// Round 211 test: the three-step studio customizer + photoreal
// garment (Emil, 2026-11-26).
// Run: node test-r211.js
// Updated for Round 215 (2026-11-26): the stepper is retired —
// the studio is ONE product page + Review. §B/§C/§G/§I now pin
// the one-page structure (hfShowScreen215 screens, the four
// collapsed option rows, the sticky bar's Review gate); the
// §D first-paint contract, §E payload invariant, §F kept
// decisions and §H photo wiring stand as they were.
// What this suite pins down:
//   A. Pins: app.js v212 / styles v208 (both files changed).
//   B. Structure statics — →215: no stepper pills, no step
//      panels, no hero slots, no step CTAs anywhere (markup,
//      JS, CSS); the product page (hero, buy card, four rows,
//      sticky bar) + the Review screen ship instead; the clip
//      row + collapsible player area live inside Change photo;
//      the Round 206 review stage stays retired.
//   C. Screen machinery drive (VM): exactly one screen visible
//      at a time, entering Review syncs the as-ordered render,
//      the sticky bar's gate holds a parent without a frame on
//      the product page (opening Change photo + saying why),
//      option rows toggle, and going back and forth never
//      loses studio state.
//   D. First-paint contract (VM): with a play open and NO
//      capture resolved yet (deferred — printDataUrl still
//      empty), the garment hero is already visible wearing the
//      play's poster at the print placement — no video-first
//      flash; when the capture lands, the print swaps to the
//      composed frame behind the same geometry.
//   E. Payload byte-identity across screen navigation and view
//      flips for equivalent choices (the R206 §M invariant
//      re-expressed over the one-page flow).
//   F. Kept decisions: embroidery default = "name" (Emil kept
//      the R197 default — NOT the mockup's None); the submit
//      label is "Send hoodie request" (R205 — NOT "Send for
//      approval"); the R205 no-payment copy is verbatim; the
//      form submit calls hfSubmitOrder206.
//   G. The avatar maker lives in the Artwork panel with its
//      consent line, and moving between screens never clears
//      an avatar preview / approval.
//   H. Photo-asset wiring (VM): the four hf-blank-*211.jpg
//      blanks land on the hero per colorway × view, and the
//      Review stage paints the ordered side's blank.
//   I. Served: the homepage carries the one-page studio; the
//      four blanks serve as JPEGs; app.js carries the screens.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r211-"));
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
assert(home.includes('href="styles.css?v=219"') && home.includes('src="app.js?v=227"'), "A: asset pins — app.js v212 / styles v208 (Round 211; both files changed) — →213: pins now v213/v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round)");

// ---- B. Structure statics (→215: the stepper is retired) ----
assert(!studio.includes("data-hf-step-pill") && !studio.includes("data-hf-step-back"), "B: →215: no stepper pills and no step back buttons anywhere in the studio");
for (const id of ["hfStepMoment211", "hfStepDesign211", "hfStepReview211", "hfHeroSlot1-211", "hfHeroSlot2-211", "hfUseFrame211", "hfToReview211", "hfStep1Msg211"])
  assert(!studio.includes(`id="${id}"`), "B: →215: the retired step element #" + id + " is gone");
assert(!appJs.includes("function hfGoStep211(") && !appJs.includes("(function wireHfSteps211()") && !appJs.includes("hfState.step211") && !appJs.includes("hfState.stepMax211"), "B: →215: the step machinery is gone from app.js (no hfGoStep211, no step wiring, no step state reads — the names survive only in retirement comments)");
assert(!css.includes(".hf-steps211{") && !css.includes(".hf-step-pill211") && !css.includes(".hf-step-panel211") && !css.includes(".hf-step-cta211"), "B: →215: the stepper CSS is retired with it");
assert(studio.includes('id="hfProduct215">') && studio.includes('id="hfReview215" hidden>'), "B: →215: exactly one screen (the product page) is visible in the markup — Review starts hidden");
assert(studio.includes('id="hfProductTitle215"') && studio.includes('id="hfProductSub215"'), "B: →215: the product page carries its title + play line");
assert(studio.includes('id="hfBuyCard215"') && studio.includes("$110"), "B: →215: the buy card ships with the $110 price on the page");
for (const id of ["hfRowPhoto215", "hfPhotoPanel215", "hfRowArtwork215", "hfArtworkPanel215", "hfRowPlacement215", "hfPlacementPanel215", "hfRowBackText215", "hfBackTextPanel215"])
  assert(studio.includes(`id="${id}"`), "B: →215: the option row + panel #" + id + " ships");
assert((studio.match(/class="hf-optpanel215 hf-sec-body222" id="hf\w+Panel215">/g) || []).length === 4 && !studio.includes('Panel215" hidden'), "B: →215: all four option panels start collapsed — →222: the panels stand OPEN as section bodies (no hidden attribute; the R215 collapse is retired)");
assert(studio.includes('id="hfStickyBar215"') && studio.includes('id="hfReviewBtn215"') && studio.includes(">Review hoodie →</button>"), "B: →215: the sticky bar carries the gold 'Review hoodie →' button");
assert(studio.includes('id="hfReviewBack215"') && studio.includes(">← Back</button>"), "B: →215: Review carries a plain back affordance");
assert(studio.indexOf('id="hfClipRow211"') > studio.indexOf('id="hfPhotoPanel215"') && studio.indexOf('id="hfClipArea211"') > studio.indexOf('id="hfPhotoPanel215"') && studio.indexOf('id="hfClipArea211"') < studio.indexOf('id="hfReview215"'), "B: →215: the Pick from video row + player area live INSIDE the Change photo panel");
assert(studio.includes('id="hfPhotoMsg215"'), "B: →215: the photo panel carries the gate message element");
for (const id of ["hfReviewTitle211", "hfReviewLine211", "hfReviewShade211", "hfReviewCrest211", "hfGarmentShade211", "hfGarmentCrest211"])
  assert(studio.includes(`id="${id}"`), "B: the photo treatment carries #" + id);
assert(!studio.includes('id="hfReview206"') && !studio.includes('id="hfReviewSend206"') && !studio.includes('id="hfReviewEdit206"') && !studio.includes('id="hfReviewMsg206"'), "B: the Round 206 review stage markup is retired");
assert(!appJs.includes("function hfOpenReview206") && !appJs.includes("function hfCloseReview206"), "B: the review-stage open/close functions are gone from app.js");
assert(!css.includes(".hf-review206{") && css.includes(".hf-stickybar215{") && css.includes("position:fixed") && css.includes("#hfProduct215[hidden]{display:none}"), "B: →215: the review-stage CSS stays retired; the sticky bar (fixed) + screen [hidden] guards ship");
assert(appJs.includes("function hfShowScreen215") && appJs.includes("function hfSeedPoster215") && appJs.includes("function hfGarmentPaint211") && appJs.includes("HF_GARMENT_AREA211"), "B: →215: app.js carries the screen flow + the poster seed + the photo painter + the measured zones");

// ---- C/D/E/G/H share one VM drive of the studio machinery ----
{
  const garmentBlock = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const reviewSlice = appJs.slice(appJs.indexOf("function hfReviewSync206"), appJs.indexOf("async function hfSubmitOrder206"));
  const wire215 = appJs.slice(appJs.indexOf("(function wireHf222()"), appJs.indexOf("/* Round 200")); // →222: the wiring IIFE is wireHf222 now (was wireHf215)
  const mkEl = (name) => ({
    name, hidden: false, textContent: "", value: "", style: {}, attrs: {}, listeners: {}, disabled: false, parentElement: null,
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    removeAttribute(k) { delete this.attrs[k]; },
    set src(v) { this._src = v; }, get src() { return this._src; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    scrollIntoView() {},
    appendChild(child) { child.parentElement = this; },
  });
  const hero = mkEl("hero");
  const prod215 = mkEl("product"), rev215 = mkEl("review"); rev215.hidden = true;
  const rowPanels215 = { photo: mkEl("photoPanel"), artwork: mkEl("artworkPanel"), placement: mkEl("placementPanel"), backtext: mkEl("backtextPanel") };
  for (const k of Object.keys(rowPanels215)) rowPanels215[k].hidden = true;
  const photoMsg215 = mkEl("photoMsg"); photoMsg215.hidden = true;
  const clipArea215 = mkEl("clipArea"); clipArea215.hidden = true;
  const flips = ["front", "back"].map((v) => ({ dataset: { hfGarmentView: v }, attrs: {}, setAttribute(k, val) { this.attrs[k] = val; } }));
  const els = {
    "#hfGarment206": hero, "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(), "#hfGarmentPrint206": mkEl(),
    "#hfGarmentBackText206": mkEl(), "#hfGarmentShade211": mkEl(), "#hfGarmentCrest211": mkEl(),
    "#hfCanvas": { width: 1280, height: 720 },
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
    "#hfGuardianName": { value: "Pat Parent" }, "#hfGuardianEmail": { value: "parent@example.com" },
    "#hfProduct215": prod215, "#hfReview215": rev215, "#hfStudio": mkEl(),
    "#hfRowPhoto215": mkEl(), "#hfPhotoPanel215": rowPanels215.photo,
    "#hfRowArtwork215": mkEl(), "#hfArtworkPanel215": rowPanels215.artwork,
    "#hfRowPlacement215": mkEl(), "#hfPlacementPanel215": rowPanels215.placement,
    "#hfRowBackText215": mkEl(), "#hfBackTextPanel215": rowPanels215.backtext,
    "#hfRowPhotoState215": mkEl(), "#hfRowArtworkState215": mkEl(), "#hfRowPlacementState215": mkEl(), "#hfRowBackTextState215": mkEl(),
    "#hfReviewBtn215": mkEl(), "#hfReviewBack215": mkEl(), "#hfPhotoMsg215": photoMsg215,
    "#hfReviewImg206": mkEl(), "#hfReviewPrintArea206": mkEl(), "#hfReviewPrint206": mkEl(),
    "#hfReviewShade211": mkEl(), "#hfReviewCrest211": mkEl(),
    "#hfReviewSize206": mkEl(), "#hfReviewPlacement206": mkEl(), "#hfReviewArt206": mkEl(), "#hfReviewBack206": mkEl(),
    "#hfReviewTitle211": mkEl(), "#hfReviewLine211": mkEl(),
    "#hfClipRow211": mkEl(), "#hfClipArea211": clipArea215, "#hfClipRowLabel211": mkEl(), "#hfClipRowThumb211": mkEl(),
    "#hfStripWrap": mkEl(),
  };
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: {
      play: { id: 7, poster_url: "/uploads/poster-7.jpg", media_url: "/uploads/v7.mp4", sport: "baseball", title: "Walk-off" },
      mediaType: "video", frozen: false, printDataUrl: "", printAspect: 0, frameTime205: null,
      colorway: "Black", side: "back", garmentView206: "back", backText: "name", size: "YM",
      preset: "hypeframe", apparel: "hoodie", imageStyle: "photo",
      placement: { cx: 50, cy: 42, size: 78 },
      avatarPreview206: false, avatarDataUrl206: "", avatarApplied206: false,
      clipOpen211: false, screen215: "product",
    },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    HF_PRESET_LABELS205: { hypeframe: "Hype Frame" }, // →229: the fixture mirrors the shipped map — only hypeframe survives
    hfPrintTone: () => "#f6f1e4",
    hfFmtTime: (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`,
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(garmentBlock, ctx);
  vm.runInContext(reviewSlice, ctx);
  vm.runInContext(wire215, ctx);
  const S = sb.hfState, GI = els["#hfGarmentImg206"], GA = els["#hfGarmentPrintArea206"], GP = els["#hfGarmentPrint206"];

  // ---- D. First paint: the poster is composited before any capture resolves ----
  sb.hfGarmentSync206();
  assert(hero.hidden === false, "D: the garment hero is visible at first paint — before any frame is captured");
  assert(GI.src === "/swag/hf-blank-back-black218.jpg", "D: first paint wears the Black back photo blank (the R208 starting look) — →218: the washed-black 218 blank");
  assert(GA.hidden === false && GP.src === "/uploads/poster-7.jpg", "D: the play's poster is ALREADY composited as the print — no video-first flash, no empty garment");
  // The capture lands (deferred stub resolves): the print swaps
  // behind the same geometry.
  S.frozen = true; S.printDataUrl = "data:print"; S.printAspect = 0.5625;
  sb.hfGarmentSync206();
  assert(GP.src === "data:print", "D: when the capture lands, the composed frame replaces the poster on the garment");
  // No play at all: nothing shows.
  S.play = null; S.frozen = false; S.printDataUrl = "";
  sb.hfGarmentSync206();
  assert(hero.hidden === true, "D: with no play open the garment stays hidden");
  S.play = { id: 7, poster_url: "/uploads/poster-7.jpg", media_url: "/uploads/v7.mp4", sport: "baseball", title: "Walk-off" };
  S.frozen = true; S.printDataUrl = "data:print";

  // ---- C. Screen machinery (→215) ----
  sb.hfShowScreen215("product", true);
  assert(prod215.hidden === false && rev215.hidden === true && S.screen215 === "product", "C: the product page is the studio's opening screen — exactly one screen visible");
  // The sticky bar advances (a frame is frozen).
  els["#hfReviewBtn215"].listeners.click();
  assert(S.screen215 === "review" && rev215.hidden === false && prod215.hidden === true, "C: 'Review hoodie →' moves to the Review screen");
  assert(els["#hfReviewImg206"].src === "/swag/hf-blank-back-black218.jpg" && els["#hfReviewPrint206"].src === "data:print", "C: entering Review syncs the as-ordered render (Black, back — the print's side) — →218: the washed-black 218 blank");
  assert(els["#hfReviewTitle211"].textContent === "Black hoodie" && els["#hfReviewLine211"].textContent === "Back print · Hype Frame", "C: the Review headline derives from live state ('Black hoodie' / 'Back print · Hype Frame')");
  // State survives a full round trip.
  S.backText = "custom"; els["#hfBackCustom197"].value = "GO HAWKS!";
  S.avatarDataUrl206 = "data:avatar"; S.avatarPreview206 = true; S.avatarApplied206 = true;
  const snapshot = JSON.stringify({ bt: S.backText, custom: els["#hfBackCustom197"].value, av: S.avatarDataUrl206, avp: S.avatarPreview206, ava: S.avatarApplied206, pd: S.printDataUrl, side: S.side, size: S.size, pl: S.placement });
  els["#hfReviewBack215"].listeners.click();
  assert(S.screen215 === "product" && prod215.hidden === false && rev215.hidden === true, "C: Review's back affordance returns to the product page");
  els["#hfReviewBtn215"].listeners.click();
  assert(JSON.stringify({ bt: S.backText, custom: els["#hfBackCustom197"].value, av: S.avatarDataUrl206, avp: S.avatarPreview206, ava: S.avatarApplied206, pd: S.printDataUrl, side: S.side, size: S.size, pl: S.placement }) === snapshot, "C+G: product → Review → product → Review loses nothing — frame, custom words, avatar preview + approval all persist");
  // Option rows toggle their panels. — →222: RETIRED — the
  // rows became always-open section heads (plain divs); the
  // wiring attaches no toggle to them at all.
  els["#hfReviewBack215"].listeners.click();
  assert(els["#hfRowArtwork215"].listeners.click === undefined && els["#hfRowPhoto215"].listeners.click === undefined, "C: →222: the section heads carry no toggle listener — every section stands open (R215's collapsible rows are retired)");
  // The Pick from video expander toggles inside Change photo.
  els["#hfClipRow211"].listeners.click();
  assert(clipArea215.hidden === false && S.clipOpen211 === true, "C: the Pick from video row expands the player area");
  els["#hfClipRow211"].listeners.click();
  assert(clipArea215.hidden === true && S.clipOpen211 === false, "C: ...and collapses it again");
  // The gate: without a frozen frame, the sticky button holds
  // the parent on the product page and says why. — →222: the
  // Change photo section stands open (nothing to expand), so
  // the gate just shows the message and scrolls to it.
  S.frozen = false; S.printDataUrl = "";
  els["#hfReviewBtn215"].listeners.click();
  assert(S.screen215 === "product" && rev215.hidden === true && photoMsg215.hidden === false && photoMsg215.textContent.includes("Pick the frame"), "C: without a frame, 'Review hoodie →' holds the parent and says what to do");
  S.frozen = true; S.printDataUrl = "data:print";

  // ---- E. Payload byte-identity across screens + view flips ----
  const buildPayload = () => JSON.stringify({
    highlightId: S.play.id,
    customName: els["#hfName"].value.trim(),
    jersey: els["#hfJersey"].value.trim(),
    backText: S.backText,
    backTextCustom: els["#hfBackCustom197"].value.trim(),
    branding: S.preset === "hypeframe",
    apparel: S.apparel,
    side: S.side,
    imageStyle: S.imageStyle,
    avatarGenerated: S.avatarApplied206 === true,
    colorway: S.colorway,
    size: S.size,
    placement: S.placement,
    guardianName: els["#hfGuardianName"].value.trim(),
    guardianEmail: els["#hfGuardianEmail"].value.trim(),
    image: S.printDataUrl,
  });
  const before = buildPayload();
  S.garmentView206 = "front"; sb.hfGarmentSync206();
  sb.hfShowScreen215("review"); S.garmentView206 = "back"; sb.hfGarmentSync206();
  sb.hfShowScreen215("product"); sb.hfShowScreen215("review");
  assert(buildPayload() === before, "E: the order payload is BYTE-IDENTICAL before and after a full screen round trip with view flips interleaved");
  assert(S.side === "back" && S.garmentView206 === "back", "E: navigation never touched the order's print side");

  // ---- H. Photo wiring per colorway × view ----
  const expect = { "Black|back": "/swag/hf-blank-back-black218.jpg", "Black|front": "/swag/hf-blank-front-black218.jpg", "Heather Gray|back": "/swag/hf-blank-back-gray211.jpg", "Heather Gray|front": "/swag/hf-blank-front-gray211.jpg" };
  for (const cw of ["Black", "Heather Gray"]) for (const v of ["back", "front"]) {
    S.colorway = cw; S.garmentView206 = v;
    sb.hfGarmentSync206();
    assert(GI.src === expect[cw + "|" + v], "H: hero — " + cw + " " + v + " wears " + expect[cw + "|" + v]);
  }
  S.side = "front"; S.colorway = "Heather Gray";
  sb.hfReviewSync206();
  assert(els["#hfReviewImg206"].src === "/swag/hf-blank-front-gray211.jpg", "H: the Review stage paints the ORDERED side's blank (front, Heather Gray)");
  assert(els["#hfReviewTitle211"].textContent === "Heather Gray hoodie" && els["#hfReviewLine211"].textContent.startsWith("Front print"), "H: the Review headline follows the order (Heather Gray / Front print)");
}

// ---- F. Kept decisions ----
{
  const btSeg = studio.slice(studio.indexOf('id="hfBackText197"'), studio.indexOf('id="hfBackCustomRow197"'));
  assert(btSeg.includes('data-hf-back-text="name" aria-pressed="true"'), "F: the back-text default is 'Name' — Emil kept the R197 default (the mockup's None-by-default was NOT adopted)");
  assert(appJs.includes('backText: "name"'), "F: hfState opens with backText 'name'");
  assert(studio.includes(">Send order request</button>"), "F: the submit label is 'Send order request' — →222: renamed from the R205 'Send hoodie request' (the mockup's 'Send for approval' was NOT adopted)");
  assert(studio.includes("No payment today. A parent or guardian confirms first."), "F: the no-payment line is verbatim on the Review screen — →222: 'No payment today. A parent or guardian confirms first.' (supersedes the R205 email copy)");
  assert(studio.includes("Private — never shown on the site."), "F: the privacy line rides with the email field");
  const formListener = appJs.slice(appJs.indexOf('"#hfOrderForm").addEventListener("submit"'), appJs.indexOf('"#hfOrderForm").addEventListener("submit"') + 900);
  assert(formListener.includes("hfSubmitOrder206()") && !formListener.includes("hfOpenReview206"), "F: the form submit IS the send (hfSubmitOrder206 — the exact pre-existing order path)");
}

// ---- G. Avatar maker placement (statics; the gate behavior is pinned in test-r206 §C/§F) ----
{
  const art215 = studio.slice(studio.indexOf('id="hfArtworkPanel215"'), studio.indexOf('id="hfRowPlacement215"'));
  assert(art215.includes('id="hfAvatarPanel206"') && art215.includes('id="hfImageStyles"'), "G: →215: the avatar maker + Artwork picker live in the Artwork panel");
  assert(art215.indexOf('id="hfAvatarPanel206"') > art215.indexOf('id="hfImageStyles"'), "G: the avatar panel reveals under the Artwork picker, as before");
  assert((studio.match(/id="hfAvatarPanel206"/g) || []).length === 1, "G: →215: the avatar maker exists exactly once on the page");
}

// ---- I. Served ----
{
  const s = await boot(41211);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=227"') && served.includes('href="styles.css?v=219"'), "I: the served homepage carries the current pins — →221: now app.js v219 / styles v213 (Round 221) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round)");
    assert(served.includes('id="hfProduct215"') && served.includes('id="hfReview215"') && served.includes('id="hfStickyBar215"') && !served.includes("data-hf-step-pill"), "I: →215: the served studio is the one-page studio — product page + Review + sticky bar, no stepper");
    for (const f of ["hf-blank-front-black218.jpg", "hf-blank-back-black218.jpg", "hf-blank-front-gray211.jpg", "hf-blank-back-gray211.jpg"]) {
      const r = await fetch(s.base + "/swag/" + f);
      const buf = Buffer.from(await r.arrayBuffer());
      assert(r.status === 200 && buf[0] === 0xff && buf[1] === 0xd8, "I: " + f + " serves as a JPEG");
    }
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("hfShowScreen215") && servedApp.includes("hfSeedPoster215") && servedApp.includes("hfGarmentPaint211") && !servedApp.includes("function hfGoStep211"), "I: →215: the served app.js carries the screens + the seed, and no step flow");
  } finally { s.stop(); }
}

// ---- J. Part B — Round 212: the homepage section as a card ----
// (Emil's mockup; he rejected the R210 hero crop on his phone.
// The overlay contracts themselves stay pinned in test-r210.)
{
  const sec212 = home.slice(home.indexOf('id="merchTeaser125"'), home.indexOf("<!-- ============ THE STORE"));
  const cardRule = (css.match(/\.hft201-card\{[^}]*\}/) || [""])[0];
  assert(cardRule.includes("border:1px solid rgba(212,175,55,.5)") && cardRule.includes("border-radius:20px") && cardRule.includes("padding:18px"), "J: the section is a CARD — thin gold hairline border, 20px radius, comfortable padding, dark gradient ground");
  const iHead = sec212.indexOf("hft212-head"), iHero = sec212.indexOf("hft207-hero"), iBody = sec212.indexOf("hft201-body");
  assert(iHead > -1 && iHead < iHero && iHero < iBody, "J: the header sits INSIDE the card at the top, ahead of the photo and the body");
  assert((sec212.match(/hft212-rule/g) || []).length === 2 && sec212.includes('src="/crown.png"') && sec212.includes("HYPE FRAME™"), "J: the header is rule — crown + HYPE FRAME™ — rule");
  assert(css.includes(".hft212-head{display:flex") && css.includes(".hft212-rule{flex:1") && css.includes(".hft212-brand{") && css.includes("letter-spacing:.22em"), "J: the header CSS rides — flex row, hairline rules flexing, letter-spaced gold wordmark");
  const imgRule212 = (css.match(/\.hft207-hero-img\{[^}]*\}/) || [""])[0];
  assert(imgRule212.includes("width:100%") && imgRule212.includes("height:auto") && !imgRule212.includes("143%") && !imgRule212.includes("object-fit") && !(css.match(/\.hft207-hero\{[^}]*\}/) || [""])[0].includes("aspect-ratio"), "J: the hero photo is WHOLE at natural aspect — the R210 143% / 4:5 crop math is out of the hero rules (it survives only in the history comments)");
  assert(!sec212.includes("hft201-badge") && !sec212.includes("The Swag Shop") && !css.includes(".hft201-badges{") && !css.includes(".hft201-badge{") && !css.includes(".hft207-badges{"), "J: the pills are off the photo and their CSS is removed (dead — the section was their only user)");
  assert(sec212.includes('<h2 class="hft201-title">Your moment on a hoodie.</h2>'), "J: the headline reads 'Your moment on a hoodie.' — WITH the trailing period");
  assert((css.match(/\.hft201-title\{[^}]*\}/) || [""])[0].includes("font-style:italic"), "J: the headline is italic bold (the mockup's styling)");
  assert(sec212.includes('<p class="hft207-sub">Pick a play. Make it yours.</p>'), "J: the sub-line is unchanged");
  const ctaRule = (css.match(/\.hft201-cta\{[^}]*\}/) || [""])[0];
  assert(ctaRule.includes("linear-gradient(180deg,#f9e58c") && ctaRule.includes("#d4af37") && ctaRule.includes("#9c7c1e"), "J: the CTA wears the metallic gold gradient (lighter at top) with dark text");
  assert(sec212.includes('onclick="openHfChoice()"') && sec212.includes("Build your hoodie →"), "J: the CTA label + openHfChoice() handler are unchanged");
  assert(sec212.includes('id="hfHomeFilmBtn201"') && sec212.includes('onclick="playHfHomeFilm201()"') && sec212.includes('id="hfHomeFilmOverlay210"') && appJs.includes("function closeHfHomeFilm210()"), "J: 'See how it works' still opens the R210 overlay (contracts pinned in test-r210 §E/§F)");
  const s = await boot(42211);
  try {
    const served = await (await fetch(s.base + "/")).text();
    const vSec = served.slice(served.indexOf('id="merchTeaser125"'), served.indexOf("<!-- ============ THE STORE"));
    assert(vSec.includes("hft212-head") && vSec.includes("HYPE FRAME™") && vSec.includes("Your moment on a hoodie.") && !vSec.includes("hft201-badge"), "J: the served section is the card — header in, headline with period, pills gone");
  } finally { s.stop(); }
}

console.log("\nALL R211 CHECKS PASSED");
