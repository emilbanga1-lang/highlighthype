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
import zlib from "node:zlib";
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
// Round 165 (2026-11-14): Hype Reel downloads live under DATA_DIR
// for the same reason — a reel is a family's own copy of their
// play's video, generated on demand, cached here, and served ONLY
// through the guardian-gated reel endpoint below (never a public
// URL). Inside BACKUP_FILE_DIRS, so the nightly backup carries
// the reels alongside the Hype Frame prints.
const REEL_DIR = path.join(DATA_DIR, "reels");
fs.mkdirSync(REEL_DIR, { recursive: true });
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
// Hype Reel guard (Round 165, see POST /api/highlights/:id/reel):
// a reel request can mean a full ffmpeg generation, so it gets
// the lookup-style per-IP cap — far above a family's real use
// (a few plays, a download each), far below anything that could
// keep the single serialized encoder busy or fill the disk.
// Generation itself is further fenced inside r165EnsureReel:
// one in-flight build per play, and a 30s cooldown after a
// failed build so a broken file can't be hammered.
const REEL_RATE_LIMIT = 30;               // reel requests per IP per window
const REEL_RATE_WINDOW_MS = 10 * 60 * 1000;
const reelHitsByIp = new Map();
// Hype Frame Avatar guard (Round 206, see POST /api/hype-frame/avatar):
// every generation is a PAID OpenAI image call, so it gets the
// tightest per-IP cap on the site — a family needs a few tries per
// hoodie, and an hour window matches the generation's own pace.
// The IP is used transiently in memory only, exactly like the
// limiters above; the frame image itself is never stored or logged.
const AVATAR_RATE_LIMIT = 6;              // avatar generations per IP per window
const AVATAR_RATE_WINDOW_MS = 60 * 60 * 1000;
const avatarHitsByIp = new Map();
// Same guard for Hype Frame fence removal (Round 222, see
// POST /api/hype-frame/remove-fence): also a paid OpenAI image
// call, so the same tight cap, on its own per-IP map.
const FENCE_RATE_LIMIT = 6;               // fence removals per IP per window
const FENCE_RATE_WINDOW_MS = 60 * 60 * 1000;
const fenceHitsByIp = new Map();
// Backup file downloads may only ever serve files inside these
// data subdirectories (the DB is served by its own snapshot
// endpoint). Round 165: reels/ joins the list — cached Hype
// Reels are part of what a restore should bring back.
const BACKUP_FILE_DIRS = [UPLOAD_DIR, HYPEFRAME_DIR, REEL_DIR];


// ---- Pending-approval email notification (zero-dependency SMTP) ----
// Set in Render env vars to enable: SMTP_USER (e.g. hello@highlighthype.com),
// SMTP_PASS (mailbox password, never committed), SMTP_HOST (default
// mail.privateemail.com), SMTP_PORT (default 465), NOTIFY_TO (default
// hello@highlighthype.com). If SMTP_USER/SMTP_PASS are unset, this is a
// silent no-op and uploads still succeed.
function smtpSend({ host, port, user, pass, from, to, subject, body, html }) {
  // Test seam (Round 164): when HH_MAIL_CAPTURE names a file, the
  // "send" appends one JSON line per message ({to, subject, body})
  // there instead of opening a socket — that file is the suites'
  // mail stub, the only way email behavior is provable in the
  // sandbox. NEVER set in prod; unset, this branch does not exist
  // as far as behavior is concerned. Round 188: a message that
  // carries an HTML part (the welcome email) adds an `html` key
  // to its capture line; plain house mail is captured exactly as
  // before.
  if (process.env.HH_MAIL_CAPTURE) {
    try { fs.appendFileSync(process.env.HH_MAIL_CAPTURE, JSON.stringify(html ? { to, subject, body, html } : { to, subject, body }) + "\n"); } catch {}
    return Promise.resolve();
  }
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
        // Round 188: a message with an `html` part goes out as
        // multipart/alternative (plain text first, HTML second —
        // clients pick the richest part they render). Plain house
        // mail keeps the exact single-part shape it always had.
        if (html) {
          const bnd = "hh-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
          sock.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${bnd}"\r\n\r\n--${bnd}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n--${bnd}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}\r\n--${bnd}--\r\n.\r\n`);
        } else {
          sock.write(`From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n.\r\n`);
        }
        await readLine();
        await cmd("QUIT", "221");
        sock.end(); resolve();
      } catch (e) { try { sock.destroy(); } catch {} reject(e); }
    })();
  });
}
// The ONE moderation-link builder. The pending-approval email
// (notifyPending) and the Round 156 owner text alert both mint
// their per-play link here, so the link in the email and the
// link in the text for the same play are byte-identical by
// construction — same path, same id, same shared token.
function moderateLinkFor(id) {
  try { return `https://highlighthype.com/moderate?id=${id}&token=${moderateToken()}`; } catch { return ""; }
}
function notifyPending(title, sport, id, review) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return;
  const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
  const reviewLine = review ? `\nPre-review: ${review.verdict}${review.flags.length ? " — " + review.flags.join("; ") : " — no flags found"}\n(Pre-review is a first-pass check only. It does NOT approve the play — you still approve or hide it in Owner view.)\n` : "";
  const modLink = moderateLinkFor(id);
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

// ---- Owner text alerts (Round 156, 2026-11-14) ----
// When a new play lands in the review queue, the owners get a
// text carrying the play's moderation link — Emil explicitly
// chose the link IN the text (2026-11-14), knowing anyone
// holding it can moderate; it is the same token link the
// pending email carries (moderateLinkFor, above), and like
// that email it is never to be forwarded. Recipients come
// from OWNER_ALERT_PHONES in Render (comma-separated — Emil
// pastes his number and Dyanna's). The numbers live ONLY in
// that env var: no API or panel payload ever carries them —
// the status helper below reports counts and booleans only.
// Sending rides the same env-gated Twilio plumbing as the
// guardian texts: until TWILIO_* is set, each send is the
// usual logged no-op; until OWNER_ALERT_PHONES is set, the
// whole feature is silent.
function ownerAlertPhones156() {
  const out = [];
  for (const part of String(process.env.OWNER_ALERT_PHONES || "").split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const digits = entry.replace(/\D/g, "");
    let norm = "";
    if (digits.length === 10) norm = "+1" + digits; // plain US number
    else if (digits.length === 11 && digits.startsWith("1")) norm = "+" + digits; // US with country code
    else if (entry.startsWith("+") && digits.length >= 7 && digits.length <= 15) norm = "+" + digits; // already international
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}
function twilioConfigured156() {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);
}
function ownerTextAlertStatus156() {
  const phones = ownerAlertPhones156();
  const twilio = twilioConfigured156();
  return { configured: phones.length > 0, numbers: phones.length, twilio, on: phones.length > 0 && twilio };
}
// Fire-and-forget by contract: called AFTER the pending
// insert, so a texting problem can never delay or fail the
// upload response. sendText itself never throws (it resolves
// false and logs), and its log line masks each recipient to
// the last two digits, the same as the guardian path. The
// body keeps to plain GSM-safe characters (hyphen, straight
// quotes) so a typical alert fits in two SMS segments.
function notifyOwnerTextAlert156({ id, playerName, title, sport }) {
  try {
    const phones = ownerAlertPhones156();
    if (!phones.length) return;
    const athlete156 = athleteDisplayName(playerName) || String(playerName || "").trim() || "A guardian";
    const title156 = String(title || "").replace(/["\r\n]+/g, "'").replace(/\s+/g, " ").trim().slice(0, 60);
    const body = `HighlightHype: new play waiting - ${athlete156}: "${title156}" (${sport}). Review: ${moderateLinkFor(id)}`;
    console.log(`[r156] owner text alert: play ${id} -> ${phones.length} number(s)`);
    for (const to of phones) { sendText(to, body).catch(() => {}); }
  } catch (e) { console.error("notifyOwnerTextAlert156 failed:", e.message); }
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

// ---- Hype Frame Avatar (Round 206, 2026-11-26) ----
// The studio's "Make my avatar": a parent who picked the Avatar
// print style can generate the illustration IN the studio from
// their frozen frame instead of waiting for fulfillment. The
// frame is forwarded to OpenAI's image API and dropped — never
// logged, never stored server-side; the generated PNG rides back
// to the browser, which may then carry it on the order as the
// print image itself (orders mark that with avatar_generated).
// Config (Render env vars, set by Emil to activate):
//   OPENAI_API_KEY     — required; without it the status endpoint
//                        answers {configured:false}, the generate
//                        endpoint answers 503, and the studio
//                        hides the maker entirely (the Round 38
//                        pick-An-illustration-at-fulfillment flow
//                        is untouched).
//   HH_NO_AVATAR=1     — kill switch: stands the feature down
//                        even with a key configured.
//   HF_AVATAR_MODEL    — default "gpt-image-1" (image-edit model).
//   HF_AVATAR_BASE_URL — default https://api.openai.com (the
//                        Images API shape is used; overridable
//                        for tests, the AI_VISION_BASE_URL
//                        pattern).
// The style recipe is LOCKED server-side: the endpoint accepts
// only the frame image — no client field can reach the prompt.
// Round 218 (2026-11-26, Emil): the recipe now builds the full
// Hype Frame FORMAT design (name line / label / crown / framed
// illustration / branding on solid black). The studio's design
// fields (name mode, name, number, custom words, label, tone)
// are validated into FIXED SLOTS and interpolated as data —
// the client still cannot send a prompt; its text only ever
// lands inside the quoted slots below.
// Round 221 (2026-11-26, Emil): the first live R218 generation
// invented a generic at-bat instead of illustrating the frozen
// frame, so the illustration paragraph gains composition-lock
// clauses (same camera angle / framing / composition, nobody
// and nothing added or removed, the exact same instant). Every
// R218 format slot and the stylized-face rule stay byte-stable;
// the clauses are additions only. The studio also now sends a
// zoomed crop of the frame (client-side, R221) — the prompt
// does not change for that: it still just says "this photo".
// Round 222 (2026-11-26, Emil): two live tests (gpt-image-1.5,
// then gpt-image-2) rendered the scene faithfully but FLAT —
// "It doesn't follow the style" — because the model had only
// ever read a prose description of the house style. Every
// generation now carries a SECOND image: Emil's own reference
// design, tone-matched (HF_AVATAR_REF222 below), and the prompt
// gains a duty split (style from the reference; scene, pose,
// people and gear from the photo) plus an exact-lettering
// clause (gpt-image-2's "NiCHOLAS" mixed-case glitch is the
// failure it guards). All R218 slots and R221 clauses stay
// byte-stable; the additions are additions only.
const HF_AVATAR_MODEL206 = process.env.HF_AVATAR_MODEL || "gpt-image-1";
const HF_AVATAR_NAME_MODES218 = ["name", "name_number", "none", "custom"];
function hfAvatarSlot218(v, max) {
  return String(v == null ? "" : v).replace(/[^\p{L}\p{N} .,'&#!-]/gu, "").replace(/\s+/g, " ").trim().slice(0, max);
}
function hfAvatarDesign218(body) {
  const b = body && typeof body === "object" ? body : {};
  return {
    nameMode: HF_AVATAR_NAME_MODES218.includes(b.nameMode) ? b.nameMode : "name",
    name: hfAvatarSlot218(b.name, 16),
    number: String(b.number == null ? "" : b.number).replace(/\D/g, "").slice(0, 3),
    customText: hfAvatarSlot218(b.customText, 16),
    label: hfAvatarSlot218(b.label, 24).toUpperCase(),
    tone: b.tone === "pink" ? "pink" : "blue",
  };
}
function hfAvatarPrompt218(d) {
  const top = d.nameMode === "none" ? "" :
    d.nameMode === "custom" ? d.customText :
    d.nameMode === "name_number" ? [d.name, d.number].filter(Boolean).join(" ") :
    d.name;
  const colorWord = d.tone === "pink" ? "hot pink" : "bright blue";
  const topLine = top
    ? `Across the very top, the text "${top}" in huge ${colorWord} brush-stroke lettering. `
    : "There is NO name or word line across the top — the top of the design carries only the gold crown and the label above the frame. ";
  const labelLine = d.label
    ? `Near the top, above the frame, the label "${d.label}" in small white letter-spaced capital letters, with a thin gold brush stroke beneath it. `
    : "";
  return "Turn this youth sports photo into a finished Hype Frame print design on a solid black background: a bold, stylized illustrated avatar of the same athlete in the same moment, staying faithful to the photo — keep the exact pose, sport, action, uniform and uniform colors, and keep the photo's real setting, background, other players, lighting and colors; illustrate the scene that is actually there instead of inventing a new one. Keep the photo's exact camera angle, framing and composition — redraw THIS scene from THIS viewpoint and do not move the camera. Do not add or remove people or objects: whoever and whatever is in the photo stays in the picture, and nothing that is not in the photo appears. The athlete's pose, body position and action must match the photo's moment exactly — the same instant, not a similar play. Two images are attached: the photo to illustrate, and a finished Hype Frame design that is the house style reference. Take the illustration STYLE from the reference design — its bold ink outlines, sports-poster energy, radiating speed lines, distressed grunge frame, layout and brush-lettering treatment. Take the SCENE from the photo alone: its camera angle, composition, the athlete's pose and moment, the people in it, and the gear exactly as photographed — the bat's real color and shape, the helmet worn straight, the uniform and its colors. Never copy the reference design's athlete, pose, moment or text — it sets the style, never the scene. Build the design in this exact format, top to bottom. " +
    topLine + labelLine +
    "In the top-right corner, a gold brush-stroke crown. In the center, the illustrated moment inside a distressed white grunge frame with rough, splattered edges. At the bottom, the words \"HYPE FRAME\" in huge white brush-stroke lettering, and beneath them \"HIGHLIGHTHYPE\" in small white letter-spaced capital letters with the word HYPE in gold. The ONLY text in the image is the text named in this prompt, spelled exactly as given — no other words, letters, numbers, logos or watermarks anywhere. Premium sports-poster illustration with clean shapes and strong outlines. The athlete's face is a stylized illustration, never photorealistic. Render the name and label text exactly as given in this prompt, letter for letter, in the reference design's brush script — no changed, added or missing letters, and no mixed casing.";
}
// Round 222: the style anchor — server-side copies of Emil's
// own two reference designs (his 2026-11-26 uploads, downscaled
// to 1024px JPEGs under assets/). Boys/blue takes the Nicholas
// HOME RUN design; girls/pink takes the Charlotte KARATE design.
// A missing asset degrades to the pre-222 single-image request
// rather than breaking the maker.
const HF_AVATAR_REF222 = (() => {
  const out = {};
  for (const [tone, file] of [["blue", "hf-avatar-ref-boys.jpg"], ["pink", "hf-avatar-ref-girls.jpg"]]) {
    try { out[tone] = fs.readFileSync(path.join(__dirname, "assets", file)); }
    catch { console.error("hype-frame avatar: style reference missing (" + file + ") — generations go out without the anchor"); }
  }
  return out;
})();
const HF_AVATAR_MAX206 = 5 * 1024 * 1024; // decoded frame cap (the studio sends a <=1024px JPEG)
function hfAvatarConfigured206() {
  return !!process.env.OPENAI_API_KEY && process.env.HH_NO_AVATAR !== "1";
}
async function runHfAvatar206(buf, mime, design218) {
  const base = String(process.env.HF_AVATAR_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const d222 = design218 || hfAvatarDesign218(null);
  const form = new FormData();
  form.append("model", HF_AVATAR_MODEL206);
  form.append("prompt", hfAvatarPrompt218(d222));
  form.append("size", "auto");
  // Round 222: the style anchor rides SECOND — the photo stays
  // the first image (the prompt's "this photo"), the tone-matched
  // reference design follows as the style source.
  // Round 224: OpenAI's /v1/images/edits takes MULTIPLE images
  // only under the field name "image[]" — two parts both named
  // "image" earn a fast 400 upstream (the R222 live test 502'd
  // in ~1s; the local stub accepted any name, so the suite
  // never saw it). With a reference attached, BOTH parts go
  // under "image[]" (photo first, reference second); a
  // single-image request keeps the plain "image" field
  // exactly as before.
  const ref222 = HF_AVATAR_REF222[d222.tone];
  const imgField224 = ref222 ? "image[]" : "image";
  form.append(imgField224, new Blob([buf], { type: mime }), mime === "image/png" ? "frame.png" : "frame.jpg");
  if (ref222) form.append("image[]", new Blob([ref222], { type: "image/jpeg" }), "style-reference.jpg");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(base + "/v1/images/edits", {
      method: "POST", signal: ctl.signal,
      headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: form,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("avatar model answered " + r.status + (t ? ": " + t.replace(/\s+/g, " ").slice(0, 400) : "")); }
    const j = await r.json();
    const b64 = j && Array.isArray(j.data) && j.data[0] && typeof j.data[0].b64_json === "string" ? j.data[0].b64_json : "";
    if (!b64) throw new Error("avatar model returned no image");
    return "data:image/png;base64," + b64;
  } finally { clearTimeout(timer); }
}

/* Round 222 (2026-11-26, Emil): fence removal — the photo
   path's optional clean-up step, approved after a same-day
   proof ("Love that yes"). Same OpenAI edits machinery as the
   avatar (same key, model and base URL — HF_AVATAR_MODEL /
   HF_AVATAR_BASE_URL), its own kill switch (HH_NO_FENCE=1)
   and a remove-fence-ONLY prompt: the fence goes, everything
   else in the scene is preserved exactly. The endpoint only
   returns the cleaned photo — the studio shows it to the
   parent, who approves it or keeps the original; nothing here
   ever touches an order, a stored file or the print on its
   own. The photo is forwarded and dropped, never logged,
   never stored, exactly like the avatar's frame. */
const HF_FENCE_MAX222 = 5 * 1024 * 1024; // decoded photo cap (the studio sends a <=1024px JPEG)
const HF_FENCE_PROMPT222 = "Remove the chain-link fence from this photo. The photo was taken through a chain-link backstop fence: erase the fence wires, mesh and posts completely, and reconstruct the scene behind them exactly as it would look with no fence in front of the camera — the same athletes in the same poses, the same uniforms, the same field, the same lighting, the same camera angle and framing. Change nothing else: do not add, remove or move any person or object other than the fence, do not change any colors, do not stylize or illustrate — return the same photograph, cleaned of the fence.";
function hfFenceConfigured222() {
  return !!process.env.OPENAI_API_KEY && process.env.HH_NO_FENCE !== "1";
}
async function runHfFence222(buf, mime) {
  const base = String(process.env.HF_AVATAR_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  const form = new FormData();
  form.append("model", HF_AVATAR_MODEL206);
  form.append("prompt", HF_FENCE_PROMPT222);
  form.append("size", "auto");
  form.append("image", new Blob([buf], { type: mime }), mime === "image/png" ? "frame.png" : "frame.jpg");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const r = await fetch(base + "/v1/images/edits", {
      method: "POST", signal: ctl.signal,
      headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY },
      body: form,
    });
    if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error("fence model answered " + r.status + (t ? ": " + t.replace(/\s+/g, " ").slice(0, 400) : "")); }
    const j = await r.json();
    const b64 = j && Array.isArray(j.data) && j.data[0] && typeof j.data[0].b64_json === "string" ? j.data[0].b64_json : "";
    if (!b64) throw new Error("fence model returned no image");
    return "data:image/png;base64," + b64;
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

// ---- Round 159 (2026-11-14): visitor sources ----
// Emil: "I really want to know — where visitors come from."
// The SPA sends ONE visit_source event per browser session (see
// trackVisitSource159 in public/app.js): the referrer reduced to
// a bare HOST (never a URL — and reduced AGAIN here, so even a
// full URL in the payload stores only its host), the UTM trio
// from our own link, and the landing view. Everything lands in
// the same aggregate stat_events counters — nothing per-visitor
// is ever stored, no IPs, no user agents:
//   kind "visit_source"   key = the class (direct|search|social|other)
//   kind "visit_host"     key = bare host (external arrivals only;
//                           known platforms fold to their base host,
//                           e.g. l.instagram.com -> instagram.com, so
//                           rankings don't fragment across subdomains;
//                           every other host is kept verbatim)
//   kind "visit_campaign" key = JSON [utm_source, utm_medium, utm_campaign]
//   kind "visit_landing"  key = landing view (allowlist, else "other")
// The owner reads the last 30 days via GET /api/owner/stats
// (the .sources block). Counting starts with this round — earlier
// arrivals were never recorded and nothing is backfilled.
const VISIT_SEARCH_HOSTS159 = ["bing.com", "duckduckgo.com", "ecosia.org", "search.brave.com"];
const VISIT_SOCIAL_HOSTS159 = ["instagram.com", "facebook.com", "tiktok.com", "youtube.com", "youtu.be", "x.com", "twitter.com", "threads.net", "threads.com", "snapchat.com", "reddit.com"];
const VISIT_LANDING_KEYS159 = ["home", "board", "battles", "month", "stories", "store"];
function visitHost159(raw) {
  let h = String(raw || "").trim().toLowerCase();
  if (!h) return "";
  if (h.includes("://")) { try { h = new URL(h).hostname; } catch { return ""; } }
  h = h.split("/")[0].split("?")[0].split("#")[0].split(":")[0].replace(/\.$/, "").replace(/^www\./, "");
  if (h.length > 253) return "";
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(h)) return "";
  return h;
}
function hostIs159(host, base) { return host === base || host.endsWith("." + base); }
function classifyVisit159(host) {
  if (!host) return "direct";
  if (hostIs159(host, "highlighthype.com")) return "direct";
  if (hostIs159(host, "google.com") || /^google\.[a-z]{2,}(\.[a-z]{2})?$/.test(host)) return "search";
  if (hostIs159(host, "search.yahoo.com") || /^search\.yahoo\.[a-z]{2,}(\.[a-z]{2})?$/.test(host)) return "search";
  for (const b of VISIT_SEARCH_HOSTS159) if (hostIs159(host, b)) return "search";
  for (const b of VISIT_SOCIAL_HOSTS159) if (hostIs159(host, b)) return "social";
  return "other";
}
function visitHostKey159(host, cls) {
  if (cls === "social" || cls === "search") {
    for (const b of [...VISIT_SOCIAL_HOSTS159, ...VISIT_SEARCH_HOSTS159, "google.com", "search.yahoo.com"]) if (hostIs159(host, b)) return b;
  }
  return host;
}
function sanUtm159(v) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 64);
}
const VISIT_HOST_LABELS159 = [["instagram.com", "Instagram"], ["facebook.com", "Facebook"], ["tiktok.com", "TikTok"], ["youtube.com", "YouTube"], ["youtu.be", "YouTube"], ["x.com", "X"], ["twitter.com", "X (Twitter)"], ["threads.net", "Threads"], ["threads.com", "Threads"], ["snapchat.com", "Snapchat"], ["reddit.com", "Reddit"], ["bing.com", "Bing"], ["duckduckgo.com", "DuckDuckGo"], ["ecosia.org", "Ecosia"], ["search.brave.com", "Brave Search"], ["pinterest.com", "Pinterest"], ["linkedin.com", "LinkedIn"]];
function visitHostLabel159(host) {
  if (hostIs159(host, "google.com") || /^google\.[a-z]{2,}(\.[a-z]{2})?$/.test(host)) return "Google";
  if (hostIs159(host, "yahoo.com") || /^search\.yahoo\.[a-z]{2,}(\.[a-z]{2})?$/.test(host)) return "Yahoo";
  for (const [base, label] of VISIT_HOST_LABELS159) if (hostIs159(host, base)) return label;
  return host;
}
function recordVisitSource159(evt) {
  const host = visitHost159(evt && evt.host);
  const cls = classifyVisit159(host);
  bumpStat("visit_source", cls);
  if (host && cls !== "direct") bumpStat("visit_host", visitHostKey159(host, cls));
  const src = sanUtm159(evt && evt.utmSource), med = sanUtm159(evt && evt.utmMedium), camp = sanUtm159(evt && evt.utmCampaign);
  if (camp) bumpStat("visit_campaign", JSON.stringify([src, med, camp]));
  const landing = VISIT_LANDING_KEYS159.includes(String((evt && evt.landing) || "")) ? String(evt.landing) : "other";
  bumpStat("visit_landing", landing);
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
// Round 227 (2026-11-27): the coming-soon store cards (the six Drop 001
// collection quick views + the per-sport Hype Sports hoodies) reuse the
// bottles' notify-me capture VERBATIM — same endpoint, same table, same
// confirmation. Their keys join the allowlist beside the six bottle
// sports; the bottle path itself is byte-identical (the six keys, the
// messages, the dedupe). Collection keys are the quick view's own slugs;
// hoodie keys are "hoodie-" + the store's sport key.
const DROP_NOTIFY_KEYS227 = [...DROP_NOTIFY_SPORTS,
  "boys-street", "boys-athletics", "boys-unleashed", "girls-street", "girls-athletics", "girls-essentials",
  ...["baseball", "basketball", "football", "soccer", "hockey", "martialarts", "lacrosse"].map((s) => "hoodie-" + s)];
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
// Round 152 (2026-11-13): named owner passcodes (Phase 7a of the
// owner-panel program). Until now there was ONE owner token —
// Emil's — so a second moderator (Dyanna) could only share it,
// and a lost phone meant rotating access for everyone. A named
// passcode is a person's own row here: only the SHA-256 hash is
// stored (the plaintext is shown exactly once, at mint), a
// revoked_at stamp kills just that person's access the moment
// it lands, and last_used_at (stamped on auth, throttled) shows
// whether a passcode is actually in use. The env OWNER_TOKEN /
// claimed main token are untouched and keep actor 'owner'; a
// named passcode's moderation actions log under its name.
db.exec(`CREATE TABLE IF NOT EXISTS owner_tokens(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  token_hash TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);`);
// Round 155 (2026-11-14): the trusted-family FAST LANE (Phase 7c
// of the owner-panel program; Emil decided EMAIL-ONLY on
// 2026-11-14 — a guardian email on this list is, by itself,
// enough for that family's uploads to go live without waiting
// in the queue). Only the SHA-256 of the normalized guardian
// email is stored — the SAME normIdentity -> sha hash uploads
// already compute into highlights.notify_email_hash, so matching
// is hash-to-hash and no raw email ever lands in this table.
// Rows are seeded ONLY by explicit owner action from the panel
// (never auto-promoted); revoked_at retires a family on the very
// next upload (the lane lookup only matches active rows);
// last_used_at stamps each fast-laned upload. The email_hash
// UNIQUE index keeps one row per family: re-adding a revoked
// email reactivates that row in place rather than duplicating
// it. highlights.fast_laned_at is the marker the panel's
// "awaiting your look" strip reads.
db.exec(`CREATE TABLE IF NOT EXISTS trusted_guardians(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_hash TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  added_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT,
  revoked_at TEXT
);`);
try { db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_trusted_guardians_hash ON trusted_guardians(email_hash)"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN fast_laned_at TEXT"); } catch {}
/* Round 162 (2026-11-14): the milestone tag — WHY this moment
   mattered, in the family's own category, not just how big it
   was (Emil: the first hit after a run of outs must not have to
   out-shine the home run). One of MOMENT_KINDS162 or NULL
   (untagged — every play posted before this round). Validated
   at both write paths (upload + the owner's retro-tag) by
   momentKind162 below; never trusted raw. */
try { db.exec("ALTER TABLE highlights ADD COLUMN moment_kind TEXT"); } catch {}
/* Round 165 (2026-11-14): the Hype Reel cache record — when a
   play's branded reel was generated and WHAT it was built
   from. The cache at DATA_DIR/reels/<id>.mp4 is reused only
   while reel_source still equals the current format key for
   the play's media_url; plays' media never changes after
   approval in this product, so absent a format bump (Round
   167 added REEL_FORMAT_V for exactly that) the first
   generation is the last. */
try { db.exec("ALTER TABLE highlights ADD COLUMN reel_generated_at TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE highlights ADD COLUMN reel_source TEXT DEFAULT ''"); } catch {}
/* Round 189 (2026-11-25): the watch feed's music chip is
   DISPLAY-ONLY — a play may someday carry the name of a
   platform-licensed instrumental track picked at upload, and
   the feed renders the chip when one is attached. No licensed
   library exists yet, nothing in the product sets this column,
   and there is deliberately NO picker: the field rides along
   empty ('' everywhere) until a real library lands. */
try { db.exec("ALTER TABLE highlights ADD COLUMN music_track TEXT DEFAULT ''"); } catch {}
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
// Round 186 (2026-11-24): the upload-time enhancement agent's
// per-play report — ONE JSON string holding what the assessment
// measured (shake, content frame, flicker, interlace, dead time),
// which adjustments were applied, and the metadata-strip outcome
// (see the Round 186 section at the media pipeline). Owner
// diagnostics only: never on the public allowlist, never part of
// approval — a play's public shape is unchanged by this round.
try { db.exec("ALTER TABLE highlights ADD COLUMN enhance_json TEXT DEFAULT ''"); } catch {}
// Round 188 (2026-11-25): the upload welcome email's per-play
// sent marker — stamped ONLY after the welcome send succeeds and
// checked before any send, so a play can never be welcomed twice
// (see the Round 188 section at the media pipeline). '' = not sent.
try { db.exec("ALTER TABLE highlights ADD COLUMN welcome_sent_at TEXT DEFAULT ''"); } catch {}
// Round 192 (2026-11-25): the streaming rendition's URL — a
// smaller, faststart H.264 sibling (<base>-stream.mp4) the
// in-page players load instead of the 8–20 MB master (see the
// Round 192 section at the media pipeline). '' = no rendition
// yet; every surface falls back to media_url. The master stays
// canonical for downloads and Hype Frame frame-picking.
try { db.exec("ALTER TABLE highlights ADD COLUMN stream_url TEXT DEFAULT ''"); } catch {}
// Round 195 (2026-11-25): the head-trim + upscale stage's
// per-play evaluation stamp — set when the Round 195 stage has
// evaluated a play (both stages decided, applied or not), and
// read by the boot backfill, which selects on the empty stamp
// so an evaluated play is never re-processed (see the Round
// 195 section at the media pipeline). '' = not yet evaluated.
try { db.exec("ALTER TABLE highlights ADD COLUMN r195_checked_at TEXT DEFAULT ''"); } catch {}
// Round 203 (2026-11-26): the action-band reframe stage's
// per-play evaluation stamp — set when the Round 203 stage
// has evaluated a play (reframed or not), and read by the
// boot backfill, which selects on the empty stamp so an
// evaluated play is never re-processed (see the Round 203
// section at the media pipeline). '' = not yet evaluated.
try { db.exec("ALTER TABLE highlights ADD COLUMN r203_checked_at TEXT DEFAULT ''"); } catch {}
// Round 209 (2026-11-26): the smart-poster stage's per-play
// evaluation stamp — set when the Round 209 stage has
// evaluated a play (poster re-picked or deliberately kept),
// and read by the boot backfill, which selects on the empty
// stamp so an evaluated play is never re-processed (see the
// Round 209 section at the media pipeline). '' = not yet
// evaluated.
try { db.exec("ALTER TABLE highlights ADD COLUMN r209_checked_at TEXT DEFAULT ''"); } catch {}
// Round 213 (2026-11-26): the smart-poster robustness
// pass's per-play stamp — set (together with
// r209_checked_at, in the same write) when the Round 209
// stage has evaluated a play under the Round 213 rules.
// The boot backfill selects on EITHER stamp being empty,
// so a play evaluated under the original Round 209 rules
// (r209 stamped, r213 empty) is re-evaluated exactly
// once under the new rules, and a play evaluated under
// Round 213 is never re-processed. '' = not yet
// evaluated under Round 213.
try { db.exec("ALTER TABLE highlights ADD COLUMN r213_checked_at TEXT DEFAULT ''"); } catch {}
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
// Round 208 (2026-11-26): the column default for a fresh DB flips
// to 'back' with the studio/server defaults (existing DBs already
// carry the column; every insert names the side explicitly anyway).
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN side TEXT DEFAULT 'back'"); } catch {}
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
// Back text (Round 197, 2026-11-25): what is embroidered across the
// back of the garment — the parent's choice at order time, from
// parent feedback Emil received with the first delivered sweatshirt:
// 'name' (the order's name — exactly the pre-R197 behavior),
// 'name_number' (the name plus the jersey number), 'none' (no back
// text at all), or 'custom' (the parent's own words, stored in
// back_text_custom). Added additively, same pattern; existing rows
// read 'name' with no data change. back_text_reviewed is the
// owner's read-it flag for custom lines: a custom order starts
// unreviewed (0) and the Owner view flags it until the owner marks
// it reviewed.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN back_text TEXT DEFAULT 'name'"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN back_text_custom TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN back_text_reviewed INTEGER DEFAULT 0"); } catch {}
// Design name mode + label (Round 218, 2026-11-26): the R197
// back-text choice became the print design's "Name on design"
// choice — the name now lives IN the artwork (the format's top
// line), not in an embroidered band. name_mode mirrors the
// order's back_text choice under its design name; design_label
// is the format's short label line (the play's moment label,
// parent-editable in the studio, sanitized to <=24 chars).
// Added additively, same pattern; older rows read ''.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN name_mode TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN design_label TEXT DEFAULT ''"); } catch {}
// Payment handoff (Round 200, 2026-11-26): the studio stays the
// order book; Shopify is the register. payment_status is '' for
// every pre-R200 row (the legacy request flow — the owner email
// fired at create and nothing about those rows changes); with the
// handoff on (HH_SHOPIFY_CHECKOUT=1) a new order starts
// 'awaiting_payment' and flips to 'paid' only when Shopify's
// signed orders/paid webhook lands, or 'refunded' on the refund
// webhook. paid_at stamps the flip; shopify_order_id carries
// Shopify's order id for reconciliation; paid_email_sent_at is
// the parent confirmation email's once-only guard (checked
// before the send, stamped after it resolves — the R188 rule).
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN payment_status TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN paid_at TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN shopify_order_id TEXT DEFAULT ''"); } catch {}
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN paid_email_sent_at TEXT DEFAULT ''"); } catch {}
// Round 206: avatar_generated marks an order whose print image
// IS a studio-generated AI avatar (the parent made it with the
// OpenAI-backed maker and chose it as the art) — as opposed to
// image_style='avatar' alone, which is the Round 38 request to
// illustrate at fulfillment. The owner email + Owner view read
// the two apart so a finished avatar is never re-illustrated.
try { db.exec("ALTER TABLE hype_frame_orders ADD COLUMN avatar_generated INTEGER DEFAULT 0"); } catch {}
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

// Round 152: ownerIdentity152 is the one place owner auth is
// decided. It returns null for no/bad credentials, { actor:
// "owner" } for the main token (env OWNER_TOKEN, else the
// claimed owner_token_hash — the exact pre-152 rule, including
// env taking precedence over the stored hash), and { actor:
// <name>, tokenId } for a named passcode from owner_tokens.
// ownerAuthorized keeps its boolean shape for every existing
// call site; ownerActor152 hands the moderation-log call sites
// the actor string for THIS request ('owner' when anonymous —
// those sites only run after a successful auth check anyway).
function ownerIdentity152(req) {
  const token = req.headers["x-owner-token"];
  if (!token) return null;
  const presented152 = sha(token);
  if (process.env.OWNER_TOKEN) {
    if (presented152 === sha(process.env.OWNER_TOKEN)) return { actor: "owner", tokenId: null };
  } else {
    const stored = getSetting("owner_token_hash");
    if (stored && presented152 === stored) return { actor: "owner", tokenId: null };
  }
  // Named passcodes: the presented hash is compared against
  // every ACTIVE row's stored hash with timingSafeEqual (the
  // table is tiny — one row per person). A match stamps
  // last_used_at, throttled to once per ~5 minutes per token
  // so a busy panel session is not a write per request.
  let rows152 = [];
  try { rows152 = db.prepare("SELECT id, name, token_hash, last_used_at FROM owner_tokens WHERE revoked_at IS NULL").all(); } catch { rows152 = []; }
  const presentedBuf152 = Buffer.from(presented152, "hex");
  for (const r152 of rows152) {
    const storedBuf152 = Buffer.from(String(r152.token_hash || ""), "hex");
    if (storedBuf152.length === presentedBuf152.length && crypto.timingSafeEqual(storedBuf152, presentedBuf152)) {
      try {
        const lastMs152 = r152.last_used_at ? Date.parse(String(r152.last_used_at).replace(" ", "T") + "Z") : NaN;
        if (isNaN(lastMs152) || Date.now() - lastMs152 > 5 * 60 * 1000)
          db.prepare("UPDATE owner_tokens SET last_used_at=datetime('now') WHERE id=?").run(r152.id);
      } catch { /* a failed stamp never fails the auth */ }
      return { actor: String(r152.name || "owner"), tokenId: r152.id };
    }
  }
  return null;
}
function ownerAuthorized(req) {
  return !!ownerIdentity152(req);
}
function ownerActor152(req) {
  const id152 = ownerIdentity152(req);
  return id152 ? id152.actor : "owner";
}
// ---- Round 155: fast-lane helpers ----
// trustedGuardianFor155 is the lane lookup: an ACTIVE
// trusted_guardians row for this guardian email hash, or null.
// Hash-to-hash only — the caller passes the same
// sha(normIdentity(email)) the upload insert stores as
// notify_email_hash, so panel-added and upload-side spellings
// of one address (case, stray whitespace) meet on one hash.
// Fail-closed: any error reads as "not trusted".
function trustedGuardianFor155(emailHash) {
  if (!emailHash) return null;
  try { return db.prepare("SELECT id, label FROM trusted_guardians WHERE email_hash=? AND revoked_at IS NULL").get(emailHash) || null; } catch { return null; }
}
// aiGateBlocksLane155 mirrors the Upload Assist gate's own
// stop rule (Round 99, app.js): the browser holds a submit
// whose verdict is a CONFIDENT not_a_play (confidence >= 0.85);
// the guardian's override of exactly that verdict re-files the
// upload FOR OWNER REVIEW, with the sanitized gate recorded
// as "override". Both shapes are gate-stopped uploads, and a
// gate stop is never rescued by the fast lane — the play
// inserts pending for a human, exactly as it did pre-155. Any
// other verdict (play / unsure / low-confidence / no verdict
// at all — the assist is inert without an API key) leaves the
// lane decision to the allowlist alone.
function aiGateBlocksLane155(aiJson) {
  if (!aiJson) return false;
  let v155 = null;
  try { v155 = JSON.parse(aiJson); } catch { return false; }
  if (!v155 || typeof v155 !== "object") return false;
  return (v155.gate === "not_a_play" || v155.gate === "override") && Number(v155.confidence) >= 0.85;
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
// ---- Round 182 (2026-11-14): contest integrity rules ----
// Emil decided ("Adopt all three") after the 2026-11-14 fairness
// review verified in this code that a repeat winner was possible:
// (1) a play can win Hype of the Month ONCE — once it stands in
// contest_winners for any period it is retired and can never be
// entered again (the play itself is untouched: it stays on the
// board, votable, frameable — only the contest door closes);
// (2) the winning ATHLETE sits out the next month — none of
// their plays (athlete_id, the stable identity, never the name
// string) can be entered in the month right after their win;
// the board is never blocked, only the contest, and they are
// fully eligible again the month after; (3) same clip = same
// play — the upload dedupe (Round 145) extends from its
// 30-minute retry window to all time against LIVE plays (see
// the upload handler). The source of truth for (1) and (2) is
// the contest_winners table the winner endpoint writes and
// /api/contest reads — no new tables, no migration: with the
// table empty (November 2026 has no finalized winner yet) every
// check below simply answers "no block".
function prevPeriod182(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ""));
  if (!m) return "";
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
// The athlete_id of the play that won `period` (null when the
// period has no recorded winner, or its play is gone).
function contestWinnerAthlete182(period) {
  if (!period) return null;
  const w = db.prepare("SELECT highlight_id FROM contest_winners WHERE period=?").get(period);
  if (!w) return null;
  const row = db.prepare("SELECT athlete_id FROM highlights WHERE id=?").get(w.highlight_id);
  return row ? (row.athlete_id || null) : null;
}
function contestRetired182(playId) {
  return !!db.prepare("SELECT 1 FROM contest_winners WHERE highlight_id=?").get(playId);
}
function contestSitOutFor182(row, period) {
  if (!row || !row.athlete_id) return false;
  const winnerAthlete = contestWinnerAthlete182(prevPeriod182(period));
  return !!winnerAthlete && row.athlete_id === winnerAthlete;
}
// contestBlock182(row, period) -> null when the play may enter
// `period`, else { reason, message } with the guardian-facing
// words (the client renders the same states from the payload
// flags). Retired is checked first: a past winner is retired in
// every month, its sit-out month included. Every entry path —
// auto-entry on approval, the manual enter endpoint, the
// one-time retro-entry — consults this one function.
function contestBlock182(row, period) {
  if (!row) return null;
  if (contestRetired182(row.id))
    return { reason: "retired", message: "This play already won Hype of the Month — winning plays retire to the Hall of Fame and can't enter again." };
  if (contestSitOutFor182(row, period))
    return { reason: "sitout", message: "Champions sit out this month after a win — this athlete won last month, so their plays sit this one out and are back next month." };
  return null;
}
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
// →182: a fifth guard rides inside — the Round 182 integrity
// rules (retired winner / athlete sit-out) skip the entry while
// leaving the approval itself untouched.
function autoEnterOnApproval130(row) {
  if (!row || row.status !== "approved" || row.is_sample || !row.contest_optin) return false;
  const period = currentPeriod();
  if (db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(row.id, period)) return false;
  // Round 182: the integrity rules gate auto-entry too — a
  // retired play, or a play whose athlete is sitting this month
  // out, is silently SKIPPED: the play still approves and posts
  // to the board exactly as before; only the contest entry is
  // withheld, and the log line says why.
  const block182 = contestBlock182(row, period);
  if (block182) { console.log(`[r182] auto-entry skipped for play ${row.id} into ${period}: ${block182.reason} (Round 182 contest integrity)`); return false; }
  db.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(row.id, period);
  console.log(`[r130] auto-entered play ${row.id} into Hype of the Month ${period} on approval (upload opt-in)`);
  return true;
}
// ---- Round 164 (2026-11-14): guardian trending nudges ----
// When an entered play climbs, its GUARDIAN (highlights.notify_
// email — never the athlete, never anyone else) hears about it:
// TOOK #1, ENTERED TOP 3, and Emil's month-end RALLY in the
// final 3 ET calendar days of the contest month. Detection is
// deliberately boring: NO daemon, NO cron. Standings only move
// when votes land, so transitions are evaluated on the vote
// path (evaluateNudges164 after every recorded vote toggle),
// and the rally rides a lazy check on the vote path + the
// contest read path (maybeSendRally164). State lives in three
// tables: nudge_log (what was actually handed to the mailer),
// nudge_state (per play+period zone membership, fall-out stamps
// and the daily-cap day), nudge_optouts (email hashes that have
// unsubscribed from TRENDING mail — approval/transactional mail
// is never gated by it). Trigger rules: a milestone fires at
// most once per play per period; falling out of the zone and
// re-entering >= 24h later may fire it once more; a hard cap of
// ONE trigger email per play per day sits above both kinds; a
// play needs at least one vote to hold a nudge rank at all
// (a 0-vote play is never "trending"). Samples, phone-only
// guardians and non-approved plays can never nudge — the
// standings query below is the same one /api/contest serves
// (approved, non-sample, votes desc then id asc), reused so
// there is exactly ONE ranking in the codebase.
db.exec(`CREATE TABLE IF NOT EXISTS nudge_log(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  play_id INTEGER NOT NULL, period TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT '', rank_at_send INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS nudge_state(
  play_id INTEGER NOT NULL, period TEXT NOT NULL DEFAULT '',
  in_first INTEGER NOT NULL DEFAULT 0, in_top3 INTEGER NOT NULL DEFAULT 0,
  first_out_at TEXT, top3_out_at TEXT, last_trigger_day TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(play_id, period)
);
CREATE TABLE IF NOT EXISTS nudge_optouts(
  email_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`);
// Test seam: EVERY nudge decision reads "now" through here. A
// settings row (nudge_now_override164, an ISO string) pins the
// clock so the suites can stand at the rally window's edges and
// 24h past a fall-out. The row is never set in prod.
function now164() {
  const o = getSetting("nudge_now_override164");
  if (o) { const d = new Date(o); if (!isNaN(d)) return d; }
  return new Date();
}
function period164() { return now164().toISOString().slice(0, 7); } // YYYY-MM, the contest's own clock (currentPeriod is this, unpinned)
function etDay164(d) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(d);
  const g = (t) => (parts.find((x) => x.type === t) || {}).value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
// UTC ms of ET midnight starting the ET date y-m-d (two-pass
// offset resolution; midnight never sits inside a DST jump).
function etOffsetMs164(t) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t));
  const g = (t) => Number((parts.find((x) => x.type === t) || {}).value || 0);
  return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour") % 24, g("minute"), g("second")) - Math.floor(t / 1000) * 1000;
}
function etMidnightUtc164(y, m, d) { const base = Date.UTC(y, m - 1, d); return base - etOffsetMs164(base - etOffsetMs164(base)); }
const MONTH_NAMES164 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function rallyWindow164(period) {
  const [y, m] = String(period || "").split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { opens: `${period}-${String(lastDay - 2).padStart(2, "0")}`, lastDay, endsLabel: `${MONTH_NAMES164[m - 1] || ""} ${lastDay}` };
}
// The contest standings, exactly as GET /api/contest computes
// them (same query, same monthlyVoteCount, same sort) with a
// 1-based rank attached. One ranking, two readers.
function contestStandings164(period) {
  const rows = db.prepare(`SELECT h.* FROM contest_entries e JOIN highlights h ON h.id=e.highlight_id
    WHERE e.period=? AND h.status='approved' AND COALESCE(h.is_sample,0)=0`).all(period);
  const out = rows.map((r) => ({ row: r, votes: monthlyVoteCount(r.id, period), rank: 0 }));
  out.sort((a, b) => b.votes - a.votes || a.row.id - b.row.id);
  out.forEach((e, i) => { e.rank = i + 1; });
  return out;
}
const nudgeEmailHash164 = (row) => sha(normIdentity((row && row.notify_email) || ""));
const nudgeOptedOut164 = (emailHash) => !!emailHash && !!db.prepare("SELECT 1 FROM nudge_optouts WHERE email_hash=?").get(emailHash);
const firstName164 = (row) => String((row && row.player_name) || "").trim().split(/\s+/)[0] || "Your athlete";
// Unsubscribe tokens: HMAC-SHA256 keyed by a server secret —
// first choice the dedicated NUDGE_SECRET, else the secrets
// already in the server env (BACKUP_TOKEN in prod, then
// MODERATE_TOKEN / OWNER_TOKEN), else a settings-stored random
// secret minted once (the moderateToken pattern). The key never
// leaves the server, so a token cannot be forged from the email
// hash it travels beside; rotating the env secret retires every
// outstanding link, which for an unsubscribe is acceptable.
function nudgeSecret164() {
  const env = process.env.NUDGE_SECRET || process.env.BACKUP_TOKEN || process.env.MODERATE_TOKEN || process.env.OWNER_TOKEN;
  if (env) return String(env);
  let s = getSetting("nudge_secret164");
  if (!s) { s = crypto.randomBytes(32).toString("hex"); setSetting("nudge_secret164", s); }
  return s;
}
function nudgeUnsubToken164(emailHash) {
  return crypto.createHmac("sha256", nudgeSecret164()).update("hh-nudge-unsub:" + emailHash).digest("hex").slice(0, 32);
}
function nudgeUnsubUrl164(emailHash) {
  return `https://highlighthype.com/api/nudge/unsubscribe?e=${emailHash}&t=${nudgeUnsubToken164(emailHash)}`;
}
// One nudge send. Mirrors notifyApproved's discipline: silent
// no-op (returns false, logs NOTHING) when SMTP is unconfigured
// or the play has no guardian email — so a "sent" row in
// nudge_log always means the mailer actually took the message.
// Fire-and-forget like every house mailer; failures are logged
// by the .catch and can never reach the vote path.
function sendNudge164(row, kind, rank, votes, period, extra) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  const to = row && row.notify_email;
  if (!user || !pass || !to) return false;
  const first = firstName164(row);
  const link = `https://highlighthype.com/#play-${row.id}`;
  let subject, body;
  if (kind === "first") {
    subject = `🏆 ${first} is #1 in Hype of the Month!`;
    body = `${first}'s play "${row.title}" just took the #1 spot in Hype of the Month — ${votes} vote${votes === 1 ? "" : "s"} and counting.\n\nSee it here: ${link}\n\nWant to keep it there? Share the link with friends and family and ask them to vote.\n`;
  } else if (kind === "top3") {
    subject = `🏆 ${first} just hit the Top 3 in Hype of the Month`;
    body = `${first}'s play "${row.title}" just climbed to #${rank} in Hype of the Month — ${votes} vote${votes === 1 ? "" : "s"} so far.\n\nSee it here: ${link}\n\nA few more votes could take it to #1 — share the link and ask friends and family to vote.\n`;
  } else { // rally
    const ex = extra || {};
    subject = `Final push: ${first} is #${rank} — voting ends ${ex.endsLabel || "soon"}`;
    body = `${first}'s play "${row.title}" is #${rank} in Hype of the Month with ${votes} vote${votes === 1 ? "" : "s"} — and voting ends ${ex.endsLabel || "at month's end"} (${ex.timeLeft || "almost out of time"}).\n\nThis is the final push. Share ${first}'s link and ask for votes:\n\n${link}\n\nReady-to-post text you can copy:\n"${first} is #${rank} in Hype of the Month! 🏆 Watch the play and vote here: ${link}"\n\nThe winner is featured on the HighlightHype homepage — and earns some serious bragging rights.\n`;
  }
  body += `\n—\nYou're getting this because ${first}'s play is entered in Hype of the Month. Don't want trending updates? Unsubscribe here: ${nudgeUnsubUrl164(nudgeEmailHash164(row))}\n(Approval emails for your plays will still arrive.)\n`;
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to, subject, body })
    .catch((e) => console.error("sendNudge164 failed:", e.message));
  db.prepare("INSERT INTO nudge_log(play_id, period, kind, rank_at_send, sent_at) VALUES(?,?,?,?,?)").run(row.id, period, kind, rank, now164().toISOString());
  return true;
}
// Transition evaluation, called from the vote path after every
// recorded vote toggle (standings can move on an un-vote too).
// Phase 1 stamps fall-outs for every tracked play this period;
// phase 2 walks the standings in rank order and fires entries.
function evaluateNudges164(period) {
  try {
    period = period || period164();
    const now = now164();
    const nowIso = now.toISOString();
    const today = etDay164(now);
    const standings = contestStandings164(period);
    const rankOf = new Map(standings.map((e) => [e.row.id, e]));
    const hoursSince164 = (iso) => { if (!iso) return Infinity; const t = new Date(iso).getTime(); return isNaN(t) ? Infinity : (now.getTime() - t) / 36e5; };
    for (const st of db.prepare("SELECT * FROM nudge_state WHERE period=?").all(period)) {
      const e = rankOf.get(st.play_id);
      const inFirst = !!(e && e.votes >= 1 && e.rank === 1), inTop3 = !!(e && e.votes >= 1 && e.rank <= 3);
      let f = st.in_first, t3 = st.in_top3, fo = st.first_out_at, to = st.top3_out_at;
      if (f && !inFirst) { f = 0; fo = nowIso; }
      if (t3 && !inTop3) { t3 = 0; to = nowIso; }
      if (f !== st.in_first || t3 !== st.in_top3 || fo !== st.first_out_at || to !== st.top3_out_at)
        db.prepare("UPDATE nudge_state SET in_first=?, in_top3=?, first_out_at=?, top3_out_at=? WHERE play_id=? AND period=?").run(f, t3, fo, to, st.play_id, period);
    }
    for (const e of standings) {
      if (e.votes < 1) continue; // a 0-vote play holds no nudge rank
      const row = e.row;
      let st = db.prepare("SELECT * FROM nudge_state WHERE play_id=? AND period=?").get(row.id, period);
      if (!st) { db.prepare("INSERT INTO nudge_state(play_id, period) VALUES(?,?)").run(row.id, period); st = { in_first: 0, in_top3: 0, first_out_at: null, top3_out_at: null, last_trigger_day: "" }; }
      const firstEntry = e.rank === 1 && !st.in_first;
      const top3Entry = e.rank <= 3 && !st.in_top3;
      if (!firstEntry && !top3Entry) continue;
      const canSend = !!row.notify_email && !nudgeOptedOut164(nudgeEmailHash164(row)) && st.last_trigger_day !== today;
      let sent = false;
      if (firstEntry && canSend) {
        const prior = db.prepare("SELECT 1 FROM nudge_log WHERE play_id=? AND period=? AND kind='first' LIMIT 1").get(row.id, period);
        // First time ever: fire. Again: only when the fall-out
        // that ended the last reign is at least 24h behind us.
        if (!prior || hoursSince164(st.first_out_at) >= 24) sent = sendNudge164(row, "first", e.rank, e.votes, period);
      }
      // Straight to #1 sends ONLY the #1 mail — the top3 branch
      // requires rank > 1, and the daily cap would stop a second
      // same-day send anyway.
      if (!sent && top3Entry && e.rank > 1 && canSend) {
        const prior = db.prepare("SELECT 1 FROM nudge_log WHERE play_id=? AND period=? AND kind='top3' LIMIT 1").get(row.id, period);
        if (!prior || hoursSince164(st.top3_out_at) >= 24) sent = sendNudge164(row, "top3", e.rank, e.votes, period);
      }
      // Zone membership updates whether or not a send happened
      // (opted-out, capped and 24h-held entries are all still
      // entries — the milestone doesn't re-fire tomorrow just
      // because today's send was suppressed).
      db.prepare("UPDATE nudge_state SET in_first=?, in_top3=?, last_trigger_day=? WHERE play_id=? AND period=?")
        .run(Math.max(st.in_first, e.rank === 1 ? 1 : 0), Math.max(st.in_top3, e.rank <= 3 ? 1 : 0), sent ? today : st.last_trigger_day, row.id, period);
    }
  } catch (err) { console.error("evaluateNudges164 failed:", err.message); }
}
// The month-end rally: during the final 3 ET calendar days of
// the contest month, ONE email per guardian featuring their
// highest-ranked entered approved play. Lazy + idempotent: the
// settings row rally_sent_<period> holds the guardian email
// hashes already mailed this period, so repeated evaluations
// (every contest read, every vote) re-send to nobody; a
// guardian whose first play is entered mid-window is picked up
// by the next evaluation. Opted-out guardians are skipped (and
// not recorded — the opt-out check is one indexed lookup).
function maybeSendRally164() {
  try {
    const now = now164();
    const period = period164();
    const win = rallyWindow164(period);
    const et = etDay164(now);
    if (et < win.opens || et.slice(0, 7) !== period) return; // outside the final-3-ET-days window
    const key = `rally_sent_${period}`;
    let sentArr = []; try { const parsed = JSON.parse(getSetting(key) || "[]"); if (Array.isArray(parsed)) sentArr = parsed; } catch {}
    const sentSet = new Set(sentArr);
    const [ny, nm] = period.split("-").map(Number);
    const endMs = nm === 12 ? etMidnightUtc164(ny + 1, 1, 1) : etMidnightUtc164(ny, nm + 1, 1);
    const hoursLeft = Math.max(0, Math.round((endMs - now.getTime()) / 36e5));
    const dLeft = Math.floor(hoursLeft / 24), hLeft = hoursLeft % 24;
    const timeLeft = dLeft >= 1 ? `${dLeft} day${dLeft === 1 ? "" : "s"} and ${hLeft} hour${hLeft === 1 ? "" : "s"} left` : `about ${hoursLeft} hour${hoursLeft === 1 ? "" : "s"} left`;
    let changed = false;
    const seen = new Set();
    for (const e of contestStandings164(period)) { // rank order: a guardian's FIRST row here is their highest-ranked play
      const row = e.row;
      if (!row.notify_email) continue;
      const h = nudgeEmailHash164(row);
      if (seen.has(h)) continue;
      seen.add(h);
      if (sentSet.has(h) || nudgeOptedOut164(h)) continue;
      if (sendNudge164(row, "rally", e.rank, e.votes, period, { endsLabel: win.endsLabel, timeLeft })) { sentSet.add(h); changed = true; }
    }
    if (changed) setSetting(key, JSON.stringify([...sentSet]));
  } catch (err) { console.error("maybeSendRally164 failed:", err.message); }
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
// Round 200: with { paid: true } this is the PRODUCTION notification,
// fired by the Shopify orders/paid webhook instead of at create —
// the same order detail, with a clear PAID marker and the Shopify
// order id, so the owner can reconcile the two systems at a glance.
function notifyHypeFrameRequest(order, play, opts = {}) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return;
  const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
  const paid200 = !!opts.paid;
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
    subject: paid200 ? `HighlightHype: Hype Frame order PAID — ${play.title}` : `HighlightHype: new Hype Frame request — ${play.title}`,
    body: `${paid200 ? `PAYMENT CONFIRMED on Shopify — this Hype Frame order is PAID and cleared for production.\nShopify order: ${order.shopify_order_id || "—"} · Site order #${order.id}` : "A family just submitted a Hype Frame order request on highlighthype.com."}\n\nPlay: ${play.title} (Play ID: ${play.id})\nPrint name: ${order.custom_name || "—"}${order.jersey ? ` · #${order.jersey}` : ""}\nBack text: ${hfBackTextToEmbroider197(order) || "NO BACK TEXT"}${order.back_text === "custom" ? " (custom words — review before production)" : ""}\nDesign (Round 218 format): name mode ${order.name_mode || order.back_text || "name"} · label "${order.design_label || ""}" — the name rides IN the print artwork now, not as separate embroidery\nHYPE FRAME branding: ${order.branding ? "yes" : "no"}\nApparel: ${order.apparel} · ${order.colorway} · Size: ${order.size || "YM"} · Print side: ${order.side === "front" ? "Front" : "Back"} · Image: ${order.image_style === "avatar" ? (order.avatar_generated ? "AI avatar — generated in the studio (OpenAI); the print image on file IS the finished avatar, no illustration step needed. The design sits on a black background — production knocks the black out for the DTF print (transparent), the same as the shop's transparent test files" : "Avatar — illustrate the frame before printing") : "Real photo"}\n${(() => { try { const p = JSON.parse(order.placement || ""); return p ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size\n` : ""; } catch { return ""; } })()}Parent/guardian: ${order.guardian_name ? order.guardian_name + " — " : ""}${order.guardian_email}\nStatus: ${paid200 ? "PAID — payment confirmed via Shopify; cleared for production." : "pending-guardian — nothing is printed until you confirm with the parent/guardian."}\n${order.print_image ? "Print image: on file — use Download print image on the request in Owner view." : "Print image: NOT on file for this request — the order was saved without one."}\n\nSee the request in Owner view: https://highlighthype.com/#owner\n` })
    .catch((e) => console.error("notifyHypeFrameRequest failed:", e.message));
}
// ---- Round 200: Shopify payment handoff helpers ----
// The variant map for the Hype Frame product (Shopify product
// 15536451584213, every variant $110 — the price lives ONLY in
// Shopify; the site never passes one). Keys are the studio's ten
// sizes (Round 199), 1:1 with the product's variants.
// Round 226 (2026-11-27, Emil): YXXS is cut catalog-wide — its
// entry leaves this map, so a YXXS order can never resolve a
// checkout variant. The Shopify-side variant itself is Emil's
// separate admin step; historical orders are untouched.
const HF_VARIANTS_200 = {
  YXS: "68266140860629", YS: "68266140893397",
  YM: "68266140926165", YL: "68266140958933", YXL: "68266140991701",
  S: "68717544734933", M: "68717544767701", L: "68717544800469", XL: "68717544833237",
};
const hfShopifyCheckoutOn200 = () => process.env.HH_SHOPIFY_CHECKOUT === "1";
// The readable one-line order summary that rides the Shopify cart
// (and lands on the Shopify order) so a human can match the two
// systems without opening the site. The back-text segment reuses
// the R197 derivation — the exact words to embroider.
function hfSummary200(order, play) {
  const back = hfBackTextToEmbroider197(order);
  return `${play.title} — ${order.custom_name || "No name"} · Size ${order.size || "YM"} · ${order.colorway} · Back: ${back || "No back text"}`;
}
// Cart permalink for the order's size variant, quantity 1. The
// site order id rides TWICE: as a line-item property (shows on
// the Shopify order's line, the primary match key) and as a cart
// attribute (surfaces as the order's note_attributes — the
// fallback match key if a theme/checkout drops line properties).
function hfCheckoutUrl200(order, play) {
  const domain = String(process.env.HH_SHOP_DOMAIN || "shop.highlighthype.com").replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const variant = HF_VARIANTS_200[String(order.size || "YM").toUpperCase()] || HF_VARIANTS_200.YM;
  const q = [
    `attributes[${encodeURIComponent("HH Order #")}]=${encodeURIComponent(String(order.id))}`,
    `properties[${encodeURIComponent("HH Order #")}]=${encodeURIComponent(String(order.id))}`,
    `properties[Summary]=${encodeURIComponent(hfSummary200(order, play))}`,
  ].join("&");
  return `https://${domain}/cart/${variant}:1?${q}`;
}
// Owner alert for handoff anomalies (unmatched payments, refunds,
// payments against legacy rows): plain house mail to the owner
// address, silent no-op without SMTP, never throws.
function notifyOwnerAlert200(subject, body) {
  const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
  if (!user || !pass) return;
  const to = process.env.NOTIFY_TO || "hello@highlighthype.com";
  smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
    subject, body: `${body}\n\nOwner view: https://highlighthype.com/#owner\n` })
    .catch((e) => console.error("notifyOwnerAlert200 failed:", e.message));
}
function hfPaidConfirmText200({ greeting, orderId, title, size, colorway, backText }) {
  return `Payment confirmed — your Hype Frame is in production\n\nHi ${greeting},\n\nGreat news: your payment is confirmed, and your Hype Frame is now in production.\n\nOrder #${orderId}\nPlay: ${title}\nSize: ${size} · Color: ${colorway}\nBack text: ${backText || "No back text"}\n\nEvery Hype Frame hoodie is made to order on Long Island, NY. Made to order — ships in 5–7 business days. You'll get a tracking email when it ships.\n\nQuestions about your order? Email hello@highlighthype.com.\n\n— The HighlightHype Family\nhighlighthype.com\n\nAthletes — Strength — Memories — Motivation\nWe believe every young athlete should be celebrated.\n`;
}
function hfPaidConfirmHtml200({ greeting, orderId, title, size, colorway, backText }) {
  const g = escHtml(greeting), t = escHtml(title), s = escHtml(size), c = escHtml(colorway), b = escHtml(backText || "No back text");
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HighlightHype — Payment confirmed</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0a0a0a;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:600px;max-width:600px;background:#0a0a0a;">
  <tr><td style="background:#0a0a0a;padding:30px 40px 6px;text-align:center;">
    <img src="https://highlighthype.com/logo-header-gold.png" width="340" alt="HighlightHype" style="display:block;margin:0 auto;width:340px;max-width:85%;height:auto;">
    <div style="font-size:10.5px;letter-spacing:.3em;color:#B39B63;text-transform:uppercase;margin-top:7px;font-family:Arial,Helvetica,sans-serif;">Athletes — Strength — Memories — Motivation</div>
  </td></tr>
  <tr><td style="padding:18px 40px 0;"><div style="border-top:1px solid #2a2517;font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr><td style="padding:22px 40px 0;color:#e8e8e8;font-size:16px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-family:'Arial Narrow',Arial,sans-serif;font-size:25px;font-weight:bold;text-transform:uppercase;letter-spacing:.03em;color:#ffffff;line-height:1.2;">Payment confirmed</div>
    <p style="margin:14px 0 0;">Hi ${g},</p>
    <p style="margin:12px 0 0;">Great news: your payment is confirmed, and your Hype Frame is now in production.</p>
  </td></tr>
  <tr><td style="padding:22px 40px 0;">
    <div style="border:1px solid #2a2517;border-radius:12px;background:#141414;padding:18px 22px;color:#e8e8e8;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;">
      <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#B39B63;font-weight:bold;">Order #${orderId}</div>
      <div style="margin-top:8px;">Play: <b style="color:#ffffff;">${t}</b></div>
      <div>Size: ${s} · Color: ${c}</div>
      <div>Back text: ${b}</div>
    </div>
  </td></tr>
  <tr><td style="padding:22px 40px 0;color:#e8e8e8;font-size:15.5px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
    <p style="margin:0;">Every Hype Frame hoodie is made to order on Long Island, NY. <b style="color:#ffffff;">Made to order — ships in 5–7 business days.</b> You'll get a tracking email when it ships.</p>
    <p style="margin:14px 0 0;">Questions about your order? Email <a href="mailto:hello@highlighthype.com" style="color:#e8cf8f;">hello@highlighthype.com</a>.</p>
    <p style="margin:14px 0 0;color:#ffffff;">— The HighlightHype Family<br><span style="font-size:13px;color:#9a958a;">highlighthype.com</span></p>
  </td></tr>
  <tr><td style="padding:26px 40px 30px;">
    <div style="border-top:1px solid #2a2517;padding-top:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:10.5px;letter-spacing:.26em;color:#B39B63;text-transform:uppercase;">Athletes — Strength — Memories — Motivation</div>
      <div style="font-size:12px;color:#8a857a;line-height:1.6;margin-top:10px;">
        We believe every young athlete should be celebrated.<br>
        HighlightHype · hello@highlighthype.com · <a href="https://highlighthype.com" style="color:#8a857a;">highlighthype.com</a>
      </div>
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
// The parent's payment-confirmed email. Fire-and-forget from the
// webhook: a mail failure can never fail the webhook, and the
// paid_email_sent_at guard (checked before, stamped only after
// smtpSend resolves — the R188 discipline) means it can only
// ever be sent once per order, even across webhook re-deliveries.
async function notifyHfPaymentConfirmed200(order, play) {
  try {
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) return; // mailer unconfigured — silent no-op, the house rule
    const fresh = db.prepare("SELECT paid_email_sent_at FROM hype_frame_orders WHERE id=?").get(order.id);
    if (!fresh || fresh.paid_email_sent_at) return; // already sent — never twice
    const to = String(order.guardian_email || "").trim();
    if (!to) return;
    const merges = {
      greeting: String(order.guardian_name || "").trim().split(/\s+/)[0] || "there",
      orderId: order.id,
      title: String(play.title || "").trim() || "Your play",
      size: order.size || "YM",
      colorway: order.colorway || "",
      backText: hfBackTextToEmbroider197(order),
    };
    await smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
      subject: `Payment confirmed — your Hype Frame is in production (order #${order.id})`,
      body: hfPaidConfirmText200(merges), html: hfPaidConfirmHtml200(merges) });
    db.prepare("UPDATE hype_frame_orders SET paid_email_sent_at=? WHERE id=?").run(new Date().toISOString(), order.id);
  } catch (e) {
    console.error("notifyHfPaymentConfirmed200 failed:", e.message);
  }
}
// The site order id a Shopify payload points at: the line-item
// property "HH Order #" first (it is set per line), then the cart
// attribute of the same name (order.note_attributes). Null when
// the payload carries neither — an order placed straight off the
// Shopify product page, with no studio order behind it.
function hfShopifyOrderRef200(payload) {
  const fromProps = (items) => {
    for (const li of Array.isArray(items) ? items : []) {
      for (const pr of Array.isArray(li && li.properties) ? li.properties : []) {
        if (pr && pr.name === "HH Order #" && Number.isInteger(Number(pr.value)) && Number(pr.value) > 0) return Number(pr.value);
      }
    }
    return null;
  };
  const byLine = fromProps(payload && payload.line_items);
  if (byLine) return byLine;
  for (const na of Array.isArray(payload && payload.note_attributes) ? payload.note_attributes : []) {
    if (na && na.name === "HH Order #" && Number.isInteger(Number(na.value)) && Number(na.value) > 0) return Number(na.value);
  }
  return null;
}
// ---- Round 197: Hype Frame back text ----
// The exact string the embroiderer stitches across the back of the
// garment, derived from the order's stored choice. "" means there is
// NO back text (the 'none' choice, or a name choice with no name on
// file). Name typography follows the flow's existing form: the name
// as entered, the number as " · #N" (the owner view's Print line).
function hfBackTextToEmbroider197(o) {
  const choice = String((o && o.back_text) || "name");
  if (choice === "none") return "";
  if (choice === "custom") return String(o.back_text_custom || "").trim();
  const name = String(o.custom_name || "").trim();
  if (!name) return "";
  if (choice === "name_number") {
    const digits = String(o.jersey || "").replace(/\D/g, "");
    return digits ? `${name} · #${digits}` : name;
  }
  return name;
}
// Custom back words: up to 16 characters of letters, numbers, spaces
// and basic punctuation — the embroidery constraint (no emoji, no
// symbols, no control characters; the character class itself
// excludes them). Returns a plain-language problem, or "" when the
// line is stitchable. The studio runs the same check client-side;
// this is the enforcing copy.
const HF_CUSTOM_TEXT_RE197 = /^[\p{L}\p{N} .,'&#!-]+$/u;
function hfCustomTextError197(raw) {
  const t = String(raw || "").trim();
  if (!t) return "Write the words you'd like on the back — or pick one of the other back-text options.";
  if (t.length > 16) return "Custom words are limited to 16 characters — the embroidery space across the back is tight.";
  if (!HF_CUSTOM_TEXT_RE197.test(t)) return "Custom words can use letters, numbers, spaces and basic punctuation only — embroidery can't stitch emoji or other symbols.";
  return "";
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
// Round 151: the same play_open sums for a whole payload in ONE
// grouped query — a Map of play id (number) -> all-time opens.
// The list endpoints (board, contest) build this once and hand
// it to publicHighlight, so a 30-play board costs one stat query
// instead of thirty. Single-play call sites keep playViews105.
function playViewCounts151() {
  const m = new Map();
  for (const r of db.prepare("SELECT key, SUM(count) c FROM stat_events WHERE kind='play_open' GROUP BY key").all()) m.set(Number(r.key), r.c);
  return m;
}
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

/* ---- Round 162 (2026-11-14): milestone tags + the Moment
   That Mattered spotlight (Emil picked the A+B design) --------
   The kinds and their labels are single-sourced HERE (the
   client carries its own copy for rendering, as with the
   Round 100 badges). big_play is a tag like any other, but it
   is NOT part of the board's Firsts & Milestones lane — that
   lane is the heart kinds only (MOMENT_HEART162), enforced
   client-side in the board filter; the server just stores. */
const MOMENT_KINDS162 = ["first", "personal_best", "comeback", "big_play", "effort"];
const MOMENT_LABELS162 = { first: "🌟 First Ever", personal_best: "📈 Personal Best", comeback: "💪 Comeback", big_play: "🔥 Big Play", effort: "❤️ Great Effort" };
const MOMENT_HEART162 = ["first", "personal_best", "comeback", "effort"];
/* The one validator for the tag, used by the upload insert and
   the owner's retro-tag endpoint: an allowlist value (any case,
   stray spaces forgiven) or NULL — junk never reaches the
   column, mirroring the division parse at upload. */
const momentKind162 = (v) => { const k = String(v == null ? "" : v).trim().toLowerCase(); return MOMENT_KINDS162.includes(k) ? k : null; };
/* The spotlight pick lives in settings as one JSON value —
   { play_id, set_at, set_by } — the same single-row pattern as
   the moderate token. Read fresh on every call: the public
   endpoint and the panel can never disagree about the pick. */
const SPOTLIGHT_KEY162 = "moment_spotlight162";
function getSpotlight162() {
  try { const j = JSON.parse(getSetting(SPOTLIGHT_KEY162) || "null"); return j && Number(j.play_id) ? { play_id: Number(j.play_id), set_at: j.set_at || "", set_by: j.set_by || "" } : null; } catch { return null; }
}

function publicHighlight(row, voterToken = "", viewsMap151 = null) {
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
  // Round 151: the play's all-time watch count, computed ONCE
  // here and carried under both names — `views` (Round 105's My
  // Highlights numbers) and `viewCount` (Round 151's public
  // surfaces: board tiles, the watch view, the Month rows). List
  // endpoints pass the grouped map (playViewCounts151); other
  // call sites fall back to the single-play sum. Same counter
  // either way — the stat_events 'play_open' rows POST /api/track
  // already records when a play is opened.
  const views151 = viewsMap151 ? (viewsMap151.get(row.id) || 0) : playViews105(row.id);
  // Round 182: the contest-integrity states for THIS play,
  // computed from the same contest_winners table /api/contest
  // reads — contestRetired (this play has won a month, ever)
  // and contestSitOut (this play's athlete won last month, so
  // their plays sit the current month out). Booleans only, and
  // nothing private: a month's winner is already public on the
  // Month board. The client renders both as informational
  // states in place of the Enter control.
  const retired182 = contestRetired182(row.id);
  const sitOut182 = contestSitOutFor182(row, currentPeriod());
  // Round 223: the smart poster's chosen moment, in seconds
  // into the clip — parsed from the Round 209/213 evaluation
  // the server already stores in enhance_json. null when no
  // poster was ever picked (photo plays, un-evaluated plays,
  // flat clips whose poster stands at the head). The watch
  // feed starts each clip at this moment instead of 0:00, so
  // a clip whose action sits seconds in no longer opens on
  // sky. Public and safe: a timestamp into the play's own
  // clip, nothing about the family.
  let posterTime223 = null;
  try {
    const ej223 = row.enhance_json ? JSON.parse(row.enhance_json) : null;
    const ct223 = ej223 && ej223.r209 ? Number(ej223.r209.chosenTime) : NaN;
    if (Number.isFinite(ct223) && ct223 > 0) posterTime223 = ct223;
    // Round 227: when no smart pick exists, fall back to the initial
    // grab's recorded frame time (enhance_json.r227time, written by
    // r124PosterFor at every poster creation). A real smart pick
    // always wins; the fallback is the same finite-and-positive rule,
    // and stays null when neither record knows the frame's time.
    if (posterTime223 === null) {
      const it227 = ej223 && ej223.r227time ? Number(ej223.r227time.t) : NaN;
      if (Number.isFinite(it227) && it227 > 0) posterTime223 = it227;
    }
  } catch { posterTime223 = null; }
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
    // Round 162: the milestone tag + its display label (null /
    // "" when untagged — pre-162 plays included). Public and
    // safe: the family picked the category themselves.
    moment_kind: row.moment_kind || null,
    moment_label: row.moment_kind ? (MOMENT_LABELS162[row.moment_kind] || "") : "",
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
    views: views151,
    viewCount: views151,
    battleWins: battleWins105(row.id),
    voteCount: voteCount(row.id),
    hasVoted: voterToken ? !!db.prepare("SELECT 1 FROM votes WHERE highlight_id=? AND voter_token=? AND (period IS NULL OR period=?)").get(row.id, voterToken, currentPeriod()) : false,
    // Round 182: see the computation above publicHighlight's return.
    contestRetired: retired182,
    contestSitOut: sitOut182,
    // Round 189: the attached licensed-track name for the watch
    // feed's music chip — '' on every play today (no library
    // exists yet; see the music_track migration note). Public
    // and safe: it is a track title, never guardian data.
    musicTrack: row.music_track || "",
    // Round 192: the streaming rendition URL for in-page
    // playback ('' when the play has none — clients fall back
    // to media_url). The HH_NO_STREAM192=1 kill switch serves
    // '' everywhere, which restores master-file playback
    // without touching a single row.
    stream_url: process.env.HH_NO_STREAM192 === "1" ? "" : (row.stream_url || ""),
    // Round 223: see the computation above publicHighlight's
    // return — the feed's start-at-the-poster-moment offset.
    poster_time: posterTime223,
  };
}
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".mp4": "video/mp4", ".webm": "video/webm", ".webmanifest": "application/manifest+json" };

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
/* ================= Round 224 (2026-11-27): upload pipeline repair — the iPhone .mov class =================
   WHY: the 2026-11-26 uploads review (hidden_files/
   uploads-review-2026-11-26.md) found that one file defeated
   the entire agent. Play 78 — an iPhone 17 Pro Max .mov —
   carries an undecodable timed-metadata stream that ffprobe
   types as AUDIO. Every transcode mapped "-map 0:a?", which
   selects ALL audio-typed streams, so ffmpeg aborted on the
   undecodable one ("Decoding requested, but no decoder found
   for: none") at every stage: no conversion, no enhance, no
   rendition, no poster re-pick — and the raw master, GPS tag
   and all, is what the site served. Four repairs:
   (1) THE MAP: every transcode now maps "-map 0:a:0?" —
   the first audio stream only, absence tolerated — at all
   six call sites (r124 convert, r192 rendition, r195
   encode, r203 encode, r186 strip remux, r186 encode). A
   clip's real audio is always its first audio stream;
   extra audio-typed metadata tracks are never selected
   again. The trailing "?" is load-bearing, not a typo:
   without it, a clip with NO audio stream hard-fails the
   map ("matches no streams") — the exact failure the
   Round 186 suite caught in this round's first pass.
   (2) DISPLAY DIMENSIONS: r124VideoInfo now also returns
   dispWidth/dispHeight — the coded dims swapped when the
   rotation is ±90/270. ffmpeg autorotates on decode, so
   every filter, fit and verification downstream works in
   DISPLAY space; feeding the stages coded dims would have
   given play 78 a 1280×720 rendition with its portrait
   players stretched flat (its correct fit is 404×720).
   width/height keep their coded meaning — stream-identity
   checks (the r186 strip remux's verify) still compare
   coded-to-coded.
   (3) METADATA BACKSTOP: when an upload's conversion and
   strip remux both fail, the settle in r124ProcessUpload
   logs a distinct [r224] METADATA EXPOSURE error — the
   served master still carries location-capable tags, and
   silence is how play 78's GPS tag shipped. The recovery
   scan below applies the same ladder (convert → strip →
   loud log) to plays already in that state. File-level
   only: a play is never held or unpublished over this.
   (4) RECOVERY + VISIBILITY: r224Backfill (boot, ahead of
   the other scans) finds file plays with no stream
   rendition whose master is still non-compliant or still
   carries strippable tags, converts them in place exactly
   as the upload path does, and clears the r195/r203/
   r209/r213 stamps a conversion makes stale, so the
   existing backfills re-run their stages against the
   healed file — poster re-pick included (the r213 stamp
   alone would otherwise block it forever). The Round 209
   backfill likewise treats a rendition-less play whose
   master still probes non-compliant as not-yet-processed
   for poster purposes. And the owner queue now flags a
   file play that has been rendition-less for over 24h
   (missing_rendition), so the next deterministic failure
   is a same-day fix, not a chance discovery in the logs.
   FALLBACK CONTRACT (the house rule, unchanged):
   best-effort, never a gate — every step verifies before
   it swaps, any failure keeps the current display file,
   and the existing library's processed plays are never
   touched (the recovery selects only the un-processed
   state and skips anything compliant). */
function r124VideoInfo(probe) {
  if (!probe || !Array.isArray(probe.streams)) return null;
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (!v) return null;
  let rotation = 0;
  if (Array.isArray(v.side_data_list)) for (const sd of v.side_data_list) { if (sd && typeof sd.rotation === "number" && sd.rotation) rotation = sd.rotation; }
  if (v.tags && v.tags.rotate) rotation = Number(v.tags.rotate) || rotation;
  const duration = Number(probe.format && probe.format.duration) || Number(v.duration) || 0;
  const width = v.width || 0, height = v.height || 0;
  // Round 224: display dimensions — swapped when the frame
  // is stored sideways (±90/270). See the banner above.
  const swapped224 = Math.abs(rotation % 180) === 90;
  return { codec: v.codec_name || "", pixFmt: v.pix_fmt || "", width, height, dispWidth: swapped224 ? height : width, dispHeight: swapped224 ? width : height, rotation, duration };
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
  // Round 186: "-map_metadata -1" — the encode writes NO global
  // metadata. Phone originals carry GPS/location tags there, and
  // this is a kids' platform: no display file may keep them (the
  // metadata half of Round 186; see r186StripRemux for the
  // passthrough case and the Round 186 banner for the whole rule).
  const args = ["-y", "-i", inFile, "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1",
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
  const at227 = r124FreezeAt(id, info ? info.duration : 0);
  if (await r124MakePoster(bins, absFile, path.join(UPLOAD_DIR, posterName), at227)) {
    db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/${posterName}`, id);
    // Round 227 (workstream 2): record the frame time this poster was
    // grabbed from, so R223's feed seek (publicHighlight poster_time)
    // has a truthful value from the very first poster. Deliberately a
    // SEPARATE field (enhance_json.r227time), never r209.chosenTime:
    // r209StoreEval replaces the whole r209 record on every evaluation
    // (a kept-flat/kept-dark verdict would null a value written there),
    // and the r209/r213 *_checked_at stamp columns must stay unset
    // until the smart-poster stage has actually evaluated the play —
    // stamping them here would suppress a needed later re-pick.
    // publicHighlight falls back to r227time.t when no real smart pick
    // exists. Only a finite, positive seek time is recorded — an
    // unknown frame time is never fabricated.
    try {
      if (Number.isFinite(at227) && at227 > 0) {
        const row227 = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
        const obj227 = row227 && row227.enhance_json ? (JSON.parse(row227.enhance_json) || {}) : {};
        obj227.r227time = { t: Math.round(at227 * 1000) / 1000, origin: "initial", at: new Date().toISOString() };
        db.prepare("UPDATE highlights SET enhance_json=? WHERE id=?").run(JSON.stringify(obj227), id);
      }
    } catch (e227) { console.log("[r227] poster-time stamp failed for", id, e227 && e227.message); }
    return true;
  }
  return false;
}
// Upload path: probe the just-written file, transcode it in place
// if it is not already compliant (a renamed .mp4 replaces the
// original upload on disk; the row follows), then generate its
// poster. Any failure leaves the original untouched — the caller
// has already inserted the row and answers 201 either way.
// Round 186 adds two steps inside the same contract: the
// metadata-strip outcome is settled here (the encode strips as it
// converts; a compliant file with strippable global tags gets the
// stream-copy remux — see the Round 186 banner), and the
// enhancement agent is chained fire-and-forget at the end: this
// function IS awaited by the upload handler, so the agent must
// never be — the 201 cannot wait on a two-pass stabilization.
async function r124ProcessUpload(id, name) {
  const bins = await r124ResolveBins();
  if (!bins) return;
  try {
    let abs = path.join(UPLOAD_DIR, name);
    const probe0 = await r124Probe(bins, abs);
    let info = r124VideoInfo(probe0);
    if (!info) return; // not a probeable video — leave exactly as uploaded
    let converted186 = false;
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
          converted186 = true;
          console.log(`[r124] upload ${id}: converted ${name} → ${finalName} (H.264/yuv420p/faststart)`);
        } else {
          try { fs.unlinkSync(tmpOut); } catch {}
          console.error(`[r124] upload ${id}: converted file did not probe as H.264 — original kept`);
        }
      }
    }
    // Round 186 metadata strip: after the conversion decision the
    // display file is final for this stage, so settle whether it
    // still carries strippable global metadata. A converted file
    // was stripped by its encode; a passthrough file is remuxed
    // ONLY when its tags carry more than container bookkeeping —
    // a metadata-free file keeps passing through byte-for-byte.
    let meta186 = { stripped: false, action: "none" };
    if (converted186) {
      meta186 = { stripped: true, action: "encode" };
    } else if (r186StrippableTags(probe0)) {
      const ok = await r186StripRemux(bins, abs, info);
      meta186 = ok ? { stripped: true, action: "remux" } : { stripped: false, action: "remux-failed" };
      if (ok) console.log(`[r186] upload ${id}: global metadata stripped by remux (${name})`);
    } else {
      meta186 = { stripped: true, action: "none-needed" };
    }
    // Round 224: the remux-failed settle is the one outcome
    // where the display file goes on serving the phone's
    // global tags — GPS included. Play 78 shipped exactly
    // that, silently. Name it as the exposure it is, so it
    // can never again hide among ordinary stage errors.
    if (meta186.action === "remux-failed") {
      console.error(`[r224] METADATA EXPOSURE: upload ${id} is serving ${name} with location-capable metadata — the conversion and the strip remux both failed`);
    }
    await r124PosterFor(bins, id, abs, info);
    // Round 186: chain the enhancement agent without awaiting it
    // (see the note above). Its own catch-all is inside; this
    // .catch is the belt to its suspenders — a rejected promise
    // here must never become an unhandled rejection.
    r186EnhanceUpload(bins, id, abs, meta186)
      .catch((e) => console.error(`[r186] upload ${id}: stage error (display file kept):`, e.message))
      // Round 195: the head-trim + upscale stage rides between
      // the agent and the rendition, so the rendition — and the
      // poster the welcome email carries — is made from the
      // trimmed / upscaled file. Its own catch-all is inside;
      // this .catch is the belt to its suspenders, the same
      // discipline as every stage on this chain.
      .then(() => r195AfterEnhance(id))
      .catch((e) => console.error(`[r195] upload ${id}: trim/upscale stage error (display file kept):`, e.message))
      // Round 203: the action-band reframe stage rides
      // between Round 195 and the rendition, so the poster,
      // the rendition and the welcome email all inherit the
      // reframed file. Its own catch-all is inside; this
      // .catch is the belt to its suspenders, the same
      // discipline as every stage on this chain.
      .then(() => r203AfterR195(id))
      .catch((e) => console.error(`[r203] upload ${id}: reframe stage error (display file kept):`, e.message))
      // Round 209: the smart-poster stage rides after the
      // reframe settles and before the rendition, so the
      // poster is re-picked from the FINAL display file's
      // action peak — the poster the leaderboard rows,
      // boards and the welcome email show. Its own catch-all
      // is inside; this .catch is the belt to its suspenders,
      // the same discipline as every stage on this chain.
      .then(() => r209PosterAfterR203(id))
      .catch((e) => console.error(`[r209] upload ${id}: smart-poster stage error (poster kept):`, e.message))
      // Round 227: the poster auto-clean rides after the smart
      // poster settles and before the rendition + welcome email,
      // so the poster the email carries is the cleaned one. It
      // touches the POSTER only — never the video file. Its own
      // catch-all is inside; this .catch is the belt to its
      // suspenders, the same discipline as every stage here.
      .then(() => r227PosterCleanAfterR209(id))
      .catch((e) => console.error(`[r227] upload ${id}: poster-clean stage error (poster kept):`, e.message))
      // Round 192: the streaming rendition is made from the
      // FINAL display file (the enhanced one, when it enhanced),
      // so it rides after the agent settles. Its catch-all is
      // inside; this .catch is the belt to its suspenders — a
      // failed rendition never touches the upload or the email.
      .then(() => r192StreamAfterEnhance(id))
      .catch((e) => console.error(`[r192] upload ${id}: stream stage error (master kept):`, e.message))
      // Round 188: the welcome email rides the very end of this
      // chain — only once the agent has fully settled is the
      // poster final (the enhanced poster, when it enhanced), so
      // that is the poster the email carries. Its own catch-all
      // is inside; this .catch is the belt to its suspenders,
      // the same discipline as the agent above.
      .then(() => r188MaybeSendWelcome(id))
      .catch((e) => console.error(`[r188] upload ${id}: welcome stage error (upload unaffected):`, e.message));
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
/* ================= Round 224 (2026-11-27): recovery for plays the pipeline never processed =================
   The Round 124 migration above is marker-guarded and
   codec-shaped; nothing re-runs the upload path's
   conversion for a play that arrived after it and failed
   there — play 78 (h264, but rotated, with the audio-map
   bug breaking its conversion) sat as a raw .mov forever.
   This scan is that missing door, keyed on the exact
   signature of the un-processed state: a file play with
   NO stream rendition whose master still probes
   non-compliant or still carries strippable global tags.
   A play whose rendition is legitimately absent (the
   master was already small enough to serve) probes
   compliant and tag-free and is skipped untouched, as is
   every processed play. The 10-minute age grace keeps the
   scan out of a live upload chain's way — a fresh upload
   is rendition-less for its first seconds by design.
   On conversion, the r195/r203/r209/r213 stamps are
   cleared: whatever those stages recorded (if anything)
   was evaluated against the un-processed original, and
   clearing is what lets the existing backfills re-run
   them against the healed file in the same boot — the
   Round 213 stamp alone would otherwise block the
   smart-poster re-pick the recovery exists to deliver.
   A strip-only heal clears nothing: the remux changes no
   frame, so every stage's record stays true. */
// Heal one play in the un-processed state. Returns
// "converted", "stripped", or "" (nothing done). Never
// throws to its caller beyond its own catch — the scan
// wraps it per row regardless.
async function r224RecoverPlay(bins, id) {
  const row = db.prepare("SELECT media_kind, media_url, stream_url FROM highlights WHERE id=?").get(id);
  if (!row || row.media_kind !== "file") return "";
  if (row.stream_url) return ""; // healed since the scan selected it
  const name = path.basename(row.media_url || "");
  if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return "";
  const abs = path.join(UPLOAD_DIR, name);
  if (!fs.existsSync(abs)) return "";
  const probe0 = await r124Probe(bins, abs);
  const info = r124VideoInfo(probe0);
  if (!info) return ""; // not a probeable video — leave exactly as it is
  const tagged = r186StrippableTags(probe0);
  if (r124Compliant(abs, info) && !tagged) return ""; // fully processed; the rendition is legitimately absent
  if (!r124Compliant(abs, info)) {
    // The upload path's conversion, verbatim discipline:
    // produce and verify first, rename into place, the row
    // follows, the poster is regenerated from the new file.
    const base = name.replace(/\.[^.]+$/, "");
    const tmpOut = path.join(UPLOAD_DIR, `${base}.r224tmp.mp4`);
    if (await r124Convert(bins, abs, tmpOut)) {
      const chk = r124VideoInfo(await r124Probe(bins, tmpOut));
      if (chk && chk.codec === "h264") {
        const finalName = `${base}.mp4`;
        const finalAbs = path.join(UPLOAD_DIR, finalName);
        fs.renameSync(tmpOut, finalAbs);
        if (finalName !== name) { try { fs.unlinkSync(abs); } catch {} }
        db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${finalName}`, id);
        console.log(`[r224] play ${id}: recovered — converted ${name} → ${finalName} (H.264/yuv420p/faststart, metadata stripped by the encode)`);
        await r124PosterFor(bins, id, finalAbs, chk);
        db.prepare("UPDATE highlights SET r195_checked_at='', r203_checked_at='', r209_checked_at='', r213_checked_at='' WHERE id=?").run(id);
        return "converted";
      }
      try { fs.unlinkSync(tmpOut); } catch {}
      console.error(`[r224] play ${id}: recovery conversion did not verify as H.264 — falling through to the strip`);
    }
  }
  // The metadata backstop (Round 224 banner, item 3): the
  // conversion is unavailable or failed, but the served
  // master must still not carry the phone's tags — strip
  // in place. If even that fails, say so as the exposure
  // it is. File-level only: the play is never held.
  if (tagged) {
    if (await r186StripRemux(bins, abs, info)) {
      console.log(`[r224] play ${id}: recovered — global metadata stripped in place (${name})`);
      return "stripped";
    }
    console.error(`[r224] METADATA EXPOSURE: play ${id} is serving ${name} with location-capable metadata — the conversion and the strip remux both failed`);
  }
  return "";
}
// Boot-time recovery scan: rendition-less file plays old
// enough to be done uploading. Fire-and-forget from the
// listen callback, ahead of the other backfills (which
// then re-run the cleared stages against healed files);
// idempotent — a boot that finds nothing in the
// un-processed state costs one query plus a probe per
// rendition-less play.
async function r224Backfill() {
  try {
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r224] recovery deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id FROM highlights WHERE media_kind='file' AND status!='trashed' AND (stream_url='' OR stream_url IS NULL) AND created_at < datetime('now','-10 minutes')").all();
    let converted = 0, stripped = 0;
    for (const row of rows) {
      try {
        const what = await r224RecoverPlay(bins, row.id);
        if (what === "converted") converted++;
        else if (what === "stripped") stripped++;
      } catch (e) { console.error(`[r224] recovery row ${row.id} failed:`, e.message); }
    }
    console.log(`[r224] recovery scan complete (${converted} converted, ${stripped} stripped, ${rows.length} rendition-less file plays scanned)`);
  } catch (e) { console.error("[r224] recovery error:", e.message); }
}
// Round 224 (owner visibility): is this play a file video
// that has been rendition-less for over 24 hours? The
// owner queue carries the flag so a deterministic stage
// failure surfaces the same day instead of hiding in the
// logs (the uploads review's recommendation 4). The
// Round 192 kill switch silences it: with renditions
// disabled globally, an empty stream_url is the design,
// not a defect.
function r224MissingRendition(r) {
  if (process.env.HH_NO_STREAM192 === "1") return false;
  if (!r || r.media_kind !== "file" || r.status === "trashed") return false;
  if (r.stream_url) return false;
  const name = path.basename(r.media_url || "");
  if (!/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return false;
  const t = Date.parse(String(r.created_at || "").replace(" ", "T") + "Z");
  return !isNaN(t) && Date.now() - t > 24 * 3600 * 1000;
}
/* ================= Round 227 (2026-11-27): upload text safety flag =================
   The site audit's finding, made concrete by the Nov 26 case (a play
   whose TEAM field carried the athlete's full name, "Kameron
   Angelin", shown publicly): the upload form now hints that the team
   field is public, and this helper gives the OWNER a heads-up chip in
   the queue when an upload's story/team text looks like it names a
   child's age or puts a person's full name in the team field. The
   flag NEVER blocks an upload and NEVER edits text — it only
   surfaces for the owner, computed at queue-read time from the
   stored row (the same pattern as r224MissingRendition above), so it
   covers plays uploaded before this round too.
   Age patterns (conservative, case-insensitive; the captured number
   must be 4–17 — a child's plausible age — so "scored 21 points at
   12 years old" flags on the age, never on the score):
     /\bis only (\d{1,2})\b/                    "is only 10"
     /\b(\d{1,2})\s*(?:years?\s*old|yrs?\.?\s*old)\b/   "10 years old", "9 yrs old"
     /\b(\d{1,2})[-]year[-]old\b/               "9-year-old"
     /\bage (\d{1,2})\b/                        "age 9"
   Full-name pattern: the team field, trimmed, is exactly two words,
   each Title-case alphabetic (/^[A-Z][a-z]+(?:['-][A-Za-z]+)?$/ —
   so all-caps "PLAINVIEW HAWKS" and lowercase entries never match),
   and neither word (lowercased) is in the team-word allowlist:
   hawks, school, academy, athletics, baseball, softball, soccer,
   club, team, travel, elite, united, fc, llc, inc. */
const R227_AGE_RES = [/\bis only (\d{1,2})\b/i, /\b(\d{1,2})\s*(?:years?\s*old|yrs?\.?\s*old)\b/i, /\b(\d{1,2})[-]year[-]old\b/i, /\bage (\d{1,2})\b/i];
const R227_TEAM_WORDS = new Set(["hawks", "school", "academy", "athletics", "baseball", "softball", "soccer", "club", "team", "travel", "elite", "united", "fc", "llc", "inc"]);
function r227AgeMentioned(text) {
  const s = String(text || "");
  for (const re of R227_AGE_RES) { const m = s.match(re); if (m) { const n = Number(m[1]); if (n >= 4 && n <= 17) return true; } }
  return false;
}
function r227TeamLooksLikeName(team) {
  const words = String(team || "").trim().split(/\s+/).filter(Boolean);
  if (words.length !== 2) return false;
  if (!words.every((w) => /^[A-Z][a-z]+(?:['-][A-Za-z]+)?$/.test(w))) return false;
  return !words.some((w) => R227_TEAM_WORDS.has(w.toLowerCase().replace(/['-].*$/, "")));
}
function r227TextFlag(r) {
  if (!r) return "";
  const bits = [];
  // The row's story lives in the `story` column (the queue
  // serializer republishes it as story_text for the client).
  if (r227AgeMentioned(r.story || r.story_text) || r227AgeMentioned(r.team)) bits.push("Age mentioned");
  if (r227TeamLooksLikeName(r.team)) bits.push("Team looks like a full name");
  return bits.join(" · ");
}
/* ================= Round 192 (2026-11-25): streaming renditions + homepage load discipline =================
   WHY: Emil, from his iPhone (2026-11-25): "It's taking awhile
   for videos to load on the homepage," with a screenshot of
   Leaderboard rows sitting on black thumbnails. The diagnosis,
   verified against the production backup before building:
   * Range serving was NOT the problem — /uploads has carried
     RFC-correct Range (206/Content-Range, suffix ranges, If-
     Range, ETag/304) since Rounds 97/117. What was missing is
     payload: the masters are 8–20 MB phone files and every
     in-page player loaded the master itself. On a phone
     connection through this small server, a board of autoplaying
     masters takes seconds-to-minutes to settle.
   * The black Leaderboard rows were the same contention, one
     step removed: the row renderer (fameRowHtml134) already
     renders the poster as an <img> when one exists, and the
     black-row plays (Nicholas 71, christian 66) HAVE posters —
     files verified present and non-black (mean luma ~113–116).
     Their posters are the two LARGEST (150–183 KB vs 39–54 KB
     for the rows that painted), queued behind megabytes of
     autoplaying master video on first load; the unloaded <img>
     over the dark row reads as a black thumb with the play badge.
   THE FIX, three parts: (1) every video play gets a streaming
   rendition — H.264/yuv420p/AAC, faststart, fit inside
   1280×720 and never upscaled, CRF 28 under a 2 Mbps cap —
   stored as <base>-stream.mp4 and carried on the row as
   stream_url; every in-page player (board cards + tiles,
   featured, watch/detail, the R189 feed) loads the rendition
   and falls back to media_url when there is none. The master
   is untouched and stays canonical for downloads and the Hype
   Frame studio. (2) A boot-time backfill makes renditions (and
   any missing posters) for existing plays, sequentially behind
   the same ffmpeg serializer, never blocking startup; it is
   idempotent by construction (a play that has its rendition
   file is skipped), so there is no settings marker to strand
   it. (3) At-rest homepage cards stop preloading whole clips:
   mediaHtml's board-card form drops preload="auto" + autoplay
   for preload="metadata" on the poster (the watch/detail form
   keeps its behavior — opening a play is the intent to watch).
   HH_NO_STREAM192=1 disables generation AND serving (the
   payload carries ''), restoring master playback exactly.
   FALLBACK CONTRACT (the house rule): a rendition is
   best-effort, never a gate — any failure leaves the master
   serving and a log line saying why. A rendition that comes
   out no smaller than its master is discarded: the master was
   already small enough to serve. */
function r192FitDims192(w, h) {
  // Fit inside 1280×720, never upscale, even dimensions for
  // yuv420p. Portrait phone clips come out 404×720-ish; a
  // 1080p GameChanger clip lands exactly 1280×720.
  const s = Math.min(1, 1280 / w, 720 / h);
  return {
    w: Math.max(2, Math.floor((w * s) / 2) * 2),
    h: Math.max(2, Math.floor((h * s) / 2) * 2),
  };
}
async function r192EncodeStream(bins, inFile, outFile, dims) {
  return r138SerializeFfmpeg(() => r192EncodeStreamNow(bins, inFile, outFile, dims));
}
async function r192EncodeStreamNow(bins, inFile, outFile, dims) {
  // Same encode conventions as r124ConvertNow (autorotate on
  // decode, no global metadata — a kids' platform keeps no GPS
  // in any display file, renditions included — capped threads),
  // tuned for delivery instead of archival: CRF 28 under a
  // 2 Mbps cap is the 0.5–1.5 MB band for a typical 10–15s play.
  const args = ["-y", "-i", inFile, "-map", "0:v:0", "-map", "0:a:0?",
    "-map_metadata", "-1",
    "-vf", `scale=${dims.w}:${dims.h}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "28", "-preset", "veryfast",
    "-maxrate", "2000k", "-bufsize", "4000k",
    "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", "-threads", "2", outFile];
  const { err, stderr } = await r124Run(bins.ffmpeg, args, 240000);
  if (err) { console.error("[r192] rendition encode failed:", err.message, stderr.slice(-300)); return false; }
  return true;
}
// Make the rendition for one play if it lacks one. Resolves
// true when the play ends up with a servable rendition (made or
// already present), false when it stays master-only. Never
// throws — the fallback contract lives here.
// Round 195 note: ensures for one play are serialized through
// a per-play promise gate (the same pattern as r195ProcessPlay).
// Three callers can now meet on one play — the upload chain,
// the boot backfill, and the Round 195 stage regenerating a
// rendition its swap just staled — and two unserialized ensures
// share the <base>.r192tmp.mp4 path: one invocation's cleanup
// can unlink the file another's ffmpeg is mid-faststart on
// (observed in test-r192 after Round 195 lengthened the chain).
// A gated second caller re-reads the row when its turn comes
// and normally finds the rendition already correct.
const r192InFlight = new Map();
async function r192EnsureStream(bins, id) {
  while (r192InFlight.has(id)) { try { await r192InFlight.get(id); } catch {} }
  const p = r192EnsureStreamNow(bins, id);
  r192InFlight.set(id, p);
  try { return await p; } finally { if (r192InFlight.get(id) === p) r192InFlight.delete(id); }
}
async function r192EnsureStreamNow(bins, id, depth = 0) {
  try {
    if (process.env.HH_NO_STREAM192 === "1") return false;
    const row = db.prepare("SELECT media_kind, media_url, stream_url FROM highlights WHERE id=?").get(id);
    if (!row || row.media_kind !== "file") return false;
    const name = path.basename(row.media_url || "");
    if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return false;
    const abs = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return false;
    const base = name.replace(/\.[^.]+$/, "");
    const streamName = `${base}-stream.mp4`;
    const streamAbs = path.join(UPLOAD_DIR, streamName);
    if (row.stream_url === `/uploads/${streamName}` && fs.existsSync(streamAbs)) return true;
    const info = r124VideoInfo(await r124Probe(bins, abs));
    if (!info || !info.width || !info.height) { console.error(`[r192] play ${id}: source did not probe as video — no rendition`); return false; }
    // Round 224: the fit is computed from the DISPLAY dims —
    // the encode's scale filter sees autorotated frames, so
    // coded dims would stretch a rotated portrait clip flat.
    const dims = r192FitDims192(info.dispWidth, info.dispHeight);
    const tmpOut = path.join(UPLOAD_DIR, `${base}.r192tmp.mp4`);
    if (!(await r192EncodeStream(bins, abs, tmpOut, dims))) { try { fs.unlinkSync(tmpOut); } catch {} return false; }
    const chk = r124VideoInfo(await r124Probe(bins, tmpOut));
    if (!chk || chk.codec !== "h264" || chk.pixFmt !== "yuv420p" || !r124IsFaststart(tmpOut)) {
      try { fs.unlinkSync(tmpOut); } catch {}
      console.error(`[r192] play ${id}: rendition did not verify as H.264/yuv420p/faststart — master kept`);
      return false;
    }
    // Media-changed recheck (the Round 195/203 swap
    // discipline, adopted here in Round 203): a sibling
    // stage's swap can rename the master mid-encode — the
    // encode reads on through the rename, but the size
    // read below then stats a path the row no longer
    // names (observed as an ENOENT "rendition failed"
    // with an orphaned temp file, once Round 203's boot
    // scan lengthened the window in which the Round 192
    // and Round 195 backfills interleave). If the media
    // moved, discard this rendition and retry against the
    // current file (bounded), so the play still leaves
    // this call with a correct rendition; the retry calls
    // the Now body directly because this call already
    // holds the per-play gate.
    const rowNow = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
    let inBytes = 0;
    try { inBytes = fs.statSync(abs).size; } catch { inBytes = 0; }
    if (!rowNow || path.basename(rowNow.media_url || "") !== name || !inBytes) {
      try { fs.unlinkSync(tmpOut); } catch {}
      if (depth < 2) { console.log(`[r192] play ${id}: media changed during rendition — retrying against the current file`); return r192EnsureStreamNow(bins, id, depth + 1); }
      console.error(`[r192] play ${id}: media changed during rendition — standing down (master kept)`);
      return false;
    }
    const outBytes = fs.statSync(tmpOut).size;
    if (outBytes >= inBytes) {
      try { fs.unlinkSync(tmpOut); } catch {}
      console.log(`[r192] play ${id}: rendition (${outBytes}B) is not smaller than the master (${inBytes}B) — master serves`);
      return false;
    }
    fs.renameSync(tmpOut, streamAbs);
    db.prepare("UPDATE highlights SET stream_url=? WHERE id=?").run(`/uploads/${streamName}`, id);
    console.log(`[r192] play ${id}: rendition ${streamName} (${inBytes} → ${outBytes} bytes, ${dims.w}x${dims.h})`);
    return true;
  } catch (e) { console.error(`[r192] play ${id}: rendition failed (master kept):`, e.message); return false; }
}
// The upload-pipeline stage: chained after the Round 186 agent
// settles, so the rendition is made from the FINAL display file
// (the enhanced one, when it enhanced). Catch-all inside, like
// every stage on this chain.
async function r192StreamAfterEnhance(id) {
  try {
    if (process.env.HH_NO_STREAM192 === "1") return;
    const bins = await r124ResolveBins();
    if (!bins) return;
    await r192EnsureStream(bins, id);
  } catch (e) { console.error(`[r192] upload ${id}: stream stage error (master kept):`, e.message); }
}
// Boot-time backfill: existing plays get their renditions (and
// any missing posters) without a re-upload. Fire-and-forget
// from the listen callback — startup never waits on it; the
// ffmpeg serializer keeps it to one encode at a time, and each
// play is independent (skip-and-log). No settings marker: the
// scan is idempotent, so a boot that finds everything done
// costs one query, and a boot after a partial run simply
// finishes the job.
async function r192Backfill() {
  try {
    if (process.env.HH_NO_STREAM192 === "1") { console.log("[r192] backfill disabled via HH_NO_STREAM192"); return; }
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r192] backfill deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id, media_url, poster_url, stream_url FROM highlights WHERE media_kind='file' AND status!='trashed'").all();
    let made = 0, posters = 0;
    for (const row of rows) {
      try {
        const name = path.basename(row.media_url || "");
        if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) continue;
        const abs = path.join(UPLOAD_DIR, name);
        if (!fs.existsSync(abs)) continue;
        if (!row.poster_url) {
          const info = r124VideoInfo(await r124Probe(bins, abs));
          if (info && (await r124PosterFor(bins, row.id, abs, info))) posters++;
        }
        const hadStream = !!row.stream_url && fs.existsSync(path.join(UPLOAD_DIR, path.basename(row.stream_url)));
        if ((await r192EnsureStream(bins, row.id)) && !hadStream) made++;
      } catch (e) { console.error(`[r192] backfill row ${row.id} failed:`, e.message); }
    }
    console.log(`[r192] backfill complete (${made} renditions made, ${posters} posters made, ${rows.length} file plays scanned)`);
  } catch (e) { console.error("[r192] backfill error:", e.message); }
}

/* ================= Round 195 (2026-11-25): head trim + sub-720 upscale =================
   WHY: Emil, watching the R189 feed (2026-11-25): plays like
   Kameron's walk-off and Juliana's caught-stealing sit on a
   still frame for seconds before the action starts — dead air
   at the head. Measured against the production backup before
   building: Kameron (id 75) ~4.0s of near-frozen head,
   Juliana (id 51) ~3.16s (freezedetect n=-50dB). He approved
   teaching the Round 186 agent to trim that head — this
   reopens R186's report-only dead-time handling for the head
   only (the tail is untouched) — and, the same evening, an
   upscale for the "smaller format" clips: Juliana's 960x444
   arrives under 720 on its small side and reads soft
   everywhere it is stretched.
   TRIM DETECTION: freezedetect at the same noise floor the
   R186 dead-time read uses (n=0.003 ≈ -50dB) with d=1.0 over
   the first 12 seconds. The motion onset is the end of the
   FIRST freeze interval that touches t=0 — deliberately no
   merging across later intervals: an interruption can only
   move the onset earlier (trim less), never later into the
   action. Dry-run calibration on the two real files before
   building: Kameron onset 4.0s (reference ~4.0s), Juliana
   3.12s (reference ~3.16s — one frame at 25fps). DECISION:
   trim only when the still head is ≥1.5s, cutting to 0.4s
   before the onset so the play does not start mid-motion; a
   still head over 6s is NOT trimmed — it is flagged in the
   report (that much stillness is content, not dead air: a
   held graphic, a ceremony); a head whose action never
   arrives inside the file is inconclusive and left alone. A
   head with real motion (a windup, a settles-in stance) never
   trips freezedetect and never trims; a detector error never
   trims and leaves the play unstamped so a later boot
   retries. The failure mode is trimming too little, by
   design.
   UPSCALE: when the smaller dimension is under 720, scale so
   it becomes 720 — lanczos plus a mild unsharp, following the
   chain's encode conventions — with the factor capped at 2×
   (a source under 360 on its small side lands at the cap and
   the report says so). Exactly 720 does NOT trigger: a
   720x1280 portrait is already at the line.
   INTEGRATION: one stage chained between the Round 186 agent
   and the Round 192 rendition, so the poster, the rendition
   and the Round 188 welcome all inherit the result. Trim and
   upscale share ONE encode when both apply. The swap follows
   the Round 186 discipline exactly: the encode is produced
   and verified first (codec / pix_fmt / faststart / dims /
   duration against the plan), the current display file is
   preserved as <base>-preenhance.mp4 (a timestamped variant
   when that name is taken — the TRUE original is never
   overwritten), and only then does the row move. A play that
   already had a rendition gets it regenerated from the new
   master (the old rendition file is deleted — it was made
   from the pre-trim file). Every outcome is recorded under
   `r195` in highlights.enhance_json, and
   highlights.r195_checked_at is stamped as the evaluation
   completes — the boot backfill selects on the empty stamp,
   so a restart never re-trims or re-upscales, and a play
   processed at upload is invisible to it; a recorded
   trim/upscale outcome is also honored directly, belt to the
   stamp's suspenders. HH_NO_TRIM=1 / HH_NO_UPSCALE=1 disable
   their stage alone (the disabled stage is recorded as
   skipped in the report; the rest of the chain is
   unaffected). FALLBACK CONTRACT (the house rule):
   best-effort, never a gate — any failure keeps the current
   display file, leaves the stamp empty for a later retry,
   and logs why. Photo uploads never enter the chain (Round
   124 returns before it); a photo the backfill meets is
   stamped not-a-video and left byte-for-byte alone. */
const R195_FREEZE_NOISE = "0.003";  // freezedetect noise floor ≈ -50dB — the R186 dead-time read's floor
const R195_FREEZE_MIN_DUR = "1.0";  // freezedetect d: stills shorter than this never even register
const R195_SCAN_SEC = 12;           // head window scanned — comfortably past the 6s flag line
const R195_MIN_STILL_SEC = 1.5;     // a still head shorter than this is a beat, not dead air
const R195_MAX_STILL_SEC = 6;       // a still head longer than this is flagged, never trimmed
const R195_LEAD_SEC = 0.4;          // kept before the onset so the play doesn't start mid-motion
const R195_MIN_DIM = 720;           // the upscale line: smaller dimension under this qualifies
const R195_MAX_FACTOR = 2;          // upscale factor cap
// Scan the head and report the still span that touches t=0.
// Returns { headStillSec, onsetSec, openEnded } — onsetSec is
// the end of the first head-touching freeze (or the scan
// window when the freeze outlasts it) — or null when the scan
// itself failed, which the caller treats as "never trim,
// never stamp".
async function r195DetectHead(bins, abs) {
  const { err, stderr } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-i", abs, "-vf", `freezedetect=n=${R195_FREEZE_NOISE}:d=${R195_FREEZE_MIN_DUR}`, "-t", String(R195_SCAN_SEC), "-f", "null", "-"], 120000));
  if (err) return null;
  const starts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
  const ends = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
  if (!starts.length || starts[0] > 0.15) return { headStillSec: 0, onsetSec: 0, openEnded: false };
  const openEnded = ends.length === 0;
  const onset = openEnded ? R195_SCAN_SEC : ends[0];
  return { headStillSec: r186Round(onset, 2), onsetSec: r186Round(onset, 2), openEnded };
}
function r195UpscalePlan(info) {
  // Round 224: the plan works in DISPLAY dims — the encode's
  // scale filter sees autorotated frames, and the output
  // verification below compares against the (rotation-free)
  // output's display dims.
  const w = info.dispWidth | 0, h = info.dispHeight | 0;
  if (!w || !h) return null;
  const minDim = Math.min(w, h);
  if (minDim >= R195_MIN_DIM) return null;
  const raw = R195_MIN_DIM / minDim;
  const factor = Math.min(raw, R195_MAX_FACTOR);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  return { factor: r186Round(factor, 3), capped: raw > R195_MAX_FACTOR, outW: even(w * factor), outH: even(h * factor), srcW: w, srcH: h };
}
async function r195Encode(bins, abs, tmpOut, cutStart, up) {
  return r138SerializeFfmpeg(() => r195EncodeNow(bins, abs, tmpOut, cutStart, up));
}
async function r195EncodeNow(bins, abs, tmpOut, cutStart, up) {
  // The Round 186 encode spec (libx264 CRF 23 / yuv420p / AAC
  // 128k / faststart / no global metadata — the kids'-platform
  // GPS rule binds every display file), plus this round's two
  // moves: an input seek to the cut point when trimming, and
  // the lanczos + mild-unsharp scale when upscaling. A
  // trim-only encode carries no scale filter at all, so the
  // dimensions pass through untouched.
  const args = ["-nostats", "-y"];
  if (cutStart > 0) args.push("-ss", String(r186Round(cutStart, 3)));
  args.push("-i", abs, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1");
  if (up) args.push("-vf", `scale=${up.outW}:${up.outH}:flags=lanczos,unsharp=5:5:0.8:5:5:0.0`);
  args.push("-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-threads", "2", tmpOut);
  const { err, stderr } = await r124Run(bins.ffmpeg, args, 600000);
  if (err) { console.error("[r195] encode failed:", err.message, stderr.slice(-300)); return false; }
  return true;
}
// Merge this round's evaluation into the play's enhance_json
// (the Round 186 report, when one exists, is preserved) and
// stamp r195_checked_at in the same write — the stamp is what
// the boot backfill selects on.
function r195StoreEval(id, r195) {
  const row = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
  let obj = {};
  if (row && row.enhance_json) { try { obj = JSON.parse(row.enhance_json); } catch { obj = {}; } }
  obj.r195 = r195;
  db.prepare("UPDATE highlights SET enhance_json=?, r195_checked_at=? WHERE id=?").run(JSON.stringify(obj), new Date().toISOString(), id);
}
// Evaluate one play for both stages and apply what trips.
// Shared by the upload chain (origin "upload") and the boot
// backfill (origin "backfill") — and those two callers can
// meet on the same fresh upload (the backfill fires seconds
// after boot; a chain can still be mid-flight), so evaluations
// of one play are serialized through a per-play promise gate:
// two evaluators share the temp/output paths, and an
// unserialized pair could rename a half-written encode into
// place. A second caller waits, then evaluates fresh against
// whatever the first left (usually: the stamp + recorded
// outcome, and nothing to do). Never throws; returns the
// tallies the backfill summary reports. The stamp is written
// only when the evaluation actually completed — a detector or
// encode failure leaves it empty so a later boot retries.
const r195InFlight = new Map();
async function r195ProcessPlay(bins, id, origin) {
  while (r195InFlight.has(id)) { try { await r195InFlight.get(id); } catch {} }
  const p = r195ProcessPlayNow(bins, id, origin);
  r195InFlight.set(id, p);
  try { return await p; } finally { if (r195InFlight.get(id) === p) r195InFlight.delete(id); }
}
async function r195ProcessPlayNow(bins, id, origin) {
  const out = { trimmed: 0, upscaled: 0, flagged: 0 };
  try {
    const row = db.prepare("SELECT media_kind, media_url, stream_url, enhance_json FROM highlights WHERE id=?").get(id);
    if (!row || row.media_kind !== "file") return out;
    const name = path.basename(row.media_url || "");
    if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return out;
    const abs = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return out; // missing file: a later boot retries — never stamp it
    const info = r124VideoInfo(await r124Probe(bins, abs));
    const r195 = { at: new Date().toISOString(), origin, trim: null, upscale: null, preEnhanceFile: null };
    if (!info || !info.width || !info.height) {
      // A file play that does not probe as video (a photo):
      // evaluated, nothing to do, stamped so backfill scans
      // stay cheap and the file is left exactly as it is.
      r195.trim = { status: "not-video" };
      r195.upscale = { status: "not-video" };
      r195StoreEval(id, r195);
      return out;
    }
    let prior = null;
    if (row.enhance_json) { try { prior = JSON.parse(row.enhance_json).r195 || null; } catch { prior = null; } }
    // A prior evaluation that already swapped recorded
    // the preserved original's name; carry it — when the
    // boot backfill wins the race to a fresh upload, the
    // chain's later evaluation only re-stores, and the
    // name is the audit trail to the true original
    // (observed in test-r195 once Round 203's boot scan
    // lengthened the window).
    if (prior && prior.preEnhanceFile) r195.preEnhanceFile = prior.preEnhanceFile;
    // ---- trim decision ----
    let cutStart = 0;
    if (prior && prior.trim && prior.trim.status === "trimmed") {
      r195.trim = prior.trim; // already trimmed once — never twice
    } else if (process.env.HH_NO_TRIM === "1") {
      r195.trim = { status: "skipped", reason: "HH_NO_TRIM=1", sourceDuration: r186Round(info.duration, 2) };
    } else {
      const det = await r195DetectHead(bins, abs);
      if (!det) { console.error(`[r195] play ${id}: head detection failed — left unstamped for a later retry`); return out; }
      const still = Math.min(det.headStillSec, info.duration || det.headStillSec);
      const onset = Math.min(det.onsetSec, info.duration || det.onsetSec);
      const t = { status: "no-trim", headStillSec: r186Round(still, 2), onsetSec: r186Round(onset, 2), sourceDuration: r186Round(info.duration, 2) };
      if (still >= R195_MIN_STILL_SEC) {
        if (onset >= (info.duration || 0) - 0.75) { t.status = "inconclusive"; t.reason = "no sustained action follows the still head inside the file"; }
        else if (still > R195_MAX_STILL_SEC) { t.status = "flagged"; t.reason = `still head of ${t.headStillSec}s exceeds the ${R195_MAX_STILL_SEC}s cap — recorded, not trimmed`; out.flagged = 1; }
        else { t.status = "trimmed"; cutStart = Math.max(0, onset - R195_LEAD_SEC); t.trimmedSec = r186Round(cutStart, 2); t.leadKeptSec = R195_LEAD_SEC; }
      }
      r195.trim = t;
    }
    // ---- upscale decision ----
    let up = null;
    if (prior && prior.upscale && prior.upscale.status === "upscaled") {
      r195.upscale = prior.upscale; // already upscaled once — never twice
    } else if (process.env.HH_NO_UPSCALE === "1") {
      r195.upscale = { status: "skipped", reason: "HH_NO_UPSCALE=1", sourceWidth: info.dispWidth, sourceHeight: info.dispHeight };
    } else {
      up = r195UpscalePlan(info);
      r195.upscale = up
        ? { status: "upscaled", sourceWidth: up.srcW, sourceHeight: up.srcH, outputWidth: up.outW, outputHeight: up.outH, factor: up.factor, capped: up.capped }
        : { status: "not-needed", sourceWidth: info.dispWidth, sourceHeight: info.dispHeight };
    }
    const wantTrim = !!(r195.trim && r195.trim.status === "trimmed" && cutStart > 0);
    if (!wantTrim && !up) {
      r195StoreEval(id, r195);
      console.log(`[r195] play ${id}: evaluated — trim=${r195.trim.status}, upscale=${r195.upscale.status} (display file unchanged)`);
      return out;
    }
    // ---- one encode for whichever stages tripped ----
    const base = name.replace(/\.[^.]+$/, "");
    const tmpOut = path.join(UPLOAD_DIR, `${base}.r195tmp.mp4`);
    const finalName = `${base}${wantTrim ? "-trimmed" : ""}${up ? "-upscaled" : ""}.mp4`;
    try {
      if (!(await r195Encode(bins, abs, tmpOut, wantTrim ? cutStart : 0, up))) { try { fs.unlinkSync(tmpOut); } catch {} return out; }
      const outInfo = r124VideoInfo(await r124Probe(bins, tmpOut));
      const expW = up ? up.outW : info.dispWidth, expH = up ? up.outH : info.dispHeight;
      const expDur = info.duration - (wantTrim ? cutStart : 0);
      const verified = outInfo && outInfo.codec === "h264" && outInfo.pixFmt === "yuv420p" && r124IsFaststart(tmpOut)
        && Math.abs(outInfo.width - expW) <= 4 && Math.abs(outInfo.height - expH) <= 4
        && Math.abs(outInfo.duration - expDur) <= 0.75;
      if (!verified) {
        try { fs.unlinkSync(tmpOut); } catch {}
        console.error(`[r195] play ${id}: output did not verify (codec/dims/duration) — display file kept`);
        return out;
      }
      const rowNow = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
      if (!rowNow || path.basename(rowNow.media_url || "") !== name) {
        try { fs.unlinkSync(tmpOut); } catch {}
        console.log(`[r195] play ${id}: media changed since evaluation — standing down`);
        return out;
      }
      // Swap order matters (the Round 186 discipline): the new
      // file lands first, then the current display file is
      // preserved under its pre-enhancement name, and only
      // then does the row move — at every instant the row
      // points at a file that exists.
      let preName = `${base}-preenhance.mp4`;
      if (fs.existsSync(path.join(UPLOAD_DIR, preName))) preName = `${base}-preenhance-${Date.now()}.mp4`;
      fs.renameSync(tmpOut, path.join(UPLOAD_DIR, finalName));
      fs.renameSync(abs, path.join(UPLOAD_DIR, preName));
      db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${finalName}`, id);
      r195.preEnhanceFile = preName;
      if (wantTrim) { out.trimmed = 1; r195.trim.outputFile = finalName; r195.trim.outputDuration = r186Round(outInfo.duration, 2); }
      if (up) { out.upscaled = 1; r195.upscale.outputFile = finalName; }
      await r124PosterFor(bins, id, path.join(UPLOAD_DIR, finalName), outInfo);
      // A rendition made from the pre-trim / pre-upscale file
      // is stale: drop it and make a fresh one from the new
      // master (Round 192's own kill switch still binds).
      // →209: the ensure now runs UNCONDITIONALLY after the
      // swap, not only when a rendition already existed. At
      // boot, the Round 192 scan can straddle this swap —
      // reading the old name just before the rename, finding
      // no file, and moving on — while stream_url is still
      // empty here, so the conditional form left the play
      // rendition-less until the NEXT boot (observed in
      // test-r195 §E once the Round 209 backfill lengthened
      // the interleaving window). Ensuring here leaves the
      // play with a correct rendition in every interleaving;
      // Round 192's per-play gate keeps it one encode.
      const rowAfter = db.prepare("SELECT stream_url FROM highlights WHERE id=?").get(id);
      if (rowAfter && rowAfter.stream_url) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(rowAfter.stream_url))); } catch {}
        db.prepare("UPDATE highlights SET stream_url='' WHERE id=?").run(id);
      }
      await r192EnsureStream(bins, id);
      r195StoreEval(id, r195);
      console.log(`[r195] play ${id}: ${wantTrim ? `trimmed ${r195.trim.trimmedSec}s (onset ${r195.trim.onsetSec}s)` : "no trim"}${up ? `, upscaled ${up.srcW}x${up.srcH} → ${up.outW}x${up.outH} (x${up.factor}${up.capped ? ", capped" : ""})` : ""} → ${finalName}; previous display file kept as ${preName}`);
    } catch (e) {
      try { fs.unlinkSync(tmpOut); } catch {}
      console.error(`[r195] play ${id}: stage failed (display file kept):`, e.message);
      return out;
    }
  } catch (e) { console.error(`[r195] play ${id}: evaluation failed (display file kept):`, e.message); }
  return out;
}
// The upload-pipeline stage: chained after the Round 186
// agent settles and before the Round 192 rendition, so
// everything downstream is made from the final file.
// Catch-all inside, like every stage on this chain.
async function r195AfterEnhance(id) {
  try {
    const bins = await r124ResolveBins();
    if (!bins) return;
    await r195ProcessPlay(bins, id, "upload");
  } catch (e) { console.error(`[r195] upload ${id}: trim/upscale stage error (display file kept):`, e.message); }
}
// Boot-time backfill: existing plays are evaluated once —
// sequentially, behind the same ffmpeg serializer, never
// blocking startup. Selection is the empty r195_checked_at
// stamp, so a boot that finds everything evaluated costs one
// query, a partial run simply finishes on the next boot, and
// a play processed at upload is never selected. The summary
// line is the deploy verification's read: what was trimmed,
// what was upscaled, what was flagged.
async function r195Backfill() {
  try {
    if (process.env.HH_NO_TRIM === "1" && process.env.HH_NO_UPSCALE === "1") { console.log("[r195] backfill disabled via HH_NO_TRIM + HH_NO_UPSCALE"); return; }
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r195] backfill deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id FROM highlights WHERE media_kind='file' AND status!='trashed' AND (r195_checked_at='' OR r195_checked_at IS NULL)").all();
    let trimmed = 0, upscaled = 0, flagged = 0;
    for (const row of rows) {
      try {
        const o = await r195ProcessPlay(bins, row.id, "backfill");
        trimmed += o.trimmed; upscaled += o.upscaled; flagged += o.flagged;
      } catch (e) { console.error(`[r195] backfill row ${row.id} failed:`, e.message); }
    }
    console.log(`[r195] backfill complete (${trimmed} trimmed, ${upscaled} upscaled, ${flagged} flagged, ${rows.length} file plays scanned)`);
  } catch (e) { console.error("[r195] backfill error:", e.message); }
}

/* ================= Round 203 (2026-11-26): action-band reframe =================
   WHY: Emil, after running a real cheer clip through the
   agent by hand (2026-11-26): the athlete sits low in a
   tall phone frame under a lot of empty sky — "could we do
   anything to center more around her instead of the sky?"
   He approved building exactly that judgment into the agent
   after seeing the hand-made reframe of that clip.
   MEASUREMENT: the display file is sampled at 5 fps onto a
   small gray working copy (at most 360 wide, 960 tall,
   never upscaled) and the mean frame-to-frame luma
   difference is accumulated per band — 8 horizontal bands
   and 8 vertical bands. That is the same quantity the hand
   run read off ffmpeg's tblend-difference + signalstats
   YAVG per band, computed here in one decode pass instead
   of sixteen. The first 60 seconds decide: a camera's
   framing does not change its band signature over a clip,
   and the cap bounds the temp file.
   DECISION (per axis): peak = the largest band energy;
   median = the LOWER median (the 4th-smallest of the 8) —
   the background level. The textbook average-of-the-
   middle-two median breaks exactly when this round
   matters: when half the bands carry the action it lands
   inside the action itself, and the calibration clip
   below would fail its own test (rows [3.3, 3.5, 4.0,
   5.3, 29.8, 25.3, 31.7, 38.9]: middle-two median 15.3
   vs lower median 5.3). The axis is DECISIVE only when
   peak ≥ 8 (an absolute floor — a nearly static frame
   has no action band to find) and peak ≥ 3× the
   background level. Action bands are those at ≥ 35% of
   peak; the crop window is their span widened by one
   band of headroom on each side, clamped to the frame,
   snapped to even pixels. A crop is taken on an axis
   only when it removes ≥ 25% of that axis and keeps
   ≥ 45% of it; the reframed frame must also keep a
   smaller dimension of ≥ 360px and ≥ 40% of the source
   area, or nothing is cropped at all.
   CALIBRATION (the cheer clip, measured on its post-R186
   display file): rows [3.33, 3.52, 3.96, 5.27, 29.84,
   25.29, 31.73, 38.88] — decisive, action bands 4–7,
   window 3–7 → y 480, keeping the bottom 800 of 1280
   (62.5%); columns [18.07, 18.25, 18.46, 16.23, 15.62,
   16.77, 17.26, 21.15] — spread (she travels the full
   width), not decisive, width untouched. Full-frame
   motion (a GameChanger clip) reads peak ≈ background on
   both axes and is never reframed.
   INTEGRATION: one stage chained between Round 195 and
   the Round 192 rendition, evaluating the CURRENT
   display file (post-agent, post-trim/upscale). A
   reframe shares Round 195's swap discipline exactly:
   the encode is produced and verified first (the Round
   186 encode spec plus the crop), the current display
   file is preserved as <base>-preenhance.mp4 (a
   timestamped variant when that name is taken — the
   TRUE original is never overwritten), the poster is
   regenerated from the reframed file, and a stale
   rendition is dropped and remade. Every outcome is
   recorded under `r203` in highlights.enhance_json, and
   highlights.r203_checked_at is stamped as the
   evaluation completes — the boot backfill selects on
   the empty stamp, and a recorded reframe is honored
   directly, so a play is never cropped twice.
   HH_NO_REFRAME=1 disables the stage (recorded as
   skipped; the rest of the chain is unaffected).
   FALLBACK CONTRACT (the house rule): best-effort, never
   a gate — any failure keeps the current display file,
   leaves the stamp empty for a later retry, and logs
   why. Photo uploads never enter the chain (Round 124
   returns before it); a photo the backfill meets keeps
   its non-video name out of this stage exactly as in
   Round 195. */
const R203_SAMPLE_FPS = 5;      // frame-difference sampling rate on the working copy
const R203_SCAN_SEC = 60;       // analysis window cap — a framing's band signature is set long before this
const R203_WORK_MAX_W = 360;    // working-copy width cap (band energies are relative; small is fast)
const R203_WORK_MAX_H = 960;    // working-copy height cap (a very tall, thin clip stays bounded)
const R203_MIN_PEAK = 8;        // absolute decisiveness floor (mean luma-difference units)
const R203_RATIO = 3;           // peak must clear 3× the background (lower-median) band level
const R203_BAND_FRAC = 0.35;    // a band counts as action at ≥ 35% of the axis peak
const R203_MIN_REMOVE = 0.25;   // a crop must remove at least this share of the axis
const R203_MIN_KEEP = 0.45;     // ... and keep at least this share of it
const R203_MIN_DIM = 360;       // the reframed frame's smaller-dimension floor
const R203_MIN_AREA = 0.40;     // the reframed frame's area floor, as a share of the source area
// Measure one display file's per-band motion energies:
// 8 horizontal + 8 vertical bands of mean frame-difference
// luma on a small gray working copy, decoded once into a
// temp raw file that is always cleaned up. Returns
// { rows, cols, frames } (energies rounded for the
// report) or null when the measurement itself failed —
// the caller treats null as "never reframe, never stamp".
async function r203BandEnergies(bins, abs, info) {
  // Round 224: DISPLAY dims — the working copy is decoded
  // (autorotated) frames, so its shape and the band axes
  // below live in display space.
  const s = Math.min(1, R203_WORK_MAX_W / info.dispWidth, R203_WORK_MAX_H / info.dispHeight);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const workW = even(info.dispWidth * s), workH = even(info.dispHeight * s);
  const base = path.basename(abs).replace(/\.[^.]+$/, "");
  const tmp = path.join(UPLOAD_DIR, `${base}.r203tmp.raw`);
  try {
    const { err } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-y", "-i", abs, "-vf", `fps=${R203_SAMPLE_FPS},scale=${workW}:${workH},format=gray`, "-t", String(R203_SCAN_SEC), "-f", "rawvideo", tmp], 300000));
    if (err) return null;
    const frameSize = workW * workH;
    const nFrames = Math.floor(fs.statSync(tmp).size / frameSize);
    if (!(nFrames >= 2) || frameSize <= 0) return null;
    const rowBand = new Uint8Array(workH), colBand = new Uint8Array(workW);
    const rowPix = new Array(8).fill(0), colPix = new Array(8).fill(0);
    for (let y = 0; y < workH; y++) { rowBand[y] = Math.min(7, Math.floor((y * 8) / workH)); rowPix[rowBand[y]]++; }
    for (let x = 0; x < workW; x++) { colBand[x] = Math.min(7, Math.floor((x * 8) / workW)); colPix[colBand[x]]++; }
    const rowSum = new Array(8).fill(0), colSum = new Array(8).fill(0);
    const fd = fs.openSync(tmp, "r");
    try {
      let prev = Buffer.alloc(frameSize), cur = Buffer.alloc(frameSize);
      if (fs.readSync(fd, prev, 0, frameSize, 0) < frameSize) return null;
      for (let f = 1; f < nFrames; f++) {
        if (fs.readSync(fd, cur, 0, frameSize, f * frameSize) < frameSize) break;
        for (let y = 0; y < workH; y++) {
          const rb = rowBand[y], off = y * workW;
          for (let x = 0; x < workW; x++) {
            const d = cur[off + x] - prev[off + x];
            if (d !== 0) { const a = d < 0 ? -d : d; rowSum[rb] += a; colSum[colBand[x]] += a; }
          }
        }
        const swap = prev; prev = cur; cur = swap;
      }
    } finally { try { fs.closeSync(fd); } catch {} }
    const pairs = nFrames - 1;
    const rows = rowSum.map((v, i) => r186Round(v / (pairs * rowPix[i] * workW), 2));
    const cols = colSum.map((v, i) => r186Round(v / (pairs * colPix[i] * workH), 2));
    return { rows, cols, frames: nFrames };
  } catch { return null; } finally { try { fs.unlinkSync(tmp); } catch {} }
}
// One axis's decision from its 8 band energies: decisive
// or not, and — when the window also passes the
// removed/kept bounds — the crop in source pixels
// ({ start, keep } along an axis of length len).
function r203AxisPlan(e, len) {
  const peak = Math.max(...e);
  const sorted = [...e].sort((a, b) => a - b);
  const median = sorted[3]; // the lower median — the background level (see the banner)
  const axis = { peak: r186Round(peak, 2), median: r186Round(median, 2), decisive: false, crop: null };
  if (!(peak >= R203_MIN_PEAK && peak >= R203_RATIO * median)) return axis;
  axis.decisive = true;
  const th = R203_BAND_FRAC * peak;
  let lo = 8, hi = -1;
  e.forEach((v, i) => { if (v >= th) { if (i < lo) lo = i; if (i > hi) hi = i; } });
  const wlo = Math.max(0, lo - 1), whi = Math.min(7, hi + 1);
  axis.actionBands = [lo, hi];
  axis.windowBands = [wlo, whi];
  const evenDn = (v) => Math.max(0, Math.floor(v / 2) * 2);
  const start = evenDn((wlo * len) / 8);
  const keep = evenDn(((whi + 1) * len) / 8) - start;
  if (keep > 0 && len - keep >= R203_MIN_REMOVE * len && keep >= R203_MIN_KEEP * len) axis.crop = { start, keep };
  else axis.veto = `window keeps ${keep}/${len}px — outside the ${(R203_MIN_REMOVE * 100) | 0}%-removed / ${(R203_MIN_KEEP * 100) | 0}%-kept bounds`;
  return axis;
}
async function r203Encode(bins, abs, tmpOut, rect) {
  return r138SerializeFfmpeg(() => r203EncodeNow(bins, abs, tmpOut, rect));
}
async function r203EncodeNow(bins, abs, tmpOut, rect) {
  // The Round 186 encode spec (libx264 CRF 23 / yuv420p /
  // AAC 128k / faststart / no global metadata — the
  // kids'-platform GPS rule binds every display file),
  // plus this round's one move: the crop to the action
  // band.
  const args = ["-nostats", "-y", "-i", abs, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1",
    "-vf", `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-threads", "2", tmpOut];
  const { err, stderr } = await r124Run(bins.ffmpeg, args, 600000);
  if (err) { console.error("[r203] encode failed:", err.message, stderr.slice(-300)); return false; }
  return true;
}
// Merge this round's evaluation into the play's
// enhance_json (the Round 186 report and the r195 key,
// when they exist, are preserved) and stamp
// r203_checked_at in the same write — the stamp is what
// the boot backfill selects on.
function r203StoreEval(id, r203) {
  const row = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
  let obj = {};
  if (row && row.enhance_json) { try { obj = JSON.parse(row.enhance_json); } catch { obj = {}; } }
  obj.r203 = r203;
  db.prepare("UPDATE highlights SET enhance_json=?, r203_checked_at=? WHERE id=?").run(JSON.stringify(obj), new Date().toISOString(), id);
}
// Evaluate one play and reframe it when the measurement
// calls for it. Shared by the upload chain (origin
// "upload") and the boot backfill (origin "backfill") —
// and those two callers can meet on the same fresh
// upload, so evaluations of one play are serialized
// through a per-play promise gate, exactly as in Round
// 195: two evaluators share the temp/output paths, and
// an unserialized pair could rename a half-written
// encode into place. A second caller waits, then
// evaluates fresh against whatever the first left
// (usually: the stamp + recorded outcome, and nothing to
// do). Never throws; returns the tallies the backfill
// summary reports. The stamp is written only when the
// evaluation actually completed — a detector or encode
// failure leaves it empty so a later boot retries.
const r203InFlight = new Map();
async function r203ProcessPlay(bins, id, origin) {
  while (r203InFlight.has(id)) { try { await r203InFlight.get(id); } catch {} }
  const p = r203ProcessPlayNow(bins, id, origin);
  r203InFlight.set(id, p);
  try { return await p; } finally { if (r203InFlight.get(id) === p) r203InFlight.delete(id); }
}
async function r203ProcessPlayNow(bins, id, origin) {
  const out = { reframed: 0 };
  try {
    const row = db.prepare("SELECT media_kind, media_url, stream_url, enhance_json FROM highlights WHERE id=?").get(id);
    if (!row || row.media_kind !== "file") return out;
    const name = path.basename(row.media_url || "");
    if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return out;
    const abs = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return out; // missing file: a later boot retries — never stamp it
    const info = r124VideoInfo(await r124Probe(bins, abs));
    const r203 = { at: new Date().toISOString(), origin, status: null, srcW: 0, srcH: 0, rowBands: null, colBands: null, rows: null, cols: null, crop: null, outputFile: null, preservedFile: null };
    if (!info || !info.width || !info.height) {
      // A file play that does not probe as video:
      // evaluated, nothing to do, stamped so backfill
      // scans stay cheap and the file is left exactly as
      // it is.
      r203.status = "not-video";
      r203StoreEval(id, r203);
      return out;
    }
    r203.srcW = info.dispWidth;
    r203.srcH = info.dispHeight;
    let prior = null;
    if (row.enhance_json) { try { prior = JSON.parse(row.enhance_json).r203 || null; } catch { prior = null; } }
    if (prior && prior.status === "reframed") {
      // Already reframed once — never twice. The recorded
      // outcome is carried into this evaluation (belt to
      // the stamp's suspenders, as in Round 195).
      r203StoreEval(id, { ...prior, at: new Date().toISOString(), origin });
      return out;
    }
    if (process.env.HH_NO_REFRAME === "1") {
      r203.status = "skipped";
      r203.reason = "HH_NO_REFRAME=1";
      r203StoreEval(id, r203);
      console.log(`[r203] play ${id}: evaluated — reframe skipped (HH_NO_REFRAME=1) (display file unchanged)`);
      return out;
    }
    const bands = await r203BandEnergies(bins, abs, info);
    if (!bands) { console.error(`[r203] play ${id}: band measurement failed — left unstamped for a later retry`); return out; }
    r203.rowBands = bands.rows;
    r203.colBands = bands.cols;
    const rowsPlan = r203AxisPlan(bands.rows, info.dispHeight);
    const colsPlan = r203AxisPlan(bands.cols, info.dispWidth);
    r203.rows = { peak: rowsPlan.peak, median: rowsPlan.median, decisive: rowsPlan.decisive };
    r203.cols = { peak: colsPlan.peak, median: colsPlan.median, decisive: colsPlan.decisive };
    if (rowsPlan.actionBands) { r203.rows.actionBands = rowsPlan.actionBands; r203.rows.windowBands = rowsPlan.windowBands; }
    if (colsPlan.actionBands) { r203.cols.actionBands = colsPlan.actionBands; r203.cols.windowBands = colsPlan.windowBands; }
    const vetoes = [];
    if (rowsPlan.veto) vetoes.push(`rows: ${rowsPlan.veto}`);
    if (colsPlan.veto) vetoes.push(`cols: ${colsPlan.veto}`);
    let rect = null;
    if (rowsPlan.crop || colsPlan.crop) {
      rect = {
        x: colsPlan.crop ? colsPlan.crop.start : 0,
        y: rowsPlan.crop ? rowsPlan.crop.start : 0,
        w: colsPlan.crop ? colsPlan.crop.keep : info.dispWidth,
        h: rowsPlan.crop ? rowsPlan.crop.keep : info.dispHeight,
      };
      if (Math.min(rect.w, rect.h) < R203_MIN_DIM) { vetoes.push(`output ${rect.w}x${rect.h} is under the ${R203_MIN_DIM}px smaller-dimension floor`); rect = null; }
      else if (rect.w * rect.h < R203_MIN_AREA * info.dispWidth * info.dispHeight) { vetoes.push(`output ${rect.w}x${rect.h} keeps under ${(R203_MIN_AREA * 100) | 0}% of the source area`); rect = null; }
    }
    if (!rect) {
      r203.status = "no-reframe";
      if (vetoes.length) r203.veto = vetoes.join("; ");
      r203StoreEval(id, r203);
      console.log(`[r203] play ${id}: evaluated — no reframe (rows peak ${r203.rows.peak} vs background ${r203.rows.median}; cols peak ${r203.cols.peak} vs background ${r203.cols.median}) (display file unchanged)`);
      return out;
    }
    // ---- the one encode ----
    const base = name.replace(/\.[^.]+$/, "");
    const tmpOut = path.join(UPLOAD_DIR, `${base}.r203tmp.mp4`);
    const finalName = `${base}-reframed.mp4`;
    try {
      if (!(await r203Encode(bins, abs, tmpOut, rect))) { try { fs.unlinkSync(tmpOut); } catch {} return out; }
      const outInfo = r124VideoInfo(await r124Probe(bins, tmpOut));
      const verified = outInfo && outInfo.codec === "h264" && outInfo.pixFmt === "yuv420p" && r124IsFaststart(tmpOut)
        && Math.abs(outInfo.width - rect.w) <= 2 && Math.abs(outInfo.height - rect.h) <= 2
        && Math.abs(outInfo.duration - info.duration) <= 0.75;
      if (!verified) {
        try { fs.unlinkSync(tmpOut); } catch {}
        console.error(`[r203] play ${id}: output did not verify (codec/dims/duration) — display file kept`);
        return out;
      }
      const rowNow = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
      if (!rowNow || path.basename(rowNow.media_url || "") !== name) {
        try { fs.unlinkSync(tmpOut); } catch {}
        console.log(`[r203] play ${id}: media changed since evaluation — standing down`);
        return out;
      }
      // Swap order matters (the Round 186 discipline):
      // the new file lands first, then the current
      // display file is preserved under its
      // pre-enhancement name, and only then does the row
      // move — at every instant the row points at a file
      // that exists.
      let preName = `${base}-preenhance.mp4`;
      if (fs.existsSync(path.join(UPLOAD_DIR, preName))) preName = `${base}-preenhance-${Date.now()}.mp4`;
      fs.renameSync(tmpOut, path.join(UPLOAD_DIR, finalName));
      fs.renameSync(abs, path.join(UPLOAD_DIR, preName));
      db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${finalName}`, id);
      r203.status = "reframed";
      r203.crop = rect;
      r203.outputFile = finalName;
      r203.preservedFile = preName;
      await r124PosterFor(bins, id, path.join(UPLOAD_DIR, finalName), outInfo);
      // A rendition made from the pre-reframe file is
      // stale: drop it and make a fresh one from the new
      // master (Round 192's own kill switch still binds).
      // →209: the ensure runs unconditionally after the
      // swap — the same boot-interleaving fix as the
      // Round 195 swap above (a straddling Round 192 scan
      // plus an empty stream_url otherwise leaves the play
      // rendition-less until the next boot).
      const rowAfter = db.prepare("SELECT stream_url FROM highlights WHERE id=?").get(id);
      if (rowAfter && rowAfter.stream_url) {
        try { fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(rowAfter.stream_url))); } catch {}
        db.prepare("UPDATE highlights SET stream_url='' WHERE id=?").run(id);
      }
      await r192EnsureStream(bins, id);
      r203StoreEval(id, r203);
      out.reframed = 1;
      console.log(`[r203] play ${id}: reframed ${info.dispWidth}x${info.dispHeight} → ${rect.w}x${rect.h} (crop x${rect.x} y${rect.y}) → ${finalName}; previous display file kept as ${preName}`);
    } catch (e) {
      try { fs.unlinkSync(tmpOut); } catch {}
      console.error(`[r203] play ${id}: stage failed (display file kept):`, e.message);
      return out;
    }
  } catch (e) { console.error(`[r203] play ${id}: evaluation failed (display file kept):`, e.message); }
  return out;
}
// The upload-pipeline stage: chained after the Round 195
// stage settles and before the Round 192 rendition, so
// everything downstream is made from the final file.
// Catch-all inside, like every stage on this chain.
async function r203AfterR195(id) {
  try {
    const bins = await r124ResolveBins();
    if (!bins) return;
    await r203ProcessPlay(bins, id, "upload");
  } catch (e) { console.error(`[r203] upload ${id}: reframe stage error (display file kept):`, e.message); }
}
// Boot-time backfill: existing plays are evaluated once —
// sequentially, behind the same ffmpeg serializer, never
// blocking startup. Selection is the empty
// r203_checked_at stamp, so a boot that finds everything
// evaluated costs one query, a partial run simply finishes
// on the next boot, and a play processed at upload is
// never selected. The summary line is the deploy
// verification's read: what was reframed.
async function r203Backfill() {
  try {
    if (process.env.HH_NO_REFRAME === "1") { console.log("[r203] backfill disabled via HH_NO_REFRAME"); return; }
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r203] backfill deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id FROM highlights WHERE media_kind='file' AND status!='trashed' AND (r203_checked_at='' OR r203_checked_at IS NULL)").all();
    let reframed = 0;
    for (const row of rows) {
      try {
        const o = await r203ProcessPlay(bins, row.id, "backfill");
        reframed += o.reframed;
      } catch (e) { console.error(`[r203] backfill row ${row.id} failed:`, e.message); }
    }
    console.log(`[r203] backfill complete (${reframed} reframed, ${rows.length} file plays scanned)`);
  } catch (e) { console.error("[r203] backfill error:", e.message); }
}

/* ================= Round 209 (2026-11-26): smart poster — the poster is picked for the action =================
   WHY: Emil, on the Hype of the Month leaderboard (2026-11-26):
   the poster is doing no work — "On Nicholas's double, I see
   the button and the fence before I can tell where Nicholas
   is… For Nicholas, show the swing or him rounding first.
   For Juliana, show the tag at home. A well-chosen frame
   makes a bigger difference than enlarging a wide shot."
   The client half of this round grows the ranked rows'
   thumbnails (~40% of the row) and moves the play icon to a
   corner chip; this stage is the server half: the poster
   itself is re-picked at the action.
   METHOD: (1) a motion series — mean absolute frame-
   difference luma over time on a small gray working copy,
   the same decode discipline as Round 203's band energies —
   smoothed over 3 samples; the peak is decisive only when
   it clears an absolute floor AND 3× the series' background
   (lower median). A flat series (locked-off shot, uniform
   motion) has no peak worth chasing: the existing poster is
   KEPT — no churn. (2) Around the peak (±1s at 3fps) each
   candidate frame is scored with ffmpeg's blurdetect filter
   (verified present in this environment's ffmpeg 8.1.2, and
   verified discriminating: a sharp testsrc2 frame scores
   ~4.9, the same frame gaussian-blurred scores ~19.7 —
   lower is sharper) plus signalstats mean luma; near-black
   candidates are disqualified — mean luma < 10 absolutely
   (the Round 205 client rule) and, because blurdetect reads
   a flat dark frame as "sharp", also any candidate under
   35% of the brightest candidate's luma — and the sharpest
   survivor is grabbed at
   full size into the SAME poster path the app already
   serves (poster-<id>.jpg) — no client change is needed for
   the new poster to appear on boards, the feed, the
   leaderboard and the studio. If blurdetect yields nothing
   parseable, the fallback is the frame AT the peak.
   INTEGRATION: one stage chained after Round 203 (which
   itself rides after R195/R186), so the poster always
   reflects the final framing — R203 regenerates the poster
   when it reframes, and this stage then re-picks from the
   reframed file. Plays with a hand-set Round 124 freeze
   override (R124_FREEZE_OVERRIDES — a human already chose
   that frame) are kept as-is. Photo and link plays never
   enter. Every outcome is recorded under `r209` in
   highlights.enhance_json, and highlights.r209_checked_at
   is stamped as the evaluation completes — the boot
   backfill selects on the empty stamp.
   HH_NO_SMARTPOSTER=1 disables the stage (recorded as
   skipped; the rest of the chain is unaffected).
   FALLBACK CONTRACT (the house rule): best-effort, never a
   gate — any failure keeps the current poster, leaves the
   stamp empty for a later retry, and logs why.
   ROUND 213 ADDENDUM (2026-11-26, Emil, from the live
   site): the first library re-pick made one poster WORSE.
   Juliana's "Caught stealing home!" is a GameChanger
   screen recording whose last ~2 seconds rotate to
   portrait — the app switches to its game page, the video
   shrinks to a sideways sliver and play-by-play text
   fills the frame. That rotation changes the whole frame
   at once, so the motion series peaked there and the
   razor-sharp UI text won the sharpness score; the old
   poster (a clean field frame) was better. Two guards
   now fence the peak search:
     * INTERIOR WINDOW — candidacy (the peak search AND
       the ±1s candidate window) is restricted to the
       clip's interior: the first max(1.0s, 8% of the
       duration) and the last max(2.5s, 12%) are excluded,
       because the head and tail are where screen
       recordings keep their junk (menus, the phone
       rotating as the parent lowers it). A clip too short
       for the exclusions to leave a usable window falls
       back to the full range. The window used is recorded
       in the report (`window`).
     * CONCENTRATION — every motion step is also scored
       for how UNIFORMLY the frame changed (the share of
       grid blocks whose own change reaches a quarter of
       the frame's mean change, at real magnitude). Real
       action concentrates — part of the frame moves, the
       rest is fence and grass; a rotation, an app-page
       takeover or a hard cut redraws ~everything at once.
       A transition-class step (share ≥ 0.90) cannot be
       the peak and cannot lend its magnitude to a
       neighbour's smoothed score (tier 1); if no decisive
       non-transition peak exists, the search falls back
       to the plain in-window peak (tier 2), so a clip
       whose action IS broad still gets its poster. The
       tier that fired and the transition-step count are
       recorded (`tier`, `transSteps`).
   Every evaluation under these rules stamps
   r213_checked_at alongside r209_checked_at, and the
   boot backfill selects on either stamp being empty —
   so the whole library is re-evaluated exactly once
   under Round 213, hand-set Round 124 overrides
   included-out (they still land on kept-override and are
   never re-picked). */
const R209_SAMPLE_FPS = 5;       // motion-series sampling rate on the working copy
const R209_SCAN_SEC = 60;        // analysis window cap (mirrors Round 203)
const R209_WORK_MAX_W = 360;     // working-copy width cap
const R209_WORK_MAX_H = 960;     // working-copy height cap
const R209_MIN_PEAK = 3;         // absolute decisiveness floor (full-frame mean luma-difference units)
const R209_RATIO = 3;            // peak must clear 3× the background (lower-median) level
const R209_CAND_FPS = 3;         // candidate sampling rate around the peak
const R209_CAND_HALF_SEC = 1;    // candidate window half-width (±1s)
const R209_CAND_MAX_W = 480;     // candidate scoring width cap (scores are relative within a clip)
const R209_LUMA_FLOOR = 10;      // near-black disqualifier (mean luma), cf. Round 205's client rule
// Round 213: the interior window (see the addendum
// above). Head/tail exclusions are the larger of a floor
// and a fraction of the duration; if they would leave
// less than R213_MIN_WINDOW_SEC of candidacy the window
// falls back to the full range (today's behavior).
const R213_HEAD_MIN_SEC = 1.0;   // head exclusion floor (s)
const R213_HEAD_FRAC = 0.08;     // head exclusion fraction of duration
const R213_TAIL_MIN_SEC = 2.5;   // tail exclusion floor (s)
const R213_TAIL_FRAC = 0.12;     // tail exclusion fraction of duration
const R213_MIN_WINDOW_SEC = 0.5; // smallest usable interior window (s)
// Round 213: the concentration guard (see the addendum
// above). The working frame is divided into a grid
// (6×4 landscape, 4×6 portrait); a block counts as
// changed when its own mean change reaches
// R213_BLOCK_FRAC of the frame's mean change, and a step
// is transition-class when at least R213_TRANS_SHARE of
// the blocks changed while the step's own magnitude is
// real (≥ R209_MIN_PEAK — a near-zero step is just a
// quiet frame pair, whatever its share says).
const R213_GRID_WIDE = [6, 4];   // [cols, rows] when width ≥ height
const R213_GRID_TALL = [4, 6];   // [cols, rows] when height > width
const R213_BLOCK_FRAC = 0.25;    // block-changed threshold, as a fraction of the frame mean change
const R213_TRANS_SHARE = 0.90;   // transition-class share cutoff
// The interior candidacy window of one clip, in seconds
// [start, end]. A non-positive or unknown duration, and
// a clip whose exclusions would leave less than the
// minimum usable window, both fall back to the full
// range — the pre-213 behavior.
function r213Window(duration) {
  const d = Number(duration) || 0;
  if (!(d > 0)) return [0, 0];
  const head = Math.max(R213_HEAD_MIN_SEC, R213_HEAD_FRAC * d);
  const tail = Math.max(R213_TAIL_MIN_SEC, R213_TAIL_FRAC * d);
  if (d - tail - head < R213_MIN_WINDOW_SEC) return [0, r186Round(d, 3)];
  return [r186Round(head, 3), r186Round(d - tail, 3)];
}
// The per-frame-pair motion series of one display file:
// mean absolute luma difference per pair on a small gray
// working copy, decoded once into a temp raw file that is
// always cleaned up. Round 213: the same pass also scores
// each step's concentration — the share of grid blocks
// whose own mean change reaches R213_BLOCK_FRAC of the
// frame's mean change (see the addendum above). Returns
// { series, shares, frames } (values rounded for the
// report) or null when the measurement itself failed —
// the caller treats null as "never re-pick, never stamp".
async function r209MotionSeries(bins, abs, info) {
  // Round 224: DISPLAY dims — the working copy is decoded
  // (autorotated) frames; its shape and the Round 213 grid
  // orientation follow the displayed picture.
  const s = Math.min(1, R209_WORK_MAX_W / info.dispWidth, R209_WORK_MAX_H / info.dispHeight);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  const workW = even(info.dispWidth * s), workH = even(info.dispHeight * s);
  const base = path.basename(abs).replace(/\.[^.]+$/, "");
  const tmp = path.join(UPLOAD_DIR, `${base}.r209tmp.raw`);
  try {
    const { err } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-y", "-i", abs, "-vf", `fps=${R209_SAMPLE_FPS},scale=${workW}:${workH},format=gray`, "-t", String(R209_SCAN_SEC), "-f", "rawvideo", tmp], 300000));
    if (err) return null;
    const frameSize = workW * workH;
    const nFrames = Math.floor(fs.statSync(tmp).size / frameSize);
    if (!(nFrames >= 2) || frameSize <= 0) return null;
    // Round 213 grid geometry: per-pixel block lookup,
    // precomputed once per measurement.
    const [gCols, gRows] = workW >= workH ? R213_GRID_WIDE : R213_GRID_TALL;
    const nBlocks = gCols * gRows;
    const bw = workW / gCols, bh = workH / gRows;
    const colOf = new Uint8Array(workW), rowBase = new Uint16Array(workH), blockPx = new Float64Array(nBlocks);
    for (let x = 0; x < workW; x++) colOf[x] = Math.min(gCols - 1, Math.floor(x / bw));
    for (let y = 0; y < workH; y++) { rowBase[y] = Math.min(gRows - 1, Math.floor(y / bh)) * gCols; for (let x = 0; x < workW; x++) blockPx[rowBase[y] + colOf[x]]++; }
    const series = [], shares = [];
    const fd = fs.openSync(tmp, "r");
    try {
      let prev = Buffer.alloc(frameSize), cur = Buffer.alloc(frameSize);
      if (fs.readSync(fd, prev, 0, frameSize, 0) < frameSize) return null;
      const blockSum = new Float64Array(nBlocks);
      for (let f = 1; f < nFrames; f++) {
        if (fs.readSync(fd, cur, 0, frameSize, f * frameSize) < frameSize) break;
        blockSum.fill(0);
        let sum = 0;
        for (let y = 0; y < workH; y++) {
          const rb = rowBase[y], ro = y * workW;
          for (let x = 0; x < workW; x++) {
            const i = ro + x;
            const d = cur[i] - prev[i];
            if (d !== 0) { const a = d < 0 ? -d : d; sum += a; blockSum[rb + colOf[x]] += a; }
          }
        }
        const mean = sum / frameSize;
        series.push(r186Round(mean, 2));
        // The concentration share. A zero-change step has
        // no meaningful share (its threshold would be 0
        // and every noisy block would count) — record 0;
        // the transition classification in r209PeakOf
        // additionally requires real magnitude.
        let share = 0;
        if (mean > 0) {
          const blockThresh = R213_BLOCK_FRAC * mean;
          let changed = 0;
          for (let j = 0; j < nBlocks; j++) if (blockSum[j] / blockPx[j] >= blockThresh) changed++;
          share = changed / nBlocks;
        }
        shares.push(r186Round(share, 2));
        const swap = prev; prev = cur; cur = swap;
      }
    } finally { try { fs.closeSync(fd); } catch {} }
    return { series, shares, frames: nFrames };
  } catch { return null; } finally { try { fs.unlinkSync(tmp); } catch {} }
}
// The decisive peak of a motion series, Round 213 rules:
// the background is the lower median of the RAW smoothed
// series (the clip's typical motion level — brief
// transitions cannot move a median); the peak search is
// restricted to the interior-window index range
// [iMin, iMax]. Tier 1 searches a capped series —
// transition-class steps (Round 213 concentration guard)
// are capped at the background level, so they can
// neither win nor lend magnitude to a neighbour's
// smoothed score, and are not themselves candidates.
// Tier 2 is the plain in-window peak of the raw smoothed
// series, used when tier 1 has no decisive candidate.
// `peak` reports the raw smoothed value at the chosen
// index in both tiers (the decision value for tier 1 is
// the capped one). Returns { peak, background, peakIdx,
// decisive, tier, transSteps }.
function r209PeakOf(series, shares, iMin, iMax) {
  const smooth = (a) => a.map((_, i) => {
    const x = a[Math.max(0, i - 1)], b = a[i], c = a[Math.min(a.length - 1, i + 1)];
    return (x + b + c) / 3;
  });
  const sm = smooth(series);
  const sorted = [...sm].sort((a, b) => a - b);
  const background = sorted[Math.floor((sorted.length - 1) / 2)] || 0;
  const lo = Math.max(0, iMin | 0), hi = Math.min(series.length - 1, iMax === undefined ? series.length - 1 : iMax);
  const isTrans = (i) => series[i] >= R209_MIN_PEAK && (shares ? shares[i] || 0 : 0) >= R213_TRANS_SHARE;
  let transSteps = 0;
  for (let i = 0; i < series.length; i++) if (isTrans(i)) transSteps++;
  const decisive = (v) => series.length >= 3 && v >= R209_MIN_PEAK && v >= R209_RATIO * background;
  if (hi >= lo) {
    const capped = series.map((v, i) => (isTrans(i) ? Math.min(v, background) : v));
    const smCap = smooth(capped);
    let t1 = -1;
    for (let i = lo; i <= hi; i++) { if (isTrans(i)) continue; if (t1 < 0 || smCap[i] > smCap[t1]) t1 = i; }
    if (t1 >= 0 && decisive(smCap[t1])) {
      return { peak: r186Round(sm[t1], 2), background: r186Round(background, 2), peakIdx: t1, decisive: true, tier: 1, transSteps };
    }
    let peakIdx = lo;
    for (let i = lo + 1; i <= hi; i++) if (sm[i] > sm[peakIdx]) peakIdx = i;
    const peak = sm[peakIdx] || 0;
    return { peak: r186Round(peak, 2), background: r186Round(background, 2), peakIdx, decisive: decisive(peak), tier: 2, transSteps };
  }
  return { peak: 0, background: r186Round(background, 2), peakIdx: 0, decisive: false, tier: 2, transSteps };
}
// Score the candidate frames around the peak: one ffmpeg
// pass at R209_CAND_FPS over the window, blurdetect +
// signalstats metadata printed to stderr and parsed in
// frame order. Returns [{ t, blur, luma }] or null when
// nothing parseable came back (the caller falls back to
// the peak frame itself).
async function r209Candidates(bins, abs, peakTime, duration, winStart, winEnd) {
  let start = Math.max(0, peakTime - R209_CAND_HALF_SEC);
  let end = duration > 0 ? Math.min(duration, peakTime + R209_CAND_HALF_SEC) : peakTime + R209_CAND_HALF_SEC;
  // Round 213: the candidate window is clamped to the
  // interior window as well — a peak near the window's
  // edge must not let candidacy leak back into the
  // excluded head or tail.
  if (winEnd > winStart) { start = Math.max(start, winStart); end = Math.min(end, winEnd); }
  if (!(end > start)) return null;
  const run = () => r124Run(bins.ffmpeg, ["-nostats", "-y", "-ss", String(r186Round(start, 3)), "-i", abs,
    "-vf", `fps=${R209_CAND_FPS},scale=${R209_CAND_MAX_W}:-2,blurdetect,signalstats,metadata=print:key=lavfi.blur,metadata=print:key=lavfi.signalstats.YAVG`,
    "-t", String(r186Round(end - start, 3)), "-f", "null", "-"], 120000);
  const { err, stderr } = await r138SerializeFfmpeg(run);
  if (err) return null;
  // Round 213: the metadata stream is parsed as ONE
  // ordered sequence — each frame prints a header
  // carrying its pts_time (relative to the seek point),
  // then its blur value, then its luma — and the three
  // are bound together per frame. The original code
  // collected blurs and lumas with two independent
  // regexes and zipped them by index. That silently
  // misaligned whenever blurdetect reported "-nan" on a
  // flat frame (the numeric regex dropped the entry,
  // shifting every later blur onto the wrong frame).
  // A NaN blur is kept as Infinity here: unmeasurable
  // sharpness never wins, but the frame keeps its time
  // and luma. A frame whose header time is missing
  // falls back to its index.
  // The candidate time points at the END of the frame's
  // fps slot (minus a small epsilon): the fps filter
  // emits, for each output slot, the LAST source frame
  // that rounds into it, so the frame actually scored
  // lives at the slot's end, not its start — pointing
  // the poster grab at the slot's start can land it on
  // the wrong side of a hard content boundary a full
  // slot earlier (a black head frame instead of the
  // action frame that won).
  const slotGrab = 1 / R209_CAND_FPS - 0.05;
  const out = [];
  let pendingT = null, pendingBlur = null;
  for (const m of stderr.matchAll(/pts_time:([\d.]+)|lavfi\.blur=(\S+)|lavfi\.signalstats\.YAVG=([\d.]+)/g)) {
    if (m[1] !== undefined) { pendingT = Number(m[1]); }
    else if (m[2] !== undefined) { const b = Number(m[2]); pendingBlur = Number.isFinite(b) ? b : Infinity; }
    else if (m[3] !== undefined) {
      out.push({ t: r186Round(start + (pendingT !== null ? pendingT : out.length / R209_CAND_FPS) + slotGrab, 3), blur: pendingBlur !== null ? pendingBlur : Infinity, luma: Number(m[3]) });
      pendingT = null; pendingBlur = null;
    }
  }
  if (!out.length) return null;
  return out;
}
// Merge this round's evaluation into the play's
// enhance_json (the Round 186 report and the r195/r203
// keys, when they exist, are preserved) and stamp
// r209_checked_at in the same write — the stamp is what
// the boot backfill selects on. Round 213: r213_checked_at
// is stamped in the same write — every evaluation now
// runs under the Round 213 rules, and the backfill
// selects on either stamp being empty, so a play stamped
// under the original Round 209 rules is re-evaluated
// exactly once.
function r209StoreEval(id, r209) {
  const row = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
  let obj = {};
  if (row && row.enhance_json) { try { obj = JSON.parse(row.enhance_json); } catch { obj = {}; } }
  obj.r209 = r209;
  const ts = new Date().toISOString();
  db.prepare("UPDATE highlights SET enhance_json=?, r209_checked_at=?, r213_checked_at=? WHERE id=?").run(JSON.stringify(obj), ts, ts, id);
}
// Evaluate one play and re-pick its poster at the action
// when the measurement calls for it. Shared by the upload
// chain (origin "upload") and the boot backfill (origin
// "backfill") — serialized per play through the same
// promise-gate discipline as Rounds 195/203. Never throws;
// returns the tallies the backfill summary reports. The
// stamp is written only when the evaluation actually
// completed — a measurement failure leaves it empty so a
// later boot retries.
const r209InFlight = new Map();
async function r209ProcessPlay(bins, id, origin) {
  while (r209InFlight.has(id)) { try { await r209InFlight.get(id); } catch {} }
  const p = r209ProcessPlayNow(bins, id, origin);
  r209InFlight.set(id, p);
  try { return await p; } finally { if (r209InFlight.get(id) === p) r209InFlight.delete(id); }
}
async function r209ProcessPlayNow(bins, id, origin) {
  // A sibling boot scan (Round 195's trim, Round 203's
  // reframe) can swap a play's display file while this
  // stage is evaluating the old one — the poster grab then
  // fails on a file that was renamed away. That is not a
  // failure of this stage: the evaluation signals a retry
  // and this wrapper re-evaluates the CURRENT file (the
  // sibling's swap is complete by then — its rename is
  // what broke the grab). Bounded at 3 attempts; beyond
  // that the play stays unstamped for the next boot, the
  // house fallback.
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await r209EvaluateOnce(bins, id, origin);
    if (!out.retry) return out;
    console.log(`[r209] play ${id}: display file changed mid-evaluation — re-evaluating the current file`);
  }
  return { picked: 0 };
}
async function r209EvaluateOnce(bins, id, origin) {
  const out = { picked: 0 };
  try {
    const row = db.prepare("SELECT media_kind, media_url, poster_url FROM highlights WHERE id=?").get(id);
    if (!row || row.media_kind !== "file") return out;
    const name = path.basename(row.media_url || "");
    if (!name || !/\.(mp4|mov|webm|avi|m4v)$/i.test(name)) return out;
    const abs = path.join(UPLOAD_DIR, name);
    if (!fs.existsSync(abs)) return out; // missing file: a later boot retries — never stamp it
    const info = r124VideoInfo(await r124Probe(bins, abs));
    const r209 = { at: new Date().toISOString(), origin, status: null, peakTime: null, chosenTime: null, method: null, peak: null, background: null, candidates: 0, v: 213, window: null, tier: null, transSteps: null };
    if (!info || !info.width || !info.height) {
      // A file play that does not probe as video:
      // evaluated, nothing to do, stamped so backfill
      // scans stay cheap (photo plays land here too when
      // the backfill meets one under a video name).
      r209.status = "not-video";
      r209StoreEval(id, r209);
      return out;
    }
    if (process.env.HH_NO_SMARTPOSTER === "1") {
      r209.status = "skipped";
      r209.reason = "HH_NO_SMARTPOSTER=1";
      r209StoreEval(id, r209);
      console.log(`[r209] play ${id}: evaluated — smart poster skipped (HH_NO_SMARTPOSTER=1) (poster unchanged)`);
      return out;
    }
    if (typeof R124_FREEZE_OVERRIDES[id] === "number") {
      // A human already hand-chose this play's freeze
      // frame (Round 124) — the hand pick stands.
      r209.status = "kept-override";
      r209.chosenTime = R124_FREEZE_OVERRIDES[id];
      r209.method = "freeze-override";
      r209StoreEval(id, r209);
      console.log(`[r209] play ${id}: evaluated — hand-set freeze override kept (poster unchanged)`);
      return out;
    }
    const motion = await r209MotionSeries(bins, abs, info);
    if (!motion) {
      const rowGone = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
      if (!rowGone || path.basename(rowGone.media_url || "") !== name) { out.retry = true; return out; }
      console.error(`[r209] play ${id}: motion measurement failed — left unstamped for a later retry`);
      return out;
    }
    // Round 213: restrict candidacy to the clip's
    // interior window. Step i of the series is the frame
    // pair ending at (i+1)/FPS — the same basis peakTime
    // is reported on — so the window in seconds converts
    // to an index range on that basis. A window that
    // would leave no index (defensive; r213Window already
    // falls back to the full range) restores full-range
    // indices.
    const [winStart, winEnd] = r213Window(info.duration || 0);
    r209.window = [winStart, winEnd];
    let iMin = 0, iMax = motion.series.length - 1;
    if (winEnd > winStart) {
      iMin = Math.max(0, Math.ceil(winStart * R209_SAMPLE_FPS) - 1);
      iMax = Math.min(motion.series.length - 1, Math.floor(winEnd * R209_SAMPLE_FPS) - 1);
      if (iMax < iMin) { iMin = 0; iMax = motion.series.length - 1; }
    }
    const pk = r209PeakOf(motion.series, motion.shares, iMin, iMax);
    r209.peak = pk.peak;
    r209.background = pk.background;
    r209.tier = pk.tier;
    r209.transSteps = pk.transSteps;
    r209.peakTime = r186Round((pk.peakIdx + 1) / R209_SAMPLE_FPS, 3);
    if (!pk.decisive) {
      r209.status = "kept-flat";
      r209.method = "flat";
      r209StoreEval(id, r209);
      console.log(`[r209] play ${id}: evaluated — no decisive action peak (peak ${pk.peak} vs background ${pk.background}) (poster unchanged)`);
      return out;
    }
    let cands = await r209Candidates(bins, abs, r209.peakTime, info.duration || 0, winStart, winEnd);
    if (cands && pk.tier === 1 && pk.transSteps > 0) {
      // Tier 1 won on a non-transition step: a candidate
      // frame that itself sits on a transition-class step
      // (the UI page a cut lands on is razor-sharp and
      // would otherwise win the sharpness score) is not a
      // candidate. If that empties the list, the caller
      // falls back to the frame at the peak, exactly as
      // when blurdetect yields nothing.
      const isTransAt = (t) => {
        const i = Math.max(0, Math.min(motion.series.length - 1, Math.ceil(t * R209_SAMPLE_FPS) - 1));
        return motion.series[i] >= R209_MIN_PEAK && (motion.shares[i] || 0) >= R213_TRANS_SHARE;
      };
      const kept = cands.filter((c) => !isTransAt(c.t));
      cands = kept.length ? kept : null;
    }
    let chosen = null;
    if (cands && cands.length) {
      r209.candidates = cands.length;
      // The luma gate is RELATIVE as well as absolute:
      // blurdetect reads a flat near-black frame as
      // "sharp" (there is nothing in it to blur), so a
      // dark transition frame at the window's edge could
      // otherwise beat the action. A candidate must clear
      // the absolute near-black floor (10, the Round 205
      // rule) AND reach 35% of the brightest candidate's
      // luma — in a genuinely dark scene every candidate
      // is dim together and the relative gate passes them
      // all, exactly as it should.
      const maxLuma = Math.max(...cands.map((c) => c.luma));
      const lumaGate = Math.max(R209_LUMA_FLOOR, 0.35 * maxLuma);
      r209.lumaGate = r186Round(lumaGate, 1);
      const live = cands.filter((c) => c.luma >= lumaGate);
      if (live.length) {
        live.sort((a, b) => a.blur - b.blur || Math.abs(a.t - r209.peakTime) - Math.abs(b.t - r209.peakTime));
        chosen = live[0];
        r209.method = "blurdetect";
        r209.chosenBlur = chosen.blur;
        r209.chosenLuma = r186Round(chosen.luma, 1);
      }
    }
    if (!chosen) {
      // blurdetect yielded nothing usable (or every
      // candidate was near-black): the frame AT the peak
      // is the fallback — unless the peak itself sits in
      // the near-black set, which the candidate pass just
      // told us; then there is nothing better to show and
      // the existing poster stands.
      if (cands && cands.length) {
        r209.status = "kept-dark";
        r209.method = "blurdetect";
        r209StoreEval(id, r209);
        console.log(`[r209] play ${id}: evaluated — every candidate near the peak is near-black (poster unchanged)`);
        return out;
      }
      chosen = { t: r209.peakTime };
      r209.method = "peak-fallback";
    }
    const chosenTime = info.duration > 0 ? Math.min(chosen.t, Math.max(0, info.duration - 0.1)) : chosen.t;
    r209.chosenTime = r186Round(chosenTime, 3);
    const rowNow = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
    if (!rowNow || path.basename(rowNow.media_url || "") !== name) { out.retry = true; return out; }
    const posterName = `poster-${id}.jpg`;
    if (!(await r124MakePoster(bins, abs, path.join(UPLOAD_DIR, posterName), chosenTime))) {
      const rowGone = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
      if (!rowGone || path.basename(rowGone.media_url || "") !== name) { out.retry = true; return out; }
      console.error(`[r209] play ${id}: poster grab failed — left unstamped for a later retry`);
      return out;
    }
    db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/${posterName}`, id);
    r209.status = "poster";
    r209StoreEval(id, r209);
    out.picked = 1;
    console.log(`[r209] play ${id}: poster re-picked at ${r209.chosenTime}s (peak ${r209.peakTime}s, method ${r209.method}${r209.chosenBlur !== undefined ? `, blur ${chosen.blur}` : ""})`);
  } catch (e) { console.error(`[r209] play ${id}: evaluation failed (poster kept):`, e.message); }
  return out;
}
// The upload-pipeline stage: chained after the Round 203
// reframe stage settles and before the Round 192 rendition,
// so the poster is picked from the final display file.
// Catch-all inside, like every stage on this chain.
async function r209PosterAfterR203(id) {
  try {
    const bins = await r124ResolveBins();
    if (!bins) return;
    await r209ProcessPlay(bins, id, "upload");
  } catch (e) { console.error(`[r209] upload ${id}: smart-poster stage error (poster kept):`, e.message); }
}
// Boot-time backfill: existing plays are evaluated once —
// sequentially, behind the same ffmpeg serializer, never
// blocking startup. Selection is the empty
// r209_checked_at stamp, so a boot that finds everything
// evaluated costs one query, a partial run simply finishes
// on the next boot, and a play processed at upload is
// never selected. Round 213: the selection also admits a
// play whose r213_checked_at is empty — a play evaluated
// under the original Round 209 rules carries the r209
// stamp only, so it is re-evaluated exactly once under
// the Round 213 rules (its evaluation stamps both).
// Round 224: the selection also admits a play with no
// stream rendition — the signature of the un-processed
// state — but a play admitted on that ground alone (both
// stamps already set) is gated on its master still
// probing non-compliant, so a healthy play whose
// rendition is legitimately absent is never re-picked
// (the Round 224 recovery scan normally converts such a
// master and clears the stamps first; this gate is the
// belt to its suspenders, and it still improves the
// poster on the raw file when a conversion is broken).
async function r209Backfill() {
  try {
    if (process.env.HH_NO_SMARTPOSTER === "1") { console.log("[r209] backfill disabled via HH_NO_SMARTPOSTER"); return; }
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r209] backfill deferred — ffmpeg unavailable (will retry next boot)"); return; }
    const rows = db.prepare("SELECT id, media_url, stream_url, r209_checked_at, r213_checked_at FROM highlights WHERE media_kind='file' AND status!='trashed' AND (r209_checked_at='' OR r209_checked_at IS NULL OR r213_checked_at='' OR r213_checked_at IS NULL OR stream_url='' OR stream_url IS NULL)").all();
    let picked = 0;
    for (const row of rows) {
      try {
        if (row.r209_checked_at && row.r213_checked_at && !row.stream_url) {
          // Round 224: admitted only for being
          // rendition-less — confirm the master is still
          // in the un-processed state before re-picking.
          const name = path.basename(row.media_url || "");
          const abs = name ? path.join(UPLOAD_DIR, name) : "";
          let unprocessed = false;
          if (abs && fs.existsSync(abs)) {
            const info = r124VideoInfo(await r124Probe(bins, abs));
            unprocessed = !!info && !r124Compliant(abs, info);
          }
          if (!unprocessed) continue;
        }
        const o = await r209ProcessPlay(bins, row.id, "backfill");
        picked += o.picked;
      } catch (e) { console.error(`[r209] backfill row ${row.id} failed:`, e.message); }
    }
    console.log(`[r209] backfill complete (${picked} posters re-picked, ${rows.length} file plays scanned)`);
  } catch (e) { console.error("[r209] backfill error:", e.message); }
}

/* ================= Round 227 (2026-11-27): poster auto-clean — "no fences at all" =================
   Emil (2026-11-27), after Round 222 shipped the studio's manual
   Remove-the-fence step: "I would still prefer no fences at all."
   So the POSTER of every video play is now checked for a chain-link
   fence and cleaned automatically. Posters only — the video files
   themselves are never touched (the studio's manual step is
   unchanged, and a play's clip stays the real clip).

   HOW IT RUNS: detection first, edit second. The poster frame goes
   to the same Anthropic vision machinery as the upload review
   (AI_VISION_API_KEY / AI_VISION_BASE_URL / AI_VISION_MODEL) with a
   single yes/no question — is a chain-link fence in this frame?
   Only a YES runs the Round 222 fence-removal edit
   (runHfFence222, the runner behind POST /api/hype-frame/
   remove-fence) on the poster, and the cleaned image replaces the
   poster file (re-encoded to JPEG through the ffmpeg serializer so
   poster-<id>.jpg stays an honest JPEG). The pre-clean poster is
   preserved on disk as poster-<id>-preclean.jpg (never publicly
   linked), mirroring the Round 186 -preenhance preservation, so
   the change is reversible by hand.

   BOOKKEEPING / NO LOOPS: the outcome lands in enhance_json as an
   r227 record {decision, at, poster, sig} — decision is "none" (no
   fence), "cleaned", "failed" (detection said yes, the edit or the
   apply failed; the original poster stands), or
   "skipped-unconfigured". sig is the poster file's "size:mtime" —
   a verdict record ("none"/"cleaned"/"failed") settles the poster
   it matches, so each distinct poster is processed exactly once: a
   later smart re-pick (a new poster under the same filename) is
   processed once, and nothing ever loops. A "skipped-unconfigured"
   record settles nothing (Round 228, below).
   If the vision key is missing OR the fence edit is unconfigured,
   the record is "skipped-unconfigured" and the poster is NEVER
   blind-cleaned. A detection ERROR records nothing — the poster is
   retried on the next pass, the house pattern. Kill switch:
   HH_NO_POSTERCLEAN=1 stands the whole stage down (no records, no
   calls).

   WHERE IT RUNS: (1) the upload chain, after the smart poster
   settles and before the rendition + welcome email, so the email
   carries the cleaned poster; (2) a one-time boot backfill in the
   Round 224 style for existing video plays. The backfill doubles
   as the poster_time coverage pass (workstream 2): a play whose
   poster has no recorded frame time (no r209.chosenTime and no
   r227time) gets ONE smart-poster re-pick first — which smart-picks
   and timestamps it — and the resulting poster is then
   detect+cleaned. A play whose r227 verdict record already matches
   its poster is skipped before any of that: healthy, settled plays
   never churn.

   Round 228 (2026-11-27): a "skipped-unconfigured" record does NOT
   settle a poster. It only says the stage could not run at all
   (no vision key / fence edit unconfigured) — if it settled, the
   library posters written while the key was missing would stay
   uncleaned forever even after the key is added. Only a real
   verdict ("none" / "cleaned" / "failed") settles the poster it
   names; skipped plays are reprocessed on the next pass, so the
   first pass after configuration runs for real. */
function r227ReadEnhance227(id) {
  const row = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
  if (!row) return null;
  try { return JSON.parse(row.enhance_json || "{}") || {}; } catch { return {}; }
}
function r227WriteRecord227(id, rec) {
  const obj = r227ReadEnhance227(id);
  if (!obj) return;
  obj.r227 = rec;
  db.prepare("UPDATE highlights SET enhance_json=? WHERE id=?").run(JSON.stringify(obj), id);
}
function r227PosterSig227(absPoster) {
  try { const st = fs.statSync(absPoster); return st.size + ":" + Math.round(st.mtimeMs); } catch { return ""; }
}
/* Round 228: the settle test shared by the upload chain and the
   backfill. A record settles its poster only when it names this
   exact poster file (name + sig) AND carries a real verdict —
   "skipped-unconfigured" is not a verdict (see the block above). */
function r227IsSettled228(rec, posterName, sig) {
  return !!rec && rec.poster === posterName && rec.sig === sig &&
    (rec.decision === "none" || rec.decision === "cleaned" || rec.decision === "failed");
}
function r227Configured228() {
  return !!process.env.AI_VISION_API_KEY && hfFenceConfigured222();
}
async function r227DetectFence227(posterBuf) {
  const base = String(process.env.AI_VISION_BASE_URL || "https://api.anthropic.com").replace(/\/+$/, "");
  const content = [
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: posterBuf.toString("base64") } },
    { type: "text", text: "This is a still frame from a youth sports video. Is a chain-link fence — a metal wire-mesh fence, like a baseball backstop — visible anywhere in this frame, whether between the camera and the scene or anywhere else in the image? Reply with ONLY a JSON object, no other text:\n{\"fence\": true} or {\"fence\": false}" },
  ];
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(base + "/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "content-type": "application/json", "x-api-key": process.env.AI_VISION_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: AI_VISION_MODEL, max_tokens: 60, messages: [{ role: "user", content }] }),
    });
    if (!r.ok) throw new Error("vision model answered " + r.status);
    const j = await r.json();
    const text = (j.content || []).filter((b) => b && b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("vision model returned no JSON");
    return JSON.parse(m[0]).fence === true;
  } finally { clearTimeout(timer); }
}
async function r227ProcessPoster227(bins, id) {
  const out = { cleaned: 0 };
  if (process.env.HH_NO_POSTERCLEAN === "1") return out;
  const row = db.prepare("SELECT media_kind, media_url, poster_url, status, enhance_json FROM highlights WHERE id=?").get(id);
  if (!row || row.status === "trashed" || row.media_kind !== "file" || !row.poster_url) return out;
  if (!/\.(mp4|mov|webm|avi|m4v)$/i.test(path.basename(row.media_url || ""))) return out;
  const posterName = path.basename(row.poster_url);
  const absPoster = path.join(UPLOAD_DIR, posterName);
  if (!fs.existsSync(absPoster)) return out;
  const sig = r227PosterSig227(absPoster);
  let ej = {}; try { ej = JSON.parse(row.enhance_json || "{}") || {}; } catch {}
  const rec = ej.r227;
  if (r227IsSettled228(rec, posterName, sig)) return out; // settled for this exact poster (Round 228: skipped-unconfigured never settles)
  if (!r227Configured228()) {
    r227WriteRecord227(id, { decision: "skipped-unconfigured", at: new Date().toISOString(), poster: posterName, sig });
    return out;
  }
  let fence = false;
  try { fence = await r227DetectFence227(fs.readFileSync(absPoster)); }
  catch (e) { console.error(`[r227] play ${id}: fence detection failed (no record — retried next pass):`, e.message); return out; }
  if (!fence) {
    r227WriteRecord227(id, { decision: "none", at: new Date().toISOString(), poster: posterName, sig });
    return out;
  }
  try {
    fs.copyFileSync(absPoster, path.join(UPLOAD_DIR, `poster-${id}-preclean.jpg`));
    const dataUrl = await runHfFence222(fs.readFileSync(absPoster), "image/jpeg");
    const m = /^data:image\/png;base64,(.+)$/.exec(String(dataUrl || ""));
    if (!m) throw new Error("fence edit returned no PNG");
    const tmpPng = path.join(UPLOAD_DIR, `poster-${id}-clean227.png`);
    fs.writeFileSync(tmpPng, Buffer.from(m[1], "base64"));
    const ok = await r138SerializeFfmpeg(async () => {
      const { err } = await r124Run(bins.ffmpeg, ["-y", "-i", tmpPng, "-q:v", "3", absPoster], 60000);
      return !err;
    });
    try { fs.unlinkSync(tmpPng); } catch {}
    if (!ok) throw new Error("cleaned poster re-encode failed");
    r227WriteRecord227(id, { decision: "cleaned", at: new Date().toISOString(), poster: posterName, sig: r227PosterSig227(absPoster) });
    out.cleaned = 1;
    console.log(`[r227] play ${id}: poster fence-cleaned (pre-clean poster preserved as poster-${id}-preclean.jpg)`);
  } catch (e) {
    console.error(`[r227] play ${id}: poster clean failed (poster kept):`, e.message);
    r227WriteRecord227(id, { decision: "failed", at: new Date().toISOString(), poster: posterName, sig });
  }
  return out;
}
async function r227PosterCleanAfterR209(id) {
  try {
    if (process.env.HH_NO_POSTERCLEAN === "1") return;
    // Round 228: one clear line per upload while unconfigured —
    // uploads are infrequent, and a silent skip is how the missing
    // vision key hid in production. The poster is left as-is and
    // the (unsettled) skipped record retries on a later pass.
    if (!r227Configured228()) console.log(`[r227] upload ${id}: poster auto-clean not configured (vision key or fence edit missing) — poster left as-is; will retry on a later pass`);
    const bins = await r124ResolveBins();
    if (!bins) return;
    await r227ProcessPoster227(bins, id);
  } catch (e) { console.error(`[r227] upload ${id}: poster-clean stage error (poster kept):`, e.message); }
}
async function r227Backfill() {
  try {
    if (process.env.HH_NO_POSTERCLEAN === "1") { console.log("[r227] backfill disabled via HH_NO_POSTERCLEAN"); return; }
    const bins = await r124ResolveBins();
    if (!bins) { console.log("[r227] backfill deferred — ffmpeg unavailable (will retry next boot)"); return; }
    // Round 228: say it once, plainly, when the stage cannot run —
    // a silent skip is how the missing vision key hid in production.
    if (!r227Configured228()) console.log("[r227] backfill: poster auto-clean not configured (vision key or fence edit missing) — posters left as-is; will retry on a later boot");
    const rows = db.prepare("SELECT id, media_url, poster_url, enhance_json FROM highlights WHERE media_kind='file' AND status!='trashed' AND poster_url IS NOT NULL AND poster_url!=''").all();
    let cleaned = 0, repicked = 0;
    for (const row of rows) {
      try {
        if (!/\.(mp4|mov|webm|avi|m4v)$/i.test(path.basename(row.media_url || ""))) continue;
        const posterName = path.basename(row.poster_url || "");
        const absPoster = path.join(UPLOAD_DIR, posterName);
        if (!fs.existsSync(absPoster)) continue;
        let ej = {}; try { ej = JSON.parse(row.enhance_json || "{}") || {}; } catch {}
        const rec = ej.r227;
        if (r227IsSettled228(rec, posterName, r227PosterSig227(absPoster))) continue; // settled — never churn (Round 228: skipped-unconfigured never settles)
        // Poster-time coverage (workstream 2): no recorded frame
        // time for this poster → run the smart-poster re-pick once
        // (it smart-picks AND timestamps), then clean THAT poster.
        const ct227 = ej.r209 ? Number(ej.r209.chosenTime) : NaN;
        const it227 = ej.r227time ? Number(ej.r227time.t) : NaN;
        if (!(Number.isFinite(ct227) && ct227 > 0) && !(Number.isFinite(it227) && it227 > 0)) {
          const o = await r209ProcessPlay(bins, row.id, "backfill");
          if (o && o.picked) repicked++;
        }
        const o2 = await r227ProcessPoster227(bins, row.id);
        cleaned += o2.cleaned;
      } catch (e) { console.error(`[r227] backfill row ${row.id} failed:`, e.message); }
    }
    console.log(`[r227] backfill complete (${cleaned} posters cleaned, ${repicked} posters re-picked, ${rows.length} file plays scanned)`);
  } catch (e) { console.error("[r227] backfill error:", e.message); }
}

/* ================= Round 186 (2026-11-24): upload-time video enhancement agent =================
   WHY: parents upload phone video of youth plays, and a lot of it
   is a shaky, flickery recording of a TV across the room — the
   girls' soccer clip Muse cleaned up by hand on 2026-11-24
   (stabilize + crop to the picture + deflicker) is the type
   specimen. Emil approved automating exactly that judgment: an
   agent that ASSESSES every upload at upload time and applies
   only the fixes the assessment calls for. It runs as a
   fire-and-forget stage chained off the end of r124ProcessUpload
   (which the upload handler awaits — the agent must never hold
   the 201), after the file is compliant, stripped and postered.
   ASSESSMENT (thresholds calibrated 2026-11-24 against the soccer
   screen recording as the positive case and synthetic locked-off /
   smooth-pan clips as negatives; the measured values are in the
   round's test script, test-r186.js):
     * shake — global frame-to-frame translation tracked on tiny
       gray frames over 1-second hops. Handheld wander = a
       substantial per-second shift whose direction cancels
       (inconsistency) or reverses; a deliberate pan is consistent
       and a locked-off shot has no shift, so neither triggers.
     * content frame — cropdetect first (true black borders). If
       it finds nothing, a dark-band scan looks for a screen inside
       the frame: a TV's bezels are uniformly near-black bands,
       which room content essentially never is.
     * flicker — per-strip luma oscillation after detrending. A
       filmed screen's refresh band parks in one strip and pulses
       its brightness while the frame mean stays calm, so the
       strip score sees what a global average cannot.
     * interlace — idet multi-frame tallies, deliberately
       conservative (R186_IDET_MIN_FRAMES / _FRAC): idet
       false-positives on synthetic and high-detail progressive
       content, so only unambiguous interlace earns a re-encode.
     * dead time — black / frozen head and tail intervals.
       REPORT ONLY in v1: nothing is trimmed.
   ADJUSTMENTS — applied only when their assessment trips, in ONE
   encode through the exact Round 124 output spec: yadif (if
   interlaced) → crop (if a content frame was found) → vidstab
   two-pass (if shaky; the detect pass analyzes the SAME
   yadif+crop chain the transform then applies) → deflicker (if
   flickery). A clean clip is a complete no-op: no encode, no
   rename, no poster change. The editorial push-in zoom from the
   hand cleanup is deliberately NOT in v1.
   METADATA (the safety half of this round): phone videos carry
   GPS/location in their global tags, and this is a kids'
   platform, so the final display file must not. Every encode in
   the upload path passes -map_metadata -1 (see r124ConvertNow
   and the encode below), and a compliant file that would
   otherwise pass through untouched gets a stream-copy strip
   remux (r186StripRemux) — but only when its global tags carry
   more than container bookkeeping, so a metadata-free file still
   passes through byte-for-byte (the Round 124 suite's contract).
   FALLBACK CONTRACT (the Round 124 hard rule, unchanged):
   best-effort, NEVER a gate. Every ffmpeg invocation goes
   through the Round 138 serializer; every produced file is
   probed and verified before it is swapped in; any failure at
   any step keeps the current display file; the pre-enhancement
   file is always preserved as <base>-preenhance.mp4, never
   deleted; and every outcome — enhanced, no-op, skipped, failed
   — is recorded as JSON in highlights.enhance_json.
   HH_NO_ENHANCE=1 disables the agent (the metadata strip still
   runs: it belongs to the Round 124 path, not the agent). */
const R186_SHAKE_MIN_PX_PER_SEC = 8;   // median 1s-hop global shift; below this the camera reads as locked-off or deliberate
const R186_SHAKE_MIN_INCONSISTENCY = 0.12; // 1 − |mean shift vector| / mean |shift| over the hops (0 = perfectly consistent pan)
const R186_FLICKER_MIN_RMS = 0.18;     // luma units (8-bit): robust detrended strip-oscillation floor for "filmed a screen"
const R186_IDET_MIN_FRAMES = 120;      // tallied frames required before idet may convict (small samples false-positive)
const R186_IDET_MIN_FRAC = 0.92;       // (TFF+BFF) share of tallied frames required — genuine interlace tallies ~100%
const R186_BENIGN_TAGS = new Set(["major_brand", "minor_version", "compatible_brands", "encoder"]); // container bookkeeping, not metadata worth a rewrite
const r186Round = (v, n) => { const f = 10 ** n; return Math.round((Number(v) || 0) * f) / f; };
function r186RunBuffer(bin, args, timeoutMs, maxBuffer) {
  return new Promise((resolve) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, encoding: "buffer" }, (err, stdout, stderr) => resolve({ err, stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.alloc(0), stderr: String(stderr || "") }));
  });
}
function r186Fps(probe) {
  if (!probe || !Array.isArray(probe.streams)) return 0;
  const v = probe.streams.find((s) => s.codec_type === "video");
  if (!v) return 0;
  for (const key of ["avg_frame_rate", "r_frame_rate"]) {
    const parts = String(v[key] || "").split("/");
    if (parts.length === 2) { const f = Number(parts[0]) / Number(parts[1]); if (isFinite(f) && f > 0) return f; }
    const f = Number(v[key]); if (isFinite(f) && f > 0) return f;
  }
  return 0;
}
// Does this probe's GLOBAL tag set carry anything beyond
// container bookkeeping? Phones write creation_time, make/model,
// software and — the one that matters — location /
// com.apple.quicktime.location.ISO6709 there. Any non-benign key
// means the file gets stripped before it may be displayed.
function r186StrippableTags(probe) {
  const tags = (probe && probe.format && probe.format.tags) || {};
  for (const k of Object.keys(tags)) if (!R186_BENIGN_TAGS.has(String(k).toLowerCase())) return true;
  return false;
}
async function r186StripRemux(bins, abs, info) {
  return r138SerializeFfmpeg(() => r186StripRemuxNow(bins, abs, info));
}
async function r186StripRemuxNow(bins, abs, info) {
  // Stream-copy the video + audio (the same streams the encode
  // path keeps — data/metadata tracks do not survive), drop all
  // global metadata, keep faststart: the source was compliant,
  // so the result must stay compliant-shaped. Verified like every
  // other swap in this pipeline; any doubt keeps the original.
  const base = path.basename(abs).replace(/\.[^.]+$/, "");
  const tmp = path.join(UPLOAD_DIR, `${base}.r186strip.mp4`);
  try {
    const { err, stderr } = await r124Run(bins.ffmpeg, ["-nostats", "-y", "-i", abs, "-map", "0:v:0", "-map", "0:a:0?", "-c", "copy", "-map_metadata", "-1", "-movflags", "+faststart", tmp], 120000);
    if (err) { console.error("[r186] metadata strip remux failed:", err.message, stderr.slice(-200)); return false; }
    const chkProbe = await r124Probe(bins, tmp);
    const chk = r124VideoInfo(chkProbe);
    if (!chk || chk.codec !== info.codec || chk.width !== info.width || chk.height !== info.height || Math.abs(chk.duration - info.duration) > 0.5 || !r124IsFaststart(tmp) || r186StrippableTags(chkProbe)) {
      console.error("[r186] metadata strip remux did not verify — original kept");
      return false;
    }
    fs.renameSync(tmp, abs);
    return true;
  } catch (e) { console.error("[r186] metadata strip remux error:", e.message); return false; }
  finally { try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {} }
}
// One tiny-gray-frame extraction feeds both the shake tracker and
// the flicker strips: width 128, sampled at up to 30fps over at
// most the first 12 seconds (assessment is a sample by design —
// shake, flicker and framing are whole-clip properties).
async function r186TinyFrames(bins, abs, info) {
  const fps = Math.min(30, Math.max(1, Math.round(info.fps || 30)));
  const tw = 128;
  // Round 224: DISPLAY aspect — the tiny frames are decoded
  // (autorotated), and the shake scale is in display pixels.
  const th = Math.max(2, Math.round((info.dispHeight * tw / info.dispWidth) / 2) * 2);
  const secs = Math.min(info.duration > 0 ? info.duration : 12, 12);
  const { err, stdout } = await r138SerializeFfmpeg(() => r186RunBuffer(bins.ffmpeg, ["-nostats", "-v", "error", "-i", abs, "-vf", `fps=${fps},scale=${tw}:${th},format=gray`, "-t", String(secs), "-f", "rawvideo", "-"], 90000, 48 * 1024 * 1024));
  if (err || !stdout || !stdout.length) return null;
  const frameSize = tw * th;
  const n = Math.floor(stdout.length / frameSize);
  if (n < 2) return null;
  return { buf: stdout, tw, th, n, fps, scale: info.dispWidth / tw };
}
// Global translation between two tiny frames: gradient-weighted
// SAD over an integer search window, with parabolic sub-pixel
// refinement. Weighting by the reference frame's gradient is
// what keeps a near-uniform soccer field from defeating the
// match (the aperture problem): textureless pixels abstain.
function r186TrackShift(a, b, tw, th, scale) {
  const R = 4, FS = tw * th;
  const w = new Float32Array(FS);
  for (let y = 1; y < th - 1; y++) for (let x = 1; x < tw - 1; x++) { const i = y * tw + x; w[i] = Math.abs(a[i + 1] - a[i - 1]) + Math.abs(a[i + tw] - a[i - tw]); }
  const grid = new Map();
  const sad = (dx, dy) => {
    const k = dx + "," + dy;
    if (grid.has(k)) return grid.get(k);
    let s = 0, ws = 0;
    for (let y = R; y < th - R; y++) for (let x = R; x < tw - R; x++) { const i = y * tw + x, wt = w[i]; if (wt < 12) continue; s += wt * Math.abs(b[i] - a[(y + dy) * tw + (x + dx)]); ws += wt; }
    const m = ws ? s / ws : 1e9;
    grid.set(k, m);
    return m;
  };
  let best = { m: 1e18, dx: 0, dy: 0 };
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const m = sad(dx, dy); if (m < best.m) best = { m, dx, dy }; }
  const denX = sad(best.dx - 1, best.dy) - 2 * best.m + sad(best.dx + 1, best.dy);
  const denY = sad(best.dx, best.dy - 1) - 2 * best.m + sad(best.dx, best.dy + 1);
  const fx = denX > 0 ? Math.max(-1, Math.min(1, 0.5 * (sad(best.dx - 1, best.dy) - sad(best.dx + 1, best.dy)) / denX)) : 0;
  const fy = denY > 0 ? Math.max(-1, Math.min(1, 0.5 * (sad(best.dx, best.dy - 1) - sad(best.dx, best.dy + 1)) / denY)) : 0;
  return { dx: (best.dx + fx) * scale, dy: (best.dy + fy) * scale };
}
function r186ShakeFromFrames(fr) {
  const { buf, tw, th, n, fps, scale } = fr;
  const FS = tw * th, K = fps, hop = Math.max(1, Math.floor(fps / 2));
  const vecs = [];
  for (let s = 0; s + K < n; s += hop) vecs.push(r186TrackShift(buf.subarray(s * FS, (s + 1) * FS), buf.subarray((s + K) * FS, (s + K + 1) * FS), tw, th, scale));
  if (vecs.length < 2) return null;
  const mags = vecs.map((v) => Math.hypot(v.dx, v.dy));
  const median = [...mags].sort((x, y) => x - y)[Math.floor(mags.length / 2)];
  const meanMag = mags.reduce((acc, v) => acc + v, 0) / mags.length;
  const mx = vecs.reduce((acc, v) => acc + v.dx, 0) / vecs.length, my = vecs.reduce((acc, v) => acc + v.dy, 0) / vecs.length;
  const inconsistency = meanMag > 0 ? 1 - Math.hypot(mx, my) / meanMag : 0;
  const reversal = (vecs.some((v) => v.dx >= 4) && vecs.some((v) => v.dx <= -4)) || (vecs.some((v) => v.dy >= 4) && vecs.some((v) => v.dy <= -4));
  return {
    medianPxPerSec: r186Round(median, 2), inconsistency: r186Round(inconsistency, 3), reversal,
    triggered: median >= R186_SHAKE_MIN_PX_PER_SEC && (inconsistency >= R186_SHAKE_MIN_INCONSISTENCY || reversal),
  };
}
function r186FlickerFromFrames(fr) {
  const { buf, tw, th, n, fps } = fr;
  if (n < 10) return null;
  const FS = tw * th, STRIPS = 6, stripH = Math.floor(th / STRIPS);
  const dwin = Math.max(7, Math.round(fps * 0.5) | 1), dh = Math.floor(dwin / 2);
  let best = 0;
  for (let sIdx = 0; sIdx < STRIPS; sIdx++) {
    const series = [];
    for (let f = 0; f < n; f++) { let s = 0; const base = f * FS + sIdx * stripH * tw; for (let i = 0; i < stripH * tw; i++) s += buf[base + i]; series.push(s / (stripH * tw)); }
    const det = series.map((v, i) => { let s = 0, c = 0; for (let k = -dh; k <= dh; k++) { const j = i + k; if (j >= 0 && j < series.length) { s += series[j]; c++; } } return Math.abs(v - s / c); });
    det.sort((x, y) => x - y);
    const keep = det.slice(0, Math.floor(det.length * 0.9)); // trimmed: scene cuts are not flicker
    const rms = Math.sqrt(keep.reduce((acc, v) => acc + v * v, 0) / keep.length);
    if (rms > best) best = rms;
  }
  return { stripRms: r186Round(best, 3), triggered: best >= R186_FLICKER_MIN_RMS };
}
// Content frame, mechanism A: cropdetect's modal rect over
// sampled frames. Trustworthy for TRUE black borders (letterbox,
// pillarbox, a phone held back from a screen in a dark room) —
// and, as the soccer clip proved, blind when the room around the
// screen is lit, which is what mechanism B below exists for.
async function r186CropDetectRect(bins, abs, info) {
  const { err, stderr } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-i", abs, "-vf", "fps=2,cropdetect=limit=24:round=2:reset=0", "-t", "60", "-f", "null", "-"], 120000));
  if (err) return null;
  const counts = new Map();
  for (const m of stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)) { const key = m.slice(1).join(":"); counts.set(key, (counts.get(key) || 0) + 1); }
  let best = null, bestN = 0;
  for (const [key, cnt] of counts) if (cnt > bestN) { bestN = cnt; best = key; }
  if (!best || bestN < 3) return null;
  const [w, h, x, y] = best.split(":").map(Number);
  if (!(w > 0 && h > 0)) return null;
  // Round 224: cropdetect reads decoded (autorotated)
  // frames — its rect and these bounds live in DISPLAY space.
  if (w >= info.dispWidth && h >= info.dispHeight) return null; // full frame: no borders found
  const significant = info.dispWidth - w >= Math.round(info.dispWidth * 0.05) || info.dispHeight - h >= Math.round(info.dispHeight * 0.05);
  if (!significant) return null;
  if (w < info.dispWidth * 0.5 || h < info.dispHeight * 0.4) return null; // pathological rect — trust nothing
  return { x, y, w, h };
}
// Per-line luma stats (dark fraction + 90th percentile) via a
// histogram, for the band scan: a bezel line is not just dark on
// average, it is dark almost everywhere along its length.
function r186LineStats(fr, w, h, byRow) {
  const lines = byRow ? h : w, span = byRow ? w : h;
  const out = [];
  const hist = new Uint32Array(256);
  for (let l = 0; l < lines; l++) {
    hist.fill(0);
    for (let i = 0; i < span; i++) hist[byRow ? fr[l * w + i] : fr[i * w + l]]++;
    let dark = 0;
    for (let v = 0; v < 60; v++) dark += hist[v];
    let cum = 0, p90 = 255;
    const target = span * 0.9;
    for (let v = 0; v < 256; v++) { cum += hist[v]; if (cum >= target) { p90 = v; break; } }
    out.push({ darkFrac: dark / span, p90 });
  }
  return out;
}
function r186BezelBands(stats) {
  const bands = [];
  let start = -1;
  for (let i = 0; i <= stats.length; i++) {
    const bezel = i < stats.length && stats[i].darkFrac >= 0.7 && stats[i].p90 <= 95;
    if (bezel && start < 0) start = i;
    if (!bezel && start >= 0) { if (i - start >= 3) bands.push({ top: start, bottom: i - 1 }); start = -1; }
  }
  return bands;
}
function r186EdgeMedian(cands, tol) {
  if (cands.length < 3) return null;
  const med = [...cands].sort((a, b) => a - b)[Math.floor(cands.length / 2)];
  return cands.filter((c) => Math.abs(c - med) <= tol).length >= 3 ? med : null;
}
// Content frame, mechanism B: the dark-band scan. On ~9 sampled
// frames (scaled to at most 640 wide), find uniformly near-black
// horizontal/vertical bands — manufactured edges — and take the
// median outer pair as the picture rect. A band must be found by
// at least 3 frames at a consistent position before its edge is
// used, each edge is independent (a bottom-only crop is a valid
// outcome), and the rect must survive sanity validation; the
// parked flicker band inside a screen recording sits too high
// and too inconsistently to pair as a picture edge.
async function r186BandRect(bins, abs, info) {
  // Round 224: DISPLAY dims — the scan samples decoded
  // (autorotated) frames and maps its edges back into
  // display pixels.
  const bw = Math.min(info.dispWidth, 640);
  const bh = Math.max(2, Math.round((info.dispHeight * bw / info.dispWidth) / 2) * 2);
  const dur = info.duration > 0 ? info.duration : 10;
  const sampleFps = Math.min(2, 9 / dur);
  const { err, stdout } = await r138SerializeFfmpeg(() => r186RunBuffer(bins.ffmpeg, ["-nostats", "-v", "error", "-i", abs, "-vf", `fps=${sampleFps.toFixed(4)},scale=${bw}:${bh},format=gray`, "-f", "rawvideo", "-"], 90000, 32 * 1024 * 1024));
  if (err || !stdout || !stdout.length) return null;
  const FS = bw * bh, nF = Math.floor(stdout.length / FS);
  if (nF < 3) return null;
  const rowBands = [], colBands = [];
  for (let f = 0; f < nF; f++) {
    const fr = stdout.subarray(f * FS, (f + 1) * FS);
    rowBands.push(r186BezelBands(r186LineStats(fr, bw, bh, true)));
    colBands.push(r186BezelBands(r186LineStats(fr, bw, bh, false)));
  }
  const tolY = Math.max(6, Math.round(bh * 0.02)), tolX = Math.max(6, Math.round(bw * 0.02));
  const topCands = [], botCands = [], leftCands = [], rightCands = [];
  for (const bands of rowBands) { const t = bands.find((b) => b.top <= bh * 0.3); if (t) topCands.push(t.bottom + 1); }
  const topMed = r186EdgeMedian(topCands, tolY);
  const minBotTop = topMed !== null ? topMed + Math.round(bh * 0.25) : Math.round(bh * 0.45);
  for (const bands of rowBands) { const b = bands.find((bd) => bd.top >= minBotTop); if (b) botCands.push(b.top); }
  const botMed = r186EdgeMedian(botCands, tolY);
  for (const bands of colBands) { const t = bands.find((b) => b.top <= bw * 0.3); if (t) leftCands.push(t.bottom + 1); }
  const leftMed = r186EdgeMedian(leftCands, tolX);
  const minRightLeft = leftMed !== null ? leftMed + Math.round(bw * 0.25) : Math.round(bw * 0.45);
  for (const bands of colBands) { const b = bands.find((bd) => bd.top >= minRightLeft); if (b) rightCands.push(b.top); }
  const rightMed = r186EdgeMedian(rightCands, tolX);
  if (topMed === null && botMed === null && leftMed === null && rightMed === null) return null;
  const sx = info.dispWidth / bw, sy = info.dispHeight / bh;
  let x0 = 0, y0 = 0, x1 = info.dispWidth, y1 = info.dispHeight;
  if (leftMed !== null) x0 = Math.round(leftMed * sx) + 4; // inset past the bezel line itself
  if (rightMed !== null) x1 = Math.round(rightMed * sx) - 4;
  if (topMed !== null) y0 = Math.round(topMed * sy) + 4;
  if (botMed !== null) y1 = Math.round(botMed * sy) - 4;
  x0 -= x0 % 2; y0 -= y0 % 2; // yuv420p crop wants even origins and sizes
  let w = x1 - x0, h = y1 - y0;
  w -= w % 2; h -= h % 2;
  if (w < info.dispWidth * 0.5 || h < info.dispHeight * 0.2 || w < 96 || h < 96) return null;
  if (w * h > info.dispWidth * info.dispHeight * 0.92) return null; // removes too little to be a content frame
  if (w >= info.dispWidth && h >= info.dispHeight) return null;
  return { x: x0, y: y0, w, h };
}
async function r186Idet(bins, abs) {
  const { err, stderr } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-i", abs, "-vf", "idet", "-frames:v", "600", "-f", "null", "-"], 120000));
  if (err) return null;
  let last = null;
  for (const m of stderr.matchAll(/Multi frame detection:\s*TFF:\s*(\d+)\s+BFF:\s*(\d+)\s+Progressive:\s*(\d+)\s+Undetermined:\s*(\d+)/g)) last = m;
  if (!last) return null;
  const tff = +last[1], bff = +last[2], progressive = +last[3], undetermined = +last[4];
  const frames = tff + bff + progressive + undetermined;
  const frac = frames > 0 ? (tff + bff) / frames : 0;
  return {
    tff, bff, progressive, undetermined, frames, interlacedFrac: r186Round(frac, 3),
    triggered: frames >= R186_IDET_MIN_FRAMES && frac >= R186_IDET_MIN_FRAC,
  };
}
// Dead time is measured for the report only (v1 trims nothing):
// black and frozen intervals that touch the head or the tail.
async function r186DeadTime(bins, abs, duration) {
  const { err, stderr } = await r138SerializeFfmpeg(() => r124Run(bins.ffmpeg, ["-nostats", "-i", abs, "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.003:d=1.5", "-t", "180", "-f", "null", "-"], 180000));
  if (err) return null;
  const blacks = [];
  for (const m of stderr.matchAll(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)/g)) blacks.push([+m[1], +m[2]]);
  const fStarts = [...stderr.matchAll(/freeze_start:\s*([\d.]+)/g)].map((m) => +m[1]);
  const fEnds = [...stderr.matchAll(/freeze_end:\s*([\d.]+)/g)].map((m) => +m[1]);
  const freezes = fStarts.map((s, i) => [s, i < fEnds.length ? fEnds[i] : duration]);
  const head = (ivs) => { let v = 0; for (const [s, e] of ivs) if (s <= 0.3) v = Math.max(v, e); return r186Round(v, 2); };
  const tail = (ivs) => { let v = 0; for (const [s, e] of ivs) if (duration > 0 && e >= duration - 0.3) v = Math.max(v, duration - s); return r186Round(v, 2); };
  return { headBlackSec: head(blacks), tailBlackSec: tail(blacks), headFrozenSec: head(freezes), tailFrozenSec: tail(freezes) };
}
async function r186Assess(bins, abs, info) {
  const a = { shake: null, flicker: null, crop: { method: null, rect: null, triggered: false }, interlace: null, deadTime: null };
  try {
    const fr = await r186TinyFrames(bins, abs, info);
    if (fr) { a.shake = r186ShakeFromFrames(fr); a.flicker = r186FlickerFromFrames(fr); }
  } catch (e) { console.error("[r186] shake/flicker assessment failed:", e.message); }
  try { a.interlace = await r186Idet(bins, abs); } catch (e) { console.error("[r186] idet assessment failed:", e.message); }
  try {
    const cd = await r186CropDetectRect(bins, abs, info);
    if (cd) a.crop = { method: "cropdetect", rect: cd, triggered: true };
    else { const br = await r186BandRect(bins, abs, info); if (br) a.crop = { method: "bands", rect: br, triggered: true }; }
  } catch (e) { console.error("[r186] crop assessment failed:", e.message); }
  try { a.deadTime = await r186DeadTime(bins, abs, info.duration); } catch (e) { console.error("[r186] dead-time assessment failed:", e.message); }
  return a;
}
function r186StoreReport(id, report) {
  try { db.prepare("UPDATE highlights SET enhance_json=? WHERE id=?").run(JSON.stringify(report), id); }
  catch (e) { console.error(`[r186] could not store the enhancement report for play ${id}:`, e.message); }
}
// The agent itself. Runs detached from the upload response; the
// display file stays exactly as Round 124 left it until an
// enhanced encode has been produced AND verified, and the row
// must still point at the file that was assessed before anything
// is swapped (a play can be approved, trashed or migrated in the
// meantime — if its media moved on, the agent stands down).
async function r186EnhanceUpload(bins, id, abs, meta) {
  const report = {
    round: 186, version: 1, at: new Date().toISOString(), status: "failed", reason: "",
    metadata_stripped: !!meta.stripped, metadata_action: meta.action,
    source: { file: path.basename(abs) }, assessment: null,
    applied: { deinterlace: false, crop: false, stabilize: false, deflicker: false },
    output: null, preEnhanceFile: null,
  };
  try {
    if (process.env.HH_NO_ENHANCE === "1") { report.status = "skipped"; report.reason = "HH_NO_ENHANCE=1"; r186StoreReport(id, report); return; }
    // The file this stage was chained with can have been moved
    // since the upload — the one real example is a first-boot
    // Round 124 migration converting the same play concurrently.
    // Work on the play's CURRENT display file instead of failing.
    if (!fs.existsSync(abs)) {
      const rowNow = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
      const alt = rowNow && rowNow.media_url ? path.join(UPLOAD_DIR, path.basename(rowNow.media_url)) : null;
      if (alt && alt !== abs && fs.existsSync(alt)) { console.log(`[r186] upload ${id}: display file moved since upload — assessing ${path.basename(alt)}`); abs = alt; report.source = { file: path.basename(abs) }; }
    }
    const probe = await r124Probe(bins, abs);
    const vinfo = r124VideoInfo(probe);
    if (!vinfo) { report.reason = "display file no longer probes as video"; r186StoreReport(id, report); return; }
    const info = { ...vinfo, fps: r186Fps(probe) };
    report.source = { file: path.basename(abs), width: info.dispWidth, height: info.dispHeight, duration: r186Round(info.duration, 2), fps: r186Round(info.fps, 2) };
    const a = await r186Assess(bins, abs, info);
    report.assessment = a;
    const want = {
      deinterlace: !!(a.interlace && a.interlace.triggered),
      crop: !!(a.crop && a.crop.triggered),
      stabilize: !!(a.shake && a.shake.triggered),
      deflicker: !!(a.flicker && a.flicker.triggered),
    };
    if (!want.deinterlace && !want.crop && !want.stabilize && !want.deflicker) {
      report.status = "no-op";
      r186StoreReport(id, report);
      console.log(`[r186] upload ${id}: assessed — nothing to enhance`);
      return;
    }
    const base = path.basename(abs).replace(/\.[^.]+$/, "");
    const trf = path.join(UPLOAD_DIR, `${base}.r186.trf`);
    const tmpOut = path.join(UPLOAD_DIR, `${base}.r186tmp.mp4`);
    // The detect pass and the transform must see the SAME picture:
    // yadif + crop run ahead of both. vidstabtransform's zoom +
    // optzoom keep the stabilized frame off the black edges.
    const preChain = [];
    if (want.deinterlace) preChain.push("yadif");
    if (want.crop) preChain.push(`crop=${a.crop.rect.w}:${a.crop.rect.h}:${a.crop.rect.x}:${a.crop.rect.y}`);
    const encChain = [...preChain];
    if (want.stabilize) encChain.push(`vidstabtransform=input=${trf}:smoothing=12:zoom=1:optzoom=1`);
    if (want.deflicker) encChain.push("deflicker");
    encChain.push("scale=-2:'if(gt(ih,1280),1280,trunc(ih/2)*2)'"); // the Round 124 output spec, unchanged
    let encodeOk = false;
    try {
      encodeOk = await r138SerializeFfmpeg(async () => {
        if (want.stabilize) {
          const det = await r124Run(bins.ffmpeg, ["-nostats", "-y", "-i", abs, "-vf", [...preChain, `vidstabdetect=shakiness=5:accuracy=15:result=${trf}`].join(","), "-f", "null", "-"], 420000);
          if (det.err) { console.error(`[r186] upload ${id}: vidstabdetect failed:`, det.err.message, det.stderr.slice(-200)); return false; }
        }
        const enc = await r124Run(bins.ffmpeg, ["-nostats", "-y", "-i", abs, "-map", "0:v:0", "-map", "0:a:0?", "-map_metadata", "-1", "-vf", encChain.join(","), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-threads", "2", tmpOut], 600000);
        if (enc.err) { console.error(`[r186] upload ${id}: enhancement encode failed:`, enc.err.message, enc.stderr.slice(-200)); return false; }
        return true;
      });
    } finally { try { fs.unlinkSync(trf); } catch {} }
    if (!encodeOk) { try { fs.unlinkSync(tmpOut); } catch {} report.reason = "enhancement encode failed"; r186StoreReport(id, report); return; }
    const outInfo = r124VideoInfo(await r124Probe(bins, tmpOut));
    // Round 224: expected dims are DISPLAY dims — the encode
    // output is rotation-free, and the crop rect (when any)
    // was measured in display space.
    let expW = info.dispWidth, expH = info.dispHeight;
    if (want.crop) { expW = a.crop.rect.w; expH = a.crop.rect.h; }
    if (expH > 1280) { expW = Math.round((expW * 1280 / expH) / 2) * 2; expH = 1280; }
    const verified = outInfo && outInfo.codec === "h264" && outInfo.pixFmt === "yuv420p" && Math.abs(outInfo.duration - info.duration) <= 0.5 && Math.abs(outInfo.width - expW) <= 4 && Math.abs(outInfo.height - expH) <= 4;
    if (!verified) {
      try { fs.unlinkSync(tmpOut); } catch {}
      report.reason = "enhanced file did not verify";
      console.error(`[r186] upload ${id}: enhanced file did not verify (codec/dims/duration) — display file kept`);
      r186StoreReport(id, report);
      return;
    }
    const row = db.prepare("SELECT media_url FROM highlights WHERE id=?").get(id);
    if (!row || path.basename(row.media_url || "") !== path.basename(abs)) {
      try { fs.unlinkSync(tmpOut); } catch {}
      report.status = "skipped";
      report.reason = "media changed since assessment";
      r186StoreReport(id, report);
      return;
    }
    // Swap order matters: the enhanced file lands first, then the
    // current display file is preserved under its pre-enhancement
    // name, and only then does the row move — at every instant
    // the row points at a file that exists.
    const enhancedName = `${base}-enhanced.mp4`;
    let preName = `${base}-preenhance.mp4`;
    if (fs.existsSync(path.join(UPLOAD_DIR, preName))) preName = `${base}-preenhance-${Date.now()}.mp4`;
    fs.renameSync(tmpOut, path.join(UPLOAD_DIR, enhancedName));
    fs.renameSync(abs, path.join(UPLOAD_DIR, preName));
    db.prepare("UPDATE highlights SET media_url=?, mime='video/mp4' WHERE id=?").run(`/uploads/${enhancedName}`, id);
    report.applied = want;
    report.status = "enhanced";
    report.preEnhanceFile = preName;
    report.output = { file: enhancedName, width: outInfo.width, height: outInfo.height, duration: r186Round(outInfo.duration, 2), bytes: fs.statSync(path.join(UPLOAD_DIR, enhancedName)).size };
    await r124PosterFor(bins, id, path.join(UPLOAD_DIR, enhancedName), outInfo);
    r186StoreReport(id, report);
    console.log(`[r186] upload ${id}: enhanced → ${enhancedName} (deinterlace=${want.deinterlace} crop=${want.crop} stabilize=${want.stabilize} deflicker=${want.deflicker}); pre-enhancement file kept as ${preName}`);
  } catch (e) {
    report.reason = e.message;
    console.error(`[r186] upload ${id}: enhancement stage failed (display file kept):`, e.message);
    r186StoreReport(id, report);
  }
}
/* ================= Round 188 (2026-11-25): the upload welcome email =================
   WHY: Emil's call (2026-11-25) — when a family uploads a play,
   the moment deserves more than a silent queue: the uploader
   gets a "Welcome to the HighlightHype family" note carrying
   the play's poster, the credo, and a link to the play's PUBLIC
   page. Emil approved the mock (welcome-email-mock-2026-11-25)
   and the build followed it the same day.
   TRIGGER: chained off the very end of the Round 186 chain in
   r124ProcessUpload — only reachable from the live upload
   handler, so backfills, the boot migration, restores and
   re-processing never welcome anyone; and only once the agent
   has fully settled is the poster the FINAL (enhanced) one.
   RECIPIENT: the play's notify_email — the parent/guardian
   account holder, never the athlete. The greeting name is the
   guardian name this family gave on a Hype Frame request when
   one is on file; otherwise the greeting falls back to a plain
   "Hi there," — the upload form captures no guardian name.
   SUBJECTS: the guardian's FIRST play gets "Welcome to the
   HighlightHype family"; every later play gets the proud line
   with the play title lowercased into the sentence, exactly as
   the approved mock shows it.
   DISCOUNT: the mock's FAMILY10 block ships in the template
   but behind HH_WELCOME_DISCOUNT=1, default OFF — the Shopify
   code does not exist yet and the store takes no payments, so
   no family may receive a code that doesn't work. Flag off,
   the block is omitted cleanly (no empty shell).
   DISCIPLINE (the house mail rules, unchanged): silent no-op
   when SMTP is unconfigured; fire-and-forget — a mail failure
   can never fail or delay an upload; HH_NO_WELCOME=1 is the
   kill switch, mirroring HH_NO_ENHANCE. NO DOUBLE-SENDS:
   highlights.welcome_sent_at is checked before sending and
   stamped ONLY after smtpSend resolves, so a failed send
   leaves the welcome owed (a later re-processing can deliver
   it) and a delivered one can never repeat. The "Watch the
   play" button links the play's public page — NEVER a
   moderation link (anyone holding one can moderate). */
// The guardian's first name, when this family has given one —
// the only place a guardian name is stored is a Hype Frame
// order request. Matched on the normalized address, newest first.
function r188GuardianFirstName(to) {
  try {
    const row = db.prepare("SELECT guardian_name FROM hype_frame_orders WHERE lower(trim(guardian_email))=? AND trim(guardian_name)<>'' ORDER BY id DESC LIMIT 1").get(normIdentity(to));
    const name = String((row && row.guardian_name) || "").trim();
    return name ? name.split(/\s+/)[0] : "";
  } catch { return ""; }
}
function r188WelcomeText({ greeting, athlete, athleteFirst, title, playUrl, showDiscount }) {
  let s = `Welcome to the HighlightHype family\n\nHi ${greeting},\n\n${athlete}'s play — "${title}" — is live on HighlightHype, and we just had to say it: welcome to the family.\n\nYou should be proud of this one. The hours in the driveway, the rides to practice, the games in the cold — they're all in this swing. Moments like this are exactly why HighlightHype exists: we believe every young athlete should be celebrated.\n\nWatch the play: ${playUrl}\nShare the link with family — every view is a vote of confidence.\n`;
  if (showDiscount) s += `\nA little welcome gift: 10% off your first HighlightHype order — enter code FAMILY10 at checkout on highlighthype.com. Our thanks for being one of the first families in.\n`;
  s += `\nThanks for trusting us with this memory. We can't wait to see what ${athleteFirst} does next.\n\n— The HighlightHype Family\nhighlighthype.com\n\nYou're receiving this email because a play was uploaded from your HighlightHype account.\n`;
  return s;
}
function r188WelcomeHtml({ greeting, athlete, athleteFirst, title, playUrl, posterUrl, showDiscount }) {
  const g = escHtml(greeting), a = escHtml(athlete), af = escHtml(athleteFirst), t = escHtml(title);
  const posterBlock = posterUrl ? `
  <tr><td style="padding:22px 40px 0;">
    <img src="${escHtml(posterUrl)}" width="520" alt="${a} — ${t}" style="display:block;width:100%;max-width:520px;height:auto;border-radius:10px;border:1px solid #2a2517;">
    <div style="background:#141414;border:1px solid #2a2517;border-top:none;border-radius:0 0 10px 10px;padding:10px 14px;margin-top:-10px;position:relative;">
      <span style="color:#e8cf8f;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:bold;">Now playing</span>
      <span style="color:#ffffff;font-size:14.5px;">&nbsp;&nbsp;${a} · ${t}</span>
    </div>
  </td></tr>` : "";
  const discountBlock = showDiscount ? `
  <tr><td style="padding:26px 40px 0;">
    <div style="border:1.5px dashed #B39B63;border-radius:12px;background:#171200;padding:20px 22px;text-align:center;">
      <div style="font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:#B39B63;font-weight:bold;">A little welcome gift</div>
      <div style="color:#ffffff;font-size:16.5px;margin-top:8px;">10% off your first HighlightHype order</div>
      <div style="font-family:'Courier New',monospace;font-size:27px;font-weight:bold;letter-spacing:.28em;color:#e8cf8f;margin-top:12px;">FAMILY10</div>
      <div style="font-size:12px;color:#9a958a;margin-top:8px;">Enter the code at checkout on highlighthype.com — our thanks for being one of the first families in.</div>
    </div>
  </td></tr>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>HighlightHype — Welcome</title></head>
<body style="margin:0;padding:0;background:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0a0a0a;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:600px;max-width:600px;background:#0a0a0a;">
  <tr><td style="background:#0a0a0a;padding:30px 40px 6px;text-align:center;">
    <img src="https://highlighthype.com/logo-header-gold.png" width="340" alt="HighlightHype" style="display:block;margin:0 auto;width:340px;max-width:85%;height:auto;">
    <div style="font-size:10.5px;letter-spacing:.3em;color:#B39B63;text-transform:uppercase;margin-top:7px;font-family:Arial,Helvetica,sans-serif;">Athletes — Strength — Memories — Motivation</div>
  </td></tr>
  <tr><td style="padding:18px 40px 0;"><div style="border-top:1px solid #2a2517;font-size:0;line-height:0;">&nbsp;</div></td></tr>
  <tr><td style="padding:22px 40px 0;color:#e8e8e8;font-size:16px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
    <div style="font-family:'Arial Narrow',Arial,sans-serif;font-size:25px;font-weight:bold;text-transform:uppercase;letter-spacing:.03em;color:#ffffff;line-height:1.2;">Welcome to the family</div>
    <p style="margin:14px 0 0;">Hi ${g},</p>
    <p style="margin:12px 0 0;">${a}'s play — &ldquo;${t}&rdquo; — is live on HighlightHype, and we just had to say it: welcome to the family.</p>
    <p style="margin:12px 0 0;">You should be proud of this one. The hours in the driveway, the rides to practice, the games in the cold — they're all in this swing. Moments like this are exactly why HighlightHype exists: <em style="color:#e8cf8f;">we believe every young athlete should be celebrated.</em></p>
  </td></tr>${posterBlock}
  <tr><td style="padding:24px 40px 0;text-align:center;">
    <a href="${escHtml(playUrl)}" style="display:inline-block;background:#B39B63;color:#0a0a0a;font-family:Arial,sans-serif;font-size:15.5px;font-weight:bold;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;padding:14px 38px;border-radius:999px;">Watch the play</a>
    <div style="font-size:12.5px;color:#9a958a;margin-top:10px;font-family:Arial,Helvetica,sans-serif;">Share the link with family — every view is a vote of confidence.</div>
  </td></tr>${discountBlock}
  <tr><td style="padding:24px 40px 0;color:#e8e8e8;font-size:15.5px;line-height:1.6;font-family:Arial,Helvetica,sans-serif;">
    <p style="margin:0;">Thanks for trusting us with this memory. We can't wait to see what ${af} does next.</p>
    <p style="margin:14px 0 0;color:#ffffff;">— The HighlightHype Family<br><span style="font-size:13px;color:#9a958a;">highlighthype.com</span></p>
  </td></tr>
  <tr><td style="padding:26px 40px 30px;">
    <div style="border-top:1px solid #2a2517;padding-top:16px;text-align:center;font-family:Arial,Helvetica,sans-serif;">
      <div style="font-size:10.5px;letter-spacing:.26em;color:#B39B63;text-transform:uppercase;">Athletes — Strength — Memories — Motivation</div>
      <div style="font-size:12px;color:#8a857a;line-height:1.6;margin-top:10px;">
        You're receiving this email because a play was uploaded from your HighlightHype account.<br>
        HighlightHype · hello@highlighthype.com · <a href="https://highlighthype.com" style="color:#8a857a;">highlighthype.com</a>
      </div>
    </div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
async function r188MaybeSendWelcome(id) {
  try {
    if (process.env.HH_NO_WELCOME === "1") return;
    const user = process.env.SMTP_USER, pass = process.env.SMTP_PASS;
    if (!user || !pass) return; // mailer unconfigured — silent no-op, the house rule
    const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
    if (!row || row.welcome_sent_at) return; // already welcomed — never twice
    const to = String(row.notify_email || "").trim();
    if (!to) return; // no guardian email on the play — nobody to welcome
    // This guardian's FIRST play? Counted on the stored identity
    // hash (the raw address for rows that predate it), strictly
    // before this play.
    let prior = 0;
    if (row.notify_email_hash) prior = db.prepare("SELECT COUNT(*) AS c FROM highlights WHERE notify_email_hash=? AND id<?").get(row.notify_email_hash, id).c;
    else prior = db.prepare("SELECT COUNT(*) AS c FROM highlights WHERE notify_email=? AND id<?").get(to, id).c;
    const isFirst = !prior;
    const athlete = String(row.player_name || "").trim() || "Your athlete";
    const athleteFirst = athlete.split(/\s+/)[0];
    const title = String(row.title || "").trim() || "Untitled play";
    const greeting = r188GuardianFirstName(to) || "there";
    const playUrl = `https://highlighthype.com/#play-${id}`;
    const posterUrl = row.poster_url ? `https://highlighthype.com${row.poster_url.startsWith("/") ? "" : "/"}${row.poster_url}` : "";
    const showDiscount = process.env.HH_WELCOME_DISCOUNT === "1";
    const subject = isFirst
      ? "Welcome to the HighlightHype family"
      : `${athlete}'s ${title.toLowerCase()} is live — you should be proud of this one`;
    const merges = { greeting, athlete, athleteFirst, title, playUrl, showDiscount };
    await smtpSend({ host: process.env.SMTP_HOST || "mail.privateemail.com", port: Number(process.env.SMTP_PORT || 465), user, pass, from: user, to,
      subject, body: r188WelcomeText(merges), html: r188WelcomeHtml({ ...merges, posterUrl }) });
    // Stamp ONLY after the send resolved — a failed send leaves
    // the marker empty, so the welcome is still owed rather than
    // lost, and a delivered one can never be sent again.
    db.prepare("UPDATE highlights SET welcome_sent_at=? WHERE id=?").run(new Date().toISOString(), id);
    console.log(`[r188] upload ${id}: welcome email sent to the uploader (${isFirst ? "first play" : "returning family"})`);
  } catch (e) {
    console.error(`[r188] upload ${id}: welcome email failed (upload unaffected):`, e.message);
  }
}
/* ================= Round 165 (2026-11-14): Hype Reels =================
   A guardian downloads a branded MP4 of their own athlete's
   approved play — the actual video file, made for sharing to
   social: the play's own (Round 124-normalized) clip bookended
   by a branded sting — a ~1.2s intro card (black, gold crest,
   athlete name + play title) and a ~1.5s outro card (crest +
   "YOUR MOMENT. YOUR HYPE." + highlighthype.com) — built by ONE
   ffmpeg invocation per reel, always through the Round 138
   serializer (never a parallel ffmpeg process), encoded to the
   house spec: H.264 / yuv420p / AAC / faststart at the source's
   own geometry, never upscaled.

   THE BRAND TREATMENT ON THE CLIP ITSELF IS A WATERMARK, not a
   lower-third — a deliberate tooling call. The pipeline's
   ffmpeg (ffmpeg-static: the same binary in dev, the suites
   and production) ships WITHOUT the drawtext filter, so ffmpeg
   cannot burn text in at all; and a name band needs text over
   moving video at every geometry. The crest watermark needs
   only `overlay`: the crest at ~55% opacity in the
   bottom-right corner, sized off the frame's width, identical
   for portrait and landscape, and it can never collide with
   the action the way a caption band can. The sting cards DO
   carry the name and title — rendered as transparent PNGs by
   the small bitmap-font renderer below and composited with
   the same overlay filter. The glyph table is embedded data
   (DejaVu Sans Bold, extracted at 96px when this round was
   built): no font files, no new dependencies, so the sting
   renders identically on the Alpine production image.

   CACHING: a reel generates on the guardian's first request
   and is then served from DATA_DIR/reels/<playId>.mp4.
   highlights.reel_source records what it was built from;
   the cache is reused only while that still matches.
   AUTHORIZATION IS NOT HERE: this block builds and fetches
   files; who may have one is decided by the endpoint below
   (the guardian email-hash match from /api/athletes/lookup).

   Round 167 (2026-11-14) — the sting cards go metallic. Emil
   supplied two photographic masters of the crest (gold metal
   on black): public/reel-crest.jpg (the crest ALONE) now
   fronts the intro card where the flat crest PNG used to sit,
   and public/reel-lockup.jpg (crest + HIGHLIGHTHYPE™ wordmark
   + the slogan, all baked into the art) IS the outro card —
   the bitmap renderer no longer draws "YOUR MOMENT. YOUR
   HYPE." there; only the small highlighthype.com line is still
   rendered, tucked under the artwork. Both masters are square
   JPGs on black, so they contain-fit onto the black cards and
   their ground disappears. The IN-CLIP watermark keeps its
   mechanism (this same overlay path, 55% alpha) — and its
   asset is the crest file itself, which Round 167 also
   replaced with the shiny metallic crest (Dyanna: the crest
   must be shiny, almost 3D), so the corner mark is the shiny
   crest too; the metallic JPG masters still never enter the
   clip (no alpha — they'd box). Card changes invalidate old
   caches:
   reel_source now stores REEL_FORMAT_V + ":" + media_url, and
   a cached file serves only while the stored value matches
   exactly, so every pre-167 reel regenerates on next request. */
const R165_INTRO_SEC = 1.2;
const R165_OUTRO_SEC = 1.5;
const R165_GOLD = [212, 175, 55];      // #D4AF37 — sampled from the crest's own pixels
const R165_WHITE = [255, 255, 255];
const R165_SOFT = [217, 217, 217];
const R165_CREST_PATH = path.join(__dirname, "public", "crest-watermark.png"); // the site crest — Round 167: 1122×1100 shiny metallic, transparent (was the 560×625 flat crest)
/* Round 167: the metallic card masters (both 1284×1284 JPGs
   on black) and the reel format version. REEL_FORMAT_V is
   folded into highlights.reel_source ahead of the media_url,
   so any change to what a reel LOOKS like (like this card
   swap) must bump it — old-format caches then miss and
   regenerate instead of serving the retired sting. Round 165
   stored the bare media_url; that is format "fmt1" by
   absence, and it never matches again. */
const R167_CREST_ART_PATH = path.join(__dirname, "public", "reel-crest.jpg");
const R167_LOCKUP_ART_PATH = path.join(__dirname, "public", "reel-lockup.jpg");
const REEL_FORMAT_V = "fmt2";
const r167ReelSourceKey = (mediaUrl) => `${REEL_FORMAT_V}:${mediaUrl || ""}`;
/* Embedded bitmap font — DO NOT hand-edit the table. Glyph
   record: [advance, w, h, dx, dy, base64] in 96px units; the
   base64 is the glyph's ink mask, 1 bit per pixel, rows packed
   MSB-first; (dx, dy) places the ink's top-left relative to
   the pen's baseline origin. Extracted from DejaVu Sans Bold
   so the sting carries real type, not a system-font gamble. */
const R165_FONT = {"px":96,"asc":90,"desc":23,"glyphs":{" ":[33.42,0,0,0,0,""],"!":[43.78,18,70,13,-70,"//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+f/+f/+f/+f/+f/+f/+f/8f/8P/8P/8P/8P/8P/8P/8P/4P/4H/4H/4H/4AAAAAAAAAAAAAAAAAAAAA//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+//+A="],"\"":[50.02,32,26,9,-70,"/+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB///4Af//+AH///gB/8="],"#":[80.44,68,69,6,-69,"AAAAP/gAf+AAAAAD/wAH/gAAAAA/8AD/4AAAAAf/AA/+AAAAAH/wAP/AAAAAB/4AD/wAAAAAf+AB/8AAAAAP/gAf/AAAAAD/4AH/gAAAAA/8AB/4AAAAAP/AA/+AAAAAH/wAP/gAAAAB/8AD/wAAAAAf+AA/8AAAAAH/gAf/AAAAAD/4AH/wAAAAA/+AB/4AAAAAP/AAf+AAA//////////wP/////////8D//////////A//////////wP/////////8D//////////A//////////wP/////////8D//////////A//////////wAAH/gAP/AAAAAB/4AD/wAAAAAf+AB/8AAAAAP/gAf/AAAAAD/wAH/gAAAAA/8AB/4AAAAAP/AA/+AAAAAH/wAP/gAAAAB/4AD/wAAAAAf+AA/8AAAAAH/gAf/AAAAAD/4AH/wAAAAA/8AB/4AAB//////////gf/////////4H/////////+B//////////gf/////////4H/////////+B//////////gf/////////4H/////////+B//////////gAAf/AA/+AAAAAH/wAP/AAAAAB/4AD/wAAAAAf+AA/8AAAAAP/gAf/AAAAAD/4AH/gAAAAA/8AB/4AAAAAP/AAf+AAAAAH/wAP/gAAAAB/8AD/wAAAAAf+AA/8AAAAAH/gAP/AAAAAD/4AH/wAAAAA/+AB/4AAAAAP/AAf+AAAAAD/wAH/gAAAAB/8AD/4AAAAAf/AA/8AAAAA="],"$":[66.8,54,87,7,-73,"AAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAf/+AAAAAP////AAAB/////+AAH//////gAf//////gA///////gB///////gD///////gH///////gH///////gP///////gP//x/B//gf//B/AB/gf/+B/AAHgf/8B/AAAgf/8B/AAAAf/4B/AAAAf/4B/AAAAf/8B/AAAAf/8B/AAAAf/+B/AAAAf//B/AAAAf//5/AAAAf////AAAAf////8AAAP/////wAAP/////+AAH//////wAD//////8AB//////+AA///////gAf//////gAH//////wAB//////4AAP/////4AAA/////8AAAD////8AAAB////+AAAB/D//+AAAB/A//+AAAB/Af/+AAAB/AP/+AAAB/AP/+AAAB/AP/+AAAB/AP/+QAAB/AP/+cAAB/AP/+fAAB/AP/+f4AB/Af/+f/AB/A//8f/8B/D//8f///////8f///////4f///////wf///////wf///////gf///////AP//////8AB//////4AAP/////AAAB////4AAAAB//8AAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAAAAB/AAAAA"],"%":[96.19,91,73,3,-72,"AAP/AAAAAAf/AAAAB//8AAAAAP/AAAAD///gAAAAP/gAAAD///8AAAAH/gAAAD////AAAAH/gAAAD////wAAAH/wAAAD////8AAAD/wAAAD////+AAAD/4AAAB//B//gAAB/4AAAB//AP/4AAB/4AAAA//AD/8AAB/8AAAA//AB/+AAA/8AAAAf/gAf/gAA/+AAAAP/gAP/wAAf+AAAAP/wAH/4AAf+AAAAH/4AB/8AAf/AAAAD/8AA/+AAP/AAAAB/+AAf/AAP/gAAAA//AAP/gAH/gAAAAf/gAH/wAH/gAAAAP/wAD/4AH/wAAAAH/4AB/8AD/wAAAAD/8AA/+AD/4AAAAB/+AA//AB/4AAAAAf/AAf/gB/4AAAAAP/wAP/wA/8AAAAAH/4AP/wA/8AAAAAB/+AH/4A/+AAAAAA//gH/8Af+AAAAAAP/4P/8Af+AAAAAAH////8AP/AAAAAAB////+AP/AAAAAAAf///+AP/gAAAAAAH///+AH/gAAAAAAB///+AH/gAAAAAAAf//8AD/wAB/4AAAD//4AD/wAH//wAAAH/gAD/4AP//+AAAAAAAB/4Af///gAAAAAAB/4Af///8AAAAAAA/8Af////AAAAAAA/8Af////gAAAAAA/+AP////4AAAAAAf+AP/8H/+AAAAAAf+AH/4B//AAAAAAP/AH/8Af/wAAAAAP/AD/8AH/4AAAAAP/gD/8AD/8AAAAAH/gB/+AA//AAAAAH/gA//AAf/gAAAAD/wAf/gAP/wAAAAD/wAP/wAH/4AAAAD/4AH/wAD/8AAAAB/4AD/4AB/+AAAAB/8AB/8AA//AAAAA/8AA/+AAf/gAAAA/8AAf/gAP/wAAAA/+AAP/wAH/4AAAAf+AAH/4AD/8AAAAf/AAD/8AB/+AAAAP/AAB/+AB/+AAAAP/AAAf/gA//AAAAP/gAAP/wA//gAAAH/gAAD/8A//gAAAH/wAAB//g//wAAAD/wAAAf////wAAAD/wAAAP////wAAAD/4AAAD////wAAAB/4AAAA////wAAAB/8AAAAH///wAAAA/8AAAAB///wAAAA/8AAAAAP//gAAAA/+AAAAAA/8AAA"],"&":[83.72,75,73,5,-72,"AAAAH/8AAAAAAAAAP///gAAAAAAAH////wAAAAAAD/////gAAAAAB/////8AAAAAAf/////gAAAAAH/////8AAAAAB//////gAAAAAP/////8AAAAAD//////gAAAAAf/////8AAAAAH//+Af/gAAAAA///AAP8AAAAAH//wAAPgAAAAB//8AAAcAAAAAP//gAAAAAAAAB//8AAAAAAAAAP//gAAAAAAAAB//8AAAAAAAAAP//wAAAAAAAAA//+AAAAAAAAAH//4AAAAAAAAA///AAAAAAAAAD//8AAAAAAAAAf//wAAAAAAAAB///AAAAAAAAAP//8AAAAAAAAA///gAAAAAAAAP//+AAAAAAAAH///4AAAAAAAB////gAAH/+AAf///+AAA//wAH////4AAH/+AB/////gAA//wAf////+AAP/+AH/////4AB//wB//////gAP/+Af/////8AB//gD//4///wAP/8A//+D///AD//gH//wP//8Af/8B//8A///wD//AP//AD///A//4B//4AP//8H//Af//AA///x//wD//wAD///f/+Af/+AAP/////wD//wAA/////8Af/+AAD/////gD//wAAf////4Af/+AAB/////AD//wAAH////wAf//AAAf///8AD//4AAB////gAf//gAAH///4AD//8AAAf//+AAP//wAAB///gAB///AAAP//+AAP//+AAD///4AA///4AB////AAH///4B////8AAf/////////wAB//////////AAP/////////8AA//////////wAD//////////AAP/////////8AAf/////8///wAB/////+D///AAD/////AP//4AAH////gB///gAAH///gAH//+AAAD/+AAAAAAAA=="],"'":[29.39,12,26,9,-70,"/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+/+"],"(":[43.88,29,86,8,-73,"AAP/8AA//wAB//gAH/+AAP/8AA//wAB//gAH//AAf/8AA//4AD//gAH//AAP/8AA//4AB//wAH//AAP/+AA//8AB//wAD//gAP//AAf/8AA//4AD//wAH//gAP/+AA//8AB//4AD//wAH//AAP/+AA//8AB//4AD//wAH//gAP//AAf/+AA//4AD//wAH//gAP//AAf/+AA//8AB//4AD//wAH//gAP//AAf/+AA//8AA//8AB//4AD//wAH//gAP//AAf/+AAf/8AA//4AB//4AD//wAH//gAH//AAP//AAf/+AAf/8AA//4AB//4AB//wAD//gAH//gAH//AAP/+AAP/+AAf/8AAf/4AA//4AB//wAB//wAD//gAD//AAD//AAH/+AAH/+AAP/8AAP/8AAf/4AAf/4"],")":[43.88,29,86,7,-73,"f/4AA//wAA//wAB//wAB//gAD//gAD//AAH//AAH/+AAP/+AAP/8AAf/8AA//4AA//4AB//wAB//wAD//gAH//AAH//AAP/+AAf/+AAf/8AA//4AB//4AD//wAD//gAH//AAP//AAf/+AA//8AA//4AB//4AD//wAH//gAP//AAf/+AA//8AB//4AB//wAD//gAH//gAP//AAf/+AA//8AB//4AD//wAH//AAP/+AA//8AB//4AD//wAH//gAP//AAf/+AA//8AB//wAH//gAP//AAf/+AA//4AB//wAH//gAP//AAf/8AA//4AD//wAH//AAP/+AA//8AB//wAD//gAP/+AAf/8AB//wAD//gAH/+AAf/8AA//wAD//gAH/+AAf/8AA//wAD//gAH/+AAf/4AA//wAA"],"*":[50.2,48,45,1,-72,"AAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAACAAP8AAQDgAP8AB4H4AP8AH4H+AP8Af8P/gP8B/8f/4P8H/+f/+P8P/+H//P8//4B//////gAf////+AAH////8AAB////wAAAf///AAAAH//8AAAAD//wAAAAH//8AAAAf///AAAB////wAAH////8AAf////+AB//////gH//P8//4f/8P8P/+f/4P8D/+P/gP8B/8H+AP8Af8H4AP8AH4DgAP8AB4CAAP8AAQAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAAAAAP8AAA"],"+":[80.44,61,61,10,-61,"AAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAf/////////v/////////3/////////7/////////9/////////+//////////f/////////v/////////3/////////7/////////9/////////+AAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAAAAP/gAAAAAAAH/wAAAAAAAD/4AAAAAAAB/8AAAAAAAA/+AAAAAAAAf/AAAAAA=="],",":[36.47,22,32,5,-18,"B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//D//4P//A//8D//gf/8B//wH/+Af/wD//AP/4A//AD/8Af/gB/8AH/wAf+AD/wAA=="],"-":[39.84,30,14,5,-34,"//////////////////////////////////////////////////////////////////////A="],".":[36.47,18,18,9,-18,"f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//A="],"/":[35.06,36,79,0,-70,"AAAA/+AAAA/+AAAA/8AAAA/8AAAB/8AAAB/4AAAB/4AAAD/4AAAD/wAAAD/wAAAH/wAAAH/gAAAH/gAAAP/gAAAP/gAAAP/AAAAP/AAAAf/AAAAf+AAAAf+AAAA/+AAAA/8AAAA/8AAAB/8AAAB/4AAAB/4AAAD/4AAAD/wAAAD/wAAAH/wAAAH/wAAAH/gAAAH/gAAAP/gAAAP/AAAAP/AAAAf/AAAAf+AAAAf+AAAA/+AAAA/8AAAA/8AAAB/8AAAB/4AAAB/4AAAD/4AAAD/4AAAD/wAAAD/wAAAH/wAAAH/gAAAH/gAAAP/gAAAP/AAAAP/AAAAf/AAAAf+AAAAf+AAAA/+AAAA/8AAAA/8AAAB/8AAAB/8AAAB/4AAAB/4AAAD/4AAAD/wAAAD/wAAAH/wAAAH/gAAAH/gAAAP/gAAAP/AAAAP/AAAAf/AAAAf+AAAAf+AAAA/+AAAA/+AAAAA="],"0":[66.8,59,73,4,-72,"AAAA/+AAAAAAAf//wAAAAAH///8AAAAA////+AAAAH////+AAAAf/////AAAB//////AAAH//////AAAf//////AAB///////AAH//////+AAP//////+AA///wH//+AD//+AD//8AH//4AD//8Af//gAD//4A///AAH//4B//8AAH//wH//4AAP//wP//gAAf//gf//AAAf//B//+AAA//+D//8AAB//+H//wAAD//8P//gAAH//4///AAAH//x//+AAAP//j//8AAAf//n//4AAA///P//wAAB//+f//gAAD//8///AAAH//5//+AAAP//z//8AAAf//n//4AAA///P//wAAB//+f//gAAD//8///AAAH//5//+AAAP//z//8AAAf//n//4AAA///P//wAAB//+f//gAAD//8///AAAH//5//+AAAP//z//8AAAf//n//4AAA//+P//wAAB//8P//gAAH//4f//gAAP//w///AAAf//h//+AAA//+B//8AAB//8D//4AAH//4H//4AAP//wH//wAAf//AP//wAB//+Af//gAH//4Af//gAP//wA///gB///AA///wH//+AA///////4AB///////gAB///////AAB//////8AAB//////wAAB//////AAAB/////8AAAB/////gAAAA////+AAAAAf///wAAAAAH//8AAAAAAA/+AAAAA="],"1":[66.8,51,70,10,-70,"AAP//8AAAA////gAAD////8AAD/////gAAf////8AAD/////gAAf////8AAD/////gAAf////8AAD/////gAAf////8AAD/////gAAf////8AAD/+P//gAAf4B//8AADgAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAAAAP//gAAAAB//8AAD///////+f///////z///////+f///////z///////+f///////z///////+f///////z///////+f///////z///////+f///////z///////+A"],"2":[66.8,52,72,7,-72,"AAB//gAAAAH///8AAAP////+AAH/////+AB//////8AH//////8Af//////4B///////wH///////gf///////B///////8H///////4f/8Af///h/8AAf///H/AAAf//8fgAAA///x4AAAB///mAAAAH//+QAAAAP//4AAAAA///gAAAAB//+AAAAAH//4AAAAAf//gAAAAB//+AAAAAH//4AAAAAf//gAAAAD//8AAAAAP//wAAAAA///AAAAAH//4AAAAAf//gAAAAD//8AAAAAf//wAAAAD//+AAAAAf//wAAAAD//+AAAAAf//4AAAAD///AAAAAf//4AAAAD///AAAAAf//4AAAAD///AAAAAf//4AAAAH///AAAAA///4AAAAH//+AAAAA///wAAAAH//+AAAAA///wAAAAH//+AAAAA///wAAAAH//+AAAAA///wAAAAH//+AAAAA///wAAAAP//8AAAAB///gAAAAP//8AAAAB///gAAAAH///////+f///////5////////n///////+f///////5////////n///////+f///////5////////n///////+f///////5////////n///////+"],"3":[66.8,54,73,6,-72,"AAD//4AAAAD////wAAB/////+AAH//////gAH//////4AH//////8AH//////+AH///////AH///////gH///////wH///////wH///////wH/4AP///4H+AAB///4HgAAAf//4GAAAAP//4AAAAAP//4AAAAAH//4AAAAAH//4AAAAAH//4AAAAAH//4AAAAAH//4AAAAAH//4AAAAAH//4AAAAAP//wAAAAAP//wAAAAAf//gAAAAB///AAAAAP///AAA/////+AAA/////4AAA/////gAAA////+AAAA////8AAAA/////AAAA/////wAAA/////8AAA/////+AAA//////AAA//////gAA//////wAAAAf///4AAAAB///4AAAAAf//8AAAAAP//8AAAAAH//8AAAAAD//+AAAAAD//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAD//+AAAAAD//+QAAAAH//+8AAAAP//8/AAAAf//8/8AAB///8//wAP///4////////4////////w////////g////////g////////A///////8A///////4A///////wA///////AAP/////4AAAf////AAAAAP//AAAAA=="],"4":[66.8,59,70,4,-70,"AAAAD///AAAAAAP//+AAAAAAf//8AAAAAB///4AAAAAH///wAAAAAP///gAAAAA////AAAAAD///+AAAAAH///8AAAAAf///4AAAAB////wAAAAD////gAAAAP////AAAAA////+AAAAB////8AAAAH////4AAAAf/3//wAAAA//v//gAAAD/+f//AAAAP/4//+AAAAf/h//8AAAB//D//4AAAH/8H//wAAAP/wP//gAAA//gf//AAAD/+A//+AAAP/4B//8AAAf/wD//4AAB//AH//wAAH/8AP//gAAP/4Af//AAA//gA//+AAD/+AB//8AAH/8AD//4AAf/wAH//wAB//AAP//gAD/+AAf//AAP/4AA//+AA//gAB//8AB//AAD//4AH/8AAH//wAf/wAAP//gA//gAAf//AB/+AAA//+AD/////////3/////////v/////////f////////+/////////9/////////7/////////3/////////v/////////f////////+/////////9/////////7/////////wAAAAD//4AAAAAAH//wAAAAAAP//gAAAAAAf//AAAAAAA//+AAAAAAB//8AAAAAAD//4AAAAAAH//wAAAAAAP//gAAAAAAf//AAAAAAA//+AAAAAAB//8AAAAAAD//4AAA=="],"5":[66.8,54,71,7,-70,"H///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH///////AH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//AAAAAAH//H/4AAAH/////gAAH/////8AAH//////AAH//////wAH//////4AH//////8AH//////+AH///////AH///////gH///////wH///////wH/4Af///4H+AAD///4HgAAA///8EAAAAP//8AAAAAP//8AAAAAH//8AAAAAD//+AAAAAD//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAB//+AAAAAD//+AAAAAD//+4AAAAH//8+AAAAP//8/gAAAP//8/4AAA///4//AAD///4//8Af///w////////w////////g////////A////////A///////+A///////4A///////wAP//////gAD/////+AAAf////4AAAB////AAAAAD//gAAAA"],"6":[66.8,57,73,5,-72,"AAAAH/+AAAAAAP///wAAAAP////wAAAH/////gAAD/////8AAA//////gAAf/////8AAH//////gAB//////8AAf//////gAH//////8AB///////gAP///gB/8AD///gAA/gA///wAAA8AH//8AAAAgB//+AAAAAAP//gAAAAAD//8AAAAAAf//AAAAAAD//4AAAAAA//+AAAAAAH//wAAAAAA//8AAAAAAP//gAAAAAB//8Af+AAAP//g///AAB//4f///AAP//P///8AD///////4Af///////gD///////+Af///////4D////////gf///////+D////////wf////////D///+A///4f///AB///j///wAH//8f//8AAf//z///gAB//+f//4AAP//z///AAA//+f//4AAH//z///AAA///P//wAAH//5//+AAA///P//wAAH//5//+AAA///P//wAAH//4//+AAA//+H//4AAH//w///AAA//+H//4AAH//wf//AAB//+D//8AAP//gP//gAD//8B//+AA///gH//4AP//4A///wH///AD///////wAP//////8AB///////gAH//////4AAf/////+AAB//////gAAH/////4AAAP////8AAAA/////AAAAB////gAAAAB///gAAAAAA//AAAAA="],"7":[66.8,54,70,6,-70,"////////+////////+////////+////////+////////+////////+////////+////////+////////+////////+////////+////////+////////8AAAAAD//8AAAAAH//4AAAAAH//4AAAAAH//wAAAAAP//wAAAAAP//gAAAAAf//gAAAAAf//AAAAAA///AAAAAA///AAAAAB//+AAAAAB//+AAAAAD//8AAAAAD//8AAAAAD//4AAAAAH//4AAAAAH//wAAAAAP//wAAAAAP//gAAAAAf//gAAAAAf//gAAAAA///AAAAAA///AAAAAB//+AAAAAB//+AAAAAB//8AAAAAD//8AAAAAD//4AAAAAH//4AAAAAH//wAAAAAP//wAAAAAP//wAAAAAf//gAAAAAf//gAAAAA///AAAAAA///AAAAAA//+AAAAAB//+AAAAAB//8AAAAAD//8AAAAAD//4AAAAAH//4AAAAAH//wAAAAAP//wAAAAAP//wAAAAAP//gAAAAAf//gAAAAAf//AAAAAA///AAAAAA//+AAAAAB//+AAAAAB//8AAAAAD//8AAAAAD//4AAAAAH//4AAAAAH//4AAAAAH//wAAAAA="],"8":[66.8,56,73,5,-72,"AAAH//AAAAAA////gAAAB/////AAAB/////8AAB//////wAA//////+AAf//////wAP//////+AH///////wD///////8A////////gP///////4H///gP///B///gA///wf//gAH//8H//4AA///D//8AAH//w///AAB//8P//wAAf//B//8AAH//wf//AAB//8H//wAAf//B//8AAH//wf//AAB//4D//4AA//+A//+AAf//gH//4AP//wB///gP//4AP//////8AB//////+AAH//////AAA//////gAAD/////gAAAH////AAAAH////8AAAH/////wAAH//////AAH//////4AD///////gB///////8A///4D///AP//wAH//4H//4AA///B//8AAH//w//+AAB//+P//gAAP//n//wAAD//5//8AAA//+f//AAAH//3//wAAB//9//8AAAf//f//AAAH//3//wAAB//9//8AAA///f//AAAP//3//4AAD//9//+AAB//+P//wAAf//j//+AAP//4///wAH//+P///gP///B////////wf///////4D///////+Af///////AD///////gAf//////wAD//////4AAf/////8AAB/////8AAAH////8AAAAP///4AAAAAH//AAAA=="],"9":[66.8,57,73,4,-72,"AAAD/8AAAAAAH//+AAAAAH///8AAAAD////4AAAB/////wAAAf/////AAAH/////8AAB//////4AAf//////AAH//////8AB///////wAP///////AD///gf//4A///gA///gH//4AD//8A//+AAP//wP//wAA//+B//8AAH//4P//gAAf//D//8AAD//4f//gAAf//j//4AAD//8f//AAAf//j//4AAD//8f//AAAf//z//4AAD//+f//AAAf//z//8AAD//+f//gAAf//z//8AAD//+f//gAA///x//+AAH///P//wAB///5///AAf///H//8AH///4///8D////D////////4f////////B////////4H////////A////////wD///////+AP///////wAf//////+AB////3//wAD///4//+AAH//4H//wAAD/4A//8AAAAAAH//gAAAAAB//8AAAAAAP//gAAAAAB//4AAAAAAf//AAAAAAD//4AAAAAA//+AAAAAAP//wAAAAAD//8AEAAAA///gA4AAAP//4AH4AAH///AA/8AH///wAH//////8AA///////AAH//////wAA//////8AAH//////AAA//////wAAH/////8AAA/////+AAAH/////gAAAf////gAAAAP///wAAAAAD//AAAAAA="],":":[38.39,18,53,10,-53,"f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//A"],";":[38.39,22,67,6,-53,"B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAf//B//8H//wf//B//8H//wf//B//8H//wf//B//8H//wf//B//8H//w//+D//wP//A//4H//Af/8B//gH/8A//wD/+AP/wA//AH/4Af/AB/8AP/gA/8AAA="],"<":[80.44,61,54,10,-57,"AAAAAAAAABAAAAAAAAAHgAAAAAAAAfwAAAAAAAB/4AAAAAAAD/8AAAAAAAP/+AAAAAAA///AAAAAAD///gAAAAAH///wAAAAAf///4AAAAB////8AAAAH////+AAAAf////8AAAA/////wAAAD/////AAAAP////8AAAA/////wAAAD/////AAAAH////8AAAAf////wAAAB/////AAAAH////8AAAAD////wAAAAB////AAAAAA///+AAAAAAf//4AAAAAAP//gAAAAAAH//gAAAAAAD//+AAAAAAB///4AAAAAA////gAAAAAf///+AAAAAP////4AAAAA/////gAAAAD////+AAAAAP////4AAAAB/////gAAAAH////+AAAAAf////4AAAAB/////gAAAAH////+AAAAA/////4AAAAD/////AAAAAP////gAAAAA////wAAAAAD///4AAAAAAf//8AAAAAAB//+AAAAAAAH//AAAAAAAAf/gAAAAAAAD/wAAAAAAAAP4AAAAAAAAA8AAAAAAAAACA=="],"=":[80.44,61,32,10,-46,"//////////f/////////v/////////3/////////7/////////9/////////+//////////f/////////v/////////3/////////7/////////8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH/////////7/////////9/////////+//////////f/////////v/////////3/////////7/////////9/////////+//////////f/////////g=="],">":[80.44,61,54,10,-57,"wAAAAAAAAAeAAAAAAAAAP4AAAAAAAAH/gAAAAAAAD/+AAAAAAAB//4AAAAAAA///AAAAAAAf//8AAAAAAP///wAAAAAH////AAAAAD////4AAAAB/////gAAAAH////+AAAAAf////4AAAAB/////gAAAAH////8AAAAA/////wAAAAD/////AAAAAP////8AAAAA/////wAAAAD////+AAAAAP////4AAAAA////8AAAAAD///+AAAAAAP///AAAAAAA///gAAAAAAD//wAAAAAAB//4AAAAAAH//8AAAAAAf//+AAAAAB////AAAAAH////gAAAAf////wAAAB/////AAAAH////+AAAAf////4AAAA/////gAAAD////+AAAAP////4AAAA/////wAAAD/////AAAAP////8AAAA/////wAAAAf////gAAAAP///+AAAAAH///4AAAAAD///gAAAAAB//+AAAAAAA//8AAAAAAAf/wAAAAAAAP/AAAAAAAAH8AAAAAAAADwAAAAAAAABgAAAAAAAAAA=="],"?":[55.69,44,70,6,-70,"AAf/4AAAH///4AAf////wAf/////AH/////4B//////gf/////8H//////B//////4f//////H//////x//////+f/wD///n/AAP//5+AAB//+eAAAP//mAAAD//4AAAA//+AAAAH//gAAAD//4AAAA//+AAAAP//gAAAH//4AAAB//+AAAA///AAAAf//wAAAP//4AAAH//8AAAD///AAAB///gAAA///wAAAf//4AAAP//8AAAH//+AAAD///AAAB///gAAA///wAAAP//4AAAH//8AAAB//+AAAAf//AAAAP//wAAAD//4AAAA//+AAAAP//gAAAD//4AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP//gAAAD//4AAAA//+AAAAP//gAAAD//4AAAA//+AAAAP//gAAAD//4AAAA//+AAAAP//gAAAD//4AAAA//+AAAAP//gAAAD//4AAAA//+AAAAP//gAAAD//4AAA=="],"@":[96.0,84,84,6,-68,"AAAAAA//gAAAAAAAAAAP///gAAAAAAAAD////8AAAAAAAAP/////gAAAAAAA//////4AAAAAAD//////+AAAAAAP///////AAAAAA////////wAAAAB////////4AAAAD///gAf//8AAAAP//4AAA//+AAAAf//AAAAP//gAAA//8AAAAB//wAAB//wAAAAAf/wAAD//AAAAAAP/4AAD/+AAAAAAD/8AAH/4AAAAAAB/+AAP/wAAAAAAA//AAf/gAAAAAAAf/AAf/AAAAAAAAP/gA/+AAAAAAAAH/gA/8AAA/wAAAD/wB/4AAH/+D/wD/wB/4AAf//D/wB/4D/wAA///z/wA/4D/gAB///7/wA/4H/gAD///7/wA/8H/AAH/////wAf8H/AAP/////wAf8P/AAf/////wAf8P+AAf/4H//wAP+P+AA//gB//wAP+f8AA//AA//wAP+f8AA/+AAf/wAP+f8AB/+AAP/wAP+f8AB/8AAP/wAP+f8AB/8AAP/wAP+f4AB/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAP+/4AD/4AAH/wAf8/4AD/4AAH/wAf8f4AB/4AAH/wA/8f8AB/8AAP/wA/4f8AB/8AAP/wB/4f8AB/+AAP/wD/4f8AB/+AAf/wH/wf8AA//AA//wP/gP+AA//gB//wf/gP+AAf/4H//z//AP+AAf///////+AP/AAP///////8AH/AAH///////4AH/gAD///7///wAH/gAB///7///gAD/wAA///z//+AAD/4AAf//D//4AAB/4AAH/+D//AAAB/8AAA/wD/wAAAA/+AAAAAAAAAAAAf/AAAAAAAAAAAAf/gAAAAAAAAAAAP/wAAAAAAAAAAAH/4AAAAAACAAAAH/8AAAAAAGAAAAD//AAAAAAfAAAAB//gAAAAB/gAAAA//4AAAAD/gAAAAf/+AAAAf/wAAAAP//wAAD//4AAAAH///gA///4AAAAB////////wAAAAA////////gAAAAAP//////+AAAAAAH//////4AAAAAAB//////gAAAAAAAf////+AAAAAAAAD////4AAAAAAAAAf///AAAAAAAAAAA//gAAAAA"],"A":[74.3,74,70,0,-70,"AAAAP///AAAAAAAAD///wAAAAAAAB///+AAAAAAAAf///gAAAAAAAH///8AAAAAAAD////AAAAAAAA////wAAAAAAAP///+AAAAAAAH////gAAAAAAB////4AAAAAAA/////AAAAAAAP////wAAAAAAD////+AAAAAAB/////gAAAAAAf////4AAAAAAH/////AAAAAAD/////wAAAAAA//+//8AAAAAAP//P//gAAAAAH//z//4AAAAAB//8f/+AAAAAA//+H//wAAAAAP//h//8AAAAAD//4P//gAAAAB//8D//4AAAAAf//A//+AAAAAH//wH//wAAAAD//4B//8AAAAA//+Af//AAAAAf//gD//4AAAAH//wA//+AAAAB//8AP//wAAAA///AB//8AAAAP//gAf//AAAAD//4AH//4AAAB//+AA//+AAAAf//AAP//gAAAH//wAD//8AAAD//4AAf//AAAA//+AAH//4AAAf//gAA//+AAAH//wAAP//gAAB//8AAD//8AAA///AAAf//AAAP////////wAAD////////+AAB/////////gAAf////////4AAP/////////AAD/////////wAA/////////+AAf/////////gAH/////////4AB//////////AA//////////wAP/////////8AH//////////gB//+AAAAH//4Af//gAAAA///AP//wAAAAP//wD//8AAAAD//8A///AAAAAf//gf//gAAAAH//4H//4AAAAB//+B//8AAAAAP//w///AAAAAD//8P//wAAAAA///n//4AAAAAH//5//+AAAAAB//+f//gAAAAAP//w"],"B":[73.17,59,70,8,-70,"f/////gAAA//////+AAB///////gAD///////4AH///////4AP///////4Af///////4A////////4B////////4D////////4H////////wP////////gf//gAH///g///AAD///B//+AAD//+D//8AAD//8H//4AAH//4P//wAAP//4f//gAAf//w///AAA///B//+AAB//+D//8AAD//8H//4AAH//4P//wAAP//wf//gAA///A///AAD//+B//+AAf//4D////////wH////////AP///////8Af///////wA///////+AB///////4AD///////8AH///////+AP///////+Af///////+A////////+B////////+D//8AAf//+H//4AAP//8P//wAAH//8f//gAAH//4///AAAP//5//+AAAP//z//8AAAf//n//4AAA///P//wAAB//+f//gAAD//8///AAAH//5//+AAAP//z//8AAAf//n//4AAA///P//wAAD//+f//gAAH//8///AAAf//5//+AAD///z//8AAf///H////////+P////////4f////////w/////////B////////8D////////wH////////AP///////8Af///////gA///////8AB///////AAD//////AAAAA=="],"C":[70.45,61,73,4,-72,"AAAAAf/8AAAAAAH///8AAAAAf////wAAAA//////AAAD//////4AAD//////+AAH///////AAH///////gAH///////wAP///////4AP///////8AP///////+AH////////AH////AB//gH///8AAD/wH///4AAAf4D///wAAAB8D///wAAAAeB///wAAAADB///wAAAAAA///wAAAAAA///wAAAAAAf//4AAAAAAP//4AAAAAAP//8AAAAAAH//8AAAAAAD//+AAAAAAB///AAAAAAB///AAAAAAA///gAAAAAAf//wAAAAAAP//4AAAAAAH//8AAAAAAD//+AAAAAAB///AAAAAAA///AAAAAAAf//gAAAAAAP//wAAAAAAH//8AAAAAAD//+AAAAAAB///AAAAAAA///gAAAAAAf//wAAAAAAP//4AAAAAAH//8AAAAAAB///AAAAAAA///gAAAAAAf//wAAAAAAP//8AAAAAAD//+AAAAAAB///gAAAAAA///wAAAAAAP//8AAAAAAH///AAAAAAB///wAAAADA///8AAAAHgP///AAAAHwH///4AAAf4B////AAA/8Af///8AH/+AH////////AD////////gA////////wAP///////4AB///////8AAf//////+AAH///////AAA///////gAAP//////gAAB//////AAAAH////8AAAAAf///wAAAAAAf/8AAA="],"D":[79.69,67,70,8,-70,"f////4AAAAAP/////+AAAAH//////8AAAD///////wAAB///////+AAA////////wAAf///////+AAP////////gAH////////4AD////////+AB/////////gA/////////4Af////////+AP//wAP////gH//4AAf///4D//8AAB///+B//+AAAP///A///AAAD///wf//gAAA///4P//wAAAP//+H//4AAAD///D//8AAAA///h//+AAAAf//4///AAAAH//8f//gAAAD//+P//wAAAA///n//4AAAAf//z//8AAAAP//5//+AAAAH//8///AAAAB//+f//gAAAA///P//wAAAAf//3//4AAAAP//7//8AAAAH//9//+AAAAD//+///AAAAB///f//gAAAA///v//wAAAAf//3//4AAAAP//7//8AAAAH//5//+AAAAD//8///AAAAD//+f//gAAAB///P//wAAAA///n//4AAAAf//z//8AAAAf//x//+AAAAP//4///AAAAP//8f//gAAAH//8P//wAAAH//+H//4AAAH///D//8AAAH///B//+AAAH///g///AAAP///gf//gAAP///wP//wAA////wH//4AH////wD/////////wB/////////wA/////////wAf////////wAP////////wAH////////wAD////////wAB////////gAA////////AAAf//////+AAAP//////4AAAH//////AAAAD/////AAAAAAA="],"E":[65.58,51,70,8,-70,"f///////z///////+f///////z///////+f///////z///////+f///////z///////+f///////z///////+f///////z///////+f///////z//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD///////4f///////D///////4f///////D///////4f///////D///////4f///////D///////4f///////D///////4f///////D///////4f//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD////////f///////7////////f///////7////////f///////7////////f///////7////////f///////7////////f///////7////////A"],"F":[65.58,50,70,8,-70,"f///////3///////9////////f///////3///////9////////f///////3///////9////////f///////3///////9////////f///////3//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf///////H///////x///////8f///////H///////x///////8f///////H///////x///////8f///////H///////x///////8f///////H//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAH//4AAAAB//+AAAAAf//gAAAAA"],"G":[78.8,68,73,4,-72,"AAAAAP//AAAAAAAB////wAAAAAH/////wAAAAH//////gAAAH///////AAAH///////4AAH///////+AAD////////gAB////////4AA////////+AA/////////gAP////////4AH////////+AD////wAP//gB////AAAH/4A////AAAAP+AP///AAAAA/gH///gAAAAD4B///wAAAAAOA///4AAAAAAgP//8AAAAAAAH//+AAAAAAAB///gAAAAAAAf//wAAAAAAAP//8AAAAAAAD//+AAAAAAAA///gAAAAAAAP//4AAAAAAAH//8AAAAAAAB///AAAAAAAAf//wAAAAAAAH//8AAAAAAAB///AAAAAAAAf//wAAD////3//8AAA////9//+AAAP////f//gAAD////3//4AAA////9//+AAAP////f//wAAD////3//8AAA////9///AAAP////f//wAAD////3//8AAA////9///AAAP////P//4AAAAH//z//+AAAAB//8///gAAAAf//P//8AAAAH//x///AAAAB//8f//4AAAAf//H//+AAAAH//w///wAAAB//8P//+AAAAf//B///wAAAH//wf//+AAAB//8D///wAAAf//A////AAAH//wH///8AAD//8A////8AH///AH/////////wB/////////8AP/////////AB/////////wAH////////8AA/////////AAH////////gAAf///////gAAD///////gAAAP//////AAAAAf////+AAAAAA////4AAAAAAAf/+AAAA"],"H":[80.34,64,70,8,-70,"f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f/////////9//////////3//////////f/////////9//////////3//////////f/////////9//////////3//////////f/////////9//////////3//////////f/////////9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//9//+AAAAf//3//4AAAB///f//gAAAH//8="],"I":[35.72,19,70,8,-70,"f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//9//+///f//v//3//7//8A="],"J":[35.72,33,89,-6,-70,"AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AA///AAH//4AB///AAP//4AB//+AAf//wAD//+AA///wAP//8AD///gD///8f////D////4f///+D////wf///8D////Af///wD///8Af//+AD///gAf//gAD//gAAf/AAAAA="],"K":[74.39,70,70,8,-70,"f//gAAAP//+B//+AAAB///wH//4AAAP//+Af//gAAB///wB//+AAAP//+AH//4AAB///wAf//gAAP//+AB//+AAB///wAH//4AAP//+AAf//gAB///wAB//+AAP//+AAH//4AB///wAAf//gAP//+AAB//+AB///wAAH//4AP//+AAAf//gB///wAAB//+AP//+AAAH//4B///wAAAf//gP//+AAAB//+B///wAAAH//4P//+AAAAf//h///wAAAB//+P//+AAAAH//5///wAAAAf//v//+AAAAB//////wAAAAH/////+AAAAAf/////wAAAAB/////+AAAAAH/////wAAAAAf////+AAAAAB/////wAAAAAH////+AAAAAAf////4AAAAAB/////gAAAAAH/////gAAAAAf/////AAAAAB/////+AAAAAH/////8AAAAAf/////4AAAAB//////wAAAAH//////gAAAAf//////AAAAB//+///+AAAAH//5///8AAAAf//j///4AAAB//+H///wAAAH//4P///gAAAf//gf///AAAB//+A///+AAAH//4B///8AAAf//gD///4AAB//+AH///wAAH//4AP///gAAf//gAf///AAB//+AA///+AAH//4AB///8AAf//gAD///4AB//+AAH///wAH//4AAP///gAf//gAAf///AB//+AAA///+AH//4AAB///8Af//gAAD///4B//+AAAH///wH//4AAAP///gf//gAAAf///B//+AAAA///+H//4AAAB///8f//gAAAD///4A=="],"L":[61.17,51,70,8,-70,"f//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD//8AAAAAf//gAAAAD////////f///////7////////f///////7////////f///////7////////f///////7////////f///////7////////f///////7////////A"],"M":[95.53,79,70,8,-70,"f///AAAAAP///v///gAAAAP///3///4AAAAH///7///8AAAAH///9////AAAAD///+////gAAAD////f///4AAAB////v///8AAAA////3///+AAAA////7////gAAAf///9////wAAAf///+////8AAAP////f///+AAAP////v////AAAH////3////wAAD////7////4AAD////9////+AAB////+/////AAB/////f////wAA/////v////4AA/////3//3/8AAf/7//7//7//AAP/9//9//9//gAP/8//+//+f/4AH/+f//f//P/8AH/+P//v//j//AD//H//3//x//gD//D//7//4f/wB//h//9//8P/8A//w//+//+H/+A//wf//f//B//gf/4P//v//g//wf/4H//3//wP/4P/8D//7//4H/+H/8B//9//8B//H/+A//+//+A//z//Af//f//Af/7//AP//v//gH////gH//3//wD////gD//7//4A////wB//9//8Af///wA//+//+AP///4Af//f//AD///8AP//v//gB///8AH//3//wAf//+AD//7//4AP//+AB//9//8AD///AA//+//+AB///gAf//f//AA///gAP//v//gAP//wAH//3//wAH//wAD//7//4AB//4AB//9//8AA//4AA//+//+AAP/8AAf//f//AAH/+AAP//v//gAD/+AAH//3//wAA//AAD//7//4AAAAAAB//9//8AAAAAAA//+//+AAAAAAAf//f//AAAAAAAP//v//gAAAAAAH//3//wAAAAAAD//7//4AAAAAAB//9//8AAAAAAA//+//+AAAAAAAf//f//AAAAAAAP//v//gAAAAAAH//3//wAAAAAAD//7//4AAAAAAB//8A="],"N":[80.34,64,70,8,-70,"f//4AAAD//9///wAAAP//3///AAAA///f//+AAAD//9///4AAAP//3///wAAA///f///AAAD//9///+AAAP//3///4AAA///f///wAAD//9////gAAP//3///+AAA///f///8AAD//9////wAAP//3////gAA///f///+AAD//9////8AAP//3////wAA///f////gAD//9////+AAP//3////8AA///f////wAD//9/////gAP//3//3/+AA///f//f/8AD//9//8//wAP//3//z//gA///f//H//AD//9//8f/8AP//3//w//4A///f//D//gD//9//8H//AP//3//wf/8A///f//A//4D//9//8B//gP//3//wH//A///f//AP/8D//9//8A//4P//3//wB//g///f//AH//D//9//8AP/8P//3//wA//4///f//AB//j//9//8AH//P//3//wAP/+///f//AA//7//9//8AB/////3//wAH/////f//AAP////9//8AAf////3//wAB/////f//AAD////9//8AAP////3//wAAf////f//AAB////9//8AAD////3//wAAP////f//AAAf///9//8AAB////3//wAAD////f//AAAP///9//8AAAf///3//wAAB////f//AAAD///9//8AAAP///3//wAAAf///f//AAAA///9//8AAAD///3//wAAAH///f//AAAAf//8="],"O":[81.61,73,73,4,-72,"AAAAA//wAAAAAAAAP///wAAAAAAA/////AAAAAAD/////4AAAAAH//////AAAAAH//////4AAAAP//////+AAAAP///////wAAAP///////8AAAP////////AAAP////////wAAP////////8AAP/////////AAP///4A////gAH///wAD///4AH///gAAf//+AH///AAAH///AD///AAAB///wD///gAAAf//4B///gAAAH//+B///gAAAD///A///wAAAA///gf//wAAAAP//4f//4AAAAH//8P//4AAAAD//+H//8AAAAA///j//+AAAAAf//x//+AAAAAP//5///AAAAAH//8///gAAAAB//+f//wAAAAA///P//4AAAAAf//3//8AAAAAP//7//+AAAAAH//9//+AAAAAD//+///AAAAAB///f//gAAAAA///v//wAAAAAf//3//4AAAAAP//7//+AAAAAH//9///AAAAAD//+///gAAAAB///f//wAAAAA///P//4AAAAAf//n//8AAAAAf//x//+AAAAAP//4///gAAAAH//8f//wAAAAD//+P//4AAAAD//+H//+AAAAB///B///AAAAA///g///wAAAA///gf//4AAAAf//wH//+AAAAf//4D///gAAAf//4A///wAAAf//8Af//8AAAf//8AH///gAAf//+AB///8AA///+AA////gD///+AAP/////////AAD/////////AAA/////////AAAP////////AAAD////////AAAA////////AAAAP//////+AAAAB//////+AAAAAf/////8AAAAAD/////4AAAAAAP////wAAAAAAA////AAAAAAAAA//wAAAAAA=="],"P":[70.36,59,70,8,-70,"f/////wAAA///////AAB///////gAD///////4AH///////4AP///////8Af///////8A////////8B////////8D////////8H////////4P////////4f////////w///AAP///x//+AAH///j//8AAD///H//4AAD///P//wAAH//+f//gAAH//8///AAAP//5//+AAAP//z//8AAAf//n//4AAA///P//wAAB//+f//gAAD//8///AAAH//5//+AAAf//z//8AAA///n//4AAD///P//wAAH//+f//gAAf//4///AAD///x//+AAf///j////////+H////////8P////////wf////////g////////+B////////4D////////gH///////+AP///////wAf///////AA///////wAB//////+AAD/////+AAAH//4AAAAAAP//wAAAAAAf//gAAAAAA///AAAAAAB//+AAAAAAD//8AAAAAAH//4AAAAAAP//wAAAAAAf//gAAAAAA///AAAAAAB//+AAAAAAD//8AAAAAAH//4AAAAAAP//wAAAAAAf//gAAAAAA///AAAAAAB//+AAAAAAD//8AAAAAAH//4AAAAAAP//wAAAAAAf//gAAAAAA///AAAAAAB//+AAAAAAD//8AAAAAAAA=="],"Q":[81.61,73,86,4,-72,"AAAAA//wAAAAAAAAP///wAAAAAAA/////AAAAAAD/////4AAAAAH//////AAAAAH//////4AAAAP///////AAAAP///////wAAAP///////8AAAP////////AAAP////////wAAP////////8AAP/////////AAP///4A////gAH///wAD///4AH///gAAf//+AH///AAAH///AD///AAAB///wD///gAAAf//4B///gAAAH//+A///gAAAD///A///wAAAA///gf//wAAAAP//4P//4AAAAH//8P//4AAAAD//+H//8AAAAA///j//+AAAAAf//x//+AAAAAP//5///AAAAAH//8///gAAAAB//+f//wAAAAA///P//4AAAAAf//3//8AAAAAP//7//+AAAAAH//9//+AAAAAD//+///AAAAAB///f//gAAAAA///v//wAAAAAf//3//4AAAAAP//7//+AAAAAH//9///AAAAAD//+///gAAAAB///f//wAAAAA///P//4AAAAAf//n//8AAAAAf//x//+AAAAAP//4///gAAAAH//8f//wAAAAD//+P//4AAAAD//+H//+AAAAB///B///AAAAA///g///gAAAA///gf//4AAAAf//wH//+AAAAf//4D///AAAAf//4A///wAAAf//8Af//8AAAf//8AH///gAAf//8AD///4AA///+AA////gD///+AAP////////+AAD/////////AAA/////////AAAP////////AAAD////////AAAA///////+AAAAP//////+AAAAB//////+AAAAAf/////8AAAAAD/////4AAAAAAP////8AAAAAAA/////AAAAAAAA////gAAAAAAAAD//4AAAAAAAAA//+AAAAAAAAAP//gAAAAAAAAD//4AAAAAAAAA//+AAAAAAAAAP//gAAAAAAAAH//4AAAAAAAAB//8AAAAAAAAAf//AAAAAAAAAH//wAAAAAAAAB//8AAAAAAAAAf//AAAAAAAAAH//wA="],"R":[73.92,64,70,8,-70,"f/////AAAAB//////8AAAH//////+AAAf//////+AAB///////8AAH///////8AAf///////4AB////////wAH////////AAf///////+AB////////4AH////////wAf////////AB//+AB///8AH//4AA///4Af//gAB///gB//+AAD//+AH//4AAP//4Af//gAAf//gB//+AAB//+AH//4AAH//4Af//gAAf//gB//+AAB//+AH//4AAH//4Af//gAAf//gB//+AAB//8AH//4AAP//wAf//gAA///AB//+AAH//4AH//4AA///gAf//gAf//8AB////////gAH///////8AAf///////gAB///////8AAH///////AAAf//////wAAB//////8AAAH//////8AAAf//////8AAB///////4AAH///////wAAf///////gAB////////AAH//4A///+AAf//gA///4AB//+AA///wAH//4AB///gAf//gAD//+AB//+AAP//8AH//4AAf//wAf//gAB///gB//+AAD//+AH//4AAH//8Af//gAAf//wB//+AAA///gH//4AAD//+Af//gAAH//8B//+AAAf//wH//4AAA///gf//gAAD//+B//+AAAH//8H//4AAAf//wf//gAAA///h//+AAAD//+H//4AAAH//8f//gAAAf//x//+AAAA///n//4AAAD//+f//gAAAH//8="],"S":[69.14,57,73,6,-72,"AAAP/+AAAAAAf///8AAAAf////+AAAP//////AAH//////8AB///////gAf//////8AH///////gB///////8Af///////gD///////8A////////gH///////8B///4AH//gP//4AAB/8B//8AAAA/gf//AAAAA8D//4AAAABAf/+AAAAAAD//wAAAAAAf/+AAAAAAD//wAAAAAAf//AAAAAAD//4AAAAAAf//gAAAAAD///AAAAAAf//+AAAAAB////AAAAAP////wAAAB/////8AAAH/////8AAA//////8AAD//////8AAf//////4AB///////gAH//////+AAf//////4AB///////gAD//////+AAH//////4AAP//////AAAP/////8AAAH/////gAAAD////8AAAAA////wAAAAA///+AAAAAB///wAAAAAD//+AAAAAAP//wAAAAAB//+AAAAAAP//wAAAAAA//+AAAAAAH//xAAAAAA//+eAAAAAP//z8AAAAB//+f4AAAAf//j/4AAAH//8f/4AAB///j//+AB///8f////////D////////4f///////+D////////wf///////8D////////Af///////wD///////8AH///////AAH//////gAAH/////wAAAB////wAAAAAP//AAAAA="],"T":[65.48,65,70,0,-70,"////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+AAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAAAAAP//wAAAAAAAf//gAAAAAAA///AAAAAAAB//+AAAAAAAD//8AAAAAAAH//4AAAA="],"U":[77.95,62,71,8,-70,"f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//4AAAH//5//+AAAB//+f//gAAAf//n//8AAAP//4///AAAD//8P//wAAA///D//+AAAf//w///gAAH//8H//8AAD//+B///gAB///gf//8AA///4D///4B///8A/////////AH////////gA////////wAP///////8AB///////+AAP///////AAB///////gAAP//////wAAA//////wAAAD/////wAAAAP////wAAAAAf///gAAAAAAP/8AAAAA="],"V":[74.3,74,70,0,-70,"f//gAAAAAP//3//4AAAAAH//5///AAAAAB//+P//wAAAAA///j//8AAAAAP//wf//gAAAAD//8H//4AAAAB//+B//+AAAAAf//gP//wAAAAH//4D//8AAAAD//8A///AAAAA///AH//4AAAAP//wB//+AAAAH//4Af//gAAAB//+AD//8AAAA///AA///AAAAP//wAH//4AAAD//8AB//+AAAB//+AAf//gAAAf//gAD//8AAAH//4AA///AAAD//8AAP//wAAA///AAB//+AAAP//gAAf//gAAH//4AAD//4AAB//+AAA///AAAf//AAAP//wAAP//wAAB//8AAD//8AAAf//gAB//+AAAH//4AAf//gAAA///AAH//4AAAP//wAD//8AAAB//8AA///AAAAf//gAP//gAAAH//4AH//4AAAA//+AB//+AAAAP//wAf//AAAAD//8AP//wAAAAf//AD//8AAAAH//4A//+AAAAB//+Af//gAAAAP//wH//wAAAAD//8D//8AAAAAf//A///AAAAAH//4P//gAAAAB//+H//4AAAAAP//h//+AAAAAD//8f//AAAAAA///P//wAAAAAH//z//4AAAAAB//+//+AAAAAAP/////gAAAAAD/////wAAAAAA/////8AAAAAAH/////AAAAAAB/////gAAAAAAf////4AAAAAAD////+AAAAAAA/////AAAAAAAP////wAAAAAAB////4AAAAAAAf///+AAAAAAAD////gAAAAAAA////wAAAAAAAP///8AAAAAAAB////AAAAAAAAf///gAAAAAAAH///4AAAAAAAA///8AAAAAAAAP///AAAAA"],"W":[105.89,101,70,2,-70,"f//AAAA///AAAA//+///AAAB//+AAAD//9//+AAAD//8AAAH//x//8AAAP//4AAAP//j//4AAAf//4AAAf//H//wAAA///wAAB//+P//wAAB///gAAD//4P//gAAH///AAAH//wf//AAAP///AAAP//g//+AAAf//+AAA///B//+AAA///8AAB//8B//8AAB///4AAD//4D//4AAH///4AAH//wH//wAAP///wAAP//gP//wAAf///gAA//+AP//gAA////AAB//8Af//AAD////AAD//4A//+AAH///+AAH//wB//+AAP/3/8AAf//gD//8AAf/n/4AA//+AD//4AB//P/wAB//8AH//wAD/+f/wAD//4AP//wAH/8//gAP//wAf//gAP/x//AAf//AAf//AA//h/+AA//+AA//+AB//D/+AB//8AB//8AD/+H/8AH//4AD//8AH/4P/4AP//gAD//4AP/wP/wAf//AAH//wA//gf/wA//+AAP//gB//A//gD//8AAf//gD/8B//AH//wAAf//AH/4B/+AP//gAA//+Af/wD/+Af//AAB//8A//gH/8A//+AAD//8B/+AP/4D//8AAD//4D/8AP/wH//wAAH//wP/4Af/gP//gAAP//gf/wA//gf//AAAf//g//gB//B//+AAA///B/+AB/+D//4AAA//+H/8AD/8H//wAAB//8P/4AH/8P//gAAD//4f/wAP/4///AAAH//4//AAf/x//8AAAH//x/+AAf/j//4AAAP//n/8AA//n//wAAAf//P/4AB//f//gAAA///f/gAD/+//+AAAA//+//AAD/9//8AAAB////+AAH////4AAAD////8AAP////wAAAH////wAAf////gAAAH////gAAf///+AAAAP////AAA////8AAAAf///+AAB////4AAAA////4AAD////wAAAA////wAAD////AAAAB////gAAH///+AAAAD////AAAP///8AAAAH///+AAAf///4AAAAP///4AAAf///gAAAAP///wAAA////AAAAAf///gAAB///+AAAAA////AAAD///8AAAAB///8AAAD///wAAAAB///4AAAH///gAAAAD///wAAAP///AAAAAH///gAAAf//+AAAAAP//+AAAA///8AAA="],"X":[74.02,72,70,1,-70,"P//4AAAAH//8H//8AAAAP//4H//8AAAAP//wD//+AAAAf//wB///AAAA///gA///AAAB///AA///gAAB///AAf//wAAD//+AAP//wAAH//8AAP//4AAH//8AAH//8AAP//4AAD//8AAf//wAAD//+AAf//wAAB///AA///gAAA///AB///AAAA///gB///AAAAf//wD//+AAAAP//4H//8AAAAP//4H//8AAAAH//8P//4AAAAD//+f//wAAAAD//+f//wAAAAB//////gAAAAA//////AAAAAA/////+AAAAAAf////+AAAAAAP////8AAAAAAP////4AAAAAAH////4AAAAAAD////wAAAAAAB////gAAAAAAB////gAAAAAAA////AAAAAAAAf//+AAAAAAAAf//+AAAAAAAA////AAAAAAAA////AAAAAAAB////gAAAAAAD////wAAAAAAD////wAAAAAAH////4AAAAAAP////8AAAAAAP////8AAAAAAf////+AAAAAA//////AAAAAB//////AAAAAB//////gAAAAD//+f//wAAAAH//8P//wAAAAH//8P//4AAAAP//4H//8AAAAf//wD//+AAAAf//wD//+AAAA///gB///AAAB///AA///gAAB///AA///gAAD//+AAf//wAAH//8AAP//4AAH//8AAP//4AAP//4AAH//8AAf//wAAD//+AAf//gAAD//+AA///gAAB///AB///AAAA///gB//+AAAAf//gD//+AAAAf//wH//8AAAAP//4H//4AAAAH//4P//4AAAAH//8f//wAAAAD//+"],"Y":[69.52,72,70,-1,-70,"///wAAAAH//+f//4AAAAH//8P//4AAAAP//8P//8AAAAf//4H//+AAAAf//wD//+AAAA///wD///AAAA///gB///gAAB///gA///gAAD///AA///wAAD//+AAf//4AAH//+AAP//4AAP//8AAP//8AAP//4AAH//8AAf//4AAD//+AA///wAAD///AA///gAAB///AB///gAAA///gD///AAAA///wD//+AAAAf//wH//+AAAAP//4H//8AAAAP//8P//4AAAAH//8f//4AAAAD//+f//wAAAAD//////gAAAAB//////gAAAAA//////AAAAAA/////+AAAAAAf////+AAAAAAf////8AAAAAAP////4AAAAAAH////4AAAAAAH////wAAAAAAD////gAAAAAAB////gAAAAAAB////AAAAAAAA///+AAAAAAAAf//+AAAAAAAAf//8AAAAAAAAP//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAAAAAAH//4AAAA"],"Z":[69.61,62,70,4,-70,"f/////////H/////////x/////////8f/////////H/////////x/////////8f/////////H/////////x/////////8f/////////H/////////x/////////8f////////+AAAAAAH///AAAAAAB///gAAAAAA///4AAAAAAf//8AAAAAAP//+AAAAAAH///AAAAAAB///gAAAAAA///wAAAAAAf//8AAAAAAP//+AAAAAAH///AAAAAAD///gAAAAAA///wAAAAAAf//8AAAAAAP//+AAAAAAH///AAAAAAD///gAAAAAA///wAAAAAAf//8AAAAAAP//+AAAAAAH///AAAAAAD///gAAAAAB///wAAAAAAf//4AAAAAAP//+AAAAAAH///AAAAAAD///gAAAAAB///wAAAAAAf//4AAAAAAP//+AAAAAAH///AAAAAAD///gAAAAAB///wAAAAAA///4AAAAAAP//8AAAAAAH///AAAAAAD///gAAAAAB///wAAAAAA///4AAAAAAP//8AAAAAAH///AAAAAAD///gAAAAAB///wAAAAAA///4AAAAAAf/////////n/////////7/////////+//////////v/////////7/////////+//////////v/////////7/////////+//////////v/////////7/////////+//////////g"],"[":[43.88,30,86,8,-73,"////+////+////+////+////+////+////+////+////+////+////+//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA//8AA////+////+////+////+////+////+////+////+////+////+////+A="],"\\":[35.06,36,79,0,-70,"/+AAAA/+AAAAf+AAAAf+AAAAf/AAAAP/AAAAP/AAAAP/gAAAH/gAAAH/gAAAH/wAAAD/wAAAD/wAAAD/4AAAB/4AAAB/4AAAB/8AAAB/8AAAA/8AAAA/8AAAA/+AAAAf+AAAAf+AAAAf/AAAAP/AAAAP/AAAAP/gAAAH/gAAAH/gAAAH/wAAAD/wAAAD/wAAAD/4AAAD/4AAAB/4AAAB/4AAAB/8AAAA/8AAAA/8AAAA/+AAAAf+AAAAf+AAAAf/AAAAP/AAAAP/AAAAP/gAAAH/gAAAH/gAAAH/wAAAH/wAAAD/wAAAD/wAAAD/4AAAB/4AAAB/4AAAB/8AAAA/8AAAA/8AAAA/+AAAAf+AAAAf+AAAAf/AAAAP/AAAAP/AAAAP/gAAAP/gAAAH/gAAAH/gAAAH/wAAAD/wAAAD/wAAAD/4AAAB/4AAAB/4AAAB/8AAAA/8AAAA/8AAAA/+AAAA/+A="],"]":[43.88,30,86,6,-73,"f////f////f////f////f////f////f////f////f////f////f////AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//AAP//f////f////f////f////f////f////f////f////f////f////f////A="],"^":[80.44,62,26,9,-70,"AAAAf/gAAAAAAAP/8AAAAAAAH//gAAAAAAD//8AAAAAAB///gAAAAAA///8AAAAAAf///gAAAAAP///8AAAAAH////gAAAAD////8AAAAB/////gAAAAf////8AAAAP//P//gAAAH//h//8AAAD//wH//gAAB//wA//8AAA//4AH//gAAf/8AAf/8AAP/8AAD//gAH/+AAAP/8AD//AAAB//AB//AAAAP/4A//gAAAA//Af/gAAAAH/4P/wAAAAA//H/4AAAAAD/4A=="],"_":[48.0,48,9,0,14,"////////////////////////////////////////////////////////////////////////"],"`":[48.0,27,18,4,-77,"f/wAB//AAH/8AAf/gAB/+AAH/4AAf/AAB/8AAH/wAAf/AAD/4AAP/gAA/+AAD/4AAP/AAA/8AAD/wAAP/A=="],"a":[64.78,54,56,4,-55,"AAD//8AAAAP////4AAB//////AAB//////wAB//////4AB//////+AB///////AB///////AB///////gB///////wB///////wB/+AB///4B/AAAP//4BwAAAD//8BAAAAB//8AAAAAB//8AAAAAA//8AAAAAA//+AAAAAA//+AAAAAA//+AAAAAA//+AAA/////+AAf/////+AD//////+AP//////+A///////+B///////+D///////+H///////+P///////+P///////+f//+AA//+f//wAA//+f//gAA//+f//AAA//+///AAA//+//+AAA//+//+AAA//+//+AAB//+//+AAB//+//+AAD//+///AAH//+///gAP//+f//wAf//+f//8D///+f///////+P///////+P///////+H////+//+D////8//+D////4//+A////w//+Af///g//+AP//+A//+AD//4A//+AAP/AAAAA"],"b":[68.72,57,74,8,-73,"//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AB/4AAH//wB//4AA//+A///wAH//wf///gA//+H///+AH//x////4A//+f////gH//3////+A////////4H////////A////////8H////////w////gf//+H///gAf//4///4AB///H//+AAH//4///wAA///n//8AAD//8///AAAf//n//4AAB//+///AAAP//3//4AAB//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+///AAAP//3//4AAB//+///AAAP//3//4AAD//8///gAAf//n//+AAH//8///wAA///H///AAP//4///8AD///H///8D///w////////+H////////g////////4H////////A//+/////wH//z////8A//+P////AH//w////wA//+D///8AH//wH//+AA//+AP//AAAAAAAP/AAAA"],"c":[56.91,47,56,4,-55,"AAAB//gAAAA///+AAAP////gAB/////gAP/////AA/////+AH/////8Af/////4B//////wH//////gf//////A//////+D///8Af8P///AAH4f//8AADx///gAABj//+AAAAH//8AAAAf//wAAAA///AAAAB//+AAAAD//8AAAAH//wAAAAf//gAAAA///AAAAB//+AAAAD//8AAAAH//4AAAAP//wAAAAf//gAAAA///AAAAB//+AAAAD//8AAAAD//4AAAAH//4AAAAP//wAAAAf//gAAAA///gAAAA///gAAAB///AAAAD///AAADD///gAAOH///gAB8H///4A/4H//////wP//////gP//////AP/////+AP/////8AP/////4AH/////wAH/////gAD/////AAB////8AAAf///AAAAD//AA="],"d":[68.72,57,74,4,-73,"AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAA/4AD//4AA//8Af//AAf//4D//4AP///gf//AD////D//4A////8f//AP////z//4D/////f//A////////4P////////B////////4f////////D///gP///4///wAf///H//8AA///5///AAH///P//wAAf//5//+AAB///f//gAAP//7//8AAA///f//gAAH//7//4AAA///f//AAAH//7//4AAA//////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf//f//AAAH//7//4AAA///f//AAAH//7//8AAA///f//gAAH//7//8AAB///P//wAAP//5//+AAD///P//4AA///4///gAH///H//+AD///4f//8B////D////////4P////////B////////4H////////Af////7//4B////+f//AH////j//4Af///4f//AB///8D//4AD///Af//AAH//gD//4AAH/AAAAAA"],"e":[65.11,57,56,4,-55,"AAAB/+AAAAAAH///AAAAAD////AAAAD////+AAAA/////4AAAf/////wAAH//////AAB//////8AAf//////wAH///////AB///////8AP//+B///gD//+AB//+A///gAH//wH//4AAf//B//+AAB//4P//gAAP//h//8AAB//8f//AAAH//j//4AAA//+f//AAAH//z//4AAA//+f////////3////////+/////////3////////+/////////3////////+/////////3////////+/////////3////////+//+AAAAAAD//wAAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//8AAAAAAP//gAAAAAB//+AAAAAIP//wAAAAHA///AAAAD4H//+AAAD/Af//4AAD/4B///4AP//AP///////4A////////AD///////4AP///////AA///////4AD///////AAH//////4AAP/////8AAAf////8AAAAf///wAAAAAP/+AAA"],"f":[41.77,42,73,1,-73,"AAAD///AAAf///AAD////AAH////AAf////AAf////AA/////AB/////AB/////AD/////AD/////AD//+AAAH//4AAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAf/////8f/////8f/////8f/////8f/////8f/////8f/////8f/////8f/////8f/////8f/////8f/////8AH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAAH//wAAA"],"g":[68.72,57,76,4,-55,"AAA/4AAAAAAA//8AAAAAAf//4D//4AP///gf//AD////D//4A////8f//AP////z//4D/////f//A////////4P////////B////////4f////////D///gP///4///wAf///H//8AB///5///AAH///P//wAAf//5//+AAB///f//gAAP//7//8AAA///f//gAAH//7//4AAA///f//AAAH//7//4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD//7//4AAAf//f//AAAH//7//4AAA///f//gAAH//7//8AAA///f//gAAP//5//+AAB///P//wAAf//5///AAH///H//8AB///4///wAf///D///gP///4f////////B////////4P////////A////////4D/////f//AP////z//4A////8f//AD////D//4AP///gf//AAf//4D//4AA//8Af/+AAA/4AH//wAAAAAA//+AAAAAAH//wAAAAAB//+AAAAAAP//gAAAAAD//8AQAAAAf//gDgAAAH//4AfAAAD///AD/AAA///wAf/gB///+AD///////gAf//////4AD//////+AAf//////gAD//////4AAf/////+AAD//////AAAf/////wAAB/////wAAAA////wAAAAAH//AAAAA="],"h":[68.34,53,73,8,-73,"//+AAAAAB//8AAAAAD//4AAAAAH//wAAAAAP//gAAAAAf//AAAAAA//+AAAAAB//8AAAAAD//4AAAAAH//wAAAAAP//gAAAAAf//AAAAAA//+AAAAAB//8AAAAAD//4AAAAAH//wAAAAAP//gAAAAAf//AAAAAA//+AA/4AB//8Af/+AD//4D///AH//wP///gP//h////gf//H////g//+f////h//9/////D////////H///////+P///////+f///////8////////9////A///7///4Af//3///AAf//v//8AAf//f//4AA//////gAB//////AAB/////8AAD/////4AAH/////wAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA//+A=="],"i":[32.91,17,73,8,-73,"///////////////////////////////////////8AAAAAAAAAAAAAAAAD/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+A"],"j":[32.91,29,94,-4,-73,"AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf//AA//+AB//8AD//4AH//wAP//gAf/+AB//8AD//4AP//wA///gD//+P///8f///w////h///+D///8H///wP///Af//4A///gB//8AD/+AAA="],"k":[63.84,58,73,8,-73,"//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAAAAA//+AAAAAAD//4AAAAAAP//gAAP//4//+AAB///D//4AAP//4P//gAB///A//+AAP//4D//4AB///AP//gAP//4A//+AB///AD//4AP//4AP//gB///AA//+AP//4AD//4B///AAP//gP//wAA//+B//+AAD//4P//wAAP//h//+AAA//+P//wAAD//5//+AAAP//v//wAAA/////+AAAD/////wAAAP////+AAAA/////wAAAD////+AAAAP////wAAAA/////gAAAD/////AAAAP////+AAAA/////8AAAD/////4AAAP/////wAAA//////gAAD//7///AAAP//n//+AAA//+P//8AAD//4f//4AAP//g///wAA//+B///gAD//4D///AAP//gH//+AA//+AP//8AD//4Af//4AP//gA///wA//+AB///gD//4AH//+AP//gAP//8A//+AAf//4D//4AA///wP//gAB///g//+AAD///D//4AAH//+P//gAAP//8//+AAAf//4A="],"l":[32.91,17,73,8,-73,"//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////+A"],"m":[100.03,86,55,7,-55,"AAAAA/wAAAH/AAAAAAB//gAAf/+AB//8B//+AAf//4Af//B///4AP///AH//w////AH///8B//8f///4D////Af//P////B////4H//3////w/////B///////+f////4f///////v////+H/////////////h/////////////8f/////////////H///4H////g///x///4A////gD//+f//8AH///wAf//n//+AA///4AH//5///AAP//8AA//+f//wAD///AAP//n//4AA///gAD//5//+AAP//4AA//+f//gAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//n//wAAf//AAB//5//8AAH//wAAf/+f//AAB//8AAH//gA=="],"n":[68.34,53,55,8,-55,"AAAAA/4AAAAAAf/+AD//4D///AH//wP///gP//h////gf//H////g//+f////h//9/////D////////H///////+P///////+f///////8////////9////A///7///4Af//3///AAf//v//8AAf//f//4AA//////gAB//////AAB/////8AAD/////4AAH/////wAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA//+A="],"o":[65.95,58,56,4,-55,"AAAD//AAAAAAD///wAAAAB////4AAAAf////4AAAD/////wAAA//////wAAH//////gAA///////AAH//////+AA///////8AH///////4A////////wD///wP///Af//4AH//+B///AAP//4P//4AAf//w///AAA///D//8AAD//8f//gAAH//5//+AAAf//n//4AAB//+f//AAAD//5//8AAAP//v//wAAA//////AAAD/////8AAAP/////wAAA//////AAAD/////8AAAP/////wAAA//////AAAD/////8AAAP/////wAAA///f//AAAD//5//8AAAP//n//4AAB//+f//gAAH//5//+AAAf//j//8AAD//8P//wAAP//w///gAB///B///AAP//4H//+AB///gP///Af//8A////////wB///////+AD///////wAH//////+AAP//////wAAf/////+AAA//////wAAA/////+AAAB/////gAAAB////4AAAAA///8AAAAAAP/8AAAA=="],"p":[68.72,57,75,8,-55,"AAAAB/4AAAAAAB//4AA//+A///wAH//wf///gA//+H///+AH//x////4A//+f////gH//3////+A////////4H////////A////////8H////////w////gf//+H///gAf//4///4AB///H//+AAH//4///wAA///n//8AAD//8///AAAf//n//4AAB//+///AAAP//3//4AAB//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+//+AAAH//3//wAAA//+///AAAP//3//4AAB//+///AAAP//3//4AAD//8///gAAf//n//+AAH//8///wAA///H///AAP//4///8AD///H///8D///w////////+H////////g////////4H////////A//+/////wH//z////8A//+P////AH//w////wA//+D///8AH//wH//+AA//+AP//AAH//wAP/AAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAH//wAAAAAA//+AAAAAAAA=="],"q":[68.72,57,75,4,-55,"AAA/4AAAAAAA//8AAAAAAf//4D//4AP///gf//AD////D//4A////8f//AP////z//4D/////f//A////////4P////////B////////4f////////D///gP///4///wAf///H//8AA///5///AAH///P//wAAf//5//+AAB///f//gAAP//7//8AAA///f//gAAH//7//4AAA///f//AAAH//7//4AAA//////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf/////AAAD/////4AAAf//f//AAAH//7//4AAA///f//AAAH//7//8AAA///f//gAAH//7//8AAB///P//wAAP//5//+AAD///P//4AA///4///gAH///H//+AD///4f//8B////D////////4P////////B////////4H////////Af////7//4B////+f//AH////j//4Af///4f//AB///8D//4AD///Af//AAH//gD//4AAH/AAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//4A=="],"r":[47.34,40,55,8,-55,"AAAAB/4AAAA//v//gP/+//+B//7//4f//v//j//+//+f//7//5///v//v//+//////7//////v/////+//////7////AHv///wAC///8AAD///gAAP//8AAA///wAAD//+AAAP//wAAA///AAAD//8AAAP//wAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAD//4AAAP//gAAA//+AAAA="],"s":[57.14,49,56,4,-55,"AAB//wAAAAf///4AAA/////4AB//////AD//////gD//////wD//////4D//////8B//////+B///////A///////gf//gA//wf//AAA/4P//AAAD8H//AAAAOD//gAAABB//wAAAAA//4AAAAAf/+AAAAAP//gAAAAH//8AAAAD///+AAAA/////AAAf/////AAP/////8AD//////gA//////4Af//////AH//////wA//////4AP/////+AA//////AAD/////wAAH////4AAAA///8AAAAB//+AAAAAf//AAAAAH//wAAAAB//4AAAAA//8gAAAAf/+cAAAAf/+PwAAAP//H/AAAf//j//AA///x///////w///////4f//////4P//////8H//////8D//////8B//////8A//////4AH/////wAAH////AAAAB//4AAA=="],"t":[45.89,43,67,1,-67,"AH//gAAAD//wAAAB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAAB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAP/////////////////////////////////////////////////////////////////////////////////////wB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAAB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAAB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAAB//4AAAA//8AAAAf/+AAAAP//AAAAH//gAAAD//wAAAB//8AAAA//+AAAAf//AAAAP//wAAAH//8AAAD/////AB/////gAf////wAP////4AD////8AB////+AAf////AAP////gAB////wAAf///4AAD///8AAAH//+AA=="],"u":[68.34,54,54,7,-53,"//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+f//AAA//+f//AAB//+f//AAB//+f//AAD//+f//AAD//+f//gAH//+f//gAP//+f//4Af//+f//8D///+P///////+P///////+P///////+H///////+H///////+D////+//+B////8//+B////4//+A////w//+AP///g//+AH//+A//+AB//4A//+AAP/AAAAAA="],"v":[62.58,61,53,1,-53,"f/+AAAAf//P//gAAAP//n//wAAAP//h//4AAAH//w//+AAAD//wP//AAAD//4H//wAAB//8D//4AAA//8A//8AAA//+Af//AAAf/+AH//gAAP//AD//wAAP//gB//8AAH//gAf/+AAD//wAP//AAD//4AH//wAB//4AB//4AB//8AA//8AA//8AAP//AAf/+AAH//gAf//AAD//4AP//AAA//8AH//gAAf/+AH//gAAH//gD//wAAD//wB//4AAB//4B//4AAAf/+A//8AAAP//Af/8AAAD//gf/+AAAB//4P//AAAA//8P//AAAAP/+H//gAAAH//j//gAAAD//z//wAAAA//9//4AAAAf/+//4AAAAH////8AAAAD////+AAAAB////+AAAAAf////AAAAAP////AAAAAD////gAAAAB////wAAAAA////wAAAAAP///4AAAAAH///4AAAAAB///8AAAAAA///+AAAAAAf//+AAAAAAH///AAAAAAD///AAAAAAB///gAAAAAAf//wAAAA"],"w":[88.69,83,53,3,-53,"f/+AAD//AAA//8//8AAH//AAB//5//4AAP/+AAH//z//4AAf/8AAP//D//wAB//4AAf/+H//gAD//4AA//8P//AAH//wAD//4f/+AAP//gAH//gf/+AA///AAP//A//8AB///AAf/+B//4AD//+AB//8D//wAH//8AD//wD//wAf//4AH//gH//gA///4AP//AP//AB///wA//+Af/+AD///gB//4Af/+AP///AD//wA//8Af///AH//gB//4A/+/+AP//AD//wB/9/8A//8AD//wH/z/4B//4AH//gP/j/4D//wAP//Af/H/wH//AAP/+A/+P/gf/+AAf/+D/4f/A//8AA//8H/wf/B//4AB//4P/g/+D//gAB//wf/B/8P//AAD//x/8D/4f/+AAH//j/4H/4//8AAP//H/wH/x//wAAP/+P/gP/n//gAAf/+/+Af/P//AAA//9/8A//f/+AAB//7/4A/+//4AAB////wB////wAAD////gD////gAAH///+AH////AAAP///8AH///8AAAP///4AP///4AAAf///wAf///wAAA////AA////gAAB///+AA///+AAAB///8AB///8AAAD///4AD///4AAAH///gAH///gAAAH///AAH///AAAAP//+AAP//+AAAAf//8AAf//8AAAA///wAA///wAAAA///gAA///gAAAB///AAB///AAAAD//+AAD//+AAA=="],"x":[61.92,60,53,1,-53,"P//gAAD//8P//wAAD//4H//4AAH//4D//8AAP//wB//8AAP//gB//+AAf//AA///AA///AAf//AA//+AAP//gB//8AAP//wD//8AAH//wH//4AAD//4H//wAAB//8P//gAAB//8f//gAAA//+f//AAAAf////+AAAAf////8AAAAP////8AAAAH////4AAAAD////wAAAAD////gAAAAB////gAAAAA////AAAAAAf//+AAAAAAf//+AAAAAAP//8AAAAAAP//8AAAAAAf//+AAAAAA////AAAAAA////AAAAAB////gAAAAD////wAAAAH////wAAAAH////4AAAAP////8AAAAf////+AAAAf////+AAAA//+f//AAAB//8f//gAAD//8P//wAAD//4H//wAAH//wD//4AAP//wD//8AAf//gB//+AAf//AA//+AA//+AA///AB//+AAf//gD//8AAP//gD//4AAH//wH//4AAH//4P//wAAD//8P//gAAB//8f//gAAB//+A="],"y":[62.58,60,74,1,-53,"//+AAAAf//f//AAAAf/+f//AAAA//+P//AAAA//+P//gAAA//8H//gAAB//8H//wAAB//4H//wAAB//4D//wAAD//4D//4AAD//wB//4AAD//wB//4AAH//gB//8AAH//gA//8AAH//gA//+AAP//AAf/+AAP//AAf/+AAP//AAP//AAf/+AAP//AAf/+AAP//gAf/8AAH//gA//8AAH//gA//8AAD//wA//4AAD//wB//4AAB//4B//4AAB//4B//wAAB//4D//wAAA//8D//gAAA//8D//gAAAf/+H//gAAAf/+H//AAAAP/+H//AAAAP//P//AAAAP//P/+AAAAH//P/+AAAAH////8AAAAD////8AAAAD////8AAAAB////4AAAAB////4AAAAB////wAAAAA////wAAAAA////wAAAAAf///gAAAAAf///gAAAAAf///gAAAAAP///AAAAAAP///AAAAAAH//+AAAAAAH//+AAAAAAD//+AAAAAAD//8AAAAAAD//8AAAAAAB//8AAAAAAB//4AAAAAAB//4AAAAAAB//wAAAAAAB//wAAAAAAD//wAAAAAAD//gAAAAAAH//gAAAAAAP//AAAAAAA///AAAAAH///+AAAAAH///+AAAAAH///8AAAAAH///8AAAAAH///4AAAAAH///wAAAAAH///gAAAAAH///AAAAAAH//8AAAAAAH//wAAAAAAH/+AAAAAA"],"z":[55.88,48,53,4,-53,"f//////+f//////+f//////+f//////+f//////+f//////+f//////+f//////+f//////+f//////+f//////+f//////+AAAAH//+AAAAH//8AAAAP//4AAAAf//wAAAA///gAAAB///AAAAD//+AAAAH//8AAAAP//4AAAAf//wAAAA///gAAAB///AAAAD//+AAAAH//8AAAAP//4AAAAf//wAAAA///gAAAB///gAAAD///AAAAH//+AAAAH//8AAAAP//4AAAAf//wAAAA///gAAAB///AAAAD//+AAAAH//8AAAAP//4AAAAf//wAAAA///////+///////+///////+///////+///////+///////+///////+///////+///////+///////+///////+///////+"],"{":[68.34,45,89,12,-73,"AAAAD//wAAAH//+AAAD///wAAB///+AAAf///wAAH///+AAB////wAAP///+AAD////wAAf///+AAD////wAA///4AAAH//4AAAA//+AAAAH//wAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAD//4AAAAf//AAAAH//4AAAD//+AAAB///wAA////8AAH////gAA////4AAH///8AAA///+AAAH///gAAA////gAAH///+AAA////4AAH////gAA////+AAAB///wAAAB///AAAAH//4AAAAf//AAAAD//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//gAAAA//8AAAAH//wAAAA//+AAAAH//4AAAA///4AAAH////wAAf///+AAD////wAAP///+AAB////wAAH///+AAAf///wAAB///+AAAD///wAAAH//+AAAAD//w"],"|":[35.06,11,96,12,-73,"////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////"],"}":[68.34,45,89,12,-73,"//8AAAAH//+AAAA///+AAAH///4AAA////gAAH///+AAA////4AAH////gAA////8AAH////wAA////+AAAA///wAAAB//+AAAAH//wAAAAf//AAAAD//4AAAAf//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//gAAAB//8AAAAP//wAAAA///AAAAH//8AAAA///8AAAD////wAAP///+AAA////wAAD///+AAAH///wAAAf//+AAAP///wAAH///+AAB////wAAf///+AAD////wAA///8AAAH//8AAAB//+AAAAP//wAAAB//8AAAAP//gAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAP//AAAAB//4AAAAf//AAAAD//4AAAAf//AAAAH//4AAAB//+AAAA///wAA////+AAH////wAA////8AAH////gAA////4AAH///+AAA////gAAH///4AAA///+AAAH//+AAAA//+AAAAA"],"~":[80.44,61,21,10,-41,"AAAAAAAAAAAAAAAAAAAAgAH/gAAAAAwA///AAAAA4B///8AAAB8D////gAAD+H////+AAH/H/////8Af/v/////////3/////////7/////////9/////////+//////////f/wD//////P/AAH////+H8AAAf///8D8AAAB///4B4AAAAH//wA4AAAAAP+AAQAAAAAAAAAAAAAAAAAAAAA="],"\u2018":[36.47,22,30,9,-70,"AB/4AH/gA/+AH/4Af/AD/8Af/wB/+AP/4B//gH/+A//wD//Af/8D//gP/+B//4H//gf/+B//4H//gf/+B//4H//gf/+B//4H//gf/+B//4H//gA="],"\u2019":[36.47,21,30,6,-70,"B//4P//B//4P//B//4P//B//4P//B//4P//B//4P//B//4P//D//wf/8D//gf/4H/+A//wH/8B//AP/4B/+AP/wD/8Af/AD/4A/+AH/gAA=="],"\u201c":[63.09,46,30,9,-70,"AB/4AB/4AH/gAP/gA/+AA/+AH/4AH/wAf/AA//AD/8AD/8Af/wAf/gB/+AD/+AP/4AP/4B//gB//gH/+AH/8A//wA//wD//AH//Af/8Af/4D//gD//gP/+Af/+B//4B//4H//gH//gf/+Af/+B//4B//4H//gH//gf/+Af/+B//4B//4H//gH//gf/+Af/+B//4B//4H//gH//gf/+Af/+B//4B//4H//gH//gA="],"\u201d":[63.09,46,30,8,-70,"A//4B//4D//gH//gP/+Af/+A//4B//4D//gH//gP/+Af/+A//4B//4D//gH//gP/+Af/+A//4B//4D//gH//gP/+Af/+A//4B//4H//gH//gf/+Af/+B//wB//wH/+AP/+A//4A//4D//AD//AP/8AP/4A//gB//gH/8AH/8Af/wAf/gB/+AD/+AP/wAP/wA//AA/+AD/4AD/4AP/AAf/AB/8AB/4AH/gAH/gAA="],"\u2013":[48.0,38,12,5,-32,"////////////////////////////////////////////////////////////////////////////"],"\u2014":[96.0,86,12,5,-32,"////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////"],"\u00b7":[36.47,18,18,9,-42,"f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//f//A="],"\u2026":[96.0,82,18,7,-18,"f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+f/+AAH//gAB//5//4AAf/+AAH//n//gAB//4AAf/+A="],"\u2022":[61.36,35,34,13,-53,"AAP8AAAD//AAAf//gAD///gAP///gA////gD////gH////gf////B/////D////+H////+f////8/////5/////z/////n/////v/////f////8/////5/////z/////j/////H////8H////4P////gP////Af///8Af///wAf///AAf//8AAP//wAAH/+AAAB/gAA="],"\u2605":[86.06,74,71,6,-70,"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAAAAAAAAAAAwAAAAAAAAAAAMAAAAAAAAAAAHgAAAAAAAAAAB4AAAAAAAAAAAeAAAAAAAAAAAPwAAAAAAAAAAD8AAAAAAAAAAA/AAAAAAAAAAAf4AAAAAAAAAAH+AAAAAAAAAAB/gAAAAAAAAAA/8AAAAAAAAAAP/AAAAAAAAAAD/wAAAAAAAAAB/+AAAAAAAAAAf/gAAAAAAAAAH/4AAAAAAAAAB//AAAAAAAAAA//wAAAAAAAAAP/8AAAAAAAAAD//gAAAAAAAAB//4AAAAAAAAAf/+AAAAAAAAAH//wAAAAf///////////j///////////wf//////////4B//////////4AP/////////8AB/////////+AAH////////+AAA/////////AAAD////////gAAAf///////gAAAD///////wAAAAP//////wAAAAB//////4AAAAAP/////8AAAAAA/////8AAAAAAH////+AAAAAAA/////AAAAAAAH////gAAAAAAD////8AAAAAAA/////AAAAAAAP////wAAAAAAH////+AAAAAAB/////gAAAAAAf////4AAAAAAP/////AAAAAAD/////wAAAAAA/////8AAAAAAf//P//gAAAAAH//h//4AAAAAB//gH/+AAAAAA//wA//wAAAAAP/4AH/8AAAAAD/4AAf/AAAAAB/8AAD/4AAAAAf+AAAP+AAAAAH+AAAB/gAAAAB/AAAAP8AAAAA/AAAAA/AAAAAPgAAAAHwAAAADwAAAAA+AAAABwAAAAADgAAAAYAAAAAAYAAAAEAAAAAABAAAAAAAAAAAAAAA"],"\u2665":[86.06,70,70,8,-70,"AAP4AAAAfwAAAH/8AAAP/4AAB//8AAD//4AAP//4AAf//wAB///wAD///gAP///gAf///AB////AD///+AP///+Af///8B////4B////4H////wP////g/////g/////D////+H////8f////4f////5/////z/////n/////P////+f////8/////5///////////3///////////f//////////9///////////n//////////+f//////////5///////////n//////////+f//////////4///////////D//////////8P//////////wf/////////+B//////////4D//////////gP/////////8Af/////////wB/////////+AD/////////wAH/////////AAf////////4AA/////////AAB////////4AAD////////AAAH///////8AAAP///////gAAA///////8AAAB///////gAAAD//////8AAAAH//////gAAAAP/////+AAAAA//////wAAAAB/////+AAAAAD/////wAAAAAH////+AAAAAAP////wAAAAAA/////AAAAAAB////4AAAAAAD////AAAAAAAH///4AAAAAAAP///AAAAAAAAf//4AAAAAAAB///gAAAAAAAD//8AAAAAAAAH//gAAAAAAAAP/8AAAAAAAAAf/gAAAAAAAAB/8AAAAAAAAAD/wAAAAAAAAAH+AAAAAAAAAAPwAAAAAAAAAAeAAAAAAAAAAAwAAAAAAAAAACAAAAAAA=="],"\u00e0":[64.78,54,78,4,-77,"AD/+AAAAAAB/+AAAAAAA//AAAAAAA//gAAAAAAf/wAAAAAAP/wAAAAAAH/4AAAAAAD/8AAAAAAB/+AAAAAAA/+AAAAAAAf/AAAAAAAP/gAAAAAAH/wAAAAAAD/wAAAAAAB/4AAAAAAA/8AAAAAAAf+AAAAAAAP+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//8AAAAP////4AAB//////AAB//////wAB//////4AB//////+AB///////AB///////AB///////gB///////wB///////wB/+AB///4B/AAAP//4BwAAAD//8BAAAAB//8AAAAAB//8AAAAAA//8AAAAAA//+AAAAAA//+AAAAAA//+AAAAAA//+AAA/////+AAf/////+AD//////+AP//////+A///////+B///////+D///////+H///////+P///////+P///////+f//+AA//+f//wAA//+f//gAA//+f//AAA//+///AAA//+//+AAA//+//+AAA//+//+AAB//+//+AAB//+//+AAD//+///AAH//+///gAP//+f//wAf//+f//8D///+f///////+P///////+P///////+H////+//+D////8//+D////4//+A////w//+Af///g//+AP//+A//+AD//4A//+AAP/AAAAAA="],"\u00e1":[64.78,54,78,4,-77,"AAAAAB//AAAAAAD/+AAAAAAH/8AAAAAAP/4AAAAAAP/wAAAAAAf/gAAAAAA//AAAAAAA/+AAAAAAB/8AAAAAAD/4AAAAAAH/wAAAAAAH/gAAAAAAP/AAAAAAAf+AAAAAAA/8AAAAAAA/4AAAAAAB/wAAAAAAD/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD//8AAAAP////4AAB//////AAB//////wAB//////4AB//////+AB///////AB///////AB///////gB///////wB///////wB/+AB///4B/AAAP//4BwAAAD//8BAAAAB//8AAAAAB//8AAAAAA//8AAAAAA//+AAAAAA//+AAAAAA//+AAAAAA//+AAA/////+AAf/////+AD//////+AP//////+A///////+B///////+D///////+H///////+P///////+P///////+f//+AA//+f//wAA//+f//gAA//+f//AAA//+///AAA//+//+AAA//+//+AAA//+//+AAB//+//+AAB//+//+AAD//+///AAH//+///gAP//+f//wAf//+f//8D///+f///////+P///////+P///////+H////+//+D////8//+D////4//+A////w//+Af///g//+AP//+A//+AD//4A//+AAP/AAAAAA="],"\u00e8":[65.11,57,78,4,-77,"AB//AAAAAAAH/8AAAAAAAf/wAAAAAAB/+AAAAAAAH/4AAAAAAAf/gAAAAAAB/+AAAAAAAH/wAAAAAAAf/AAAAAAAB/8AAAAAAAH/wAAAAAAAf+AAAAAAAB/4AAAAAAAH/gAAAAAAAf8AAAAAAAD/wAAAAAAAP/AAAAAAAA/8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/+AAAAAAH///AAAAAD////AAAAD////+AAAA/////4AAAf/////wAAH//////AAB//////8AAf//////wAH///////AB///////8AP//+B///gD//+AB//+A///gAH//wH//4AAf//B//+AAB//4P//gAAP//h//8AAB//8f//AAAH//j//4AAA//+f//AAAH//z//4AAA//+f////////3////////+/////////3////////+/////////3////////+/////////3////////+/////////3////////+//+AAAAAAD//wAAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//8AAAAAAP//gAAAAAB//+AAAAAIP//wAAAAHA///AAAAD4H//+AAAD/Af//4AAD/4B///4AP//AP///////4A////////AD///////4AP///////AA///////4AD///////AAH//////4AAP/////8AAAf////8AAAAf///wAAAAAP/+AAAA=="],"\u00e9":[65.11,57,78,4,-77,"AAAAAA//gAAAAAAP/4AAAAAAB/+AAAAAAAf/gAAAAAAH/4AAAAAAB/+AAAAAAAP/wAAAAAAD/8AAAAAAA//AAAAAAAH/wAAAAAAB/8AAAAAAAf/AAAAAAAH/wAAAAAAA/8AAAAAAAP/AAAAAAAD/wAAAAAAA/8AAAAAAAH/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB/+AAAAAAH///AAAAAD////AAAAD////+AAAA/////4AAAf/////wAAH//////AAB//////8AAf//////wAH///////AB///////8AP//+B///gD//+AB//+A///gAH//wH//4AAf//B//+AAB//4P//gAAP//h//8AAB//8f//AAAH//j//4AAA//+f//AAAH//z//4AAA//+f////////3////////+/////////3////////+/////////3////////+/////////3////////+/////////3////////+//+AAAAAAD//wAAAAAAf//AAAAAAD//4AAAAAAf//AAAAAAD//8AAAAAAP//gAAAAAB//+AAAAAIP//wAAAAHA///AAAAD4H//+AAAD/Af//4AAD/4B///4AP//AP///////4A////////AD///////4AP///////AA///////4AD///////AAH//////4AAP/////8AAAf////8AAAAf///wAAAAAP/+AAAA=="],"\u00ed":[32.91,30,77,8,-77,"AAD/+AAH/8AAP/4AAf/wAAf/gAA//AAB/+AAD/8AAD/4AAH/wAAP/gAAf/AAAf+AAA/8AAB/4AAB/wAAD/gAAH/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AA//+AAA=="],"\u00f3":[65.95,58,78,4,-77,"AAAAAA//gAAAAAAH/8AAAAAAAf/gAAAAAAD/8AAAAAAAf/gAAAAAAD/8AAAAAAAP/gAAAAAAB/8AAAAAAAP/wAAAAAAB/+AAAAAAAH/wAAAAAAA/+AAAAAAAH/wAAAAAAA/+AAAAAAAD/wAAAAAAAf+AAAAAAAD/wAAAAAAAP+AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/8AAAAAAP///AAAAAH////gAAAB/////gAAAP/////AAAD//////AAAf/////+AAD//////8AAf//////4AD///////wAf///////gD////////AP///A///8B///gAf//4H//8AA///g///gAB///D//8AAD//8P//wAAP//x//+AAAf//n//4AAB//+f//gAAH//5//8AAAP//n//wAAA//+///AAAD/////8AAAP/////wAAA//////AAAD/////8AAAP/////wAAA//////AAAD/////8AAAP/////wAAA//////AAAD//9//8AAAP//n//wAAA//+f//gAAH//5//+AAAf//n//4AAB//+P//wAAP//w///AAA///D//+AAH//8H//8AA///gf//4AH//+A///8B///wD////////AH///////4AP///////AAf//////4AA///////AAB//////4AAD//////AAAD/////4AAAH////+AAAAH////gAAAAD///wAAAAAA//wAAAA="],"\u00fa":[68.34,54,78,7,-77,"AAAAAD/+AAAAAAD/8AAAAAAH/8AAAAAAP/4AAAAAAf/wAAAAAAf/gAAAAAA//AAAAAAB/+AAAAAAD/8AAAAAAD/4AAAAAAH/wAAAAAAP/gAAAAAAf/AAAAAAAf+AAAAAAA/8AAAAAAB/4AAAAAAB/wAAAAAAD/gAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+f//AAA//+f//AAB//+f//AAB//+f//AAD//+f//AAD//+f//gAH//+f//gAP//+f//4Af//+f//8D///+P///////+P///////+P///////+H///////+H///////+D////+//+B////8//+B////4//+A////w//+AP///g//+AH//+A//+AB//4A//+AAP/AAAAAA="],"\u00f1":[68.34,53,77,8,-77,"AAB+AAfwAAAP/AA/gAAA//gB/AAAD//wD8AAAH//wP4AAAf//4/wAAA/////gAAB/D//+AAAH8B//8AAAP4B//wAAAfwA//AAAA/gA/8AAAB/AAfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP+AAAAAAH//gA//+A///wB//8D///4D//4f///4H//x////4P//n////4f//f////w////////x////////j////////n////////P////////f///wP//+///+AH//9///wAH//7///AAH//3//+AAP/////4AAf/////wAAf/////AAA/////+AAB/////8AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP/////AAAf////+AAA/////8AAB/////4AAD/////wAAH/////gAAP//gA=="],"\u00fc":[68.34,54,75,7,-74,"AA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAA/+Af/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+//+AAA//+f//AAA//+f//AAB//+f//AAB//+f//AAD//+f//AAD//+f//gAH//+f//gAP//+f//4Af//+f//8D///+P///////+P///////+P///////+H///////+H///////+D////+//+B////8//+B////4//+A////w//+AP///g//+AH//+A//+AB//4A//+AAP/AAAAAA"],"\u00e7":[56.91,47,74,4,-55,"AAAB//gAAAA///+AAAP////gAB/////gAP/////AA/////+AH/////8Af/////4B//////wH//////gf//////A//////+D///8Af8P///AAH4f//8AADx///gAABj//+AAAAH//8AAAAf//wAAAA///AAAAB//+AAAAD//8AAAAH//wAAAAf//gAAAA///AAAAB//+AAAAD//8AAAAH//4AAAAP//wAAAAf//gAAAA///AAAAB//+AAAAD//8AAAAD//4AAAAH//4AAAAP//wAAAAf//gAAAA///gAAAA///gAAAB///AAAAD///AAADD///gAAOH///gAB8H///4A/4H//////wP//////gP//////AP/////+AP/////8AP/////4AH/////wAH/////gAD/////AAB////8AAAf///AAAAD//AAAAAAfwAAAAAAfwAAAAAAfwAAAAAA/gAAAAAA/gAAAAAB/AAAAAAD/AAAAAAH+AAAAAAP8AAAAAA/4AAABgD/wAAAD///gAAAH///AAAAP//8AAAAf//4AAAA///gAAAB//8AAAAAf/AAA"]}};
const R165_GLYPHS = {};
for (const [ch165, g165] of Object.entries(R165_FONT.glyphs)) {
  R165_GLYPHS[ch165] = { adv: g165[0], w: g165[1], h: g165[2], dx: g165[3], dy: g165[4], bits: g165[5] ? Buffer.from(g165[5], "base64") : null };
}
// Text hygiene for the sting: keep only characters the font
// carries, fold any whitespace to a plain space, collapse runs,
// cap the length. Anything exotic a family typed simply doesn't
// reach the card — the play's title elsewhere is untouched.
function r165SanitizeText(s, max) {
  let out = "";
  for (const ch of String(s || "")) {
    if (/\s/.test(ch)) { if (out && !out.endsWith(" ")) out += " "; continue; }
    if (R165_GLYPHS[ch]) out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}
function r165MeasureText(text, px) {
  const s = px / R165_FONT.px;
  let w = 0;
  for (const ch of text) { const g = R165_GLYPHS[ch] || R165_GLYPHS["?"]; if (g) w += g.adv * s; }
  return w;
}
// Greedy word wrap at a pixel size. Returns the lines, or null
// when the text needs more than maxLines even wrapped (the
// caller's fit loop then shrinks the size and tries again). A
// single word wider than the card is hard-truncated with an
// ellipsis rather than spilling off the frame.
function r165WrapText(text, px, maxW, maxLines) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (r165MeasureText(trial, px) <= maxW) { cur = trial; continue; }
    if (cur) lines.push(cur);
    if (r165MeasureText(w, px) > maxW) {
      let t = w;
      while (t.length > 1 && r165MeasureText(t + "…", px) > maxW) t = t.slice(0, -1);
      cur = t + "…";
    } else cur = w;
    if (lines.length > maxLines) return null;
  }
  if (cur) lines.push(cur);
  return lines.length > maxLines ? null : lines;
}
// Lay out a stack of text items (each {text, px, rgb, maxLines,
// gap}) starting at a first baseline, shrinking the whole stack
// until it fits above maxBottom. Returns [{text, px, rgb,
// baselineY}] or null when it cannot fit even shrunk — the
// caller then falls back to fewer items (a crest-only card is
// always a valid sting).
function r165FitLines(items, maxW, topBaseline, maxBottom) {
  let scale = 1;
  for (let attempt = 0; attempt < 6; attempt++) {
    let y = topBaseline;
    const out = [];
    let ok = true, bottom = topBaseline;
    for (const it of items) {
      const px = Math.max(15, Math.round(it.px * scale));
      const lines = r165WrapText(it.text, px, maxW, it.maxLines);
      if (!lines) { ok = false; break; }
      for (const line of lines) { out.push({ text: line, px, rgb: it.rgb, baselineY: Math.round(y) }); bottom = y + px * 0.35; y += px * 1.3; }
      y += Math.round((it.gap || 0) * scale);
    }
    if (ok && bottom <= maxBottom) return out;
    scale *= 0.86;
  }
  return null;
}
function r165GlyphBit(g, x, y) { const i = y * g.w + x; return (g.bits[i >> 3] >> (7 - (i & 7))) & 1; }
// Draw one centered line into an RGBA frame buffer with
// alpha-over compositing; the glyph masks are sampled with a
// 2×2 coverage estimate so scaled text keeps softened edges.
function r165DrawLine(buf, W, H, text, cx, baselineY, px, rgb) {
  const s = px / R165_FONT.px;
  let penX = cx - r165MeasureText(text, px) / 2;
  for (const ch of text) {
    const g = R165_GLYPHS[ch] || R165_GLYPHS["?"];
    if (!g) continue;
    if (g.bits) {
      const ox = penX + g.dx * s, oy = baselineY + g.dy * s;
      const x0 = Math.max(0, Math.floor(ox)), y0 = Math.max(0, Math.floor(oy));
      const x1 = Math.min(W - 1, Math.ceil(ox + g.w * s)), y1 = Math.min(H - 1, Math.ceil(oy + g.h * s));
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const sx = (x - ox) / s, sy = (y - oy) / s;
          let cov = 0;
          for (let oy2 = 0; oy2 < 2; oy2++) for (let ox2 = 0; ox2 < 2; ox2++) {
            const gx = Math.min(g.w - 1, Math.max(0, Math.floor(sx + ox2 * 0.5)));
            const gy = Math.min(g.h - 1, Math.max(0, Math.floor(sy + oy2 * 0.5)));
            cov += r165GlyphBit(g, gx, gy);
          }
          cov /= 4;
          if (cov <= 0) continue;
          const i = (y * W + x) * 4;
          const sa = cov, da = buf[i + 3] / 255, oa = sa + da * (1 - sa);
          if (oa <= 0) continue;
          buf[i] = Math.round((rgb[0] * sa + buf[i] * da * (1 - sa)) / oa);
          buf[i + 1] = Math.round((rgb[1] * sa + buf[i + 1] * da * (1 - sa)) / oa);
          buf[i + 2] = Math.round((rgb[2] * sa + buf[i + 2] * da * (1 - sa)) / oa);
          buf[i + 3] = Math.round(oa * 255);
        }
      }
    }
    penX += g.adv * s;
  }
}
// A full-frame transparent PNG carrying exactly the card's text
// (the crest itself is composited by ffmpeg from the brand
// asset, so this layer is text only). The encoder is core zlib
// plus hand-rolled chunks — the app's zero-dependency rule
// holds for images too.
const R165_CRC_TABLE = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function r165Crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = R165_CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function r165PngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(r165Crc32(td));
  return Buffer.concat([len, td, crc]);
}
function r165EncodePng(rgba, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), r165PngChunk("IHDR", ihdr), r165PngChunk("IDAT", zlib.deflateSync(raw, { level: 6 })), r165PngChunk("IEND", Buffer.alloc(0))]);
}
function r165CardPng(W, H, lines) {
  const buf = Buffer.alloc(W * H * 4);
  for (const ln of lines) r165DrawLine(buf, W, H, ln.text, W / 2, ln.baselineY, ln.px, ln.rgb);
  return r165EncodePng(buf, W, H);
}
// The probe facts a reel build needs: the Round 124 video info
// plus whether an audio stream exists (the concat graph must
// know — a silent clip gets generated silence in its place).
function r165MediaFacts(probe) {
  const info = r124VideoInfo(probe);
  if (!info) return null;
  const hasAudio = (probe.streams || []).some((s) => s.codec_type === "audio");
  return { ...info, hasAudio };
}
// Build one reel into outAbs. Never throws for content
// problems — returns {ok:false, status, message} so the
// endpoint can answer plainly; a throw is reserved for the
// truly unexpected and the caller turns it into a 500.
async function r165BuildReelNow(bins, row, srcAbs, outAbs, workDir) {
  const facts = r165MediaFacts(await r124Probe(bins, srcAbs));
  if (!facts || !(facts.duration > 0) || !facts.width || !facts.height)
    return { ok: false, status: 422, message: "We couldn't read that video well enough to make its reel." };
  // Display geometry: Round 124 files carry their rotation in
  // the pixels, but a legacy rotated file decodes rotated in
  // the graph too, so the cards are built at DISPLAY size.
  const quarterTurn = ((facts.rotation % 180) + 180) % 180 !== 0;
  let W = quarterTurn ? facts.height : facts.width;
  let H = quarterTurn ? facts.width : facts.height;
  W -= W % 2; H -= H % 2;
  if (W < 160 || H < 160) return { ok: false, status: 422, message: "That video is too small to make a reel from." };
  const dur = facts.duration;
  const maxTextW = Math.round(W * 0.88);
  const namePx = Math.max(26, Math.min(100, Math.round(Math.min(W * 0.088, H * 0.14))));
  // ---- intro card (Round 167): the metallic crest master,
  // contain-fit on the black card — centered horizontally and
  // centered on 35% of the height, exactly where the flat
  // crest sat — with the rendered name + title under it, as
  // before. The master is square, so its box is square. ----
  const introArtW = Math.max(120, Math.min(560, Math.round(Math.min(W, H) * 0.52)));
  const introArtH = introArtW;
  const introArtBottom = Math.round(H * 0.35 + introArtH / 2);
  const introItems = [
    { text: r165SanitizeText(athleteDisplayName(row.player_name) || row.player_name || "", 60), px: namePx, rgb: R165_WHITE, maxLines: 2, gap: Math.round(H * 0.012) },
    { text: r165SanitizeText(row.title || "", 90), px: Math.round(namePx * 0.54), rgb: R165_SOFT, maxLines: 2, gap: 0 },
  ].filter((it) => it.text);
  let introLines = r165FitLines(introItems, maxTextW, Math.round(introArtBottom + H * 0.055 + namePx * 0.75), Math.round(H * 0.96));
  if (!introLines && introItems.length > 1) introLines = r165FitLines([introItems[0]], maxTextW, Math.round(introArtBottom + H * 0.055 + namePx * 0.75), Math.round(H * 0.96));
  if (!introLines) introLines = [];
  // ---- outro card (Round 167): the full metallic lockup IS
  // the card — crest, wordmark and the slogan are baked into
  // the art, so the renderer draws nothing here but the small
  // highlighthype.com line, tucked under the artwork inside
  // the master's own black footroom (the artwork band ends at
  // ~85% of the square; the URL baseline rides at ~93%). ----
  const outroArtW = Math.max(140, Math.round(Math.min(W * 0.86, H * 0.62)));
  const outroArtH = outroArtW;
  const outroArtTop = Math.round(H * 0.10);
  const urlPx = Math.max(16, Math.min(46, Math.round(W * 0.040)));
  let outroLines = r165FitLines([
    { text: "highlighthype.com", px: urlPx, rgb: R165_WHITE, maxLines: 1, gap: 0 },
  ], maxTextW, Math.round(outroArtTop + outroArtH * 0.93 + urlPx * 0.75), Math.round(H * 0.97)) || [];
  const introPng = path.join(workDir, "intro.png");
  const outroPng = path.join(workDir, "outro.png");
  fs.writeFileSync(introPng, r165CardPng(W, H, introLines));
  fs.writeFileSync(outroPng, r165CardPng(W, H, outroLines));
  // ---- the one ffmpeg graph: card + watermarked clip + card ----
  // Every overlay carries shortest=1: the crest and the card
  // text ride in as -loop 1 stills, which never reach EOF on
  // their own — without shortest, framesync keeps the overlay
  // (and so the whole concat) alive forever on those endless
  // inputs even though every main input is finite (bisected
  // and proven in this round's smoke work: a bare overlay ran
  // 1,500+ frames on a 2s clip; shortest=1 stops at exactly
  // the main's last frame).
  const wmW = Math.max(44, Math.round(W * 0.115));
  const wmM = Math.max(10, Math.round(Math.min(W, H) * 0.032));
  const fc = [
    "[4:v]split=2[r165bgA][r165bgB]",
    // Round 167: the site crest (input 1) now feeds ONLY the
    // in-clip watermark — the cards composite the metallic
    // masters (inputs 6 and 7) instead.
    "[1:v]format=rgba[r165cW]",
    `[6:v]format=rgba,scale=${introArtW}:${introArtH}[r167artI]`,
    `[r165bgA]trim=end=${R165_INTRO_SEC},setpts=PTS-STARTPTS[r165bgAt]`,
    `[r165bgAt][r167artI]overlay=(main_w-overlay_w)/2:(main_h*0.35-overlay_h/2):shortest=1[r165iv0]`,
    "[r165iv0][2:v]overlay=0:0:shortest=1,setsar=1,format=yuv420p,fps=30[r165introV]",
    `[0:v]scale=${W}:${H},setsar=1,format=yuv420p,fps=30[r165base]`,
    `[r165cW]scale=${wmW}:-2,format=rgba,colorchannelmixer=aa=0.55[r165cWi]`,
    `[r165base][r165cWi]overlay=main_w-overlay_w-${wmM}:main_h-overlay_h-${wmM}:shortest=1[r165clipV]`,
    `[7:v]format=rgba,scale=${outroArtW}:${outroArtH}[r167artO]`,
    `[r165bgB]trim=end=${R165_OUTRO_SEC},setpts=PTS-STARTPTS[r165bgBt]`,
    `[r165bgBt][r167artO]overlay=(main_w-overlay_w)/2:${outroArtTop}:shortest=1[r165ov0]`,
    "[r165ov0][3:v]overlay=0:0:shortest=1,setsar=1,format=yuv420p,fps=30[r165outroV]",
    "[r165introV][r165clipV][r165outroV]concat=n=3:v=1:a=0[r165v]",
    // (the silence split is 2-way when the clip brings its own
    // audio — an unconnected split output fails the whole graph)
    facts.hasAudio ? "[5:a]asplit=2[r165sA][r165sB]" : "[5:a]asplit=3[r165sA][r165sB][r165sC]",
    `[r165sA]atrim=end=${R165_INTRO_SEC},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[r165introA]`,
    `[r165sB]atrim=end=${R165_OUTRO_SEC},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[r165outroA]`,
    facts.hasAudio
      ? "[0:a:0]aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[r165clipA]"
      : `[r165sC]atrim=end=${dur.toFixed(3)},asetpts=PTS-STARTPTS,aresample=44100,aformat=sample_fmts=fltp:channel_layouts=stereo[r165clipA]`,
    "[r165introA][r165clipA][r165outroA]concat=n=3:v=0:a=1[r165a]",
  ].join(";");
  const args = ["-y",
    "-i", srcAbs,
    "-loop", "1", "-framerate", "30", "-i", R165_CREST_PATH,
    "-loop", "1", "-framerate", "30", "-i", introPng,
    "-loop", "1", "-framerate", "30", "-i", outroPng,
    "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:r=30`,
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-loop", "1", "-framerate", "30", "-i", R167_CREST_ART_PATH,
    "-loop", "1", "-framerate", "30", "-i", R167_LOCKUP_ART_PATH,
    "-filter_complex", fc,
    "-map", "[r165v]", "-map", "[r165a]",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "veryfast", "-threads", "2",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", outAbs];
  const { err, stderr } = await r124Run(bins.ffmpeg, args, 600000);
  if (err) { console.error(`[r165] reel build failed for play ${row.id}:`, err.message, String(stderr || "").slice(-300)); return { ok: false, status: 500, message: "The reel maker hit a snag — please try again in a bit." }; }
  // Verify before caching: a real H.264 file whose length is
  // the clip plus the sting (a generous window — fps rounding
  // and audio priming shift the edges slightly).
  const chk = r165MediaFacts(await r124Probe(bins, outAbs));
  if (!chk || chk.codec !== "h264" || Math.abs(chk.duration - (dur + R165_INTRO_SEC + R165_OUTRO_SEC)) > 1.0) {
    console.error(`[r165] reel for play ${row.id} failed verification (codec=${chk && chk.codec}, duration=${chk && chk.duration}, expected ~${dur + R165_INTRO_SEC + R165_OUTRO_SEC})`);
    return { ok: false, status: 500, message: "The reel maker hit a snag — please try again in a bit." };
  }
  return { ok: true };
}
// The builder always takes its turn behind the Round 138
// serializer — the reel is the third (and only other) ffmpeg
// call site, beside the transcode and the poster grab.
async function r165BuildReel(bins, row, srcAbs, outAbs, workDir) {
  return r138SerializeFfmpeg(() => r165BuildReelNow(bins, row, srcAbs, outAbs, workDir));
}
// Cache + in-flight bookkeeping for the endpoint. The cache
// check comes FIRST (a cached reel serves even when the disk
// guard below would refuse a fresh build); a build for a play
// is shared by every concurrent requester of that play; and a
// failed build starts a 30-second cooldown so a broken file
// cannot be hammered through the serialized encoder.
const reelInflight165 = new Map();   // playId -> Promise<absPath>
const reelFailAt165 = new Map();     // playId -> ms of last failed build
function r165CachedPath(row) {
  // Round 167: the stored key carries REEL_FORMAT_V — a reel
  // cached under an older format (Round 165 stored the bare
  // media_url) never matches, so it regenerates below instead
  // of serving the retired card art.
  if (!row.reel_generated_at || (row.reel_source || "") !== r167ReelSourceKey(row.media_url)) return null;
  const f = path.join(REEL_DIR, `${row.id}.mp4`);
  try { return fs.statSync(f).isFile() && fs.statSync(f).size > 0 ? f : null; } catch { return null; }
}
async function r165EnsureReel(row) {
  const id = row.id;
  const hit = r165CachedPath(row);
  if (hit) return hit;
  if (reelInflight165.has(id)) return reelInflight165.get(id);
  if (Date.now() - (reelFailAt165.get(id) || 0) < 30000)
    throw Object.assign(new Error("The reel maker stumbled on this one a moment ago — give it a few seconds and try again."), { status: 503 });
  const p = (async () => {
    // Generation is the expensive, disk-writing path, so it
    // answers to the same free-space floor as uploads (the
    // Round 128/149 guard). Cached reels never reach here.
    if (storageIsFull()) throw Object.assign(new Error("Storage is full right now — new reels are paused until there's room. Try again later."), { status: 507 });
    const bins = await r124ResolveBins();
    if (!bins) throw Object.assign(new Error("Reels aren't available right now — the video tools are offline."), { status: 503 });
    const fresh = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
    if (!fresh) throw Object.assign(new Error("Play not found."), { status: 404 });
    const srcAbs = path.join(UPLOAD_DIR, path.basename(fresh.media_url || ""));
    const workDir = fs.mkdtempSync(path.join(REEL_DIR, `.build-${id}-`));
    const tmpAbs = path.join(workDir, "reel.mp4");
    try {
      const built = await r165BuildReel(bins, fresh, srcAbs, tmpAbs, workDir);
      if (!built.ok) { reelFailAt165.set(id, Date.now()); throw Object.assign(new Error(built.message), { status: built.status || 500 }); }
      const finalAbs = path.join(REEL_DIR, `${id}.mp4`);
      fs.renameSync(tmpAbs, finalAbs);
      db.prepare("UPDATE highlights SET reel_generated_at=datetime('now'), reel_source=? WHERE id=?").run(r167ReelSourceKey(fresh.media_url), id);
      reelFailAt165.delete(id);
      return finalAbs;
    } finally {
      try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
    }
  })();
  reelInflight165.set(id, p);
  try { return await p; } finally { reelInflight165.delete(id); }
}
function r165SendFile(res, id, abs) {
  const st = fs.statSync(abs);
  res.writeHead(200, { "content-type": "video/mp4", "content-disposition": `attachment; filename="highlighthype-reel-${id}.mp4"`, "content-length": st.size, "cache-control": "private, no-store" });
  return fs.createReadStream(abs).pipe(res);
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
      const row = db.prepare("SELECT id, status, is_sample, athlete_id FROM highlights WHERE id=?").get(id);
      if (!row) { console.log(`[r130] retro-entry: play ${id} not found — skipped`); continue; }
      if (row.status !== "approved") { console.log(`[r130] retro-entry: play ${id} is ${row.status}, not approved — skipped`); continue; }
      if (row.is_sample) { console.log(`[r130] retro-entry: play ${id} is a sample — skipped`); continue; }
      if (db.prepare("SELECT 1 FROM contest_entries WHERE highlight_id=? AND period=?").get(id, period)) { console.log(`[r130] retro-entry: play ${id} already entered for ${period} — skipped`); continue; }
      // Round 182: the integrity rules guard this third entry
      // path too. (Both plays predate any recorded winner, so
      // this never fires in practice — the guard keeps the path
      // honest by construction rather than by assumption.)
      const block182 = contestBlock182(row, period);
      if (block182) { console.log(`[r130] retro-entry: play ${id} blocked by Round 182 (${block182.reason}) — skipped`); continue; }
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
// the action's own error handling). actor is 'owner' for the main
// owner token (Owner view + email moderation links), the NAME on
// the passcode for a named-token Owner view action (Round 152),
// 'backup-tool' for the BACKUP_TOKEN channel, 'system' for the
// auto-purge.
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
// Same per-IP pattern for Hype Reel requests (see constants).
function reelRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (reelHitsByIp.get(ip) || []).filter((t) => now - t < REEL_RATE_WINDOW_MS);
  if (hits.length >= REEL_RATE_LIMIT) { reelHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  reelHitsByIp.set(ip, hits);
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
// Same per-IP pattern for Hype Frame avatar generation (see constants).
function avatarRateLimited(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (avatarHitsByIp.get(ip) || []).filter((t) => now - t < AVATAR_RATE_WINDOW_MS);
  if (hits.length >= AVATAR_RATE_LIMIT) { avatarHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  avatarHitsByIp.set(ip, hits);
  return false;
}
// Same per-IP pattern for Hype Frame fence removal (Round 222, see constants).
function fenceRateLimited222(req) {
  const ip = clientIp(req);
  const now = Date.now();
  const hits = (fenceHitsByIp.get(ip) || []).filter((t) => now - t < FENCE_RATE_WINDOW_MS);
  if (hits.length >= FENCE_RATE_LIMIT) { fenceHitsByIp.set(ip, hits); return true; }
  hits.push(now);
  fenceHitsByIp.set(ip, hits);
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

    // ---- Round 200: Shopify webhooks (orders/paid, orders/refunded) ----
    // Emil creates these in Shopify Admin; the signing secret lives
    // ONLY in the HH_SHOPIFY_WEBHOOK_SECRET env var. The HMAC is
    // computed over the RAW request body and compared timing-safe
    // BEFORE the payload is parsed or trusted — nothing is stored
    // on a bad signature (401). With the secret unset the endpoints
    // are inert (503): a misconfigured deploy answers honestly
    // instead of accepting unsigned money events. Every verified
    // delivery gets a 200 — including duplicates and unmatched
    // orders — so Shopify never retry-storms us; anomalies go to
    // the owner by email instead.
    if (p === "/api/webhooks/shopify/orders-paid" || p === "/api/webhooks/shopify/orders-refunded") {
      if (req.method !== "POST") return sendJson(res, 405, { ok: false, message: "POST only." });
      const secret200 = process.env.HH_SHOPIFY_WEBHOOK_SECRET || "";
      if (!secret200) return sendJson(res, 503, { ok: false, message: "Webhook endpoint not configured." });
      let raw200;
      try { raw200 = await readBody(req, 2 * 1024 * 1024); } catch { return sendJson(res, 400, { ok: false, message: "Unreadable body." }); }
      const expected200 = crypto.createHmac("sha256", secret200).update(raw200).digest("base64");
      const givenBuf200 = Buffer.from(String(req.headers["x-shopify-hmac-sha256"] || ""), "utf8");
      const expectBuf200 = Buffer.from(expected200, "utf8");
      if (givenBuf200.length !== expectBuf200.length || !crypto.timingSafeEqual(givenBuf200, expectBuf200))
        return sendJson(res, 401, { ok: false, message: "Bad signature." });
      let payload200 = null;
      try { payload200 = JSON.parse(raw200.toString("utf8") || "{}"); } catch { return sendJson(res, 400, { ok: false, message: "Payload is not JSON." }); }
      const shopifyOrderId200 = String(payload200.id || payload200.order_id || "");
      const refId200 = hfShopifyOrderRef200(payload200);
      const order200 = refId200 ? db.prepare("SELECT * FROM hype_frame_orders WHERE id=?").get(refId200) : null;
      if (p === "/api/webhooks/shopify/orders-paid") {
        if (!order200) {
          console.error(`[r200] orders/paid UNMATCHED — Shopify order ${shopifyOrderId200 || "?"} carries no known HH Order #`);
          notifyOwnerAlert200(`HighlightHype: unmatched Shopify payment (order ${shopifyOrderId200 || "?"})`,
            `Shopify reported a PAID order that does not match any Hype Frame studio order.\n\nShopify order: ${shopifyOrderId200 || "—"}\nHH Order # on the payment: ${refId200 || "none"}\nBuyer email: ${String(payload200.email || payload200.customer?.email || "—")}\nTotal: ${String(payload200.total_price || "—")}\n\nThis usually means the hoodie was bought straight off the Shopify product page. The money is in Shopify; the studio order (frame, print, back text) is NOT on file — contact the buyer for their play details before producing anything.`);
          return sendJson(res, 200, { ok: true, matched: false });
        }
        if (order200.payment_status === "paid" || order200.payment_status === "refunded")
          return sendJson(res, 200, { ok: true, matched: true, duplicate: true }); // re-delivery — already processed, no second emails
        if (order200.payment_status !== "awaiting_payment") {
          // A legacy (pre-handoff) request: its owner email already
          // fired at create, so a production email here would double
          // the notification. Alert instead; state stays untouched.
          console.error(`[r200] orders/paid for LEGACY order #${order200.id} (Shopify order ${shopifyOrderId200 || "?"}) — no state change`);
          notifyOwnerAlert200(`HighlightHype: Shopify payment for legacy request #${order200.id}`,
            `Shopify reported a payment (order ${shopifyOrderId200 || "—"}) against Hype Frame request #${order200.id}, which predates the payment handoff — its owner email already went out when the request was created, so no second production email was sent and the request's state was left untouched.\n\nCheck Shopify and the request in Owner view and reconcile by hand.`);
          return sendJson(res, 200, { ok: true, matched: true, legacy: true });
        }
        db.prepare("UPDATE hype_frame_orders SET payment_status='paid', paid_at=?, shopify_order_id=? WHERE id=?")
          .run(new Date().toISOString(), shopifyOrderId200, order200.id);
        const paidOrder200 = db.prepare("SELECT * FROM hype_frame_orders WHERE id=?").get(order200.id);
        const play200 = getPlayRow(paidOrder200.highlight_id) || { id: paidOrder200.highlight_id, title: `Play #${paidOrder200.highlight_id}` };
        notifyHypeFrameRequest(paidOrder200, play200, { paid: true });
        notifyHfPaymentConfirmed200(paidOrder200, play200);
        return sendJson(res, 200, { ok: true, matched: true });
      }
      // orders-refunded
      if (!order200) {
        console.error(`[r200] orders/refunded UNMATCHED — Shopify order ${shopifyOrderId200 || "?"}`);
        return sendJson(res, 200, { ok: true, matched: false });
      }
      if (order200.payment_status === "refunded") return sendJson(res, 200, { ok: true, matched: true, duplicate: true });
      if (order200.payment_status === "paid" || order200.payment_status === "awaiting_payment") {
        db.prepare("UPDATE hype_frame_orders SET payment_status='refunded' WHERE id=?").run(order200.id);
        notifyOwnerAlert200(`HighlightHype: Hype Frame order #${order200.id} REFUNDED on Shopify`,
          `Shopify refunded the payment for Hype Frame order #${order200.id} (Shopify order ${order200.shopify_order_id || shopifyOrderId200 || "—"}).\n\nThe order is marked REFUNDED. If it has not been produced yet, do NOT produce it; if it already shipped, this is a money matter only.\n\nParent/guardian: ${order200.guardian_name ? order200.guardian_name + " — " : ""}${order200.guardian_email}`);
        return sendJson(res, 200, { ok: true, matched: true });
      }
      console.error(`[r200] orders/refunded for LEGACY order #${order200.id} — no state change`);
      return sendJson(res, 200, { ok: true, matched: true, legacy: true });
    }

    // ---- Round 200: public payment status for the return landing ----
    // The studio's post-checkout landing polls this. It returns ONLY
    // the payment status — no email, no name, no order detail — so
    // the order id on its own reveals nothing private.
    const hfPayStatusMatch200 = p.match(/^\/api\/hype-frame\/orders\/(\d+)\/payment-status$/);
    if (hfPayStatusMatch200 && req.method === "GET") {
      const o200 = db.prepare("SELECT payment_status FROM hype_frame_orders WHERE id=?").get(Number(hfPayStatusMatch200[1]));
      if (!o200) return sendJson(res, 404, { ok: false, message: "Order not found." });
      return sendJson(res, 200, { payment_status: o200.payment_status || "" });
    }

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
          // Round 182: the guardian's own contest-integrity
          // states — My Plays shows the winner / sit-out chip
          // from these instead of leaving a family to wonder
          // why a play can't be entered. Same helpers the
          // public payload uses, so the two surfaces can't drift.
          contestRetired: contestRetired182(r.id),
          contestSitOut: contestSitOutFor182(r, period),
          // Round 165: a reel exists only for an approved play
          // with a local video file — My Plays renders the
          // "Get the reel" button from this flag, and the reel
          // endpoint re-checks the same rule server-side.
          canReel: r.status === "approved" && r.media_kind === "file" && String(r.mime || "").startsWith("video/"),
          // Round 179: whether a finished reel is already cached
          // for this play (the exact r165CachedPath check the reel
          // endpoint makes) — My Plays renders its ready state
          // from this, so a returning guardian sees "ready"
          // instead of sitting through a fake generation wait.
          reelReady: r.status === "approved" ? !!r165CachedPath(r) : false,
          created_at: r.created_at,
        }));
      }
      return sendJson(res, 200, { ok: true, athletes, plays });
    }

    // ---- Round 165: Hype Reel download (guardian-only) ----
    // POST /api/highlights/:id/reel { email } → the branded MP4
    // itself (attachment), generated on first request and then
    // served from the DATA_DIR/reels cache. The authorization
    // is the My Plays rule itself, in hash form: the email
    // rides in the POST body (never a URL, so it lands in no
    // log or history), the server hashes it with the very
    // expression the upload insert stores (sha(normIdentity)),
    // and it must equal THIS play's notify_email_hash — the
    // same match /api/athletes/lookup makes before it will
    // show the guardian their plays. No match: 403, no file,
    // no generation, nothing cached. A play with no guardian
    // email on file can never match, so it can never be reeled
    // by a stranger — or by anyone online. Eligibility mirrors
    // the lookup's canReel flag: approved plays with a local
    // video file only; pending / trashed / image / link plays
    // are refused in plain words. The reel rides under /api/,
    // so the service worker passes it through untouched.
    const reelMatch165 = p.match(/^\/api\/highlights\/(\d+)\/reel$/);
    if (reelMatch165 && req.method === "POST") {
      if (reelRateLimited(req)) return sendJson(res, 429, { ok: false, message: "Too many reel requests from this connection right now — please try again in a little while." });
      let reelBody165 = {};
      try { reelBody165 = JSON.parse((await readBody(req)).toString("utf8") || "{}"); } catch { reelBody165 = {}; }
      const row165 = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(reelMatch165[1]));
      if (!row165) return sendJson(res, 404, { ok: false, message: "Play not found." });
      const givenHash165 = reelBody165.email ? sha(normIdentity(reelBody165.email)) : "";
      if (!givenHash165 || !row165.notify_email_hash || givenHash165 !== row165.notify_email_hash)
        return sendJson(res, 403, { ok: false, message: "That email doesn't match the one used to post this play — try the one you posted with." });
      if (row165.status !== "approved")
        return sendJson(res, 400, { ok: false, message: "Only a play that's live on the board can be made into a reel." });
      if (row165.media_kind !== "file" || !String(row165.mime || "").startsWith("video/") || !String(row165.media_url || "").startsWith("/uploads/"))
        return sendJson(res, 400, { ok: false, message: "This play doesn't have a video file to make a reel from." });
      const reelSrcAbs165 = path.join(UPLOAD_DIR, path.basename(row165.media_url));
      if (!fs.existsSync(reelSrcAbs165))
        return sendJson(res, 400, { ok: false, message: "That play's video file can't be found right now." });
      try {
        const reelFile165 = await r165EnsureReel(row165);
        return r165SendFile(res, row165.id, reelFile165);
      } catch (e) {
        return sendJson(res, e.status || 500, { ok: false, message: e.message || "The reel couldn't be made right now." });
      }
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
    //  - kind "visit_source" (Round 159): the body carries extra
    //    fields (host / utmSource / utmMedium / utmCampaign /
    //    landing); recordVisitSource159 reads ONLY those,
    //    reduces the host again server-side, classifies it, and
    //    bumps the visit_* counters — never refused.
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
      } else if (kind === "visit_source") {
        recordVisitSource159(evt);
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

    // ---- Hype Frame Avatar (Round 206): in-studio AI avatar ----
    // The status probe lets the studio show the maker only when
    // it can actually work; with no OPENAI_API_KEY (or the
    // HH_NO_AVATAR kill switch) it answers {configured:false} and
    // the studio behaves exactly as it did before this round.
    if (p === "/api/hype-frame/avatar-status" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, configured: hfAvatarConfigured206() });
    }
    // Generation: the browser posts the frozen frame (a data URL
    // it captured itself) plus, since Round 218, the design
    // fields for the format's slots (name mode / name / number /
    // custom words / label / tone). The frame is validated, the
    // fields are sanitized into fixed prompt slots server-side,
    // and the request is forwarded to OpenAI — the frame is
    // dropped, never logged, never stored. The generated PNG
    // returns as a data URL; the studio decides whether it
    // becomes the order's print art.
    if (p === "/api/hype-frame/avatar" && req.method === "POST") {
      if (!hfAvatarConfigured206()) return sendJson(res, 503, { ok: false, configured: false, message: "The avatar maker isn't switched on right now — your photo print still works." });
      if (avatarRateLimited(req)) return sendJson(res, 429, { ok: false, configured: true, message: "That's a lot of avatars in an hour — give it a little while and try again. Your photo print still works." });
      const AVATAR_BODY_MAX206 = 8 * 1024 * 1024;
      if (Number(req.headers["content-length"] || 0) > AVATAR_BODY_MAX206) return sendJson(res, 413, { ok: false, configured: true, message: "That frame is too large to send to the avatar maker." });
      let raw;
      try { raw = await readBody(req, AVATAR_BODY_MAX206); }
      catch { try { return sendJson(res, 413, { ok: false, configured: true, message: "That frame is too large to send to the avatar maker." }); } catch { return; } }
      let body = null;
      try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { body = null; }
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String((body && body.image) || ""));
      if (!m) return sendJson(res, 400, { ok: false, configured: true, message: "Send the frozen frame as a jpeg/png data URL." });
      const buf = Buffer.from(m[2], "base64");
      if (!buf.length || buf.length > HF_AVATAR_MAX206) return sendJson(res, 400, { ok: false, configured: true, message: "That frame is too large to send to the avatar maker." });
      const design218 = hfAvatarDesign218(body);
      try {
        const image = await runHfAvatar206(buf, "image/" + m[1], design218);
        console.log("hype-frame avatar: generated (" + HF_AVATAR_MODEL206 + ", mode " + design218.nameMode + ")");
        return sendJson(res, 200, { ok: true, configured: true, image });
      } catch (e) {
        console.error("hype-frame avatar failed:", e.message);
        return sendJson(res, 502, { ok: false, configured: true, failed: true, message: "The avatar maker couldn't finish that one — your photo print still works. Try again in a bit." });
      }
    }

    // ---- Hype Frame fence removal (Round 222) ----
    // The status probe lets the studio show the "Remove the
    // fence" step only when it can actually work (OPENAI_API_KEY
    // set, HH_NO_FENCE unset) — otherwise the photo path behaves
    // exactly as it did before this round.
    if (p === "/api/hype-frame/fence-status" && req.method === "GET") {
      return sendJson(res, 200, { ok: true, configured: hfFenceConfigured222() });
    }
    // Removal: the browser posts the current print-source photo
    // (a data URL it holds itself); the photo is validated and
    // forwarded to OpenAI with the remove-fence-only prompt —
    // dropped, never logged, never stored. The cleaned photo
    // returns as a data URL; the studio shows it for the
    // parent's explicit approval before it can become the print
    // source. Nothing is ever cleaned automatically.
    if (p === "/api/hype-frame/remove-fence" && req.method === "POST") {
      if (!hfFenceConfigured222()) return sendJson(res, 503, { ok: false, configured: false, message: "Fence removal isn't switched on right now — your photo still works as it is." });
      if (fenceRateLimited222(req)) return sendJson(res, 429, { ok: false, configured: true, message: "That's a lot of fence removals in an hour — give it a little while and try again. Your photo still works as it is." });
      const FENCE_BODY_MAX222 = 8 * 1024 * 1024;
      if (Number(req.headers["content-length"] || 0) > FENCE_BODY_MAX222) return sendJson(res, 413, { ok: false, configured: true, message: "That photo is too large to send for fence removal." });
      let raw;
      try { raw = await readBody(req, FENCE_BODY_MAX222); }
      catch { try { return sendJson(res, 413, { ok: false, configured: true, message: "That photo is too large to send for fence removal." }); } catch { return; } }
      let body = null;
      try { body = JSON.parse(raw.toString("utf8") || "{}"); } catch { body = null; }
      const m = /^data:image\/(jpeg|png);base64,([A-Za-z0-9+/=]+)$/.exec(String((body && body.image) || ""));
      if (!m) return sendJson(res, 400, { ok: false, configured: true, message: "Send the photo as a jpeg/png data URL." });
      const buf = Buffer.from(m[2], "base64");
      if (!buf.length || buf.length > HF_FENCE_MAX222) return sendJson(res, 400, { ok: false, configured: true, message: "That photo is too large to send for fence removal." });
      try {
        const image = await runHfFence222(buf, "image/" + m[1]);
        console.log("hype-frame fence: removed (" + HF_AVATAR_MODEL206 + ")");
        return sendJson(res, 200, { ok: true, configured: true, image });
      } catch (e) {
        console.error("hype-frame fence failed:", e.message);
        return sendJson(res, 502, { ok: false, configured: true, failed: true, message: "Fence removal couldn't finish that one — your photo still works as it is. Try again in a bit." });
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
      const viewCounts151 = playViewCounts151(); // Round 151: one grouped query for the whole board
      rows = rows.map((r) => publicHighlight(r, voter, viewCounts151));
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
        // Round 182: same clip = same play, ALL-TIME. Past the
        // 30-minute retry window, a byte-match against a LIVE
        // play (pending or approved) of ANY age gets the same
        // answer — the clip is already on the board (or in the
        // queue) as that play, whoever is re-posting it and
        // however long ago it landed. Trashed or declined
        // (hidden) originals do NOT block: remove the original
        // and the clip can be posted again (a permanently
        // deleted original leaves no row to match at all). The
        // hash is the stored Round 145 media_hash, so no new
        // data is needed; NULL hashes (link plays) never match,
        // exactly as before.
        const dup182 = db.prepare("SELECT id, status, athlete_tag FROM highlights WHERE media_hash=? AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1").get(mediaHash145);
        if (dup182) return sendJson(res, 200, { ok: true, deduped: true, id: dup182.id, status: dup182.status, athlete_tag: dup182.athlete_tag || "", message: "This clip is already in — no need to post it twice." });
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
      // Round 162: the milestone tag — optional, skippable, and
      // validated by the allowlist helper: a valid kind stores,
      // anything else (or nothing) stores NULL = untagged.
      const momentKind162v = momentKind162(fields.momentKind);
      // Upload Assist (Round 99): the browser's AI result rides along
      // as an untrusted label (see sanitizeAiField) — display only.
      const aiJson = sanitizeAiField(fields.ai);
      // Round 155 (2026-11-14): the trusted-family fast lane.
      // ORDER IS A HARD RULE, in this exact sequence: (1) the
      // Round 145 dedupe above already answered a same-bytes
      // retry — unchanged, and earlier than everything here;
      // (2) the Upload Assist garbage gate — enforced in the
      // browser (Round 99) and mirrored here from the SANITIZED
      // verdict via aiGateBlocksLane155: a gate-stopped upload
      // is NEVER rescued by the lane, it files for owner review
      // exactly as it always has; (3) only then does the
      // guardian email hash meet the allowlist. A match inserts
      // APPROVED with the fast_laned_at marker and, below, the
      // standard approval side-effects; anything else stays
      // pending, byte-for-byte the pre-155 behavior. The hash
      // computed here is the very value the insert stores as
      // notify_email_hash — one expression, so panel-added and
      // upload-side spellings can never drift apart.
      const notifyEmail155 = String(fields.notifyEmail || "").trim();
      const guardianHash155 = notifyEmail155 ? sha(normIdentity(notifyEmail155)) : "";
      const trusted155 = aiGateBlocksLane155(aiJson) ? null : trustedGuardianFor155(guardianHash155);
      const insertStatus155 = trusted155 ? "approved" : "pending";
      const fastLanedAt155 = trusted155 ? new Date().toISOString().replace("T", " ").slice(0, 19) : null;
      const info = db.prepare(`INSERT INTO highlights(title,sport,division,play_type,player_name,story,media_kind,media_url,mime,embed_url,host_label,status,review,team,notify_email,notify_email_hash,athlete_id,athlete_tag,athlete_group,jersey,guardian_phone,text_consent,guardian_consent_at,story_consent,story_consent_at,ai_json,contest_optin,media_hash,fast_laned_at,moment_kind)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(title, sport, division, fields.playType || "", fields.playerName || "", fields.story || "", media_kind, media_url, mime, embed_url, host_label, insertStatus155, JSON.stringify(review), String(fields.team || "").trim(), notifyEmail155, guardianHash155, athlete.athlete_id, athlete.athlete_tag, athlete.athlete_group, String(fields.jersey || "").trim(), guardianPhone, textConsent, new Date().toISOString(), storyConsent, storyConsent ? new Date().toISOString() : "", aiJson, contestOptin130, mediaHash145, fastLanedAt155, momentKind162v);
      const newPlayId = Number(info.lastInsertRowid);
      // Round 124: the media pipeline runs BEFORE the response —
      // a converted file and its poster are part of the finished
      // upload, not an afterthought. It can never fail the upload:
      // every failure path inside keeps the original file and the
      // 201 below still goes out (see the fallback contract above).
      if (uploadedName && file && (file.ctype || "").startsWith("video/")) await r124ProcessUpload(newPlayId, uploadedName);
      const rowNow = db.prepare("SELECT media_url, poster_url FROM highlights WHERE id=?").get(newPlayId);
      if (rowNow) { media_url = rowNow.media_url; }
      if (trusted155) {
        // Round 155: a fast-laned play runs the STANDARD approval
        // side-effects — the same helpers in the same order as
        // the owner status endpoint's pending->approved
        // transition: the moderation log (here: actor
        // fast-lane:<label>, written at insert time so the lane
        // never leaves an unlogged live play), the guardian
        // approval email, the guardian text, and the Round 130
        // contest auto-entry on the post-insert row. The owner's
        // notifyPending mail is NOT sent — nothing is pending.
        try { db.prepare("UPDATE trusted_guardians SET last_used_at=datetime('now') WHERE id=?").run(trusted155.id); } catch {}
        const laneRow155 = db.prepare("SELECT * FROM highlights WHERE id=?").get(newPlayId);
        logModeration146(newPlayId, "approve", `fast-lane:${trusted155.label}`, `"${title}" went live via the fast lane — trusted guardian, no queue wait`);
        if (laneRow155 && laneRow155.notify_email) notifyApproved(laneRow155.title, laneRow155.id, laneRow155.notify_email);
        if (laneRow155) notifyGuardianText(laneRow155, `HighlightHype: good news — your play "${laneRow155.title}" was approved and is now live! See it here: https://highlighthype.com/#play-${laneRow155.id}`);
        if (laneRow155) autoEnterOnApproval130(laneRow155);
      } else {
        notifyPending(title, sport, newPlayId, review);
        // Round 156: the owners' text alert rides the same
        // pending insert. The Round 145 dedupe answered much
        // earlier (nothing was inserted, nothing texts), and
        // the fast-lane branch above never reaches this line
        // (a laned play is covered by the panel's strip), so
        // exactly one alert round goes out per genuinely new
        // queue arrival.
        notifyOwnerTextAlert156({ id: newPlayId, playerName: fields.playerName || "", title, sport });
      }
      // Round 121: the response carries the athlete's HH tag so the
      // client can show it on the post-success screen ("save it!") —
      // the tag is a public identifier, safe to hand back.
      return sendJson(res, 201, { ok: true, id: newPlayId, status: insertStatus155, fastLaned: !!trusted155, athlete_tag: athlete.athlete_tag || "", media_url, poster_url: (rowNow && rowNow.poster_url) || "", message: trusted155 ? "Your play is live on the board!" : "Thanks! Your play is in review and will appear once the owner approves it." });
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
      // Round 164: standings just moved — evaluate guardian
      // trending nudges + the lazy rally check. Both helpers
      // catch their own errors; the extra wrap is belt-and-
      // braces so mail can NEVER break voting.
      try { evaluateNudges164(period); maybeSendRally164(); } catch (e) { console.error("nudge hooks failed:", e.message); }
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
      // Round 227: the allowlist widened to the coming-soon store keys
      // (DROP_NOTIFY_KEYS227) — the six bottle sports behave exactly as
      // before; anything outside the full list still 400s here.
      if (!DROP_NOTIFY_KEYS227.includes(sport))
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
      // Back text (Round 197): the parent's choice for the words
      // embroidered across the back. An absent or unknown choice
      // reads 'name' — exactly the pre-R197 behavior. 'custom' is
      // validated hard: an empty, over-length or un-stitchable line
      // rejects the order with a clear message rather than saving a
      // bad order. 'name_number' stores the jersey digits (and only
      // the digits) in the order's jersey field.
      const backTextChoice = ["name", "name_number", "none", "custom"].includes(String(body.backText || "").trim().toLowerCase())
        ? String(body.backText).trim().toLowerCase() : "name";
      let backTextCustom = "";
      if (backTextChoice === "custom") {
        const err197 = hfCustomTextError197(body.backTextCustom);
        if (err197) return sendJson(res, 400, { ok: false, message: err197 });
        backTextCustom = String(body.backTextCustom || "").trim();
      }
      let jersey197 = String(body.jersey || "").trim().slice(0, 8);
      if (backTextChoice === "name_number") {
        const digits197 = String(body.jersey || "").replace(/\D/g, "").slice(0, 3);
        if (!digits197) return sendJson(res, 400, { ok: false, message: "Add the jersey number — you picked name + number for the back." });
        jersey197 = digits197;
      }
      // Design name mode + label (Round 218): the client sends
      // nameMode alongside backText (the same four choices under
      // their design name — an absent or unknown value falls back
      // to the back-text choice) and the design's label line,
      // sanitized with the avatar slot rules (printable chars
      // only, <=24) and stored uppercased as the format prints it.
      const nameMode218 = ["name", "name_number", "none", "custom"].includes(String(body.nameMode || "").trim().toLowerCase())
        ? String(body.nameMode).trim().toLowerCase() : backTextChoice;
      const designLabel218 = hfAvatarSlot218(body.designLabel, 24).toUpperCase();
      // Garment color (Round 199, 2026-11-26 — Emil): the studio
      // sells exactly two colorways now, Black and Heather Gray,
      // and an order must name one of them. Unlike the enum fields
      // that sanitize to a default (side, image style, size), a
      // missing or discontinued colorway REJECTS the order — a
      // stale client can never quietly order a color that no
      // longer exists. Orders already on file are untouched: the
      // owner email and Owner view keep printing the stored value.
      const colorway199 = String(body.colorway || "").trim();
      if (!["Black", "Heather Gray"].includes(colorway199))
        return sendJson(res, 400, { ok: false, message: "Pick a hoodie color — the Hype Frame hoodie comes in Black or Heather Gray." });
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
        jersey: jersey197,
        back_text: backTextChoice,
        back_text_custom: backTextCustom,
        name_mode: nameMode218,
        design_label: designLabel218,
        branding: body.branding === false ? 0 : 1,
        apparel: String(body.apparel || "").trim().toLowerCase() === "tee" ? "tee" : "hoodie",
        // Round 208 (2026-11-26, Emil): the print-side default
        // flips to "back" — the framed print is a back print (his
        // configurator mockup, the DTF shop's back-print format,
        // the hoodie-back example photo); the front carries the
        // embroidered crest. Explicit "front"/"back" pass through
        // exactly as before; a missing or bogus side now lands on
        // "back" instead of "front". Stored orders are untouched.
        side: String(body.side || "").trim().toLowerCase() === "front" ? "front" : "back",
        image_style: String(body.imageStyle || "").trim().toLowerCase() === "avatar" ? "avatar" : "photo",
        // Round 206: the print image is a studio-generated AI
        // avatar only when the client says the avatar was made
        // AND chosen — and the claim only makes sense riding an
        // avatar-styled order (a photo order's flag is ignored).
        avatar_generated: body.avatarGenerated === true && String(body.imageStyle || "").trim().toLowerCase() === "avatar" ? 1 : 0,
        colorway: colorway199,
        // Round 199: adult sizes S–XL join the youth run in the
        // whitelist; the sanitize-to-YM fallback is unchanged.
        // Round 226: YXXS leaves the whitelist (cut catalog-wide)
        // — a payload naming it now gets the same treatment as
        // any other invalid size (the sanitize-to-YM fallback).
        size: ["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"].includes(String(body.size || "").trim().toUpperCase()) ? String(body.size).trim().toUpperCase() : "YM",
        guardian_name: String(body.guardianName || "").trim().slice(0, 80),
        guardian_email: guardianEmail,
        placement,
      };
      const info = db.prepare(`INSERT INTO hype_frame_orders(highlight_id,athlete_id,print_image,custom_name,jersey,branding,apparel,side,image_style,avatar_generated,colorway,size,guardian_name,guardian_email,placement,back_text,back_text_custom,name_mode,design_label)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(order.highlight_id, order.athlete_id, order.print_image, order.custom_name, order.jersey, order.branding, order.apparel, order.side, order.image_style, order.avatar_generated, order.colorway, order.size, order.guardian_name, order.guardian_email, order.placement, order.back_text, order.back_text_custom, order.name_mode, order.design_label);
      if (imgProblem) console.error(`hype-frame order ${Number(info.lastInsertRowid)} saved WITHOUT its print image: ${imgProblem}`);
      // Round 200: with the Shopify handoff ON, the order starts
      // as awaiting_payment and the owner email is DEFERRED to the
      // orders/paid webhook — an unpaid order must never reach
      // production. The response carries the checkout URL and the
      // studio offers "Continue to payment". With the handoff OFF
      // (the dark-launch default), the flow below is byte-identical
      // to the pre-R200 behavior.
      if (hfShopifyCheckoutOn200()) {
        const newId200 = Number(info.lastInsertRowid);
        db.prepare("UPDATE hype_frame_orders SET payment_status='awaiting_payment' WHERE id=?").run(newId200);
        const saved200 = { ...order, id: newId200 };
        return sendJson(res, 201, { ok: true, id: newId200, status: "awaiting_payment", paymentStatus: "awaiting_payment", checkoutUrl: hfCheckoutUrl200(saved200, play), imageSaved: !!imgName, backTextToEmbroider: hfBackTextToEmbroider197(order), message: "Your Hype Frame is saved — one step left: complete payment to send it to production." });
      }
      notifyHypeFrameRequest({ ...order, id: Number(info.lastInsertRowid) }, play);
      return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid), status: "pending-guardian", imageSaved: !!imgName, backTextToEmbroider: hfBackTextToEmbroider197(order), message: "Request received — we'll email the parent/guardian to confirm before anything is printed." });
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
        // Round 179 (2026-11-14, Emil — the youth testers' #1
        // fairness flag): battles are JUST FOR FUN. A daily pick
        // records the pick and nothing else — it never creates,
        // removes, or alters a Hype of the Month contest vote.
        // (Rounds 91–178 coupled a real-matchup pick to a normal
        // vote insert, invisibly to the picker; that coupling is
        // removed here and in the client's btlPick. Contest votes
        // change ONLY through the explicit vote endpoints.)
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
    /* Round 162: the Moment That Mattered — the owner's current
       spotlight pick, resolved LIVE on every read: the pick is
       served only while the play is an approved, non-sample play,
       so trashing / hiding / un-approving it later makes the
       homepage card simply vanish (no stale feature, no separate
       cleanup). The story text is consent-gated HERE, at the one
       public surface that quotes it: without the play's
       story_consent flag the payload carries NO story at all —
       not a teaser, not a truncation. */
    if (p === "/api/spotlight" && req.method === "GET") {
      const pick162 = getSpotlight162();
      if (!pick162) return sendJson(res, 200, { ok: true, spotlight: null });
      const row162 = db.prepare("SELECT * FROM highlights WHERE id=?").get(pick162.play_id);
      if (!row162 || row162.status !== "approved" || row162.is_sample) return sendJson(res, 200, { ok: true, spotlight: null });
      const pub162 = publicHighlight(row162);
      pub162.story = row162.story_consent ? (row162.story || "") : "";
      pub162.story_consent = !!row162.story_consent;
      return sendJson(res, 200, { ok: true, spotlight: pub162 });
    }
    if (p === "/api/contest" && req.method === "GET") {
      // Round 164: the rally's lazy check rides the contest
      // read path too (idempotent — see maybeSendRally164).
      try { maybeSendRally164(); } catch (e) { console.error("rally check failed:", e.message); }
      const period = u.searchParams.get("period") || currentPeriod();
      const voter = u.searchParams.get("voterToken") || "";
      const winnerId = db.prepare("SELECT highlight_id FROM contest_winners WHERE period=?").get(period)?.highlight_id;
      // Defensive (Round 7): samples are refused at the enter
      // endpoint, but even a legacy/hand-made entry row for a sample
      // must never surface on the month board or the podium — the
      // query itself excludes them.
      const viewCounts151 = playViewCounts151(); // Round 151: one grouped query for the whole contest board
      const rows = db.prepare(`SELECT h.* FROM contest_entries e JOIN highlights h ON h.id=e.highlight_id
        WHERE e.period=? AND h.status='approved' AND COALESCE(h.is_sample,0)=0`).all(period).map((r) => ({ ...publicHighlight(r, voter, viewCounts151), voteCount: monthlyVoteCount(r.id, period), isWinner: r.id === winnerId, prizeEligible: prizeEligibleFor(r) }));
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
      // Round 182: the integrity rules — a play that already won
      // is retired for good, and last month's winning athlete
      // sits this month out. Refused here in the same plain
      // words the client renders as disabled states (the payload
      // flags contestRetired / contestSitOut), with the reason
      // distinguished for the client and the tests.
      const block182 = contestBlock182(row, period);
      if (block182) return sendJson(res, 400, { ok: false, reason182: block182.reason, message: block182.message });
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

    // ---- Round 164: trending-nudge unsubscribe (public) ----
    // The link rides every nudge email. The token is an HMAC of
    // the email hash (see nudgeUnsubToken164) — a valid pair
    // proves the click came from a real nudge we sent, without
    // any login. Opting out gates ONLY trending mail (triggers +
    // rally); approval/transactional mail keeps flowing.
    if (p === "/api/nudge/unsubscribe" && req.method === "GET") {
      const eHash = String(u.searchParams.get("e") || "");
      const tok = String(u.searchParams.get("t") || "");
      const valid = /^[0-9a-f]{64}$/.test(eHash) && !!tok && sha(tok) === sha(nudgeUnsubToken164(eHash));
      if (!valid) return sendHtml(res, 400, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HighlightHype</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px"><h1>That unsubscribe link isn't valid</h1><p>It may have been copied incompletely. Open the link straight from the trending-update email and it will work.</p><p><a href="/">← HighlightHype home</a></p></body></html>`);
      db.prepare("INSERT OR IGNORE INTO nudge_optouts(email_hash) VALUES(?)").run(eHash);
      return sendHtml(res, 200, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HighlightHype</title></head><body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px"><h1>You're unsubscribed from trending updates</h1><p>Approval emails for your plays will still arrive — this only stops the trending updates (Top 3, #1 and the month-end rally).</p><p><a href="/">← HighlightHype home</a></p></body></html>`);
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
          trashed_at: r.trashed_at || "", status_before_trash: r.status_before_trash || "", trash_days_left: trashDaysLeft146(r),
          // Round 155: the fast-lane marker (owner-only, like the
          // fields above) — the queue card wears the ⚡ chip for a
          // play that skipped the queue via a trusted guardian.
          fast_laned_at: r.fast_laned_at || "",
          // Round 224: the missing-rendition flag (owner-only,
          // like the fields above) — the queue card wears a
          // warning chip for a file play rendition-less for
          // over 24h, the state play 78 hid in for a day.
          missing_rendition: r224MissingRendition(r),
          // Round 227: the upload text-safety flag (owner-only,
          // like the fields above) — a short label when the
          // story/team text mentions a child's age or the team
          // field looks like a person's full name. Display
          // only: it never blocks and never edits anything.
          text_flag227: r227TextFlag(r) };
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
    // ---- Owner: named passcodes (Round 152; owner-authorized ONLY) ----
    // Each person gets their OWN passcode (owner_tokens) instead
    // of sharing the main token. The list exposes metadata only —
    // never a hash, never a value. Mint returns the plaintext
    // EXACTLY ONCE (only its SHA-256 is stored). Revoke stamps
    // revoked_at and takes effect on the very next request,
    // because ownerIdentity152 only matches active rows. Any
    // valid owner credential (main token or a named passcode)
    // may mint/revoke — Dyanna can kill her own lost passcode.
    if (p === "/api/owner/tokens" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const tokens152 = db.prepare("SELECT id, name, created_at, last_used_at, revoked_at FROM owner_tokens ORDER BY id").all()
        .map((r) => ({ id: r.id, name: r.name, created_at: r.created_at, last_used_at: r.last_used_at || null, revoked: !!r.revoked_at }));
      return sendJson(res, 200, { ok: true, tokens: tokens152 });
    }
    if (p === "/api/owner/tokens" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const name152 = String(body.name || "").trim().replace(/\s+/g, " ");
      if (!name152) return sendJson(res, 400, { ok: false, message: "Give the passcode a name — whose is it?" });
      if (name152.length > 40) return sendJson(res, 400, { ok: false, message: "That name is too long — 40 characters max." });
      const dup152 = db.prepare("SELECT id FROM owner_tokens WHERE revoked_at IS NULL AND LOWER(name)=LOWER(?)").get(name152);
      if (dup152) return sendJson(res, 400, { ok: false, message: `There is already an active passcode named "${name152}" — revoke that one first, or pick another name.` });
      const token152 = "hh-" + crypto.randomBytes(12).toString("base64url");
      const info152 = db.prepare("INSERT INTO owner_tokens(name, token_hash) VALUES(?,?)").run(name152, sha(token152));
      return sendJson(res, 200, { ok: true, id: Number(info152.lastInsertRowid), name: name152, token: token152 });
    }
    if (p === "/api/owner/tokens/revoke" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id152 = Number(body.id);
      if (!Number.isInteger(id152)) return sendJson(res, 400, { ok: false, message: "Which passcode should be revoked? Reload the panel and try again." });
      const row152 = db.prepare("SELECT id, name, revoked_at FROM owner_tokens WHERE id=?").get(id152);
      if (!row152) return sendJson(res, 404, { ok: false, message: "That passcode doesn't exist." });
      const already152 = !!row152.revoked_at;
      if (!already152) db.prepare("UPDATE owner_tokens SET revoked_at=datetime('now') WHERE id=?").run(id152);
      return sendJson(res, 200, { ok: true, id: id152, name: row152.name, revoked: true, alreadyRevoked: already152 });
    }
    // ---- Owner: trusted-family fast lane (Round 155; owner-authorized ONLY) ----
    // The allowlist behind the upload fast lane (see the schema
    // note at trusted_guardians). The list exposes METADATA only
    // — label, created, last used, active/revoked — never an
    // email and never a hash: the owner types the address once
    // at add time and the server keeps only its hash. The GET
    // also carries the "awaiting your look" strip: the most
    // recent fast-laned plays that are STILL LIVE (status
    // approved + marker set), newest first, capped at 10 — the
    // owner's undo for any of them is the panel's ordinary
    // Trash move (DELETE /api/highlights/:id, 7-day restorable).
    if (p === "/api/owner/trusted" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const guardians155 = db.prepare("SELECT id, label, created_at, last_used_at, revoked_at FROM trusted_guardians ORDER BY id").all()
        .map((r) => ({ id: r.id, label: r.label, created_at: r.created_at, last_used_at: r.last_used_at || null, revoked: !!r.revoked_at }));
      const recent155 = db.prepare(`SELECT h.id, h.title, h.player_name, h.athlete_tag, h.fast_laned_at, t.label AS lane_label
        FROM highlights h LEFT JOIN trusted_guardians t ON t.email_hash = h.notify_email_hash
        WHERE h.status='approved' AND h.fast_laned_at IS NOT NULL AND h.fast_laned_at<>''
        ORDER BY h.fast_laned_at DESC, h.id DESC LIMIT 10`).all()
        .map((r) => ({ id: r.id, title: r.title, athlete: r.player_name ? athleteDisplayName(r.player_name) : "", athlete_tag: r.athlete_tag || "", fast_laned_at: r.fast_laned_at, label: r.lane_label || "" }));
      // Round 156: the text-alert status rides this payload —
      // counts and booleans ONLY (see ownerTextAlertStatus156);
      // the configured numbers themselves never leave the env.
      return sendJson(res, 200, { ok: true, guardians: guardians155, recent: recent155, textAlerts156: ownerTextAlertStatus156() });
    }
    if (p === "/api/owner/trusted" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const email155 = String(body.email || "").trim();
      const label155 = String(body.label || "").trim().replace(/\s+/g, " ");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email155)) return sendJson(res, 400, { ok: false, message: "That doesn't look like an email address — check it and try again." });
      if (!label155) return sendJson(res, 400, { ok: false, message: "Give the family a label — e.g. \"The Millers — Hawks\"." });
      if (label155.length > 60) return sendJson(res, 400, { ok: false, message: "That label is too long — 60 characters max." });
      // Hashed with the uploads' own normalization, so the
      // address the owner types here matches the address the
      // guardian posts with, whatever the case or spacing.
      const hash155 = sha(normIdentity(email155));
      const existing155 = db.prepare("SELECT id, label, revoked_at FROM trusted_guardians WHERE email_hash=?").get(hash155);
      if (existing155 && !existing155.revoked_at) return sendJson(res, 400, { ok: false, message: `That email is already on the fast lane as "${existing155.label}".` });
      if (existing155) {
        // Re-adding a REVOKED email reactivates its row in place
        // (the UNIQUE hash rules out a second row): fresh label,
        // the revoking stamp cleared, last-used reset so the
        // panel reads like a fresh add.
        db.prepare("UPDATE trusted_guardians SET label=?, added_by=?, revoked_at=NULL, last_used_at=NULL WHERE id=?").run(label155, ownerActor152(req), existing155.id);
        return sendJson(res, 200, { ok: true, id: existing155.id, label: label155, reactivated: true });
      }
      const info155 = db.prepare("INSERT INTO trusted_guardians(email_hash, label, added_by) VALUES(?,?,?)").run(hash155, label155, ownerActor152(req));
      return sendJson(res, 200, { ok: true, id: Number(info155.lastInsertRowid), label: label155, reactivated: false });
    }
    if (p === "/api/owner/trusted/revoke" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id155 = Number(body.id);
      if (!Number.isInteger(id155)) return sendJson(res, 400, { ok: false, message: "Which family should come off the list? Reload the panel and try again." });
      const row155 = db.prepare("SELECT id, label, revoked_at FROM trusted_guardians WHERE id=?").get(id155);
      if (!row155) return sendJson(res, 404, { ok: false, message: "That family isn't on the fast-lane list." });
      const already155 = !!row155.revoked_at;
      if (!already155) db.prepare("UPDATE trusted_guardians SET revoked_at=datetime('now') WHERE id=?").run(id155);
      return sendJson(res, 200, { ok: true, id: id155, label: row155.label, revoked: true, alreadyRevoked: already155 });
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
      return sendJson(res, 200, { requests: rows.map((o) => ({ ...o, branding: !!o.branding, back_text_reviewed: !!o.back_text_reviewed, backTextToEmbroider: hfBackTextToEmbroider197(o), imageUrl: `/api/owner/hype-frames/${o.id}/image` })) });
    }
    // ---- Owner: bottle drop notifications (owner-authorized ONLY) ----
    // The only place drop-notify emails are ever returned. Counts are
    // grouped per sport in the fixed six-sport order so the owner
    // panel reads like the shop grid.
    if (p === "/api/owner/drop-notifications" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const signups = db.prepare("SELECT email, sport, created_at FROM drop_notifications ORDER BY id DESC").all();
      // Round 227: counts cover the full key list (bottles first, in
      // their original order, then the coming-soon store keys) so the
      // hoodie/collection signups are visible to the owner too.
      const counts = DROP_NOTIFY_KEYS227.map((sport) => ({ sport, count: signups.filter((s) => s.sport === sport).length }));
      return sendJson(res, 200, { signups, counts });
    }
    // ---- Round 197: owner marks a custom back-text line reviewed ----
    // The Owner view flags every custom-words order until the owner
    // has read the line; this is the whole "review" — one flag, set
    // here, owner-authorized only, idempotent.
    const hfReviewedMatch197 = p.match(/^\/api\/owner\/hype-frames\/(\d+)\/back-text-reviewed$/);
    if (hfReviewedMatch197 && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const o197 = db.prepare("SELECT id FROM hype_frame_orders WHERE id=?").get(Number(hfReviewedMatch197[1]));
      if (!o197) return sendJson(res, 404, { ok: false, message: "That order isn't on file." });
      db.prepare("UPDATE hype_frame_orders SET back_text_reviewed=1 WHERE id=?").run(o197.id);
      return sendJson(res, 200, { ok: true, id: o197.id, backTextReviewed: true });
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
      // Round 159: visitor sources — the last 30 days of the
      // visit_* counters (see recordVisitSource159). Classes are
      // always all four keys (zero-filled); top hosts carry a
      // friendly label beside the raw host; campaigns decode the
      // JSON [source, medium, campaign] keys back into fields.
      const srcSince159 = dayStr(new Date(Date.now() - 29 * 864e5));
      const byClass159 = { direct: 0, search: 0, social: 0, other: 0 };
      let srcTotal159 = 0;
      for (const r of db.prepare("SELECT key, SUM(count) c FROM stat_events WHERE kind='visit_source' AND day>=? GROUP BY key").all(srcSince159)) {
        if (Object.prototype.hasOwnProperty.call(byClass159, r.key)) byClass159[r.key] = r.c;
        srcTotal159 += r.c;
      }
      const topHosts159 = db.prepare("SELECT key, SUM(count) AS count FROM stat_events WHERE kind='visit_host' AND day>=? GROUP BY key ORDER BY count DESC, key ASC LIMIT 8").all(srcSince159)
        .map((r) => ({ host: r.key, label: visitHostLabel159(r.key), count: r.count }));
      // Campaign rows are stored per (source, medium, campaign)
      // triple; for display they aggregate by (campaign, source)
      // — the same campaign arriving with and without a medium
      // tag is one campaign, not two lookalike rows. The medium
      // shown is the first non-empty one (rows arrive count-
      // ordered). Aggregation happens AFTER the full read: no
      // LIMIT on the raw query, or a split row could be cut.
      const campAgg159 = new Map();
      for (const r of db.prepare("SELECT key, SUM(count) AS count FROM stat_events WHERE kind='visit_campaign' AND day>=? GROUP BY key ORDER BY count DESC, key ASC").all(srcSince159)) {
        let a = []; try { const parsed159 = JSON.parse(r.key); if (Array.isArray(parsed159)) a = parsed159; } catch {}
        const row159 = { source: String(a[0] || ""), medium: String(a[1] || ""), campaign: String(a[2] || ""), count: r.count };
        if (!row159.campaign) continue;
        const gk159 = row159.campaign + "\n" + row159.source;
        const g159 = campAgg159.get(gk159);
        if (g159) { g159.count += row159.count; if (!g159.medium && row159.medium) g159.medium = row159.medium; }
        else campAgg159.set(gk159, row159);
      }
      const campaigns159 = [...campAgg159.values()].sort((x, y) => y.count - x.count || (x.campaign < y.campaign ? -1 : x.campaign > y.campaign ? 1 : 0)).slice(0, 8);
      const sources159 = { windowDays: 30, total: srcTotal159, byClass: byClass159, topHosts: topHosts159, campaigns: campaigns159 };
      // Round 164: guardian trending nudges — this period's
      // sends by kind, the last few log rows, and the rally
      // state (window + how many guardians have been mailed).
      const nudgePeriod164 = currentPeriod();
      const nudgeCounts164 = { first: 0, top3: 0, rally: 0 };
      for (const r of db.prepare("SELECT kind, COUNT(*) c FROM nudge_log WHERE period=? GROUP BY kind").all(nudgePeriod164))
        if (Object.prototype.hasOwnProperty.call(nudgeCounts164, r.kind)) nudgeCounts164[r.kind] = r.c;
      const nudgeRecent164 = db.prepare(`SELECT l.kind AS kind, l.rank_at_send AS rank, l.sent_at AS sent_at, h.player_name AS athlete, h.title AS title
        FROM nudge_log l LEFT JOIN highlights h ON h.id=l.play_id WHERE l.period=? ORDER BY l.id DESC LIMIT 8`).all(nudgePeriod164);
      const rallyWin164 = rallyWindow164(nudgePeriod164);
      let rallySent164 = 0;
      try { const arr164 = JSON.parse(getSetting(`rally_sent_${nudgePeriod164}`) || "[]"); if (Array.isArray(arr164)) rallySent164 = arr164.length; } catch {}
      const etToday164 = etDay164(new Date());
      const nudges164 = {
        period: nudgePeriod164, counts: nudgeCounts164, recent: nudgeRecent164,
        rally: { windowOpens: rallyWin164.opens, endsLabel: rallyWin164.endsLabel, inWindow: etToday164 >= rallyWin164.opens && etToday164.slice(0, 7) === nudgePeriod164, sentGuardians: rallySent164 },
      };
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
        sources: sources159,
        nudges: nudges164,
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
      const reelsBytes = walkDataFiles(REEL_DIR).reduce((a, f) => a + f.size, 0); // Round 165: cached Hype Reels ride the same meter
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
      return sendJson(res, 200, { ok: true, totalBytes, freeBytes, usedBytes, usedPct, uploadsBytes, dbBytes, hypeFramesBytes, reelsBytes, pendingCount, pendingBytes, biggest: sized149.slice(0, 8) });
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
    /* Round 162: owner retro-tagging — plays posted before the
       milestone question existed (and any play whose family
       skipped it) get their tag here. Same allowlist validator
       as the upload; null / "" clears. Logged like every other
       owner action (Round 146). Any status may be tagged — the
       tag only displays once a play is public. */
    if (p === "/api/owner/moment-kind" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = Number(body.id);
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (body.kind != null && body.kind !== "" && !momentKind162(body.kind)) return sendJson(res, 400, { ok: false, message: "Unknown moment kind." });
      const kind162 = momentKind162(body.kind);
      db.prepare("UPDATE highlights SET moment_kind=? WHERE id=?").run(kind162, id);
      logModeration146(id, "moment-kind", ownerActor152(req), `"${row.title}" moment tag ${kind162 ? `set to ${MOMENT_LABELS162[kind162]}` : "cleared"}${row.moment_kind ? ` (was ${MOMENT_LABELS162[row.moment_kind] || row.moment_kind})` : ""}`);
      return sendJson(res, 200, { ok: true, id, moment_kind: kind162, moment_label: kind162 ? MOMENT_LABELS162[kind162] : "" });
    }
    /* Round 162 (Feature 3): attach a guardian email to a play
       posted phone-only — Emil found play 71 (Nicholas's
       "Double") has notify_email EMPTY, so its guardian finds
       nothing in My Plays by email (the lookup matches on
       notify_email_hash / the athlete's email_hash). Sets the
       play's email + hash (the insert's own single expression,
       sha(normIdentity(email)), so spellings can never drift),
       and the athlete row's email_hash ONLY when it's empty —
       an athlete's established email is never overwritten.
       Same email again = a no-op success (nothing written,
       nothing logged — the log stays a record of changes).
       Logged like every other owner action (Round 146). */
    if (p === "/api/owner/guardian-email" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const id = Number(body.id);
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      const email162 = String(body.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email162)) return sendJson(res, 400, { ok: false, message: "That doesn't look like an email address — check it and try again." });
      const hash162 = sha(normIdentity(email162));
      if ((row.notify_email_hash || "") === hash162 && (row.notify_email || "") === email162) return sendJson(res, 200, { ok: true, id, email: email162, unchanged: true });
      db.prepare("UPDATE highlights SET notify_email=?, notify_email_hash=? WHERE id=?").run(email162, hash162, id);
      let athleteLinked162 = false;
      if (row.athlete_id) {
        const ath162 = db.prepare("SELECT athlete_key, email_hash FROM athletes WHERE athlete_key=?").get(row.athlete_id);
        if (ath162 && !(ath162.email_hash || "")) { db.prepare("UPDATE athletes SET email_hash=? WHERE athlete_key=?").run(hash162, row.athlete_id); athleteLinked162 = true; }
      }
      logModeration146(id, "guardian-email", ownerActor152(req), `"${row.title}" guardian email attached (${email162})${athleteLinked162 ? " — athlete record linked" : ""}`);
      return sendJson(res, 200, { ok: true, id, email: email162, athleteLinked: athleteLinked162 });
    }
    /* Round 162: the Moment That Mattered pick (owner only).
       POST { playId } sets the one current pick — APPROVED,
       non-sample plays only, refused in plain words otherwise;
       { playId: null } clears it. GET /api/owner/spotlight-state
       feeds the panel section: the current pick (with who/when)
       plus the picker list — approved, non-sample plays that
       carry a story OR a milestone tag, newest first. */
    if (p === "/api/owner/spotlight" && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const actor162 = ownerActor152(req);
      if (body.playId == null) {
        const prev162 = getSpotlight162();
        setSetting(SPOTLIGHT_KEY162, "");
        if (prev162) logModeration146(prev162.play_id, "spotlight-clear", actor162, "Moment That Mattered spotlight cleared");
        return sendJson(res, 200, { ok: true, spotlight: null });
      }
      const id = Number(body.playId);
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(id);
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (row.is_sample) return sendJson(res, 400, { ok: false, message: "Sample plays can't be the Moment That Mattered." });
      if (row.status !== "approved") return sendJson(res, 400, { ok: false, message: "Only an approved play can be the Moment That Mattered." });
      const pick162 = { play_id: id, set_at: new Date().toISOString(), set_by: actor162 };
      setSetting(SPOTLIGHT_KEY162, JSON.stringify(pick162));
      logModeration146(id, "spotlight-set", actor162, `"${row.title}" set as the Moment That Mattered`);
      return sendJson(res, 200, { ok: true, spotlight: pick162 });
    }
    if (p === "/api/owner/spotlight-state" && req.method === "GET") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const pick162 = getSpotlight162();
      let current162 = null;
      if (pick162) {
        const r = db.prepare("SELECT id, player_name, title, moment_kind, status FROM highlights WHERE id=?").get(pick162.play_id);
        if (r) current162 = { play_id: r.id, player_name: r.player_name || "", title: r.title || "", moment_kind: r.moment_kind || null, moment_label: r.moment_kind ? (MOMENT_LABELS162[r.moment_kind] || "") : "", status: r.status, set_at: pick162.set_at, set_by: pick162.set_by };
      }
      const picker162 = db.prepare("SELECT id, player_name, title, moment_kind, story, story_consent, created_at FROM highlights WHERE status='approved' AND COALESCE(is_sample,0)=0 AND ((story IS NOT NULL AND story<>'') OR moment_kind IS NOT NULL) ORDER BY id DESC").all()
        .map((r) => ({ id: r.id, player_name: r.player_name || "", title: r.title || "", moment_kind: r.moment_kind || null, moment_label: r.moment_kind ? (MOMENT_LABELS162[r.moment_kind] || "") : "", has_story: !!(r.story && r.story.trim()), story_consent: !!r.story_consent, created_at: r.created_at || "" }));
      return sendJson(res, 200, { ok: true, current: current162, picker: picker162 });
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
      if (before && body.status === "approved" && before.status !== "approved") logModeration146(Number(statusMatch[1]), "approve", ownerActor152(req), `"${before.title}" approved${hasSample && body.sample ? " (as a sample play)" : ""}`);
      if (before && body.status === "hidden" && before.status !== "hidden") logModeration146(Number(statusMatch[1]), "reject", ownerActor152(req), `"${before.title}" declined (hidden)`);
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
      const newly = trashPlay146(row, ownerActor152(req), "");
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
      logModeration146(row.id, "restore", ownerActor152(req), `"${row.title}" restored from Trash to ${backTo} (contest entry is not automatic)`);
      return sendJson(res, 200, { ok: true, status: backTo });
    }
    const purgeMatch146 = p.match(/^\/api\/highlights\/(\d+)\/purge$/);
    if (purgeMatch146 && req.method === "POST") {
      if (!ownerAuthorized(req)) return sendJson(res, 403, { ok: false, message: "Owner access required." });
      const row = db.prepare("SELECT * FROM highlights WHERE id=?").get(Number(purgeMatch146[1]));
      if (!row) return sendJson(res, 404, { ok: false, message: "Play not found." });
      if (row.status !== "trashed") return sendJson(res, 400, { ok: false, message: "Only a play in the Trash can be deleted forever — move it to Trash first." });
      permanentDeletePlay146(row.id);
      logModeration146(row.id, "purge", ownerActor152(req), `manual delete-forever from Trash: "${row.title}"`);
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
         with a 304 instead. Range support unchanged.
         Round 192 (2026-11-25): video files go long-cache
         immutable. An upload's filename is unique (timestamp +
         random), and every pipeline stage that changes a play's
         bytes mints a NEW filename (-h264, -enhanced, -stream)
         and repoints the row — the bytes at a video URL never
         change, so a year of immutable caching is safe and a
         repeat visit never re-fetches a clip. Images keep the
         one-day policy: poster-<id>.jpg IS regenerated in place
         (the enhancement stage re-grabs it), so posters must
         stay revalidatable. */
      const upEtag = `"${size.toString(16)}-${Math.floor(upStat.mtimeMs).toString(16)}"`;
      const upLastMod = upStat.mtime.toUTCString();
      const upCacheControl = [".mp4", ".webm", ".mov"].includes(ext) ? "public, max-age=31536000, immutable" : "public, max-age=86400";
      const upCache = { "cache-control": upCacheControl, etag: upEtag, "last-modified": upLastMod };
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
    // Round 166 (2026-11-14): /demo joins them — the standalone
    // showcase team page (public/demo.html), a public pitch link.
    // The page is fully static fictional content: it loads no
    // app.js, calls no API and emits no tracking, so this mapping
    // is its only server footprint; nothing here reads the DB.
    // Round 173 (2026-11-14): /about joins them — the standalone
    // About / Our Story page (public/about.html), a PROTOTYPE
    // for Emil's review: noindex, not linked from the nav,
    // homepage or footer yet. Same isolation posture as /demo:
    // fully static, no app.js, no API, no tracking, no script.
    let filePath = path.join(__dirname, "public", p === "/" ? "index.html" : p === "/terms" ? "terms.html" : p === "/privacy" ? "privacy.html" : p === "/demo" ? "demo.html" : p === "/about" ? "about.html" : p);
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
    /* Round 161 (2026-11-14): the service worker and the web app
       manifest must always revalidate — a cached sw.js would
       strand visitors on a stale worker, and the manifest is
       three lines of JSON. They opt out of the rules below by
       name so a future rule change can't sweep them in. */
    const cacheControl = (p === "/sw.js" || p === "/manifest.webmanifest") ? "no-cache"
      : /[?&]v=/.test(req.url || "") ? "public, max-age=604800"
      : /\.(jpe?g|png|webp|gif|svg|ico|mp4|webm|woff2?)$/.test(staticExt) ? "public, max-age=86400"
      : "no-cache";
    /* Round 189 (2026-11-25): the HH_NO_FEED=1 kill switch. The
       watch feed is client-side, so the flag rides the one
       document every visit loads: when the switch is set, the
       served index.html carries window.HH_NO_FEED189 just
       before app.js, and the client keeps every board tap on
       the classic play-detail path — boards behave exactly as
       they did before the feed. Mirrors HH_NO_ENHANCE /
       HH_NO_WELCOME. */
    /* Round 196 (2026-11-26): the HH_NO_FEEDFILL196=1 kill switch.
       The feed's extra-wide blur fill is client-side, so the flag
       rides the same document: when the switch is set, the served
       index.html carries window.HH_NO_FEEDFILL196 just before
       app.js, and the client never builds a fill element — wide
       clips keep the Round 191 band treatment exactly. Stamped
       BEFORE the Round 189 block below so both flags can ride
       the same page when both switches are set. Mirrors
       HH_NO_FEED / HH_NO_ENHANCE. */
    if (process.env.HH_NO_FEEDFILL196 === "1" && path.basename(filePath) === "index.html") {
      try {
        const fillOffBuf196 = Buffer.from(fs.readFileSync(filePath, "utf8").replace('<script src="app.js', '<script>window.HH_NO_FEEDFILL196=true;</script>\n<script src="app.js'), "utf8");
        res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": fillOffBuf196.length, "cache-control": "no-cache" });
        return res.end(fillOffBuf196);
      } catch { /* fall through to the plain static serve */ }
    }
    if (process.env.HH_NO_FEED === "1" && path.basename(filePath) === "index.html") {
      try {
        const feedOffBuf189 = Buffer.from(fs.readFileSync(filePath, "utf8").replace('<script src="app.js', '<script>window.HH_NO_FEED189=true;</script>\n<script src="app.js'), "utf8");
        res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": feedOffBuf189.length, "cache-control": "no-cache" });
        return res.end(feedOffBuf189);
      } catch { /* fall through to the plain static serve */ }
    }
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

/* Round 226 (2026-11-27, Emil-approved): one-time correction of
   play 78's public Team field. The Nov 26 site audit found it
   reading "Kameron Angelin" — a child's full surname, where the
   site standard is first name + last initial. No owner-side edit
   path for the team field exists (owner actions change status /
   athlete links only), so the correction is a guarded UPDATE:
   the WHERE clause is the whole guard — it fires ONLY when the
   row is id 78 AND the current value is exactly the surname
   form, and no-ops on every later boot and for any other value.
   No other play's data is touched. */
function r226TeamFix78() {
  try {
    const r = db.prepare("UPDATE highlights SET team='Kameron A' WHERE id=78 AND team='Kameron Angelin'").run();
    if (r.changes) console.log("[r226] play 78 team corrected: 'Kameron Angelin' -> 'Kameron A' (Emil-approved surname removal)");
  } catch (e) { console.error("[r226] play 78 team correction failed:", e && e.message); }
}
server.listen(PORT, () => { console.log(`HighlightHype listening on http://localhost:${PORT} (data: ${DATA_DIR})`); r131RunMigration(); r130RunMigration(); r124RunMigration(); r146PurgeExpiredTrash(); r226TeamFix78(); /* Round 224: the recovery scan starts ahead of the backfills below — a play it converts has its stage stamps cleared, so those scans re-run their stages against the healed file within this same boot; it starts a few seconds late for the same reason Round 192 does (the boot migrations and the first requests own the ffmpeg queue first). */ setTimeout(() => { r224Backfill(); }, 2500); /* Round 192: the rendition backfill starts a few seconds late on purpose — the boot migrations and the first requests own the ffmpeg queue first, so a background encode never delays a migration poster or a fresh upload's pipeline. */ setTimeout(() => { r192Backfill(); }, 5000); /* Round 195: the trim/upscale backfill starts on the same delay — the two scans share the ffmpeg serializer, and a play this round trims or upscales gets its rendition regenerated in place, so the end state is the same whichever scan reaches a play first. */ setTimeout(() => { r195Backfill(); }, 5000); /* Round 203: the reframe backfill starts on the same delay, on the same reasoning — the scans share the ffmpeg serializer, and a play this round reframes gets its poster and rendition regenerated in place, so the end state is the same whichever scan reaches a play first. */ setTimeout(() => { r203Backfill(); }, 5000); /* Round 209: the smart-poster backfill starts on the same delay, on the same reasoning — the scans share the ffmpeg serializer, and this stage only ever rewrites the poster file, so the end state is the same whichever scan reaches a play first. */ setTimeout(() => { r209Backfill(); }, 5000); /* Round 227: the poster auto-clean backfill starts last on purpose — the poster backfills above settle first (a re-pick it would otherwise race is exactly the poster this scan then detect+cleans), and its own smart re-pick gate covers the plays those scans leave unstamped. */ setTimeout(() => { r227Backfill(); }, 8000); });
