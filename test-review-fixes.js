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
  fd.append("guardianConsent", "on");
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
  assert(!home.includes('data-store-target="hype-boys"') && !home.includes('data-store-target="hype-girls"') && home.includes('class="rep-band"'), "Round 55: the homepage store entry is the Rep The Hype photo band — the old card's Hype Boys/Girls quick links left with the card (divisions are entered inside the Store)");
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
  assert(home.includes('href="/logo-header-gold.png"'), "logo preload points at the crest header lockup (Round 19; Round 97: right-sized copy; Round 114: metallic gold master art)");
  assert((home.split('src="/logo-header-gold.png"').length - 1) === 1, "header uses the horizontal crest lockup (Round 19; Round 97: right-sized copy; Round 114: metallic gold master art)");
  assert(home.includes('src="/logo-lockup-gold.jpg"'), "footer uses the full lockup with tagline (Round 19; Round 65: Emil's metallic gold master)");
  assert(home.includes('href="/favicon.ico"') && home.includes('href="/favicon.png"'), "favicon is the gold crest badge (Round 19)");
  const logoRes = await fetch(`${base}/logo-header-gold.png`);
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
  assert(home.includes('id="hfExamplesHome"') && !home.includes('id="hfExamples"'), "homepage Hype Frame examples strip present (hfExamplesHome); Round 27: the store's gated #hfExamples copy left with the hypeframe focus panel");
  assert(home.includes("/swag/hf-example-hoodie-back.jpg") && home.includes("/swag/hf-example-lineup.jpg"), "examples strip uses the two poster crops");
  assert(home.includes("Pick a moment. Put it on a hoodie."), "Round 44: the homepage Hype Frame head carries the concept line (the old made-from-your-own-play caption retired with the concept rebuild)");
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
     mid-flow. The API contract is unchanged. ---- */
  const enterBlock = appJs.slice(appJs.indexOf("const ENTER_MSGS"), appJs.indexOf("window.reportPlay"));
  assert(enterBlock.includes("window.enterContest") && enterBlock.includes("submitContestEntry"), "enter flow block located (enterContest + submitContestEntry)");
  assert(!enterBlock.includes("confirm(") && !enterBlock.includes("alert("), "the enter path uses NO native dialogs (confirm/alert gone from the whole enter flow)");
  assert(appJs.includes('onclick="enterContest(${h.id}, this)"'), "the Enter button still calls enterContest from the card");
  assert(appJs.includes('class="card-msg"') && appJs.includes("data-enter-msg"), "cards render the per-card enter message slot");
  assert(appJs.includes("ENTER_MSGS.get(h.id)") && appJs.includes("ENTER_MSGS.has(h.id)"), "cardHtml renders the slot from ENTER_MSGS (re-render safe, exactly one slot per card)");
  assert(enterBlock.includes("can't be featured yet") && enterBlock.includes("parent/guardian email or mobile number on file") && enterBlock.includes("It can still collect votes"), "the no-guardian prompt explains the rule inline, in plain words (Round 9: email OR mobile)");
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
      { id: 41, hasGuardianEmail: false, hasGuardianText: false, hasGuardianPhone: false },
      { id: 42, hasGuardianEmail: true, hasGuardianText: false, hasGuardianPhone: false },
      { id: 43, hasGuardianEmail: true, hasGuardianText: false, hasGuardianPhone: false },
      { id: 44, hasGuardianEmail: false, hasGuardianText: false, hasGuardianPhone: true },
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
  await enterSandbox.window.enterContest(44);
  assert(enterCalls.length === 4 && enterCalls[3].body.highlightId === 44, "behavioral (Round 9): a PHONE-ONLY play enters directly — email OR mobile satisfies the featured rule, no prompt");
  assert(enterMsgOf(44).includes("You're in — good luck!") && !enterMsgOf(44).includes("Enter anyway"), "behavioral (Round 9): the phone-only enter lands the success message, never the no-guardian prompt");

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
  const playsIdx = home.indexOf('data-panel="plays"'), mineIdx = home.indexOf('data-panel="mine"'), exIdx = home.indexOf('id="hfExamplesHome"');
  assert(playsIdx > -1 && exIdx > playsIdx && exIdx < mineIdx, "homepage examples block sits inside the plays panel (before My Highlights)");
  const exSlice = home.slice(exIdx, mineIdx);
  assert(exSlice.includes("hype-frame-film.mp4") && exSlice.includes("hf-hero-fig") && exSlice.includes("See how it works"), "Round 44/48: the homepage Hype Frame section is ONE hero figure — since Round 48 it carries the film under the cream-hoodie cover (click-to-play)");
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
    appJs.slice(ddStart, appJs.indexOf("/* ---------------- Swag film", ddStart));
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
  assert(playA && playA.hasGuardianEmail === false && playA.hasGuardianText === false && playA.hasGuardianPhone === false, "Round 6: the no-guardian play reports no guardian contact on file (Round 9: hasGuardianPhone false too)");
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
    f.append("guardianConsent", "on");
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
    assert(html8.includes('<div class="tile-grid" id="board"></div>') && html8.includes('<div class="tile-grid" id="allBoard"></div>'), "Round 8: both board lists are tile grids");
    assert(html8.includes('<div class="board" id="athleteBoard"></div>'), "Round 8: the athlete board keeps the full-card .board grid (athlete pages are NOT tiled)");
    assert(html8.includes('id="playDetail"') && html8.includes('id="playDetailBody"') && html8.includes("data-detail-close") && html8.includes("← Back"), "Round 8: the play-detail overlay markup is present with a ← Back close affordance");
    assert(css8.includes(".tile-grid{display:grid;grid-template-columns:repeat(2,1fr)") && css8.includes(".play-detail{position:fixed") && css8.includes(".play-detail[hidden]{display:none}") && css8.includes("body.detail-open{overflow:hidden}"), "Round 8: tile-grid (2 per phone row) and detail-overlay CSS are in place");
    assert(css8.includes(".board{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}"), "Round 8: the .board card grid CSS is untouched (athlete pages)");

    // Wiring: both board renders use tiles; the athlete page still
    // renders full cards; the default rule runs inside loadData
    // before the first render; panel navigation hides the detail;
    // the hashchange route forces a fresh #play- routing.
    const monthBlock8 = appJs.slice(appJs.indexOf("function renderMonth"), appJs.indexOf("function fameThumbHtml"));
    assert(monthBlock8.includes("tileHtml(h, { monthVotes: h.voteCount })") && !monthBlock8.includes("cardHtml(h"), "Round 8: the Month board renders tiles (podium above it unchanged)");
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
      { id: 101, title: "Big Play", sport: "baseball", division: "boys", athlete_label: "Jayden", player_name: "Jayden", media_kind: "file", media_url: "/uploads/a.mp4", mime: "video/mp4", voteCount: 5, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, created_at: "2026-11-05T00:00:00Z" },
      { id: 102, title: "Voted Play", sport: "softball", division: "girls", athlete_label: "Maya", player_name: "Maya", media_kind: "file", media_url: "/uploads/b.png", mime: "image/png", voteCount: 9, hasVoted: true, isSample: false, isWinner: false, prizeEligible: true, created_at: "2026-11-05T00:00:00Z" },
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
    assert(t1.includes("Big Play") && t1.includes("Baseball") && t1.includes("Boys") && t1.includes("Jayden"), "Round 8: a tile shows title, sport · division and the athlete's name");
    assert(t1.includes('class="vote-chip vote-chip-btn"') && t1.includes("👑 Vote · <b>5</b>") && t1.includes('onclick="event.stopPropagation();toggleVote(101, this)"') && t1.includes('aria-pressed="false"'), "Round 8/108: the tile's gold chip is a REAL vote button again — Round 107's watch-view-only voting is reversed at Emil's direction ('How do they vote now?'); the chip votes in place via the same toggleVote as the watch view, its click stopped so it never also opens the watch view");
    assert(!t1.includes("enterContest("), "Round 8: tiles carry no Enter affordance (Enter lives on the full card in the detail)");
    const t2 = r8("tileHtml(ALL_PLAYS[1])");
    assert(t2.includes("<img") && t2.includes('class="vote-chip vote-chip-btn voted"') && t2.includes("👑 Voted · <b>9</b>") && t2.includes('aria-pressed="true"') && t2.includes("toggleVote(102"), "Round 8/45/108: an image tile shows the photo, and its chip renders the VOTED state on the tile itself (tap removes the vote — the same toggle)");
    const t3 = r8("tileHtml(ALL_PLAYS[2])");
    assert(t3.includes("⭐ SAMPLE PLAY") && !t3.includes("enterContest(") && !t3.includes("toggleVote(") && t3.includes('class="vote-chip"'), "Round 8/108: a sample tile carries the SAMPLE badge, no Enter affordance, and the display-only count chip — samples never get a vote control");
    const t4 = r8("tileHtml(CONTEST.entries[0], { monthVotes: 7 })");
    assert(t4.includes("<b>7</b>") && t4.includes("this month"), "Round 8: a Month-board tile shows the month vote count");

    // Detail: the FULL card, with the play's own context.
    r8("window.openPlayDetail(101)");
    assert(r8Wrap.hidden === false && r8("detailPlayId") === 101 && r8Classes.has("detail-open"), "Round 8: openPlayDetail shows the overlay for the tapped play");
    assert(r8BodyEl.innerHTML.includes('data-play-id="101"') && r8BodyEl.innerHTML.includes("enterContest(101, this)"), "Round 8: the detail holds the FULL card — Enter present for a non-sample play");
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
  // (4) Enter flow guard is email-OR-phone now (behavior in §14).
  assert(appJs.includes("!play.hasGuardianEmail && !play.hasGuardianPhone"), "Round 9: the enter prompt fires only when NEITHER guardian email nor mobile is on file");
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
  const en9 = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: stripId, period: prevPeriod9 }) });
  assert(en9.status === 201 && en9.body.ok, "Round 9: the play enters LAST month's contest (explicit period)");
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
  const monthFiltersHtml10 = home.slice(home.indexOf('id="boardFilters"'), home.indexOf('id="board"'));
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
    appJs.slice(appJs.indexOf("function renderAll2"), appJs.indexOf("let detailPlayId"));
  assert(r10Block.includes("function renderAll2") && r10Block.includes("function divMatch") && !r10Block.includes("teamFilter"), "Round 10: renderAll2 test block located (divMatch + renderAll2, no team wiring inside)");
  const r10Ctx = vm.createContext(r10Sandbox);
  vm.runInContext(r10Block, r10Ctx);
  vm.runInContext("renderAll2()", r10Ctx);
  assert(r10Els["#allBoard"].innerHTML === '<div class="tile-featured-slot">TILE:12;</div><div class="tile-deck">TILE:14;TILE:15;TILE:99;</div>' && r10Els["#allCount"].textContent === "4 plays", "behavioral (Round 10/62): with no team filter, team-tagged AND untagged plays all render — the board behaves as team='all' (count format is Round 62's 'N plays')");
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
    assert(home.includes(`data-sp="${s}"`), `Round 10/62: the ${s} pill sits in the sport pill bar (the goToSportBoard browse row retired in Round 62)`);
  }
  assert(home.includes("Filter plays by sport") && home.includes("See all plays →") && !home.includes("All sports →"), "Round 44/47/62: See all plays sits under the clips; the sports sit above the videos (the pill bar since Round 62) and the All sports link is gone");
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
  assert(home.includes('data-sp="baseball"') && css.includes(".montage video{pointer-events:none}"), "Round 11/62: the sport filter lives on the pill bar now (was the browse row; the montage retired in Round 44, its CSS stays harmless)");
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
  assert(headerBlock26.includes("Swag Shop — Rep The Hype") && home.includes("Shop the Drop"), "Round 11→12/55: the ☰ menu entry keeps its wording, and the homepage store entry is the Rep The Hype band whose call is Shop the Drop — they carry the store now (§27 drives their handler)");
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
  const upMod26 = async (title) => { const f = new FormData(); f.append("title", title); f.append("sport", "baseball"); f.append("division", "boys"); f.append("playerName", "Mod"); f.append("guardianConsent", "on"); f.append("file", new Blob([png26], { type: "image/png" }), "play.png"); const r = await j("/api/highlights", { method: "POST", body: f }); assert(r.status === 201 && r.body.status === "pending", `Round 11: moderation fixture uploads pending (${title})`); return r.body.id; };
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
  assert(storeAnchors27.length === 1 && storeAnchors27.some((a) => a.includes("rep-band")), "Round 12/51/55/60: exactly one data-store-link anchor remains — the Rep The Hype band (the footer Store line left in Round 60 per Emil's bottom-of-page mock; the ☰ menu entry is the real /store page link since Round 51)");
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
     section and the per-play page are untouched. ---- */
  const serverJs28 = fs.readFileSync(path.join(root, "server.js"), "utf8");
  assert(serverJs28.includes('"approve", "approve_sample", "hide", "delete"'), "Round 13: POST /moderate accepts delete alongside approve / approve_sample / hide (same action list, same token gate)");
  const modPostBlock28 = serverJs28.slice(serverJs28.indexOf('p === "/moderate" && req.method === "POST"'), serverJs28.indexOf('p === "/moderate-queue"'));
  assert(modPostBlock28.includes('action === "delete"') && modPostBlock28.includes("DELETE FROM highlights WHERE id=?") && modPostBlock28.includes("DELETE FROM votes WHERE highlight_id=?") && modPostBlock28.includes("DELETE FROM contest_entries WHERE highlight_id=?") && modPostBlock28.includes("DELETE FROM hype_frame_orders WHERE highlight_id=?") && modPostBlock28.includes("fs.unlinkSync(path.join(UPLOAD_DIR, path.basename(before.media_url)))") && modPostBlock28.includes("fs.unlinkSync(path.join(HYPEFRAME_DIR, path.basename(o.print_image)))") && modPostBlock28.includes("moderateDeletedPage(before.title, token)"), "Round 13: the delete branch mirrors the owner DELETE cleanup exactly — media unlink, print-image unlinks, orders, play, votes, contest entries — and answers with the by-title confirmation page");
  assert(serverJs28.includes('moderateQueuePage(rows, token, "", liveRows)') && serverJs28.includes("WHERE status='approved' ORDER BY id DESC") && serverJs28.includes("<h2>Live on the board</h2>") && serverJs28.includes("Yes, delete permanently") && serverJs28.includes('name="confirm" value="yes" required'), "Round 13: the queue route fetches the approved plays and the page renders the 'Live on the board' section with the required confirm checkbox on the delete form");
  const modDb28 = (fn) => { let lastErr; for (let i = 0; i < 20; i++) { try { const d = new DatabaseSync(path.join(tmp, "highlighthype.db")); try { return fn(d); } finally { d.close(); } } catch (e) { lastErr = e; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100); } } throw lastErr; };
  const png28 = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");
  const upMod28 = async (title) => { const f = new FormData(); f.append("title", title); f.append("sport", "hockey"); f.append("division", "boys"); f.append("playerName", "Queue"); f.append("guardianConsent", "on"); f.append("file", new Blob([png28], { type: "image/png" }), "play.png"); const r = await j("/api/highlights", { method: "POST", body: f }); assert(r.status === 201 && r.body.status === "pending", `Round 13: queue fixture uploads pending (${title})`); return r.body.id; };
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
  const enter28 = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: victimId28 }) });
  assert(enter28.status === 201, "Round 13: the delete victim carries a real contest entry into the delete");
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
  assert(liveSection28.includes('value="hide"') && liveSection28.includes(">Hide</button>") && liveSection28.includes('value="delete"') && liveSection28.includes(">Delete</button>") && liveSection28.includes('name="confirm" value="yes" required') && liveSection28.includes("Yes, delete permanently"), "Round 13: each Live row carries BOTH forms — Hide, and Delete armed by the required 'Yes, delete permanently' checkbox");
  assert(!liveSection28.includes("Queue Pending Play") && pendingSection28.includes("Queue Pending Play") && pendingSection28.includes('value="approve_sample"'), "Round 13: the pending play stays in the pending section only (with its Approve as Sample play form) — it is NOT listed as live");
  // Gate + unknown id: same pages as every other action.
  const badDel28 = await modPost28({ id: String(victimId28), token: "definitely-wrong", action: "delete", confirm: "yes" });
  assert(badDel28.status === 403 && badDel28.body.includes("Moderation link not valid"), "Round 13: delete with an invalid token 403s on the same page as the other actions");
  const survivor28 = modDb28((d) => d.prepare("SELECT status FROM highlights WHERE id=?").get(victimId28));
  assert(survivor28 && survivor28.status === "approved", "Round 13: the rejected delete changed nothing — the play is still live");
  const ghost28 = await modPost28({ id: "999999", token: modToken28, action: "delete", confirm: "yes" });
  assert(ghost28.status === 404 && ghost28.body.includes("Play not found"), "Round 13: deleting a nonexistent id gets the same 404 page as the other actions");
  // The delete itself: confirm page by title, then total cleanup.
  const del28 = await modPost28({ id: String(victimId28), token: modToken28, action: "delete", confirm: "yes" });
  assert(del28.status === 200 && del28.body.includes("Play deleted") && del28.body.includes("Queue Delete Victim"), "Round 13: the delete answers with a confirmation page naming the deleted play by title");
  const gone28 = modDb28((d) => ({
    play: d.prepare("SELECT COUNT(*) c FROM highlights WHERE id=?").get(victimId28).c,
    votes: d.prepare("SELECT COUNT(*) c FROM votes WHERE highlight_id=?").get(victimId28).c,
    entries: d.prepare("SELECT COUNT(*) c FROM contest_entries WHERE highlight_id=?").get(victimId28).c,
    orders: d.prepare("SELECT COUNT(*) c FROM hype_frame_orders WHERE highlight_id=?").get(victimId28).c,
  }));
  assert(gone28.play === 0 && gone28.votes === 0 && gone28.entries === 0 && gone28.orders === 0, "Round 13: the delete removed the play row, its votes, its contest entries AND its Hype Frame orders — the full mirrored cleanup");
  assert(!fs.existsSync(victimFile28) && !fs.existsSync(printFile28), "Round 13: the delete unlinked the uploaded media file and the Hype Frame print image from disk");
  const pub28 = await j("/api/highlights?division=all");
  assert(!pub28.body.highlights.some((h) => h.id === victimId28), "Round 13: the deleted play no longer appears in the public API");
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
    assert(!appJs.includes("viewCount") && !appJs.includes("onended"), "Round 14/15: no view-count field is read or invented anywhere, and autoplay-advance (Round 15) listens via addEventListener — no inline onended attribute exists");
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
    assert(tAll14.includes("Sofia · Soccer · Girls · <b>3</b> all-time votes · 2d ago"), "Round 14/45: the info line is ONE merged line — '<first name> · <sport> · <division> · <N> votes · <age>' from API fields only");
    assert(tMonth14.includes("Sofia · Soccer · Girls · <b>7</b> this month votes · 2d ago"), "Round 14/45: on the Month board the merged line carries the MONTH vote count");
    assert(tAll14.includes("Sofia · Soccer · Girls"), "Round 45: sport and division live inside the single info line now (the separate Sport · Division line retired)");
    const tOne14 = r14("tileHtml(ALL_PLAYS[2])");
    assert(tOne14.includes("Ava · ") && tOne14.includes("<b>1</b> all-time vote · 3w ago"), "Round 14/45: the merged info line singularizes '1 vote' and humanizes weeks");
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
  assert(home.includes("I'm this athlete's parent/guardian, or I have their permission to post this video."), "Round 21: the attestation label is the exact approved copy");
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
  fNo31.append("file", new Blob([png], { type: "image/png" }), "play.png");
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
  fYes31.append("file", new Blob([png], { type: "image/png" }), "play.png");
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
    fOld31.append("file", new Blob([png], { type: "image/png" }), "play.png");
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
  assert(fab32.includes('aria-label="Submit a Hype — go to the upload form"'), "Round 22: the FAB keeps its accessible name ('Submit a Hype — go to the upload form')");
  assert(fab32.includes("<svg") && fab32.includes('d="M12 5v14"') && fab32.includes('d="M5 12h14"') && fab32.includes('class="float-submit-label">Submit a Hype</span>'), "Round 22/23: the FAB carries a plus icon and the full label span (the pill's text on desktop, hidden on phones; plus supersedes the upload arrow — §33)");
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
  assert(hero32.includes('<p class="hero-sub">HighlightHype is where young athletes become the highlight.</p>'), "Round 22: the hero paragraph is exactly Emil's one line");
  assert(!hero32.includes("hero-tagline") && !hero32.includes("The home of youth sports culture. Big plays."), "Round 22: the hero tagline element and the old multi-sentence paragraph are gone from the hero");
  assert(hero32.includes("Watch Highlights") && hero32.includes('data-submit-link') && hero32.includes('id="heroVideo"'), "Round 22: the hero keeps its headline, both CTAs and the film (Round 30 replaced the playback controls — see the next assertion)");
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
  assert(fab33.includes('<span class="float-submit-short">Post</span>'), "Round 23: the FAB carries the short 'Post' label span next to the full label");
  assert(fab33.includes('aria-label="Submit a Hype — go to the upload form"'), "Round 23: the FAB's accessible name is unchanged");
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
  const hfAt35 = home.indexOf('id="hfExamplesHome"');
  assert(boardAt35 > -1 && underAt35 > boardAt35 && hfAt35 > underAt35, "Round 44: document order is board -> See all/Browse block -> Hype Frame section");
  assert(home.includes("See all plays →") && home.includes('id="sportPills"') && !home.includes("All sports →"), "Round 44/47/62: under the clips sits See all plays; the sports live in the pill bar above the videos (the Browse by Sport row retired in Round 62), All sports link removed");

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
  const kept38 = ['id="menuAllHypes"', 'href="/my-highlights"', 'href="/how-it-works"', 'href="/stories"', "Swag Shop — Rep The Hype"];
  const keptIdx38 = kept38.map((m) => menu38.indexOf(m));
  assert(keptIdx38.every((v) => v > -1), "Round 29/108: the menu keeps All Hypes, My Highlights, How It Works, Hype Stories and Swag Shop — Rep The Hype");
  assert(keptIdx38.every((v, i) => i === 0 || v > keptIdx38[i - 1]), "Round 29/108: the five kept menu items appear in the approved order");
  assert((menu38.match(/<a /g) || []).length === 5 && !menu38.includes("<button"), "Round 51/108: the menu contains EXACTLY five entries — all real page links, no buttons (Round 108 added /stories to the Round 51 four)");
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
  const hfHome39 = home.slice(home.indexOf('id="hfExamplesHome"'), home.indexOf('data-panel="mine"'));
  assert(hfHome39.includes('class="hf-create-link"') && hfHome39.includes('data-hf-start') && !hfHome39.includes('data-tablink') && hfHome39.includes(">Create a Hype Frame →<"), "Round 86 (supersedes Round 32/44): the homepage Hype Frame section's Create CTA opens the choice card (data-hf-start) — the Round 32 trip to the board was the compromise this replaces");
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

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

