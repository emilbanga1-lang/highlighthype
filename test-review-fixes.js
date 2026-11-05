// Checks for Emil's 2026-11-04 site-review fixes. Run: node test-review-fixes.js
// 1. Sport pills are dynamic (rendered from the sports present in data).
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
     questions (name, Boys/Girls toggle, sport pills, optional title),
     everything else in a collapsed "Add more (optional)" section — all
     with the SAME field names/payload as the wizard had. */
  for (const f of FIELDS) assert((home.split(`name="${f}"`).length - 1) === 1, `field name="${f}" appears exactly once in the quick form`);
  assert(!home.includes("form-step") && !home.includes('id="uploadProgress"') && !home.includes('id="upNext"') && !home.includes('id="upBack"') && !appJs.includes("showUploadStep") && !appJs.includes("validUploadStep"), "the 3-step wizard is gone (steps, progress chrome, nav buttons, wizard JS)");
  assert(home.includes("Tap to pick a clip from your camera roll"), "dropzone leads with the phone-first camera-roll copy (drag & drop still offered)");
  assert(!home.includes("MOV") && !home.includes("most reliably"), "the MP4/.MOV warning text is removed entirely");
  assert(home.includes('id="dzPreview"') && home.includes('id="dzVideo"') && appJs.includes("Your clip is in") && appJs.includes("createObjectURL"), "a picked clip previews playing in the dropzone with a '✓ Your clip is in' state");
  assert(home.includes('data-div-pick="boys"') && home.includes('data-div-pick="girls"') && home.includes('name="division" value="boys"') && appJs.includes("setDivPick"), "Boys/Girls big toggle writes the division field (default Boys)");
  assert((home.match(/data-sport-pick=/g) || []).length === 12 && home.includes('name="sport" value=""') && appJs.includes("setSportPick"), "sport is one-tap pills (12 sports, same list/order as the old select) writing the sport field");
  assert(home.includes("What happened? (optional)") && appJs.includes("'s highlight`"), "the title is one optional 'What happened?' line; blank auto-fills as <Name>'s highlight at submit");
  const moreAt = home.indexOf("Add more (optional)");
  assert(moreAt > -1 && home.includes('class="quick-more"'), "'Add more (optional)' collapsed section present");
  for (const f of ["playType", "story", "jersey", "team", "notifyEmail", "guardianPhone", "textConsent"]) assert(home.indexOf(`name="${f}"`) > moreAt, `optional field lives inside Add more: ${f}`);
  assert(home.includes("Add a parent/guardian contact so we can reach you if this play wins — winners are featured on our socials."), "guardian-contact line sits under the optional section (featured framing, no prize promise)");
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

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

