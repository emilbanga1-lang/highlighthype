// Round 238 (2026-11-27) — the studio unpin. Emil, three
// times in one afternoon: the pinned garment card "half-
// covered the YOUTH row" (08:16, fixed structurally in
// R229), "It's hard to use this page" (15:05), and finally
// the plain verdict: "I don't like the hoodie scroll on the
// hype frame order page. It's hard to use the page." (16:03).
//
// THE PIN'S LIFE: R222 made the garment preview sticky at
// the top of the product page (top:70px under the site
// header) so it never scrolled away; R229 confined it —
// the garment + Your moment + Artwork moved into a wrapper
// (#hfPinZone229) so the sticky range ended before Color &
// size. R235 measured what that cost: the card is ~394px
// tall on a 390px-wide phone — 47–50% of an 844px viewport,
// ~55–58% with its sticky offset — before the first control
// scrolls under it.
//
// THIS ROUND takes the pin out at the root:
//   - the garment rule in styles.css loses the sticky trio
//     (position sticky / top 70px / z-index 40) and keeps
//     only its card skin — the preview is a plain in-flow
//     block at the top of the product page and scrolls away
//     with it; no spacer, no reserve, nothing held open;
//   - the #hfPinZone229 wrapper is gone from index.html —
//     it existed only as the pin's containing block; the
//     garment and the sections stand directly in the
//     product page, same order, every id unchanged;
//   - no JS served the pin (no JS ever read the zone), so
//     app.js changes only in comments + the pin sweep;
//     hfShowScreen215 still lands the user at the top of
//     the chosen screen (driven in §D).
// Everything inside the card stands: the stage, the
// Front/Back flip, the "Preview — your design on the
// hoodie" line, the fence status line + revert, the R235
// capture behavior, the R237 wide design, the in-flow
// Review bar. The Review screen is untouched.
//
// Pins: app.js v234 / styles v225.
// Run: node test-r238.js — exits non-zero on failure.
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

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=240"'), "A: asset pins — app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");

// ---- B. the unpin statics ----
{
  assert(!home.includes('id="hfPinZone229"') && !home.includes("hf-pinzone229"), "B: the pin-zone wrapper is gone from the page — no element, no class (its name survives only in historical round comments)");
  assert(!css.includes(".hf-pinzone229"), "B: no pin-zone rule exists in the stylesheet (there never was one — the wrapper was purely the pin's containing block)");
  assert(!appJs.includes("hfPinZone229"), "B: no JS ever read the zone — app.js carries no reference to it");
  const skinAt = css.indexOf("#hfProduct215 .hf-garment206{background:#101012");
  assert(skinAt > -1, "B: the garment card rule still exists (the card skin)");
  const skinRule = css.slice(skinAt, css.indexOf("}", skinAt));
  assert(!skinRule.includes("position:sticky") && !skinRule.includes("position:fixed") && !skinRule.includes("top:70px") && !skinRule.includes("z-index"), "B: the garment rule carries NO pinning — no sticky, no fixed, no 70px offset, no z-index (Emil: 'I don't like the hoodie scroll')");
  assert(skinRule.includes("border:1px solid var(--line2)") && skinRule.includes("border-radius:16px") && skinRule.includes("padding:10px 10px 8px"), "B: what remains is ordinary card styling — border, radius, padding — a plain in-flow block");
  assert(!css.includes(".hf-garment206{position:sticky") && !css.includes(".hf-garment206{position:fixed"), "B: no other garment rule pins it either (the margin rule and the base rule included)");
  assert(css.includes("#hfProduct215{max-width:560px;margin:0 auto;padding-bottom:12px}"), "B: no compensating reserve anywhere — the product page still ends on its normal 12px padding");
}

// ---- C. the card's contents, the section order, the wiring ----
{
  const prod = home.slice(home.indexOf('id="hfProduct215"'), home.indexOf('id="hfReview215"'));
  const at = (id) => prod.indexOf('id="' + id + '"');
  assert(at("hfGarment206") > -1 && at("hfRowPhoto215") > at("hfGarment206") && at("hfPhotoPanel215") > at("hfRowPhoto215") && at("hfRowArtwork215") > at("hfPhotoPanel215") && at("hfArtworkPanel215") > at("hfRowArtwork215") && at("hfBuyCard215") > at("hfArtworkPanel215") && at("hfStickyBar215") > at("hfBuyCard215"), "C: the product page order is unchanged — garment → moment → artwork → buy card → Review bar, standing directly in the page (no wrapper between)");
  const card = prod.slice(at("hfGarment206"), at("hfRowPhoto215"));
  for (const id of ["hfGarmentStage206", "hfGarmentImg206", "hfGarmentPrintArea206", "hfGarmentPrint206", "hfGarmentShade211", "hfGarmentCrest211", "hfGarmentBackText206"]) {
    assert(card.includes('id="' + id + '"'), "C: the garment card still carries #" + id);
  }
  assert(!card.includes("data-hf-garment-view") && prod.slice(0, at("hfGarment206")).includes('id="hfGarmentFlip206"'), "C: the Front/Back flip buttons are still in the card — →244: they LEFT the card (Emil) and ride the price row as #hfGarmentFlip206, above the card");
  assert(card.includes("Preview — your design on the hoodie"), "C: the 'Preview — your design on the hoodie' line is still in the card");
  for (const id of ["hfFenceAuto229", "hfFenceAutoNote229", "hfFenceAutoActions229", "hfFenceAutoOriginal229", "hfFenceAutoCleaned229"]) {
    assert(card.includes('id="' + id + '"'), "C: the fence status line's #" + id + " still lives in the card");
  }
  assert(appJs.includes('$$("#hfGarmentFlip206 [data-hf-garment-view]").forEach((b) => b.addEventListener("click"'), "C: the flip is still wired — a tap sets garmentView206 and re-syncs the garment — →244: the binding selects the flip by its new price-row group id");
  assert(appJs.includes("function hfGarmentPaint211") && appJs.includes("function hfGarmentSync206") && appJs.includes("function hfShowScreen215"), "C: the garment painter, the garment sync and the screen switcher all stand");
  const laySrc = appJs.slice(appJs.indexOf("function hfFormatLayout218"), appJs.indexOf("function hfDrawFormat218"));
  assert(laySrc.includes("Math.round(W * 31 / 36)"), "C: the R237 wide geometry is untouched by the unpin (620×465 window at W=720)");
  const barRule = css.slice(css.indexOf(".hf-stickybar215{"), css.indexOf("}", css.indexOf(".hf-stickybar215{")));
  assert(!barRule.includes("position:sticky") && !barRule.includes("position:fixed"), "C: the R237 in-flow Review bar is untouched — still no positioning");
}

// ---- D. VM drive: hfShowScreen215 still switches screens ----
// The real function, sliced whole, over stub elements: the
// switch must hide/show the two screens, re-sync the right
// one, and land the user at the top of the studio — with
// the instant form skipping the scroll, as before.
{
  const src = appJs.slice(appJs.indexOf("function hfShowScreen215"), appJs.indexOf("\n}", appJs.indexOf("function hfShowScreen215")) + 2);
  const scrolls = [];
  const mkEl = (name) => ({ name, hidden: false, scrollIntoView(opts) { scrolls.push({ el: name, opts }); } });
  const els = { "#hfProduct215": mkEl("product"), "#hfReview215": mkEl("review"), "#hfStudio": mkEl("studio") };
  els["#hfReview215"].hidden = true;
  const syncs = [];
  const sb = {
    console,
    $: (s) => els[s] || null,
    hfState: {},
    hfReviewSync206: () => syncs.push("review"),
    hfGarmentSync206: () => syncs.push("garment"),
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(src, ctx);
  sb.hfShowScreen215("review");
  assert(els["#hfProduct215"].hidden === true && els["#hfReview215"].hidden === false && sb.hfState.screen215 === "review", "D: switching to Review hides the product page and shows the Review screen");
  assert(syncs.join(",") === "review", "D: entering Review re-syncs the as-ordered render (hfReviewSync206)");
  assert(scrolls.length === 1 && scrolls[0].el === "studio" && scrolls[0].opts.block === "start", "D: the switch lands the user at the top of the studio (scrollIntoView, block:start) — sensible with no stuck card to land under");
  sb.hfShowScreen215("product");
  assert(els["#hfProduct215"].hidden === false && els["#hfReview215"].hidden === true && sb.hfState.screen215 === "product", "D: switching back restores the product page and hides Review");
  assert(syncs.join(",") === "review,garment" && scrolls.length === 2, "D: returning to the product page re-syncs the garment and scrolls to the top again");
  sb.hfShowScreen215("review", true);
  assert(scrolls.length === 2 && sb.hfState.screen215 === "review", "D: the instant form (studio open) switches without scrolling, as before");
}

// ---- E. served smoke ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r238-"));
  const port = 19900 + (process.pid % 400);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" },
    stdio: "pipe",
  });
  try {
    let served = "";
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { served = await r.text(); break; } } catch (e) { /* not up yet */ }
      await wait(400);
    }
    assert(served.length > 0, "E: the server serves the homepage from a scratch DATA_DIR");
    assert(served.includes('src="app.js?v=240"') && served.includes('href="styles.css?v=228"'), "E: the served homepage carries the v234/v225 pins — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");
    assert(!served.includes('id="hfPinZone229"') && served.includes('id="hfGarment206"') && served.includes('id="hfFenceAuto229"'), "E: the served studio has no pin zone — and the garment card + fence block are served as ever");
    const servedCss = await (await fetch(`http://127.0.0.1:${port}/styles.css`)).text();
    const sAt = servedCss.indexOf("#hfProduct215 .hf-garment206{background:#101012");
    const servedSkin = sAt > -1 ? servedCss.slice(sAt, servedCss.indexOf("}", sAt)) : "";
    assert(sAt > -1 && !servedSkin.includes("position:sticky") && !servedSkin.includes("position:fixed"), "E: the served garment rule is unpinned — the preview scrolls with the page");
    const servedApp = await (await fetch(`http://127.0.0.1:${port}/app.js`)).text();
    assert(servedApp.includes("function hfShowScreen215") && servedApp.includes("function hfGarmentPaint211"), "E: the served app.js carries the screen switcher + garment painter");
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("test-r238: all assertions passed");
