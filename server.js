// HighlightHype — private-beta server.
// Zero-dependency Node 22+ app (uses node:sqlite). No build step.
// Run:  node server.js        (PORT, DATA_DIR, OWNER_TOKEN are optional)
// Data: DATA_DIR/highlighthype.db + DATA_DIR/uploads/
// SECURITY NOTE: the owner token is a private-beta gate, NOT real account
// security. It lives in the owner's browser localStorage. Anyone with the
// token (or the owner's device) can moderate. Real login/password auth is
// still required before a public launch. Never put OWNER_TOKEN in git.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
// Hype Frame print images live OUTSIDE the publicly served uploads dir:
// they are a family's own video stills, so they are stored under DATA_DIR
// and served only through the owner-authorized image endpoint below.
// They are never listed on any public endpoint.
const HYPEFRAME_DIR = path.join(DATA_DIR, "hype-frames");
fs.mkdirSync(HYPEFRAME_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "highlighthype.db");

// ---- Hardening (2026-11-04, security/infra review follow-up) ----
// Named thresholds for the upload guards in POST /api/highlights:
// refuse file writes when the data volume is nearly full, and cap how
// many plays one connection can create per hour. Beta traffic is a
// handful of uploads a day, so both limits sit far above real use and
// exist only to stop a stranger filling the disk that holds the DB.
const MIN_FREE_BYTES = 200 * 1024 * 1024; // free-space floor: 200 MB
const UPLOAD_RATE_LIMIT = 20;             // uploads per IP per window
const UPLOAD_RATE_WINDOW_MS = 60 * 60 * 1000;
const uploadHitsByIp = new Map();
// Backup file downloads may only ever serve files inside these two
// data subdirectories (the DB is served by its own snapshot endpoint).
const BACKUP_FILE_DIRS = [UPLOAD_DIR, HYPEFRAME_DIR];


// ---- Pending-approval email notification (zero-dependency SMTP) ----
// Set in Render env vars to enable: SMTP_USER (e.g. hello@highlighthype.com),
// SMTP_PASS (mailbox password, never committed), SMTP_HOST (default
// mail.privateemail.com), SMTP_PORT (default 465), NOTIFY_TO (default
// hello@highlighthype.com). If SMTP_USER/SMTP_PASS are unset, this is a
// silent no-op and uploads still succeed.
function smtpSend({ host, port, user, pass, from, to, subject, body }) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect(port, host, { servername: host });
    let buf = ""; const queue = []; let waiting = null;
    const readLine = () => new Promise((res) => { waiting = res; pump(); });
    function pump() {
      let i;
      while (waiting && (i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (/^\d{3}-/.test(line)) continue;
        const w = waiting; waiting = null; w(line);
      }
    }
    sock.on("data", (d) => { buf += d.toString("utf8"); pump(); });
    sock.on("error", reject);
    sock.setTimeout(15000, () => sock.destroy(new Error("SMTP timeout")));
    (async () => {
      try {
        await readLine();
        const cmd = async (c, expect) => { sock.write(c + "\r\n"); const r = await readLine(); if (expect && !r.startsWith(expect)) throw new Error("SMTP: " + r); return r; };
        await cmd(`EHLO highlighthype.com`, "250");
        await cmd(`AUTH LOGIN`, "334");
        await cmd(Buffer.from(user).toString("base64"), "334");
        await cmd(Buffer.from(pass).toString("base64"), "235");
        await cmd(`MAIL FROM:<${from}>`, "250");
        await cmd(`RCPT TO:<${to}>`, "250");
        await cmd("DATA", "354");
        sock.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`);
        await readLine();
        await cmd("QUIT", "221");
        sock.end(); resolve();
      } catch (e) { try { sock.destroy(); } catch {} reject(e); }
    })();
  });
}
function notifyPending(title, sport, id, review) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return;
  const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
  const reviewLine = review ? `\nPre-review: ${review.verdict}${review.flags.length ? " — " + review.flags.join("; ") : " — no flags found"}\n(Pre-review is a first-pass check only. It does NOT approve the play — you still approve or hide it in Owner view.)\n` : "";
  let modLink = "";
  try { modLink = `https://highlighthype.com/moderate?id=${id}&token=${moderateToken()}`; } catch {}
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
    subject: `HighlightHype: new play pending approval — ${title}`,
    body: `A new play is waiting for approval on highlighthype.com.\n\nTitle: ${title}\nSport: ${sport}\nPlay ID: ${id}\n${reviewLine}\nView it and approve or decline here (works on any device, no Owner token needed):\n${modLink}\n\nOr open Owner view on the device where you claimed ownership: https://highlighthype.com/#owner\n\nPrivate beta only: anyone with the moderation link can approve or decline. Do not forward it.\n` })
    .catch((e) => console.error("notifyPending failed:", e.message));
}

// ---- Guardian text messages (SMS) — CAPTURE ONLY for now ----
// Emil approved collecting a parent/guardian mobile + text opt-in at
// upload (2026-11-03). Actually SENDING texts waits for a Twilio account
// Emil will set up himself: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and
// TWILIO_FROM (the HighlightHype number) in Render env vars to activate.
// Until then this is an inert no-op with a clear log line, exactly like
// SMTP above behaves when SMTP_USER/SMTP_PASS are unset. No credentials
// live in the code, and nothing is ever texted to the athlete — guardian
// numbers only, and only where the guardian checked the opt-in box.
function sendText(to, body) {
  const sid = process.env.TWILIO_ACCOUNT_SID, auth = process.env.TWILIO_AUTH_TOKEN, from = process.env.TWILIO_FROM;
  if (!sid || !auth || !from) { const masked = to ? "***" + String(to).replace(/\D/g, "").slice(-2) : "(no number)"; console.log(`[sms] TWILIO_* env vars not set — text NOT sent (guardian number ${masked}; message body withheld from logs)`); return Promise.resolve(false); }
  if (!to) return Promise.resolve(false);
  const creds = Buffer.from(`${sid}:${auth}`).toString("base64");
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: { authorization: `Basic ${creds}`, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ From: from, To: to, Body: String(body) }).toString(),
  }).then(async (r) => {
    if (!r.ok) { console.error("sendText failed:", r.status); return false; }
    return true;
  }).catch((e) => { console.error("sendText failed:", e.message); return false; });
}
// Text a guardian ONLY when they left a mobile AND checked the opt-in.
function notifyGuardianText(row, body) {
  if (!row || !row.guardian_phone || !row.text_consent) return;
  sendText(row.guardian_phone, body).catch(() => {});
}

// ---- Agent pre-review (first-pass check, NOT an approval) ----
// Runs on every new upload/link before it reaches the owner queue.
// It only checks what the server can see: the submitted text, the media
// type/size, and whether it is an uploaded file or an external link.
// It cannot judge the video itself (faces, age, context) — that is why
// every play still starts PENDING and needs a human owner decision.
function preReview({ title, sport, playType, playerName, story, mediaKind, mime, fileSize }) {
  const flags = [];
  const text = [title, playerName, story].join(" ").toLowerCase();
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test([title, playerName, story].join(" "))) flags.push("Contact info (email) in title/name/story — remove before approving");
  if (/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/.test(text)) flags.push("Phone number in title/name/story — remove before approving");
  const hasFullName = /\S+\s+\S+/.test(String(playerName || "").trim());
  if (hasFullName && /(school|team|plainview|pasadena|hawks)/.test(text)) flags.push("Possible full name + school/team — check the site safety rule (first names only, no full name + school + team)");
  const bad = ["fuck", "shit", "bitch", "asshole", "damn", "hell"];
  if (bad.some((w) => new RegExp(`\\b${w}\\b`).test(text))) flags.push("Strong language in title/name/story — check before approving");
  if (String(story || "").length > 500) flags.push("Very long story — check it before approving");
  if (mediaKind === "file" && mime === "video/quicktime") flags.push("MOV upload — plays in Safari but may not play in all browsers; an MP4 version is safer");
  if (mediaKind && mediaKind.startsWith("link")) flags.push("External link, not an uploaded file — check the source before approving");
  if (fileSize && fileSize > 100 * 1024 * 1024) flags.push("Very large file (over 100 MB)");
  return { verdict: flags.length ? "FLAGGED — needs a closer look" : "Clean — no flags found", flags, checkedAt: new Date().toISOString() };
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
CREATE TABLE IF NOT EXISTS highlights(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL, sport TEXT NOT NULL DEFAULT 'other',
  play_type TEXT DEFAULT '', player_name TEXT DEFAULT '', story TEXT DEFAULT '',
  media_kind TEXT NOT NULL, media_url TEXT NOT NULL, mime TEXT DEFAULT '',
  embed_url TEXT DEFAULT '', host_label TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS votes(
  highlight_id INTEGER NOT NULL, voter_token TEXT NOT NULL,
  UNIQUE(highlight_id, voter_token)
);
CREATE TABLE IF NOT EXISTS contest_entries(
  highlight_id INTEGER NOT NULL, period TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(highlight_id, period)
);
CREATE TABLE IF NOT EXISTS contest_winners(
  period TEXT PRIMARY KEY, highlight_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS reports(
  id INTEGER PRIMARY KEY AUTOINCREMENT, highlight_id INTEGER NOT NULL,
  reason TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT);
`);

try { db.exec("ALTER TABLE votes ADD COLUMN created_at TEXT"); db.exec("UPDATE votes SET created_at=datetime('now') WHERE created_at IS NULL"); } catch {}
try { db.exec("ALTER TABLE votes ADD COLUMN period TEXT"); db.exec("UPDATE votes SET period=substr(created_at,1,7) WHERE period IS NULL OR period=''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN division TEXT DEFAULT 'coed'"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN review TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN team TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN notify_email TEXT DEFAULT ''"); } catch {}
// Guardian mobile + text opt-in (2026-11-03 follow-up). Both are PRIVATE,
// treated exactly like notify_email: stored on the play, stripped from
// every public response, visible only on owner-authorized endpoints.
// text_consent is the uploader's explicit opt-in (unchecked by default);
// a phone stored WITHOUT consent is never treated as textable.
try { db.exec("ALTER TABLE highlights ADD COLUMN guardian_phone TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN text_consent INTEGER DEFAULT 0"); } catch {}
// Sample plays (Round 7, 2026-11-05): owner-flagged demo plays (the
// AI-generated seed clips) that show newcomers how the board works.
// They render with a SAMPLE badge, can collect votes and be used in
// the Hype Frame studio, but they can NEVER enter the contest or
// appear in the Hall of Fame (enforced at the contest endpoints and
// in the contest/board queries below). Default 0 = a real family play.
try { db.exec("ALTER TABLE highlights ADD COLUMN is_sample INTEGER DEFAULT 0"); } catch {}
// A contest play is prize-eligible when the owner can actually reach a
// parent/guardian: a guardian email on file, OR a guardian mobile WITH
// text consent. No reachable guardian = not prize-eligible.
/* Prize eligibility (Round 9, 2026-11-05): a play can be featured
   as a winner when the parent/guardian is reachable SOMEHOW — a
   guardian email OR a guardian mobile on file; either one is
   enough (the upload form now says exactly that). Text consent is
   NOT part of eligibility anymore: it still governs whether we may
   TEXT the number (notifyGuardianText keeps requiring it), but a
   phone on file makes the play prize-eligible on its own. */
const prizeEligibleFor = (row) => !!row && (!!row.notify_email || !!row.guardian_phone);
// Loose phone sanity: keep what the guardian typed, but only store it if
// it has enough digits to be a real number (drops obvious typos/garbage).
const cleanPhone = (s) => { const v = String(s || "").trim(); return v.replace(/\D/g, "").length >= 10 ? v.slice(0, 32) : ""; };
const parseConsent = (v) => ["on", "yes", "true", "1"].includes(String(v ?? "").trim().toLowerCase()) ? 1 : 0;
// ---- Athlete identity (same-name differentiation) ----
// Two different youths can post under the same name. A play's athlete is
// NEVER identified by the name string alone: each athlete gets a stable
// athlete_id plus a short public tag (HH-####). Identity resolution at
// upload time, in order: (1) the uploader explicitly picks "same athlete"
// from the duplicate-check prompt (athleteChoice=same + athleteKey);
// (2) same normalized name + team AND the same guardian email hash as an
// existing athlete -> same athlete; (3) otherwise a NEW athlete is created
// — a matching name with a different (or missing) guardian email is a
// different athlete, never silently merged.
db.exec(`CREATE TABLE IF NOT EXISTS athletes(
  athlete_key TEXT PRIMARY KEY, tag TEXT UNIQUE NOT NULL,
  name_norm TEXT NOT NULL, team_norm TEXT NOT NULL DEFAULT '',
  email_hash TEXT NOT NULL DEFAULT '', display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
try { db.exec("ALTER TABLE highlights ADD COLUMN athlete_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN athlete_tag TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN athlete_group TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN jersey TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE athletes ADD COLUMN division TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE athletes ADD COLUMN jersey TEXT DEFAULT ''"); } catch {}
// ---- Hype Frame order requests (2026-11-04) ----
// A Hype Frame starts from an APPROVED play: a family freezes a frame of
// the athlete's own highlight in the studio, customizes it, previews it on
// apparel, and a parent/guardian submits an ORDER REQUEST. There is no
// payment and no price anywhere in this flow: status starts as
// "pending-guardian" and printing happens only after the owner confirms
// with the guardian directly. guardian_email is private exactly like
// notify_email — stored here, returned ONLY on owner-authorized
// endpoints, never in a public response.
db.exec(`CREATE TABLE IF NOT EXISTS hype_frame_orders(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  highlight_id INTEGER NOT NULL,
  athlete_id TEXT DEFAULT '',
  print_image TEXT NOT NULL DEFAULT '',
  custom_name TEXT DEFAULT '',
  jersey TEXT DEFAULT '',
  branding INTEGER DEFAULT 1,
  apparel TEXT DEFAULT 'hoodie',
  colorway TEXT DEFAULT '',
  guardian_name TEXT DEFAULT '',
  guardian_email TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending-guardian',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Print placement (2026-11-04): where the print sits on the garment, as
// percentages relative to the garment's print area — {cx, cy, size}
// (center across, center down, width as % of the print-area width).
// Stored as a JSON string so the owner (and any printer) can reproduce
// exactly what the family previewed. Added additively for existing DBs.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN placement TEXT DEFAULT ''"); } catch {}
// Print side (Store v8, 2026-11-04): 'front' | 'back' — which side of
// the garment the print lands on, chosen in the studio. Added
// additively for existing DBs, same pattern as placement.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN side TEXT DEFAULT 'front'"); } catch {}
// Youth size (Round 3, 2026-11-05): the studio's size picker rides on
// the order (YXXS..YXL). Added additively, same pattern; pre-Round-3
// rows read back '' and the owner surfaces show the YM default.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN size TEXT DEFAULT ''"); } catch {}
const normIdentity = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
function athleteDisplayName(raw) {
  const parts = String(raw || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}
function newAthleteTag() {
  for (let i = 0; i < 50; i++) {
    const tag = "HH-" + Math.floor(1000 + Math.random() * 9000);
    if (!db.prepare("SELECT 1 FROM athletes WHERE tag=?").get(tag)) return tag;
  }
  return "HH-" + crypto.randomBytes(3).toString("hex").toUpperCase();
}
function resolveAthlete({ playerName, team, division = "", jersey = "", notifyEmail, athleteChoice, athleteKey }) {
  const nameNorm = normIdentity(playerName), teamNorm = normIdentity(team);
  if (!nameNorm) return { athlete_id: "", athlete_tag: "", athlete_group: "" };
  const group = nameNorm + "|" + teamNorm;
  const emailHash = notifyEmail ? sha(normIdentity(notifyEmail)) : "";
  if (athleteChoice === "same" && athleteKey) {
    const a = db.prepare("SELECT * FROM athletes WHERE athlete_key=? AND name_norm=?").get(String(athleteKey), nameNorm);
    if (a) return { athlete_id: a.athlete_key, athlete_tag: a.tag, athlete_group: group };
  }
  if (emailHash) {
    const a = db.prepare("SELECT * FROM athletes WHERE name_norm=? AND team_norm=? AND email_hash=? AND email_hash<>''").get(nameNorm, teamNorm, emailHash);
    if (a) return { athlete_id: a.athlete_key, athlete_tag: a.tag, athlete_group: group };
  }
  const key = crypto.randomBytes(8).toString("hex");
  const tag = newAthleteTag();
  db.prepare("INSERT INTO athletes(athlete_key,tag,name_norm,team_norm,email_hash,display_name,division,jersey) VALUES(?,?,?,?,?,?,?,?)")
    .run(key, tag, nameNorm, teamNorm, emailHash, athleteDisplayName(playerName), String(division || ""), String(jersey || ""));
  return { athlete_id: key, athlete_tag: tag, athlete_group: group };
}
function athleteCollision(group) {
  if (!group) return false;
  const r = db.prepare("SELECT COUNT(DISTINCT athlete_id) c FROM highlights WHERE athlete_group=? AND athlete_id<>''").get(group);
  return (r?.c || 0) > 1;
}
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const getSetting = (k) => db.prepare("SELECT value FROM settings WHERE key=?").get(k)?.value;
const setSetting = (k, v) => db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(k, v);

function ownerAuthorized(req) {
  const token = req.headers["x-owner-token"];
  if (!token) return false;
  if (process.env.OWNER_TOKEN) return sha(token) === sha(process.env.OWNER_TOKEN);
  const stored = getSetting("owner_token_hash");
  return !!stored && sha(token) === stored;
}
// ---- Email moderation (private beta) ----
// Why this exists: Owner view relies on a token in ONE browser's
// localStorage, so an email link opened on another device (e.g. a phone)
// shows an empty queue. Email moderation links carry a dedicated token
// instead, so the owner can view and approve/hide from any device.
// SECURITY: anyone with a moderation link can moderate. Keep the
// hello@ mailbox private. Set MODERATE_TOKEN in Render env vars to
// choose/rotate the token; it takes precedence over the stored one.
// Never put MODERATE_TOKEN in git.
function moderateToken() {
  if (process.env.MODERATE_TOKEN) return String(process.env.MODERATE_TOKEN);
  let t = getSetting("moderate_token");
  if (!t) { t = crypto.randomBytes(24).toString("hex"); setSetting("moderate_token", t); }
  return t;
}
function moderateAuthorized(token) {
  return !!token && sha(String(token)) === sha(moderateToken());
}
const escHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function moderateMediaHtml(row) {
  const url = row.embed_url || row.media_url || "";
  if (row.media_kind === "file" && /\.(mp4|webm|mov)$/i.test(row.media_url))
    return `<video controls playsinline style="max-width:100%;max-height:60vh"><source src="${escHtml(row.media_url)}"></video>`;
  if (row.media_kind === "file" && /\.(jpg|jpeg|png|gif|webp)$/i.test(row.media_url))
    return `<img src="${escHtml(row.media_url)}" style="max-width:100%" alt="">`;
  if (url) return `<p><a href="${escHtml(url)}" target="_blank" rel="noopener">Open the play media</a> (${escHtml(row.host_label || "external link")})</p>`;
  return `<p>No media preview available.</p>`;
}
function moderatePage(row, token, message = "") {
  let review = null; try { review = row.review ? JSON.parse(row.review) : null; } catch {}
  const flags = review?.flags?.length ? `<p><b>Pre-review:</b> ${escHtml(review.verdict)} — ${escHtml(review.flags.join("; "))}</p>` : "";
  const statusNote = row.status !== "pending"
    ? `<p><b>This play is already ${escHtml(row.status)}.</b>${row.status === "approved" ? ` <a href="https://highlighthype.com/#play-${row.id}">View it on the board</a>` : ""}</p>`
    : "";
  const forms = row.status === "pending" ? `
    <form method="POST" action="/moderate" style="display:inline">
      <input type="hidden" name="id" value="${row.id}"><input type="hidden" name="token" value="${escHtml(token)}">
      <input type="hidden" name="action" value="approve">
      <button type="submit" style="font-size:18px;padding:12px 20px">Approve</button>
    </form>
    <form method="POST" action="/moderate" style="display:inline;margin-left:12px">
      <input type="hidden" name="id" value="${row.id}"><input type="hidden" name="token" value="${escHtml(token)}">
      <input type="hidden" name="action" value="hide">
      <button type="submit" style="font-size:18px;padding:12px 20px">Decline (hide)</button>
    </form>` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderate: ${escHtml(row.title)}</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h1>Moderate this play</h1>${message ? `<p><b>${escHtml(message)}</b></p>` : ""}
<p><b>${escHtml(row.title)}</b> — ${escHtml(row.sport)}${row.player_name ? ` — ${escHtml(row.player_name)}` : ""}${row.team ? ` — team: ${escHtml(row.team)}` : ""}${row.athlete_tag ? ` — athlete ${escHtml(row.athlete_tag)}` : ""}</p>
${row.story ? `<p>${escHtml(row.story)}</p>` : ""}${flags}${moderateMediaHtml(row)}${statusNote}${forms}
<p><a href="/">← Back to the HighlightHype homepage</a></p>
<p style="color:#666">Private beta only: anyone with this link can approve or decline. Do not forward it.</p>
</body></html>`;
}
function moderateQueuePage(rows, token, message = "") {
  const items = rows.length ? rows.map((r) => `
    <div style="border:1px solid #ccc;padding:12px;margin:12px 0">
      <b>${escHtml(r.title)}</b> — ${escHtml(r.sport)} — Play ID ${r.id}
      <p><a href="/moderate?id=${r.id}&token=${escHtml(token)}">View and approve / decline this play</a></p>
    </div>`).join("") : "<p>No plays are pending right now.</p>";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderation queue</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h1>Plays waiting for approval</h1>${message ? `<p><b>${escHtml(message)}</b></p>` : ""}${items}
<p><a href="/">← Back to the HighlightHype homepage</a></p>
<p style="color:#666">Private beta only: anyone with this link can approve or decline. Do not forward it.</p>
</body></html>`;
}
function sendHtml(res, code, html) { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(html); }
function currentPeriod() { return new Date().toISOString().slice(0, 7); } // YYYY-MM
function voteCount(id) { return db.prepare("SELECT COUNT(*) c FROM votes WHERE highlight_id=?").get(id).c; }
function monthlyVoteCount(id, period) { try { return db.prepare("SELECT COUNT(*) c FROM votes WHERE highlight_id=? AND substr(created_at,1,7)=?").get(id, period).c; } catch { return voteCount(id); } }

function normalizeUrl(u) {
  u = String(u || "").trim();
  if (!u) return "";
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}
// Classify a pasted link the same way the prototype does.
function classifyLink(raw) {
  const url = normalizeUrl(raw);
  let host = "";
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch { /* keep raw */ }
  const lower = url.toLowerCase();
  if (/\.(mp4|webm)(\?|#|$)/.test(lower)) return { media_kind: "link_video", media_url: url, embed_url: "", host_label: host };
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
  if (yt) return { media_kind: "link_embed", media_url: url, embed_url: `https://www.youtube.com/embed/${yt[1]}`, host_label: "YouTube" };
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return { media_kind: "link_embed", media_url: url, embed_url: `https://player.vimeo.com/video/${vm[1]}`, host_label: "Vimeo" };
  if (/(dailymotion\.com|streamable\.com|tiktok\.com|drive\.google\.com|loom\.com)/.test(lower))
    return { media_kind: "link_embed", media_url: url, embed_url: url, host_label: host };
  return { media_kind: "link_watch", media_url: url, embed_url: "", host_label: host || "link" };
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}
function readBody(req, max = 120 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on("data", (c) => { size += c.length; if (size > max) { reject(new Error("File too large (max 120 MB)")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}
// Minimal multipart parser (fields + one file). Good enough for phone uploads.
function parseMultipart(buf, boundary) {
  const parts = []; const sep = Buffer.from("--" + boundary);
  let start = buf.indexOf(sep); if (start < 0) return parts;
  start += sep.length;
  while (true) {
    if (buf[start] === 45 && buf[start + 1] === 45) break; // -- end
    if (buf[start] === 13 && buf[start + 1] === 10) start += 2;
    const headerEnd = buf.indexOf("\r\n\r\n", start); if (headerEnd < 0) break;
    const headers = buf.toString("utf8", start, headerEnd);
    const name = headers.match(/name="([^"]*)"/)?.[1] || "";
    const filename = headers.match(/filename="([^"]*)"/)?.[1];
    const ctype = headers.match(/Content-Type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";
    const bodyStart = headerEnd + 4;
    let bodyEnd = buf.indexOf(sep, bodyStart); if (bodyEnd < 0) break;
    bodyEnd -= 2; // strip trailing CRLF
    parts.push({ name, filename, ctype, data: buf.subarray(bodyStart, bodyEnd) });
    start = bodyEnd + 2 + sep.length;
  }
  return parts;
}
const EXT = { "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov", "video/x-msvideo": "avi", "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

function notifyApproved(title, id, to) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass || !to) return;
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
    subject: `HighlightHype: your play is live — ${title}`,
    body: `Good news — your play "${title}" was approved and is now live on HighlightHype!\n\nSee it here: https://highlighthype.com/#play-${id}\n\nThanks for posting!\n` })
    .catch((e) => console.error("notifyApproved failed:", e.message));
}
// Owner notification for a new Hype Frame order request — same pattern
// as notifyPending: silent no-op when SMTP is not configured.
function notifyHypeFrameRequest(order, play) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return;
  const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
    subject: `HighlightHype: new Hype Frame request — ${play.title}`,
    body: `A family just submitted a Hype Frame order request on highlighthype.com.\n\nPlay: ${play.title} (Play ID: ${play.id})\nPrint name: ${order.custom_name || "—"}${order.jersey ? ` · #${order.jersey}` : ""}\nHYPE FRAME branding: ${order.branding ? "yes" : "no"}\nApparel: ${order.apparel} · ${order.colorway} · Size: ${order.size || "YM"} · Print side: ${order.side === "back" ? "Back" : "Front"}\n${(() => { try { const p = JSON.parse(order.placement || ""); return p ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size\n` : ""; } catch { return ""; } })()}Parent/guardian: ${order.guardian_name ? order.guardian_name + " — " : ""}${order.guardian_email}\nStatus: pending-guardian — nothing is printed until you confirm with the parent/guardian.\n\nSee the request and the print image in Owner view: https://highlighthype.com/#owner\n` })
    .catch((e) => console.error("notifyHypeFrameRequest failed:", e.message));
}
function publicHighlight(row, voterToken = "") {
  // Public shape is an explicit ALLOWLIST (hardening, 2026-11-04): only
  // the fields the client renders are returned. The old spread-minus-
  // three also leaked internal columns — above all `review`, the agent
  // pre-review JSON — and would have leaked any future column by
  // default. Private guardian contact fields (notify_email,
  // guardian_phone, text_consent) are NOT on the list and must never
  // be added; owner endpoints attach guardian details separately,
  // after their own authorization check. This is the single choke
  // point every public response flows through (board, athlete
  // collections, contest).
  // Athlete display: first name + last initial (+ team in the UI). The
  // HH-#### tag is only exposed when two different athletes share the
  // same name+team group, so it appears exactly when disambiguation is
  // needed and stays out of the way otherwise.
  const collision = athleteCollision(row.athlete_group || "");
  return {
    id: row.id,
    title: row.title,
    sport: row.sport,
    play_type: row.play_type,
    player_name: row.player_name,
    story: row.story,
    media_kind: row.media_kind,
    media_url: row.media_url,
    mime: row.mime,
    embed_url: row.embed_url,
    host_label: row.host_label,
    status: row.status,
    created_at: row.created_at,
    division: row.division,
    team: row.team,
    athlete_id: row.athlete_id,
    athlete_tag: collision ? (row.athlete_tag || "") : "",
    athlete_group: row.athlete_group,
    jersey: row.jersey,
    athlete_label: row.player_name ? athleteDisplayName(row.player_name) : "",
    athlete_collision: collision,
    // Boolean only — the guardian email itself is never exposed publicly.
    // Used to mark contest prize eligibility (winners are contacted
    // through the parent/guardian, never the child directly).
    hasGuardianEmail: !!row.notify_email,
    // Boolean only — true when a guardian mobile is on file WITH text
    // consent (i.e. reachable by text). The number itself never leaves
    // the server except on owner-authorized endpoints.
    hasGuardianText: !!row.guardian_phone && !!row.text_consent,
    hasGuardianPhone: !!row.guardian_phone,
    // Sample/demo play flag (Round 7) — a plain boolean, safe to be
    // public: the client renders the SAMPLE badge from it, and the
    // Hall of Fame ranking drops samples client-side as a second
    // layer under the server-side contest exclusions.
    isSample: !!row.is_sample,
    voteCount: voteCount(row.id),
    hasVoted: voterToken ? !!db.prepare("SELECT 1 FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").get(row.id, voterToken, currentPeriod()) : false,
  };
}
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm" };

// ---- Backup endpoints (hardening, 2026-11-04) ----
// Read-only off-site backup pull for Muse's nightly job. Auth is a
// dedicated BACKUP_TOKEN env var (separate from the owner and
// moderation tokens), compared in constant time. When BACKUP_TOKEN is
// unset the feature is OFF: every backup route answers 403. The token
// itself is set by Emil in the Render dashboard and kept in Muse's
// Secure Vault — it never appears in code, git, or chat. See
// BACKUP-RESTORE.md for the pull schedule and restore steps.
function backupAuthorized(req) {
  const expected = process.env.BACKUP_TOKEN;
  if (!expected) return false;
  const provided = req.headers["x-backup-token"];
  if (!provided) return false;
  const a = Buffer.from(String(provided)), b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
// Recursive file listing for the manifest: paths relative to DATA_DIR
// with forward slashes, sorted, so nightly pulls can diff cheaply.
function walkDataFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile()) out.push({ path: path.relative(DATA_DIR, full).split(path.sep).join("/"), size: fs.statSync(full).size });
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out;
}
function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return fwd || req.socket?.remoteAddress || "unknown";
}
// Per-IP in-memory upload rate limit (see constants at the top).
// Counts attempts, not just successes. Returns true when limited.
function uploadRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (uploadHitsByIp.get(ip) || []).filter((t) => now - t < UPLOAD_RATE_WINDOW_MS);
  if (hits.length >= UPLOAD_RATE_LIMIT) { uploadHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  uploadHitsByIp.set(ip, hits);
  return false;
}
// True when the data volume is below the free-space floor. Fails OPEN
// (returns false) if the platform cannot report free space — a backup
// guard must never take the beta down by itself.
function storageIsFull() {
  try {
    const s = fs.statfsSync(DATA_DIR);
    return Number(s.bavail) * Number(s.bsize) < MIN_FREE_BYTES;
  } catch { return false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;

    // Security headers on EVERY response (hardening, 2026-11-04). The
    // CSP is deliberately frame-ancestors only: the app uses inline
    // scripts/styles and embeds third-party video, so a broad policy
    // would break it — this one only stops other sites framing us.
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'self'");

    if (p === "/api/health") return sendJson(res, 200, { ok: true, period: currentPeriod() });

    // ---- Backup pull (token-gated; 403 for everyone when off) ----
    if (p.startsWith("/api/backup/")) {
      if (!backupAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Backup access required." });
      if (p === "/api/backup/db" && req.method === "GET") {
        // Consistent snapshot of the LIVE database: VACUUM INTO writes
        // a complete, transactionally consistent copy to a temp file
        // inside the data dir; we stream it, then delete the temp.
        const tmpSnap = path.join(DATA_DIR, `.backup-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.sqlite`);
        db.exec(`VACUUM INTO '${tmpSnap.replace(/'/g, "''")}'`);
        const size = fs.statSync(tmpSnap).size;
        res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": 'attachment; filename="highlighthype-db.sqlite"', "content-length": size });
        const stream = fs.createReadStream(tmpSnap);
        let cleaned = false;
        const cleanup = () => { if (!cleaned) { cleaned = true; try { fs.unlinkSync(tmpSnap); } catch {} } };
        stream.on("error", cleanup);
        res.on("finish", cleanup);
        res.on("close", cleanup);
        return stream.pipe(res);
      }
      if (p === "/api/backup/manifest" && req.method === "GET") {
        const files = BACKUP_FILE_DIRS.flatMap((d) => walkDataFiles(d)).sort((a, b) => a.path.localeCompare(b.path));
        const dbSize = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
        return sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), db: { path: "highlighthype.db", size: dbSize }, dbSize, files });
      }
      if (p === "/api/backup/file" && req.method === "GET") {
        const rel = u.searchParams.get("path") || "";
        // Traversal guard: no empty/absolute/NUL paths, and the fully
        // resolved path must stay inside one of the backup file dirs
        // (which also keeps the DB file itself out of this route).
        if (!rel || rel.includes("\0") || path.isAbsolute(rel)) return sendJson(res, 400, { ok: false, message: "Invalid backup path." });
        const resolved = path.resolve(DATA_DIR, rel);
        const allowed = BACKUP_FILE_DIRS.some((d) => resolved.startsWith(d + path.sep));
        if (!allowed) return sendJson(res, 403, { ok: false, message: "Path is outside the backup file directories." });
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return sendJson(res, 404, { ok: false, message: "Backup file not found." });
        res.writeHead(200, { "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${path.basename(resolved)}"`, "content-length": fs.statSync(resolved).size });
        return fs.createReadStream(resolved).pipe(res);
      }
      return sendJson(res, 404, { ok: false, message: "Unknown backup route." });
    }

    // ---- Owner claim (one-time; token is returned ONCE and never again) ----
    if (p === "/api/owner/status" && req.method === "GET")
      return sendJson(res, 200, { claimed: !!process.env.OWNER_TOKEN || !!getSetting("owner_token_hash"), envManaged: !!process.env.OWNER_TOKEN });
    if (p === "/api/owner/claim" && req.method === "POST") {
      if (process.env.OWNER_TOKEN || getSetting("owner_token_hash"))
        return sendJson(res, 409, { ok: false, message: "Owner already claimed. Use the token saved on the owner's device." });
      const token = crypto.randomBytes(24).toString("hex");
      setSetting("owner_token_hash", sha(token));
      return sendJson(res, 200, { ok: true, token, warning: "Save this token: it is shown only once. It is stored in this browser automatically." });
    }

    // ---- Athlete duplicate check (upload form) ----
    // Returns existing athletes whose normalized name matches, so the
    // uploader can say "same athlete" vs "a different athlete with the
    // same name" instead of the server silently merging by name string.
    // Exposes only public facts: display label, team, tag, play count.
    if (p === "/api/athletes/check" && req.method === "GET") {
      const nameNorm = normIdentity(u.searchParams.get("name") || "");
      if (!nameNorm) return sendJson(res, 200, { matches: [] });
      const rows = db.prepare("SELECT * FROM athletes WHERE name_norm=? ORDER BY created_at").all(nameNorm);
      const matches = rows.map((a) => ({
        athleteKey: a.athlete_key, tag: a.tag, displayName: a.display_name,
        team: db.prepare("SELECT team FROM highlights WHERE athlete_id=? AND team<>'' LIMIT 1").get(a.athlete_key)?.team || "",
        playCount: db.prepare("SELECT COUNT(*) c FROM highlights WHERE athlete_id=?").get(a.athlete_key).c,
      }));
      return sendJson(res, 200, { matches });
    }

    // ---- Public highlights ----
    if (p === "/api/highlights" && req.method === "GET") {
      const sport = u.searchParams.get("sport") || "all";
      const division = u.searchParams.get("division") || "all";
      const team = u.searchParams.get("team") || "all";
      const search = (u.searchParams.get("search") || "").toLowerCase();
      const sort = u.searchParams.get("sort") || "top";
      const voter = u.searchParams.get("voterToken") || "";
      let rows = db.prepare("SELECT * FROM highlights WHERE status='approved'").all();
      const athleteId = u.searchParams.get("athlete_id") || "";
      if (athleteId) rows = rows.filter((r) => r.athlete_id === athleteId);
      if (sport !== "all") rows = rows.filter((r) => r.sport === sport);
      // No Coed option any more, but older plays stored as coed still show
      // on both boards until they are re-tagged.
      if (division !== "all") rows = rows.filter((r) => (r.division || "coed") === division || (r.division || "coed") === "coed");
      if (team !== "all") rows = rows.filter((r) => slugify(r.team) === team || (r.team || "").toLowerCase() === team.toLowerCase());
      if (search) rows = rows.filter((r) => [r.title, r.player_name, r.story].join(" ").toLowerCase().includes(search));
      rows = rows.map((r) => publicHighlight(r, voter));
      if (sort === "top") rows.sort((a, b) => b.voteCount - a.voteCount || b.id - a.id);
      else if (sort === "oldest") rows.sort((a, b) => a.id - b.id);
      else rows.sort((a, b) => b.id - a.id);
      return sendJson(res, 200, { highlights: rows, totalHighlights: rows.length, totalVotes: rows.reduce((s, r) => s + r.voteCount, 0) });
    }

    // ---- Create a play: always starts PENDING (private beta lockdown) ----
    if (p === "/api/highlights" && req.method === "POST") {
      if (uploadRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many uploads from this connection right now — please try again in a little while." });
      const buf = await readBody(req);
      const ct = req.headers["content-type"] || "";
      let fields = {}, file = null;
      if (ct.includes("multipart/form-data")) {
        const boundary = ct.split("boundary=")[1];
        for (const part of parseMultipart(buf, boundary)) {
          if (part.filename) file = part; else fields[part.name] = part.data.toString("utf8");
        }
      } else {
        try { fields = JSON.parse(buf.toString("utf8") || "{}"); } catch { fields = {}; }
      }
      const title = String(fields.title || "").trim();
      if (!title) return sendJson(res, 400, { ok: false, message: "Title is required." });
      const sport = String(fields.sport || "other").trim().toLowerCase();
      const division = ["girls","boys"].includes(String(fields.division || "").trim().toLowerCase()) ? String(fields.division).trim().toLowerCase() : "boys";
      let media_kind, media_url, mime = "", embed_url = "", host_label = "";
      if (file && file.filename) {
        const ext = EXT[file.ctype] || path.extname(file.filename).replace(".", "").toLowerCase();
        if (!["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"].includes(ext) || !(file.ctype.startsWith("video/") || file.ctype.startsWith("image/")))
          return sendJson(res, 400, { ok: false, message: "Upload a video or photo file." });
        if (storageIsFull()) return sendJson(res, 507, { ok: false, message: "Storage is full right now — please try again later." });
        const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data);
        media_kind = "file"; media_url = `/uploads/${name}`; mime = file.ctype;
      } else if (fields.videoUrl) {
        const c = classifyLink(fields.videoUrl);
        media_kind = c.media_kind; media_url = c.media_url; embed_url = c.embed_url; host_label = c.host_label;
      } else {
        return sendJson(res, 400, { ok: false, message: "Upload a file or paste a video link." });
      }
      const review = preReview({ title, sport, playType: fields.playType || "", playerName: fields.playerName || "", story: fields.story || "", mediaKind: media_kind, mime, fileSize: file ? file.data.length : 0 });
      const athlete = resolveAthlete({ playerName: fields.playerName || "", team: String(fields.team || "").trim(), division, jersey: String(fields.jersey || "").trim(), notifyEmail: String(fields.notifyEmail || "").trim(), athleteChoice: String(fields.athleteChoice || ""), athleteKey: String(fields.athleteKey || "") });
      const guardianPhone = cleanPhone(fields.guardianPhone || "");
      const textConsent = parseConsent(fields.textConsent);
      const info = db.prepare(`INSERT INTO highlights(title,sport,division,play_type,player_name,story,media_kind,media_url,mime,embed_url,host_label,status,review,team,notify_email,athlete_id,athlete_tag,athlete_group,jersey,guardian_phone,text_consent)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?)`).run(title, sport, division, fields.playType || "", fields.playerName || "", fields.story || "", media_kind, media_url, mime, embed_url, host_label, JSON.stringify(review), String(fields.team || "").trim(), String(fields.notifyEmail || "").trim(), athlete.athlete_id, athlete.athlete_tag, athlete.athlete_group, String(fields.jersey || "").trim(), guardianPhone, textConsent);
      notifyPending(title, sport, Number(info.lastInsertRowid), review);
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid), status: "pending", message: "Thanks! Your play is in review and will appear once the owner approves it." });
    }

    // ---- Vote toggle ----
    const voteMatch = p.match(/^\/api\/highlights\/(\d+)\/vote$/);
    if (voteMatch && req.method === "POST") {
      const id = Number(voteMatch[1]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const voter = String(body.voterToken || "").trim();
      if (!voter) return sendJson(res, 400, { ok: false, message: "Missing voter token." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=? AND status='approved'").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found or not yet approved." });
      const period = currentPeriod();
      const existing = db.prepare("SELECT 1 FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").get(id, voter, period);
      if (existing) db.prepare("DELETE FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").run(id, voter, period);
      else db.prepare("INSERT INTO votes(highlight_id,voter_token,created_at,period) VALUES(?,?,datetime('now'),?)").run(id, voter, period);
      return sendJson(res, 200, { ok: true, voteCount: voteCount(id), hasVoted: !existing });
    }

    // ---- Report ----
    const reportMatch = p.match(/^\/api\/highlights\/(\d+)\/report$/);
    if (reportMatch && req.method === "POST") {
      const id = Number(reportMatch[1]);
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!db.prepare("SELECT 1 FROM highlights WHERE id=?").get(id)) return sendJson(res, 404, { ok: false, message: "Play not found." });
      db.prepare("INSERT INTO reports(highlight_id,reason) VALUES(?,?)").run(id, String(body.reason || "Reported by a user"));
      return sendJson(res, 200, { ok: true, message: "Thanks — the owner has been notified and will review this play." });
    }

    // ---- Hype Frame order requests ----
    // Creates a request ONLY for an APPROVED play (the studio button only
    // exists on approved plays, and the endpoint re-checks server-side).
    // The client sends the final print image as a PNG data URL (the exact
    // canvas composite the family previewed, branding included when on).
    // No payment, no price. The guardian email in the response is never
    // echoed back — it is only stored and owner-visible.
    if (p === "/api/hype-frame/orders" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const play = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(body.highlightId));
      if (!play || play.status !== "approved")
        return sendJson(res, 404, { ok: false, message: "Hype Frame starts from an approved play on the board — this play is not approved yet." });
      const guardianEmail = String(body.guardianEmail || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guardianEmail))
        return sendJson(res, 400, { ok: false, message: "A parent/guardian email is required so we can confirm the order before printing." });
      const m = String(body.image || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) return sendJson(res, 400, { ok: false, message: "Freeze a frame first — the print image is missing." });
      const imgBuf = Buffer.from(m[1], "base64");
      if (!imgBuf.length || imgBuf.length > 25 * 1024 * 1024)
        return sendJson(res, 400, { ok: false, message: "That print image is too large — try freezing the frame again." });
      if (imgBuf.subarray(0, 4).toString("hex") !== "89504e47")
        return sendJson(res, 400, { ok: false, message: "The print image must be a PNG — try freezing the frame again." });
      if (storageIsFull()) return sendJson(res, 507, { ok: false, message: "Storage is full right now — please try again later." });
      const imgName = `hf-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.png`;
      fs.writeFileSync(path.join(HYPEFRAME_DIR, imgName), imgBuf);
      // Placement: percentages relative to the garment print area.
      // Clamp to sane ranges; a missing/partial placement falls back to
      // the studio defaults (centered, default size) so every order on
      // file carries a reproducible placement.
      const plIn = body.placement && typeof body.placement === "object" ? body.placement : {};
      const clampPct = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n * 10) / 10)) : dflt; };
      const placement = JSON.stringify({
        cx: clampPct(plIn.cx, 0, 100, 50),
        cy: clampPct(plIn.cy, 0, 100, 42),
        size: clampPct(plIn.size, 10, 100, 78),
      });
      const order = {
        highlight_id: play.id,
        athlete_id: play.athlete_id || "",
        print_image: imgName,
        custom_name: String(body.customName || "").trim().slice(0, 60),
        jersey: String(body.jersey || "").trim().slice(0, 8),
        branding: body.branding === false ? 0 : 1,
        apparel: String(body.apparel || "").trim().toLowerCase() === "tee" ? "tee" : "hoodie",
        side: String(body.side || "").trim().toLowerCase() === "back" ? "back" : "front",
        colorway: String(body.colorway || "").trim().slice(0, 40),
        size: ["YXXS", "YXS", "YS", "YM", "YL", "YXL"].includes(String(body.size || "").trim().toUpperCase()) ? String(body.size).trim().toUpperCase() : "YM",
        guardian_name: String(body.guardianName || "").trim().slice(0, 80),
        guardian_email: guardianEmail,
        placement,
      };
      const info = db.prepare(`INSERT INTO hype_frame_orders(highlight_id,athlete_id,print_image,custom_name,jersey,branding,apparel,side,colorway,size,guardian_name,guardian_email,placement)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.highlight_id, order.athlete_id, order.print_image, order.custom_name, order.jersey, order.branding, order.apparel, order.side, order.colorway, order.size, order.guardian_name, order.guardian_email, order.placement);
      notifyHypeFrameRequest({ ...order, id: Number(info.lastInsertRowid) }, play);
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid), status: "pending-guardian", message: "Request received — we'll email the parent/guardian to confirm before anything is printed." });
    }

    // ---- Contest ----
    if (p === "/api/contest" && req.method === "GET") {
      const period = u.searchParams.get("period") || currentPeriod();
      const voter = u.searchParams.get("voterToken") || "";
      const winnerId = db.prepare("SELECT highlight_id FROM contest_winners WHERE period=?").get(period)?.highlight_id;
      // Defensive (Round 7): samples are refused at the enter
      // endpoint, but even a legacy/hand-made entry row for a sample
      // must never surface on the month board or the podium — the
      // query itself excludes them.
      const rows = db.prepare(`SELECT h.* FROM contest_entries e JOIN highlights h ON h.id=e.highlight_id
        WHERE e.period=? AND h.status='approved' AND COALESCE(h.is_sample,0)=0`).all(period).map((r) => ({ ...publicHighlight(r, voter), voteCount: monthlyVoteCount(r.id, period), isWinner: r.id === winnerId, prizeEligible: prizeEligibleFor(r) }));
      rows.sort((a, b) => b.voteCount - a.voteCount || a.id - b.id);
      const sportCounts = {};
      for (const r of rows) sportCounts[r.sport] = (sportCounts[r.sport] || 0) + 1;
      return sendJson(res, 200, { period, entries: rows, totalEntries: rows.length, sportCounts, winnerId: winnerId || null });
    }
    if (p === "/api/contest/enter" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = Number(body.highlightId);
      const period = String(body.period || currentPeriod());
      if (!/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { ok: false, message: "Invalid month." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=? AND status='approved'").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found, or it is still in review — approved plays only can enter." });
      // Sample plays are demos (Round 7): they can collect votes but
      // can never take a contest slot or a prize.
      if (row.is_sample) return sendJson(res, 400, { ok: false, message: "Sample plays can't enter Hype of the Month." });
      const dup = db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(id, period);
      if (dup) return sendJson(res, 200, { ok: false, alreadyEntered: true, message: "This play is already entered in Hype of the Month." });
      const info = db.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(id, period);
      return sendJson(res, 201, { ok: true, entryId: Number(info.lastInsertRowid), period, message: "Entered in Hype of the Month!" });
    }
    if (p === "/api/contest/winner" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const period = String(body.period || currentPeriod());
      const id = Number(body.highlightId);
      if (!db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(id, period))
        return sendJson(res, 400, { ok: false, message: "That play is not entered in this month's contest." });
      const wrowPre = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      // Defensive (Round 7): a sample can never be crowned, even if an
      // entry row somehow existed for it.
      if (wrowPre && wrowPre.is_sample) return sendJson(res, 400, { ok: false, message: "Sample plays can't enter Hype of the Month." });
      db.prepare("INSERT INTO contest_winners(period,highlight_id) VALUES(?,?) ON CONFLICT(period) DO UPDATE SET highlight_id=excluded.highlight_id").run(period, id);
      const wrow = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      // If the guardian opted into texts, send the claim text — inert
      // (log line only) until Emil activates Twilio; see sendText.
      if (wrow) notifyGuardianText(wrow, `HighlightHype: your athlete's play "${wrow.title}" won Hype of the Month! Reply to this text or check your email to claim. — HighlightHype`);
      return sendJson(res, 200, { ok: true, period, highlightId: id, warning: prizeEligibleFor(wrow) ? "" : "This play has no parent/guardian email or mobile on file, so the winner's parent/guardian cannot be contacted — it can't be featured as Hype of the Month until one is added." });
    }

    // ---- Email moderation (works on any device; see moderateToken) ----
    if (p === "/moderate" && req.method === "GET") {
      const token = u.searchParams.get("token") || "";
      if (!moderateAuthorized(token)) return sendHtml(res, 403, "<h1>Moderation link not valid</h1><p>Check the link from the approval email, or request a fresh moderation link.</p><p><a href=\"/\">← HighlightHype home</a></p>");
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(u.searchParams.get("id") || 0));
      if (!row) return sendHtml(res, 404, "<h1>Play not found</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      return sendHtml(res, 200, moderatePage(row, token));
    }
    if (p === "/moderate" && req.method === "POST") {
      const params = new URLSearchParams((await readBody(req)).toString("utf8"));
      const token = params.get("token") || "";
      if (!moderateAuthorized(token)) return sendHtml(res, 403, "<h1>Moderation link not valid</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      const id = Number(params.get("id") || 0);
      const action = params.get("action");
      if (!["approve", "hide"].includes(action)) return sendHtml(res, 400, "<h1>Invalid action</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      const status = action === "approve" ? "approved" : "hidden";
      const before = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!before) return sendHtml(res, 404, "<h1>Play not found</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      db.prepare("UPDATE highlights SET status=? WHERE id=?").run(status, id);
      if (status === "approved" && before.status !== "approved" && before.notify_email) notifyApproved(before.title, before.id, before.notify_email);
      if (status === "approved" && before.status !== "approved") notifyGuardianText(before, `HighlightHype: good news — your play "${before.title}" was approved and is now live! See it here: https://highlighthype.com/#play-${before.id}`);
      const after = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      return sendHtml(res, 200, moderatePage(after, token, status === "approved" ? "Approved — this play is now live on the board." : "Declined — this play is hidden and will not appear on the board."));
    }
    if (p === "/moderate-queue" && req.method === "GET") {
      const token = u.searchParams.get("token") || "";
      if (!moderateAuthorized(token)) return sendHtml(res, 403, "<h1>Moderation link not valid</h1><p>Check the link from the approval email, or request a fresh moderation link.</p><p><a href=\"/\">← HighlightHype home</a></p>");
      const rows = db.prepare("SELECT * FROM highlights WHERE status='pending' ORDER BY id DESC").all();
      return sendHtml(res, 200, moderateQueuePage(rows, token));
    }
    if (p === "/api/moderate/request" && req.method === "GET") {
      // Emails a fresh moderation-queue link to the owner's mailbox only.
      // Anyone can trigger it, but the link itself goes to NOTIFY_TO, not
      // to the requester, so it cannot hand moderation to a stranger.
      const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
      if (!user || !pass) return sendJson(res, 500, { ok: false, message: "Email is not configured on this server." });
      const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
      const link = `https://highlighthype.com/moderate-queue?token=${moderateToken()}`;
      await smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
        subject: "HighlightHype: moderation queue link",
        body: `Here is a fresh link to the plays waiting for approval. It works on any device, no Owner token needed:\n\n${link}\n\nPrivate beta only: anyone with this link can approve or decline. Do not forward it.\n` });
      return sendJson(res, 200, { ok: true, message: "Moderation link emailed to the owner's mailbox." });
    }

    // ---- Owner moderation ----
    if (p === "/api/owner/queue" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const rows = db.prepare("SELECT * FROM highlights ORDER BY id DESC").all().map((r) => {
        let review = null; try { review = r.review ? JSON.parse(r.review) : null; } catch {}
        // Owner-only: the guardian email is included HERE (owner-authorized
        // endpoint) so the owner can contact a winner's parent/guardian.
        // It stays stripped from every public response. Same for the
        // guardian mobile + text opt-in: owner-visible only, and the
        // text_consent flag says whether texting is permitted at all.
        return { ...publicHighlight(r), review, guardian_email: r.notify_email || "", guardian_phone: r.guardian_phone || "", text_consent: !!r.text_consent };
      });
      return sendJson(res, 200, { queue: rows });
    }
    // ---- Owner: Hype Frame requests (owner-authorized ONLY) ----
    // This is the only place order requests are listed, and the only place
    // a guardian email for an order is returned. The print image itself is
    // served by the image endpoint below, also owner-authorized only —
    // print images are never publicly listed or publicly served.
    if (p === "/api/owner/hype-frames" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const rows = db.prepare(`SELECT o.*, h.title AS play_title FROM hype_frame_orders o
        LEFT JOIN highlights h ON h.id=o.highlight_id ORDER BY o.id DESC`).all();
      return sendJson(res, 200, { requests: rows.map((o) => ({ ...o, branding: !!o.branding, imageUrl: `/api/owner/hype-frames/${o.id}/image` })) });
    }
    const hfImgMatch = p.match(/^\/api\/owner\/hype-frames\/(\d+)\/image$/);
    if (hfImgMatch && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const o = db.prepare("SELECT * FROM hype_frame_orders WHERE id=?").get(Number(hfImgMatch[1]));
      const file = o ? path.join(HYPEFRAME_DIR, path.basename(o.print_image)) : "";
      if (!o || !fs.existsSync(file)) return sendJson(res, 404, { ok: false, message: "Print image not found." });
      res.writeHead(200, { "content-type": "image/png", "content-length": fs.statSync(file).size, "cache-control": "private, no-store" });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === "/api/owner/reports" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      return sendJson(res, 200, { reports: db.prepare("SELECT * FROM reports ORDER BY id DESC").all() });
    }
    const statusMatch = p.match(/^\/api\/highlights\/(\d+)\/status$/);
    if (statusMatch && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!["approved", "hidden", "pending"].includes(body.status)) return sendJson(res, 400, { ok: false, message: "Invalid status." });
      const before = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(statusMatch[1]));
      db.prepare("UPDATE highlights SET status=? WHERE id=?").run(body.status, Number(statusMatch[1]));
      // Sample flag rides the same call (Round 7): { sample: true }
      // flags the play as a sample IN THE SAME STEP as the status
      // change, so "Approve as Sample play" is a single owner action;
      // { sample: false } removes the mark. Absent = flag untouched.
      const hasSample = Object.prototype.hasOwnProperty.call(body, "sample");
      if (hasSample) db.prepare("UPDATE highlights SET is_sample=? WHERE id=?").run(body.sample ? 1 : 0, Number(statusMatch[1]));
      if (body.status === "approved" && before && before.status !== "approved" && before.notify_email) notifyApproved(before.title, before.id, before.notify_email);
      if (body.status === "approved" && before && before.status !== "approved") notifyGuardianText(before, `HighlightHype: good news — your play "${before.title}" was approved and is now live! See it here: https://highlighthype.com/#play-${before.id}`);
      return sendJson(res, 200, { ok: true, status: body.status, isSample: hasSample ? !!body.sample : !!(before && before.is_sample) });
    }
    const delMatch = p.match(/^\/api\/highlights\/(\d+)$/);
    if (delMatch && req.method === "DELETE") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(delMatch[1]));
      if (row && row.media_kind === "file") { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(row.media_url))); } catch {} }
      for (const o of db.prepare("SELECT print_image FROM hype_frame_orders WHERE highlight_id=?").all(Number(delMatch[1]))) {
        try { fs.unlinkSync(path.join(HYPEFRAME_DIR, path.basename(o.print_image))); } catch {}
      }
      db.prepare("DELETE FROM hype_frame_orders WHERE highlight_id=?").run(Number(delMatch[1]));
      db.prepare("DELETE FROM highlights WHERE id=?").run(Number(delMatch[1]));
      db.prepare("DELETE FROM votes WHERE highlight_id=?").run(Number(delMatch[1]));
      db.prepare("DELETE FROM contest_entries WHERE highlight_id=?").run(Number(delMatch[1]));
      return sendJson(res, 200, { ok: true });
    }

    // ---- Uploads ----
    if (p.startsWith("/uploads/")) {
      const file = path.join(UPLOAD_DIR, path.basename(p));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
      const ext = path.extname(file).toLowerCase();
      const type = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" }[ext] || "application/octet-stream";
      const size = fs.statSync(file).size;
      const range = req.headers.range;
      if (range) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        const start = m && m[1] ? Number(m[1]) : 0;
        const end = m && m[2] ? Number(m[2]) : size - 1;
        if (start >= size || end >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
      return fs.createReadStream(file).pipe(res);
    }

    // ---- Static ----
    // Clean legal-page routes: /terms and /privacy serve the standalone
    // pages in public/ (also reachable directly as /terms.html etc.).
    let filePath = path.join(__dirname, "public", p === "/" ? "index.html" : p === "/terms" ? "terms.html" : p === "/privacy" ? "privacy.html" : p);
    if (!filePath.startsWith(path.join(__dirname, "public")) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory())
      filePath = path.join(__dirname, "public", "index.html");
    const type = MIME[path.extname(filePath)] || "text/plain";
    const size = fs.statSync(filePath).size;
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m && m[1] ? Number(m[1]) : 0;
      const end = m && m[2] ? Number(m[2]) : size - 1;
      if (start >= size || end >= size) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, message: e.message || "Server error" });
  }
});

server.listen(PORT, () => console.log(`HighlightHype listening on http://localhost:${PORT} (data: ${DATA_DIR})`));
