// Checks for Emil's 2026-11-04 site-review fixes. Run: node test-review-fixes.js
// 1. Sport pills are dynamic (rendered from the sports present in data).
// 2. Upload form is file-only (no video-link field) and file upload works.
// 3. Modernized upload form keeps every field id/name + the dropzone.
// 4. Hype Frame: pause-overlay scene map hits the right Store targets.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-review-"));
const PORT = 3457;
const base = `http://localhost:${PORT}`;
const root = new URL(".", import.meta.url).pathname;
const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp }, stdio: "pipe" });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
const text = async (p) => { const r = await fetch(base + p); return r.text(); };

try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const home = await text("/");
  const appJs = await text("/app.js");

  /* ---- 3. Form structure: every field survives, dropzone present ---- */
  const FIELDS = ["file", "title", "sport", "division", "playType", "playerName", "team", "jersey", "story", "notifyEmail", "guardianPhone", "textConsent", "athleteChoice", "athleteKey"];
  for (const f of FIELDS) assert(home.includes(`name="${f}"`), `upload form keeps field name="${f}"`);
  assert(home.includes('id="dropzone"') && home.includes('id="fileInput"') && home.includes('id="dzFile"'), "dropzone markup present (dropzone/fileInput/dzFile)");
  assert(home.includes('accept="video/*,image/*"'), "file input keeps the same accept types");
  for (const label of ["The play", "The athlete", "Parent/guardian (private)"]) assert(home.includes(label), `form section label present: ${label}`);
  assert(home.includes("Text me about this play — approval updates and, if it wins Hype of the Month, the claim message. Message/data rates may apply. We never text the athlete."), "text opt-in copy is EXACTLY the current copy");
  assert(!/name="textConsent"[^>]*checked/.test(home), "text opt-in checkbox is unchecked by default");
  assert(home.includes('id="athletePrompt"'), "athlete disambiguation prompt container preserved");
  assert(appJs.includes('id="athletePrompt"') || appJs.includes('"#athletePrompt"') || appJs.includes("#athletePrompt"), "athlete prompt wiring preserved in app.js");

  /* ---- 2. File-only upload ---- */
  assert(!home.includes('name="videoUrl"'), "upload form has NO video-link field");
  assert(!appJs.includes("videoUrl"), "client submit path has no videoUrl handling");
  const noMedia = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "No media play", sport: "baseball" }) });
  assert(noMedia.status === 400, "server still refuses an upload with neither file nor link (400)");

  // File upload end-to-end via multipart (tiny PNG), then approve + verify.
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
  const fd = new FormData();
  fd.append("title", "Review Fixes File Play");
  fd.append("sport", "baseball");
  fd.append("division", "boys");
  fd.append("playerName", "Nick");
  fd.append("file", new Blob([png], { type: "image/png" }), "play.png");
  const up = await j("/api/highlights", { method: "POST", body: fd });
  assert(up.status === 201 && up.body.status === "pending", "file upload succeeds and starts pending");
  const claim = await j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token; assert(tok, "owner claim returns token");
  const appr = await j(`/api/highlights/${up.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(appr.body.status === "approved", "owner approves the uploaded file play");
  const pub = await j("/api/highlights?division=all");
  const mine = pub.body.highlights.find((h) => h.id === up.body.id);
  assert(mine && mine.media_kind === "file", "approved file play is public with media_kind=file");

  /* ---- 1. Dynamic sport pills ---- */
  assert(appJs.includes("function sportsInData"), "app.js derives pill sports from data (sportsInData)");
  assert(appJs.includes('data-sport="all"') && appJs.includes("All sports"), "an 'All sports' pill is always rendered");
  assert(/renderPills\(\$\("#monthSportPills"\), monthSport, monthSports/.test(appJs), "month pills render from contest-entry sports");
  assert(/renderPills\(\$\("#allSportPills"\), allSport, allSports/.test(appJs), "All Hypes pills render from all-play sports");
  assert(appJs.includes('monthSport = "all"') && appJs.includes('allSport = "all"'), "stale sport selection falls back to All");
  // With only a baseball play approved, baseball is the ONLY sport in the
  // data the pills are derived from — so Baseball is the only sport pill.
  const sportsPresent = [...new Set(pub.body.highlights.map((h) => h.sport))];
  assert(sportsPresent.length === 1 && sportsPresent[0] === "baseball", "test data has exactly one sport (baseball) for the pills to render");

  /* ---- 4. Film shop-the-look scene map ---- */
  // Renamed 2026-11-04: Emil moved the "Hype Frame" name to the
  // freeze-frame studio, so the film hint/kicker use the plain wording.
  // (The studio-side assertions live in test-hype-frame.js.)
  assert(home.includes("⏸ Pause to shop the look") && !home.includes("Hype Frame — pause to shop the look"), "film hint reads 'Pause to shop the look' (no Hype Frame name on the film)");
  assert(home.includes('id="swagShopCard"') && home.includes('id="sscBtn"') && home.includes('<p class="ssc-kicker">In this scene</p>') && !home.includes("Hype Frame · In this scene"), "pause card present with plain 'In this scene' kicker");
  assert(home.includes('id="swagVideo"') && /id="swagVideo"[^>]*controls/.test(home), "swag film has native controls so it can be paused");
  const sceneRe = (until, target) => new RegExp(`until:\\s*${until}[\\s\\S]{0,300}target:\\s*"${target}"`);
  assert(sceneRe("2.5", "hype-girls").test(appJs), "scene 0–2.5s (Girls) maps to #hype-girls");
  assert(sceneRe("5\\.0", "hype-boys").test(appJs), "scene 2.5–5s (Boys) maps to #hype-boys");
  assert(sceneRe("7\\.5", "coordinating").test(appJs), "scene 5–7.5s (Hype All Day) maps to #coordinating");
  assert(appJs.includes("Infinity") && appJs.includes('target: "collections"'), "end-card scene maps to #collections");
  assert(home.includes('id="hype-girls"') && home.includes('id="hype-boys"') && home.includes('id="coordinating"') && home.includes('id="collections"'), "all four Hype Frame scroll targets exist in the Store");
  assert(appJs.includes('"pause"') && appJs.includes('"play"'), "card shows on pause and hides on play");
  const storeSection = home.slice(home.indexOf('id="shop"'));
  assert(!storeSection.includes("$"), "no prices anywhere in the Store section");

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
