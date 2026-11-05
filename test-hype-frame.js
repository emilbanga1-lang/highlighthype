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
  assert(home.includes('id="swagPauseBtn"') && home.includes("Pause the film"), "film carries the docked pause/play button (no Hype Frame name on the film)");
  const kicker = (home.match(/<p class="ssc-kicker">([^<]*)<\/p>/) || [])[1] || "";
  assert(kicker === "In this scene", "film pause-card kicker is exactly 'In this scene'");
  // Store v8 (2026-11-04): the creative adopts Emil's concept-poster
  // copy — the tagline "Turn your highlight into wearable hype." as
  // the headline and the three VIDEO / FRAME / WEAR IT beats in place
  // of the five-step line (the studio itself keeps the full flow).
  assert(home.includes('class="hf-creative"') && home.includes("Turn your highlight") && home.includes("into wearable hype."), "Store creative headline is the poster tagline");
  for (const step of [
    "Video",
    "Wear It",
    "Upload your highlight",
    "Choose your frame",
    "Printed on your gear",
  ]) assert(home.includes(step), "Store creative VIDEO / FRAME / WEAR IT beat includes: " + step);
  assert(appJs.includes("Create a Hype Frame"), "play cards get a 'Create a Hype Frame' button");
  assert(home.includes('id="hypeframe"') && home.includes('id="hfVideo"') && home.includes('id="hfScrub"') && home.includes('id="hfFreeze"') && home.includes('id="hfOrderForm"'), "studio markup present (video, timeline, freeze button, order form)");
  assert(appJs.includes("/api/hype-frame/orders") && appJs.includes("composeHfPrint"), "studio wires freeze -> compose -> order request");

  /* ---- 1b. Apparel preview: BOTH garment branches show the print ----
     Regression (2026-11-04 live bug): the T-Shirt preview showed the
     hoodie carrying the print above a plain tee. Root cause: the author
     rule .hf-garment{display:block} outranks the UA [hidden]{display:none},
     so hfSetApparel's hidden toggling never hid either garment — both
     SVGs stacked and the shared print overlay landed on the hoodie in
     both modes. Fix: .hf-garment[hidden]{display:none}.
     Regression 2 (2026-11-04, after the placement build): switching
     apparel updated aria-pressed, data-apparel and the placement, but
     the garment graphic stayed on the hoodie. Root cause: hfSetApparel
     toggled visibility via the `hidden` IDL *property* on the two
     garment SVGs — on SVG elements that property does not reliably
     reflect to the `hidden` content attribute, so the attribute (the
     only thing the CSS rule keys off) never changed and the initial
     markup state (hoodie shown, tee hidden) persisted. Fix: toggle the
     attribute itself with toggleAttribute(), which is an Element
     method and works on SVG elements in every engine. */
  assert(/\.hf-garment\[hidden\]\s*\{\s*display:\s*none/.test(css), "inactive garment is actually hidden (.hf-garment[hidden]{display:none} present)");
  for (const a of ["hoodie", "tee"]) {
    const rule = new RegExp(`\\.hf-mock\\[data-apparel="${a}"\\] \\.hf-print\\s*\\{[^}]*left:[^}]*top:[^}]*width:`);
    assert(rule.test(css), `${a} branch positions the shared print layer in its chest print area`);
  }
  for (const a of ["hoodie", "tee"]) {
    const backRule = new RegExp(`\\.hf-mock\\[data-apparel="${a}"\\]\\[data-side="back"\\] \\.hf-print\\s*\\{[^}]*left:`);
    assert(backRule.test(css), `${a} back-side print area is positioned (upper back)`);
  }
  assert(appJs.includes("function hfSyncGarment"), "one garment sync drives all four garment SVGs (apparel x print side)");
  for (const [cls, cond] of [["hf-garment-hoodie-front", '!(a === "hoodie" && s === "front")'], ["hf-garment-hoodie-back", '!(a === "hoodie" && s === "back")'], ["hf-garment-tee-front", '!(a === "tee" && s === "front")'], ["hf-garment-tee-back", '!(a === "tee" && s === "back")']])
    assert(appJs.includes(`$(".${cls}").toggleAttribute("hidden", ${cond})`), "garment sync toggles the hidden ATTRIBUTE: " + cls);
  assert(!appJs.includes('$(".hf-garment-hoodie-front").hidden =') && !appJs.includes('$(".hf-garment-tee-front").hidden ='), "garment sync does not rely on the hidden IDL property for the garment SVGs (it does not reflect to the attribute on SVG elements)");
  assert(appJs.includes('$("#hfMock").dataset.apparel = a'), "apparel switch sets the mock's data-apparel so the matching print-area rule applies");
  assert(appJs.includes('$("#hfMock").dataset.side = s'), "garment sync sets the mock's data-side so the matching back print-area rule applies");
  assert((home.match(/id="hfPrint"/g) || []).length === 1, "exactly one shared print layer serves both garments");
  const mockHtml = home.slice(home.indexOf('id="hfMock"'), home.indexOf('id="hfOrderForm"'));
  assert(mockHtml.indexOf("hf-garment-tee") > -1 && mockHtml.indexOf('id="hfPrint"') > mockHtml.indexOf("hf-garment-tee"), "print layer follows both garment SVGs in the mock, so it paints above the active garment");
  assert((mockHtml.match(/<svg class="hf-garment /g) || []).length === 4, "mock contains exactly four garment SVGs (front + back per apparel)");
  assert(/<svg class="hf-garment hf-garment-tee-front"[^>]*hidden>/.test(mockHtml) && /<svg class="hf-garment hf-garment-hoodie-back"[^>]*hidden>/.test(mockHtml) && /<svg class="hf-garment hf-garment-tee-back"[^>]*hidden>/.test(mockHtml) && !/<svg class="hf-garment hf-garment-hoodie-front"[^>]*hidden>/.test(mockHtml), "markup opens on the hoodie FRONT: the other three garments start hidden, so the first switch has a state to flip");
  // Prices exist in the Store now (Drop 001 cards, 2026-11-04) — but
  // the Hype Frame creative inside the Store stays price-free.
  const hfCreative = home.slice(home.indexOf('class="hf-creative"'), home.indexOf('id="quickView"'));
  assert(!hfCreative.includes("$"), "Hype Frame creative carries no price (prices live on the product cards only)");

  /* ---- setup: a pending play and an approved play ---- */
  const claim = await j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token; assert(tok, "owner claim returns token");
  const mk = async (title) => (await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }) })).body.id;
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
  assert(home.includes('id="hfFinRow"') && appJs.includes("HF_FINISHED") && appJs.includes("function hfRenderFinished"), "'See it finished' lineup present (4 example garments, current print layered per garment+side)");
  assert(appJs.includes("size: 78") && appJs.includes("HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 78 }"), "the one shared placement default carries the raised 78% print size");
  assert(appJs.includes("function hfSetPreset") && appJs.includes('hfState.preset === "hypeframe"'), "presets drive the compose flags + the order's branding value");
  assert(home.includes('id="hfSideFront"') && home.includes('id="hfSideBack"'), "studio offers a Front / Back print-side toggle");
  assert(appJs.includes("function hfSetSide") && appJs.includes("side: hfState.side"), "the chosen print side rides on the order payload");
  assert(appJs.includes("function hfGrungeFrame") && appJs.includes("function hfDrawLockup"), "Hype Frame preset composes the grunge frame + under-photo lockup (poster identity)");
  assert(!appJs.includes("hfBranding") && !appJs.includes("hfStill") && !appJs.includes("hfDrag") && !appJs.includes("hfSetPlacementSize"), "old checkbox / still box / drag + size JS are gone");
  assert(appJs.includes("function hfApplyPlacement") && appJs.includes("placement: hfState.placement"), "studio applies the (fixed) placement and sends it with the order");
  assert(appJs.includes("Placement:") && appJs.includes("% size"), "Owner view displays each request's placement for the printer");
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

  const pubH2 = await text("/api/highlights?division=all");
  assert(!pubH2.includes('"placement"'), "placement absent from the public highlights API");
  const pubC2 = await text("/api/contest");
  assert(!pubC2.includes('"placement"'), "placement absent from the public contest API");

  console.log("\nALL HYPE FRAME CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
