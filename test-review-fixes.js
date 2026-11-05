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
  // freeze-frame studio, so the film hint/kicker use the plain wording.
  // (The studio-side assertions live in test-hype-frame.js.)
  assert(home.includes("⏸ Pause to shop the look") && !home.includes("Hype Frame — pause to shop the look"), "film hint reads 'Pause to shop the look' (no Hype Frame name on the film)");
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
  assert(sceneRe("7", "boys-street").test(appJs), "scene 0–7s (Boys Street clip) maps to boys-street");
  assert(sceneRe("14", "boys-athletics").test(appJs), "scene 7–14s (Boys Athletics clip) maps to boys-athletics");
  assert(sceneRe("21", "boys-unleashed").test(appJs), "scene 14–21s (Boys Unleashed clip) maps to boys-unleashed");
  assert(sceneRe("28", "girls-street").test(appJs), "scene 21–28s (Girls Street clip) maps to girls-street");
  assert(sceneRe("Infinity", "girls-essentials").test(appJs), "scene 28s–end (Girls Essentials clip) maps to girls-essentials");
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
     quick view's swipeable gallery (§11). */
  const SLUGS = ["girls-street", "girls-athletics", "girls-essentials", "boys-street", "boys-athletics", "boys-unleashed"];
  assert((home.match(/class="prod-card"/g) || []).length === 6, "product grid has exactly 6 cards (one per collection)");
  for (const slug of SLUGS) {
    assert(home.includes(`data-slug="${slug}"`), `grid card present: ${slug}`);
    assert(!home.includes(`/swag/${slug}-front.jpg`) && !home.includes(`/swag/${slug}-back.jpg`), `card ${slug} references no worn photo (garment-only product views)`);
    for (const kind of ["front", "back"]) {
      assert(home.includes(`/swag-boards/${slug}-${kind}.svg`), `card ${slug} shows the garment ${kind} illustration`);
      const r = await fetch(`${base}/swag-boards/${slug}-${kind}.svg`);
      const buf = await r.arrayBuffer();
      assert(r.status === 200 && buf.byteLength > 3000, `board illustration serves and is non-trivial: /swag-boards/${slug}-${kind}.svg (${buf.byteLength} bytes)`);
    }
  }
  assert(home.includes("/swag-boards/"), "Store cards use the flat garment board illustrations");
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

  /* ---- 6. Store film hero: full-bleed cinematic, music, no button ----
     Emil (2026-11-04, with Overtime shop screenshots): the film leads
     the Store as an edge-to-edge autoplay hero — bold italic title,
     underlined Shop Girls / Shop Boys link-buttons, no native controls.
     Tonight batch: the round pause/play button is REMOVED (tapping the
     film pauses for pause-to-shop), the film carries the homepage
     music bed (probed in §8), and the photo nav tiles became the
     division blocks' banner headers (§5/§8). */
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
  assert(appJs.includes("sv.muted = false"), "entering the Store attempts an unmuted (music) start, first-tap fallback");
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
  assert(filmDur > 34 && filmDur < 36, `the film still runs ~35s (${filmDur}s — five 7.0s scenes; scene 1 is now the blue-sky Boys Street clip)`);
  const filmStreams = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", filmFile]).toString();
  assert(filmStreams.includes("video") && filmStreams.includes("audio"), "the film now carries the homepage music bed (audio stream present)");
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
  assert(css.includes(".swag-film-hero .swag-film-badge{top:82px") && css.includes(".swag-film-hero .swag-film-hint{top:82px"), "film badge + hint pill drop below the floating nav line (no logo overlap)");
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
  assert(heroDur > 12.5 && heroDur < 13.6, `hero runs ~13.1s after the recut (${heroDur}s — 9.08s montage, logo ending cut, + 4.0s golf close)`);

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
  assert(/body\.store-open\[data-store-focus="boys"\] \.shop,\s*body\.store-open\[data-store-focus="girls"\] \.shop\{padding-top:calc\(var\(--navh,70px\) \+ 12px\)\}/.test(css), "focus mode pads the shop below the floating nav band, so the exit pill is fully mouse-clickable (v8 root-cause fix)");
  assert(!/\.store-focusbar\{[^}]*padding:12px 64px/.test(css) && css.includes("scroll-margin-top:calc(var(--navh,70px) + 8px)"), "the ineffective 64px focusbar padding hack is gone; scroll margin kept");
  assert(appJs.includes("sharePlay(${h.id}, this)") && appJs.includes("Link copied ✓") && appJs.includes("share-copied"), "share fallback flips the clicked button to 'Link copied ✓' (impossible-to-miss confirmation)");

  /* ---- 11. Store v8: quick-view gallery + Overtime card rhythm ----
     Emil (2026-11-04): products bigger, colorways scrollable, no
     models in product views; card anatomy matched to Overtime (image
     dominant, one badge, name + price + size run, no prose chrome).
     The gallery frames are build-time recolors of the board SVGs —
     garment body recolored per colorway, print art unchanged. */
  assert(appJs.includes("QV_PRODUCTS") && appJs.includes("qvSyncGallery") && appJs.includes("/swag/qv/"), "quick view is driven by per-product colorway gallery data");
  assert(!home.includes("qv-media") && !/id="qv(Front|Back|Flat)"/.test(home), "quick view has no worn-photo figures or static colorway strip left");
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

  console.log("\nALL REVIEW-FIX CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
