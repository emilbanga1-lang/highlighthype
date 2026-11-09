// Checks for Hype Frame v1 (Emil's freeze-frame studio, 2026-11-04).
// Run: node test-hype-frame.js
// 1. The "Hype Frame" name moved OFF the swag film (hint + kicker) and
//    onto the Store section, the play cards, and the studio.
// 2. Order endpoint: approved plays only, guardian email required, print
//    image stored; status starts "pending-guardian"; no payment/price.
// 3. Guardian email never appears in any public endpoint response.
// 4. Owner endpoints: list + print image require owner auth.
// 5. Print placement (2026-11-04): the studio's drag/size placement is
//    carried on the order (defaults when unadjusted, clamped when out
//    of range), shows on the owner API, and never leaks publicly.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-hypeframe-"));
const PORT = 3461;
const base = `http://localhost:${PORT}`;
const root = new URL(".", import.meta.url).pathname;
const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp }, stdio: "pipe" });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
const text = async (p) => { const r = await fetch(base + p); return r.text(); };

const GUARDIAN = "frameguardian@example.com";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const orderPayload = (highlightId, extra = {}) => ({ highlightId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", guardianName: "Pat Parent", guardianEmail: GUARDIAN, image: PNG, ...extra });

try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const home = await text("/");
  const appJs = await text("/app.js");
  const css = await text("/styles.css");

  /* ---- 1. Naming: film vs studio ---- */
  /* Nov 5 (2026-11-05): the floating hint pill is gone — a docked
     pause/play button (#swagPauseBtn) is the film's pause control. */
  assert(!home.includes('id="swagHint"'), "floating film hint pill is gone (Nov 5)");
  assert(!home.includes('id="swagPauseBtn"') && !home.includes('id="swagVideo"'), "Round 27: the film and its docked pause/play button left the store view entirely (the Hype Frame name stays off the film — there is no film in the store)");
  assert(!home.includes("ssc-kicker"), "Round 27: the film pause card is gone from the store markup (no 'In this scene' kicker)");
  // Store v8 (2026-11-04): the creative adopted Emil's concept-poster
  // copy. Round 27 (2026-11-06): the creative panel left the store;
  // Hype Frame's store presence is the compact in-store feature,
  // and the poster tagline lives on in the studio.
  assert(home.includes('id="hsHfFeature"') && home.includes("Your Play. Your") && home.includes("Hoodie."), "Round 27: the store's Hype Frame feature carries the 'Your Play. Your Hoodie.' headline");
  for (const step of [
    "Freeze a frame from your own highlight video",
    "parent or guardian confirms by email",
    "Create a Hype Frame",
  ]) assert(home.includes(step), "Round 27 Hype Frame feature includes: " + step);
  assert(appJs.includes("Create a Hype Frame"), "play cards get a 'Create a Hype Frame' button");
  assert(home.includes('id="hypeframe"') && home.includes('id="hfVideo"') && home.includes('id="hfScrub"') && home.includes('id="hfFreeze"') && home.includes('id="hfOrderForm"'), "studio markup present (video, timeline, freeze button, order form)");
  assert(appJs.includes("/api/hype-frame/orders") && appJs.includes("composeHfPrint"), "studio wires freeze -> compose -> order request");

  /* ---- 1b. Round 2 (2026-11-05): the ENTIRE studio preview is gone ----
     Emil found the "Preview it on apparel" block too confusing: the
     garment mock, the Hoodie/T-Shirt picker, the Front/Back picker,
     the colorway swatch row and the "See it finished" row were all
     deleted. Round 3 (2026-11-05, later the same day): Emil brought
     back exactly two pickers — hoodie COLOR (button list, §7 below)
     and youth SIZE. The assertions in this section scope to the
     apparel-PREVIEW block only: the mock, the garment/side pickers
     and the finished-row stay deleted, and the old preview's element
     ids / function names (hfSwatches, hfSetColorway, …) stay gone —
     the new pickers use fresh names (hfColors, hfPickColor). The
     studio flow is now payoff -> freeze -> print style -> color/size
     -> name/number -> guardian contact -> send request; apparel and
     side still ride as fixed defaults (hoodie / front). */
  for (const gone of ["Preview it on apparel", 'id="hfAppHoodie"', 'id="hfAppTee"', 'id="hfSideFront"', 'id="hfSideBack"', 'id="hfSwatches"', 'id="hfMock"', 'id="hfPrint"', 'id="hfPrintImg"', 'id="hfPrintEmpty"', 'id="hfFinRow"', "See it finished"])
    assert(!home.includes(gone), `studio preview stays deleted: ${gone}`);
  for (const goneFn of ["function hfSetApparel", "function hfSetSide", "function hfSetColorway", "function hfSyncGarment", "function hfApplyPlacement", "function hfRenderFinished", "HF_FINISHED"])
    assert(!appJs.includes(goneFn), `preview JS stays deleted: ${goneFn}`);
  assert(!css.includes(".hf-mock{") && !css.includes(".hf-fin-row{") && !css.includes(".hf-garment{"), "preview CSS is deleted too (mock / finished-row / garment rules)");
  assert(appJs.includes('apparel: "hoodie"') && appJs.includes('side: "front"'), "studio state carries the fixed garment defaults (hoodie, front)");
  assert(appJs.includes("apparel: hfState.apparel") && appJs.includes("side: hfState.side") && appJs.includes("colorway: hfState.colorway"), "order payload still sends apparel / side / colorway (the defaults) — server contract unchanged");
  assert(appJs.includes("composeHfPrint") && appJs.includes("hfState.printDataUrl = c.toDataURL"), "the composed print is still generated client-side and carried on the order (only the on-screen preview went away)");

  // Prices exist in the Store now (Drop 001 cards, 2026-11-04) — but
  // the Hype Frame feature inside the Store stays price-free.
  const hfCreative = home.slice(home.indexOf('id="hsHfFeature"'), home.indexOf('id="quickView"'));
  assert(!hfCreative.includes("$"), "Hype Frame feature carries no price (prices live on the product cards only)");

  /* ---- setup: a pending play and an approved play ---- */
  const claim = await j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token; assert(tok, "owner claim returns token");
  const mk = async (title) => (await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) })).body.id;
  const pendingId = await mk("Pending Frame Play");
  const approvedId = await mk("Approved Frame Play");
  const appr = await j(`/api/highlights/${approvedId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(appr.body.status === "approved", "second play approved for the order tests");

  /* ---- 2. Order endpoint rules ---- */
  let r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(pendingId)) });
  assert(r.status === 404, "order for a PENDING play is rejected (404)");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(99999)) });
  assert(r.status === 404, "order for a nonexistent play is rejected (404)");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { guardianEmail: "" })) });
  assert(r.status === 400, "order without a guardian email is rejected (400)");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { guardianEmail: "not-an-email" })) });
  assert(r.status === 400, "order with a malformed guardian email is rejected (400)");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { image: "" })) });
  assert(r.status === 400, "order without a print image is rejected (400)");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId)) });
  assert(r.status === 201 && r.body.ok, "valid order request is created (201)");
  assert(r.body.status === "pending-guardian", "order starts as pending-guardian");
  assert(r.body.message === "Request received — we'll email the parent/guardian to confirm before anything is printed.", "confirmation copy matches Emil's flow (guardian confirms before printing)");
  assert(!JSON.stringify(r.body).includes(GUARDIAN), "order response does not echo the guardian email");
  const orderId = r.body.id;

  /* ---- 3. Guardian email stays out of every public response ---- */
  const pubH = await text("/api/highlights?division=all");
  assert(!pubH.includes(GUARDIAN), "guardian email absent from /api/highlights");
  const pubC = await text("/api/contest");
  assert(!pubC.includes(GUARDIAN), "guardian email absent from /api/contest");
  const pubAthlete = await text(`/api/highlights?division=all&athlete_id=whatever`);
  assert(!pubAthlete.includes(GUARDIAN), "guardian email absent from athlete collection responses");
  // The print image is NOT in the public uploads area.
  const uploadsProbe = await fetch(base + "/uploads/hf-nonexistent.png");
  assert(uploadsProbe.status === 404, "no Hype Frame image is reachable under /uploads");

  /* ---- 4. Owner endpoints ---- */
  r = await j("/api/owner/hype-frames");
  assert(r.status === 403, "owner Hype Frame list requires owner auth (403 without token)");
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  assert(r.status === 200 && r.body.requests.length === 1, "owner list returns the request with owner auth");
  const o = r.body.requests[0];
  assert(o.id === orderId && o.highlight_id === approvedId && o.guardian_email === GUARDIAN, "owner sees the request with the guardian email (owner-only)");
  assert(o.custom_name === "Nick" && o.jersey === "13" && o.branding === true && o.apparel === "hoodie" && o.colorway === "Black" && o.side === "front" && o.status === "pending-guardian", "owner sees customization + apparel + status stored correctly");
  const imgNoAuth = await fetch(base + `/api/owner/hype-frames/${orderId}/image`);
  assert(imgNoAuth.status === 403, "print image endpoint requires owner auth (403 without token)");
  const img = await fetch(base + `/api/owner/hype-frames/${orderId}/image`, { headers: { "x-owner-token": tok } });
  assert(img.status === 200 && (img.headers.get("content-type") || "").includes("image/png"), "print image serves as PNG with owner auth");
  const imgBytes = Buffer.from(await img.arrayBuffer());
  assert(imgBytes.subarray(0, 4).toString("hex") === "89504e47", "stored print image bytes are the submitted PNG");

  /* ---- 5. Placement (fixed) + look presets (2026-11-04) ----
     The studio no longer offers drag/size placement: the print always
     renders at the fixed default (50 / 42 · 78% — size raised from 66%
     on 2026-11-05, it read small/washed on the garment) and the order
     still carries those values. The server keeps accepting, storing
     and clamping placement exactly as before (round-trip checks below).
     The branding checkbox became three look presets; the frozen-frame
     box is gone (the frame shows on the garment mock only). */
  for (const id of ["hfPlace", "hfSize", "hfSizeMinus", "hfSizePlus", "hfSizeVal", "hfPlaceReset", "hfBranding", "hfStillWrap", "hfStill"]) assert(!home.includes(`id="${id}"`), `removed studio control stays gone: #${id}`);
  for (const p of ["classic", "signature", "hypeframe"]) assert(home.includes(`data-hf-preset="${p}"`), `print-style preset present: ${p}`);
  assert(home.includes('data-hf-preset="hypeframe" aria-pressed="true"'), "Hype Frame is the default preset");
  assert(home.includes('id="hfStepBack"') && home.includes('id="hfStepFwd"'), "±1s step buttons flank the Freeze button");
  /* ---- 5b. Nov 5 studio usability (2026-11-05) ----
     Big step targets + no double-tap zoom; the stray #hfPhoto box is
     hidden for video plays; a frame filmstrip under the video; and a
     "See it finished" lineup under the preview. */
  assert(css.includes(".hf-freezerow .btn{min-height:56px") && css.includes("min-width:84px"), "step buttons are big tap targets (≥56px tall, ≥84px wide)");
  assert(css.includes("touch-action:manipulation"), "studio controls opt out of double-tap zoom (touch-action: manipulation)");
  assert(/\.hf-studio img#hfPhoto\[hidden\]\s*\{\s*display:\s*none/.test(css), "the src-less studio photo is really hidden for video plays (no stray alt-text box)");
  assert(home.includes('id="hfStrip"') && appJs.includes("function hfBuildStrip") && appJs.includes("function hfJumpToFrame"), "frame filmstrip present and wired (capture → tap → seek + pause)");
  assert(!home.includes('id="hfFinRow"') && !appJs.includes("HF_FINISHED"), "Round 2: the 'See it finished' row is removed with the rest of the studio preview (finished-product examples live on the homepage instead)");
  assert(appJs.includes("size: 78") && appJs.includes("HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 78 }"), "the one shared placement default carries the raised 78% print size");
  assert(appJs.includes("function hfSetPreset") && appJs.includes('hfState.preset === "hypeframe"'), "presets drive the compose flags + the order's branding value");
  assert(!home.includes('id="hfSideFront"') && !home.includes('id="hfSideBack"'), "Round 2: the old V1 side-toggle ids stay gone (the Round 35 restore uses data-hf-side buttons instead)");
  assert(home.includes('id="hfSides"') && home.includes('data-hf-side="front"') && home.includes('data-hf-side="back"') && appJs.includes("function hfPickSide"), "Round 35: the print-side picker is restored (Front / Back, Front default) — Emil's call after the usability audit");
  assert(appJs.includes("side: hfState.side") && appJs.includes('hfPickSide("front")'), "the chosen print side rides on the order payload, reset to Front for each new play");
  assert(home.includes('id="hfImageStyles"') && home.includes('data-hf-image-style="photo"') && home.includes('data-hf-image-style="avatar"') && appJs.includes("function hfPickImageStyle"), "Round 38: the Photo or Avatar picker is in the studio (Real photo / Avatar, Real photo default) — Twinkie's feature");
  assert(appJs.includes("imageStyle: hfState.imageStyle") && appJs.includes('hfPickImageStyle("photo")'), "the chosen image style rides on the order payload, reset to Real photo for each new play");
  assert(appJs.includes('Image: ${o.image_style'), "Owner view's Hype Frame list surfaces the image style (Avatar orders must be illustrated before printing)");
  assert(home.includes("/swag/hf-poster-photo.webp") && home.includes("/swag/hf-poster-avatar.webp") && home.includes("Photo or Avatar — your pick"), "Round 39: the homepage Hype Frame section shows the concept poster both ways (photo + avatar) under the Photo-or-Avatar heading");
  assert(css.includes(".hf-swipe-wide"), "Round 39/43: the posters present as one wide swipe card (the two-up pair grid retired in Round 43)");
  for (const pth of ["/swag/hf-poster-photo.webp", "/swag/hf-poster-avatar.webp"]) {
    const ir = await fetch(base + pth);
    assert(ir.status === 200 && (ir.headers.get("content-type") || "").includes("webp"), `Round 39: poster image serves (${pth})`);
  }
  assert((home.match(/hf-example-hoodie-back-avatar\.webp/g) || []).length === 1, "Round 40/48/59: the STUDIO cream-hoodie example carries the avatar slide — the Store feature went single-photo in Round 59 per Emil's mock, and the homepage figure is the film cover since Round 48");
  assert((home.match(/data-hf-swipe/g) || []).length === 2, "Round 43/48/52/59: two swipes page-wide, both in the studio (hoodie + poster Photo/Avatar) — the Store feature went single-photo in Round 59 per Emil's mock");
  assert(appJs.includes("[data-hf-swipe]") && appJs.includes("data-hf-chip"), "Round 40: the swipe initializer wires the chips and scroll sync");
  assert(css.includes(".hf-swipe-track") && css.includes("scroll-snap-type"), "Round 40: the swipe track uses native scroll-snap");
  const avImg = await fetch(base + "/swag/hf-example-hoodie-back-avatar.webp");
  assert(avImg.status === 200 && (avImg.headers.get("content-type") || "").includes("webp"), "Round 40: the avatar hoodie example image serves");
  assert(!css.includes(".hf-example-hoodie{max-width:340px}"), "Round 41: the hoodie example card is no longer width-capped on phones — the examples stack shares one width (Emil's screenshot)");
  assert(home.includes('class="hf-example hf-hero-fig"'), "Round 44: the homepage examples are ONE hero figure (the hoodie swipe) — the Round 42 solo grid grew into the concept hero");
  const hfHomeSlice42 = home.slice(home.indexOf('id="hfExamplesHome"'), home.indexOf('id="mine"'));
  assert(!hfHomeSlice42.includes("hf-example-lineup.jpg"), "Round 42: the garment-lineup card left the HOMEPAGE examples (its range story lives in the poster pair; the card remains in the studio)");
  assert((home.match(/hf-example-lineup\.jpg/g) || []).length === 1, "Round 42: the lineup image appears exactly once on the page now (studio only)");
  assert(css.includes("#hfExamplesHome{") && css.includes("clamp(30px,5vw,44px)"), "Round 42: anchoring pass — the homepage Hype Frame block is a panelled place and its header sits at section scale");
  assert(home.includes('class="hf-swipe hf-swipe-wide"') && !home.includes("hf-poster-pair"), "Round 43: the concept posters are one Photo/Avatar swipe card, not a stacked pair");
  assert((home.match(/class="hf-swipe hs-swipe"/g) || []).length === 0, "Round 52: the store cards no longer carry Front/Back swipes (Round 43's card swipes retired — front/back live on the product page; cards lead with the back)");
  assert(appJs.includes("e.stopPropagation()"), "Round 43/52: chip clicks still stop propagation where swipes remain (studio + Store Hype Frame feature)");
  assert(css.includes("hs-img-back"), "Round 52: the back-led card image class is styled (the Round 43 card-swipe box retired with the swipes)");
  assert(css.includes(".hero h1{font-family:\"Anton\",sans-serif;font-style:italic") && css.includes(".tile-grid > .tile-featured-slot > .tile{grid-column:1/-1}"), "Round 44/54: the concept's italic display system is in, and the board's featured play (inside .tile-featured-slot) renders full-width");
  assert((home.match(/class="sp-pill" data-sp=/g) || []).length === 20, "Round 62: the sport pill bar carries All Sports + all 19 sports as pills (the Round 44 browse row's goToSportBoard buttons retired — goToSportBoard itself stays in app.js for the Fame jump and deep links)");
  assert(appJs.includes("window.seeAllPlays") && appJs.includes('`Hype of the Month`'), "Round 44/53: See all plays has its handler, and the month view titles itself Hype of the Month — all-white since Round 53 (the mock's title has no gold word)");
  assert(home.includes("not just the MVP.") && home.includes("preserve big plays and memories.") && css.includes("padding-top:30px"), "Round 44: trust descriptions are one short sentence each, and the board gets more air above it");
  assert(appJs.includes('class="tile-disc"') && appJs.includes('class="tile-toprow"') && appJs.includes("📸 Frame</button>"), "Round 45: tiles take the concept's video style — centered play disc, italic title + Vote pill row, compact 📸 Frame button");
  assert(css.includes(".tile-disc{") && css.includes(".tile-title{font-style:italic"), "Round 45: the disc and the italic tile titles are styled");
  assert(appJs.includes("tile-featured-slot") && appJs.includes("tile-deck") && css.includes(".tile-featured-slot{display:contents}") && css.includes(".tile-deck{display:contents}"), "Round 54: boardHtml wraps the first tile in .tile-featured-slot and the rest in .tile-deck; on desktop both wrappers are display:contents so the grid is unchanged");
  assert(css.includes("@media (max-width:699px)") && css.includes(".tile-featured-slot{display:block") && css.includes(".tile-deck{display:flex") && css.includes("scroll-snap-type:x mandatory") && css.includes(".tile-deck > .tile{flex:0 0 47.5%"), "Round 54: on phones the featured play sits large and static on top and the rest run smaller in a two-up swipe deck under it (supersedes Round 46's single deck)");
  assert(!home.includes('id="allSearch"') && !home.includes("All sports →") && home.indexOf('class="viewseg"') > -1 && home.indexOf('class="viewseg"') < home.indexOf('id="sportPills"') && home.indexOf('id="sportPills"') < home.indexOf('id="viewAll"') && home.indexOf('id="seeAllRow"') > home.indexOf('id="viewAll"'), "Round 47/62: the search box and All sports link stay gone; per Emil's board mock the view toggles now sit above the sport pill bar, the pills stay above the videos, and See all plays stays under the clips");
  /* ---- Round 53: board atmosphere + mock copy. ---- */
  assert(home.includes('<div class="board-bg" aria-hidden="true"></div>') && css.includes("background:url(/board-bg.jpg?v=2)"), "Round 53: the board carries the stadium backdrop (a graded frame from Emil's B15 lineup shot)");
  assert(home.includes('<p id="boardIntro">Athletes post their plays. Your votes crown the winner.</p>'), "Round 53: the board intro is the mock's short line — the one-vote-per-person tail is off");
  assert(home.includes('<h2 id="boardTitle">Hype of the Month</h2>'), "Round 53: the static board title matches the all-white month title");
  /* ---- Round 55: Rep The Hype photo band; the swag film rests. ---- */
  assert(home.includes('class="rep-band"') && home.includes("/swag/rep-hype-band.jpg") && home.includes("Shop the Drop →") && home.includes("rep-band-drop"), "Round 55: Rep The Hype is the mock's photo band — night-game photo, DROP 001 line, Shop the Drop link, whole band opens the Store");
  assert(!home.includes("swag-film.mp4") && !home.includes('class="store-card"'), "Round 55: the Drop 001 swag film is off the home page (the file stays on the server for later, per Emil) and the old film card is gone");
  /* ---- Round 57: All Hypes + Hype Frame atmospheres. ---- */
  assert(home.includes('<div class="all-bg" aria-hidden="true"></div>') && css.includes("background:url(/all-bg.jpg)"), "Round 57: All Hypes carries the Rep The Hype stadium backdrop under a soft gradient (same night-game grade as the band)");
  assert(home.includes('<div class="hf-bg" aria-hidden="true"></div>') && css.includes("background:url(/hf-bg.jpg)"), "Round 57: the homepage Hype Frame section carries the mock's warm floodlight-bokeh backdrop");
  /* ---- Round 59: the store takes Emil's photo-74 mock. ---- */
  assert((home.match(/\/swag\/hs\/night-[a-z]+\.jpg/g) || []).length === 6, "Round 59: all six hoodie cards lead with the worn night-shot photos (player from behind under the stadium lights, each sport's real back design)");
  assert(home.includes('/swag/street-sunset.jpg') && home.includes("Hot Pink returns for Drop 002."), "Round 59: the Drop 002 teaser shows the cleaned-up sunset Hot Pink photo with the mock's caption");
  assert(home.includes("<h2>Have a play to share?</h2>") && !home.includes("Hype is earned.</h2>"), "Round 60: the page closes with Emil's short 'Have a play to share?' section and its one Submit button — the video-backed band retired");
  assert(home.includes('<a href="mailto:hello@highlighthype.com">Contact</a>'), "Round 60: the footer closes with the essential links only — Contact · Terms · Privacy under the lockup and handle");
  assert(!home.includes('class="beta-note"') && home.indexOf("owner-approved before it appears") > home.indexOf('id="guidelinesModal"'), "Round 61/62: the strip above the board is gone at Emil's direction — the rules text survives ONLY inside the Posting guidelines pop-up (Round 62), nowhere above the board");
  /* ---- Round 62: the board takes Emil's header mock. ---- */
  assert(home.includes('id="sportPills"') && !home.includes('id="spMore"') && !home.includes('data-filter-btn') && home.indexOf('id="monthDivSeg"') < home.indexOf('id="boardFilters"') && home.indexOf('id="allDivSeg"') < home.indexOf('id="allFilters"'), "Round 67: pill bar scrolls sideways with no More button; no Filter buttons; each view's division seg sits visible in its board-tools row, ahead of the hidden machinery div");
  assert(home.includes('id="guidelinesModal"') && home.includes("Posting guidelines") && appJs.includes("`${filtered.length} plays`"), "Round 62: the guidelines live behind their link (the four rules in a pop-up), and the All Hypes count reads 'N plays'");
  assert(home.includes('id="hfFilmCover"') && home.includes("▶ See how it works") && home.includes('id="hfHomeFilm" data-click-play') && appJs.includes("function playHfHomeFilm()"), "Round 48: the homepage Hype Frame film is back under the cream-hoodie cover — a See how it works control, click-to-play inline, Create link directly below");
  assert(css.includes(".hf-hero-fig{max-width:none}") && css.includes("#hfExamplesHome{padding-left:0;padding-right:0"), "Round 49: sections wider and even per the mock — the Hype Frame figure spans its panel, and on phones one 16px gutter aligns every section (the HF panel drops its extra side inset)");
  assert(css.includes("section{padding:40px 0}") && home.includes('href="styles.css?v=79"') && home.includes('src="app.js?v=79"'), "Round 50/51: the section rhythm tightens toward the mock, and the CSS/JS asset URLs are versioned (bumped to v=51) so phones stop serving stale cached copies");
  /* ---- Round 51: real pages. The menu items are real URLs; the
     boot router opens the matching view in page mode; the server
     serves the app at those paths. ---- */
  const menu51 = home.slice(home.indexOf('id="navMenu"'), home.indexOf("</nav>"));
  assert(menu51.includes('href="/?view=all" id="menuAllHypes"') && menu51.includes('<a href="/my-highlights">My Highlights</a>') && menu51.includes('<a href="/how-it-works">How it works</a>') && menu51.includes('<a class="nav-swag" href="/store">'), "Round 51: the four menu items are real page links (/?view=all, /my-highlights, /how-it-works, /store)");
  assert(!menu51.includes("data-store-link") && !menu51.includes('data-panel-btn="'), "Round 51: no in-page panel/store wiring remains in the menu — the links navigate for real");
  assert(appJs.includes('bootPath === "/my-highlights"') && appJs.includes('bootPath === "/how-it-works"') && appJs.includes('bootPath === "/store"') && appJs.includes('classList.add("page-sub")'), "Round 51: the boot router opens mine/how in page mode and the store at /store");
  assert(appJs.includes('location.href = "/"; return;'), "Round 51: goHome navigates for real from a sub-page instead of switching panels under the wrong URL");
  assert(css.includes("body.page-sub .view-home{display:none}") && css.includes("body.page-sub .shop{display:none}"), "Round 51: page mode hides the home flow and the store so the panel reads as its own page");
  assert(css.includes("body.page-sub .deck.view-home{display:block}"), "Round 51b: the deck stays visible in page mode — it wraps ALL five panels, so hiding it blanked /my-highlights and /how-it-works (live-caught)");
  const pageProbe = await fetch(base + "/how-it-works");
  const pageHtml = await pageProbe.text();
  assert(pageProbe.status === 200 && pageHtml.includes('id="how"') && pageHtml.includes('id="navMenu"'), "Round 51: /how-it-works serves the app (200) — the server's index fallback covers the page routes");
  /* ---- Round 52: the store takes Emil's mobile mock — football
     hero, tiles jump to their hoodie, the hoodies header carries
     the preview status, cards lead with the back. ---- */
  const shop52 = home.slice(home.indexOf('id="shop"'), home.indexOf('id="hsView"'));
  assert(shop52.includes('class="hs-hero-img" src="/swag/hs/football-back.jpg"') && !shop52.includes("hero-model.jpg"), "Round 52: the store hero is the football hoodie back (the mock's hero), not the baseball model photo");
  assert((shop52.match(/data-hs-jump=/g) || []).length === 6 && !shop52.slice(shop52.indexOf('id="hsBySport"'), shop52.indexOf('id="hsGridSection"')).includes("data-hs-open"), "Round 52: all six Shop by Sport tiles jump to their hoodie card — none opens the product view directly");
  assert(appJs.includes("[data-hs-jump]") && appJs.includes("hs-flash"), "Round 52: the tile jump handler scrolls to the card and flashes it");
  assert(shop52.includes("Planned price: $69.99 each") && shop52.includes("Coming Soon") && !shop52.includes('id="hsChips"') && !shop52.includes('class="hs-price"'), "Round 52: the hoodies header carries COMING SOON + the planned price; the filter chips and per-card prices are gone (the product view keeps its own price)");
  const grid52 = shop52.slice(shop52.indexOf('id="hsGrid">'), shop52.indexOf('id="hsHfFeature"'));
  assert((grid52.match(/class="hs-img-back"/g) || []).length === 6 && !grid52.includes("data-hf-swipe") && !grid52.includes("hs-view-btn"), "Round 52: each card leads with its back graphic — no in-card swipe, no view button; the whole card is the tap target");
  assert(css.includes(".shop .hs-grid{grid-template-columns:repeat(2,1fr)") && css.includes(".hs-card-media{aspect-ratio:4/5}"), "Round 52: the grid runs two-up on phones and the card media is a taller back-led box");
  assert(appJs.includes("function hfGrungeFrame") && appJs.includes("function hfDrawLockup"), "Hype Frame preset composes the grunge frame + under-photo lockup (poster identity)");
  assert(!appJs.includes("hfBranding") && !appJs.includes("hfStill") && !appJs.includes("hfDrag") && !appJs.includes("hfSetPlacementSize"), "old checkbox / still box / drag + size JS are gone");
  assert(appJs.includes("placement: hfState.placement") && appJs.includes("HF_PLACEMENT_DEFAULT"), "studio sends the (fixed) default placement with the order");
  assert(appJs.includes("Placement:") && appJs.includes("% size"), "Owner view displays each request's placement for the printer");
  /* ---- 5c. Freeze confirmation (Fixes batch, 2026-11-05) ----
     Round 2 removed the studio preview, and with it the ONLY visible
     sign a freeze had worked (youth rerun: "I tapped freeze and…
     nothing"). The fix is deliberately NOT the apparel preview: a
     compact thumbnail of the COMPOSED print under the freeze row +
     the Freeze button relabels, synced from composeHfPrint — the
     single choke point that freeze, print-style presets and
     name/jersey edits all flow through — so the thumbnail always
     tracks the current print style automatically. */
  assert(home.includes('id="hfFrozenWrap"') && home.includes('id="hfFrozenImg"'), "studio carries the freeze-confirmation block (wrapper + print image)");
  assert(/<div class="hf-frozen" id="hfFrozenWrap" hidden>/.test(home), "the confirmation wrapper starts hidden (no empty box before the first freeze)");
  assert(home.includes("Your frozen frame — this is the print"), "confirmation caption: the thumbnail IS the print, not a garment mock");
  assert(/\.hf-frozen\[hidden\]\s*\{\s*display:\s*none/.test(css), "the wrapper's [hidden] state has an explicit display:none guard (the #hfPhoto lesson)");
  assert(css.includes(".hf-frozen img") && css.includes("max-height:180px"), "the confirmation thumbnail is compact (max-height 180px)");
  assert(!home.includes('id="hfFrozenMock"') && !css.includes(".hf-frozen .hf-garment"), "the confirmation is not the removed apparel preview sneaking back (no garment mock)");
  const composeBody = appJs.slice(appJs.indexOf("function composeHfPrint()"), appJs.indexOf("function hfSetPreset"));
  assert((composeBody.match(/hfSyncFrozenThumb\(\)/g) || []).length >= 2, "composeHfPrint syncs the confirmation on BOTH exits (print cleared + print composed) — the choke point");
  assert(appJs.includes("img.src = hfState.printDataUrl"), "the confirmation thumbnail shows the COMPOSED print (hfState.printDataUrl)");
  assert(appJs.includes('btn.textContent = "Frame frozen ✓ — tap to re-freeze"'), "a successful freeze relabels the Freeze button");
  assert(appJs.includes('HF_FREEZE_LABEL = "📸 Freeze this frame"') && appJs.includes("btn.textContent = HF_FREEZE_LABEL"), "the original Freeze label is restored when there is no print");
  const initBody = appJs.slice(appJs.indexOf("function initHfStudio"), appJs.indexOf("/* Frame filmstrip"));
  assert(initBody.includes("hfSyncFrozenThumb()"), "opening a new play in the studio resets the confirmation (block hidden, label restored)");
  assert((appJs.match(/if \(hfState\.frozen\) composeHfPrint\(\)/g) || []).length >= 2, "preset + name/jersey edits recompose when frozen, so the thumbnail tracks the print style on its own");
  // Unadjusted order -> studio defaults are stored.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId)) });
  assert(r.status === 201, "order without placement is created (defaults apply)");
  const defId = r.body.id;
  // Custom placement round-trips.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { placement: { cx: 35.5, cy: 60, size: 92 } })) });
  assert(r.status === 201, "order with a custom placement is created");
  const customId = r.body.id;
  // Out-of-range placement is clamped server-side.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { placement: { cx: 250, cy: -5, size: 500 } })) });
  assert(r.status === 201, "order with an out-of-range placement is created (clamped)");
  const clampedId = r.body.id;
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  const byId = (id) => r.body.requests.find((q) => q.id === id);
  const pDef = JSON.parse(byId(defId).placement);
  assert(pDef.cx === 50 && pDef.cy === 42 && pDef.size === 78, "default placement stored on an unadjusted order (50 / 42 · 78% size)");
  const pCustom = JSON.parse(byId(customId).placement);
  assert(pCustom.cx === 35.5 && pCustom.cy === 60 && pCustom.size === 92, "custom placement round-trips to the owner API exactly");
  const pClamp = JSON.parse(byId(clampedId).placement);
  assert(pClamp.cx === 100 && pClamp.cy === 0 && pClamp.size === 100, "out-of-range placement is clamped to the print-area bounds");
  /* ---- 6. Print side (Store v8, 2026-11-04) ----
     The studio's Front/Back chooser rides on the order; the server
     sanitizes anything but "back" to "front". */
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { side: "back" })) });
  assert(r.status === 201, "order with print side Back is created");
  const backId = r.body.id;
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { side: "sideways" })) });
  assert(r.status === 201, "order with a bogus print side is created (sanitized server-side)");
  const bogusSideId = r.body.id;
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  assert(byId(backId).side === "back", "chosen print side (back) round-trips to the owner API");
  assert(byId(defId).side === "front", "order without a side defaults to front");
  assert(byId(bogusSideId).side === "front", "bogus side is sanitized to front");

  /* ---- 7. Round 3 (2026-11-05): color + size pickers return; the
     studio opens with the payoff; size rides on the order ----
     Emil reversed the Round 2 simplification for exactly two fields.
     Color: a button list built from HF_COLORWAYS (default Black);
     picking one sets hfState.colorway, which drives the composed
     print's tone. Size: six youth sizes, default YM. The garment
     (hoodie) and side (front) pickers do NOT return (§1b). */
  assert(home.includes('id="hfColors"') && home.includes('id="hfSizes"'), "studio carries the color + size picker containers");
  for (const sz of ["YXXS", "YXS", "YS", "YM", "YL", "YXL"])
    assert(home.includes(`data-hf-size="${sz}"`), `size picker offers ${sz}`);
  assert(home.includes('data-hf-size="YM" aria-pressed="true"'), "YM is the pressed default size");
  assert(appJs.includes("function hfPickColor") && appJs.includes("function hfPickSize") && appJs.includes("function hfBuildColorButtons"), "picker logic present (pick color / pick size / build color buttons)");
  assert(appJs.includes("hfBuildColorButtons()") && appJs.includes("HF_COLORWAYS.hoodie"), "color buttons are built from the HF_COLORWAYS hoodie list (one source of truth)");
  assert(appJs.includes('size: "YM"') && appJs.includes("size: hfState.size"), "studio state defaults size to YM and the order payload sends the chosen size");
  assert(appJs.includes("hfState.colorway = name"), "picking a color sets hfState.colorway (the print tone follows)");
  assert(appJs.includes('Size: ${esc(o.size || "YM")}'), "Owner view's Hype Frame list surfaces the size next to the colorway");
  assert(css.includes(".hf-color{") && css.includes(".hf-size{"), "picker styles present");
  // Studio opens with the payoff (Round 3 item 5): film + examples
  // BEFORE the studio card; the freeze flow follows unchanged.
  assert(home.indexOf('class="hf-payoff"') > home.indexOf('id="hypeframe"') && home.indexOf('class="hf-payoff"') < home.indexOf('id="hfStudio"'), "the payoff block opens the studio (after the title, before the freeze card)");
  assert(home.includes("This is what your moment becomes."), "payoff line present");
  assert((home.match(/src="\/hype-frame-film\.mp4\?v=7"/g) || []).length === 2, "Round 48/58: the Hype Frame film plays in the studio payoff AND under the homepage cover (click-to-play) — srcs versioned (v=7: the video-first cut — her swing, the captured freeze, the hoodie, then the avatar morph with the choice captioned (FROM YOUR VIDEO / YOUR FRAME. YOUR HOODIE. / OR YOUR AVATAR. YOU CHOOSE.))");
  assert(home.includes('class="hf-steps"') && home.includes("Your actual image — or your avatar") && home.includes("/swag/hf-hoodie-softball.jpg"), "Round 58: the four steps live under the homepage film as page text, and the film cover is her softball hoodie");
  // Size round-trips like the print side does.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { size: "YL" })) });
  assert(r.status === 201, "order with a chosen size is created");
  const sizedId = r.body.id;
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { size: "huge" })) });
  assert(r.status === 201, "order with a bogus size is created (sanitized server-side)");
  const bogusSizeId = r.body.id;
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  assert(byId(sizedId).size === "YL", "chosen size (YL) round-trips to the owner API");
  assert(byId(defId).size === "YM", "order without a size defaults to YM");
  assert(byId(bogusSizeId).size === "YM", "bogus size is sanitized to YM");
  const pubS = await text("/api/highlights?division=all");
  assert(!pubS.includes('"size"'), "size stays off the public highlights API (owner-side field only)");

  /* ---- 8. Image style (Round 38, 2026-11-08) ----
     Twinkie's Photo-or-Avatar choice: "avatar" rides on the order and
     round-trips to the owner API; anything else sanitizes to "photo",
     and an order without the field defaults to "photo". */
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { imageStyle: "avatar" })) });
  assert(r.status === 201, "order with image style Avatar is created");
  const avatarId = r.body.id;
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { imageStyle: "cartoon" })) });
  assert(r.status === 201, "order with a bogus image style is created (sanitized server-side)");
  const bogusStyleId = r.body.id;
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  assert(byId(avatarId).image_style === "avatar", "chosen image style (avatar) round-trips to the owner API");
  assert(byId(defId).image_style === "photo", "order without an image style defaults to photo");
  assert(byId(bogusStyleId).image_style === "photo", "bogus image style is sanitized to photo");
  const pubI = await text("/api/highlights?division=all");
  assert(!pubI.includes('"image_style"'), "image style stays off the public highlights API (owner-side field only)");

  const pubH2 = await text("/api/highlights?division=all");
  assert(!pubH2.includes('"placement"'), "placement absent from the public highlights API");
  const pubC2 = await text("/api/contest");
  assert(!pubC2.includes('"placement"'), "placement absent from the public contest API");

  console.log("\nALL HYPE FRAME CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
