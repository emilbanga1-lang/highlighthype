// Round 237 (2026-11-27) — the wide-photo template + the
// Review bar unstick, both Emil's, both from his phone:
//
// ITEM 1 — THE WIDE PHOTO. R235 measured the locked template
// (the frame window was 397×706 of a 720×1023 design — a
// narrow portrait sliver, because the layout contain-fit the
// whole 9:16 frame) and mocked current vs +37%. Emil answered
// with a reference shot of his own (a hoodie back where the
// photo is WIDE and dominant, name above, label below) and
// then approved the wide mock built to it verbatim
// (mock-r237-frame-wide.png): "Build it like this — wide
// photo in the template" (15:53).
//   Geometry (the mock's, now the layout's): design stays
//   720 wide; the window is 620×465 (4:3, 86.1% of width) in
//   the same flow position (header + branding heights
//   unchanged); total height 782. At the locked 12" print
//   width (60 px/in): window 10.33" × 7.75", design 13.0"
//   tall. Fill is COVER-fit — no letterbox, no distortion —
//   through a source crop rect the layout returns: centered
//   horizontally; vertically, when the source is taller than
//   the window's shape, the band centers at 60% of source
//   height, clamped inside the source. Implemented in the ONE
//   path (hfFormatLayout218 / hfDrawFormat218): composeHfPrint
//   feeds the studio's frozen thumb, the garment fit (via
//   printAspect) and the order payload's print image from the
//   same composition, so preview ≡ production. The avatar
//   path's window is the server prompt's format description —
//   it now specifies the same wide 4:3 frame; an approved
//   avatar design still becomes the print wholesale (R218)
//   with its aspect recorded, never re-cropped client-side.
//   Existing orders are untouched (stored artwork stands).
//
// ITEM 2 — THE REVIEW BAR UNSTICK. R235 made the bar
// sticky-in-flow to kill the dead band; Emil's 15:50 shot
// shows the sticky bar riding OVER the ADULT size pills
// while scrolling: "The review hoodie button is now
// floating." The stickiness is gone entirely: the bar is a
// plain in-flow block directly after the buy card (12px top
// margin kept, "No payment today" note still inside it),
// scrolling naturally with the page. No fixed, no sticky,
// no reserve.
//
// Pins: app.js v233 / styles v224.
// Run: node test-r237.js — exits non-zero on failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=240"'), "A: asset pins — app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");

// ---- B. layout statics: the wide window replaced contain-fit ----
const laySrc = appJs.slice(appJs.indexOf("function hfFormatLayout218"), appJs.indexOf("function hfDrawFormat218"));
assert(laySrc.includes("Math.round(W * 31 / 36)") && laySrc.includes("Math.round(fw * 3 / 4)"), "B: the window is a fixed share of the design — 31/36 of the width, 4:3 (620×465 at W=720)");
assert(laySrc.includes("Math.max(fw / aW, fh / aH)") && laySrc.includes("0.60 * aH"), "B: the crop is cover-fit (max scale) with the portrait band centered at 60% of source height");
assert(!laySrc.includes("maxFrameH") && !laySrc.includes("Math.min(frameW / aW"), "B: the contain-fit geometry is GONE (no maxFrameH cap, no min-scale fit — the sliver's cause)");
assert(appJs.includes("x.drawImage(art, lay.sx, lay.sy, lay.sw, lay.sh, lay.frameX, lay.frameY, lay.fw, lay.fh)"), "B: the draw routes the art through the layout's crop rect into the window (9-arg drawImage)");
assert(!appJs.includes("x.drawImage(art, lay.frameX, lay.frameY, lay.fw, lay.fh)"), "B: the old whole-art stretch draw is GONE");

// ---- C + D. VM drive: the real layout + compose ----
// The same block test-r218 slices (hfPrintTone → composeHfPrint's
// end): the layout, the draw, the grunge frame and the composer.
const block = appJs.slice(appJs.indexOf("function hfPrintTone"), appJs.indexOf("\n}", appJs.indexOf("function composeHfPrint")) + 2);
const calls = [];
const recCtx = (cv) => {
  const base = { canvas: cv, measureText: (t) => ({ width: String(t).length * 10 }) };
  return new Proxy(base, {
    get(t, k) { if (typeof k === "symbol") return undefined; if (k in t) return t[k]; return (...a) => { calls.push({ m: String(k), a }); }; },
    set(t, k, v) { t[k] = v; return true; },
  });
};
const created = [];
const mkCanvas = () => { const cv = { width: 0, height: 0, _ctx: null, getContext() { if (!this._ctx) this._ctx = recCtx(this); return this._ctx; }, toDataURL: () => "data:image/png;base64,REC237" }; created.push(cv); return cv; };
class FakeImage {
  constructor() { this.naturalWidth = 1000; this.naturalHeight = 1250; }
  set src(v) { this._src = v; if (this.onload) queueMicrotask(() => this.onload()); }
  get src() { return this._src; }
}
const mkEl = () => ({
  hidden: false, textContent: "", value: "", style: {}, attrs: {}, listeners: {},
  addEventListener(ev, fn) { this.listeners[ev] = fn; },
  classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
  setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
  removeAttribute(k) { if (k === "src") this._src = undefined; delete this.attrs[k]; },
  set src(v) { this._src = v; }, get src() { return this._src; },
});
const photoStub = { width: 720, height: 1280 };
const els = {
  "#hfCanvas": photoStub,
  "#hfName": { value: "Kameron" }, "#hfJersey": { value: "" }, "#hfBackCustom197": { value: "" },
  "#hfLabel218": { value: "TOUCHDOWN" },
};
const generic = {};
const sb = {
  console,
  $: (s) => els[s] || (generic[s] ??= mkEl()),
  $$: () => [],
  document: { createElement: (t) => (t === "canvas" ? mkCanvas() : mkEl()), addEventListener: () => {}, body: mkEl() },
  Image: FakeImage,
  hfState: { play: { id: 78, title: "Touchdown", division: "boys" }, frozen: true, printDataUrl: "", printAspect: 0, colorway: "Black", side: "back", garmentView206: "back", preset: "hypeframe", backText: "name", imageStyle: "photo", placement: { cx: 50, cy: 42, size: 78 }, avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, designAspect218: 0, size: "YM", apparel: "hoodie", mediaType: "video" },
  HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
  HF_PRESET_LABELS205: { hypeframe: "Hype Frame" },
  hfPickImageStyle: (s) => { sb.hfState.imageStyle = s; },
  hfSyncAvatar206: () => {},
  esc: (t) => String(t),
};
sb.window = sb;
const ctx = vm.createContext(sb);
vm.runInContext(block, ctx);
const S = sb.hfState;
const L = sb.hfFormatLayout218;

// ---- C. geometry + crop math (the approved mock's numbers) ----
{
  const lay = L(720, 720, 1280, true);
  assert(lay.fw === 620 && lay.fh === 465, "C: at W=720 the window is 620×465 (4:3, 86.1% of the design width)");
  assert(lay.frameX === 50 && lay.frameY === 169 && lay.totalH === 782, "C: the window sits in the old flow position (x=50, y=header 169) and the design is 720×782");
  assert(Math.abs(lay.fw / 60 - 10.333) < 0.01 && lay.fh / 60 === 7.75 && Math.abs(lay.totalH / 60 - 13.033) < 0.01, "C: at the locked 12-inch print width (60 px/in) the window prints 10.33\" × 7.75\" and the design stands 13.0\" tall");
  assert(L(720, 720, 1280, false).totalH === 703, "C: no-name mode keeps its shorter header — total 703 (header/footer heights unchanged by the round)");

  // Portrait (play 78's shape): full width kept, band at 60%.
  assert(lay.sw === 720 && lay.sh === 540 && lay.sx === 0, "C-crop: a 720×1280 frame cover-fits at full width — the visible band is 720×540");
  assert(lay.sy === 498 && lay.sy + lay.sh / 2 === 0.60 * 1280, "C-crop: the band centers at 60% of source height (sy=498, center 768) — on the action, per the approved mock's rule");
  // Portrait clamp: a near-square-but-taller source whose band
  // would run past the bottom lands flush with it instead.
  const clamp = L(720, 1100, 1000, true);
  assert(clamp.sw === 1100 && clamp.sh === 825 && clamp.sy === 175 && clamp.sy + clamp.sh === 1000, "C-crop: the 60% band clamps inside the source (1100×1000 → sy=175, flush with the bottom edge, never past it)");
  // Landscape: full height kept, sides cropped symmetrically.
  const land = L(720, 1280, 720, true);
  assert(land.sw === 960 && land.sh === 720 && land.sx === 160 && land.sy === 0, "C-crop: a 1280×720 frame side-crops symmetrically (sx=160, full height kept)");
  // Square: full width, band at 60%.
  const sq = L(720, 1000, 1000, true);
  assert(sq.sw === 1000 && sq.sh === 750 && sq.sx === 0 && sq.sy === 225, "C-crop: a square source keeps full width and bands at 60% (sy=225 of a 750 band)");
  // A source already 4:3 passes through whole.
  const exact = L(720, 1200, 900, true);
  assert(exact.sw === 1200 && exact.sh === 900 && exact.sx === 0 && exact.sy === 0, "C-crop: a 4:3 source is drawn whole — cover-fit crops only what the window's shape excludes");
}

// ---- D. compose drive: preview ≡ production, one path ----
{
  calls.length = 0; created.length = 0;
  sb.composeHfPrint();
  await wait(30); // crown lands → one recompose, same geometry
  const comp = created[created.length - 1];
  assert(comp && comp.width === 720 && comp.height === 782, "D: the composed print canvas IS the wide design — 720×782 for play 78's frame");
  assert(S.printDataUrl === "data:image/png;base64,REC237" && Math.abs(S.printAspect - 782 / 720) < 1e-9, "D: printAspect records the wide design (782/720) — the garment fit math consumes exactly this");
  const draw = calls.filter((c) => c.m === "drawImage" && c.a[0] === photoStub).pop();
  assert(draw && draw.a.length === 9 && draw.a[1] === 0 && draw.a[2] === 498 && draw.a[3] === 720 && draw.a[4] === 540 && draw.a[5] === 50 && draw.a[6] === 169 && draw.a[7] === 620 && draw.a[8] === 465, "D: the photo is drawn through the crop rect (0,498 720×540) into the window (50,169 620×465) — cover-fit, no letterbox, no distortion");
  assert((appJs.match(/hfDrawFormat218\(x, W, fc, lay\)/g) || []).length === 1, "D: exactly ONE draw call site composes the format (composeHfPrint) — no second renderer to drift");
  const submit = appJs.slice(appJs.indexOf("async function hfSubmitOrder206"), appJs.indexOf("(function wireHf206()"));
  assert(submit.includes("image: hfState.printDataUrl"), "D: the order payload carries hfState.printDataUrl itself — the file production prints is the composition the studio previewed");
  const paint = appJs.slice(appJs.indexOf("function hfGarmentPaint211"), appJs.indexOf("function hfGarmentBackText206"));
  assert(paint.includes("hfState.printAspect") && paint.includes("refs.print.naturalHeight / refs.print.naturalWidth"), "D: the garment painter fits by the print's own aspect (loaded art first, printAspect before load) — the wide design seats itself, no portrait constant anywhere in the fit");
}

// ---- E. the avatar path uses the same window ----
{
  assert(serverJs.includes("the frame is WIDE: a landscape frame with a 4:3 shape spanning most of the design's width (about 86% of it), never a tall narrow portrait frame"), "E: the avatar maker's format description carries the SAME wide window (4:3, ~86% of width) — generated designs fill the wide frame, not the old sliver");
  assert(serverJs.includes("distressed white grunge frame"), "E: the rest of the format anatomy in the prompt is untouched (grunge frame, crown, branding)");
  // The approved design still becomes the print wholesale —
  // its own aspect recorded, never re-cropped by the layout.
  S.avatarDataUrl206 = "data:design237"; S.designAspect218 = 0.92; S.avatarApplied206 = true;
  calls.length = 0;
  sb.composeHfPrint();
  assert(S.printDataUrl === "data:design237" && S.printAspect === 0.92, "E: an approved avatar design passes through as the print with its recorded aspect — the client layout never re-crops or re-wraps it");
  S.avatarApplied206 = false; S.avatarDataUrl206 = ""; S.designAspect218 = 0;
}

// ---- F. Item 2: the Review bar is a plain in-flow block ----
{
  const barRule = css.slice(css.indexOf(".hf-stickybar215{"), css.indexOf("}", css.indexOf(".hf-stickybar215{")));
  assert(!barRule.includes("position:sticky") && !barRule.includes("position:fixed") && !barRule.includes("bottom:0") && !barRule.includes("z-index"), "F: the Review bar rule carries NO positioning at all — no sticky, no fixed, no bottom pin, no z-index (Emil: 'The review hoodie button is now floating')");
  assert(barRule.includes("margin:12px auto 0") && barRule.includes("border-radius:16px"), "F: the bar keeps its 12px top margin and reads as a plain card in the page (full 16px radius — no viewport-attached top-only rounding)");
  assert(css.includes(".hf-stickybar215{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px))}") && css.includes(".hf-review-btn215{padding:12px}") && css.includes(".hf-stickybar-note215{margin-top:5px}"), "F: the bar's components are unchanged — compact padding, the button, the note's margin (only the positioning left)");
  const prod = home.slice(home.indexOf('id="hfProduct215"'), home.indexOf('id="hfReview215"'));
  const barHtml = prod.slice(prod.indexOf('id="hfStickyBar215"'), prod.indexOf('id="hfStickyBar215"') + 400);
  assert(prod.indexOf('id="hfStickyBar215"') > prod.indexOf('id="hfSizeMsg222"') && barHtml.includes("Review hoodie →") && barHtml.includes("No payment today — a parent or guardian confirms first"), "F: in the markup the bar still sits directly after the size card, with the 'No payment today' note inside it");
  assert(!css.includes("#hfProduct215{max-width:560px;margin:0 auto;padding-bottom:96px}") && css.includes("#hfProduct215{max-width:560px;margin:0 auto;padding-bottom:12px}"), "F: no reserve crept back — the product page still ends on its normal 12px padding");
}

// ---- G. served smoke ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r237-"));
  const port = 19800 + (process.pid % 500);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" },
    stdio: "pipe",
  });
  try {
    let served = "", servedApp = "", servedCss = "";
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { served = await r.text(); break; } } catch (e) { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert(served.length > 0, "G: the server serves the homepage from a scratch DATA_DIR");
    assert(served.includes('src="app.js?v=240"') && served.includes('href="styles.css?v=228"'), "G: the served homepage carries the v233/v224 pins — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");
    servedApp = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
    assert(servedApp.includes("Math.round(W * 31 / 36)") && servedApp.includes("0.60 * aH - sh / 2"), "G: the served app.js carries the wide layout + 60% band crop");
    servedCss = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
    const servedBar = servedCss.slice(servedCss.indexOf(".hf-stickybar215{"), servedCss.indexOf("}", servedCss.indexOf(".hf-stickybar215{")));
    assert(!servedBar.includes("position:sticky") && !servedBar.includes("position:fixed"), "G: the served styles carry the unstuck Review bar");
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("test-r237: all assertions passed");
