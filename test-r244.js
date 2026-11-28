// Round 244 (2026-11-27, Emil — from his hands-on phone review
// of the LIVE studio, play 71 Nicholas "Double"): the studio
// flow round. His governing order: 1) select the image they
// want; 2) pick Frame or avatar; 3) if avatar, generation
// starts RIGHT when avatar is clicked; 4) decide name etc.;
// then the rest.
//   1. AVATAR TAP — on his phone the tap did nothing visible:
//      the handler only unhid the maker panel two sections
//      down (off-screen) and generation still needed a second
//      tap on "Make my avatar"; the garment never changed, and
//      until the one-time status fetch answered "configured"
//      the panel didn't even open. (A real-Chromium probe of
//      the pre-244 page confirmed the click itself flips
//      aria-pressed/imageStyle and the button is the hit
//      target — the dead end was the flow, not the binding.)
//      Now the pick flips + auto-starts generation from the
//      current frame, progress rides in the preview card, the
//      finished avatar is applied as the design on the
//      garment, and failure surfaces in the card with a retry.
//   2. RECOMMENDED FRAME — play 71's ★ was 0:12, an empty-field
//      fence shot (and the default selection). The scorer's
//      dominant term was sharpness (a chain-link fence is a
//      gradient magnet; a still camera is never blurred) and
//      nothing required the winner to contain motion or a
//      subject. Now a play's poster_time anchors the ★ to the
//      strip frame nearest it (the poster is the curated
//      action frame), and the scorer disqualifies empty/static
//      frames whenever any frame carries real motion.
//   3. FRONT/BACK — out of the garment card; small toggles on
//      the "$110 · Made to order" price row (#hfGarmentFlip206).
//   4. FENCE — "Checking your frame for a fence…" never
//      resolved on his phone: the seed frame's detect was in
//      flight when the ★ frame committed; the commit's reset
//      bumped the run token (invalidating run 1) but never
//      cleared fenceAutoBusy229, the new frame's check
//      early-returned on busy, and run 1's finally skipped its
//      clear on the token mismatch — a session-wide deadlock
//      the stubbed-fetch test rig never saw (its runs finish
//      before the strip lands). The reset now clears busy, a
//      superseded run's failure records nothing, the removing
//      phase has its own note, a failed verdict is a
//      first-class state with a retry, and a stale clean can
//      never swap into a replaced frame.
//   5. PAGE TOP — Back to the board is the first thing on the
//      page (the studio hero block is gone, panel top padding
//      36px → 8px) and the product card's "From the play …"
//      sub-line is removed.
//   6. SECTION ORDER — Name on design moves up out of the
//      Artwork section to directly follow Your moment.
//   A. Pins + top/flip statics.  B. Section order statics.
//   C. Flip drive (VM).  D. Recommendation (scorer units +
//      hfRecommend205 drives).  E. Avatar drive (VM, real
//      picker + maker blocks).  F. Fence race drive (VM, real
//      fence block, deferred fetches).  G. Served smoke.
// Exits non-zero on failure. No real OpenAI/Anthropic calls:
// every network seam is stubbed in-process.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 40; i++) await wait(5); };

const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));
const prod = studio.slice(studio.indexOf('id="hfProduct215"'), studio.indexOf('id="hfReview215"'));
const at = (id) => prod.indexOf(`id="${id}"`);

// ---- A. pins + page-top / flip statics ----
{
  assert(home.includes('src="app.js?v=241"') && home.includes('href="styles.css?v=229"'), "A: asset pins — app.js v239 / styles v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
  // (5a) Back to the board is the first content of the studio view.
  const wrapOpen = studio.indexOf('<div class="wrap">');
  const firstBits = studio.slice(wrapOpen, wrapOpen + 220);
  assert(firstBits.includes('id="hfBackBtn246"') && !firstBits.includes("data-panel-btn") && firstBits.includes("Back to the board"), "A: 'Back to the board' is the first content element of the studio view — →246: the button is #hfBackBtn246 and no longer carries data-panel-btn (hfBack246 returns to the entry view; the generic handler was the dump-to-Watch bug)");
  // (5b) the hero block is gone — eyebrow, headline, play line.
  assert(!studio.includes("sec-tag") && !studio.includes('<span class="lime">Your swag.</span>') && !studio.includes('id="hfPlayLine"'), "A: the studio hero block (eyebrow / 'Your moment. Your swag.' headline / #hfPlayLine) is removed");
  assert(!appJs.includes('$("#hfPlayLine")'), "A: app.js no longer writes to the removed #hfPlayLine");
  assert(css.includes("#hypeframe{padding:8px 0 42px}") && !css.includes("#hypeframe{padding:36px 0 42px}"), "A: the studio panel's dead top gap is gone (padding-top 36px → 8px)");
  // (5c) the product card sub-line is gone.
  assert(!studio.includes('id="hfProductSub215"') && !appJs.includes("hfProductSub215"), "A: the 'From the play … frame is already on the hoodie' sub-line is removed (markup + writer)");
  // (3) the flip rides the price row, out of the garment card.
  const priceRow = prod.slice(prod.indexOf('class="hf-price-row244"'), prod.indexOf('id="hfGarment206"'));
  assert(priceRow.includes('id="hfPriceTop222"') && priceRow.includes('id="hfGarmentFlip206"') && priceRow.includes('data-hf-garment-view="front"') && priceRow.includes('data-hf-garment-view="back"'), "A: the price row carries '$110 · Made to order' + the Front/Back toggles (#hfGarmentFlip206)");
  const card = prod.slice(at("hfGarment206"), at("hfRowPhoto215"));
  assert(!card.includes("data-hf-garment-view"), "A: the garment card no longer carries the Front/Back buttons");
  assert((home.match(/data-hf-garment-view=/g) || []).length === 2, "A: exactly two garment-view buttons on the page (the price-row pair)");
  assert(css.includes(".hf-price-row244{display:flex") && css.includes("#hfGarmentFlip206 button{font-size:12.5px;padding:4px 12px}"), "A: the price row is a flex row and the toggles wear the small (∼29px) sizing");
  assert(appJs.includes('$$("#hfGarmentFlip206 [data-hf-garment-view]")'), "A: the garment sync + click wiring select the flip by its new group id");
  // (1) the avatar's in-card status block rides in the garment card.
  assert(card.includes('id="hfAvatarCard244"') && card.includes('id="hfAvatarCardNote244"') && card.includes('id="hfAvatarRetry244"'), "A: the preview card carries the avatar status block (note + retry)");
  assert(card.indexOf('id="hfImageStyles"') < card.indexOf('id="hfAvatarCard244"'), "A: …directly under the Frame | Illustrated avatar selector");
  // (4) the fence retry rides the auto block.
  assert(card.includes('id="hfFenceAutoRetry244"'), "A: the auto fence block carries its retry button");
}

// ---- B. section order statics (Emil's flow order) ----
{
  assert(at("hfPhotoPanel215") > -1 && at("hfRowBackText215") > at("hfPhotoPanel215") && at("hfBackTextPanel215") > at("hfRowBackText215") && at("hfRowDesign246") > at("hfBackTextPanel215") && at("hfDesignPanel246") > at("hfRowDesign246") && at("hfBuyCard215") > at("hfDesignPanel246"), "B: sections run Your moment → Name on design → Artwork → Color & size — →246: the Artwork section is DELETED; the Design label section stands in its slot");
  const art = prod.slice(at("hfDesignPanel246"), at("hfBuyCard215")); // →246: the slice runs from the Design panel (the Artwork panel is deleted)
  assert(!art.includes('id="hfBackText197"') && !art.includes('id="hfName"'), "B: Name on design is OUT of the Artwork section");
  assert(!art.includes('id="hfAvatarPanel206"') && art.includes('id="hfLabel218"'), "B: the Artwork section keeps the avatar maker, the design label and print placement — →246: the Artwork section is DELETED — the avatar maker is gone (the lifecycle lives in the preview card), the design label is its own section, and print placement follows as its own section");
  const name = prod.slice(at("hfRowBackText215"), at("hfRowDesign246")); // →246: the Name block now runs to the Design row
  assert(name.includes('id="hfBackText197"') && name.includes('id="hfName"') && name.includes('id="hfJerseyRow205"') && name.includes('id="hfRowBackTextState215"'), "B: the moved Name block is whole (modes, name field, jersey row, state line)");
}

// ---- shared fake-DOM helpers ----
function fakeCanvas(tag, w, h) {
  const cv = { width: w || 200, height: h || 150, _tag: tag || "x" };
  cv.getContext = () => ({ drawImage(src) { if (src && src._tag) cv._tag = src._tag; } });
  cv.toDataURL = () => "data:image/jpeg;base64," + cv._tag + "-" + cv.width + "x" + cv.height;
  return cv;
}
const mkEl = () => ({
  hidden: false, textContent: "", value: "", disabled: false, style: {}, dataset: {}, _src: "",
  classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  setAttribute() {}, getAttribute() { return this._src; },
  set src(v) { this._src = v; }, get src() { return this._src; },
});

// ---- C. flip drive (VM): the sync paints the price-row pills ----
{
  const block = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  assert(block.includes("function hfGarmentSync206"), "C: harness — the garment block slice carries the sync");
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                 { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const garmentEl = mkEl();
  const els = { "#hfGarment206": garmentEl, "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(), "#hfGarmentPrint206": mkEl(), "#hfGarmentShade211": mkEl(), "#hfGarmentCrest211": mkEl(), "#hfGarmentBackText206": mkEl(), "#hfName": { value: "Nick" }, "#hfJersey": { value: "" }, "#hfBackCustom197": { value: "" } };
  els["#hfGarmentPrint206"].naturalWidth = 720; els["#hfGarmentPrint206"].naturalHeight = 782;
  const state = { play: { id: 71, title: "Double" }, frozen: true, printDataUrl: "data:print", printAspect: 782 / 720, colorway: "Black", side: "back", garmentView206: "front", backText: "name", imageStyle: "photo", placement: { cx: 50, cy: 42, size: 78 }, avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false };
  const sb = { console, $: (s) => els[s] || null, $$: (s) => (s.includes("data-hf-garment-view") ? flips : []), hfState: state, HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 }, hfPrintTone: () => "#f6f1e4" };
  sb.window = sb;
  vm.runInContext(block, vm.createContext(sb));
  sb.hfGarmentSync206();
  assert(flips[0].attrs["aria-pressed"] === "true" && flips[1].attrs["aria-pressed"] === "false", "C: the sync marks the FRONT pill pressed when the view is front (the pills live outside the card now)");
  state.garmentView206 = "back";
  state.play = null; state.frozen = false; state.printDataUrl = ""; // the garment card stands down — the price-row pills must still sync
  sb.hfGarmentSync206();
  assert(flips[1].attrs["aria-pressed"] === "true" && garmentEl.hidden === true, "C: …and the pills still sync when the garment card itself is hidden");
}

// ---- D. recommendation ----
const W48 = 48, H27 = 27;
function pattern48(hi, lo) { const lum = new Float32Array(W48 * H27); for (let y = 0; y < H27; y++) for (let x = 0; x < W48; x++) lum[y * W48 + x] = (x + y) % 2 ? hi : lo; return lum; }
function blob48(lum, bx, by, val) { const out = Float32Array.from(lum); for (let y = by; y < by + 10; y++) for (let x = bx; x < bx + 7; x++) out[y * W48 + x] = val; return out; }
{
  const scoreSrc = appJs.slice(appJs.indexOf("function hfThumbLuma205"), appJs.indexOf("function hfFmtTime"));
  assert(scoreSrc.includes("function hfScoreStills205") && scoreSrc.includes("function hfRecommend205"), "D: harness — the recommendation slice carries scorer + recommender");
  const scoreOf = new Function(scoreSrc + "; return hfScoreStills205;")();
  const soft = pattern48(150, 95), sharp = pattern48(205, 55);
  const B = { lum: blob48(soft, 20, 9, 250), w: W48, h: H27 };
  const C = { lum: blob48(soft, 24, 9, 250), w: W48, h: H27 };
  const S1 = { lum: sharp, w: W48, h: H27 };
  const S2 = { lum: Float32Array.from(sharp), w: W48, h: H27 }; // the held, identical, empty frame — play 71's 0:12 shape
  const winner = scoreOf([B, C, S1, S2]);
  assert(winner !== 3, `D: the held empty frame (max sharpness, zero motion, zero subject) is NEVER crowned while action frames exist (winner was ${winner})`);
  const stillWinner = scoreOf([S1, S2, { lum: Float32Array.from(sharp), w: W48, h: H27 }]);
  assert(stillWinner >= 0, "D: an all-still strip still gets a recommendation (the guard restores the field)");

  // hfRecommend205 drives: poster anchor + scoring fallback.
  const rgba = (lum) => { const d = new Uint8ClampedArray(lum.length * 4); for (let i = 0; i < lum.length; i++) { d[i * 4] = lum[i]; d[i * 4 + 1] = lum[i]; d[i * 4 + 2] = lum[i]; d[i * 4 + 3] = 255; } return d; };
  function driveRecommend(play, lumList, times) {
    const jumps = [];
    const thumbs = lumList.map((lum, i) => {
      const img = { complete: true, naturalWidth: W48, naturalHeight: H27, _rgba: rgba(lum), addEventListener() {} };
      const btn = { dataset: { hfT: String(times[i]) }, _badge: null,
        querySelector(sel) { return sel.includes("img") ? img : this._badge; },
        appendChild(ch) { if ((ch.className || "").includes("hf-rec-badge205")) this._badge = ch; },
        setAttribute() {}, getAttribute: () => "" };
      return btn;
    });
    const strip = { querySelectorAll: () => thumbs };
    const sb = {
      console, hfState: { play, frameTime205: null, frozen: false, seedFrame215: false }, hfStripToken: 0,
      document: { createElement: () => { const cv = { width: 0, height: 0, _img: null, getContext: () => ({ drawImage(im) { cv._img = im; }, getImageData: () => ({ data: cv._img._rgba }) }) }; return cv; } },
      hfJumpToFrame: (t) => jumps.push(t),
    };
    sb.window = sb;
    vm.runInContext(scoreSrc, vm.createContext(sb));
    return { sb, thumbs, jumps, strip };
  }
  { // poster_time present → the ★ is the poster-nearest frame, whatever the scorer would say
    const { sb, thumbs, jumps, strip } = driveRecommend({ id: 71, poster_time: 2 }, [S1.lum, B.lum, C.lum, S2.lum, S1.lum], [0, 1, 2, 3, 12]);
    await sb.hfRecommend205(strip, 0);
    assert(thumbs[2]._badge && jumps.length === 1 && jumps[0] === 2, "D: with poster_time=2 the ★ lands on the t=2 frame and pre-selects it (the poster anchor beats the scorer)");
  }
  { // no poster_time → the scoring path runs, and the held empty tail frame still loses
    const { sb, thumbs, jumps, strip } = driveRecommend({ id: 99 }, [B.lum, C.lum, S1.lum, S2.lum], [0, 1, 2, 3]);
    await sb.hfRecommend205(strip, 0);
    const badged = thumbs.findIndex((b) => !!b._badge);
    assert(badged >= 0 && badged !== 3 && jumps.length === 1 && jumps[0] !== 3, `D: without poster_time the ★ comes from scoring and is not the held empty frame (badged ${badged})`);
  }
}

// ---- E. avatar drive (VM): pick → generate → applied; failure → retry ----
function driveAvatar({ configured = true, avatarFails = false } = {}) {
  const pickSrc = appJs.slice(appJs.indexOf("function hfPickImageStyle"), appJs.indexOf("/* Words on the back"));
  const bigSlice = appJs.slice(appJs.indexOf("let hfAvatarStatusPromise206"), appJs.indexOf("/* Part F (Round 206 scope update"));
  const els = {};
  const styleBtns = [{ dataset: { hfImageStyle: "photo" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                     { dataset: { hfImageStyle: "avatar" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const calls = { avatar: 0, status: 0, composes: 0, garment: 0 };
  const state = {
    play: { id: 71, title: "Double" }, frozen: true, frameCanvas206: fakeCanvas("FRAME", 400, 300), printDataUrl: "data:print", printAspect: 1,
    imageStyle: "photo", backText: "name", side: "back",
    avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, avatarConfigured206: configured, avatarBusy206: false,
    designAspect218: 0, avatarFocus221: null, avatarFailed244: false, avatarStale244: false, seedFrame215: false,
    fenceConfigured222: null, fenceBusy222: false, fenceClean222: "", fenceDetect229: null, fenceAuto229: null,
    fenceAutoCache229: {}, fenceAutoKey229: "", fenceAutoClean229: "", fenceAutoOriginal229: null, fenceAutoBusy229: false, fenceAutoFailed229: false, fenceAutoToken229: 0,
  };
  const sb = {
    console, hfState: state,
    $: (sel) => { if (sel === "#hfCanvas") return fakeCanvas("PRINTSRC", 400, 300); return els[sel] || (els[sel] = mkEl()); },
    $$: (sel) => (sel.includes("data-hf-image-style") ? styleBtns : []),
    document: { createElement: () => fakeCanvas("x", 8, 8) },
    Image: class { set src(v) { this._src = v; this.naturalWidth = 100; this.naturalHeight = 110; queueMicrotask(() => this.onload && this.onload()); } },
    fetch: async (p) => {
      if (p === "/api/hype-frame/avatar-status") { calls.status++; return { ok: true, json: async () => ({ configured: true }) }; }
      if (p === "/api/hype-frame/avatar") { calls.avatar++; if (avatarFails) return { ok: false, status: 500, json: async () => ({ ok: false, message: "maker boom" }) }; return { ok: true, json: async () => ({ ok: true, image: "data:image/png;base64,AVATAR" }) }; }
      throw new Error("unexpected fetch " + p);
    },
    setTimeout, clearTimeout, AbortController,
    composeHfPrint() { calls.composes++; state.printDataUrl = state.avatarApplied206 ? state.avatarDataUrl206 : "data:print"; },
    hfGarmentSync206() { calls.garment++; },
    hfSyncRowStates215() {},
    hfDesignFirstName218: () => "Nick", hfDesignLabel218: () => "DOUBLE", hfTone218: () => "blue",
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(pickSrc, ctx);
  vm.runInContext(bigSlice, ctx);
  return { sb, els, calls, state, styleBtns, setAvatarFails(v) { avatarFails = v; } };
}
{
  const { sb, els, calls, state, styleBtns } = driveAvatar();
  sb.hfPickImageStyle("avatar");
  assert(state.imageStyle === "avatar" && styleBtns[1].attrs["aria-pressed"] === "true" && styleBtns[0].attrs["aria-pressed"] === "false", "E: tapping Illustrated avatar flips the selector");
  await settle();
  assert(calls.avatar === 1, "E: generation STARTED from the pick itself — no second tap on a Make button");
  assert(state.avatarDataUrl206 === "data:image/png;base64,AVATAR" && state.avatarApplied206 === true, "E: the finished avatar becomes the design (applied, not just previewing)");
  assert(state.printDataUrl === "data:image/png;base64,AVATAR", "E: …and the composed print IS the avatar");
  assert((els["#hfAvatarCardNote244"].textContent || "").includes("design on the hoodie"), "E: the preview card says the avatar landed");
  assert(els["#hfAvatarRetry244"].hidden === true, "E: no retry offered after a success");
  const callsBefore = calls.avatar;
  sb.hfPickImageStyle("photo");
  await settle();
  assert(state.imageStyle === "photo" && calls.avatar === callsBefore, "E: picking Frame starts nothing (the Frame path is untouched)");
}
{
  const d = driveAvatar({ avatarFails: true });
  d.sb.hfPickImageStyle("avatar");
  await settle();
  assert(d.calls.avatar === 1 && d.state.avatarFailed244 === true, "E: a failed generation is recorded (never silence)");
  assert((d.els["#hfAvatarCardNote244"].textContent || "").includes("maker boom"), "E: the failure reason shows in the preview card");
  assert(d.els["#hfAvatarRetry244"].hidden === false, "E: …with the retry offered right there");
  d.setAvatarFails(false);
  await d.sb.hfAvatarAutoStart244(); // the retry button's own call
  assert(d.state.avatarApplied206 === true && d.els["#hfAvatarRetry244"].hidden === true, "E: the retry regenerates and lands the avatar");
}
{
  // The one-time status word still out when the parent taps:
  // the pick waits for it, then generation starts on its own.
  const d = driveAvatar({ configured: null });
  d.sb.hfPickImageStyle("avatar");
  await settle();
  assert(d.calls.status === 1 && d.calls.avatar === 1 && d.state.avatarApplied206 === true, "E: with the status unresolved at tap time, generation still starts once it lands");
}

// ---- F. fence race drive (VM): the Emil deadlock, replayed ----
function driveFence() {
  const fenceBlock = appJs.slice(appJs.indexOf("let hfFenceStatusPromise222"), appJs.indexOf("/* Part F (Round 206 scope update"));
  const els = {};
  const canvasEl = fakeCanvas("FENCED", 200, 150);
  const calls = { status: 0, detect: 0, remove: 0 };
  const pending = { detect: [], remove: [] };
  let detectBehavior = "defer"; // "defer" | "fail"
  const sb = {
    console,
    hfState: {
      play: { id: 71 }, frozen: true, printDataUrl: "", printAspect: 0, seedFrame215: true,
      frameCanvas206: fakeCanvas("FENCED", 200, 150),
      avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, designAspect218: 0, avatarFocus221: null,
      fenceConfigured222: null, fenceBusy222: false, fenceClean222: "",
      fenceDetect229: null, fenceAuto229: null, fenceAutoCache229: {}, fenceAutoKey229: "", fenceAutoClean229: "",
      fenceAutoOriginal229: null, fenceAutoBusy229: false, fenceAutoFailed229: false, fenceAutoToken229: 0,
    },
    $: (sel) => { if (sel === "#hfCanvas") return canvasEl; return els[sel] || (els[sel] = mkEl()); },
    $$: () => [],
    document: { createElement: () => fakeCanvas("x", 1, 1) },
    Image: class { set src(v) { this._src = v; this.naturalWidth = 120; this.naturalHeight = 90; queueMicrotask(() => this.onload && this.onload()); } },
    fetch: (p) => {
      if (p === "/api/hype-frame/fence-status") { calls.status++; return Promise.resolve({ ok: true, json: async () => ({ ok: true, configured: true, detect: true, auto: true }) }); }
      if (p === "/api/hype-frame/fence-detect") { calls.detect++; if (detectBehavior === "fail") return Promise.resolve({ ok: false, status: 502, json: async () => ({ ok: false, message: "vision boom" }) }); return new Promise((res) => pending.detect.push(res)); }
      if (p === "/api/hype-frame/remove-fence") { calls.remove++; return new Promise((res) => pending.remove.push(res)); }
      return Promise.reject(new Error("unexpected fetch " + p));
    },
    setTimeout, clearTimeout, AbortController,
    composeHfPrint() { sb.hfState.printDataUrl = "data:print"; },
    hfSyncAvatar206() {},
  };
  sb.window = sb;
  vm.runInContext(fenceBlock, vm.createContext(sb));
  const okRes = (body) => ({ ok: true, status: 200, json: async () => body });
  return { sb, els, calls, pending, okRes, setDetectBehavior(v) { detectBehavior = v; } };
}
{
  const { sb, els, calls, pending, okRes } = driveFence();
  await sb.hfFenceStatus222(); // the status landing starts run 1 on the seed frame (detect in flight)
  await settle();
  assert(calls.detect === 1 && sb.hfState.fenceAutoBusy229 === true, "F: entering the studio starts the fence check on the seed frame");
  assert((els["#hfFenceAutoNote229"].textContent || "").includes("Checking your frame for a fence"), "F: …with the checking note up");
  // The ★ frame commits mid-flight — exactly the commit sequence
  // (new frame snapshot, reset, auto-check). Pre-244 this
  // deadlocked: busy never cleared, no second run ever started.
  sb.hfState.frameCanvas206 = fakeCanvas("FENCED2", 200, 150);
  sb.hfState.seedFrame215 = false;
  sb.hfFenceAutoReset229();
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 2, "F: the new frame's check STARTS even though run 1 is still in flight (the deadlock is gone)");
  // Run 1's detect finally answers — superseded: it must stand
  // down silently (no edit, no state theft, busy stays run 2's).
  pending.detect[0](okRes({ ok: true, configured: true, auto: true, fence: true }));
  await settle();
  assert(calls.remove === 0 && sb.hfState.fenceAutoBusy229 === true, "F: the superseded run stands down — no edit fired, run 2 still owns the busy flag");
  // Run 2: fence found → the removing state gets its own note.
  pending.detect[1](okRes({ ok: true, configured: true, auto: true, fence: true }));
  await settle();
  assert(calls.remove === 1 && (els["#hfFenceAutoNote229"].textContent || "").includes("removing it"), "F: a found fence moves the note to the removing state while the edit runs");
  pending.remove[0](okRes({ ok: true, configured: true, image: "data:image/png;base64,CLEANED2" }));
  await settle();
  assert(sb.hfState.fenceAutoBusy229 === false && sb.hfState.fenceAutoClean229 === "data:image/png;base64,CLEANED2", "F: run 2 lands — busy clears and the cleaned frame is the print source");
  assert((els["#hfFenceAutoNote229"].textContent || "").includes("Fence removed"), "F: …and the note resolves to the removed state (never stuck on 'Checking…')");
}
{
  const d = driveFence();
  d.setDetectBehavior("fail");
  await d.sb.hfFenceStatus222();
  await settle();
  assert(d.sb.hfState.fenceAutoBusy229 === false && d.sb.hfState.fenceAutoFailed229 === true, "F: a failed check resolves — busy clears, the failure is recorded");
  assert((d.els["#hfFenceAutoNote229"].textContent || "").includes("We couldn't clean this frame — try another frame.") && d.els["#hfFenceAutoRetry244"].hidden === false, "F: …the note says so in plain words and the retry is offered — →246: the failure copy is now the ONE plain line (no mechanics, no manual step to point at)");
  assert(!d.els["#hfFence222"], "F: …and the manual fence step surfaces as the other fallback — →246: the manual step is DELETED; the plain line + retry are the whole fallback");
  d.setDetectBehavior("defer");
  d.sb.hfFenceAutoRetry229();
  await settle();
  assert(d.calls.detect === 2 && d.sb.hfState.fenceAutoFailed229 === false, "F: the retry re-runs the check and stands the fallback down");
  d.pending.detect[d.pending.detect.length - 1](d.okRes({ ok: true, configured: true, auto: true, fence: false }));
  await settle();
  assert(d.els["#hfFenceAutoNote229"].textContent === "" && d.els["#hfFenceAutoRetry244"].hidden === true, "F: a fence-free retry resolves quietly (no note, no retry)");
}

// ---- G. served smoke ----
{
  const port = 3994;
  const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || "/tmp", "hh-r244-"));
  const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: tmp, OPENAI_API_KEY: "", AI_VISION_API_KEY: "" }, stdio: "pipe" });
  try {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) { try { const r = await fetch(`http://localhost:${port}/api/health`); up = r.ok; } catch { await wait(200); } }
    assert(up, "G: the server boots");
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    assert(html.includes("app.js?v=241") && html.includes("styles.css?v=229"), "G: the served page carries the Round 244 pins — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
    assert(html.includes('id="hfGarmentFlip206"') && html.includes('id="hfAvatarCard244"') && !html.includes('id="hfPlayLine"'), "G: …with the price-row flip + avatar card in, and the hero block out");
  } finally { child.kill("SIGKILL"); }
}

console.log("\nALL R244 CHECKS PASSED");
