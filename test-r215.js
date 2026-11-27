// Round 215 test: the one-page Hype Frame studio (Emil,
// 2026-11-26 — outside feedback + his approved one-page mock:
// "I like the mock up! Just want to minimize scrolling where
// we can"). The Round 211 three-step customizer collapses
// into ONE product page + the existing Review.
// Run: node test-r215.js
// What this suite pins down:
//   A. Pins: app.js v214 / styles v210 (both files changed).
//   B. Statics: no stepper anywhere (markup / JS / CSS); the
//      product page ships (title, hero, ONE buy card with
//      color + size + $110, four collapsed option rows, the
//      sticky Review bar INSIDE the product page); the
//      precision tools (player, Freeze, fine scrub) live
//      inside Change photo's Pick from video expander and NOT
//      on the main page; the dashed print guide is gone from
//      markup, JS and CSS; personalization exists exactly
//      once, on the product page, and Review only summarizes.
//      — →222: the four option rows became always-open
//      SECTIONS (moment → artwork → color & size), the buy
//      card moved last, and Review's submit is "Send order
//      request" with the new no-payment line; test-r222.js
//      pins the rebuild itself.
//   C. The poster seed (VM): hfSeedUrl215 picks the right
//      still per media kind (never the branded placeholder);
//      hfSeedPoster215 freezes + composes from the poster with
//      NO video interaction, landing on state identical to
//      the same frame hand-frozen through hfCapturePrint's
//      image path (the payload byte-identity anchor); load
//      failure / compose failure / a superseding play all
//      fall back to the pre-seed behavior.
//   D. init wiring: opening the studio seeds the play, starts
//      on the product screen with every row closed, and names
//      the page for the athlete. — →222: no rows to close (the
//      sections stand open) and NO size is preselected.
//   E. The avatar gate still holds on the one-page studio:
//      the panel lives in the Artwork panel with its consent
//      line, and a finished generation previews on the
//      garment WITHOUT becoming the print.
//   F. Served: pins + one-page studio + seed/screen code.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r215-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log, stop: () => child.kill("SIGKILL") };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));

// ---- A. pins ----
assert(home.includes('href="styles.css?v=221"') && home.includes('src="app.js?v=230"'), "A: asset pins — app.js v214 / styles v210 (Round 215; both files changed) — →217: app.js now v215 (Round 217) — →218: app.js now v216 (Round 218); styles keeps v210 — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round)");

// ---- B. statics ----
assert(!studio.includes("data-hf-step-pill") && !studio.includes("data-hf-step-back") && !appJs.includes("function hfGoStep211(") && !css.includes(".hf-step-pill211"), "B: no stepper — no pills or step backs in the markup, no step flow in app.js, no pill CSS");
const prod = studio.slice(studio.indexOf('id="hfProduct215"'), studio.indexOf('id="hfReview215"'));
assert(prod.includes('id="hfProductTitle215"') && prod.includes('id="hfGarment206"'), "B: the product page opens with its title + the garment hero");
const buy = studio.slice(studio.indexOf('id="hfBuyCard215"'), studio.indexOf('id="hfStickyBar215"'));
assert(buy.includes('id="hfColors"') && buy.includes('id="hfSizes"'), "B: ONE buy card carries color + size — →222: the buy card is the Color & size section (last, before the sticky bar; the slice end moved from hfRowPhoto215, which now precedes it)");
assert(prod.includes('id="hfPriceTop222"') && prod.includes("$110 · Made to order") && prod.indexOf('id="hfPriceTop222"') < prod.indexOf('id="hfGarment206"'), "B: the $110 price rides under the product name — →222: '$110 · Made to order' moved out of the buy card to #hfPriceTop222, above the garment (R215 kept it inside the card)");
for (const id of ["hfRowPhoto215", "hfRowArtwork215", "hfRowPlacement215", "hfRowBackText215"])
  assert(prod.includes(`id="${id}"`), "B: the section head #" + id + " ships (the R215 option-row id, kept) — →222: rows became always-open section heads");
assert((prod.match(/class="hf-optpanel215 hf-sec-body222" id="hf\w+Panel215">/g) || []).length === 4 && !prod.includes('Panel215" hidden'), "B: all four section panels stand OPEN — →222: R215 started them collapsed (hidden); the rebuild keeps every control on the page");
assert(prod.includes('id="hfStickyBar215"') && prod.includes('id="hfReviewBtn215"') && prod.includes(">Review hoodie →</button>"), "B: the sticky bar + gold Review button live INSIDE the product page (they vanish with it — never page chrome)");
assert(css.includes(".hf-stickybar215{") && css.includes("position:fixed") && css.includes("z-index:54"), "B: the bar is fixed to the viewport bottom while the studio is open");
assert(/#hfProduct215\{[^}]*padding-bottom/.test(css), "B: the product page carries bottom padding so the bar never covers content");
assert(/#hfProduct215 \.hf-garment-stage206\{max-width:284px\}/.test(css), "B: the hero stage is compact (284px — not full-viewport)");
// The precision tools live inside Change photo — and only there.
const photoPanel = studio.slice(studio.indexOf('id="hfPhotoPanel215"'), studio.indexOf('id="hfRowArtwork215"'));
for (const id of ["hfStripWrap", "hfClipRow211", "hfClipArea211", "hfVideoWrap127", "hfVideo", "hfFreeze", "hfFineRow206", "hfFineBack206", "hfFineFwd206", "hfScrub"])
  assert(photoPanel.includes(`id="${id}"`), "B: Change photo hosts #" + id + " (strip / Pick from video / Freeze / fine scrub)");
const beforePhoto = studio.slice(0, studio.indexOf('id="hfPhotoPanel215"'));
assert(!beforePhoto.includes('id="hfVideo"') && !beforePhoto.includes('id="hfFreeze"') && !beforePhoto.includes('id="hfStripWrap"'), "B: the player, Freeze and strip are NOT on the main page above the panel");
// The dashed print guide is gone everywhere.
assert(!studio.includes("hfGarmentWide206") && !appJs.includes("hf-garment-area-wide206") && !css.includes("hf-garment-area-wide206") && !css.includes(".hf-garment-wide206"), "B: the dashed print guide (Round 206 Part D) is dropped entirely — markup, painter and CSS");
// Personalization: exactly once, on the product page; Review summarizes.
assert((home.match(/id="hfBackText197"/g) || []).length === 1 && prod.includes('id="hfBackText197"') && prod.includes('id="hfJerseyRow205"'), "B: the personalization control + jersey field exist exactly once, on the product page");
const review = studio.slice(studio.indexOf('id="hfReview215"'));
assert(!review.includes('id="hfBackText197"') && !review.includes('id="hfSizes"') && review.includes('id="hfReviewBack206"') && review.includes('id="hfReviewSize206"'), "B: Review hosts no personalization/size control — its summary rows name the choices");
assert(review.includes('id="hfReviewBack215"') && review.includes(">Send order request</button>") && review.includes("No payment today. A parent or guardian confirms first."), "B: Review keeps its back affordance and the submit — →222: renamed 'Send order request' with the verbatim line 'No payment today. A parent or guardian confirms first.' (R215: 'Send hoodie request' + the longer email copy)");

// ---- C. The poster seed (VM) ----
{
  const seedBlock = appJs.slice(appJs.indexOf("function hfSeedUrl215"), appJs.indexOf("/* Round 211: one stage painter"));
  const captureBlock = appJs.slice(appJs.indexOf("function hfCapturePrint()"), appJs.indexOf("function freezeHfFrame()"));
  const mkCanvas = () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: "", drawImage() {}, fillRect() {} }) });
  const hfCanvas = mkCanvas();
  const photoImg = { naturalWidth: 1280, naturalHeight: 720 };
  class FakeImage {
    constructor() { FakeImage.last = this; this.naturalWidth = 0; this.naturalHeight = 0; }
  }
  let composeCalls = 0, composeThrows = false;
  const sb = {
    console,
    Image: FakeImage,
    document: { createElement: () => mkCanvas() },
    $: (s) => (s === "#hfCanvas" ? hfCanvas : s === "#hfPhoto" ? photoImg : null),
    hfState: { play: null, mediaType: "video", frozen: false, printDataUrl: "", printAspect: 0, frameCanvas206: null, avatarDataUrl206: "data:stale-avatar", avatarApplied206: true, avatarPreview206: true },
    composeHfPrint: () => {
      composeCalls++;
      if (composeThrows) throw new Error("compose boom");
      const fc = sb.hfState.frameCanvas206;
      sb.hfState.printDataUrl = "data:print:" + fc.width + "x" + fc.height;
      sb.hfState.printAspect = fc.height / fc.width;
    },
    hfSyncAvatar206: () => {},
    hfSyncFrozenThumb: () => {},
    hfGarmentSync206: () => {},
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(seedBlock, ctx);
  vm.runInContext(captureBlock, ctx);
  const S = sb.hfState;
  const reset = () => { S.play = null; S.mediaType = "video"; S.frozen = false; S.printDataUrl = ""; S.printAspect = 0; S.frameCanvas206 = null; S.avatarDataUrl206 = "data:stale-avatar"; S.avatarApplied206 = true; S.avatarPreview206 = true; composeThrows = false; };

  // Seed URL selection per media kind.
  assert(sb.hfSeedUrl215({ media_type: "image", media_url: "/uploads/p.jpg", poster_url: "/uploads/poster.jpg" }) === "/uploads/p.jpg", "C: a photo play seeds from the photo itself (the capture path's own source)");
  assert(sb.hfSeedUrl215({ media_type: "video", media_url: "/uploads/v.mp4", poster_url: "/uploads/poster.jpg" }) === "/uploads/poster.jpg", "C: a video play seeds from its poster");
  assert(sb.hfSeedUrl215({ media_type: "video", media_url: "/uploads/v.mp4", poster_url: "" }) === "", "C: a video play with no poster and no banked frame does NOT seed — never the branded placeholder");
  sb.btlPosters104 = { "/uploads/v.mp4": "data:banked-frame" };
  assert(sb.hfSeedUrl215({ media_type: "video", media_url: "/uploads/v.mp4", poster_url: "" }) === "data:banked-frame", "C: ...unless the board banked a real frame for it");
  delete sb.btlPosters104;
  assert(sb.hfSeedUrl215({ media_type: "link", media_url: "https://youtu.be/x", poster_url: "/uploads/poster.jpg" }) === "", "C: a link play never seeds (it has no still of its own)");
  assert(sb.hfSeedUrl215(null) === "", "C: no play, no seed");

  // The seed itself: poster loads → frozen + composed, no video touched.
  reset();
  const play = { id: 9, media_type: "video", media_url: "/uploads/v9.mp4", poster_url: "/uploads/poster-9.jpg", title: "Walk-off" };
  S.play = play;
  sb.hfSeedPoster215(play);
  const img = FakeImage.last;
  assert(img && img._src === undefined && img.src === "/uploads/poster-9.jpg", "C: the seed loads the play's poster");
  img.naturalWidth = 1280; img.naturalHeight = 720;
  img.onload();
  assert(S.frozen === true && S.printDataUrl === "data:print:1280x720" && S.printAspect === 0.5625, "C: the seed freezes + composes the poster at natural size — the hoodie opens finished");
  assert(S.frameCanvas206 && S.frameCanvas206.width === 1280 && S.frameCanvas206.height === 720, "C: the frame canvas snapshot carries the poster's pixels (the avatar maker's input)");
  assert(S.avatarDataUrl206 === "" && S.avatarApplied206 === false && S.avatarPreview206 === false, "C: the seed stands the avatar down exactly like a capture (a stale avatar never rides a new frame)");
  const seededState = JSON.stringify({ frozen: S.frozen, print: S.printDataUrl, aspect: S.printAspect, fcw: S.frameCanvas206.width, fch: S.frameCanvas206.height });

  // Byte-identity anchor: the SAME frame hand-frozen through
  // hfCapturePrint's image path lands on identical state.
  reset();
  S.mediaType = "image";
  assert(sb.hfCapturePrint() === true, "C: the hand-freeze capture runs");
  const capturedState = JSON.stringify({ frozen: S.frozen, print: S.printDataUrl, aspect: S.printAspect, fcw: S.frameCanvas206.width, fch: S.frameCanvas206.height });
  assert(capturedState === seededState, "C: seeded poster ≡ hand-frozen frame — identical frozen state, so the payload built from it is byte-identical");

  // Fallbacks: load error, compose failure, superseded play.
  reset(); S.play = play;
  sb.hfSeedPoster215(play);
  FakeImage.last.onerror();
  assert(S.frozen === false && S.printDataUrl === "", "C: a poster that fails to load leaves the studio unfrozen (the filmstrip path, as before)");
  reset(); S.play = play; composeThrows = true;
  sb.hfSeedPoster215(play);
  const img2 = FakeImage.last; img2.naturalWidth = 1280; img2.naturalHeight = 720; img2.onload();
  assert(S.frozen === false && S.printDataUrl === "" && S.frameCanvas206 === null, "C: a compose failure resets to the pre-seed state — never a half-frozen print");
  reset(); S.play = play;
  sb.hfSeedPoster215(play);
  const img3 = FakeImage.last;
  S.play = { id: 10, media_type: "video", media_url: "/uploads/v10.mp4", poster_url: "/uploads/poster-10.jpg" }; // a newer play opened meanwhile
  img3.naturalWidth = 1280; img3.naturalHeight = 720; img3.onload();
  assert(S.frozen === false && S.printDataUrl === "", "C: a seed that lands after a newer play opened stands down");
  reset(); S.play = play; S.frozen = true; S.printDataUrl = "data:print:manual";
  const callsBefore = composeCalls;
  sb.hfSeedPoster215(play);
  assert(composeCalls === callsBefore && S.printDataUrl === "data:print:manual", "C: an existing freeze is never overridden by the seed");
}

// ---- D. init wiring (statics over the real init) ----
{
  const init = appJs.slice(appJs.indexOf("function initHfStudio"), appJs.indexOf("function hfBuildStrip"));
  assert(init.includes("hfSeedPoster215(play)"), "D: opening the studio seeds the play's poster");
  assert(init.includes('hfShowScreen215("product", true)'), "D: a new play restarts on the product screen");
  assert(!init.includes("hfSetRow215(") && init.includes("hfClearSize222()"), "D: init touches no option rows (retired in →222 — the sections stand open) and CLEARS the size for a new play");
  assert(init.includes("hfProductTitle215") && init.includes("Hype Frame Hoodie"), "D: the page title names the athlete ('<Name>'s Hype Frame Hoodie')");
  assert(init.includes('hfPickSide("back")'), "D: the print-side default is still Back (Round 208)");
  assert(appJs.includes('backText: "name"') && appJs.includes('size: ""'), "D: the standing defaults ride — back text Name; size EMPTY — →222: no size is preselected (R215 defaulted YM); the Review gate prompts until one is tapped");
}

// ---- E. Avatar gate on the one-page studio ----
{
  const artPanel = studio.slice(studio.indexOf('id="hfArtworkPanel215"'), studio.indexOf('id="hfRowPlacement215"'));
  assert(artPanel.includes('id="hfAvatarPanel206"') && artPanel.includes("Avatar previews are made by OpenAI's image AI — your chosen frame, the athlete's first name and the design label below are sent to OpenAI to create it. Nothing is sent until you tap the button below."), "E: the avatar panel + verbatim consent line live in the Artwork panel — →218: the consent line also names the design's text slots (first name + label)");
  const makeBlock = appJs.slice(appJs.indexOf("async function hfMakeAvatar206"), appJs.indexOf("function hfApplyAvatar206"));
  assert(!makeBlock.includes("hfApplyAvatar206(") && makeBlock.includes("avatarPreview206 = true"), "E: approval gate — a finished generation only PREVIEWS; 'Use this avatar' is still the only way it becomes the print");
  // VM: the garment wears the preview while the order's print stays the photo.
  const garmentBlock = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", style: {}, attrs: {},
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    set src(v) { this._src = v; }, get src() { return this._src; },
  });
  const els = {
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentBackText206": mkEl(),
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
  };
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }, { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: { play: { id: 3 }, frozen: true, printDataUrl: "data:print", printAspect: 0.5625, colorway: "Black", side: "back", garmentView206: "back", backText: "name", placement: { cx: 50, cy: 42, size: 78 }, avatarPreview206: true, avatarDataUrl206: "data:avatar", avatarApplied206: false },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    HF_PRESET_LABELS205: { hypeframe: "Hype Frame" }, // →229: the fixture mirrors the shipped map — only hypeframe survives
    hfPrintTone: () => "#f6f1e4",
    hfFmtTime: (t) => "0:00",
  };
  sb.window = sb;
  vm.runInContext(garmentBlock, vm.createContext(sb));
  sb.hfGarmentSync206();
  assert(els["#hfGarmentPrint206"].src === "data:avatar", "E: an unapproved avatar previews on the garment");
  assert(sb.hfState.printDataUrl === "data:print", "E: ...while the order's print art is still the composed photo print — preview ≠ print until approved");
}

// ---- F. Served ----
{
  const s = await boot(41215);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=230"') && served.includes('href="styles.css?v=221"'), "F: the served homepage carries the Round 215 pins — →219: app.js now v217 / styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round)");
    assert(served.includes('id="hfProduct215"') && served.includes('id="hfStickyBar215"') && served.includes('id="hfReview215"') && !served.includes("data-hf-step-pill"), "F: the served studio is the one-page studio");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("function hfSeedPoster215") && servedApp.includes("function hfShowScreen215") && !servedApp.includes("function hfGoStep211("), "F: the served app.js carries the seed + screens, and no step flow");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes(".hf-stickybar215{") && !servedCss.includes("hf-garment-area-wide206"), "F: the served styles carry the sticky bar and no dashed guide");
  } finally { s.stop(); }
}

console.log("\nALL R215 CHECKS PASSED");
