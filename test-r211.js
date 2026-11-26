// Round 211 test: the three-step studio customizer + photoreal
// garment (Emil, 2026-11-26).
// Run: node test-r211.js
// What this suite pins down:
//   A. Pins: app.js v212 / styles v208 (both files changed).
//   B. Step structure statics: the stepper (Moment / Design /
//      Review pills), exactly one panel visible in markup,
//      per-step CTAs + back buttons, the clip row + collapsible
//      player area, the hero slots, the Review step's compact
//      stage + summary headline elements; the Round 206 review
//      stage is fully retired (markup, JS, CSS).
//   C. Step machinery drive (VM): one panel visible at a time,
//      pill states (current / done / locked-ahead), the garment
//      hero moving between the Moment and Design slots,
//      entering Review syncs the as-ordered render, and going
//      back and forth never loses studio state.
//   D. First-paint contract (VM): with a play open and NO
//      capture resolved yet (deferred — printDataUrl still
//      empty), the garment hero is already visible wearing the
//      play's poster at the print placement — no video-first
//      flash; when the capture lands, the print swaps to the
//      composed frame behind the same geometry.
//   E. Payload byte-identity across step navigation and view
//      flips for equivalent choices (the R206 §M invariant
//      re-expressed over the step flow).
//   F. Kept decisions: embroidery default = "name" (Emil kept
//      the R197 default — NOT the mockup's None); the submit
//      label is "Send hoodie request" (R205 — NOT "Send for
//      approval"); the R205 no-payment copy is verbatim; the
//      form submit calls hfSubmitOrder206.
//   G. The avatar maker lives in Step 2 (Design) with its
//      consent line, and stepping around never clears an
//      avatar preview / approval.
//   H. Photo-asset wiring (VM): the four hf-blank-*211.jpg
//      blanks land on the hero per colorway × view, and the
//      Review stage paints the ordered side's blank.
//   I. Served: the homepage carries the step markup; the four
//      blanks serve as JPEGs; app.js carries the step flow.
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
assert(home.includes('href="styles.css?v=208"') && home.includes('src="app.js?v=212"'), "A: asset pins — app.js v212 / styles v208 (Round 211; both files changed)");

// ---- B. Step structure statics ----
for (const [n, label] of [[1, "Moment"], [2, "Design"], [3, "Review"]])
  assert(studio.includes(`data-hf-step-pill="${n}"`) && studio.includes(`>${n} · ${label}<`), "B: the stepper carries the " + label + " pill");
for (const id of ["hfStepMoment211", "hfStepDesign211", "hfStepReview211"])
  assert(studio.includes(`id="${id}"`), "B: step panel #" + id + " ships");
assert(studio.includes('id="hfStepMoment211">') && studio.includes('id="hfStepDesign211" hidden>') && studio.includes('id="hfStepReview211" hidden>'), "B: exactly one panel (Moment) is visible in the markup — the studio opens on Step 1");
assert(studio.includes('id="hfUseFrame211"') && studio.includes(">Use this frame</button>"), "B: Step 1's CTA is 'Use this frame'");
assert(studio.includes('id="hfToReview211"') && studio.includes(">Choose size &amp; review</button>"), "B: Step 2's CTA is 'Choose size & review'");
assert((studio.match(/data-hf-step-back=/g) || []).length === 2, "B: Steps 2 and 3 each carry a back affordance");
for (const id of ["hfHeroSlot1-211", "hfHeroSlot2-211", "hfClipRow211", "hfClipRowThumb211", "hfClipRowLabel211", "hfClipArea211", "hfStep1Msg211"])
  assert(studio.includes(`id="${id}"`), "B: the Moment step carries #" + id);
assert(studio.includes('aria-expanded="false"') && studio.includes('id="hfClipArea211" hidden>'), "B: the player area starts collapsed behind the clip row (video plays) — the player is not inline by default");
for (const id of ["hfReviewTitle211", "hfReviewLine211", "hfReviewShade211", "hfReviewCrest211", "hfGarmentShade211", "hfGarmentCrest211"])
  assert(studio.includes(`id="${id}"`), "B: the photo treatment carries #" + id);
assert(!studio.includes('id="hfReview206"') && !studio.includes('id="hfReviewSend206"') && !studio.includes('id="hfReviewEdit206"') && !studio.includes('id="hfReviewMsg206"'), "B: the Round 206 review stage markup is retired");
assert(!appJs.includes("function hfOpenReview206") && !appJs.includes("function hfCloseReview206"), "B: the review-stage open/close functions are gone from app.js");
assert(!css.includes(".hf-review206{") && css.includes(".hf-steps211{") && css.includes(".hf-step-panel211[hidden]{display:none}"), "B: the review-stage CSS is retired; the stepper + panel CSS ships with [hidden] guards");
assert(appJs.includes("function hfGoStep211") && appJs.includes("function hfGarmentPaint211") && appJs.includes("HF_GARMENT_AREA211"), "B: app.js carries the step flow + the photo painter + the measured zones");

// ---- C/D/E/G/H share one VM drive of the studio machinery ----
{
  const garmentBlock = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const reviewSlice = appJs.slice(appJs.indexOf("function hfReviewSync206"), appJs.indexOf("async function hfSubmitOrder206"));
  const stepsWire = appJs.slice(appJs.indexOf("(function wireHfSteps211()"), appJs.indexOf("/* Round 200"));
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
  const slot1 = mkEl("slot1"), slot2 = mkEl("slot2");
  const hero = mkEl("hero"); hero.parentElement = slot1;
  const panels = { 1: mkEl("panel1"), 2: mkEl("panel2"), 3: mkEl("panel3") };
  panels[2].hidden = true; panels[3].hidden = true;
  const pills = [1, 2, 3].map((n) => { const p = mkEl("pill" + n); p.dataset = { hfStepPill: String(n) }; return p; });
  const backs = ["1", "2"].map((n) => { const b = mkEl("back" + n); b.dataset = { hfStepBack: n }; return b; });
  const flips = ["front", "back"].map((v) => ({ dataset: { hfGarmentView: v }, attrs: {}, setAttribute(k, val) { this.attrs[k] = val; } }));
  const els = {
    "#hfGarment206": hero, "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(), "#hfGarmentPrint206": mkEl(),
    "#hfGarmentBackText206": mkEl(), "#hfGarmentWide206": mkEl(), "#hfGarmentShade211": mkEl(), "#hfGarmentCrest211": mkEl(),
    "#hfCanvas": { width: 1280, height: 720 },
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
    "#hfGuardianName": { value: "Pat Parent" }, "#hfGuardianEmail": { value: "parent@example.com" },
    "#hfStepMoment211": panels[1], "#hfStepDesign211": panels[2], "#hfStepReview211": panels[3],
    "#hfHeroSlot1-211": slot1, "#hfHeroSlot2-211": slot2, "#hfStudio": mkEl(),
    "#hfReviewImg206": mkEl(), "#hfReviewPrintArea206": mkEl(), "#hfReviewPrint206": mkEl(),
    "#hfReviewShade211": mkEl(), "#hfReviewCrest211": mkEl(),
    "#hfReviewSize206": mkEl(), "#hfReviewPlacement206": mkEl(), "#hfReviewArt206": mkEl(), "#hfReviewBack206": mkEl(),
    "#hfReviewTitle211": mkEl(), "#hfReviewLine211": mkEl(),
    "#hfUseFrame211": mkEl(), "#hfToReview211": mkEl(), "#hfStep1Msg211": mkEl(),
    "#hfClipRow211": mkEl(), "#hfClipArea211": mkEl(), "#hfClipRowLabel211": mkEl(), "#hfClipRowThumb211": mkEl(),
    "#hfStripWrap": mkEl(),
  };
  els["#hfStep1Msg211"].hidden = true;
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-step-pill") ? pills : s.includes("data-hf-step-back") ? backs : s.includes("data-hf-garment-view") ? flips : []),
    hfState: {
      play: { id: 7, poster_url: "/uploads/poster-7.jpg", media_url: "/uploads/v7.mp4", sport: "baseball", title: "Walk-off" },
      mediaType: "video", frozen: false, printDataUrl: "", printAspect: 0,
      colorway: "Black", side: "back", garmentView206: "back", backText: "name", size: "YM",
      preset: "hypeframe", apparel: "hoodie", imageStyle: "photo",
      placement: { cx: 50, cy: 42, size: 78 },
      avatarPreview206: false, avatarDataUrl206: "", avatarApplied206: false,
      step211: 1, stepMax211: 1, clipOpen211: false,
    },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    HF_PRESET_LABELS205: { classic: "Classic", signature: "Signature", hypeframe: "Hype Frame" },
    hfPrintTone: () => "#f6f1e4",
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(garmentBlock, ctx);
  vm.runInContext(reviewSlice, ctx);
  vm.runInContext(stepsWire, ctx);
  const S = sb.hfState, GI = els["#hfGarmentImg206"], GA = els["#hfGarmentPrintArea206"], GP = els["#hfGarmentPrint206"];

  // ---- D. First paint: the poster is composited before any capture resolves ----
  sb.hfGarmentSync206();
  assert(hero.hidden === false, "D: the garment hero is visible at first paint — before any frame is captured");
  assert(GI.src === "/swag/hf-blank-back-black211.jpg", "D: first paint wears the Black back photo blank (the R208 starting look)");
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

  // ---- C. Step machinery ----
  sb.hfGoStep211(1, true);
  assert(panels[1].hidden === false && panels[2].hidden === true && panels[3].hidden === true, "C: Step 1 shows exactly one panel (Moment)");
  assert(pills[0].classList.set.has("is-current211") && pills[1].disabled === true && pills[2].disabled === true, "C: at open, Moment is current and the unreached steps are locked");
  assert(hero.parentElement === slot1, "C: the hero starts in the Moment slot");
  // The "Use this frame" CTA advances (a frame is frozen).
  els["#hfUseFrame211"].listeners.click();
  assert(S.step211 === 2 && panels[2].hidden === false && panels[1].hidden === true, "C: 'Use this frame' advances to Design");
  assert(hero.parentElement === slot2, "C: the hero moves WITH the parent into the Design slot — one preview, still in sync");
  assert(pills[0].classList.set.has("is-done211") && pills[1].classList.set.has("is-current211") && pills[2].disabled === true, "C: Moment reads done, Design current, Review still locked until reached");
  els["#hfToReview211"].listeners.click();
  assert(S.step211 === 3 && panels[3].hidden === false, "C: 'Choose size & review' advances to Review");
  assert(els["#hfReviewImg206"].src === "/swag/hf-blank-back-black211.jpg" && els["#hfReviewPrint206"].src === "data:print", "C: entering Review syncs the as-ordered render (Black, back — the print's side)");
  assert(els["#hfReviewTitle211"].textContent === "Black hoodie" && els["#hfReviewLine211"].textContent === "Back print · Hype Frame", "C: the Review headline derives from live state ('Black hoodie' / 'Back print · Hype Frame')");
  assert(pills.every((p) => p.disabled === false), "C: once reached, every step is tappable");
  // State survives a full round trip.
  S.backText = "custom"; els["#hfBackCustom197"].value = "GO HAWKS!";
  S.avatarDataUrl206 = "data:avatar"; S.avatarPreview206 = true; S.avatarApplied206 = true;
  const snapshot = JSON.stringify({ bt: S.backText, custom: els["#hfBackCustom197"].value, av: S.avatarDataUrl206, avp: S.avatarPreview206, ava: S.avatarApplied206, pd: S.printDataUrl, side: S.side, size: S.size, pl: S.placement });
  pills[0].listeners.click();
  assert(S.step211 === 1 && hero.parentElement === slot1, "C: the Moment pill goes back — and the hero comes home");
  backs[0].listeners.click(); // Step 2's back button targets 1 — already there; harmless
  els["#hfUseFrame211"].listeners.click();
  els["#hfToReview211"].listeners.click();
  assert(JSON.stringify({ bt: S.backText, custom: els["#hfBackCustom197"].value, av: S.avatarDataUrl206, avp: S.avatarPreview206, ava: S.avatarApplied206, pd: S.printDataUrl, side: S.side, size: S.size, pl: S.placement }) === snapshot, "C+G: stepping 1→2→3→1→2→3 loses nothing — frame, custom words, avatar preview + approval all persist");
  // The gate: without a frozen frame, "Use this frame" stays put and says why.
  S.frozen = false; S.printDataUrl = "";
  sb.hfGoStep211(1);
  els["#hfUseFrame211"].listeners.click();
  assert(S.step211 === 1 && els["#hfStep1Msg211"].hidden === false && els["#hfStep1Msg211"].textContent.includes("Pick the frame"), "C: without a frame, the Step 1 CTA holds the parent on Moment and says what to do");
  S.frozen = true; S.printDataUrl = "data:print";

  // ---- E. Payload byte-identity across steps + view flips ----
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
  sb.hfGoStep211(2); S.garmentView206 = "front"; sb.hfGarmentSync206();
  sb.hfGoStep211(3); S.garmentView206 = "back"; sb.hfGarmentSync206();
  sb.hfGoStep211(1); sb.hfGoStep211(2); sb.hfGoStep211(3);
  assert(buildPayload() === before, "E: the order payload is BYTE-IDENTICAL before and after a full step round trip with view flips interleaved");
  assert(S.side === "back" && S.garmentView206 === "back", "E: navigation never touched the order's print side");

  // ---- H. Photo wiring per colorway × view ----
  const expect = { "Black|back": "/swag/hf-blank-back-black211.jpg", "Black|front": "/swag/hf-blank-front-black211.jpg", "Heather Gray|back": "/swag/hf-blank-back-gray211.jpg", "Heather Gray|front": "/swag/hf-blank-front-gray211.jpg" };
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
  assert(studio.includes(">Send hoodie request</button>"), "F: the submit label is 'Send hoodie request' (R205 — the mockup's 'Send for approval' was NOT adopted)");
  assert(studio.includes("No payment is collected today. We'll email your parent or guardian to confirm the design before we print."), "F: the R205 no-payment copy is verbatim on the Review step");
  assert(studio.includes("Private — never shown on the site."), "F: the privacy line rides with the email field");
  const formListener = appJs.slice(appJs.indexOf('"#hfOrderForm").addEventListener("submit"'), appJs.indexOf('"#hfOrderForm").addEventListener("submit"') + 900);
  assert(formListener.includes("hfSubmitOrder206()") && !formListener.includes("hfOpenReview206"), "F: the form submit IS the send (hfSubmitOrder206 — the exact pre-existing order path)");
}

// ---- G. Avatar maker placement (statics; the gate behavior is pinned in test-r206 §C/§F) ----
{
  const design = studio.slice(studio.indexOf('id="hfStepDesign211"'), studio.indexOf('id="hfStepReview211"'));
  assert(design.includes('id="hfAvatarPanel206"') && design.includes('id="hfImageStyles"'), "G: the avatar maker + Artwork picker live in Step 2 (Design)");
  assert(design.indexOf('id="hfAvatarPanel206"') > design.indexOf('id="hfImageStyles"'), "G: the avatar panel reveals under the Artwork picker, as before");
  assert(!studio.slice(studio.indexOf('id="hfStepMoment211"'), studio.indexOf('id="hfStepDesign211"')).includes('id="hfAvatarPanel206"'), "G: the avatar maker is not duplicated into Step 1");
}

// ---- I. Served ----
{
  const s = await boot(41211);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=212"') && served.includes('href="styles.css?v=208"'), "I: the served homepage carries the Round 211 pins");
    assert(served.includes('id="hfStepMoment211"') && served.includes('id="hfStepDesign211"') && served.includes('id="hfStepReview211"') && served.includes('data-hf-step-pill="3"'), "I: the served studio carries the three steps + stepper");
    for (const f of ["hf-blank-front-black211.jpg", "hf-blank-back-black211.jpg", "hf-blank-front-gray211.jpg", "hf-blank-back-gray211.jpg"]) {
      const r = await fetch(s.base + "/swag/" + f);
      const buf = Buffer.from(await r.arrayBuffer());
      assert(r.status === 200 && buf[0] === 0xff && buf[1] === 0xd8, "I: " + f + " serves as a JPEG");
    }
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("hfGoStep211") && servedApp.includes("hfGarmentPaint211"), "I: the served app.js carries the round");
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
