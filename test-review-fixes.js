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
import { inflateSync } from "node:zlib";
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
  for (const f of ["playType", "jersey", "team"]) assert(home.indexOf(`name="${f}"`) > moreAt, `optional field lives inside Add more: ${f}`);
  // Round 63 (2026-11-08): the story field MOVED OUT of "Add more"
  // into the main form as "What made this moment matter?" — Emil's
  // Hype Stories concept asks the question at submit time, with the
  // separate storyConsent permission checkbox beside it.
  assert(home.indexOf('name="story"') > -1 && home.indexOf('name="story"') < moreAt, "Round 63: story field lives in the main form, before Add more");
  assert(home.includes("What made this moment matter?") && home.includes('name="storyConsent"'), "Round 63: the moment question + story permission checkbox are in the form");
  // Round 6 (2026-11-05): the guardian-contact block MOVED OUT of
  // "Add more" into the main form — youth rerun v3's #1 finding was
  // that the contact deciding featuring sat hidden in a section
  // labelled optional. Full location/explainer coverage is in §21.
  for (const f of ["notifyEmail", "guardianPhone", "textConsent"]) assert(home.indexOf(`name="${f}"`) > -1 && home.indexOf(`name="${f}"`) < moreAt, `guardian field lives in the MAIN form, before Add more: ${f}`);
  assert(home.includes("Post a Play</button>"), "submit button reads 'Post a Play' (Round 123 one-label sweep; was 'Post my hype')");
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
  // →145: the server's upload dedupe hashes the file bytes, so a
  // shared 1×1 fixture uploaded twice inside the window is now
  // CORRECTLY answered as a retry. Fixtures that mean "a new play"
  // go through uniqPng(): a counter appended after the PNG's IEND
  // (the server stores bytes verbatim; nothing decodes the fixture)
  // makes each upload a distinct clip to the hasher.
  let uniqPngN = 0;
  const uniqPng = (buf) => Buffer.concat([buf, Buffer.from(`\nfixture-${++uniqPngN}`)]);
  const fd = new FormData();
  fd.append("title", "Review Fixes File Play");
  fd.append("sport", "baseball");
  fd.append("division", "boys");
  fd.append("playerName", "Nick");
  fd.append("guardianConsent", "on");
  fd.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
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
  assert(!home.includes('id="swagHint"') && !home.includes('id="swagPauseBtn"') && !home.includes('id="swagVideo"'), "Round 27: the swag film (hint pill, docked pause button, video element) is gone from the store view entirely — Hype Sports leads now (§36); the film file still backs the homepage entry-card teaser");
  assert(!home.includes('id="swagShopCard"') && !home.includes('id="sscBtn"') && !home.includes("ssc-kicker"), "Round 27: the film's pause-to-shop scene card left with the film (its scene map lives on in app.js, asserted below)");
  // Store v2 (2026-11-04): Emil asked for Overtime's chrome-free hero,
  // so the native control bar was removed then; Round 27 removes the
  // film element itself from the store.
  assert(!home.includes('id="swagVideo"'), "Round 27: no store film element at all (was: the v2 cinematic hero without native controls)");
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
  assert(!home.includes('id="sscTitle"'), "Round 27: the pause card's placeholder title is gone with the card");
  assert(!home.includes('data-store-block="boys"') && !home.includes('data-store-block="girls"') && !home.includes('id="collections"') && !home.includes('id="storeFocusBar"'), "Round 27: division blocks + grid anchor + focus bar are removed from the Store (Emil's resolutions supersede the blocks; §36 pins the new sections)");
  assert(appJs.includes('"pause"') && appJs.includes('"play"'), "card shows on pause and hides on play");
  const storeSection = home.slice(home.indexOf('id="shop"'));
  // Prices landed with the tonight additions (Emil, 2026-11-04, BL101
  // pattern): $69.99 + the youth size run, INSIDE the Store only.
  assert((storeSection.match(/\$69\.99/g) || []).length === 3, "Round 52: $69.99 shows exactly three times from the store on — the hoodies header's planned price, the product view and the Hot Pink quick view (it came off the six cards)");
  assert(storeSection.includes("YXXS · YXS · YS · YM · YL · YXL") && storeSection.includes("Youth sizes"), "youth size run shown in the Store (YXXS–YXL)");
  assert(home.includes('id="qvSizes"') && (home.match(/data-qv-size=/g) || []).length === 6, "quick view has the six-size tappable selector");
  assert(appJs.includes("qv-size"), "quick-view size selection wired (state only — no cart/checkout)");
  assert(!home.slice(0, home.indexOf('id="shop"')).includes("$69.99"), "no prices outside the Store (homepage + boards stay price-free)");
  assert(storeSection.includes("Ordering opens soon — no orders are being taken yet."), "store status line: 'Ordering opens soon' (drop-neutral since Round 35 — the quick view also serves the Drop 002 Hot Pink preview)");

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
  /* Round 20 (2026-11-06): the two LEAD cards (boys-street,
     girls-street) show the new MODEL photo as their primary image
     instead of the front lookbook photo; the front/back lookbook
     files remain on disk and still serve (the quick view keeps
     them after the lead model frame). */
  const LEAD_MODEL_SLUGS = ["boys-street", "girls-street"];
  /* Round 27 (2026-11-06) supersedes the card grid itself: the six
     Original Drop cards left the store with the division blocks.
     What survives of this section: the lookbook photo FILES still
     serve (the quick view's gallery is built from them, and the
     NEXT DROP teaser's Hot Pink card shows the girls-street model +
     back photos), and the QV data/wiring is untouched. */
  assert((home.match(/class="prod-card"/g) || []).length === 0, "Round 27: the Original Drop product cards are gone from the store (the grid is Hype Sports now — §36)");
  for (const slug of SLUGS) {
    if (LEAD_MODEL_SLUGS.includes(slug)) {
      assert(appJs.includes(`leadPhoto: "/swag/${slug}-model.jpg"`), `quick view for ${slug} still leads its gallery with the model photo (Round 20 data kept — the teaser's QV depends on it)`);
      const mr = await fetch(`${base}/swag/${slug}-model.jpg`);
      const mbuf = await mr.arrayBuffer();
      assert(mr.status === 200 && mbuf.byteLength > 5000, `model photo serves and is non-trivial: /swag/${slug}-model.jpg (${mbuf.byteLength} bytes)`);
    }
    for (const kind of ["front", "back"]) {
      const r = await fetch(`${base}/swag/${slug}-${kind}.jpg`);
      const buf = await r.arrayBuffer();
      assert(r.status === 200 && buf.byteLength > 5000, `real ${kind} photo serves and is non-trivial: /swag/${slug}-${kind}.jpg (${buf.byteLength} bytes)`);
    }
  }
  assert(home.includes("/swag/street-sunset.jpg"), "Round 27/59: the Drop 002 teaser shows the Hot Pink street hoodie — the cleaned-up sunset photo since Round 59 (was the soft girls-street-back.jpg)");
  assert(!home.includes("/swag-boards/"), "Round 2: cards no longer reference the flat board illustrations");
  assert(!home.includes("prod-photo"), "Round 27: the old card photo treatment class left with the cards");
  assert(!home.includes('class="look-board"'), "old stacked look-board markup is gone");
  assert(!home.includes("data-store-div=") && !home.includes("data-store-chip=") && !home.includes('class="store-controls"'), "division toggle + collection chips are gone (blocks replace filters)");
  assert(!home.includes('data-store-focus="boys"') && !home.includes('data-store-focus="girls"'), "Round 27: the block banners' focus buttons are gone with the blocks (the focus wiring stays dormant in app.js)");
  assert(!(home.match(/<article class="prod-card"[^>]*>/g) || []).some((t) => t.includes("hidden")), "no product card starts hidden on the landing (all six show)");
  assert(home.includes('id="quickView"') && home.includes('id="qvGallery"') && home.includes('id="qvSwatches"') && home.includes('id="qvColorName"'), "quick-view overlay present with the swipeable colorway gallery");
  assert((home.match(/data-flip/g) || []).length === 0, "Round 27: card flip toggles left with the Original Drop cards (Hype Sports cards show the front+back pair instead)");
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
     Nov 5 (2026-11-05): the film was made SILENT (music stripped),
     two scenes are back views, the floating hint pill is gone,
     and a real pause/play button is docked in the film's corner.
     Round 9 (2026-11-05): the silence is REVERSED — a quiet sound
     bed is back in the file (§8 probes it) with a speaker toggle
     beside Pause; autoplay still starts muted. Round 10: the bed
     was a stadium crowd and the controls row moved BELOW the film
     (§25). Round 11: Nicholas didn't like the crowd — the Round 9
     music bed is restored (§26); the controls stay below. */
  const filmTag = (home.match(/<video id="swagVideo"[^>]*>/) || [""])[0];
  assert(filmTag === "" && !home.includes('class="swag-film swag-film-hero"'), "Round 27: the store film hero is gone from the markup (was: muted autoplay loop, full-bleed) — the Hype Sports hero leads instead (§36)");
  const css = await text("/styles.css");
  assert(css.includes(".swag-film-hero") && css.includes("100vw"), "styles.css bleeds the hero edge-to-edge (100vw)");
  assert(!css.includes(".film-toggle") && !css.includes(".store-tile") && !css.includes(".store-controls"), "styles.css: round toggle, nav tile and filter-control rules are gone");
  assert(css.includes(".store-banner") && css.includes('body[data-store-focus="boys"]') && css.includes('body[data-store-focus="girls"]'), "styles.css carries the banner + focus-mode rules");
  assert(!home.includes('data-hero-shop="girls"') && !home.includes('data-hero-shop="boys"'), "Round 27: the film overlay's Shop Girls / Shop Boys link-buttons are gone with the film");
  assert(!home.includes('id="swagPlayBtn"') && !appJs.includes("swagPlayBtn"), "round outline pause/play button removed from markup and JS");
  assert(appJs.includes("sv.muted = true") && !appJs.includes("sv.muted = false"), "the film is silent (Nov 5): entering the Store keeps it muted — the unmute-on-gesture logic is gone");
  assert(!home.includes('id="swagShopCard"') && !home.includes('id="sscBtn"'), "Round 27: the pause-to-shop scene card is gone with the film");
  for (const side of ["girls", "boys"]) {
    const r = await fetch(`${base}/swag/tile-${side}.jpg`);
    const buf = await r.arrayBuffer();
    assert(r.status === 200 && buf.byteLength > 5000, `division banner photo still serves (asset kept on disk): /swag/tile-${side}.jpg (${buf.byteLength} bytes)`);
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
  const shopIdx = home.indexOf('id="shop"'), heroIdx = home.indexOf('id="hsHero"'), headIdx = home.indexOf("shop-head");
  assert(heroIdx > shopIdx && headIdx === -1 && !home.includes("swag-film-hero"), "Round 27: the Hype Sports hero is the first element of the Store; the film hero and the old shop-head are gone");
  const boysBlockIdx = home.indexOf('data-store-block="boys"'), girlsBlockIdx = home.indexOf('data-store-block="girls"'), creativeIdx = home.indexOf('class="hf-creative"');
  assert(boysBlockIdx === -1 && girlsBlockIdx === -1 && creativeIdx === -1, "Round 27: no division blocks and no hf-creative panel remain in the store (landing order for the new sections is pinned in §36)");
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
  assert(filmStreams.includes("video") && filmStreams.includes("audio"), "Round 11: the film HAS an audio stream — the quiet MUSIC bed is back (Round 10's stadium crowd, Nicholas's own suggestion, was reverted at his verdict; §26 probes the restored file)");
  const filmPix = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=pix_fmt", "-of", "csv=p=0", filmFile]).toString().trim();
  assert(filmPix === "yuv420p", "Round 9: the film's video stream is still yuv420p (the audio mux did not touch the picture)");
  const filmVol = execFileSync("bash", ["-c", `ffmpeg -i "${filmFile}" -map 0:a -af volumedetect -f null - 2>&1 | grep mean_volume`]).toString();
  const filmMeanDb = Number((/mean_volume:\s*(-?[\d.]+)/.exec(filmVol) || [])[1]);
  assert(filmMeanDb < -20 && filmMeanDb > -35, `Round 11: the film's music bed is QUIET (mean ${filmMeanDb} dB — background, not a soundtrack)`);
  assert((home.match(/poster="\/swag-poster-v6\.jpg"/g) || []).length === 0, "Round 27/55: no film tag keeps the v6 poster — the store's left in Round 27, and the homepage entry-card teaser left in Round 55 when Rep The Hype became a photo band (the film file stays on the server)");
  /* Scene table integrity: exactly the five new scenes, on the
     assembled film's measured boundaries, and none of the old film's
     scenes (title card / Hype All Day / division & end cards) remain. */
  const scenesBlock = appJs.slice(appJs.indexOf("FILM_SCENES"), appJs.indexOf("];", appJs.indexOf("FILM_SCENES")));
  assert((scenesBlock.match(/until:/g) || []).length === 5, "scene table has exactly 5 scenes");
  assert(!scenesBlock.includes("Hype All Day") && !scenesBlock.includes("hype-girls") && !scenesBlock.includes("hype-boys") && !scenesBlock.includes("coordinating") && !scenesBlock.includes("collections"), "no old-film scene targets remain in the scene table");
  assert(!appJs.includes("The Hype All Day hoodie") && !appJs.includes("Drop 001 — the full drop"), "old title-card / statement-hoodie scene copy is gone from app.js");
  assert(appJs.includes('data-slug="${target}"') || appJs.includes("data-slug="), "scene button resolves its target card by slug (goToStoreScene)");
  /* Hype Frame in the store, Round 27: the big creative panel
     (layered prints, steps, garment mock) left with the hypeframe
     focus state; the store now carries the compact feature —
     headline, one line, guardian framing, the finished-hoodie
     example photo, and the same CTA into the plays. */
  assert(!home.includes('class="hf-creative"') && home.includes('id="hsHfFeature"') && !home.includes("hypeframe-banner") && !home.includes("hf-steps-strip"), "Round 27: the in-store Hype Frame feature replaces the creative panel");
  assert(!home.includes('class="hfc-print') && !home.includes('class="hfc-garment"'), "Round 27: the layered-print creative (moment/hoodie prints, garment mock) is out of the store");
  const hfcRes = await fetch(`${base}/swag/hf-example-hoodie-back.jpg`);
  const hfcBuf = await hfcRes.arrayBuffer();
  assert(hfcRes.status === 200 && hfcBuf.byteLength > 5000, `the feature's finished-hoodie example serves and is non-trivial: /swag/hf-example-hoodie-back.jpg (${hfcBuf.byteLength} bytes)`);
  assert(home.includes("Your moment.") && home.includes("Your hype.") && home.includes("Turn your highlight"), "manifesto line stays on the page (hero) and the studio keeps the poster tagline");
  assert(css.includes(".hf-creative{display:grid") && css.includes("border-top:1px solid var(--line)"), "creative is styled for the dark store (v2 palette, unscoped by .store-light)");
  assert(home.includes("Freeze a frame from your own highlight video — and wear it."), "feature subline: freeze a frame from your own highlight video — and wear it");
  for (const step of ["Your Play. Your", "Hoodie.", "Create a Hype Frame"]) assert(home.includes(step), `Round 27 Hype Frame feature includes: ${step}`);
  assert(home.includes('class="hfc-cta hs-hf-cta"') && home.includes("Create a Hype Frame"), "creative CTA: 'Create a Hype Frame' (Round 59: the store feature's link carries the purple-underline class from Emil's mock)");
  const hfCreative = home.slice(home.indexOf('id="hsHfFeature"'), home.indexOf('id="quickView"'));
  assert(!hfCreative.includes("$"), "Hype Frame feature stays price-free (prices live on the product cards only)");
  assert(hfCreative.includes('href="#deck"') && hfCreative.includes('data-hf-start') && !hfCreative.includes('data-tablink'), "Round 86 (supersedes the old banner-button pin): the creative CTA opens the Hype Frame choice card (data-hf-start) instead of landing on the plays board — the studio starts from a play, so the button offers sample vs own video");
  assert(hfCreative.includes("parent or guardian confirms by email before anything is printed"), "creative keeps the guardian-approval framing (no payment/checkout language)");

  /* ---- Store v6: film at the very top under the floating nav,
     Boys first + Boys default (Emil, 2026-11-04 night) ---- */
  assert(css.includes("body.store-open .nav{position:absolute;top:0;background:transparent"), "in the Store the nav floats over the film, homepage-style (logo on the video)");
  assert(!css.includes("body.store-open .nav{position:relative"), "the old solid in-flow store nav bar is gone");
  assert(css.includes("body.store-open .shop{padding-top:0;border-top:0}"), "Store view starts at the very top — no padding or border above the film");
  const barIdx = home.indexOf("store-bar");
  assert(barIdx > shopIdx && barIdx < heroIdx, "Round 27: store bar (Back + breadcrumb) sits at the top of the store, above the Hype Sports hero");
  assert(css.includes(".swag-film-hero .swag-film-badge{top:82px") && !home.includes('id="swagHint"') && !css.includes(".swag-film-hint"), "film badge drops below the floating nav line; the floating hint pill is fully removed (Nov 5)");
  assert(css.includes(".swag-pause-btn{position:absolute;right:16px;bottom:16px"), "the docked pause-button rule stays in styles.css (Nov 5) — the film it served left the store in Round 27");
  assert(css.includes("body:not([data-store-focus]) .store-block .prod-grid{display:none"), "doors landing (Nov 5): division products stay collapsed until a door opens the division");
  assert((home.match(/class="prod-colors"/g) || []).length === 0 && (home.match(/class="prod-dot"/g) || []).length === 0, "Round 27: colorway dots left with the Original Drop cards (was: 6 cards x 4 colorways)");
  assert(home.includes('id="qvSides"') && home.includes('data-qv-side="0"') && home.includes('data-qv-side="1"') && appJs.includes("qv-side-btn"), "quick view has explicit FRONT / BACK buttons (colors + sides reachable without swiping)");
  assert(appJs.includes("const storeState = { focus: null }"), "store starts unfocused (full landing: film, Boys, Girls, Hype Frame)");
  assert(!home.includes("data-hero-shop"), "Round 27: film overlay Shop Boys/Girls links are gone with the film");
  assert(!home.includes("data-store-focus"), "Round 27: banner focus buttons are gone with the blocks");
  assert(!home.includes('data-store-target="hype-boys"') && !home.includes('data-store-target="hype-girls"') && home.includes('id="merchTeaser125"') && !home.includes('class="rep-band"'), "Round 55→125: the homepage store entry is the price-free merch teaser now (the Rep The Hype photo band retired in Round 125) — the old card's Hype Boys/Girls quick links stay gone (divisions are entered inside the Store)");
  const cardTag = (slug) => (home.match(new RegExp(`<article class="prod-card"[^>]*data-slug="${slug}"[^>]*>`)) || [""])[0];
  for (const slug of SLUGS) assert(cardTag(slug) === "", `Round 27: no Original Drop card remains in the markup: ${slug}`);

  /* ---- 9. Tonight batch: logo, hero, proof removal, share, autoplay --
     Emil (2026-11-04 night): (1) the logo's black JPEG box showed on
     bright film frames — it is now a transparent PNG everywhere it
     sits over video; (2) the hero's logo ending is cut and a golf
     scene closes the film instead; (12) "What's on the line" is
     removed, its two useful lines folded into How it works;
     (17) Share uses the native sheet + deep links that land on the
     play from any view; (9) board videos autoplay. */
  assert(home.includes('href="/logo-header-gold.png?v=118"'), "logo preload points at the crest header lockup (Round 19; Round 97: right-sized copy; Round 114: metallic gold master art; Round 115: full-color rebuild, cache-busted ?v=118)");
  assert((home.split('src="/logo-header-gold.png?v=118"').length - 1) === 1, "header uses the horizontal crest lockup (Round 19; Round 97: right-sized copy; Round 114: metallic gold master art; Round 115: full-color rebuild, cache-busted ?v=118)");
  assert(home.includes('src="/logo-lockup-gold.jpg"'), "footer uses the full lockup with tagline (Round 19; Round 65: Emil's metallic gold master)");
  assert(home.includes('href="/favicon.ico"') && home.includes('href="/favicon.png"'), "favicon is the gold crest badge (Round 19)");
  const logoRes = await fetch(`${base}/logo-header-gold.png?v=118`);
  const logoBuf = Buffer.from(await logoRes.arrayBuffer());
  assert(logoRes.status === 200 && logoBuf.subarray(1, 4).toString() === "PNG" && logoBuf.byteLength > 5000, `crest header lockup serves as a real PNG (${logoBuf.byteLength} bytes)`);
  assert(!css.includes("mix-blend-mode:screen"), "the screen-blend workaround is gone (real transparency now)");
  assert(!home.includes('data-panel-btn="proof"') && !home.includes('id="proof"') && !appJs.includes("proof") && !css.includes(".proof"), "What's on the line is gone: menu button, panel, JS and CSS");
  const howPanel = home.slice(home.indexOf('data-panel="how"'), home.indexOf('id="owner"'));
  assert(howPanel.includes("What's on the line") && howPanel.includes("parent or guardian") && howPanel.includes("featured on the homepage") && howPanel.includes("shoutout on HighlightHype socials"), "How it works carries the folded lines (contest + bragging-rights prize + guardian contact)");
  assert(!home.includes("free piece") && !home.includes("claims the Drop 001 piece"), "no swag/merch prize promised anywhere on the homepage");
  assert(appJs.includes("navigator.share") && appJs.includes('title: "HighlightHype"'), "sharePlay uses the native share sheet when available");
  assert(appJs.includes('switchView("all")') && appJs.includes("#play-"), "deep links land on the play (All Hypes hosts the tiles; a #play- link opens the play's detail — Round 8, §23)");
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
  assert(appJs.includes("qvGalleryState.photos + Number(b.dataset.qvColor) * 2"), "swatch jumps account for the leading photo frames (2, or 3 with a Round 20 lead model frame)");
  assert(appJs.includes("(qvGalleryState.photos || 2) - 1"), "FRONT/BACK buttons target the photo frames (BACK = last photo frame, incl. the Round 20 lead)");
  // Homepage Hype Frame finished-product examples (poster crops).
  assert(!home.includes('id="hfExamplesHome"') && !home.includes('id="hfExamples"'), "Round 125: the homepage Hype Frame examples strip is GONE (Dyanna's board-first homepage — the mid-feed banner + the menu carry Hype Frame now); Round 27: the store's gated #hfExamples copy left with the hypeframe focus panel");
  assert(home.includes("/swag/hf-example-hoodie-back.jpg") && !home.includes("/swag/hf-example-lineup.jpg"), "examples: the hoodie-back crop still illustrates the Store feature's example strip; the lineup crop left the page in Round 127 with the studio payoff stack (its file still serves — asserted below)");
  assert(!home.includes("Pick a moment. Put it on a hoodie."), "Round 44→125: the homepage Hype Frame head and its concept line left with the section (the studio keeps its own head; the mid-feed banner carries the concept on the homepage now)");
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
  assert(appJs.includes('$$(".brand").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); goHome(); }));'), "every .brand logo (header + footer) is bound to goHome() (→132: the handler now prevents the #top anchor jump so goHome's Watch-board landing sticks)");
  assert(appJs.includes("function goHome()") && appJs.includes('showPanel("plays")'), "goHome() resets to the plays board (the homepage)");
  assert(home.includes('data-home-link') && home.includes("← Back to homepage"), "store landing carries a Back-to-homepage button (data-home-link -> goHome)");
  assert(!home.includes('id="storeFocusExit"'), "Round 27: the focus-bar exit left with focus mode — the store's back route is the store bar's Back-to-homepage button (asserted above)");
  assert((home.match(/data-panel-btn="plays"/g) || []).length === 2, "athlete + studio panels carry a Back-to-the-board button (Round 29: the menu's Plays button is gone — the count drops from 3 to exactly these two)");
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
     mid-flow.
     Round 121 (2026-11-12) rewires WHAT the flow does: the old
     one-tap enter (and its "Enter anyway" door for contact-less
     plays) let any visitor enter anyone's play. Now the button
     opens an inline guardian confirm — the email used to post the
     play — and submitContestEntry posts { highlightId, email };
     the server does the matching. Plays with no guardian email
     don't render the button (asserted on cardHtml below), the
     owner enters directly (api rides the owner token), and the
     assertions here drive the new flow end to end. ---- */
  const enterBlock = appJs.slice(appJs.indexOf("const ENTER_MSGS"), appJs.indexOf("window.reportPlay"));
  assert(enterBlock.includes("window.enterContest") && enterBlock.includes("submitContestEntry"), "enter flow block located (enterContest + submitContestEntry)");
  assert(!enterBlock.includes("confirm(") && !enterBlock.includes("alert("), "the enter path uses NO native dialogs (confirm/alert gone from the whole enter flow)");
  assert(appJs.includes('onclick="enterContest(${h.id}, this)"'), "the Enter button still calls enterContest from the card");
  assert(appJs.includes('class="card-msg"') && appJs.includes("data-enter-msg"), "cards render the per-card enter message slot");
  assert(appJs.includes("ENTER_MSGS.get(h.id)") && appJs.includes("ENTER_MSGS.has(h.id)"), "cardHtml renders the slot from ENTER_MSGS (re-render safe, exactly one slot per card)");
  assert(enterBlock.includes("Parents/guardians: enter the email you posted this play with to enter it.") && enterBlock.includes('name="guardianEmail"'), "Round 121: the inline confirm asks for the posting email, in plain words");
  assert(!enterBlock.includes("Enter anyway") && !appJs.includes("enterContestAnyway"), "Round 121: the 'Enter anyway' door is closed everywhere — that was the hole");
  assert(enterBlock.includes("can't be entered online") && enterBlock.includes("no guardian email is on file"), "Round 121: a play with no guardian email explains instead of posting");
  assert(enterBlock.includes('api("/api/contest/enter"') && enterBlock.includes("highlightId: id") && enterBlock.includes("payload.email = email"), "Round 121: the enter POST carries highlightId + the guardian email the server matches");
  assert(enterBlock.includes("await loadData()"), "a successful enter still refreshes the board (loadData)");
  assert(appJs.includes('!h.hasGuardianEmail && !ownerToken()'), "Round 121: cards/watch render NO Enter button for a play with no guardian email on file (owner excepted)");
  assert(css.includes(".card-msg{") && css.includes(".card-msg[hidden]{display:none}"), "the enter slot is styled, with an explicit [hidden] guard");
  // Behavioral: run the real enter block in a vm with stubbed api /
  // DOM and drive the Round 121 paths (no-email refusal, the
  // guardian form, a matched enter, a server refusal).
  const enterCalls = [];
  const enterSandbox = {
    window: {},
    ALL_PLAYS: [
      { id: 41, hasGuardianEmail: false, hasGuardianText: false, hasGuardianPhone: false },
      { id: 42, hasGuardianEmail: true, hasGuardianText: false, hasGuardianPhone: false },
      { id: 43, hasGuardianEmail: true, hasGuardianText: false, hasGuardianPhone: false },
      { id: 44, hasGuardianEmail: false, hasGuardianText: false, hasGuardianPhone: true },
    ],
    CONTEST: { period: "2026-11", entries: [], winnerId: null },
    ownerToken: () => "",
    __form: null,
    api: async (p, opts) => {
      const body = JSON.parse(opts.body);
      enterCalls.push({ path: p, body });
      if (body.highlightId === 43) throw new Error("That email doesn't match the one used to post this play — try the one you posted with.");
      return { message: "🏆 Entered! Good luck." };
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
  const fakeForm = (email) => ({ guardianEmail: { value: email } });
  enterSandbox.window.enterContest(41);
  assert(enterCalls.length === 0, "behavioral (Round 121): a no-guardian-email tap does NOT post — it can't be entered online");
  assert(enterMsgOf(41).includes("can't be entered online") && enterMsgOf(41).includes("no guardian email is on file"), "behavioral (Round 121): the no-email explanation is stored for the card slot");
  enterSandbox.window.enterContestDismiss(41);
  assert(enterMsgOf(41) === "", "behavioral: Not now dismisses the message");
  enterSandbox.window.enterContest(44);
  assert(enterCalls.length === 0 && enterMsgOf(44).includes("can't be entered online"), "behavioral (Round 121): a PHONE-ONLY play can't enter by email either — no form, no post");
  enterSandbox.window.enterContest(42);
  assert(enterCalls.length === 0, "behavioral (Round 121): a guardian-email play does NOT post on the first tap — the confirm form opens");
  assert(enterMsgOf(42).includes("Parents/guardians: enter the email you posted this play with") && enterMsgOf(42).includes('name="guardianEmail"') && enterMsgOf(42).includes("Not now"), "behavioral (Round 121): the inline form (email field + Enter + Not now) is stored for the card slot");
  enterSandbox.__form = fakeForm("guardian@example.com");
  await vm.runInContext("submitContestEntry(42, __form)", enterCtx);
  assert(enterCalls.length === 1 && enterCalls[0].path === "/api/contest/enter" && enterCalls[0].body.highlightId === 42 && enterCalls[0].body.email === "guardian@example.com", "behavioral (Round 121): submitting the form posts highlightId + the typed email");
  assert(enterMsgOf(42).includes("🏆 Entered! Good luck."), "behavioral (Round 121): the server's success message lands inline on the card");
  enterSandbox.window.enterContest(43);
  enterSandbox.__form = fakeForm("wrong@example.com");
  await vm.runInContext("submitContestEntry(43, __form)", enterCtx);
  assert(enterCalls.length === 2 && enterCalls[1].body.email === "wrong@example.com", "behavioral (Round 121): a wrong email still posts — the SERVER decides the match");
  assert(enterMsgOf(43).includes("doesn't match the one used to post") && enterMsgOf(43).includes("err"), "behavioral (Round 121): the server's mismatch refusal shows inline on the card as an error, not an alert");

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
  assert(hfDoorIdx === -1 && !home.includes("data-store-block="), "Round 27: all three store doors (Boys / Girls / Hype Frame) are gone from the store view — Hype Frame's store presence is the in-store feature (§36)");
  assert(!home.includes("data-store-focus="), "Round 27: no focus controls remain in the store markup (the app.js focus wiring below is dormant)");
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
  assert(hfFilmDur > 8 && hfFilmDur < 12, `the Hype Frame film runs ~10s (${hfFilmDur}s) — Round 58's single-morph loop (was the ~14s tour)`);
  const hfFilmSize = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", hfFilmFile], { encoding: "utf8" }).trim();
  assert(hfFilmSize === "1280,720", `the Hype Frame film is 1280x720 (${hfFilmSize})`);
  const doorRes = await fetch(`${base}/swag/hf-door.jpg`);
  assert(doorRes.status === 200 && Number(doorRes.headers.get("content-length")) > 10000, "the door banner image serves");
  // Item 7 structural fix: the examples block lives INSIDE the home
  // (plays) panel now, so panel views no longer trail it.
  const playsIdx = home.indexOf('data-panel="plays"'), mineIdx = home.indexOf('data-panel="mine"');
  assert(playsIdx > -1 && mineIdx > playsIdx && home.indexOf('id="hfExamplesHome"') === -1, "Round 125: no homepage examples block anywhere — the plays panel runs board -> upload form with no Hype Frame section trailing it");
  assert(!home.includes("hf-hero-fig"), "Round 44/48→125: the homepage Hype Frame hero figure and its click-to-play film cover left with the section (the hype-frame film itself still plays in the store + studio)");
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
  assert(!home.includes('id="hfExamplesHome"') && !home.includes('class="hf-examples hf-examples-studio"'), "Round 4→125/127: the studio examples block is GONE in Round 127 (the studio opens at the freeze tool); the homepage block's hook stays retired (neither is gated by the store rule)");
  // (1c) Wiring: both the door button and a tap anywhere on the
  // banner route hypeframe to the panel; the focus bar (with its
  // exit) is the panel chrome and the back path.
  assert(appJs.includes('if (b.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }') && appJs.includes('if (btn.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }'), "Round 4: door button AND banner tap both route hypeframe to openStoreHf");
  assert(appJs.includes('div === "hypeframe" ? "Hype Frame"'), "Round 4: the focus bar titles the panel 'Hype Frame'");
  assert(appJs.includes('$("#storeFocusExit")') && appJs.includes("setStoreFocus(null)"), "Round 4: the focus-bar exit clears the focus (back to the doors landing)");
  assert(!appJs.includes('$$("[data-hf-door]")') && !appJs.includes('$$(".store-banner-hf")'), "Round 4: the old scroll-to-creative door handlers are gone");
  // (1d) The panel's CTA wiring into the studio path. Round 86
  // supersedes the Round 3/4 data-tablink-to-plays wiring: the link
  // opens the Hype Frame choice card (data-hf-start), because the
  // studio starts from a play and the bare board landing was a
  // dead end (kid-experience feedback, 2026-11-09).
  const hfCreativeSlice = home.slice(home.indexOf('id="hsHfFeature"'), home.indexOf('id="quickView"'));
  assert(hfCreativeSlice.includes('class="hfc-cta hs-hf-cta"') && hfCreativeSlice.includes('data-hf-start') && !hfCreativeSlice.includes('data-tablink') && hfCreativeSlice.includes("Create a Hype Frame"), "Round 86 (supersedes Round 27/59): the in-store feature's 'Create a Hype Frame' CTA opens the choice card (data-hf-start)");
  // (2) The new film: same slot facts as Round 3 (serves, ~13-15s,
  // 1280x720) — asserted in section 16 above against the live file;
  // its composition is the sweatshirt-player build (see DEPLOY-NOTES).


  /* §18 Round 4 fix (2026-11-05): showStore() pauses every .view-home
     video; an explicitly paused video never auto-resumes, so the Hype
     Frame films are restarted explicitly — studio film on studio open,
     homepage film on return home. */
  assert("18.1 (Round 48) showHome does NOT resume any homepage Hype Frame film — it is click-to-play now (Emil: no autoplay competing with the hero)",
    !appJs.includes('$("#hfExamplesHome video")'));
  assert("18.2→127 openHypeFrame no longer plays a studio film — the film left with the payoff stack in Round 127 (the studio opens at the tool)",
    !appJs.includes("#hypeframe .hf-film video") && !/hfFilm\.play\(\)/.test(appJs));

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
    appJs.slice(ddStart, appJs.indexOf("/* ---------------- Swag film", ddStart));
  assert(ddBlock.includes("function renderSportSelect") && ddBlock.includes("function syncFilterUI") && ddBlock.includes("function divMatch"), "Round 5: dropdown test block located (SPORTS + divMatch + sportsInData/renderSportSelect/syncFilterUI)");
  const mkSelect = () => ({ innerHTML: "", value: "", onchange: null });
  const monthSel = mkSelect(), allSel = mkSelect(), fameSel = mkSelect();
  let monthRenders = 0, allRenders = 0;
  const ddSandbox = {
    window: {},
    cap: (s) => { if (s === "fieldhockey") return "Field Hockey"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
    CONTEST: { period: "2026-11", winnerId: null, entries: [
      { sport: "baseball", division: "boys" }, { sport: "hockey", division: "girls" } ] },
    ALL_PLAYS: [
      { sport: "baseball", division: "boys" }, { sport: "soccer", division: "girls" }, { sport: "baseball", division: "girls" } ],
    monthDiv: "boys", monthSport: "all", allDiv: "all", allSport: "all",
    $: (sel) => sel === "#monthSportSelect" ? monthSel : sel === "#allSportSelect" ? allSel : sel === "#fameSportSelect" ? fameSel : null,
    $$: () => [],
    renderMonth: () => { monthRenders++; },
    renderAll2: () => { allRenders++; },
    console,
  };
  const ddCtx = vm.createContext(ddSandbox);
  vm.runInContext(ddBlock, ddCtx);
  vm.runInContext("syncFilterUI()", ddCtx);
  assert(monthSel.innerHTML.includes('<option value="all"') && monthSel.innerHTML.includes(">Baseball<") && monthSel.innerHTML.includes("Hockey"), "behavioral: month dropdown = All sports + every sport in the contest, whatever the stored division (→132: one combined contest — pre-132 the list was scoped to the Boys toggle and girls' hockey stayed out)");
  assert(fameSel.innerHTML === monthSel.innerHTML, "behavioral: the Hall of Fame dropdown mirrors the Month dropdown exactly (→134: one shared contest sport state, two selects)");
  assert(allSel.innerHTML.includes(">Baseball<") && allSel.innerHTML.includes(">Soccer<") && !allSel.innerHTML.includes("Hockey"), "behavioral: All dropdown = All sports + every sport with an approved play (baseball + soccer)");
  allSel.value = "soccer"; allSel.onchange();
  assert(vm.runInContext("allSport", ddCtx) === "soccer" && allRenders === 1, "behavioral: choosing Soccer in the All dropdown sets that view's filter and re-renders it");
  assert(vm.runInContext("monthSport", ddCtx) === "all" && monthSel.value === "all" && monthRenders === 0, "behavioral: the month view is untouched by the All dropdown (independent state, kept in sync on reload)");
  monthSel.value = "baseball"; monthSel.onchange();
  assert(vm.runInContext("monthSport", ddCtx) === "baseball" && monthRenders === 1 && vm.runInContext("allSport", ddCtx) === "soccer", "behavioral: the month dropdown filters its own view only; the All filter survives");
  // (3b) Behavioral — renderFame from the real app.js: video plays
  // (file + link) render a playing <video>, image plays keep <img>,
  // embeds keep the sport-name fallback, every row taps to its card.
  // →134: Fame rows no longer carry a video thumb at all — the row
  // shows the play's POSTER (posterUrlFor134: image plays wear
  // their own file; video plays their resolved poster) with a play
  // icon, the athlete-led short title, and a compact votes pill.
  // fameThumbHtml itself is unchanged (the Watch tiles keep it).
  const fameBlock = appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine"));
  assert(fameBlock.includes("function renderFame") && fameBlock.includes("goToPlayCard"), "Round 5: fame test block located (fameThumbHtml + renderFame)");
  const fameListStub = { innerHTML: "" };
  const fameSandbox = {
    window: {},
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    cap: ddSandbox.cap,
    /* →134: renderFame's new deps — the shared contest sport
       state, the athlete-led name, the short-title helper, and
       the poster resolver's bank (the real shortTitle is pinned
       in §45(f); these fixtures' titles carry no sentence
       punctuation, so the pass-through stub is exact here). */
    monthSport: "all",
    firstNameOf: (h) => (h.player_name || "").split(" ")[0],
    shortTitle: (t) => String(t || ""),
    btlPosterFor118: (url) => (url ? "POSTER:" + url : ""),
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
  assert(fameHtml.includes('<img src="POSTER:/uploads/v.mp4"') && fameHtml.includes("fame-play134") && !fameHtml.includes("<video"), "behavioral: an uploaded-file video play gets its POSTER as the Hall of Fame thumbnail, play icon on it (→134: poster thumb, no playing video in the row)");
  assert(fameHtml.includes('<img src="POSTER:https://cdn.example/v.mp4"'), "behavioral: a link-video play gets the same poster-thumbnail treatment (→134)");
  assert(fameHtml.includes('<img src="/uploads/i.png"') && !fameHtml.includes('<video src="/uploads/i.png"'), "behavioral: an image play keeps its photo (no video element)");
  const embedRow = fameHtml.slice(fameHtml.indexOf("Embed Play") - 200);
  assert(!embedRow.includes("<video") && !embedRow.includes("<iframe") && embedRow.includes("Cheer"), "behavioral: an embed play keeps the sport-name fallback (no fake video)");
  assert(fameHtml.indexOf("File Vid") < fameHtml.indexOf("Photo Play") && fameHtml.indexOf("Photo Play") < fameHtml.indexOf("Link Vid"), "behavioral: fame rows stay ranked by all-time votes");
  for (const pid of [11, 12, 13, 14]) assert(fameHtml.includes(`onclick="goToPlayCard(${pid})"`), `behavioral: fame row for play ${pid} taps through to its card`);
  // (3c) Behavioral — goToPlayCard wiring (Round 8): the Hall of
  // Fame tap now opens the play's DETAIL (the full card in the
  // overlay) instead of Round 5's reset-filters + flash + scroll to
  // the All-board card; §23 covers the detail itself end to end.
  const gtcBlock = appJs.slice(appJs.indexOf("window.goToPlayCard"), appJs.indexOf("/* ---------------- athlete collection"));
  assert(gtcBlock.includes("openPlayDetail(id)") && !gtcBlock.includes("#allBoard [data-play-id="), "Round 8: goToPlayCard block located (opens the play detail; the scoped board-card lookup is gone)");
  const gtcCalls = [];
  const gtcSandbox = {
    window: {},
    showHome: () => gtcCalls.push("showHome"),
    showPanel: (n) => gtcCalls.push("panel:" + n),
    openPlayDetail: (id) => gtcCalls.push("detail:" + id),
    console,
  };
  const gtcCtx = vm.createContext(gtcSandbox);
  vm.runInContext(gtcBlock, gtcCtx);
  gtcSandbox.window.goToPlayCard(7);
  assert(gtcCalls.join("|") === "showHome|panel:plays|detail:7", "behavioral: a fame tap leaves the store, lands on the plays panel and opens the play's detail");

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
  assert(JSON.stringify(optVals) === JSON.stringify(["", "baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "martialarts", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"]), "Round 6: the form sport select = placeholder (value \"\") + the FULL sport list (19 since Round 35 added Martial Arts — the audit found the form had drifted from SPORTS), alphabetical with Other in its Lacrosse–Soccer slot");
  assert(optLabels[0] === "Choose a sport" && optLabels[3] === "Cheer" && optLabels[4] === "Dance" && optLabels[5] === "Field Hockey" && optLabels[11] === "Martial Arts" && optLabels[17] === "Track &amp; Field" && optLabels[19] === "Wrestling", "Round 6: placeholder reads 'Choose a sport'; option labels carry display names (Martial Arts for the martialarts key, Track & Field for the track key, Wrestling last)");
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
  assert(home.includes("Parent or guardian — needed to win") && home.includes("Email or mobile — either one is enough.") && home.includes("We only use it to contact the winner's parent or guardian") && home.includes("You can still post with neither; your play just can't be featured until we have one."), "Round 6+9: the guardian block carries the plain-language eligibility explainer (Round 9: email OR mobile — either one is enough; posting with neither still allowed, just not featureable)");
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
    f.append("guardianConsent", "on"); // Round 21: attestation is required; guardian CONTACT stays the optional thing under test here
    f.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
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
  assert(playA && playA.hasGuardianEmail === false && playA.hasGuardianText === false && playA.hasGuardianPhone === false, "Round 6: the no-guardian play reports no guardian contact on file (Round 9: hasGuardianPhone false too)");
  assert(playB && playB.sport === "wrestling" && playB.hasGuardianEmail === true, "Round 6: the wrestling play is served with sport=wrestling and its guardian email on file");
  for (const u of [upA, upB]) {
    // Round 121: entry is gated (guardian email or owner) — the
    // owner path enters both plays here; prize ELIGIBILITY (what
    // this section tests) is computed from contact on file, not
    // from which door the entry came through.
    const e = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: u.body.id }) });
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
  assert(JSON.stringify(vm.runInContext("SPORTS", sportsCtx)) === JSON.stringify(["baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "martialarts", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"]), "Round 6: the client SPORTS constant is the full 19, alphabetical with Martial Arts between Lacrosse and Other");
  for (const [k, label] of [["dance", "Dance"], ["golf", "Golf"], ["martialarts", "Martial Arts"], ["swimming", "Swimming"], ["tennis", "Tennis"], ["track", "Track & Field"], ["wrestling", "Wrestling"]])
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
  assert(appJs.includes('h.isSample || (!h.hasGuardianEmail && !ownerToken()) ? "" : `<button type="button" class="mini-btn" onclick="enterContest'), "Round 7/121: the Enter button is not offered on sample cards — nor (Round 121) on any play with no guardian email on file");
  assert(appJs.includes("Sample plays can't enter Hype of the Month."), "Round 7: the client enter flow guards samples with the same message the server returns");
  assert(appJs.includes("[...ALL_PLAYS].filter((h) => !h.isSample)"), "Round 7: the Hall of Fame ranking filters samples out at its computation point");
  assert(appJs.includes("Approve as Sample play") && appJs.includes("Remove sample mark") && appJs.includes("window.setSample"), "Round 7: the owner queue carries Approve-as-Sample and Remove-sample-mark actions");
  assert(css.includes(".sample-badge"), "Round 7: the sample badge pill is styled");
  assert(!home.includes("⭐ SAMPLE PLAY are demos posted by HighlightHype") && !home.includes("every play here was uploaded by a family"), "Round 7 →135: the Month board note is retired at the owner's direction (Emil: cut it out); sample disclosure lives on the cards themselves (badge + explainer asserted above)");
  // (b) End-to-end against the real server (fresh DB — booting at all
  // proves the is_sample migration ran): upload -> ONE approve-as-
  // sample call -> isSample in the public payload + owner queue.
  const mkUp7 = async (fields) => {
    const f = new FormData();
    f.append("title", fields.title); f.append("sport", fields.sport); f.append("division", "boys"); f.append("playerName", fields.playerName);
    f.append("guardianConsent", "on");
    f.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
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
  const enterR = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: realId }) });
  assert(enterR.status === 201 && enterR.body.ok, "Round 7: a real play still enters the contest (Round 121: via the owner path — the play carries no guardian email)");
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
    /* →134: renderFame's new deps (shared sport state + the
       athlete-led short title); the fixtures' titles carry no
       sentence punctuation, so the stubs are exact here. */
    monthSport: "all",
    firstNameOf: (h) => (h.player_name || "").split(" ")[0],
    shortTitle: (t) => String(t || ""),
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

  /* ---- 23. Round 8 (2026-11-05): default landing view + board
     tiles + play detail. CHANGE 1: on first load the site lands on
     All Hypes unless this month's contest already has an entry (the
     Month board used to be a dead first screen whenever the contest
     was empty — samples can never be entries). The rule fires once,
     inside loadData BEFORE the first renderAll, and an explicit
     boot hash target always wins. CHANGE 2: both board lists render
     compact tiles (thumbnail-first, fameThumbHtml media) instead of
     full cards; tapping a tile opens the play's FULL cardHtml card
     in the play-detail overlay; #play- links and Hall of Fame taps
     route to the same detail; athlete pages keep full cards. ---- */
  {
    const html8 = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
    const css8 = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");

    // Structure: tile grids on the two boards ONLY; the overlay
    // markup exists with its ← Back close affordance.
    assert(html8.includes('<div class="month-rows134" id="monthRows"></div>') && html8.includes('<div class="tile-grid" id="allBoard"></div>'), "Round 8: both board lists render their plays — →134: the Month list is the compact leaderboard (#monthRows), Watch keeps its tile grid");
    assert(html8.includes('<div class="board" id="athleteBoard"></div>'), "Round 8: the athlete board keeps the full-card .board grid (athlete pages are NOT tiled)");
    assert(html8.includes('id="playDetail"') && html8.includes('id="playDetailBody"') && html8.includes("data-detail-close") && html8.includes("← Back"), "Round 8: the play-detail overlay markup is present with a ← Back close affordance");
    assert(css8.includes(".tile-grid{display:grid;grid-template-columns:repeat(2,1fr)") && css8.includes(".play-detail{position:fixed") && css8.includes(".play-detail[hidden]{display:none}") && css8.includes("body.detail-open{overflow:hidden}"), "Round 8: tile-grid (2 per phone row) and detail-overlay CSS are in place");
    assert(css8.includes(".board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}"), "Round 8: the .board card grid CSS is untouched (athlete pages)");

    // Wiring: both board renders use tiles; the athlete page still
    // renders full cards; the default rule runs inside loadData
    // before the first render; panel navigation hides the detail;
    // the hashchange route forces a fresh #play- routing.
    const monthBlock8 = appJs.slice(appJs.indexOf("function renderMonth"), appJs.indexOf("function fameThumbHtml"));
    assert(monthBlock8.includes("featCardHtml134(feat134)") && monthBlock8.includes("fameRowHtml134(h, i)") && !monthBlock8.includes("cardHtml(h"), "Round 8: the Month board renders its plays — →134: as the featured card + compact leaderboard rows (the tile deck retired, see §45) — →147: the rows render through the shared Hall of Fame renderer (fameRowHtml134; lbRowHtml134 retired, see §55)");
    const allBlock8 = appJs.slice(appJs.indexOf("function renderAll2"), appJs.indexOf("let detailPlayId"));
    assert(allBlock8.includes("tileHtml(h, { rank: i + 1 })") && !allBlock8.includes("cardHtml(h"), "Round 8: All Hypes renders tiles");
    const athleteBlock8 = appJs.slice(appJs.indexOf("window.openAthlete = async"), appJs.indexOf("/* ---------------- panels / menu / store"));
    assert(athleteBlock8.includes("cardHtml(h, { numbers: true })") && !athleteBlock8.includes("tileHtml"), "Round 8: athlete pages still render FULL cards (no tiles) — Round 105 passes the My Highlights numbers opt into the same full card");
    const loadBlock8 = appJs.slice(appJs.indexOf("async function loadData"), appJs.indexOf("function applyDefaultView"));
    assert(loadBlock8.includes("applyDefaultView();") && loadBlock8.indexOf("applyDefaultView();") < loadBlock8.indexOf("renderAll();"), "Round 8: loadData decides the default view BEFORE the first board render (no visible flash)");
    const panelBlock8 = appJs.slice(appJs.indexOf("function showPanel"), appJs.indexOf("function showStore"));
    assert(panelBlock8.includes("hidePlayDetail();"), "Round 8: panel navigation hides the play detail");
    assert(appJs.includes('handledPlayHash = ""; highlightSharedPlay();'), "Round 8: a #play- hashchange forces a fresh detail routing");

    // (a) Default-view rule, vm-level: the real loadData +
    // applyDefaultView + renderAll chain with stubbed api parts.
    const dvSlice = appJs.slice(appJs.indexOf("let ALL_PLAYS"), appJs.indexOf("/* ---------------- media + cards"));
    const dvRun = async (entries, hashTarget) => {
      const calls = [];
      const sb = {
        console, setTimeout, clearTimeout,
        voterToken: "tok",
        api: async (url) => (String(url).includes("contest") ? { monthKey: "2026-11", monthLabel: "November 2026", entries, winner: null } : { highlights: [] }),
        switchView: (v) => calls.push("view:" + v),
        renderAll: () => calls.push("render"),
      };
      const ctx = vm.createContext(sb);
      vm.runInContext(dvSlice, ctx);
      if (hashTarget) vm.runInContext("bootHashTarget = true;", ctx);
      await vm.runInContext("loadData()", ctx);
      return { calls, ctx };
    };
    const dv0 = await dvRun([], false);
    assert(dv0.calls[0] === "view:all" && dv0.calls[1] === "render", "behavioral: 0 contest entries → the site lands on All Hypes, decided before the first render");
    await vm.runInContext("loadData()", dv0.ctx);
    assert(dv0.calls.filter((c) => c.startsWith("view:")).length === 1, "behavioral: the default-view rule fires ONCE — later data refreshes never yank the visitor's view");
    const dv1 = await dvRun([{ id: 1 }], false);
    assert(dv1.calls[0] === "view:month", "behavioral: ≥1 contest entry → the site lands on Hype of the Month, as before");
    const dvH = await dvRun([], true);
    assert(!dvH.calls.some((c) => c.startsWith("view:")), "behavioral: an explicit boot hash target wins — the default rule does not switch the view");

    // (b) Tiles + detail, vm-level: the real esc/cap, mediaHtml,
    // cardHtml, tileHtml, fameThumbHtml and the detail machinery
    // against stub plays.
    const r8Plays = [
      { id: 101, title: "Big Play", sport: "baseball", division: "boys", athlete_label: "Jayden", player_name: "Jayden", media_kind: "file", media_url: "/uploads/a.mp4", mime: "video/mp4", voteCount: 5, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
      { id: 102, title: "Voted Play", sport: "softball", division: "girls", athlete_label: "Maya", player_name: "Maya", media_kind: "file", media_url: "/uploads/b.png", mime: "image/png", voteCount: 9, hasVoted: true, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
      { id: 103, title: "Sample Play", sport: "soccer", division: "girls", athlete_label: "Sofia", player_name: "Sofia", media_kind: "file", media_url: "/uploads/c.mp4", mime: "video/mp4", voteCount: 2, hasVoted: false, isSample: true, isWinner: false, prizeEligible: false, created_at: "2026-11-05T00:00:00Z" },
    ];
    const r8Entry = { id: 104, title: "Contest Play", sport: "hockey", division: "boys", athlete_label: "Liam", player_name: "Liam", media_kind: "file", media_url: "/uploads/d.mp4", mime: "video/mp4", voteCount: 7, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, created_at: "2026-11-05T00:00:00Z" };
    const r8Calls = [];
    const r8BodyEl = { innerHTML: "" };
    const r8Wrap = { hidden: true, querySelector: () => ({ focus: () => r8Calls.push("focus") }) };
    const r8Classes = new Set();
    const r8Loc = { hash: "" };
    let r8EscListener = null;
    const r8Doc = {
      querySelector: (sel) => (sel === "#playDetail" ? r8Wrap : sel === "#playDetailBody" ? r8BodyEl : null),
      querySelectorAll: () => [],
      addEventListener: (ev, fn) => { if (ev === "keydown") r8EscListener = fn; },
      body: { classList: { add: (c) => r8Classes.add(c), remove: (c) => r8Classes.delete(c) } },
    };
    const r8Sb = {
      console, window: {},
      document: r8Doc,
      $: (sel) => r8Doc.querySelector(sel),
      $$: () => [],
      location: r8Loc,
      history: { replaceState: (a, b, url) => { r8Loc.hash = url; } },
      switchView: (v) => r8Calls.push("view:" + v),
      showHome: () => r8Calls.push("showHome"),
      showPanel: (n) => r8Calls.push("panel:" + n),
      ownerToken: () => "",
      ALL_PLAYS: [...r8Plays, r8Entry],
      CONTEST: { monthKey: "2026-11", monthLabel: "November 2026", entries: [r8Entry], winner: null },
    };
    const r8Ctx = vm.createContext(r8Sb);
    vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), r8Ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), r8Ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine")), r8Ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("let detailPlayId"), appJs.indexOf("/* ---------------- athlete collection")), r8Ctx);
    // In a browser, window.* assignments ARE globals (highlightSharedPlay
    // calls bare openPlayDetail); mirror that in the vm context.
    vm.runInContext("var openPlayDetail = window.openPlayDetail, closePlayDetail = window.closePlayDetail, goToPlayCard = window.goToPlayCard;", r8Ctx);
    const r8 = (code) => vm.runInContext(code, r8Ctx);

    // Tiles: media, meta, vote wiring + state; samples badged with
    // NO Enter affordance on the tile itself.
    const t1 = r8("tileHtml(ALL_PLAYS[0])");
    assert(t1.includes('class="tile"') && t1.includes('data-tile-id="101"') && t1.includes("openPlayDetail(101)"), "Round 8: a tile opens the play's detail on tap");
    assert(t1.includes("<video") && t1.includes('muted loop playsinline') && t1.includes('preload="metadata"'), "Round 8: a video tile's thumbnail plays in place (fameThumbHtml treatment)");
    assert(t1.includes("Big Play") && t1.includes("Baseball") && t1.includes("Jayden") && !t1.includes(" · Boys · "), "Round 8: a tile shows title, sport and the athlete's name — →153: the division leaves the card meta (it lives on the play detail view now)");
    assert(t1.includes('class="vote-chip vote-chip-btn vote-pill153"') && t1.includes("Vote · <b>5</b>") && !t1.includes("👑 Vote") && t1.includes('onclick="event.stopPropagation();toggleVote(101, this)"') && t1.includes('aria-pressed="false"'), "Round 8/108: the tile's gold chip is a REAL vote button again — Round 107's watch-view-only voting is reversed at Emil's direction ('How do they vote now?'); the chip votes in place via the same toggleVote as the watch view, its click stopped so it never also opens the watch view");
    assert(!t1.includes("enterContest("), "Round 8: tiles carry no Enter affordance (Enter lives on the full card in the detail)");
    const t2 = r8("tileHtml(ALL_PLAYS[1])");
    assert(t2.includes("<img") && t2.includes('class="vote-chip vote-chip-btn vote-pill153 voted"') && t2.includes("Voted · <b>9</b>") && t2.includes('aria-pressed="true"') && t2.includes("toggleVote(102"), "Round 8/45/108: an image tile shows the photo, and its chip renders the VOTED state on the tile itself (tap removes the vote — the same toggle)");
    const t3 = r8("tileHtml(ALL_PLAYS[2])");
    assert(t3.includes("⭐ SAMPLE PLAY") && !t3.includes("enterContest(") && !t3.includes("toggleVote(") && t3.includes('class="vote-chip"'), "Round 8/108: a sample tile carries the SAMPLE badge, no Enter affordance, and the display-only count chip — samples never get a vote control");
    const t4 = r8("tileHtml(CONTEST.entries[0], { monthVotes: 7 })");
    assert(t4.includes("<b>7</b> votes") && !t4.includes("this month") && !t4.includes("all-time"), "Round 8: a Month-board tile shows the month vote count — →153: the hybrid meta labels it plainly 'votes' (no 'this month'/'all-time' wording on the card); the count is still the threaded month count");

    // Detail: the FULL card, with the play's own context.
    r8("window.openPlayDetail(101)");
    assert(r8Wrap.hidden === false && r8("detailPlayId") === 101 && r8Classes.has("detail-open"), "Round 8: openPlayDetail shows the overlay for the tapped play");
    assert(r8BodyEl.innerHTML.includes('data-play-id="101"') && r8BodyEl.innerHTML.includes("enterContest(101, this)"), "Round 8: the detail holds the FULL card — Enter present for a non-sample play (Round 121: the fixture carries a guardian email, so the gated button renders)");
    assert(r8BodyEl.innerHTML.includes("data-report-msg") && r8Loc.hash === "#play-101", "Round 8: the detail card carries the inline Report message slot, and opening sets the shareable #play- hash");
    r8("window.openPlayDetail(102)");
    assert(r8BodyEl.innerHTML.includes("You voted — tap to remove"), "Round 8: the detail card shows the play's live vote state");
    r8("window.openPlayDetail(103)");
    assert(r8BodyEl.innerHTML.includes("⭐ SAMPLE PLAY") && r8BodyEl.innerHTML.includes("Sample play — posted by HighlightHype") && !r8BodyEl.innerHTML.includes("enterContest("), "Round 8: a sample's detail keeps the badge + explainer and hides Enter");
    r8("window.openPlayDetail(104)");
    assert(r8BodyEl.innerHTML.includes("<b>7</b>") && r8BodyEl.innerHTML.includes("this month votes"), "Round 8: a contest entry's detail opens with its month context (month vote count + label)");

    // Report from the detail: reportPlay stores the panel HTML in
    // REPORT_MSGS and setReportMsg paints it into the card's slot;
    // cardHtml re-injects the Map on every render, so the open
    // panel (and later the confirmation) survives the detail's
    // re-renders exactly as it did on the board.
    r8("window.openPlayDetail(101)");
    r8("window.reportPlay(101); renderPlayDetail();");
    assert(r8BodyEl.innerHTML.includes("Report this play?") && r8BodyEl.innerHTML.includes("data-report-reason") && r8BodyEl.innerHTML.includes("Send report"), "Round 8: the report flow works from the detail — the inline panel opens inside the detail card and survives its re-render");
    r8('REPORT_MSGS.set(101, "Thanks — the owner will take a look."); renderPlayDetail();');
    assert(r8BodyEl.innerHTML.includes("Thanks — the owner will take a look."), "Round 8: a report confirmation renders in the detail card");
    r8("REPORT_MSGS.delete(101); renderPlayDetail();");

    // #play- routing: entry → Month board behind the detail,
    // non-entry → All Hypes; routed once per hash; unknown play is
    // a no-op; Escape + closePlayDetail dismiss and drop the hash.
    r8("window.closePlayDetail()");
    r8Calls.length = 0;
    r8Loc.hash = "#play-101"; r8("highlightSharedPlay()");
    assert(r8Calls.includes("view:all") && r8("detailPlayId") === 101 && r8Wrap.hidden === false, "Round 8: loading with #play-<id> opens that play's detail (All Hypes behind it)");
    r8("hidePlayDetail(); highlightSharedPlay();");
    assert(r8("detailPlayId") === null && r8Wrap.hidden === true, "Round 8: a routed #play- hash is handled once — later refreshes don't resurrect a closed detail");
    r8Loc.hash = "#play-104"; r8("highlightSharedPlay()");
    assert(r8Calls.includes("view:month") && r8("detailPlayId") === 104, "Round 8: a contest entry's #play- link lands on the Month board behind its detail");
    r8Loc.hash = "#play-999"; r8("highlightSharedPlay()");
    assert(r8("detailPlayId") === 104, "Round 8: a #play- link for a play that doesn't exist does nothing");
    r8EscListener({ key: "Escape" });
    assert(r8("detailPlayId") === null && r8Wrap.hidden === true, "Round 8: Escape closes the detail");
    r8("window.openPlayDetail(101)"); r8Loc.hash = "#play-101"; r8("window.closePlayDetail()");
    assert(r8Wrap.hidden === true && r8Loc.hash === "#top", "Round 8: the ← Back close hides the detail and drops its #play- hash");

    // Hall of Fame tap-through (behavioral wiring is §19 (3c);
    // here: the fame rows still call goToPlayCard, and driving it
    // lands in the detail).
    assert(appJs.includes("goToPlayCard(${h.id})"), "Round 8: Hall of Fame rows still tap through via goToPlayCard");
    r8Calls.length = 0;
    r8("window.goToPlayCard(102)");
    assert(r8Calls[0] === "showHome" && r8Calls[1] === "panel:plays" && r8("detailPlayId") === 102 && r8Wrap.hidden === false, "Round 8: a Hall of Fame tap opens the play's detail");
    r8("window.closePlayDetail()");
  }

  /* ---- 24. Round 9 (2026-11-05): Nicholas's phone fixes ----
     From his real-device pass over the round-8 build, owner-approved:
     (1) an unmissable header Store button (the link lived only in
     the ☰ menu); (2) board controls with >=48px tap targets and
     readable inactive labels; (3) a tap layer over tile media (the
     playing video swallowed taps in his in-app browser); (4)
     guardian contact = email OR mobile, in the copy AND the rule
     (server + enter flow; text consent still gates TEXTING — the
     flipped Play B case lives in test-text-consent.js and the
     phone-only enter drive is §14); (5) store photos re-cropped
     full-garment from the older-teen lookbook board; (6) last
     month's winner strip + the never-disappear line; (7) the store
     film's quiet music bed + docked sound toggle (the file itself
     is probed in §8). Deliberately NOT here: separate Boys/Girls
     contest pages — the owner is still deciding. */
  // (1) Store button in the header bar: added here in Round 9,
  // REMOVED in Round 12 — the owner cut every header variant
  // (button, both pills, the plain "Swag" link). These asserts now
  // pin the ABSENCE; §27 pins the current spec (the store stays
  // reachable via the ☰ entry, the Entry Card and the doors).
  const headerBlock9 = home.slice(home.indexOf('<header class="nav">'), home.indexOf("</header>"));
  assert(!headerBlock9.includes("nav-store-btn") && !home.includes("nav-store-btn"), "Round 9→12: NO header store control remains — the header store anchor is gone from the markup (§27 pins the current spec)");
  assert(!css.includes(".nav-store-btn"), "Round 9→12: the header store CSS rules are gone with the element — nothing styles a removed control");
  assert(headerBlock9.includes("Swag Shop — Rep The Hype"), "Round 9→12: the menu's store entry stays — it is once again the header's only store path");
  // (2) Board control sizing lives in the stylesheet (both boards).
  assert(css.includes(".viewseg button{min-height:48px"), "Round 9: board view tabs are >=48px tall");
  assert(css.includes(".board-tools .seg button{min-height:44px"), "Round 9/67: division seg buttons are comfortably tall in the board-tools rows on BOTH boards (the segs left the filter bars in Round 67)");
  assert(css.includes(".team-select,.sport-select,.search-input{min-height:48px}"), "Round 9: sport/team selects and the search field are >=48px tall");
  assert(css.includes("#boardFilters,#allFilters{row-gap:14px}"), "Round 9: stacked board control rows are >=12px apart");
  assert(css.includes(".board-tools .seg button{min-height:44px;display:flex;align-items:center;justify-content:center;color:#e8e8e2"), "Round 9: inactive segmented labels are near-white, not the dim muted gray");
  // (3) Tile tap layer: drive the REAL tileHtml and inspect order.
  const tileFn9 = appJs.slice(appJs.indexOf("const TILE_DURATIONS"), appJs.indexOf("/* Vote hardening")); // Round 14: the slice starts at the tile helpers tileHtml now calls
  const tileSandbox9 = {
    esc: (s) => String(s ?? ""), cap: (s) => String(s ?? ""),
    fameThumbHtml: () => '<video src="/uploads/x.mp4"></video>',
    console,
  };
  const tileCtx9 = vm.createContext(tileSandbox9);
  vm.runInContext(tileFn9, tileCtx9);
  const tile9 = vm.runInContext(`tileHtml({ id: 7, title: "Tap Test", sport: "soccer", division: "boys", player_name: "Nico", voteCount: 3, hasVoted: false })`, tileCtx9);
  const iVid9 = tile9.indexOf("<video"), iTap9 = tile9.indexOf('class="tile-tap"'), iVote9 = tile9.indexOf("tile-votes");
  assert(iVid9 > -1 && iTap9 > iVid9 && iVote9 > iTap9, "Round 9: the tap layer sits OVER the tile media and the vote row stays outside it");
  assert(tile9.includes('onclick="event.stopPropagation();openPlayDetail(7)"'), "Round 9: tapping the media layer opens the play detail via the existing openPlayDetail");
  assert(css.includes(".tile-tap{position:absolute;inset:0;z-index:1") && css.includes(".tile-media .badge,.tile-media .ranktag{z-index:2}"), "Round 9: tap layer is above the video, below the winner badge / rank chip");
  // (4) Enter flow guard: Round 9 made it email-OR-phone; Round 121
  // supersedes — the gate keys on the guardian EMAIL alone (a
  // phone-only play can't prove the posting guardian by email, so
  // it explains instead of entering; behavior in §14).
  assert(appJs.includes("if (play && !play.hasGuardianEmail)"), "Round 9/121: the enter flow's no-email branch is keyed on the guardian email alone (Round 121 supersedes Round 9's email-or-phone prompt)");
  // (5) Store photos: all twelve re-crops on disk at 620px wide.
  for (const slug of ["boys-street", "boys-athletics", "boys-unleashed", "girls-street", "girls-athletics", "girls-essentials"]) {
    for (const side of ["front", "back"]) {
      const dims = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path.join(root, "public", "swag", `${slug}-${side}.jpg`)]).toString().trim();
      assert(dims === "620,1266", `Round 9: ${slug}-${side}.jpg is the full-garment re-crop at 620px wide (was ~300px) — got ${dims}`);
    }
  }
  // (7) Film sound toggle wiring (the file's audio is probed in §8).
  assert(!home.includes('class="swag-film-controls"') && !home.includes('id="swagSoundBtn"') && !home.includes('id="swagPauseBtn"'), "Round 27: the film's Sound/Pause controls left the store with the film (Round 9's docked toggle is history; its wiring stays dormant in app.js, asserted next)");
  assert(appJs.includes('$("#swagSoundBtn")') && appJs.includes("v.muted = !v.muted") && appJs.includes('"volumechange"'), "Round 9: the toggle flips the film's own muted flag (pausing pauses the sound — same element) and the label re-syncs on volumechange");
  assert(css.includes(".swag-film-controls{") && css.includes("min-height:44px"), "Round 9: film controls are >=44px targets in one docked cluster");
  // (6) Winner strip, end to end: seed LAST month with an entered,
  // crowned play through the real API, then drive the real
  // renderMonth with the real previous-period payload.
  assert(appJs.includes("prevPeriodOf(CONTEST.period)") && appJs.includes("/api/contest?period="), "Round 9: loadData fetches the previous period's contest for the strip");
  const ppCtx9 = vm.createContext({ console });
  vm.runInContext(appJs.slice(appJs.indexOf("function prevPeriodOf"), appJs.indexOf("/* ---------------- media + cards")), ppCtx9);
  assert(vm.runInContext(`prevPeriodOf("2026-11")`, ppCtx9) === "2026-10" && vm.runInContext(`prevPeriodOf("2026-01")`, ppCtx9) === "2025-12" && vm.runInContext(`prevPeriodOf("")`, ppCtx9) === "", "Round 9: prevPeriodOf steps back one month, across the year boundary, and bails on junk");
  const MONTHS9 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const now9 = new Date();
  const curPeriod9 = `${now9.getUTCFullYear()}-${String(now9.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevDate9 = new Date(Date.UTC(now9.getUTCFullYear(), now9.getUTCMonth() - 1, 1));
  const prevPeriod9 = `${prevDate9.getUTCFullYear()}-${String(prevDate9.getUTCMonth() + 1).padStart(2, "0")}`;
  const prevName9 = MONTHS9[prevDate9.getUTCMonth()];
  const png9 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const f9 = new FormData();
  f9.append("title", "Round 9 Strip Winner"); f9.append("sport", "baseball"); f9.append("division", "boys"); f9.append("playerName", "Nico");
  f9.append("guardianConsent", "on");
  f9.append("file", new Blob([png9], { type: "image/png" }), "strip.png");
  const up9 = await j("/api/highlights", { method: "POST", body: f9 });
  assert(up9.status === 201, "Round 9: strip-winner play uploads");
  const stripId = up9.body.id;
  const ap9 = await j(`/api/highlights/${stripId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(ap9.body.status === "approved", "Round 9: strip-winner play approved");
  const en9 = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: stripId, period: prevPeriod9 }) });
  assert(en9.status === 201 && en9.body.ok, "Round 9: the play enters LAST month's contest (explicit period; Round 121: owner path — the fixture carries no guardian email)");
  const win9 = await j("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: stripId, period: prevPeriod9 }) });
  assert(win9.body.ok, "Round 9: the owner crowns last month's winner");
  const prevContest9 = (await j(`/api/contest?period=${prevPeriod9}`)).body;
  assert(prevContest9.winnerId === stripId, "Round 9: the previous period's contest payload carries the winnerId — the strip's data source (no new tables)");
  const rmEls9 = {};
  const rmSandbox9 = {
    CONTEST: { period: curPeriod9, entries: [], winnerId: null },
    LAST_MONTH: prevContest9,
    MONTHS: MONTHS9,
    $: (sel) => (rmEls9[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: true }),
    esc: (s) => String(s ?? ""), cap: (s) => String(s ?? ""),
    hydrateDurPills: () => {}, // Round 14: renderMonth ends with a duration-pill hydration pass (stubbed here; §29 drives the real one)
    console,
  };
  const rmCtx9 = vm.createContext(rmSandbox9);
  vm.runInContext(appJs.slice(appJs.indexOf("function renderMonth"), appJs.indexOf("function fameThumbHtml")), rmCtx9);
  vm.runInContext("renderMonth()", rmCtx9);
  assert(rmEls9["#lastWinner"].hidden === false && rmEls9["#lastWinner"].innerHTML.includes(`🏆 Last month (${prevName9}): Round 9 Strip Winner — Nico`) && rmEls9["#lastWinner"].innerHTML.includes(`openPlayDetail(${stripId})`), "Round 9: with a crowned past winner, the strip renders and taps through to the play");
  assert(rmEls9["#neverDisappear"].hidden === false, "Round 9: the never-disappear line shows while the current month has no entries");
  assert(home.includes("Plays never disappear — when a month ends, its plays stay in All Hypes."), "Round 9: the never-disappear line is in the Month board markup");
  vm.runInContext(`LAST_MONTH = { period: "${prevPeriod9}", entries: [], winnerId: null }; renderMonth();`, rmCtx9);
  assert(rmEls9["#lastWinner"].hidden === true && rmEls9["#lastWinner"].innerHTML === "", "Round 9: with NO past winner the strip renders nothing — no placeholder, no fake winner");

  /* ---- 25. Round 10 (2026-11-05, night): Nicholas's second pass +
     the owner's screenshot fixes — (1) the header Store pill is
     MUTED (near-black, lime text, thin lime outline) and slightly
     smaller (~40px): the solid-lime pill popped too hard and, on
     the owner's phone, covered the store film model's face; (2)
     the "All teams" filter is REMOVED — the Month bar never had
     one; the All bar's team select, its option population, change
     listener, #team- hash route and the filter clause are all
     gone, so filtering behaves as team="all" (team names still
     match through search); no API change — loadData never sent a
     team parameter, the server default simply stands; (3) the
     homepage montage strips are REAL BUTTONS (they were decoration
     wearing a ▶ label — tapping did nothing); (4) the store film's
     Sound/Pause controls moved OUT of the film overlay into a row
     below the film (they covered the Shop Girls link); (5) the
     film's sound is a stadium CROWD bed now, not music — video
     stream bit-identical, crowd RMS in the −30..−34 dB band.
     (Round 11 supersedes (1) and (5): the header control is a
     plain "Swag" link and the film is back to the Round 9 music
     bed — §26 pins both restored specs; the asserts below are
     maintained to the current state. Round 12 then removes (1)'s
     control entirely — §27 pins the header's final state.) */
  // (1) Store pill: the whole header-store lineage ended in
  // Round 12 (the element is removed, §27 pins the absence), so
  // the pill-era asserts collapse into one: no trace survives.
  assert(!css.includes(".nav-store-btn") && !home.includes("nav-store-btn") && !home.includes("🛍️ Store"), "Round 10→12: the header store control is gone entirely — no pill rule, no link, no emoji (§27 pins the current spec)");
  // (2) Team filter removal: markup, wiring, and behavior.
  assert(!home.includes('id="teamFilter"') && !home.includes('id="teamLabel"') && !home.includes("All teams"), "Round 10: no team select (and no 'All teams' option) anywhere in the served page");
  const allFiltersHtml10 = home.slice(home.indexOf('id="allFilters"'), home.indexOf('id="allBoard"'));
  const monthFiltersHtml10 = home.slice(home.indexOf('id="boardFilters"'), home.indexOf('id="monthRows"'));
  assert(allFiltersHtml10.includes('id="allSportSelect"') && !allFiltersHtml10.includes('id="allSearch"') && !allFiltersHtml10.includes("teamFilter") && !allFiltersHtml10.includes("team-select"), "Round 10/47: the All filter bar keeps the sport select and nothing team-shaped; the search box was retired in Round 47 (filter logic dormant in app.js)");
  assert(monthFiltersHtml10.includes('id="monthSportSelect"') && !monthFiltersHtml10.includes("teamFilter") && !monthFiltersHtml10.includes("team-select"), "Round 10: the Month filter bar renders with no team select (it never had one — nothing dangles)");
  assert(!appJs.includes("teamFilter") && !appJs.includes("allTeam") && !appJs.includes("#team-"), "Round 10: no code path in app.js references the removed element, its state variable, or its #team- hash route");
  const noTeamProbe10 = await j("/api/highlights?division=all&sort=top");
  assert(noTeamProbe10.status === 200 && Array.isArray(noTeamProbe10.body.highlights), "Round 10: /api/highlights answers with NO team parameter (its long-standing server default) — the client never sent one, so the contract is untouched");
  const r10Els = {};
  const r10Sandbox = {
    window: {}, console,
    ALL_PLAYS: [
      { id: 12, title: "No-Doubt Home Run", sport: "baseball", division: "boys", player_name: "Jayden", team: "Plainview Hawks", story: "", voteCount: 0 },
      { id: 14, title: "Buzzer-Beater!", sport: "basketball", division: "boys", player_name: "Caleb", team: "", story: "", voteCount: 0 },
      { id: 15, title: "Top-Corner Goal", sport: "soccer", division: "girls", player_name: "Sofia", team: "Tigers", story: "", voteCount: 0 },
      { id: 99, title: "Big Hit to the Gap", sport: "softball", division: "boys", player_name: "Maya", team: "", story: "", voteCount: 0 },
    ],
    allDiv: "all", allSport: "all", allSearch: "",
    $: (sel) => (r10Els[sel] ||= { innerHTML: "", textContent: "", style: {} }),
    tileHtml: (h) => `TILE:${h.id};`,
    hydrateDurPills: () => {}, // Round 14: renderAll2 ends with a duration-pill hydration pass (stubbed here; §29 drives the real one)
  };
  const r10Block = appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function ", appJs.indexOf("function divMatch") + 10)) +
    appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("let detailPlayId"));
  assert(r10Block.includes("function renderAll2") && r10Block.includes("function divMatch") && !r10Block.includes("teamFilter"), "Round 10→125→126: renderAll2 test block located (divMatch + the mid-feed Hype Frame slot helper — the Round 125 banner, the Round 126 strip — + renderAll2, no team wiring inside)");
  const r10Ctx = vm.createContext(r10Sandbox);
  vm.runInContext(r10Block, r10Ctx);
  vm.runInContext("renderAll2()", r10Ctx);
  const r10Html125 = r10Els["#allBoard"].innerHTML;
  assert(r10Html125.startsWith('<div class="tile-featured-slot">TILE:12;</div><div class="tile-deck">TILE:14;TILE:15;') && r10Html125.includes('class="hf-strip126"') && r10Html125.indexOf('class="hf-strip126"') < r10Html125.indexOf("TILE:99;") && r10Els["#allCount"].textContent === "4 plays", "behavioral (Round 10/62→125→126): with no team filter, team-tagged AND untagged plays all render — the board behaves as team='all' (count format is Round 62's 'N plays'); Round 125 put the Hype Frame slot mid-deck after the third tile; Round 126: the slot carries the compact film strip (hf-strip126), same splice");
  r10Sandbox.allSport = "baseball"; vm.runInContext("renderAll2()", r10Ctx);
  assert(r10Els["#allBoard"].innerHTML === '<div class="tile-featured-slot">TILE:12;</div>', "behavioral (Round 10): the sport filter still filters on its own (baseball only)");
  r10Sandbox.allSport = "all"; r10Sandbox.allDiv = "girls"; vm.runInContext("renderAll2()", r10Ctx);
  assert(r10Els["#allBoard"].innerHTML === '<div class="tile-featured-slot">TILE:15;</div>', "behavioral (Round 10): the division segment still filters on its own (girls only)");
  r10Sandbox.allDiv = "all"; r10Sandbox.allSearch = "hawks"; vm.runInContext("renderAll2()", r10Ctx);
  assert(r10Els["#allBoard"].innerHTML === '<div class="tile-featured-slot">TILE:12;</div>', "behavioral (Round 10/47): the (now dormant) text filter still matches team names — the search UI was retired in Round 47, the logic kept for an easy re-add");
  r10Sandbox.allSearch = "";
  // (3) Sport jumps: the montage strips retired in Round 44 — the
  // Browse by Sport row under the clips carries the same wiring.
  for (const s of ["baseball", "basketball", "soccer"]) {
    assert(home.includes(`<option value="${s}">`), `Round 10/62→125: ${s} sits in the board sport dropdown (the pill bar retired in Round 125; the goToSportBoard browse row retired in Round 62)`);
  }
  assert(home.includes("Filter plays by sport") && home.includes("See all plays →") && !home.includes("All sports →"), "Round 44/47/62→125: See all plays sits under the clips; the sports sit above the videos (the sport DROPDOWN since Round 125, the pill bar in Round 62) and the All sports link is gone");
  assert(css.includes(".sport-row") && css.includes(".browse-head"), "Round 44: the browse block has its row + heading styles");
  const g10Calls = [];
  const g10Sandbox = {
    window: {}, console,
    allSport: "all",
    showHome: () => g10Calls.push("home"),
    showPanel: (p) => g10Calls.push("panel:" + p),
    syncFilterUI: () => g10Calls.push("sync"),
    switchView: (v) => g10Calls.push("view:" + v),
    renderAll2: () => g10Calls.push("render"),
    $: () => ({ scrollIntoView: () => g10Calls.push("scroll") }),
  };
  const g10Block = appJs.slice(appJs.indexOf("window.goToSportBoard"), appJs.indexOf("/* ---------------- athlete collection"));
  assert(g10Block.includes("window.goToSportBoard"), "Round 10: goToSportBoard located in app.js");
  const g10Ctx = vm.createContext(g10Sandbox);
  vm.runInContext(g10Block, g10Ctx);
  for (const [sport, tile] of [["baseball", "TILE:12;"], ["basketball", "TILE:14;"], ["soccer", "TILE:15;"]]) {
    g10Calls.length = 0;
    vm.runInContext(`window.goToSportBoard("${sport}")`, g10Ctx);
    assert(g10Sandbox.allSport === sport && g10Calls.join(",") === "home,panel:plays,sync,view:all,render,scroll", `behavioral (Round 10): tapping the ${sport} strip sets the All-board sport filter and lands on All Hypes (home → plays panel → sync → view:all → render → scroll)`);
    r10Sandbox.allSport = g10Sandbox.allSport; r10Sandbox.allDiv = "all"; r10Sandbox.allSearch = "";
    vm.runInContext("renderAll2()", r10Ctx);
    assert(r10Els["#allBoard"].innerHTML === `<div class="tile-featured-slot">${tile}</div>`, `behavioral (Round 10/54): after the ${sport} tap, the rendered All board holds exactly that sport's seeded sample play (${tile}) — alone, it renders as the featured tile`);
  }
  // (4) Film controls: Round 27 removes the film from the store, so
  // Round 10's placement/byte-identity asserts are superseded by
  // absence; the controls CSS rule itself stays in styles.css.
  assert(!home.includes('class="swag-film swag-film-hero"') && !home.includes('id="sscBtn"') && !home.includes('class="swag-film-controls"') && !home.includes('id="swagSoundBtn"') && !home.includes('id="swagPauseBtn"'), "Round 27: the film block, scene card, controls row and both buttons are out of the store (Round 10's placement rules are moot)");
  const controlsRule10 = css.slice(css.indexOf(".swag-film-controls{"), css.indexOf("}", css.indexOf(".swag-film-controls{")));
  assert(controlsRule10.includes("justify-content:flex-end") && !controlsRule10.includes("position:absolute"), "Round 10: the controls cluster is a static right-aligned row below the film, not an absolute overlay");
  // (5) The film file: video untouched; Round 11 restored the
  // Round 9 music bed (the crowd band asserts are superseded).
  const filmPath10 = path.join(root, "public", "swag-film.mp4");
  const vHash10 = execFileSync("ffmpeg", ["-v", "error", "-i", filmPath10, "-map", "0:v:0", "-c", "copy", "-f", "streamhash", "-hash", "md5", "-"]).toString();
  assert(vHash10.includes("MD5=2055d4f3e22e7252e90254bfb81d649e"), "Round 10: the film's VIDEO stream is bit-identical to the Round 9 cut (streamhash MD5 matches — only the audio was replaced)");
  const aStats10 = execFileSync("bash", ["-c", `ffmpeg -i "${filmPath10}" -map 0:a -af astats=metadata=1 -f null - 2>&1 | grep -E "RMS level|Peak level" | tail -2`]).toString();
  const rms10 = Number((/RMS level dB:\s*(-?[\d.]+)/.exec(aStats10) || [])[1]);
  const peak10 = Number((/Peak level dB:\s*(-?[\d.]+)/.exec(aStats10) || [])[1]);
  assert(rms10 <= -24 && rms10 >= -27 && peak10 <= -12, `Round 11: the restored MUSIC bed sits in its band (RMS ${rms10} dB within −24..−27, peak ${peak10} dB ≤ −12) — the Round 10 crowd band (−30..−34) is superseded (§26)`);
  const aProbe10 = execFileSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,sample_rate,channels", "-of", "csv=p=0", filmPath10]).toString().trim();
  assert(aProbe10 === "aac,44100,2", `Round 11: the restored music bed is AAC 44.1kHz stereo (got ${aProbe10}) — the file is Round 9's own (§26 pins its size)`);

  /* ---- 26. Round 11 (2026-11-05, night): three fixes from the
     owner's phone review of Round 10 — (1) the montage clips
     STOPPED PLAYING: showStore() pauses EVERY .view-home video
     (montage included) but showHome() resumed only the hero + the
     Hype Frame film, so one Store visit froze the strips on their
     posters for the rest of the session; showHome resumes them
     now, and a visibility observer plays each clip while ≥25% of
     it is on screen and pauses it off-screen, so a stalled clip
     self-heals on scroll and off-screen clips stop burning CPU.
     The posters are real frames extracted from the clips (the old
     .webp posters were comic illustrations that never matched the
     photographic clips). (2) The floating "+ Submit a Hype" FAB
     sits on the upload form's Girls toggle at phone widths and
     eats the tap — while the form is on screen the FAB fades out
     (.fab-away) via an IntersectionObserver on #uploadForm; its
     perch, look and click behavior are otherwise unchanged.
     (Round 24 retires the observer and the fade rule — the form
     leaves the page flow entirely, so there is nothing in-flow
     left to observe; the pill is state-driven now and the checks
     below pin the retirement. §34.) (3)
     The header store control is a plain text link reading "Swag"
     — Nicholas rejected both pill looks and the word "Store"; the
     ☰ entry and the Store Entry Card keep "Store" (out of scope).
     (Round 12 removes the link entirely — §27 pins the header.)
     (4) The store film's audio is the Round 9 quiet MUSIC bed
     again — the Round 10 stadium crowd is reverted with the file
     byte-identical to Round 9's; the Sound/Pause row stays below
     the film (§25 placement unchanged). (5) The emailed moderation
     flow gains "Approve as Sample play" (owner-requested the same
     night): POST /moderate accepts action=approve_sample — an
     approval that also sets is_sample=1 in the same update, with
     the same notifications — and both moderation pages carry the
     third button. Same moderateAuthorized gate; nothing else in
     server.js changes. */
  // (1) Montage resume + observer: wiring, then the real functions
  // driven in a vm against stub videos.
  const showHome26 = appJs.slice(appJs.indexOf("function showHome()"), appJs.indexOf("/* One home reset"));
  assert(showHome26.includes('$$(".montage video")') && showHome26.includes("watchMontageVideos"), "Round 11: showHome's block carries the montage resume + the visibility watcher (the Round 4 resume covered hero + HF film only)");
  assert(appJs.includes("e.intersectionRatio >= 0.25") && appJs.includes("e.target.pause()") && appJs.includes("threshold: [0, 0.25]"), "Round 11: the montage observer plays at >=25% visibility and pauses below it");
  assert(home.includes('<option value="baseball">Baseball</option>') && css.includes(".montage video{pointer-events:none}"), "Round 11/62→125: the sport filter lives on the board dropdown now (was the browse row, then the pill bar; the montage retired in Round 44, its CSS stays harmless)");
  const mkVid26 = () => ({ plays: 0, pauses: 0, play() { this.plays++; return Promise.resolve(); }, pause() { this.pauses++; } });
  const montageVids26 = [mkVid26(), mkVid26(), mkVid26()];
  const heroVid26 = mkVid26(), hfVid26 = mkVid26();
  let ioCb26 = null, ioOpts26 = null; const ioSeen26 = [];
  class FakeIO26 { constructor(cb, opts) { ioCb26 = cb; ioOpts26 = opts; } observe(v) { ioSeen26.push(v); } }
  const sb26 = {
    console, window: {},
    document: { body: { classList: { contains: () => true, remove: () => {} } } },
    location: { hash: "#top" }, history: { replaceState: () => {} },
    setStoreFocus: () => {},
    IntersectionObserver: FakeIO26,
    $: (sel) => (sel === "#heroVideo" ? heroVid26 : null),
    $$: (sel) => (sel === ".montage video" ? montageVids26 : []),
  };
  const ctx26 = vm.createContext(sb26);
  vm.runInContext(showHome26, ctx26);
  assert(ioSeen26.length === 3 && ioOpts26 && ioOpts26.threshold.includes(0.25), "behavioral (Round 11): the watcher observes all three montage clips with the 25% threshold");
  vm.runInContext("showHome()", ctx26);
  assert(montageVids26.every((v) => v.plays === 1) && heroVid26.plays === 1 && hfVid26.plays === 0, "behavioral (Round 11/48): returning home from the Store plays hero + ALL three montage clips; the homepage Hype Frame film is NOT resumed (click-to-play since Round 48 — hfVid26 stands in for it and must stay at 0)");
  ioCb26([{ target: montageVids26[0], intersectionRatio: 0.5 }, { target: montageVids26[1], intersectionRatio: 0.1 }, { target: montageVids26[2], intersectionRatio: 0 }]);
  assert(montageVids26[0].plays === 2 && montageVids26[1].pauses === 1 && montageVids26[2].pauses === 1, "behavioral (Round 11): the observer plays a clip scrolled >=25% into view and pauses the ones below the line / off-screen");
  for (const p of ["play-baseball.webp", "play-basketball.webp", "play-soccer.webp"]) {
    const r = await fetch(`${base}/${p}`);
    const buf = await r.arrayBuffer();
    assert(r.status === 200 && buf.byteLength > 15000 && buf.byteLength < 200000, `Round 11: montage poster ${p} is a real frame from its clip (${buf.byteLength} bytes — the old comic-illustration posters were 476–766 KB)`);
  }
  // (2) FAB vs the upload form. Round 11's observer + fade rule
  // stood here until Round 24: the form left the page flow at
  // every width (display:none until body.upload-open), so an
  // observer watching it could never fire — Round 24 retires
  // both, and the pill's visibility is state-driven (hidden only
  // while the overlay is open — §34). These checks pin the
  // retirement; what survives of Round 11 is the click wiring.
  assert(!css.includes(".float-submit.fab-away{"), "Round 24: the Round 11 fade rule is gone with its observer (the form is an overlay now — the pill hides while it is open, §34, and can never cover the in-flow form again)");
  const fabBlock26 = appJs.slice(appJs.indexOf('$("#floatSubmit")'), appJs.indexOf('$$("[data-submit-link]")'));
  assert(!fabBlock26.includes("observe(") && !fabBlock26.includes("isIntersecting") && !fabBlock26.includes('classList.toggle("fab-away"'), "Round 24: no observer watches #uploadForm and nothing toggles the retired fade class — no dead observer runs against the hidden form");
  assert(fabBlock26.includes('addEventListener("click", goSubmit)'), "Round 11: the FAB's click wiring is untouched (still goSubmit)");
  const fabStub26 = { listeners: {}, addEventListener(ev, fn) { this.listeners[ev] = fn; } };
  let fabGoCalls26 = 0;
  const fabSb26 = { console, goSubmit: () => { fabGoCalls26++; }, $: (sel) => (sel === "#floatSubmit" ? fabStub26 : null) };
  vm.runInContext(fabBlock26, vm.createContext(fabSb26));
  assert(typeof fabStub26.listeners.click === "function", "behavioral (Round 24): the FAB's click listener still registers from the same block (the block no longer constructs any observer)");
  fabStub26.listeners.click();
  assert(fabGoCalls26 === 1, "behavioral (Round 24): a FAB tap still routes to goSubmit (which now opens the overlay at any width — §34)");
  // (2b) The toggle itself: the quick-upload-picks section header
  // in app.js was an UNTERMINATED block comment — everything from
  // it to the next */ (setDivPick, setSportPick, the click wiring,
  // window.syncQuickPicks) was commented out, so the Boys/Girls
  // toggle has had NO handler since 2026-11-04 (the owner's "can
  // not click Girls" report; uploads still worked because the
  // submit handler sits after the closing */). Round 11 closes
  // the comment; the drive below runs the real resurrected block.
  assert(appJs.includes("quick upload picks (2026-11-04) ---------------- */"), "Round 11: the quick-upload-picks section header comment is CLOSED — the toggle code below it is live again, not commented out");
  const divBlock26 = appJs.slice(appJs.indexOf("function setDivPick"), appJs.indexOf("/* ---------------- upload + athlete prompt"));
  assert(divBlock26.includes("function setSportPick") && divBlock26.includes("window.syncQuickPicks") && divBlock26.includes('addEventListener("click"'), "Round 11: the resurrected block holds setDivPick + setSportPick + the click wiring + syncQuickPicks");
  const divBtns26 = ["boys", "girls"].map((d) => ({ dataset: { divPick: d }, pressed: null, clickFn: null, setAttribute(k, v) { if (k === "aria-pressed") this.pressed = v; }, addEventListener(ev, fn) { if (ev === "click") this.clickFn = fn; } }));
  const divForm26 = { elements: { division: { value: "boys" }, sport: { value: "" } } };
  const divSb26 = { console, window: {}, $: (sel) => (sel === "#uploadForm" ? divForm26 : null), $$: (sel) => (sel === "[data-div-pick]" ? divBtns26 : []) };
  vm.runInContext(divBlock26, vm.createContext(divSb26));
  divBtns26[1].clickFn();
  assert(divForm26.elements.division.value === "girls" && divBtns26[1].pressed === "true" && divBtns26[0].pressed === "false", "behavioral (Round 11): the Girls toggle's real click handler flips the hidden division field to 'girls' and the aria-pressed pair with it");
  // (3) "Swag" link: REMOVED in Round 12 — the owner found the
  // plain link weirdly floating in the bar and cut it. These
  // asserts now pin the absence; §27 pins the current spec.
  const headerBlock26 = home.slice(home.indexOf('<header class="nav">'), home.indexOf("</header>"));
  assert(!headerBlock26.includes("nav-store-btn") && !css.includes(".nav-store-btn"), "Round 11→12: the 'Swag' link and its rule are gone — the header carries no store control (§27)");
  assert(!home.includes("🛍️"), "Round 11→12: the bag emoji stays gone from the page (it lived only on the header controls)");
  assert(headerBlock26.includes("Swag Shop — Rep The Hype") && !home.includes("Shop the Drop") && home.includes("Open the full store"), "Round 11→12/55→125: the ☰ menu entry keeps its wording, and the homepage store entry is the merch teaser whose call is Open the full store (the Rep The Hype band and its Shop the Drop call retired in Round 125) — they carry the store now (§27 drives their handler)");
  // (4) The film file: Round 9's own bytes, same picture as ever.
  const filmPath26 = path.join(root, "public", "swag-film.mp4");
  assert(fs.statSync(filmPath26).size === 9384994, "Round 11: the store film is exactly Round 9's music-bed file (9,384,994 bytes) — reverted, not re-muxed");
  const vHash26 = execFileSync("ffmpeg", ["-v", "error", "-i", filmPath26, "-map", "0:v:0", "-c", "copy", "-f", "streamhash", "-hash", "md5", "-"]).toString();
  assert(vHash26.includes("MD5=2055d4f3e22e7252e90254bfb81d649e"), "Round 11: the reverted film's video stream still hashes to the Round 9/10 value — the picture never changed across the sound swaps");
  // (5) Moderation by email link: "Approve as Sample play" — the
  // owner approves the AI sample plays from the emailed link and
  // needs the sample mark set in the same tap (previously he had
  // to approve by email, then re-mark in the Owner panel).
  const serverJs26 = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(serverJs26.includes('"approve", "approve_sample", "hide"') && serverJs26.includes("SET status=?, is_sample=1"), "Round 11: POST /moderate accepts approve_sample and sets status + is_sample in the same update");
  assert((serverJs26.match(/Approve as Sample play/g) || []).length >= 2, "Round 11: BOTH moderation pages (per-play + queue) carry the 'Approve as Sample play' button");
  const modDb26 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
  const png26 = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
  const upMod26 = async (title) => { const f = new FormData(); f.append("title", title); f.append("sport", "baseball"); f.append("division", "boys"); f.append("playerName", "Mod"); f.append("guardianConsent", "on"); f.append("file", new Blob([uniqPng(png26)], { type: "image/png" }), "play.png"); const r = await j("/api/highlights", { method: "POST", body: f }); assert(r.status === 201 && r.body.status === "pending", `Round 11: moderation fixture uploads pending (${title})`); return r.body.id; };
  const sampleId26 = await upMod26("Mod Sample Play");
  const plainId26 = await upMod26("Mod Plain Play");
  const hideId26 = await upMod26("Mod Hide Play");
  await fetch(`${base}/moderate?id=${sampleId26}&token=primer`); // a wrong-token hit: 403, and moderateAuthorized's sha compare generates + stores the real token (a tokenless hit short-circuits before that)
  const modToken26 = modDb26((d) => d.prepare("SELECT value FROM settings WHERE key='moderate_token'").get()?.value);
  assert(!!modToken26, "Round 11: the stored moderation token is readable for the flow tests");
  const modPageRes26 = await fetch(`${base}/moderate?id=${sampleId26}&token=${modToken26}`);
  const modPage26 = await modPageRes26.text();
  assert(modPageRes26.status === 200 && modPage26.includes('value="approve_sample"') && modPage26.includes("Approve as Sample play"), "Round 11: the per-play moderation page renders the 'Approve as Sample play' button");
  const modQueueRes26 = await fetch(`${base}/moderate-queue?token=${modToken26}`);
  const modQueue26 = await modQueueRes26.text();
  assert(modQueueRes26.status === 200 && modQueue26.includes('value="approve_sample"') && modQueue26.includes("Approve as Sample play"), "Round 11: the moderation QUEUE page renders the 'Approve as Sample play' button on pending plays");
  const modPost26 = async (fields) => { const r = await fetch(`${base}/moderate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }); return { status: r.status, body: await r.text() }; };
  const badTok26 = await modPost26({ id: String(plainId26), token: "definitely-wrong", action: "approve_sample" });
  assert(badTok26.status === 403, "Round 11: approve_sample with an invalid token still 403s (same moderateAuthorized gate, no new auth surface)");
  const afterBad26 = modDb26((d) => d.prepare("SELECT status, is_sample FROM highlights WHERE id=?").get(plainId26));
  assert(afterBad26.status === "pending" && afterBad26.is_sample === 0, "Round 11: the rejected approve_sample changed nothing (play still pending, unmarked)");
  const samplePost26 = await modPost26({ id: String(sampleId26), token: modToken26, action: "approve_sample" });
  assert(samplePost26.status === 200 && samplePost26.body.includes("Approved as a sample play"), "Round 11: the approve_sample result page says the play was approved as a sample play");
  const sampleRow26 = modDb26((d) => d.prepare("SELECT status, is_sample FROM highlights WHERE id=?").get(sampleId26));
  assert(sampleRow26.status === "approved" && sampleRow26.is_sample === 1, "Round 11: approve_sample approved the play AND set is_sample=1 in one action");
  const pub26 = await j("/api/highlights?division=all");
  const pubSample26 = pub26.body.highlights.find((h) => h.id === sampleId26);
  assert(pubSample26 && pubSample26.isSample === true, "Round 11: the moderation-approved sample shows isSample in the public API");
  const enter26 = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: sampleId26 }) });
  assert(enter26.status === 400 && String(enter26.body.message || "").includes("Sample plays can't enter Hype of the Month."), "Round 11: the moderation-approved sample is refused contest entry like every other sample");
  const plainPost26 = await modPost26({ id: String(plainId26), token: modToken26, action: "approve" });
  const plainRow26 = modDb26((d) => d.prepare("SELECT status, is_sample FROM highlights WHERE id=?").get(plainId26));
  assert(plainPost26.status === 200 && plainPost26.body.includes("Approved — this play is now live on the board.") && plainRow26.status === "approved" && plainRow26.is_sample === 0, "Round 11: plain approve via the link is unchanged — approved, NOT sample-marked, original message");
  const hidePost26 = await modPost26({ id: String(hideId26), token: modToken26, action: "hide" });
  const hideRow26 = modDb26((d) => d.prepare("SELECT status, is_sample FROM highlights WHERE id=?").get(hideId26));
  assert(hidePost26.status === 200 && hidePost26.body.includes("Declined — this play is hidden") && hideRow26.status === "hidden" && hideRow26.is_sample === 0, "Round 11: hide via the link is unchanged — hidden, and a hide never sets the sample flag");

  /* ---- 27. Round 12 (2026-11-05, night): the header store
     control is REMOVED entirely. It lived three lives — Round 9's
     lime button, Round 10's muted pill, Round 11's plain "Swag"
     link — and the owner cut it for good: the plain link looked
     like it was weirdly floating in the bar. The header is back
     to logo + ☰, exactly as it was before Round 9, and the ☰
     button's base margin-left:auto (the Round 9 override that
     zeroed it is gone too) pushes it to the right edge again.
     The store stays reachable via the ☰-menu entry ("Swag Shop —
     Rep The Hype"), the Store Entry Card ("Enter the Store" +
     its Hype Boys / Hype Girls door links) and the final CTA —
     all untouched, all still riding the single [data-store-link]
     handler in app.js. */
  const headerBlock27 = home.slice(home.indexOf('<header class="nav">'), home.indexOf("</header>"));
  assert(!home.includes("nav-store-btn") && !css.includes(".nav-store-btn"), "Round 12: no trace of the header store control — the anchor and every CSS variant (button, muted pill, plain link, :active) are removed");
  assert(!headerBlock27.includes(">Swag</a>") && headerBlock27.includes('id="menuBtn"') && headerBlock27.includes('class="brand"') && headerBlock27.includes("nav-swag"), "Round 12: the header renders logo + ☰ only — no store anchor floats in the bar; the menu (with its store entry) is intact");
  assert(!css.includes(".nav .menu-btn{margin-left:0}") && css.includes(".menu-btn{margin-left:auto"), "Round 12: the Round 9 margin override is gone — the base .menu-btn rule's margin-left:auto pushes the ☰ back to the right edge");
  const storeAnchors27 = [...home.matchAll(/<a [^>]*data-store-link[^>]*>/g)].map((m) => m[0]);
  assert(storeAnchors27.length === 4 && storeAnchors27.filter((a) => a.includes("mt125-prod")).length === 3, "Round 12/51/55/60→125: the data-store-link anchors are the merch teaser's three products + its full-store link (the Rep The Hype band retired in Round 125; the footer Store line left in Round 60 per Emil's bottom-of-page mock; the ☰ menu entry is the real /store page link since Round 51)");
  // Drive the REAL [data-store-link] handler line from app.js:
  // every remaining store anchor must still land in showStore.
  const linkLine27 = appJs.slice(appJs.indexOf('$$("[data-store-link]")'), appJs.indexOf("\n", appJs.indexOf('$$("[data-store-link]")')));
  assert(linkLine27.includes("showStore"), "Round 12: the shared data-store-link handler line located in app.js");
  const linkCalls27 = [];
  const mkAnchor27 = () => ({ dataset: {}, fn: null, addEventListener(ev, fn) { if (ev === "click") this.fn = fn; } });
  const anchorStubs27 = [mkAnchor27(), mkAnchor27()];
  const linkSb27 = { console, $$: (sel) => (sel === "[data-store-link]" ? anchorStubs27 : []), closeMenu: () => linkCalls27.push("closeMenu"), showStore: (t) => linkCalls27.push("showStore:" + t) };
  vm.runInContext(linkLine27, vm.createContext(linkSb27));
  let prevented27 = false;
  anchorStubs27[0].fn({ preventDefault: () => { prevented27 = true; } });
  assert(prevented27 && linkCalls27.join(",") === "closeMenu,showStore:null", "behavioral (Round 12): a click on a remaining data-store-link anchor (menu entry / Entry Card) still routes through closeMenu into showStore — the store opens without the header link");

  /* ---- 28. Round 13 (2026-11-05, night): the emailed moderation
     QUEUE learns to retire live plays. The owner swaps sample plays
     often, and deleting the replaced ones used to mean six separate
     Owner-view deletes (owner-token device + a native confirm
     each). Now POST /moderate accepts action=delete behind the
     SAME moderateAuthorized gate, for a play of ANY status, with
     cleanup mirrored statement-for-statement from the owner DELETE
     /api/highlights/:id route (media file, Hype Frame print files,
     order rows, the play, its votes, its contest entries) — and
     the queue page lists the approved plays under "Live on the
     board" with Hide + checkbox-armed Delete forms. The pending
     section and the per-play page are untouched.
     →147 (2026-11-13): the delete is a Trash move now — the
     branch calls trashPlay146, the checkbox arms THAT, and the
     delete-outcome assertions below were re-pointed at the
     parked state (row 'trashed', vote + order + files kept,
     contest entry removed, log 'trash' via the email link). ---- */
  const serverJs28 = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(serverJs28.includes('"approve", "approve_sample", "hide", "delete"'), "Round 13: POST /moderate accepts delete alongside approve / approve_sample / hide (same action list, same token gate)");
  const modPostBlock28 = serverJs28.slice(serverJs28.indexOf('p === "/moderate" && req.method === "POST"'), serverJs28.indexOf('p === "/moderate-queue"'));
  assert(modPostBlock28.includes('action === "delete"') && modPostBlock28.includes('trashPlay146(before, "owner", "via the email moderation link")') && modPostBlock28.includes("moderateTrashedPage147(before.title, token)") && !modPostBlock28.includes("DELETE FROM highlights WHERE id=?") && !modPostBlock28.includes("DELETE FROM votes WHERE highlight_id=?") && !modPostBlock28.includes("DELETE FROM contest_entries WHERE highlight_id=?") && !modPostBlock28.includes("DELETE FROM hype_frame_orders WHERE highlight_id=?") && !modPostBlock28.includes("fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(before.media_url)))"), "Round 13: the delete branch mirrors the owner DELETE cleanup exactly — →147: the owner DELETE is a Trash move, and this branch mirrors THAT — one trashPlay146 call (status flip, current-period entry removal, moderation log 'trash' noting the email-link channel) answering with the by-title 'moved to Trash' page; NO permanent cascade (no row/vote/entry/order deletes, no media unlink) remains in the branch");
  assert(serverJs28.includes('moderateQueuePage(rows, token, "", liveRows)') && serverJs28.includes("WHERE status='approved' ORDER BY id DESC") && serverJs28.includes("<h2>Live on the board</h2>") && serverJs28.includes("Yes, move to Trash") && serverJs28.includes('name="confirm" value="yes" required'), "Round 13: the queue route fetches the approved plays and the page renders the 'Live on the board' section with the required confirm checkbox on the delete form (→147: the checkbox arms a move to Trash)");
  const modDb28 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
  const png28 = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
  const upMod28 = async (title) => { const f = new FormData(); f.append("title", title); f.append("sport", "hockey"); f.append("division", "boys"); f.append("playerName", "Queue"); f.append("guardianConsent", "on"); f.append("file", new Blob([uniqPng(png28)], { type: "image/png" }), "play.png"); const r = await j("/api/highlights", { method: "POST", body: f }); assert(r.status === 201 && r.body.status === "pending", `Round 13: queue fixture uploads pending (${title})`); return r.body.id; };
  const modPost28 = async (fields) => { const r = await fetch(`${base}/moderate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }); return { status: r.status, body: await r.text() }; };
  await fetch(`${base}/moderate?id=1&token=primer`); // wrong-token primer: generates + stores the real moderation token (same trick as §26)
  const modToken28 = modDb28((d) => d.prepare("SELECT value FROM settings WHERE key='moderate_token'").get()?.value);
  assert(!!modToken28, "Round 13: the stored moderation token is readable for the queue flow tests");
  // Fixtures: two live plays (one of them a sample), one delete
  // victim carrying a vote + a contest entry + a Hype Frame order,
  // and one play left pending.
  const liveId28 = await upMod28("Queue Live Play");
  const sampleLiveId28 = await upMod28("Queue Live Sample");
  const victimId28 = await upMod28("Queue Delete Victim");
  const pendingId28 = await upMod28("Queue Pending Play");
  await modPost28({ id: String(liveId28), token: modToken28, action: "approve" });
  await modPost28({ id: String(sampleLiveId28), token: modToken28, action: "approve_sample" });
  await modPost28({ id: String(victimId28), token: modToken28, action: "approve" });
  const vote28 = await j(`/api/highlights/${victimId28}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "voter-28" }) });
  assert(vote28.status === 200 && vote28.body.voteCount === 1, "Round 13: the delete victim carries a real vote into the delete");
  const enter28 = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: victimId28 }) });
  assert(enter28.status === 201, "Round 13: the delete victim carries a real contest entry into the delete (Round 121: owner path)");
  const victimMedia28 = modDb28((d) => d.prepare("SELECT media_url FROM highlights WHERE id=?").get(victimId28)).media_url;
  const victimFile28 = path.join(tmp, "uploads", path.basename(victimMedia28));
  const printFile28 = path.join(tmp, "hype-frames", "print-28.png");
  fs.mkdirSync(path.dirname(printFile28), { recursive: true });
  fs.writeFileSync(printFile28, png28);
  modDb28((d) => d.prepare("INSERT INTO hype_frame_orders(highlight_id, print_image, guardian_email) VALUES(?,?,?)").run(victimId28, "print-28.png", "guardian@example.com"));
  assert(fs.existsSync(victimFile28) && fs.existsSync(printFile28), "Round 13: the victim's media file and Hype Frame print file are on disk before the delete");
  // The queue page: pending above, live below, nothing crossed.
  const queueRes28 = await fetch(`${base}/moderate-queue?token=${modToken28}`);
  const queue28 = await queueRes28.text();
  assert(queueRes28.status === 200 && queue28.includes("<h2>Live on the board</h2>"), "Round 13: the queue page renders the 'Live on the board' section under the pending list");
  const liveSection28 = queue28.slice(queue28.indexOf("<h2>Live on the board</h2>"));
  const pendingSection28 = queue28.slice(0, queue28.indexOf("<h2>Live on the board</h2>"));
  assert(liveSection28.includes("Queue Live Play") && liveSection28.includes("Queue Live Sample") && liveSection28.includes("⭐ SAMPLE PLAY") && liveSection28.includes("Queue Delete Victim"), "Round 13: the Live section lists every approved play, with the SAMPLE badge on the sample one");
  assert(liveSection28.includes('value="hide"') && liveSection28.includes(">Hide</button>") && liveSection28.includes('value="delete"') && liveSection28.includes(">Move to Trash</button>") && liveSection28.includes('name="confirm" value="yes" required') && liveSection28.includes("Yes, move to Trash") && !liveSection28.includes("permanently"), "Round 13: each Live row carries BOTH forms — Hide, and Delete armed by the required 'Yes, delete permanently' checkbox — →147: the second form is 'Move to Trash', armed by 'Yes, move to Trash', with no 'permanently' wording anywhere in the section");
  assert(!liveSection28.includes("Queue Pending Play") && pendingSection28.includes("Queue Pending Play") && pendingSection28.includes('value="approve_sample"'), "Round 13: the pending play stays in the pending section only (with its Approve as Sample play form) — it is NOT listed as live");
  // Gate + unknown id: same pages as every other action.
  const badDel28 = await modPost28({ id: String(victimId28), token: "definitely-wrong", action: "delete", confirm: "yes" });
  assert(badDel28.status === 403 && badDel28.body.includes("Moderation link not valid"), "Round 13: delete with an invalid token 403s on the same page as the other actions");
  const survivor28 = modDb28((d) => d.prepare("SELECT status FROM highlights WHERE id=?").get(victimId28));
  assert(survivor28 && survivor28.status === "approved", "Round 13: the rejected delete changed nothing — the play is still live");
  const ghost28 = await modPost28({ id: "999999", token: modToken28, action: "delete", confirm: "yes" });
  assert(ghost28.status === 404 && ghost28.body.includes("Play not found"), "Round 13: deleting a nonexistent id gets the same 404 page as the other actions");
  // The delete itself: →147 the confirmation names the play and
  // says Trash — and the play is parked, not cleaned up.
  const del28 = await modPost28({ id: String(victimId28), token: modToken28, action: "delete", confirm: "yes" });
  assert(del28.status === 200 && del28.body.includes("Play moved to Trash") && del28.body.includes("Queue Delete Victim") && del28.body.includes("within 7 days") && !del28.body.includes("permanently deleted"), "Round 13: the delete answers with a confirmation page naming the deleted play by title — →147: 'Play moved to Trash', the 7-day restore window stated, no 'permanently deleted' wording");
  const parked28 = modDb28((d) => ({
    row: d.prepare("SELECT status, status_before_trash, trashed_at FROM highlights WHERE id=?").get(victimId28),
    votes: d.prepare("SELECT COUNT(*) c FROM votes WHERE highlight_id=?").get(victimId28).c,
    entries: d.prepare("SELECT COUNT(*) c FROM contest_entries WHERE highlight_id=?").get(victimId28).c,
    orders: d.prepare("SELECT COUNT(*) c FROM hype_frame_orders WHERE highlight_id=?").get(victimId28).c,
  }));
  assert(parked28.row && parked28.row.status === "trashed" && parked28.row.status_before_trash === "approved" && !!parked28.row.trashed_at && parked28.votes === 1 && parked28.entries === 0 && parked28.orders === 1, "Round 13: the delete removed the play row, its votes, its contest entries AND its Hype Frame orders — →147: it does NOT — the row is 'trashed' (pre-trash status + stamp kept), the vote and the Hype Frame order are KEPT, and only the current-period contest entry is removed");
  assert(fs.existsSync(victimFile28) && fs.existsSync(printFile28), "Round 13: the delete unlinked the uploaded media file and the Hype Frame print image from disk — →147: both files are KEPT (that is the point of Trash)");
  const pub28 = await j("/api/highlights?division=all");
  assert(!pub28.body.highlights.some((h) => h.id === victimId28), "Round 13: the deleted play no longer appears in the public API (→147: a trashed play is off every public surface, the board included)");
  // Hide from the Live section: same action, same flow — the play
  // leaves the board (and the Live list) without being deleted.
  const hideLive28 = await modPost28({ id: String(liveId28), token: modToken28, action: "hide" });
  const hiddenRow28 = modDb28((d) => d.prepare("SELECT status FROM highlights WHERE id=?").get(liveId28));
  assert(hideLive28.status === 200 && hiddenRow28 && hiddenRow28.status === "hidden", "Round 13: Hide from the Live section sets an approved play hidden (row kept, board cleared)");
  const queueAfter28 = await (await fetch(`${base}/moderate-queue?token=${modToken28}`)).text();
  const liveAfter28 = queueAfter28.slice(queueAfter28.indexOf("<h2>Live on the board</h2>"));
  assert(!liveAfter28.includes("Queue Live Play") && liveAfter28.includes("Queue Live Sample"), "Round 13: the hidden play leaves the Live list; the other live play stays");
  // Pending flow is byte-unchanged: plain approve still answers
  // with the original message (§26 proves approve_sample + hide).
  const plainApprove28 = await modPost28({ id: String(pendingId28), token: modToken28, action: "approve" });
  const pendingRow28 = modDb28((d) => d.prepare("SELECT status, is_sample FROM highlights WHERE id=?").get(pendingId28));
  assert(plainApprove28.status === 200 && plainApprove28.body.includes("Approved — this play is now live on the board.") && pendingRow28.status === "approved" && pendingRow28.is_sample === 0, "Round 13: plain approve on a pending play is byte-unchanged — original message, approved, unmarked");

  /* ---- 29. Round 14 (2026-11-06): YouTube tile furniture ----
     The owner's look-and-feel comparison against YouTube approved
     exactly three borrows. (1) DURATION PILL: a black "0:08" pill
     at the thumbnail's bottom-right on BOTH boards' tiles. The API
     returns no duration and no tile text ever carried one, so the
     value comes from the tile's own <video> metadata: the pill
     renders empty + hidden, hydrateDurPills fills it on
     loadedmetadata, and TILE_DURATIONS caches per media_url so
     re-renders paint it instantly. It is pointer-events:none
     (visual only — the tile-tap layer keeps the tap) and sits in
     the only free media corner (winner badge top-left, rank tag
     top-right, SAMPLE badge in the tile BODY). (2) INFO LINE:
     "<first name> · <N> votes · <age>" under Sport · Division,
     replacing the name-only line, built ONLY from API fields
     (athlete label / player name, the tile's own vote count,
     created_at) — no view counts exist or are invented. (3) UP
     NEXT in the play detail: up to 4 other approved plays,
     same-sport first, then votes desc, then newest; a tap swaps
     the dialog through openPlayDetail (hash follows, list
     rebuilds); hidden when no other plays. (Autoplay-advance and
     the session played-set arrived with Round 15 — see §30; the
     one assert below about the rebuilt list was updated in place
     there, because played plays now drop out of it.)
     Harness repairs this round forced in earlier sections: §24's
     tile slice now starts at the Round 14 helpers, and the §24/§25
     board drives stub hydrateDurPills (the real one is driven
     below). ---- */
  {
    const css14 = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
    const tileBlock14 = appJs.slice(appJs.indexOf("const TILE_DURATIONS"), appJs.indexOf("/* Vote hardening"));
    const detailBlock14 = appJs.slice(appJs.indexOf("function renderPlayDetail"), appJs.indexOf("window.openPlayDetail"));
    // (1) Source pins — pill CSS + placement, info line, Up next.
    const pillRule14 = css14.slice(css14.indexOf(".dur-pill{"), css14.indexOf("}", css14.indexOf(".dur-pill{")));
    assert(pillRule14.includes("position:absolute") && pillRule14.includes("right:8px") && pillRule14.includes("bottom:8px"), "Round 14: the duration pill anchors the thumbnail's bottom-right corner");
    assert(pillRule14.includes("pointer-events:none") && pillRule14.includes("background:rgba(0,0,0,.82)") && pillRule14.includes("color:#fff"), "Round 14: the pill is a black YouTube-style chip and pointer-events:none — visual only, the tile tap is untouched");
    assert(css14.includes(".dur-pill[hidden]{display:none}"), "Round 14: an unfilled pill stays display:none until its video's metadata lands");
    assert(tileBlock14.includes('class="tile-media dur-host"') && tileBlock14.indexOf("${durPillHtml(h)}") > tileBlock14.indexOf("ranktag"), "Round 14: the pill renders inside the tile media, after the badge/rank slots");
    assert(tileBlock14.indexOf("${durPillHtml(h)}") < tileBlock14.indexOf('class="tile-body"') && tileBlock14.indexOf("tile-sample-tag") > -1 && tileBlock14.indexOf("tile-sample-tag") < tileBlock14.indexOf('class="tile-body"'), "Round 14/107: pill and SAMPLE tag can never collide — Round 107 puts the tag on the media's top-left and the pill at its bottom-left (opposite corners; Round 14 kept them in different boxes)");
    assert(!appJs.includes("onended"), "Round 14/15: autoplay-advance (Round 15) listens via addEventListener — no inline onended attribute exists");
    assert(appJs.includes("viewCount"), "Round 14/15 →151: the old 'no view-count field is read or invented anywhere' invariant is SUPERSEDED by Round 151 — viewCount now exists as a real server-computed payload field (the play_open sum, §59); the Round 14 rule survives in spirit: the count is never invented client-side, only rendered from the payload");
    assert(detailBlock14.includes("upNextHtml(play)") && detailBlock14.includes("hydrateDurPills()"), "Round 14: the detail render appends Up next and hydrates duration pills");
    const monthBlock14 = appJs.slice(appJs.indexOf("function renderMonth"), appJs.indexOf("function fameThumbHtml"));
    const allBlock14 = appJs.slice(appJs.indexOf("function renderAll2"), appJs.indexOf("let detailPlayId"));
    assert(monthBlock14.includes("hydrateDurPills();") && allBlock14.includes("hydrateDurPills();"), "Round 14: BOTH board renders end with the duration-pill hydration pass");
    assert(css14.includes(".upnext-row{") && css14.includes(".upnext-thumb{") && css14.includes(".tile-info{"), "Round 14: Up-next rows/thumbs and the tile info line have their styles");

    // (2) Behavioral — the real helpers + tileHtml + detail
    // machinery in a vm, §23-style.
    const ago14 = (ms) => new Date(Date.now() - ms).toISOString();
    const plays14 = [
      { id: 201, title: "Goal Fest", sport: "soccer", division: "girls", athlete_label: "Sofia R.", player_name: "Sofia Reyes", media_kind: "file", media_url: "/uploads/s1.mp4", mime: "video/mp4", voteCount: 3, hasVoted: false, isSample: false, isWinner: false, created_at: ago14(2 * 864e5 + 6e4) },
      { id: 202, title: "Second Strike", sport: "soccer", division: "boys", athlete_label: "Liam O.", player_name: "Liam Ortiz", media_kind: "file", media_url: "/uploads/s2.mp4", mime: "video/mp4", voteCount: 9, hasVoted: false, isSample: false, isWinner: false, created_at: ago14(5 * 36e5 + 6e4) },
      { id: 203, title: "Quiet Keeper", sport: "soccer", division: "girls", athlete_label: "Ava B.", player_name: "Ava Brooks", media_kind: "file", media_url: "/uploads/s3.mp4", mime: "video/mp4", voteCount: 1, hasVoted: false, isSample: true, isWinner: false, created_at: ago14(21 * 864e5 + 36e5) },
      { id: 204, title: "Grand Slam", sport: "baseball", division: "boys", athlete_label: "Jayden C.", player_name: "Jayden Cole", media_kind: "file", media_url: "/uploads/s4.mp4", mime: "video/mp4", voteCount: 50, hasVoted: false, isSample: false, isWinner: false, created_at: ago14(36e5) },
      { id: 205, title: "Top Shelf", sport: "hockey", division: "boys", athlete_label: "Noah R.", player_name: "Noah Reed", media_kind: "file", media_url: "/uploads/s5.mp4", mime: "video/mp4", voteCount: 40, hasVoted: false, isSample: false, isWinner: false, created_at: ago14(3 * 864e5) },
      { id: 206, title: "Long Bomb", sport: "football", division: "boys", athlete_label: "Eli F.", player_name: "Eli Ford", media_kind: "file", media_url: "/uploads/s6.mp4", mime: "video/mp4", voteCount: 30, hasVoted: false, isSample: false, isWinner: false, created_at: ago14(4 * 864e5) },
    ];
    const bodyEl14 = { innerHTML: "" };
    const wrap14 = { hidden: true, scrollTop: 0, querySelector: () => ({ focus: () => {} }) };
    const classes14 = new Set();
    const loc14 = { hash: "" };
    const durHosts14 = [];
    const doc14 = {
      querySelector: (sel) => (sel === "#playDetail" ? wrap14 : sel === "#playDetailBody" ? bodyEl14 : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { classList: { add: (c) => classes14.add(c), remove: (c) => classes14.delete(c) } },
    };
    const sb14 = {
      console, window: {},
      document: doc14,
      $: (sel) => doc14.querySelector(sel),
      $$: (sel) => (sel === ".dur-host" ? durHosts14 : []),
      location: loc14,
      history: { replaceState: (a, b, url) => { loc14.hash = url; } },
      switchView: () => {}, showHome: () => {}, showPanel: () => {},
      ownerToken: () => "",
      ALL_PLAYS: plays14,
      CONTEST: { period: "2026-11", entries: [], winnerId: null },
    };
    const ctx14 = vm.createContext(sb14);
    vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), ctx14);
    vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), ctx14);
    vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine")), ctx14);
    vm.runInContext(appJs.slice(appJs.indexOf("let detailPlayId"), appJs.indexOf("/* ---------------- athlete collection")), ctx14);
    vm.runInContext("var openPlayDetail = window.openPlayDetail, closePlayDetail = window.closePlayDetail;", ctx14);
    const r14 = (code) => vm.runInContext(code, ctx14);

    // Formatting + age units, driven directly with a fixed clock.
    const NOW14 = Date.parse("2026-11-06T12:00:00Z");
    assert(r14(`fmtDur(8.2)`) === "0:08" && r14(`fmtDur(65)`) === "1:05" && r14(`fmtDur(600)`) === "10:00" && r14(`fmtDur(0)`) === "0:00", "Round 14: fmtDur renders m:ss the YouTube way");
    assert(r14(`humanAge("2026-11-06T11:59:30Z", ${NOW14})`) === "just now" && r14(`humanAge("2026-11-06T11:45:00Z", ${NOW14})`) === "15m ago" && r14(`humanAge("2026-11-06T07:00:00Z", ${NOW14})`) === "5h ago" && r14(`humanAge("2026-11-04T12:00:00Z", ${NOW14})`) === "2d ago" && r14(`humanAge("2026-10-16T12:00:00Z", ${NOW14})`) === "3w ago", "Round 14: humanAge covers just now / minutes / hours / days / weeks");
    assert(r14(`humanAge("2026-11-06 11:59:30", ${NOW14})`) === "just now", "Round 14: the SQLite space-form created_at parses as UTC (no viewer-timezone shift)");
    assert(r14(`humanAge("", ${NOW14})`) === "" && r14(`humanAge("junk", ${NOW14})`) === "", "Round 14: a missing or junk created_at yields no age (the info line just omits it)");

    // Tiles: pill present (empty + hidden pre-metadata) on video
    // tiles of both boards, absent where no duration can exist;
    // info line format, month count, singular.
    const tAll14 = r14("tileHtml(ALL_PLAYS[0])");
    assert(tAll14.includes('class="tile-media dur-host"') && tAll14.includes('<span class="dur-pill" aria-hidden="true" hidden></span>'), "Round 14: an All Hypes video tile carries the duration pill (empty + hidden until metadata)");
    const tMonth14 = r14("tileHtml(ALL_PLAYS[0], { monthVotes: 7 })");
    assert(tMonth14.includes('<span class="dur-pill" aria-hidden="true" hidden></span>'), "Round 14: a Month-board tile carries the same pill (one tileHtml serves both boards)");
    assert(tAll14.includes('<span class="meta-name153">Sofia Reyes</span>') && tAll14.includes(" · Soccer · ▶ 0 · <b>3</b> votes"), "Round 14/45: the info line is ONE merged line from API fields only — →153: the HYBRID line '<FULL name> · <sport> · ▶ <views> · <N> votes' — the name is player_name (the fullest in the payload), views are the Round 151 count (0 in this fixture), division + age have left the card");
    assert(tMonth14.includes(" · Soccer · ▶ 0 · <b>7</b> votes") && !tMonth14.includes("this month"), "Round 14/45: on the Month board the merged line carries the MONTH vote count — →153: labeled plainly 'votes' on the card");
    assert(tAll14.includes("Sofia Reyes") && tAll14.includes("Soccer") && !tAll14.includes(" · Girls · "), "Round 45: sport lives inside the single info line (the separate Sport · Division line retired) — →153: the name segment is the FULL name and the division segment is gone from the card");
    const tOne14 = r14("tileHtml(ALL_PLAYS[2])");
    assert(tOne14.includes('<span class="meta-name153">Ava Brooks</span>') && tOne14.includes(" · Soccer · ▶ 0 · <b>1</b> vote</span>"), "Round 14/45: the merged info line singularizes '1 vote' — →153: full name + plain 'votes' label in the meta; no age segment (humanAge still serves the detail view); the sample chip in the action row keeps its 'all-time' wording, untouched");
    assert(tOne14.includes("⭐ SAMPLE PLAY") && tOne14.includes("dur-pill"), "Round 14: a sample tile carries BOTH the SAMPLE badge and the duration pill");
    const bodyPart14 = tAll14.slice(tAll14.indexOf('class="tile-body"'));
    assert(!/\b\d+:\d{2}\b/.test(bodyPart14), "Round 14: the duration appears ONLY in the pill — no m:ss text anywhere in the tile body (no double display)");
    assert(!r14("tileHtml({ id: 301, title: 'Pic', sport: 'cheer', division: 'girls', player_name: 'Kim', media_kind: 'file', media_url: '/uploads/p.png', mime: 'image/png', voteCount: 0, hasVoted: false, created_at: '' })").includes("dur-pill"), "Round 14: an image play gets NO pill (no client-side duration exists)");
    assert(!r14("tileHtml({ id: 302, title: 'Emb', sport: 'cheer', division: 'girls', player_name: 'Kim', media_kind: 'link_embed', media_url: '', embed_url: 'https://youtube.example/embed/x', voteCount: 0, hasVoted: false, created_at: '' })").includes("dur-pill"), "Round 14: an embed play gets NO pill (its duration is not readable client-side)");

    // Hydration: readyState path fills + caches; the
    // loadedmetadata path fills on the event; a re-render then
    // paints the pill instantly from the cache.
    const mkHost14 = (src, dur, readyState) => {
      const listeners = {};
      const video = { duration: dur, readyState, getAttribute: (a) => (a === "src" ? src : null), addEventListener: (ev, fn) => { listeners[ev] = fn; } };
      const pill = { textContent: "", hidden: true };
      return { host: { querySelector: (sel) => (sel === "video" ? video : sel === ".dur-pill" ? pill : null) }, video, pill, listeners };
    };
    const hReady14 = mkHost14("/uploads/s1.mp4", 65.4, 4);
    durHosts14.push(hReady14.host);
    r14("hydrateDurPills()");
    assert(hReady14.pill.textContent === "1:05" && hReady14.pill.hidden === false, "Round 14: hydration fills the pill from the video's metadata when it is already loaded");
    assert(r14(`TILE_DURATIONS.get("/uploads/s1.mp4")`) === 65.4, "Round 14: the filled duration is cached by media_url");
    const tCached14 = r14("tileHtml(ALL_PLAYS[0])");
    assert(tCached14.includes('<span class="dur-pill" aria-hidden="true">1:05</span>'), "Round 14: a re-render paints the pill instantly from the cache — no hidden flash after a vote refresh");
    const hLate14 = mkHost14("/uploads/s2.mp4", 0, 0);
    durHosts14.length = 0; durHosts14.push(hLate14.host);
    r14("hydrateDurPills()");
    assert(hLate14.pill.hidden === true && hLate14.pill.textContent === "", "Round 14: before metadata the pill stays hidden and empty");
    hLate14.video.duration = 8.2; hLate14.listeners.loadedmetadata();
    assert(hLate14.pill.textContent === "0:08" && hLate14.pill.hidden === false, "Round 14: loadedmetadata fills the pill with the video's own duration");
    durHosts14.length = 0;

    // Up next: order, exclusion, cap — then the tap swap.
    r14("window.openPlayDetail(201)");
    assert(r14("detailPlayId") === 201 && bodyEl14.innerHTML.includes('data-play-id="201"'), "Round 14: the detail opens on the tapped play as before");
    const up14 = bodyEl14.innerHTML.slice(bodyEl14.innerHTML.indexOf('class="upnext"'));
    assert(up14.includes("Up next"), "Round 14: the detail carries an Up next section below the card");
    const order14 = [202, 203, 204, 205].map((id) => up14.indexOf(`openPlayDetail(${id})`));
    assert(order14.every((i) => i > -1) && order14[0] < order14[1] && order14[1] < order14[2] && order14[2] < order14[3], "Round 14: Up next orders same-sport first (202's 9 votes, then 203), then the rest by votes desc (204's 50, 205's 40)");
    assert(!up14.includes("openPlayDetail(201)") && !up14.includes("openPlayDetail(206)"), "Round 14: Up next never lists the open play, and the 4-row cap drops the 5th candidate (206)");
    assert((up14.match(/upnext-row/g) || []).length === 4, "Round 14: Up next lists exactly 4 rows here");
    assert(up14.includes("Second Strike") && up14.includes("Liam · 9 votes") && up14.includes("dur-pill"), "Round 14: a row shows poster thumb + duration pill, title, athlete first name + votes");
    wrap14.scrollTop = 999;
    r14("window.openPlayDetail(202)");
    assert(r14("detailPlayId") === 202 && loc14.hash === "#play-202" && bodyEl14.innerHTML.includes('data-play-id="202"'), "Round 14: tapping an Up-next row swaps the dialog to that play and moves the #play- hash with it");
    assert(wrap14.scrollTop === 0, "Round 14: the swap restarts the overlay at the new play's top");
    const up14b = bodyEl14.innerHTML.slice(bodyEl14.innerHTML.indexOf('class="upnext"'));
    assert(!up14b.includes("openPlayDetail(202)") && !up14b.includes("openPlayDetail(201)") && up14b.includes("openPlayDetail(203)"), "Round 15 (supersedes the Round 14 line): the rebuilt Up next excludes the new open play AND the already-played previous one — played plays drop out of the session list, and the next unplayed candidate (203) is offered");
    r14("window.closePlayDetail()");
    assert(wrap14.hidden === true && loc14.hash === "#top", "Round 14: ← Back still closes the detail and drops its hash (unchanged)");
    // Single-play board: no section at all.
    r14("ALL_PLAYS = [ALL_PLAYS[0]]; CONTEST = { period: '2026-11', entries: [], winnerId: null };");
    r14("window.openPlayDetail(201)");
    assert(bodyEl14.innerHTML.includes('data-play-id="201"') && !bodyEl14.innerHTML.includes('class="upnext"'), "Round 14: with a single approved play the Up next section is hidden entirely");
    r14("window.closePlayDetail()");
  }

  /* ---- 30. Round 15 (2026-11-06): autoplay-advance for Up next ----
     The owner turned ON the YouTube behavior Round 14 deliberately
     left out: when the open play's video finishes, the detail rolls
     into the next Up next candidate on its own. Rules: (1) advance
     goes through openPlayDetail, exactly like a tap (full re-render,
     hash follows, overlay scrolls to top); (2) NO cycles — a
     per-detail-session played set (detailPlayedIds) feeds the same
     candidate logic as the list, so played plays drop out of BOTH,
     and when no unplayed candidate remains autoplay just stops (no
     wrap, no replay); the set resets when a detail opens fresh from
     outside, and within-detail moves (tap or advance) add to it;
     (3) a small Autoplay switch in the Up next heading, default ON,
     session-only (a page-load variable, never stored), repainting
     itself in place so flipping it never restarts the video;
     (4) guards — only a real file/link video wires an ended
     listener (image and embed plays never advance; samples advance
     like any play), only the ended event triggers (pause never
     does), and closing the detail tears the handler down. The
     detail video's shared loop attribute is removed for the
     detail's own copy, or the ended event could never fire. ---- */
  {
    const css15 = fs.readFileSync(path.join(root, "public", "styles.css"), "utf8");
    // (1) Source pins.
    assert(appJs.includes('addEventListener("ended"') && appJs.includes('removeEventListener("ended"'), "Round 15: the detail video's ended event is wired with addEventListener and torn down with removeEventListener");
    assert(appJs.includes("let detailAutoplay = true;") && appJs.includes("const detailPlayedIds = new Set();"), "Round 15: autoplay defaults ON at page load (a session-only variable) and the per-session played set exists");
    assert(appJs.includes("autoplay-toggle") && appJs.includes('onclick="toggleDetailAutoplay()"'), "Round 15: the Up next heading carries the Autoplay toggle switch");
    const togRule15 = css15.slice(css15.indexOf(".autoplay-toggle.on{"), css15.indexOf("}", css15.indexOf(".autoplay-toggle.on{")));
    assert(togRule15.includes("var(--volt)"), "Round 15: the toggle's ON state is volt-lime, matching the site's pill language");
    assert(css15.includes(".upnext-head{"), "Round 15: the Up next heading row (title + toggle) has its layout style");

    // (2) Behavioral — the §29 drive pattern, with a fake detail
    // video whose listeners the test can inspect and fire.
    const ago15 = (ms) => new Date(Date.now() - ms).toISOString();
    const plays15 = [
      { id: 201, title: "Goal Fest", sport: "soccer", division: "girls", athlete_label: "Sofia R.", player_name: "Sofia Reyes", media_kind: "file", media_url: "/uploads/s1.mp4", mime: "video/mp4", voteCount: 3, hasVoted: false, isSample: false, isWinner: false, created_at: ago15(2 * 864e5 + 6e4) },
      { id: 202, title: "Second Strike", sport: "soccer", division: "boys", athlete_label: "Liam O.", player_name: "Liam Ortiz", media_kind: "file", media_url: "/uploads/s2.mp4", mime: "video/mp4", voteCount: 9, hasVoted: false, isSample: false, isWinner: false, created_at: ago15(5 * 36e5 + 6e4) },
      { id: 203, title: "Quiet Keeper", sport: "soccer", division: "girls", athlete_label: "Ava B.", player_name: "Ava Brooks", media_kind: "file", media_url: "/uploads/s3.mp4", mime: "video/mp4", voteCount: 1, hasVoted: false, isSample: true, isWinner: false, created_at: ago15(21 * 864e5 + 36e5) },
      { id: 204, title: "Grand Slam", sport: "baseball", division: "boys", athlete_label: "Jayden C.", player_name: "Jayden Cole", media_kind: "file", media_url: "/uploads/s4.mp4", mime: "video/mp4", voteCount: 50, hasVoted: false, isSample: false, isWinner: false, created_at: ago15(36e5) },
      { id: 205, title: "Top Shelf", sport: "hockey", division: "boys", athlete_label: "Noah R.", player_name: "Noah Reed", media_kind: "file", media_url: "/uploads/s5.mp4", mime: "video/mp4", voteCount: 40, hasVoted: false, isSample: false, isWinner: false, created_at: ago15(3 * 864e5) },
      { id: 206, title: "Long Bomb", sport: "football", division: "boys", athlete_label: "Eli F.", player_name: "Eli Ford", media_kind: "file", media_url: "/uploads/s6.mp4", mime: "video/mp4", voteCount: 30, hasVoted: false, isSample: false, isWinner: false, created_at: ago15(4 * 864e5) },
    ];
    const mkVideo15 = () => ({
      listeners: {}, removedAttrs: [],
      addEventListener(ev, fn) { this.listeners[ev] = fn; },
      removeEventListener(ev, fn) { if (this.listeners[ev] === fn) delete this.listeners[ev]; },
      removeAttribute(a) { this.removedAttrs.push(a); },
      fire(ev) { if (this.listeners[ev]) this.listeners[ev](); },
    });
    let video15 = null;
    const bodyEl15 = { innerHTML: "", querySelector: (sel) => (sel === "video" ? video15 : null) };
    const wrap15 = { hidden: true, scrollTop: 0, querySelector: () => ({ focus: () => {} }) };
    const classes15 = new Set();
    const loc15 = { hash: "" };
    const stateSpan15 = { textContent: "On" };
    const toggleBtn15 = { attrs: {}, classList: { toggles: [], toggle(c, f) { this.toggles.push([c, f]); } }, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => stateSpan15 };
    const doc15 = {
      querySelector: (sel) => (sel === "#playDetail" ? wrap15 : sel === "#playDetailBody" ? bodyEl15 : null),
      querySelectorAll: () => [],
      addEventListener: () => {},
      body: { classList: { add: (c) => classes15.add(c), remove: (c) => classes15.delete(c) } },
    };
    const sb15 = {
      console, window: {},
      document: doc15,
      $: (sel) => doc15.querySelector(sel),
      $$: (sel) => (sel === ".autoplay-toggle" ? [toggleBtn15] : []),
      location: loc15,
      history: { replaceState: (a, b, url) => { loc15.hash = url; } },
      switchView: () => {}, showHome: () => {}, showPanel: () => {},
      ownerToken: () => "",
      ALL_PLAYS: plays15,
      CONTEST: { period: "2026-11", entries: [], winnerId: null },
    };
    const ctx15 = vm.createContext(sb15);
    vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), ctx15);
    vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), ctx15);
    vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function renderMine")), ctx15);
    vm.runInContext(appJs.slice(appJs.indexOf("let detailPlayId"), appJs.indexOf("/* ---------------- athlete collection")), ctx15);
    vm.runInContext("var openPlayDetail = window.openPlayDetail, closePlayDetail = window.closePlayDetail;", ctx15);
    const r15 = (code) => vm.runInContext(code, ctx15);
    const openWithVideo15 = (id) => { video15 = mkVideo15(); r15(`window.openPlayDetail(${id})`); return video15; };

    // Fresh open: default ON, toggle painted ON in the heading,
    // ended wired (and ONLY ended), loop stripped, set seeded.
    const v1 = openWithVideo15(201);
    assert(r15("detailAutoplay") === true, "Round 15: autoplay is ON by default");
    assert(r15("detailPlayId") === 201 && typeof v1.listeners.ended === "function" && !("pause" in v1.listeners), "Round 15: a video play's detail wires ONLY the ended event — pausing never advances");
    assert(v1.removedAttrs.includes("loop"), "Round 15: the detail video's loop attribute is removed, so the ended event can actually fire");
    const head15 = bodyEl15.innerHTML.slice(bodyEl15.innerHTML.indexOf('class="upnext"'));
    assert(head15.includes('class="autoplay-toggle on"') && head15.includes('aria-pressed="true"') && head15.includes(">On<"), "Round 15: the Autoplay toggle renders ON in the Up next heading, before the list");
    assert(r15("detailPlayedIds.has(201)") === true, "Round 15: opening a play seeds the session played set with it");

    // Advance chain: same-sport first, samples included, played
    // plays drop out of the list as the session progresses.
    v1.fire("ended");
    assert(r15("detailPlayId") === 202 && loc15.hash === "#play-202" && bodyEl15.innerHTML.includes('data-play-id="202"'), "Round 15: when a play ends, the view rolls into the first unplayed Up next candidate — content and hash swap exactly like a tap");
    const up15b = bodyEl15.innerHTML.slice(bodyEl15.innerHTML.indexOf('class="upnext"'));
    assert(!up15b.includes("openPlayDetail(201)") && !up15b.includes("openPlayDetail(202)"), "Round 15: played plays drop out of the Up next list as the session progresses");
    video15.fire("ended");
    assert(r15("detailPlayId") === 203 && bodyEl15.innerHTML.includes("SAMPLE PLAY"), "Round 15: autoplay advances into a SAMPLE play like any other (samples are the board's content)");

    // Toggle off mid-session prevents the next advance; on re-arms.
    r15("window.toggleDetailAutoplay()");
    assert(r15("detailAutoplay") === false && toggleBtn15.attrs["aria-pressed"] === "false" && stateSpan15.textContent === "Off", "Round 15: toggling off flips the session variable and repaints the switch in place (no re-render)");
    video15.fire("ended");
    assert(r15("detailPlayId") === 203, "Round 15: with autoplay off, a finished play does NOT advance");
    r15("window.toggleDetailAutoplay()");
    assert(r15("detailAutoplay") === true && stateSpan15.textContent === "On", "Round 15: toggling back on re-arms autoplay");

    // The walk continues by votes, then stops dead at the pool's end.
    video15.fire("ended");
    assert(r15("detailPlayId") === 204, "Round 15: once the same-sport pool is played, advance continues by votes descending");
    video15.fire("ended");
    video15.fire("ended");
    assert(r15("detailPlayId") === 206, "Round 15: autoplay walks the whole pool exactly once");
    video15.fire("ended");
    assert(r15("detailPlayId") === 206, "Round 15: with no unplayed candidate left, autoplay STOPS at the end — no wrap-around, no replay");

    // Back tears the handler down; a fresh open resets the set.
    r15("window.closePlayDetail()");
    assert(!("ended" in video15.listeners) && r15("detailPlayId") === null, "Round 15: closing the detail (Back) removes the ended handler — nothing advances in the background");
    video15.fire("ended");
    assert(r15("detailPlayId") === null, "Round 15: a stray ended event after close changes nothing");
    const v2 = openWithVideo15(201);
    const up15c = bodyEl15.innerHTML.slice(bodyEl15.innerHTML.indexOf('class="upnext"'));
    assert(up15c.includes("openPlayDetail(202)"), "Round 15: reopening fresh from outside RESETS the played set — the first candidate is offered again");
    v2.fire("ended");
    assert(r15("detailPlayId") === 202, "Round 15: after the reset, autoplay advances from the top of the pool again");
    r15("window.closePlayDetail()");

    // Image and embed plays never wire an advance.
    r15(`ALL_PLAYS = [...ALL_PLAYS, { id: 207, title: "Still Photo", sport: "cheer", division: "girls", player_name: "Kim Park", media_kind: "file", media_url: "/uploads/p.png", mime: "image/png", voteCount: 0, hasVoted: false, created_at: "" }, { id: 208, title: "Embedded Clip", sport: "cheer", division: "girls", player_name: "Kim Park", media_kind: "link_embed", media_url: "", embed_url: "https://youtube.example/embed/x", voteCount: 0, hasVoted: false, created_at: "" }];`);
    const vImg = openWithVideo15(207);
    assert(r15("detailPlayId") === 207 && !("ended" in vImg.listeners), "Round 15: an image play registers NO advance (it has no ended event)");
    r15("window.closePlayDetail()");
    const vEmb = openWithVideo15(208);
    assert(r15("detailPlayId") === 208 && !("ended" in vEmb.listeners), "Round 15: an embed play registers NO advance (an iframe's end is not ours to hear)");
    r15("window.closePlayDetail()");
  }

  /* ---- 31. Round 21 (2026-11-06): guardian attestation ----------
     The upload form gains ONE required checkbox in the guardian
     block — "I'm this athlete's parent/guardian, or I have their
     permission to post this video." Guardian CONTACT stays optional
     (§21 stands); the ATTESTATION does not. Client blocks an
     unticked submit with an inline message; the server refuses it
     (400) before any file is written and stamps guardian_consent_at
     (ISO) on the play. The timestamp is owner/moderation-only: the
     public allowlist must not grow. Upload budget note: the suite
     is at 14 of the server's 20 uploads/hour before this section;
     these five bring it to 19 — do not add more POSTs above. ---- */
  assert((home.split('name="guardianConsent"').length - 1) === 1, "Round 21: the upload form carries exactly one guardianConsent checkbox");
  const gbAt31 = home.indexOf('class="quick-field guardian-block"');
  assert(gbAt31 > -1 && home.indexOf('name="guardianConsent"') > gbAt31 && home.indexOf('name="guardianConsent"') < moreAt, "Round 21: the attestation checkbox lives inside the guardian block, in the MAIN form before Add more");
  assert(home.includes("I'm this athlete's parent/guardian, or I have their permission to post this video — and I understand HighlightHype may share this clip and still images from it on its website and social channels."), "Round 21: the attestation label is the exact approved copy (Round 116: social + stills sharing named in the label)");
  assert(!/name="guardianConsent"[^>]*checked/.test(home), "Round 21: the attestation checkbox starts unchecked");
  assert(appJs.includes("form.elements.guardianConsent") && appJs.includes("Please confirm you're the parent/guardian, or have their permission, to post this video."), "Round 21: an unticked submit is blocked client-side with the inline confirmation message");
  const db31 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
  const countTitle31 = (t) => db31((d) => d.prepare("SELECT COUNT(*) c FROM highlights WHERE title=?").get(t).c);
  const uploadFiles31 = () => fs.readdirSync(path.join(tmp, "uploads")).length;
  // (a) No attestation (multipart, the real form's shape): 400, the
  // confirmation message, NO play row and NO orphan file on disk.
  const filesBefore31 = uploadFiles31();
  const fNo31 = new FormData();
  fNo31.append("title", "Round 21 No Consent Play"); fNo31.append("sport", "baseball"); fNo31.append("division", "boys"); fNo31.append("playerName", "Nia");
  fNo31.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
  const noConsent31 = await j("/api/highlights", { method: "POST", body: fNo31 });
  assert(noConsent31.status === 400 && (noConsent31.body.message || "").includes("Please confirm you're the parent/guardian"), "Round 21: a file upload WITHOUT the attestation is refused (400) with the confirmation message");
  assert(countTitle31("Round 21 No Consent Play") === 0 && uploadFiles31() === filesBefore31, "Round 21: the refused upload created no play and left no orphan file");
  // (b) A present-but-false value (JSON path) is refused the same way.
  const jsonFalse31 = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Round 21 False Consent", sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "false" }) });
  assert(jsonFalse31.status === 400 && countTitle31("Round 21 False Consent") === 0, "Round 21: guardianConsent='false' is refused too (400, nothing created)");
  // (c) With attestation but NO media, the refusal is the old media
  // one — the consent gate passes and the media guard still fires.
  const noMedia31 = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Round 21 Consent No Media", sport: "baseball", guardianConsent: "true" }) });
  assert(noMedia31.status === 400 && /file or paste a video link/.test(noMedia31.body.message || ""), "Round 21: attested but medialess still hits the media guard (400, media message)");
  // (d) The real checkbox value ("on", multipart): 201, and the
  // attestation timestamp is stored on the play.
  const fYes31 = new FormData();
  fYes31.append("title", "Round 21 Consent Play"); fYes31.append("sport", "baseball"); fYes31.append("division", "boys"); fYes31.append("playerName", "Cory");
  fYes31.append("guardianConsent", "on");
  fYes31.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
  const yes31 = await j("/api/highlights", { method: "POST", body: fYes31 });
  assert(yes31.status === 201 && yes31.body.status === "pending", "Round 21: an upload WITH the attestation succeeds and starts pending");
  const consentId31 = yes31.body.id;
  const row31 = db31((d) => d.prepare("SELECT guardian_consent_at FROM highlights WHERE id=?").get(consentId31));
  assert(row31 && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(row31.guardian_consent_at || "") && !isNaN(Date.parse(row31.guardian_consent_at)), "Round 21: guardian_consent_at is stored on the play as an ISO timestamp from upload time");
  // (e) JSON "true" is accepted as well.
  const jsonYes31 = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Round 21 JSON Consent", sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
  assert(jsonYes31.status === 201, "Round 21: guardianConsent='true' on the JSON path is accepted (201)");
  // (f) Owner queue carries it; Owner view renders it.
  const oq31 = await j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  const oqItem31 = oq31.body.queue.find((h) => h.id === consentId31);
  assert(oqItem31 && oqItem31.guardian_consent_at === row31.guardian_consent_at, "Round 21: the owner queue payload carries the play's guardian_consent_at");
  assert(appJs.includes("Guardian consent ✓") && appJs.includes("h.guardian_consent_at"), "Round 21: the Owner view renders the 'Guardian consent ✓ <date>' line from the payload");
  // (g) Moderation surfaces show it, formatted like the spec example.
  const dateStr31 = new Date(row31.guardian_consent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "America/New_York" });
  const queuePage31 = await (await fetch(`${base}/moderate-queue?token=${modToken28}`)).text();
  assert(queuePage31.includes("Round 21 Consent Play") && queuePage31.includes(`Guardian consent ✓ ${dateStr31}`), "Round 21: the moderation queue lists the pending play with 'Guardian consent ✓ <date>'");
  const modPage31 = await (await fetch(`${base}/moderate?id=${consentId31}&token=${modToken28}`)).text();
  assert(modPage31.includes(`Guardian consent ✓ ${dateStr31}`), "Round 21: the per-play moderation page shows the attestation too");
  // (h) A legacy play (inserted directly, no attestation — the shape
  // every pre-Round-21 play has) shows NOTHING: no consent line, and
  // an empty string in the owner payload.
  db31((d) => d.prepare("INSERT INTO highlights(title,sport,media_kind,media_url,mime,status) VALUES('Round 21 Legacy Play','baseball','file','/uploads/legacy21.png','image/png','pending')").run());
  const legacyId31 = db31((d) => d.prepare("SELECT id FROM highlights WHERE title='Round 21 Legacy Play'").get().id);
  const legacyPage31 = await (await fetch(`${base}/moderate?id=${legacyId31}&token=${modToken28}`)).text();
  assert(legacyPage31.includes("Round 21 Legacy Play") && !legacyPage31.includes("Guardian consent"), "Round 21: a legacy play with no attestation shows no consent line anywhere on its moderation page");
  const oqLegacy31 = (await j("/api/owner/queue", { headers: { "x-owner-token": tok } })).body.queue.find((h) => h.id === legacyId31);
  assert(oqLegacy31 && oqLegacy31.guardian_consent_at === "", "Round 21: the owner payload reports an empty attestation for the legacy play");
  // (i) Public API: even after approval, no consent field leaks.
  const ap31 = await j(`/api/highlights/${consentId31}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(ap31.body.status === "approved", "Round 21: the attested play approves normally");
  const pub31 = await j("/api/highlights?division=all");
  const pubItem31 = pub31.body.highlights.find((h) => h.id === consentId31);
  assert(pubItem31 && !("guardian_consent_at" in pubItem31) && !("guardianConsent" in pubItem31), "Round 21: the public payload for the attested play carries NO consent field");
  const pubRaw31 = await (await fetch(base + "/api/highlights?division=all")).text();
  assert(!pubRaw31.includes("guardian_consent"), "Round 21: 'guardian_consent' appears NOWHERE in the public API response (allowlist unchanged)");
  // (j) Migration on a LEGACY (pre-Round-21) DB: base schema only,
  // no guardian_consent_at column anywhere — a fresh boot must add
  // it idempotently, default the old row to '', and enforce the
  // gate for new uploads on that same DB.
  const legacyDir31 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-legacy21-"));
  const legacyDb31 = new DatabaseSync(path.join(legacyDir31, "highlighthype.db"));
  legacyDb31.exec(`CREATE TABLE highlights(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL, sport TEXT NOT NULL DEFAULT 'other',
    play_type TEXT DEFAULT '', player_name TEXT DEFAULT '', story TEXT DEFAULT '',
    media_kind TEXT NOT NULL, media_url TEXT NOT NULL, mime TEXT DEFAULT '',
    embed_url TEXT DEFAULT '', host_label TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  INSERT INTO highlights(title,sport,media_kind,media_url,mime,status) VALUES('Pre Round21 Play','baseball','file','/uploads/old.png','image/png','approved');`);
  legacyDb31.close();
  const PORT31 = 3461;
  const child31 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT31), DATA_DIR: legacyDir31 }, stdio: "pipe" });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${PORT31}/api/health`); break; } catch { await wait(200); } }
    const cols31 = (() => { const d = new DatabaseSync(path.join(legacyDir31, "highlighthype.db")); try { return d.prepare("PRAGMA table_info(highlights)").all().map((c) => c.name); } finally { d.close(); } })();
    assert(cols31.includes("guardian_consent_at"), "Round 21: boot adds guardian_consent_at to a pre-Round-21 DB (idempotent ALTER, same pattern as is_sample)");
    const oldRow31 = (() => { const d = new DatabaseSync(path.join(legacyDir31, "highlighthype.db")); try { return d.prepare("SELECT guardian_consent_at FROM highlights WHERE title='Pre Round21 Play'").get(); } finally { d.close(); } })();
    assert(oldRow31 && oldRow31.guardian_consent_at === "", "Round 21: the pre-Round-21 play defaults to an empty attestation after migration");
    const legacyPub31 = await (await fetch(`http://localhost:${PORT31}/api/highlights?division=all`)).json();
    const legacyPubRow31 = (legacyPub31.highlights || []).find((h) => h.title === "Pre Round21 Play");
    assert(legacyPubRow31 && !("guardian_consent_at" in legacyPubRow31), "Round 21: the migrated legacy play serves publicly with no consent field");
    const fOld31 = new FormData();
    fOld31.append("title", "Post Migration No Consent"); fOld31.append("sport", "baseball"); fOld31.append("division", "boys"); fOld31.append("playerName", "Old");
    fOld31.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
    const oldNoRes31 = await fetch(`http://localhost:${PORT31}/api/highlights`, { method: "POST", body: fOld31 });
    assert(oldNoRes31.status === 400, "Round 21: the migrated DB's server enforces the attestation gate on new uploads (400)");
  } finally {
    child31.kill();
    fs.rmSync(legacyDir31, { recursive: true, force: true });
  }

  /* ---- 32. Round 22 (2026-11-06): FAB + upload overlay, hero
     slim-down, gold brand pass --------------------------------
     External design feedback, approved by Emil "as mapped":
     (1) PHONES ONLY (≤760px): the floating Submit pill becomes a
     compact FAB (Round 23 supersedes the original 56px
     upload-arrow circle with a 48px "＋ Post" pill — the arrow
     read as "back to top"; full detail in §33) that no longer
     drapes over cards/text/footer controls, and tapping it — or
     any [data-submit-link] CTA — opens the SAME #uploadForm as a
     fixed full-viewport overlay (body.upload-open) with a fixed
     ✕; closing preserves form state. Desktop keeps the pill and
     the in-page form exactly (Round 24 supersedes the desktop
     half — the overlay opens at every width and the form leaves
     the flow; §34). (2) HERO: the paragraph is Emil's
     one line and the tagline element is gone from the hero (it
     still rides the footer lockup image + alt). (3) PALETTE:
     --gold is the crest gold #D4AF37 and carries the brand
     surfaces (sec-tag eyebrows, the .lime word in section h2s,
     the hero headline's "hype.", the spotlight tag, the podium
     .lead, the step numerals); lime stays on every interactive
     element. No uploads in this section (the §31 budget note
     stands) — markup/CSS/wiring checks plus a vm drive of the
     real goSubmit/open/close functions. ---- */
  // (1a) FAB markup: same button, same accessible name, now an
  // upload icon + a label span the phone CSS can hide.
  const fab32 = home.slice(home.indexOf('id="floatSubmit"'), home.indexOf("<!-- ============ HERO"));
  assert(fab32.includes('aria-label="Post a Play — go to the upload form"'), "Round 22: the FAB keeps its accessible name ('Post a Play — go to the upload form'; Round 123 one-label sweep, was 'Submit a Hype …')");
  assert(fab32.includes("<svg") && fab32.includes('d="M12 5v14"') && fab32.includes('d="M5 12h14"') && fab32.includes('class="float-submit-label">Post a Play</span>'), "Round 22/23: the FAB carries a plus icon and the full label span (the pill's text on desktop, hidden on phones; plus supersedes the upload arrow — §33)");
  // (1b) The overlay close: exactly one ✕, inside the form itself.
  assert((home.split('id="uploadClose"').length - 1) === 1, "Round 22: exactly one #uploadClose button exists");
  const formOpen32 = home.indexOf('<form id="uploadForm"');
  assert(home.indexOf('id="uploadClose"') > formOpen32 && home.indexOf('id="uploadClose"') < home.indexOf("</form>"), "Round 22: the ✕ lives inside #uploadForm (it renders only in the overlay state)");
  // (1c) Phone CSS: compact FAB + the overlay layer + the locks.
  const css22 = css.slice(css.indexOf("===== Round 22"), css.indexOf("===== Round 24"));
  assert(css22.includes("@media (max-width:760px)"), "Round 22: the Round 22 block's FAB/overlay rules are fenced to ≤760px (Round 24 layers its all-widths rules in the NEXT block — §34)");
  assert(css22.includes(".float-submit{width:auto;height:48px") && css22.includes("border-radius:999px"), "Round 23: on phones the pill becomes a compact 48px-tall pill (Round 22's 56px round icon-only FAB superseded — its upload arrow read as 'back to top')");
  assert(css22.includes(".float-submit-label{display:none}"), "Round 22/23: the FAB's full label text is hidden on phones (the short 'Post' label shows instead — §33)");
  assert(css22.includes("body.upload-open #uploadForm{position:fixed;inset:0") && css22.includes("overflow-y:auto") && css22.includes("z-index:90"), "Round 22: body.upload-open turns #uploadForm into a fixed full-viewport layer that scrolls independently");
  assert(css22.includes("body.upload-open{overflow:hidden}") && css22.includes("body.upload-open .float-submit{display:none}"), "Round 22: the page behind the overlay locks, and the FAB hides while the overlay is open");
  assert(css22.includes("#uploadForm .upload-close{display:grid") && css22.includes(".upload-close{display:none}"), "Round 22: the ✕ shows only in the overlay state and is display:none everywhere else (Round 24: the same show-rule now applies at every width — §34)");
  assert(css22.includes("body.upload-used .panel.active{animation:none}"), "Round 22: after the first open the panel entry animation retires, so its fill-both transform can't trap the fixed form inside the panel");
  // (1d) Wiring: Round 22's goSubmit branched on the phone
  // breakpoint (Round 24 removed the branch — the overlay opens
  // at every width; the branch's absence is pinned in §34); the
  // ✕ and Escape close; §26's click wiring still stands.
  assert(appJs.includes("function openUploadOverlay()") && appJs.includes("function closeUploadOverlay()"), "Round 22: app.js has the open/close overlay functions (Round 24 removed the width branch that gated them — §34)");
  assert(appJs.includes('$("#uploadClose")') && appJs.includes('e.key === "Escape"'), "Round 22: the ✕ click and the Escape key are wired to close the overlay");
  // (1e) Behavioral: drive the REAL goSubmit/open/close block in a
  // vm — the overlay opens (no anchor scroll), the close drops
  // only upload-open. The desktop drive below already expects
  // Round 24 behavior (it opens too; the width stub in mkSb32 is
  // vestigial — §34 drives goSubmit with NO width API at all).
  const goBlock32 = appJs.slice(appJs.indexOf("function goSubmit()"), appJs.indexOf('$("#floatSubmit")'));
  const bodyClasses32 = new Set();
  const formStub32 = { scrollTop: 99, scrolled: 0, scrollIntoView() { this.scrolled++; } };
  const mkSb32 = (mobile) => ({
    console,
    window: { matchMedia: (q) => ({ matches: mobile && q.includes("760px") }) },
    document: {
      body: { classList: { add: (...cs) => cs.forEach((c) => bodyClasses32.add(c)), remove: (...cs) => cs.forEach((c) => bodyClasses32.delete(c)), contains: (c) => bodyClasses32.has(c) } },
      getElementById: (id) => (id === "uploadForm" ? formStub32 : null),
    },
    showHome: () => {}, closeMenu: () => {}, showPanel: () => {}, switchView: () => {},
  });
  const ctx32 = vm.createContext(mkSb32(true));
  vm.runInContext(goBlock32, ctx32);
  vm.runInContext("goSubmit()", ctx32);
  assert(bodyClasses32.has("upload-open") && bodyClasses32.has("upload-used") && formStub32.scrolled === 0 && formStub32.scrollTop === 0, "behavioral (Round 22): at phone width goSubmit opens the overlay (upload-open + upload-used, form scrolled to top) and never anchor-scrolls");
  vm.runInContext("closeUploadOverlay()", ctx32);
  assert(!bodyClasses32.has("upload-open") && bodyClasses32.has("upload-used"), "behavioral (Round 22): closing drops only upload-open — the animation guard (upload-used) persists");
  const ctx32d = vm.createContext(mkSb32(false));
  vm.runInContext(goBlock32, ctx32d);
  vm.runInContext("goSubmit()", ctx32d);
  assert(bodyClasses32.has("upload-open") && formStub32.scrolled === 0, "behavioral (Round 24, via the Round 22 drive): at desktop width goSubmit opens the overlay too and never anchor-scrolls (scrolled is still 0 from the phone drive — the in-page form it used to scroll to is out of the flow)");
  // (2) Hero: one-line saying in, tagline + old paragraph out,
  // CTAs and playback controls untouched.
  const hero32 = home.slice(home.indexOf('<div class="hero view-home"'), home.indexOf("<!-- ============ TRUST STRIP"));
  assert(hero32.includes('<p class="hero-sub hero-sub125">SHOW US YOURS</p>'), "Round 22→125: the hero paragraph is Dyanna's call now — SHOW US YOURS (Emil's Round 22 one-liner retired as the hero sub-line in Round 125; the H1 above it is untouched)");
  assert(!hero32.includes("hero-tagline") && !hero32.includes("The home of youth sports culture. Big plays."), "Round 22: the hero tagline element and the old multi-sentence paragraph are gone from the hero");
  assert(hero32.includes("Watch Highlights") && hero32.includes('id="heroVideo"'), "Round 22: the hero keeps its headline, its Watch Highlights CTA and the film (Round 30 replaced the playback controls — see the next assertion)");
  const heroCtas142 = home.slice(home.indexOf('<div class="hero-ctas">'), home.indexOf('<div class="hero-ctas">') + 700);
  assert(heroCtas142.includes("Watch Highlights") && !heroCtas142.includes("btn-ghost") && !heroCtas142.includes("Post a Play"), "Round 142: the hero CTA row holds Watch Highlights ALONE — the duplicate Post a Play button (the ghost data-submit-link) is out of the hero; the header pill carries upload up top");
  // Round 30 supersedes the Round 22 controls expectation: the hero film
  // is now the B15 commercial; the progress bar, seconds timer and the
  // "Tap for sound" pill are REMOVED, replaced by one small mute icon on
  // the video itself, and the film autoplays (sound attempted first).
  assert(hero32.includes('src="/hero-film.mp4"') && hero32.includes('id="heroMute"') && !hero32.includes('id="heroSound"') && !hero32.includes('id="heroFill"') && !hero32.includes('id="heroCur"') && !hero32.includes("hero-controls"), "Round 30: the hero runs the B15 commercial (hero-film.mp4 = the card-free looping cut) with only the on-video mute icon — no progress bar, timer or sound pill");
  // (3) Palette: gold on the brand surfaces, lime untouched on
  // the interactive ones.
  const rule32 = (sel) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  assert(css.includes("--gold:#D4AF37"), "Round 22: --gold is the crest gold #D4AF37");
  assert(rule32(".sec-tag{").includes("color:var(--gold)"), "Round 22: section eyebrows (.sec-tag) are gold");
  assert(rule32(".sec-head h2 .lime{").includes("color:var(--gold)") && rule32(".shop-head h2 .lime{").includes("color:var(--gold)") && rule32(".store-card-body h2 .lime{").includes("color:var(--gold)"), "Round 22: the accent word in the section h2s (board / store head / store entry card) is gold");
  assert(rule32(".hero h1 .lime{").includes("color:var(--gold)"), "Round 22: the hero headline's 'hype.' is gold, matching the crest lockup");
  assert(rule32(".pod .lead{").includes("color:var(--gold)") && rule32(".sp-tag{").includes("color:var(--gold)") && rule32(".step .num{").includes("color:var(--gold)"), "Round 22: the podium lead label, spotlight tag and step numerals are gold");
  assert(rule32(".btn-lime{").includes("background:var(--volt)") && rule32(".float-submit{").includes("background:var(--volt)"), "Round 22: primary buttons and the FAB stay lime (they are actions)");
  assert(rule32('.votebtn[aria-pressed="true"]{').includes("background:var(--volt)") && rule32('.viewseg button[aria-pressed="true"]{').includes("background:var(--volt)") && rule32('.pill[aria-pressed="true"]{').includes("background:var(--volt)"), "Round 22: pressed/active interactive states (vote, view toggle, pills) stay lime");

  /* ---- 33. Round 23 (2026-11-06): "＋ Post" phone pill + footer
     lockup badge colorway -------------------------------------
     Two phone reports from Emil: (A) Round 22's floating button
     confused him — an upload ARROW on a floating button reads as
     "back to top". The icon is now a PLUS and the button carries
     a second, short label span ("Post"): the desktop pill keeps
     the full "Submit a Hype" label with the short span
     display:none; on phones (≤760px) the button becomes a
     compact pill (48px tall, auto width, 999px radius, 16px
     horizontal padding, 20px icon) with the short label visible
     and the full label hidden. All Round 22 behavior stood
     through this round: goSubmit/overlay wiring untouched
     (app.js unchanged in Round 23), the button still hides while
     body.upload-open. (Round 24 has since removed goSubmit's
     width branch and retired the fab-away observer — §34; the
     hide-while-open rule now applies at every width.) (B) The
     footer lockup's badge didn't match
     the header's: the header uses the crest-COLOR badge (gold
     crown over SILVER-WHITE HH) but the footer file carried the
     all-GOLD badge. /logo-crest-lockup.png (SAME filename) was
     rebuilt from the crest-color source at the same badge
     size/position on the same 4395×3701 canvas — stacked layout,
     wordmark and tagline untouched, so the footer can't shift.
     The pixel proof below decodes the served PNG with node:zlib
     (rows 0–2700 cover the whole badge) and samples the crown
     band (rows ≤1056) for gold and the HH band (rows 1085–2687)
     for silver — in the old all-gold file the HH band held ZERO
     silver pixels. No uploads in this section. ---- */
  // (A1) Markup: plus icon in, upload arrow out, short span in.
  const fab33 = home.slice(home.indexOf('id="floatSubmit"'), home.indexOf("<!-- ============ HERO"));
  assert(fab33.includes('d="M12 5v14"') && fab33.includes('d="M5 12h14"') && !fab33.includes('d="M12 19V5"'), "Round 23: the FAB icon is a plus — the upload arrow is gone");
  assert(fab33.includes('<span class="float-submit-short">Post a Play</span>'), "Round 23: the FAB carries the short label span next to the full label (Round 123: it reads 'Post a Play' too — one label everywhere)");
  assert(fab33.includes('aria-label="Post a Play — go to the upload form"'), "Round 23: the FAB's accessible name is unchanged (Round 123 label sweep aside)");
  // (A2) CSS: short span hidden by default; on phones the compact
  // pill shows it and hides the full label; overlay hide stands.
  const css23 = css.slice(css.indexOf("===== Round 22"), css.indexOf("===== Round 24"));
  const media23 = css23.slice(css23.indexOf("@media (max-width:760px)"));
  assert(css23.includes(".float-submit-short{display:none}"), "Round 23: the short 'Post' label is display:none outside the phone media query (desktop keeps the full label)");
  assert(media23.includes(".float-submit{width:auto;height:48px") && media23.includes("padding:0 16px") && media23.includes("border-radius:999px") && media23.includes(".float-submit svg{width:20px;height:20px}"), "Round 23: on phones the FAB is a compact pill — auto width, 48px tall, 999px radius, 16px horizontal padding, 20px icon");
  assert(media23.includes(".float-submit .float-submit-short{display:inline}") && media23.includes(".float-submit .float-submit-label{display:none}"), "Round 23: on phones the short 'Post' label shows and the full label hides");
  assert(media23.includes("body.upload-open .float-submit{display:none}"), "Round 23: the pill still hides while the upload overlay is open (Round 22 behavior kept)");
  // (B) Round 65 (2026-11-09) SUPERSEDES the Round 23 footer
  // lockup design: Emil supplied the metallic GOLD master (gold
  // crown AND gold HH, white+gold wordmark, tagline) and approved
  // swapping the footer's flat crest-color lockup for it,
  // centered. The served file is /logo-lockup-gold.jpg (a
  // 1284x880 JPEG; its textured background was crushed to the
  // footer's pure black so it floats with no rectangle edge).
  // The Round 23 pixel proof (silver HH band matching the
  // header badge) is retired by this decision - gold HH in the
  // footer is now the intended design; the header keeps the
  // flat crest-color badge.
  assert(home.includes('src="/logo-lockup-gold.jpg"'), "Round 65: the footer uses Emil's metallic gold master lockup");
  assert(home.includes('class="foot-stack"') && css.includes("footer .foot-stack{width:100%;text-align:center}"), "Round 65: the footer brand stack is centered");
  const goldBuf = Buffer.from(await (await fetch(base + "/logo-lockup-gold.jpg")).arrayBuffer());
  assert(goldBuf[0] === 0xff && goldBuf[1] === 0xd8 && goldBuf.length > 50000, "Round 65: the served gold lockup is a real JPEG");

  /* ---- 34. Round 24 (2026-11-06): the upload overlay at EVERY
     width — feedback item 5 completed --------------------------
     Round 22 solved item 5's access problem on phones only; the
     homepage itself stayed just as long and the desktop form
     stayed in the flow. Round 24 finishes it: #uploadForm is
     display:none until body.upload-open at EVERY width (it was a
     direct child of the plays wrap — no wrapper, heading or
     spacer exists solely to hold it, so nothing else collapses),
     goSubmit opens the overlay unconditionally (the width branch
     is gone), the desktop open state is a centered modal (dimmed
     backdrop, Round 18 two-column grid, 92vh cap, internal
     scroll), the ✕ shows whenever the overlay is open at any
     width, the Round 11 fab-away observer is RETIRED (§26 pins
     the retirement — nothing in-flow remains to observe; the
     pill is visible whenever the overlay is closed and hidden
     while it is open), and a #post deep link (the form heading's
     id — what external links point at) opens the overlay on load
     and on hashchange. The in-page href="#post" CTAs all carry
     data-submit-link and were already routed through goSubmit.
     The submit handler needed no changes: its success path only
     writes #uploadMsg, and its validation scrolls target
     elements INSIDE the form, which scroll the overlay container
     at any width. No uploads in this section (the §31 budget
     note stands) — CSS/markup/wiring checks plus vm drives. ---- */
  // (a) Closed = out of flow; open restores the form; the desktop
  // open state is the centered modal.
  const css34 = css.slice(css.indexOf("===== Round 24"));
  assert(css34.includes("#uploadForm{display:none}"), "Round 24: with the overlay closed the form occupies NO page space (display:none) — the homepage runs hero → board → montage → Hype Frame → store → final CTA → footer");
  assert(css34.includes("body.upload-open #uploadForm{display:block"), "Round 24: opening the overlay restores the form's display at every width");
  const desk34 = css34.slice(css34.indexOf("@media (min-width:761px)"));
  assert(desk34.includes("body.upload-open #uploadForm{display:grid") && desk34.includes("position:fixed") && desk34.includes("translate(-50%,-50%)") && desk34.includes("max-height:92vh") && desk34.includes("overflow-y:auto"), "Round 24: on desktop the open form is a centered modal wearing its Round 18 two-column grid, capped at 92vh and scrolling internally");
  assert(css34.includes("body.upload-open::after") && css34.includes("z-index:89"), "Round 24: a dimmed backdrop layer (z 89) sits under the modal form (z 90) and over the page");
  // (b) The all-widths locks and the ✕ rule live OUTSIDE any
  // media query in the Round 24 block.
  const css34Base = css34.slice(0, css34.indexOf("@media (min-width:761px)"));
  assert(css34Base.includes("body.upload-open{overflow:hidden}") && css34Base.includes("body.upload-open .float-submit{display:none}"), "Round 24: the scroll lock and the hidden pill apply at EVERY width while the overlay is open (Round 22 fenced them to phones)");
  assert(css34Base.includes("body.upload-open #uploadForm .upload-close{display:grid"), "Round 24: the ✕ shows whenever the overlay is open, at any width (display:none only while closed)");
  assert(css34Base.includes("body.upload-used .panel.active{animation:none}"), "Round 24: the panelIn containing-block guard is hoisted to all widths — the desktop panel's fill-both transform can't trap the fixed modal inside the panel either");
  // (c) Wiring: no width branch left in goSubmit; the #post deep
  // link is handled at boot and on hashchange; every in-page
  // #post href rides data-submit-link.
  const goBlock34 = appJs.slice(appJs.indexOf("function goSubmit()"), appJs.indexOf('$("#floatSubmit")'));
  assert(!goBlock34.includes("matchMedia") && !goBlock34.includes("scrollIntoView"), "Round 24: goSubmit has no width branch and no in-page anchor scroll left — it opens the overlay unconditionally");
  assert(appJs.includes('if (location.hash === "#post") { bootHashTarget = true; goSubmit(); }'), "Round 24: a #post deep link opens the overlay on load");
  assert(appJs.includes('if (location.hash === "#post") goSubmit();'), "Round 24: a #post hashchange opens the overlay too");
  const postLinks34 = home.split('href="#post"').length - 1;
  assert(postLinks34 >= 3 && postLinks34 === (home.split('href="#post" data-submit-link').length - 1), "Round 24: every in-page #post link carries data-submit-link, so they all route through goSubmit instead of a native anchor jump to a hidden form");
  // (d) Behavioral: drive the REAL goSubmit at desktop width with
  // NO width API in the sandbox at all — the Round 22 code would
  // have thrown reaching for it; Round 24 must open anyway.
  const bodyClasses34 = new Set();
  const formStub34 = { scrollTop: 42 };
  const sb34 = {
    console, window: {},
    document: {
      body: { classList: { add: (...cs) => cs.forEach((c) => bodyClasses34.add(c)), remove: (...cs) => cs.forEach((c) => bodyClasses34.delete(c)), contains: (c) => bodyClasses34.has(c) } },
      getElementById: (id) => (id === "uploadForm" ? formStub34 : null),
      addEventListener: () => {},
    },
    showHome: () => {}, closeMenu: () => {}, showPanel: () => {}, switchView: () => {},
    $: () => ({ addEventListener: () => {} }),
  };
  const ctx34 = vm.createContext(sb34);
  vm.runInContext(goBlock34, ctx34);
  vm.runInContext("goSubmit()", ctx34);
  assert(bodyClasses34.has("upload-open") && bodyClasses34.has("upload-used") && formStub34.scrollTop === 0, "behavioral (Round 24): at desktop width (no width API in the sandbox) goSubmit opens the overlay — upload-open + upload-used set, form scrolled to top");
  // (e) Behavioral: Escape closes at desktop width, other keys
  // don't, Escape while closed is a no-op. Drive the REAL wiring
  // block (✕ listener + keydown handler) in the same context.
  const wireBlock34 = appJs.slice(appJs.indexOf('$("#uploadClose")'), appJs.indexOf('$$("[data-tablink]")'));
  let keyHandler34 = null;
  sb34.document.addEventListener = (ev, fn) => { if (ev === "keydown") keyHandler34 = fn; };
  vm.runInContext(wireBlock34, ctx34);
  assert(typeof keyHandler34 === "function", "Round 24: the keydown wiring registers from the same block as the ✕ listener");
  keyHandler34({ key: "Enter" });
  assert(bodyClasses34.has("upload-open"), "behavioral (Round 24): a non-Escape key leaves the desktop overlay open");
  keyHandler34({ key: "Escape" });
  assert(!bodyClasses34.has("upload-open") && bodyClasses34.has("upload-used"), "behavioral (Round 24): Escape closes the overlay at desktop width (the Round 22 handler was never width-scoped — the overlay just never opened on desktop before)");
  keyHandler34({ key: "Escape" });
  assert(!bodyClasses34.has("upload-open"), "behavioral (Round 24): Escape with the overlay already closed is a harmless no-op");

  /* ---- 35. Round 25 (2026-11-06): the mid-page CTA band --------
     Emil, from his phone after Round 24: "between the video
     thumbnails and the sections below, add another CTA button
     for Submit a Hype like the top section has." A parent who
     has just watched the board is at peak "my kid has a clip
     like that," but the only submit asks were the hero (a page
     up), the final CTA (below the store) and the floating pill.
     The band sits INSIDE the plays panel, between the board
     wrap and the montage wrap: the slogan as the heading
     (Round 26 — it replaced the Round 25 mission line;
     the .sec-head h2 accent pattern — .lime renders gold since
     Round 22), one subline, and the lime button at hero size.
     The button is a <button data-submit-link> — NOT an
     href="#post" anchor — so it routes through goSubmit and
     opens the Round 24 overlay without joining §34's #post-href
     census. Markup/CSS checks only; goSubmit's behavior itself
     is pinned in §34. ---- */
  assert(!home.includes('class="cta-band"') && !home.includes('class="montage"'), "Round 44: the mid-page CTA band (Rounds 25/26/31) and the sports montage (Round 10) are RETIRED — the adopted concept flow runs board -> Hype Frame; submit asks live in the hero, the FAB and the final CTA");
  const boardAt35 = home.indexOf('id="viewMonth"');
  const underAt35 = home.indexOf('id="boardUnder"');
  const hfAt35 = home.indexOf('id="merchTeaser125"');
  assert(boardAt35 > -1 && underAt35 > boardAt35 && hfAt35 > underAt35 && home.indexOf('id="hfExamplesHome"') === -1, "Round 44→125: document order is board -> See all/Browse block -> merch teaser (the Hype Frame section left the homepage in Round 125)");
  assert(home.includes("See all plays →") && home.includes('id="boardSportSelect"') && !home.includes("All sports →"), "Round 44/47/62→125: under the clips sits See all plays; the sports live in the dropdown above the videos (the pill bar retired in Round 125; the Browse by Sport row retired in Round 62), All sports link removed");

  /* ---- 36. Round 27 (2026-11-06): the Hype Sports store rebuild ----
     Emil's direction + resolutions: the store is rebuilt around
     HYPE SPORTS. Order: hero -> Shop by Sport -> filter chips/grid
     -> Hype Frame feature -> NEXT DROP teaser. Holds: $69.99 (the
     comp's $59.99 NOT adopted), six youth sizes, Coming Soon (no
     cart, no shipping promises), Hot Pink not lost (teaser + its
     quick view). The film + Boys/Girls blocks are OUT — §§4–8, 16,
     25–26 now pin their absence. Comp alignments adopted: pair
     cards (the card Front/Back toggle is dropped as redundant),
     filter chips, gold VIEW PRODUCT buttons, product-view tabs +
     feature bullets, mobile single-column grid + scrollable gold
     chips (photo-54), 3-across tiles with HTML labels (photo-53),
     mobile product view with dots + big gold-selected size chips +
     Size Guide link under the CTA (photo-55), menu Shop Hype
     Sports group + shared Size Guide overlay (photo-56). ---- */
  const shopSlice36 = home.slice(home.indexOf('id="shop"'), home.indexOf('id="sizeGuide"'));
  assert(shopSlice36.includes("DROP 001 / HYPE SPORTS"), "Round 27: store hero eyebrow badge reads 'DROP 001 / HYPE SPORTS'");
  assert(shopSlice36.includes('REP YOUR <span class="gold">SPORT.</span>'), "Round 27: hero headline 'REP YOUR SPORT.' with SPORT. in crest gold");
  assert(shopSlice36.includes("Six sports. One attitude. Your moment. Your hype."), "Round 27: hero subline is exact");
  assert(shopSlice36.includes('id="hsShopBtn"') && shopSlice36.includes("SHOP HYPE SPORTS"), "Round 27: gold SHOP HYPE SPORTS button present");
  assert(appJs.includes('$("#hsShopBtn")') && appJs.includes('getElementById("hsBySport")'), "Round 27: the hero button smooth-scrolls to Shop by Sport");
  assert(shopSlice36.includes("/swag/hs/football-back.jpg") && !shopSlice36.includes("hero-model.jpg"), "Round 52: hero art is the football hoodie back (Emil's mock hero; the Round 27 baseball model crop retired)");
  const HS_SPORTS36 = ["baseball", "football", "basketball", "soccer", "softball", "volleyball"];
  assert((shopSlice36.match(/class="hs-tile"/g) || []).length === 6, "Round 27: six Shop by Sport tiles");
  for (const s of HS_SPORTS36) {
    assert(shopSlice36.includes(`data-hs-jump="${s}"`), `Round 52: a tile jumps to the ${s} hoodie card (Round 27's direct product-view open retired)`);
    assert(shopSlice36.includes(`/swag/hs/tile-${s}.jpg`), `Round 27: tile art present: ${s}`);
  }
  for (const label of ["Baseball", "Football", "Basketball", "Soccer", "Softball", "Volleyball"]) assert(shopSlice36.includes(`<span class="hs-tile-label">${label}</span>`), `Round 27: tile label is real HTML: ${label}`);
  assert((shopSlice36.match(/class="hs-card"/g) || []).length === 6, "Round 27: six Hype Sports grid cards");
  for (const s of HS_SPORTS36) {
    const card52 = (home.match(new RegExp(`<article class="hs-card" data-hs-card="${s}"[\\s\\S]*?</article>`)) || [""])[0];
    assert(card52.includes(`/swag/hs/night-${s}.jpg`) && card52.includes('class="hs-card-front"') && card52.includes(`/swag/hs/${s}-front.jpg`) && appJs.includes(`/swag/hs/${s}-front.jpg`), `Round 52/59 + 85: the ${s} card leads with the worn night-shot of the back (Round 59) and carries the small FRONT thumbnail chip (Round 85, youth tester ask); the full front still lives on the product page (its data is intact)`);
  }
  assert((shopSlice36.match(/class="hs-badge">Sample phase<\/span>/g) || []).length === 0, "Round 52: the per-card Sample phase badges are gone — the hoodies header's COMING SOON carries the preview status now");
  assert((shopSlice36.match(/>VIEW PRODUCT<\/button>/g) || []).length === 0, "Round 52: no VIEW PRODUCT buttons on the cards — the whole card is the tap target (the name bar carries a chevron)");
  assert(!shopSlice36.includes("data-flip"), "Round 27: grid cards have NO front/back toggle (the pair layout makes it redundant — dropped per the comp steer; the product view keeps its switch)");
  const gridSlice52 = shopSlice36.slice(shopSlice36.indexOf('id="hsGrid">'), shopSlice36.indexOf('id="hsHfFeature"'));
  assert(!gridSlice52.includes("Premium youth fit") && !gridSlice52.includes("HYPE SPORTS /") && gridSlice52.includes("<h4>Baseball Hype Hoodie</h4>") && gridSlice52.includes("<h4>Volleyball Hype Hoodie</h4>"), "Round 52: card bodies are slim name bars — no fit line, no eyebrows (the product view keeps its own eyebrow)");
  assert((shopSlice36.match(/class="hs-chip"/g) || []).length === 0, "Round 52: the filter chips are gone (the Shop by Sport tiles do the navigating now)");
  assert(!shopSlice36.includes("data-hs-filter="), "Round 52: no filter wiring remains in the store markup (the app.js chip handler is dormant without chips)");
  assert(appJs.includes("chip.dataset.hsFilter") && appJs.includes('card.hidden = f !== "all"'), "Round 27: chip filtering hides non-matching cards in app.js");
  const HS_LINES36 = { baseball: "Built for the diamond. Made for the hype.", football: "Friday lights. Full send.", basketball: "Built for the blacktop. Ready for the lights.", soccer: "Top corner is a lifestyle.", softball: "Yellow ball. Loud bat. Louder hype.", volleyball: "All hustle above the net." };
  for (const [s, line] of Object.entries(HS_LINES36)) assert(appJs.includes(`${s}: {`) && appJs.includes(`line: "${line}"`), `Round 27: HS_PRODUCTS ${s} carries its exact personality line`);
  assert((appJs.match(/price: "\$69\.99"/g) || []).length === 6, "Round 27: all six HS_PRODUCTS are priced $69.99 (the comp's $59.99 was NOT adopted)");
  assert(home.includes('id="hsView"') && home.includes('id="hsMainImg"') && home.includes('id="hsThumbs"') && home.includes('id="hsDots"'), "Round 27: product view overlay markup exists (gallery, thumbs, mobile dots)");
  assert(home.includes('data-hs-side="front"') && home.includes('data-hs-side="back"'), "Round 27: product view keeps its Front/Back switch");
  assert(appJs.includes("function openHsView") && appJs.includes("function closeHsView") && appJs.includes("function hsSetFrame"), "Round 27: product view open/close/frame logic in app.js");
  assert((home.match(/data-hs-size="/g) || []).length === 6 && home.includes('id="hsSizes"'), "Round 27: product view has the six youth size chips");
  assert(home.includes("Sample phase — sales open soon"), "Round 27: product view status line is exact");
  assert(home.includes('class="hsv-cta" disabled aria-disabled="true">COMING SOON</button>'), "Round 27: the CTA is a disabled COMING SOON button");
  const hsViewSlice36 = home.slice(home.indexOf('id="hsView"'), home.indexOf('id="sizeGuide"'));
  assert(!/add[\s-]*to[\s-]*cart/i.test(hsViewSlice36) && !hsViewSlice36.includes("$59.99"), "Round 27: no add-to-cart control and no comp price anywhere in the product view");
  for (const tab of ["DESCRIPTION", "DETAILS", "SIZE GUIDE", "SHIPPING"]) assert(hsViewSlice36.includes(`>${tab}</button>`), `Round 27: product view tab present: ${tab}`);
  for (const feat of ["Premium, soft fabric", "Athletic, relaxed fit", "Durable, everyday wear"]) assert(hsViewSlice36.includes(feat), `Round 27: feature bullet present: ${feat}`);
  assert(hsViewSlice36.includes("Ships when Drop 001 sales open — no orders are being taken yet."), "Round 27: shipping note is the no-orders hold copy (no shipping promise)");
  assert(hsViewSlice36.includes("Wash inside-out, cold. Hang dry to protect the print."), "Round 27: care note is exact");
  assert(appJs.includes("Chest detail: crest with sport name"), "Round 27: generated chest-detail graphics carry the honest 'Chest detail: crest with sport name' alt text");
  assert(shopSlice36.includes('id="hsHfFeature"') && shopSlice36.includes('id="hfStoreFilm"') && shopSlice36.includes("playHfStoreFilm()"), "Round 27/83: Hype Frame feature sits inside the store — since Round 83 (Emil) with the Hype Frame film + steps instead of the still photo");
  assert(shopSlice36.includes("NEXT DROP") && shopSlice36.includes("DROP 002 · COMING SOON"), "Round 27: NEXT DROP teaser carries the Drop 002 copy");
  assert(shopSlice36.includes("Hot Pink returns for Drop 002."), "Round 27/59: Hot Pink is named as Drop 002's returning star (Round 59: the mock's exact caption)");
  assert(shopSlice36.includes('class="hs-teaser-card" data-slug="girls-street"') && shopSlice36.includes('id="hsHotPinkBtn"') && shopSlice36.includes("Preview Hot Pink"), "Round 27: the teaser card is wired as the girls-street product with a Preview Hot Pink button");
  assert(appJs.includes("openQuickView(hsTeaserCard)") && appJs.includes('"girls-street": {'), "Round 27: the teaser card opens the existing quick view (girls-street QV data intact)");
  assert(!shopSlice36.includes("data-store-block") && !shopSlice36.includes('id="swagVideo"') && !shopSlice36.includes("swag-film"), "Round 27: Boys/Girls blocks and the store film are ABSENT from the store view");
  assert(!shopSlice36.includes("THE ORIGINAL DROP"), "Round 27: the Original Drop section plan was superseded by the NEXT DROP teaser");
  const ord36 = ['id="hsHero"', 'id="hsBySport"', 'id="hsGridSection"', 'id="hsHfFeature"', 'id="hsTeaser"'].map((m) => home.indexOf(m));
  assert(ord36.every((v, i) => v > -1 && (i === 0 || v > ord36[i - 1])), "Round 27: store order is hero < tiles < grid < Hype Frame feature < NEXT DROP teaser");
  const menu36 = home.slice(home.indexOf('id="navMenu"'), home.indexOf("</nav>"));
  assert(!menu36.includes('id="menuHsBtn"'), "Round 29: the menu's Shop Hype Sports group toggle is REMOVED (was Round 27: the menu carries the group; §38 pins the slim menu)");
  assert((menu36.match(/data-hs-menu="/g) || []).length === 0, "Round 29: the menu group lists NO sports (was Round 27: all six sports; the store's tiles/cards still open the product views)");
  assert(!appJs.includes("showStore(); openHsView(b.dataset.hsMenu)"), "Round 29: the menu-sport wiring is gone from app.js (was Round 27: a menu sport opens the Store and then its product view)");
  assert(!menu36.includes('id="menuSizeGuide"'), "Round 29: the menu's Size Guide entry is REMOVED (was Round 27: the menu carries a Size Guide item; the shared overlay stays — §38)");
  assert((home.match(/id="sizeGuide"/g) || []).length === 1, "Round 27: exactly ONE shared size guide overlay exists (single source markup)");
  assert((home.match(/data-size-guide-open/g) || []).length === 2, "Round 29: exactly the two product-view Size Guide links open the shared overlay (was Round 27: menu item + the two product-view links = 3)");
  assert(appJs.includes("function openSizeGuide") && appJs.includes("function closeSizeGuide"), "Round 27: shared size guide open/close logic in app.js");
  const sg36 = home.slice(home.indexOf('id="sizeGuide"'));
  for (const row of ["YXXS", "YXS", "YS", "YM", "YL", "YXL"]) assert(sg36.includes(`<td>${row}</td>`), `Round 27: size guide lists ${row}`);
  assert(sg36.includes("general youth sizing guidance"), "Round 27: size guide ages are labeled general guidance");
  assert(!menu36.includes("Shipping & Returns") && !menu36.includes(">About<"), "Round 27: no About or Shipping & Returns menu items (nothing real behind them yet)");
  const css36 = css.slice(css.indexOf("Round 27"));
  assert(css36.includes(".hs-hero{") && css36.includes(".hs-tiles{") && css36.includes(".hsv-panel{"), "Round 27: hero/tiles/product-view rules exist in the Round 27 CSS block");
  assert(css36.includes(".hs-grid{grid-template-columns:1fr}"), "Round 27 (photo-54): on phones the product grid is a single column of large cards");
  assert(css36.includes(".hsv-dots{display:flex"), "Round 27 (photo-55): on phones the product view shows gallery dot indicators");
  assert(css36.includes('.hs-chip[aria-pressed="true"]{background:var(--gold)'), "Round 27 (photo-54): the active filter chip is gold");
  assert(home.includes('data-div-pick="girls"') && appJs.includes("setDivPick"), "Round 27: the Round 11 upload Boys/Girls toggle wiring is intact (the store rebuild did not touch the upload form)");
  for (const s of HS_SPORTS36) {
    for (const kind of ["pair", "front", "back"]) {
      const r = await fetch(`${base}/swag/hs/${s}-${kind}.jpg`);
      const buf = await r.arrayBuffer();
      assert(r.status === 200 && buf.byteLength > 5000, `Round 27: Hype Sports image serves: /swag/hs/${s}-${kind}.jpg (${buf.byteLength} bytes)`);
    }
    const rt = await fetch(`${base}/swag/hs/tile-${s}.jpg`);
    assert(rt.status === 200, `Round 27: tile image serves: /swag/hs/tile-${s}.jpg`);
  }
  for (const s of ["football", "basketball", "soccer", "softball", "volleyball"]) {
    const r = await fetch(`${base}/swag/hs/${s}-detail-chest.png`);
    assert(r.status === 200, `Round 27: chest-detail graphic serves: /swag/hs/${s}-detail-chest.png`);
  }
  for (const d of ["chest", "sleeve", "fabric", "tag"]) {
    const r = await fetch(`${base}/swag/hs/baseball-detail-${d}.jpg`);
    assert(r.status === 200, `Round 27: baseball detail serves: /swag/hs/baseball-detail-${d}.jpg`);
  }
  const heroR36 = await fetch(`${base}/swag/hs/hero-model.jpg`);
  assert(heroR36.status === 200, "Round 27: hero model image serves");

  /* ---- 37. Round 28 (2026-11-06): product-view phone fixes ----
     Emil on the live Round 27 store: the back of the hoodie is
     cut off on all sports (the square stage cover-cropped the
     portrait gallery art, clipping the hood and the bottom of
     the back's HYPE letters), and he "can't swipe between front
     and back" (the mobile dots were inert spans, no touch
     handlers). The stage now letterboxes the whole frame
     (contain on black), the dots are real buttons, and swipe +
     arrow keys step between frames. ---- */
  const hsImgRule37 = css.slice(css.indexOf("img#hsMainImg"), css.indexOf("}", css.indexOf("img#hsMainImg")));
  assert(hsImgRule37.includes("object-fit:contain") && hsImgRule37.includes("object-position:center") && hsImgRule37.includes("background:#0a0a0a"), "Round 28: the product-view stage shows the ENTIRE gallery image (object-fit:contain, centered, on #0a0a0a)");
  assert(!hsImgRule37.includes("object-fit:cover"), "Round 28: the stage no longer cover-crops the portrait front/back art (hood + HYPE letters were clipped)");
  assert(hsImgRule37.includes("aspect-ratio:1/1"), "Round 28: the stage keeps its 1/1 box (no layout shift)");
  assert(appJs.includes('addEventListener("touchstart"') && appJs.includes('addEventListener("touchend"'), "Round 28: touch swipe handlers are wired on the product-view media stage");
  assert(appJs.includes("HS_SWIPE_MIN = 40") && appJs.includes("Math.abs(dx) >= HS_SWIPE_MIN"), "Round 28: a swipe must clear a 40px horizontal threshold before it turns a frame");
  assert((appJs.match(/hsSetFrame\(hsState\.frame \+ \(dx < 0 \? 1 : -1\)\)/g) || []).length === 2, "Round 28: touch AND pointer swipes both step one frame through hsSetFrame (clamped at both ends, no wraparound)");
  assert(appJs.includes('addEventListener("pointerdown"') && appJs.includes('addEventListener("pointerup"'), "Round 28: pointer-event drag is the swipe fallback for mouse/pen");
  assert(appJs.includes('<button type="button" class="hsv-dot"') && appJs.includes('aria-label="Show image'), "Round 28: the mobile dots are generated as real buttons with per-image labels");
  assert(appJs.includes('addEventListener("click", () => hsSetFrame(Number(b.dataset.hsDot)))'), "Round 28: tapping a dot jumps straight to that frame");
  assert(!home.includes('id="hsDots" aria-hidden'), "Round 28: #hsDots is no longer aria-hidden (it holds real controls now)");
  assert(appJs.includes('"ArrowLeft"') && appJs.includes('"ArrowRight"'), "Round 28: Left/Right arrow keys are handled for gallery navigation");
  assert(appJs.includes("hsView28.hidden") && appJs.includes('t.tagName === "INPUT"'), "Round 28: arrow-key navigation is guarded to the open product view and non-input focus");

  /* ---- 38. Round 29 (2026-11-06): the hamburger menu slimmed to
     exactly four items ----
     Emil approved the mapping ("Yes — slim it to those 4 items"):
     All Hypes, My Highlights, How It Works, Swag Shop — Rep The
     Hype. Removed: the "Plays" header row (duplicated All Hypes),
     the expandable Shop Hype Sports group, and the menu's Size
     Guide entry. The shared #sizeGuide overlay, openSizeGuide()
     and every product view's Size Guide link are untouched — only
     the menu entry went away. All absence checks below are scoped
     to the nav block: both removed labels legitimately live on
     elsewhere (the store hero button, the product views).
     Round 108 (2026-11-12, Emil): Hype Stories joins the menu as
     a FIFTH real page link (/stories) at his explicit direction —
     the four-item rule is broken for this one, deliberately. ---- */
  const menu38 = home.slice(home.indexOf('id="navMenu"'), home.indexOf("</nav>"));
  const kept38 = ['id="menuAllHypes"', 'href="/my-highlights"', 'href="/how-it-works"', 'href="/stories"', 'id="menuHf125"', "Swag Shop — Rep The Hype"];
  const keptIdx38 = kept38.map((m) => menu38.indexOf(m));
  assert(keptIdx38.every((v) => v > -1), "Round 29/108→125: the menu keeps All Hypes, My Highlights, How It Works, Hype Stories, the Round 125 Hype Frame entry and Swag Shop — Rep The Hype");
  assert(keptIdx38.every((v, i) => i === 0 || v > keptIdx38[i - 1]), "Round 29/108→125: the six kept menu items appear in the approved order");
  assert((menu38.match(/<a /g) || []).length === 5 && (menu38.match(/<button/g) || []).length === 1 && menu38.includes('id="menuHf125"'), "Round 51/108→125: the menu holds the five real page links plus exactly ONE button — the Round 125 Hype Frame entry (an in-page action, not a page; Dyanna's board-first homepage needs it in the menu)");
  assert(!menu38.includes('data-panel-btn="plays"') && !menu38.includes(">Plays</button>"), "Round 29: the 'Plays' header row is gone from the menu (the panels' Back-to-the-board buttons sit outside the menu and stay)");
  assert(!menu38.includes('id="menuHsBtn"') && !menu38.includes("menu-group") && (menu38.match(/data-hs-menu="/g) || []).length === 0 && !menu38.includes("Shop Hype Sports"), "Round 29: no Shop Hype Sports group markup remains inside the menu (the label still names the store's hero button, outside the menu)");
  assert(!appJs.includes("menuHsBtn") && !appJs.includes("menuHsList") && !appJs.includes("dataset.hsMenu"), "Round 29: the menu-group-only wiring is gone from app.js (store tiles/cards still open views via data-hs-open / openHsView)");
  assert(!menu38.includes('id="menuSizeGuide"') && !menu38.includes("data-size-guide-open"), "Round 29: the menu's Size Guide entry is gone (scoped to the menu — the product views keep their openers)");
  const hsView38 = home.slice(home.indexOf('id="hsView"'), home.indexOf('id="sizeGuide"'));
  assert(home.includes('id="sizeGuide"') && appJs.includes("function openSizeGuide") && appJs.includes("$$(\"[data-size-guide-open]\")"), "Round 29: the shared size guide overlay, openSizeGuide() and its opener wiring survive the menu slim-down");
  assert((home.match(/data-size-guide-open/g) || []).length === 2 && hsView38.includes("data-size-guide-open"), "Round 29: exactly the two product-view Size Guide links still open the shared overlay");

  /* ---- 39. Round 32 (2026-11-07): the Hype Frame create path --------
     Emil reported the store's "Create a Hype Frame" link broken. Live
     reproduction showed the link itself navigates (store -> board),
     but the board's compact tiles (Round 8) dropped the create button
     the full card always had — the path dead-ended at Vote-only tiles.
     Fix: (1) every tile carries its own create button (stopPropagation,
     so it never also opens the detail); (2) the homepage Hype Frame
     section gets the small CTA Emil asked for. The store CTA is
     unchanged — with tiles fixed, its route completes. ---- */
  assert(appJs.includes('class="mini-btn tile-hf-btn"') && appJs.includes('event.stopPropagation();openHypeFrame(${h.id})'), "Round 32: every board tile has a 📸 Create a Hype Frame button that opens the studio for that play without opening the detail");
  assert(home.indexOf('id="hfExamplesHome"') === -1 && home.includes('data-hf-start') && appJs.includes("data-hf-start"), "Round 86→125 (supersedes the homepage half of Round 32/44): the homepage Hype Frame section is gone — the choice card (data-hf-start) is reached from the ☰ menu, the mid-feed banner and the per-play tile buttons now");
  assert(css.includes(".tile-actions{padding-top:8px}") && css.includes(".hf-home-cta{"), "Round 32: tile action row + homepage CTA styles exist");

  /* ---- 40. Round 34 (2026-11-07): grab-the-video sharing ------------
     Emil picked "Save clip + share-sheet video posting": every full
     card for a file/link-video play gains a ⬇ Save clip button
     (downloads the mp4), and Share prefers handing the share sheet
     the video FILE (native posting) with the link flow as fallback.
     Link-embed plays have no file: no Save button, link-only Share. ---- */
  assert(appJs.includes('onclick="saveClip(${h.id}, this)">⬇ Save clip</button>') && appJs.includes("playHasVideo(h) ? `<button type=\"button\" class=\"mini-btn\" onclick=\"saveClip("), "Round 34: full cards for video plays carry a ⬇ Save clip button (hidden for link embeds)");
  assert(appJs.includes("window.saveClip = async") && appJs.includes("a.download = file.name") && appJs.includes("highlighthype-"), "Round 34: Save clip downloads the video under a highlighthype-<title> filename, with an open-in-tab fallback");
  assert(appJs.includes("navigator.canShare({ files: [file] })") && appJs.includes("navigator.share({ files: [file], title: \"HighlightHype\" })"), "Round 34: Share tries the video file via the share sheet before falling back to the link flow");

  /* ---- 41. Round 35 (2026-11-07): the usability-audit fix round ----
     Emil approved all four audit defects plus the design decision to
     restore the Hype Frame print-side choice. (1) The upload form's
     hardcoded sport list had drifted from SPORTS (Martial Arts
     missing) — option added, and a drift guard compares the two
     lists so it can't silently happen again. (2) Store-entry scroll
     is two-stage so low targets (the NEXT DROP teaser) can't be
     stranded at the top. (3) The studio's 1s step clamps 0.05s short
     of the exact end — a seek TO duration never settles. (4) The
     quick-view note no longer names a drop (the same quick view
     serves Drop 001 products and the Drop 002 Hot Pink preview).
     (5) Print side picker restored — server, owner email and Owner
     view carried the side all along; only the picker was missing. ---- */
  const html35 = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const sportsConst = (appJs.match(/const SPORTS = \[([^\]]+)\]/) || [])[1].split(",").map((s) => s.trim().replace(/"/g, ""));
  const selectBlock = (html35.match(/<select name="sport"[^>]*>([\s\S]*?)<\/select>/) || [])[1];
  const formSports = [...selectBlock.matchAll(/<option value="([a-z]+)"/g)].map((m) => m[1]);
  assert(JSON.stringify([...formSports].sort()) === JSON.stringify([...sportsConst].sort()), "Round 35: the upload form's sport list matches SPORTS exactly (drift guard — Martial Arts included)");
  assert(appJs.includes("function scrollToStoreEl") && appJs.includes('document.getElementById("hsTeaser")') && appJs.includes('behavior: "auto", block: "start"'), "Round 35: store-entry scroll is two-stage (smooth, then a settle jump if the target is still off-screen)");
  assert(appJs.includes("v.duration - 0.05"), "Round 35: the studio 1s step clamps 0.05s short of the exact end so the seek settles");
  assert(!html35.includes("Drop 001 — ordering opens soon") && html35.includes("Ordering opens soon — no orders are being taken yet."), "Round 35: the quick-view note no longer names a drop");
  assert(html35.includes('id="hfSides"') && html35.includes('data-hf-side="back"') && appJs.includes("function hfPickSide") && appJs.includes('$$("#hfSides [data-hf-side]")') && appJs.includes('side: hfState.side'), "Round 35: the studio Print side picker is restored and wired, and the order still carries the side");

  /* ---- 40. Round 125 (2026-11-13): Dyanna's board-first homepage ----
     Music ON by default (mute is the choice now), SHOW US YOURS,
     the live contest line, the board sport DROPDOWN replacing the
     pill bar, Ice Hockey + Lacrosse in the taxonomy, the homepage
     Hype Frame/Store sections distilled to a mid-feed banner + a
     price-free merch teaser, and the optional last initial. ---- */
  // (a) Static markup facts.
  const ddSlice125 = home.slice(home.indexOf('id="boardSportSelect"'), home.indexOf("</select>", home.indexOf('id="boardSportSelect"')));
  assert((ddSlice125.match(/<option/g) || []).length === 20 && ddSlice125.includes('<option value="all">All Sports</option>'), "r125: the board sport dropdown carries All Sports + all 19 sports (20 options; syncFilterUI sets the live value)");
  assert(ddSlice125.includes('<option value="hockey">Ice Hockey</option>') && ddSlice125.includes('<option value="fieldhockey">Field Hockey</option>') && ddSlice125.includes('<option value="lacrosse">Lacrosse</option>'), "r125: the dropdown labels hockey as Ice Hockey, keeps Field Hockey separate, and includes Lacrosse");
  assert((home.match(/<option value="hockey">Ice Hockey<\/option>/g) || []).length >= 2 && (home.match(/<option value="lacrosse">Lacrosse<\/option>/g) || []).length >= 2, "r125: the upload form's sport list carries the same Ice Hockey label + Lacrosse");
  assert(home.includes('<p class="hero-sub hero-sub125">SHOW US YOURS</p>') && !home.includes("HighlightHype is where young athletes become the highlight"), "r125: the hero sub-line is SHOW US YOURS (the Round 22 line survives nowhere on the page)");
  assert(home.includes("A message to our youth athletes! Ask your parent or guardian to help you post your clip. Once they give permission using their email or cell phone number, you can then post your video. Their contact information is how we'll notify you if your video wins the most votes for the month!"), "r125: the Post a Play youth message is Dyanna's exact wording");
  assert(!home.includes("post the play now; a parent/guardian confirms by email") && !home.includes('class="up-note">Quick upload'), "r125: the 'quick upload' line under the message is gone entirely");
  const liTag125 = (home.match(/<input[^>]*name="lastInitial"[^>]*>/) || [""])[0];
  assert(liTag125 && !liTag125.includes("required") && home.includes("Last initial") && home.includes("(optional)"), "r125: the last-initial field exists, is labeled (optional), and carries no required enforcement");
  assert(appJs.includes("lastInitial125") && appJs.includes('fdSend125.set("playerName", fullName125)'), "r125: the submit handler composes playerName from first name + the optional initial before posting");
  const merchSlice125 = home.slice(home.indexOf('id="merchTeaser125"'), home.indexOf("<!-- ============ THE STORE", home.indexOf('id="merchTeaser125"')));
  assert(!merchSlice125.includes("$") && (merchSlice125.match(/mt125-prod/g) || []).length >= 3 && merchSlice125.includes("Open the full store") && !merchSlice125.includes("merchNotifyForm125") && !merchSlice125.includes("mt125-notify"), "r125→126: the merch teaser shows its products + the store link with ZERO price strings (prices live inside the Store only); Round 126 REMOVED the teaser's drop-notify form (r125 asserted its presence — the Store's own notify is untouched, §41 covers the removal)");
  const bannerFn125 = appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("function renderAll2()"));
  assert(bannerFn125.includes("Your moment on a hoodie") && bannerFn125.includes("hype-frame-film.mp4") && bannerFn125.includes("hf-hoodie-softball.jpg") && !/\$\d/.test(bannerFn125) && bannerFn125.includes("openHfChoice()") && !appJs.includes("function hypeFrameBanner125") && !appJs.includes("hf-banner125"), "r125→126: the mid-feed slot is the compact Hype Frame FILM strip — the pre-125 treatment (film under its hoodie cover, lockup, compressed steps), no price, the choice-card button; the Round 125 SVG-hoodie banner is gone from app.js entirely");
  assert(home.includes('id="menuHf125"') && appJs.includes('$("#menuHf125")?.addEventListener'), "r125: the ☰ menu's Hype Frame entry exists and is wired to the choice card");
  // (b) Dropdown parity — drive the REAL change handler: its branch
  // behavior must match the retired pills exactly.
  const ddHandler125 = appJs.slice(appJs.indexOf("const boardSportSel125"), appJs.indexOf("});", appJs.indexOf("boardSportSel125.addEventListener")) + 3);
  assert(ddHandler125.includes('addEventListener("change"'), "r125: dropdown handler block located");
  const selStub125 = { value: "all", addEventListener: (ev, fn) => { selStub125.__fire = fn; } };
  const calls125 = [];
  const dd125Sandbox = {
    window: {}, console,
    currentView: "all", monthSub: "contest", monthSport: "all", allSport: "all",
    $: (s) => (s === "#boardSportSelect" ? selStub125 : null),
    switchView: (v) => { calls125.push("switch:" + v); dd125Sandbox.currentView = v; },
    renderMonth: () => calls125.push("month"),
    renderAll2: () => calls125.push("all"),
    syncFilterUI: () => calls125.push("sync"),
  };
  const dd125Ctx = vm.createContext(dd125Sandbox);
  vm.runInContext(ddHandler125, dd125Ctx);
  selStub125.value = "soccer"; selStub125.__fire();
  assert(dd125Sandbox.allSport === "soccer" && calls125.join() === "sync,all", "r125 parity: on Watch, choosing a sport sets allSport + re-renders Watch (the pill behavior)");
  calls125.length = 0; dd125Sandbox.currentView = "month";
  selStub125.value = "baseball"; selStub125.__fire();
  assert(dd125Sandbox.monthSport === "baseball" && calls125.join() === "sync,month", "r125 parity: on Month, choosing a sport sets monthSport + re-renders Month");
  calls125.length = 0; dd125Sandbox.monthSub = "fame";
  selStub125.value = "hockey"; selStub125.__fire();
  assert(dd125Sandbox.allSport === "hockey" && calls125.join() === "sync,switch:all,all", "r125 parity: on Hall of Fame, choosing a sport jumps to Watch with that sport (the pill behavior)");
  // (c) The REAL syncFilterUI reflects state into the dropdown.
  const syncSlice125 = appJs.slice(appJs.indexOf("const SPORTS"), appJs.indexOf("const MONTHS")) +
    appJs.slice(appJs.indexOf("const cap = (s)"), appJs.indexOf("\n", appJs.indexOf("const cap = (s)"))) +
    appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function renderMonth")) +
    appJs.slice(appJs.indexOf("function sportsInData"), appJs.indexOf("/* ---------------- Swag film"));
  assert(syncSlice125.includes("function syncFilterUI") && syncSlice125.includes("boardSportSelect"), "r125: sync test block located (SPORTS + cap + sportsInData..syncFilterUI with the dropdown write)");
  const mkSel125 = () => ({ innerHTML: "", value: "" });
  const boardSelS = mkSel125(), monthSelS = mkSel125(), allSelS = mkSel125(), fameSelS = mkSel125();
  const sync125Sandbox = {
    window: {}, console, currentView: "all", monthSport: "all", allSport: "hockey", monthDiv: "all", allDiv: "all",
    CONTEST: { period: "2026-11", winnerId: null, entries: [{ sport: "lacrosse", division: "girls" }] },
    ALL_PLAYS: [{ sport: "hockey", division: "boys" }],
    $: (s) => (s === "#boardSportSelect" ? boardSelS : s === "#monthSportSelect" ? monthSelS : s === "#allSportSelect" ? allSelS : s === "#fameSportSelect" ? fameSelS : null),
    $$: () => [], renderMonth: () => {}, renderAll2: () => {}, renderFame: () => {},
  };
  const sync125Ctx = vm.createContext(sync125Sandbox);
  vm.runInContext(syncSlice125, sync125Ctx);
  vm.runInContext("syncFilterUI()", sync125Ctx);
  assert(boardSelS.value === "hockey", "r125: syncFilterUI mirrors the Watch sport state into the dropdown");
  sync125Sandbox.currentView = "month"; sync125Sandbox.monthSport = "lacrosse";
  vm.runInContext("syncFilterUI()", sync125Ctx);
  assert(boardSelS.value === "lacrosse", "r125: on the Month view the dropdown mirrors monthSport instead");
  // (d) Taxonomy labels + hockey filtering, from the REAL cap/renderAll2.
  const labelSlice125 = appJs.slice(appJs.indexOf("const cap = (s)"), appJs.indexOf("\n", appJs.indexOf("const cap = (s)"))) +
    appJs.slice(appJs.indexOf("const esc = (s)"), appJs.indexOf("\n", appJs.indexOf("const esc = (s)")));
  const capCtx125 = vm.createContext({ window: {}, console });
  vm.runInContext(labelSlice125, capCtx125);
  assert(vm.runInContext('cap("hockey")', capCtx125) === "Ice Hockey" && vm.runInContext('cap("fieldhockey")', capCtx125) === "Field Hockey" && vm.runInContext('cap("lacrosse")', capCtx125) === "Lacrosse", "r125: cap() renders Ice Hockey / Field Hockey / Lacrosse labels from the unchanged keys");
  const filt125Block = appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function ", appJs.indexOf("function divMatch") + 10)) +
    appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("let detailPlayId"));
  const filt125Els = {};
  const filt125Sandbox = {
    window: {}, console,
    ALL_PLAYS: [
      { id: 77, title: "Slap Shot", sport: "hockey", division: "boys", player_name: "Cam", team: "", story: "", voteCount: 0 },
      { id: 78, title: "Breakaway", sport: "hockey", division: "boys", player_name: "Cam", team: "", story: "", voteCount: 0 },
      { id: 79, title: "Home Run", sport: "baseball", division: "boys", player_name: "Jay", team: "", story: "", voteCount: 0 },
    ],
    allDiv: "all", allSport: "hockey", allSearch: "",
    $: (sel) => (filt125Els[sel] ||= { innerHTML: "", textContent: "", style: {} }),
    tileHtml: (h) => `TILE:${h.id}:${vm.runInContext(`cap(${JSON.stringify(h.sport)})`, capCtx125)};`,
    hydrateDurPills: () => {},
  };
  const filt125Ctx = vm.createContext(filt125Sandbox);
  vm.runInContext(labelSlice125 + filt125Block, filt125Ctx);
  vm.runInContext("renderAll2()", filt125Ctx);
  assert(filt125Els["#allBoard"].innerHTML.includes("TILE:77:Ice Hockey;") && filt125Els["#allBoard"].innerHTML.includes("TILE:78:Ice Hockey;") && !filt125Els["#allBoard"].innerHTML.includes("TILE:79"), "r125: 'hockey' plays still filter under their key — and their tiles label them Ice Hockey");
  // (e) The contest line renders from live state, both ways.
  const stripSlice125 = appJs.slice(appJs.indexOf("const MONTHS"), appJs.indexOf("\n", appJs.indexOf("const MONTHS"))) +
    labelSlice125 +
    appJs.slice(appJs.indexOf("function firstNameOf"), appJs.indexOf("\n", appJs.indexOf("function firstNameOf"))) +
    appJs.slice(appJs.indexOf("function updateContestStrip107()"), appJs.indexOf("function hypeFrameStrip126"));
  assert(stripSlice125.includes("function updateContestStrip107") && stripSlice125.includes("leadName125"), "r125: contest-strip test block located (with the Round 125 leader derivation)");
  const mkStripEl125 = () => ({ innerHTML: "", textContent: "", hidden: false, classList: { toggle: () => {}, add: () => {}, remove: () => {} } });
  const slim125 = mkStripEl125(), stripState125 = mkStripEl125(), monthSub125 = mkStripEl125(), stripTitle125 = mkStripEl125(), stripEnds125 = mkStripEl125();
  const contest125Sandbox = {
    window: {}, console, currentView: "month",
    CONTEST: { period: "2026-11", winnerId: null, entries: [], totalEntries: 0 },
    $: (s) => (s === "#contestSlimText123" ? slim125 : s === "#stripState" ? stripState125 : s === "#monthSub107" ? monthSub125 : s === "#stripTitle" ? stripTitle125 : s === "#stripEnds" ? stripEnds125 : null),
  };
  const contest125Ctx = vm.createContext(contest125Sandbox);
  vm.runInContext(stripSlice125, contest125Ctx);
  vm.runInContext("updateContestStrip107()", contest125Ctx);
  assert(slim125.textContent === "🏆 Hype of the Month — November: no entries yet · Post a play to enter →" && stripState125.textContent.startsWith("No entries yet"), "r125 contest line (empty): both surfaces invite — post a play to enter");
  contest125Sandbox.CONTEST = { period: "2026-11", winnerId: null, totalEntries: 2, entries: [
    { id: 1, athlete_label: "Charlotte", player_name: "Charlotte", voteCount: 2 },
    { id: 2, athlete_label: "Sam R", player_name: "Sam R", voteCount: 5 } ] };
  vm.runInContext("updateContestStrip107()", contest125Ctx);
  assert(stripState125.textContent === "Sam leads with 5 votes" && slim125.textContent === "🏆 Hype of the Month — November: Sam leads with 5 votes · Vote now →", "r125 contest line (seeded): both surfaces name the live leader with the month's vote count");
  contest125Sandbox.CONTEST = { period: "2026-11", winnerId: null, totalEntries: 1, entries: [
    { id: 1, athlete_label: "Charlotte", player_name: "Charlotte", voteCount: 0 } ] };
  vm.runInContext("updateContestStrip107()", contest125Ctx);
  assert(slim125.textContent.includes("No votes yet — cast the first vote") && stripState125.textContent.startsWith("No votes yet"), "r125 contest line (entries, no votes): honest zero state, not a fake leader");
  // (f) Music default logic: ON unless the visitor muted (hh_music).
  const musicSlice125 = appJs.slice(appJs.indexOf("function heroMusicWanted125()"), appJs.indexOf("\n", appJs.indexOf("function heroMusicWanted125()")));
  const store125 = {};
  const music125Ctx = vm.createContext({ window: {}, console, hhStorageGet: (k) => (k in store125 ? store125[k] : null), hhStorageSet: (k, v) => { store125[k] = v; } });
  vm.runInContext(musicSlice125, music125Ctx);
  assert(vm.runInContext("heroMusicWanted125()", music125Ctx) === true, "r125 music: with nothing stored, the default is ON");
  store125.hh_music = "off";
  assert(vm.runInContext("heroMusicWanted125()", music125Ctx) === false, "r125 music: a stored mute wins (hh_music=off)");
  store125.hh_music = "on";
  assert(vm.runInContext("heroMusicWanted125()", music125Ctx) === true, "r125 music: an explicit on stays on");
  assert(appJs.includes('hhStorageSet("hh_music", v.muted ? "off" : "on")') && appJs.includes('window.addEventListener("pointerdown", onTap)') && !appJs.includes("the film ALWAYS starts muted"), "r125 music: the toggle persists the visitor's choice, the first-tap unmute is armed for autoplay-blocked starts, and the Round 98 always-muted rule is retired");

  /* ---- 41. Round 126 (2026-11-13): Emil's teaser fixes ----
     The mid-feed Hype Frame slot becomes the compact pre-125
     film strip; the teaser sweatshirts default to BACK with the
     Swag Shop's Front/Back switch on the card; the teaser
     drop-notify form is removed entirely; and the teaser
     products render in two switchable layouts (A: hoodies row +
     bottle row underneath / B: one hoodie + the bottle).
     (Round 129 restacked the strip itself — film full-width on
     top, the numbered steps row retired; see §42.) ---- */
  // (a) Static markup facts.
  const merch126 = home.slice(home.indexOf('id="merchTeaser125"'), home.indexOf("<!-- ============ THE STORE", home.indexOf('id="merchTeaser125"')));
  assert(merch126.includes('src="/swag/hs/baseball-back.jpg"') && merch126.includes('src="/swag/hs/basketball-back.jpg"') && !merch126.includes('src="/swag/hs/baseball-front.jpg"') && !merch126.includes('src="/swag/hs/basketball-front.jpg"'), "r126: both teaser sweatshirts render their BACK photo by default (the fronts ride along as data-front for the switch)");
  assert((merch126.match(/mt126-side-btn/g) || []).length >= 4 && merch126.includes('data-mt-side="back" aria-pressed="true"') && merch126.includes('data-mt-side="front" aria-pressed="false"'), "r126: each sweatshirt card carries the Front/Back switch with Back pressed by default (the store's hsv-side pattern)");
  assert(!home.includes("merchNotify") && !appJs.includes("merchNotify") && !merch126.includes("drop-notify"), "r126: the homepage drop-notify form is gone — markup AND handler (the Store's own notify keeps the endpoint; it never used the merch ids)");
  assert(merch126.includes('id="mtProducts126"') && merch126.includes('data-teaser-variant="A"') && merch126.includes('data-prod="basketball-hoodie"') && merch126.includes('class="mt126-bottle-row"'), "r126: the teaser products carry the variant scaffold — A by default, the bottle in its own row under the hoodies");
  assert(appJs.includes("function playHfFeedFilm126()") && appJs.includes('id="hfFilmCoverFeed126"') && appJs.includes('id="hfFeedFilm126"'), "r126: the strip's film has its own cover + video pair and play function (the playHfStoreFilm pattern)");
  // (b) Behavioral: drive the REAL side-switch wiring from app.js.
  const teaser126Block = appJs.slice(appJs.indexOf('$$(".mt125-prod[data-front][data-back]")'), appJs.indexOf("/* Teaser deep link"));
  assert(teaser126Block.includes("teaserVariant126") && teaser126Block.includes("mt126-side-btn"), "r126: teaser wiring block located (side switch + variant IIFE)");
  const mkSideBtn126 = (side) => ({ dataset: { mtSide: side }, attrs: {}, __fire: null, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ev, fn) { this.__fire = fn; } });
  const mkCard126 = () => {
    const img = { src: "/swag/hs/baseball-back.jpg", alt: "back alt", dataset: { altFront: "front alt", altBack: "back alt" } };
    const btns = [mkSideBtn126("front"), mkSideBtn126("back")];
    btns[0].attrs["aria-pressed"] = "false"; btns[1].attrs["aria-pressed"] = "true";
    return { dataset: { front: "/swag/hs/baseball-front.jpg", back: "/swag/hs/baseball-back.jpg" }, querySelector: (s) => (s === "img" ? img : null), querySelectorAll: (s) => (s === ".mt126-side-btn" ? btns : []), __img: img, __btns: btns };
  };
  const cardA126 = mkCard126();
  const teaser126Sandbox = {
    window: {}, console, URLSearchParams, location: { search: "" }, hhStorageGet: () => null,
    $$: (s) => (s === ".mt125-prod[data-front][data-back]" ? [cardA126] : []),
    $: () => null, // no #mtProducts126 in this run -> the variant IIFE no-ops
  };
  vm.runInContext(teaser126Block, vm.createContext(teaser126Sandbox));
  cardA126.__btns[0].__fire(); // tap Front
  assert(cardA126.__img.src === "/swag/hs/baseball-front.jpg" && cardA126.__img.alt === "front alt" && cardA126.__btns[0].attrs["aria-pressed"] === "true" && cardA126.__btns[1].attrs["aria-pressed"] === "false", "r126 switch: tapping Front swaps the card photo + alt to the front and moves aria-pressed with it");
  cardA126.__btns[1].__fire(); // tap Back
  assert(cardA126.__img.src === "/swag/hs/baseball-back.jpg" && cardA126.__img.alt === "back alt" && cardA126.__btns[1].attrs["aria-pressed"] === "true", "r126 switch: tapping Back restores the back photo, its alt, and the pressed state");
  // (c) Behavioral: ?teaser=B restructures the SAME nodes; no flag, no touch.
  const mkNode126 = () => ({ dataset: {}, hidden: false, classList: { added: [], add(c) { this.added.push(c); } }, children: [], appendChild(n) { this.children.push(n); } });
  const hoodies126 = mkNode126(), bb126 = mkNode126(), bottleRow126 = mkNode126(), bottle126 = mkNode126();
  const wrap126 = { dataset: {}, querySelector: (s) => (s === ".mt126-hoodies" ? hoodies126 : s === '[data-prod="basketball-hoodie"]' ? bb126 : s === ".mt126-bottle-row" ? bottleRow126 : s === '[data-prod="bottle"]' ? bottle126 : null) };
  const variant126Sandbox = { window: {}, console, URLSearchParams, location: { search: "?teaser=B" }, hhStorageGet: () => null, $$: () => [], $: (s) => (s === "#mtProducts126" ? wrap126 : null) };
  vm.runInContext(teaser126Block, vm.createContext(variant126Sandbox));
  assert(wrap126.dataset.teaserVariant === "B" && bb126.hidden === true && bottleRow126.hidden === true && hoodies126.children.includes(bottle126) && bottle126.classList.added.includes("mt126-bottle-inrow"), "r126 variant B: the basketball card hides, the emptied bottle row hides, and the bottle card moves into the hoodies row as a full card");
  const wrapA126 = { dataset: {}, querySelector: () => null };
  const variantA126Sandbox = { window: {}, console, URLSearchParams, location: { search: "" }, hhStorageGet: () => null, $$: () => [], $: (s) => (s === "#mtProducts126" ? wrapA126 : null) };
  vm.runInContext(teaser126Block, vm.createContext(variantA126Sandbox));
  assert(wrapA126.dataset.teaserVariant === undefined, "r126 variant A: no flag, no restructure — the authored layout stands");
  // (d) The strip follows the filters and never carries a price.
  const stripFilt126Block = appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function ", appJs.indexOf("function divMatch") + 10)) +
    appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("let detailPlayId"));
  const stripEls126 = {};
  const stripSandbox126 = {
    window: {}, console,
    ALL_PLAYS: [
      { id: 1, title: "A", sport: "hockey", division: "boys", player_name: "Cam", team: "", story: "", voteCount: 0 },
      { id: 2, title: "B", sport: "hockey", division: "boys", player_name: "Cam", team: "", story: "", voteCount: 0 },
      { id: 3, title: "C", sport: "baseball", division: "boys", player_name: "Jay", team: "", story: "", voteCount: 0 },
      { id: 4, title: "D", sport: "baseball", division: "girls", player_name: "May", team: "", story: "", voteCount: 0 },
    ],
    allDiv: "all", allSport: "all", allSearch: "",
    $: (sel) => (stripEls126[sel] ||= { innerHTML: "", textContent: "", style: {} }),
    tileHtml: (h) => `TILE:${h.id};`,
    hydrateDurPills: () => {},
  };
  const stripCtx126 = vm.createContext(stripSandbox126);
  vm.runInContext(stripFilt126Block, stripCtx126);
  vm.runInContext("renderAll2()", stripCtx126);
  const stripHtml126 = stripEls126["#allBoard"].innerHTML;
  assert(stripHtml126.includes('class="hf-strip126"') && stripHtml126.indexOf('class="hf-strip126"') > stripHtml126.indexOf("TILE:3;") && !stripHtml126.slice(stripHtml126.indexOf('class="hf-strip126"')).includes("$"), "r126 strip: renders after the third tile of the unfiltered list and its markup carries no price string");
  stripSandbox126.allSport = "hockey"; // only 2 matching plays
  vm.runInContext("renderAll2()", stripCtx126);
  assert(!stripEls126["#allBoard"].innerHTML.includes("hf-strip126"), "r126 strip: follows the filter — with only 2 matching plays it doesn't render at all");

  /* ---- 42. Round 129 (2026-11-13): the mid-feed strip's film
     goes FULL-WIDTH — Emil: "The video is really small in hype
     frame section." The Round 126 side-by-side strip (film in
     a 148px left box, 112px on phones →126) restacks: the film
     takes the full card width at 16:9 across the TOP and the
     copy stacks below it; the arrow steps line becomes the
     steps at every width and the numbered mini-row retires
     (→129). Slot, cover and the one-tap swap are Round 126's,
     untouched; geometry itself is proven in rig129. ---- */
  // (a) DOM order inside the rendered strip: film box, then
  // the lockup, then the steps line, then the Create button.
  stripSandbox126.allSport = "all";
  vm.runInContext("renderAll2()", stripCtx126);
  const strip129Html = stripEls126["#allBoard"].innerHTML;
  const strip129 = strip129Html.slice(strip129Html.indexOf('class="hf-strip126"'));
  assert(strip129.indexOf('class="hf-strip-film126"') > -1 && strip129.indexOf('class="hf-strip-film126"') < strip129.indexOf('class="hf-strip-lockup126"') && strip129.indexOf('class="hf-strip-lockup126"') < strip129.indexOf('class="hf-strip-stepsline126"') && strip129.indexOf('class="hf-strip-stepsline126"') < strip129.indexOf("openHfChoice()"), "r129 strip: DOM order is film, lockup, one-line steps, Create button — the film leads the card");
  // (b) The numbered mini-row is retired (→129); the arrow
  // line carries the steps, with the approved text.
  assert(!strip129.includes('<p class="hf-strip-steps126">') && strip129.includes("pick a frame") && strip129.includes("we take care of the rest"), "r129 strip: the numbered steps row is gone (→129) — the one-line steps carry the four steps");
  // (c) Cover + swap wiring unchanged: same cover image, same
  // one-tap play function, same hidden video.
  assert(strip129.includes('id="hfFilmCoverFeed126"') && strip129.includes("/swag/hf-hoodie-softball.jpg") && strip129.includes('onclick="playHfFeedFilm126()"') && strip129.includes('id="hfFeedFilm126"') && strip129.includes("/hype-frame-film.mp4?v=7"), "r129 strip: cover, film and the one-tap swap are Round 126's, untouched");
  // (d) The stacked layout lives in the Round 129 CSS block:
  // column card, film wrapper full width, steps line shown at
  // every width (the rig proves the rendered geometry).
  const css129 = css.slice(css.indexOf("Round 129"));
  assert(css129.includes(".hf-strip126{flex-direction:column") && css129.includes(".hf-strip-film126{flex:none;width:100%}") && css129.includes(".hf-strip-stepsline126{display:block"), "r129 css: the strip stacks — column layout, film full width, steps line always shown — →148: the rules stand in the file but the Round 148 block (later in the cascade) overrides them back to the compact horizontal band; see §56");
  // (e) Asset pins: v131 for Round 129; bumped to v132 by
  // Round 132 (→132), and to v133 by Round 133 (→133).
  assert(home.includes('href="styles.css?v=161"') && home.includes('src="app.js?v=161"'), "r129→148: asset pins are v147 — →149: now v148 (Round 149) — →150: now v149 (Round 150) — →151: now v150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

  /* ---- 43. Round 132 (2026-11-13): Emil's live Month-tab
     review. (a) The panel is decluttered in index.html: under
     the gold strip only ONE slim prize line remains before the
     This month / Hall of Fame toggle — the duplicate heading,
     the date/every-vote sub, the how-entry paragraph and the
     long prize paragraph are gone, and the how-entry story
     survives nowhere on the tab (the upload flow carries it).
     (b) renderMonth with the REAL tile chain: the contest
     ignores the division entirely — with monthDiv stuck on
     "boys" (Emil's screenshot state) BOTH girls' entries
     render (pre-132 the filter rendered neither); the sport
     filter still narrows. This is also the item-3 regression:
     each tile's video src + poster are asserted to be that
     entry's OWN, on the server-poster path AND the URL-keyed
     banked-frame fallback. (c) Watch keeps its division
     filtering. (d) switchView keeps #monthDivSeg hidden on
     every view now; goHome activates the Watch view + board
     parking from any tab, and the logo handler prevents the
     anchor's #top jump from overriding the landing. ---- */
  // (a) Index: the Month panel's text stack, after the strip.
  const monthPanel132 = home.slice(home.indexOf('id="viewMonth"'), home.indexOf('id="viewFame"'));
  assert(monthPanel132.includes('id="contestStrip"') && monthPanel132.includes('class="seg month-subseg mtabs134"'), "r132 declutter: the gold strip and the This month / Hall of Fame toggle survive, in order (→134: banner card + text tabs)");
  assert(!monthPanel132.includes('class="month-title"') && !monthPanel132.includes('id="monthSub107"') && !monthPanel132.includes('class="month-how"') && !monthPanel132.includes("How a play gets in") && !monthPanel132.includes("Every vote counts"), "r132 declutter: duplicate heading, date/every-vote line and the how-entry paragraph are removed from the Month tab (→132)");
  assert(monthPanel132.includes("Win a homepage feature and a social shoutout.") && !monthPanel132.includes("bragging rights only, just glory"), "r132 declutter: ONE slim prize line carries the prize — →134: Emil's shorter line, inside the banner card");
  // (b) renderMonth, real tile chain, division stuck on boys.
  const escCap132 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
  const monthChain132 = escCap132 +
    appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) + /* →151: the Month chain now renders viewCount (feat chip + watches line, fame-row suffix) — the real Round 151 helpers ride along */
    appJs.slice(appJs.indexOf("function durPillHtml"), appJs.indexOf("function fillDurPill")) +
    appJs.slice(appJs.indexOf("function tileInfoHtml"), appJs.indexOf("function tileHtml")) +
    appJs.slice(appJs.indexOf("function tileHtml"), appJs.indexOf("/* Vote hardening")) +
    appJs.slice(appJs.indexOf("function medalSvg"), appJs.indexOf("function renderFame")) +
    appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
  const mkEntry132 = (id, name, sport, votes, media, poster) => ({ id, title: id === 50 ? "Kata and Kumite highlights" : "Caught stealing home!", player_name: name, sport, division: "girls", voteCount: votes, media_kind: "file", mime: "video/mp4", media_url: media, poster_url: poster, isSample: false, hasVoted: false, team: "", story: "", created_at: "2026-11-13T10:00:00.000Z" });
  const monthEls132 = {};
  const monthSandbox132 = {
    window: {}, console,
    CONTEST: { period: "2026-11", entries: [mkEntry132(50, "Charlotte", "martialarts", 4, "/uploads/charlotte132.mp4", "/uploads/poster-50.jpg"), mkEntry132(51, "Juliana", "softball", 1, "/uploads/juliana132.mp4", "/uploads/poster-51.jpg")] },
    LAST_MONTH: { period: "2026-10", entries: [], winnerId: 0 },
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthDiv: "boys", monthSport: "all",
    TILE_DURATIONS: new Map(), playHasVideo: () => true, fmtDur: () => "0:10",
    firstNameOf: (h) => (h.player_name || "").split(" ")[0], humanAge: () => "",
    hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
    $: (sel) => (monthEls132[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
    $$: () => [],
  };
  const monthCtx132 = vm.createContext(monthSandbox132);
  vm.runInContext(monthChain132, monthCtx132);
  vm.runInContext("renderMonth()", monthCtx132);
  const feat132 = monthEls132["#monthFeat"].innerHTML;
  const rows132 = monthEls132["#monthRows"].innerHTML;
  const rowOf132 = (id) => rows132.split('<div class="fame-row').slice(1).find((r) => r.includes(`goToPlayCard(${id})`)) || ""; // →147: the rows are fameRowHtml134 output — the split + tap target follow the shared renderer
  assert(rowOf132(50) && rowOf132(51), "r132 month: with the stored division on Boys, BOTH girls' contest entries render — the contest ignores the division (→132; →134: as compact leaderboard rows; →147: as Hall of Fame rows)");
  assert(feat132.includes('data-feat-id="50"') && feat132.includes("Currently #1"), "r132 month: the #1 entry leads the tab (→134: the featured card replaces the LEADING podium)");
  // Item 3 regression: media + poster paired per entry. The
  // featured preview is the Month tab's only media now — it
  // must carry CHARLOTTE's own src + poster, nothing of
  // Juliana's; Juliana's play rides her own row.
  assert(feat132.includes('src="/uploads/charlotte132.mp4"') && feat132.includes('poster="/uploads/poster-50.jpg"') && !feat132.includes("juliana132") && !feat132.includes("poster-51"), "r132 media regression: the featured card carries Charlotte's OWN video + poster, and nothing of Juliana's (→134)");
  assert(rowOf132(51).includes("Caught stealing home"), "r132 media regression: Juliana's row carries her own play (→134: rows are text — her title, her sport, her count; →147: her row carries her own poster thumb + title + sport + count)");
  // Sport filter still narrows the contest.
  monthSandbox132.monthSport = "softball";
  vm.runInContext("renderMonth()", monthCtx132);
  const rowsSport132 = monthEls132["#monthRows"].innerHTML;
  assert(rowsSport132.includes("goToPlayCard(51)") && !rowsSport132.includes("goToPlayCard(50)"), "r132 month: the sport filter still narrows the contest list (softball shows only the softball entry) (→134: the rows narrow; the featured stays the overall #1; →147: row taps read goToPlayCard, the shared renderer's target)");
  assert(monthEls132["#monthFeat"].innerHTML.includes('data-feat-id="50"'), "r134 month: the featured spotlight is NOT narrowed by the sport filter — it stays the contest's #1");
  monthSandbox132.monthSport = "all";
  // Banked-frame fallback path: no server poster — the poster
  // must still come from the entry's OWN media URL (the bank
  // is keyed by URL, never by position).
  monthSandbox132.CONTEST.entries = [mkEntry132(50, "Charlotte", "martialarts", 4, "/uploads/charlotte132.mp4", ""), mkEntry132(51, "Juliana", "softball", 1, "/uploads/juliana132.mp4", "")];
  vm.runInContext("renderMonth()", monthCtx132);
  const featBank132 = monthEls132["#monthFeat"].innerHTML;
  assert(featBank132.includes('poster="BANKED:/uploads/charlotte132.mp4"') && featBank132.includes('data-poster123="/uploads/charlotte132.mp4"') && !featBank132.includes("juliana132"), "r132 media regression: with no server poster, the featured card's banked-frame poster keys off its OWN media URL (→134)");
  // (c) Watch still filters by its division toggle.
  const watchBlock132 = appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function ", appJs.indexOf("function divMatch") + 10)) +
    appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("let detailPlayId"));
  const watchEls132 = {};
  const watchSandbox132 = {
    window: {}, console,
    ALL_PLAYS: [
      { id: 1, title: "Boy play", sport: "baseball", division: "boys", player_name: "Cam", team: "", story: "", voteCount: 0 },
      { id: 2, title: "Girl play", sport: "baseball", division: "girls", player_name: "May", team: "", story: "", voteCount: 0 },
    ],
    allDiv: "boys", allSport: "all", allSearch: "",
    $: (sel) => (watchEls132[sel] ||= { innerHTML: "", textContent: "", style: {} }),
    tileHtml: (h) => `TILE:${h.id};`,
    hydrateDurPills: () => {},
  };
  const watchCtx132 = vm.createContext(watchSandbox132);
  vm.runInContext(watchBlock132, watchCtx132);
  vm.runInContext("renderAll2()", watchCtx132);
  assert(watchEls132["#allBoard"].innerHTML.includes("TILE:1;") && !watchEls132["#allBoard"].innerHTML.includes("TILE:2;"), "r132 watch: the Watch board still respects the division toggle (Boys shows only the boys play)");
  watchSandbox132.allDiv = "girls";
  vm.runInContext("renderAll2()", watchCtx132);
  assert(watchEls132["#allBoard"].innerHTML.includes("TILE:2;") && !watchEls132["#allBoard"].innerHTML.includes("TILE:1;"), "r132 watch: switching the Watch toggle to Girls flips the Watch board with it");
  // (d) switchView: the Month division seg stays hidden on
  // every view; the Watch seg keeps its rule.
  const switchBlock132 = appJs.slice(appJs.indexOf("function switchView"), appJs.indexOf("function scrollBoardIntoView122"));
  const switchEls132 = {};
  const mkSwitchEl132 = () => ({ hidden: false, style: {}, dataset: {}, setAttribute() {} });
  const switchSandbox132 = {
    window: {}, console, monthSub: "month", currentView: "month",
    $: (sel) => (switchEls132[sel] ||= mkSwitchEl132()),
    $$: () => [],
  };
  const switchCtx132 = vm.createContext(switchSandbox132);
  vm.runInContext(switchBlock132, switchCtx132);
  vm.runInContext('switchView("month")', switchCtx132);
  assert(switchEls132["#viewMonth"].hidden === false && switchEls132["#monthDivSeg"].hidden === true && switchEls132["#allDivSeg"].hidden === true, "r132 seg: on the Month view the panel shows but the Boys/Girls seg stays hidden (→132); the Watch seg is hidden there as before");
  vm.runInContext('switchView("all")', switchCtx132);
  assert(switchEls132["#allDivSeg"].hidden === false && switchEls132["#monthDivSeg"].hidden === true, "r132 seg: on the Watch view its own seg shows exactly as before, and the Month seg stays retired");
  vm.runInContext('switchView("battles")', switchCtx132);
  assert(switchEls132["#monthDivSeg"].hidden === true && switchEls132["#allDivSeg"].hidden === true, "r132 seg: Battles keeps both segs hidden, as today");
  // (e) goHome: from any tab, the logo lands on the Watch
  // board — Watch activated + board parking; the sub-page
  // branch is a plain navigation and does NOT switch views.
  const goHomeBlock132 = appJs.slice(appJs.indexOf("function goHome"), appJs.indexOf('$$("[data-store-link]")'));
  const goCalls132 = [];
  const goSandbox132 = {
    window: {}, console,
    location: { pathname: "/", hash: "", href: "" },
    history: { replaceState: () => {} },
    showHome: () => goCalls132.push("showHome"),
    showPanel: (p) => goCalls132.push("showPanel:" + p),
    switchView: (v) => goCalls132.push("switchView:" + v),
    scrollBoardIntoView122: () => goCalls132.push("scrollBoard"),
  };
  const goCtx132 = vm.createContext(goSandbox132);
  vm.runInContext(goHomeBlock132, goCtx132);
  vm.runInContext("goHome()", goCtx132);
  assert(goCalls132.includes("switchView:all") && goCalls132.includes("scrollBoard") && goCalls132.includes("showPanel:plays"), "r132 logo: goHome activates the Watch view and parks at the board top (pre-132 it only scrolled, leaving the Month panel up — the dead tap)");
  goCalls132.length = 0;
  goSandbox132.location.pathname = "/store";
  vm.runInContext("goHome()", goCtx132);
  assert(goSandbox132.location.href === "/" && goCalls132.length === 0, "r132 logo: from a real sub-page the logo still navigates to / and nothing else changed");
  assert(appJs.includes('addEventListener("click", (e) => { e.preventDefault(); goHome(); })'), "r132 logo: the brand handler prevents the anchor's #top jump so goHome's landing is the one that sticks");

  /* ---- 44. Round 133 (2026-11-13): Month cards rest on the
     poster + the crowd-photo wash leaves the Month tab.
     Emil's evidence: Charlotte's card displayed the medal-
     podium photos at the END of her montage reel (the tile
     video autoplays + loops, so the resting moment drifts),
     and a blurred crowd photo smeared behind the whole tab.
     (a) The REAL Month chain (§43b's slices): entry tiles
     carry NO autoplay — the poster is the resting visual —
     while each tile still pairs its OWN src + poster; the
     default tileHtml path (Watch) keeps its autoplay.
     (b) fameThumbHtml directly: the no-opts output is the
     pinned Round 5 string; {rest133:true} drops ONLY the
     autoplay attribute.
     (c) hydrateDurPills + markVertical107 with fake hosts: a
     host inside #viewMonth is never marked and gains no
     .vfill clone; a host outside marks exactly as before;
     both still fill their duration pills.
     (d) switchView: .board-bg — the crowd-photo backdrop
     layered behind the whole board section (styles.css:
     absolute, top 0, 900px tall) — is display:none on the
     Month view, the mechanism that painted the wash behind
     the strip / toggle / podium; Watch + Battles restore it,
     and "fame" rides the month rule. The element stays in
     the markup for the views that keep it. ---- */
  // (a) Month chain: poster-rest tiles, media still paired.
  const escCap133 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
  const monthChain133 = escCap133 +
    appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) + /* →151: the real Round 151 helpers ride along (feat chip + watches line, fame-row suffix) */
    appJs.slice(appJs.indexOf("function durPillHtml"), appJs.indexOf("function fillDurPill")) +
    appJs.slice(appJs.indexOf("function tileInfoHtml"), appJs.indexOf("function tileHtml")) +
    appJs.slice(appJs.indexOf("function tileHtml"), appJs.indexOf("/* Vote hardening")) +
    appJs.slice(appJs.indexOf("function medalSvg"), appJs.indexOf("function renderFame")) +
    appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
  const mkEntry133 = (id, name, sport, votes, media, poster) => ({ id, title: id === 50 ? "Kata and Kumite highlights" : "Caught stealing home!", player_name: name, sport, division: "girls", voteCount: votes, media_kind: "file", mime: "video/mp4", media_url: media, poster_url: poster, isSample: false, hasVoted: false, team: "", story: "", created_at: "2026-11-13T10:00:00.000Z" });
  const entryA133 = mkEntry133(50, "Charlotte", "martialarts", 4, "/uploads/charlotte133.mp4", "/uploads/poster-50.jpg");
  const entryB133 = mkEntry133(51, "Juliana", "softball", 1, "/uploads/juliana133.mp4", "/uploads/poster-51.jpg");
  const monthEls133 = {};
  const monthSandbox133 = {
    window: {}, console,
    CONTEST: { period: "2026-11", entries: [entryA133, entryB133] },
    LAST_MONTH: { period: "2026-10", entries: [], winnerId: 0 },
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthDiv: "boys", monthSport: "all", entryA133,
    TILE_DURATIONS: new Map(), playHasVideo: () => true, fmtDur: () => "0:10",
    firstNameOf: (h) => (h.player_name || "").split(" ")[0], humanAge: () => "",
    hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
    $: (sel) => (monthEls133[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
    $$: () => [],
  };
  const monthCtx133 = vm.createContext(monthSandbox133);
  vm.runInContext(monthChain133, monthCtx133);
  vm.runInContext("renderMonth()", monthCtx133);
  const feat133 = monthEls133["#monthFeat"].innerHTML;
  const rows133txt = monthEls133["#monthRows"].innerHTML;
  assert(feat133.includes('data-feat-id="50"') && !feat133.includes("autoplay") && !rows133txt.includes("autoplay"), "r133 month: NO autoplay anywhere in the Month render — the featured preview rests on its poster frame (→133; →134: the featured card is the tab's only media)");
  assert(feat133.includes('src="/uploads/charlotte133.mp4"') && feat133.includes('poster="/uploads/poster-50.jpg"'), "r133 month: Charlotte's resting preview still pairs her OWN video src + poster");
  assert(rows133txt.includes("goToPlayCard(50)") && rows133txt.includes("goToPlayCard(51)") && !rows133txt.includes("<video") && rows133txt.includes("fame-thumb134"), "r133 month: both entries ride the leaderboard as text rows — no second media surface can drift (→134) — →147: as Hall of Fame rows — the tap is goToPlayCard and the thumb is a still poster <img> (fame-thumb134), still no <video> in the rows");
  // (b) fameThumbHtml: default byte-identical, rest133 drops
  // only the autoplay attribute; the default tile path (Watch)
  // is untouched.
  const fameDefault133 = vm.runInContext("fameThumbHtml(entryA133)", monthCtx133);
  assert(fameDefault133 === '<video src="/uploads/charlotte133.mp4" poster="/uploads/poster-50.jpg" muted loop playsinline autoplay preload="metadata"></video>', "r133 fame: the no-opts thumbnail is byte-identical to the pre-133 tag (autoplay intact for Watch + Hall of Fame)");
  const fameRest133 = vm.runInContext("fameThumbHtml(entryA133, { rest133: true })", monthCtx133);
  assert(fameRest133 === '<video src="/uploads/charlotte133.mp4" poster="/uploads/poster-50.jpg" muted loop playsinline preload="metadata"></video>', "r133 fame: rest133 drops ONLY the autoplay attribute — same src, same poster, same everything else");
  assert(vm.runInContext("tileHtml(entryA133)", monthCtx133).includes(" autoplay"), "r133 tiles: tileHtml WITHOUT the Month opt still renders an autoplaying thumbnail (the Watch treatment is untouched)");
  // (c) The vertical fill: a Month host takes the POSTER-IMAGE
  // fill now (→134) — marked .is-vertical like any portrait
  // host, but the inserted node is an <img> of the play's own
  // poster, never a .vfill VIDEO clone.
  const hydSlice133 = appJs.slice(appJs.indexOf("function fillDurPill"), appJs.indexOf("function firstNameOf"));
  const mkHost133 = (inMonth) => {
    const video = {
      duration: 30, readyState: 4, videoWidth: 720, videoHeight: 1214, dataset: {},
      getAttribute: (a) => (a === "src" ? "/uploads/x133.mp4" : a === "poster" ? "/uploads/poster-50.jpg" : null),
      addEventListener: () => {},
      cloneNode: () => ({ classList: { add: () => {} }, removeAttribute: () => {}, setAttribute: () => {}, pause: () => {}, muted: false }),
    };
    const pill = { textContent: "", hidden: true };
    const classes = new Set();
    const host = {
      inserted: [],
      classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c) },
      closest: (sel) => (inMonth && sel === "#viewMonth" ? { id: "viewMonth" } : null),
      querySelector: (sel) => (sel === ".dur-pill" ? pill : video),
      insertBefore: (node) => { host.inserted.push(node); },
    };
    return { host, pill, classes };
  };
  const monthHost133 = mkHost133(true), watchHost133 = mkHost133(false);
  const hydCtx133 = vm.createContext({ window: {}, console, TILE_DURATIONS: new Map(), fmtDur: () => "0:30", $$: () => [monthHost133.host, watchHost133.host], document: { createElement: (tag) => ({ tagName: String(tag).toUpperCase(), className: "", src: "", setAttribute() {} }) } });
  vm.runInContext(hydSlice133, hydCtx133);
  vm.runInContext("hydrateDurPills()", hydCtx133);
  assert(monthHost133.classes.has("is-vertical") && monthHost133.host.inserted.length === 1 && monthHost133.host.inserted[0].tagName === "IMG" && monthHost133.host.inserted[0].className === "pfill134" && monthHost133.host.inserted[0].src === "/uploads/poster-50.jpg" && !monthHost133.host.inserted[0].classList, "r134 fill: a Month host is marked vertical and gains exactly ONE fill — an <img> of the play's OWN poster (the poster-image fill), never a .vfill video clone");
  assert(watchHost133.classes.has("is-vertical") && watchHost133.host.inserted.length === 1, "r133 fill: a non-Month host still gets the vertical mark + blurred fill, exactly as before");
  assert(monthHost133.pill.textContent === "0:30" && monthHost133.pill.hidden === false && watchHost133.pill.textContent === "0:30", "r133 fill: duration pills still hydrate on Month and Watch hosts alike");
  // (d) The backdrop mechanism: off on Month, restored elsewhere.
  const switchBlock133 = appJs.slice(appJs.indexOf("function switchView"), appJs.indexOf("function scrollBoardIntoView122"));
  const switchEls133 = {};
  const switchSandbox133 = {
    window: {}, console, monthSub: "month", currentView: "month",
    $: (sel) => (switchEls133[sel] ||= { hidden: false, style: {}, dataset: {}, setAttribute() {} }),
    $$: () => [],
  };
  const switchCtx133 = vm.createContext(switchSandbox133);
  vm.runInContext(switchBlock133, switchCtx133);
  vm.runInContext('switchView("month")', switchCtx133);
  assert(switchEls133[".board-bg"].style.display === "none", "r133 wash: on the Month view the crowd-photo backdrop is display:none — nothing photo-like can paint behind the banner, tabs or leaderboard (→133)");
  vm.runInContext('switchView("fame")', switchCtx133);
  assert(switchEls133[".board-bg"].style.display === "none", "r133 wash: the Hall of Fame sub-view rides the same month rule");
  vm.runInContext('switchView("all")', switchCtx133);
  assert(switchEls133[".board-bg"].style.display === "", "r133 wash: the Watch view restores the backdrop exactly as before");
  vm.runInContext('switchView("battles")', switchCtx133);
  assert(switchEls133[".board-bg"].style.display === "", "r133 wash: Battles restores the backdrop exactly as before");
  assert(home.includes('class="board-bg"'), "r133 wash: the backdrop element itself stays in the markup — it is per-view chrome, not deleted");

  /* ============ §45 Round 134 — Emil's mockup Month tab:
     banner card, featured clip, Leaderboard heading + dropdown,
     text tabs, compact rows; short titles; the Hall of Fame
     heading block + compact rows. ============ */
  // (a) Tab order in the markup: banner → featured → Leaderboard
  // heading (with the sport dropdown on its row) → text tabs →
  // leaderboard rows.
  const iStrip134 = home.indexOf('id="contestStrip"');
  const iFeat134 = home.indexOf('id="monthFeat"');
  const iHead134 = home.indexOf('class="lb-title134">Leaderboard<');
  const iFilters134 = home.indexOf('id="boardFilters"');
  const iTabs134 = home.indexOf("mtabs134");
  const iRows134 = home.indexOf('id="monthRows"');
  assert(iStrip134 > -1 && iStrip134 < iFeat134 && iFeat134 < iHead134 && iHead134 < iFilters134 && iFilters134 < iTabs134 && iTabs134 < iRows134, "r134 order: banner card → featured slot → Leaderboard heading + sport dropdown → text tabs → leaderboard rows");
  assert(!home.includes('id="board"'), "r134 markup: the Month tile deck's #board element is retired (Watch renders #allBoard)");
  // (b) The banner card: eyebrow + ends ids survive, the big
  // title is in the card, the prize line lives INSIDE it, and
  // the dynamic leader line's element is gone.
  const banner134 = home.slice(iStrip134, iFeat134);
  assert(banner134.includes('id="stripTitle"') && banner134.includes('id="stripEnds"') && banner134.includes("banner-eyebrow134") && !banner134.includes("banner-title134") && appJs.includes("`Hype of the Month · ${label107}`"), "r134 →136 banner: the big title is dropped (the tab says it); the eyebrow carries name + period, beside the ENDS pill, one card");
  assert(banner134.includes("Win a homepage feature and a social shoutout.") && !home.includes('id="stripState"') && !banner134.includes("cs-cr"), "r134 banner: Emil's short prize line inside the card; the leader line and the strip crown are retired from the banner");
  // (c) Text tabs in BOTH panels, labels per the final wording.
  assert((home.match(/month-subseg mtabs134/g) || []).length === 2 && home.includes('>This Month</button>') && home.includes('>Hall of Fame</button>') && !home.includes("All-time · Hall of Fame"), "r134 tabs: This Month / Hall of Fame as text tabs in both the Month and Fame panels — the All-Time rename is reversed, the name stays Hall of Fame");
  // (d) The Hall of Fame heading block: heading, its own sport
  // dropdown, the explainer line; the old bottom note retires.
  const fameBlock134 = home.slice(home.indexOf('id="viewFame"'), home.indexOf('id="viewFame"') + 2400);
  assert(fameBlock134.includes('lb-title134">Hall of Fame<') && fameBlock134.includes('id="fameSportSelect"') && fameBlock134.includes("Top 10 plays ranked by all-time votes."), "r134 fame: heading block — 'Hall of Fame', the All Sports dropdown beside it, the Top-10 line beneath");
  assert(!home.includes("The Hall of Fame is the Top 10 of all time"), "r134 fame: the old bottom board-note retires (the explainer moved under the heading)");
  assert(appJs.includes('renderSportSelect($("#fameSportSelect"), monthSport, monthSports'), "r134 fame: the Fame dropdown renders from the SAME shared contest sport state as Month");
  // (e) CSS: the new components exist; the retired 118px Month
  // tile rule is gone; the podium CSS the older sections pin
  // stays (only its writer retired).
  assert(css.includes(".feat-card134") && css.includes(".pfill134") && css.includes(".lb-row134") && css.includes(".fame-votes-pill134") && css.includes(".mtabs134"), "r134 css: banner/featured/fill/rows/pill/text-tab components are styled");
  assert(!css.includes("#viewMonth .tile-media{flex:0 0 118px") && css.includes(".pod .lead"), "r134 css: the 118px Month tile layout retires; the podium rules remain for the pinned legacy checks");
  // (f) shortTitle — Emil's reference cases plus the edges.
  const stCtx134 = vm.createContext({ window: {}, console });
  vm.runInContext(appJs.slice(appJs.indexOf("function shortTitle"), appJs.indexOf("function featCardHtml134")), stCtx134);
  const st134 = (t) => vm.runInContext(`shortTitle(${JSON.stringify(t)})`, stCtx134);
  assert(st134("Gold and silver in both Kata and Kumite. These are the highlights") === "Gold and silver in both Kata and Kumite", "r134 shortTitle: the Kata title shortens to its first sentence (the reference case)");
  assert(st134("Caught stealing home!") === "Caught stealing home!", "r134 shortTitle: a single-sentence title keeps its whole text — bang included (the reference case)");
  assert(st134("Wow! What a play") === "Wow" && st134("No punctuation at all") === "No punctuation at all" && st134("One clean sentence.") === "One clean sentence" && st134("") === "", "r134 shortTitle: an internal sentence end cuts; no punctuation keeps the title; a lone trailing period trims; empty stays empty");
  // (g) The renders: featured = the #1 entry with badge, short
  // title, Sport · Division and the vote button; rows carry
  // every entry; Fame rows are compact with the poster thumb,
  // the pill, the short title — and no team placeholder.
  const chain134 = escCap133
    + appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) /* →151: the real Round 151 helpers ride along (feat chip + watches line, fame-row suffix) */
    + appJs.slice(appJs.indexOf("function firstNameOf"), appJs.indexOf("function tileHtml"))
    + appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function renderMine"))
    + appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
  const mkPlay134 = (id, name, sport, title, votes, poster) => ({
    id, player_name: name, sport, division: "girls", title, voteCount: votes, hasVoted: false,
    media_kind: "file", mime: "video/mp4", media_url: `/uploads/p${id}.mp4`, poster_url: poster,
    isSample: false, team: "", athlete_label: "", athlete_tag: "", story: "",
  });
  const playA134 = mkPlay134(50, "Charlotte", "martialarts", "Gold and silver in both Kata and Kumite. These are the highlights", 4, "/uploads/poster-50.jpg");
  const playB134 = mkPlay134(51, "Juliana", "softball", "Caught stealing home!", 1, "/uploads/poster-51.jpg");
  const playC134 = mkPlay134(52, "Mia", "softball", "Walk-off single in the ninth. The crowd went wild", 2, "/uploads/poster-52.jpg");
  const els134 = {};
  const ctx134 = vm.createContext({
    window: {}, console,
    CONTEST: { period: "2026-11", entries: [playA134, playB134] },
    LAST_MONTH: { winnerId: null, entries: [] },
    ALL_PLAYS: [playA134, playB134, playC134],
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthSport: "all",
    playHasVideo: () => true, playVideoSrc134: (h) => h.media_url, durPillHtml: () => "",
    hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
    $: (sel) => (els134[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
    $$: () => [],
  });
  vm.runInContext(chain134, ctx134);
  vm.runInContext("renderMonth()", ctx134);
  const featHtml134 = els134["#monthFeat"].innerHTML;
  assert(featHtml134.includes('data-feat-id="50"') && featHtml134.includes("👑 Currently #1") && featHtml134.includes("Charlotte · Gold and silver in both Kata and Kumite") && !featHtml134.includes("These are the highlights"), "r134 featured: the #1 entry, badged, with the athlete-led SHORT title (full title stays on the play view)");
  assert(featHtml134.includes("Vote for this play") && featHtml134.includes("4 votes") && featHtml134.includes("toggleVote(50") && featHtml134.includes('poster="/uploads/poster-50.jpg"') && !featHtml134.includes("autoplay") && !featHtml134.includes("feat-sub134"), "r134 featured→142: the full-width vote button with the count at its right end, the play's own poster, no autoplay — and →142: the Sport · Division sub-line is GONE from the featured card (the title line is followed directly by the vote button; rows keep their sport lines, checked below)");
  const rowsHtml134 = els134["#monthRows"].innerHTML;
  assert(rowsHtml134.includes('fame-rank">1<') && rowsHtml134.includes("Charlotte · Gold and silver in both Kata and Kumite") && rowsHtml134.includes("Juliana · Caught stealing home!") && rowsHtml134.includes("goToPlayCard(51)") && rowsHtml134.includes('src="/uploads/poster-51.jpg"') && rowsHtml134.includes("fame-play134") && rowsHtml134.includes("fame-votes-pill134") && rowsHtml134.includes("1 vote"), "r134 rows: rank chips, athlete-led short titles, sport-only sub-lines, 'N votes ›', and the row tap opens that row's play — →147: the Hall of Fame row design instead — fame-rank, a poster thumb with the play icon, the compact votes pill, and the goToPlayCard tap (see §55)");
  playA134.hasVoted = true;
  vm.runInContext("renderMonth()", ctx134);
  assert(els134["#monthFeat"].innerHTML.includes("✓ Voted for this play") && els134["#monthFeat"].innerHTML.includes('aria-pressed="true"'), "r134 featured: the already-voted state renders on the vote button after a refresh");
  playA134.hasVoted = false;
  ctx134.CONTEST.entries = [];
  vm.runInContext("renderMonth()", ctx134);
  assert(els134["#monthFeat"].innerHTML === "" && els134["#monthRows"].innerHTML === "", "r134 featured: no entries → the featured slot is absent and the rows are empty (the empty states carry the tab)");
  ctx134.CONTEST.entries = [playA134, playB134];
  vm.runInContext("renderFame()", ctx134);
  const fameHtml134 = els134["#fameList"].innerHTML;
  assert(fameHtml134.includes("Charlotte · Gold and silver in both Kata and Kumite") && fameHtml134.includes("Mia · Walk-off single in the ninth") && !fameHtml134.includes("The crowd went wild") && !fameHtml134.includes("These are the highlights"), "r134 fame rows: athlete-led SHORT titles — no five-line captions");
  assert(fameHtml134.includes('src="/uploads/poster-50.jpg"') && fameHtml134.includes("fame-play134") && fameHtml134.includes("fame-votes-pill134") && fameHtml134.includes("4 votes") && fameHtml134.includes('onclick="goToPlayCard(50)"'), "r134 fame rows: poster thumb with the play icon, the compact votes pill, the whole row opens the play");
  assert(!fameHtml134.includes("No team tagged") && !fameHtml134.includes("All-time votes"), "r134 fame rows: an empty team shows NOTHING (no placeholder), and the wide ALL-TIME VOTES column is gone");
  vm.runInContext('monthSport = "softball"; renderFame()', ctx134);
  const fameSoft134 = els134["#fameList"].innerHTML;
  assert(fameSoft134.includes("goToPlayCard(52)") && fameSoft134.includes("goToPlayCard(51)") && !fameSoft134.includes("goToPlayCard(50)"), "r134 fame: the heading dropdown filters the all-time list by sport, ranking preserved");
  vm.runInContext('monthSport = "all"', ctx134);
  // (h) The header dropdown hides for the whole Month view.
  vm.runInContext('switchView("month")', switchCtx133);
  assert(switchEls133[".sport-dd125"].style.display === "none", "r134 dropdown: the shared header sport dropdown hides on the Month view (the Leaderboard row carries it)");
  vm.runInContext('switchView("fame")', switchCtx133);
  assert(switchEls133[".sport-dd125"].style.display === "none", "r134 dropdown: still hidden on the Hall of Fame sub-view (its heading carries the dropdown)");
  vm.runInContext('switchView("all")', switchCtx133);
  assert(switchEls133[".sport-dd125"].style.display === "", "r134 dropdown: Watch restores the header dropdown exactly as before");

  /* ============ §46 Round 137 — the This Month / Hall of
     Fame switch re-parks the board. Emil's phone (v136): down
     at the Month tab's text tabs he tapped Hall of Fame and
     landed mid-list, past the Fame heading block — the msub
     handler called setMonthSub ONLY, while the board tab
     wiring (Round 122) pairs its switch with
     scrollBoardIntoView122. The tall Month content above the
     tabs (banner + featured card) leaves the layout on the
     switch, the page shrinks, and the un-moved scroll depth
     lands inside the shorter Fame panel. Drive the REAL
     slice (setMonthSub → switchView → both wirings →
     scrollBoardIntoView122) with stub buttons: a tap handler
     must flip the panels AND call the SAME board landing the
     viewseg taps use, in both directions, and the helper's
     own already-parked skip must still hold. ============ */
  assert(appJs.includes('$$(".month-subseg button").forEach((b) => b.addEventListener("click", () => { setMonthSub(b.dataset.msub); scrollBoardIntoView122(); }));'), "r137 wiring: the msub click handler pairs setMonthSub with scrollBoardIntoView122 — the same landing path as the board tab wiring");
  const msubBlock137 = appJs.slice(appJs.indexOf('let monthSub = "month"'), appJs.indexOf("/* Round 35"));
  const els137 = {};
  const mkEl137 = () => ({ hidden: false, style: {}, dataset: {}, innerHTML: "", textContent: "", setAttribute() {} });
  const handlers137 = {};
  const mkMsubBtn137 = (msub) => ({ dataset: { msub }, setAttribute() {}, addEventListener: (ev, fn) => { handlers137[msub] = fn; } });
  const msubBtns137 = [mkMsubBtn137("month"), mkMsubBtn137("fame")];
  let playsTop137 = -512;
  const scrollCalls137 = [];
  const playsEl137 = { getBoundingClientRect: () => ({ top: playsTop137 }), scrollIntoView: (opts) => scrollCalls137.push(opts || {}) };
  const sandbox137 = {
    window: {}, console, currentView: "month",
    $: (sel) => (els137[sel] ||= mkEl137()),
    $$: (sel) => (sel === ".month-subseg button" ? msubBtns137 : []),
    document: { getElementById: (id) => (id === "plays" ? playsEl137 : null) },
    getComputedStyle: () => ({ scrollMarginTop: "76px" }),
    requestAnimationFrame: (fn) => fn(),
  };
  const ctx137 = vm.createContext(sandbox137);
  vm.runInContext(msubBlock137, ctx137);
  assert(typeof handlers137.fame === "function" && typeof handlers137.month === "function", "r137 wiring: both text tabs carry a click handler from the real wiring line");
  handlers137.fame();
  assert(els137["#viewFame"].hidden === false && els137["#viewMonth"].hidden === true && scrollCalls137.length === 1 && scrollCalls137[0].block === "start", "r137 landing: deep-scrolled, tapping Hall of Fame flips the panels AND scrolls #plays to its parked start (pre-137 the scroll never fired)");
  scrollCalls137.length = 0; playsTop137 = -512;
  handlers137.month();
  assert(els137["#viewMonth"].hidden === false && els137["#viewFame"].hidden === true && scrollCalls137.length === 1, "r137 landing: the reverse tap (This Month) re-parks the same way");
  scrollCalls137.length = 0; playsTop137 = 76;
  handlers137.fame();
  assert(scrollCalls137.length === 0, "r137 landing: already parked at the 76px margin — the helper's own skip holds, no jump (the msub path reuses the board landing, not a bespoke scroll)");

  /* ============ §47 Round 138 — ffmpeg conversions are
     serialized and thread-capped. The 2026-11-13 18:33 ET
     Render memory-limit restart: this pipeline is the app's
     only memory-hungry work, and two encodes could overlap
     (upload conversions run inline per request; an upload
     could land mid-migration-sweep). server.js now routes
     BOTH ffmpeg entry points (r124Convert, r124MakePoster)
     through the r138SerializeFfmpeg promise chain and caps
     the transcode with -threads 2, output spec unchanged.
     Wiring asserts on the real source, plus a behavioral run
     of the REAL serializer sliced out of server.js: tasks
     submitted back-to-back must not overlap, and a rejected
     task must not jam the queue. ============ */
  const serverJs138 = fs.readFileSync(path.join(root, "server.js"), "utf8");
  const convertNow138 = serverJs138.slice(serverJs138.indexOf("async function r124ConvertNow"), serverJs138.indexOf("async function r124MakePoster"));
  assert(convertNow138.includes('"-threads", "2"') && convertNow138.includes('"-c:v", "libx264"') && convertNow138.includes('"-pix_fmt", "yuv420p"') && convertNow138.includes('"-movflags", "+faststart"') && convertNow138.includes('"-crf", "23"'), "r138 threads: the transcode command carries -threads 2 with the output spec untouched (libx264/yuv420p/faststart/crf 23)");
  assert(serverJs138.includes("return r138SerializeFfmpeg(() => r124ConvertNow(bins, inFile, outFile));"), "r138 wiring: r124Convert routes through the serializer");
  assert(serverJs138.includes("return r138SerializeFfmpeg(() => r124MakePosterNow(bins, videoFile, posterFile, atSec));"), "r138 wiring: r124MakePoster routes through the serializer");
  assert((serverJs138.split("r124Run(bins.ffmpeg").length - 1) === 2, "r138 wiring: ffmpeg is spawned from exactly two places — the serialized ConvertNow and MakePosterNow bodies");
  const serSrc138 = serverJs138.slice(serverJs138.indexOf("let r138FfmpegQueue"), serverJs138.indexOf("async function r124Convert("));
  const ctx138 = vm.createContext({ console, setTimeout });
  vm.runInContext(serSrc138 + "\n;this.__ser138 = r138SerializeFfmpeg;", ctx138);
  const ser138 = ctx138.__ser138;
  assert(typeof ser138 === "function", "r138 queue: the real serializer loads from the server.js source");
  const events138 = [];
  const task138 = (name, ms, fail) => () => new Promise((res, rej) => { events138.push("start-" + name); setTimeout(() => { events138.push("end-" + name); if (fail) rej(new Error("boom-" + name)); else res(name); }, ms); });
  const pA138 = ser138(task138("A", 60));
  const pB138 = ser138(task138("B", 5));
  await Promise.all([pA138, pB138]);
  assert(events138.join(",") === "start-A,end-A,start-B,end-B", "r138 queue: two conversions submitted back-to-back run strictly one at a time (B waits for A despite being shorter)");
  let rejected138 = false;
  await ser138(task138("C", 5, true)).catch(() => { rejected138 = true; });
  const outD138 = await ser138(task138("D", 1));
  assert(rejected138 && outD138 === "D" && events138.join(",").endsWith("start-D,end-D"), "r138 queue: a failed conversion rejects to its own caller and still releases the next in line (no jam)");

  /* ============ §48 Round 139 — in-app history. Emil:
     "When on a page and I click the browser back button it
     takes me to the swag store." Pre-139 the app never called
     pushState and had no popstate listener: in-app view
     switches recorded NO history, while the Store is also a
     real page (/store) — the first Back from anywhere popped
     straight back to it. app.js now keeps a place model:
     switchView / showPanel / showStore / showHome schedule a
     coalesced record; the hash-writing opens (detail, athlete,
     studio) push their own entry WITH their hash as its URL;
     popstate re-applies the recorded place; the boot entry is
     only re-snapshotted while boot settles, so Back from a
     fresh visit's first view still leaves the site. Wiring
     asserts on the real source, plus a behavioral run of the
     REAL helper block sliced out of app.js against a recording
     history stub. ============ */
  assert(!appJs.includes("replaceState(null"), "r139 wiring: no replaceState may wipe history.state anymore — a Round 139 snapshot must survive every hash rewrite");
  assert(appJs.includes('window.addEventListener("popstate"'), "r139 wiring: a popstate listener is registered");
  assert(appJs.includes('history.pushState({ hh139: { place, pushed: true } }, "");'), "r139 wiring: the coalesced record pushes the place snapshot (hhFlush139)");
  assert(appJs.includes('history.pushState({ hh139: { place, pushed: true } }, "", url);'), "r139 wiring: the hash-writing opens push their entry WITH the deep-link hash as its URL (hhNavPush139)");
  const switchView139 = appJs.slice(appJs.indexOf("function switchView"), appJs.indexOf('$$(".viewseg button").forEach((b) => b.addEventListener("click"'));
  assert(switchView139.includes("hhRecord139"), "r139 wiring: switchView records the place (board tabs + Month/Fame sub-views ride it)");
  const showPanel139 = appJs.slice(appJs.indexOf("function showPanel"), appJs.indexOf('$$("[data-panel-btn]").forEach((b) => b.addEventListener("click"'));
  assert(showPanel139.includes("hhRecord139"), "r139 wiring: showPanel records the place");
  const showStore139 = appJs.slice(appJs.indexOf("function showStore"), appJs.indexOf("function showHome"));
  assert(showStore139.includes("hhSetStoreTarget139") && showStore139.includes("hhRecord139"), "r139 wiring: showStore remembers its target and records the place");
  const showHome139 = appJs.slice(appJs.indexOf("function showHome"), appJs.indexOf("/* Round 48"));
  assert(showHome139.includes("hhRecord139") && showHome139.includes('history.replaceState(history.state, "", "#top")'), "r139 wiring: showHome records the place and its #shop cleanup preserves history.state");
  const openDetail139 = appJs.slice(appJs.indexOf("window.openPlayDetail"), appJs.indexOf("function hidePlayDetail"));
  assert(openDetail139.indexOf("hhNavPush139") !== -1 && openDetail139.indexOf("hhNavPush139") < openDetail139.indexOf("history.replaceState"), "r139 wiring: openPlayDetail pushes the detail's own entry (its replaceState fallback is state-preserving and secondary)");
  const closeDetail139 = appJs.slice(appJs.indexOf("window.closePlayDetail"), appJs.indexOf('$$("[data-detail-close]")'));
  assert(closeDetail139.includes("history.back()") && closeDetail139.includes("st139.pushed") && closeDetail139.includes("st139.place.detail === was"), "r139 wiring: the detail's own Back button IS history.back() when the current entry is the one the detail pushed");
  const hashHandler139 = appJs.slice(appJs.indexOf('window.addEventListener("hashchange"'), appJs.indexOf("function goSubmit"));
  assert(hashHandler139.includes("hhSuppressHash139) return"), "r139 wiring: the hashchange router stands down during a popstate restore (no fighting the snapshot)");
  assert(appJs.includes("if (typeof hhBoot139 === \"function\") hhBoot139();") && appJs.includes("if (typeof hhSettle139 === \"function\") hhSettle139();"), "r139 wiring: boot arms the tracker and settles it when loadData lands");

  const hhBlock139 = appJs.slice(appJs.indexOf("let hhSettled139"), appJs.indexOf("/* Round 137"));
  const histCalls139 = [];
  const histStub139 = {
    state: null,
    pushState(st, _t, url) { histCalls139.push({ op: "push", st, url }); this.state = st; },
    replaceState(st, _t, url) { histCalls139.push({ op: "replace", st, url }); this.state = st; },
    back() { histCalls139.push({ op: "back" }); },
  };
  const live139 = { panel: "plays", store: false };
  const applied139 = [];
  let popHandler139 = null;
  const sandbox139 = {
    console, setTimeout, queueMicrotask,
    window: { addEventListener: (ev, fn) => { if (ev === "popstate") popHandler139 = fn; } },
    history: histStub139,
    document: {
      querySelector: (sel) => (sel === ".panel.active" ? { dataset: { panel: live139.panel } } : null),
      body: { classList: { contains: (c) => c === "store-open" && live139.store } },
    },
    currentView: "month", monthSub: "month", detailPlayId: null,
    showStore: (t) => applied139.push(["showStore", t]),
    showHome: () => applied139.push(["showHome"]),
    showPanel: (p) => applied139.push(["showPanel", p]),
    setMonthSub: (s) => applied139.push(["setMonthSub", s]),
    switchView: (v) => applied139.push(["switchView", v]),
    openPlayDetail: (id, o) => applied139.push(["openPlayDetail", id, o]),
    hidePlayDetail: () => applied139.push(["hidePlayDetail"]),
    openAthlete: (a) => applied139.push(["openAthlete", a]),
    openHypeFrame: (h) => applied139.push(["openHypeFrame", h]),
  };
  const ctx139 = vm.createContext(sandbox139);
  vm.runInContext(hhBlock139 + "\n;this.__hh139 = { hhRecord139, hhSettle139, hhPlace139, hhNavPush139 };", ctx139);
  const HH139 = ctx139.__hh139;
  assert(typeof popHandler139 === "function" && typeof HH139.hhRecord139 === "function", "r139 behavior: the real helper block loads and registers its popstate listener");
  const tick139 = () => new Promise((r) => setTimeout(r, 10));
  const pushes139 = () => histCalls139.filter((c) => c.op === "push");
  const replaces139 = () => histCalls139.filter((c) => c.op === "replace");
  /* Settling: records re-snapshot the first entry, never push. */
  HH139.hhRecord139();
  await tick139();
  assert(replaces139().length === 1 && pushes139().length === 0 && replaces139()[0].st.hh139.pushed === false && replaces139()[0].st.hh139.place.view === "month", "r139 settling: boot records REPLACE the first entry's snapshot (pushed:false) — Back from a fresh visit still leaves the site");
  sandbox139.currentView = "battles";
  HH139.hhRecord139();
  await tick139();
  assert(pushes139().length === 0 && replaces139().length === 2 && replaces139()[1].st.hh139.place.view === "battles", "r139 settling: even a view change before settle only re-snapshots — no trap entry is created during load");
  HH139.hhSettle139();
  assert(replaces139().length === 3 && replaces139()[2].st.hh139.place.view === "battles", "r139 settle: settling stamps the live place onto the first entry");
  /* Settled: a place change pushes exactly once; repeats dedupe. */
  sandbox139.currentView = "all";
  HH139.hhRecord139();
  await tick139();
  assert(pushes139().length === 1 && pushes139()[0].st.hh139.pushed === true && pushes139()[0].st.hh139.place.view === "all", "r139 push: a settled view switch pushes ONE entry carrying the new place");
  HH139.hhRecord139();
  await tick139();
  assert(pushes139().length === 1, "r139 dedupe: re-recording the SAME place pushes nothing (no push loops)");
  sandbox139.currentView = "battles";
  HH139.hhRecord139();
  sandbox139.currentView = "month";
  HH139.hhRecord139();
  await tick139();
  assert(pushes139().length === 2 && pushes139()[1].st.hh139.place.view === "month", "r139 coalesce: two switches inside one action collapse into a single push of the final place");
  /* The hash-writing opens push synchronously, with the hash as URL. */
  const place139 = HH139.hhPlace139();
  place139.detail = 7;
  assert(HH139.hhNavPush139(place139, "#play-7") === true && pushes139().length === 3 && pushes139()[2].url === "#play-7" && pushes139()[2].st.hh139.place.detail === 7, "r139 nav-push: the detail open pushes its own entry carrying #play-7 as the URL (the previous entry keeps its clean URL)");
  assert(HH139.hhNavPush139(place139, "#play-7") === false && pushes139().length === 3, "r139 nav-push: pushing the place already current is a no-op");
  /* Popstate re-applies the recorded place and never pushes. */
  applied139.length = 0;
  const beforePop139 = histCalls139.length;
  popHandler139({ state: { hh139: { pushed: true, place: { panel: "plays", view: "battles", msub: "month", store: false, storeTarget: null, detail: null, hf: null, athlete: null } } } });
  await tick139();
  assert(applied139.some((c) => c[0] === "switchView" && c[1] === "battles") && applied139.some((c) => c[0] === "showPanel" && c[1] === "plays"), "r139 popstate: the recorded place is re-applied through the real view functions");
  assert(histCalls139.slice(beforePop139).every((c) => c.op !== "push"), "r139 popstate: a restore NEVER pushes (no forward-stack destruction, no loops)");
  applied139.length = 0;
  popHandler139({ state: { hh139: { pushed: true, place: { panel: "plays", view: "month", msub: "fame", store: false, storeTarget: null, detail: 9, hf: null, athlete: null } } } });
  await tick139();
  assert(applied139.some((c) => c[0] === "setMonthSub" && c[1] === "fame") && applied139.some((c) => c[0] === "openPlayDetail" && c[1] === 9 && c[2] && c[2].keepHash === true), "r139 popstate: a Month/Fame place with a play restores the sub-view AND reopens the detail with keepHash (Forward re-applies it)");

  /* ============ §49 Round 140 — two fixes. (1) Emil:
     "As soon as someone clicks a video play link it starts
     playing but the pause is on stays there." The detail video
     is a plain native-controls element (mediaHtml) — there is
     no app overlay to fade; on his iPhone the native chrome
     (big center pause cluster included) simply never left.
     wireWatchChrome140 manages the chrome standard-player
     style: playing → the controls attribute drops ~2s in;
     pause/ended → it returns and stays; a tap on the bare
     picture or a mouse move returns it and re-arms the fade.
     (2) Emil: "Center watch, battles and hype of the month" —
     the .viewseg row centers its tab group. ============ */
  const chromeBlock140 = appJs.slice(appJs.indexOf("/* Round 140"), appJs.indexOf("/* The slim contest line on Watch"));
  /* →148: the two watch-chrome `let` declarations moved above
     hidePlayDetail (the page-sub boot TDZ fix, see §56), out of
     this block — the harness prepends them (sliced from their
     new home) so the slice still executes with its state
     declared, in the same order the file itself runs. */
  const chromeState148 = appJs.slice(appJs.indexOf("let watchChromeVideo140"), appJs.indexOf("let watchChromeOff140 = null;") + "let watchChromeOff140 = null;".length);
  assert(chromeBlock140.includes("function wireWatchChrome140") && chromeBlock140.includes('body.querySelector(".watch-player")') && chromeBlock140.includes('box.querySelector("video:not(.vfill)")'), "r140 wiring: the chrome manager targets the detail's watch player and its real video (never the .vfill poster clone)");
  assert(chromeBlock140.includes('video.removeAttribute("controls")') && chromeBlock140.includes('video.setAttribute("controls", "")') && chromeBlock140.includes("HIDE_MS140 = 2000"), "r140 wiring: playing drops the controls attribute after ~2s; showing restores it — the native controls themselves are unchanged");
  assert(chromeBlock140.includes('addEventListener("play"') && chromeBlock140.includes('addEventListener("pause"') && chromeBlock140.includes('addEventListener("ended"') && chromeBlock140.includes('addEventListener("click"'), "r140 wiring: play/pause/ended/tap drive the chrome state");
  assert(!chromeBlock140.includes("hfBigPlay127") && !chromeBlock140.includes("hfStudio"), "r140 wiring: the Hype Frame studio's own overlay rules are NOT touched");
  const renderDetail140 = appJs.slice(appJs.indexOf("function renderPlayDetail"), appJs.indexOf("function upNextFor"));
  assert(renderDetail140.includes('typeof wireWatchChrome140 === "function") wireWatchChrome140(body);'), "r140 wiring: every detail render wires the chrome manager (guarded, like wireWatch123 beside it)");
  assert(appJs.slice(appJs.indexOf("function hidePlayDetail"), appJs.indexOf("window.closePlayDetail")).includes("teardownWatchChrome140()"), "r140 wiring: closing the detail tears the chrome manager down");
  const css140 = css.slice(css.indexOf("Round 140"));
  assert(css140.includes(".viewseg{justify-content:center}"), "r140 css (→141): the R140 block centered the tab group — the centering the pill bar inherits");
  /* Round 141 — Emil picked Variant B from the preview mocks:
     the board tab row is now a segmented pill bar. */
  const css141 = css.slice(css.indexOf("Round 141"));
  assert(css141.includes("background:var(--card)") && css141.includes("border:1px solid var(--line2)") && css141.includes("border-radius:999px") && css141.includes("width:fit-content"), "r141 css: the tab row is ONE rounded dark bar — card fill, subtle border, content-sized");
  assert(css141.includes("margin:2px auto 10px") && css141.includes("#plays .viewseg{justify-self:center}"), "r141 css: the bar stays centered as a group (auto side margins; centered in the desktop header grid too)");
  assert(css141.includes('.viewseg button[aria-pressed="true"]{background:var(--volt);color:var(--volt-ink)'), "r141 css: the ACTIVE tab is a lime-filled pill with black text — the filled pill is the indicator");
  assert(css141.includes("border-bottom:0") && !css141.includes("border-bottom-color") && !css141.includes("border-bottom:3px"), "r141 css: the active underline is retired — no bottom-border indicator in the pill rules");
  assert(!css141.includes("month-subseg") && !css141.includes("gap:26px"), "r141 css: scoped to the board tabs only — the This Month | Hall of Fame text tabs are untouched and the old 26px text-tab spacing does not carry into the bar");
  /* Behavioral: the REAL chrome block against a fake video and
     manual timers. */
  let timers140 = [];
  const fakeVideo140 = () => {
    const listeners = {};
    return {
      paused: true, ended: false, attrs: { controls: "" },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); },
      fire(ev) { (listeners[ev] || []).slice().forEach((fn) => fn()); },
      hasAttribute(n) { return n in this.attrs; },
      setAttribute(n, v) { this.attrs[n] = v; },
      removeAttribute(n) { delete this.attrs[n]; },
    };
  };
  const fakeBody140 = (video) => {
    const box = { querySelector: () => video, addEventListener: () => {}, removeEventListener: () => {} };
    return { querySelector: (sel) => (sel === ".watch-player" ? box : null) };
  };
  const sandbox140 = {
    console,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers140.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  };
  const ctx140 = vm.createContext(sandbox140);
  vm.runInContext(chromeState148 + "\n" + chromeBlock140 + "\n;this.__c140 = { wireWatchChrome140, teardownWatchChrome140 };", ctx140);
  const C140 = ctx140.__c140;
  const runTimers140 = () => { const due = timers140.filter((t) => !t.cleared); timers140 = []; due.forEach((t) => t.fn()); };
  const vid140 = fakeVideo140();
  vid140.paused = false; // autoplay already running when the detail wires
  C140.wireWatchChrome140(fakeBody140(vid140));
  assert(timers140.length === 1 && timers140[0].ms === 2000 && vid140.hasAttribute("controls"), "r140 behavior: wiring a playing clip arms ONE 2s fade timer, chrome still up");
  runTimers140();
  assert(!vid140.hasAttribute("controls"), "r140 behavior: ~2s into playback the chrome is GONE (controls attribute dropped while playing)");
  vid140.paused = true; vid140.fire("pause");
  assert(vid140.hasAttribute("controls") && timers140.length === 0, "r140 behavior: pausing brings the chrome straight back and no fade is pending — it stays while paused");
  vid140.paused = false; vid140.fire("play");
  runTimers140();
  assert(!vid140.hasAttribute("controls"), "r140 behavior: resuming re-arms the fade — chrome drops again while playing");
  vid140.fire("click");
  assert(vid140.hasAttribute("controls") && timers140.length === 1, "r140 behavior: a tap on the bare picture brings the chrome back and re-arms the fade");
  const vid140b = fakeVideo140(); // paused at wire time (a clip that did not autoplay)
  C140.wireWatchChrome140(fakeBody140(vid140b));
  assert(vid140.hasAttribute("controls") && timers140.filter((t) => !t.cleared).length === 0, "r140 behavior: rewiring (an Up-next swap) restores the old video's chrome, detaches it, and a paused new clip arms no fade");
  vid140.fire("play");
  assert(timers140.filter((t) => !t.cleared).length === 0, "r140 behavior: the swapped-out video's listeners are gone — its play event arms nothing");

  /* ============ §50 Round 142 — two tweaks from the review
     Emil shared and endorsed ("Build both tweaks").
     (1) The hero's duplicate "Post a Play" button is removed
     (the header pill stays); on the stacked breakpoint the
     hero min-height trims by the button's footprint so the
     board genuinely rises. (2) The Month FEATURED stage
     adapts to the #1 clip: portrait → a ~4:5 stage
     (markFeatStage142), landscape stays 16:9; the featured
     body is title line → vote button directly beneath. */
  // (a) Hero: one CTA left, header pill + FAB intact. (The
  // check slices the CTA ROW itself — the file's wider "hero"
  // slices run on into later sections that legitimately keep
  // their own Post a Play links.)
  const heroCtas142b = home.slice(home.indexOf('<div class="hero-ctas">'), home.indexOf('<div class="hero-ctas">') + 700);
  assert(heroCtas142b.includes("Watch Highlights") && !heroCtas142b.includes("btn-ghost") && !heroCtas142b.includes("data-submit-link") && !heroCtas142b.includes("Post a Play"), "r142 hero: Watch Highlights is the ONLY hero CTA — the duplicate Post a Play button is gone from the hero");
  assert(home.includes('id="postPlayBtn"') && home.includes("+ Post a Play") && home.includes('id="floatSubmit"'), "r142 hero: the header's lime '+ Post a Play' pill and the floating button are untouched");
  assert(css.includes("@media (max-width:560px)") && css.includes("calc(80vh - 70px)"), "r142 hero css: on the stacked-buttons breakpoint the hero min-height trims by the removed button's footprint (~56px + the 14px gap), so the board rises instead of the headline sinking");
  // (b) Stage wiring + CSS.
  assert((appJs.match(/markFeatStage142\(host\);/g) || []).length === 2, "r142 stage: markFeatStage142 is wired into BOTH hydrateDurPills branches (ready-now and loadedmetadata)");
  assert(css.includes(".feat-media134.feat-tall142") && css.includes("aspect-ratio:4/5") && css.includes("max-height:640px"), "r142 stage css: a portrait featured stage is ~4:5 with a 640px desktop height cap; landscape keeps the base 16:9");
  // (c) Behavior: the REAL markFeatStage142 against fake hosts.
  const stageSlice142 = appJs.slice(appJs.indexOf("function markFeatStage142"), appJs.indexOf("function hydrateDurPills"));
  const IMG_DIMS142 = { "/uploads/poster-p.jpg": { w: 720, h: 1280 }, "/uploads/poster-l.jpg": { w: 1280, h: 720 } };
  class FakeImage142 { set src(u) { const d = IMG_DIMS142[u] || { w: 0, h: 0 }; this.naturalWidth = d.w; this.naturalHeight = d.h; if (this.onload) this.onload(); } }
  const mkHost142 = (video, feat = true) => {
    const classes = new Set(feat ? ["tile-media", "dur-host", "feat-media134"] : ["tile-media", "dur-host"]);
    return { classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c) }, querySelector: () => video, _classes: classes };
  };
  const mkVideo142 = (vw, vh, poster) => ({ videoWidth: vw, videoHeight: vh, getAttribute: (a) => (a === "poster" ? poster : null) });
  const ctx142 = vm.createContext({ window: {}, console, Image: FakeImage142 });
  vm.runInContext(stageSlice142, ctx142);
  const mark142 = (host) => vm.runInContext("markFeatStage142", ctx142)(host);
  const hostP142 = mkHost142(mkVideo142(0, 0, "/uploads/poster-p.jpg"));
  mark142(hostP142);
  assert(hostP142._classes.has("feat-tall142"), "r142 behavior: a PORTRAIT poster (natural 720×1280, metadata unknown) marks the featured stage tall");
  const hostL142 = mkHost142(mkVideo142(0, 0, "/uploads/poster-l.jpg"));
  mark142(hostL142);
  assert(!hostL142._classes.has("feat-tall142"), "r142 behavior: a LANDSCAPE poster leaves the featured stage at 16:9");
  const hostM142 = mkHost142(mkVideo142(720, 1280, "/uploads/poster-l.jpg"));
  mark142(hostM142);
  assert(hostM142._classes.has("feat-tall142"), "r142 behavior: portrait VIDEO METADATA marks the stage tall even before/without the poster signal");
  const hostT142 = mkHost142(mkVideo142(0, 0, "/uploads/poster-p.jpg"), false);
  mark142(hostT142);
  assert(!hostT142._classes.has("feat-tall142"), "r142 behavior: a non-featured host (a board tile) is never marked — the adaptive stage is featured-only");
  const hostU142 = mkHost142(mkVideo142(0, 0, ""));
  mark142(hostU142);
  assert(!hostU142._classes.has("feat-tall142"), "r142 behavior: no poster and no metadata → no mark → today's 16:9 fallback");
  // (d) The rendered featured card: title line, then the vote
  // button DIRECTLY beneath (no sub-line between), and the
  // leaderboard rows keep their sport sub-lines.
  const chain142 = escCap133
    + appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) /* →151: the real Round 151 helpers ride along (feat chip + watches line, fame-row suffix) */
    + appJs.slice(appJs.indexOf("function firstNameOf"), appJs.indexOf("function tileHtml"))
    + appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function renderMine"))
    + appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
  const els142 = {};
  const ctx142b = vm.createContext({
    window: {}, console,
    CONTEST: { period: "2026-11", entries: [playA134, playB134] },
    LAST_MONTH: { winnerId: null, entries: [] },
    ALL_PLAYS: [playA134, playB134],
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthSport: "all",
    playHasVideo: () => true, playVideoSrc134: (h) => h.media_url, durPillHtml: () => "",
    hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
    $: (sel) => (els142[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
    $$: () => [],
  });
  vm.runInContext(chain142, ctx142b);
  vm.runInContext("renderMonth()", ctx142b);
  const feat142 = els142["#monthFeat"].innerHTML;
  assert(feat142.indexOf("feat-title134") > -1 && feat142.indexOf("feat-vote134") > feat142.indexOf("feat-title134") && !feat142.includes("feat-sub134"), "r142 featured: the vote button directly follows the title line — no sub-line between them");
  assert(els142["#monthRows"].innerHTML.includes("Martial Arts"), "r142 rows: the leaderboard rows keep their sport sub-lines (only the featured card dropped its own)");

  /* ============ §51 Round 143 — the chrome fade reaches
     Battles. Emil: "In quick battles can you check the play
     on videos it's also delayed before the pause button goes
     away." Round 140 fixed the play detail and deliberately
     scoped Battles OUT (its big player had its own tap-to-
     play wiring). The fade core is now ONE shared helper,
     attachChromeFade143: wireWatchChrome140 delegates to it
     (the §49 block above still proves the detail behavior),
     and wireBtlChrome143 wires the three persistent Battles
     big players to it once at startup — #btlPlayer (Quick),
     #dailyPlayer (Daily Battle), #runPlayer (Battle Run).
     The Battles minis are muted frame-grab previews with NO
     controls attribute — there is no chrome on them to fade. */
  assert(appJs.includes("function attachChromeFade143") && appJs.includes("watchChromeOff140 = attachChromeFade143(video, box);"), "r143 wiring: ONE shared fade helper — the detail wrapper delegates to it, no copy-paste twin");
  assert(appJs.includes("function wireBtlChrome143") && appJs.includes('["btlPlayer", "dailyPlayer", "runPlayer"].forEach'), "r143 wiring: all three Battles big players (Quick / Daily / Battle Run) are wired to the fade, once each");
  assert(home.includes('id="btlPlayer" playsinline loop preload="metadata" controls') && home.includes('id="dailyPlayer" playsinline loop preload="metadata" controls') && home.includes('id="runPlayer" playsinline loop preload="metadata" controls'), "r143 wiring: the three big players are the persistent native-controls elements in the markup");
  assert(!appJs.slice(appJs.indexOf("function btlConfigureMedia111"), appJs.indexOf("function btlObtainMedia111")).includes("controls"), "r143 scope: the pooled Battles minis are configured WITHOUT native controls — no chrome exists on them to fade");
  /* Behavioral: the REAL helper against two fake battle
     players on manual timers — each player fades on its own
     clock; a pick (the pause) restores only its own player;
     a tap on a faded player restores + re-arms; a teardown
     detaches completely. */
  const fadeSlice143 = appJs.slice(appJs.indexOf("function attachChromeFade143"), appJs.indexOf("/* The slim contest line on Watch"));
  let timers143 = [];
  const fakePlayer143 = () => {
    const listeners = {};
    return {
      paused: true, ended: false, attrs: { controls: "" },
      addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
      removeEventListener(ev, fn) { if (listeners[ev]) listeners[ev] = listeners[ev].filter((f) => f !== fn); },
      fire(ev) { (listeners[ev] || []).slice().forEach((fn) => fn()); },
      hasAttribute(n) { return n in this.attrs; },
      setAttribute(n, v) { this.attrs[n] = v; },
      removeAttribute(n) { delete this.attrs[n]; },
    };
  };
  const fakeBox143 = () => ({ addEventListener: () => {}, removeEventListener: () => {} });
  const sandbox143 = {
    console,
    setTimeout: (fn, ms) => { const t = { fn, ms, cleared: false }; timers143.push(t); return t; },
    clearTimeout: (t) => { if (t) t.cleared = true; },
  };
  const ctx143 = vm.createContext(sandbox143);
  vm.runInContext(fadeSlice143 + "\n;this.__f143 = { attachChromeFade143 };", ctx143);
  const F143 = ctx143.__f143;
  const runTimers143 = () => { const due = timers143.filter((t) => !t.cleared); timers143 = []; due.forEach((t) => t.fn()); };
  const pending143 = () => timers143.filter((t) => !t.cleared).length;
  const quick143 = fakePlayer143(), daily143 = fakePlayer143();
  const offQuick143 = F143.attachChromeFade143(quick143, fakeBox143());
  F143.attachChromeFade143(daily143, fakeBox143());
  assert(pending143() === 0 && quick143.hasAttribute("controls") && daily143.hasAttribute("controls"), "r143 behavior: wiring PAUSED battle players (the Battles-open state) arms no fade — chrome up on both");
  quick143.paused = false; quick143.fire("play");
  assert(pending143() === 1 && timers143.find((t) => !t.cleared).ms === 2000, "r143 behavior: the Quick player starting arms ONE 2s fade (the same timing as the detail player)");
  runTimers143();
  assert(!quick143.hasAttribute("controls") && daily143.hasAttribute("controls"), "r143 behavior: ~2s into the battle clip the Quick player's chrome is GONE — and the Daily player's is untouched (per-player state)");
  quick143.paused = true; quick143.fire("pause"); // a pick pauses the player
  assert(quick143.hasAttribute("controls") && pending143() === 0, "r143 behavior: the pick's pause brings the Quick chrome straight back and it stays while paused");
  daily143.paused = false; daily143.fire("play"); runTimers143();
  assert(!daily143.hasAttribute("controls"), "r143 behavior: the Daily player fades on its own clock too");
  daily143.fire("click");
  assert(daily143.hasAttribute("controls") && pending143() === 1, "r143 behavior: a tap on the faded Daily picture brings the chrome back and re-arms the fade");
  offQuick143();
  quick143.paused = false; quick143.fire("play");
  assert(pending143() === 1 && quick143.hasAttribute("controls"), "r143 behavior: a torn-down player's events arm nothing (the one pending timer is the Daily tap's re-arm)");

  /* ============ §52 Round 144 — exact restore of deleted plays
     (POST /api/backup/restore-plays) ==============================
     The one writing backup route: it puts back a play the owner
     deleted by mistake — original id, status, votes, contest entry
     and media/poster files — from a bundle extracted out of a pulled
     backup. All-or-nothing. This section boots its OWN server with
     BACKUP_TOKEN set, seeds a real play (video upload -> poster,
     approve, vote, contest entry), captures the pre-delete state
     through the server's own backup snapshot, owner-deletes the
     play, then drives the restore endpoint end to end. */
  {
    const PORT52 = 3491, base52 = `http://localhost:${PORT52}`;
    const tmp52 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r144-"));
    const TOK52 = "r144-test-backup-token";
    const child52 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT52), DATA_DIR: tmp52, BACKUP_TOKEN: TOK52 }, stdio: "pipe" });
    const j52 = async (p, opts = {}) => { const r = await fetch(base52 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const snap52 = async () => {
      const r = await fetch(base52 + "/api/backup/db", { headers: { "x-backup-token": TOK52 } });
      assert(r.status === 200, "r144: backup snapshot downloads with the token");
      const snapPath = path.join(tmp52, "snap.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      const data = {
        row: sdb.prepare("SELECT * FROM highlights WHERE id=?").get(playId52),
        votes: sdb.prepare("SELECT * FROM votes WHERE highlight_id=?").all(playId52),
        entries: sdb.prepare("SELECT * FROM contest_entries WHERE highlight_id=?").all(playId52),
      };
      data.athlete = data.row && data.row.athlete_id ? sdb.prepare("SELECT * FROM athletes WHERE athlete_key=?").get(data.row.athlete_id) : null;
      sdb.close();
      return data;
    };
    let playId52 = 0;
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base52 + "/api/health"); break; } catch { await wait(200); } }
      // Seed: a real video upload so the pipeline writes a poster.
      const clip52 = path.join(tmp52, "clip52.mp4");
      execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x120:rate=10:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", clip52]);
      const fd52 = new FormData();
      fd52.append("title", "R144 Restore Play");
      fd52.append("sport", "baseball");
      fd52.append("division", "boys");
      fd52.append("playerName", "Restore Kid");
      fd52.append("notifyEmail", "restore@example.com");
      fd52.append("guardianConsent", "on");
      fd52.append("contestOptin", "on");
      fd52.append("file", new Blob([fs.readFileSync(clip52)], { type: "video/mp4" }), "clip52.mp4");
      const up52 = await j52("/api/highlights", { method: "POST", body: fd52 });
      assert(up52.status === 201, "r144 seed: video upload succeeds (201)");
      playId52 = up52.body.id;
      const claim52 = await j52("/api/owner/claim", { method: "POST" });
      const otok52 = claim52.body.token; assert(otok52, "r144 seed: owner claim returns a token");
      const appr52 = await j52(`/api/highlights/${playId52}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": otok52 }, body: JSON.stringify({ status: "approved" }) });
      assert(appr52.body.status === "approved", "r144 seed: play approved");
      const vote52 = await j52(`/api/highlights/${playId52}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "r144-voter" }) });
      assert(vote52.status === 200, "r144 seed: vote cast");
      // Pre-delete truth, captured through the backup snapshot.
      const pre52 = await snap52();
      assert(pre52.row && pre52.row.status === "approved", "r144 seed: snapshot shows the approved play");
      assert(pre52.votes.length === 1, "r144 seed: snapshot shows exactly 1 vote");
      if (!pre52.entries.length) { // auto-entry should have fired; fall back to the owner enter route
        await j52("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": otok52 }, body: JSON.stringify({ highlightId: playId52 }) });
        Object.assign(pre52, await snap52());
      }
      assert(pre52.entries.length === 1 && pre52.entries[0].period === pre52.votes[0].period, "r144 seed: snapshot shows exactly 1 contest entry for the vote period");
      assert(pre52.row.poster_url, "r144 seed: the pipeline generated a poster for the play");
      const mediaName52 = path.basename(pre52.row.media_url), posterName52 = path.basename(pre52.row.poster_url);
      const mediaBytes52 = fs.readFileSync(path.join(tmp52, "uploads", mediaName52));
      const posterBytes52 = fs.readFileSync(path.join(tmp52, "uploads", posterName52));
      const bundle52 = {
        plays: [pre52.row], votes: pre52.votes, contest_entries: pre52.entries,
        athletes: pre52.athlete ? [pre52.athlete] : [],
        files: [{ name: mediaName52, size: mediaBytes52.length }, { name: posterName52, size: posterBytes52.length }],
      };
      const restoreFd52 = (bundle, mediaBytes, posterBytes) => {
        const fd = new FormData();
        fd.append("bundle", JSON.stringify(bundle));
        fd.append(mediaName52, new Blob([mediaBytes]), mediaName52);
        fd.append(posterName52, new Blob([posterBytes]), posterName52);
        return fd;
      };
      // →146: the owner delete is a TRASH move now — the row, the
      // files and the votes all STAY; only the status flips and
      // the contest entry is removed. "Delete forever" (the purge
      // route) is what makes the play actually gone, and only a
      // truly-gone play can come back through the endpoint under
      // test, so the r144 flow now goes delete -> purge -> restore.
      const del52 = await j52(`/api/highlights/${playId52}`, { method: "DELETE", headers: { "x-owner-token": otok52 } });
      assert(del52.status === 200 && del52.body.ok && del52.body.trashed === true, "r144: owner delete succeeds (→146: as a move to Trash)");
      assert(fs.existsSync(path.join(tmp52, "uploads", mediaName52)) && fs.existsSync(path.join(tmp52, "uploads", posterName52)), "→146: trashing KEEPS the media + poster files on disk");
      const trashed52 = await snap52();
      assert(trashed52.row && trashed52.row.status === "trashed" && trashed52.row.status_before_trash === "approved" && trashed52.votes.length === 1 && trashed52.entries.length === 0, "→146: the trashed play keeps its row + vote; its contest entry is removed");
      const purge52 = await j52(`/api/highlights/${playId52}/purge`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": otok52 }, body: "{}" });
      assert(purge52.status === 200 && purge52.body.ok, "→146: delete-forever (purge) succeeds from the Trash");
      assert(!fs.existsSync(path.join(tmp52, "uploads", mediaName52)) && !fs.existsSync(path.join(tmp52, "uploads", posterName52)), "r144: delete removed the media + poster files (→146: via the purge)");
      const gone52 = await snap52();
      assert(!gone52.row && gone52.votes.length === 0 && gone52.entries.length === 0, "r144: delete removed the row, its vote and its entry (→146: via trash + purge)");
      // Auth: the restore route answers exactly like the other
      // backup routes when the token is wrong or absent.
      const noTok52 = await fetch(base52 + "/api/backup/restore-plays", { method: "POST", body: restoreFd52(bundle52, mediaBytes52, posterBytes52) });
      assert(noTok52.status === 403, "r144: restore without a token -> 403 (same as every backup route)");
      const badTok52 = await fetch(base52 + "/api/backup/restore-plays", { method: "POST", headers: { "x-backup-token": "wrong-token" }, body: restoreFd52(bundle52, mediaBytes52, posterBytes52) });
      assert(badTok52.status === 403, "r144: restore with a wrong token -> 403");
      // Abort semantics: a stated size that disagrees with the part
      // aborts the whole restore — nothing written, nothing inserted.
      const badBundle52 = JSON.parse(JSON.stringify(bundle52));
      badBundle52.files[0].size += 1;
      const badSize52 = await j52("/api/backup/restore-plays", { method: "POST", headers: { "x-backup-token": TOK52 }, body: restoreFd52(badBundle52, mediaBytes52, posterBytes52) });
      assert(badSize52.status === 400, "r144: size-mismatch bundle -> 400 abort");
      const stillGone52 = await snap52();
      assert(!stillGone52.row && !fs.existsSync(path.join(tmp52, "uploads", mediaName52)), "r144: aborted restore wrote nothing (no row, no file)");
      // The real restore.
      const ok52 = await j52("/api/backup/restore-plays", { method: "POST", headers: { "x-backup-token": TOK52 }, body: restoreFd52(bundle52, mediaBytes52, posterBytes52) });
      assert(ok52.status === 200 && ok52.body.ok === true, "r144: restore succeeds");
      assert(JSON.stringify(ok52.body.restored) === JSON.stringify([playId52]) && ok52.body.filesWritten === 2 && ok52.body.votes === 1 && ok52.body.entries === 1, "r144: restore reports the id, 2 files, 1 vote, 1 entry");
      const back52 = await snap52();
      assert(back52.row && back52.row.id === playId52 && back52.row.status === "approved" && back52.row.title === "R144 Restore Play", "r144: the play is back with the SAME id, status and title");
      assert(back52.votes.length === 1 && back52.votes[0].voter_token === "r144-voter", "r144: the vote is back");
      assert(back52.entries.length === 1, "r144: the contest entry is back");
      assert(fs.readFileSync(path.join(tmp52, "uploads", mediaName52)).equals(mediaBytes52), "r144: media file bytes are identical after restore");
      assert(fs.readFileSync(path.join(tmp52, "uploads", posterName52)).equals(posterBytes52), "r144: poster bytes are identical after restore");
      const pub52 = await j52("/api/highlights?division=all");
      assert(pub52.body.highlights.some((h) => h.id === playId52), "r144: restored play is public again under its original id");
      // Second restore of the same play: 409, nothing duplicated.
      const again52 = await j52("/api/backup/restore-plays", { method: "POST", headers: { "x-backup-token": TOK52 }, body: restoreFd52(bundle52, mediaBytes52, posterBytes52) });
      assert(again52.status === 409 && Array.isArray(again52.body.ids) && again52.body.ids.includes(playId52), "r144: second restore -> 409 naming the existing id");
      const afterAgain52 = await snap52();
      assert(afterAgain52.votes.length === 1 && afterAgain52.entries.length === 1, "r144: the 409 abort duplicated nothing");
    } finally {
      child52.kill();
      fs.rmSync(tmp52, { recursive: true, force: true });
    }
  }

  /* ============ §53 Round 145 — the crash-retry safeguards ======
     Four changes, one for each way the 2026-11-13 night went
     wrong: (A) a token-gated cleanup route that deletes ONLY
     still-pending, non-sample plays from an approved id list;
     (B) upload dedupe — the server stores the sha256 of the file
     bytes and answers a same-bytes retry inside 30 minutes from
     the original play; (C) the upload button locks in flight
     (Emil's ask) so the retry gesture can't even fire; (D) the
     Owner queue groups pending duplicates behind one delete-all
     action, and a LIVE play deletes only through a dialog that
     names it, its votes and its contest entry. */
  {
    // ---- Wiring asserts (no extra server) ----
    assert(serverJs.includes("ADD COLUMN media_hash") && serverJs.includes("idx_highlights_media_hash"), "r145 wiring: highlights gains a media_hash column (+ index) via the ALTER migration pattern");
    assert(serverJs.includes('p === "/api/backup/delete-pending"') && serverJs.includes('reason: "not pending"') && serverJs.includes('reason: "sample"') && serverJs.includes('reason: "not found"'), "r145 wiring: the guarded cleanup route exists with per-id skip reasons");
    assert(serverJs.includes("datetime('now','-30 minutes')") && serverJs.includes("deduped: true"), "r145 wiring: the upload handler dedupes same-bytes uploads inside a 30-minute window");
    assert(appJs.includes("function setUploadLock145") && appJs.includes("if (uploadInFlight145) return;") && appJs.includes("Posting your play…") && appJs.includes("j.deduped ? (j.status || \"pending\") : null"), "r145 wiring: the submit handler guards re-entry, locks at the fetch, unlocks on error, and routes a deduped answer to the success variant");
    const fdAt145 = appJs.indexOf("const fdSend125 = new FormData(form)");
    const lockAt145 = appJs.indexOf("setUploadLock145(form, true)");
    assert(fdAt145 > -1 && lockAt145 > fdAt145, "r145 wiring: the lock engages AFTER the send FormData is built — a disabled file input drops out of FormData, so locking first would strip the clip from its own upload (rig-caught)");
    assert(appJs.includes("This clip is already in — no need to post it twice.") && home.includes('id="uploadSuccessStatus145"') && home.includes('id="uploadSuccessCheck"') && home.includes('id="uploadSuccessSteps"'), "r145 wiring: the dedupe success variant (headline + status line) is wired into the Round 121 screen");
    assert(appJs.includes("pendGroups145") && appJs.includes("deletePendingGroup145") && appJs.includes("copies of '") && appJs.includes("the live play is not touched"), "r145 wiring: the queue groups pending duplicates with a delete-all-copies header that spares the live play");
    assert(appJs.includes("function openDeleteLive145") && home.includes('id="deleteLiveModal145"') && home.includes("Move to Trash") && home.includes("restore it from the Trash") && home.includes('id="deleteLiveCancel145"'), "r145 wiring: deleting a LIVE play takes the dedicated dialog (named play, red button, Cancel present) (→146: its copy + red button now say 'Move to Trash' — a delete is a Trash move, restorable for 7 days)");
    assert(css.includes(".dropzone.locked145") && css.includes(".queue-group145") && css.includes(".dellive-red145") && css.includes(".dellive145[hidden]"), "r145 wiring: styles carry the locked dropzone, the group header and the dialog");

    // ---- Behavioral: the lock helper against a fake form ----
    const lockSlice145 = appJs.slice(appJs.indexOf("let uploadInFlight145"), appJs.indexOf("let athleteCheckDoneFor"));
    const dzClasses145 = new Set();
    const fakeBtn145 = { disabled: false, textContent: "Post a Play", dataset: {} };
    const fakeInput145 = { disabled: false };
    const fakeForm145 = { querySelector: (sel) => (sel === 'button[type="submit"]' ? fakeBtn145 : null), elements: { file: fakeInput145 } };
    const lockSandbox145 = { console, window: {}, $: (sel) => (sel === "#dropzone" ? { classList: { toggle: (c, on) => { if (on) dzClasses145.add(c); else dzClasses145.delete(c); } } } : null) };
    const lockCtx145 = vm.createContext(lockSandbox145);
    vm.runInContext(lockSlice145 + "\n;this.__L145 = { setUploadLock145, inflight: () => uploadInFlight145 };", lockCtx145);
    const L145 = lockCtx145.__L145;
    L145.setUploadLock145(fakeForm145, true);
    assert(L145.inflight() === true && lockSandbox145.window.__hhUploadLock145 === true, "r145 lock: engaging sets the in-flight flag (submit re-entry guard + dropzone guard)");
    assert(fakeBtn145.disabled === true && fakeBtn145.textContent === "Posting your play…" && fakeInput145.disabled === true && dzClasses145.has("locked145"), "r145 lock: submit disabled + relabeled 'Posting your play…', file input disabled, dropzone locked");
    L145.setUploadLock145(fakeForm145, false);
    assert(L145.inflight() === false && fakeBtn145.disabled === false && fakeBtn145.textContent === "Post a Play" && fakeInput145.disabled === false && !dzClasses145.has("locked145"), "r145 lock: releasing restores the 'Post a Play' label and hands the form back for a retry");

    // ---- Behavioral: queue delete paths (group + live dialog) ----
    const delSlice145 = appJs.slice(appJs.indexOf("window.deletePlay = async"), appJs.indexOf("const ownerBtnEl"));
    const modalTxt145 = { textContent: "" };
    const modal145 = { hidden: true, querySelector: () => ({ addEventListener: () => {} }) };
    const captured145 = {};
    const apiCalls145 = [];
    let confirmReply145 = true, confirmMsg145 = "";
    const delSandbox145 = {
      console, window: {},
      ownerQueue145: [
        { id: 11, title: "second homer", player_name: "christian", athlete_label: "christian", status: "approved", voteCount: 3, contest_entry_period: "2026-11" },
        { id: 12, title: "second homer", player_name: "christian", athlete_label: "christian", status: "pending", voteCount: 0, contest_entry_period: "" },
        { id: 13, title: "second homer", player_name: "christian", athlete_label: "christian", status: "pending", voteCount: 0, contest_entry_period: "" },
        { id: 14, title: "second homer", player_name: "christian", athlete_label: "christian", status: "pending", voteCount: 0, contest_entry_period: "" },
      ],
      $: (sel) => (sel === "#deleteLiveModal145" ? modal145 : sel === "#deleteLiveText145" ? modalTxt145 : sel === "#deleteLiveCancel145" || sel === "#deleteLiveConfirm145" ? { addEventListener: (ev, fn) => { captured145[sel] = fn; }, focus: () => { captured145.focused = sel; } } : null),
      api: async (p, opts = {}) => { apiCalls145.push({ p, method: opts.method || "GET" }); return {}; },
      loadOwner: () => {}, loadData: () => {},
      confirm: (m) => { confirmMsg145 = m; return confirmReply145; },
    };
    const delCtx145 = vm.createContext(delSandbox145);
    vm.runInContext(delSlice145, delCtx145);
    await delSandbox145.window.deletePlay(11);
    assert(modal145.hidden === false && apiCalls145.length === 0, "r145 dialog: deleting an APPROVED play opens the dialog — nothing is deleted yet, no bare confirm");
    assert(modalTxt145.textContent.includes('"second homer"') && modalTxt145.textContent.includes("christian") && modalTxt145.textContent.includes("LIVE") && modalTxt145.textContent.includes("3 all-time votes") && modalTxt145.textContent.includes("entered in Hype of the Month (2026-11)"), "r145 dialog: it names the play + athlete, states LIVE, the all-time votes and the contest entry");
    assert(captured145.focused === "#deleteLiveCancel145", "r145 dialog: Cancel carries the focus on open — the red button is never the default");
    await captured145["#deleteLiveConfirm145"]();
    assert(apiCalls145.length === 1 && apiCalls145[0].method === "DELETE" && apiCalls145[0].p === "/api/highlights/11" && modal145.hidden === true, "r145 dialog: only the red button acts, and the dialog closes (→146: the button reads 'Move to Trash' — the DELETE it fires is a Trash move server-side)");
    apiCalls145.length = 0; confirmReply145 = false;
    await delSandbox145.window.deletePlay(12);
    assert(apiCalls145.length === 0, "r145 queue: a pending delete still asks first — a 'no' deletes nothing");
    confirmReply145 = true;
    await delSandbox145.window.deletePlay(12);
    assert(apiCalls145.length === 1 && apiCalls145[0].p === "/api/highlights/12", "r145 queue: a pending delete with a 'yes' goes through the existing owner delete");
    apiCalls145.length = 0; confirmMsg145 = "";
    await delSandbox145.window.deletePendingGroup145("12,13,14");
    assert(confirmMsg145.includes("3 pending copies of 'second homer'"), "r145 group: ONE confirmation names the copy count and the title");
    assert(apiCalls145.filter((c) => c.method === "DELETE").length === 3, "r145 group: delete-all-copies deletes each pending id through the owner endpoint");

    // ---- Server behavior: dedupe + the guarded cleanup ----
    const PORT53 = 3492, base53 = `http://localhost:${PORT53}`;
    const tmp53 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r145-"));
    const TOK53 = "r145-test-backup-token";
    const child53 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT53), DATA_DIR: tmp53, BACKUP_TOKEN: TOK53 }, stdio: "pipe" });
    const j53 = async (p, opts = {}) => { const r = await fetch(base53 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const snap53 = async () => {
      const r = await fetch(base53 + "/api/backup/db", { headers: { "x-backup-token": TOK53 } });
      const snapPath = path.join(tmp53, "snap53.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      const data = { rows: sdb.prepare("SELECT * FROM highlights ORDER BY id").all() };
      sdb.close();
      return data;
    };
    const photo53 = (seedByte) => { const b = Buffer.alloc(2048, 7); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[100] = seedByte; return b; };
    const upload53 = async (bytes, title, name) => {
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "soccer"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      fd.append("file", new Blob([bytes], { type: "image/png" }), "clip.png");
      return j53("/api/highlights", { method: "POST", body: fd });
    };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base53 + "/api/health"); break; } catch { await wait(200); } }
      // Dedupe: same bytes twice inside the window -> ONE row, ONE file.
      const bytesA53 = photo53(1), bytesB53 = photo53(2);
      const upA1 = await upload53(bytesA53, "Dedupe Play", "Casey");
      assert(upA1.status === 201 && upA1.body.id, "r145 dedupe seed: the first upload lands (201)");
      const dupId53 = upA1.body.id;
      const filesAfterFirst53 = fs.readdirSync(path.join(tmp53, "uploads")).length;
      const upA2 = await upload53(bytesA53, "Dedupe Play — retry", "Casey");
      assert(upA2.status === 200 && upA2.body.deduped === true && upA2.body.id === dupId53 && upA2.body.status === "pending", "r145 dedupe: the same-bytes retry is answered from the ORIGINAL play (200, deduped, same id + status)");
      const snapD53 = await snap53();
      assert(snapD53.rows.filter((r) => r.id === dupId53).length === 1 && snapD53.rows.length === 1, "r145 dedupe: exactly ONE highlights row exists after the retry");
      assert(fs.readdirSync(path.join(tmp53, "uploads")).length === filesAfterFirst53, "r145 dedupe: the retry wrote NO second file");
      assert(snapD53.rows[0].media_hash && snapD53.rows[0].media_hash.length === 64, "r145 dedupe: the stored media_hash is the file's sha256");
      const upB53 = await upload53(bytesB53, "Different Play", "Casey");
      assert(upB53.status === 201 && upB53.body.id !== dupId53, "r145 dedupe: different bytes are a different play (201, new id)");
      // Window: backdate the original past 30 minutes -> the same
      // bytes are a NEW play again (a fresh post half an hour
      // later is not a retry).
      const direct53 = new DatabaseSync(path.join(tmp53, "highlighthype.db"));
      direct53.prepare("UPDATE highlights SET created_at = datetime('now','-31 minutes') WHERE id=?").run(dupId53);
      direct53.close();
      const upA3 = await upload53(bytesA53, "Dedupe Play — much later", "Casey");
      assert(upA3.status === 201 && upA3.body.id !== dupId53, "r145 dedupe: a same-hash row OLDER than the window does not dedupe — a new play is created");
      // Cleanup endpoint: seed one of each verdict class.
      const claim53 = await j53("/api/owner/claim", { method: "POST" });
      const otok53 = claim53.body.token; assert(otok53, "r145 cleanup seed: owner claim returns a token");
      const mkPlay53 = async (seedByte, title) => (await upload53(photo53(seedByte), title, "Clean Kid")).body.id;
      const pendId53 = await mkPlay53(11, "Cleanup Pending");
      const apprId53 = await mkPlay53(12, "Cleanup Approved");
      const sampId53 = await mkPlay53(13, "Cleanup Sample Pending");
      await j53(`/api/highlights/${apprId53}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": otok53 }, body: JSON.stringify({ status: "approved" }) });
      await j53(`/api/highlights/${sampId53}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": otok53 }, body: JSON.stringify({ status: "pending", sample: true }) });
      const preClean53 = await snap53();
      const pendRow53 = preClean53.rows.find((r) => r.id === pendId53);
      assert(pendRow53 && pendRow53.status === "pending", "r145 cleanup seed: the pending play exists");
      assert(preClean53.rows.find((r) => r.id === apprId53).status === "approved", "r145 cleanup seed: the approved play exists");
      assert(preClean53.rows.find((r) => r.id === sampId53).is_sample === 1 && preClean53.rows.find((r) => r.id === sampId53).status === "pending", "r145 cleanup seed: the pending SAMPLE play exists");
      const pendFile53 = path.join(tmp53, "uploads", path.basename(pendRow53.media_url));
      assert(fs.existsSync(pendFile53), "r145 cleanup seed: the pending play's media file is on disk");
      const noTok53 = await fetch(base53 + "/api/backup/delete-pending", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [pendId53] }) });
      assert(noTok53.status === 403, "r145 cleanup: no token -> 403 (same as every backup route)");
      const badTok53 = await fetch(base53 + "/api/backup/delete-pending", { method: "POST", headers: { "content-type": "application/json", "x-backup-token": "wrong-token" }, body: JSON.stringify({ ids: [pendId53] }) });
      assert(badTok53.status === 403, "r145 cleanup: wrong token -> 403");
      const tooMany53 = await j53("/api/backup/delete-pending", { method: "POST", headers: { "content-type": "application/json", "x-backup-token": TOK53 }, body: JSON.stringify({ ids: Array.from({ length: 101 }, (_, i) => i + 1) }) });
      assert(tooMany53.status === 400, "r145 cleanup: more than 100 ids -> 400");
      const clean53 = await j53("/api/backup/delete-pending", { method: "POST", headers: { "content-type": "application/json", "x-backup-token": TOK53 }, body: JSON.stringify({ ids: [pendId53, apprId53, sampId53, 999999] }) });
      assert(clean53.status === 200 && clean53.body.ok === true, "r145 cleanup: the call succeeds");
      assert(JSON.stringify(clean53.body.deleted) === JSON.stringify([pendId53]), "r145 cleanup: ONLY the pending non-sample play was deleted");
      const skip53 = Object.fromEntries((clean53.body.skipped || []).map((s) => [s.id, s.reason]));
      assert(skip53[apprId53] === "not pending" && skip53[sampId53] === "sample" && skip53[999999] === "not found", "r145 cleanup: approved -> 'not pending', sample -> 'sample', unknown -> 'not found'");
      const postClean53 = await snap53();
      assert(!postClean53.rows.some((r) => r.id === pendId53) && !fs.existsSync(pendFile53), "r145 cleanup: the deleted play's row AND media file are gone");
      assert(postClean53.rows.some((r) => r.id === apprId53) && postClean53.rows.some((r) => r.id === sampId53), "r145 cleanup: the approved and sample plays are fully intact");
    } finally {
      child53.kill();
      fs.rmSync(tmp53, { recursive: true, force: true });
    }
  }

  /* ============ §54 Round 146 — Trash + undo, moderation log ==
     Phase 2 of the owner-panel program: the owner DELETE is a
     move to Trash now (status 'trashed', pre-trash status kept,
     contest entry removed, votes + files KEPT), Restore flips
     the play back whole (contest entry NOT recreated), Delete
     forever is the extracted permanent cascade, plays trashed
     7+ days auto-purge, and every action lands in the
     moderation_log. The R145 backup cleanup keeps its permanent
     semantics, and its deletes — plus R144 restores — are logged
     under actor 'backup-tool'. */
  {
    // ---- Wiring asserts (no extra server) ----
    assert(serverJs.includes("ADD COLUMN trashed_at") && serverJs.includes("ADD COLUMN status_before_trash") && serverJs.includes("CREATE TABLE IF NOT EXISTS moderation_log"), "r146 wiring: highlights gains trashed_at + status_before_trash; the moderation_log table is created");
    assert(serverJs.includes("\\/restore$") && serverJs.includes("\\/purge$") && serverJs.includes('p === "/api/owner/moderation-log"') && serverJs.includes("function trashPlay146") && serverJs.includes("function permanentDeletePlay146") && serverJs.includes("function r146PurgeExpiredTrash"), "r146 wiring: restore + purge routes, the owner moderation-log endpoint, and the trash/purge helpers exist");
    assert(appJs.includes("window.restorePlay146") && appJs.includes("window.purgePlay146") && appJs.includes('$("#trash146")') && appJs.includes("/api/owner/moderation-log") && home.includes('id="trash146"') && home.includes('id="modLog146"'), "r146 wiring: the Owner view renders a Trash section + a Moderation log section and wires both actions");

    // ---- Server behavior ----
    const PORT54 = 3493, base54 = `http://localhost:${PORT54}`;
    const tmp54 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r146-"));
    const TOK54 = "r146-test-backup-token";
    const child54 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT54), DATA_DIR: tmp54, BACKUP_TOKEN: TOK54 }, stdio: "pipe" });
    const j54 = async (p, opts = {}) => { const r = await fetch(base54 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const snap54 = async () => {
      const r = await fetch(base54 + "/api/backup/db", { headers: { "x-backup-token": TOK54 } });
      const snapPath = path.join(tmp54, "snap54.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      const data = {
        row: (id) => sdb.prepare("SELECT * FROM highlights WHERE id=?").get(id),
        votes: (id) => sdb.prepare("SELECT * FROM votes WHERE highlight_id=?").all(id),
        entries: (id) => sdb.prepare("SELECT * FROM contest_entries WHERE highlight_id=?").all(id),
        athleteOf: (row) => (row && row.athlete_id ? sdb.prepare("SELECT * FROM athletes WHERE athlete_key=?").get(row.athlete_id) : null),
      };
      data.close = () => sdb.close();
      return data;
    };
    const photo54 = (seedByte) => { const b = Buffer.alloc(2048, 7); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[100] = seedByte; return b; };
    const upload54 = async (seedByte, title, name, extra = {}) => {
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      if (extra.email) fd.append("notifyEmail", extra.email);
      if (extra.contest) fd.append("contestOptin", "on");
      fd.append("file", new Blob([photo54(seedByte)], { type: "image/png" }), "clip.png");
      return j54("/api/highlights", { method: "POST", body: fd });
    };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base54 + "/api/health"); break; } catch { await wait(200); } }
      const claim54 = await j54("/api/owner/claim", { method: "POST" });
      const otok54 = claim54.body.token; assert(otok54, "r146 seed: owner claim returns a token");
      const own54 = { "content-type": "application/json", "x-owner-token": otok54 };
      const approve54 = async (id) => (await j54(`/api/highlights/${id}/status`, { method: "POST", headers: own54, body: JSON.stringify({ status: "approved" }) })).body.status;
      const modLog54 = async () => (await j54("/api/owner/moderation-log", { headers: { "x-owner-token": otok54 } })).body.entries || [];
      const logHas54 = async (action, playId, actor) => (await modLog54()).some((e) => e.action === action && e.play_id === playId && e.actor === actor);

      // Seed: A (contest-entered, 2 votes), B and C approved.
      const aId54 = (await upload54(21, "Trash Hero Play", "Trash Kid", { email: "trash@example.com", contest: true })).body.id;
      const bId54 = (await upload54(22, "Battle Buddy One", "Buddy One")).body.id;
      const cId54 = (await upload54(23, "Battle Buddy Two", "Buddy Two")).body.id;
      assert(aId54 && bId54 && cId54, "r146 seed: three uploads land");
      assert((await approve54(aId54)) === "approved" && (await approve54(bId54)) === "approved" && (await approve54(cId54)) === "approved", "r146 seed: all three plays approved");
      await j54(`/api/highlights/${aId54}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "r146-voter-1" }) });
      await j54(`/api/highlights/${aId54}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "r146-voter-2" }) });
      const queue54 = (await j54("/api/owner/queue", { headers: { "x-owner-token": otok54 } })).body.queue;
      const aRow54 = queue54.find((h) => h.id === aId54);
      const aAthlete54 = aRow54.athlete_id;
      const aFile54 = path.join(tmp54, "uploads", path.basename(aRow54.media_url));
      assert(fs.existsSync(aFile54), "r146 seed: the play's media file is on disk");
      // Pre-trash: visible everywhere public, entered, logged.
      const boardPre54 = await j54("/api/highlights?division=all");
      assert(boardPre54.body.highlights.some((h) => h.id === aId54), "r146 seed: the play is on the board before trashing");
      const contestPre54 = await j54("/api/contest");
      const aEntryPre54 = contestPre54.body.entries.find((e) => e.id === aId54);
      assert(aEntryPre54 && aEntryPre54.voteCount === 2, "r146 seed: the play stands in the contest with its 2 votes");
      const athletePre54 = await j54(`/api/highlights?athlete_id=${encodeURIComponent(aAthlete54)}`);
      assert(athletePre54.body.highlights.some((h) => h.id === aId54), "r146 seed: the play is on its athlete page before trashing");
      assert(await logHas54("approve", aId54, "owner"), "r146 log: the approval was recorded (actor 'owner')");

      // ---- Trash an approved play ----
      const trash54 = await j54(`/api/highlights/${aId54}`, { method: "DELETE", headers: { "x-owner-token": otok54 } });
      assert(trash54.status === 200 && trash54.body.ok && trash54.body.trashed === true, "r146 trash: the owner DELETE now reports a move to Trash");
      const boardPost54 = await j54("/api/highlights?division=all");
      assert(!boardPost54.body.highlights.some((h) => h.id === aId54) && boardPost54.body.highlights.some((h) => h.id === bId54), "r146 trash: the play is OFF the board (its buddies are untouched)");
      const contestPost54 = await j54("/api/contest");
      assert(!contestPost54.body.entries.some((e) => e.id === aId54), "r146 trash: the play is OUT of the contest standings");
      const athletePost54 = await j54(`/api/highlights?athlete_id=${encodeURIComponent(aAthlete54)}`);
      assert(!athletePost54.body.highlights.some((h) => h.id === aId54), "r146 trash: the play is OFF its athlete page");
      const daily54 = await j54("/api/daily-battle");
      assert(daily54.body.available === true && [daily54.body.a.id, daily54.body.b.id].sort().join(",") === [bId54, cId54].sort().join(","), "r146 trash: the Daily Battle pool pairs the two remaining approved plays — the trashed play cannot be picked");
      let s54 = await snap54();
      const trashedRow54 = s54.row(aId54);
      assert(trashedRow54 && trashedRow54.status === "trashed" && trashedRow54.status_before_trash === "approved" && !!trashedRow54.trashed_at, "r146 trash: the row is kept — status 'trashed', pre-trash status + timestamp recorded");
      assert(s54.votes(aId54).length === 2, "r146 trash: the play's votes are KEPT (a restore brings it back whole)");
      assert(s54.entries(aId54).length === 0, "r146 trash: the contest entry is REMOVED");
      s54.close();
      assert(fs.existsSync(aFile54), "r146 trash: the media file is KEPT on disk");
      const queueTrashed54 = (await j54("/api/owner/queue", { headers: { "x-owner-token": otok54 } })).body.queue.find((h) => h.id === aId54);
      assert(queueTrashed54 && queueTrashed54.status === "trashed" && queueTrashed54.trash_days_left === 7 && queueTrashed54.status_before_trash === "approved", "r146 trash: the owner queue carries the Trash fields (trashed_at, restores-to, 7 days left)");
      assert(await logHas54("trash", aId54, "owner"), "r146 log: the trash was recorded (actor 'owner')");

      // ---- Restore brings it back whole; the entry stays out ----
      const restore54 = await j54(`/api/highlights/${aId54}/restore`, { method: "POST", headers: own54, body: "{}" });
      assert(restore54.status === 200 && restore54.body.status === "approved", "r146 restore: the play returns to its pre-trash status (approved)");
      const boardBack54 = await j54("/api/highlights?division=all");
      const aBack54 = boardBack54.body.highlights.find((h) => h.id === aId54);
      assert(aBack54 && aBack54.voteCount === 2, "r146 restore: the play is back on the board WITH its 2 votes");
      const contestBack54 = await j54("/api/contest");
      assert(!contestBack54.body.entries.some((e) => e.id === aId54), "r146 restore: the contest entry is NOT auto-recreated");
      assert(await logHas54("restore", aId54, "owner"), "r146 log: the restore was recorded");

      // ---- Reject (hide) lands in the log too ----
      await j54(`/api/highlights/${cId54}/status`, { method: "POST", headers: own54, body: JSON.stringify({ status: "hidden" }) });
      assert(await logHas54("reject", cId54, "owner"), "r146 log: a decline (hide) was recorded as 'reject'");
      await j54(`/api/highlights/${cId54}/status`, { method: "POST", headers: own54, body: JSON.stringify({ status: "approved" }) });

      // ---- Guards: purge/restore refuse a play that is not trashed ----
      const purgeLive54 = await j54(`/api/highlights/${bId54}/purge`, { method: "POST", headers: own54, body: "{}" });
      assert(purgeLive54.status === 400, "r146 purge guard: a live play cannot be deleted forever — Trash first (400)");
      const restoreLive54 = await j54(`/api/highlights/${bId54}/restore`, { method: "POST", headers: own54, body: "{}" });
      assert(restoreLive54.status === 400, "r146 restore guard: a play that is not in the Trash cannot be restored (400)");

      // ---- Delete forever: the permanent cascade ----
      await j54(`/api/highlights/${aId54}`, { method: "DELETE", headers: { "x-owner-token": otok54 } });
      const purge54 = await j54(`/api/highlights/${aId54}/purge`, { method: "POST", headers: own54, body: "{}" });
      assert(purge54.status === 200 && purge54.body.ok, "r146 purge: delete-forever succeeds from the Trash");
      s54 = await snap54();
      assert(!s54.row(aId54) && s54.votes(aId54).length === 0 && s54.entries(aId54).length === 0, "r146 purge: the row, its votes and its entries are all gone");
      s54.close();
      assert(!fs.existsSync(aFile54), "r146 purge: the media file is gone from disk");
      assert(await logHas54("purge", aId54, "owner"), "r146 log: the manual purge was recorded");
      const purgeAgain54 = await j54(`/api/highlights/${aId54}/purge`, { method: "POST", headers: own54, body: "{}" });
      assert(purgeAgain54.status === 404, "r146 purge: a purged play is simply not found (404)");
      const restoreGone54 = await j54(`/api/highlights/${aId54}/restore`, { method: "POST", headers: own54, body: "{}" });
      assert(restoreGone54.status === 404, "r146 restore: a purged play cannot come back through Restore (404) — backup restore is the only way back");

      // ---- The backup cleanup keeps its PERMANENT semantics ----
      const dUp54 = await upload54(24, "Cleanup Permanent Play", "Restore Pending Kid");
      const dId54 = dUp54.body.id; assert(dId54, "r146 cleanup seed: a pending play lands");
      let sd54 = await snap54();
      const dRow54 = sd54.row(dId54);
      const dAthlete54 = sd54.athleteOf(dRow54);
      const dFile54 = path.join(tmp54, "uploads", path.basename(dRow54.media_url));
      const dBytes54 = fs.readFileSync(dFile54);
      const dBundle54 = { plays: [dRow54], votes: [], contest_entries: [], athletes: dAthlete54 ? [dAthlete54] : [], files: [{ name: path.basename(dRow54.media_url), size: dBytes54.length }] };
      sd54.close();
      const clean54 = await j54("/api/backup/delete-pending", { method: "POST", headers: { "content-type": "application/json", "x-backup-token": TOK54 }, body: JSON.stringify({ ids: [dId54] }) });
      assert(clean54.status === 200 && JSON.stringify(clean54.body.deleted) === JSON.stringify([dId54]), "r146 cleanup: delete-pending still deletes a pending play outright");
      sd54 = await snap54();
      assert(!sd54.row(dId54) && !fs.existsSync(dFile54), "r146 cleanup: the play's row AND file are gone — no Trash stop on the operator path");
      sd54.close();
      assert(await logHas54("delete-pending", dId54, "backup-tool"), "r146 log: the cleanup delete was recorded (actor 'backup-tool')");

      // ---- …and an R144 restore of it is logged too ----
      const rfd54 = new FormData();
      rfd54.append("bundle", JSON.stringify(dBundle54));
      rfd54.append(path.basename(dRow54.media_url), new Blob([dBytes54]), path.basename(dRow54.media_url));
      const restored54 = await j54("/api/backup/restore-plays", { method: "POST", headers: { "x-backup-token": TOK54 }, body: rfd54 });
      assert(restored54.status === 200 && restored54.body.ok === true, "r146 restore-plays: the backup restore still works");
      assert(await logHas54("restore-plays", dId54, "backup-tool"), "r146 log: the backup restore was recorded (actor 'backup-tool')");

      // ---- Auto-purge: 7+ days in Trash, gone on the next trigger ----
      const eId54 = (await upload54(25, "Stale Trash Play", "Stale Kid")).body.id;
      const eRow54 = (await j54("/api/owner/queue", { headers: { "x-owner-token": otok54 } })).body.queue.find((h) => h.id === eId54);
      const eFile54 = path.join(tmp54, "uploads", path.basename(eRow54.media_url));
      await j54(`/api/highlights/${eId54}`, { method: "DELETE", headers: { "x-owner-token": otok54 } });
      assert(fs.existsSync(eFile54), "r146 auto-purge seed: the freshly trashed play's file is on disk");
      const direct54 = new DatabaseSync(path.join(tmp54, "highlighthype.db"));
      direct54.prepare("UPDATE highlights SET trashed_at = datetime('now','-8 days') WHERE id=?").run(eId54);
      direct54.close();
      await j54("/api/owner/queue", { headers: { "x-owner-token": otok54 } }); // the queue-load trigger
      const se54 = await snap54();
      assert(!se54.row(eId54), "r146 auto-purge: a play trashed 8 days ago is permanently deleted on the queue-load trigger");
      se54.close();
      assert(!fs.existsSync(eFile54), "r146 auto-purge: its media file went with it");
      assert(await logHas54("purge", eId54, "system"), "r146 log: the auto-purge was recorded (actor 'system', distinct from a manual purge)");

      // ---- The log endpoint is owner-only ----
      const noTokLog54 = await fetch(base54 + "/api/owner/moderation-log");
      assert(noTokLog54.status === 403, "r146 log: the moderation log refuses anonymous reads (403)");
    } finally {
      child54.kill();
      fs.rmSync(tmp54, { recursive: true, force: true });
    }
  }

  /* ============ §55 Round 147 — one contest row design; the
     email link's delete joins Trash ============
     (1) The This Month leaderboard renders through
     fameRowHtml134 — the Hall of Fame renderer — while the
     FEATURED card stays on top. The numbers stay honest per
     tab because the payloads differ: /api/contest overrides
     each entry's voteCount with the MONTH count, while
     /api/highlights keeps the all-time count. The seed gives
     play X a split history (5 votes last month + 2 this
     month = 7 all-time) and play Y a clean 3 this month, so
     the Month pill must read X=2 / Y=3 while the Fame pill
     keeps X=7 / Y=3. (2) POST /moderate action=delete is a
     trashPlay146 move: the row parks as 'trashed', its media
     file, votes and Hype Frame order are KEPT, only the
     current-period contest entry is removed, the moderation
     log records 'trash' with the email-link channel in the
     detail — and the owner route restores the play afterwards. */
  {
    // ---- Wiring asserts (no extra server) ----
    assert(!appJs.includes("function lbRowHtml134"), "r147 wiring: lbRowHtml134 is retired — one contest row renderer remains");
    assert(appJs.slice(appJs.indexOf("function renderMonth"), appJs.indexOf("function fameThumbHtml")).includes("fameRowHtml134(h, i)"), "r147 wiring: renderMonth renders the This Month rows through fameRowHtml134");
    assert(serverJs.includes('trashPlay146(before, "owner", "via the email moderation link")') && serverJs.includes("function moderateTrashedPage147") && serverJs.includes("Yes, move to Trash"), "r147 wiring: the /moderate delete branch is the trashPlay146 move, the result page is moderateTrashedPage147, and the queue checkbox speaks Trash");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r147 wiring: asset pins bumped to ?v=146 — →148: now ?v=147 (Round 148) — →149: now ?v=148 (Round 149) — →150: now ?v=149 (Round 150) — →151: now ?v=150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Server behavior ----
    const PORT55 = 3494, base55 = `http://localhost:${PORT55}`;
    const tmp55 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r147-"));
    const TOK55 = "r147-test-backup-token";
    const child55 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT55), DATA_DIR: tmp55, BACKUP_TOKEN: TOK55 }, stdio: "pipe" });
    const j55 = async (p, opts = {}) => { const r = await fetch(base55 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const snap55 = async () => {
      const r = await fetch(base55 + "/api/backup/db", { headers: { "x-backup-token": TOK55 } });
      const snapPath = path.join(tmp55, "snap55.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      const data = {
        row: (id) => sdb.prepare("SELECT * FROM highlights WHERE id=?").get(id),
        votes: (id) => sdb.prepare("SELECT * FROM votes WHERE highlight_id=?").all(id),
        entries: (id) => sdb.prepare("SELECT * FROM contest_entries WHERE highlight_id=?").all(id),
        orders: (id) => sdb.prepare("SELECT * FROM hype_frame_orders WHERE highlight_id=?").all(id),
      };
      data.close = () => sdb.close();
      return data;
    };
    const dbWrite55 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp55, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
    const photo55 = (seedByte) => { const b = Buffer.alloc(2048, 7); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[100] = seedByte; return b; };
    const upload55 = async (seedByte, title, name) => {
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      fd.append("file", new Blob([photo55(seedByte)], { type: "image/png" }), "clip.png");
      return j55("/api/highlights", { method: "POST", body: fd });
    };
    const modPost55 = async (fields) => { const r = await fetch(`${base55}/moderate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(fields).toString() }); return { status: r.status, body: await r.text() }; };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base55 + "/api/health"); break; } catch { await wait(200); } }
      const claim55 = await j55("/api/owner/claim", { method: "POST" });
      const otok55 = claim55.body.token; assert(otok55, "r147 seed: owner claim returns a token");
      const own55 = { "content-type": "application/json", "x-owner-token": otok55 };
      const approve55 = async (id) => (await j55(`/api/highlights/${id}/status`, { method: "POST", headers: own55, body: JSON.stringify({ status: "approved" }) })).body.status;
      const vote55 = async (id, voter) => (await j55(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: voter }) })).status;

      // Seed: X with a split vote history, Y the email-trash victim.
      const xId55 = (await upload55(41, "Month Split Heroics", "Split Kid")).body.id;
      const yId55 = (await upload55(42, "Email Trash Victim", "Victim Kid")).body.id;
      assert(xId55 && yId55, "r147 seed: both uploads land");
      assert((await approve55(xId55)) === "approved" && (await approve55(yId55)) === "approved", "r147 seed: both plays approved");
      assert((await j55("/api/contest/enter", { method: "POST", headers: own55, body: JSON.stringify({ highlightId: xId55 }) })).status === 201, "r147 seed: X entered in the contest");
      assert((await j55("/api/contest/enter", { method: "POST", headers: own55, body: JSON.stringify({ highlightId: yId55 }) })).status === 201, "r147 seed: Y entered in the contest");
      assert((await vote55(xId55, "r147-m1")) === 200 && (await vote55(xId55, "r147-m2")) === 200, "r147 seed: X takes 2 votes this month");
      assert((await vote55(yId55, "r147-m1")) === 200 && (await vote55(yId55, "r147-m2")) === 200 && (await vote55(yId55, "r147-m3")) === 200, "r147 seed: Y takes 3 votes this month");
      const past55 = new Date(); past55.setMonth(past55.getMonth() - 1);
      const pastPeriod55 = past55.toISOString().slice(0, 7);
      dbWrite55((d) => { for (let i = 1; i <= 5; i++) d.prepare("INSERT INTO votes(highlight_id, voter_token, created_at, period) VALUES(?,?,?,?)").run(xId55, `r147-past-${i}`, `${pastPeriod55}-15 12:00:00`, pastPeriod55); });
      const board55 = await j55("/api/highlights?division=all");
      const xBoard55 = board55.body.highlights.find((h) => h.id === xId55);
      assert(xBoard55 && xBoard55.voteCount === 7 && xBoard55.votesMonth === 2, "r147 seed: X reads 7 all-time / 2 this month on the board payload");
      const contest55 = await j55("/api/contest");
      const xEntry55 = contest55.body.entries.find((e) => e.id === xId55);
      const yEntry55 = contest55.body.entries.find((e) => e.id === yId55);
      assert(xEntry55 && xEntry55.voteCount === 2 && yEntry55 && yEntry55.voteCount === 3 && contest55.body.entries[0].id === yId55, "r147 seed: the contest payload carries MONTH counts (X=2, Y=3) and month order (Y leads)");

      // ---- (1) The renders: real payloads through the VM chain ----
      const escCap55 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
      const chain55 = escCap55
        + appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) /* →151: the real Round 151 helpers ride along (feat chip + watches line, fame-row suffix) */
        + appJs.slice(appJs.indexOf("function firstNameOf"), appJs.indexOf("function tileHtml"))
        + appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function renderMine"))
        + appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
      const els55 = {};
      const ctx55 = vm.createContext({
        window: {}, console,
        CONTEST: contest55.body,
        LAST_MONTH: { winnerId: null, entries: [] },
        ALL_PLAYS: board55.body.highlights,
        MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
        monthSport: "all",
        playHasVideo: () => true, durPillHtml: () => "",
        hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
        $: (sel) => (els55[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
        $$: () => [],
      });
      vm.runInContext(chain55, ctx55);
      vm.runInContext("renderMonth()", ctx55);
      const rows55 = els55["#monthRows"].innerHTML;
      const feat55 = els55["#monthFeat"].innerHTML;
      assert(feat55.includes(`data-feat-id="${yId55}"`) && feat55.includes("Currently #1"), "r147 month: the featured clip stays on top — Y, the month leader, holds it");
      assert(rows55.includes('<div class="fame-row top"') && rows55.includes("fame-thumb134") && rows55.includes("fame-play134") && rows55.includes("<img src=\"/uploads/"), "r147 month: the rows wear the Hall of Fame design — poster thumb with the play icon");
      const rowOf55 = (id) => rows55.split('<div class="fame-row').slice(1).find((r) => r.includes(`goToPlayCard(${id})`)) || "";
      assert(rowOf55(yId55).includes('fame-votes-pill134">3 votes<') && rowOf55(xId55).includes('fame-votes-pill134">2 votes<') && !rows55.includes("7 votes"), "r147 month: the pills show the MONTH counts (Y=3, X=2) — X's 7 all-time votes appear nowhere in the Month rows");
      assert(rowOf55(xId55).includes("Split · Month Split Heroics"), "r147 month: rows keep the athlete-led short title");
      vm.runInContext("renderFame()", ctx55);
      const fame55 = els55["#fameList"].innerHTML;
      const fameRowOf55 = (id) => fame55.split('<div class="fame-row').slice(1).find((r) => r.includes(`goToPlayCard(${id})`)) || "";
      assert(fameRowOf55(xId55).includes('fame-votes-pill134">7 votes<') && fameRowOf55(yId55).includes('fame-votes-pill134">3 votes<'), "r147 fame: the Hall of Fame rows are unchanged — all-time counts (X=7, Y=3), same renderer");

      // ---- (2) The email link's delete is a Trash move ----
      const yQueueRow55 = (await j55("/api/owner/queue", { headers: { "x-owner-token": otok55 } })).body.queue.find((h) => h.id === yId55);
      const yFile55 = path.join(tmp55, "uploads", path.basename(yQueueRow55.media_url));
      const printFile55 = path.join(tmp55, "hype-frames", "print-55.png");
      fs.mkdirSync(path.dirname(printFile55), { recursive: true });
      fs.writeFileSync(printFile55, photo55(99));
      dbWrite55((d) => d.prepare("INSERT INTO hype_frame_orders(highlight_id, print_image, guardian_email) VALUES(?,?,?)").run(yId55, "print-55.png", "guardian@example.com"));
      assert(fs.existsSync(yFile55) && fs.existsSync(printFile55), "r147 trash seed: the victim's media file and Hype Frame print file are on disk");
      await fetch(`${base55}/moderate?id=1&token=primer`); // wrong-token primer generates + stores the moderation token (§26/§28 trick)
      const modToken55 = dbWrite55((d) => d.prepare("SELECT value FROM settings WHERE key='moderate_token'").get()?.value);
      assert(!!modToken55, "r147 trash: the stored moderation token is readable");
      const queuePage55 = await (await fetch(`${base55}/moderate-queue?token=${modToken55}`)).text();
      const liveSection55 = queuePage55.slice(queuePage55.indexOf("<h2>Live on the board</h2>"));
      assert(liveSection55.includes("Email Trash Victim") && liveSection55.includes("Yes, move to Trash") && liveSection55.includes(">Move to Trash</button>") && !queuePage55.includes("permanently"), "r147 trash: the emailed queue's Live section arms a 'Move to Trash' — no 'permanently' wording anywhere on the page");
      const del55 = await modPost55({ id: String(yId55), token: modToken55, action: "delete", confirm: "yes" });
      assert(del55.status === 200 && del55.body.includes("Play moved to Trash") && del55.body.includes("Email Trash Victim") && del55.body.includes("within 7 days") && !del55.body.includes("permanently"), "r147 trash: the email delete answers 'Play moved to Trash' with the 7-day restore window — no 'permanently' wording");
      let s55 = await snap55();
      const yRow55 = s55.row(yId55);
      assert(yRow55 && yRow55.status === "trashed" && yRow55.status_before_trash === "approved" && !!yRow55.trashed_at, "r147 trash: the row is parked — status 'trashed', pre-trash status + stamp recorded");
      assert(s55.votes(yId55).length === 3, "r147 trash: the play's 3 votes are KEPT");
      assert(s55.entries(yId55).length === 0, "r147 trash: the current-period contest entry is REMOVED");
      assert(s55.orders(yId55).length === 1, "r147 trash: the Hype Frame order is KEPT");
      s55.close();
      assert(fs.existsSync(yFile55) && fs.existsSync(printFile55), "r147 trash: the media file and the print image are KEPT on disk");
      const boardAfter55 = await j55("/api/highlights?division=all");
      assert(!boardAfter55.body.highlights.some((h) => h.id === yId55), "r147 trash: the play is OFF the board");
      const contestAfter55 = await j55("/api/contest");
      assert(!contestAfter55.body.entries.some((e) => e.id === yId55) && contestAfter55.body.entries.some((e) => e.id === xId55), "r147 trash: the play is OUT of the contest; X still stands");
      const log55 = (await j55("/api/owner/moderation-log", { headers: { "x-owner-token": otok55 } })).body.entries || [];
      const yTrash55 = log55.find((e) => e.play_id === yId55 && e.action === "trash");
      assert(yTrash55 && yTrash55.actor === "owner" && (yTrash55.detail || "").includes("email moderation link"), "r147 log: the email delete is recorded as 'trash' (actor 'owner') with the email-link channel in the detail");
      assert(!log55.some((e) => e.play_id === yId55 && e.action === "purge"), "r147 log: NO 'purge' entry for the play — the email delete is not a purge anymore");
      // And back: the owner route restores what the email link trashed.
      const restore55 = await j55(`/api/highlights/${yId55}/restore`, { method: "POST", headers: own55, body: "{}" });
      assert(restore55.status === 200 && restore55.body.status === "approved", "r147 restore: the owner route restores the email-trashed play to approved");
      const boardBack55 = await j55("/api/highlights?division=all");
      const yBack55 = boardBack55.body.highlights.find((h) => h.id === yId55);
      assert(yBack55 && yBack55.voteCount === 3, "r147 restore: the play is back on the board WITH its 3 votes");
    } finally {
      child55.kill();
      fs.rmSync(tmp55, { recursive: true, force: true });
    }
  }

  /* ============ §56 Round 148 — the QA-fix batch ============
     (1) /my-highlights rendered as bare board chrome over a
     black void (the desktop inspection, 2026-11-13): boot()
     routes the page-sub paths through showPanel, showPanel
     calls hidePlayDetail, hidePlayDetail calls
     teardownWatchChrome140 — which reads the Round 140
     watch-chrome `let` state. Those declarations sat BELOW
     boot() in app.js, so the read landed in the TDZ, the
     ReferenceError killed boot before the panel toggled or
     loadData ran, and /how-it-works + /stories died of the
     same throw. Round 148 declares the state above
     hidePlayDetail; the order pins below hold the fix, the
     route assert holds the served panel (heading + lookup
     form + results region), and the lookup assert holds the
     empty state behind the form. (2) The studio freeze helper
     gets scoped clearance off the shared .upload-card .small
     -6px pull. (3) The mid-feed strip is the compact
     horizontal band again. (4) The footer tail: the static
     body padding goes, the footer closes at 36px (Round 122's
     html scroll-padding stays). (5) The final CTA headline:
     line-height 1 + the board's scroll-margin. (6) The hero
     poster — it existed (/hero-poster.jpg) but arrived late —
     is preloaded. (7) Up Next thumbs cover-crop portrait
     clips; the blurred .vfill clone is hidden in the rail. */
  {
    // ---- (1) the sub-page boot killer ----
    const bootIdx56 = appJs.indexOf("(function boot()");
    const declOff56 = appJs.indexOf("let watchChromeOff140");
    const declVideo56 = appJs.indexOf("let watchChromeVideo140");
    assert(bootIdx56 > 0 && declOff56 > 0 && declOff56 < bootIdx56 && declVideo56 > 0 && declVideo56 < bootIdx56, "r148 boot: the Round 140 watch-chrome state is declared BEFORE the boot IIFE executes — hidePlayDetail (reached via showPanel during boot on the page-sub routes) can never read it in its TDZ again");
    assert(appJs.indexOf("let watchChromeOff140", declOff56 + 1) === -1 && appJs.indexOf("let watchChromeVideo140", declVideo56 + 1) === -1, "r148 boot: the watch-chrome state is declared exactly once (the Round 140 block keeps the functions, not a second declaration)");
    const mh56 = await text("/my-highlights");
    assert(mh56.includes('id="mine"') && mh56.includes('id="mineFind"') && mh56.includes('id="mineEmail"') && mh56.includes('id="mineFindResults"') && mh56.includes("Every moment"), "r148 route: /my-highlights serves the My Plays panel — its heading, the guardian-email lookup form and the results region");
    const lookup56 = await j("/api/athletes/lookup?email=ghost-r148%40example.com");
    assert(lookup56.status === 200 && Array.isArray(lookup56.body.plays) && lookup56.body.plays.length === 0, "r148 route: the lookup behind the form answers an unknown email 200 with an empty plays list (the form's 'No plays found for that email yet' state)");
    assert(appJs.includes("No plays found for that email yet"), "r148 route: the form's empty-state copy is in the client");

    // ---- (2)-(7) the Round 148 CSS block + hero preload ----
    const css148 = css.slice(css.indexOf("Round 148 (2026-11-13, QA-fix batch"));
    assert(css148.length > 200, "r148 css: the Round 148 block is present in styles.css");
    assert(css148.includes("#hfStudio .hf-frozen + p.small{margin-top:12px}"), "r148 studio: the freeze helper gets 12px clearance below the Freeze row (off the shared -6px pull)");
    assert(css148.includes(".hf-strip126{flex-direction:row") && css148.includes(".hf-strip-film126{flex:0 0 40%"), "r148 strip: the mid-feed Hype Frame strip is the compact horizontal band — copy at the right, film thumb at 40% on the left (the Round 129 full-width stack is overridden)");
    assert(appJs.includes("hf-strip-tag126") && appJs.includes("onclick=\"openHfChoice()\""), "r148 strip: the band keeps the HYPE FRAME tag and the Create button's openHfChoice destination");
    assert(css148.includes("body{padding-bottom:0}") && css148.includes("footer{padding-bottom:36px}") && css.includes("html{scroll-padding-bottom:calc(96px"), "r148 footer: the static body tail padding is gone and the footer closes at 36px — Round 122's html scroll-padding (the programmatic-scroll pill clearance) stays");
    assert(css148.includes(".final{scroll-margin-top:76px}") && css148.includes(".final h2{line-height:1}"), "r148 cta: the final headline gets line-height 1 and the board's scroll-margin, so its italic ink never rides at the sticky header's edge");
    assert(home.includes('<link rel="preload" as="image" href="/hero-poster.jpg" fetchpriority="high">') && home.includes('poster="/hero-poster.jpg"'), "r148 hero: the hero video's poster (the brand still) is preloaded at high priority and still on the element — first paint has the still, autoplay/mute untouched");
    assert(css148.includes("#playDetailBody .upnext-thumb.is-vertical > video:not(.vfill){position:absolute;inset:0;width:100%;height:100%;object-fit:cover}") && css148.includes("#playDetailBody .upnext-thumb .vfill{display:none}"), "r148 upnext: portrait clips cover-crop the 16:9 Up Next thumb and the blurred clone is hidden in the rail");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r148 wiring: asset pins bumped to ?v=147 — →149: now ?v=148 (Round 149) — →150: now ?v=149 (Round 150) — →151: now ?v=150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");
  }

  /* ============ §57 Round 149 — the Owner panel storage meter ====
     GET /api/owner/storage is owner-only (403 anonymous, 403 on a
     wrong token) and reports: the DATA_DIR mount (statfs total /
     free / used / usedPct), the uploads tree total, the sqlite
     file size, the hype-frames tree total, the pending queue's
     count + bytes, and the biggest media files (up to 8, size
     desc). Sizes come from the FILESYSTEM (media_url → uploads
     path), never a DB column. The seed writes files of exact
     sizes plus rows referencing them, so every figure is
     asserted exactly — including a stray unreferenced poster
     that counts toward the tree total but not the biggest list,
     and a linked play that counts toward neither. */
  {
    // ---- Wiring asserts (no extra server) ----
    assert(serverJs.includes('p === "/api/owner/storage"') && serverJs.includes("fs.statfsSync(DATA_DIR)"), "r149 wiring: the storage endpoint reads the DATA_DIR mount via statfs behind the owner check");
    assert(appJs.includes('api("/api/owner/storage")') && appJs.includes("function storageHtml149") && appJs.includes('so.usedPct >= 90 ? " crit149" : so.usedPct >= 75 ? " warn149"'), "r149 wiring: loadOwner fetches the endpoint and storageHtml149 renders the meter — red at >=90%, gold at >=75%");
    assert(appJs.includes("Storage unavailable right now"), "r149 wiring: a failed storage fetch degrades to the 'Storage unavailable right now' note in the block");
    assert(home.includes('id="ownerStorage149"'), "r149 wiring: the storage block div sits in the Site stats section");
    assert(css.includes(".storage-bar149") && css.includes(".storage-fill149.warn149") && css.includes(".storage-fill149.crit149"), "r149 wiring: the meter styles ship (bar, gold warn fill, red crit fill)");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r149 wiring: asset pins bumped to ?v=148 — →150: now ?v=149 (Round 150) — →151: now ?v=150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Server behavior ----
    const PORT57 = 3495, base57 = `http://localhost:${PORT57}`;
    const tmp57 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r149-"));
    const child57 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT57), DATA_DIR: tmp57 }, stdio: "pipe" });
    const j57 = async (p, opts = {}) => { const r = await fetch(base57 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const dbWrite57 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp57, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base57 + "/api/health"); break; } catch { await wait(200); } }
      const anon57 = await j57("/api/owner/storage");
      assert(anon57.status === 403, "r149 auth: the storage endpoint 403s anonymously");
      const claim57 = await j57("/api/owner/claim", { method: "POST" });
      const otok57 = claim57.body.token; assert(otok57, "r149 seed: owner claim returns a token");
      const wrong57 = await j57("/api/owner/storage", { headers: { "x-owner-token": "not-the-token" } });
      assert(wrong57.status === 403, "r149 auth: a wrong owner token 403s too");

      // Seed: files of exact sizes, then rows that reference them.
      const upDir57 = path.join(tmp57, "uploads"), hfDir57 = path.join(tmp57, "hype-frames");
      fs.mkdirSync(upDir57, { recursive: true }); fs.mkdirSync(hfDir57, { recursive: true });
      const put57 = (dir, name, size) => fs.writeFileSync(path.join(dir, name), Buffer.alloc(size, 3));
      put57(upDir57, "big-a.mp4", 5000); put57(upDir57, "pend-d.mp4", 4000); put57(upDir57, "mid-b.mp4", 3000);
      put57(upDir57, "pend-e.mp4", 1500); put57(upDir57, "small-c.mp4", 1000); put57(upDir57, "poster-stray.jpg", 222);
      put57(hfDir57, "print-x.png", 777);
      const ins57 = (title, name, status, kind, url) => dbWrite57((d) => Number(d.prepare("INSERT INTO highlights(title, sport, player_name, media_kind, media_url, status) VALUES(?,?,?,?,?,?)").run(title, "baseball", name, kind, url, status).lastInsertRowid));
      const idA57 = ins57("Big Game Winner", "Alpha", "approved", "file", "/uploads/big-a.mp4");
      ins57("Pending Giant", "Delta", "pending", "file", "/uploads/pend-d.mp4");
      ins57("Mid Play", "Beta", "approved", "file", "/uploads/mid-b.mp4");
      ins57("Pending Small", "Epsilon", "pending", "file", "/uploads/pend-e.mp4");
      ins57("Small Play", "Gamma", "approved", "file", "/uploads/small-c.mp4");
      ins57("Linked Clip", "Zeta", "approved", "link_watch", "https://example.com/clip");

      const so57 = await j57("/api/owner/storage", { headers: { "x-owner-token": otok57 } });
      assert(so57.status === 200 && so57.body.ok === true, "r149: the storage endpoint answers 200 for the owner");
      const b57 = so57.body;
      assert(b57.uploadsBytes === 14722, "r149 numbers: uploadsBytes sums the whole uploads tree (14,500 seeded media + the 222-byte stray poster)");
      assert(b57.hypeFramesBytes === 777, "r149 numbers: hypeFramesBytes sums the hype-frames tree");
      assert(b57.pendingCount === 2 && b57.pendingBytes === 5500, "r149 numbers: the pending queue reads 2 plays holding 5,500 bytes");
      assert(Array.isArray(b57.biggest) && b57.biggest.length === 5, "r149 numbers: biggest lists the five file-backed plays — the linked clip is excluded");
      assert(b57.biggest.map((f) => f.bytes).join(",") === "5000,4000,3000,1500,1000", "r149 numbers: biggest is ordered by media file size desc");
      assert(b57.biggest[0].id === idA57 && b57.biggest[0].title === "Big Game Winner" && b57.biggest[0].player_name === "Alpha" && b57.biggest[0].status === "approved" && b57.biggest[1].status === "pending", "r149 numbers: biggest rows carry id, title, athlete and status");
      const dbSize57 = fs.statSync(path.join(tmp57, "highlighthype.db")).size;
      assert(b57.dbBytes === dbSize57 && b57.dbBytes > 0, "r149 numbers: dbBytes is the sqlite file's real size");
      assert(typeof b57.totalBytes === "number" && b57.totalBytes > 0 && typeof b57.freeBytes === "number" && b57.usedBytes === b57.totalBytes - b57.freeBytes, "r149 numbers: the mount figures are coherent (used = total - free)");
      assert(Math.abs(b57.usedPct - (b57.usedBytes / b57.totalBytes) * 100) < 0.11, "r149 numbers: usedPct matches used/total (0.1 rounding)");
    } finally {
      child57.kill();
      fs.rmSync(tmp57, { recursive: true, force: true });
    }
  }

  /* ============ §58 Round 150 — batch actions + swipe review ====
     Phase 5 of the owner-panel program. The queue gains batch
     selection (per-card checkboxes on PENDING cards, a
     duplicate-group checkbox covering exactly the copies its
     Delete-all-copies covers, Select all), a batch bar that runs
     the EXISTING per-play endpoints strictly sequentially with a
     live progress label and one tally line (failures named by
     id, still selected), ONE confirm for a batch trash — and a
     full-screen Review mode: one pending play at a time off a
     snapshot, live data underneath (a play changed elsewhere is
     skipped, never acted on), big preview + pre-review verdict,
     "k of N", Approve/Trash buttons, arrow keys, a pointer
     swipe (90px threshold; right approves, left trashes; short
     drags and pointercancel spring back), and an Undo that
     reverses a TRASH via the restore endpoint while honestly
     refusing an approve (note + disabled). No new endpoints:
     the vm below runs the real client block against a stub api
     and pins the call sequence; the server half then drives
     those same endpoints over HTTP and pins the end state —
     batch-trashed plays sit in the Trash, recoverable. */
  {
    // ---- Wiring asserts ----
    const i150 = appJs.indexOf("Round 150 — swipe review mode + batch actions");
    assert(i150 > -1, "r150 wiring: the Round 150 block exists in app.js");
    const block150 = appJs.slice(appJs.lastIndexOf("/*", i150), appJs.indexOf("/* ---------------- boot / hashes"));
    assert(block150.includes("REVIEW_SWIPE_THRESHOLD150 = 90"), "r150 wiring: the swipe threshold is a named 90px constant");
    assert(block150.includes("window.runBatch150") && block150.includes("runBatch150('approved')") && block150.includes("runBatch150('trash')"), "r150 wiring: the batch bar wires Approve + Move to Trash to the batch runner");
    assert(block150.includes("for (let i = 0; i < ids.length; i++)") && block150.includes("of ${ids.length}…"), "r150 wiring: the batch run is a sequential loop with a live 'k of N…' progress label");
    assert(block150.includes("api(`/api/highlights/${ids[i]}/status`") && block150.includes("api(`/api/highlights/${ids[i]}`, { method: \"DELETE\" })"), "r150 wiring: batch approve + trash reuse the EXISTING per-play endpoints (status POST, owner DELETE) — no new server route");
    assert(block150.includes("moved to Trash") && block150.includes("failed: ${failed.map((id) => \"#\" + id)"), "r150 wiring: the tally line reports the count and names failures by play id");
    assert(block150.includes("confirm(`Move ${ids.length} selected play") && block150.includes("to Trash? They leave the board right away"), "r150 wiring: a batch trash takes ONE confirm for the whole batch");
    assert(block150.includes("api(`/api/highlights/${last.id}/restore`") && block150.includes('last.action === "trash"'), "r150 wiring: Undo calls the restore endpoint and arms ONLY after a trash");
    assert(block150.includes("Approved — to undo, trash it from Live plays in the panel."), "r150 wiring: after an approve the note says where the undo lives — no fake un-approve");
    assert(block150.includes('e.key === "ArrowRight"') && block150.includes('e.key === "ArrowLeft"') && block150.includes('e.key === "Escape"'), "r150 wiring: review mode keys — → approves, ← trashes, Esc exits");
    assert(block150.includes('e.type === "pointercancel"'), "r150 wiring: a pointercancel springs back — it never commits a swipe");
    assert(appJs.includes("queueHead150(viewRows157)") && appJs.includes("pruneBatchSel150(q.queue)"), "r150 wiring: loadOwner renders the queue head (Select all + Review mode + batch bar) and prunes the selection on every load — →157: the head now renders inside renderOwnerQueue157 with the view's rows (in All view viewRows157 IS liveQueue146, so the head is byte-identical there; see §65)");
    assert(appJs.includes('class="qsel-box150"') && appJs.includes('onchange="toggleBatchSel150(') && appJs.includes("data-qsel-group") && appJs.includes('onclick="openReview150()"'), "r150 wiring: pending cards carry a batch checkbox, group headers carry a covers-all-copies checkbox, and the head carries the Review mode button");
    for (const idAttr of ["reviewModal150", "reviewCard150", "reviewMedia150", "reviewMeta150", "reviewProgress150", "reviewApprove150", "reviewTrash150", "reviewUndo150", "reviewDone150", "reviewTint150"]) assert(home.includes(`id="${idAttr}"`), `r150 wiring: the review overlay markup carries #${idAttr}`);
    assert(home.includes("All caught up"), "r150 wiring: the review overlay carries the 'All caught up' empty state");
    assert(css.includes(".review150") && css.includes(".batch-bar150") && css.includes(".queue-head150") && css.includes(".review-tint150") && css.includes(".qsel150"), "r150 wiring: the batch + review styles ship");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r150 wiring: asset pins bumped to ?v=149 — →151: now ?v=150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Client behavior: the real block in a vm ----
    const escCap150 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
    const els150 = {};
    const mkEl150 = () => ({
      innerHTML: "", textContent: "", hidden: false, disabled: false, checked: false, indeterminate: false,
      style: {}, dataset: {}, listeners: {},
      classList: { _s: new Set(), toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      addEventListener(t, fn) { this.listeners[t] = fn; },
      removeEventListener(t) { delete this.listeners[t]; },
      setPointerCapture() {},
    });
    const $150 = (sel) => (els150[sel] ||= mkEl150());
    const mkRow150 = (id) => ({ id, title: "Play " + id, sport: "baseball", division: "boys", status: "pending", player_name: "Kid " + id, athlete_label: "Kid " + id, athlete_tag: "", team: "", media_kind: "file", media_url: "/uploads/vm" + id + ".mp4", poster_url: "", embed_url: "", host_label: "", created_at: "2026-11-13T10:00:00.000Z", review: null, ai: null, isSample: false, voteCount: 0 });
    const queueRows150 = [11, 12, 13, 14].map(mkRow150);
    const calls150 = [];
    let failIds150 = new Set();
    let confirmAnswer150 = true;
    let loadOwnerCalls150 = 0;
    const api150 = async (p, opts = {}) => {
      calls150.push({ p, method: opts.method || "GET", body: opts.body || "" });
      if (p === "/api/owner/queue") return { queue: queueRows150 };
      const m = p.match(/^\/api\/highlights\/(\d+)(\/status|\/restore)?$/);
      if (m) {
        const id = Number(m[1]);
        if (failIds150.has(id)) throw new Error("boom " + id);
        const row = queueRows150.find((h) => h.id === id);
        if (row && m[2] === "/status") row.status = JSON.parse(opts.body).status;
        else if (row && m[2] === "/restore") row.status = "pending";
        else if (row) row.status = "trashed";
        return { ok: true };
      }
      return { ok: true };
    };
    const ctx150 = vm.createContext({
      window: {}, console, api: api150, ownerQueue145: queueRows150,
      loadOwner: async () => { loadOwnerCalls150++; }, loadData: () => {},
      confirm: () => confirmAnswer150, alert: () => {},
      $: $150,
      document: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    });
    vm.runInContext(escCap150 + block150, ctx150);
    // The block publishes its handlers on window (in the browser
    // that IS the global); mirror them onto the vm global so bare
    // calls — the tests', and the block's own cross-calls like
    // the swipe committing via reviewAct150 — resolve here too.
    for (const k of Object.keys(ctx150.window)) ctx150[k] = ctx150.window[k];
    const run150 = (code) => vm.runInContext(code, ctx150);

    const head150 = run150("queueHead150(ownerQueue145)");
    assert(head150.includes("Select all pending (4)") && head150.includes('onclick="openReview150()"') && head150.includes('id="batchBar150"'), "r150 head: Select all with the pending count, the Review mode button and the batch bar mount");
    assert(run150("batchBarHtml150()") === "", "r150 batch: no selection, no batch bar");
    run150("toggleBatchSel150(11, true); toggleBatchSel150(12, true);");
    const bar150 = run150("batchBarHtml150()");
    assert(bar150.includes("2 selected") && bar150.includes("Approve 2 selected") && bar150.includes("Move 2 to Trash") && bar150.includes("Clear"), "r150 batch: the bar names the count on both actions plus Clear");
    await run150("runBatch150('approved')");
    const statusCalls150 = calls150.filter((c) => c.p.endsWith("/status"));
    assert(statusCalls150.length === 2 && statusCalls150[0].p === "/api/highlights/11/status" && statusCalls150[1].p === "/api/highlights/12/status", "r150 batch: approve hit the status endpoint once per play, in selection order");
    assert(queueRows150.find((h) => h.id === 11).status === "approved" && queueRows150.find((h) => h.id === 12).status === "approved", "r150 batch: both plays approved");
    assert(run150("batchMsg150") === "2 approved." && run150("batchSel150.size") === 0, "r150 batch: the tally reads '2 approved.' and the selection cleared");
    assert(loadOwnerCalls150 >= 1, "r150 batch: completion refreshed the panel (loadOwner)");
    // A declined batch-trash confirm sends NOTHING.
    run150("toggleBatchSel150(13, true); toggleBatchSel150(14, true);");
    confirmAnswer150 = false;
    const callsBefore150 = calls150.length;
    await run150("runBatch150('trash')");
    assert(calls150.length === callsBefore150 && queueRows150.find((h) => h.id === 13).status === "pending", "r150 batch: declining the one batch confirm sends no requests at all");
    // One failure inside a batch trash: tally names it; it stays selected.
    confirmAnswer150 = true; failIds150 = new Set([14]);
    await run150("runBatch150('trash')");
    const msg150 = run150("batchMsg150");
    assert(msg150.includes("1 moved to Trash") && msg150.includes("#14"), "r150 batch: the tally counts the success and names the failed play (#14)");
    assert(queueRows150.find((h) => h.id === 13).status === "trashed" && run150("batchSel150.has(13)") === false && run150("batchSel150.has(14)") === true, "r150 batch: the trashed play left the selection; the failed one stays for a retry");
    failIds150 = new Set();

    // ---- Review mode, end to end ----
    queueRows150.length = 0; queueRows150.push(mkRow150(21), mkRow150(22), mkRow150(23));
    calls150.length = 0;
    run150("openReview150()");
    assert(els150["#reviewModal150"].hidden === false && els150["#reviewProgress150"].textContent === "1 of 3", "r150 review: opens on the first pending with '1 of 3'");
    assert(els150["#reviewMeta150"].innerHTML.includes("Play 21") && els150["#reviewMedia150"].innerHTML.includes("/uploads/vm21.mp4"), "r150 review: the first play's meta + video render");
    await run150("reviewAct150('approved')");
    assert(queueRows150[0].status === "approved" && els150["#reviewProgress150"].textContent === "2 of 3", "r150 review: approve advances to the next play");
    assert(els150["#reviewNote150"].hidden === false && els150["#reviewNote150"].textContent.includes("Approved — to undo, trash it from Live plays"), "r150 review: after an approve, the honest undo note shows…");
    assert(els150["#reviewUndo150"].disabled === true, "r150 review: …and Undo stays disabled (there is no un-approve)");
    await run150("reviewAct150('trash')");
    assert(queueRows150[1].status === "trashed" && els150["#reviewUndo150"].disabled === false, "r150 review: a trash arms Undo");
    await run150("reviewUndo150()");
    assert(queueRows150[1].status === "pending" && els150["#reviewProgress150"].textContent === "2 of 3", "r150 review: Undo restores the trashed play and steps back to it");
    // The swipe: 50px springs back, 130px commits (threshold 90).
    const card150 = els150["#reviewCard150"];
    assert(typeof card150.listeners.pointerdown === "function" && typeof card150.listeners.pointermove === "function" && typeof card150.listeners.pointerup === "function", "r150 review: the card carries the pointer handlers");
    const ev150 = (x, type) => ({ pointerId: 7, clientX: x, button: 0, type: type || "pointerup", currentTarget: card150, target: card150, preventDefault() {} });
    card150.listeners.pointerdown(ev150(100, "pointerdown"));
    card150.listeners.pointermove(ev150(150, "pointermove"));
    assert(card150.style.transform === "translateX(50px)" && els150["#reviewTint150"].style.opacity !== "0" && els150["#reviewTintGlyph150"].textContent === "✓ APPROVE", "r150 swipe: mid-drag the card follows and the green APPROVE tint names the action");
    card150.listeners.pointerup(ev150(150));
    await wait(30);
    assert(queueRows150[1].status === "pending", "r150 swipe: a 50px drag is under the 90px threshold — springs back, no action");
    card150.listeners.pointerdown(ev150(100, "pointerdown"));
    card150.listeners.pointermove(ev150(230, "pointermove"));
    card150.listeners.pointerup(ev150(230));
    await wait(30);
    assert(queueRows150[1].status === "approved", "r150 swipe: a 130px right drag commits the approve");
    await run150("reviewAct150('trash')");
    assert(queueRows150[2].status === "trashed" && els150["#reviewDone150"].hidden === false && els150["#reviewProgress150"].textContent === "Done", "r150 review: handling the last play lands on the 'All caught up' state");
    run150("closeReview150()");
    assert(els150["#reviewModal150"].hidden === true, "r150 review: Exit closes the overlay");

    // ---- Server behavior: the batch sequence over HTTP ----
    const PORT58 = 3496, base58 = `http://localhost:${PORT58}`;
    const tmp58 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r150-"));
    const TOK58 = "r150-test-backup-token";
    const child58 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT58), DATA_DIR: tmp58, BACKUP_TOKEN: TOK58 }, stdio: "pipe" });
    const j58 = async (p, opts = {}) => { const r = await fetch(base58 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const snap58 = async () => {
      const r = await fetch(base58 + "/api/backup/db", { headers: { "x-backup-token": TOK58 } });
      const snapPath = path.join(tmp58, "snap58.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      return { row: (id) => sdb.prepare("SELECT * FROM highlights WHERE id=?").get(id), close: () => sdb.close() };
    };
    const photo58 = (seedByte) => { const b = Buffer.alloc(2048, 7); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[100] = seedByte; return b; };
    const upload58 = async (seedByte, title, name) => {
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      fd.append("file", new Blob([photo58(seedByte)], { type: "image/png" }), "clip.png");
      return j58("/api/highlights", { method: "POST", body: fd });
    };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base58 + "/api/health"); break; } catch { await wait(200); } }
      const claim58 = await j58("/api/owner/claim", { method: "POST" });
      const otok58 = claim58.body.token; assert(otok58, "r150 seed: owner claim returns a token");
      const own58 = { "content-type": "application/json", "x-owner-token": otok58 };
      const ids58 = [];
      for (const [seed, title, name] of [[31, "Batch Approve One", "Batch Kid A"], [32, "Batch Approve Two", "Batch Kid B"], [33, "Batch Trash One", "Batch Kid C"], [34, "Batch Trash Two", "Batch Kid D"]]) {
        const up = await upload58(seed, title, name);
        assert(up.body.id && up.body.status === "pending", `r150 seed: '${title}' lands pending`);
        ids58.push(up.body.id);
      }
      const queue58 = async () => (await j58("/api/owner/queue", { headers: { "x-owner-token": otok58 } })).body.queue;
      const files58 = {};
      for (const h of await queue58()) if (ids58.includes(h.id)) files58[h.id] = path.join(tmp58, "uploads", path.basename(h.media_url));
      // The batch path, exactly as the client runs it: approve the
      // first pair via the status endpoint, trash the second pair
      // via the owner DELETE — sequentially, one at a time.
      for (const id of [ids58[0], ids58[1]]) {
        const r = await j58(`/api/highlights/${id}/status`, { method: "POST", headers: own58, body: JSON.stringify({ status: "approved" }) });
        assert(r.status === 200 && r.body.status === "approved", `r150 server: batch approve of #${id} lands`);
      }
      for (const id of [ids58[2], ids58[3]]) {
        const r = await j58(`/api/highlights/${id}`, { method: "DELETE", headers: { "x-owner-token": otok58 } });
        assert(r.status === 200 && r.body.trashed === true, `r150 server: batch trash of #${id} reports a Trash move`);
      }
      const after58 = await queue58();
      const st58 = (id) => (after58.find((h) => h.id === id) || {}).status;
      assert(st58(ids58[0]) === "approved" && st58(ids58[1]) === "approved" && st58(ids58[2]) === "trashed" && st58(ids58[3]) === "trashed", "r150 server: the queue shows the batch outcome — 2 approved, 2 in the Trash");
      let s58 = await snap58();
      const tRow58 = s58.row(ids58[2]);
      assert(tRow58 && tRow58.status === "trashed" && tRow58.status_before_trash === "pending" && !!tRow58.trashed_at, "r150 server: a batch-trashed play is PARKED, not purged — row kept, pre-trash status + stamp recorded");
      s58.close();
      assert(fs.existsSync(files58[ids58[2]]) && fs.existsSync(files58[ids58[3]]), "r150 server: the batch-trashed plays' media files are KEPT");
      const log58 = (await j58("/api/owner/moderation-log", { headers: { "x-owner-token": otok58 } })).body.entries || [];
      assert(log58.some((e) => e.action === "approve" && e.play_id === ids58[0] && e.actor === "owner") && log58.some((e) => e.action === "approve" && e.play_id === ids58[1] && e.actor === "owner"), "r150 server: the batch approvals are in the moderation log (actor 'owner')");
      assert(log58.some((e) => e.action === "trash" && e.play_id === ids58[2] && e.actor === "owner") && log58.some((e) => e.action === "trash" && e.play_id === ids58[3] && e.actor === "owner"), "r150 server: the batch trashes are in the moderation log (actor 'owner')");
      assert(!log58.some((e) => e.action === "purge" && ids58.includes(e.play_id)), "r150 server: NO purge entries — a batch trash is never a purge");
      // …and the review-mode Undo path restores one of them whole.
      const restore58 = await j58(`/api/highlights/${ids58[2]}/restore`, { method: "POST", headers: own58, body: "{}" });
      assert(restore58.status === 200 && restore58.body.status === "pending", "r150 server: the Undo restore brings a batch-trashed play back to pending");
    } finally {
      child58.kill();
      fs.rmSync(tmp58, { recursive: true, force: true });
    }
  }

  /* ============ §59 Round 151 — watch counts on the videos ====
     Phase 6 of the owner-panel program. publicHighlight carries
     viewCount — the play's all-time play_open sum out of
     stat_events, the counter POST /api/track already keeps (no
     new counting). The two list payloads (GET /api/highlights,
     GET /api/contest) compute it with ONE grouped query
     (playViewCounts151) handed in as a map; single-play call
     sites (Battles, Daily, the owner queue spread) fall back to
     the per-play sum — their `views` field already paid for that
     exact query, so the field costs nothing extra there. The
     seed below drives the REAL track path, then reads the
     counts back off both public payloads. The owner-stats gaps
     (daily CSS bar strip, Battle picks card, Hype Stories
     total) are render-side only: the payload already carried
     every field, which the stats asserts pin. */
  {
    // ---- Wiring asserts ----
    assert(serverJs.includes("function playViewCounts151") && serverJs.includes("kind='play_open' GROUP BY key"), "r151 wiring: ONE grouped play_open query (playViewCounts151) feeds the list payloads");
    assert(serverJs.includes("viewCount: views151") && serverJs.includes("viewsMap151") && serverJs.includes("views: views151"), "r151 wiring: publicHighlight carries viewCount + views from the one computed sum");
    assert(serverJs.includes("publicHighlight(r, voter, viewCounts151)") && serverJs.includes("publicHighlight(r, voter, viewCounts151)"), "r151 wiring: the board + contest handlers pass the grouped map in");
    assert(appJs.includes("function fmtCount151") && appJs.includes("function viewsChip151") && appJs.includes("function watchesText151"), "r151 wiring: the formatter + chip + watches-text helpers ship");
    assert(appJs.includes("${durPillHtml(h)}${viewsChip151(h)}"), "r151 wiring: the tile poster chip rides the tile media next to the duration pill");
    assert(appJs.includes("feat-views151") && appJs.includes("watchesText151(h.viewCount)") && appJs.includes("${viewsChip151(h)}</div>"), "r151 wiring: the featured card gets the poster chip + the watches line");
    assert((appJs.match(/Number\(h\.viewCount\) >= 1/g) || []).length >= 2 && (appJs.match(/Number\(p\.viewCount\) >= 1/g) || []).length >= 2, "r151 wiring: the fame-row suffix + both battle minis gate the count at >= 1 watch");
    assert(appJs.includes('class="watch-views151"') && appJs.includes("fmtCount151(h.viewCount)"), "r151 wiring: the watch view carries the always-shown views line");
    assert(appJs.includes("stats-bars151") && appJs.includes("stats-bar151") && appJs.includes("stats-bars-cap151") && appJs.includes("busiest day:"), "r151 wiring: the owner stats daily series renders as a CSS bar strip with tooltips + a busiest-day caption");
    assert(appJs.includes("Battle picks · all time") && appJs.includes("total watch"), "r151 wiring: the stats cards gain Battle picks and the Hype Stories total line");
    assert(css.includes(".views-chip151") && css.includes(".stats-bar151") && css.includes(".watch-views151") && css.includes(".feat-views151"), "r151 wiring: the Round 151 styles ship");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r151 wiring: asset pins bumped to ?v=150 — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Formatter behavior: the real client block in a vm ----
    const fStart151 = appJs.indexOf("function fmtCount151");
    const fEnd151 = appJs.indexOf("function firstNameOf");
    assert(fStart151 > -1 && fEnd151 > fStart151, "r151 vm: the formatter block is extractable");
    const fns151 = vm.runInContext(appJs.slice(fStart151, fEnd151) + "\n;({ fmtCount151, watchesText151, viewsChip151 });", vm.createContext({}));
    assert(fns151.fmtCount151(0) === "0" && fns151.fmtCount151(999) === "999" && fns151.fmtCount151(1000) === "1k" && fns151.fmtCount151(1204) === "1.2k" && fns151.fmtCount151(2000) === "2k" && fns151.fmtCount151(37) === "37", "r151 formatter: exact under 1,000, compact above (1000→1k, 1204→1.2k, 2000→2k)");
    assert(fns151.viewsChip151({ viewCount: 0 }) === "" && fns151.viewsChip151({ viewCount: 1 }).includes("▶ 1") && fns151.viewsChip151({ viewCount: 1204 }).includes("▶ 1.2k"), "r151 chip: hidden at 0 views, shown from the first watch, compact above 1,000");
    assert(fns151.watchesText151(1) === "1 watch" && fns151.watchesText151(1204) === "1.2k watches", "r151 formatter: the watches line pluralizes + compacts");

    // ---- Server behavior: real track path -> both payloads ----
    const PORT59 = 3497, base59 = `http://localhost:${PORT59}`;
    const tmp59 = fs.mkdtempSync(path.join(root, ".tmp-r151-"));
    const child59 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT59), DATA_DIR: tmp59 }, stdio: "pipe" });
    const j59 = async (p, opts = {}) => { const r = await fetch(base59 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const photo59 = (seedByte) => { const b = Buffer.alloc(2048, 7); b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47; b[100] = seedByte; return b; };
    const upload59 = async (seedByte, title, name) => {
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      fd.append("file", new Blob([photo59(seedByte)], { type: "image/png" }), "clip.png");
      return j59("/api/highlights", { method: "POST", body: fd });
    };
    const track59 = async (kind, key) => j59("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind, key: String(key) }) });
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base59 + "/api/health"); break; } catch { await wait(200); } }
      const anonStats59 = await j59("/api/owner/stats");
      assert(anonStats59.status === 403, "r151 auth: the owner stats endpoint still 403s anonymously");
      const claim59 = await j59("/api/owner/claim", { method: "POST" });
      const otok59 = claim59.body.token; assert(otok59, "r151 seed: owner claim returns a token");
      const own59 = { "content-type": "application/json", "x-owner-token": otok59 };
      const idA59 = (await upload59(41, "Watched Thrice Play", "Viewer Kid A")).body.id;
      const idB59 = (await upload59(42, "Watched Five Play", "Viewer Kid B")).body.id;
      const idC59 = (await upload59(43, "Never Watched Play", "Viewer Kid C")).body.id;
      assert(idA59 && idB59 && idC59, "r151 seed: three uploads land");
      for (const id of [idA59, idB59, idC59]) {
        const ap = await j59(`/api/highlights/${id}/status`, { method: "POST", headers: own59, body: JSON.stringify({ status: "approved" }) });
        assert(ap.body.status === "approved", `r151 seed: play #${id} approved`);
      }
      for (const id of [idA59, idB59]) {
        const en = await j59("/api/contest/enter", { method: "POST", headers: own59, body: JSON.stringify({ highlightId: id }) });
        assert(en.status === 201 && en.body.ok === true, `r151 seed: play #${id} entered in the contest`);
      }
      // The REAL track path — the same POST the SPA's openPlayDetail fires.
      for (let i = 0; i < 3; i++) assert((await track59("play_open", idA59)).status === 200, "r151 track: play_open events for A accepted");
      for (let i = 0; i < 5; i++) assert((await track59("play_open", idB59)).status === 200, "r151 track: play_open events for B accepted");
      assert((await track59("view", "home")).status === 200 && (await track59("view", "home")).status === 200, "r151 track: two home views recorded");
      assert((await track59("battle_pick", idB59)).status === 200, "r151 track: a battle pick for B recorded");
      const badTrack59 = await track59("play_open", 999999);
      assert(badTrack59.status === 400, "r151 track: a play_open for a nonexistent play is still refused (400)");

      const board59 = await j59("/api/highlights?division=all");
      const rowA59 = board59.body.highlights.find((h) => h.id === idA59);
      const rowB59 = board59.body.highlights.find((h) => h.id === idB59);
      const rowC59 = board59.body.highlights.find((h) => h.id === idC59);
      assert(rowA59 && rowA59.viewCount === 3 && rowA59.views === 3, "r151 payload: the board carries A's count — viewCount 3 (and views agrees)");
      assert(rowB59 && rowB59.viewCount === 5 && rowB59.views === 5, "r151 payload: the board carries B's count — viewCount 5, per-play correct");
      assert(rowC59 && rowC59.viewCount === 0 && "viewCount" in rowC59, "r151 payload: the never-watched play carries an honest viewCount 0");

      const contest59 = await j59("/api/contest");
      const eA59 = contest59.body.entries.find((e) => e.id === idA59);
      const eB59 = contest59.body.entries.find((e) => e.id === idB59);
      assert(eA59 && eA59.viewCount === 3 && eB59 && eB59.viewCount === 5, "r151 payload: the contest entries carry the same per-play counts (3 and 5)");
      assert(!contest59.body.entries.some((e) => e.id === idC59), "r151 payload: the unentered play is not on the contest board");

      const stats59 = await j59("/api/owner/stats", { headers: { "x-owner-token": otok59 } });
      assert(stats59.status === 200 && stats59.body.ok === true, "r151 stats: the owner reads the stats payload");
      assert(stats59.body.playOpens.total === 8 && stats59.body.playOpens.top[0].id === idB59 && stats59.body.playOpens.top[0].opens === 5, "r151 stats: playOpens totals 8 with B on top at 5 — the same counter the payloads surface");
      assert(stats59.body.battles.total === 1 && stats59.body.views.today === 2 && stats59.body.views.allTime === 2, "r151 stats: the battles total + view counters the new cards render are in the payload");
      assert(Array.isArray(stats59.body.views.daily) && stats59.body.views.daily.length === 30, "r151 stats: the daily series the bar strip renders is the full 30 days");
    } finally {
      child59.kill();
      fs.rmSync(tmp59, { recursive: true, force: true });
    }
  }

  /* ============ §60 Round 152 — named owner passcodes =========
     Phase 7a of the owner-panel program. owner_tokens stores a
     NAME + SHA-256 hash per person; ownerIdentity152 accepts
     the main token exactly as before (env first, else the
     claimed hash) and additionally any ACTIVE named passcode,
     compare timing-safe, stamping last_used_at throttled.
     Panel moderation actions log the passcode's NAME as the
     actor; the main token keeps 'owner'. Mint returns the
     plaintext exactly once; the list leaks neither value nor
     hash; revoke is effective on the next request. Two
     servers: A on the claim flow (no env token), B env-managed
     like production. */
  {
    // ---- Wiring asserts ----
    assert(serverJs.includes("CREATE TABLE IF NOT EXISTS owner_tokens") && serverJs.includes("token_hash TEXT NOT NULL"), "r152 wiring: the owner_tokens table (name + hash only) is created");
    assert(serverJs.includes("function ownerIdentity152") && serverJs.includes("function ownerActor152") && serverJs.includes("crypto.timingSafeEqual"), "r152 wiring: identity-aware auth + the actor helper + timing-safe hash compare ship");
    assert(serverJs.includes('p === "/api/owner/tokens" && req.method === "GET"') && serverJs.includes('p === "/api/owner/tokens" && req.method === "POST"') && serverJs.includes('p === "/api/owner/tokens/revoke" && req.method === "POST"'), "r152 wiring: the list + mint + revoke endpoints ship");
    assert(serverJs.includes('logModeration146(Number(statusMatch[1]), "approve", ownerActor152(req)') && serverJs.includes("trashPlay146(row, ownerActor152(req)") && serverJs.includes('"restore", ownerActor152(req)') && serverJs.includes('"purge", ownerActor152(req)'), "r152 wiring: the panel moderation actions log the request's actor");
    assert(home.includes('id="ownerAccess152"'), "r152 wiring: the Owner access block mounts in the panel");
    assert(appJs.includes("function renderOwnerAccess152") && appJs.includes("window.mintPasscode152") && appJs.includes("window.revokePasscode152") && appJs.includes("shown only once"), "r152 wiring: the block renders, mints and revokes, with the once-only reveal");
    assert(css.includes(".access152-reveal") && css.includes(".access152-code"), "r152 wiring: the Round 152 styles ship");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r152 wiring: asset pins bumped to ?v=151 — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Server behavior ----
    const j60 = async (b, p, opts = {}) => { const r = await fetch(b + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const up60 = async (b, seedByte, title, name) => {
      const buf = Buffer.alloc(2048, 7); buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; buf[100] = seedByte;
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      fd.append("file", new Blob([buf], { type: "image/png" }), "clip.png");
      return j60(b, "/api/highlights", { method: "POST", body: fd });
    };
    const health60 = async (b) => { for (let i = 0; i < 50; i++) { try { await fetch(b + "/api/health"); return; } catch { await wait(200); } } throw new Error("server never came up: " + b); };

    // -- A: claim flow (no env OWNER_TOKEN) --
    const PORT60A = 3498, base60A = `http://localhost:${PORT60A}`;
    const tmp60A = fs.mkdtempSync(path.join(root, ".tmp-r152a-"));
    const env60A = { ...process.env, PORT: String(PORT60A), DATA_DIR: tmp60A }; delete env60A.OWNER_TOKEN;
    const child60A = spawn(process.execPath, ["server.js"], { cwd: root, env: env60A, stdio: "pipe" });
    // -- B: env-managed (production shape) --
    const PORT60B = 3499, base60B = `http://localhost:${PORT60B}`;
    const tmp60B = fs.mkdtempSync(path.join(root, ".tmp-r152b-"));
    const child60B = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT60B), DATA_DIR: tmp60B, OWNER_TOKEN: "env-main-secret-152" }, stdio: "pipe" });
    try {
      await health60(base60A); await health60(base60B);
      const post60 = (b, p, headers, body) => j60(b, p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body || {}) });

      // Anonymous: all three endpoints refuse.
      assert((await j60(base60A, "/api/owner/tokens")).status === 403, "r152 auth: token list 403s anonymously");
      assert((await post60(base60A, "/api/owner/tokens", null, { name: "Sneaky" })).status === 403, "r152 auth: mint 403s anonymously");
      assert((await post60(base60A, "/api/owner/tokens/revoke", null, { id: 1 })).status === 403, "r152 auth: revoke 403s anonymously");

      const claim60 = await j60(base60A, "/api/owner/claim", { method: "POST" });
      const main60 = claim60.body.token; assert(main60, "r152 seed A: owner claim returns the main token");
      const mainH60 = { "x-owner-token": main60 };

      const empty60 = await j60(base60A, "/api/owner/tokens", { headers: mainH60 });
      assert(empty60.status === 200 && Array.isArray(empty60.body.tokens) && empty60.body.tokens.length === 0, "r152 list: starts empty for the main token");

      assert((await post60(base60A, "/api/owner/tokens", mainH60, { name: "   " })).status === 400, "r152 mint: a blank name is refused (400)");
      assert((await post60(base60A, "/api/owner/tokens", mainH60, { name: "N".repeat(41) })).status === 400, "r152 mint: a 41-char name is refused (400)");

      const mint60 = await post60(base60A, "/api/owner/tokens", mainH60, { name: "Dyanna" });
      assert(mint60.status === 200 && mint60.body.ok === true && mint60.body.name === "Dyanna", "r152 mint: Dyanna's passcode is created");
      const dyToken60 = mint60.body.token, dyId60 = mint60.body.id;
      assert(/^hh-[A-Za-z0-9_-]{16}$/.test(dyToken60), "r152 mint: the passcode is returned ONCE, in hh- + 16-char form");
      assert(Number.isInteger(dyId60), "r152 mint: the new passcode's id comes back");

      assert((await post60(base60A, "/api/owner/tokens", mainH60, { name: "dyanna" })).status === 400, "r152 mint: the same name in another case is a duplicate (400)");
      assert((await post60(base60A, "/api/owner/tokens", mainH60, { name: "  Dyanna  " })).status === 400, "r152 mint: the same name padded is a duplicate (400)");

      const list60 = await j60(base60A, "/api/owner/tokens", { headers: mainH60 });
      const entry60 = (list60.body.tokens || []).find((t) => t.id === dyId60);
      assert(entry60 && entry60.name === "Dyanna" && entry60.revoked === false && entry60.last_used_at === null && !!entry60.created_at, "r152 list: Dyanna's row shows metadata — created set, never used, active");
      assert(!("token" in entry60) && !("token_hash" in entry60) && !JSON.stringify(list60.body).includes(dyToken60), "r152 list: neither the passcode value nor any hash field leaks");

      // Named passcode authenticates owner endpoints.
      const dyH60 = { "x-owner-token": dyToken60 };
      assert((await j60(base60A, "/api/owner/queue", { headers: dyH60 })).status === 200, "r152 auth: Dyanna's passcode opens the queue");
      assert((await j60(base60A, "/api/owner/stats", { headers: dyH60 })).status === 200, "r152 auth: Dyanna's passcode opens the stats");
      assert((await j60(base60A, "/api/owner/tokens", { headers: dyH60 })).status === 200, "r152 auth: Dyanna's passcode opens the passcode list (she can manage her own)");
      assert((await j60(base60A, "/api/owner/queue", { headers: { "x-owner-token": "hh-garbagegarbage1" } })).status === 403, "r152 auth: a garbage passcode is refused (403)");

      const listUsed60 = await j60(base60A, "/api/owner/tokens", { headers: mainH60 });
      const entryUsed60 = (listUsed60.body.tokens || []).find((t) => t.id === dyId60);
      assert(entryUsed60 && !!entryUsed60.last_used_at, "r152 last-used: authenticating with the passcode stamps last_used_at");

      // Moderation under the named passcode logs the NAME.
      const play60 = (await up60(base60A, 61, "Named Actor Play", "Actor Kid")).body.id;
      assert(play60, "r152 seed A: a play lands for the actor checks");
      const dyPost60 = (p, body) => post60(base60A, p, dyH60, body);
      assert((await dyPost60(`/api/highlights/${play60}/status`, { status: "approved" })).status === 200, "r152 actor: Dyanna approves the play");
      assert((await j60(base60A, `/api/highlights/${play60}`, { method: "DELETE", headers: dyH60 })).status === 200, "r152 actor: Dyanna trashes the play");
      assert((await dyPost60(`/api/highlights/${play60}/restore`, {})).status === 200, "r152 actor: Dyanna restores the play");
      const log60 = await j60(base60A, "/api/owner/moderation-log", { headers: mainH60 });
      const byDy60 = (action) => (log60.body.entries || []).find((e) => e.play_id === play60 && e.action === action);
      assert(byDy60("approve") && byDy60("approve").actor === "Dyanna", "r152 log: the approval is recorded under the name Dyanna");
      assert(byDy60("trash") && byDy60("trash").actor === "Dyanna", "r152 log: the trash is recorded under the name Dyanna");
      assert(byDy60("restore") && byDy60("restore").actor === "Dyanna", "r152 log: the restore is recorded under the name Dyanna");
      // …while the main token still logs plain 'owner'.
      assert((await post60(base60A, `/api/highlights/${play60}/status`, mainH60, { status: "hidden" })).status === 200, "r152 actor: the main token declines the play");
      const log60b = await j60(base60A, "/api/owner/moderation-log", { headers: mainH60 });
      const rej60 = (log60b.body.entries || []).find((e) => e.play_id === play60 && e.action === "reject");
      assert(rej60 && rej60.actor === "owner", "r152 log: the main token's action still records actor 'owner'");

      // Revoke: unknown id 404s; the real revoke is immediate.
      assert((await post60(base60A, "/api/owner/tokens/revoke", mainH60, { id: 99999 })).status === 404, "r152 revoke: an unknown id 404s");
      const rev60 = await post60(base60A, "/api/owner/tokens/revoke", mainH60, { id: dyId60 });
      assert(rev60.status === 200 && rev60.body.revoked === true && rev60.body.alreadyRevoked === false, "r152 revoke: Dyanna's passcode is revoked");
      assert((await j60(base60A, "/api/owner/queue", { headers: dyH60 })).status === 403, "r152 revoke: the revoked passcode 403s on the very next request");
      assert((await j60(base60A, "/api/owner/queue", { headers: mainH60 })).status === 200, "r152 revoke: the main token is unaffected");
      const revAgain60 = await post60(base60A, "/api/owner/tokens/revoke", mainH60, { id: dyId60 });
      assert(revAgain60.status === 200 && revAgain60.body.alreadyRevoked === true, "r152 revoke: revoking twice is a calm no-op (alreadyRevoked)");
      const remint60 = await post60(base60A, "/api/owner/tokens", mainH60, { name: "Dyanna" });
      assert(remint60.status === 200 && remint60.body.token && remint60.body.token !== dyToken60, "r152 mint: the name is free again after revoke — a FRESH passcode is issued");

      // -- B: env-managed, like production --
      const status60B = await j60(base60B, "/api/owner/status");
      assert(status60B.body.claimed === true && status60B.body.envManaged === true, "r152 B: the env-managed status reads as before");
      assert((await j60(base60B, "/api/owner/claim", { method: "POST" })).status === 409, "r152 B: claim stays closed once the env token manages access");
      assert((await j60(base60B, "/api/owner/tokens")).status === 403, "r152 B: the passcode list 403s anonymously");
      const envH60 = { "x-owner-token": "env-main-secret-152" };
      assert((await j60(base60B, "/api/owner/queue", { headers: envH60 })).status === 200, "r152 B: the env token still opens the queue");
      assert((await j60(base60B, "/api/owner/queue", { headers: { "x-owner-token": "env-main-secret-WRONG" } })).status === 403, "r152 B: a wrong env token is refused");
      const mint60B = await post60(base60B, "/api/owner/tokens", envH60, { name: "Dyanna" });
      assert(mint60B.status === 200 && /^hh-/.test(mint60B.body.token), "r152 B: the env owner mints Dyanna a passcode");
      const dyH60B = { "x-owner-token": mint60B.body.token };
      assert((await j60(base60B, "/api/owner/queue", { headers: dyH60B })).status === 200, "r152 B: Dyanna's passcode works alongside the env token (production shape)");
      assert((await post60(base60B, "/api/owner/tokens/revoke", envH60, { id: mint60B.body.id })).status === 200, "r152 B: the env owner revokes it");
      assert((await j60(base60B, "/api/owner/queue", { headers: dyH60B })).status === 403, "r152 B: the revoked passcode 403s immediately");
      assert((await j60(base60B, "/api/owner/queue", { headers: envH60 })).status === 200, "r152 B: the env token still works after the revoke");
    } finally {
      child60A.kill(); child60B.kill();
      fs.rmSync(tmp60A, { recursive: true, force: true });
      fs.rmSync(tmp60B, { recursive: true, force: true });
    }
  }

  /* ============ §61 Round 153 — the HYBRID board card =========
     Emil reviewed the YouTube-grammar mock against the live
     board and picked the blend: the stage is untouched; the
     body gains (1) an avatar disc + the FULL athlete name,
     (2) ONE meta line "Name · Sport · ▶ views · N votes" whose
     counts can never truncate (only the name segment may
     ellipsis), and (3) the Vote button as a solid lime pill.
     Division and time-ago leave the card. Client-only:
     player_name already rides the public payload
     (publicHighlight), so the full name needs no server
     change — athlete_label ("First L.") is only the fallback. */
  {
    const css61 = fs.readFileSync(path.join(root, "public/styles.css"), "utf8");
    // ---- Wiring pins ----
    assert(appJs.includes("function fullName153") && appJs.includes("function avatarDisc153") && appJs.includes("function avatarInitials153") && appJs.includes("function avatarHue153"), "r153 wiring: the hybrid name/avatar helpers exist");
    assert(appJs.includes('class="tile-head153"') && appJs.includes("avatarDisc153(h)") && appJs.includes('class="meta-name153"') && appJs.includes('class="meta-rest153"') && appJs.includes("vote-pill153"), "r153 wiring: tileHtml renders the head row (avatar + title block), the segmented meta line, and the lime vote pill class");
    const tileBody153 = appJs.slice(appJs.indexOf("function tileHtml"), appJs.indexOf("/* Vote hardening"));
    assert(tileBody153.includes("badgesHtml100(h)") && tileBody153.includes("crownsHtml105(h)") && tileBody153.includes("durPillHtml(h)") && tileBody153.includes("viewsChip151(h)"), "r153 wiring: the stage + badge machinery is untouched inside tileHtml (badges, crowns, duration pill, views chip all still rendered)");
    const info153 = appJs.slice(appJs.indexOf("function tileInfoHtml"), appJs.indexOf("function tileHtml"));
    assert(!info153.includes("humanAge(") && !info153.includes("h.division") && !info153.includes('|| "all-time"'), "r153 wiring: the card meta no longer renders division, age, or 'all-time' wording (code-level: no humanAge call, no division read, no all-time fallback)");
    assert(css61.includes(".tile-head153{") && css61.includes(".tile-avatar153{") && css61.includes(".meta-name153{min-width:0;overflow:hidden;text-overflow:ellipsis") && css61.includes(".meta-rest153{flex:0 0 auto") && css61.includes(".vote-pill153") && css61.includes("background:var(--volt)"), "r153 wiring: styles.css carries the head row, the avatar disc, the name-only ellipsis (rest segment flex-fixed), and the volt lime pill");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r153 wiring: asset pins bumped to ?v=152 — →154: now ?v=153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Behavior: the real render chain in a vm ----
    const escCap153 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
    const chain153 = escCap153 +
      appJs.slice(appJs.indexOf("function fmtCount151"), appJs.indexOf("function firstNameOf")) +
      appJs.slice(appJs.indexOf("function durPillHtml"), appJs.indexOf("function fillDurPill")) +
      appJs.slice(appJs.indexOf("function tileInfoHtml"), appJs.indexOf("function tileHtml")) +
      appJs.slice(appJs.indexOf("function tileHtml"), appJs.indexOf("/* Vote hardening")) +
      appJs.slice(appJs.indexOf("function medalSvg"), appJs.indexOf("function renderFame")) +
      appJs.slice(appJs.indexOf("function posterAttr123"), appJs.indexOf("function upgradeSurfacePosters123"));
    const hA153 = { id: 901, title: "Hybrid Hero", sport: "softball", division: "girls", player_name: "Maya Chen", athlete_label: "Maya C.", media_kind: "file", media_url: "/uploads/m153.mp4", mime: "video/mp4", poster_url: "/uploads/poster-901.jpg", voteCount: 5, viewCount: 37, hasVoted: false, isSample: false, isWinner: false, created_at: "2026-11-13T10:00:00.000Z" };
    const hLong153 = { id: 902, title: "Marathon Match", sport: "martialarts", division: "girls", player_name: "Alexandria Featherstonehaugh", athlete_label: "Alexandria F.", media_kind: "file", media_url: "/uploads/l153.mp4", mime: "video/mp4", poster_url: "/uploads/poster-902.jpg", voteCount: 12, viewCount: 1204, hasVoted: true, isSample: false, isWinner: false, created_at: "2026-11-13T10:00:00.000Z" };
    const hSample153 = { id: 903, title: "Sample Star", sport: "soccer", division: "boys", player_name: "Sam Sample", athlete_label: "Sam S.", media_kind: "file", media_url: "/uploads/s153.mp4", mime: "video/mp4", poster_url: "", voteCount: 2, viewCount: 0, hasVoted: false, isSample: true, isWinner: false, created_at: "2026-11-13T10:00:00.000Z" };
    const els153 = {};
    const sb153 = {
      window: {}, console, hA153, hLong153, hSample153,
      CONTEST: { period: "2026-11", entries: [], winnerId: null },
      LAST_MONTH: { period: "2026-10", entries: [], winnerId: 0 },
      MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      monthDiv: "boys", monthSport: "all",
      TILE_DURATIONS: new Map(), playHasVideo: () => true, fmtDur: () => "0:10",
      firstNameOf: (h) => (h.player_name || "").split(" ")[0], humanAge: () => "",
      hydrateDurPills: () => {}, btlPosterFor118: (url) => "BANKED:" + url,
      $: (sel) => (els153[sel] ||= { innerHTML: "", textContent: "", style: {}, hidden: false }),
      $$: () => [],
    };
    const ctx153 = vm.createContext(sb153);
    vm.runInContext(chain153, ctx153);
    const r153 = (code) => vm.runInContext(code, ctx153);
    const metaOf153 = (tile) => (tile.match(/<p class="tile-meta tile-info tile-meta153">([\s\S]*?)<\/p>/) || [])[1] || "";

    // Name source: fullest field wins, label is only a fallback.
    assert(r153(`fullName153({ player_name: "Maya Chen", athlete_label: "Maya C." })`) === "Maya Chen", "r153 name: player_name (the fullest name in the payload) wins over the 'First L.' athlete_label");
    assert(r153(`fullName153({ athlete_label: "Maya C." })`) === "Maya C." && r153(`fullName153({})`) === "", "r153 name: athlete_label is the fallback when player_name is absent; empty when neither exists (nothing invented)");
    // Avatar: initials derivation + deterministic hue.
    assert(r153(`avatarInitials153("Maya Chen")`) === "MC" && r153(`avatarInitials153("Nicholas")`) === "N" && r153(`avatarInitials153("")`) === "HH" && r153(`avatarInitials153("mary ann smith")`) === "MS", "r153 avatar: initials are first + last token initials, uppercased; a single name gives one letter; empty falls back to HH");
    const hue153 = r153(`avatarHue153("Maya Chen")`);
    assert(Number.isInteger(hue153) && hue153 >= 0 && hue153 < 360 && r153(`avatarHue153("Maya Chen")`) === hue153, "r153 avatar: the hue is a deterministic 0–359 hash of the name");

    const tA153 = r153("tileHtml(hA153)");
    assert(tA153.includes('class="tile-head153"') && tA153.includes('class="tile-avatar153"') && tA153.includes(`--avh153:${hue153}`) && tA153.includes('aria-hidden="true">MC</span>'), "r153 tile: the head row renders the avatar disc with Maya Chen's initials on her name-hashed hue");
    const metaA153 = metaOf153(tA153);
    assert(metaA153.includes('<span class="meta-name153">Maya Chen</span>') && metaA153.includes(' · Softball · ▶ 37 · <b>5</b> votes'), "r153 meta: ONE line — FULL name · sport · ▶ views (Round 151 count) · N votes");
    assert(!metaA153.includes("Girls") && !metaA153.includes("all-time") && !metaA153.includes("ago"), "r153 meta: no division, no 'all-time', no time-ago on the card");
    assert(tA153.includes('class="vote-chip vote-chip-btn vote-pill153"') && tA153.includes("Vote · <b>5</b>") && !tA153.includes("👑 Vote"), "r153 pill: the Vote button is the lime pill (vote-pill153) with the variant's crown-less label");
    assert(tA153.includes("dur-pill") && tA153.includes('class="views-chip151"') && tA153.includes("▶ 37"), "r153 stage: unchanged — the duration pill and the Round 151 views chip still render on the poster");
    assert(r153("tileHtml(hA153, { rank: 1 })").includes('<span class="ranktag">#1</span>'), "r153 stage: the rank tag still renders when ranked");
    assert(metaOf153(r153("tileHtml(hA153, { monthVotes: 7 })")).includes(' · Softball · ▶ 37 · <b>7</b> votes'), "r153 meta: a threaded month count still shows — labeled plainly 'votes'");

    const tLong153 = r153("tileHtml(hLong153)");
    const metaLong153 = metaOf153(tLong153);
    assert(metaLong153.includes('<span class="meta-name153">Alexandria Featherstonehaugh</span>') && metaLong153.includes(' · Martial Arts · ▶ 1.2k · <b>12</b> votes'), "r153 long name: the FULL name rides the name segment whole (ellipsis is CSS-side only) and the counts stay intact — compact views, full votes");
    assert(tLong153.includes('class="vote-chip vote-chip-btn vote-pill153 voted"') && tLong153.includes("Voted · <b>12</b>"), "r153 pill: the voted state rides the same lime pill");

    const tSample153 = r153("tileHtml(hSample153)");
    assert(tSample153.includes("⭐ SAMPLE PLAY") && tSample153.includes('class="vote-chip"') && tSample153.includes("all-time") && !tSample153.includes("vote-pill153") && !tSample153.includes("toggleVote("), "r153 sample: unchanged — SAMPLE tag + the display-only chip with its 'all-time' wording; samples never get the pill button");
    assert(metaOf153(tSample153).includes(' · Soccer · ▶ 0 · <b>2</b> votes'), "r153 meta: a zero view count still prints in the line (▶ 0) — the line never drops a segment");
  }

  /* ============ §62 Round 154 — the Battles BIG players get
     the adaptive stage (the Round 142 featured treatment).
     Round 113 contained a portrait clip in the big player but
     inside the fixed 16:9 video element — a skinny pillar-
     boxed strip (Emil's phone, 2026-11-13; round approved
     2026-11-14). Now the .btl-player box gains .btl-tall154
     and the video element takes a ~4:5 stage (640px cap,
     contain, Round 113 blur fill behind). Signal order, R142-
     style: the play's SERVER poster (the clip's own frame)
     marks at selection (markBtlStage154, called from
     btlWatch + d100Watch); loadedmetadata confirms or clears
     both ways in syncBtlPlayer113, in lockstep with
     .is-vertical. Landscape keeps 16:9; the minis, the
     mechanics and the Round 143 chrome fade are untouched. */
  {
    // (a) Wiring.
    assert(appJs.includes("function markBtlStage154"), "r154 wiring: the adaptive-stage marker for Battles big players exists");
    const btlWatch154 = appJs.slice(appJs.indexOf("function btlWatch"), appJs.indexOf("function btlNewChallenger"));
    assert(btlWatch154.includes("markBtlStage154(player, p)"), "r154 wiring: Quick Battles marks the stage from its selection (btlWatch)");
    const d100Watch154 = appJs.slice(appJs.indexOf("function d100Watch"), appJs.indexOf("function d100WireMatchup"));
    assert(d100Watch154.includes("markBtlStage154(player, play)"), "r154 wiring: Daily Battle + Battle Run mark the stage from their shared watch (d100Watch)");
    const sync154 = appJs.slice(appJs.indexOf("function syncBtlPlayer113"), appJs.indexOf("function wireBtlPlayer113"));
    assert(sync154.includes('classList.add("is-vertical")') && sync154.includes('classList.add("btl-tall154")') && sync154.includes('classList.remove("btl-tall154")'), "r154 wiring: the metadata sync adds AND removes .btl-tall154 in lockstep with .is-vertical — landscape after portrait sheds the tall stage");
    assert(!appJs.slice(appJs.indexOf("function markBtlStage154"), appJs.indexOf("/* ---------------- Round 118")).includes("controls"), "r154 scope: the stage marker never touches the controls attribute — the Round 143 chrome fade owns it");
    assert(appJs.includes("function wireBtlChrome143") && appJs.includes('["btlPlayer", "dailyPlayer", "runPlayer"].forEach'), "r154 coexistence: the Round 143 chrome fade still wires all three big players");
    // (b) CSS: the tall rule exists, the base 16:9 rule is
    // untouched, and the Round 154 block carries no mini rules.
    assert(css.includes(".btl-player.btl-tall154 > video:not(.vfill){aspect-ratio:4/5;max-height:640px;object-fit:contain}"), "r154 css: a marked Battles stage is ~4:5 with the 640px cap and contain fit — no crop, no squeeze");
    assert(css.includes(".btl-player video{display:block;width:100%;aspect-ratio:16/9;object-fit:cover"), "r154 css: the base big-player rule is unchanged — landscape keeps 16:9 exactly as before");
    const css154 = css.slice(css.indexOf("Round 154"));
    assert(!css154.includes(".btl-mini"), "r154 scope: the Round 154 CSS block touches no battle mini — their posters already render fine");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r154 wiring: asset pins bumped to ?v=153 — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");
    // (c) Behavior: the REAL markBtlStage154 + syncBtlPlayer113
    // against fake players/boxes, incl. the poster race guard.
    const IMG_DIMS154 = { "/uploads/poster-p.jpg": { w: 720, h: 1280 }, "/uploads/poster-l.jpg": { w: 960, h: 444 } };
    class FakeImage154 { set src(u) { const d = IMG_DIMS154[u] || { w: 0, h: 0 }; this.naturalWidth = d.w; this.naturalHeight = d.h; if (FakeImage154.defer) { FakeImage154.pending.push(this); return; } if (this.onload) this.onload(); } }
    FakeImage154.defer = false; FakeImage154.pending = [];
    const mkBox154 = () => {
      const classes = new Set();
      const box = {
        classList: { contains: (c) => classes.has(c), add: (c) => classes.add(c), remove: (c) => classes.delete(c) },
        _classes: classes, _fill: null,
        querySelector(sel) { return sel === "video.vfill" ? box._fill : null; },
        insertBefore(node) { node.remove = () => { if (box._fill === node) box._fill = null; }; box._fill = node; },
      };
      return box;
    };
    const mkPlayer154 = (box, vw, vh) => ({
      videoWidth: vw, videoHeight: vh, dataset: {},
      closest: (sel) => (sel === ".btl-player" ? box : null),
      getAttribute: (a) => (a === "src" ? "/uploads/clip.mp4" : null),
      cloneNode() { return { classList: { add: () => {} }, removeAttribute: () => {}, setAttribute: () => {}, pause: () => {}, dataset: {} }; },
    });
    const chain154 = appJs.slice(appJs.indexOf("function vfillClone113"), appJs.indexOf("function markHostVertical113"))
      + appJs.slice(appJs.indexOf("function syncBtlPlayer113"), appJs.indexOf("function wireBtlPlayer113"))
      + appJs.slice(appJs.indexOf("function markBtlStage154"), appJs.indexOf("/* ---------------- Round 118"));
    const ctx154 = vm.createContext({ window: {}, console, Image: FakeImage154 });
    vm.runInContext(chain154, ctx154);
    const mark154 = (player, play) => vm.runInContext("markBtlStage154", ctx154)(player, play);
    const syncFn154 = (player) => vm.runInContext("syncBtlPlayer113", ctx154)(player);

    const boxA154 = mkBox154(); mark154(mkPlayer154(boxA154, 720, 1280), {});
    assert(boxA154._classes.has("btl-tall154"), "r154 behavior: PORTRAIT metadata (720×1280, christian/Charlotte shape) marks the battle stage tall at selection");
    const boxB154 = mkBox154(); boxB154._classes.add("btl-tall154"); mark154(mkPlayer154(boxB154, 960, 444), {});
    assert(!boxB154._classes.has("btl-tall154"), "r154 behavior: LANDSCAPE metadata (960×444, Juliana shape) clears a stale tall mark — 16:9 as before");
    const boxC154 = mkBox154(); mark154(mkPlayer154(boxC154, 0, 0), { poster_url: "/uploads/poster-p.jpg", media_url: "/uploads/p.mp4" });
    assert(boxC154._classes.has("btl-tall154"), "r154 behavior: a PORTRAIT server poster marks the stage BEFORE metadata lands — no wrong-shape start, no jump");
    const boxD154 = mkBox154(); boxD154._classes.add("btl-tall154"); mark154(mkPlayer154(boxD154, 0, 0), { poster_url: "/uploads/poster-l.jpg", media_url: "/uploads/l.mp4" });
    assert(!boxD154._classes.has("btl-tall154"), "r154 behavior: a LANDSCAPE server poster clears the mark just as authoritatively");
    const boxE154 = mkBox154(); mark154(mkPlayer154(boxE154, 0, 0), { media_url: "/uploads/x.mp4" });
    assert(!boxE154._classes.has("btl-tall154"), "r154 behavior: no poster and no metadata → no mark → today's 16:9 fallback, never a broken stage");
    // The poster race: side A's slow portrait poster must not
    // re-mark the stage after the viewer switched to side B.
    FakeImage154.defer = true;
    const boxF154 = mkBox154(); const plF154 = mkPlayer154(boxF154, 0, 0);
    mark154(plF154, { poster_url: "/uploads/poster-p.jpg", media_url: "/uploads/A.mp4" });
    mark154(plF154, { media_url: "/uploads/B.mp4" }); // switched sides; B has no poster signal
    FakeImage154.pending.forEach((img) => { if (img.onload) img.onload(); });
    FakeImage154.defer = false; FakeImage154.pending = [];
    assert(!boxF154._classes.has("btl-tall154"), "r154 behavior: a stale poster probe for the previous side is ignored (media_url token) — the new side is never re-marked");
    // Mixed matchup: the two sides adapt independently.
    const boxL154 = mkBox154(), boxR154 = mkBox154();
    mark154(mkPlayer154(boxL154, 720, 1280), {}); mark154(mkPlayer154(boxR154, 960, 444), {});
    assert(boxL154._classes.has("btl-tall154") && !boxR154._classes.has("btl-tall154"), "r154 behavior: a mixed-orientation matchup marks each side independently — portrait tall, landscape 16:9");
    // The metadata sync (loadedmetadata path) both ways.
    const boxG154 = mkBox154(); const plG154 = mkPlayer154(boxG154, 720, 1280);
    syncFn154(plG154);
    assert(boxG154._classes.has("is-vertical") && boxG154._classes.has("btl-tall154"), "r154 behavior: syncBtlPlayer113 marks .is-vertical AND .btl-tall154 together for a portrait clip");
    plG154.videoWidth = 960; plG154.videoHeight = 444; syncFn154(plG154);
    assert(!boxG154._classes.has("is-vertical") && !boxG154._classes.has("btl-tall154"), "r154 behavior: the next landscape clip sheds BOTH marks — the sync runs both ways on every clip change");
    // A player outside a .btl-player box is a no-op.
    mark154({ videoWidth: 720, videoHeight: 1280, dataset: {}, closest: () => null }, {});
  }

  /* ============ §63 Round 155 — the trusted-family FAST LANE ==
     Phase 7c of the owner-panel program; Emil decided EMAIL-
     ONLY on 2026-11-14. trusted_guardians stores the SHA-256
     of the normalized guardian email (the uploads' own
     normIdentity -> sha, so matching is hash-to-hash and no
     raw email is stored). ORDER IS A HARD RULE in the upload
     handler: dedupe (Round 145) first, then the Upload Assist
     garbage gate — aiGateBlocksLane155 mirrors the browser
     gate's stop rule from the SANITIZED verdict (a confident
     not_a_play, or the guardian's override of one) and a
     gate-stopped upload is NEVER rescued by the lane — then
     the allowlist match. A match inserts APPROVED with the
     fast_laned_at marker and runs the standard approval
     side-effects (log under fast-lane:<label>, guardian
     email/text, contest auto-entry per opt-in); the panel
     lists/adds/revokes and shows the "awaiting your look"
     strip. One env-managed server, production shape. */
  {
    // ---- Wiring asserts ----
    assert(serverJs.includes("CREATE TABLE IF NOT EXISTS trusted_guardians") && serverJs.includes("idx_trusted_guardians_hash") && serverJs.includes("ADD COLUMN fast_laned_at"), "r155 wiring: the trusted_guardians table (hash-only) + unique hash index + the fast_laned_at marker column ship");
    assert(serverJs.includes("function trustedGuardianFor155") && serverJs.includes("function aiGateBlocksLane155"), "r155 wiring: the lane lookup + the gate mirror helpers exist");
    assert(serverJs.includes('p === "/api/owner/trusted" && req.method === "GET"') && serverJs.includes('p === "/api/owner/trusted" && req.method === "POST"') && serverJs.includes('p === "/api/owner/trusted/revoke" && req.method === "POST"'), "r155 wiring: the list/strip + add + revoke endpoints ship");
    assert(serverJs.includes("fastLaned: !!trusted155") && serverJs.includes("`fast-lane:${trusted155.label}`") && serverJs.includes("autoEnterOnApproval130(laneRow155)") && serverJs.includes("notifyGuardianText(laneRow155"), "r155 wiring: a lane hit answers fastLaned, logs under fast-lane:<label>, and runs the standard approval side-effects (guardian text + contest auto-entry on the inserted row)");
    const createSlice155 = serverJs.slice(serverJs.indexOf("// ---- Create a play"), serverJs.indexOf("// ---- Vote toggle ----"));
    assert(createSlice155.includes("aiGateBlocksLane155(aiJson) ? null : trustedGuardianFor155(guardianHash155)"), "r155 ordering: the gate verdict is consulted BEFORE the allowlist — the lane lookup is the gate's else-branch, never its rescue");
    assert(createSlice155.indexOf("aiGateBlocksLane155") < createSlice155.indexOf("INSERT INTO highlights"), "r155 ordering: the gate + lane decision is computed before the INSERT, so status and marker land in one write");
    assert(createSlice155.includes("sha(normIdentity(notifyEmail155))") && createSlice155.includes("notifyEmail155, guardianHash155"), "r155 parity: the hash the lane matches on is the very value the insert stores as notify_email_hash (one expression)");
    assert(home.includes('id="fastLane155"') && home.includes("⚡ Fast lane"), "r155 wiring: the Fast lane section mounts in the Owner panel");
    assert(appJs.includes("function renderFastLane155") && appJs.includes("window.addTrusted155") && appJs.includes("window.revokeTrusted155") && appJs.includes("Fast-laned — awaiting your look") && appJs.includes("skip the review queue"), "r155 wiring: the panel renders the section (explainer, strip heading, add + revoke actions)");
    assert(appJs.includes('onclick="deletePlay(${p.id})"'), "r155 wiring: the strip's Trash button is the panel's ordinary deletePlay — the same hard-confirm dialog and DELETE endpoint, no new delete path");
    assert(appJs.includes("h.fast_laned_at") && appJs.includes("⚡ Fast lane"), "r155 wiring: queue cards wear the ⚡ Fast lane chip from the owner payload's marker");
    assert(appJs.includes("!j.deduped && !!j.fastLaned") && appJs.includes("fastLaned155"), "r155 wiring: the upload success screen routes a fast-laned answer to its live variant");
    assert(serverJs.includes("fast_laned_at: r.fast_laned_at || \"\""), "r155 wiring: the owner queue payload carries the marker (owner-only)");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r155 wiring: asset pins bumped to ?v=154 — →156: now ?v=155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Server behavior ----
    const { createHash: createHash63 } = await import("node:crypto");
    const sha63 = (s) => createHash63("sha256").update(String(s)).digest("hex");
    const PORT63 = 3500, base63 = `http://localhost:${PORT63}`;
    const TOK63 = "r155-test-backup-token";
    const tmp63 = fs.mkdtempSync(path.join(root, ".tmp-r155-"));
    const child63 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT63), DATA_DIR: tmp63, OWNER_TOKEN: "env-main-secret-155", BACKUP_TOKEN: TOK63 }, stdio: "pipe" });
    const j63 = async (p, opts = {}) => { const r = await fetch(base63 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const ownerH63 = { "x-owner-token": "env-main-secret-155" };
    const post63 = (p, headers, body) => j63(p, { method: "POST", headers: { "content-type": "application/json", ...(headers || {}) }, body: JSON.stringify(body || {}) });
    const snap63 = async () => {
      const r = await fetch(base63 + "/api/backup/db", { headers: { "x-backup-token": TOK63 } });
      const snapPath = path.join(tmp63, "snap63.sqlite");
      fs.writeFileSync(snapPath, Buffer.from(await r.arrayBuffer()));
      const sdb = new DatabaseSync(snapPath, { readOnly: true });
      const data = {
        play: (id) => sdb.prepare("SELECT * FROM highlights WHERE id=?").get(id),
        contestEntry: (id) => sdb.prepare("SELECT * FROM contest_entries WHERE highlight_id=?").get(id),
        logFor: (id) => sdb.prepare("SELECT * FROM moderation_log WHERE play_id=? ORDER BY id").all(id),
        guardianByHash: (h) => sdb.prepare("SELECT * FROM trusted_guardians WHERE email_hash=?").get(h),
      };
      data.close = () => sdb.close();
      return data;
    };
    let seed63 = 40;
    const upload63 = async ({ email, title, name, optin, ai }) => {
      const buf = Buffer.alloc(2048, 7); buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; buf[100] = seed63++;
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      if (email != null) fd.append("notifyEmail", email);
      if (optin != null) fd.append("contestOptin", optin);
      if (ai != null) fd.append("ai", ai);
      fd.append("file", new Blob([buf], { type: "image/png" }), "clip.png");
      return j63("/api/highlights", { method: "POST", body: fd });
    };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base63 + "/api/health"); break; } catch { await wait(200); } }

      // Anonymous: all three endpoints refuse.
      assert((await j63("/api/owner/trusted")).status === 403, "r155 auth: the trusted list 403s anonymously");
      assert((await post63("/api/owner/trusted", null, { email: "a@b.co", label: "Sneaky" })).status === 403, "r155 auth: add 403s anonymously");
      assert((await post63("/api/owner/trusted/revoke", null, { id: 1 })).status === 403, "r155 auth: revoke 403s anonymously");

      // Untrusted upload: pending, exactly as before the lane existed.
      const stranger63 = await upload63({ email: "stranger@example.com", title: "Stranger Play", name: "Stranger Kid", optin: "1" });
      assert(stranger63.status === 201 && stranger63.body.status === "pending" && stranger63.body.fastLaned === false, "r155 lane: an untrusted guardian's upload waits in the queue (pending, fastLaned false)");
      const boardBefore63 = await j63("/api/highlights");
      assert(!(boardBefore63.body.highlights || []).some((h) => h.id === stranger63.body.id), "r155 lane: the untrusted play is NOT on the public board");

      // Add-form validation.
      assert((await post63("/api/owner/trusted", ownerH63, { email: "not-an-email", label: "X" })).status === 400, "r155 add: an implausible email is refused (400)");
      assert((await post63("/api/owner/trusted", ownerH63, { email: "ok@example.com", label: "   " })).status === 400, "r155 add: a blank label is refused (400)");
      assert((await post63("/api/owner/trusted", ownerH63, { email: "ok@example.com", label: "L".repeat(61) })).status === 400, "r155 add: a 61-char label is refused (400)");

      // Add the Millers with a messy spelling — case + padding the
      // upload-side normalization must still meet on one hash.
      const add63 = await post63("/api/owner/trusted", ownerH63, { email: "  Miller.Family@Example.COM ", label: "The Millers — Hawks" });
      assert(add63.status === 200 && add63.body.ok === true && add63.body.reactivated === false, "r155 add: the Millers join the fast lane");
      const millerId63 = add63.body.id;
      assert((await post63("/api/owner/trusted", ownerH63, { email: "miller.family@example.com", label: "Duplicate" })).status === 400, "r155 add: the same email in another case is a duplicate among ACTIVE rows (400)");

      const list63 = await j63("/api/owner/trusted", { headers: ownerH63 });
      const g63 = (list63.body.guardians || []).find((g) => g.id === millerId63);
      assert(g63 && g63.label === "The Millers — Hawks" && g63.revoked === false && g63.last_used_at === null && !!g63.created_at, "r155 list: the Millers show metadata — label, created set, never used, active");
      assert(!("email" in g63) && !("email_hash" in g63) && !JSON.stringify(list63.body).includes("miller.family@example.com") && !JSON.stringify(list63.body).includes(sha63("miller.family@example.com")), "r155 list: neither the email nor its hash ever leaves the server");

      // Trusted upload #1 (clean lowercase spelling, contest opt-in ON):
      // live immediately, with every approval side-effect.
      const lane1 = await upload63({ email: "miller.family@example.com", title: "Lane Play One", name: "Miller Kid", optin: "1" });
      assert(lane1.status === 201 && lane1.body.status === "approved" && lane1.body.fastLaned === true, "r155 lane: a trusted upload inserts APPROVED and answers fastLaned (hash parity: panel-added mixed case == upload lowercase)");
      const lane1Id = lane1.body.id;
      const board63 = await j63("/api/highlights");
      assert((board63.body.highlights || []).some((h) => h.id === lane1Id), "r155 lane: the fast-laned play is LIVE on the public board with no queue action");
      const contest63 = await j63("/api/contest");
      assert((contest63.body.entries || []).some((e) => e.id === lane1Id), "r155 lane: the opted-in fast-laned play is in Hype of the Month (contest auto-entry ran)");
      let db63 = await snap63();
      const laneRow63 = db63.play(lane1Id);
      assert(laneRow63.status === "approved" && !!laneRow63.fast_laned_at, "r155 db: the row is approved with the fast_laned_at marker set");
      assert(!!db63.contestEntry(lane1Id), "r155 db: the contest_entries row exists for the opted-in lane play");
      const laneLog63 = db63.logFor(lane1Id).find((e) => e.action === "approve");
      assert(laneLog63 && laneLog63.actor === "fast-lane:The Millers — Hawks", "r155 db: the moderation log records the approval at insert under actor fast-lane:<label>");
      const millerRow63 = db63.guardianByHash(sha63("miller.family@example.com"));
      assert(millerRow63 && !!millerRow63.last_used_at, "r155 db: the guardian's last_used_at is stamped by the lane upload");
      db63.close();

      // Trusted upload #2 (contest opt-in OFF): live, NOT entered.
      const lane2 = await upload63({ email: "MILLER.FAMILY@EXAMPLE.COM", title: "Lane Play Two", name: "Miller Kid", optin: "0" });
      assert(lane2.status === 201 && lane2.body.status === "approved" && lane2.body.fastLaned === true, "r155 lane: an all-caps upload spelling matches too — live again");
      db63 = await snap63();
      assert(!db63.contestEntry(lane2.body.id), "r155 db: the opt-out lane play has NO contest entry (auto-entry honors the opt-in)");
      db63.close();

      // GATE BEATS LANE: a confident not_a_play verdict from the
      // trusted email does NOT go live — it files for review.
      const gateAi63 = JSON.stringify({ sport: null, division: null, title: "screen grab", story: "", gate: "not_a_play", confidence: 0.95, reason: "screen recording" });
      const gated63 = await upload63({ email: "miller.family@example.com", title: "Gated Play", name: "Miller Kid", optin: "1", ai: gateAi63 });
      assert(gated63.status === 201 && gated63.body.status === "pending" && gated63.body.fastLaned === false, "r155 gate: a gate-REJECTED upload from a trusted email stays pending — the lane never rescues it");
      const boardGate63 = await j63("/api/highlights");
      assert(!(boardGate63.body.highlights || []).some((h) => h.id === gated63.body.id), "r155 gate: the gated play is not on the board");
      // The guardian's OVERRIDE of that verdict promises owner
      // review — the lane doesn't take the promise away either.
      const overrideAi63 = JSON.stringify({ sport: "baseball", division: "boys", title: "override", story: "", gate: "override", confidence: 0.95, reason: "" });
      const overridden63 = await upload63({ email: "miller.family@example.com", title: "Override Play", name: "Miller Kid", optin: "1", ai: overrideAi63 });
      assert(overridden63.status === 201 && overridden63.body.status === "pending" && overridden63.body.fastLaned === false, "r155 gate: an OVERRIDDEN gate verdict also waits for the owner (the override files for review, not for the lane)");
      // A passing verdict from the trusted email lanes normally.
      const passAi63 = JSON.stringify({ sport: "baseball", division: "boys", title: "clean play", story: "", gate: "play", confidence: 0.9, reason: "" });
      const passed63 = await upload63({ email: "miller.family@example.com", title: "Clean Lane Play", name: "Miller Kid", optin: "0", ai: passAi63 });
      assert(passed63.status === 201 && passed63.body.status === "approved" && passed63.body.fastLaned === true, "r155 gate: a passing AI verdict doesn't block the lane");

      // The strip: recent fast-laned plays, still live, labeled;
      // the gated pending play is nowhere in it.
      const strip63 = await j63("/api/owner/trusted", { headers: ownerH63 });
      const recent63 = strip63.body.recent || [];
      assert(recent63.some((p) => p.id === lane1Id && p.label === "The Millers — Hawks" && !!p.fast_laned_at), "r155 strip: the first lane play is listed with its family label");
      assert(recent63.some((p) => p.id === passed63.body.id) && !recent63.some((p) => p.id === gated63.body.id) && !recent63.some((p) => p.id === overridden63.body.id), "r155 strip: lane plays only — gate-stopped uploads never appear");
      assert(recent63.length <= 10, "r155 strip: capped at 10");

      // Queue payload: the marker rides owner-only.
      const queue63 = await j63("/api/owner/queue", { headers: ownerH63 });
      const qLane63 = (queue63.body.queue || []).find((h) => h.id === lane1Id);
      const qGate63 = (queue63.body.queue || []).find((h) => h.id === gated63.body.id);
      assert(qLane63 && !!qLane63.fast_laned_at && qGate63 && qGate63.status === "pending" && !qGate63.fast_laned_at, "r155 queue: the lane play carries its marker; the gated play waits unmarked");

      // Revoke: unknown 404s; the real revoke closes the lane on
      // the VERY NEXT upload; a second revoke is a calm no-op.
      assert((await post63("/api/owner/trusted/revoke", ownerH63, { id: 99999 })).status === 404, "r155 revoke: an unknown id 404s");
      const rev63 = await post63("/api/owner/trusted/revoke", ownerH63, { id: millerId63 });
      assert(rev63.status === 200 && rev63.body.revoked === true && rev63.body.alreadyRevoked === false, "r155 revoke: the Millers come off the lane");
      const afterRevoke63 = await upload63({ email: "miller.family@example.com", title: "After Revoke Play", name: "Miller Kid", optin: "1" });
      assert(afterRevoke63.status === 201 && afterRevoke63.body.status === "pending" && afterRevoke63.body.fastLaned === false, "r155 revoke: the revoked family's next upload waits in the queue again");
      const revAgain63 = await post63("/api/owner/trusted/revoke", ownerH63, { id: millerId63 });
      assert(revAgain63.status === 200 && revAgain63.body.alreadyRevoked === true, "r155 revoke: revoking twice is a calm no-op (alreadyRevoked)");

      // Re-adding a revoked email reactivates the SAME row (fresh
      // label), and the lane works again under it.
      const readd63 = await post63("/api/owner/trusted", ownerH63, { email: "Miller.Family@example.com", label: "The Millers (back)" });
      assert(readd63.status === 200 && readd63.body.reactivated === true && readd63.body.id === millerId63, "r155 re-add: a revoked email reactivates its row in place (same id, no duplicate)");
      const laneBack63 = await upload63({ email: "miller.family@example.com", title: "Lane Again Play", name: "Miller Kid", optin: "0" });
      assert(laneBack63.status === 201 && laneBack63.body.status === "approved" && laneBack63.body.fastLaned === true, "r155 re-add: the reactivated family lanes again");
      db63 = await snap63();
      const laneBackLog63 = db63.logFor(laneBack63.body.id).find((e) => e.action === "approve");
      assert(laneBackLog63 && laneBackLog63.actor === "fast-lane:The Millers (back)", "r155 re-add: the new label is the actor on new lane approvals");
      db63.close();

      // The strip's undo path: the ordinary owner DELETE is a
      // Trash move, and the trashed play leaves the strip.
      assert((await j63(`/api/highlights/${lane1Id}`, { method: "DELETE", headers: ownerH63 })).status === 200, "r155 strip undo: the owner DELETE answers the strip's Trash button");
      const stripAfter63 = await j63("/api/owner/trusted", { headers: ownerH63 });
      assert(!(stripAfter63.body.recent || []).some((p) => p.id === lane1Id), "r155 strip undo: the trashed play leaves the strip (still-live only)");
      db63 = await snap63();
      assert(db63.play(lane1Id).status === "trashed", "r155 strip undo: the play sits in Trash — 7-day restorable, not deleted");
      db63.close();
    } finally {
      child63.kill();
      fs.rmSync(tmp63, { recursive: true, force: true });
    }
  }

  /* ============ §64 Round 156 — OWNER TEXT ALERTS ==============
     Phase 7b of the owner-panel program; Emil chose the link
     IN the text (2026-11-14). A play INSERTED AS PENDING fires
     exactly one alert round to the OWNER_ALERT_PHONES numbers
     (env-only, comma-separated, normalized + deduped) — body:
     athlete, title, sport, and the play's moderation link,
     minted by moderateLinkFor, the SAME builder notifyPending
     uses, so the text link and the email link for a play are
     identical by construction. Deduped retries insert nothing
     and text nothing; fast-laned inserts never text (the
     panel strip covers them). Sending rides sendText (global
     fetch to Twilio): absent Twilio vars = the logged no-op,
     absent OWNER_ALERT_PHONES = silence, and a send can never
     delay or fail the upload. The panel status (counts +
     booleans only) rides GET /api/owner/trusted. Servers A/C
     stub the network layer with a --import fetch capture, so
     the real sendText path runs end to end. */
  {
    // ---- Wiring asserts ----
    assert(serverJs.includes("function ownerAlertPhones156") && serverJs.includes("function notifyOwnerTextAlert156") && serverJs.includes("OWNER_ALERT_PHONES"), "r156 wiring: the env parsing + alert helpers ship, recipients from OWNER_ALERT_PHONES");
    assert(serverJs.includes("function moderateLinkFor") && (serverJs.split("moderate?id=${id}&token=${moderateToken()}").length - 1) === 1 && serverJs.includes("const modLink = moderateLinkFor(id);") && serverJs.includes("Review: ${moderateLinkFor(id)}"), "r156 link identity: exactly ONE place mints a per-play moderation URL (moderateLinkFor), and BOTH the pending email and the text call it — their links for a play are identical by construction");
    const createSlice156 = serverJs.slice(serverJs.indexOf("// ---- Create a play"), serverJs.indexOf("// ---- Vote toggle ----"));
    assert((createSlice156.split("notifyOwnerTextAlert156({").length - 1) === 1 && createSlice156.indexOf("notifyOwnerTextAlert156({") > createSlice156.indexOf("autoEnterOnApproval130(laneRow155)"), "r156 trigger: exactly one alert call, in the pending else-branch AFTER the fast-lane block — dedupes (answered earlier) and laned plays can never reach it");
    assert(serverJs.includes("textAlerts156: ownerTextAlertStatus156()"), "r156 wiring: the counts-only status rides the owner trusted payload");
    assert(appJs.includes("function textAlertLine156") && appJs.includes("Text alerts: on") && appJs.includes("Text alerts: off") && appJs.includes("textAlerts156 = tr155.textAlerts156"), "r156 wiring: the panel renders the status line from the trusted payload (on/off forms)");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r156 wiring: asset pins bumped to ?v=155 — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");

    // ---- Shared helpers ----
    const { pathToFileURL: p2u64 } = await import("node:url");
    const env64 = (extra, drop = []) => { const e = { ...process.env, ...extra }; for (const k of drop) delete e[k]; return e; };
    const stub64src = `import fs from "node:fs";\nconst origFetch156 = globalThis.fetch;\nglobalThis.fetch = async (url, opts = {}) => {\n  if (String(url).includes("api.twilio.com")) {\n    const prm = new URLSearchParams(String(opts.body || ""));\n    fs.appendFileSync(process.env.FETCH_CAPTURE_156, JSON.stringify({ to: prm.get("To"), from: prm.get("From"), body: prm.get("Body") }) + "\\n");\n    return new Response(JSON.stringify({ sid: "SMstub156" }), { status: 201, headers: { "content-type": "application/json" } });\n  }\n  return origFetch156(url, opts);\n};\n`;
    const readCap64 = (file) => { try { return fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
    const waitCap64 = async (file, n) => { for (let i = 0; i < 25; i++) { const c = readCap64(file); if (c.length >= n) return c; await wait(200); } return readCap64(file); };
    const makeUpload64 = (b) => async ({ seedByte, email, title, name }) => {
      const buf = Buffer.alloc(2048, 7); buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47; buf[100] = seedByte;
      const fd = new FormData();
      fd.append("title", title); fd.append("sport", "baseball"); fd.append("division", "boys");
      fd.append("playerName", name); fd.append("guardianConsent", "on");
      if (email != null) fd.append("notifyEmail", email);
      fd.append("file", new Blob([buf], { type: "image/png" }), "clip.png");
      const r = await fetch(b + "/api/highlights", { method: "POST", body: fd });
      return { status: r.status, body: await r.json().catch(() => ({})) };
    };
    const health64 = async (b) => { for (let i = 0; i < 50; i++) { try { await fetch(b + "/api/health"); return; } catch { await wait(200); } } throw new Error("server did not come up: " + b); };

    // ---- Server A: Twilio stubbed, messy OWNER_ALERT_PHONES ----
    const PORT64A = 3502, base64A = `http://localhost:${PORT64A}`;
    const TOK64A = "r156-test-backup-token";
    const tmp64A = fs.mkdtempSync(path.join(root, ".tmp-r156a-"));
    const cap64A = path.join(tmp64A, "capture.jsonl");
    const stub64A = path.join(tmp64A, "fetch-stub.mjs");
    fs.writeFileSync(stub64A, stub64src);
    const child64A = spawn(process.execPath, ["--import", p2u64(stub64A).href, "server.js"], { cwd: root, env: env64({ PORT: String(PORT64A), DATA_DIR: tmp64A, OWNER_TOKEN: "env-main-secret-156", BACKUP_TOKEN: TOK64A, TWILIO_ACCOUNT_SID: "ACstub156", TWILIO_AUTH_TOKEN: "stub-auth-token", TWILIO_FROM: "+15550009999", OWNER_ALERT_PHONES: "516-840-2454, +1 (347) 752-0014, 5168402454, not-a-number, +44 20 7946 0958", FETCH_CAPTURE_156: cap64A }), stdio: "pipe" });
    const j64A = async (p, opts = {}) => { const r = await fetch(base64A + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const ownerH64A = { "x-owner-token": "env-main-secret-156" };
    const upload64A = makeUpload64(base64A);
    try {
      await health64(base64A);
      assert((await j64A("/api/owner/trusted")).status === 403, "r156 auth: the status payload 403s anonymously");
      const st64A = await j64A("/api/owner/trusted", { headers: ownerH64A });
      const ta64A = st64A.body.textAlerts156 || {};
      assert(ta64A.configured === true && ta64A.numbers === 3 && ta64A.twilio === true && ta64A.on === true, "r156 parse: messy env (dashes, parens, a bare duplicate, junk, a +44 number) normalizes to exactly 3 numbers; status on");
      const stJson64A = JSON.stringify(st64A.body);
      assert(!stJson64A.includes("5168402454") && !stJson64A.includes("3477520014") && !stJson64A.includes("442079460958") && !stJson64A.includes("+15168402454") && !stJson64A.includes("+13477520014"), "r156 privacy: no configured number (raw or normalized) appears anywhere in the panel payload");

      const up1 = await upload64A({ seedByte: 11, email: "parent@example.com", title: "Text Alert Play One", name: "Test Athlete" });
      assert(up1.status === 201 && up1.body.status === "pending" && up1.body.fastLaned === false, "r156 trigger: a normal upload lands pending");
      const caps1 = await waitCap64(cap64A, 3);
      await wait(400);
      assert(readCap64(cap64A).length === 3, "r156 trigger: exactly one send attempt per configured number (3)");
      assert(JSON.stringify(caps1.map((c) => c.to).sort()) === JSON.stringify(["+13477520014", "+15168402454", "+442079460958"]), "r156 parse: sends went to the normalized, deduped set (+1 for US, + kept for international)");
      assert(caps1.every((c) => c.from === "+15550009999"), "r156 send: every text is From the TWILIO_FROM number");
      const snapR64A = await fetch(base64A + "/api/backup/db", { headers: { "x-backup-token": TOK64A } });
      const snapP64A = path.join(tmp64A, "snap.sqlite");
      fs.writeFileSync(snapP64A, Buffer.from(await snapR64A.arrayBuffer()));
      const sdb64A = new DatabaseSync(snapP64A, { readOnly: true });
      const token64A = sdb64A.prepare("SELECT value FROM settings WHERE key='moderate_token'").get().value;
      sdb64A.close();
      const link1 = `https://highlighthype.com/moderate?id=${up1.body.id}&token=${token64A}`;
      assert(caps1.every((c) => c.body.startsWith("HighlightHype: new play waiting - ") && c.body.includes(`Test A.: "Text Alert Play One" (baseball). Review: ${link1}`)), "r156 body: athlete (display form), title, sport, and the play's moderation link — the identical link the pending email carries (same builder, same token)");
      const modPage64A = await fetch(`${base64A}/moderate?id=${up1.body.id}&token=${token64A}`);
      assert(modPage64A.status === 200 && (await modPage64A.text()).includes("Text Alert Play One"), "r156 link: the texted link actually opens the play's moderation page");

      const dup64A = await upload64A({ seedByte: 11, email: "parent@example.com", title: "Text Alert Play One", name: "Test Athlete" });
      assert(dup64A.body.deduped === true, "r156 dedupe: the same-bytes retry answers deduped");
      await wait(600);
      assert(readCap64(cap64A).length === 3, "r156 dedupe: a deduped retry texts NOTHING");

      const addLane64A = await j64A("/api/owner/trusted", { method: "POST", headers: { ...ownerH64A, "content-type": "application/json" }, body: JSON.stringify({ email: "lane@example.com", label: "Lane Fam" }) });
      assert(addLane64A.status === 200, "r156 setup: the lane family is added");
      const laned64A = await upload64A({ seedByte: 22, email: "lane@example.com", title: "Laned No Text Play", name: "Lane Kid" });
      assert(laned64A.status === 201 && laned64A.body.fastLaned === true, "r156 lane: the trusted upload fast-lanes");
      await wait(600);
      assert(readCap64(cap64A).length === 3, "r156 lane: a fast-laned insert texts NOTHING (the panel strip covers it)");

      const up2 = await upload64A({ seedByte: 33, email: "other@example.com", title: "Text Alert Play Two", name: "Second Athlete" });
      const caps2 = await waitCap64(cap64A, 6);
      assert(caps2.length === 6 && caps2.slice(3).every((c) => c.body.includes(`moderate?id=${up2.body.id}&`)), "r156 trigger: the next pending play fires its own round, with ITS link");
    } finally {
      child64A.kill();
      fs.rmSync(tmp64A, { recursive: true, force: true });
    }

    // ---- Server B: phones set, Twilio ABSENT — logged no-op ----
    const PORT64B = 3503, base64B = `http://localhost:${PORT64B}`;
    const tmp64B = fs.mkdtempSync(path.join(root, ".tmp-r156b-"));
    const child64B = spawn(process.execPath, ["server.js"], { cwd: root, env: env64({ PORT: String(PORT64B), DATA_DIR: tmp64B, OWNER_TOKEN: "env-main-secret-156", OWNER_ALERT_PHONES: "+1 516-840-2454, 347-752-0014" }, ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM"]), stdio: "pipe" });
    let log64B = "";
    child64B.stdout.on("data", (d) => { log64B += d; });
    child64B.stderr.on("data", (d) => { log64B += d; });
    const upload64B = makeUpload64(base64B);
    try {
      await health64(base64B);
      const upB = await upload64B({ seedByte: 44, email: "parent@example.com", title: "No Twilio Play", name: "Quiet Athlete" });
      assert(upB.status === 201 && upB.body.status === "pending", "r156 no-twilio: the upload still succeeds and lands pending — texting can never fail an upload");
      for (let i = 0; i < 25 && !log64B.includes("[r156]"); i++) await wait(200);
      assert(log64B.includes(`[r156] owner text alert: play ${upB.body.id} -> 2 number(s)`), "r156 no-twilio: the alert round is attempted for both numbers");
      assert(log64B.includes("[sms] TWILIO_* env vars not set"), "r156 no-twilio: sendText logs its inert no-op, exactly like the guardian path");
      assert(log64B.includes("***54") && log64B.includes("***14") && !log64B.includes("5168402454") && !log64B.includes("+15168402454"), "r156 logs: recipients are masked to the last two digits; full numbers never hit the log");
      const st64B = await (await fetch(base64B + "/api/owner/trusted", { headers: { "x-owner-token": "env-main-secret-156" } })).json();
      const ta64B = st64B.textAlerts156 || {};
      assert(ta64B.configured === true && ta64B.numbers === 2 && ta64B.twilio === false && ta64B.on === false, "r156 status: numbers set but Twilio missing reads on=false, twilio=false, numbers=2");
    } finally {
      child64B.kill();
      fs.rmSync(tmp64B, { recursive: true, force: true });
    }

    // ---- Server C: Twilio stubbed, NO OWNER_ALERT_PHONES — silent ----
    const PORT64C = 3504, base64C = `http://localhost:${PORT64C}`;
    const tmp64C = fs.mkdtempSync(path.join(root, ".tmp-r156c-"));
    const cap64C = path.join(tmp64C, "capture.jsonl");
    const stub64C = path.join(tmp64C, "fetch-stub.mjs");
    fs.writeFileSync(stub64C, stub64src);
    const child64C = spawn(process.execPath, ["--import", p2u64(stub64C).href, "server.js"], { cwd: root, env: env64({ PORT: String(PORT64C), DATA_DIR: tmp64C, OWNER_TOKEN: "env-main-secret-156", TWILIO_ACCOUNT_SID: "ACstub156", TWILIO_AUTH_TOKEN: "stub-auth-token", TWILIO_FROM: "+15550009999", FETCH_CAPTURE_156: cap64C }, ["OWNER_ALERT_PHONES"]), stdio: "pipe" });
    let log64C = "";
    child64C.stdout.on("data", (d) => { log64C += d; });
    child64C.stderr.on("data", (d) => { log64C += d; });
    const upload64C = makeUpload64(base64C);
    try {
      await health64(base64C);
      const upC = await upload64C({ seedByte: 55, email: "parent@example.com", title: "Unconfigured Play", name: "Silent Athlete" });
      assert(upC.status === 201 && upC.body.status === "pending", "r156 unconfigured: uploads behave exactly as before the feature existed");
      await wait(700);
      assert(readCap64(cap64C).length === 0 && !log64C.includes("[r156]"), "r156 unconfigured: no sends and no alert log line — the feature is a true no-op");
      const st64C = await (await fetch(base64C + "/api/owner/trusted", { headers: { "x-owner-token": "env-main-secret-156" } })).json();
      const ta64C = st64C.textAlerts156 || {};
      assert(ta64C.configured === false && ta64C.numbers === 0 && ta64C.twilio === true && ta64C.on === false, "r156 status: no numbers configured reads configured=false, numbers=0, on=false");
    } finally {
      child64C.kill();
      fs.rmSync(tmp64C, { recursive: true, force: true });
    }
  }

  /* ============ §65 Round 157 — the queue's New | All filter ====
     Emil (2026-11-14): the Moderation queue showed ALL videos
     by default — "We should have a filter for new videos and
     then all videos. It's confusing right now when you see all
     videos by default." The queue gains a segmented New | All
     pill bar (the Round 141 idiom): New (pending only, count
     on the pill) is the DEFAULT view, with a calm "🎉 All
     caught up" line when nothing waits; All is the list the
     queue has always rendered — same plays, order, cards,
     detail. The render loadOwner always did was lifted
     verbatim into renderOwnerQueue157 (ownerQueue145 in,
     #queue out) so the switch is a pure re-render: no fetch,
     no re-order. Switching CLEARS the batch selection +
     tally. The choice is panel state only — queueView157
     starts "new" on every fresh load, nothing persisted.
     Client-only: the vm below runs the REAL Round 157 block
     plus the Round 150 block (head/batch/review machinery)
     against a stub DOM, the pattern §58 set. */
  {
    // ---- Wiring asserts ----
    const i157 = appJs.indexOf("Round 157 — the Moderation queue gains");
    assert(i157 > -1, "r157 wiring: the Round 157 block exists in app.js");
    const block157 = appJs.slice(appJs.lastIndexOf("/*", i157), appJs.indexOf("async function loadOwner", i157));
    assert(block157.includes('let queueView157 = "new"'), "r157 wiring: the view state starts on New — a fresh panel load opens on New, nothing persisted");
    assert(block157.includes("function renderOwnerQueue157()") && appJs.includes("renderOwnerQueue157();"), "r157 wiring: the queue render is a named function, and loadOwner calls it");
    assert(block157.includes('$("#queue").innerHTML = queueFilterHtml157(') && !block157.includes('$("#trash146")') && !block157.includes('$("#ownerStats")') && !block157.includes('$("#fastLane155")'), "r157 wiring: the render writes ONLY #queue — Trash, stats, Fast lane and every other panel section are untouched by the filter");
    assert(block157.includes("New (${pendCount})") && block157.includes("setQueueView157('new')") && block157.includes("setQueueView157('all')"), "r157 wiring: the pill bar renders New with its pending count plus All, both wired to the switch");
    assert(block157.includes("batchSel150.clear()") && block157.includes('batchMsg150 = ""'), "r157 wiring: switching views clears the batch selection and its tally");
    assert(block157.includes("🎉 All caught up — no new plays waiting"), "r157 wiring: the New view's empty-state copy ships");
    assert(block157.includes('queueView157 === "all" ? liveQueue146 : pendRows157'), "r157 wiring: All takes liveQueue146 itself (the pre-157 list, untouched); New takes the pending subset");
    assert(css.includes(".qfilter157") && css.includes('.qfilter157 button[aria-pressed="true"]') && css.includes(".queue-empty157"), "r157 wiring: the pill bar styles ship — active pill filled lime via aria-pressed, the Round 141 look");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r157 wiring: asset pins bumped to ?v=156 (→157: ?v=157; →159: ?v=158; →160: ?v=159; →161: ?v=160; →162: ?v=161)");

    // ---- Client behavior: the real blocks in a vm ----
    const escCap157 = appJs.match(/const esc = [\s\S]*?\nconst cap = [\s\S]*?;\n/)[0];
    const i150b = appJs.indexOf("Round 150 — swipe review mode + batch actions");
    const block150b = appJs.slice(appJs.lastIndexOf("/*", i150b), appJs.indexOf("/* ---------------- boot / hashes"));
    const els157 = {};
    const mkEl157 = () => ({
      innerHTML: "", textContent: "", hidden: false, disabled: false, checked: false, indeterminate: false,
      style: {}, dataset: {}, listeners: {},
      classList: { _s: new Set(), toggle(c, f) { const on = f === undefined ? !this._s.has(c) : !!f; if (on) this._s.add(c); else this._s.delete(c); }, contains(c) { return this._s.has(c); } },
      addEventListener(t, fn) { this.listeners[t] = fn; },
      removeEventListener(t) { delete this.listeners[t]; },
      setPointerCapture() {},
    });
    const $157 = (sel) => (els157[sel] ||= mkEl157());
    const mkRow157 = (id, status, title) => ({ id, title, sport: "baseball", division: "boys", status, player_name: "Kid " + id, athlete_label: "Kid " + id, athlete_tag: "", team: "", voteCount: 0, guardian_email: "", guardian_phone: "", text_consent: false, guardian_consent_at: "", story_consent: false, story_text: "", review: null, ai: null, isSample: false, fast_laned_at: null, celebration_spotlight: false, media_kind: "file", media_url: "/uploads/vm" + id + ".mp4", poster_url: "", embed_url: "", host_label: "", created_at: "2026-11-14T09:00:00.000Z" });
    const rows157 = [mkRow157(1, "pending", "Pending Alpha"), mkRow157(2, "pending", "Pending Beta"), mkRow157(3, "approved", "Approved Gamma"), mkRow157(4, "approved", "Approved Delta"), mkRow157(5, "hidden", "Hidden Epsilon"), mkRow157(6, "trashed", "Trashed Zeta")];
    let apiCalls157 = 0;
    const ctx157 = vm.createContext({
      window: {}, console, ownerQueue145: rows157,
      api: async () => { apiCalls157++; return { ok: true }; },
      loadOwner: async () => {}, loadData: () => {},
      confirm: () => true, alert: () => {},
      $: $157,
      document: { querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} },
    });
    vm.runInContext(escCap157 + block157 + block150b, ctx157);
    for (const k of Object.keys(ctx157.window)) ctx157[k] = ctx157.window[k];
    const run157 = (code) => vm.runInContext(code, ctx157);
    const qHtml157 = () => els157["#queue"].innerHTML;
    const cardCount157 = (html) => (html.match(/class="queue-item"/g) || []).length;

    // Default: New — pending only, count on the pill.
    assert(run157("queueView157") === "new", "r157 view: the view state opens on New (nothing persisted)");
    run157("renderOwnerQueue157()");
    let h157 = qHtml157();
    assert(h157.includes("New (2)") && h157.includes('aria-pressed="true"'), "r157 view: the filter renders with New active and the pending count (2) on its pill");
    assert(h157.includes("Pending Alpha") && h157.includes("Pending Beta") && cardCount157(h157) === 2, "r157 view: New renders exactly the 2 pending cards");
    assert(!h157.includes("Approved Gamma") && !h157.includes("Hidden Epsilon") && !h157.includes("Trashed Zeta"), "r157 view: New hides approved, hidden AND trashed plays");
    assert(h157.includes("Select all pending (2)") && h157.includes('onclick="openReview150()"'), "r157 view: the queue head rides along in New — Select all pending (2) + Review mode");

    // Switching to All: the pre-157 list, order intact, no fetch.
    run157("toggleBatchSel150(1, true)");
    assert(run157("batchSel150.size") === 1, "r157 switch: a selection exists before the switch");
    run157("setQueueView157('all')");
    h157 = qHtml157();
    assert(run157("batchSel150.size") === 0 && run157("batchMsg150") === "", "r157 switch: switching views CLEARS the batch selection and its tally — it never applies to the other list");
    assert(cardCount157(h157) === 5 && h157.includes("Approved Gamma") && h157.includes("Approved Delta") && h157.includes("Hidden Epsilon") && !h157.includes("Trashed Zeta"), "r157 view: All renders every non-trashed play (5 cards) — the pre-157 list");
    assert(h157.indexOf("Pending Alpha") < h157.indexOf("Pending Beta") && h157.indexOf("Pending Beta") < h157.indexOf("Approved Gamma") && h157.indexOf("Approved Gamma") < h157.indexOf("Hidden Epsilon"), "r157 view: All keeps the queue's delivered order — nothing re-ordered");
    assert(h157.includes("New (2)"), "r157 view: the New pill still carries the pending count while All is active");
    assert(apiCalls157 === 0, "r157 switch: rendering and switching never call the API — a pure re-render of the loaded queue");

    // Review mode still launches from New.
    run157("setQueueView157('new')");
    run157("openReview150()");
    assert(els157["#reviewModal150"].hidden === false && els157["#reviewProgress150"].textContent === "1 of 2", "r157 review: Review mode launches from New over the 2 pendings ('1 of 2')");
    run157("closeReview150(true)");

    // Empty New: the calm state, filter still present.
    rows157[0].status = "approved"; rows157[1].status = "approved";
    run157("renderOwnerQueue157()");
    h157 = qHtml157();
    assert(h157.includes("New (0)") && h157.includes("🎉 All caught up — no new plays waiting") && cardCount157(h157) === 0, "r157 view: New with nothing waiting shows the calm All-caught-up state, no cards");
    run157("setQueueView157('all')");
    assert(cardCount157(qHtml157()) === 5, "r157 view: ...while All still shows the full list underneath");
  }

  /* ============ §66 Round 158 — only the view you're looking
     at can make sound (HOTFIX: the Battles audio leak) =======
     Emil, watching Nicholas's clip in Battles, tapped to All
     videos and the battle kept playing — audibly. Verified in
     the rig on the unmodified tree: SEVEN paths leaked
     (Battles -> All, Battles -> Month, Battles -> detail,
     Daily -> All, detail -> close, studio -> panel, detail
     -> Back), because no view switch paused anything and
     hidePlayDetail never stopped the detail's own video.
     The fix is one pause-only sweep (hhSilence158 /
     pauseMediaIn158) at the choke points: switchView,
     showPanel, openPlayDetail, hidePlayDetail, btlPlayBig118
     (the one battle funnel) and showHome (Store exit);
     popstate rides hhApply139 through the same functions.
     Muted previews are exempt (they make no sound and the
     board's previews must keep previewing); the hero is
     ambient home chrome under its own Round 125 controller
     and sits outside every swept root. The vm below runs the
     REAL helpers + the REAL switchView / hidePlayDetail /
     btlPlayBig118 slices against stub DOMs (§58/§65 pattern). */
  {
    // ---- Wiring asserts ----
    const i158 = appJs.indexOf("function hhSilence158");
    assert(i158 > -1, "r158 wiring: the Round 158 silence predicate exists in app.js");
    const helpers158 = appJs.slice(i158, appJs.indexOf("function hidePlayDetail()"));
    assert(helpers158.includes("function pauseMediaIn158") && !helpers158.includes("heroVideo"), "r158 wiring: the sweep helper ships, and the hero is never in its scope");
    assert(helpers158.includes('el.closest(".btl-player")') && helpers158.includes('el.closest(".watch-player")') && helpers158.includes('el.id === "hfVideo"'), "r158 wiring: the dedicated watch surfaces (battle/detail players, studio film) are silenced by structure, muted or not");
    assert(!helpers158.includes("currentTime =") && !helpers158.includes("removeAttribute("), "r158 wiring: the sweep is pause-only — it never resets a position or unloads a clip");
    const sw158 = appJs.slice(appJs.indexOf("function switchView(v)"), appJs.indexOf('$$(".viewseg button").forEach((b) => b.addEventListener("click"'));
    assert(sw158.includes("pauseMediaIn158") && sw158.includes('"#viewAll"') && sw158.includes('"#viewBattles"') && sw158.includes("active158"), "r158 wiring: switchView sweeps the board views it leaves, exempting the newly active one");
    const sp158 = appJs.slice(appJs.indexOf("function showPanel(name)"), appJs.indexOf("/* Round 51"));
    assert(sp158.includes("pauseMediaIn158") && sp158.includes("p.dataset.panel !== name"), "r158 wiring: showPanel silences every panel except the newly active one");
    const op158 = appJs.slice(appJs.indexOf("window.openPlayDetail"), appJs.indexOf("/* Round 148"));
    assert(op158.includes('$$(".panel[data-panel]").forEach((p) => pauseMediaIn158(p, false))'), "r158 wiring: opening the play detail silences every panel behind the overlay");
    const hd158 = appJs.slice(appJs.indexOf("function hidePlayDetail()"), appJs.indexOf("/* The explicit close affordances"));
    assert(hd158.includes('pauseMediaIn158($("#playDetail"), true)'), "r158 wiring: closing the detail force-pauses its own player");
    const iBp158 = appJs.indexOf("function btlPlayBig118(player, force)");
    const bp158 = appJs.slice(iBp158, appJs.indexOf('["btlPlayer", "dailyPlayer", "runPlayer"].forEach', iBp158));
    assert(bp158.includes("pauseMediaIn158") && bp158.includes('$("#viewBattles")') && bp158.includes('$("#playDetail")') && bp158.includes('$("#hypeframe")') && bp158.includes('$("#stories")'), "r158 wiring: a battle start (btlPlayBig118, the one funnel) silences its sibling players + detail/studio/story leftovers");
    assert(appJs.includes('if (typeof btlPlayBig118 === "function") btlPlayBig118(player, false); else { try { player.play(); }'), "r158 wiring: the battle watch paths still funnel through btlPlayBig118");
    const sh158 = appJs.slice(appJs.indexOf("function showHome()"), appJs.indexOf("/* Round 48"));
    assert(sh158.includes('pauseMediaIn158($("#shop"), true)'), "r158 wiring: leaving the Store force-pauses the Store's films (showStore already pauses home on the way in)");
    const ap139 = appJs.slice(appJs.indexOf("function hhApply139(place)"), appJs.indexOf("function hhSettle139()"));
    assert(ap139.includes("switchView(") && ap139.includes("showPanel(") && ap139.includes("hidePlayDetail()"), "r158 wiring: popstate restores (hhApply139) route through the same swept functions — Back is a view change");
    assert(appJs.includes("function attachChromeFade143") && appJs.includes("function markBtlStage154") && appJs.includes("function syncBtlPlayer113"), "r158 wiring: Round 143 chrome fade + Round 154 stage marking untouched");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r158 wiring: asset pins bumped to ?v=157 (→159: ?v=158; →160: ?v=159; →161: ?v=160; →162: ?v=161)");

    // ---- Behavior: real code slices in vms ----
    const helpersSrc158 = appJs.slice(i158, appJs.indexOf("function hidePlayDetail()"));
    const mkVid158 = (opts = {}) => ({
      paused: !!opts.paused, currentTime: opts.t || 0, muted: !!opts.muted, id: opts.id || "",
      dataset: {}, style: {}, readyState: 4, networkState: 1, error: null, currentSrc: "x",
      _cm: opts.closestMap || {},
      closest(sel) { return this._cm[sel] || null; },
      pause() { this.paused = true; },
      play() { this.paused = false; return Promise.resolve(); },
      getAttribute() { return "x"; }, setAttribute() {}, removeAttribute() {}, load() {},
      addEventListener() {}, removeEventListener() {},
    });
    const mkRoot158 = (kids) => ({ hidden: false, style: {}, dataset: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, innerHTML: "", textContent: "", querySelectorAll: (sel) => (sel === "video, audio" ? kids : []) });

    // Scenario 1: switchView — Battles playing -> All.
    {
      const btlVid = mkVid158({ muted: false, t: 7.5, closestMap: { ".btl-player": {} } });
      const monthVid = mkVid158({ muted: false, t: 3 });
      const tileVid = mkVid158({ muted: true, t: 1 });
      const loudTile = mkVid158({ muted: false, t: 2 });
      const reg = { "#viewBattles": mkRoot158([btlVid]), "#viewMonth": mkRoot158([monthVid]), "#viewAll": mkRoot158([tileVid, loudTile]), "#viewFame": mkRoot158([]) };
      const $s = (sel) => reg[sel] || (reg[sel] = mkRoot158([]));
      const ctx = vm.createContext({ window: {}, console, $: $s, $$: () => [], monthSub: "month", currentView: "battles", document: { body: { classList: { add() {}, remove() {} } } } });
      const swSrc = appJs.slice(appJs.indexOf("function switchView(v)"), appJs.indexOf('$$(".viewseg button").forEach((b) => b.addEventListener("click"'));
      vm.runInContext(helpersSrc158 + swSrc, ctx);
      vm.runInContext('switchView("all")', ctx);
      assert(btlVid.paused === true && btlVid.currentTime === 7.5, "r158 behavior: Battles -> All pauses the battle video and does NOT reset its position (7.5 kept)");
      assert(monthVid.paused === true, "r158 behavior: the hidden Month view's playing clip is silenced too");
      assert(tileVid.paused === false, "r158 behavior: the ACTIVE view's muted previews keep previewing — the sweep never touches the view you're on");
      assert(loudTile.paused === false, "r158 behavior: the active view's own player is untouched even unmuted");
      btlVid.play();
      vm.runInContext('switchView("battles")', ctx);
      assert(loudTile.paused === true, "r158 behavior: All -> Battles silences an unmuted board player left running");
      assert(tileVid.paused === false, "r158 behavior: ...while its muted preview STILL keeps previewing (no sound, no freeze)");
      assert(btlVid.paused === false, "r158 behavior: returning to Battles leaves its player as it was — pause-only, no forced state");
    }

    // Scenario 2: hidePlayDetail — the detail's own (muted) video stops on close.
    {
      const detailVid = mkVid158({ muted: true, t: 12 });
      const reg = { "#playDetail": mkRoot158([detailVid]) };
      const $s = (sel) => reg[sel] || (reg[sel] = mkRoot158([]));
      const ctx = vm.createContext({ window: {}, console, $: $s, $$: () => [], detailPlayId: 9, teardownDetailAutoplay: () => {}, document: { body: { classList: { add() {}, remove() {} } } } });
      const hdSrc = appJs.slice(appJs.indexOf("function hidePlayDetail()"), appJs.indexOf("/* The explicit close affordances"));
      vm.runInContext(helpersSrc158 + hdSrc, ctx);
      vm.runInContext("hidePlayDetail()", ctx);
      assert(detailVid.paused === true && detailVid.currentTime === 12, "r158 behavior: closing the detail pauses its player even muted (force), position preserved");
    }

    // Scenario 3: btlPlayBig118 — a battle start silences siblings + leftovers, never itself.
    {
      const box158 = { contains: (el) => el === targetVid || el === fillVid };
      var targetVid = mkVid158({ paused: true, closestMap: { ".btl-player": box158 } });
      var fillVid = mkVid158({ muted: true, closestMap: { ".btl-player": box158 } });
      const dailyVid = mkVid158({ muted: false, t: 9, closestMap: { ".btl-player": {} } });
      const detailVid = mkVid158({ muted: false, t: 4 });
      const storyVid = mkVid158({ muted: false, t: 6 });
      const reg = { "#viewBattles": mkRoot158([targetVid, fillVid, dailyVid]), "#playDetail": mkRoot158([detailVid]), "#hypeframe": mkRoot158([]), "#stories": mkRoot158([storyVid]) };
      const $s = (sel) => reg[sel] || (reg[sel] = mkRoot158([]));
      const ctx = vm.createContext({ window: {}, console, $: $s, $$: () => [], btlShowRetry118: () => {}, document: { body: { classList: { add() {}, remove() {} } } } });
      const bpSrc = appJs.slice(iBp158, appJs.indexOf('["btlPlayer", "dailyPlayer", "runPlayer"].forEach', iBp158));
      vm.runInContext(helpersSrc158 + bpSrc, ctx);
      ctx.__target = targetVid;
      vm.runInContext("btlPlayBig118(__target, false)", ctx);
      assert(dailyVid.paused === true && dailyVid.currentTime === 9, "r158 behavior: a Quick battle start pauses the Daily player left playing on the same screen");
      assert(detailVid.paused === true && storyVid.paused === true, "r158 behavior: ...and any detail/story player left running elsewhere");
      assert(fillVid.paused === false, "r158 behavior: the starting player's own blur fill is exempt (it rides with its player)");
      assert(targetVid.paused === false, "r158 behavior: the starting player itself plays — the sweep never silences the battle you just started");
    }
  }

  /* ============ §67 Round 159 — visitor sources: where
     visitors come from, cookieless and in-house ============
     Emil (2026-11-14): "I really want to know — where visitors
     come from." Once per browser session (a sessionStorage
     flag — NO cookie, nothing persistent) the SPA sends ONE
     visit_source event through POST /api/track: the referrer's
     HOSTNAME only (never a URL), the UTM trio from our own
     link, and the landing view; the #owner route is skipped —
     owner visits are not audience. The server reduces the host
     AGAIN, classifies it (direct / search / social / other)
     and keeps aggregate daily counters only: visit_source
     (class), visit_host (bare host; known platforms fold to
     their base), visit_campaign (JSON [source, medium,
     campaign]), visit_landing. GET /api/owner/stats gains
     .sources (last 30 days) and the Owner panel's "Where
     visitors come from" block renders from it. The vm parts
     run the REAL server helpers (sliced from server.js), the
     REAL client capture + renderer (sliced from app.js)
     against stubs (§58/§65 pattern); the HTTP part runs on
     its own scratch server. */
  {
    const serverJs159 = fs.readFileSync(path.join(root, "server.js"), "utf8");
    const css159 = await text("/styles.css");

    // ---- Wiring asserts (server + client + css) ----
    assert(serverJs159.includes('kind === "visit_source"') && serverJs159.includes("recordVisitSource159(evt)"), "r159 wiring: /api/track accepts the visit_source kind and routes the whole event to the recorder");
    assert(serverJs159.includes('bumpStat("visit_source", cls)') && serverJs159.includes('bumpStat("visit_host", visitHostKey159(host, cls))') && serverJs159.includes('bumpStat("visit_campaign", JSON.stringify([src, med, camp]))') && serverJs159.includes('bumpStat("visit_landing", landing)'), "r159 wiring: the recorder writes exactly the four aggregate kinds (class / host / campaign JSON / landing)");
    assert(serverJs159.includes("sources: sources159") && serverJs159.includes("kind='visit_source'") && serverJs159.includes("kind='visit_host'") && serverJs159.includes("kind='visit_campaign'"), "r159 wiring: /api/owner/stats serves the 30-day .sources block built from the visit_* counters");
    const iCap159 = appJs.indexOf("function trackVisitSource159");
    assert(iCap159 > -1, "r159 wiring: the client capture (trackVisitSource159) exists in app.js");
    const capSlice159 = appJs.slice(appJs.indexOf("function landingView159"), appJs.indexOf("const SPORTS"));
    assert(capSlice159.includes('sessionStorage.getItem("hhVisitSource159")') && capSlice159.includes('sessionStorage.setItem("hhVisitSource159", "1")'), "r159 wiring: once-per-session is gated on the sessionStorage flag");
    assert(!capSlice159.includes("document.cookie") && !appJs.includes("hhVisitSource159="), "r159 wiring: the capture sets NO cookie — sessionStorage only, nothing persists between visits");
    assert(capSlice159.includes('if (location.hash === "#owner") return;'), "r159 wiring: the owner route is skipped — owner visits are not audience");
    assert(capSlice159.includes("new URL(document.referrer).hostname"), "r159 wiring: the client reduces the referrer to its hostname before anything is sent — the payload can only carry a host");
    assert(appJs.includes("trackVisitSource159();"), "r159 wiring: boot fires the capture");
    assert(appJs.includes("function sourcesHtml159") && appJs.includes("const refs = sourcesHtml159(st.sources);"), "r159 wiring: the Owner stats render the sources block under 'Where visitors came from'");
    assert(appJs.includes("No visits recorded yet — sources appear here as people arrive."), "r159 wiring: the honest empty-state line ships (counting starts this round, nothing backfilled)");
    assert(css159.includes(".stats-sub159"), "r159 wiring: the block's sub-head style ships in styles.css");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r159 wiring: asset pins bumped to ?v=158 (→160: ?v=159; →161: ?v=160; →162: ?v=161)");

    // ---- Server classification behavior (real helpers, vm) ----
    const helpersSrc159 = serverJs159.slice(serverJs159.indexOf("const VISIT_SEARCH_HOSTS159"), serverJs159.indexOf("function recordVisitSource159"));
    const ctxH159 = vm.createContext({ URL, console });
    vm.runInContext(helpersSrc159 + "\n;this.__h = { visitHost159, classifyVisit159, visitHostKey159, sanUtm159, visitHostLabel159 };", ctxH159);
    const H159 = ctxH159.__h;
    const cls159 = (raw) => { const h = H159.visitHost159(raw); return [h, H159.classifyVisit159(h)]; };
    const cases159 = [
      ["", "", "direct"],
      ["https://l.instagram.com/some/path?x=1", "l.instagram.com", "social"],
      ["www.google.com", "google.com", "search"],
      ["https://www.google.com/search?q=hype", "google.com", "search"],
      ["google.co.uk", "google.co.uk", "search"],
      ["https://m.facebook.com/story.php?id=1", "m.facebook.com", "social"],
      ["youtu.be", "youtu.be", "social"],
      ["https://x.com/HH/status/1", "x.com", "social"],
      ["threads.net", "threads.net", "social"],
      ["https://tiktok.com/@kid/video/1", "tiktok.com", "social"],
      ["duckduckgo.com", "duckduckgo.com", "search"],
      ["search.yahoo.co.jp", "search.yahoo.co.jp", "search"],
      ["search.brave.com", "search.brave.com", "search"],
      ["ecosia.org", "ecosia.org", "search"],
      ["bing.com", "bing.com", "search"],
      ["https://highlighthype.com/board", "highlighthype.com", "direct"],
      ["https://app.highlighthype.com/x", "app.highlighthype.com", "direct"],
      ["some-school-site.org", "some-school-site.org", "other"],
      ["not a host at all!!", "", "direct"],
      ["https://EXAMPLE.com:8443/a/b?c=d", "example.com", "other"],
      ["evilgoogle.com", "evilgoogle.com", "other"],
      ["google.com.evil.example", "google.com.evil.example", "other"],
    ];
    for (const [raw, wantHost, wantCls] of cases159) {
      const [h, c] = cls159(raw);
      assert(h === wantHost && c === wantCls, `r159 classify: ${JSON.stringify(String(raw).slice(0, 44))} -> host ${JSON.stringify(wantHost)}, class ${wantCls}`);
    }
    assert(H159.visitHostKey159("l.instagram.com", "social") === "instagram.com" && H159.visitHostKey159("m.facebook.com", "social") === "facebook.com", "r159 classify: known-platform subdomains fold to the base host key (rankings don't fragment)");
    assert(H159.visitHostKey159("google.co.uk", "search") === "google.co.uk" && H159.visitHostKey159("some-school-site.org", "other") === "some-school-site.org", "r159 classify: regional search hosts and other-class hosts keep their verbatim host key");
    assert(H159.visitHostLabel159("instagram.com") === "Instagram" && H159.visitHostLabel159("google.co.uk") === "Google" && H159.visitHostLabel159("youtu.be") === "YouTube" && H159.visitHostLabel159("search.yahoo.co.jp") === "Yahoo" && H159.visitHostLabel159("some-school-site.org") === "some-school-site.org", "r159 labels: friendly names where obvious (Instagram / Google / YouTube / Yahoo), the host itself as fallback");
    assert(H159.sanUtm159("x".repeat(100)).length === 64, "r159 utm: values are capped at 64 chars");
    assert(H159.sanUtm159("  pilot  ") === "pilot" && H159.sanUtm159("a\u0007b") === "a b" && H159.sanUtm159(null) === "" && H159.sanUtm159(undefined) === "", "r159 utm: trimmed, control chars scrubbed, null-safe");

    // ---- Client capture behavior (real code, vm) ----
    const capSrc159 = appJs.slice(appJs.indexOf("function landingView159"), appJs.indexOf("const SPORTS"));
    const mkCapCtx159 = ({ referrer = "", hash = "", search = "", pathname = "/" } = {}) => {
      const store159 = new Map();
      const sent159 = [];
      const ctx = vm.createContext({
        URL, URLSearchParams, Blob, console,
        sessionStorage: { getItem: (k) => (store159.has(k) ? store159.get(k) : null), setItem: (k, v) => store159.set(k, String(v)) },
        document: { referrer },
        location: { hash, pathname, search, hostname: "highlighthype.com" },
        navigator: { sendBeacon: (url, blob) => { sent159.push(blob); return true; } },
      });
      ctx.__sent = sent159;
      vm.runInContext(capSrc159, ctx);
      return ctx;
    };
    const capCtx1 = mkCapCtx159({ referrer: "https://www.tiktok.com/@somekid/video/7301?utm_source=share", search: "?utm_source=tiktok&utm_campaign=nov-contest" });
    vm.runInContext("trackVisitSource159()", capCtx1);
    assert(capCtx1.__sent.length === 1, "r159 behavior: the first boot in a session sends exactly one visit_source event");
    const pay1 = JSON.parse(await capCtx1.__sent[0].text());
    assert(pay1.kind === "visit_source" && pay1.host === "www.tiktok.com", "r159 behavior: the payload carries the referrer HOSTNAME (www.tiktok.com) — the server normalizes it from there");
    assert(!JSON.stringify(pay1).includes("@somekid") && !JSON.stringify(pay1).includes("video/7301"), "r159 behavior: no referrer path, query or account name leaks into the payload");
    assert(pay1.utmSource === "tiktok" && pay1.utmCampaign === "nov-contest" && pay1.utmMedium === "" && pay1.landing === "home", "r159 behavior: the UTM trio + the landing view ride along");
    vm.runInContext("trackVisitSource159()", capCtx1);
    assert(capCtx1.__sent.length === 1, "r159 behavior: a second boot in the SAME session sends nothing (once-only flag)");
    const capCtx2 = mkCapCtx159({ referrer: "https://instagram.com/p/xyz", hash: "#owner" });
    vm.runInContext("trackVisitSource159()", capCtx2);
    assert(capCtx2.__sent.length === 0, "r159 behavior: the owner panel route never counts a visit");
    const capCtx3 = mkCapCtx159({ referrer: "", search: "?view=battles" });
    vm.runInContext("trackVisitSource159()", capCtx3);
    const pay3 = JSON.parse(await capCtx3.__sent[0].text());
    assert(pay3.host === "" && pay3.landing === "battles", "r159 behavior: no referrer -> empty host (the server counts direct); a ?view=battles landing is named");
    const capCtx4 = mkCapCtx159({ referrer: "https://www.google.com/search?q=x", pathname: "/stories" });
    vm.runInContext("trackVisitSource159()", capCtx4);
    const pay4 = JSON.parse(await capCtx4.__sent[0].text());
    assert(pay4.host === "www.google.com" && pay4.landing === "stories", "r159 behavior: a /stories landing is named (and again only the host crosses the wire)");

    // ---- Client render behavior (real sourcesHtml159, vm) ----
    const shSrc159 = appJs.slice(appJs.indexOf("function sourcesHtml159"), appJs.indexOf("/* Site stats panel"));
    const escSrc159 = appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("const cap ="));
    const ctxR159 = vm.createContext({ console });
    vm.runInContext(escSrc159 + shSrc159 + "\n;this.__render = sourcesHtml159;", ctxR159);
    const emptyHtml159 = ctxR159.__render({ total: 0, byClass: { direct: 0, search: 0, social: 0, other: 0 }, topHosts: [], campaigns: [] });
    assert(emptyHtml159.includes("No visits recorded yet — sources appear here as people arrive."), "r159 render: the empty state is the honest one-liner");
    assert(ctxR159.__render(null).includes("No visits recorded yet"), "r159 render: a missing sources block degrades to the empty state, never a crash");
    const noCamp159 = ctxR159.__render({ total: 4, byClass: { direct: 1, search: 1, social: 2, other: 0 }, topHosts: [{ host: "instagram.com", label: "Instagram", count: 2 }], campaigns: [] });
    assert(noCamp159.includes("Top sources") && noCamp159.includes("Instagram") && noCamp159.includes("(instagram.com)"), "r159 render: top sources show the friendly label with the host beside it");
    assert(noCamp159.includes("Social") && noCamp159.includes("50%") && !noCamp159.includes("Campaigns"), "r159 render: class rows carry counts + share %; with no UTM visits the Campaigns list is hidden entirely");
    const withCamp159 = ctxR159.__render({ total: 5, byClass: { direct: 1, search: 1, social: 2, other: 1 }, topHosts: [], campaigns: [{ source: "newsletter", medium: "email", campaign: "nov-contest", count: 2 }] });
    assert(withCamp159.includes("Campaigns") && withCamp159.includes("nov-contest") && withCamp159.includes("newsletter"), "r159 render: UTM-tagged visits surface the Campaigns list (campaign + source)");

    // ---- HTTP behavior: auth, aggregation, storage audit ----
    const PORT67 = 3506, base67 = `http://localhost:${PORT67}`;
    const tmp67 = fs.mkdtempSync(path.join(root, ".tmp-r159-"));
    const child67 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT67), DATA_DIR: tmp67 }, stdio: "pipe" });
    const j67 = async (p, opts = {}) => { const r = await fetch(base67 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const visit67 = (evt) => j67("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "visit_source", ...evt }) });
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base67 + "/api/health"); break; } catch { await wait(200); } }
      const anon67 = await j67("/api/owner/stats");
      assert(anon67.status === 403, "r159 auth: /api/owner/stats still 403s anonymously — the sources block rides the owner gate");
      const claim67 = await j67("/api/owner/claim", { method: "POST" });
      const tok67 = claim67.body.token; assert(tok67, "r159 seed: owner claim returns a token");
      const own67 = { headers: { "x-owner-token": tok67 } };
      const empty67 = await j67("/api/owner/stats", own67);
      assert(empty67.body.sources && empty67.body.sources.total === 0 && empty67.body.sources.windowDays === 30 && empty67.body.sources.byClass.direct === 0 && empty67.body.sources.topHosts.length === 0 && empty67.body.sources.campaigns.length === 0, "r159 stats: a fresh site reports the honest empty sources shape (total 0, zeroed classes, no hosts, no campaigns)");
      for (const [evt, n] of [
        [{ host: "instagram.com", landing: "home" }, 2],
        [{ host: "l.instagram.com", landing: "home" }, 1],
        [{ host: "https://www.google.com/search?q=youth+baseball+highlights", landing: "home" }, 1],
        [{ host: "", landing: "board" }, 1],
        [{ host: "highlighthype.com", landing: "home" }, 1],
        [{ host: "junk junk junk", landing: "home" }, 1],
        [{ host: "tiktok.com", utmSource: "tiktok", utmCampaign: "nov-contest", landing: "month" }, 1],
        [{ host: "tiktok.com", utmSource: "tiktok", utmMedium: "social", utmCampaign: "nov-contest", landing: "home" }, 1],
        [{ host: "some-school-site.org", utmSource: "newsletter", utmMedium: "email", utmCampaign: "nov-contest", landing: "stories" }, 1],
        [{ host: "x.com", utmCampaign: "x".repeat(100), landing: "home" }, 1],
      ]) for (let i = 0; i < n; i++) { const r = await visit67(evt); assert(r.status === 200 && r.body.ok, "r159 track: visit_source accepted (never refused — junk counts as direct)"); }
      const st67 = await j67("/api/owner/stats", own67);
      const S67 = st67.body.sources;
      assert(S67.total === 11, "r159 stats: the total counts every seeded arrival (11)");
      assert(S67.byClass.social === 6 && S67.byClass.search === 1 && S67.byClass.direct === 3 && S67.byClass.other === 1, "r159 stats: class counts — social 6 (incl. the l.instagram.com arrival + both TikTok arrivals), search 1, direct 3 (no referrer + self + junk), other 1");
      assert(S67.topHosts.length === 5 && S67.topHosts[0].host === "instagram.com" && S67.topHosts[0].count === 3 && S67.topHosts[0].label === "Instagram", "r159 stats: the top host is instagram.com at 3 (the subdomain arrival folded in) with its friendly label");
      const hostMap67 = Object.fromEntries(S67.topHosts.map((h) => [h.host, h]));
      assert(hostMap67["google.com"] && hostMap67["google.com"].count === 1 && hostMap67["google.com"].label === "Google", "r159 stats: the full-URL Google arrival stored host-only and labels as Google");
      assert(hostMap67["some-school-site.org"] && hostMap67["some-school-site.org"].label === "some-school-site.org", "r159 stats: an unknown host is kept verbatim and labels as itself");
      const campMap67 = Object.fromEntries(S67.campaigns.map((c) => [c.campaign + "|" + c.source, c]));
      assert(campMap67["nov-contest|tiktok"] && campMap67["nov-contest|tiktok"].count === 2 && campMap67["nov-contest|tiktok"].medium === "social", "r159 stats: the TikTok campaign decodes back to campaign + source — and the same campaign arriving with and without a medium tag aggregates into ONE row (count 2, the medium kept), never two lookalike rows");
      assert(campMap67["nov-contest|newsletter"] && campMap67["nov-contest|newsletter"].medium === "email", "r159 stats: the newsletter campaign keeps its medium");
      const capped67 = S67.campaigns.find((c) => c.campaign.length === 64);
      assert(capped67 && capped67.count === 1, "r159 stats: an over-long campaign is capped at 64 chars — never stored raw");
      let db67 = null;
      for (let i = 0; i < 10 && !db67; i++) { try { db67 = new DatabaseSync(path.join(tmp67, "highlighthype.db"), { readOnly: true }); } catch { await wait(200); } }
      assert(db67, "r159 audit: the scratch DB opens for the storage audit");
      const vraw67 = JSON.stringify(db67.prepare("SELECT kind, key, count FROM stat_events WHERE kind LIKE 'visit%'").all());
      assert(!vraw67.includes("://") && !vraw67.includes("q=") && !vraw67.includes("/search") && !vraw67.includes("youth"), "r159 audit: no stored visit row contains a URL, a path or a query — hosts and classes only");
      const land67 = Object.fromEntries(db67.prepare("SELECT key, count FROM stat_events WHERE kind='visit_landing'").all().map((r) => [r.key, r.count]));
      assert(land67.home === 8 && land67.board === 1 && land67.month === 1 && land67.stories === 1, "r159 audit: landing views counted per arrival (home 8, board / month / stories 1 each)");
      db67.close();
    } finally {
      child67.kill();
      fs.rmSync(tmp67, { recursive: true, force: true });
    }
  }

  /* ============ §68 Round 160 — the hero must MOVE even when
     the browser refuses its sound (HOTFIX: hero frozen on its
     poster on iOS) ==========================================
     Emil's phone, 2026-11-14 10:23, minutes after the Round
     158 deploy: the hero sits on its poster frame and the
     sound badge shows MUTED. Not the sweep — #heroVideo lives
     in .hero, outside every swept root (the .panel sections,
     the four board views, #playDetail, #shop), and the rig
     (default Chromium policy, cold load, zero gestures) drove
     the pre-158 and current trees to IDENTICAL media logs:
     one play() from startHero125, one NotAllowedError
     rejection, the film playing muted anyway — Chromium
     rescues a refused start itself once the element stands
     muted (its own autoplay attempt proceeds), which masked
     the gap on every desktop check. The mechanism is in the
     Round 125 start: music-wanted sets muted=false and calls
     play(); where the browser refuses an uninteracted unmuted
     start, the refusal handler muted the film and armed the
     first-tap unmute but NEVER PLAYED AGAIN. On iOS Safari
     that is fatal: WebKit evaluates the element's autoplay
     with the muted state standing at load (muted=false,
     applied synchronously before the film loads) and does
     not re-attempt when muted flips afterwards — so the film
     sat on its poster, badge truthfully muted, until a tap.
     The fix stays inside the controller: the refusal path now
     retries play() muted (motion beats a frozen poster),
     never writes hh_music (the saved preference stays
     authoritative for sound and badge), and leaves the
     first-tap unmute exactly as it was. §66 is re-verified
     unmodified below; the vm scenarios run the REAL hero
     controller against an iOS-shaped stub element (unmuted
     play refuses, NOTHING rescues it) — the shape headless
     Chromium cannot produce on its own. */
  {
    // ---- Wiring asserts ----
    const iHero160 = appJs.indexOf("function heroMusicWanted125");
    assert(iHero160 > -1, "r160 wiring: the Round 125 hero controller exists in app.js");
    const heroSlice160 = appJs.slice(iHero160, appJs.indexOf("/* ---------------- countdown", iHero160));
    const iStart160 = appJs.indexOf("const startHero125");
    const startSlice160 = appJs.slice(iStart160, appJs.indexOf("armFirstTap125 = () => {", iStart160));
    assert(startSlice160.includes("v.muted = false;") && startSlice160.includes("const p = v.play();"), "r160 wiring: the audible start is still attempted FIRST — music on by default is unchanged");
    assert(startSlice160.includes("v.muted = true; setIcon(); armFirstTap125();"), "r160 wiring: the refusal handler still mutes + syncs the badge + arms the first-tap unmute");
    assert(startSlice160.includes("const q160 = v.play(); if (q160 && q160.catch) q160.catch(() => {});"), "r160 wiring: the refusal handler now RETRIES play() — the muted-motion fallback");
    assert(startSlice160.indexOf("const q160") > startSlice160.indexOf("armFirstTap125();"), "r160 wiring: the retry runs inside the refusal handler, after the mute + arm (not as a parallel start)");
    assert(!startSlice160.includes("hhStorageSet"), "r160 wiring: the start path never writes storage — the fallback cannot overwrite the saved hh_music preference");
    assert(heroSlice160.includes('hhStorageSet("hh_music", v.muted ? "off" : "on")'), "r160 wiring: the badge tap remains the ONLY writer of the sound preference");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r160 wiring: asset pins bumped to ?v=159 — →161: now ?v=160 — →162: now ?v=161");
    // ---- §66 re-verified, unmodified ----
    const helpers66r = appJs.slice(appJs.indexOf("function hhSilence158"), appJs.indexOf("function hidePlayDetail()"));
    assert(helpers66r.includes("function pauseMediaIn158") && !helpers66r.includes("heroVideo"), "r160/§66 recheck: the Round 158 sweep helpers stand unmodified and still never name the hero");
    const sw66r = appJs.slice(appJs.indexOf("function switchView(v)"), appJs.indexOf('$$(".viewseg button").forEach((b) => b.addEventListener("click"'));
    assert(sw66r.includes("pauseMediaIn158") && sw66r.includes('"#viewAll"') && sw66r.includes('"#viewBattles"') && sw66r.includes("active158"), "r160/§66 recheck: switchView still sweeps the board views it leaves, exempting the active one");
    const hd66r = appJs.slice(appJs.indexOf("function hidePlayDetail()"), appJs.indexOf("/* The explicit close affordances"));
    assert(hd66r.includes('pauseMediaIn158($("#playDetail"), true)'), "r160/§66 recheck: closing the detail still force-pauses its own player");

    // ---- Behavior: the REAL hero controller, iOS-shaped stub ----
    const heroSrc160 = appJs.slice(iHero160, appJs.indexOf("/* ---------------- countdown", iHero160));
    const mkHeroCtx160 = ({ pref = null, alwaysRefuse = false } = {}) => {
      const store160 = new Map();
      if (pref !== null) store160.set("hh_music", pref);
      const sim160 = { interacted: false };
      const calls160 = [];
      const winL160 = {};
      const vid160 = {
        id: "heroVideo", muted: false, paused: true, currentTime: 0,
        dataset: { src: "/hero-film.mp4" },
        getAttribute() { return null; }, setAttribute() {},
        addEventListener() {},
        /* iOS shape: an unmuted play with no interaction is
           refused, and nothing else ever starts the film (no
           autoplay attribute rescue); a muted play starts it. */
        play() {
          calls160.push({ mutedAtCall: this.muted });
          if (alwaysRefuse || (!this.muted && !sim160.interacted)) return Promise.reject(Object.assign(new Error("play() failed because the user didn't interact with the document first"), { name: "NotAllowedError" }));
          this.paused = false; return Promise.resolve();
        },
        pause() { this.paused = true; },
      };
      const badge160 = {
        _mutedShown: null, _click: null,
        classList: { toggle(cls, force) { if (cls === "is-muted") badge160._mutedShown = !!force; } },
        setAttribute() {},
        addEventListener(ev, fn) { if (ev === "click") badge160._click = fn; },
      };
      const ctx = vm.createContext({
        console,
        location: { pathname: "/", hash: "" },
        window: {
          addEventListener(ev, fn) { (winL160[ev] = winL160[ev] || []).push(fn); },
          removeEventListener(ev, fn) { if (winL160[ev]) winL160[ev] = winL160[ev].filter((f) => f !== fn); },
        },
        $: (sel) => (sel === "#heroVideo" ? vid160 : sel === "#heroMute" ? badge160 : null),
        hhStorageGet: (k) => (store160.has(k) ? store160.get(k) : null),
        hhStorageSet: (k, v) => store160.set(k, String(v)),
      });
      vm.runInContext(heroSrc160, ctx);
      return { vid160, badge160, store160, calls160, winL160, sim160 };
    };

    // Scenario A: fresh visitor (no saved preference), iOS refusal.
    {
      const h = mkHeroCtx160();
      await wait(20); // the refusal handler settles in microtasks
      assert(h.calls160.length === 2 && h.calls160[0].mutedAtCall === false && h.calls160[1].mutedAtCall === true, "r160 behavior: cold load attempts the audible start FIRST, then the muted retry — the hero start is attempted on load, audibly, before any fallback");
      assert(h.vid160.paused === false, "r160 behavior: after the refusal the film MOVES (muted retry) — no frozen poster on the iOS shape");
      assert(h.vid160.muted === true && h.badge160._mutedShown === true, "r160 behavior: the badge tells the truth during the fallback (muted shown while muted)");
      assert(!h.store160.has("hh_music"), "r160 behavior: the fallback never writes hh_music — the saved preference is untouched");
      // First interaction: the armed Round 125 rescue unmutes.
      h.sim160.interacted = true;
      (h.winL160.pointerdown || []).slice().forEach((fn) => fn({ target: { closest: () => null } }));
      await wait(5);
      assert(h.vid160.muted === false && h.vid160.paused === false, "r160 behavior: the first tap still turns the sound on (the Round 125 rescue is intact) and the film keeps moving");
      assert(!h.store160.has("hh_music"), "r160 behavior: even the first-tap unmute writes nothing — only the badge tap is an explicit preference");
    }

    // Scenario B: the visitor muted it themselves (hh_music=off).
    {
      const h = mkHeroCtx160({ pref: "off" });
      await wait(20);
      assert(h.calls160.length === 1 && h.calls160[0].mutedAtCall === true, "r160 behavior: a saved mute goes straight to a muted start — no audible attempt, no retry needed");
      assert(h.vid160.paused === false && h.vid160.muted === true, "r160 behavior: the muted-preference film still moves from the first start");
      assert(h.store160.get("hh_music") === "off", "r160 behavior: the saved 'off' preference stands exactly as the visitor left it");
    }

    // Scenario C: even muted autoplay is refused (Low Power Mode shape).
    {
      const h = mkHeroCtx160({ alwaysRefuse: true });
      await wait(20);
      assert(h.calls160.length === 2 && h.vid160.paused === true, "r160 behavior: when even the muted retry is refused, both rejections are swallowed and the film simply waits for a tap — no crash, no loop");
      assert(!h.store160.has("hh_music"), "r160 behavior: the double refusal still writes no preference");
    }
  }

  /* ============ §69 Round 161 — installable web app (PWA) ====
     Emil (2026-11-14): "Let's try this" — the app middle path.
     A web app manifest (crest icons generated from the flat
     gold crest: 192/512 "any", a 512 maskable with the crest
     inside the safe zone, a 180 apple-touch-icon), the iOS
     standalone meta, a deliberately conservative service
     worker (network-first HTML so a deploy is never masked;
     cache-first ONLY for ?v=-pinned assets + brand images;
     /api, media, /uploads and /moderate pass through
     untouched), and a gated Add to Home Screen hint (never
     standalone, never after dismissal, never in a first
     visit's first seconds; Chromium fires its captured
     install prompt, iOS gets the Share-sheet walkthrough,
     anything else shows nothing). Push is a separate future
     round — no push plumbing exists here. The file parts run
     on disk reads; the HTTP part rides the suite's own server;
     the gate runs the REAL client functions in a vm. */
  {
    const fs161 = fs;
    const manifestSrc161 = fs161.readFileSync(path.join(root, "public", "manifest.webmanifest"), "utf8");
    const swSrc161 = fs161.readFileSync(path.join(root, "public", "sw.js"), "utf8");
    const serverSrc161 = fs161.readFileSync(path.join(root, "server.js"), "utf8");
    const css161 = await text("/styles.css");

    // ---- Manifest: parses, required fields, icons on disk ----
    const man161 = JSON.parse(manifestSrc161);
    assert(man161.name === "HighlightHype" && man161.short_name === "HighlightHype", "r161 manifest: name + short_name are HighlightHype");
    assert(man161.start_url === "/" && man161.scope === "/" && man161.display === "standalone", "r161 manifest: start_url /, scope /, display standalone");
    assert(man161.theme_color === "#0a0a0a" && man161.background_color === "#0a0a0a", "r161 manifest: theme + background are the app black (#0a0a0a)");
    assert(man161.description === "Youth sports highlights — every athlete deserves the hype.", "r161 manifest: the one-line description");
    const pngDims161 = (buf) => [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    const iconBy161 = (sizes, purpose) => man161.icons.find((i) => i.sizes === sizes && i.purpose === purpose);
    for (const [sizes, purpose] of [["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"]]) {
      const icon = iconBy161(sizes, purpose);
      assert(icon && icon.type === "image/png", `r161 manifest: a ${sizes} "${purpose}" PNG icon is declared`);
      const file = path.join(root, "public", icon.src.replace(/^\//, ""));
      assert(fs161.existsSync(file), `r161 manifest: ${icon.src} exists on disk`);
      const [w, h] = pngDims161(fs161.readFileSync(file));
      const [ew, eh] = sizes.split("x").map(Number);
      assert(w === ew && h === eh, `r161 manifest: ${icon.src} really is ${sizes} (PNG header says ${w}x${h})`);
    }
    const appleIcon161 = fs161.readFileSync(path.join(root, "public", "icons", "apple-touch-icon.png"));
    const [aw161, ah161] = pngDims161(appleIcon161);
    assert(aw161 === 180 && ah161 === 180, "r161 icons: apple-touch-icon.png is 180x180");

    // ---- Head + markup wiring ----
    assert(home.includes('<link rel="manifest" href="/manifest.webmanifest">'), "r161 wiring: index.html links the manifest");
    assert(home.includes('<meta name="theme-color" content="#0a0a0a">'), "r161 wiring: theme-color meta ships");
    assert(home.includes('name="mobile-web-app-capable"') && home.includes('name="apple-mobile-web-app-capable"'), "r161 wiring: standalone-capable meta (modern + Apple) ships");
    assert(home.includes('name="apple-mobile-web-app-status-bar-style" content="black-translucent"') && home.includes('name="apple-mobile-web-app-title" content="HighlightHype"'), "r161 wiring: Apple status-bar style + app title ship");
    assert(home.includes('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">'), "r161 wiring: the apple-touch-icon link ships");
    assert(home.includes('id="a2hsBar161"') && home.includes('id="a2hsBtn161"') && home.includes('id="a2hsX161"') && home.includes('id="a2hsSteps161"'), "r161 wiring: the hint bar markup (bar / button / dismiss / steps) ships, hidden by default");
    assert(home.includes("Add HighlightHype to your Home Screen") && home.includes("Add to Home Screen"), "r161 wiring: the bar's line + the walkthrough's second step ship");
    assert(css161.includes(".a2hs161{") && css161.includes("body.a2hs-open161 .float-submit") && css161.includes("body.a2hs-steps161 .float-submit"), "r161 wiring: the bar styles ship, including the pill-lift rules that keep it clear of Post a Play");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r161 wiring: asset pins bumped to ?v=160 — →162: now ?v=161");

    // ---- Service worker pins ----
    assert(swSrc161.includes('const HH_SW_VERSION = "r162-v161";'), "r161 sw: the version constant HH_SW_VERSION carries the round + pin (r162-v161)");
    assert(swSrc161.includes('"hh-static-" + HH_SW_VERSION'), "r161 sw: the cache name derives from HH_SW_VERSION — one bump invalidates every old cache");
    assert(swSrc161.includes('url.pathname.startsWith("/api/")') && swSrc161.includes('url.pathname.startsWith("/moderate")') && swSrc161.includes('url.pathname.startsWith("/uploads/")'), "r161 sw: /api, /moderate and /uploads pass through untouched");
    assert(swSrc161.includes("mp4|webm|mov|m4v") && swSrc161.includes('url.origin !== self.location.origin') && swSrc161.includes('request.method !== "GET"'), "r161 sw: video files, cross-origin requests and non-GETs pass through untouched");
    assert(swSrc161.includes('request.mode === "navigate"') && swSrc161.includes("hhNetworkFirst161"), "r161 sw: navigations are network-first (a deploy can never be masked by the worker)");
    assert(swSrc161.includes("hhCacheFirst161") && swSrc161.includes("[?&]v="), "r161 sw: cache-first is reserved for ?v=-pinned assets + brand images");
    assert(swSrc161.includes("skipWaiting") && swSrc161.includes("clients.claim"), "r161 sw: the new worker activates + claims promptly (safe because HTML is network-first)");
    assert(!swSrc161.includes("PushManager") && !swSrc161.includes('addEventListener("push"') && !swSrc161.includes("showNotification"), "r161 sw: no push plumbing in this round");
    assert(appJs.includes('navigator.serviceWorker.register("/sw.js")') && appJs.includes('"serviceWorker" in navigator'), "r161 wiring: app.js registers /sw.js, feature-guarded");
    assert(appJs.includes("function registerSW161") && appJs.includes("function initA2HS161") && appJs.includes("beforeinstallprompt") && appJs.includes("appinstalled"), "r161 wiring: registration + hint init + prompt capture + appinstalled handling all ship");

    // ---- Server wiring ----
    assert(serverSrc161.includes('".webmanifest": "application/manifest+json"'), "r161 server: the MIME map serves the manifest type");
    assert(serverSrc161.includes('p === "/sw.js" || p === "/manifest.webmanifest"'), "r161 server: sw.js + the manifest opt out of long caching by name (always revalidate)");

    // ---- HTTP: the three content types + the sw cache header ----
    const head161 = async (p) => { const r = await fetch(base + p); return { status: r.status, type: r.headers.get("content-type") || "", cache: r.headers.get("cache-control") || "" }; };
    const hMan161 = await head161("/manifest.webmanifest");
    assert(hMan161.status === 200 && hMan161.type.includes("application/manifest+json"), "r161 http: /manifest.webmanifest serves 200 as application/manifest+json");
    assert(hMan161.cache.includes("no-cache"), "r161 http: the manifest revalidates (no-cache)");
    const hSw161 = await head161("/sw.js");
    assert(hSw161.status === 200 && hSw161.type.includes("javascript"), "r161 http: /sw.js serves 200 as JavaScript");
    assert(hSw161.cache.includes("no-cache"), "r161 http: sw.js carries no-cache — worker updates land promptly");
    const hIcon161 = await head161("/icons/icon-512.png");
    assert(hIcon161.status === 200 && hIcon161.type.includes("image/png"), "r161 http: the PWA icons serve 200 as image/png");
    const hApple161 = await head161("/icons/apple-touch-icon.png");
    assert(hApple161.status === 200 && hApple161.type.includes("image/png"), "r161 http: the apple-touch-icon serves 200 as image/png");

    // ---- Gate behavior (the REAL a2hsGate161, vm) ----
    const gateSrc161 = appJs.slice(appJs.indexOf("function a2hsGate161"), appJs.indexOf("function a2hsStandalone161"));
    const ctxG161 = vm.createContext({ console });
    vm.runInContext(gateSrc161 + "\n;this.__gate = a2hsGate161;", ctxG161);
    const gate161 = ctxG161.__gate;
    const baseEnv161 = { standalone: false, dismissed: false, visits: 2, elapsedMs: 30000, hasPrompt: true, isIOS: false };
    assert(gate161({ ...baseEnv161, standalone: true }) === "", "r161 gate: already standalone -> never shows");
    assert(gate161({ ...baseEnv161, dismissed: true }) === "", "r161 gate: previously dismissed -> never shows");
    assert(gate161({ ...baseEnv161, visits: 1, elapsedMs: 3000 }) === "", "r161 gate: a first visit's first seconds -> hidden");
    assert(gate161({ ...baseEnv161, visits: 1, elapsedMs: 24999 }) === "", "r161 gate: still hidden just before the ~25s mark");
    assert(gate161({ ...baseEnv161, visits: 1, elapsedMs: 25000 }) === "prompt", "r161 gate: a first visit earns the prompt variant at ~25s");
    assert(gate161({ ...baseEnv161, visits: 2, elapsedMs: 0 }) === "prompt", "r161 gate: a return visit earns the prompt variant immediately");
    assert(gate161({ ...baseEnv161, hasPrompt: false, isIOS: true }) === "ios", "r161 gate: iOS Safari (no prompt exists) gets the walkthrough variant");
    assert(gate161({ ...baseEnv161, hasPrompt: false, isIOS: false }) === "", "r161 gate: no prompt and not iOS -> shows nothing rather than dead instructions");
    assert(gate161({ ...baseEnv161, hasPrompt: true, isIOS: true }) === "prompt", "r161 gate: a real prompt beats the walkthrough when both could apply");
    assert(gate161(null) === "" && gate161({}) === "", "r161 gate: junk input degrades to hidden, never a crash");

    // ---- iOS detector (the REAL a2hsIsIOS161, vm) ----
    const iosSrc161 = appJs.slice(appJs.indexOf("function a2hsIsIOS161"), appJs.indexOf("function initA2HS161"));
    const ios161 = (ua) => { const c = vm.createContext({ console, navigator: { userAgent: ua } }); vm.runInContext(iosSrc161 + "\n;this.__f = a2hsIsIOS161;", c); return c.__f(); };
    assert(ios161("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1") === true, "r161 ios: iPhone Safari is the walkthrough audience");
    assert(ios161("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1") === false, "r161 ios: Chrome on iOS is excluded (its toolbar is not Safari's)");
    assert(ios161("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 312.0") === false, "r161 ios: the Instagram in-app browser is excluded (no Share-sheet install there)");
    assert(ios161("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36") === false, "r161 ios: Android Chrome is not the walkthrough audience");

    // ---- Registration guard (the REAL registerSW161, vm) ----
    const regSrc161 = appJs.slice(appJs.indexOf("function registerSW161"), appJs.indexOf("function a2hsGate161"));
    const regCalls161 = [];
    const ctxNoSw161 = vm.createContext({ console, navigator: {}, document: { readyState: "complete" }, window: { addEventListener() {} } });
    vm.runInContext(regSrc161, ctxNoSw161);
    assert(regCalls161.length === 0, "r161 register: no serviceWorker support -> registers nothing, throws nothing");
    const ctxSw161 = vm.createContext({ console, navigator: { serviceWorker: { register: (p) => { regCalls161.push(p); return Promise.resolve({}); } } }, document: { readyState: "complete" }, window: { addEventListener() {} } });
    vm.runInContext(regSrc161, ctxSw161);
    assert(regCalls161.length === 1 && regCalls161[0] === "/sw.js", "r161 register: with support + a loaded document, /sw.js registers exactly once");
    let loadHook161 = null;
    const ctxLoad161 = vm.createContext({ console, navigator: { serviceWorker: { register: (p) => { regCalls161.push(p); return Promise.resolve({}); } } }, document: { readyState: "loading" }, window: { addEventListener: (ev, fn) => { if (ev === "load") loadHook161 = fn; } } });
    vm.runInContext(regSrc161, ctxLoad161);
    assert(regCalls161.length === 1 && typeof loadHook161 === "function", "r161 register: mid-load, registration waits for the window load event instead of competing with first paint");
    loadHook161();
    assert(regCalls161.length === 2 && regCalls161[1] === "/sw.js", "r161 register: the load event fires the deferred registration");
  }

  /* ============ §70 Round 162 — milestone tags, the Moment
     That Mattered, and the guardian-email attach ==============
     Emil picked the A+B design on 2026-11-14: the upload asks
     "What kind of moment is this?" (five kinds, none
     pre-selected, skippable), the tag rides the cards as a
     chip, the board gains a Firsts & Milestones lane (the
     heart kinds only — big_play stays on the main board), and
     one owner-picked play is featured between the hero and
     the board with its story quoted ONLY under the play's
     story_consent flag (the Round 63 column). Feature 3 (same
     morning, from Emil's live find): play 71's guardian is
     phone-only, notify_email EMPTY, so My Plays by email
     finds nothing — the queue gains an email attach that also
     links the athlete record when its email_hash is empty. */
  {
    const { createHash } = await import("node:crypto");
    const sha70 = (s) => createHash("sha256").update(s).digest("hex");
    const norm70 = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
    const serverJs162 = fs.readFileSync(path.join(root, "server.js"), "utf8");
    const css162 = await text("/styles.css");


    // ---- Wiring: server ----
    assert(serverJs162.includes("ALTER TABLE highlights ADD COLUMN moment_kind TEXT"), "r162 wiring: the moment_kind migration ships (nullable — pre-162 plays are untagged)");
    assert(serverJs162.includes('const MOMENT_KINDS162 = ["first", "personal_best", "comeback", "big_play", "effort"]'), "r162 wiring: the five kinds are single-sourced server-side");
    assert(serverJs162.includes("moment_kind: row.moment_kind || null") && serverJs162.includes('moment_label: row.moment_kind ? (MOMENT_LABELS162[row.moment_kind] || "") : ""'), "r162 wiring: the public payload carries moment_kind + moment_label");
    assert(serverJs162.includes("const momentKind162v = momentKind162(fields.momentKind);") && serverJs162.includes("momentKind162v)"), "r162 wiring: the upload validates momentKind through the allowlist helper into the insert");
    assert(serverJs162.includes('p === "/api/owner/moment-kind"') && serverJs162.includes('"moment-kind", ownerActor152(req)'), "r162 wiring: the owner retro-tag endpoint ships, moderation-logged with the named actor");
    assert(serverJs162.includes('p === "/api/owner/spotlight"') && serverJs162.includes('p === "/api/owner/spotlight-state"') && serverJs162.includes('p === "/api/spotlight"'), "r162 wiring: the spotlight endpoints ship (owner set/state + public read)");
    assert(serverJs162.includes('SPOTLIGHT_KEY162 = "moment_spotlight162"'), "r162 wiring: the pick lives in settings under its own key");
    assert(serverJs162.includes('pub162.story = row162.story_consent ? (row162.story || "") : "";'), "r162 wiring: the public spotlight gates the story on the play's story_consent flag");
    assert(serverJs162.includes('p === "/api/owner/guardian-email"') && serverJs162.includes('"guardian-email", ownerActor152(req)'), "r162 wiring (Feature 3): the guardian-email attach endpoint ships, moderation-logged");

    // ---- Wiring: client + markup + css ----
    assert(home.includes('id="momentPickLabel"') && home.includes("What kind of moment is this? (optional)") && home.includes('name="momentKind" value=""'), "r162 wiring: the upload asks the moment question with a hidden momentKind field, empty by default");
    for (const k of ["first", "personal_best", "comeback", "big_play", "effort"]) assert(home.includes(`data-moment-pick="${k}" aria-pressed="false"`), `r162 wiring: the ${k} chip ships un-pressed (none pre-selected)`);
    assert(home.includes('id="momentCard162" hidden') && home.indexOf('id="momentCard162"') < home.indexOf('class="viewseg"'), "r162 wiring: the spotlight container sits above the pill bar, hidden until a pick is live");
    assert(home.includes('id="laneToggle162"') && home.includes("🌟 Firsts &amp; Milestones"), "r162 wiring: the lane toggle ships in the board filter bar");
    assert(home.includes('id="momentSpotlight162"') && home.includes("The story text appears only when that family gave story consent."), "r162 wiring: the panel's Moment section + its consent guidance ship");
    assert(appJs.includes('const MOMENT_HEART162 = ["first", "personal_best", "comeback", "effort"]'), "r162 wiring: the lane's heart kinds exclude big_play, client-side as specced");
    assert(appJs.includes('"/api/owner/moment-kind"') && appJs.includes('onchange="setMomentKind162('), "r162 wiring: the queue card's milestone select is wired to the retro-tag endpoint");
    assert(appJs.includes('id="gemail162-') && appJs.includes('"/api/owner/guardian-email"'), "r162 wiring (Feature 3): the queue card's guardian-email row + Save are wired to the attach endpoint");
    assert(appJs.includes("No firsts or milestones yet — they'll show up here as families post them."), "r162 wiring: the empty-lane line ships verbatim");
    assert(appJs.includes("💛 MOMENT THAT MATTERED") && appJs.includes("function renderSpotlight162()"), "r162 wiring: the homepage card renderer + its eyebrow ship");
    assert(css162.includes(".moment-chip162{") && css162.includes(".lane-chip162.on{") && css162.includes(".moment-card162{"), "r162 wiring: the chip, lane and card styles ship");
    assert(home.includes('app.js?v=161') && home.includes('styles.css?v=161'), "r162 wiring: asset pins bumped to ?v=161");

    // ---- Server validator (the REAL momentKind162, vm) ----
    const mkSrc162 = serverJs162.slice(serverJs162.indexOf("const MOMENT_KINDS162"), serverJs162.indexOf("function publicHighlight"));
    const mkCtx162 = vm.createContext({ console });
    vm.runInContext(mkSrc162 + "\n;this.__mk = momentKind162; this.__labels = MOMENT_LABELS162; this.__heart = MOMENT_HEART162;", mkCtx162);
    const mk162 = mkCtx162.__mk;
    assert(mk162("first") === "first" && mk162(" personal_best ") === "personal_best" && mk162("EFFORT") === "effort" && mk162("big_play") === "big_play" && mk162("Comeback") === "comeback", "r162 validator: every allowlist kind stores (case/space forgiven)");
    assert(mk162("huge") === null && mk162("") === null && mk162(null) === null && mk162(undefined) === null && mk162(42) === null, "r162 validator: junk, empty and missing all store NULL (untagged)");
    assert(mkCtx162.__labels.first === "🌟 First Ever" && mkCtx162.__labels.personal_best === "📈 Personal Best" && mkCtx162.__labels.comeback === "💪 Comeback" && mkCtx162.__labels.big_play === "🔥 Big Play" && mkCtx162.__labels.effort === "❤️ Great Effort", "r162 validator: the labels are the approved set");
    assert(mkCtx162.__heart.length === 4 && !mkCtx162.__heart.includes("big_play"), "r162 validator: the heart set is four kinds and big_play is not one of them");

    // ---- Live HTTP: this section's own side server (the §52+
    // pattern). The main server's upload budget (20/IP/hour,
    // in-memory) is nearly spent by the sections above — §70's
    // seven uploads would 429 there — so the live behavior
    // runs against a fresh instance with its own limits, its
    // own data dir, and an env owner token. Inside this block,
    // `j` and `tok` shadow the suite's main-server pair. ----
    const PORT162 = 3501, base162url = `http://localhost:${PORT162}`;
    const tmp162 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r162-"));
    const child162 = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT162), DATA_DIR: tmp162, OWNER_TOKEN: "env-main-secret-162" }, stdio: "pipe" });
    const j = async (p, opts = {}) => { const r = await fetch(base162url + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const tok = "env-main-secret-162";
    const ownerH162 = { "content-type": "application/json", "x-owner-token": tok };
    const db162 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp162, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
    for (let i = 0; i < 50; i++) { try { await fetch(base162url + "/api/health"); break; } catch { await wait(200); } }
    try {
    const up162 = async (fields) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.append(k, v);
      fd.append("file", new Blob([uniqPng(png)], { type: "image/png" }), "play.png");
      return j("/api/highlights", { method: "POST", body: fd });
    };
    const base162 = { sport: "baseball", division: "girls", guardianConsent: "on" };
    const a162 = await up162({ ...base162, title: "First hit after a slump", playerName: "Maya162", story: "Struck out three times, then ripped this one.", storyConsent: "on", momentKind: "first" });
    assert(a162.status === 201 && a162.body.status === "pending", "r162 upload: the tagged upload lands pending like any other");
    const b162 = await up162({ ...base162, title: "Junk kind play", playerName: "Junk162", momentKind: "hugeness" });
    const c162 = await up162({ ...base162, title: "Untagged play", playerName: "Plain162" });
    assert(b162.status === 201 && c162.status === 201, `r162 upload: the junk-kind and untagged uploads land too (got ${b162.status} ${JSON.stringify(b162.body).slice(0, 140)} / ${c162.status} ${JSON.stringify(c162.body).slice(0, 140)})`);
    for (const u of [a162, b162, c162]) { const ap = await j(`/api/highlights/${u.body.id}/status`, { method: "POST", headers: ownerH162, body: JSON.stringify({ status: "approved" }) }); assert(ap.body.status === "approved", `r162 upload: owner approval lands (play ${u.body.id} -> ${JSON.stringify(ap.body).slice(0, 140)})`); }
    const board162 = await j("/api/highlights?division=all");
    const pa162 = board162.body.highlights.find((h) => h.id === a162.body.id);
    const pb162 = board162.body.highlights.find((h) => h.id === b162.body.id);
    const pc162 = board162.body.highlights.find((h) => h.id === c162.body.id);
    assert(pa162.moment_kind === "first" && pa162.moment_label === "🌟 First Ever", "r162 upload: a valid kind reaches the public payload with its label");
    assert(pb162.moment_kind === null && pb162.moment_label === "", "r162 upload: a junk kind stores NULL — untagged, never junk-tagged");
    assert(pc162.moment_kind === null && pc162.moment_label === "", "r162 upload: no selection stores NULL (skippable means untagged)");

    // ---- Chip rendering (the REAL momentChip162 helpers, vm) ----
    const chipSrc162 = appJs.slice(appJs.indexOf("const MOMENT_LABELS162"), appJs.indexOf("function crownsHtml105"));
    const chipCtx162 = vm.createContext({ console });
    vm.runInContext(chipSrc162 + "\n;this.__chip = momentChip162; this.__chipI = momentChipInline162;", chipCtx162);
    assert(chipCtx162.__chip({ moment_kind: "comeback" }).includes("💪 Comeback") && chipCtx162.__chip({ moment_kind: "comeback" }).includes("moment-chip162"), "r162 chip: a tagged play renders its label chip");
    assert(chipCtx162.__chip({ moment_kind: null }) === "" && chipCtx162.__chip({}) === "" && chipCtx162.__chip({ moment_kind: "bogus" }) === "", "r162 chip: untagged and junk-tagged plays render NOTHING (exactly as today)");
    assert(chipCtx162.__chipI({ moment_kind: "first" }).includes("🌟 First Ever"), "r162 chip: the inline variant (rows/queue) renders too");

    // ---- Lane filtering (the REAL renderAll2, Round 10 harness shape) ----
    const laneEls162 = {};
    const laneSandbox162 = {
      window: {}, console,
      ALL_PLAYS: [
        { id: 501, title: "First Ever Play", sport: "baseball", division: "boys", player_name: "A", team: "", story: "", voteCount: 0, moment_kind: "first" },
        { id: 502, title: "Comeback Play", sport: "baseball", division: "girls", player_name: "B", team: "", story: "", voteCount: 0, moment_kind: "comeback" },
        { id: 503, title: "Big Play", sport: "baseball", division: "boys", player_name: "C", team: "", story: "", voteCount: 0, moment_kind: "big_play" },
        { id: 504, title: "Plain Play", sport: "soccer", division: "boys", player_name: "D", team: "", story: "", voteCount: 0, moment_kind: null },
      ],
      allDiv: "all", allSport: "all", allSearch: "", lane162: false,
      MOMENT_HEART162: ["first", "personal_best", "comeback", "effort"],
      $: (sel) => (laneEls162[sel] ||= { innerHTML: "", textContent: "", style: {} }),
      tileHtml: (h) => `TILE:${h.id};`,
      hydrateDurPills: () => {},
    };
    const laneBlock162 = appJs.slice(appJs.indexOf("function divMatch"), appJs.indexOf("function ", appJs.indexOf("function divMatch") + 10)) +
      appJs.slice(appJs.indexOf("function hypeFrameStrip126"), appJs.indexOf("let detailPlayId"));
    const laneCtx162 = vm.createContext(laneSandbox162);
    vm.runInContext(laneBlock162, laneCtx162);
    vm.runInContext("renderAll2()", laneCtx162);
    assert(laneEls162["#allBoard"].innerHTML.includes("TILE:503;") && laneEls162["#allBoard"].innerHTML.includes("TILE:504;"), "r162 lane OFF: every play renders, big_play and untagged included (the board as it was)");
    laneSandbox162.lane162 = true; vm.runInContext("renderAll2()", laneCtx162);
    const laneHtml162 = laneEls162["#allBoard"].innerHTML;
    assert(laneHtml162.includes("TILE:501;") && laneHtml162.includes("TILE:502;") && !laneHtml162.includes("TILE:503;") && !laneHtml162.includes("TILE:504;"), "r162 lane ON: heart kinds only — big_play and untagged fall out");
    laneSandbox162.allDiv = "girls"; vm.runInContext("renderAll2()", laneCtx162);
    assert(laneEls162["#allBoard"].innerHTML.includes("TILE:502;") && !laneEls162["#allBoard"].innerHTML.includes("TILE:501;"), "r162 lane ON: the division filter still composes (girls narrows the lane)");
    laneSandbox162.allDiv = "all"; laneSandbox162.allSport = "soccer"; vm.runInContext("renderAll2()", laneCtx162);
    assert(laneEls162["#allBoard"].innerHTML === "" && laneEls162["#allEmpty"].textContent === "No firsts or milestones yet — they'll show up here as families post them.", "r162 lane ON + no matches: the board empties and the empty-lane line shows (a state, not an error)");
    laneSandbox162.allSport = "all"; laneSandbox162.lane162 = false; vm.runInContext("renderAll2()", laneCtx162);
    assert(laneEls162["#allBoard"].innerHTML.includes("TILE:504;") && laneEls162["#allEmpty"].textContent === "No plays match — try a different board, sport, or search.", "r162 lane OFF again: the full board and the generic empty line restore");

    // ---- Retro-tag endpoint (live HTTP) ----
    const anonTag162 = await j("/api/owner/moment-kind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: c162.body.id, kind: "effort" }) });
    assert(anonTag162.status === 403, "r162 retro-tag: anonymous is refused (403)");
    const tag162 = await j("/api/owner/moment-kind", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: c162.body.id, kind: "effort" }) });
    assert(tag162.status === 200 && tag162.body.moment_kind === "effort" && tag162.body.moment_label === "❤️ Great Effort", "r162 retro-tag: the owner tags a pre-162-style play (the Nicholas's Double case)");
    const board162b = await j("/api/highlights?division=all");
    assert(board162b.body.highlights.find((h) => h.id === c162.body.id).moment_kind === "effort", "r162 retro-tag: the tag reaches the public payload");
    const junkTag162 = await j("/api/owner/moment-kind", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: c162.body.id, kind: "hugeness" }) });
    assert(junkTag162.status === 400, "r162 retro-tag: a junk kind is refused in plain words (400)");
    const clearTag162 = await j("/api/owner/moment-kind", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: c162.body.id, kind: null }) });
    assert(clearTag162.status === 200 && clearTag162.body.moment_kind === null, "r162 retro-tag: null clears the tag");
    const log162 = await j("/api/owner/moderation-log", { headers: { "x-owner-token": tok } });
    assert((log162.body.entries || []).some((e) => e.play_id === c162.body.id && e.action === "moment-kind"), "r162 retro-tag: the change is in the moderation log");

    // ---- Spotlight endpoints (live HTTP) ----
    const anonSpot162 = await j("/api/owner/spotlight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playId: a162.body.id }) });
    assert(anonSpot162.status === 403, "r162 spotlight: anonymous set is refused (403)");
    const pend162 = await up162({ ...base162, title: "Still pending play", playerName: "Pend162", story: "A story waiting on review." });
    const setPend162 = await j("/api/owner/spotlight", { method: "POST", headers: ownerH162, body: JSON.stringify({ playId: pend162.body.id }) });
    assert(setPend162.status === 400, "r162 spotlight: a PENDING play is refused — approved only");
    const sample162 = await up162({ ...base162, title: "Sample hopeful", playerName: "Samp162", story: "A sample story." });
    await j(`/api/highlights/${sample162.body.id}/status`, { method: "POST", headers: ownerH162, body: JSON.stringify({ status: "approved", sample: true }) });
    const setSample162 = await j("/api/owner/spotlight", { method: "POST", headers: ownerH162, body: JSON.stringify({ playId: sample162.body.id }) });
    assert(setSample162.status === 400, "r162 spotlight: a SAMPLE play is refused — samples can never be the pick");
    const setA162 = await j("/api/owner/spotlight", { method: "POST", headers: ownerH162, body: JSON.stringify({ playId: a162.body.id }) });
    assert(setA162.status === 200 && setA162.body.spotlight && setA162.body.spotlight.play_id === a162.body.id, "r162 spotlight: the owner sets the pick");
    const pubSpot162 = await j("/api/spotlight");
    assert(pubSpot162.body.spotlight && pubSpot162.body.spotlight.id === a162.body.id && pubSpot162.body.spotlight.moment_kind === "first", "r162 spotlight: the public read serves the pick with its tag");
    assert(pubSpot162.body.spotlight.story === "Struck out three times, then ripped this one.", "r162 spotlight CONSENT: story_consent given -> the story is quoted in the payload");
    const d162 = await up162({ ...base162, title: "Quiet milestone", playerName: "Quiet162", story: "This story has no permission.", momentKind: "effort" });
    await j(`/api/highlights/${d162.body.id}/status`, { method: "POST", headers: ownerH162, body: JSON.stringify({ status: "approved" }) });
    await j("/api/owner/spotlight", { method: "POST", headers: ownerH162, body: JSON.stringify({ playId: d162.body.id }) });
    const pubSpot162d = await j("/api/spotlight");
    assert(pubSpot162d.body.spotlight && pubSpot162d.body.spotlight.id === d162.body.id && pubSpot162d.body.spotlight.story === "" && pubSpot162d.body.spotlight.story_consent === false, "r162 spotlight CONSENT: no story_consent -> the payload carries NO story at all (not a teaser, not a truncation)");
    const state162 = await j("/api/owner/spotlight-state", { headers: { "x-owner-token": tok } });
    assert(state162.body.current && state162.body.current.play_id === d162.body.id, "r162 spotlight: the panel state names the current pick");
    const pickerIds162 = (state162.body.picker || []).map((r) => r.id);
    assert(pickerIds162.includes(a162.body.id) && pickerIds162.includes(d162.body.id) && !pickerIds162.includes(pend162.body.id) && !pickerIds162.includes(sample162.body.id) && !pickerIds162.includes(b162.body.id), "r162 spotlight: the picker holds story/tag plays only — pending, sample and bare untagged plays are out");
    await j(`/api/highlights/${d162.body.id}`, { method: "DELETE", headers: { "x-owner-token": tok } });
    const pubSpot162t = await j("/api/spotlight");
    assert(pubSpot162t.body.spotlight === null, "r162 spotlight: a trashed pick resolves to NO spotlight — the card simply vanishes");
    const clear162 = await j("/api/owner/spotlight", { method: "POST", headers: ownerH162, body: JSON.stringify({ playId: null }) });
    assert(clear162.status === 200 && clear162.body.spotlight === null, "r162 spotlight: the owner clears the pick");
    const pubSpot162c = await j("/api/spotlight");
    assert(pubSpot162c.body.spotlight === null, "r162 spotlight: no pick -> no spotlight");

    // ---- Guardian email attach (Feature 3, live HTTP + DB) ----
    const e162 = await up162({ sport: "baseball", division: "boys", guardianConsent: "on", title: "Double", playerName: "Nick162", guardianPhone: "516-555-0162", team: "Plainview Hawks" });
    await j(`/api/highlights/${e162.body.id}/status`, { method: "POST", headers: ownerH162, body: JSON.stringify({ status: "approved" }) });
    const before162 = await j(`/api/athletes/lookup?email=${encodeURIComponent("guardian162@example.com")}`);
    assert(!(before162.body.plays || []).some((p) => p.id === e162.body.id), "r162 guardian-email: BEFORE the attach, the email lookup finds nothing (the play-71 gap, reproduced)");
    const anonGe162 = await j("/api/owner/guardian-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: e162.body.id, email: "guardian162@example.com" }) });
    assert(anonGe162.status === 403, "r162 guardian-email: anonymous is refused (403)");
    const badGe162 = await j("/api/owner/guardian-email", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: e162.body.id, email: "not-an-email" }) });
    assert(badGe162.status === 400, "r162 guardian-email: an invalid email is refused in plain words (400)");
    const athId162 = db162((d) => d.prepare("SELECT athlete_id FROM highlights WHERE id=?").get(e162.body.id)).athlete_id;
    assert(db162((d) => d.prepare("SELECT email_hash FROM athletes WHERE athlete_key=?").get(athId162)).email_hash === "", "r162 guardian-email: the phone-only athlete starts with an empty email_hash");
    const ge162 = await j("/api/owner/guardian-email", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: e162.body.id, email: "Guardian162@Example.com" }) });
    assert(ge162.status === 200 && ge162.body.athleteLinked === true, "r162 guardian-email: the attach lands and links the athlete");
    const playRow162 = db162((d) => d.prepare("SELECT notify_email, notify_email_hash FROM highlights WHERE id=?").get(e162.body.id));
    assert(playRow162.notify_email === "Guardian162@Example.com" && playRow162.notify_email_hash === sha70(norm70("Guardian162@Example.com")), "r162 guardian-email: the play carries the email + sha(normIdentity(email)) — the insert's own expression");
    assert(db162((d) => d.prepare("SELECT email_hash FROM athletes WHERE athlete_key=?").get(athId162)).email_hash === sha70("guardian162@example.com"), "r162 guardian-email: the athlete's empty email_hash is set");
    const after162 = await j(`/api/athletes/lookup?email=${encodeURIComponent("guardian162@example.com")}`);
    assert((after162.body.plays || []).some((p) => p.id === e162.body.id), "r162 guardian-email: AFTER the attach, My Plays by email finds the play");
    const logGe162 = await j("/api/owner/moderation-log", { headers: { "x-owner-token": tok } });
    assert((logGe162.body.entries || []).some((e) => e.play_id === e162.body.id && e.action === "guardian-email"), "r162 guardian-email: the attach is in the moderation log");
    const geAgain162 = await j("/api/owner/guardian-email", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: e162.body.id, email: "Guardian162@Example.com" }) });
    assert(geAgain162.status === 200 && geAgain162.body.unchanged === true, "r162 guardian-email: setting the same email is a no-op success");
    db162((d) => d.prepare("UPDATE athletes SET email_hash='sentinel-hash-162' WHERE athlete_key=?").run(athId162));
    const geOther162 = await j("/api/owner/guardian-email", { method: "POST", headers: ownerH162, body: JSON.stringify({ id: e162.body.id, email: "other162@example.com" }) });
    assert(geOther162.status === 200 && geOther162.body.athleteLinked === false, "r162 guardian-email: a second attach updates the play but does NOT claim the athlete link again");
    assert(db162((d) => d.prepare("SELECT email_hash FROM athletes WHERE athlete_key=?").get(athId162)).email_hash === "sentinel-hash-162", "r162 guardian-email: an athlete's established email_hash is NEVER overwritten");
    assert(db162((d) => d.prepare("SELECT notify_email_hash FROM highlights WHERE id=?").get(e162.body.id)).notify_email_hash === sha70("other162@example.com"), "r162 guardian-email: the play's own email still updates");
    } finally { child162.kill(); try { fs.rmSync(tmp162, { recursive: true, force: true }); } catch {} }
  }

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

