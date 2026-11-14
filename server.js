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
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
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
// Round 128: cap on an order's composed print PNG (decoded bytes).
// Studio compositions run ~170KB; 5MB is generous headroom without
// letting one order payload park a huge file on the data disk.
const HF_PRINT_IMAGE_MAX = 5 * 1024 * 1024;
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
// My Highlights lookup guard (see /api/athletes/lookup): the endpoint
// answers "which athletes sit behind this guardian email", so it gets
// its own per-IP cap, far above a family's real use (a handful of
// lookups) and far below anything that could enumerate guardian emails.
const LOOKUP_RATE_LIMIT = 30;             // lookups per IP per window
const LOOKUP_RATE_WINDOW_MS = 10 * 60 * 1000;
const lookupHitsByIp = new Map();
// Site stats guard (see /api/track): the counter endpoint is public
// by necessity (it counts anonymous visitors), so it gets its own
// per-IP cap — generous for real browsing (a whole visit is a
// handful of events), far below anything that could inflate the
// aggregates. The IP is used transiently in memory only, exactly
// like the limiters above; it is never written to the stats table.
const TRACK_RATE_LIMIT = 300;             // track events per IP per window
const TRACK_RATE_WINDOW_MS = 10 * 60 * 1000;
const trackHitsByIp = new Map();
// Upload Assist guard (see /api/upload-assist): every call forwards
// frames to a PAID vision model, so it gets the lookup-style per-IP
// cap — far above a family's real use (a few file picks per play),
// far below anything that could run up the model bill.
const ASSIST_RATE_LIMIT = 10;             // assist calls per IP per window
const ASSIST_RATE_WINDOW_MS = 10 * 60 * 1000;
const assistHitsByIp = new Map();
// Bottle drop-notify guard (Round 106, see POST /api/drop-notify):
// a public email-capture form, so it gets the lookup-style per-IP
// cap — far above a family's real use (a few sports, one email),
// far below anything that could stuff the list. The IP is used
// transiently in memory only, exactly like the limiters above.
const NOTIFY_RATE_LIMIT = 30;             // notify signups per IP per window
const NOTIFY_RATE_WINDOW_MS = 10 * 60 * 1000;
const notifyHitsByIp = new Map();
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

// ---- Upload Assist (Round 99, 2026-11-11) ----
// An AI first pass over a few frames of the clip a guardian just
// picked: it suggests the sport, the division, and a hype-tone
// title/story (prefilled in the form as EDITABLE suggestions), and it
// is the gateway that keeps obvious non-plays out of the upload flow.
// It NEVER approves or rejects a play: a confident "not_a_play" only
// blocks in the browser, always with an override that files the play
// for owner review anyway, and every play still starts PENDING.
// Config (Render env vars, set by Emil to activate):
//   AI_VISION_API_KEY  — required; without it the endpoint answers
//                        {configured:false} and the form is untouched.
//   AI_VISION_MODEL    — default "claude-haiku-4-5" (vision-capable,
//                        cheapest tier; set to a Sonnet model for a
//                        stronger read at higher per-call cost).
//   AI_VISION_BASE_URL — default https://api.anthropic.com (the
//                        Anthropic Messages API shape is used).
// Frames are forwarded to the model and then dropped: they are never
// logged and never stored server-side.
const AI_VISION_MODEL = process.env.AI_VISION_MODEL || "claude-haiku-4-5";
const AI_SPORTS = ["baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "martialarts", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"];
const AI_GATES = ["play", "unsure", "not_a_play"];
// Clamp anything the model (or a client re-sending a result) claims
// into the exact shape the site stores and displays.
function normalizeAiResult(o) {
  const sportRaw = String(o?.sport || "").toLowerCase();
  const divRaw = String(o?.division || "").toLowerCase();
  let confidence = Number(o?.confidence);
  if (!isFinite(confidence)) confidence = 0;
  confidence = Math.min(1, Math.max(0, confidence));
  return {
    sport: AI_SPORTS.includes(sportRaw) ? sportRaw : null,
    division: ["boys", "girls"].includes(divRaw) ? divRaw : null,
    title: String(o?.title || "").slice(0, 80),
    story: String(o?.story || "").slice(0, 240),
    gate: AI_GATES.includes(o?.gate) ? o.gate : "unsure",
    confidence,
    reason: String(o?.reason || "").slice(0, 160),
  };
}
// The client sends its assist result back with the upload so it can
// ride on the highlight row into the owner queue. UNTRUSTED by
// design: sanitized into the same normalized shape, stored as a
// display label only — it never touches status or moderation.
function sanitizeAiField(raw) {
  let o = null;
  try { o = JSON.parse(String(raw || "")); } catch { /* not JSON -> no label */ }
  if (!o || typeof o !== "object") return "";
  const wasOverride = o.gate === "override";
  const clean = normalizeAiResult(o);
  if (wasOverride) clean.gate = "override";
  if (!clean.sport && !clean.title && clean.gate === "unsure" && !wasOverride) return "";
  return JSON.stringify(clean);
}
async function runUploadAssist(frames) {
  const base = String(process.env.AI_VISION_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const content = frames.map((f) => ({ type: "image", source: { type: "base64", media_type: f.media_type, data: f.data } }));
  content.push({ type: "text", text:
`These are frames from one short video a parent/guardian is uploading to a youth sports highlights site. Decide: (1) is this a youth sports play? (2) which sport? (3) boys or girls division, only if clearly readable, else null? (4) a short hype-tone title for what happened (about 60 characters max) and one hype-tone sentence describing it.
Reply with ONLY a JSON object, no other text:
{"sport": one of ${JSON.stringify(AI_SPORTS)} or null, "division": "boys" or "girls" or null, "title": string, "story": string, "gate": "play" or "unsure" or "not_a_play", "confidence": number between 0 and 1, "reason": short string}
Gate rules: "play" = clearly a sports play; "unsure" = probably sports but unclear; "not_a_play" = clearly NOT a sports play (screen recording, meme, scenery, talking selfie, random footage). Never answer "not_a_play" unless you are sure — when in doubt, answer "unsure".` });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(base + "/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.AI_VISION_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: AI_VISION_MODEL, max_tokens: 600, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) throw new Error("vision model answered " + r.status);
    const j = await r.json();
    const text = (j.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("vision model returned no JSON");
    return normalizeAiResult(JSON.parse(m[0]));
  } finally { clearTimeout(timer); }
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
// ---- Site stats (first-party, aggregate only) ----
// Daily counters, never per-visitor rows: (day, kind, key) -> count,
// where day is the UTC date (the same clock the rest of the server
// uses), kind is "view" / "play_open" / "referrer", and key is a
// value from the small fixed allowlists below (a main view, a real
// highlight id, or a referrer bucket). There is deliberately NO
// column for an IP address, a user agent, or anything else about a
// visitor: the table cannot identify anyone, because it never
// stores anything about anyone — it only adds up how many times
// things happened each day. The owner reads it via /api/owner/stats.
db.exec(`CREATE TABLE IF NOT EXISTS stat_events(
  day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(day, kind, key)
);`);
// The only view keys POST /api/track accepts — the SPA's main views
// (public/app.js): the home boards, the store, My Highlights, and
// How It Works. Refusing everything else keeps the stats key space
// bounded by construction (no unauthenticated disk-fill vector).
const TRACK_VIEW_KEYS = ["home", "store", "mine", "how"];
// Referrer buckets: a visitor's previous page is only ever counted
// as one of these recognizable hosts (suffix match, so
// l.instagram.com and www.google.com land in their base bucket),
// the literal "direct" (no referrer, or a page on this site), or
// "other" (everything else). Full URLs and paths are NEVER stored.
const TRACK_REFERRER_HOSTS = ["instagram.com", "tiktok.com", "youtube.com", "google.com", "facebook.com", "x.com", "twitter.com", "bing.com", "duckduckgo.com", "yahoo.com", "snapchat.com", "reddit.com", "pinterest.com", "linkedin.com"];
function normalizeReferrerKey(raw) {
  let host = String(raw || "").trim().toLowerCase();
  if (host === "direct") return "direct";
  if (host === "other") return "other";
  // Tolerate a full URL sneaking in: keep only its host. The path
  // and query are dropped here and never reach the table.
  if (host.includes("://")) { try { host = new URL(host).hostname; } catch { /* keep the raw string; it buckets to "other" below */ } }
  host = host.split("/")[0].split("?")[0].split(":")[0].replace(/^www\./, "");
  for (const known of TRACK_REFERRER_HOSTS) if (host === known || host.endsWith("." + known)) return known;
  return "other";
}
function bumpStat(kind, key) {
  const day = new Date().toISOString().slice(0, 10);
  db.prepare("INSERT INTO stat_events(day,kind,key,count) VALUES(?,?,?,1) ON CONFLICT(day,kind,key) DO UPDATE SET count=count+1").run(day, kind, key);
}

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
try { db.exec("ALTER TABLE highlights ADD COLUMN story_consent INTEGER DEFAULT 0"); } catch {}
// Upload Assist (Round 99, 2026-11-11): the AI first-pass result the
// uploader's browser collected (sport/division/title suggestions plus
// the gateway gate verdict), stored as ONE JSON string exactly like
// `review` above. It is a LABEL for the owner queue only: never on
// the public allowlist, never part of approval — every play still
// starts pending and a person still decides.
try { db.exec("ALTER TABLE highlights ADD COLUMN ai_json TEXT DEFAULT ''"); } catch {}
// Round 100 (2026-11-11): Best Celebration spotlight — an editorial
// flag on ONE approved non-sample play at a time (the owner queue
// toggle clears every other play when it sets one). Its only public
// effect is the best_celebration badge computed in publicHighlight.
try { db.exec("ALTER TABLE highlights ADD COLUMN celebration_spotlight INTEGER DEFAULT 0"); } catch {}
// Round 124 (2026-11-12): server-generated poster for a video play —
// the frame at the play's freeze point, extracted by the media
// pipeline below at upload time (and for pre-existing plays by the
// one-time migration). Public and allowlisted in publicHighlight:
// it is the first-choice poster on every client surface, ahead of
// the Round 118/123 client-side frame banking. Empty when the play
// has no server poster (link plays, images, ffmpeg unavailable).
try { db.exec("ALTER TABLE highlights ADD COLUMN poster_url TEXT DEFAULT ''"); } catch {}
// Round 100: Daily Battle + Battle Run. One matchup per ET day
// (daily_battles.date is the America/New_York calendar date), one
// pick per voter per day (the UNIQUE constraint IS the lock).
// Picks on a REAL matchup can also cast a normal contest vote (see
// the pick route); practice (sample) matchups never do. A row is
// finalized lazily once its ET date has passed: winner = more picks,
// a tie leaves winner_id NULL and never counts toward Battle Run.
db.exec(`CREATE TABLE IF NOT EXISTS daily_battles(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  play_a_id INTEGER NOT NULL, play_b_id INTEGER NOT NULL,
  practice INTEGER NOT NULL DEFAULT 0,
  finalized INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER,
  final_a_picks INTEGER NOT NULL DEFAULT 0,
  final_b_picks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS daily_battle_picks(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_id INTEGER NOT NULL, voter_token TEXT NOT NULL, pick_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(daily_id, voter_token)
);`);
// Round 105 (2026-11-11): winner crowns — the PERSISTED record
// behind "a trophy that stays on the play". A row is written at the
// moment a winner is decided (Daily Battle lazy finalization, Hype
// of the Month crowning) and never expires. kind 'daily' refs the
// matchup's ET date, kind 'monthly' the contest period; the display
// title is frozen into the row at award time. The UNIQUE triple
// makes re-finalization / re-crowning idempotent. Winners decided
// before this table existed are NOT backfilled.
db.exec(`CREATE TABLE IF NOT EXISTS play_crowns(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  highlight_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(highlight_id, kind, ref)
);`);
// Round 106 (2026-11-11): bottle drop notifications — a parent asks
// to be emailed when one of the six Hype Sports bottles drops. The
// email is a first-party signup, exactly like a guardian email on a
// play: stored here, returned ONLY on the owner-authorized list
// endpoint, never in any public payload. UNIQUE(email, sport) is
// the dedupe: re-submitting the same pair is a silent no-op that
// still answers success.
db.exec(`CREATE TABLE IF NOT EXISTS drop_notifications(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, sport TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email, sport)
);`);
const DROP_NOTIFY_SPORTS = ["baseball", "football", "basketball", "soccer", "softball", "volleyball"];
try { db.exec("ALTER TABLE highlights ADD COLUMN story_consent_at TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN text_consent INTEGER DEFAULT 0"); } catch {}
// Sample plays (Round 7, 2026-11-05): owner-flagged demo plays (the
// AI-generated seed clips) that show newcomers how the board works.
// They render with a SAMPLE badge, can collect votes and be used in
// the Hype Frame studio, but they can NEVER enter the contest or
// appear in the Hall of Fame (enforced at the contest endpoints and
// in the contest/board queries below). Default 0 = a real family play.
try { db.exec("ALTER TABLE highlights ADD COLUMN is_sample INTEGER DEFAULT 0"); } catch {}
// Guardian attestation (Round 21, 2026-11-06): the uploader must
// confirm they are the athlete's parent/guardian, or have the
// guardian's permission, to post the video. The upload endpoint
// REJECTS a new play without it (400, before any file is written)
// and stamps the attestation time here (ISO). PRIVATE like the other
// guardian fields: never on the public allowlist — owner queue and
// moderation pages only. Plays posted before this round keep ''.
try { db.exec("ALTER TABLE highlights ADD COLUMN guardian_consent_at TEXT DEFAULT ''"); } catch {}
// Contest opt-in (Round 130, 2026-11-13): the Post a Play form's
// "Enter this play in Hype of the Month" box is PRE-CHECKED, and
// the client sends the state EXPLICITLY (contestOptin=1/0) on every
// new-form submit. 1 = the guardian left it checked; approval then
// enters the play automatically (see autoEnterOnApproval130). An
// upload with NO contestOptin field is a legacy client — its plays
// store 0 and are NEVER auto-entered; the Round 121 guardian
// tap-to-enter remains their path. Rows predating this round are 0.
try { db.exec("ALTER TABLE highlights ADD COLUMN contest_optin INTEGER DEFAULT 0"); } catch {}
// Round 145 (2026-11-13): the sha256 of an upload's file bytes,
// stored at insert time so a retry of the SAME clip inside a short
// window can be answered from the original play instead of landing
// as a second pending row + a second full file copy (the 2026-11-13
// crash-retry pile-up: 34 duplicate pendings, 639MB). NULL for
// every pre-145 row and for link plays (no bytes to hash) — NULLs
// never match, so only genuine same-bytes retries dedupe.
try { db.exec("ALTER TABLE highlights ADD COLUMN media_hash TEXT"); } catch {}
try { db.exec("CREATE INDEX IF NOT EXISTS idx_highlights_media_hash ON highlights(media_hash)"); } catch {}
// Round 146 (2026-11-13): Trash + moderation log (Phase 2 of the
// owner-panel program Emil approved the night of the accidental
// deletions). status stays free text — 'trashed' is a new VALUE,
// no constraint change. trashed_at stamps the move; status_before_
// trash remembers where a Restore should land. moderation_log is
// the append-only record of every moderation action (approve,
// reject, trash, restore, purge, plus the backup channel's
// delete-pending and restore-plays): who, what, which play, when.
try { db.exec("ALTER TABLE highlights ADD COLUMN trashed_at TEXT"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN status_before_trash TEXT"); } catch {}
db.exec(`CREATE TABLE IF NOT EXISTS moderation_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id INTEGER,
  action TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
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
try { db.exec("ALTER TABLE highlights ADD COLUMN notify_email_hash TEXT DEFAULT ''"); } catch {}
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
// Image style (Round 38, 2026-11-08): 'photo' | 'avatar' — the family
// chooses whether the print is the real frozen frame or an illustrated
// avatar of the same moment (Twinkie's idea; kid-approved by Twinkie
// and Nicholas). The illustration is produced at fulfillment, after
// the owner confirms with the guardian — the order only carries the
// choice. Added additively, same pattern; older rows read 'photo'.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN image_style TEXT DEFAULT 'photo'"); } catch {}
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
// Round 121 (2026-11-12): the My Plays email lookup serves a
// guardian their OWN plays — pending ones included — matched by a
// per-play hash of the guardian email given at upload (the address
// itself is never queried or returned). Backfill the hash column
// for rows that predate it; the upload insert maintains it.
try {
  const stale121 = db.prepare("SELECT id, notify_email FROM highlights WHERE notify_email<>'' AND COALESCE(notify_email_hash,'')=''").all();
  const upd121 = db.prepare("UPDATE highlights SET notify_email_hash=? WHERE id=?");
  for (const r of stale121) upd121.run(sha(normIdentity(r.notify_email)), r.id);
} catch { /* fresh DB: nothing to backfill */ }

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
// Guardian attestation display (Round 21): "Guardian consent ✓ Nov 6,
// 2026" on the owner-only surfaces (moderation pages; the Owner view
// renders the same text client-side from guardian_consent_at). Legacy
// plays posted before the checkbox existed have no timestamp and get
// an empty string — nothing is shown for them.
const fmtConsentDate = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" }); };
const consentText = (row) => (row && row.guardian_consent_at ? `Guardian consent ✓ ${fmtConsentDate(row.guardian_consent_at)}` : "");
function moderatePage(row, token, message = "") {
  let review = null; try { review = row.review ? JSON.parse(row.review) : null; } catch {}
  const flags = review?.flags?.length ? `<p><b>Pre-review:</b> ${escHtml(review.verdict)} — ${escHtml(review.flags.join("; "))}</p>` : "";
  let aiRow = null; try { aiRow = row.ai_json ? JSON.parse(row.ai_json) : null; } catch {}
  const aiLine = aiRow ? `<p><b>🤖 AI:</b> ${escHtml(aiRow.sport || "?")} · ${escHtml(aiRow.division || "?")} · gate ${escHtml(aiRow.gate === "play" ? "pass" : aiRow.gate || "?")}${typeof aiRow.confidence === "number" ? ` (${Math.round(aiRow.confidence * 100)}%)` : ""}${aiRow.reason ? ` — ${escHtml(aiRow.reason)}` : ""}<br><i>AI first pass only — watch the play yourself before deciding.</i></p>` : "";
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
      <input type="hidden" name="action" value="approve_sample">
      <button type="submit" style="font-size:18px;padding:12px 20px">Approve as Sample play</button>
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
${consentText(row) ? `<p>${escHtml(consentText(row))}</p>` : ""}${row.story ? `<p>${escHtml(row.story)}</p>` : ""}${flags}${aiLine}${moderateMediaHtml(row)}${statusNote}${forms}
<p><a href="/">← Back to the HighlightHype homepage</a></p>
<p style="color:#666">Private beta only: anyone with this link can approve or decline. Do not forward it.</p>
</body></html>`;
}
/* Round 147 (2026-11-13): the email link's delete lands here
   now — it is a Trash move (trashPlay146), not a permanent
   delete, and the page says so: the play can be restored
   from the Owner panel's Trash for 7 days. (Round 13's
   version of this page announced a permanent deletion;
   →146 logged that delete as a 'purge'.) */
function moderateTrashedPage147(title, token) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Play moved to Trash</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h1>Play moved to Trash</h1>
<p><b>${escHtml(title)}</b> was moved to the Trash — it is off the board and out of the contest, but nothing was deleted: its uploaded file, votes and any Hype Frame requests are all kept.</p>
<p>Changed your mind? It can be restored from the Owner panel's Trash section within 7 days. After 7 days in the Trash it is deleted for good automatically.</p>
<p><a href="/moderate-queue?token=${escHtml(token)}">← Back to the moderation queue</a></p>
<p style="color:#666">Private beta only: anyone with this link can approve or decline. Do not forward it.</p>
</body></html>`;
}
function moderateQueuePage(rows, token, message = "", liveRows = []) {
  // Round 13 (2026-11-05): a second section lists the APPROVED plays
  // ("Live on the board") with Hide + Delete forms, so the owner can
  // retire replaced samples straight from the emailed queue link —
  // no Owner-token device, no six separate deletes. Delete carries a
  // required "Yes, delete permanently" checkbox: the browser's own
  // validation blocks an unticked submit (zero-JS, no dialogs).
  // →147: the Delete is a move to Trash now — the checkbox reads
  // "Yes, move to Trash" and the button "Move to Trash", with the
  // same required-checkbox arming.
  const liveItems = liveRows.length ? liveRows.map((r) => `
    <div style="border:1px solid #ccc;padding:12px;margin:12px 0">
      <b>${escHtml(r.title)}</b> — ${escHtml(r.sport)}${r.player_name ? ` — ${escHtml(r.player_name)}` : ""}${r.is_sample ? " — ⭐ SAMPLE PLAY" : ""} — Play ID ${r.id}${consentText(r) ? `<br>${escHtml(consentText(r))}` : ""}
      <form method="POST" action="/moderate" style="display:inline">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="token" value="${escHtml(token)}">
        <input type="hidden" name="action" value="hide">
        <button type="submit" style="font-size:18px;padding:12px 20px">Hide</button>
      </form>
      <form method="POST" action="/moderate" style="display:inline;margin-left:12px">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="token" value="${escHtml(token)}">
        <input type="hidden" name="action" value="delete">
        <label style="font-size:18px"><input type="checkbox" name="confirm" value="yes" required> Yes, move to Trash</label>
        <button type="submit" style="font-size:18px;padding:12px 20px">Move to Trash</button>
      </form>
    </div>`).join("") : "<p>Nothing is live on the board right now.</p>";
  const items = rows.length ? rows.map((r) => `
    <div style="border:1px solid #ccc;padding:12px;margin:12px 0">
      <b>${escHtml(r.title)}</b> — ${escHtml(r.sport)} — Play ID ${r.id}${consentText(r) ? `<br>${escHtml(consentText(r))}` : ""}
      <p><a href="/moderate?id=${r.id}&token=${escHtml(token)}">View and approve / decline this play</a></p>
      <form method="POST" action="/moderate" style="display:inline">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="token" value="${escHtml(token)}">
        <input type="hidden" name="action" value="approve">
        <button type="submit" style="font-size:18px;padding:12px 20px">Approve</button>
      </form>
      <form method="POST" action="/moderate" style="display:inline;margin-left:12px">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="token" value="${escHtml(token)}">
        <input type="hidden" name="action" value="approve_sample">
        <button type="submit" style="font-size:18px;padding:12px 20px">Approve as Sample play</button>
      </form>
      <form method="POST" action="/moderate" style="display:inline;margin-left:12px">
        <input type="hidden" name="id" value="${r.id}"><input type="hidden" name="token" value="${escHtml(token)}">
        <input type="hidden" name="action" value="hide">
        <button type="submit" style="font-size:18px;padding:12px 20px">Decline (hide)</button>
      </form>
    </div>`).join("") : "<p>No plays are pending right now.</p>";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moderation queue</title></head>
<body style="font-family:system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px">
<h1>Plays waiting for approval</h1>${message ? `<p><b>${escHtml(message)}</b></p>` : ""}${items}
<h2>Live on the board</h2>${liveItems}
<p><a href="/">← Back to the HighlightHype homepage</a></p>
<p style="color:#666">Private beta only: anyone with this link can approve or decline. Do not forward it.</p>
</body></html>`;
}
function sendHtml(res, code, html) { res.writeHead(code, { "content-type": "text/html; charset=utf-8" }); res.end(html); }
function currentPeriod() { return new Date().toISOString().slice(0, 7); } // YYYY-MM
// Round 130 (2026-11-13): contest auto-entry on approval. A play
// whose guardian left the upload form's contest box checked
// (contest_optin=1) is entered into the APPROVAL month's contest
// the moment it becomes approved — currentPeriod() at hook time IS
// the approval month. Both approval paths (the emailed /moderate
// action and the owner POST /api/highlights/:id/status) call this
// with the post-update row on a pending->approved transition only.
// Hard guards, in order: not approved, SAMPLE (a sample never
// enters, whatever any flag says — the same rule the enter endpoint
// enforces), no opt-in, already entered for the period (the
// table's UNIQUE(highlight_id, period) backs this too). Prize
// eligibility is untouched: an entered play with no reachable
// guardian simply stays prize-ineligible, exactly as a manually
// entered one does. Returns true when a row was inserted.
function autoEnterOnApproval130(row) {
  if (!row || row.status !== "approved" || row.is_sample || !row.contest_optin) return false;
  const period = currentPeriod();
  if (db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(row.id, period)) return false;
  db.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(row.id, period);
  console.log(`[r130] auto-entered play ${row.id} into Hype of the Month ${period} on approval (upload opt-in)`);
  return true;
}
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
    body: `A family just submitted a Hype Frame order request on highlighthype.com.\n\nPlay: ${play.title} (Play ID: ${play.id})\nPrint name: ${order.custom_name || "—"}${order.jersey ? ` · #${order.jersey}` : ""}\nHYPE FRAME branding: ${order.branding ? "yes" : "no"}\nApparel: ${order.apparel} · ${order.colorway} · Size: ${order.size || "YM"} · Print side: ${order.side === "back" ? "Back" : "Front"} · Image: ${order.image_style === "avatar" ? "Avatar — illustrate the frame before printing" : "Real photo"}\n${(() => { try { const p = JSON.parse(order.placement || ""); return p ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size\n` : ""; } catch { return ""; } })()}Parent/guardian: ${order.guardian_name ? order.guardian_name + " — " : ""}${order.guardian_email}\nStatus: pending-guardian — nothing is printed until you confirm with the parent/guardian.\n${order.print_image ? "Print image: on file — use Download print image on the request in Owner view." : "Print image: NOT on file for this request — the order was saved without one."}\n\nSee the request in Owner view: https://highlighthype.com/#owner\n` })
    .catch((e) => console.error("notifyHypeFrameRequest failed:", e.message));
}
// ---- Round 100: Daily Battle helpers ----
// All Daily Battle dates are ET calendar dates (America/New_York),
// never UTC — a matchup day rolls over at ET midnight.
function etToday() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => (parts.find((x) => x.type === t) || {}).value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function etDateMinus(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
const getPlayRow = (id) => db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
// A daily matchup is REAL only while both plays exist and neither
// is a sample; anything else is practice (no votes, no Battle Run,
// no Battle Tested).
function dailyIsReal(row) {
  if (!row) return false;
  const a = getPlayRow(row.play_a_id), b = getPlayRow(row.play_b_id);
  return !!(a && b && !a.is_sample && !b.is_sample);
}
// ---- Round 105: winner crowns + My Highlights numbers + picker streaks ----
// Crown titles are written in the site's voice at award time:
// "Daily Winner · Nov 11" for a daily (ref = its ET date) and
// "Hype of the Month · November 2026" for a monthly (ref = period).
const MONTH_SHORT105 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG105 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function crownTitle105(kind, ref) {
  const parts = String(ref || "").split("-").map(Number);
  if (kind === "monthly") return `Hype of the Month · ${MONTH_LONG105[(parts[1] || 1) - 1]} ${parts[0] || ""}`.trim();
  return `Daily Winner · ${MONTH_SHORT105[(parts[1] || 1) - 1]} ${parts[2] || ""}`.trim();
}
function awardCrown105(highlightId, kind, ref) {
  if (!highlightId || !ref) return;
  try { db.prepare("INSERT OR IGNORE INTO play_crowns(highlight_id,kind,ref,title) VALUES(?,?,?,?)").run(highlightId, kind, ref, crownTitle105(kind, ref)); } catch { /* a crown must never break finalization */ }
}
function crownsFor105(id) {
  try { return db.prepare("SELECT kind,title FROM play_crowns WHERE highlight_id=? ORDER BY id DESC").all(id).map((c) => ({ kind: c.kind, title: c.title })); } catch { return []; }
}
// Per-play numbers for My Highlights (Feature 3): votes in the
// current contest period, all-time views, finalized Daily wins.
// Views are NOT a new counter: they sum the stat_events 'play_open'
// rows the site already keeps (the stats system is aggregate-only —
// the per-play key is a highlight id, never anything about a
// visitor). Battle wins count ONLY what the battle system persists:
// finalized Daily Battle victories (daily_battles.winner_id). Fresh
// Pairs / Winner Stays results are session play — nothing about them
// is persisted per play, so they count nothing here.
function playViews105(id) { return db.prepare("SELECT COALESCE(SUM(count),0) c FROM stat_events WHERE kind='play_open' AND key=?").get(String(id)).c; }
function battleWins105(id) { return db.prepare("SELECT COUNT(*) c FROM daily_battles WHERE finalized=1 AND winner_id=?").get(id).c; }
// Picker streaks (Feature 4). Identity is the existing voter token;
// picks are the daily_battle_picks rows the pick route already
// stores for EVERY daily — practice days included — in their own
// table, never in votes (practice picks cast none; that invariant
// is untouched). THE RULE: walk the finalized dailies newest ->
// oldest; a day EXTENDS the streak when the token's pick equals the
// day's winner; anything else — picked the loser, no pick that day,
// or a tie (winner_id NULL) — ENDS the walk. The current streak is
// the unbroken run of winning picks ending at the MOST RECENT
// finalized day (0 when that day was not a winning pick for the
// token). Best is the longest such run anywhere in the token's
// history. A calendar day with no Daily Battle row at all never
// enters the sequence, so it can neither extend nor break a streak.
function fanTag105(token) { return "Fan #" + sha(String(token)).slice(0, 4).toUpperCase(); }
function pickerStreaks105() {
  const rows = db.prepare("SELECT id, winner_id FROM daily_battles WHERE finalized=1 ORDER BY date ASC, id ASC").all();
  const byToken = new Map();
  const top = [];
  if (rows.length) {
    const picks = db.prepare("SELECT p.daily_id, p.voter_token, p.pick_id, p.created_at FROM daily_battle_picks p JOIN daily_battles d ON d.id=p.daily_id WHERE d.finalized=1").all();
    const per = new Map();
    for (const pk of picks) { if (!per.has(pk.voter_token)) per.set(pk.voter_token, new Map()); per.get(pk.voter_token).set(pk.daily_id, pk); }
    for (const [token, mine] of per) {
      let run = 0, best = 0;
      for (const r of rows) { const pk = mine.get(r.id); if (pk && r.winner_id != null && pk.pick_id === r.winner_id) { run++; if (run > best) best = run; } else run = 0; }
      let current = 0, reachedAt = "";
      for (let i = rows.length - 1; i >= 0; i--) { const pk = mine.get(rows[i].id); if (pk && rows[i].winner_id != null && pk.pick_id === rows[i].winner_id) { current++; reachedAt = pk.created_at || ""; } else break; }
      byToken.set(token, { current, best });
      // Top Pickers order: streak desc, then who REACHED it first —
      // proxied by the pick time on the OLDEST day of the current
      // run (the pick that started the run), then tag so the order
      // is deterministic.
      if (current >= 2) top.push({ tag: fanTag105(token), streak: current, reachedAt });
    }
    top.sort((a, b) => b.streak - a.streak || String(a.reachedAt).localeCompare(String(b.reachedAt)) || a.tag.localeCompare(b.tag));
  }
  return { byToken, top: top.slice(0, 5).map(({ tag, streak }) => ({ tag, streak })) };
}
// Lazy finalization: any unfinalized row whose ET date has passed
// gets its pick counts frozen and its winner set (NULL on a tie).
function finalizeDailyBattles() {
  const today = etToday();
  const rows = db.prepare("SELECT * FROM daily_battles WHERE finalized=0 AND date<?").all(today);
  for (const r of rows) {
    const a = db.prepare("SELECT COUNT(*) c FROM daily_battle_picks WHERE daily_id=? AND pick_id=?").get(r.id, r.play_a_id).c;
    const b = db.prepare("SELECT COUNT(*) c FROM daily_battle_picks WHERE daily_id=? AND pick_id=?").get(r.id, r.play_b_id).c;
    const winner = a > b ? r.play_a_id : b > a ? r.play_b_id : null;
    db.prepare("UPDATE daily_battles SET finalized=1, final_a_picks=?, final_b_picks=?, winner_id=? WHERE id=?").run(a, b, winner, r.id);
    if (winner != null) awardCrown105(winner, "daily", r.date);
  }
}
// Today's matchup: a row the owner set wins; otherwise auto-pick
// ONCE for the ET day and persist it, so the matchup is stable all
// day (and matches whatever the day's social post points at).
// Preference: (1) two approved non-sample same-sport plays not
// paired in the last 14 days; (2) any two approved non-sample
// plays; (3) any two samples (a PRACTICE matchup). Returns the row
// or null when fewer than two approved plays exist at all.
function ensureTodayDaily() {
  finalizeDailyBattles();
  const today = etToday();
  let row = db.prepare("SELECT * FROM daily_battles WHERE date=?").get(today);
  if (row) {
    // A play under today's row was deleted — retire the row and re-pick.
    if (getPlayRow(row.play_a_id) && getPlayRow(row.play_b_id)) return row;
    db.prepare("DELETE FROM daily_battle_picks WHERE daily_id=?").run(row.id);
    db.prepare("DELETE FROM daily_battles WHERE id=?").run(row.id);
    row = null;
  }
  const approved = db.prepare("SELECT * FROM highlights WHERE status='approved' ORDER BY id ASC").all();
  const real = approved.filter((r) => !r.is_sample);
  const cutoff = etDateMinus(today, 14);
  const recent = new Set(db.prepare("SELECT play_a_id, play_b_id FROM daily_battles WHERE date>=?").all(cutoff).map((r) => [Math.min(r.play_a_id, r.play_b_id), Math.max(r.play_a_id, r.play_b_id)].join("_")));
  const pairsOf = (list) => { const out = []; for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]); return out; };
  const bySport = new Map();
  for (const r of real) { if (!bySport.has(r.sport)) bySport.set(r.sport, []); bySport.get(r.sport).push(r); }
  let sameSport = [];
  bySport.forEach((list) => { sameSport = sameSport.concat(pairsOf(list)); });
  const notRecent = (pairs) => pairs.filter(([a, b]) => !recent.has([Math.min(a.id, b.id), Math.max(a.id, b.id)].join("_")));
  const pick = notRecent(sameSport)[0] || sameSport[0] || notRecent(pairsOf(real))[0] || pairsOf(real)[0] || pairsOf(approved.filter((r) => r.is_sample))[0] || pairsOf(approved)[0];
  if (!pick) return null;
  const practice = (pick[0].is_sample || pick[1].is_sample) ? 1 : 0;
  try {
    const info = db.prepare("INSERT INTO daily_battles(date,play_a_id,play_b_id,practice) VALUES(?,?,?,?)").run(today, pick[0].id, pick[1].id, practice);
    return db.prepare("SELECT * FROM daily_battles WHERE id=?").get(Number(info.lastInsertRowid));
  } catch { return db.prepare("SELECT * FROM daily_battles WHERE date=?").get(today) || null; }
}
// The public daily payload. PRIVACY RULE (Emil's spec): pick counts
// and the split are returned ONLY to a voter who has already picked
// (or once the day is finalized) — never before picking, so nobody
// can bandwagon off the crowd.
function dailyPayload(row, voter = "") {
  if (!row) return { ok: true, available: false, date: etToday() };
  const a = getPlayRow(row.play_a_id), b = getPlayRow(row.play_b_id);
  if (!a || !b) return { ok: true, available: false, date: row.date };
  const pick = voter ? db.prepare("SELECT pick_id FROM daily_battle_picks WHERE daily_id=? AND voter_token=?").get(row.id, voter) : null;
  const out = {
    ok: true, available: true, id: row.id, date: row.date,
    practice: !dailyIsReal(row), finalized: !!row.finalized,
    a: publicHighlight(a, voter), b: publicHighlight(b, voter),
    yourPick: pick ? pick.pick_id : null,
  };
  if (pick || row.finalized) {
    const ca = row.finalized ? row.final_a_picks : db.prepare("SELECT COUNT(*) c FROM daily_battle_picks WHERE daily_id=? AND pick_id=?").get(row.id, row.play_a_id).c;
    const cb = row.finalized ? row.final_b_picks : db.prepare("SELECT COUNT(*) c FROM daily_battle_picks WHERE daily_id=? AND pick_id=?").get(row.id, row.play_b_id).c;
    const total = ca + cb;
    out.split = { a: ca, b: cb, total, aPct: total ? Math.round((ca / total) * 100) : 0, bPct: total ? Math.round((cb / total) * 100) : 0 };
    if (row.finalized) out.winnerId = row.winner_id;
  }
  // Round 105 (Feature 4): picker streaks ride the daily payload —
  // the caller's own streak (only for an identified voter) plus the
  // public Top Pickers aggregate: anonymous fan tags derived by
  // one-way hash from tokens, streak counts, nothing else.
  const streaks105 = pickerStreaks105();
  out.topPickers = streaks105.top;
  if (voter) { const s105 = streaks105.byToken.get(voter); out.streak = { current: s105 ? s105.current : 0, best: s105 ? s105.best : 0 }; }
  return out;
}
// Finalized, REAL daily battles, newest first — the shared pool for
// Battle Tested and Battle Run. Decisive-only is the caller's call
// (Battle Run filters winner_id; Battle Tested counts ties too).
function finalizedRealDailies() {
  return db.prepare("SELECT * FROM daily_battles WHERE finalized=1 ORDER BY date DESC, id DESC").all().filter((r) => dailyIsReal(r));
}
// ---- Round 100: play badges (computed, never stored) ----
// Samples NEVER get badges. first_hype = the athlete's earliest
// approved non-sample play (by creation order); battle_tested = the
// play appeared in a finalized REAL Daily Battle (win, loss or
// tie); best_celebration = the play holds the Celebration Spotlight.
function badgesFor(row) {
  if (!row || row.status !== "approved" || row.is_sample) return [];
  const out = [];
  if (row.athlete_id) {
    const first = db.prepare("SELECT id FROM highlights WHERE athlete_id=? AND status='approved' AND COALESCE(is_sample,0)=0 ORDER BY id ASC LIMIT 1").get(row.athlete_id);
    if (first && first.id === row.id) out.push("first_hype");
  }
  const tested = db.prepare(`SELECT 1 FROM daily_battles d JOIN highlights o
    ON o.id = CASE WHEN d.play_a_id=? THEN d.play_b_id ELSE d.play_a_id END
    WHERE d.finalized=1 AND (d.play_a_id=? OR d.play_b_id=?) AND COALESCE(o.is_sample,0)=0 LIMIT 1`).get(row.id, row.id, row.id);
  if (tested) out.push("battle_tested");
  if (row.celebration_spotlight) out.push("best_celebration");
  return out;
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
    // Round 124: server-generated poster (see the media pipeline
    // below). "" when the play has none — the client then falls
    // back to its Round 118/123 banking + placeholder behavior.
    poster_url: row.poster_url || "",
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
    // Round 100 badges (see badgesFor): computed per play, samples
    // always []. The client renders gold chips from these keys.
    badges: badgesFor(row),
    // Round 105 crowns (Feature 5): PERSISTED winner records,
    // newest first — unlike badges these include samples (a sample
    // can win a practice Daily) and never expire. The client shows
    // the latest everywhere and the full list on cards.
    crowns: crownsFor105(row.id),
    // Round 105 numbers (Feature 3): rendered on My Highlights
    // cards — this month's votes, all-time views, Daily wins.
    votesMonth: monthlyVoteCount(row.id, currentPeriod()),
    views: playViews105(row.id),
    battleWins: battleWins105(row.id),
    voteCount: voteCount(row.id),
    hasVoted: voterToken ? !!db.prepare("SELECT 1 FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").get(row.id, voterToken, currentPeriod()) : false,
  };
}
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm" };

// ---- Round 124 (2026-11-12): server-side media compatibility ----
// WHY: play 50 (Charlotte, the board's first real play) arrived as
// HEVC/hvc1 with a -90° rotation matrix. Safari plays it, Chromium
// cannot decode it at all (the timer runs over a black picture),
// and the Hype Frame studio — which must decode the clip AND
// capture frames from it — got nothing: black freeze video, empty
// filmstrip, a dead end on both studio entry paths. The client
// cannot fix a codec; the server now owns compatibility:
//   * uploads are probed, and anything that is not already
//     H.264 + yuv420p + faststart (+ no rotation metadata — a
//     rotated file is converted too, so the rotation is baked
//     into the pixels rather than left for each player/canvas
//     to interpret) is transcoded to exactly that, in place,
//     before the upload is treated as complete;
//   * every video play gets a server-generated poster JPEG at
//     its freeze point (publicHighlight's poster_url), so first
//     paint shows the action on every browser, no banking needed;
//   * a one-time startup migration converts pre-existing
//     non-H.264 files (in practice play 50) the same way.
// FALLBACK CONTRACT (hard rule): conversion is best-effort, NEVER
// a gate. If ffmpeg/ffprobe cannot be found, a probe fails, or a
// conversion errors or times out, the upload still succeeds with
// the original file and no poster, and a log line says why. The
// pre-124 behavior is the floor, never a casualty.
// Resolution order for both binaries: FFMPEG_PATH / FFPROBE_PATH
// env → the ffmpeg-static / @ffprobe-installer/ffprobe packages
// (package.json dependencies, installed by Render's build) →
// system binaries on PATH. HH_NO_FFMPEG=1 forces "unavailable"
// (the test suites use it to prove the fallback contract).
const R124_FREEZE_OVERRIDES = { 50: 1.5 }; // mirrors btlStartOffset119 in public/app.js — keep the two in sync
const R124_MIGRATION_KEY = "r124_media_migration_v1";
let r124BinsCache; // undefined = not resolved yet, null = unavailable, {ffmpeg, ffprobe} = ready
function r124BinWorks(bin) {
  return new Promise((resolve) => {
    if (!bin) return resolve(false);
    execFile(bin, ["-version"], { timeout: 8000 }, (err) => resolve(!err));
  });
}
async function r124ResolveBins() {
  if (r124BinsCache !== undefined) return r124BinsCache;
  if (process.env.HH_NO_FFMPEG === "1") {
    r124BinsCache = null;
    console.log("[r124] ffmpeg disabled via HH_NO_FFMPEG — uploads keep original files, posters skipped.");
    return null;
  }
  const req = createRequire(import.meta.url);
  const pkgPath = (name, pick) => { try { const v = pick(req(name)); return typeof v === "string" && v ? v : null; } catch { return null; } };
  const ffmpegCands = [process.env.FFMPEG_PATH, pkgPath("ffmpeg-static", (m) => m), "ffmpeg"].filter(Boolean);
  const ffprobeCands = [process.env.FFPROBE_PATH, pkgPath("@ffprobe-installer/ffprobe", (m) => m && m.path), "ffprobe"].filter(Boolean);
  let ffmpeg = null, ffprobe = null;
  for (const c of ffmpegCands) { if (await r124BinWorks(c)) { ffmpeg = c; break; } }
  for (const c of ffprobeCands) { if (await r124BinWorks(c)) { ffprobe = c; break; } }
  r124BinsCache = ffmpeg && ffprobe ? { ffmpeg, ffprobe } : null;
  if (r124BinsCache) console.log(`[r124] media conversion ready (ffmpeg: ${ffmpeg} · ffprobe: ${ffprobe})`);
  else console.log("[r124] ffmpeg/ffprobe unavailable — uploads keep their original files and posters are skipped (conversion is best-effort, never a gate).");
  return r124BinsCache;
}
function r124Run(bin, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ err, stderr: String(stderr || "") }));
  });
}
async function r124Probe(bins, file) {
  return new Promise((resolve) => {
    execFile(bins.ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 }, (e, stdout) => {
      if (e) return resolve(null);
      try { resolve(JSON.parse(stdout)); } catch { resolve(null); }
    });
  });
}
function r124VideoInfo(probe) {
  if (!probe || !Array.isArray(probe.streams)) return null;
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (!v) return null;
  let rotation = 0;
  if (Array.isArray(v.side_data_list)) for (const sd of v.side_data_list) { if (sd && typeof sd.rotation === "number" && sd.rotation) rotation = sd.rotation; }
  if (v.tags && v.tags.rotate) rotation = Number(v.tags.rotate) || rotation;
  const duration = Number(probe.format && probe.format.duration) || Number(v.duration) || 0;
  return { codec: v.codec_name || "", pixFmt: v.pix_fmt || "", width: v.width || 0, height: v.height || 0, rotation, duration };
}
// Faststart = the moov atom sits ahead of the media data, so a
// player can start before the file finishes downloading. Probed
// from the file head: if moov does not appear within the first
// megabyte it lives at the tail (the classic phone-export layout
// that made several sample clips slow to start).
function r124IsFaststart(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    const buf = Buffer.alloc(1024 * 1024);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const head = buf.subarray(0, n);
    const moov = head.indexOf("moov"), mdat = head.indexOf("mdat");
    if (moov === -1) return false;
    if (mdat === -1) return true;
    return moov < mdat;
  } catch { return false; } finally { if (fd !== undefined) { try { fs.closeSync(fd); } catch {} } }
}
function r124Compliant(file, info) {
  return !!info && info.codec === "h264" && info.pixFmt === "yuv420p" && !info.rotation && r124IsFaststart(file);
}
// The freeze point a play's poster is taken from: the client's
// per-play start-offset map wins (play 50 → 1.5s, past Charlotte's
// black intro and diamond transition); everything else gets a
// frame ~35% in, clamped inside the clip.
function r124FreezeAt(id, duration) {
  const over = R124_FREEZE_OVERRIDES[id];
  let t = typeof over === "number" ? over : duration * 0.35;
  if (!isFinite(t) || t < 0) t = 0;
  if (duration > 0) t = Math.min(t, Math.max(0, duration - 0.1));
  return t;
}
// Round 138 (2026-11-13): ffmpeg runs strictly one process at a
// time, with a capped thread appetite. On 2026-11-13 18:33 ET
// Render reported the (small Starter) instance exceeded its
// memory limit and auto-restarted; this conversion path is the
// app's only memory-hungry work, and nothing stopped two encodes
// from overlapping — two uploads close together both convert
// inline in their request handlers, and an upload could land
// while the startup migration sweep was mid-conversion. Every
// ffmpeg invocation (transcode AND poster grab) now takes its
// turn behind this promise chain, so at most one ffmpeg process
// exists at any moment. ffprobe is deliberately NOT gated: it is
// brief and metadata-only. The chain can never jam — each link
// settles fulfilled for the next waiter regardless of the task's
// own outcome, and a failed conversion reports failure to its
// caller exactly as before (best-effort rule untouched).
let r138FfmpegQueue = Promise.resolve();
function r138SerializeFfmpeg(task) {
  const run = r138FfmpegQueue.then(task, task);
  r138FfmpegQueue = run.then(() => undefined, () => undefined);
  return run;
}
async function r124Convert(bins, inFile, outFile) {
  return r138SerializeFfmpeg(() => r124ConvertNow(bins, inFile, outFile));
}
async function r124ConvertNow(bins, inFile, outFile) {
  // Autorotate is ffmpeg's default on decode, so a rotated phone
  // clip comes out with the rotation baked into the pixels and no
  // rotation metadata on the result. Height capped at 1280, never
  // upscaled; the width follows at an even number for yuv420p.
  // Round 138: "-threads 2" caps the encoder's thread pool for
  // the small shared instance — the output spec is unchanged.
  const args = ["-y", "-i", inFile, "-map", "0:v:0", "-map", "0:a?",
    "-vf", "scale=-2:'if(gt(ih,1280),1280,trunc(ih/2)*2)'",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-threads", "2", outFile];
  const { err, stderr } = await r124Run(bins.ffmpeg, args, 240000);
  if (err) { console.error("[r124] conversion failed:", err.message, stderr.slice(-300)); return false; }
  return true;
}
async function r124MakePoster(bins, videoFile, posterFile, atSec) {
  return r138SerializeFfmpeg(() => r124MakePosterNow(bins, videoFile, posterFile, atSec));
}
async function r124MakePosterNow(bins, videoFile, posterFile, atSec) {
  const { err } = await r124Run(bins.ffmpeg, ["-y", "-ss", String(atSec), "-i", videoFile, "-frames:v", "1", "-q:v", "3", posterFile], 60000);
  if (err) { console.error("[r124] poster generation failed:", err.message); return false; }
  try { return fs.existsSync(posterFile) && fs.statSync(posterFile).size > 0; } catch { return false; }
}
async function r124PosterFor(bins, id, absFile, info) {
  const posterName = `poster-${id}.jpg`;
  if (await r124MakePoster(bins, absFile, path.join(UPLOAD_DIR, posterName), r124FreezeAt(id, info ? info.duration : 0))) {
    db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/${posterName}`, id);
    return true;
  }
  return false;
}
// Upload path: probe the just-written file, transcode it in place
// if it is not already compliant (a renamed .mp4 replaces the
// original upload on disk; the row follows), then generate its
// poster. Any failure leaves the original untouched — the caller
// has already inserted the row and answers 201 either way.
async function r124ProcessUpload(id, name) {
  const bins = await r124ResolveBins();
  if (!bins) return;
  try {
    let abs = path.join(UPLOAD_DIR, name);
    let info = r124VideoInfo(await r124Probe(bins, abs));
    if (!info) return; // not a probeable video — leave exactly as uploaded
    if (!r124Compliant(abs, info)) {
      const base = name.replace(/\.[^.]+$/, "");
      const tmpOut = path.join(UPLOAD_DIR, `${base}.r124tmp.mp4`);
      if (await r124Convert(bins, abs, tmpOut)) {
        const chk = r124VideoInfo(await r124Probe(bins, tmpOut));
        if (chk && chk.codec === "h264") {
          const finalName = `${base}.mp4`;
          fs.renameSync(tmpOut, path.join(UPLOAD_DIR, finalName));
          if (finalName !== name) { try { fs.unlinkSync(abs); } catch {} }
          abs = path.join(UPLOAD_DIR, finalName);
          db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${finalName}`, id);
          info = chk;
          console.log(`[r124] upload ${id}: converted ${name} → ${finalName} (H.264/yuv420p/faststart)`);
        } else {
          try { fs.unlinkSync(tmpOut); } catch {}
          console.error(`[r124] upload ${id}: converted file did not probe as H.264 — original kept`);
        }
      }
    }
    await r124PosterFor(bins, id, abs, info);
  } catch (e) { console.error(`[r124] upload ${id} media processing error (original kept):`, e.message); }
}
// One-time migration for plays that predate the pipeline: any
// stored video file that probes as non-H.264 is converted to a
// NEW file (<base>-h264.mp4), the row is repointed only after the
// new file verifies as H.264, and the original is preserved on
// disk under a backup name — never deleted. Every video play
// without a poster gets one. Guarded by a settings marker so
// later boots skip the scan entirely; when ffmpeg is missing the
// marker is NOT set and the next boot retries.
async function r124RunMigration() {
  try {
    if (getSetting(R124_MIGRATION_KEY)) return;
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r124] migration deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id, media_url FROM highlights WHERE media_kind='file'").all();
    for (const row of rows) {
      try {
        const name = path.basename(row.media_url || "");
        if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) continue;
        const abs = path.join(UPLOAD_DIR, name);
        if (!fs.existsSync(abs)) continue;
        let info = r124VideoInfo(await r124Probe(bins, abs));
        if (!info) continue;
        if (info.codec !== "h264") {
          const base = name.replace(/\.[^.]+$/, "");
          const newName = `${base}-h264.mp4`;
          const newAbs = path.join(UPLOAD_DIR, newName);
          console.log(`[r124] migrating play ${row.id}: ${name} (${info.codec || "unknown codec"}) → ${newName}`);
          if (!(await r124Convert(bins, abs, newAbs))) { console.error(`[r124] migration: conversion failed for play ${row.id} — left untouched`); continue; }
          const chk = r124VideoInfo(await r124Probe(bins, newAbs));
          if (!chk || chk.codec !== "h264") { console.error(`[r124] migration: converted file for play ${row.id} did not verify as H.264 — left untouched`); try { fs.unlinkSync(newAbs); } catch {} continue; }
          let bakName = `${base}.hevc-orig.mp4`;
          if (fs.existsSync(path.join(UPLOAD_DIR, bakName))) bakName = `${base}.hevc-orig-${Date.now()}.mp4`;
          fs.renameSync(abs, path.join(UPLOAD_DIR, bakName));
          db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${newName}`, row.id);
          info = chk;
          console.log(`[r124] play ${row.id} migrated to ${newName}; original preserved as ${bakName}`);
        }
        const cur = db.prepare("SELECT poster_url, media_url FROM highlights WHERE id=?").get(row.id);
        if (cur && !cur.poster_url) {
          const finalAbs = path.join(UPLOAD_DIR, path.basename(cur.media_url || name));
          if (fs.existsSync(finalAbs)) await r124PosterFor(bins, row.id, finalAbs, info);
        }
      } catch (e) { console.error(`[r124] migration row ${row.id} failed:`, e.message); }
    }
    setSetting(R124_MIGRATION_KEY, new Date().toISOString());
    console.log("[r124] media migration complete");
  } catch (e) { console.error("[r124] migration error:", e.message); }
}
// One-time owner-directed retro-entry (Round 130, 2026-11-13):
// Emil directed that the board's first two real plays — id 50
// (Charlotte) and id 51 (Janine), both posted BEFORE the upload
// form had an opt-in box — be entered into the November 2026
// Hype of the Month contest. This is a one-time instruction for
// these two plays ONLY: it does not generalize to other legacy
// plays, and it never re-fires (settings marker, the r124 style).
// Each play is entered only if it exists, is approved, is not a
// sample, and is not already entered for 2026-11; every outcome
// is logged. A guardian can still withdraw either play from
// My Plays afterwards — the marker does not re-enter it.
const R130_MIGRATION_KEY = "r130_enter_50_51_v1";
function r130RunMigration() {
  try {
    if (getSetting(R130_MIGRATION_KEY)) return;
    const period = "2026-11";
    for (const id of [50, 51]) {
      const row = db.prepare("SELECT id, status, is_sample FROM highlights WHERE id=?").get(id);
      if (!row) { console.log(`[r130] retro-entry: play ${id} not found — skipped`); continue; }
      if (row.status !== "approved") { console.log(`[r130] retro-entry: play ${id} is ${row.status}, not approved — skipped`); continue; }
      if (row.is_sample) { console.log(`[r130] retro-entry: play ${id} is a sample — skipped`); continue; }
      if (db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(id, period)) { console.log(`[r130] retro-entry: play ${id} already entered for ${period} — skipped`); continue; }
      db.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(id, period);
      console.log(`[r130] retro-entry: play ${id} entered into Hype of the Month ${period} (owner direction, 2026-11-13)`);
    }
    setSetting(R130_MIGRATION_KEY, new Date().toISOString());
    console.log("[r130] retro-entry migration complete");
  } catch (e) { console.error("[r130] migration error:", e.message); }
}
// One-time athlete rename (Round 131, 2026-11-13): play 51 was
// uploaded with the GUARDIAN's name in the athlete field — it
// displays "Janine", but the athlete is the catcher in the play's
// own story ("Juliana showing her catcher skills!!"). Emil
// directed the correction ("Make the change"). The rename
// re-derives the athlete identity with the very same resolver the
// upload path uses, fed the row's own team/division/jersey/
// guardian email, so the end state is indistinguishable from an
// upload that had the right name all along: the resolver finds or
// creates the "juliana" registry row and the play's athlete_id /
// athlete_tag / athlete_group move to it. The old "janine"
// registry row is left in place — registry rows are never
// deleted, and nothing references it once the play moves.
// Contest entries and votes key off highlight_id and are
// untouched. One-time and idempotent twice over: the settings
// marker (r124 style) never re-fires, and the name condition
// alone — play 51 currently displaying "Janine" — would stop a
// second run anyway.
const R131_MIGRATION_KEY = "r131_rename_51_v1";
function r131RunMigration() {
  try {
    if (getSetting(R131_MIGRATION_KEY)) return;
    const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(51);
    if (!row) {
      console.log("[r131] rename: play 51 not found — skipped");
    } else if (normIdentity(row.player_name) !== "janine") {
      console.log(`[r131] rename: play 51 displays "${row.player_name}", not "Janine" — skipped`);
    } else {
      const before = { player_name: row.player_name, athlete_id: row.athlete_id, athlete_tag: row.athlete_tag, athlete_group: row.athlete_group };
      const athlete = resolveAthlete({ playerName: "Juliana", team: String(row.team || "").trim(), division: row.division || "", jersey: String(row.jersey || "").trim(), notifyEmail: String(row.notify_email || "").trim() });
      db.prepare("UPDATE highlights SET player_name=?, athlete_id=?, athlete_tag=?, athlete_group=? WHERE id=?")
        .run("Juliana", athlete.athlete_id, athlete.athlete_tag, athlete.athlete_group, 51);
      console.log(`[r131] rename: play 51 athlete "${before.player_name}" -> "Juliana" (athlete_id ${before.athlete_id || "(none)"} -> ${athlete.athlete_id || "(none)"}, tag ${before.athlete_tag || "(none)"} -> ${athlete.athlete_tag || "(none)"}, group "${before.athlete_group}" -> "${athlete.athlete_group}") — owner direction, 2026-11-13`);
    }
    setSetting(R131_MIGRATION_KEY, new Date().toISOString());
    console.log("[r131] rename migration complete");
  } catch (e) { console.error("[r131] migration error:", e.message); }
}

// ---- Round 146: Trash + moderation log helpers ----
// logModeration146 is the ONE writer for moderation_log. It is
// deliberately fail-silent: a logging error must never fail the
// moderation action it records (every call site also stays outside
// the action's own error handling). actor is 'owner' for the owner
// surfaces (Owner view + email moderation links — named tokens are
// Phase 7), 'backup-tool' for the BACKUP_TOKEN channel, 'system'
// for the auto-purge.
function logModeration146(playId, action, actor, detail) {
  try {
    db.prepare("INSERT INTO moderation_log(play_id, action, actor, detail) VALUES(?,?,?,?)")
      .run(playId == null ? null : Number(playId), String(action || ""), String(actor || ""), String(detail || ""));
  } catch (e) { console.error("[r146] moderation log write failed:", e.message); }
}
// permanentDeletePlay146 is the OLD owner-delete cascade, extracted
// verbatim (media file, poster, Hype Frame print images + order
// rows, the play row, its votes, its contest entries — same order,
// same tolerant unlinks) for the two NEW permanent paths: the
// Trash section's "Delete forever" and the 7-day auto-purge. The
// pre-146 inline copies (owner DELETE is now a trash move; the
// /moderate delete and the R145 cleanup route keep their own) are
// statement-identical to this helper.
// →147: the /moderate delete no longer keeps its own copy — it is
// a trashPlay146 move like the owner DELETE. Only the R145 cleanup
// route keeps its own permanent cascade now.
function permanentDeletePlay146(id) {
  const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
  if (row && row.media_kind === "file") { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(row.media_url))); } catch {} }
  if (row && row.poster_url) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(row.poster_url))); } catch {} }
  for (const o of db.prepare("SELECT print_image FROM hype_frame_orders WHERE highlight_id=?").all(id)) {
    try { fs.unlinkSync(path.join(HYPEFRAME_DIR, path.basename(o.print_image))); } catch {}
  }
  db.prepare("DELETE FROM hype_frame_orders WHERE highlight_id=?").run(id);
  db.prepare("DELETE FROM highlights WHERE id=?").run(id);
  db.prepare("DELETE FROM votes WHERE highlight_id=?").run(id);
  db.prepare("DELETE FROM contest_entries WHERE highlight_id=?").run(id);
  return row;
}
// trashPlay146 moves a play to Trash: the status flips, the
// pre-trash status is remembered for Restore, and the CURRENT
// period's contest entry is removed so a trashed play can never
// stand in the contest (standings derive from contest_entries;
// /api/contest also filters status='approved', so the entry
// removal is belt-and-braces for a later restore). Votes are KEPT
// — a restore brings the play back whole; only a purge deletes
// them. Media + poster files are KEPT (that is the point of
// Trash). Returns true when the play was newly trashed.
function trashPlay146(row, actor, viaLabel) {
  if (!row || row.status === "trashed") return false;
  db.prepare("UPDATE highlights SET status_before_trash=?, status='trashed', trashed_at=datetime('now') WHERE id=?").run(row.status, row.id);
  db.prepare("DELETE FROM contest_entries WHERE highlight_id=? AND period=?").run(row.id, currentPeriod());
  logModeration146(row.id, "trash", actor, `"${row.title}" — was ${row.status}, moved to Trash${viaLabel ? ` (${viaLabel})` : ""}`);
  return true;
}
// r146PurgeExpiredTrash permanently deletes every play that has
// sat in Trash for more than 7 days. Called at startup (in the
// listen callback, with the other migrations) and at the top of
// every Owner queue load, so the panel always shows the
// post-purge state — the app has no daily-timer idiom to ride,
// and these two triggers bound the worst case to the owner's
// next queue look. One [r146] log line per run that purged.
function r146PurgeExpiredTrash() {
  try {
    const rows = db.prepare("SELECT * FROM highlights WHERE status='trashed' AND trashed_at IS NOT NULL AND trashed_at < datetime('now','-7 days')").all();
    if (!rows.length) return 0;
    for (const r of rows) {
      permanentDeletePlay146(r.id);
      logModeration146(r.id, "purge", "system", `auto-purge after 7 days in Trash: "${r.title}"`);
    }
    console.log(`[r146] auto-purge: permanently deleted ${rows.length} play(s) trashed more than 7 days ago (${rows.map((r) => r.id).join(",")})`);
    return rows.length;
  } catch (e) { console.error("[r146] auto-purge error:", e.message); return 0; }
}

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
// Same per-IP pattern for the My Highlights lookup (see constants).
function lookupRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (lookupHitsByIp.get(ip) || []).filter((t) => now - t < LOOKUP_RATE_WINDOW_MS);
  if (hits.length >= LOOKUP_RATE_LIMIT) { lookupHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  lookupHitsByIp.set(ip, hits);
  return false;
}
// Same per-IP pattern for the site stats counter (see constants).
function trackRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (trackHitsByIp.get(ip) || []).filter((t) => now - t < TRACK_RATE_WINDOW_MS);
  if (hits.length >= TRACK_RATE_LIMIT) { trackHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  trackHitsByIp.set(ip, hits);
  return false;
}
// Same per-IP pattern for the Upload Assist (see constants).
function assistRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (assistHitsByIp.get(ip) || []).filter((t) => now - t < ASSIST_RATE_WINDOW_MS);
  if (hits.length >= ASSIST_RATE_LIMIT) { assistHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  assistHitsByIp.set(ip, hits);
  return false;
}
// Same per-IP pattern for the bottle drop-notify form (see constants).
function notifyRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (notifyHitsByIp.get(ip) || []).filter((t) => now - t < NOTIFY_RATE_WINDOW_MS);
  if (hits.length >= NOTIFY_RATE_LIMIT) { notifyHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  notifyHitsByIp.set(ip, hits);
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
      // ---- Round 144: exact restore of deleted plays (the one
      // WRITING backup route) ----
      // Built for one job: putting back plays the owner deleted by
      // mistake, with their original ids, votes, contest entries and
      // media files, from a bundle extracted out of a pulled backup.
      // ALL-OR-NOTHING: every validation below runs before a single
      // byte or row is written; any failure leaves the live DB and
      // the uploads dir exactly as they were. Auth is the same
      // BACKUP_TOKEN check as every other backup route (above).
      // Body: multipart/form-data with a text field "bundle" (JSON:
      // { plays, votes, contest_entries, athletes, files:[{name,
      // size}] }) and one file part per file, part name = basename.
      if (p === "/api/backup/restore-plays" && req.method === "POST") {
        const ct = req.headers["content-type"] || "";
        if (!ct.includes("multipart/form-data")) return sendJson(res, 400, { ok: false, message: "multipart/form-data required." });
        const boundary = ct.split("boundary=")[1];
        if (!boundary) return sendJson(res, 400, { ok: false, message: "Missing multipart boundary." });
        const buf = await readBody(req);
        const parts = parseMultipart(buf, boundary);
        const bundlePart = parts.find((x) => x.name === "bundle");
        if (!bundlePart) return sendJson(res, 400, { ok: false, message: "Missing bundle field." });
        let bundle;
        try { bundle = JSON.parse(bundlePart.data.toString("utf8")); } catch { return sendJson(res, 400, { ok: false, message: "Bundle is not valid JSON." }); }
        const plays = Array.isArray(bundle.plays) ? bundle.plays : null;
        const votes = Array.isArray(bundle.votes) ? bundle.votes : [];
        const entries = Array.isArray(bundle.contest_entries) ? bundle.contest_entries : [];
        const athletes = Array.isArray(bundle.athletes) ? bundle.athletes : [];
        const fileSpecs = Array.isArray(bundle.files) ? bundle.files : null;
        if (!plays || !plays.length || !fileSpecs) return sendJson(res, 400, { ok: false, message: "Bundle needs at least one play and a files list." });
        const ids = plays.map((r) => Number(r && r.id));
        if (ids.some((id) => !Number.isInteger(id) || id <= 0) || new Set(ids).size !== ids.length)
          return sendJson(res, 400, { ok: false, message: "Bundle plays need unique positive integer ids." });
        const fileParts = new Map();
        for (const part of parts) if (part.name !== "bundle") fileParts.set(part.name, part.data);
        const safeName = (n) => typeof n === "string" && n.length > 0 && !n.includes("\0") && path.basename(n) === n && n !== "." && n !== "..";
        // ---- Validate EVERYTHING before writing ANYTHING ----
        const present = db.prepare(`SELECT id FROM highlights WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids).map((r) => r.id);
        if (present.length) return sendJson(res, 409, { ok: false, message: "Some plays already exist; restore aborted, nothing written.", ids: present });
        const specByName = new Map();
        for (const f of fileSpecs) {
          if (!f || !safeName(f.name) || !Number.isInteger(f.size) || f.size < 0 || specByName.has(f.name))
            return sendJson(res, 400, { ok: false, message: "Bundle files list is malformed." });
          specByName.set(f.name, f.size);
          const data = fileParts.get(f.name);
          if (!data) return sendJson(res, 400, { ok: false, message: `Missing file part: ${f.name}` });
          if (data.length !== f.size) return sendJson(res, 400, { ok: false, message: `File size mismatch for ${f.name}: bundle says ${f.size}, part has ${data.length}.` });
        }
        // Every file the plays point at must be covered by the bundle.
        for (const r of plays) {
          const refs = [];
          if (r.media_kind === "file" && r.media_url) refs.push(r.media_url);
          if (r.poster_url) refs.push(r.poster_url);
          for (const url of refs) {
            const base = path.basename(String(url));
            if (!specByName.has(base)) return sendJson(res, 400, { ok: false, message: `Play ${r.id} references ${base}, which is not in the bundle files.` });
          }
        }
        // Votes/entries may only reference plays inside this bundle.
        for (const v of [...votes, ...entries]) {
          if (!v || !ids.includes(Number(v.highlight_id))) return sendJson(res, 400, { ok: false, message: "Bundle votes/entries reference a play outside the bundle." });
        }
        for (const a of athletes) {
          if (!a || typeof a.athlete_key !== "string" || !a.athlete_key) return sendJson(res, 400, { ok: false, message: "Bundle athlete row is missing its athlete_key." });
        }
        // Existing-file rule: same size already on disk = already
        // there, skip its write; a different size = conflict, abort.
        const toWrite = [];
        for (const [name, size] of specByName) {
          const dest = path.join(UPLOAD_DIR, name);
          if (fs.existsSync(dest)) {
            if (fs.statSync(dest).size !== size) return sendJson(res, 409, { ok: false, message: `File already exists with a different size: ${name}` });
          } else toWrite.push(name);
        }
        // ---- Write: files (temp + rename), then ONE DB transaction.
        // Any throw removes the files this request wrote and rolls
        // the transaction back — the restore lands whole or not at all.
        const written = [];
        const tableCols = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
        const insertRow = (table, rowObj, orIgnore) => {
          const cols = tableCols(table).filter((c) => Object.prototype.hasOwnProperty.call(rowObj, c));
          if (!cols.length) return;
          db.prepare(`INSERT ${orIgnore ? "OR IGNORE " : ""}INTO ${table}(${cols.join(",")}) VALUES(${cols.map(() => "?").join(",")})`)
            .run(...cols.map((c) => (rowObj[c] === undefined ? null : rowObj[c])));
        };
        try {
          for (const name of toWrite) {
            const tmpName = path.join(UPLOAD_DIR, `.restore-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}`);
            fs.writeFileSync(tmpName, fileParts.get(name));
            fs.renameSync(tmpName, path.join(UPLOAD_DIR, name));
            written.push(name);
          }
          db.exec("BEGIN IMMEDIATE");
          try {
            for (const a of athletes) insertRow("athletes", a, true);
            for (const r of plays) insertRow("highlights", r, false);
            for (const v of votes) insertRow("votes", v, false);
            for (const e of entries) insertRow("contest_entries", e, false);
            db.exec("COMMIT");
          } catch (txErr) { try { db.exec("ROLLBACK"); } catch {} throw txErr; }
        } catch (err) {
          for (const name of written) { try { fs.unlinkSync(path.join(UPLOAD_DIR, name)); } catch {} }
          console.error("[r144] restore-plays failed, nothing kept:", err.message);
          return sendJson(res, 500, { ok: false, message: `Restore failed and was rolled back: ${err.message}` });
        }
        console.log(`[r144] restore-plays: restored plays ${ids.join(",")} (${written.length} files written, ${votes.length} votes, ${entries.length} contest entries)`);
        // Round 146: the restore lands in the moderation log, one
        // row per play (the helper never throws).
        for (const r of plays) logModeration146(r.id, "restore-plays", "backup-tool", `"${r.title || ""}" restored from backup (status ${r.status || "?"})`);
        return sendJson(res, 200, { ok: true, restored: ids, filesWritten: written.length, votes: votes.length, entries: entries.length });
      }
      // ---- Round 145: guarded cleanup of duplicate PENDING plays ----
      // The queue-cleanup companion to restore-plays: the owner
      // approves an exact id list (read off a backup pull), this
      // route deletes ONLY those plays, and ONLY while each is
      // still pending and not a sample — an approved or sample id
      // in the list is skipped and reported, never deleted. That
      // guard is the whole point: the 2026-11-13 hand-cleanup is
      // how three APPROVED plays got deleted by mistake. Per-id
      // semantics (NOT all-or-nothing): every id in the list gets
      // a verdict in the response. Deletion mirrors the owner
      // DELETE /api/highlights/:id cleanup exactly — media file,
      // poster, Hype Frame print images + order rows, votes,
      // contest entries, then the play row. Same BACKUP_TOKEN
      // auth as every other backup route (block check above).
      if (p === "/api/backup/delete-pending" && req.method === "POST") {
        let body145 = null;
        try { body145 = JSON.parse((await readBody(req, 64 * 1024)).toString("utf8") || "{}"); } catch { body145 = null; }
        if (!body145 || !Array.isArray(body145.ids)) return sendJson(res, 400, { ok: false, message: "Body must be JSON with an ids array." });
        if (body145.ids.length > 100) return sendJson(res, 400, { ok: false, message: "At most 100 ids per cleanup call." });
        const ids145 = [];
        for (const raw of body145.ids) {
          const n = Number(raw);
          if (!Number.isInteger(n) || n <= 0) return sendJson(res, 400, { ok: false, message: "Every id must be a positive integer." });
          if (!ids145.includes(n)) ids145.push(n);
        }
        const deleted145 = [], skipped145 = [];
        for (const id of ids145) {
          const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
          if (!row) { skipped145.push({ id, reason: "not found" }); continue; }
          if (row.status !== "pending") { skipped145.push({ id, reason: "not pending" }); continue; }
          if (row.is_sample) { skipped145.push({ id, reason: "sample" }); continue; }
          if (row.media_kind === "file") { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(row.media_url))); } catch {} }
          if (row.poster_url) { try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(row.poster_url))); } catch {} }
          for (const o of db.prepare("SELECT print_image FROM hype_frame_orders WHERE highlight_id=?").all(id)) {
            try { fs.unlinkSync(path.join(HYPEFRAME_DIR, path.basename(o.print_image))); } catch {}
          }
          db.prepare("DELETE FROM hype_frame_orders WHERE highlight_id=?").run(id);
          db.prepare("DELETE FROM highlights WHERE id=?").run(id);
          db.prepare("DELETE FROM votes WHERE highlight_id=?").run(id);
          db.prepare("DELETE FROM contest_entries WHERE highlight_id=?").run(id);
          // Round 146: the cleanup lands in the moderation log too
          // — it is a permanent delete, and the log is the record.
          logModeration146(id, "delete-pending", "backup-tool", `"${row.title}" — pending play permanently deleted by the guarded cleanup`);
          deleted145.push(id);
        }
        console.log(`[r145] delete-pending: deleted [${deleted145.join(",") || "none"}]; skipped ${skipped145.map((s) => `${s.id}:${s.reason}`).join(", ") || "none"}`);
        return sendJson(res, 200, { ok: true, deleted: deleted145, skipped: skipped145 });
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

    // ---- My Highlights lookup (light, no accounts) ----
    // "Find my athlete's highlights": a parent/guardian finds their
    // athlete's public collection without any sign-in — by the
    // athlete's HH-#### tag (or athlete_id), or by the guardian email
    // given at upload. The plays themselves are NOT served here: the
    // client takes the athlete_id into the existing public collection
    // (GET /api/highlights?athlete_id=…, approved plays only), so this
    // endpoint only ever names athletes.
    // Privacy, by construction:
    //  - The email is matched by its SHA-256 hash (the same hash the
    //    athletes table stores); the address itself is never stored,
    //    logged, or returned. Responses carry only public facts:
    //    display name, team, tag, approved-play count.
    //  - Only athletes with at least one APPROVED play are returned.
    //    An athlete whose plays are all still pending (or hidden) is
    //    indistinguishable from no match at all.
    //  - Every no-match — unknown tag, unknown email, pending-only
    //    athlete, empty query — returns the SAME empty list, so the
    //    endpoint cannot be used to probe whether a guardian email is
    //    on file. The per-IP rate limit above caps probing volume.
    //  - Athletes are returned as a LIST and are never merged: two
    //    athletes behind one guardian email (or sharing a name) stay
    //    two entries, and the visitor picks theirs.
    // Round 121 (2026-11-12): an EMAIL lookup ALSO returns `plays` —
    // the guardian's OWN plays in every status (pending included),
    // matched by the per-play guardian-email hash (notify_email_hash),
    // so a family can finally SEE the play they just posted and its
    // status. A play only ever appears when the query email hashes to
    // THAT play's guardian contact on file — the tag path never
    // returns plays, and no response field carries the address, a
    // phone, or any private column name. The athletes list above
    // keeps its approved-only semantics unchanged.
    if (p === "/api/athletes/lookup" && req.method === "GET") {
      if (lookupRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many lookups from this connection right now — please try again in a little while." });
      const tagQ = String(u.searchParams.get("tag") || "").trim();
      const emailQ = String(u.searchParams.get("email") || "").trim();
      let found = [];
      if (tagQ) {
        // Tags are stored uppercase ("HH-####"); accept any case the
        // family types. An athlete_id (the collection key) works too.
        const a = db.prepare("SELECT * FROM athletes WHERE tag=? OR athlete_key=?").get(tagQ.toUpperCase(), tagQ);
        if (a) found = [a];
      } else if (emailQ) {
        const emailHash = sha(normIdentity(emailQ));
        found = db.prepare("SELECT * FROM athletes WHERE email_hash=? AND email_hash<>'' ORDER BY created_at LIMIT 25").all(emailHash);
      }
      const athletes = [];
      for (const a of found) {
        const playCount = db.prepare("SELECT COUNT(*) c FROM highlights WHERE athlete_id=? AND status='approved'").get(a.athlete_key).c;
        if (!playCount) continue;
        const team = db.prepare("SELECT team FROM highlights WHERE athlete_id=? AND status='approved' AND team<>'' LIMIT 1").get(a.athlete_key)?.team || "";
        athletes.push({ athlete_id: a.athlete_key, tag: a.tag, name: a.display_name, team, playCount });
      }
      // Round 121: the guardian's own plays (email lookups only).
      let plays = [];
      if (emailQ && !tagQ) {
        const period = currentPeriod();
        const rows = db.prepare("SELECT * FROM highlights WHERE notify_email_hash=? AND notify_email_hash<>'' ORDER BY id DESC LIMIT 50").all(sha(normIdentity(emailQ)));
        plays = rows.map((r) => ({
          id: r.id,
          title: r.title,
          sport: r.sport,
          division: r.division,
          athlete_label: r.player_name ? athleteDisplayName(r.player_name) : "",
          athlete_id: r.athlete_id || "",
          athlete_tag: r.athlete_tag || "",
          team: r.team || "",
          status: r.status,
          inContest: r.status === "approved" ? !!db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(r.id, period) : false,
          created_at: r.created_at,
        }));
      }
      return sendJson(res, 200, { ok: true, athletes, plays });
    }

    // ---- Site stats: count an event (aggregate only) ----
    // POST /api/track { kind, key } — the ONLY writer of stat_events.
    // Strict allowlist, so the key space is bounded by construction:
    //  - kind "view": key must be one of TRACK_VIEW_KEYS (the SPA's
    //    main views), else 400.
    //  - kind "play_open": key must be the id of a highlight that
    //    exists (any status — the detail only ever opens for
    //    approved plays in the UI; existence is the stated rule),
    //    else 400.
    //  - kind "referrer": key is normalized to a host bucket /
    //    "direct" / "other" (see normalizeReferrerKey) — never
    //    refused, never stored raw.
    // Unknown kinds are 400. The body parse is fully guarded: a
    // malformed or oversized body is a 400, never a 500. Nothing
    // about the requester (IP, user agent) is stored — the IP only
    // feeds the in-memory rate limiter above.
    if (p === "/api/track" && req.method === "POST") {
      if (trackRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many events from this connection right now." });
      let evt = null;
      try { evt = JSON.parse((await readBody(req, 4096)).toString("utf8") || "{}"); } catch { evt = null; }
      if (!evt || typeof evt !== "object") return sendJson(res, 400, { ok: false, message: "Invalid tracking event." });
      const kind = String(evt.kind || "");
      const key = String(evt.key ?? "");
      if (kind === "view") {
        if (!TRACK_VIEW_KEYS.includes(key)) return sendJson(res, 400, { ok: false, message: "Unknown view." });
        bumpStat("view", key);
      } else if (kind === "play_open") {
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0 || !db.prepare("SELECT 1 FROM highlights WHERE id=?").get(id))
          return sendJson(res, 400, { ok: false, message: "Unknown play." });
        bumpStat("play_open", String(id));
      } else if (kind === "battle_pick") {
        // Hype Battles (Round 91): key is the winning play's id.
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0 || !db.prepare("SELECT 1 FROM highlights WHERE id=?").get(id))
          return sendJson(res, 400, { ok: false, message: "Unknown play." });
        bumpStat("battle_pick", String(id));
      } else if (kind === "battle_run_pick") {
        // Battle Run (Round 100): key is the finalized daily's id.
        const id = Number(key);
        if (!Number.isInteger(id) || id <= 0 || !db.prepare("SELECT 1 FROM daily_battles WHERE id=?").get(id))
          return sendJson(res, 400, { ok: false, message: "Unknown daily battle." });
        bumpStat("battle_run_pick", String(id));
      } else if (kind === "battle_run_complete") {
        // Battle Run (Round 100): key is the final score, "0".."5".
        if (!/^[0-5]$/.test(key)) return sendJson(res, 400, { ok: false, message: "Unknown run score." });
        bumpStat("battle_run_complete", key);
      } else if (kind === "story_open") {
        // Hype Stories (Round 63): key is the episode id ("ep01").
        if (!/^ep\d{2}$/.test(key)) return sendJson(res, 400, { ok: false, message: "Unknown story." });
        bumpStat("story_open", key);
      } else if (kind === "referrer") {
        bumpStat("referrer", normalizeReferrerKey(key));
      } else {
        return sendJson(res, 400, { ok: false, message: "Unknown tracking event." });
      }
      return sendJson(res, 200, { ok: true });
    }

    // ---- Upload Assist (Round 99): AI first pass over clip frames ----
    // The uploader's browser extracts ~5 frames from the picked clip
    // and posts them here as data URLs. They are validated, forwarded
    // to the vision model, and dropped — never logged, never stored.
    // With no AI_VISION_API_KEY configured the endpoint answers
    // {configured:false} and the upload form behaves exactly as it
    // did before this round; any model error answers {failed:true}
    // with the same effect. The verdict NEVER blocks server-side:
    // the browser enforces the gate (with its override), and every
    // upload still starts pending for a human owner decision.
    if (p === "/api/upload-assist" && req.method === "POST") {
      if (assistRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many assist requests from this connection right now — the form still works without it." });
      const ASSIST_MAX = 2.5 * 1024 * 1024;
      if (Number(req.headers["content-length"] || 0) > ASSIST_MAX) return sendJson(res, 413, { ok: false, message: "Frames too large." });
      let raw;
      try { raw = await readBody(req, ASSIST_MAX); }
      catch { try { return sendJson(res, 413, { ok: false, message: "Frames too large." }); } catch { return; } }
      let body = null;
      try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { body = null; }
      if (!body || !Array.isArray(body.frames) || !body.frames.length || body.frames.length > 8)
        return sendJson(res, 400, { ok: false, message: "Send 1–8 frames." });
      const frames = [];
      for (const f of body.frames) {
        const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String(f || ""));
        if (!m || m[2].length > 1400000) return sendJson(res, 400, { ok: false, message: "Frames must be jpeg/png data URLs." });
        frames.push({ media_type: "image/" + m[1], data: m[2] });
      }
      if (!process.env.AI_VISION_API_KEY) return sendJson(res, 200, { ok: true, configured: false });
      try {
        const result = await runUploadAssist(frames);
        return sendJson(res, 200, { ok: true, configured: true, result });
      } catch (e) {
        console.error("upload-assist failed:", e.message);
        return sendJson(res, 200, { ok: false, configured: true, failed: true, message: "Assist unavailable — the form works without it." });
      }
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
      // Round 100: the Hawks Founding Plays challenge count rides
      // the board payload — approved, non-sample, team matches
      // "Plainview Hawks" ignoring case and stray spaces.
      const hawksFounding = { count: db.prepare("SELECT COUNT(*) c FROM highlights WHERE status='approved' AND COALESCE(is_sample,0)=0 AND lower(trim(team))='plainview hawks'").get().c, goal: 10 };
      return sendJson(res, 200, { highlights: rows, totalHighlights: rows.length, totalVotes: rows.reduce((s, r) => s + r.voteCount, 0), hawksFounding });
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
      // Guardian attestation (Round 21): required on every new play,
      // checked BEFORE any file is written, so a rejected upload
      // leaves nothing behind — no play row, no orphan upload file.
      if (!parseConsent(fields.guardianConsent)) return sendJson(res, 400, { ok: false, message: "Please confirm you're the parent/guardian, or have their permission, to post this video." });
      const sport = String(fields.sport || "other").trim().toLowerCase();
      const division = ["girls","boys"].includes(String(fields.division || "").trim().toLowerCase()) ? String(fields.division).trim().toLowerCase() : "boys";
      let media_kind, media_url, mime = "", embed_url = "", host_label = "";
      let uploadedName = ""; // Round 124: the stored file's name, for the media pipeline below
      let mediaHash145 = null; // Round 145: sha256 of the file bytes (file uploads only)
      if (file && file.filename) {
        const ext = EXT[file.ctype] || path.extname(file.filename).replace(".", "").toLowerCase();
        if (!["mp4", "webm", "mov", "avi", "jpg", "jpeg", "png", "gif", "webp"].includes(ext) || !(file.ctype.startsWith("video/") || file.ctype.startsWith("image/")))
          return sendJson(res, 400, { ok: false, message: "Upload a video or photo file." });
        // Round 145: dedupe, checked BEFORE any file write or row
        // insert. The 2026-11-13 crash window made successful
        // uploads look failed, and every panicked retry landed as
        // a new pending play + a full file copy. A same-bytes play
        // created within the last 30 minutes (any status) means
        // this submit is that retry: answer from the original
        // play, write nothing, insert nothing. The AI-gate
        // override resubmits through this same handler, so it is
        // covered identically — no special case.
        mediaHash145 = crypto.createHash("sha256").update(file.data).digest("hex");
        const dup145 = db.prepare("SELECT id, status, athlete_tag FROM highlights WHERE media_hash=? AND created_at >= datetime('now','-30 minutes') ORDER BY id DESC LIMIT 1").get(mediaHash145);
        if (dup145) return sendJson(res, 200, { ok: true, deduped: true, id: dup145.id, status: dup145.status, athlete_tag: dup145.athlete_tag || "", message: "This clip is already in — no need to post it twice." });
        if (storageIsFull()) return sendJson(res, 507, { ok: false, message: "Storage is full right now — please try again later." });
        const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), file.data);
        media_kind = "file"; media_url = `/uploads/${name}`; mime = file.ctype; uploadedName = name;
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
      // Hype Stories (Round 63, 2026-11-08): a SEPARATE, optional
      // permission — the guardian agrees the play may be featured
      // as a story episode on the site and social channels. Board
      // posting never depends on it.
      const storyConsent = parseConsent(fields.storyConsent) ? 1 : 0;
      // Contest opt-in (Round 130): the new form sends contestOptin
      // EXPLICITLY ("1" checked / "0" unchecked — the client sets it
      // from the pre-checked box on every submit). parseConsent maps
      // "1"/"on"/"true" -> 1 and everything else -> 0, so a legacy
      // upload with NO field lands on 0 = never auto-entered (see
      // the column note above).
      const contestOptin130 = Object.prototype.hasOwnProperty.call(fields, "contestOptin") ? parseConsent(fields.contestOptin) : 0;
      // Upload Assist (Round 99): the browser's AI result rides along
      // as an untrusted label (see sanitizeAiField) — display only.
      const aiJson = sanitizeAiField(fields.ai);
      const info = db.prepare(`INSERT INTO highlights(title,sport,division,play_type,player_name,story,media_kind,media_url,mime,embed_url,host_label,status,review,team,notify_email,notify_email_hash,athlete_id,athlete_tag,athlete_group,jersey,guardian_phone,text_consent,guardian_consent_at,story_consent,story_consent_at,ai_json,contest_optin,media_hash)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, sport, division, fields.playType || "", fields.playerName || "", fields.story || "", media_kind, media_url, mime, embed_url, host_label, JSON.stringify(review), String(fields.team || "").trim(), String(fields.notifyEmail || "").trim(), String(fields.notifyEmail || "").trim() ? sha(normIdentity(String(fields.notifyEmail).trim())) : "", athlete.athlete_id, athlete.athlete_tag, athlete.athlete_group, String(fields.jersey || "").trim(), guardianPhone, textConsent, new Date().toISOString(), storyConsent, storyConsent ? new Date().toISOString() : "", aiJson, contestOptin130, mediaHash145);
      const newPlayId = Number(info.lastInsertRowid);
      // Round 124: the media pipeline runs BEFORE the response —
      // a converted file and its poster are part of the finished
      // upload, not an afterthought. It can never fail the upload:
      // every failure path inside keeps the original file and the
      // 201 below still goes out (see the fallback contract above).
      if (uploadedName && file && (file.ctype || "").startsWith("video/")) await r124ProcessUpload(newPlayId, uploadedName);
      const rowNow = db.prepare("SELECT media_url, poster_url FROM highlights WHERE id=?").get(newPlayId);
      if (rowNow) { media_url = rowNow.media_url; }
      notifyPending(title, sport, newPlayId, review);
      // Round 121: the response carries the athlete's HH tag so the
      // client can show it on the post-success screen ("save it!") —
      // the tag is a public identifier, safe to hand back.
      return sendJson(res, 201, { ok: true, id: newPlayId, status: "pending", athlete_tag: athlete.athlete_tag || "", media_url, poster_url: (rowNow && rowNow.poster_url) || "", message: "Thanks! Your play is in review and will appear once the owner approves it." });
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

    // ---- Bottle drop notifications (Round 106) ----
    // A parent/guardian asks to be emailed when a Hype Sports
    // bottle drops. The email is stored ONLY in drop_notifications
    // and listed ONLY on the owner endpoint below — the response
    // never echoes it and no public payload ever carries it. The
    // UNIQUE(email, sport) row + INSERT OR IGNORE make a repeat
    // signup the same success as the first (no duplicate rows, no
    // error for an honest double-tap).
    if (p === "/api/drop-notify" && req.method === "POST") {
      if (notifyRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many signups from this connection right now — please try again in a little while." });
      let body = null;
      try { body = JSON.parse((await readBody(req, 8192)).toString("utf8") || "{}"); } catch { body = null; }
      if (!body) return sendJson(res, 400, { ok: false, message: "That signup didn't come through — please try again." });
      const sport = String(body.sport || "").trim().toLowerCase();
      if (!DROP_NOTIFY_SPORTS.includes(sport))
        return sendJson(res, 400, { ok: false, message: "Pick one of the six bottles first." });
      const email = String(body.email || "").trim().toLowerCase();
      if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return sendJson(res, 400, { ok: false, message: "That email doesn't look right — check it and try again." });
      db.prepare("INSERT OR IGNORE INTO drop_notifications(email,sport) VALUES(?,?)").run(email, sport);
      return sendJson(res, 200, { ok: true, message: "You're on the list." });
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
      // Print image (Round 128): the composed PNG rides on the order
      // and is stored as a file in HYPEFRAME_DIR (DATA_DIR/hype-frames
      // — inside BACKUP_FILE_DIRS, so the nightly backup carries it).
      // Fault-tolerant by design: a missing, malformed, oversized or
      // unwritable image NEVER loses the order — the order is saved
      // with print_image = "" (marked missing) and the problem is
      // logged below; the owner view then shows "no print image on
      // file" and the image endpoint 404s cleanly for that order.
      let imgName = "";
      let imgProblem = "";
      const m = String(body.image || "").match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) imgProblem = "no PNG data URL on the payload";
      else {
        const imgBuf = Buffer.from(m[1], "base64");
        if (!imgBuf.length) imgProblem = "empty image payload";
        else if (imgBuf.length > HF_PRINT_IMAGE_MAX) imgProblem = `image over the 5MB cap (${imgBuf.length} bytes)`;
        else if (imgBuf.subarray(0, 4).toString("hex") !== "89504e47") imgProblem = "payload is not a PNG";
        else if (storageIsFull()) imgProblem = "storage full";
        else {
          const candidate = `hf-${Date.now()}-${crypto.randomBytes(6).toString("hex")}.png`;
          try { fs.writeFileSync(path.join(HYPEFRAME_DIR, candidate), imgBuf); imgName = candidate; }
          catch (e) { imgProblem = "write failed: " + e.message; }
        }
      }
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
        image_style: String(body.imageStyle || "").trim().toLowerCase() === "avatar" ? "avatar" : "photo",
        colorway: String(body.colorway || "").trim().slice(0, 40),
        size: ["YXXS", "YXS", "YS", "YM", "YL", "YXL"].includes(String(body.size || "").trim().toUpperCase()) ? String(body.size).trim().toUpperCase() : "YM",
        guardian_name: String(body.guardianName || "").trim().slice(0, 80),
        guardian_email: guardianEmail,
        placement,
      };
      const info = db.prepare(`INSERT INTO hype_frame_orders(highlight_id,athlete_id,print_image,custom_name,jersey,branding,apparel,side,image_style,colorway,size,guardian_name,guardian_email,placement)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.highlight_id, order.athlete_id, order.print_image, order.custom_name, order.jersey, order.branding, order.apparel, order.side, order.image_style, order.colorway, order.size, order.guardian_name, order.guardian_email, order.placement);
      if (imgProblem) console.error(`hype-frame order ${Number(info.lastInsertRowid)} saved WITHOUT its print image: ${imgProblem}`);
      notifyHypeFrameRequest({ ...order, id: Number(info.lastInsertRowid) }, play);
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid), status: "pending-guardian", imageSaved: !!imgName, message: "Request received — we'll email the parent/guardian to confirm before anything is printed." });
    }

    // ---- Round 100: Daily Battle ----
    if (p === "/api/daily-battle" && req.method === "GET") {
      const voter = u.searchParams.get("voterToken") || "";
      const row = ensureTodayDaily();
      return sendJson(res, 200, dailyPayload(row, voter));
    }
    if (p === "/api/daily-battle/pick" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const voter = String(body.voterToken || "").trim();
      if (!voter) return sendJson(res, 400, { ok: false, message: "Missing voter token." });
      const row = ensureTodayDaily();
      if (!row) return sendJson(res, 404, { ok: false, message: "No Daily Battle today yet." });
      const pickId = Number(body.pickId);
      if (pickId !== row.play_a_id && pickId !== row.play_b_id)
        return sendJson(res, 400, { ok: false, message: "That play is not in today's matchup." });
      // One pick per voter per day, LOCKED: a repeat post (even for
      // the other play) returns the stored pick unchanged.
      const existing = db.prepare("SELECT pick_id FROM daily_battle_picks WHERE daily_id=? AND voter_token=?").get(row.id, voter);
      if (!existing) {
        try { db.prepare("INSERT INTO daily_battle_picks(daily_id,voter_token,pick_id) VALUES(?,?,?)").run(row.id, voter, pickId); } catch { /* lost a race — the stored pick stands */ }
        // A pick on a REAL matchup also casts a normal vote for the
        // chosen play when it is a current contest entry and the
        // voter has not already voted for it this period. The check
        // + insert (never a delete) is what guarantees a daily pick
        // can NEVER toggle a vote off — the Round 91 safeguard.
        if (dailyIsReal(row)) {
          const period = currentPeriod();
          const entered = db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(pickId, period);
          const voted = db.prepare("SELECT 1 FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").get(pickId, voter, period);
          if (entered && !voted) {
            try { db.prepare("INSERT INTO votes(highlight_id,voter_token,created_at,period) VALUES(?,?,datetime('now'),?)").run(pickId, voter, period); } catch { /* vote already on file */ }
          }
        }
      }
      return sendJson(res, 200, dailyPayload(row, voter));
    }
    // Owner setter: social posts are made in advance, so the owner
    // can fix any date's matchup ahead of time. A date whose matchup
    // already has picks (or is finalized) is locked — changing it
    // would rewrite a crowd result people already played.
    if (p === "/api/owner/daily-battle" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const date = String(body.date || etToday());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return sendJson(res, 400, { ok: false, message: "Invalid date." });
      const aId = Number(body.playAId), bId = Number(body.playBId);
      if (!Number.isInteger(aId) || !Number.isInteger(bId) || aId === bId)
        return sendJson(res, 400, { ok: false, message: "Pick two different plays." });
      const a = getPlayRow(aId), b = getPlayRow(bId);
      if (!a || !b || a.status !== "approved" || b.status !== "approved")
        return sendJson(res, 400, { ok: false, message: "Both plays must be approved." });
      finalizeDailyBattles();
      const existing = db.prepare("SELECT * FROM daily_battles WHERE date=?").get(date);
      const practice = (a.is_sample || b.is_sample) ? 1 : 0;
      if (existing) {
        if (existing.finalized) return sendJson(res, 400, { ok: false, message: "That day is finalized — its result is locked." });
        const picks = db.prepare("SELECT COUNT(*) c FROM daily_battle_picks WHERE daily_id=?").get(existing.id).c;
        if (picks > 0) return sendJson(res, 400, { ok: false, message: "That matchup already has picks — it is locked." });
        db.prepare("UPDATE daily_battles SET play_a_id=?, play_b_id=?, practice=? WHERE id=?").run(aId, bId, practice, existing.id);
      } else {
        db.prepare("INSERT INTO daily_battles(date,play_a_id,play_b_id,practice) VALUES(?,?,?,?)").run(date, aId, bId, practice);
      }
      const saved = db.prepare("SELECT * FROM daily_battles WHERE date=?").get(date);
      return sendJson(res, 200, { ok: true, id: saved.id, date: saved.date, practice: !!saved.practice, a: publicHighlight(a), b: publicHighlight(b) });
    }

    // ---- Round 100: Battle Run ----
    if (p === "/api/battle-run" && req.method === "GET") {
      finalizeDailyBattles();
      const voter = u.searchParams.get("voterToken") || "";
      const decisive = finalizedRealDailies().filter((r) => r.winner_id != null);
      const finalizedCount = decisive.length;
      // Eligible for THIS voter: decisive real finals they did not
      // play live (no pick row), so the result is unknown to them.
      const eligible = voter
        ? decisive.filter((r) => !db.prepare("SELECT 1 FROM daily_battle_picks WHERE daily_id=? AND voter_token=?").get(r.id, voter))
        : decisive;
      if (eligible.length < 5) return sendJson(res, 200, { ok: true, available: false, finalizedCount, eligibleCount: eligible.length });
      const matchups = eligible.slice(0, 5).map((r) => ({
        dailyId: r.id, date: r.date,
        a: publicHighlight(getPlayRow(r.play_a_id), voter),
        b: publicHighlight(getPlayRow(r.play_b_id), voter),
      }));
      return sendJson(res, 200, { ok: true, available: true, finalizedCount, matchups });
    }
    if (p === "/api/battle-run/pick" && req.method === "POST") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      finalizeDailyBattles();
      const row = db.prepare("SELECT * FROM daily_battles WHERE id=?").get(Number(body.dailyId));
      if (!row || !row.finalized || row.winner_id == null || !dailyIsReal(row))
        return sendJson(res, 400, { ok: false, message: "That matchup is not a finalized Battle Run matchup." });
      const pickId = Number(body.pickId);
      if (pickId !== row.play_a_id && pickId !== row.play_b_id)
        return sendJson(res, 400, { ok: false, message: "That play is not in this matchup." });
      const total = row.final_a_picks + row.final_b_picks;
      const a = getPlayRow(row.play_a_id), b = getPlayRow(row.play_b_id);
      return sendJson(res, 200, {
        ok: true, correct: pickId === row.winner_id, winnerId: row.winner_id,
        split: { aPct: total ? Math.round((row.final_a_picks / total) * 100) : 0, bPct: total ? Math.round((row.final_b_picks / total) * 100) : 0 },
        titles: { a: a ? a.title : "", b: b ? b.title : "" },
      });
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
      // Round 121 (2026-11-12): entering is the POSTING GUARDIAN's
      // call — the old one-tap button let any visitor enter anyone's
      // play (the youth-agent test entered Charlotte's play as a
      // stranger). The caller must prove the guardian link with the
      // email used to post the play (trimmed, case-insensitive, the
      // same normalization as identity matching). The owner token is
      // the override path. A play with NO guardian email on file can
      // only be entered by the owner — the public control for it is
      // not rendered at all.
      if (!ownerAuthorized(req)) {
        if (!row.notify_email)
          return sendJson(res, 403, { ok: false, message: "This play can't be entered online — no guardian email is on file for it. The owner can enter it for you." });
        const given = normIdentity(body.email || "");
        if (!given || given !== normIdentity(row.notify_email))
          return sendJson(res, 403, { ok: false, message: "That email doesn't match the one used to post this play — try the one you posted with." });
      }
      const dup = db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(id, period);
      if (dup) return sendJson(res, 200, { ok: false, alreadyEntered: true, message: "This play is already entered in Hype of the Month." });
      const info = db.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(id, period);
      return sendJson(res, 201, { ok: true, entryId: Number(info.lastInsertRowid), period, message: "🏆 Entered! Good luck." });
    }
    if (p === "/api/contest/withdraw" && req.method === "POST") {
      // Round 130 (2026-11-13): the mirror of Round 121's enter —
      // withdrawing is the POSTING GUARDIAN's call too, proven with
      // the same email match (or the owner token). Only the
      // contest_entries row is removed: votes already cast stay in
      // the votes table (they are counted per month from the votes
      // rows themselves), so a play that re-enters in the same
      // month shows its votes again — the codebase's entry/vote
      // separation, unchanged. A withdrawn play can be re-entered
      // by the guardian through /api/contest/enter as before.
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = Number(body.highlightId);
      const period = String(body.period || currentPeriod());
      if (!/^\d{4}-\d{2}$/.test(period)) return sendJson(res, 400, { ok: false, message: "Invalid month." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (!ownerAuthorized(req)) {
        if (!row.notify_email)
          return sendJson(res, 403, { ok: false, message: "This play can't be withdrawn online — no guardian email is on file for it. The owner can withdraw it for you." });
        const given = normIdentity(body.email || "");
        if (!given || given !== normIdentity(row.notify_email))
          return sendJson(res, 403, { ok: false, message: "That email doesn't match the one used to post this play — try the one you posted with." });
      }
      const info = db.prepare("DELETE FROM contest_entries WHERE highlight_id=? AND period=?").run(id, period);
      if (!info.changes) return sendJson(res, 200, { ok: false, notEntered: true, message: "This play isn't entered in Hype of the Month." });
      return sendJson(res, 200, { ok: true, period, message: "Withdrawn from Hype of the Month." });
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
      // Round 105 (Feature 5): the crown follows the winner record —
      // re-crowning a different play for the same period MOVES the
      // monthly crown (the old winner's row for this period goes).
      db.prepare("DELETE FROM play_crowns WHERE kind='monthly' AND ref=?").run(period);
      awardCrown105(id, "monthly", period);
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
      // Round 11 (2026-11-05): "approve_sample" joins approve/hide —
      // the owner approves the AI sample plays through this emailed
      // link and needs them sample-marked in the same tap. It is a
      // normal approval PLUS is_sample=1 in the same update; the
      // notification conditions below key on status, so a sample
      // approval notifies exactly like a plain one. Hide never sets
      // the sample flag.
      // Round 13 (2026-11-05): "delete" joins them — the queue page's
      // "Live on the board" section retires approved plays from the
      // same emailed link. It works for a play of ANY status (its
      // whole purpose is removing approved ones) and mirrors the
      // owner DELETE /api/highlights/:id cleanup EXACTLY (below).
      // →147: the owner DELETE is a Trash move, and this delete
      // mirrors THAT now — see the branch below.
      if (!["approve", "approve_sample", "hide", "delete"].includes(action)) return sendHtml(res, 400, "<h1>Invalid action</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      const status = action === "hide" ? "hidden" : "approved";
      const before = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!before) return sendHtml(res, 404, "<h1>Play not found</h1><p><a href=\"/\">← HighlightHype home</a></p>");
      if (action === "delete") {
        // Round 147 (2026-11-13): the email link's delete is a
        // Trash move now — the same trashPlay146 semantics as the
        // Owner view's delete: the status flips (pre-trash status
        // remembered), the current period's contest entry goes,
        // and votes, files and Hype Frame orders are all KEPT, so
        // the play restores whole from the Owner panel's Trash
        // any time within 7 days. trashPlay146 writes the
        // moderation-log entry itself: action 'trash', actor
        // 'owner' (this surface's actor, as →146 set it), detail
        // carrying the email-link channel via the via-label.
        // (Round 13 →146 this branch ran the permanent cascade
        // inline and logged a 'purge'; permanent delete now
        // lives only in the Trash's Delete forever + auto-purge
        // and in the R145 operator cleanup route.)
        trashPlay146(before, "owner", "via the email moderation link");
        return sendHtml(res, 200, moderateTrashedPage147(before.title, token));
      }
      if (action === "approve_sample") db.prepare("UPDATE highlights SET status=?, is_sample=1 WHERE id=?").run(status, id);
      else db.prepare("UPDATE highlights SET status=? WHERE id=?").run(status, id);
      // Round 146: approvals and declines via the email link land
      // in the moderation log (transitions only, like the owner
      // status route — a re-post of the same state logs nothing).
      if (status === "approved" && before.status !== "approved") logModeration146(id, "approve", "owner", `"${before.title}" approved via the email moderation link${action === "approve_sample" ? " (as a sample play)" : ""}`);
      if (status === "hidden" && before.status !== "hidden") logModeration146(id, "reject", "owner", `"${before.title}" declined (hidden) via the email moderation link`);
      if (status === "approved" && before.status !== "approved" && before.notify_email) notifyApproved(before.title, before.id, before.notify_email);
      if (status === "approved" && before.status !== "approved") notifyGuardianText(before, `HighlightHype: good news — your play "${before.title}" was approved and is now live! See it here: https://highlighthype.com/#play-${before.id}`);
      const after = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      // Round 130: on a fresh approval, an opted-in play auto-enters
      // the contest (the helper refuses samples — approve_sample
      // lands here with is_sample=1 already set on `after`).
      if (status === "approved" && before.status !== "approved") autoEnterOnApproval130(after);
      const message = action === "approve_sample" ? "Approved as a sample play — this play is now live on the board, marked as a sample." : status === "approved" ? "Approved — this play is now live on the board." : "Declined — this play is hidden and will not appear on the board.";
      return sendHtml(res, 200, moderatePage(after, token, message));
    }
    if (p === "/moderate-queue" && req.method === "GET") {
      const token = u.searchParams.get("token") || "";
      if (!moderateAuthorized(token)) return sendHtml(res, 403, "<h1>Moderation link not valid</h1><p>Check the link from the approval email, or request a fresh moderation link.</p><p><a href=\"/\">← HighlightHype home</a></p>");
      const rows = db.prepare("SELECT * FROM highlights WHERE status='pending' ORDER BY id DESC").all();
      const liveRows = db.prepare("SELECT * FROM highlights WHERE status='approved' ORDER BY id DESC").all();
      return sendHtml(res, 200, moderateQueuePage(rows, token, "", liveRows));
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
      // Round 146: the queue load is one of the two auto-purge
      // triggers (startup is the other) — the panel always shows
      // the post-purge Trash.
      r146PurgeExpiredTrash();
      const trashDaysLeft146 = (r) => { if (!r.trashed_at) return null; const t = Date.parse(String(r.trashed_at).replace(" ", "T") + "Z"); return isNaN(t) ? null : Math.max(0, 7 - Math.floor((Date.now() - t) / 86400000)); };
      const rows = db.prepare("SELECT * FROM highlights ORDER BY id DESC").all().map((r) => {
        let review = null; try { review = r.review ? JSON.parse(r.review) : null; } catch {}
        let ai = null; try { ai = r.ai_json ? JSON.parse(r.ai_json) : null; } catch {}
        // Owner-only: the guardian email is included HERE (owner-authorized
        // endpoint) so the owner can contact a winner's parent/guardian.
        // It stays stripped from every public response. Same for the
        // guardian mobile + text opt-in: owner-visible only, and the
        // text_consent flag says whether texting is permitted at all.
        // The Upload Assist result (`ai`) rides the same owner-only
        // channel — it is a label for the queue, never public.
        return { ...publicHighlight(r), review, ai, celebration_spotlight: !!r.celebration_spotlight, guardian_email: r.notify_email || "", guardian_phone: r.guardian_phone || "", text_consent: !!r.text_consent, guardian_consent_at: r.guardian_consent_at || "", story_text: r.story || "", story_consent: !!r.story_consent,
          // Round 145: the current period's contest entry, owner-only,
          // so the live-delete confirmation can say the play is
          // entered (and in which month) before the owner deletes it.
          contest_entry_period: (db.prepare("SELECT period FROM contest_entries WHERE highlight_id=? AND period=?").get(r.id, currentPeriod()) || {}).period || "",
          // Round 146: Trash fields (owner-only, like the contest
          // entry above) — when the play was trashed, the status it
          // restores to, and whole days left before the auto-purge.
          trashed_at: r.trashed_at || "", status_before_trash: r.status_before_trash || "", trash_days_left: trashDaysLeft146(r) };
      });
      return sendJson(res, 200, { queue: rows });
    }
    // ---- Owner: moderation log (Round 146; owner-authorized ONLY) ----
    // The latest 50 moderation actions, newest first. play_title
    // comes from a LEFT JOIN so an entry survives its play's purge
    // (title null then; the detail text carries it).
    if (p === "/api/owner/moderation-log" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const entries = db.prepare(`SELECT l.id, l.play_id, l.action, l.actor, l.detail, l.created_at, h.title AS play_title
        FROM moderation_log l LEFT JOIN highlights h ON h.id = l.play_id ORDER BY l.id DESC LIMIT 50`).all();
      return sendJson(res, 200, { entries });
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
    // ---- Owner: bottle drop notifications (owner-authorized ONLY) ----
    // The only place drop-notify emails are ever returned. Counts are
    // grouped per sport in the fixed six-sport order so the owner
    // panel reads like the shop grid.
    if (p === "/api/owner/drop-notifications" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const signups = db.prepare("SELECT email, sport, created_at FROM drop_notifications ORDER BY id DESC").all();
      const counts = DROP_NOTIFY_SPORTS.map((sport) => ({ sport, count: signups.filter((s) => s.sport === sport).length }));
      return sendJson(res, 200, { signups, counts });
    }
    const hfImgMatch = p.match(/^\/api\/owner\/hype-frames\/(\d+)\/image$/);
    if (hfImgMatch && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const o = db.prepare("SELECT * FROM hype_frame_orders WHERE id=?").get(Number(hfImgMatch[1]));
      const file = o && o.print_image ? path.join(HYPEFRAME_DIR, path.basename(o.print_image)) : "";
      // Round 128: orders saved without an image (print_image = "")
      // 404 cleanly here — never resolve the directory itself.
      if (!o || !file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { ok: false, message: "Print image not found." });
      // Round 128 (Emil's fulfillment workflow): the owner grabs this
      // image on his iPhone and feeds it to his avatar tool, so the
      // response is a proper direct download — PNG content type plus
      // an attachment disposition with a stable, meaningful filename
      // (hypeframe-order-<id>.png) so iOS offers Save to Files/Photos
      // without friction. Auth stays header-only (owner token); the
      // Owner view fetches with the header and saves the blob under
      // this same filename.
      res.writeHead(200, { "content-type": "image/png", "content-disposition": `attachment; filename="hypeframe-order-${o.id}.png"`, "content-length": fs.statSync(file).size, "cache-control": "private, no-store" });
      return fs.createReadStream(file).pipe(res);
    }
    if (p === "/api/owner/reports" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      return sendJson(res, 200, { reports: db.prepare("SELECT * FROM reports ORDER BY id DESC").all() });
    }
    // ---- Owner: site stats (aggregate counters, owner-only) ----
    // Combines the stat_events counters (views, play opens,
    // referrers — see POST /api/track) with counts read straight
    // from the existing tables (votes, plays by status, Hype Frame
    // orders, athletes). The existing-system numbers are NEVER
    // double-counted through /api/track: a vote is a row in votes,
    // not a tracked event.
    if (p === "/api/owner/stats" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const dayStr = (d) => d.toISOString().slice(0, 10);
      const today = dayStr(new Date());
      const sumKind = (kind, sinceDay) => sinceDay
        ? db.prepare("SELECT COALESCE(SUM(count),0) c FROM stat_events WHERE kind=? AND day>=?").get(kind, sinceDay).c
        : db.prepare("SELECT COALESCE(SUM(count),0) c FROM stat_events WHERE kind=?").get(kind).c;
      const viewsByKey = {};
      for (const k of TRACK_VIEW_KEYS) viewsByKey[k] = 0;
      for (const r of db.prepare("SELECT key, SUM(count) c FROM stat_events WHERE kind='view' GROUP BY key").all()) viewsByKey[r.key] = r.c;
      const dailyRows = db.prepare("SELECT day, SUM(count) c FROM stat_events WHERE kind='view' AND day>=? GROUP BY day").all(dayStr(new Date(Date.now() - 29 * 864e5)));
      const dailyByDay = new Map(dailyRows.map((r) => [r.day, r.c]));
      const daily = [];
      for (let i = 29; i >= 0; i--) { const day = dayStr(new Date(Date.now() - i * 864e5)); daily.push({ day, count: dailyByDay.get(day) || 0 }); }
      const topPlays = db.prepare(`SELECT CAST(s.key AS INTEGER) AS id, h.title AS title, SUM(s.count) AS opens
        FROM stat_events s JOIN highlights h ON h.id = CAST(s.key AS INTEGER)
        WHERE s.kind='play_open' GROUP BY s.key ORDER BY opens DESC, id ASC LIMIT 10`).all();
      const referrers = db.prepare("SELECT key, SUM(count) AS count FROM stat_events WHERE kind='referrer' GROUP BY key ORDER BY count DESC, key ASC").all();
      const playStatus = { total: 0, approved: 0, pending: 0, hidden: 0 };
      for (const r of db.prepare("SELECT status, COUNT(*) c FROM highlights GROUP BY status").all()) {
        playStatus.total += r.c;
        if (Object.prototype.hasOwnProperty.call(playStatus, r.status)) playStatus[r.status] = r.c;
      }
      return sendJson(res, 200, {
        ok: true,
        generatedAt: new Date().toISOString(),
        views: {
          today: sumKind("view", today),
          last7Days: sumKind("view", dayStr(new Date(Date.now() - 6 * 864e5))),
          last30Days: sumKind("view", dayStr(new Date(Date.now() - 29 * 864e5))),
          allTime: sumKind("view"),
          byView: viewsByKey,
          daily,
        },
        playOpens: { total: sumKind("play_open"), top: topPlays.map((r) => ({ id: r.id, title: r.title, opens: r.opens })) },
        battles: { total: sumKind("battle_pick") },
        stories: { total: sumKind("story_open"), byEpisode: db.prepare("SELECT key, SUM(count) AS opens FROM stat_events WHERE kind='story_open' GROUP BY key ORDER BY key ASC").all().map((r) => ({ episode: r.key, opens: r.opens })) },
        referrers,
        totals: {
          votes: db.prepare("SELECT COUNT(*) c FROM votes").get().c,
          plays: playStatus,
          hypeFrameOrders: db.prepare("SELECT COUNT(*) c FROM hype_frame_orders").get().c,
          athletes: db.prepare("SELECT COUNT(*) c FROM athletes").get().c,
        },
      });
    }
    // ---- Round 149: storage meter (owner-only) ----
    // Born of the 2026-11-13 disk-full incident: the 1 GB disk
    // silently filled with duplicate pending uploads until
    // uploads started failing with "Storage is full." This
    // endpoint reports the DATA_DIR mount (statfs), the uploads
    // and hype-frames trees, the DB size, what the pending queue
    // is holding, and the biggest media files — the Owner panel
    // renders it as a meter so trouble is visible early. File
    // sizes come from the filesystem (media_url → UPLOAD_DIR),
    // never from a DB column.
    if (p === "/api/owner/storage" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      let totalBytes = null, freeBytes = null, usedBytes = null, usedPct = null;
      try {
        const s149 = fs.statfsSync(DATA_DIR);
        totalBytes = Number(s149.blocks) * Number(s149.bsize);
        freeBytes = Number(s149.bavail) * Number(s149.bsize);
        usedBytes = totalBytes - freeBytes;
        usedPct = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
      } catch { /* statfs unavailable here: nulls — the meter degrades to uploads-only numbers */ }
      const uploadsBytes = walkDataFiles(UPLOAD_DIR).reduce((a, f) => a + f.size, 0);
      const hypeFramesBytes = walkDataFiles(HYPEFRAME_DIR).reduce((a, f) => a + f.size, 0);
      const dbBytes = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH).size : 0;
      const mediaBytes149 = (row) => {
        if (!row || row.media_kind !== "file" || !row.media_url) return 0;
        try { return fs.statSync(path.join(UPLOAD_DIR, path.basename(row.media_url))).size; } catch { return 0; }
      };
      const rows149 = db.prepare("SELECT id, player_name, title, status, media_url, media_kind FROM highlights").all();
      let pendingCount = 0, pendingBytes = 0;
      const sized149 = [];
      for (const r of rows149) {
        const b = mediaBytes149(r);
        if (r.status === "pending") { pendingCount++; pendingBytes += b; }
        if (b > 0) sized149.push({ id: r.id, player_name: r.player_name, title: r.title, status: r.status, bytes: b });
      }
      sized149.sort((a, b) => b.bytes - a.bytes);
      return sendJson(res, 200, { ok: true, totalBytes, freeBytes, usedBytes, usedPct, uploadsBytes, dbBytes, hypeFramesBytes, pendingCount, pendingBytes, biggest: sized149.slice(0, 8) });
    }
    // Round 100: Celebration Spotlight toggle (owner only). Setting
    // it on one play clears every other play — a single active
    // spotlight by construction. Approved non-sample plays only.
    const celebMatch = p.match(/^\/api\/highlights\/(\d+)\/celebration$/);
    if (celebMatch && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = Number(celebMatch[1]);
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (body.spotlight) {
        if (row.status !== "approved" || row.is_sample) return sendJson(res, 400, { ok: false, message: "Only an approved, non-sample play can hold the Celebration Spotlight." });
        db.prepare("UPDATE highlights SET celebration_spotlight=0").run();
        db.prepare("UPDATE highlights SET celebration_spotlight=1 WHERE id=?").run(id);
      } else {
        db.prepare("UPDATE highlights SET celebration_spotlight=0 WHERE id=?").run(id);
      }
      const current = db.prepare("SELECT id FROM highlights WHERE celebration_spotlight=1").get();
      return sendJson(res, 200, { ok: true, spotlightId: current ? current.id : null });
    }
    const statusMatch = p.match(/^\/api\/highlights\/(\d+)\/status$/);
    if (statusMatch && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      if (!["approved", "hidden", "pending"].includes(body.status)) return sendJson(res, 400, { ok: false, message: "Invalid status." });
      const before = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(statusMatch[1]));
      // Round 146: re-statuing a TRASHED play (reachable only by a
      // direct API call — the panel keeps trashed plays in the
      // Trash section) clears its trash stamps in the same step, so
      // a play can never sit live with a stale trashed_at behind it.
      if (before && before.status === "trashed") db.prepare("UPDATE highlights SET status=?, trashed_at=NULL, status_before_trash=NULL WHERE id=?").run(body.status, Number(statusMatch[1]));
      else db.prepare("UPDATE highlights SET status=? WHERE id=?").run(body.status, Number(statusMatch[1]));
      // Sample flag rides the same call (Round 7): { sample: true }
      // flags the play as a sample IN THE SAME STEP as the status
      // change, so "Approve as Sample play" is a single owner action;
      // { sample: false } removes the mark. Absent = flag untouched.
      const hasSample = Object.prototype.hasOwnProperty.call(body, "sample");
      if (hasSample) db.prepare("UPDATE highlights SET is_sample=? WHERE id=?").run(body.sample ? 1 : 0, Number(statusMatch[1]));
      // Round 146: approvals and declines land in the moderation
      // log (transitions only — a same-state re-post, e.g. a pure
      // sample-flag change, logs nothing).
      if (before && body.status === "approved" && before.status !== "approved") logModeration146(Number(statusMatch[1]), "approve", "owner", `"${before.title}" approved${hasSample && body.sample ? " (as a sample play)" : ""}`);
      if (before && body.status === "hidden" && before.status !== "hidden") logModeration146(Number(statusMatch[1]), "reject", "owner", `"${before.title}" declined (hidden)`);
      if (body.status === "approved" && before && before.status !== "approved" && before.notify_email) notifyApproved(before.title, before.id, before.notify_email);
      if (body.status === "approved" && before && before.status !== "approved") notifyGuardianText(before, `HighlightHype: good news — your play "${before.title}" was approved and is now live! See it here: https://highlighthype.com/#play-${before.id}`);
      // Round 130: on a fresh approval, an opted-in play auto-enters
      // the contest. Re-fetched AFTER the sample-flag update above,
      // so a same-call { sample: true } approval is refused by the
      // helper's sample guard, exactly like the moderate path.
      if (body.status === "approved" && before && before.status !== "approved") autoEnterOnApproval130(db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(statusMatch[1])));
      return sendJson(res, 200, { ok: true, status: body.status, isSample: hasSample ? !!body.sample : !!(before && before.is_sample) });
    }
    const delMatch = p.match(/^\/api\/highlights\/(\d+)$/);
    if (delMatch && req.method === "DELETE") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      // Round 146: the owner delete is now a move to TRASH, not a
      // permanent delete — the 2026-11-13 hand-cleanup deleted
      // three LIVE plays by mistake, and a delete that cannot be
      // undone is how that happens. The play leaves every public
      // surface (its status is no longer approved/pending/hidden,
      // and its current-period contest entry goes), but its files,
      // votes and row stay put for 7 days: Restore (below) brings
      // it back whole, "Delete forever" (below) and the auto-purge
      // are the only permanent paths left on this surface. The
      // R145 backup cleanup route keeps its permanent semantics —
      // it is the operator tool for junk, not an owner gesture.
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(delMatch[1]));
      if (!row) return sendJson(res, 200, { ok: true, trashed: false });
      const newly = trashPlay146(row, "owner", "");
      return sendJson(res, 200, { ok: true, trashed: newly, alreadyTrashed: row.status === "trashed" });
    }
    // ---- Round 146: Trash restore + delete-forever (owner) ----
    const restoreMatch146 = p.match(/^\/api\/highlights\/(\d+)\/restore$/);
    if (restoreMatch146 && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(restoreMatch146[1]));
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (row.status !== "trashed") return sendJson(res, 400, { ok: false, message: "That play is not in the Trash." });
      // The media file IS the play: a trashed play whose file has
      // gone missing (a hand-cleaned disk, a partial backup) must
      // not come back as a broken board entry — it stays trashed
      // and the owner hears why. (A missing POSTER is not fatal:
      // the board falls back to its placeholder behavior.)
      if (row.media_kind === "file" && (!row.media_url || !fs.existsSync(path.join(UPLOAD_DIR, path.basename(row.media_url)))))
        return sendJson(res, 409, { ok: false, message: "The play's video file is missing, so it can't be restored. It stays in the Trash." });
      const backTo = ["approved", "pending", "hidden"].includes(row.status_before_trash || "") ? row.status_before_trash : "pending";
      db.prepare("UPDATE highlights SET status=?, trashed_at=NULL, status_before_trash=NULL WHERE id=?").run(backTo, row.id);
      // The contest entry is NOT recreated: trashing removed it,
      // and re-entering is the guardian/owner's explicit call via
      // the existing enter flow. The play's votes were kept, so a
      // re-entry shows them again.
      logModeration146(row.id, "restore", "owner", `"${row.title}" restored from Trash to ${backTo} (contest entry is not automatic)`);
      return sendJson(res, 200, { ok: true, status: backTo });
    }
    const purgeMatch146 = p.match(/^\/api\/highlights\/(\d+)\/purge$/);
    if (purgeMatch146 && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(purgeMatch146[1]));
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (row.status !== "trashed") return sendJson(res, 400, { ok: false, message: "Only a play in the Trash can be deleted forever — move it to Trash first." });
      permanentDeletePlay146(row.id);
      logModeration146(row.id, "purge", "owner", `manual delete-forever from Trash: "${row.title}"`);
      return sendJson(res, 200, { ok: true });
    }

    // ---- Uploads ----
    if (p.startsWith("/uploads/")) {
      const file = path.join(UPLOAD_DIR, path.basename(p));
      if (!fs.existsSync(file)) { res.writeHead(404); return res.end("Not found"); }
      const ext = path.extname(file).toLowerCase();
      const type = { ".mp4": "video/mp4", ".webm": "video/webm", ".mov": "video/quicktime", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp" }[ext] || "application/octet-stream";
      const upStat = fs.statSync(file);
      const size = upStat.size;
      /* Round 97 (2026-11-10): uploads carried no cache headers at
         all, so repeat visits re-downloaded the board's videos in
         full. Same one-day media policy as static files, plus
         ETag/Last-Modified validators so browsers can revalidate
         with a 304 instead. Range support unchanged. */
      const upEtag = `"${size.toString(16)}-${Math.floor(upStat.mtimeMs).toString(16)}"`;
      const upLastMod = upStat.mtime.toUTCString();
      const upCache = { "cache-control": "public, max-age=86400", etag: upEtag, "last-modified": upLastMod };
      const inm = req.headers["if-none-match"];
      const ims = req.headers["if-modified-since"];
      if ((inm && inm.split(",").map((s) => s.trim()).includes(upEtag)) || (!inm && ims && Date.parse(ims) >= Math.floor(upStat.mtimeMs / 1000) * 1000)) {
        res.writeHead(304, upCache); return res.end();
      }
      const range = req.headers.range;
      const ifRange = req.headers["if-range"];
      if (range && (!ifRange || ifRange === upEtag || ifRange === upLastMod)) {
        const m = /bytes=(\d*)-(\d*)/.exec(range);
        /* Round 117: two RFC 9110 corrections — Emil's iPhone
           reported Battles videos "did not load." (1) An end past
           EOF is satisfiable by clamping to the last byte, never a
           416 (media stacks probe with oversized ends). (2) A
           suffix range (bytes=-N) asks for the LAST N bytes — the
           tail fetch a player makes to find the moov index, which
           sits at the END of most battle clips; the old code handed
           back the file's HEAD labeled as that range, so the index
           never arrived and the player sat black. */
        let start, end;
        if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
        else {
          start = m && m[1] ? Number(m[1]) : 0;
          end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
        }
        if (start >= size || start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
        res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, ...upCache });
        return fs.createReadStream(file, { start, end }).pipe(res);
      }
      res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, ...upCache });
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
    /* Round 84 (2026-11-09, Emil): the store's pictures popped in
       late because static files carried NO cache headers at all —
       every visit re-downloaded megabytes from this small server.
       Versioned URLs (?v=) cache for a week (the version IS the
       invalidation), images/video/fonts for a day, pages never. */
    const staticExt = path.extname(filePath).toLowerCase();
    const cacheControl = /[?&]v=/.test(req.url || "") ? "public, max-age=604800"
      : /\.(jpe?g|png|webp|gif|svg|ico|mp4|webm|woff2?)$/.test(staticExt) ? "public, max-age=86400"
      : "no-cache";
    const range = req.headers.range;
    if (range) {
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      /* Round 117: same RFC 9110 corrections as the uploads
         handler — clamp an oversized end, honor suffix ranges. */
      let start, end;
      if (m && !m[1] && m[2]) { start = Math.max(0, size - Number(m[2])); end = size - 1; }
      else {
        start = m && m[1] ? Number(m[1]) : 0;
        end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
      }
      if (start >= size || start > end) { res.writeHead(416, { "content-range": `bytes */${size}` }); return res.end(); }
      res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1, "cache-control": cacheControl });
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, "cache-control": cacheControl });
    fs.createReadStream(filePath).pipe(res);
  } catch (e) {
    console.error(e);
    sendJson(res, 500, { ok: false, message: e.message || "Server error" });
  }
});

server.listen(PORT, () => { console.log(`HighlightHype listening on http://localhost:${PORT} (data: ${DATA_DIR})`); r131RunMigration(); r130RunMigration(); r124RunMigration(); r146PurgeExpiredTrash(); });
