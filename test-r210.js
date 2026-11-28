// Round 210 test: two fixes to the homepage Hype Frame
// section (Emil, 2026-11-26, from his screenshot of the
// LIVE R207 section; mapping confirmed "Correct").
// Run: node test-r210.js
// What this suite pins down:
//   A. Pins: app.js v211 / styles v207 (both files changed).
//   B. CENTER THE HOODIE: the hero is a fixed 4:5 frame
//      (aspect-ratio + overflow hidden) and the photo
//      renders at 143% width under object-fit: cover,
//      object-position 50% 0%. The 143% is MEASURED math,
//      not a guess: on the asset (1440×1680) the framed
//      print spans x 130–880 (PIL brightness scan of the
//      bright photo against the black hoodie: interior
//      130–859; visual grounding incl. the white border:
//      124–894) → center 0.351, and 1.43 × 0.351 = 0.502,
//      the frame's horizontal center. The vertical window
//      (top-aligned) covers the photo's top ~75%: the hood
//      (y 0–0.283), the shoulders and the whole print
//      (bottom 0.744) stay in frame.
//   C. The pills are unchanged (raised row on the photo).
//   D. The body order is unchanged (headline → sub-line →
//      CTA → film link) and the retired in-place reveal is
//      GONE: no hfHomeFilmBox207 markup, lookup or CSS.
//   E. The OVERLAY: markup after the section (backdrop
//      shell in the Round 128 lightbox idiom, ✕ button,
//      the SAME cover / video pair in hfHomeFilmBox210),
//      its CSS (fixed, flex-centered, [hidden] guard),
//      closeHfHomeFilm210 + the Escape listener in app.js,
//      the hhSilence158 exemption still keyed on the video
//      id, and the board strip's film untouched.
//   F. VM drives: the tap opens the overlay + hides the
//      link instantly (lagging stub), re-parents the
//      overlay to <body>, locks page scroll, focuses the
//      ✕; close (function / Escape) pauses the film,
//      hides the overlay, restores scroll + the link +
//      focus; a non-Escape key is a no-op; close-when-
//      closed is a no-op; a failed start closes the
//      overlay and restores the link; listeners wire once.
//   G. The served homepage carries all of it, in order,
//      and still carries no $110 anywhere.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r210-"));
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

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=239"'), "A: asset pins — app.js v211 / styles v207 (Round 210; both files changed) — →212: pins now v212/v208 (Round 211) — →213: pins now v213/v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");

// ---- the section + the overlay after it ----
const secStart = home.indexOf('id="merchTeaser125"');
const secEnd = home.indexOf("<!-- ============ THE STORE", secStart);
assert(secStart > -1 && secEnd > secStart, "the merch section is located ahead of the Store section");
const sec = home.slice(secStart, secEnd);
const iHero = sec.indexOf("hft207-hero");
const iTitle = sec.indexOf("Your moment on a hoodie");
const iSub = sec.indexOf("Pick a play. Make it yours.");
const iCta = sec.indexOf('onclick="openHfChoice()"');
const iFilmBtn = sec.indexOf('id="hfHomeFilmBtn201"');
const iOverlay = sec.indexOf('id="hfHomeFilmOverlay210"');
const iFilm = sec.indexOf('id="hfHomeFilm201"');
const bodySlice = sec.slice(0, sec.indexOf("<!-- Round 210: the merch section's film"));

// ---- B. the centered hero ----
const heroRule = (css.match(/\.hft207-hero\{[^}]*\}/) || [""])[0];
assert(heroRule.includes("position:relative") && heroRule.includes("overflow:hidden") && heroRule.includes("border-radius:14px") && !heroRule.includes("aspect-ratio"), "B: →212 SUPERSEDED — the fixed 4:5 hero frame is GONE (Emil rejected the crop on his phone); the hero is a rounded natural-aspect frame again");
const imgRule = (css.match(/\.hft207-hero-img\{[^}]*\}/) || [""])[0];
assert(imgRule.includes("width:100%") && imgRule.includes("height:auto") && !imgRule.includes("object-fit") && !imgRule.includes("143%"), "B: →212 SUPERSEDED — the 143% cover render is GONE; the photo renders whole at natural aspect (width 100%, height auto), the full print + graffiti crown/H visible");
assert(sec.slice(iHero, sec.indexOf("hft201-body")).includes('src="/swag/hf-hoodie-nicholas218.jpg"'), "B: →218: the hero is Emil's Nicholas front+back shot now (the softball photo left the hero)");
assert((sec.match(/hf-hoodie-softball\.jpg/g) || []).length === 1, "B: →218: the softball photo appears exactly ONCE in the section slice — only the film's own cover instance (it was twice while it was also the hero)");

// ---- C. the pills — →212: REMOVED (the card header does their job) ----
assert(!sec.includes("hft201-badges") && !sec.includes("hft201-badge") && !css.includes(".hft201-badges{") && !css.includes(".hft207-badges{"), "C: →212 — the pills are OFF the photo: markup and their CSS are gone; the crown + HYPE FRAME™ card header carries the branding instead");

// ---- D. body order + the retired reveal ----
assert(iTitle > -1 && iSub > iTitle && iCta > iSub && iFilmBtn > iCta, "D: body order unchanged — headline, sub-line, CTA, film link");
assert(bodySlice.includes('id="hfHomeFilmBtn201"') && !bodySlice.includes("hf-film-box"), "D: the section body carries the film LINK only — no film box in the body anymore");
assert(!home.includes('id="hfHomeFilmBox207"') && !appJs.includes('$("#hfHomeFilmBox207")') && !css.includes("#hfHomeFilmBox207") && !css.includes(".hft207-film{"), "D: the in-place reveal is retired everywhere — no hfHomeFilmBox207 markup, no handler lookup, no CSS (the .hft207-film margin went with it)");

// ---- E. the overlay ----
assert(iOverlay > iFilmBtn && iFilm > iOverlay, "E: DOM order — the film link, then the overlay after the section, then the video inside it");
assert(sec.includes('<div class="hf-film-overlay210" id="hfHomeFilmOverlay210" hidden role="dialog" aria-modal="true"'), "E: the overlay is a hidden dialog shell (role + aria-modal) after the section");
assert(sec.includes('onclick="if(event.target===this)closeHfHomeFilm210()"'), "E: a backdrop tap (a click landing on the overlay shell itself) closes it");
assert(sec.includes('<button type="button" class="hf-film-close210" id="hfHomeFilmClose210" onclick="closeHfHomeFilm210()"'), "E: the ✕ button closes it (its own id + the close handler)");
const ovSlice = sec.slice(iOverlay, sec.indexOf("<!-- ============ THE STORE"));
assert(ovSlice.includes('<div class="hf-film-box hf-film-box210" id="hfHomeFilmBox210">') && ovSlice.includes('id="hfFilmCoverHome201"') && ovSlice.includes('id="hfHomeFilm201"') && ovSlice.includes('src="/hype-frame-film.mp4?v=7"'), "E: the overlay holds the SAME cover / video pair in the new film box (hfHomeFilmBox210) — same cut, no duplicate video");
assert((home.match(/id="hfHomeFilm201"/g) || []).length === 1 && (home.match(/id="hfFilmCoverHome201"/g) || []).length === 1, "E: the section film ids still occur exactly once in the page");
const ovRule = (css.match(/\.hf-film-overlay210\{[^}]*\}/) || [""])[0];
assert(ovRule.includes("position:fixed") && ovRule.includes("inset:0") && ovRule.includes("display:flex") && ovRule.includes("align-items:center") && ovRule.includes("justify-content:center"), "E: the overlay CSS is the lightbox shell — fixed, dim, flex-centered");
assert(css.includes(".hf-film-overlay210[hidden]{display:none}"), "E: the overlay's explicit [hidden] guard rides (the standing CSS trap)");
assert(css.includes(".hf-film-box210{") && css.includes(".hf-film-close210{"), "E: the film box sizing and the ✕ button styles ride in styles.css");
assert(appJs.includes("function closeHfHomeFilm210()"), "E: the close function rides in app.js");
assert(appJs.includes('document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHfHomeFilm210(); });'), "E: Escape closes the overlay (a document keydown listener in the film block's wake)");
assert(appJs.includes('el.id === "hfHomeFilm201"'), "E: the film stays registered in the media-hygiene exemption (hhSilence158) under its unchanged id");
const stripStart = appJs.indexOf("function hypeFrameStrip126()");
const strip = appJs.slice(stripStart, appJs.indexOf("`;", stripStart)).replace(/\\"/g, '"');
assert(strip.includes('id="hfFilmCoverFeed126"') && strip.includes('id="hfFeedFilm126"') && strip.includes('onclick="playHfFeedFilm126()"'), "E: the board strip's film (All Hypes) is untouched");

// ---- F. VM drives ----
const filmBlock = appJs.slice(appJs.indexOf("let hfHomeFilmWired204"), appJs.indexOf("\n}", appJs.indexOf("function playHfHomeFilm201")) + 2);
assert(filmBlock.includes("function playHfHomeFilm201()") && filmBlock.includes("function closeHfHomeFilm210()") && filmBlock.includes("hfHomeFilmBtnSync204"), "F: the film block is located (wiring flag + sync + close + handler)");
const escIdx = appJs.indexOf("closeHfHomeFilm210(); });");
const escLine = appJs.slice(appJs.lastIndexOf("document.addEventListener", escIdx), appJs.indexOf("\n", escIdx));
assert(escLine.includes('"keydown"') && escLine.includes('"Escape"'), "F: the Escape listener line is located");

function mkDrive(failStart) {
  const body = { style: {}, appendChild(el) { el.parentElement = this; } };
  const keyHandlers = [];
  const documentStub = { body, addEventListener(ev, fn) { if (ev === "keydown") keyHandlers.push(fn); } };
  const vid = {
    hidden: true, plays: 0, pauses: 0, paused: true, ended: false, listeners: {},
    addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
    fire(ev) { (this.listeners[ev] || []).slice().forEach((fn) => fn()); },
    play() { this.plays++; return failStart ? { catch(fn) { fn(new Error("autoplay blocked")); } } : { catch() {} }; },
    pause() { this.pauses++; this.paused = true; this.fire("pause"); },
  };
  const cover = { hidden: false };
  const btn = { hidden: false, focuses: 0, focus() { this.focuses++; } };
  const closeBtn = { hidden: false, focuses: 0, focus() { this.focuses++; } };
  const ov = { hidden: true, parentElement: null };
  const elMap = { "#hfFilmCoverHome201": cover, "#hfHomeFilm201": vid, "#hfHomeFilmBtn201": btn, "#hfHomeFilmOverlay210": ov, "#hfHomeFilmClose210": closeBtn };
  const sb = { console, document: documentStub, $: (s) => elMap[s] || null };
  vm.runInContext(filmBlock + "\n" + escLine, vm.createContext(sb));
  return { sb, body, keyHandlers, vid, cover, btn, closeBtn, ov };
}

// The open/close drive, on the LAGGING stub (play() neither
// flips paused nor fires 'play' — the buffering lag).
{
  const d = mkDrive(false);
  assert(d.btn.hidden === false && d.ov.hidden === true && !d.body.style.overflow, "F: before the tap — link visible, overlay hidden, page scroll free");
  d.sb.playHfHomeFilm201();
  assert(d.btn.hidden === true, "F: the link hides INSTANTLY on tap — before any 'play' event (the R207 contract, carried over)");
  assert(d.ov.hidden === false && d.ov.parentElement === d.body, "F: the tap opens the overlay, re-parented to <body> (the choice-dialog idiom)");
  assert(d.body.style.overflow === "hidden", "F: opening locks the page scroll (the lightbox idiom)");
  assert(d.closeBtn.focuses === 1, "F: opening moves focus to the ✕ button");
  assert(d.cover.hidden === true && d.vid.hidden === false && d.vid.plays === 1, "F: the same tap swaps the cover out and starts the film");
  d.vid.paused = false; d.vid.fire("play");
  assert(d.btn.hidden === true, "F: when the lagging 'play' event lands, the link stays hidden");
  // Close via the close function (the ✕ / backdrop route).
  d.sb.closeHfHomeFilm210();
  assert(d.vid.pauses === 1 && d.vid.paused === true, "F: closing PAUSES the film");
  assert(d.ov.hidden === true && d.body.style.overflow === "", "F: closing hides the overlay and restores the page scroll");
  assert(d.btn.hidden === false && d.btn.focuses === 1, "F: closing restores the link and returns focus to it");
  d.sb.closeHfHomeFilm210();
  assert(d.vid.pauses === 1 && d.btn.focuses === 1, "F: closing an already-closed overlay is a no-op (no extra pause, no focus steal)");
  // Reopen, then close via Escape; a non-Escape key is a no-op.
  d.sb.playHfHomeFilm201();
  assert(d.ov.hidden === false && d.vid.plays === 2, "F: the link reopens the overlay after a close");
  d.vid.paused = false;
  d.keyHandlers.forEach((fn) => fn({ key: "Enter" }));
  assert(d.ov.hidden === false, "F: a non-Escape key leaves the overlay open");
  d.keyHandlers.forEach((fn) => fn({ key: "Escape" }));
  assert(d.ov.hidden === true && d.vid.paused === true && d.btn.hidden === false, "F: Escape closes the overlay, pauses the film and restores the link");
  assert(d.vid.listeners.play.length === 1 && d.vid.listeners.pause.length === 1 && d.vid.listeners.ended.length === 1, "F: the listeners wire exactly once, however often the handler runs");
}

// Failure path: play() rejects — the rejection path closes
// the overlay and the sync restores the link.
{
  const d = mkDrive(true);
  d.sb.playHfHomeFilm201();
  assert(d.ov.hidden === true && d.btn.hidden === false && d.body.style.overflow === "", "F: if playback fails to start, the overlay closes and the link + scroll are restored (the rejection path)");
}

// ---- G. served homepage ----
const s = await boot(8951);
try {
  const served = await (await fetch(s.base + "/")).text();
  const vStart = served.indexOf('id="merchTeaser125"');
  const vSec = served.slice(vStart, served.indexOf("<!-- ============ THE STORE", vStart));
  const vHero = vSec.indexOf("hft207-hero"), vTitle = vSec.indexOf("Your moment on a hoodie"), vCta = vSec.indexOf('onclick="openHfChoice()"'), vBtn = vSec.indexOf('id="hfHomeFilmBtn201"'), vOv = vSec.indexOf('id="hfHomeFilmOverlay210"'), vFilm = vSec.indexOf('id="hfHomeFilm201"');
  assert(vHero > -1 && vTitle > vHero && vCta > vTitle && vBtn > vCta && vOv > vBtn && vFilm > vOv, "G: the served section reads hero -> headline -> CTA -> film link -> overlay -> film");
  assert(!served.includes('id="hfHomeFilmBox207"'), "G: the served homepage carries no trace of the retired in-place film box");
  assert(served.slice(served.indexOf('id="hfPriceTop222"'), served.indexOf('id="hfGarment206"')).includes("$110"), "G: the served homepage carries the $110 in the studio — →215: the one-page studio shows its price (before R215 it appeared nowhere in the document) — →222: under the product name (#hfPriceTop222)");
  assert(served.includes('src="app.js?v=239"') && served.includes('href="styles.css?v=228"'), "G: the served homepage carries the Round 210 pins — →212: pins now v212/v208 (Round 211) — →213: pins now v213/v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");
} finally { s.child.kill(); }

console.log("\nALL R210 CHECKS PASSED");
