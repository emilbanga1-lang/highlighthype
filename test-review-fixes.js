// Checks for Emil's 2026-11-04 site-review fixes. Run: node test-review-fixes.js
// 1. Sport pills are dynamic (rendered from the sports present in data).
// 2. Upload form is file-only (no video-link field) and file upload works.
// 3. Modernized upload form keeps every field id/name + the dropzone.
// 4. Hype Frame: pause-overlay scene map hits the right Store targets.
// 5. Store redesign: filterable product grid with real lookbook photos.
// 6. Store v2: full-bleed cinematic film hero + photo nav tiles.
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
  // Stepped form (Emil, 2026-11-04): the old single-page section title
  // "The play" became Step 1 "Your video"; the other two section titles
  // carry over unchanged as Steps 2 and 3.
  for (const label of ["Your video", "The athlete", "Parent/guardian (private)"]) assert(home.includes(label), `form section label present: ${label}`);

  /* ---- 3b. Wizard structure: 3 steps, progress, fields exactly once -- */
  assert((home.match(/class="form-section form-step"/g) || []).length === 3, "upload form has exactly 3 wizard steps");
  for (const n of ["1", "2", "3"]) assert(home.includes(`data-step="${n}"`), `wizard step ${n} present`);
  assert(home.includes('id="uploadProgress"') && home.includes('id="uploadStepLabel"') && home.includes('id="uploadBarFill"'), "wizard progress chrome present (label + bar)");
  assert(home.includes('id="upBack"') && home.includes('id="upNext"'), "wizard Back/Continue buttons present");
  for (const f of FIELDS) assert((home.split(`name="${f}"`).length - 1) === 1, `field name="${f}" appears exactly once in the stepped form`);
  const step2At = home.indexOf('data-step="2"'), step3At = home.indexOf('data-step="3"');
  assert(home.indexOf('name="division"') > step2At && home.indexOf('name="division"') < step3At, "division select lives in Step 2 (The athlete)");
  assert(home.indexOf('id="athletePrompt"') > step2At && home.indexOf('id="athletePrompt"') < step3At, "athlete prompt lives inside Step 2");
  assert(home.indexOf('id="uploadMsg"') > step3At, "upload messages show in Step 3 with the Submit button");
  assert(appJs.includes("function showUploadStep") && appJs.includes("function validUploadStep"), "wizard navigation + per-step validation wired in app.js");
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
  // Store v2 (2026-11-04): Emil asked for Overtime's chrome-free hero,
  // so the native control bar is GONE — tapping the film or the round
  // outline button toggles playback instead (wiring asserted in §6).
  assert(home.includes('id="swagVideo"') && !/id="swagVideo"[^>]*\bcontrols\b/.test(home), "swag film has NO native controls (v2 cinematic hero)");
  const sceneRe = (until, target) => new RegExp(`until:\\s*${until}[\\s\\S]{0,300}target:\\s*"${target}"`);
  assert(sceneRe("2.5", "hype-girls").test(appJs), "scene 0–2.5s (Girls) maps to #hype-girls");
  assert(sceneRe("5\\.0", "hype-boys").test(appJs), "scene 2.5–5s (Boys) maps to #hype-boys");
  assert(sceneRe("7\\.5", "coordinating").test(appJs), "scene 5–7.5s (Hype All Day) maps to #coordinating");
  assert(appJs.includes("Infinity") && appJs.includes('target: "collections"'), "end-card scene maps to #collections");
  assert(home.includes('id="hype-girls"') && home.includes('id="hype-boys"') && home.includes('id="coordinating"') && home.includes('id="collections"'), "all four Hype Frame scroll targets exist in the Store");
  assert(appJs.includes('"pause"') && appJs.includes('"play"'), "card shows on pause and hides on play");
  const storeSection = home.slice(home.indexOf('id="shop"'));
  assert(!storeSection.includes("$"), "no prices anywhere in the Store section");

  /* ---- 5. Store redesign: product grid with real lookbook photos ----
     Emil (2026-11-04): the six stacked illustrated boards became one
     filterable product grid using photos cropped from the Drop 001
     lookbook. The scene targets above keep their names but now drive
     the grid (division filter + highlight), so the old board markup
     assertions were replaced by the grid assertions below. */
  const SLUGS = ["girls-street", "girls-athletics", "girls-essentials", "boys-street", "boys-athletics", "boys-unleashed"];
  assert((home.match(/class="prod-card"/g) || []).length === 6, "product grid has exactly 6 cards (one per collection)");
  for (const slug of SLUGS) {
    assert(home.includes(`data-slug="${slug}"`), `grid card present: ${slug}`);
    for (const kind of ["front", "back", "flat"]) {
      assert(home.includes(`/swag/${slug}-${kind}.jpg`), `card ${slug} references its ${kind} lookbook crop`);
      const r = await fetch(`${base}/swag/${slug}-${kind}.jpg`);
      const buf = await r.arrayBuffer();
      assert(r.status === 200 && buf.byteLength > 5000, `crop serves and is non-trivial: /swag/${slug}-${kind}.jpg (${buf.byteLength} bytes)`);
    }
  }
  assert(!home.includes("/swag-boards/"), "illustrated board SVGs are no longer referenced by the Store");
  assert(!home.includes('class="look-board"'), "old stacked look-board markup is gone");
  assert(home.includes('data-store-div="girls"') && home.includes('data-store-div="boys"'), "Girls/Boys division toggle present");
  for (const chip of ["all", "street", "athletics", "essentials", "unleashed"]) assert(home.includes(`data-store-chip="${chip}"`), `collection filter chip present: ${chip}`);
  assert(home.includes('id="quickView"') && home.includes('id="qvFront"') && home.includes('id="qvBack"') && home.includes('id="qvFlat"'), "quick-view overlay present with front/back/flat images");
  assert((home.match(/data-flip/g) || []).length >= 6, "every card has a front/back flip toggle");
  assert(appJs.includes("applyStoreFilter") && appJs.includes("setStoreDivision") && appJs.includes("openQuickView"), "grid filtering + quick view wired in app.js");
  assert(appJs.includes("goToStoreScene") && appJs.includes("flashStoreCards"), "film scene button drives the grid (filter + highlight)");
  assert(home.includes('class="hf-steps-strip"'), "Hype Frame section compressed into a slim steps strip under the grid");

  /* ---- 6. Store v2: full-bleed cinematic hero + photo nav tiles ----
     Emil (2026-11-04, with Overtime shop screenshots): the film leads
     the Store as an edge-to-edge autoplay hero — bold italic title,
     underlined Shop Girls / Shop Boys link-buttons, one round outline
     pause/play button, no native controls — and two full-width photo
     tiles cropped from the lookbook's sunset banner act as navigation
     (whole tile tappable -> division filter + scroll to grid). */
  const filmTag = (home.match(/<video id="swagVideo"[^>]*>/) || [""])[0];
  assert(filmTag.includes("autoplay") && filmTag.includes("muted") && filmTag.includes("loop") && filmTag.includes("playsinline"), "hero film autoplays muted, loops, plays inline");
  assert(home.includes('class="swag-film swag-film-hero"'), "film block carries the full-bleed hero treatment");
  const css = await text("/styles.css");
  assert(css.includes(".swag-film-hero") && css.includes("100vw"), "styles.css bleeds the hero edge-to-edge (100vw)");
  assert(css.includes(".film-toggle") && css.includes(".store-tile"), "styles.css carries the round toggle button + nav tile rules");
  assert(home.includes('data-hero-shop="girls"') && home.includes('data-hero-shop="boys"'), "hero overlay has Shop Girls / Shop Boys link-buttons");
  assert(home.includes("Shop Girls") && home.includes("Shop Boys"), "hero shop links are labelled Shop Girls / Shop Boys");
  assert(home.includes('id="swagPlayBtn"') && home.includes('class="film-toggle"'), "round outline pause/play button present in the hero");
  assert(appJs.includes("swagPlayBtn"), "pause/play button wired in app.js");
  assert(home.includes('id="swagShopCard"') && home.includes('id="sscBtn"'), "pause-to-shop scene card still present under the hero");
  for (const side of ["girls", "boys"]) {
    assert(home.includes(`data-store-tile="${side}"`) && home.includes(`/swag/tile-${side}.jpg`), `nav tile present with lookbook crop: ${side}`);
    const r = await fetch(`${base}/swag/tile-${side}.jpg`);
    const buf = await r.arrayBuffer();
    assert(r.status === 200 && buf.byteLength > 5000, `tile crop serves and is non-trivial: /swag/tile-${side}.jpg (${buf.byteLength} bytes)`);
  }
  assert(appJs.includes("[data-hero-shop]") && appJs.includes("[data-store-tile]") && appJs.includes("goToStoreScene"), "hero links + tiles wired to the division filter + grid scroll in app.js");

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
