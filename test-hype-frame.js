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
  // →128: an order WITHOUT a print image is no longer rejected
  // (400) — it is saved with the image marked missing. The case
  // itself is asserted in §9 below, so this section's first valid
  // order stays the owner list's only request in §4.
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
  assert(!home.includes("/swag/hf-poster-photo.webp") && !home.includes("/swag/hf-poster-avatar.webp") && !home.includes("Photo or Avatar — your pick"), "Round 39→127: the concept-poster marketing section is OUT of the studio (Emil: the studio opens at the tool; the marketing lives in the Store feature) — the working Photo/Avatar picker above is the choice now");
  assert(css.includes(".hf-swipe-wide"), "Round 39/43: the posters present as one wide swipe card (the two-up pair grid retired in Round 43)");
  for (const pth of ["/swag/hf-poster-photo.webp", "/swag/hf-poster-avatar.webp"]) {
    const ir = await fetch(base + pth);
    assert(ir.status === 200 && (ir.headers.get("content-type") || "").includes("webp"), `Round 39: poster image serves (${pth})`);
  }
  assert((home.match(/hf-example-hoodie-back-avatar\.webp/g) || []).length === 0, "Round 40/48/59→127: the studio hoodie example (and its avatar slide) is removed — the studio opens at the freeze tool now; the asset still serves (asserted below) for the Store feature");
  assert((home.match(/data-hf-swipe/g) || []).length === 0, "Round 43/48/52/59→127: no Photo/Avatar swipes remain page-wide — both lived in the studio payoff stack, which Round 127 removed (the swipe initializer in app.js is inert without roots)");
  assert(appJs.includes("[data-hf-swipe]") && appJs.includes("data-hf-chip"), "Round 40: the swipe initializer wires the chips and scroll sync");
  assert(css.includes(".hf-swipe-track") && css.includes("scroll-snap-type"), "Round 40: the swipe track uses native scroll-snap");
  const avImg = await fetch(base + "/swag/hf-example-hoodie-back-avatar.webp");
  assert(avImg.status === 200 && (avImg.headers.get("content-type") || "").includes("webp"), "Round 40: the avatar hoodie example image serves");
  assert(!css.includes(".hf-example-hoodie{max-width:340px}"), "Round 41: the hoodie example card is no longer width-capped on phones — the examples stack shares one width (Emil's screenshot)");
  assert(!home.includes('hf-hero-fig'), "Round 44→125: the homepage examples' hero figure is GONE — Round 125 removes the homepage Hype Frame section entirely (the studio keeps its own examples)");
  assert(home.indexOf('id="hfExamplesHome"') === -1, "Round 42→125/127: there is no homepage examples block, and the garment-lineup card left the studio too in Round 127 (studio opens at the tool)");
  assert((home.match(/hf-example-lineup\.jpg/g) || []).length === 0, "Round 42→127: the lineup image is gone from the page (it lived only in the studio payoff stack; the file still serves for the Store feature)");
  assert(css.includes("#hfExamplesHome{") && css.includes("clamp(30px,5vw,44px)"), "Round 42: anchoring pass — the homepage Hype Frame block is a panelled place and its header sits at section scale");
  assert(!home.includes('class="hf-swipe hf-swipe-wide"') && !home.includes("hf-poster-pair"), "Round 43→127: the concept-poster swipe card is removed with the studio payoff stack (neither the swipe nor the old stacked pair remains)");
  assert((home.match(/class="hf-swipe hs-swipe"/g) || []).length === 0, "Round 52: the store cards no longer carry Front/Back swipes (Round 43's card swipes retired — front/back live on the product page; cards lead with the back)");
  assert(appJs.includes("e.stopPropagation()"), "Round 43/52: chip clicks still stop propagation where swipes remain (studio + Store Hype Frame feature)");
  assert(css.includes("hs-img-back"), "Round 52: the back-led card image class is styled (the Round 43 card-swipe box retired with the swipes)");
  assert(css.includes(".hero h1{font-family:\"Anton\",sans-serif;font-style:italic") && css.includes(".tile-grid > .tile-featured-slot > .tile{grid-column:1/-1}"), "Round 44/54: the concept's italic display system is in, and the board's featured play (inside .tile-featured-slot) renders full-width");
  const ddOpts190 = [...home.matchAll(/<option value="([a-z-]+)">/g)].length;
  assert((home.match(/<option value=/g) || []).length >= 20 && home.includes('<select class="sport-select board-sport-select125" id="boardSportSelect"'), "Round 62→125: the board sport control is a DROPDOWN carrying All Sports + all 19 sports (the pill bar retired in Round 125 — goToSportBoard itself stays in app.js for the Fame jump and deep links)");
  assert(appJs.includes("window.seeAllPlays") && appJs.includes('`Hype of the Month`'), "Round 44/53: See all plays has its handler, and the month view titles itself Hype of the Month — all-white since Round 53 (the mock's title has no gold word; Round 125 removed the static h2 the title used to mirror)");
  assert(home.includes("not just the MVP.") && home.includes("preserve big plays and memories.") && css.includes("padding-top:30px"), "Round 44: trust descriptions are one short sentence each, and the board gets more air above it");
  assert(appJs.includes('class="tile-disc"') && appJs.includes('class="tile-toprow"') && appJs.includes("📸 Frame</button>"), "Round 45: tiles take the concept's video style — centered play disc, italic title + Vote pill row, compact 📸 Frame button");
  assert(css.includes(".tile-disc{") && css.includes(".tile-title{font-style:italic"), "Round 45: the disc and the italic tile titles are styled");
  assert(appJs.includes("tile-featured-slot") && appJs.includes("tile-deck") && css.includes(".tile-featured-slot{display:contents}") && css.includes(".tile-deck{display:contents}"), "Round 54: boardHtml wraps the first tile in .tile-featured-slot and the rest in .tile-deck; on desktop both wrappers are display:contents so the grid is unchanged");
  assert(css.includes("@media (max-width:699px)") && css.includes(".tile-featured-slot{display:block") && css.includes(".tile-deck{display:flex") && css.includes("scroll-snap-type:x mandatory") && css.includes(".tile-deck > .tile{flex:0 0 47.5%"), "Round 54: on phones the featured play sits large and static on top and the rest run smaller in a two-up swipe deck under it (supersedes Round 46's single deck)");
  assert(!home.includes('id="allSearch"') && !home.includes("All sports →") && home.indexOf('class="viewseg"') > -1 && home.indexOf('class="viewseg"') < home.indexOf('id="boardSportSelect"') && home.indexOf('id="boardSportSelect"') < home.indexOf('id="viewAll"') && home.indexOf('id="seeAllRow"') > home.indexOf('id="viewAll"'), "Round 47/62→125: the search box and All sports link stay gone; the view toggles sit above the sport DROPDOWN, the dropdown stays above the videos, and See all plays stays under the clips");
  /* ---- Round 53: board atmosphere + mock copy. ---- */
  assert(home.includes('<div class="board-bg" aria-hidden="true"></div>') && css.includes("background:url(/board-bg.jpg?v=6)"), "Round 53 + Round 88: the board carries the stadium backdrop (a graded frame from Emil's B15 lineup shot; R88 warmed the grade and softened it over the graphite wash)");
  assert(!home.includes('id="boardIntro"'), "Round 53→125: the board intro line left with the .sec-head block — the board opens straight at the contest line and filters now (Dyanna's board-first homepage)");
  const playsSlice201 = home.slice(home.indexOf('data-panel="plays"'), home.indexOf('id="boardFilters"'));
  assert(!home.includes('id="boardTitle"') && !playsSlice201.includes('class="sec-head"'), "Round 53→125: the board's static title and its .sec-head band are gone from the plays panel (other panels keep their own sec-heads; the Month view still titles itself in app.js)");
  /* ---- Round 55: Rep The Hype photo band; the swag film rests. ---- */
  assert(!home.includes('class="rep-band"') && home.includes('id="merchTeaser125"') && home.includes("Open the full store"), "Round 55→125→126: the Rep The Hype photo band retired — the homepage store entry is the price-free merch teaser now (products, names only, a full-store link; Round 126: the teaser notify form is gone and the sweatshirt cards default to their back view with the store's Front/Back switch)");
  assert(!home.includes("swag-film.mp4") && !home.includes('class="store-card"'), "Round 55: the Drop 001 swag film is off the home page (the file stays on the server for later, per Emil) and the old film card is gone");
  /* ---- Round 57: All Hypes + Hype Frame atmospheres. ---- */
  assert(home.includes('<div class="all-bg" aria-hidden="true"></div>') && css.includes("background:url(/all-bg.jpg)"), "Round 57: All Hypes carries the Rep The Hype stadium backdrop under a soft gradient (same night-game grade as the band)");
  assert(!home.includes('class="hf-bg"'), "Round 57→125: the homepage Hype Frame section and its floodlight-bokeh backdrop are gone with the section (the studio carries its own atmosphere)");
  /* ---- Round 59: the store takes Emil's photo-74 mock. ---- */
  assert(["baseball","basketball","football","soccer","softball","volleyball"].every((sp) => home.includes("/swag/hs/night-" + sp + ".jpg")), "Round 59: all six hoodie cards lead with the worn night-shot photos (player from behind under the stadium lights, each sport's real back design) — Round 78: the desktop store hero reuses night-football, so the check is per-sport presence, not a raw count");
  assert(home.includes('/swag/street-sunset.jpg') && home.includes("Hot Pink returns for Drop 002."), "Round 59: the Drop 002 teaser shows the cleaned-up sunset Hot Pink photo with the mock's caption");
  assert(home.includes("<h2>Have a play to share?</h2>") && !home.includes("Hype is earned.</h2>"), "Round 60: the page closes with Emil's short 'Have a play to share?' section and its one Submit button — the video-backed band retired");
  assert(home.includes('<a href="mailto:hello@highlighthype.com">Contact</a>'), "Round 60: the footer closes with the essential links only — Contact · Terms · Privacy under the lockup and handle");
  assert(!home.includes('class="beta-note"') && home.indexOf("owner-approved before it appears") > home.indexOf('id="guidelinesModal"'), "Round 61/62: the strip above the board is gone at Emil's direction — the rules text survives ONLY inside the Posting guidelines pop-up (Round 62), nowhere above the board");
  /* ---- Round 62: the board takes Emil's header mock. ---- */
  assert(home.includes('id="boardSportSelect"') && !home.includes('id="sportPills"') && !home.includes('id="spMore"') && !home.includes('data-filter-btn') && home.indexOf('id="monthDivSeg"') < home.indexOf('id="boardFilters"') && home.indexOf('id="allDivSeg"') < home.indexOf('id="allFilters"'), "Round 67→125: the sport DROPDOWN replaced the pill bar (no More button, no Filter buttons); each view's division seg sits visible in its board-tools row, ahead of the hidden machinery div");
  assert(home.includes('id="guidelinesModal"') && home.includes("Posting guidelines") && appJs.includes("`${filtered.length} plays`"), "Round 62: the guidelines live behind their link (the four rules in a pop-up), and the All Hypes count reads 'N plays'");
  assert(appJs.includes('window.openGuidelines = () => { const m = $("#guidelinesModal"); if (!m) return; if (m.parentElement !== document.body) document.body.appendChild(m); m.hidden = false; };'), "Round 101: opening Posting guidelines hoists the modal to <body>, out of the transformed #plays stacking context that let Hype Stories paint over it");
  assert(!home.includes('id="hfFilmCover"') && !home.includes('id="hfHomeFilm"') && !appJs.includes("function playHfHomeFilm()"), "Round 48→125: the homepage Hype Frame film and its cream-hoodie cover left with the section — the hype-frame film still plays in the store + studio, and the mid-feed banner carries the concept on the homepage");
  assert(css.includes(".hf-hero-fig{max-width:none}") && css.includes("#hfExamplesHome{padding-left:0;padding-right:0"), "Round 49: the section-width rules stay in the stylesheet (harmless now that the homepage figure is gone — Round 125 removes markup, not the design system)");
  assert(css.includes("section{padding:40px 0}") && home.includes('href="styles.css?v=161"') && home.includes('src="app.js?v=161"'), "Round 50/51: the section rhythm tightens toward the mock, and the CSS/JS asset URLs are versioned (bumped along each round; v147 for Round 148, →148; v148 for Round 149; v149 for Round 150; →151: v150 for Round 151; →152: v151 for Round 152); →153: v152 for Round 153; →154: v153 for Round 154 so phones stop serving stale cached copies — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");
  assert((home.match(/onclick="openHfChoice\(\);return false"/g) || []).length === 2 && appJs.includes('closest("[data-hf-start]")'), "Round 103→125: the two remaining Hype Frame entry anchors (store hero + Hype Girls door) carry the parse-time inline opener AND app.js delegates [data-hf-start] taps at document level — the homepage section's third anchor left with the section; the menu entry and the mid-feed banner wire in app.js");
  /* ---- Round 51: real pages. The menu items are real URLs; the
     boot router opens the matching view in page mode; the server
     serves the app at those paths. ---- */
  const menu51 = home.slice(home.indexOf('id="navMenu"'), home.indexOf("</nav>"));
  assert(menu51.includes('href="/?view=all" id="menuAllHypes"') && menu51.includes('<a href="/my-highlights">My Plays</a>') && menu51.includes('<a href="/how-it-works">How it works</a>') && menu51.includes('<a href="/stories">Hype Stories</a>') && menu51.includes('<a class="nav-swag" href="/store">'), "Round 51/108: the menu items are real page links (/?view=all, /my-highlights, /how-it-works, /store) — Round 108 added Hype Stories (/stories) as a fifth; Round 121 renamed My Highlights to My Plays (URL unchanged)");
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
  assert(/<div class="hf-frozen" id="hfFrozenWrap" hidden/.test(home), "the confirmation wrapper starts hidden (no empty box before the first freeze) — →128: it also carries role/tabindex as the print lightbox's tap target");
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
  assert(!home.includes('class="hf-payoff"') && home.indexOf('id="hfStudio"') > home.indexOf('id="hypeframe"'), "Round 3→127: the payoff block no longer opens the studio — the freeze card is the studio's first major section (Emil: remove the marketing material from the frame flow)");
  assert(!home.includes("This is what your moment becomes."), "Round 3→127: the payoff line is gone with its block");
  assert((home.match(/src="\/hype-frame-film\.mp4\?v=7"/g) || []).length === 1, "Round 48/58/83→127: the Hype Frame film now plays ONLY in the store feature (Round 83, Emil) — the studio payoff copy left in Round 127 (the homepage feed strip builds its own film element from app.js) — src versioned (v=7: the video-first cut — her swing, the captured freeze, the hoodie, then the avatar morph with the choice captioned (FROM YOUR VIDEO / YOUR FRAME. YOUR HOODIE. / OR YOUR AVATAR. YOU CHOOSE.))");
  assert(home.includes("hf-steps") && home.includes("Your actual image — or your avatar") && home.includes("/swag/hf-hoodie-softball.jpg"), "Round 58→125: the four steps live under the STORE film as page text now (the homepage film left with its section in Round 125), and the softball hoodie still illustrates the concept");
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

  // Round 91 (2026-11-10): Hype Battles board view.
  assert(home.includes('data-view="battles"') && home.includes('id="viewBattles"') && home.includes('id="btlPlayer"') && home.includes("Which Play Wins?") && home.includes('id="quickTitle111">Quick Battles</p>') && !home.includes("hit replay"), "Round 91/102/111: the board gains a Battles view with the tested matchup layout; 'Which Play Wins?' stays the Daily headline and the endless pairs are 'Quick Battles' (Round 111)");
  assert(css.includes(".btl-mini") && css.includes(".btl-pick"), "Round 91: battles styles ship in styles.css");
  assert(home.includes('>Watch</button>') && !home.includes('data-view="fame"') && (home.match(/month-subseg/g) || []).length >= 2 && home.indexOf('id="sportPills"') < home.indexOf('id="monthDivSeg"') && home.indexOf('id="monthDivSeg"') < home.indexOf('id="viewMonth"') && home.includes("Sample highlights for now"), "Round 94: three tabs (Watch / Battles / Hype of the Month) with the Hall of Fame as the Month tab's All-time sub-view, division segs riding the pill row, and a one-line sample note");
  assert(appJs.includes("monthSub") && appJs.includes("setMonthSub") && !appJs.includes("trustMove95") && home.indexOf('class="final view-home"') < home.indexOf('class="trust view-home"') && home.indexOf('class="trust view-home"') < home.indexOf("<footer") && css.includes(".sp-divseg[hidden]"), "Round 94: switchView drives the sub-view and seg visibility, the trust strip re-rows below the deck on phones, and hidden segs stay hidden");
  assert(css.includes("overflow-x:clip"), "Round 96: horizontal overflow is clipped at the root so the page cannot pan sideways (the crest bleed ran 42px wide)");
  assert(appJs.includes('currentView === "month" && monthSub === "fame"'), "Round 95: a sport pill tapped in the All-time sub-view jumps to Watch filtered by that sport, like the old Fame tab");
  assert(appJs.includes("function btlMiniFrame") && appJs.includes("data-btl-media111") && appJs.includes("btlObtainMedia111") && appJs.includes("btlPlaceholderPoster111"), "Round 93/111: battle minis briefly play muted and freeze on a real frame instead of sitting black — since Round 111 they render as media slots filled with session-pooled <video> elements that always carry a poster (captured frame, else a branded placeholder)");
  assert(!home.includes('id="btlPoolNote"') && home.includes('id="quickSub111"') && home.includes("Practice matchup · Picks are just for fun") && !home.includes("Sample pool") && !home.includes('id="btlPractice"') && !home.includes("same-sport matchups"), "Round 92/102/111: the Daily keeps its one short practice label; the Battles pool note is retired in Round 111 — the Quick Battles sub-line is the single explainer, no fine print, no second note at the pick row");

  /* ---- Round 127 (2026-11-13, Emil's phone review): the studio
     opens at the tool, one tap picks a frame, and no play button
     covers the frame. Behavioral proof (real taps in a browser)
     lives in ~/workspace/.pwtest/rig127.mjs; these are the static
     DOM/wiring facts. ---- */
  const hfPanel127 = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('data-panel="how"'));
  assert(!hfPanel127.includes("hf-payoff") && !hfPanel127.includes("hf-examples") && !hfPanel127.includes("hf-film") && !hfPanel127.includes("example finishes") && !hfPanel127.includes("concept poster"), "Round 127: the studio panel carries NO payoff stack — no film, no example finishes, no concept-poster section");
  const hfHead127 = hfPanel127.indexOf('class="sec-head"'), hfCard127 = hfPanel127.indexOf('id="hfStudio"');
  assert(hfHead127 !== -1 && hfCard127 > hfHead127 && !hfPanel127.slice(hfHead127, hfCard127).includes("<figure") && !hfPanel127.slice(hfHead127, hfCard127).includes("<video"), "Round 127: between the studio header and the freeze card there is nothing promotional — the freeze tool is the first major section");
  assert(hfPanel127.includes('id="hfImageStyles"') && hfPanel127.includes('data-hf-image-style="avatar"') && hfPanel127.includes('id="hfSides"') && hfPanel127.includes('id="hfOrderForm"'), "Round 127: the working controls survive the cleanup — Photo/Avatar picker, Front/Back picker, order form");
  assert(/<video id="hfVideo" playsinline preload="metadata"><\/video>/.test(home) && !/<video id="hfVideo"[^>]*\bcontrols\b/.test(home), "Round 127: the studio video has NO native controls (iOS's center play button covered the frame)");
  assert(home.includes('id="hfVideoWrap127"') && home.includes('id="hfBigPlay127"') && home.includes('id="hfPlayBtn127"') && home.includes('id="hfTapFlash127"'), "Round 127: custom player chrome is in the markup (wrap, first-play overlay, scrub-row play/pause, tap flash)");
  assert(appJs.includes("function hfTogglePlay127") && appJs.includes("function hfResetPlayer127") && appJs.includes("hfPlayed127") && appJs.includes('addEventListener("play"'), "Round 127: player chrome wiring — overlay retires on first play, surface toggles, per-play reset");
  assert(css.includes(".hf-bigplay127") && css.includes(".hf-bigplay127[hidden]{display:none}") && css.includes(".hf-tapflash127") && css.includes(".hf-playbtn127"), "Round 127: player chrome styles ship, with the explicit [hidden] guard on the overlay");
  assert(appJs.includes("function hfCapturePrint") && appJs.includes("hfTapToken127"), "Round 127: the capture choke point + tap token exist for one-tap frame picking");
  const hfJump127 = appJs.slice(appJs.indexOf("function hfJumpToFrame"), appJs.indexOf("function hfFmtTime"));
  assert(hfJump127.includes("hfCapturePrint()") && hfJump127.includes('addEventListener("seeked"'), "Round 127: hfJumpToFrame completes the pick — seek, then capture+compose on seeked (one tap = the frame is the print)");
  assert(appJs.includes("Freeze a frame first"), "Round 127: the Freeze button path still guards orders (one-tap pick feeds the same frozen state)");

  /* ---- 9. Round 128 (2026-11-13, Emil): tap the composed print
     to see it big, and the order keeps its print image without
     ever being LOST to a bad one. The lightbox's real-tap
     behavior is proven in ~/workspace/.pwtest/rig128.mjs; these
     are the static wiring facts + the order-endpoint contract.
     Pre-128 the endpoint REJECTED (400) any order whose image
     was missing/invalid and capped it at 25MB; now the cap is
     5MB and every image problem degrades to "saved, image
     missing" (print_image = ""), logged server-side. ---- */
  assert(home.includes('id="hfLightbox128"') && home.includes('id="hfLightboxImg128"') && home.includes('id="hfLightboxClose128"'), "Round 128: the print lightbox is in the markup (overlay + enlarged image + close button)");
  assert(home.includes("Tap to see it bigger") && home.includes("hf-frozen-zoom128"), "Round 128: the frozen confirmation carries the enlarge hint (⤢ chip) so the tap is discoverable");
  assert(appJs.includes("function hfOpenLightbox128") && appJs.includes("function hfCloseLightbox128") && appJs.includes('addEventListener("click", hfOpenLightbox128)'), "Round 128: lightbox wiring — ONE click on the frozen print opens it (no second tap, per Emil's Round 127 fix)");
  assert(appJs.includes("im.src = hfState.printDataUrl"), "Round 128: the lightbox reads the current composition at open time (reopening after a name/preset edit shows the new print)");
  assert(css.includes(".hf-lightbox128") && css.includes(".hf-lightbox128[hidden]{display:none}"), "Round 128: lightbox styles ship with the explicit [hidden] guard");
  assert(appJs.includes("Download print image") && appJs.includes('download="hypeframe-order-'), "Round 128: the Owner view carries a Download print image action per request, saved under the hypeframe-order-<id>.png name Emil's iPhone workflow expects");
  // No image at all (the legacy client path): the order is SAVED.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { image: "" })) });
  assert(r.status === 201 && r.body.imageSaved === false, "→128: an order without a print image is SAVED (201) with the image marked missing — pre-128 it was rejected (400)");
  const noImgId = r.body.id;
  // Malformed payloads: saved too, never a lost order.
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { image: "https://example.com/not-a-data-url.png" })) });
  assert(r.status === 201 && r.body.imageSaved === false, "Round 128: an order with a malformed image payload is saved, image missing");
  const badImgId = r.body.id;
  const gifUrl = "data:image/png;base64," + Buffer.from("GIF89a-not-a-png").toString("base64");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { image: gifUrl })) });
  assert(r.status === 201 && r.body.imageSaved === false, "Round 128: an order with a non-PNG payload is saved, image missing");
  // Oversized (over the 5MB cap, valid PNG magic): saved too.
  const bigBuf = Buffer.alloc(5 * 1024 * 1024 + 1024, 7); Buffer.from([0x89, 0x50, 0x4e, 0x47]).copy(bigBuf, 0);
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId, { image: "data:image/png;base64," + bigBuf.toString("base64") })) });
  assert(r.status === 201 && r.body.imageSaved === false, "Round 128: an order with an over-cap image is saved, image missing (5MB cap, →128 from 25MB)");
  // Missing-image orders read back honestly; the download 404s.
  r = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  for (const id of [noImgId, badImgId]) {
    const row = r.body.requests.find((q) => q.id === id);
    assert(row && row.print_image === "", `Round 128: order ${id} is on file with print_image = "" (marked missing)`);
    const dl = await fetch(base + `/api/owner/hype-frames/${id}/image`, { headers: { "x-owner-token": tok } });
    assert(dl.status === 404, `Round 128: the download for a missing-image order 404s cleanly (order ${id})`);
    const dlAnon = await fetch(base + `/api/owner/hype-frames/${id}/image`);
    assert(dlAnon.status === 403, `Round 128: the download still requires owner auth (order ${id})`);
  }
  // With-image order: the owner download returns the EXACT bytes.
  const pngBytes = Buffer.from(PNG.split(",")[1], "base64");
  r = await j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(orderPayload(approvedId)) });
  assert(r.status === 201 && r.body.imageSaved === true, "Round 128: an order with a valid print image reports imageSaved");
  const dlImg = await fetch(base + `/api/owner/hype-frames/${r.body.id}/image`, { headers: { "x-owner-token": tok } });
  const dlBytes = Buffer.from(await dlImg.arrayBuffer());
  assert(dlImg.status === 200 && dlBytes.equals(pngBytes), "Round 128: the owner download returns the EXACT bytes the studio submitted");
  const dlCd = dlImg.headers.get("content-disposition") || "";
  assert((dlImg.headers.get("content-type") || "").includes("image/png") && dlCd.includes("attachment") && dlCd.includes(`hypeframe-order-${r.body.id}.png`), "Round 128: the download is iPhone-clean — image/png + attachment disposition with the hypeframe-order-<id>.png filename (Emil grabs it on his phone for the avatar workflow)");

  console.log("\nALL HYPE FRAME CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
