// Checks for Emil's 2026-11-04 site-review fixes. Run: node test-review-fixes.js
// 1. Sport filters are dynamic (rendered from the sports present in
//    data). Rounds 1-4: pill rows. Round 5: native dropdown selects.
// 2. Upload form is file-only (no video-link field) and file upload works.
// 3. Modernized upload form keeps every field id/name + the dropzone.
// 4. Hype Frame: pause-overlay scene map hits the right Store targets.
// 5. Store: product blocks with real lookbook photos (one per division).
// 6. Store film hero: full-bleed cinematic, music, no round button.
// 8. Store v4/v6: dark store, film-first hero, Boys-first recut.
// 9. Tonight batch (2026-11-04): transparent logo, proof panel removed,
//    autoplay plays, native share + deep links, recut hero, focus mode.
// 10. Hardening follow-up (2026-11-04): backup endpoints, headers, log
//     redaction, upload guards, API allowlist, focus-exit + share fixes.
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import vm from "node:vm";
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
  // Quick Upload (Emil, 2026-11-04 night): the wizard's three section
  // titles are gone with the steps; the quick questions carry the form.
  for (const label of ["Athlete's first name", "Boys or Girls", "What happened? (optional)"]) assert(home.includes(label), `quick question present: ${label}`);

  /* ---- 3b. Quick Upload: ONE screen (Emil, 2026-11-04 night) -------
     The 3-step wizard is replaced by a single quick form: clip picker
     first (phone-first copy, playing preview once picked), a few quick
     questions (name, Boys/Girls toggle, sport dropdown, optional title),
     everything else in a collapsed "Add more (optional)" section — all
     with the SAME field names/payload as the wizard had. */
  for (const f of FIELDS) assert((home.split(`name="${f}"`).length - 1) === 1, `field name="${f}" appears exactly once in the quick form`);
  assert(!home.includes("form-step") && !home.includes('id="uploadProgress"') && !home.includes('id="upNext"') && !home.includes('id="upBack"') && !appJs.includes("showUploadStep") && !appJs.includes("validUploadStep"), "the 3-step wizard is gone (steps, progress chrome, nav buttons, wizard JS)");
  assert(home.includes("Tap to pick a clip from your camera roll"), "dropzone leads with the phone-first camera-roll copy (drag & drop still offered)");
  assert(!home.includes("MOV") && !home.includes("most reliably"), "the MP4/.MOV warning text is removed entirely");
  assert(home.includes('id="dzPreview"') && home.includes('id="dzVideo"') && appJs.includes("Your clip is in") && appJs.includes("createObjectURL"), "a picked clip previews playing in the dropzone with a '✓ Your clip is in' state");
  assert(home.includes('data-div-pick="boys"') && home.includes('data-div-pick="girls"') && home.includes('name="division" value="boys"') && appJs.includes("setDivPick"), "Boys/Girls big toggle writes the division field (default Boys)");
  assert(!home.includes("data-sport-pick") && !appJs.includes("data-sport-pick") && home.includes('<select name="sport" id="sportSelect"') && appJs.includes("setSportPick"), "sport is a native dropdown in the upload form (round 5b: the 12 one-tap pills are gone; the <select name=\"sport\"> IS the sport field)");
  assert(home.includes("What happened? (optional)") && appJs.includes("'s highlight`"), "the title is one optional 'What happened?' line; blank auto-fills as <Name>'s highlight at submit");
  const moreAt = home.indexOf("Add more (optional)");
  assert(moreAt > -1 && home.includes('class="quick-more"'), "'Add more (optional)' collapsed section present");
  for (const f of ["playType", "story", "jersey", "team"]) assert(home.indexOf(`name="${f}"`) > moreAt, `optional field lives inside Add more: ${f}`);
  // Round 6 (2026-11-05): the guardian-contact block MOVED OUT of
  // "Add more" into the main form — youth rerun v3's #1 finding was
  // that the contact deciding featuring sat hidden in a section
  // labelled optional. Full location/explainer coverage is in §21.
  for (const f of ["notifyEmail", "guardianPhone", "textConsent"]) assert(home.indexOf(`name="${f}"`) > -1 && home.indexOf(`name="${f}"`) < moreAt, `guardian field lives in the MAIN form, before Add more: ${f}`);
  assert(home.includes("Post my hype"), "submit button reads 'Post my hype'");
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

  /* ---- 1. Dynamic sport filters (Round 5: dropdown selects) ---- */
  assert(appJs.includes("function sportsInData"), "app.js derives filter sports from data (sportsInData)");
  assert(appJs.includes('<option value="all"') && appJs.includes("All sports"), "an 'All sports' option is always rendered");
  assert(/renderSportSelect\(\$\("#monthSportSelect"\), monthSport, monthSports/.test(appJs), "month dropdown renders from contest-entry sports");
  assert(/renderSportSelect\(\$\("#allSportSelect"\), allSport, allSports/.test(appJs), "All Hypes dropdown renders from all-play sports");
  assert(appJs.includes('monthSport = "all"') && appJs.includes('allSport = "all"'), "stale sport selection falls back to All");
  assert(home.includes('id="monthSportSelect"') && home.includes('id="allSportSelect"') && !home.includes('id="monthSportPills"') && !home.includes('id="allSportPills"'), "both board views carry a sport <select>; the pill containers are gone");
  assert(!appJs.includes("renderPills") && !appJs.includes("monthSportPills") && !appJs.includes("allSportPills"), "no pill renderer or pill container references remain in app.js");
  // With only a baseball play approved, baseball is the ONLY sport in the
  // data the options are derived from — so Baseball is the only sport option.
  const sportsPresent = [...new Set(pub.body.highlights.map((h) => h.sport))];
  assert(sportsPresent.length === 1 && sportsPresent[0] === "baseball", "test data has exactly one sport (baseball) for the dropdowns to render");

  /* ---- 4. Film shop-the-look scene map ---- */
  // Renamed 2026-11-04: Emil moved the "Hype Frame" name to the
  // freeze-frame studio, so the film's pause card uses plain wording.
  // Nov 5 (2026-11-05): the floating hint pill itself is gone — the
  // docked pause button + the pause card carry the flow now.
  // (The studio-side assertions live in test-hype-frame.js.)
  assert(!home.includes('id="swagHint"') && home.includes('id="swagPauseBtn"'), "no floating hint on the film; the docked pause button is the pause affordance (no Hype Frame name on the film)");
  assert(home.includes('id="swagShopCard"') && home.includes('id="sscBtn"') && home.includes('<p class="ssc-kicker">In this scene</p>') && !home.includes("Hype Frame · In this scene"), "pause card present with plain 'In this scene' kicker");
  // Store v2 (2026-11-04): Emil asked for Overtime's chrome-free hero,
  // so the native control bar is GONE — tapping the film or the round
  // outline button toggles playback instead (wiring asserted in §6).
  assert(home.includes('id="swagVideo"') && !/id="swagVideo"[^>]*\bcontrols\b/.test(home), "swag film has NO native controls (v2 cinematic hero)");
  const sceneRe = (until, target) => new RegExp(`until:\\s*${until}[\\s\\S]{0,300}target:\\s*"${target}"`);
  // Store v4 (2026-11-04): the film was rebuilt from 10s clips of
  // youth wearing the actual Drop 001 designs, so the scene map is
  // collection scenes on the measured boundaries — the old title-card
  // and Hype All Day scenes are gone (asserted in §8). Film v5 cut the
  // Boys Unleashed clip in as the fifth scene.
  // Store v6 (2026-11-04): Emil asked for Boys first + a faster cut —
  // the same five clips recut Boys-first at ~1.3x, 7.0s per scene, so
  // the boundaries are 7/14/21/28s and Girls Essentials closes the film.
  // Round 3 (2026-11-05): the film is recut to 4.0s scenes — the
  // pause-to-shop boundaries move to the 4s grid with it.
  assert(sceneRe("4", "boys-street").test(appJs), "scene 0–4s (Boys Street clip) maps to boys-street");
  assert(sceneRe("8", "boys-athletics").test(appJs), "scene 4–8s (Boys Athletics clip) maps to boys-athletics");
  assert(sceneRe("12", "boys-unleashed").test(appJs), "scene 8–12s (Boys Unleashed clip) maps to boys-unleashed");
  assert(sceneRe("16", "girls-street").test(appJs), "scene 12–16s (Girls Street clip) maps to girls-street");
  assert(sceneRe("Infinity", "girls-essentials").test(appJs), "scene 16s–end (Girls Essentials clip) maps to girls-essentials");
  assert(appJs.includes("The Boys Hype Unleashed hoodie"), "Unleashed scene card carries the collection title");
  assert(home.includes('<h4 id="sscTitle">The Boys Hype Street hoodie</h4>'), "pause card placeholder title matches the new first scene (Boys Street)");
  assert(home.includes('data-store-block="boys"') && home.includes('data-store-block="girls"') && home.includes('id="collections"') && home.includes('id="storeFocusBar"'), "division blocks + grid anchor + focus bar exist in the Store");
  assert(appJs.includes('"pause"') && appJs.includes('"play"'), "card shows on pause and hides on play");
  const storeSection = home.slice(home.indexOf('id="shop"'));
  // Prices landed with the tonight additions (Emil, 2026-11-04, BL101
  // pattern): $69.99 + the youth size run, INSIDE the Store only.
  assert((storeSection.match(/\$69\.99/g) || []).length >= 7, "Drop 001 price $69.99 shows on all six cards + quick view");
  assert(storeSection.includes("YXXS · YXS · YS · YM · YL · YXL") && storeSection.includes("Youth sizes"), "youth size run shown in the Store (YXXS–YXL)");
  assert(home.includes('id="qvSizes"') && (home.match(/data-qv-size=/g) || []).length === 6, "quick view has the six-size tappable selector");
  assert(appJs.includes("qv-size"), "quick-view size selection wired (state only — no cart/checkout)");
  assert(!home.slice(0, home.indexOf('id="shop"')).includes("$69.99"), "no prices outside the Store (homepage + boards stay price-free)");
  assert(storeSection.includes("Drop 001 — ordering opens soon"), "store status line: 'Drop 001 — ordering opens soon' (no preview-only phrasing)");

  /* ---- 5. Store: product blocks with real lookbook photos ----
     Emil (2026-11-04): the six stacked illustrated boards became a
     product grid using photos cropped from the Drop 001 lookbook.
     Tonight batch (2026-11-04): the filter toggle + chips are gone —
     the grid is now two always-visible division blocks (banner header
     + 3 cards each) with a focus mode, so the old filter assertions
     were replaced by the block assertions below.
     Store v8 (2026-11-04): cards are garment-only again — the flat
     board illustrations at their native ratio, Overtime-style lean
     body (name + price + size run) — and the colorways live in the
     quick view's swipeable gallery (§11).
     Round 2 (2026-11-05, Emil's option A) SUPERSEDES v8 on card
     imagery: the card's primary image is the design's real FRONT
     lookbook photo and the flip peek its real BACK photo; the boards
     are no longer referenced by the store markup (the files remain
     on disk). The colorway illustration frames still exist — inside
     the quick view, AFTER the two real photo frames (§11/§12). */
  const SLUGS = ["girls-street", "girls-athletics", "girls-essentials", "boys-street", "boys-athletics", "boys-unleashed"];
  assert((home.match(/class="prod-card"/g) || []).length === 6, "product grid has exactly 6 cards (one per collection)");
  for (const slug of SLUGS) {
    assert(home.includes(`data-slug="${slug}"`), `grid card present: ${slug}`);
    assert(home.includes(`/swag/${slug}-front.jpg`), `card ${slug} shows the real FRONT lookbook photo as its primary image`);
    assert(home.includes(`/swag/${slug}-back.jpg`), `card ${slug} flip peek shows the real BACK lookbook photo`);
    for (const kind of ["front", "back"]) {
      const r = await fetch(`${base}/swag/${slug}-${kind}.jpg`);
      const buf = await r.arrayBuffer();
      assert(r.status === 200 && buf.byteLength > 5000, `real ${kind} photo serves and is non-trivial: /swag/${slug}-${kind}.jpg (${buf.byteLength} bytes)`);
    }
  }
  assert(!home.includes("/swag-boards/"), "Round 2: cards no longer reference the flat board illustrations");
  assert(home.includes("prod-photo"), "card photos carry the photo treatment class (posed photos anchor high in the card frame)");
  assert(!home.includes('class="look-board"'), "old stacked look-board markup is gone");
  assert(!home.includes("data-store-div=") && !home.includes("data-store-chip=") && !home.includes('class="store-controls"'), "division toggle + collection chips are gone (blocks replace filters)");
  assert(home.includes('data-store-focus="boys"') && home.includes('data-store-focus="girls"'), "each block banner carries its focus button");
  assert(!(home.match(/<article class="prod-card"[^>]*>/g) || []).some((t) => t.includes("hidden")), "no product card starts hidden on the landing (all six show)");
  assert(home.includes('id="quickView"') && home.includes('id="qvGallery"') && home.includes('id="qvSwatches"') && home.includes('id="qvColorName"'), "quick-view overlay present with the swipeable colorway gallery");
  assert((home.match(/data-flip/g) || []).length >= 6, "every card has a front/back flip toggle");
  assert(appJs.includes("setStoreFocus") && !appJs.includes("applyStoreFilter") && !appJs.includes("setStoreDivision") && appJs.includes("openQuickView"), "focus mode + quick view wired in app.js (old filter functions gone)");
  assert(appJs.includes("goToStoreScene") && appJs.includes("flashStoreCards"), "film scene button focuses the card's division and highlights the card");
  // Hype Frame in the Store: the v3 creative section (layered prints,
  // manifesto headline, steps line, CTA) was ported into the restored
  // v2 store and re-skinned dark — asserted in §8 below.

  /* ---- 6. Store film hero: full-bleed cinematic, silent, docked pause ----
     Emil (2026-11-04, with Overtime shop screenshots): the film leads
     the Store as an edge-to-edge autoplay hero — bold italic title,
     underlined Shop Girls / Shop Boys link-buttons, no native controls.
     Tonight batch: the round pause/play button was REMOVED (tapping
     the film pauses for pause-to-shop) and the photo nav tiles became
     the division blocks' banner headers (§5/§8).
     Nov 5 (2026-11-05): the film is SILENT (music stripped, probed in
     §8), two scenes are back views, the floating hint pill is gone,
     and a real pause/play button is docked in the film's corner. */
  const filmTag = (home.match(/<video id="swagVideo"[^>]*>/) || [""])[0];
  assert(filmTag.includes("autoplay") && filmTag.includes("muted") && filmTag.includes("loop") && filmTag.includes("playsinline"), "hero film autoplays muted, loops, plays inline");
  assert(home.includes('class="swag-film swag-film-hero"'), "film block carries the full-bleed hero treatment");
  const css = await text("/styles.css");
  assert(css.includes(".swag-film-hero") && css.includes("100vw"), "styles.css bleeds the hero edge-to-edge (100vw)");
  assert(!css.includes(".film-toggle") && !css.includes(".store-tile") && !css.includes(".store-controls"), "styles.css: round toggle, nav tile and filter-control rules are gone");
  assert(css.includes(".store-banner") && css.includes('body[data-store-focus="boys"]') && css.includes('body[data-store-focus="girls"]'), "styles.css carries the banner + focus-mode rules");
  assert(home.includes('data-hero-shop="girls"') && home.includes('data-hero-shop="boys"'), "hero overlay has Shop Girls / Shop Boys link-buttons");
  assert(home.includes("Shop Girls") && home.includes("Shop Boys"), "hero shop links are labelled Shop Girls / Shop Boys");
  assert(!home.includes('id="swagPlayBtn"') && !appJs.includes("swagPlayBtn"), "round outline pause/play button removed from markup and JS");
  assert(appJs.includes("sv.muted = true") && !appJs.includes("sv.muted = false"), "the film is silent (Nov 5): entering the Store keeps it muted — the unmute-on-gesture logic is gone");
  assert(home.includes('id="swagShopCard"') && home.includes('id="sscBtn"'), "pause-to-shop scene card still present under the hero");
  for (const side of ["girls", "boys"]) {
    assert(home.includes(`data-store-block="${side}"`) && home.includes(`/swag/tile-${side}.jpg`), `division block banner present with its photo: ${side}`);
    const r = await fetch(`${base}/swag/tile-${side}.jpg`);
    const buf = await r.arrayBuffer();
    assert(r.status === 200 && buf.byteLength > 5000, `banner photo serves and is non-trivial: /swag/tile-${side}.jpg (${buf.byteLength} bytes)`);
  }
  assert(appJs.includes("[data-hero-shop]") && appJs.includes("[data-store-focus]") && appJs.includes("goToStoreScene"), "hero links + banner buttons wired to focus mode in app.js");

  /* ---- 8. Store v4/v6: dark store, film-first hero, Boys-first recut ----
     Emil (2026-11-04 evening): the v3 light re-skin was rejected
     ("looked better before"), so the dark v2 store is restored and:
     (1) the film leads the page, bigger; (2) the film itself is new —
     five clips of youth wearing the actual Drop 001 designs (the
     fifth, Boys Unleashed, was cut in by film v5, 2026-11-04);
     (3) the Hype Frame creative survives, re-skinned for the dark
     store. (The v3 §7 light-skin assertions were replaced by these.)
     Store v6 (later that night): Emil asked for the film at the very
     top of the Store with the header floating over it like the
     homepage, Boys first + Boys as the default division, and a faster
     Boys-first recut of the film (~35s). */
  assert(home.includes('class="shop"') && !home.includes("store-light"), "dark v2 store restored (no .store-light scope class)");
  assert(!css.includes(".store-light") && !css.includes("#f4f1ea"), "no light-canvas rules remain in styles.css");
  const shopIdx = home.indexOf('id="shop"'), heroIdx = home.indexOf("swag-film-hero"), headIdx = home.indexOf("shop-head");
  assert(heroIdx > shopIdx && heroIdx < headIdx, "film hero is the first element of the Store (before the intro copy)");
  const boysBlockIdx = home.indexOf('data-store-block="boys"'), girlsBlockIdx = home.indexOf('data-store-block="girls"'), creativeIdx = home.indexOf('class="hf-creative"');
  assert(headIdx < boysBlockIdx && boysBlockIdx < girlsBlockIdx && girlsBlockIdx < creativeIdx, "landing order: film → intro → Boys block → Girls block → Hype Frame creative");
  assert(css.includes("aspect-ratio:16/9;max-height:92vh"), "desktop hero runs 16/9 with a generous max-height");
  assert(css.includes(".swag-film-hero{aspect-ratio:auto;height:82vh"), "mobile hero is ~82vh tall (taller than v2's 4/5 crop)");
  const filmRes = await fetch(`${base}/swag-film.mp4`);
  const filmBuf = await filmRes.arrayBuffer();
  assert(filmRes.status === 200 && filmBuf.byteLength > 5000000 && filmBuf.byteLength < 20000000, `the five-clip film serves and is upload-sized (${filmBuf.byteLength} bytes)`);
  const filmFile = path.join(tmp, "film-probe.mp4");
  fs.writeFileSync(filmFile, Buffer.from(filmBuf));
  const filmDur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", filmFile]).toString().trim());
  assert(filmDur > 19 && filmDur < 21, `the film runs ~20s after the Round 3 recut (${filmDur}s — the same five scenes at 4.0s each; Emil: the 7s scenes felt too long)`);
  const filmStreams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filmFile]).toString();
  assert(filmStreams.includes("video") && !filmStreams.includes("audio"), "the film is SILENT (Nov 5): no audio stream at all — the music bed is stripped");
  assert((home.match(/poster="\/swag-poster-v6\.jpg"/g) || []).length === 2, "both film tags (store hero + homepage teaser) use the v6 poster — a Boys Street frame of the v7 widescreen film");
  /* Scene table integrity: exactly the five new scenes, on the
     assembled film's measured boundaries, and none of the old film's
     scenes (title card / Hype All Day / division & end cards) remain. */
  const scenesBlock = appJs.slice(appJs.indexOf("FILM_SCENES"), appJs.indexOf("];", appJs.indexOf("FILM_SCENES")));
  assert((scenesBlock.match(/until:/g) || []).length === 5, "scene table has exactly 5 scenes");
  assert(!scenesBlock.includes("Hype All Day") && !scenesBlock.includes("hype-girls") && !scenesBlock.includes("hype-boys") && !scenesBlock.includes("coordinating") && !scenesBlock.includes("collections"), "no old-film scene targets remain in the scene table");
  assert(!appJs.includes("The Hype All Day hoodie") && !appJs.includes("Drop 001 — the full drop"), "old title-card / statement-hoodie scene copy is gone from app.js");
  assert(appJs.includes('data-slug="${target}"') || appJs.includes("data-slug="), "scene button resolves its target card by slug (goToStoreScene)");
  /* Hype Frame creative, dark skin: layered prints, manifesto
     headline, one numbered steps line, CTA to the plays. */
  assert(home.includes('class="hf-creative"') && !home.includes("hypeframe-banner") && !home.includes("hf-steps-strip"), "Hype Frame creative section replaces the slim banner");
  assert(home.includes('class="hfc-print hfc-print-moment"') && home.includes('class="hfc-print hfc-print-hoodie"'), "creative layers a moment print over a hoodie print");
  assert(home.includes('class="hfc-printbox"') && home.includes('class="hfc-garment"'), "hoodie print reuses the studio garment mock with a composed print in its print area");
  assert((home.split("/swag/hfc-action.jpg").length - 1) === 2, "the creative's sports-action still (from the hero film) appears on BOTH figures — moment print and hoodie print");
  const hfcRes = await fetch(`${base}/swag/hfc-action.jpg`);
  const hfcBuf = await hfcRes.arrayBuffer();
  assert(hfcRes.status === 200 && hfcBuf.byteLength > 5000, `action still serves and is non-trivial: /swag/hfc-action.jpg (${hfcBuf.byteLength} bytes)`);
  assert(home.includes("Your moment.") && home.includes("Your hype.") && home.includes("Turn your highlight") && css.includes(".hfc-title"), "manifesto line stays on the page (hero) and the creative headline is the poster tagline");
  assert(css.includes(".hf-creative{display:grid") && css.includes("border-top:1px solid var(--line)"), "creative is styled for the dark store (v2 palette, unscoped by .store-light)");
  assert(home.includes("Freeze a frame from your own highlight video — and wear it."), "creative subline: freeze a frame from your own highlight video — and wear it");
  for (const step of ["Video", "Wear It", "Upload your highlight", "Choose your frame", "Printed on your gear"]) assert(home.includes(step), `creative VIDEO / FRAME / WEAR IT beat includes: ${step}`);
  assert(home.includes('class="hfc-cta"') && home.includes("Create a Hype Frame"), "creative CTA: 'Create a Hype Frame'");
  const hfCreative = home.slice(home.indexOf('class="hf-creative"'), home.indexOf('id="quickView"'));
  assert(!hfCreative.includes("$"), "Hype Frame creative stays price-free (prices live on the product cards only)");
  assert(hfCreative.includes('href="#deck"') && hfCreative.includes('data-tablink="plays"'), "creative CTA takes the user to the plays, like the old banner button");
  assert(hfCreative.includes("parent or guardian confirms by email before anything is printed"), "creative keeps the guardian-approval framing (no payment/checkout language)");

  /* ---- Store v6: film at the very top under the floating nav,
     Boys first + Boys default (Emil, 2026-11-04 night) ---- */
  assert(css.includes("body.store-open .nav{position:absolute;top:0;background:transparent"), "in the Store the nav floats over the film, homepage-style (logo on the video)");
  assert(!css.includes("body.store-open .nav{position:relative"), "the old solid in-flow store nav bar is gone");
  assert(css.includes("body.store-open .shop{padding-top:0;border-top:0}"), "Store view starts at the very top — no padding or border above the film");
  const barIdx = home.indexOf("store-bar");
  assert(barIdx > heroIdx && barIdx < headIdx, "store bar (Back + breadcrumb) sits below the film, above the intro copy");
  assert(css.includes(".swag-film-hero .swag-film-badge{top:82px") && !home.includes('id="swagHint"') && !css.includes(".swag-film-hint"), "film badge drops below the floating nav line; the floating hint pill is fully removed (Nov 5)");
  assert(home.includes('id="swagPauseBtn"') && css.includes(".swag-pause-btn{position:absolute;right:16px;bottom:16px"), "a real pause/play button is docked in the film's bottom-right corner (Nov 5)");
  assert(css.includes("body:not([data-store-focus]) .store-block .prod-grid{display:none"), "doors landing (Nov 5): division products stay collapsed until a door opens the division");
  assert((home.match(/class="prod-colors"/g) || []).length === 6 && (home.match(/class="prod-dot"/g) || []).length === 24, "every card shows its colorway dots under the size run (6 cards x 4 colorways)");
  assert(home.includes('id="qvSides"') && home.includes('data-qv-side="0"') && home.includes('data-qv-side="1"') && appJs.includes("qv-side-btn"), "quick view has explicit FRONT / BACK buttons (colors + sides reachable without swiping)");
  assert(appJs.includes("const storeState = { focus: null }"), "store starts unfocused (full landing: film, Boys, Girls, Hype Frame)");
  assert(home.indexOf('data-hero-shop="boys"') < home.indexOf('data-hero-shop="girls"'), "hero overlay links: Shop Boys before Shop Girls");
  assert(home.indexOf('data-store-focus="boys"') < home.indexOf('data-store-focus="girls"'), "banner focus buttons: Boys before Girls");
  assert(home.indexOf('data-store-target="hype-boys"') < home.indexOf('data-store-target="hype-girls"'), "homepage store card links: Hype Boys before Hype Girls");
  const cardTag = (slug) => (home.match(new RegExp(`<article class="prod-card"[^>]*data-slug="${slug}"[^>]*>`)) || [""])[0];
  for (const slug of SLUGS) assert(cardTag(slug) !== "" && !cardTag(slug).includes("hidden"), `initial HTML shows the card: ${slug}`);

  /* ---- 9. Tonight batch: logo, hero, proof removal, share, autoplay --
     Emil (2026-11-04 night): (1) the logo's black JPEG box showed on
     bright film frames — it is now a transparent PNG everywhere it
     sits over video; (2) the hero's logo ending is cut and a golf
     scene closes the film instead; (12) "What's on the line" is
     removed, its two useful lines folded into How it works;
     (17) Share uses the native sheet + deep links that land on the
     play from any view; (9) board videos autoplay. */
  assert(home.includes('href="/logo-transparent.png"'), "logo preload points at the transparent PNG");
  assert((home.split('src="/logo-transparent.png"').length - 1) === 2, "header + footer logos use the transparent PNG");
  const logoRes = await fetch(`${base}/logo-transparent.png`);
  const logoBuf = Buffer.from(await logoRes.arrayBuffer());
  assert(logoRes.status === 200 && logoBuf.subarray(1, 4).toString() === "PNG" && logoBuf.byteLength > 5000, `transparent logo serves as a real PNG (${logoBuf.byteLength} bytes)`);
  assert(!css.includes("mix-blend-mode:screen"), "the screen-blend workaround is gone (real transparency now)");
  assert(!home.includes('data-panel-btn="proof"') && !home.includes('id="proof"') && !appJs.includes("proof") && !css.includes(".proof"), "What's on the line is gone: menu button, panel, JS and CSS");
  const howPanel = home.slice(home.indexOf('data-panel="how"'), home.indexOf('id="owner"'));
  assert(howPanel.includes("What's on the line") && howPanel.includes("parent or guardian") && howPanel.includes("featured on the homepage") && howPanel.includes("shoutout on HighlightHype socials"), "How it works carries the folded lines (contest + bragging-rights prize + guardian contact)");
  assert(!home.includes("free piece") && !home.includes("claims the Drop 001 piece"), "no swag/merch prize promised anywhere on the homepage");
  assert(appJs.includes("navigator.share") && appJs.includes('title: "HighlightHype"'), "sharePlay uses the native share sheet when available");
  assert(appJs.includes('switchView("all")') && appJs.includes("#play-"), "deep links switch to All Hypes and land on the play card");
  assert(appJs.includes('preload="auto" autoplay'), "board videos autoplay with preload=auto (muted + loop already present)");
  const heroRes = await fetch(`${base}/hero.mp4`);
  const heroBuf = await heroRes.arrayBuffer();
  const heroFile = path.join(tmp, "hero-probe.mp4");
  fs.writeFileSync(heroFile, Buffer.from(heroBuf));
  const heroDur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", heroFile]).toString().trim());
  assert(heroDur > 9.0 && heroDur < 9.7, `hero runs ~9.3s after the Round 3 rebuild (${heroDur}s — true 0.7s crossfades at the hockey->golf join AND the golf->montage loop seam, so the loop is continuous; one unbroken music bed. Was ~11.2s in Rounds 1-2, where fades-to-black read as a blip)`);

  /* ---- 10. Hardening follow-up (2026-11-04 night, post-tonight-batch):
     backup endpoints + headers + log redaction + upload guards +
     public-API allowlist (server behavior itself is exercised in
     test.js; these are the static wiring checks), the render.yaml plan
     fix, the store focus-exit clearance, and the share label flip. */
  const serverJs = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const renderYaml = fs.readFileSync(path.join(root, "render.yaml"), "utf8");
  assert(serverJs.includes('req.headers["x-backup-token"]') && serverJs.includes("timingSafeEqual"), "backup endpoints are gated by a constant-time BACKUP_TOKEN check");
  assert(serverJs.includes("VACUUM INTO") && serverJs.includes("/api/backup/manifest") && serverJs.includes("/api/backup/file"), "backup snapshot + manifest + file endpoints exist");
  assert(serverJs.includes("Strict-Transport-Security") && serverJs.includes("frame-ancestors 'self'") && serverJs.includes("X-Content-Type-Options") && serverJs.includes("Referrer-Policy"), "security headers are set on responses (frame-ancestors-only CSP)");
  assert(!serverJs.includes("would text ${to}") && serverJs.includes("guardian number ${masked}"), "guardian phone numbers are never logged in plaintext (SMS fallback masks to last-2)");
  assert(serverJs.includes("statfsSync") && serverJs.includes("MIN_FREE_BYTES") && serverJs.includes("UPLOAD_RATE_LIMIT"), "upload guards present: free-space floor + per-IP rate-limit constants");
  assert(!serverJs.includes("...safe") && serverJs.includes("athlete_label: row.player_name"), "publicHighlight is an explicit allowlist (internal columns like review no longer spread into public output)");
  assert(renderYaml.includes("plan: starter"), "render.yaml matches the live Starter service");
  assert(/body\.store-open\[data-store-focus="boys"\] \.shop,\s*body\.store-open\[data-store-focus="girls"\] \.shop,\s*body\.store-open\[data-store-focus="hypeframe"\] \.shop\{padding-top:calc\(var\(--navh,70px\) \+ 12px\)\}/.test(css), "focus mode pads the shop below the floating nav band, so the exit pill is fully mouse-clickable (v8 root-cause fix; Round 4 adds the hypeframe state)");
  assert(!/\.store-focusbar\{[^}]*padding:12px 64px/.test(css) && css.includes("scroll-margin-top:calc(var(--navh,70px) + 8px)"), "the ineffective 64px focusbar padding hack is gone; scroll margin kept");
  assert(appJs.includes("sharePlay(${h.id}, this)") && appJs.includes("Link copied ✓") && appJs.includes("share-copied"), "share fallback flips the clicked button to 'Link copied ✓' (impossible-to-miss confirmation)");

  /* ---- 11. Store v8: quick-view gallery + Overtime card rhythm ----
     Emil (2026-11-04): products bigger, colorways scrollable, no
     models in product views; card anatomy matched to Overtime (image
     dominant, one badge, name + price + size run, no prose chrome).
     The gallery frames are build-time recolors of the board SVGs —
     garment body recolored per colorway, print art unchanged.
     Round 2 (2026-11-05) note: the gallery now LEADS with the
     design's real front/back photos (JS-built frames, asserted in
     §12); the colorway frames below keep their v8 assertions. */
  assert(appJs.includes("QV_PRODUCTS") && appJs.includes("qvSyncGallery") && appJs.includes("/swag/qv/"), "quick view is driven by per-product colorway gallery data");
  assert(!home.includes("qv-media") && !/id="qv(Front|Back|Flat)"/.test(home), "quick view static markup has no photo figures or colorway strip (Round 2 photos are JS-built frames — §12)");
  const QV_COLORS = {
    "boys-street": ["black", "denim-blue", "gray", "olive"],
    "boys-athletics": ["cream", "heather-gray", "forest-green", "navy"],
    "boys-unleashed": ["blue-lightning", "fire-orange", "purple-lightning", "teal-lightning"],
    "girls-street": ["black", "pink", "cream", "light-blue"],
    "girls-athletics": ["cream", "forest-green", "navy", "heather-gray"],
    "girls-essentials": ["sky-blue", "cream", "pink", "lavender"],
  };
  for (const [slug, colors] of Object.entries(QV_COLORS)) {
    for (const c of colors) {
      for (const sd of ["front", "back"]) {
        const r = await fetch(`${base}/swag/qv/${slug}-${c}-${sd}.svg`);
        const txt = await r.text();
        assert(r.status === 200 && txt.includes("<svg") && txt.includes("-fabric"), `gallery frame serves: /swag/qv/${slug}-${c}-${sd}.svg`);
      }
    }
  }
  const preShopV8 = home.slice(0, home.indexOf('id="shop"'));
  assert(!preShopV8.includes("$"), "no price anywhere before the Store section (v8)");

  /* ---- 12. Round 2 (2026-11-05): safe token storage, friendly vote
     failures, quick view leads with real photos, homepage Hype Frame
     examples, hero single audio bed ---- */
  // Safe storage: one guarded wrapper (localStorage -> cookie ->
  // in-memory), used for BOTH the voter token and the owner token.
  assert(appJs.includes("function hhStorageGet") && appJs.includes("function hhStorageSet"), "safe storage helper present (hhStorageGet / hhStorageSet)");
  assert(appJs.includes("document.cookie") && appJs.includes("hhMemoryStore"), "storage helper falls back to a cookie, then to an in-memory store");
  assert((appJs.match(/localStorage\.(getItem|setItem)/g) || []).length === 2, "localStorage is touched ONLY inside the guarded helper (one get + one set)");
  assert(appJs.includes('hhStorageGet("hh_voter")'), "the voter token is minted/read through the safe helper");
  assert(appJs.includes('ownerToken = () => hhStorageGet("hh_owner_token")'), "the owner token is read through the safe helper");
  assert(!appJs.includes('localStorage.getItem("hh_owner_token")') && !appJs.includes('localStorage.setItem("hh_owner_token"'), "no unguarded owner-token localStorage access remains");
  // Friendly vote path: retry once on a network failure, inline
  // message instead of alert(), refresh isolated in its own try/catch.
  assert(appJs.includes("Didn't go through — tap to try again"), "vote failure shows the friendly inline button message");
  assert(appJs.includes("isNetworkFailure") && appJs.includes("function showVoteFailure"), "vote failure helpers present (network sniff + inline message)");
  assert((appJs.match(/await postVote\(\)/g) || []).length === 2, "toggleVote POSTs, then retries exactly once");
  const voteFn = appJs.slice(appJs.indexOf("async function toggleVote"), appJs.indexOf("function showVoteFailure"));
  assert(!voteFn.includes("alert("), "toggleVote never surfaces a raw alert() error");
  assert(/try \{\s*await loadData\(\);\s*\} catch/.test(appJs), "the post-vote board refresh runs in its own try/catch (a refresh failure can't read as a vote error)");
  assert(css.includes(".votebtn.vote-failed"), "the failed-vote button state is styled");
  // Quick view leads with the real photos, colorway frames after.
  assert(appJs.includes('class="qv-frame qv-frame-photo"'), "quick view builds real-photo frames");
  assert(appJs.includes("/swag/${slug}-${sd}.jpg"), "quick view photo frames use the design's real front/back photos");
  assert(appJs.includes("2 + Number(b.dataset.qvColor) * 2"), "swatch jumps account for the 2 leading photo frames");
  assert(appJs.includes('g.scrollTo({ left: Number(b.dataset.qvSide) * w'), "FRONT/BACK buttons target the photo frames");
  // Homepage Hype Frame finished-product examples (poster crops).
  assert(home.includes('id="hfExamples"'), "homepage Hype Frame examples strip present");
  assert(home.includes("/swag/hf-example-hoodie-back.jpg") && home.includes("/swag/hf-example-lineup.jpg"), "examples strip uses the two poster crops");
  assert(home.includes("Example finishes — yours is made from your own play"), "examples are captioned as examples, made-from-your-own-play");
  const sizeOf = (f) => execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();
  assert(sizeOf("public/swag/hf-example-hoodie-back.jpg") === "386,448", "hoodie-back example crop is 386x448");
  assert(sizeOf("public/swag/hf-example-lineup.jpg") === "1284,284", "garment-lineup example crop is 1284x284");
  for (const f of ["hf-example-hoodie-back.jpg", "hf-example-lineup.jpg"]) {
    const r = await fetch(`${base}/swag/${f}`);
    assert(r.ok && Number(r.headers.get("content-length")) > 10000, `example crop serves: /swag/${f}`);
  }
  // Hero: exactly ONE audio stream (the unbroken master track bed).
  const heroStreams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", heroFile], { encoding: "utf8" }).trim().split("\n");
  assert(heroStreams.filter((t) => t === "audio").length === 1, "hero carries exactly one audio stream (single unbroken music bed)");

  /* ---- 13. Dead-end sweep (Round 2 added scope, 2026-11-05): every
     view/panel must have a visible, working route back to the
     homepage. The header logo (goHome) is the global route; panels
     add their own back buttons; the store adds a Back-to-homepage
     bar; the quick view and the standalone moderation pages were
     the dead ends and are fixed here. ---- */
  assert(appJs.includes('$$(".brand").forEach((b) => b.addEventListener("click", () => goHome()));'), "every .brand logo (header + footer) is bound to goHome()");
  assert(appJs.includes("function goHome()") && appJs.includes('showPanel("plays")'), "goHome() resets to the plays board (the homepage)");
  assert(home.includes('data-home-link') && home.includes("← Back to homepage"), "store landing carries a Back-to-homepage button (data-home-link -> goHome)");
  assert(home.includes('id="storeFocusExit"'), "store focus mode has its exit back to the store landing");
  assert((home.match(/data-panel-btn="plays"/g) || []).length >= 3, "athlete + studio panels carry a Back-to-the-board button (plus the menu's Plays button)");
  assert(home.includes('id="qvHome"') && home.includes("← Home"), "the open quick view carries its own Home button (it covers the header)");
  assert(appJs.includes('$("#qvHome")?.addEventListener("click", () => { closeQuickView(); goHome(); })'), "quick-view Home closes the dialog, then runs goHome()");
  assert(css.includes(".qv-home{"), "the quick-view Home button is styled (pill, top-left, mirrors the close button)");
  // Moderation pages (server-rendered): both templates + every bare
  // error response on the moderation routes link home.
  assert(serverJs.includes("← Back to the HighlightHype homepage"), "moderation page + queue templates link back to the homepage");
  assert((serverJs.match(/<a href=\\?"/g) || []).length >= 8, "moderation templates and error responses all carry a home link");
  const modRes = await fetch(`${base}/moderate?id=1`);
  const modBody = await modRes.text();
  assert(modRes.status === 403 && modBody.includes('<a href="/">'), "the served moderation 403 page links home");
  const queueRes = await fetch(`${base}/moderate-queue`);
  const queueBody = await queueRes.text();
  assert(queueRes.status === 403 && queueBody.includes('<a href="/">'), "the served moderation-queue 403 page links home");

  /* ---- 14. Enter-contest inline feedback (Fixes batch, 2026-11-05):
     the enter flow's confirm()/alert() can be blocked or
     auto-dismissed in in-app browsers, so the button read as
     completely dead (youth rerun: tapped twice, nothing happened).
     All enter feedback is now inline in a per-card message slot fed
     from ENTER_MSGS — one slot per card, rendered by cardHtml, so a
     board re-render can neither duplicate it nor drop a message
     mid-flow. The API contract is unchanged. ---- */
  const enterBlock = appJs.slice(appJs.indexOf("const ENTER_MSGS"), appJs.indexOf("window.reportPlay"));
  assert(enterBlock.includes("window.enterContest") && enterBlock.includes("submitContestEntry"), "enter flow block located (enterContest + submitContestEntry)");
  assert(!enterBlock.includes("confirm(") && !enterBlock.includes("alert("), "the enter path uses NO native dialogs (confirm/alert gone from the whole enter flow)");
  assert(appJs.includes('onclick="enterContest(${h.id}, this)"'), "the Enter button still calls enterContest from the card");
  assert(appJs.includes('class="card-msg"') && appJs.includes("data-enter-msg"), "cards render the per-card enter message slot");
  assert(appJs.includes("ENTER_MSGS.get(h.id)") && appJs.includes("ENTER_MSGS.has(h.id)"), "cardHtml renders the slot from ENTER_MSGS (re-render safe, exactly one slot per card)");
  assert(enterBlock.includes("can't be featured yet") && enterBlock.includes("parent/guardian email on file") && enterBlock.includes("It can still collect votes"), "the no-guardian prompt explains the rule inline, in plain words");
  assert(enterBlock.includes("Enter anyway") && enterBlock.includes("Not now"), "the inline prompt offers Enter anyway / Not now");
  assert(enterBlock.includes("enterContestAnyway") && enterBlock.includes("enterContestDismiss"), "both inline choices are wired (anyway -> submit, dismiss -> clear)");
  assert(enterBlock.includes('api("/api/contest/enter"') && enterBlock.includes("highlightId: id"), "the enter POST contract is unchanged (/api/contest/enter, highlightId)");
  assert(enterBlock.includes("await loadData()"), "a successful enter still refreshes the board (loadData)");
  assert(css.includes(".card-msg{") && css.includes(".card-msg[hidden]{display:none}"), "the enter slot is styled, with an explicit [hidden] guard");
  // Behavioral: run the real enter block in a vm with stubbed api /
  // DOM and drive all three paths (prompt, direct, refusal).
  const enterCalls = [];
  const enterSandbox = {
    window: {},
    ALL_PLAYS: [
      { id: 41, hasGuardianEmail: false, hasGuardianText: false },
      { id: 42, hasGuardianEmail: true, hasGuardianText: false },
      { id: 43, hasGuardianEmail: true, hasGuardianText: false },
    ],
    CONTEST: { period: "2026-11", entries: [], winnerId: null },
    api: async (p, opts) => {
      const body = JSON.parse(opts.body);
      enterCalls.push({ path: p, body });
      if (body.highlightId === 43) throw new Error("This play is already in this month's contest.");
      return { message: "You're in — good luck!" };
    },
    loadData: async () => {},
    esc: (s) => String(s ?? ""),
    $: () => null,
    $$: () => [], // app.js's selector helpers: no live DOM in the sandbox (slot writes land in ENTER_MSGS)
    document: { querySelectorAll: () => [] },
    console,
  };
  const enterCtx = vm.createContext(enterSandbox);
  vm.runInContext(enterBlock, enterCtx);
  const enterMsgOf = (id) => vm.runInContext(`ENTER_MSGS.get(${id}) || ""`, enterCtx);
  enterSandbox.window.enterContest(41);
  assert(enterCalls.length === 0, "behavioral: a no-guardian tap does NOT post — it asks inline first");
  assert(enterMsgOf(41).includes("Enter anyway") && enterMsgOf(41).includes("Not now"), "behavioral: the inline prompt (both choices) is stored for the card slot");
  enterSandbox.window.enterContestDismiss(41);
  assert(enterMsgOf(41) === "", "behavioral: Not now dismisses the prompt");
  await enterSandbox.window.enterContestAnyway(41);
  assert(enterCalls.length === 1 && enterCalls[0].path === "/api/contest/enter" && enterCalls[0].body.highlightId === 41, "behavioral: Enter anyway posts the same payload as the old dialog flow");
  assert(enterMsgOf(41).includes("You're in — good luck!"), "behavioral: the server's success message lands inline on the card");
  await enterSandbox.window.enterContest(42);
  assert(enterCalls.length === 2 && enterCalls[1].body.highlightId === 42, "behavioral: a play WITH guardian contact enters directly (no prompt)");
  assert(enterMsgOf(42).includes("You're in — good luck!"), "behavioral: direct-enter success is inline too");
  await enterSandbox.window.enterContest(43);
  assert(enterCalls.length === 3, "behavioral: the refusal path still posts (server decides)");
  assert(enterMsgOf(43).includes("already in this month's contest") && enterMsgOf(43).includes("err"), "behavioral: a server refusal shows inline on the card as an error, not an alert");

  /* ---- 15. Vote in-flight guard (Fixes batch, 2026-11-05): voting
     is a toggle, so a second tap during a slow first request fired a
     parallel POST that toggled the vote back off — the user
     cancelled their own vote. While a vote is in flight the button
     ignores further clicks and shows a pending state; the guard
     releases on every exit path. Round 2's retry + friendly failure
     behavior is preserved (asserted in §12 and re-verified below). ---- */
  assert(css.includes(".votebtn.vote-pending"), "the pending vote state is styled");
  const voteBlock = appJs.slice(appJs.indexOf("const isNetworkFailure"), appJs.indexOf("const ENTER_MSGS"));
  assert(voteBlock.includes('btn.dataset.voteBusy === "1"') && voteBlock.includes('btn.dataset.voteBusy = "1"') && voteBlock.includes("delete btn.dataset.voteBusy"), "toggleVote sets, checks and releases the in-flight guard (dataset.voteBusy)");
  assert(voteBlock.includes('btn.textContent = "Voting…"') && voteBlock.includes('"vote-pending"'), "toggleVote shows the pending label + style while in flight");
  assert(voteBlock.includes("finally"), "the guard release lives in a finally (all exit paths)");
  let voteApiCalls = 0, voteLoads = 0, voteMode = "gate";
  let releaseVote = null;
  const mkVoteBtn = () => {
    const classes = new Set();
    return { dataset: {}, disabled: false, isConnected: true, textContent: "Vote",
      classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
  };
  const voteSandbox = {
    window: {},
    voterToken: "v_guard_test",
    api: async () => {
      voteApiCalls++;
      if (voteMode === "gate") await new Promise((r) => { releaseVote = r; });
      if (voteMode === "fail") throw new Error("Server refused the vote");
      if (voteMode === "flaky") { voteMode = "ok"; throw new TypeError("Failed to fetch"); }
      return { ok: true };
    },
    loadData: async () => { voteLoads++; },
    setTimeout: () => 0, // showVoteFailure's restore timer: captured, never scheduled
    console,
  };
  const voteCtx = vm.createContext(voteSandbox);
  vm.runInContext(voteBlock, voteCtx);
  const vbtn = mkVoteBtn();
  const inFlight = voteSandbox.window.toggleVote(7, vbtn);
  assert(vbtn.dataset.voteBusy === "1" && vbtn.disabled === true && vbtn.textContent === "Voting…" && vbtn.classList.contains("vote-pending"), "behavioral: while a vote is in flight the button shows the pending state");
  await voteSandbox.window.toggleVote(7, vbtn); // the impatient second tap
  assert(voteApiCalls === 1, "behavioral: a second tap during flight is ignored (no parallel toggle POST)");
  releaseVote(); voteMode = "ok";
  await inFlight;
  assert(voteApiCalls === 1 && voteLoads === 1, "behavioral: the single flight posted once and refreshed the board");
  assert(!vbtn.dataset.voteBusy && vbtn.disabled === false && !vbtn.classList.contains("vote-pending") && vbtn.textContent === "Vote", "behavioral: the guard fully releases after success (label restored)");
  voteMode = "fail";
  const fbtn = mkVoteBtn();
  await voteSandbox.window.toggleVote(8, fbtn);
  assert(fbtn.textContent === "Didn't go through — tap to try again" && fbtn.classList.contains("vote-failed"), "behavioral: a final failure still lands on showVoteFailure's friendly label");
  assert(!fbtn.dataset.voteBusy && fbtn.disabled === false && !fbtn.classList.contains("vote-pending"), "behavioral: the guard fully releases after a failure too");
  voteMode = "flaky"; voteApiCalls = 0; voteLoads = 0;
  const rbtn = mkVoteBtn();
  await voteSandbox.window.toggleVote(9, rbtn);
  assert(voteApiCalls === 2 && voteLoads === 1, "behavioral: Round 2's retry still works under the guard (network failure -> one retry -> success)");
  assert(!rbtn.dataset.voteBusy && rbtn.disabled === false, "behavioral: the guard releases after the retry path");

  /* ---- 16. Round 3 (2026-11-05, later): third door, Hype Frame film,
     examples placement (the blank-space fix), HF order size wiring ----
     Emil's phone review: the store landing gets a THIRD door for Hype
     Frame; a real-assets promo film opens the studio and sits on the
     homepage; and the homepage examples block — a plain deck child
     that rendered under EVERY panel — moves inside the home panel,
     which is what left a slab of dead black space under the studio
     card (hidden panels hold no height; the examples block did). */
  const hfDoorIdx = home.indexOf('data-store-block="hypeframe"');
  assert(hfDoorIdx > girlsBlockIdx && hfDoorIdx < creativeIdx, "landing order: Boys door -> Girls door -> Hype Frame door -> Hype Frame creative");
  const doorSlice = home.slice(hfDoorIdx, creativeIdx);
  assert(doorSlice.includes('data-store-focus="hypeframe"') && doorSlice.includes("Turn your highlight into wearable hype") && doorSlice.includes("/swag/hf-door.jpg"), "the third door is labeled Hype Frame with its tagline and banner art");
  assert(!doorSlice.includes('data-store-focus="boys"') && !doorSlice.includes('data-store-focus="girls"') && !doorSlice.includes("data-hf-door"), "Round 4: the Hype Frame door carries its OWN focus control (hypeframe), not a division's, and the old scroll-door attribute is gone");
  assert(appJs.includes("function openStoreHf") && appJs.includes('setStoreFocus("hypeframe")'), "Round 4: the door opens the Hype Frame panel via the focus mechanics (openStoreHf)");
  assert(css.includes('[data-store-focus="boys"] .store-block[data-store-block="hypeframe"]') && css.includes('[data-store-focus="girls"] .store-block[data-store-block="hypeframe"]'), "the door's block hides in either division's focus mode");
  assert(css.includes(".hf-creative{scroll-margin-top"), "the creative keeps its nav-clearing scroll margin");
  // The film itself: serves, ~15s, 1280x720 (Round 3: assembled from
  // real assets — Nicholas's clip, its freeze, the poster crops.
  // Round 4 replaced it with the sweatshirt-player film; the serve /
  // duration / dimension facts asserted here are unchanged).
  const hfFilmRes = await fetch(`${base}/hype-frame-film.mp4`);
  const hfFilmBuf = Buffer.from(await hfFilmRes.arrayBuffer());
  assert(hfFilmRes.status === 200 && hfFilmBuf.byteLength > 500000, `the Hype Frame film serves (${hfFilmBuf.byteLength} bytes)`);
  const hfFilmFile = path.join(tmp, "hf-film-probe.mp4");
  fs.writeFileSync(hfFilmFile, hfFilmBuf);
  const hfFilmDur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", hfFilmFile]).toString().trim());
  assert(hfFilmDur > 12 && hfFilmDur < 18, `the Hype Frame film runs ~15s (${hfFilmDur}s)`);
  const hfFilmSize = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", hfFilmFile], { encoding: "utf8" }).trim();
  assert(hfFilmSize === "1280,720", `the Hype Frame film is 1280x720 (${hfFilmSize})`);
  const doorRes = await fetch(`${base}/swag/hf-door.jpg`);
  assert(doorRes.status === 200 && Number(doorRes.headers.get("content-length")) > 10000, "the door banner image serves");
  // Item 7 structural fix: the examples block lives INSIDE the home
  // (plays) panel now, so panel views no longer trail it.
  const playsIdx = home.indexOf('data-panel="plays"'), mineIdx = home.indexOf('data-panel="mine"'), exIdx = home.indexOf('id="hfExamplesHome"');
  assert(playsIdx > -1 && exIdx > playsIdx && exIdx < mineIdx, "homepage examples block sits inside the plays panel (before My Highlights)");
  const exSlice = home.slice(exIdx, mineIdx);
  assert(exSlice.includes('src="/hype-frame-film.mp4"') && exSlice.indexOf('src="/hype-frame-film.mp4"') < exSlice.indexOf("hf-examples-grid"), "on the homepage the film sits ABOVE the examples grid");
  // Server: size column + sanitizer + owner-email surfacing.
  assert(serverJs.includes('ADD COLUMN size TEXT') && serverJs.includes('"YXXS", "YXS", "YS", "YM", "YL", "YXL"'), "server stores the HF order size (additive column + whitelist)");
  assert(serverJs.includes("Size: ${order.size"), "the owner notification email enumerates the size alongside the colorway");

  /* ---- 17. Round 4 (2026-11-05, evening): Hype Frame content moves
     behind the door click; new sweatshirt-player film ----
     Emil, reviewing Round 3 on his phone: (1) ALL Hype Frame content
     on the swag page should sit UNDER the button click — the creative
     was part of the landing's always-visible flow; (2) the Round 3
     film showed Nicholas's clip but the sweatshirt examples showed a
     different player — build the film around the player ON the
     sweatshirt instead. Confirmed mapping: creative + finished-
     product examples become the hypeframe focus panel; homepage
     examples and the studio stay as they are. */
  // (1a) The creative + examples are CSS-gated OUT of the default
  // store view and the division focuses — only the hypeframe focus
  // state reveals them.
  assert(css.includes('body:not([data-store-focus="hypeframe"]) .shop .hf-creative') && css.includes('body:not([data-store-focus="hypeframe"]) #hfExamples{display:none}'), "Round 4: the store creative + examples are hidden unless the Hype Frame panel is open");
  assert(css.includes('body[data-store-focus="hypeframe"] .store-block{display:none}'), "Round 4: the hypeframe panel hides all three door blocks");
  assert(css.includes('body[data-store-focus="hypeframe"] .swag-film-hero') && css.includes('body[data-store-focus="hypeframe"] .shop-head{display:none}'), "Round 4: the hypeframe panel hides the film + store head like a division focus");
  assert(css.includes('body[data-store-focus="hypeframe"] .hf-creative{margin-top:0;padding-top:10px;border-top:0}'), "Round 4: in the panel the creative sits directly under the focus bar (landing separator dropped)");
  // (1b) The gating must NOT swallow the other examples blocks: the
  // homepage block and the studio strip carry different hooks.
  assert(home.includes('id="hfExamplesHome"') && home.includes('class="hf-examples hf-examples-studio"'), "Round 4: homepage + studio examples blocks keep their own hooks (not gated by the store rule)");
  // (1c) Wiring: both the door button and a tap anywhere on the
  // banner route hypeframe to the panel; the focus bar (with its
  // exit) is the panel chrome and the back path.
  assert(appJs.includes('if (b.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }') && appJs.includes('if (btn.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }'), "Round 4: door button AND banner tap both route hypeframe to openStoreHf");
  assert(appJs.includes('div === "hypeframe" ? "Hype Frame"'), "Round 4: the focus bar titles the panel 'Hype Frame'");
  assert(appJs.includes('$("#storeFocusExit")') && appJs.includes("setStoreFocus(null)"), "Round 4: the focus-bar exit clears the focus (back to the doors landing)");
  assert(!appJs.includes('$$("[data-hf-door]")') && !appJs.includes('$$(".store-banner-hf")'), "Round 4: the old scroll-to-creative door handlers are gone");
  // (1d) The panel's CTA keeps its exact Round 3 wiring into the
  // studio path (data-tablink to the plays panel).
  const hfCreativeSlice = home.slice(home.indexOf('class="hf-creative"'), home.indexOf('id="quickView"'));
  assert(hfCreativeSlice.includes('class="hfc-cta"') && hfCreativeSlice.includes('data-tablink="plays"') && hfCreativeSlice.includes("Create a Hype Frame"), "Round 4: the panel's 'Create a Hype Frame' CTA is unchanged (opens the studio exactly as before)");
  // (2) The new film: same slot facts as Round 3 (serves, ~13-15s,
  // 1280x720) — asserted in section 16 above against the live file;
  // its composition is the sweatshirt-player build (see DEPLOY-NOTES).


  /* §18 Round 4 fix (2026-11-05): showStore() pauses every .view-home
     video; an explicitly paused video never auto-resumes, so the Hype
     Frame films are restarted explicitly — studio film on studio open,
     homepage film on return home. */
  assert("18.1 showHome resumes the homepage Hype Frame film",
    /#hfExamplesHome video/.test(appJs) && /hfHome\.play\(\)/.test(appJs));
  assert("18.2 openHypeFrame plays the studio film",
    /#hypeframe \.hf-film video/.test(appJs) && /hfFilm\.play\(\)/.test(appJs));

  /* ---- 19. Round 5 (2026-11-05, night): homepage condense, sport
     dropdowns, Hall of Fame videos ----
     Emil, after Round 4: (1) tighten ALL the homepage spacing —
     condense it, not as much scrolling; (2) drop the sports into a
     dropdown to get the pill rows' space back; (3) the Hall of Fame
     should also show videos (it was a names-only leaderboard whose
     rows didn't even link anywhere). Mapping confirmed in chat:
     spacing = air only (no content, no type changes), home view
     only, studio keeps its spacing; dropdowns on both board views
     with the pills' dynamic rule; fame rows get playing video
     thumbnails and tap through to the play's card. ---- */
  // (1) Condense facts (CSS): hero air, panel rhythm, cards, examples.
  assert(css.includes("min-height:min(80vh,680px)") && !css.includes("min-height:min(92vh,780px)"), "Round 5: hero min-height trimmed (92vh/780px -> 80vh/680px), film untouched");
  assert(css.includes(".panel{display:none;padding:18px 0 22px}") && css.includes(".panel{padding-top:18px}"), "Round 5: panel rhythm roughly halved (36/42 -> 18/22)");
  assert(css.includes(".board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}") && css.includes(".card-body{padding:13px 14px 15px;"), "Round 5: tighter board gaps + card padding");
  assert(css.includes(".hf-examples{margin:22px 0 4px;padding-top:18px;"), "Round 5: homepage examples block air roughly halved");
  assert(css.includes("footer{background:#000;color:var(--muted);padding:20px 0 70px;"), "Round 5: footer lead-in trimmed, bottom pill clearance kept");
  assert(css.includes("#hypeframe{padding:36px 0 42px}") && css.includes("#hypeframe .sec-head{margin-bottom:26px}"), "Round 5 scope guard: the studio panel keeps its original spacing");
  // (2) Dropdowns: styled like the team select; fame rows clickable.
  assert(css.includes(".team-select,.sport-select,.search-input{") && css.includes(".sport-select:focus-visible"), "Round 5: the sport dropdown carries the team-select chrome + focus ring");
  assert(css.includes(".fame-thumb video{width:100%;height:100%;object-fit:cover;display:block"), "Round 5: fame video thumbnails fill their frame like the photos do");
  assert(css.includes(".fame-row{display:grid;") && css.includes("cursor:pointer"), "Round 5: fame rows signal they are tappable");
  // (3a) Behavioral — the dropdowns, run from the REAL app.js blocks
  // in a vm with stub selects: options stay dynamic per view, a change
  // filters that view only, and the two views stay independent.
  const ddStart = appJs.indexOf("function sportsInData");
  const ddBlock = appJs.slice(appJs.indexOf("const SPORTS"), appJs.indexOf("const MONTHS")) +
    appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function renderMonth")) +
    appJs.slice(ddStart, appJs.indexOf('$("#teamFilter")', ddStart));
  assert(ddBlock.includes("function renderSportSelect") && ddBlock.includes("function syncFilterUI") && ddBlock.includes("function divMatch"), "Round 5: dropdown test block located (SPORTS + divMatch + sportsInData/renderSportSelect/syncFilterUI)");
  const mkSelect = () => ({ innerHTML: "", value: "", onchange: null });
  const monthSel = mkSelect(), allSel = mkSelect();
  let monthRenders = 0, allRenders = 0;
  const ddSandbox = {
    window: {},
    cap: (s) => { if (s === "fieldhockey") return "Field Hockey"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
    CONTEST: { period: "2026-11", winnerId: null, entries: [
      { sport: "baseball", division: "boys" }, { sport: "hockey", division: "girls" } ] },
    ALL_PLAYS: [
      { sport: "baseball", division: "boys" }, { sport: "soccer", division: "girls" }, { sport: "baseball", division: "girls" } ],
    monthDiv: "boys", monthSport: "all", allDiv: "all", allSport: "all",
    $: (sel) => sel === "#monthSportSelect" ? monthSel : sel === "#allSportSelect" ? allSel : null,
    $$: () => [],
    renderMonth: () => { monthRenders++; },
    renderAll2: () => { allRenders++; },
    console,
  };
  const ddCtx = vm.createContext(ddSandbox);
  vm.runInContext(ddBlock, ddCtx);
  vm.runInContext("syncFilterUI()", ddCtx);
  assert(monthSel.innerHTML.includes('<option value="all"') && monthSel.innerHTML.includes(">Baseball<") && !monthSel.innerHTML.includes("Hockey"), "behavioral: month dropdown = All sports + the sports on the boys contest board only (baseball; girls' hockey stays out)");
  assert(allSel.innerHTML.includes(">Baseball<") && allSel.innerHTML.includes(">Soccer<") && !allSel.innerHTML.includes("Hockey"), "behavioral: All dropdown = All sports + every sport with an approved play (baseball + soccer)");
  allSel.value = "soccer"; allSel.onchange();
  assert(vm.runInContext("allSport", ddCtx) === "soccer" && allRenders === 1, "behavioral: choosing Soccer in the All dropdown sets that view's filter and re-renders it");
  assert(vm.runInContext("monthSport", ddCtx) === "all" && monthSel.value === "all" && monthRenders === 0, "behavioral: the month view is untouched by the All dropdown (independent state, kept in sync on reload)");
  monthSel.value = "baseball"; monthSel.onchange();
  assert(vm.runInContext("monthSport", ddCtx) === "baseball" && monthRenders === 1 && vm.runInContext("allSport", ddCtx) === "soccer", "behavioral: the month dropdown filters its own view only; the All filter survives");
  // (3b) Behavioral — renderFame from the real app.js: video plays
  // (file + link) render a playing <video>, image plays keep <img>,
  // embeds keep the sport-name fallback, every row taps to its card.
  const fameBlock = appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine"));
  assert(fameBlock.includes("function renderFame") && fameBlock.includes("goToPlayCard"), "Round 5: fame test block located (fameThumbHtml + renderFame)");
  const fameListStub = { innerHTML: "" };
  const fameSandbox = {
    window: {},
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    cap: ddSandbox.cap,
    ALL_PLAYS: [
      { id: 11, title: "File Vid", sport: "baseball", division: "boys", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v.mp4", voteCount: 9 },
      { id: 12, title: "Photo Play", sport: "soccer", division: "girls", media_kind: "file", mime: "image/png", media_url: "/uploads/i.png", voteCount: 5 },
      { id: 13, title: "Link Vid", sport: "hockey", division: "boys", media_kind: "link_video", mime: "", media_url: "https://cdn.example/v.mp4", voteCount: 3 },
      { id: 14, title: "Embed Play", sport: "cheer", division: "girls", media_kind: "link_embed", mime: "", media_url: "", embed_url: "https://youtube.example/embed/x", voteCount: 1 },
    ],
    $: (sel) => sel === "#fameList" ? fameListStub : null,
    console,
  };
  const fameCtx = vm.createContext(fameSandbox);
  vm.runInContext(fameBlock, fameCtx);
  vm.runInContext("renderFame()", fameCtx);
  const fameHtml = fameListStub.innerHTML;
  assert(fameHtml.includes('<video src="/uploads/v.mp4" muted loop playsinline autoplay preload="metadata"></video>'), "behavioral: an uploaded-file video play gets a real playing video thumbnail in the Hall of Fame");
  assert(fameHtml.includes('<video src="https://cdn.example/v.mp4" muted loop playsinline autoplay preload="metadata"></video>'), "behavioral: a link-video play gets the same video thumbnail treatment");
  assert(fameHtml.includes('<img src="/uploads/i.png" alt="">') && !fameHtml.includes('<video src="/uploads/i.png"'), "behavioral: an image play keeps its photo (no video element)");
  const embedRow = fameHtml.slice(fameHtml.indexOf("Embed Play") - 200);
  assert(!embedRow.includes("<video") && !embedRow.includes("<iframe") && embedRow.includes("Cheer"), "behavioral: an embed play keeps the sport-name fallback (no fake video)");
  assert(fameHtml.indexOf("File Vid") < fameHtml.indexOf("Photo Play") && fameHtml.indexOf("Photo Play") < fameHtml.indexOf("Link Vid"), "behavioral: fame rows stay ranked by all-time votes");
  for (const pid of [11, 12, 13, 14]) assert(fameHtml.includes(`onclick="goToPlayCard(${pid})"`), `behavioral: fame row for play ${pid} taps through to its card`);
  // (3c) Behavioral — goToPlayCard wiring: resets the All filters,
  // switches to the All view, sets the shared-play hash, and flashes
  // the card inside #allBoard (scoped on purpose, see app.js note).
  const gtcBlock = appJs.slice(appJs.indexOf("window.goToPlayCard"), appJs.indexOf("/* ---------------- athlete collection"));
  assert(gtcBlock.includes('switchView("all")') && gtcBlock.includes("#allBoard [data-play-id="), "Round 5: goToPlayCard block located (All view + scoped card lookup)");
  const gtcCalls = [];
  const gtcSandbox = {
    window: {},
    allDiv: "boys", allSport: "soccer", allTeam: "plainview-hawks", allSearch: "left",
    showHome: () => gtcCalls.push("showHome"),
    showPanel: (n) => gtcCalls.push("panel:" + n),
    switchView: (v) => gtcCalls.push("view:" + v),
    renderAll2: () => gtcCalls.push("renderAll2"),
    syncFilterUI: () => gtcCalls.push("syncFilterUI"),
    history: { replaceState: (a, b, url) => gtcCalls.push("hash:" + url) },
    document: { querySelector: (sel) => { gtcCalls.push("qs:" + sel); return { classList: { add: (c) => gtcCalls.push("class:" + c) }, scrollIntoView: () => gtcCalls.push("scroll") }; } },
    $: () => ({ value: "left" }),
    setTimeout: (fn) => { fn(); return 0; },
    console,
  };
  const gtcCtx = vm.createContext(gtcSandbox);
  vm.runInContext(gtcBlock, gtcCtx);
  gtcSandbox.window.goToPlayCard(7);
  assert(gtcSandbox.allDiv === "all" && gtcSandbox.allSport === "all" && gtcSandbox.allTeam === "all" && gtcSandbox.allSearch === "", "behavioral: a fame tap resets every All Hypes filter so the card is rendered");
  assert(gtcCalls.includes("view:all") && gtcCalls.includes("hash:#play-7"), "behavioral: a fame tap switches to All Hypes and sets the shared-play hash");
  assert(gtcCalls.includes('qs:#allBoard [data-play-id="7"]') && gtcCalls.includes("class:flash") && gtcCalls.includes("scroll"), "behavioral: a fame tap flash-highlights the play's All-board card and scrolls to it");

  /* ---- 20. Round 5b (2026-11-05, night): the upload form's sport
     picker becomes a dropdown too ----
     Round 5 turned the BOARD sport filters into native selects but
     deliberately left the upload form's 12 one-tap sport pills; the
     owner then reported he still saw "all the sports listed" on the
     homepage and directed the form to convert too, so no sport list
     renders as pills anywhere. Differences from the board selects,
     on purpose: the form offers the FULL sport list (the dynamic
     plays-only rule belongs to the board filters), behind a
     "Choose a sport" placeholder (value ""). Because the <select>
     itself carries name="sport" (the old hidden field is gone), the
     payload and the submit-time validation read exactly the field
     they always have: no sport chosen fails with the same message
     and scroll-to-control behavior, and a chosen sport submits the
     same value its pill used to write. ---- */
  // (1) Structure: placeholder first, then the full list, in order.
  const selStart = home.indexOf('<select name="sport"');
  const selBlock = home.slice(selStart, home.indexOf("</select>", selStart));
  const optVals = [...selBlock.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => m[1]);
  const optLabels = [...selBlock.matchAll(/<option value="([^"]*)">([^<]*)<\/option>/g)].map((m) => m[2]);
  assert(JSON.stringify(optVals) === JSON.stringify(["", "baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"]), "Round 6: the form sport select = placeholder (value \"\") + the FULL 18-sport list (Round 5b's 12 + Dance/Golf/Swimming/Tennis/Track/Wrestling), alphabetical with Other in its Lacrosse–Soccer slot");
  assert(optLabels[0] === "Choose a sport" && optLabels[3] === "Cheer" && optLabels[4] === "Dance" && optLabels[5] === "Field Hockey" && optLabels[16] === "Track &amp; Field" && optLabels[18] === "Wrestling", "Round 6: placeholder reads 'Choose a sport'; option labels carry display names (Track & Field for the track key, Wrestling last)");
  assert(selBlock.includes('class="sport-select"'), "Round 5b: the form select wears the same .sport-select chrome as the round-5 board selects");
  assert(!home.includes('type="hidden" name="sport"') && !home.includes("quick-sports") && !css.includes(".quick-sports"), "Round 5b: the hidden sport field and the pill container/CSS are gone — name=\"sport\" survives exactly once (the §3b count), on the select");
  // (2) Behavioral — setSportPick/syncQuickPicks from the REAL app.js,
  // run in a vm against a stub form whose sport field is a select.
  const pickStart = appJs.indexOf("function setDivPick");
  const pickEnd = appJs.indexOf("};", appJs.indexOf("window.syncQuickPicks")) + 2;
  const pickBlock = appJs.slice(pickStart, pickEnd);
  assert(pickBlock.includes("function setSportPick") && pickBlock.includes("window.syncQuickPicks") && !pickBlock.includes("data-sport-pick"), "Round 5b: quick-picks block located (setDivPick/setSportPick/syncQuickPicks, no pill wiring left)");
  const stubSport = { value: "" }, stubDiv = { value: "boys" };
  const stubForm = { elements: { sport: stubSport, division: stubDiv } };
  const pickSandbox = {
    window: {},
    $: (sel) => sel === "#uploadForm" ? stubForm : null,
    $$: () => [],
    console,
  };
  const pickCtx = vm.createContext(pickSandbox);
  vm.runInContext(pickBlock, pickCtx);
  vm.runInContext('setSportPick("soccer")', pickCtx);
  assert(stubSport.value === "soccer", "behavioral: setSportPick writes the chosen value into the sport select — the same value the soccer pill used to write into the hidden field");
  vm.runInContext('setSportPick("")', pickCtx);
  assert(stubSport.value === "", "behavioral: clearing the pick returns the select to the placeholder value (\"\") the validation treats as unchosen");
  vm.runInContext('setSportPick("hockey"); setDivPick("girls"); window.syncQuickPicks()', pickCtx);
  assert(stubSport.value === "" && stubDiv.value === "boys", "behavioral: syncQuickPicks still resets both quick picks after a submit (Boys, no sport) — now against the select");
  // (3) Validation path: same field read, same message, scroll target
  // is the select now (the pill container no longer exists).
  assert(appJs.includes('msg.textContent = "Tap the sport — one tap is all it takes."') && appJs.includes('$("#sportSelect")?.scrollIntoView') && !appJs.includes(".quick-sports"), "Round 5b: an unchosen sport fails submit validation with the SAME message as the untapped pills did, scrolling the dropdown into view instead of the gone pill row");

  /* ---- 21. Round 6 (2026-11-05, late): three youth-rerun-v3 fixes ----
     (1) The guardian-contact block moves OUT of the collapsed "Add
     more (optional)" section into the main quick form under a
     plain-language explainer — the email that decides featuring was
     hidden behind an "optional" label (the rerun's #1 finding).
     Posting without it still works; it only decides featuring, and
     the server-side eligibility rule (notify_email, or guardian
     phone + text consent) is untouched. (2) Report goes inline: the
     built-in prompt/alert pair read as a dead button in in-app
     browsers; the panel mirrors §14's enter pattern, same endpoint,
     same payload. (3) Six sports join — Dance, Golf, Swimming,
     Tennis, Track & Field, Wrestling — across the form select, the
     client SPORTS constant and cap()'s labels. The server holds NO
     sport whitelist (it lowercases and stores the key), so there is
     no server list to sync; the wrestling upload below proves a new
     sport end-to-end (post -> approve -> served with its key). ---- */
  // (1a) Structure: guardian block in the main form — after "What
  // happened?", before "Add more" — with the explainer in plain words.
  const guardianAt = home.indexOf('class="quick-field guardian-block"');
  const happenedAt = home.indexOf("What happened? (optional)");
  assert(guardianAt > happenedAt && guardianAt < moreAt, "Round 6: the guardian block sits in the main form — after 'What happened?', before the collapsed 'Add more' section");
  assert(home.includes("Parent or guardian — needed to win") && home.includes("To win Hype of the Month, we need a parent or guardian we can reach — ask a parent first.") && home.includes("You can still post without it; your play just can't be featured until we have it."), "Round 6: the guardian block carries the plain-language eligibility explainer (ask a parent first; posting still allowed)");
  assert(!home.includes("Add a parent/guardian contact so we can reach you if this play wins"), "Round 6: the old guardian pointer note under the optional section is gone (the block itself is in the form now)");
  const moreBlock = home.slice(moreAt, home.indexOf("</details>", moreAt));
  assert(!moreBlock.includes("notifyEmail") && !moreBlock.includes("guardianPhone") && !moreBlock.includes("textConsent"), "Round 6: no guardian field remains inside the collapsed section");
  assert(css.includes(".guardian-block{"), "Round 6: the guardian block is framed as part of the main form");
  // (1b)+(3) Behavior against the real server: a no-guardian upload
  // still succeeds and is NOT prize-eligible; a wrestling upload WITH
  // a guardian email is accepted and IS prize-eligible.
  const mkUpload = async (fields) => {
    const f = new FormData();
    f.append("title", fields.title); f.append("sport", fields.sport); f.append("division", "boys"); f.append("playerName", fields.playerName);
    if (fields.notifyEmail) f.append("notifyEmail", fields.notifyEmail);
    f.append("file", new Blob([png], { type: "image/png" }), "play.png");
    return j("/api/highlights", { method: "POST", body: f });
  };
  const upA = await mkUpload({ title: "Round 6 No Guardian Play", sport: "soccer", playerName: "Noa" });
  assert(upA.status === 201 && upA.body.status === "pending", "Round 6: an upload with NO guardian contact still succeeds and starts pending (guardian stays optional for posting)");
  const upB = await mkUpload({ title: "Round 6 Wrestling Play", sport: "wrestling", playerName: "Wren", notifyEmail: "parent@example.com" });
  assert(upB.status === 201 && upB.body.status === "pending", "Round 6: a wrestling upload is accepted by the server (no sport whitelist exists to fall out of sync)");
  for (const u of [upA, upB]) {
    const a = await j(`/api/highlights/${u.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    assert(a.body.status === "approved", `Round 6: owner approves play ${u.body.id}`);
  }
  const pub2 = await j("/api/highlights?division=all");
  const playA = pub2.body.highlights.find((h) => h.id === upA.body.id);
  const playB = pub2.body.highlights.find((h) => h.id === upB.body.id);
  assert(playA && playA.hasGuardianEmail === false && playA.hasGuardianText === false, "Round 6: the no-guardian play reports no guardian contact on file");
  assert(playB && playB.sport === "wrestling" && playB.hasGuardianEmail === true, "Round 6: the wrestling play is served with sport=wrestling and its guardian email on file");
  for (const u of [upA, upB]) {
    const e = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: u.body.id }) });
    assert(e.status === 201 && e.body.ok, `Round 6: play ${u.body.id} enters the contest`);
  }
  const contest6 = await j("/api/contest?voterToken=round6probe");
  const entryA = (contest6.body.entries || []).find((h) => h.id === upA.body.id);
  const entryB = (contest6.body.entries || []).find((h) => h.id === upB.body.id);
  assert(entryA && entryA.prizeEligible === false, "Round 6: the no-guardian entry is NOT prize-eligible (placement changed, the eligibility rule didn't)");
  assert(entryB && entryB.prizeEligible === true, "Round 6: the guardian-email entry IS prize-eligible");
  // (2) Report inline: structure + vm behavioral drive of the real block.
  const reportBlock = appJs.slice(appJs.indexOf("const REPORT_MSGS"), appJs.indexOf("window.markWinner"));
  assert(reportBlock.includes("window.reportPlay") && reportBlock.includes("window.sendReport") && reportBlock.includes("window.cancelReport"), "Round 6: report block located (reportPlay + sendReport + cancelReport)");
  assert(!reportBlock.includes("prompt(") && !reportBlock.includes("alert("), "Round 6: the report path uses NO native dialogs");
  assert(appJs.includes('onclick="reportPlay(${h.id})"') && appJs.includes("data-report-msg") && appJs.includes("REPORT_MSGS.get(h.id)"), "Round 6: the Report button opens the inline panel; cards render a per-card report slot from REPORT_MSGS");
  assert(reportBlock.includes("Report this play? The owner reviews every report.") && reportBlock.includes("Send report") && reportBlock.includes("Cancel"), "Round 6: the panel copy and both actions are present");
  assert(reportBlock.includes("/api/highlights/${id}/report") && reportBlock.includes('"Reported by a user"'), "Round 6: Send posts the same endpoint, an empty reason defaulting to 'Reported by a user'");
  assert(css.includes(".card-msg .report-reason textarea"), "Round 6: the report reason field is styled inside the card slot");
  const reportCalls = [];
  const reportSandbox = {
    window: {},
    api: async (p, opts) => { reportCalls.push({ path: p, body: JSON.parse(opts.body) }); if (p.includes("/99/")) throw new Error("Play not found."); return { message: "Thanks — the owner has been notified and will review this play." }; },
    esc: (s) => String(s ?? ""),
    $$: () => [],
    console,
  };
  const reportCtx = vm.createContext(reportSandbox);
  vm.runInContext(reportBlock, reportCtx);
  const reportMsgOf = (id) => vm.runInContext(`REPORT_MSGS.get(${id}) || ""`, reportCtx);
  reportSandbox.window.reportPlay(7);
  assert(reportMsgOf(7).includes("Send report") && reportMsgOf(7).includes("data-report-reason") && reportCalls.length === 0, "behavioral: tapping Report opens the inline panel (reason field + Send/Cancel) and posts nothing yet");
  reportSandbox.window.cancelReport(7);
  assert(reportMsgOf(7) === "" && reportCalls.length === 0, "behavioral: Cancel closes the panel and sends nothing (no trace)");
  const fakeBtn = (val) => ({ closest: () => ({ querySelector: () => ({ value: val }) }) });
  reportSandbox.window.reportPlay(7);
  await reportSandbox.window.sendReport(7, fakeBtn("  spam clip  "));
  assert(reportCalls.length === 1 && reportCalls[0].path === "/api/highlights/7/report" && reportCalls[0].body.reason === "spam clip", "behavioral: Send posts the trimmed reason to the same endpoint with the same payload shape");
  assert(reportMsgOf(7).includes("Thanks — the owner has been notified") && reportMsgOf(7).includes("ok"), "behavioral: the server's confirmation message shows inline on the card");
  await reportSandbox.window.sendReport(8, fakeBtn("   "));
  assert(reportCalls.length === 2 && reportCalls[1].body.reason === "Reported by a user", "behavioral: a blank reason still sends the default 'Reported by a user'");
  await reportSandbox.window.sendReport(99, fakeBtn("x"));
  assert(reportMsgOf(99).includes("Play not found.") && reportMsgOf(99).includes("err"), "behavioral: a server error shows inline on the card as an error, not an alert");
  // (3) The client SPORTS constant + cap() labels, run for real.
  const sportsBlock = appJs.slice(appJs.indexOf("const cap"), appJs.indexOf("const MONTHS"));
  const sportsCtx = vm.createContext({ console });
  vm.runInContext(sportsBlock, sportsCtx);
  assert(JSON.stringify(vm.runInContext("SPORTS", sportsCtx)) === JSON.stringify(["baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"]), "Round 6: the client SPORTS constant is the full 18, alphabetical with Other between Lacrosse and Soccer");
  for (const [k, label] of [["dance", "Dance"], ["golf", "Golf"], ["swimming", "Swimming"], ["tennis", "Tennis"], ["track", "Track & Field"], ["wrestling", "Wrestling"]])
    assert(vm.runInContext(`cap("${k}")`, sportsCtx) === label, `Round 6: cap("${k}") renders the label "${label}"`);

  /* ---- 22. Round 7 (2026-11-05, late): sample plays ----
     Owner-approved board seeding with AI-generated SAMPLE plays:
     a first-class is_sample flag. Samples render with a badge, can
     collect votes and feed the Hype Frame studio, but can NEVER
     enter the contest, be crowned, surface on the month board /
     podium, or take a Hall of Fame slot. The flag is set in ONE
     owner call ({status:"approved", sample:true}); the migration
     is the same idempotent ALTER pattern as every prior column. ---- */
  // (a) Structure: badge + explainer on the shared card renderer, the
  // Enter button hidden for samples, the client enter guard, the HoF
  // filter, the owner-queue actions, the CSS, and the truthful board
  // note (samples are HighlightHype demos, not family uploads).
  assert(appJs.includes("⭐ SAMPLE PLAY") && appJs.includes("Sample play — posted by HighlightHype to show how it works."), "Round 7: cards render the SAMPLE badge pill and the kid-readable explainer line");
  assert(appJs.includes('h.isSample ? "" : `<button type="button" class="mini-btn" onclick="enterContest'), "Round 7: the Enter button is not offered on sample cards");
  assert(appJs.includes("Sample plays can't enter Hype of the Month."), "Round 7: the client enter flow guards samples with the same message the server returns");
  assert(appJs.includes("[...ALL_PLAYS].filter((h) => !h.isSample)"), "Round 7: the Hall of Fame ranking filters samples out at its computation point");
  assert(appJs.includes("Approve as Sample play") && appJs.includes("Remove sample mark") && appJs.includes("window.setSample"), "Round 7: the owner queue carries Approve-as-Sample and Remove-sample-mark actions");
  assert(css.includes(".sample-badge"), "Round 7: the sample badge pill is styled");
  assert(home.includes("⭐ SAMPLE PLAY are demos posted by HighlightHype to show how it works") && !home.includes("every play here was uploaded by a family"), "Round 7: the board note is truthful with samples present (demos are HighlightHype's, not family uploads)");
  // (b) End-to-end against the real server (fresh DB — booting at all
  // proves the is_sample migration ran): upload -> ONE approve-as-
  // sample call -> isSample in the public payload + owner queue.
  const mkUp7 = async (fields) => {
    const f = new FormData();
    f.append("title", fields.title); f.append("sport", fields.sport); f.append("division", "boys"); f.append("playerName", fields.playerName);
    f.append("file", new Blob([png], { type: "image/png" }), "play.png");
    return j("/api/highlights", { method: "POST", body: f });
  };
  const upS = await mkUp7({ title: "Round 7 Sample Play", sport: "baseball", playerName: "Demo" });
  assert(upS.status === 201 && upS.body.status === "pending", "Round 7: the sample candidate uploads and starts pending");
  const sampleId = upS.body.id;
  const asSample = await j(`/api/highlights/${sampleId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved", sample: true }) });
  assert(asSample.body.status === "approved" && asSample.body.isSample === true, "Round 7: ONE owner call approves AND flags the play as a sample");
  const upR = await mkUp7({ title: "Round 7 Real Play", sport: "baseball", playerName: "Rea" });
  const realId = upR.body.id;
  const apprR = await j(`/api/highlights/${realId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(apprR.body.status === "approved" && apprR.body.isSample === false, "Round 7: a plain approve leaves the sample flag off (fresh-DB default 0)");
  const pub7 = await j("/api/highlights?division=all");
  const samplePub = pub7.body.highlights.find((h) => h.id === sampleId);
  const realPub = pub7.body.highlights.find((h) => h.id === realId);
  assert(samplePub && samplePub.isSample === true, "Round 7: isSample=true survives the public allowlist on the sample");
  assert(realPub && realPub.isSample === false, "Round 7: isSample=false on a real play");
  const queue7 = await j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  const sampleQ = queue7.body.queue.find((h) => h.id === sampleId);
  assert(sampleQ && sampleQ.isSample === true, "Round 7: the owner queue payload carries isSample so the UI can show the Sample tag/actions");
  // (c) Voting on a sample is ALLOWED (that's the demo) — and the
  // sample ends up with MORE votes than the real play.
  for (const vt of ["r7v1", "r7v2", "r7v3"]) {
    const v = await j(`/api/highlights/${sampleId}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: vt }) });
    assert(v.status === 200 && v.body.ok, `Round 7: vote ${vt} lands on the sample play`);
  }
  const vReal = await j(`/api/highlights/${realId}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "r7v1" }) });
  assert(vReal.status === 200 && vReal.body.voteCount === 1, "Round 7: the real play takes its one vote");
  const pub7b = await j("/api/highlights?division=all");
  const samplePub2 = pub7b.body.highlights.find((h) => h.id === sampleId);
  assert(samplePub2.voteCount === 3, "Round 7: the sample holds 3 votes — more than any real play here");
  // (d) Contest protection: enter refuses the sample with the exact
  // message; the real play still enters fine.
  const enterS = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: sampleId }) });
  assert(enterS.status === 400 && enterS.body.message === "Sample plays can't enter Hype of the Month.", "Round 7: entering a sample is refused with the exact message");
  const enterR = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: realId }) });
  assert(enterR.status === 201 && enterR.body.ok, "Round 7: a real play still enters the contest");
  // (e) Defensive layer: hand-insert a contest entry for the sample
  // straight into the DB (as if it somehow existed) — the month
  // board/podium query must still exclude it, and crowning it must
  // be refused.
  const period7 = new Date().toISOString().slice(0, 7);
  const dbFile7 = path.join(tmp, "highlighthype.db");
  const rawDb = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(dbFile7); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
  rawDb((d) => d.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(?,?)").run(sampleId, period7));
  const contest7 = await j("/api/contest");
  assert(!(contest7.body.entries || []).some((h) => h.id === sampleId), "Round 7: even with a hand-made entry row, the sample never surfaces on the month board / podium");
  assert((contest7.body.entries || []).some((h) => h.id === realId), "Round 7: the real entry still shows on the month board");
  const crownS = await j("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: sampleId, period: period7 }) });
  assert(crownS.status === 400 && crownS.body.message === "Sample plays can't enter Hype of the Month.", "Round 7: crowning a sample is refused defensively");
  rawDb((d) => d.prepare("DELETE FROM contest_entries WHERE highlight_id=? AND period=?").run(sampleId, period7));
  // (f) Hall of Fame: the ranking is computed client-side from
  // ALL_PLAYS — drive the REAL fameThumbHtml/renderFame block in a vm
  // with the served payloads (sample ahead 3-1 on votes) and prove
  // the sample is nowhere in the rendered list.
  const fameBlock7 = appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine"));
  const fameEl7 = { innerHTML: "" };
  const fameSandbox7 = {
    ALL_PLAYS: pub7b.body.highlights,
    $: () => fameEl7,
    esc: (s) => String(s ?? ""),
    cap: (s) => String(s ?? ""),
    console,
  };
  const fameCtx7 = vm.createContext(fameSandbox7);
  vm.runInContext(fameBlock7, fameCtx7);
  vm.runInContext("renderFame()", fameCtx7);
  assert(fameEl7.innerHTML.includes("Round 7 Real Play") && !fameEl7.innerHTML.includes("Round 7 Sample Play"), "Round 7: the Hall of Fame excludes the sample even though it has the most votes");
  // (g) Un-flagging: same endpoint, sample:false — the play keeps its
  // status and becomes a normal play again.
  const unflag = await j(`/api/highlights/${sampleId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved", sample: false }) });
  assert(unflag.body.status === "approved" && unflag.body.isSample === false, "Round 7: un-flagging removes the sample mark in the same call shape");
  const pub7c = await j("/api/highlights?division=all");
  assert(pub7c.body.highlights.find((h) => h.id === sampleId).isSample === false, "Round 7: the un-flagged play is served as a normal play");
  // (h) Migration on a LEGACY (pre-round-7) DB: a highlights table
  // with the original base schema and one approved row, no
  // is_sample column anywhere — a fresh server boot must add the
  // column idempotently and serve the row as a non-sample.
  const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-legacy-"));
  const legacyDb = new DatabaseSync(path.join(legacyDir, "highlighthype.db"));
  legacyDb.exec(`CREATE TABLE highlights(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, sport TEXT NOT NULL DEFAULT 'other',
    play_type TEXT DEFAULT '', player_name TEXT DEFAULT '', story TEXT DEFAULT '',
    media_kind TEXT NOT NULL, media_url TEXT NOT NULL, mime TEXT DEFAULT '',
    embed_url TEXT DEFAULT '', host_label TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO highlights(title,sport,media_kind,media_url,mime,status) VALUES('Legacy Play','baseball','file','/uploads/legacy.png','image/png','approved');`);
  legacyDb.close();
  const PORT7 = 3459;
  const child7 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT7), DATA_DIR: legacyDir }, stdio: "pipe" });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT7}/api/health`); break; } catch { await wait(200); } }
    const legacyPub = await (await fetch(`http://localhost:${PORT7}/api/highlights?division=all`)).json();
    const legacyRow = (legacyPub.highlights || []).find((h) => h.title === "Legacy Play");
    assert(legacyRow && legacyRow.isSample === false, "Round 7: a pre-round-7 DB migrates on boot — the legacy play serves with isSample=false");
  } finally {
    child7.kill();
    fs.rmSync(legacyDir, { recursive: true, force: true });
  }

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

