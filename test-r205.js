// Round 205 test: Hype Frame studio quick fixes (Emil, 2026-11-26).
// Run: node test-r205.js
// What this suite pins down:
//   A. Pins: app.js v206 / styles v203 (both files changed) —
//      →207: app.js now v207 / styles now v204 (Round 206).
//   B. Item 1 — the Sample start is OUT of the choice dialog:
//      two options (Posted, Own) under "Two ways to start:", no
//      hfChoiceSample handler anywhere; sample plays still ride
//      the picker with their SAMPLE tag (Round 202 parity holds).
//   C. Item 2 — the studio player's center play button is small:
//      the .hf-bigplay127 rule is 46px (the 76px lime circle is
//      gone), [hidden] guard intact.
//   D. Items 3+4 — VM drive of the real strip block: a thumbnail
//      tap sets the "Frame selected · 0:04" label and fills the
//      player box with the thumbnail's own image INSTANTLY; when
//      the seek lands, the full-res capture runs (hfCapturePrint)
//      and the overlay clears. The submitted print still comes
//      from hfState.printDataUrl (statics).
//   E. Item 5 — the still recommendation: hfScoreStills205 unit
//      drives (black never wins, all-black -> -1, the action
//      frame beats static neighbours) and a full hfRecommend205
//      drive (badge on the winner + pre-select through the tap
//      path; no override of a family's own pick; stale strip
//      token stands down).
//   F. Item 6 — VM drive of showPanel: body.hf-studio-open205
//      rides only while the studio panel is active; the CSS
//      hides the floating pill under it; the pill + menu entry
//      themselves are untouched.
//   G. Item 7 — VM drive of hfPickBackText197: the jersey row
//      shows ONLY for name_number and toggles live.
//   H. Items 8-12 statics + the summary drive: the 2x2 back-text
//      grid rule; the size guide (button, panel, youth + adult,
//      "general guide"); the live order summary above the email
//      field (VM: hfSummary205 reads real state); "Send hoodie
//      request" + the verbatim no-payment copy under the email
//      field, the old no-price note gone; "Name on the print"
//      gone, the embroidered-across-the-back label in.
//   I. The served homepage + app.js + styles.css carry it all.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r205-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "" },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=239"'), "A: asset pins — app.js v206 / styles v203 (Round 205; both files changed) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");

// ---- B. item 1: Sample out of the dialog ----
const mStart = home.indexOf('id="hfChoiceModal"');
const modal = home.slice(mStart, home.indexOf('id="uploadForm"', mStart));
assert(modal.includes("Two ways to start:") && !modal.includes("Three ways"), "B: the dialog sub-copy offers two ways to start");
assert(!modal.includes("hfChoiceSample") && !modal.includes("Try it with a sample clip"), "B: no Sample button in the dialog");
assert(!appJs.includes("window.hfChoiceSample"), "B: the hfChoiceSample handler is gone from app.js");
assert(modal.indexOf('onclick="hfChoicePosted()"') > -1 && modal.indexOf('onclick="hfChoiceOwn()"') > modal.indexOf('onclick="hfChoicePosted()"'), "B: the two remaining options render in order — Posted, Own");
assert(appJs.includes("⭐ SAMPLE PLAY"), "B: sample plays keep their SAMPLE PLAY tag on the boards (tiles/cards/watch) — →231: the picker no longer lists samples at all, so the tag's surviving home is the boards; the string still rides in app.js");

// ---- C. item 2: small play button ----
const bigRule = css.slice(css.indexOf(".hf-bigplay127{"), css.indexOf("}", css.indexOf(".hf-bigplay127{")));
assert(bigRule.includes("width:46px;height:46px") && !bigRule.includes("76px"), "C: the center play button is 46px now — the 76px lime circle is gone");
assert(css.includes(".hf-bigplay127[hidden]{display:none}"), "C: the overlay's [hidden] guard still rides");

// ---- D. items 3+4: instant preview + selection label (VM drive) ----
const fmtLine = appJs.slice(appJs.indexOf("function hfFmtTime"), appJs.indexOf("\n", appJs.indexOf("function hfFmtTime")));
const stripBlock = appJs.slice(appJs.indexOf("let hfTapToken127"), appJs.indexOf("function hfFmtTime"));
{
  const video = {
    paused: true, duration: 12, currentTime: 0, readyState: 3, videoWidth: 640,
    _seeked: [],
    pause() { this.paused = true; },
    addEventListener(ev, fn) { if (ev === "seeked") this._seeked.push(fn); },
    removeEventListener(ev, fn) { if (ev === "seeked") this._seeked = this._seeked.filter((f) => f !== fn); },
    fireSeeked() { const fns = this._seeked.slice(); fns.forEach((f) => f()); },
  };
  const label = { hidden: true, textContent: "" };
  const instant = { hidden: true, src: "", removeAttribute(n) { if (n === "src") this.src = ""; } };
  const scrub = { value: 0 };
  const elMap = { "#hfVideo": video, "#hfSelected205": label, "#hfInstant205": instant, "#hfScrub": scrub };
  let captures = 0;
  const sb = {
    console,
    document: { createElement: () => ({ className: "", textContent: "" }) },
    $: (s) => elMap[s] || null,
    $$: () => [],
    hfState: { mediaType: "video", frozen: false, frameTime205: null },
    hfStripToken: 1,
    hfCapturePrint: () => { captures++; sb.hfState.frozen = true; return true; },
    hfUpdateTime: () => {},
  };
  sb.window = sb;
  vm.runInContext(fmtLine + "\n" + stripBlock, vm.createContext(sb));

  const thumbBtn = { querySelector: (s) => (s === "img" ? { src: "data:image/jpeg;thumb-at-4" } : null) };
  sb.hfJumpToFrame(4, thumbBtn);
  assert(label.hidden === false && label.textContent === "Frame selected · 0:04", "D: one tap names the selection — 'Frame selected · 0:04'");
  assert(instant.hidden === false && instant.src === "data:image/jpeg;thumb-at-4", "D: the thumbnail's own frame fills the player box instantly (before the seek lands)");
  assert(captures === 0, "D: no capture yet — the full-res capture still waits for the seek, behind the preview");
  video.fireSeeked();
  assert(captures === 1 && instant.hidden === true && instant.src === "", "D: when the seek lands the full-res capture runs and the instant overlay clears");
  sb.hfSetSelected205(65);
  assert(label.textContent === "Frame selected · 1:05", "D: the label formats minutes (1:05)");
  sb.hfSetSelected205(null);
  assert(label.hidden === true && sb.hfState.frameTime205 === null, "D: clearing the selection hides the label (new play)");
}
// The submitted print is still the composed full-res image.
const captureBlock = appJs.slice(appJs.indexOf("function hfCapturePrint()"), appJs.indexOf("function freezeHfFrame()"));
assert(captureBlock.includes("scratch.width = v.videoWidth; scratch.height = v.videoHeight") && captureBlock.includes("scratch.getContext(\"2d\").drawImage(v, 0, 0, scratch.width, scratch.height)") && captureBlock.includes("x.drawImage(scratch, 0, 0, c.width, c.height)") && captureBlock.includes("hfPixelsBlank235"), "D: the capture still draws the video at full resolution — →235: into a scratch canvas first, pixel-probed (hfPixelsBlank235), and only a frame that painted is committed into #hfCanvas (the old in-place reset let one unpainted draw wipe the seed frame and compose an empty window)");
assert(appJs.includes("image: hfState.printDataUrl"), "D: the order still carries the composed print, never the thumbnail");
const jumpBlock = appJs.slice(appJs.indexOf("function hfJumpToFrame"), appJs.indexOf("/* Round 205 still recommendation"));
assert(jumpBlock.indexOf("hfShowInstant205(btn)") > -1 && jumpBlock.indexOf("hfShowInstant205(btn)") < jumpBlock.indexOf("v.currentTime = target"), "D: the instant preview is set before the seek is issued");

// ---- E. item 5: still recommendation ----
{
  // Synthetic luma frames, 8x8: a textured pattern (sharp), a
  // black frame, and the texture with a bright block moved to
  // the centre (the action).
  const W = 8, H = 8;
  const tex = () => { const a = new Float32Array(W * H); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = ((x * 7 + y * 13) % 2) ? 200 : 60; return { lum: a, w: W, h: H }; };
  const black = () => ({ lum: new Float32Array(W * H), w: W, h: H });
  const action = () => { const f = tex(); for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) f.lum[y * W + x] = 255; return f; };
  const sb = { console, document: { createElement: () => ({}) }, $: () => null, $$: () => [], hfState: { mediaType: "video", frozen: false, frameTime205: null }, hfStripToken: 1, hfCapturePrint: () => true, hfUpdateTime: () => {} };
  sb.window = sb;
  vm.runInContext(fmtLine + "\n" + stripBlock, vm.createContext(sb));
  assert(sb.hfScoreStills205([black(), black()]) === -1, "E: an all-black strip has NO winner — black never wins");
  assert(sb.hfScoreStills205([black()]) === -1, "E: a lone black still is disqualified");
  assert(sb.hfScoreStills205([tex()]) === 0, "E: a lone real still wins by default");
  assert(sb.hfScoreStills205([black(), tex()]) === 1, "E: black loses to the first real frame");
  assert(sb.hfScoreStills205([black(), tex(), tex(), action()]) === 3, "E: the action frame (sharp, central motion) beats black + static neighbours");
}
{
  // Full drive: badge + pre-select, the no-override guard, and
  // the stale-token stand-down. Canvas pixels are faked per img.
  const W = 48, H = 27;
  const mkLum = (kind) => {
    const a = new Float32Array(W * H);
    if (kind === "black") return a;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = ((x * 7 + y * 13) % 2) ? 200 : 60;
    if (kind === "action") for (let y = 10; y < 18; y++) for (let x = 20; x < 29; x++) a[y * W + x] = 255;
    return a;
  };
  const mkImg = (kind) => ({ complete: true, naturalWidth: W, naturalHeight: H, src: "data:" + kind, _lum: mkLum(kind), addEventListener() {} });
  const mkBtn = (t, kind) => ({
    dataset: { hfT: String(t) }, _badge: null, _attrs: {},
    querySelector(s) { if (s === "img") return this._img; if (s === ".hf-rec-badge205") return this._badge; return null; },
    appendChild(el) { this._badge = el; },
    setAttribute(k, v) { this._attrs[k] = v; },
    getAttribute(k) { return this._attrs[k] || ""; },
    _img: mkImg(kind),
  });
  const ctx2d = {
    _last: null,
    drawImage(img) { this._last = img; },
    getImageData() {
      const lum = this._last._lum, data = new Uint8ClampedArray(W * H * 4);
      for (let i = 0, p = 0; i < lum.length; i++, p += 4) { data[p] = data[p + 1] = data[p + 2] = lum[i]; data[p + 3] = 255; }
      return { data };
    },
  };
  const video = { paused: true, duration: 12, currentTime: 2, readyState: 3, videoWidth: 640, pause() {}, addEventListener() {}, removeEventListener() {} };
  const label = { hidden: true, textContent: "" };
  const instant = { hidden: true, src: "", removeAttribute(n) { if (n === "src") this.src = ""; } };
  const elMap = { "#hfVideo": video, "#hfSelected205": label, "#hfInstant205": instant, "#hfScrub": { value: 0 } };
  let captures = 0;
  const sb = {
    console,
    document: { createElement: (tag) => (tag === "canvas" ? { width: 0, height: 0, getContext: () => ctx2d } : { className: "", textContent: "" }) },
    $: (s) => elMap[s] || null,
    $$: () => [],
    hfState: { mediaType: "video", frozen: false, frameTime205: null },
    hfStripToken: 7,
    hfCapturePrint: () => { captures++; sb.hfState.frozen = true; return true; },
    hfUpdateTime: () => {},
  };
  sb.window = sb;
  vm.runInContext(fmtLine + "\n" + stripBlock, vm.createContext(sb));
  const btns = [mkBtn(0, "black"), mkBtn(1, "tex"), mkBtn(2, "action")];
  const strip = { querySelectorAll: () => btns };
  await sb.hfRecommend205(strip, 7);
  assert(btns[2]._badge && btns[2]._badge.textContent === "★ Recommended", "E: the Recommended badge lands on the action still");
  assert(!btns[0]._badge && !btns[1]._badge, "E: no badge on the black or static stills");
  assert(label.textContent === "Frame selected · 0:02" && captures === 1, "E: the winner is pre-selected through the one-tap path (label + capture)");
  // A family pick already made is never overridden.
  sb.hfState.frozen = true; sb.hfState.frameTime205 = 1; captures = 0;
  const btns2 = [mkBtn(0, "black"), mkBtn(1, "tex"), mkBtn(2, "action")];
  await sb.hfRecommend205({ querySelectorAll: () => btns2 }, 7);
  assert(btns2[2]._badge && captures === 0, "E: the badge still lands, but a frame the family already picked is NOT overridden");
  // A stale strip (a newer play's build) stands the scoring down.
  const btns3 = [mkBtn(0, "tex"), mkBtn(2, "action")];
  await sb.hfRecommend205({ querySelectorAll: () => btns3 }, 999);
  assert(!btns3[0]._badge && !btns3[1]._badge, "E: a stale strip token stands the recommendation down");
}

// ---- F. item 6: the floating pill stands down in the studio ----
{
  const classes = new Set();
  const body = { classList: { toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) } };
  const sb = {
    console,
    document: { body },
    $: () => null,
    $$: () => [],
    hidePlayDetail: () => {},
  };
  sb.window = sb;
  const spStart = appJs.indexOf("function showPanel(name)");
  const showPanelSrc = appJs.slice(spStart, appJs.indexOf('$$("[data-panel-btn]").forEach((b) => b.addEventListener', spStart));
  vm.runInContext(showPanelSrc, vm.createContext(sb));
  sb.showPanel("hypeframe");
  assert(classes.has("hf-studio-open205"), "F: opening the studio sets body.hf-studio-open205");
  sb.showPanel("plays");
  assert(!classes.has("hf-studio-open205"), "F: leaving the studio clears it — the pill returns");
}
assert(css.includes("body.hf-studio-open205 .float-submit{display:none}"), "F: the CSS hides the floating pill while the studio is open");
assert(home.includes('id="floatSubmit"') && home.includes('id="menuHf125"'), "F: the pill itself and the menu's Post a Play entry are untouched");

// ---- G. item 7: conditional jersey field (VM drive) ----
{
  const mkEl = () => ({ hidden: false, disabled: false, value: "" });
  const customRow = mkEl(), jerseyRow = mkEl(); jerseyRow.hidden = true;
  const nameEl = mkEl(), jerseyEl = mkEl();
  const elMap = { "#hfBackCustomRow197": customRow, "#hfJerseyRow205": jerseyRow, "#hfName": nameEl, "#hfJersey": jerseyEl };
  const sb = { console, $: (s) => elMap[s] || null, $$: () => [], hfState: { backText: "name" } };
  sb.window = sb;
  const btBlock = appJs.slice(appJs.indexOf("const HF_BACK_TEXT_197"), appJs.indexOf("function hfBuildColorButtons"));
  vm.runInContext(btBlock, vm.createContext(sb));
  sb.hfPickBackText197("name");
  assert(jerseyRow.hidden === true, "G: Name — the jersey field is hidden (it doesn't affect the back)");
  sb.hfPickBackText197("name_number");
  assert(jerseyRow.hidden === false, "G: Name + number — the jersey field shows");
  sb.hfPickBackText197("custom");
  assert(jerseyRow.hidden === true && customRow.hidden === false, "G: Your own words — jersey hidden, the words row shows instead");
  sb.hfPickBackText197("none");
  assert(jerseyRow.hidden === true && customRow.hidden === true, "G: No name — jersey hidden");
  sb.hfPickBackText197("name_number");
  assert(jerseyRow.hidden === false, "G: toggling back to Name + number restores the field live");
}
assert(studio.includes('id="hfJerseyRow205" hidden'), "G: the jersey row starts hidden (the default back-text is Name)");
assert(css.includes("#hfJerseyRow205[hidden]{display:none}"), "G: the row's [hidden] guard rides (its .row2 grid would beat the attribute)");

// ---- H. items 8-12 ----
assert(css.includes(".hf-studio .seg.hf-backtext197{display:grid") && css.includes("grid-template-columns:1fr 1fr"), "H8: the back-text picker is a 2x2 grid");
assert(studio.includes('id="hfSizeGuideBtn205"') && studio.includes('id="hfSizeGuide205"'), "H9: the size guide button + panel ride beside Size");
assert(studio.includes("YXS") && studio.includes("YXL") && studio.includes(">S<") && studio.includes("general guide"), "H9: the guide covers youth + adult and labels itself a general guide — →226: the guide opens at YXS (YXXS cut catalog-wide)");
assert(appJs.includes('$("#hfSizeGuideBtn205")') && appJs.includes("aria-expanded"), "H9: the guide toggle is wired");
assert(studio.indexOf('id="hfSummary205"') > studio.indexOf('id="hfOrderForm"') && studio.indexOf('id="hfSummary205"') < studio.indexOf('id="hfGuardianEmail"'), "H10: the order summary line sits above the email field");
{
  const sb = { console, $: () => null, hfState: { colorway: "Black", size: "YM", side: "front", preset: "hypeframe" } };
  sb.window = sb;
  const sumBlock = appJs.slice(appJs.indexOf("const HF_PRESET_LABELS205"), appJs.indexOf("function hfPickColor")); // →229: slice end was hfSetPreset — retired with the picker
  vm.runInContext(sumBlock, vm.createContext(sb));
  assert(sb.hfSummary205() === "Black hoodie · Youth M · Front print · Hype Frame", "H10: the summary reads live state — 'Black hoodie · Youth M · Front print · Hype Frame'");
  sb.hfState.size = "L"; sb.hfState.side = "back"; sb.hfState.preset = "classic"; sb.hfState.colorway = "Heather Gray";
  assert(sb.hfSummary205() === "Heather Gray hoodie · Adult L · Back print · Hype Frame", "H10: the summary tracks color / adult size / side picks — →229: a legacy preset value in state still reads Hype Frame (the labels map carries only hypeframe; the format is fixed)");
  sb.hfState.size = "YXXS";
  assert(sb.hfSummary205().includes("Youth XXS"), "H10: the smallest youth size reads 'Youth XXS'");
}
for (const fn of ["hfPickColor", "hfPickSize", "hfPickSide"]) { // →229: hfSetPreset retired with the picker — it no longer exists to re-sync anything
  const body = appJs.slice(appJs.indexOf(`function ${fn}(`), appJs.indexOf("}", appJs.indexOf(`function ${fn}(`)));
  assert(body.includes("hfSyncSummary205()"), `H10: ${fn} re-syncs the summary`);
}
assert(studio.includes("Send order request") && !home.includes("Send hoodie request"), "H11: the submit button is 'Send order request' everywhere — →222: renamed from the R205 'Send hoodie request'");
assert(studio.includes("No payment today. A parent or guardian confirms first."), "H11: the verbatim no-payment line rides under the submit — →222: 'No payment today. A parent or guardian confirms first.' (supersedes the R205 email copy)");
assert(!home.includes("no payment and no price"), "H11: the old no-price note is gone (superseded by the verbatim copy)");
assert(!home.includes("Name on the print"), "H12: 'Name on the print' is gone from the page");
assert(studio.includes("Name — printed at the top of the design"), "H12: the name field says what the name is — →218: printed at the top of the design (the name lives in the artwork now, not embroidered across the back)");
for (const id of ["hfInstant205", "hfSelected205", "hfJerseyRow205", "hfSizeGuideBtn205", "hfSizeGuide205", "hfSummary205", "hfNoPay205"])
  assert(home.split(`id="${id}"`).length === 2, "H: id occurs exactly once: " + id);

// ---- I. served ----
const s = await boot(8955);
try {
  const served = await (await fetch(s.base + "/")).text();
  assert(served.includes("Two ways to start:") && served.includes("Send order request") && served.includes('id="hfSummary205"') && served.includes('id="hfInstant205"') && served.includes("app.js?v=239") && served.includes("styles.css?v=228"), "I: the served homepage carries the two-way card, the renamed submit (— →222: 'Send order request'), the summary + instant preview, and the v206/v203 pins — →207: now v207/v204 (Round 206) — →208: now v208/v205 (Round 207) — →209: now v209 (Round 208) — →210: now v210/v206 (Round 209) — →211: now v211/v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");
  const servedJs = await (await fetch(s.base + "/app.js")).text();
  assert(!servedJs.includes("window.hfChoiceSample") && servedJs.includes("function hfRecommend205") && servedJs.includes("function hfScoreStills205") && servedJs.includes("hf-studio-open205"), "I: the served app.js carries the recommendation + studio pill stand-down, and no Sample handler");
  const servedCss = await (await fetch(s.base + "/styles.css")).text();
  assert(servedCss.includes("width:46px;height:46px") && servedCss.includes(".hf-studio .seg.hf-backtext197{display:grid") && servedCss.includes("body.hf-studio-open205 .float-submit{display:none}"), "I: the served styles carry the small play button, the 2x2 grid and the pill stand-down");
} finally { s.child.kill(); }

console.log("\nALL R205 CHECKS PASSED");
