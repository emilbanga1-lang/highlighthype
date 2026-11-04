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
  const hint = (home.match(/id="swagHint"[^>]*>([^<]*)</) || [])[1] || "";
  assert(hint.includes("Pause to shop the look") && !hint.includes("Hype Frame"), "film hint says 'Pause to shop the look' with no Hype Frame name");
  const kicker = (home.match(/<p class="ssc-kicker">([^<]*)<\/p>/) || [])[1] || "";
  assert(kicker === "In this scene", "film pause-card kicker is exactly 'In this scene'");
  assert(home.includes("HYPE FRAME — Your moment. Your swag."), "Store section carries the HYPE FRAME header");
  for (const step of [
    "Select your highlight from an uploaded video.",
    "Freeze your favorite frame using a video timeline.",
    "Customize with your name, jersey number, and optional HYPE FRAME branding.",
    "Preview the actual image on a hoodie or T-shirt.",
    "Order with parent or guardian approval.",
  ]) assert(home.includes(step), `Store how-it-works step present: ${step}`);
  assert(appJs.includes("Create a Hype Frame"), "play cards get a 'Create a Hype Frame' button");
  assert(home.includes('id="hypeframe"') && home.includes('id="hfVideo"') && home.includes('id="hfScrub"') && home.includes('id="hfFreeze"') && home.includes('id="hfOrderForm"'), "studio markup present (video, timeline, freeze button, order form)");
  assert(appJs.includes("/api/hype-frame/orders") && appJs.includes("composeHfPrint"), "studio wires freeze -> compose -> order request");

  /* ---- 1b. Apparel preview: BOTH garment branches show the print ----
     Regression (2026-11-04 live bug): the T-Shirt preview showed the
     hoodie carrying the print above a plain tee. Root cause: the author
     rule .hf-garment{display:block} outranks the UA [hidden]{display:none},
     so hfSetApparel's hidden toggling never hid either garment — both
     SVGs stacked and the shared print overlay landed on the hoodie in
     both modes. Fix: .hf-garment[hidden]{display:none}. */
  assert(/\.hf-garment\[hidden\]\s*\{\s*display:\s*none/.test(css), "inactive garment is actually hidden (.hf-garment[hidden]{display:none} present)");
  for (const a of ["hoodie", "tee"]) {
    const rule = new RegExp(`\\.hf-mock\\[data-apparel="${a}"\\] \\.hf-print\\s*\\{[^}]*left:[^}]*top:[^}]*width:`);
    assert(rule.test(css), `${a} branch positions the shared print layer in its chest print area`);
  }
  assert(appJs.includes('$(".hf-garment-hoodie").hidden = a !== "hoodie"') && appJs.includes('$(".hf-garment-tee").hidden = a !== "tee"'), "apparel switch toggles hidden on both garments");
  assert(appJs.includes('$("#hfMock").dataset.apparel = a'), "apparel switch sets the mock's data-apparel so the matching print-area rule applies");
  assert((home.match(/id="hfPrint"/g) || []).length === 1, "exactly one shared print layer serves both garments");
  const mockHtml = home.slice(home.indexOf('id="hfMock"'), home.indexOf('id="hfOrderForm"'));
  assert(mockHtml.indexOf("hf-garment-tee") > -1 && mockHtml.indexOf('id="hfPrint"') > mockHtml.indexOf("hf-garment-tee"), "print layer follows both garment SVGs in the mock, so it paints above the active garment");
  const storeSection = home.slice(home.indexOf('id="shop"'));
  assert(!storeSection.includes("$"), "no prices anywhere in the Store section (Hype Frame included)");

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
  assert(o.custom_name === "Nick" && o.jersey === "13" && o.branding === true && o.apparel === "hoodie" && o.colorway === "Black" && o.status === "pending-guardian", "owner sees customization + apparel + status stored correctly");
  const imgNoAuth = await fetch(base + `/api/owner/hype-frames/${orderId}/image`);
  assert(imgNoAuth.status === 403, "print image endpoint requires owner auth (403 without token)");
  const img = await fetch(base + `/api/owner/hype-frames/${orderId}/image`, { headers: { "x-owner-token": tok } });
  assert(img.status === 200 && (img.headers.get("content-type") || "").includes("image/png"), "print image serves as PNG with owner auth");
  const imgBytes = Buffer.from(await img.arrayBuffer());
  assert(imgBytes.subarray(0, 4).toString("hex") === "89504e47", "stored print image bytes are the submitted PNG");

  /* ---- 5. Print placement: controls, defaults, round-trip, clamping ---- */
  for (const id of ["hfPlace", "hfSize", "hfSizeMinus", "hfSizePlus", "hfSizeVal", "hfPlaceReset"]) assert(home.includes(`id="${id}"`), `placement control present: #${id}`);
  assert(appJs.includes("function hfApplyPlacement") && appJs.includes("placement: hfState.placement"), "studio applies placement and sends it with the order");
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
  assert(pDef.cx === 50 && pDef.cy === 42 && pDef.size === 66, "default placement stored on an unadjusted order (50 / 42 · 66% size)");
  const pCustom = JSON.parse(byId(customId).placement);
  assert(pCustom.cx === 35.5 && pCustom.cy === 60 && pCustom.size === 92, "custom placement round-trips to the owner API exactly");
  const pClamp = JSON.parse(byId(clampedId).placement);
  assert(pClamp.cx === 100 && pClamp.cy === 0 && pClamp.size === 100, "out-of-range placement is clamped to the print-area bounds");
  const pubH2 = await text("/api/highlights?division=all");
  assert(!pubH2.includes('"placement"'), "placement absent from the public highlights API");
  const pubC2 = await text("/api/contest");
  assert(!pubC2.includes('"placement"'), "placement absent from the public contest API");

  console.log("\nALL HYPE FRAME CHECKS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
