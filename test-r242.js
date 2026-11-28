// Round 242 (2026-11-27, Emil — approved from the side-by-side
// mock + his Front/Back-buttons correction + "bring up the
// ability to select either avatar or the other option"):
// three studio preview changes.
//   1. BACK DESIGN PLACEMENT — bigger and higher. The Black
//      BACK zone (HF_GARMENT_AREA218) is EXTENDED to
//      {0.186 / 0.2725 / 0.637 / 0.55} and the Heather Gray
//      BACK zone (HF_GARMENT_AREA211) likewise, so the
//      UNCHANGED placement default {50 / 42 / 78} lands the
//      R237 design (720×782) at 520×565 px on the Black blank
//      — top edge 27.3% of the photo (just under the hood tip
//      ≈26.3%), center-x 50.5%, bottom 73.4%. The zone grew
//      instead of the size number (which would be ≈101 in
//      old-zone terms) because the server clamps a stored
//      placement to ≤100 — a 101 default would be recorded
//      as 100 and the order would stop matching the preview.
//      Front zones + crest anchors do not move.
//   2. FRONT/BACK TOGGLE — slim. The .hf-garment-flip206 seg
//      in the garment card gets card-scoped slim sizing
//      (≈38px tall, about half its phone height); same ids,
//      same flip behavior.
//   3. ARTWORK SELECTOR MOVES UP. #hfImageStyles (Frame |
//      Illustrated avatar, values unchanged) now lives in the
//      garment card directly under the flip — exactly one on
//      the page; the Artwork section keeps the explainer, the
//      avatar maker, the design label, placement + back-text.
//   A. Pins + placement statics.  B. Geometry (VM drive of the
//      real painter).  C. Flip drive (VM, both ways).
//   D. Toggle CSS (the slim band, computed from the CSS).
//   E. Selector statics (one, in the card, Artwork intact).
//   F. Selector drive (VM: hfPickImageStyle state changes).
//   G. Served smoke.
// Exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins + placement statics ----
{
  assert(home.includes('src="app.js?v=240"') && home.includes('href="styles.css?v=228"'), "A: asset pins — app.js v237 / styles v227 (Round 242) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");
  assert(appJs.includes("back: { left: 0.186, top: 0.2725, width: 0.637, height: 0.55 }"), "A: the Black BACK zone is the extended R242 zone (nearly seam to seam, top just under the hood tip)");
  assert(appJs.includes("back: { left: 0.188, top: 0.42, width: 0.624, height: 0.42 }"), "A: the Heather Gray BACK zone carries the same relative extension (in the 211 table — Gray has no 218 entry)");
  assert(appJs.includes("front: { left: 0.30, top: 0.315, width: 0.43, height: 0.29 }"), "A: the Black FRONT zone is unchanged");
  assert(appJs.includes("front: { left: 0.29, top: 0.315, width: 0.42, height: 0.30 }"), "A: the Heather Gray FRONT zone is unchanged");
  assert(appJs.includes("Black: { cx: 0.64, cy: 0.33, w: 0.17 }") && appJs.includes('"Heather Gray": { cx: 0.65, cy: 0.335, w: 0.17 }'), "A: both crest anchors are unchanged — the embroidered front crest does not move");
  assert(appJs.includes("HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 78 }"), "A: the placement default is UNCHANGED {50 / 42 / 78} — the zones grew around it, so the order payload, the server clamp (≤100) and the server fallback defaults all stay truthful");
  assert(appJs.includes("≈15.6\" wide × ≈16.9\" tall"), "A: the physical print-size note follows the new placement (the design prints ≈15.6\" × ≈16.9\" at the R242 back placement, window ≈13.4\" × 10.1\")");
}

// ---- VM harness over the real garment block ----
const block = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
assert(block.includes("function hfGarmentPaint211") && block.includes("function hfGarmentSync206"), "harness: the garment block slice carries the painter + the sync");
const mkEl = () => ({
  hidden: false, textContent: "", value: "", style: {}, attrs: {},
  classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
  setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
  set src(v) { this._src = v; }, get src() { return this._src; },
});
const mkPrint = (nw, nh) => { const e = mkEl(); e.naturalWidth = nw; e.naturalHeight = nh; return e; };
function drive(state, view, print) {
  const els = {
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentShade211": mkEl(), "#hfGarmentCrest211": mkEl(),
    "#hfGarmentBackText206": mkEl(),
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
  };
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                 { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: state,
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfPrintTone: () => "#f6f1e4",
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(block, ctx);
  const refs = { img: els["#hfGarmentImg206"], area: els["#hfGarmentPrintArea206"], print, shade: els["#hfGarmentShade211"], crest: els["#hfGarmentCrest211"], backText: els["#hfGarmentBackText206"] };
  sb.hfGarmentPaint211(refs, { view, printSrc: "data:print", words: "" });
  return { sb, ctx, els, refs, flips };
}
function designRect(refs, artW, artH, designAsp) {
  const aL = parseFloat(refs.area.style.left) / 100, aT = parseFloat(refs.area.style.top) / 100;
  const aW = parseFloat(refs.area.style.width) / 100, aH = parseFloat(refs.area.style.height) / 100;
  const wFrac = (parseFloat(refs.print.style.width) / 100) * aW;
  const cx = aL + (parseFloat(refs.print.style.left) / 100) * aW;
  const cy = aT + (parseFloat(refs.print.style.top) / 100) * aH;
  const hFrac = wFrac * designAsp * (artW / artH);
  return { wPx: wFrac * artW, hPx: hFrac * artH, cxPct: cx * 100, topPct: (cy - hFrac / 2) * 100, botPct: (cy + hFrac / 2) * 100 };
}
const baseState = (over) => ({ play: { id: 7, title: "Double" }, frozen: true, printDataUrl: "data:print", printAspect: 782 / 720, colorway: "Black", side: "back", garmentView206: "back", backText: "name", imageStyle: "photo", placement: { cx: 50, cy: 42, size: 78 }, avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, ...over });

// ---- B. geometry: the approved mock's rect, from the real painter ----
{
  const { refs } = drive(baseState(), "back", mkPrint(720, 782));
  const r = designRect(refs, 1046, 1225, 782 / 720);
  assert(near(r.wPx, 520, 3), `B: Black back — the R237 design lands 520px wide on the blank (got ${r.wPx.toFixed(1)})`);
  assert(near(r.hPx, 565, 3), `B: Black back — 565px tall (got ${r.hPx.toFixed(1)})`);
  assert(near(r.topPct, 27.3, 0.4), `B: Black back — top edge at 27.3% of the photo, just under the hood tip ≈26.3% (got ${r.topPct.toFixed(2)}%)`);
  assert(near(r.cxPct, 50.5, 0.3), `B: Black back — center-x unchanged at 50.5% (got ${r.cxPct.toFixed(2)}%)`);
  assert(near(r.botPct, 73.4, 0.4), `B: Black back — bottom edge at 73.4% (got ${r.botPct.toFixed(2)}%)`);
  assert(near(r.wPx / 400, 1.30, 0.01), "B: Black back — the design is ×1.30 the pre-242 footprint (400px at the old zone)");

  const g = drive(baseState({ colorway: "Heather Gray" }), "back", mkPrint(720, 782));
  const gr = designRect(g.refs, 1280, 1920, 782 / 720);
  assert(near(gr.wPx, 623, 4), `B: Heather Gray back — the design lands 623px wide (got ${gr.wPx.toFixed(1)})`);
  assert(near(gr.wPx / (0.78 * 0.48 * 1280), 1.30, 0.01), "B: Heather Gray back — ×1.30 the old zone's width, the same relative change as Black");
  assert(near(gr.topPct, 42.0, 0.4), `B: Heather Gray back — top edge at 42.0%, just under its hood tip ≈41% (got ${gr.topPct.toFixed(2)}%)`);

  const f = drive(baseState({ side: "front", printAspect: 0 }), "front", mkPrint(0, 0));
  assert(f.refs.print.style.width === "78%" && f.refs.print.style.left === "50%" && f.refs.print.style.top === "42%", "B: FRONT placement is unchanged — the print still sits at its true placement (78% / 50% / 42%) on the front view");
  const c = drive(baseState(), "front", mkPrint(720, 782));
  assert(c.refs.crest.hidden === false && c.refs.crest.style.width === "17%" && c.refs.crest.style.left === "55.5%" && c.refs.crest.style.top === "25.6%", "B: the front CREST is unchanged — same anchor, same size (17% / 55.5% / 25.6%) on the front view");

  const { ctx } = drive(baseState(), "back", mkPrint(720, 782));
  const tables = vm.runInContext("({ A218: HF_GARMENT_AREA218, A211: HF_GARMENT_AREA211 })", ctx);
  assert(tables.A218.Black.front.left === 0.30 && tables.A218.Black.front.top === 0.315 && tables.A211["Heather Gray"].front.width === 0.42 && tables.A211.Black.back.width === 0.46, "B: the zone tables in the VM — fronts + the (218-superseded) 211 Black record stand as they were; only the two BACK zones grew");
}

// ---- C. flip drive: hfGarmentSync206 both ways ----
{
  const els = {
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentShade211": mkEl(), "#hfGarmentCrest211": mkEl(),
    "#hfGarmentBackText206": mkEl(),
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
  };
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                 { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: baseState(),
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfPrintTone: () => "#f6f1e4",
  };
  sb.window = sb;
  vm.runInContext(block, vm.createContext(sb));
  sb.hfGarmentSync206();
  assert(els["#hfGarment206"].hidden === false && els["#hfGarmentImg206"].src === "/swag/hf-blank-back-black218.jpg", "C: sync opens on the back blank, garment shown");
  assert(flips[1].attrs["aria-pressed"] === "true" && flips[0].attrs["aria-pressed"] === "false", "C: the flip's pressed state names the back view");
  sb.hfState.garmentView206 = "front";
  sb.hfGarmentSync206();
  assert(els["#hfGarmentImg206"].src === "/swag/hf-blank-front-black218.jpg" && flips[0].attrs["aria-pressed"] === "true" && flips[1].attrs["aria-pressed"] === "false", "C: the flip turns the garment to the front blank and re-presses");
  sb.hfState.garmentView206 = "back";
  sb.hfGarmentSync206();
  assert(els["#hfGarmentImg206"].src === "/swag/hf-blank-back-black218.jpg" && flips[1].attrs["aria-pressed"] === "true", "C: …and back again — the slim switch flips both ways through the same sync");
  assert(sb.hfState.side === "back" && JSON.stringify(sb.hfState.placement) === JSON.stringify({ cx: 50, cy: 42, size: 78 }), "C: the flips never touched the order's side or placement (view-only, as ever)");
}

// ---- D. toggle CSS: the slim band ----
{
  const segPad = (sel) => { const m = css.match(new RegExp(sel.replace(/[.#]/g, "\\$&") + "\\{[^}]*padding:(\\d+)px")); return m ? Number(m[1]) : null; };
  const btnRule = (sel) => { const m = css.match(new RegExp(sel.replace(/[.#]/g, "\\$&") + " button\\{[^}]*font-size:(\\d+(?:\\.\\d+)?)px;padding:(\\d+)px (\\d+)px")); return m ? { font: Number(m[1]), padV: Number(m[2]), padH: Number(m[3]) } : null; };
  const flipSeg = segPad("#hfGarmentFlip206");
  const flipBtn = btnRule("#hfGarmentFlip206");
  assert(flipSeg === 2 && flipBtn && flipBtn.font === 12.5 && flipBtn.padV === 4, "D: the flip wears the R242 slim sizing in the card (seg padding 3px; buttons 13px / 5px vertical) — →244: the flip LEFT the card for the price row (Emil) and shrank again — seg padding 2px; buttons 12.5px / 4px vertical under #hfGarmentFlip206");
  const est = 2 * flipSeg + 2 + 2 * flipBtn.padV + flipBtn.font * 1.5; // seg padding + seg border + button padding + one line of text
  assert(est >= 30 && est <= 34, `D: the flip's computed height is ≈${est.toFixed(1)}px — inside the slim 36–40px band (± rounding) — →244: inside Emil's ~28–32px ask for the price-row toggles`);
  const oldEst = 2 * 4 + 2 + 2 * 10 + 14.5 * 1.5; // pre-242 phone geometry from the same CSS terms: .seg padding 4px + the ≤560px studio button padding 10px at 14.5px
  assert(est < oldEst, `D: …and clearly shorter than the pre-242 phone toggle on the same terms (≈${oldEst.toFixed(1)}px from the CSS; ≈64px as measured on Emil's phone with the bar's wrap)`);
  const mq = css.slice(css.indexOf("@media (max-width:560px)", css.indexOf("Round 242")));
  assert(mq.includes("#hfGarmentFlip206{width:auto}") && mq.includes("#hfGarmentFlip206 button{flex:0 0 auto"), "D: on phone the slim flip is content-width (it no longer stretches full-width like every studio .seg) — →244: same guarantee, retargeted to the price-row group (the seg is content-width, buttons don't stretch)");
  const stylesSeg = segPad("#hfGarment206 .hf-image-styles");
  const stylesBtn = btnRule("#hfGarment206 .hf-image-styles");
  assert(stylesSeg === 3 && stylesBtn && stylesBtn.font === 13 && stylesBtn.padV === 5, "D: the moved artwork selector wears the same slim sizing in the card, so the card stays tidy");
}

// ---- E. selector statics: one, in the card, Artwork intact ----
{
  assert((home.match(/id="hfImageStyles"/g) || []).length === 1, "E: exactly ONE artwork selector on the page");
  assert((home.match(/data-hf-image-style=/g) || []).length === 2, "E: exactly two style buttons (Frame + Illustrated avatar)");
  const at = (id) => home.indexOf(`id="${id}"`);
  assert(at("hfImageStyles") > at("hfGarment206") && at("hfImageStyles") < at("hfRowPhoto215"), "E: the selector lives inside the garment card, above Your moment");
  const card = home.slice(at("hfGarment206"), at("hfRowPhoto215"));
  assert(!card.includes("hf-garment-flip206") && card.indexOf('id="hfImageStyles"') > -1 && card.indexOf('id="hfAvatarCard244"') > card.indexOf('id="hfImageStyles"'), "E: …directly under the Front/Back flip — →244: the flip left the card for the price row; the selector now sits under the card caption, with the avatar status card directly beneath it");
  const art = home.slice(at("hfArtworkPanel215"), at("hfBuyCard215"));
  assert(!art.includes('id="hfImageStyles"'), "E: the selector is GONE from the Artwork section (no duplicate left behind)");
  assert(art.includes('id="hfAvatarPanel206"') && art.includes('id="hfAvatarMake206"') && art.includes('id="hfLabel218"') && art.includes('id="hfSides"') && !art.includes('id="hfBackText197"'), "E: the Artwork section keeps its remaining content — avatar maker + entry, design label, print placement, name on design — →244: Name on design moved UP out of Artwork to follow Your moment (Emil's flow order), so it is absent here now");
  assert(home.includes('id="hfRowArtwork215"') && home.includes('id="hfRowArtworkState215"'), "E: the Artwork section head + its state line survive (hfSyncRowStates215 still names the choice there)");
  assert(appJs.includes('$$("#hfImageStyles [data-hf-image-style]")') && appJs.includes("function hfPickImageStyle"), "E: the wiring is untouched — the click binding + hfPickImageStyle select by id, so they follow the control to its new home");
  assert(appJs.includes("function hfSyncAvatar206") && appJs.includes("function hfMakeAvatar206") && appJs.includes("function hfApplyAvatar206"), "E: the avatar flow's entry points stand (sync + maker + approval all still in app.js)");
}

// ---- F. selector drive: hfPickImageStyle state changes ----
{
  const fnSrc = appJs.slice(appJs.indexOf("function hfPickImageStyle"), appJs.indexOf("/* Words on the back"));
  assert(fnSrc.includes("hfSyncAvatar206") && fnSrc.includes("hfSyncRowStates215"), "F: the picker still kicks the avatar sync + the row states");
  const btns = [{ dataset: { hfImageStyle: "photo" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                { dataset: { hfImageStyle: "avatar" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const calls = [];
  const sb = {
    console,
    $$: (s) => (s.includes("data-hf-image-style") ? btns : []),
    hfState: { imageStyle: "photo" },
    hfSyncAvatar206: () => calls.push("avatar"),
    hfSyncRowStates215: () => calls.push("rows"),
  };
  sb.window = sb;
  vm.runInContext(fnSrc, vm.createContext(sb));
  sb.hfPickImageStyle("avatar");
  assert(sb.hfState.imageStyle === "avatar" && btns[1].attrs["aria-pressed"] === "true" && btns[0].attrs["aria-pressed"] === "false", "F: picking Illustrated avatar sets the state + pressed buttons, exactly as before the move");
  assert(calls.join(",") === "avatar,rows", "F: …and kicks the avatar maker sync + row states (the maker still reveals in the Artwork section)");
  sb.hfPickImageStyle("photo");
  assert(sb.hfState.imageStyle === "photo" && btns[0].attrs["aria-pressed"] === "true" && btns[1].attrs["aria-pressed"] === "false", "F: picking Frame returns the state to the frozen frame");
  sb.hfPickImageStyle("bogus");
  assert(sb.hfState.imageStyle === "photo", "F: an unknown value still falls back to Frame (the state value for Frame stays \"photo\")");
}

// ---- G. served smoke ----
{
  const tmp = fs.mkdtempSync("/tmp/hh-r242-");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: "3542", DATA_DIR: tmp },
    stdio: "ignore",
  });
  try {
    let servedHome = "", servedCss = "";
    for (let i = 0; i < 40 && !servedHome; i++) {
      try { servedHome = await (await fetch("http://127.0.0.1:3542/")).text(); } catch { await wait(250); }
    }
    servedCss = await (await fetch("http://127.0.0.1:3542/styles.css")).text();
    assert(servedHome.includes('src="app.js?v=240"') && servedHome.includes('href="styles.css?v=228"'), "G: the served homepage carries the Round 242 pins — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");
    const gAt = servedHome.indexOf('id="hfGarment206"'), sAt = servedHome.indexOf('id="hfImageStyles"'), pAt = servedHome.indexOf('id="hfRowPhoto215"');
    assert(gAt > -1 && sAt > gAt && sAt < pAt && (servedHome.match(/id="hfImageStyles"/g) || []).length === 1, "G: the served page carries exactly one artwork selector, inside the garment card");
    assert(servedCss.includes("#hfGarmentFlip206 button"), "G: the served stylesheet carries the slim flip sizing — →244: retargeted to the price-row group");
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nALL R242 CHECKS PASSED");
