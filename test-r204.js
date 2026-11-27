// Round 204 test: the homepage Hype Frame feature section is
// SLIMMED (Emil, 2026-11-26, after reviewing Round 201 live).
// Run: node test-r204.js
// What this suite pins down:
//   A. Pins: app.js v205 / styles v202 (both files changed) —
//      →206: app.js now v206 / styles now v203 (Round 205) —
//      →207: app.js now v207 / styles now v204 (Round 206).
//   B. The section (#merchTeaser125, element + id + view-home
//      class unchanged) reads, in DOM order: the label pills
//      row on the film (BOTH "The Swag Shop" and "📸 Hype
//      Frame" pills) -> the film (its own R201 ids) -> the
//      headline "Your moment on a hoodie" -> the "Create
//      yours" CTA (openHfChoice()).
//      → Round 207 (Emil, same day) REDESIGNED the section
//      from his product-hero reference: the real softball
//      hoodie photo is the hero (pills ride on it, raised),
//      the headline gains the "Pick a play. Make it yours."
//      sub-line, the CTA is renamed "Build your hoodie →",
//      and the film sits BELOW the CTA (a link reveals its
//      box in place). The B/C assertions below were updated
//      to the new order and labels; test-r207.js pins the
//      redesign in full. REMOVED from the section:
//      the standalone eyebrow, the pitch paragraph, the facts
//      pills ($110, Black or Heather Gray, Youth YXXS–YXL,
//      Adult S–XL, the 5–7 business days line), both finished-
//      example thumbnails + captions, and the sub-line. The
//      example image FILES stay on disk in /swag. "$110" is
//      absent from the served homepage entirely; no Drop 001
//      or Coming soon text (re)appears in the section; the
//      /store section is unchanged.
//   C. The served homepage (booted server) carries the slim
//      section in the same order, price-free.
//   D. VM drive: "Create yours" still opens the choice dialog
//      (openHfChoice shows the modal on its choices panel).
//      →207: the CTA is "Build your hoodie" now; same drive.
//   E. VM drive: the film's play button (hfHomeFilmBtn201,
//      now OUTSIDE the cover) answers to the video's events —
//      visible before play, hidden on play, back on pause,
//      hidden again on the next play, back on ended (replay)
//      — and the listeners wire exactly once.
//      →207: the button is the "See how it works" LINK below
//      the CTA and the contract is INSTANT-HIDE — the drive
//      below uses a lagging stub (play() neither flips paused
//      nor fires 'play', the buffering lag Emil saw) and pins:
//      hidden at tap BEFORE any play event, the film box
//      revealed at tap, back on pause, back on ended.
//      →210: the revealed box is the film OVERLAY now
//      (hfHomeFilmOverlay210) — the drive's stub map and the
//      reveal assertion below were updated to match.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r204-"));
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
assert(home.includes('href="styles.css?v=219"') && home.includes('src="app.js?v=226"'), "A: asset pins — app.js v205 / styles v202 (Round 204; both files changed) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230)");

// ---- B. the slim section: order + removals ----
const secStart = home.indexOf('id="merchTeaser125"');
const secEnd = home.indexOf("<!-- ============ THE STORE", secStart);
assert(secStart > -1 && secEnd > secStart, "B: the merch section is located ahead of the Store section");
const sec = home.slice(secStart, secEnd);
assert(home.includes('<div class="merch-teaser125 view-home" id="merchTeaser125">'), "B: the section element, its id and the view-home class are unchanged (view routing untouched)");

// DOM order: pills row -> film -> headline -> CTA.
// →207: hero (pills on the product photo) -> headline ->
// sub-line -> CTA -> the film link -> the film box.
const iBadges = sec.indexOf("hft201-badges");
const iFilm = sec.indexOf('id="hfHomeFilm201"');
const iTitle = sec.indexOf("Your moment on a hoodie");
const iCta = sec.indexOf('onclick="openHfChoice()"');
const iFilmBtn = sec.indexOf('id="hfHomeFilmBtn201"');
const iFilmBox = sec.indexOf('id="hfHomeFilmOverlay210"');
assert(iBadges === -1 && sec.indexOf("hft212-head") > -1 && iTitle > sec.indexOf("hft212-head") && iCta > iTitle && iFilmBtn > iCta && iFilmBox > iFilmBtn && iFilm > iFilmBox, "B: DOM order — card header, then the headline, then the CTA, then the film link, then the film (→207 redesign; was pills -> film -> headline -> CTA in Round 204 — →210: the film sits in its overlay after the section — →212: the pills are REMOVED, replaced by the crown + HYPE FRAME™ card header)");
assert(!sec.includes("hft201-badge") && !sec.includes("The Swag Shop") && sec.includes("HYPE FRAME™"), "B: →212 — no label pills ride the hero anymore; the card header carries the branding");
assert(sec.includes('id="hfFilmCoverHome201"') && sec.includes('id="hfHomeFilm201"') && sec.includes('src="/hype-frame-film.mp4?v=7"') && sec.includes('src="/swag/hf-hoodie-softball.jpg"'), "B: the film is unchanged — its own cover / video ids, the shared cut, the softball cover (→207: the softball photo ALSO serves as the hero still; the film keeps its own cover)");
assert(sec.includes('id="hfHomeFilmBtn201"') && sec.includes('onclick="playHfHomeFilm201()"'), "B: the film's play button carries its own id and the section handler");
assert(iFilmBtn > iCta && iFilmBtn < iFilmBox, "B: the play button is the 'See how it works' link BELOW the CTA and OUTSIDE the film box (→207; in Round 204 it sat between cover and video, overlaying the film — →210: the box rides in the overlay after the section)");
const coverSlice = sec.slice(sec.indexOf('id="hfFilmCoverHome201"'), sec.indexOf("</div>", sec.indexOf('id="hfFilmCoverHome201"')));
assert(!coverSlice.includes("hf-film-btn") && !coverSlice.includes("hfHomeFilmBtn201"), "B: no play button remains inside the cover");
assert(sec.includes("Build your hoodie") && !sec.includes("Create yours"), "B: the CTA label rides — 'Build your hoodie →' (→207; was 'Create yours →')");

// Removed, entirely:
assert(!sec.includes("hft201-eyebrow"), "B: REMOVED — the standalone eyebrow below the film");
assert(!sec.includes("hft201-pitch") && !sec.includes("Your highlight becomes the print") && !sec.includes("Pick a frame from your play"), "B: REMOVED — the pitch paragraph");
for (const f of ["$110", "Black or Heather Gray", "Youth YXXS–YXL", "Adult S–XL", "Made to order — ships in 5–7 business days"])
  assert(!sec.includes(f), "B: REMOVED — the fact: " + f);
assert(!sec.includes("hft201-facts") && !sec.includes("hft201-gold"), "B: REMOVED — the facts row markup and its gold price pill");
assert(!sec.includes('src="/swag/hf-example-hoodie-back.jpg"') && !sec.includes('src="/swag/hf-example-lineup.jpg"') && !sec.includes("hft201-thumbs") && !sec.includes("Your play, printed large on the back.") && !sec.includes("Photo or avatar — your call in the studio."), "B: REMOVED — both example thumbnails and their captions");
assert(!sec.includes("hft201-sub") && !sec.includes("Opens the Hype Frame studio"), "B: REMOVED — the sub-line under the CTA");
assert(fs.existsSync(path.join(ROOT, "public/swag/hf-example-hoodie-back.jpg")) && fs.existsSync(path.join(ROOT, "public/swag/hf-example-lineup.jpg")), "B: the example image FILES stay on disk in /swag (only their use in this section was removed)");
for (const bad of ["Drop 001", "Coming soon", "mt125-prod", "Open the full store"])
  assert(!sec.includes(bad), "B: absent from the section (as before): " + bad);
assert(!sec.includes("$110") && home.slice(home.indexOf('id="hfPriceTop222"'), home.indexOf('id="hfGarment206"')).includes("$110 · Made to order"), "B: the $110 string is absent from the homepage SECTION entirely — →215: it now lives in the studio's buy card (Emil's one-page mock shows the price on the product page; before R215 the studio markup carried no price string at all) — →222: the price moved under the product name (#hfPriceTop222, '$110 · Made to order')");

// The CSS follows the markup: dead rules gone, the new ones ride.
for (const dead of [".hft201-eyebrow", ".hft201-pitch", ".hft201-facts", ".hft201-thumbs", ".hft201-sub", ".hft201-gold"])
  assert(!css.includes(dead), "B: dead CSS removed: " + dead);
assert(!css.includes(".hft201-badges{") && css.includes("#hfHomeFilmBtn201[hidden]"), "B: the film button's explicit [hidden] guard rides in styles.css — →212: the badges row CSS is REMOVED with the pills (dead — nothing else used it)");
assert(!css.includes(".hft201-film-btn") && !css.includes(".hft207-badges{") && css.includes(".hft207-film-link{") && css.includes(".hf-film-overlay210[hidden]") && !css.includes("hfHomeFilmBox207"), "B: →207 — the R204 film-button stacking rule is REMOVED with the overlay markup; the film link and the film box's [hidden] guard ride instead — →210: the guard is the film OVERLAY's now, and the retired box's rules are gone — →212: the raised-badges rule went with the pills");
assert(css.includes(".hft201-card{") && css.includes(".hft201-title{") && css.includes(".hft201-cta{"), "B: the surviving section styles ride (card / headline / CTA)");

// The /store section is unchanged.
const store = home.slice(secEnd);
assert(store.includes('<span class="crumb">HighlightHype<span class="sep">/</span><b>Store</b><span class="sep">·</span>Drop 001</span>') && store.includes('id="hfFilmCoverStore"') && store.includes('id="hfStoreFilm"'), "B: the /store section is unchanged (crumb + its own film pair)");

// ---- D. VM drive: the CTA opens the choice dialog ----
// (→207: the CTA reads "Build your hoodie" — same openHfChoice.)
// (The R202 drive pattern: the real openHfChoice block on stubs.)
function lineSrc(startNeedle) { const i = appJs.indexOf(startNeedle); return appJs.slice(i, appJs.indexOf("\n", i)); }
const escCapSrc = appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("\n", appJs.indexOf("const cap =")));
const choiceBlock = appJs.slice(appJs.indexOf("window.openHfChoice"), appJs.indexOf('$$("[data-hf-start]")'));
const mkEl = () => ({ hidden: false, innerHTML: "", textContent: "", value: "", parentElement: null });
const modalEl = mkEl(); modalEl.hidden = true;
const choiceEl = mkEl(), pickerEl = mkEl(); pickerEl.hidden = true;
const elMapD = { "#hfChoiceModal": modalEl, "#hfChoicePanel": choiceEl, "#hfPickerPanel": pickerEl, "#hfPickerSearch202": mkEl(), "#hfPickerList202": mkEl(), "#hfPickerEmpty202": mkEl() };
const sbD = {
  console,
  document: { body: { appendChild() {} } },
  $: (s) => elMapD[s] || null,
  ALL_PLAYS: [], CONTEST: { entries: [] },
  openHypeFrame: () => {}, goSubmit: () => {},
};
sbD.window = sbD;
vm.runInContext(escCapSrc + "\n" + lineSrc("function parsePlayDate(") + "\n" + choiceBlock, vm.createContext(sbD));
sbD.openHfChoice();
assert(modalEl.hidden === false && choiceEl.hidden === false && pickerEl.hidden === true, "D: the CTA (Build your hoodie, →207; Create yours before) still opens the choice dialog on its choices panel");

// ---- E. VM drive: the film button answers to the video ----
// →207: the stub's play() is deliberately LAGGING — it neither
// flips paused nor fires 'play' (the buffering lag behind
// Emil's 3-second sit). The button must hide at TAP, before
// any event; the sync restores it on pause / ended.
const filmBlock = appJs.slice(appJs.indexOf("let hfHomeFilmWired204"), appJs.indexOf("\n}", appJs.indexOf("function playHfHomeFilm201")) + 2);
assert(filmBlock.includes("function playHfHomeFilm201()") && filmBlock.includes("hfHomeFilmBtnSync204"), "E: the R204 film block is located (wiring flag + sync helper + handler)");
for (const ev of ['"play"', '"pause"', '"ended"'])
  assert(filmBlock.includes("addEventListener(" + ev), "E: the button sync is wired to the video's " + ev + " event");
const vidE = {
  hidden: true, plays: 0, paused: true, ended: false, listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  fire(ev) { (this.listeners[ev] || []).slice().forEach((fn) => fn()); },
  play() { this.plays++; return { catch() {} }; },
};
const coverE = { hidden: false }, btnE = { hidden: false }, boxE = { hidden: true };
const elMapE = { "#hfFilmCoverHome201": coverE, "#hfHomeFilm201": vidE, "#hfHomeFilmBtn201": btnE, "#hfHomeFilmOverlay210": boxE };
const sbE = { console, $: (s) => elMapE[s] || null };
vm.runInContext(filmBlock, vm.createContext(sbE));
assert(btnE.hidden === false && boxE.hidden === true, "E: before play, the link is visible under the CTA and the film overlay is hidden (→207; overlay →210)");
sbE.playHfHomeFilm201();
assert(coverE.hidden === true && vidE.hidden === false && vidE.plays === 1, "E: the handler still swaps the cover out and plays the film");
assert(boxE.hidden === false, "E: the tap opens the film overlay over the page (→210; it revealed the box in place below the CTA in Round 207)");
assert(btnE.hidden === true, "E: the button hides INSTANTLY on tap — before any 'play' event fires (→207, the 3-second-sit fix)");
vidE.paused = false; vidE.fire("play");
assert(btnE.hidden === true, "E: when the (lagging) play event finally lands, the button stays hidden");
vidE.paused = true; vidE.fire("pause");
assert(btnE.hidden === false, "E: on pause, the button returns (the sync restores it)");
sbE.playHfHomeFilm201();
assert(btnE.hidden === true, "E: tapping again hides it instantly again");
vidE.paused = false; vidE.fire("play");
assert(btnE.hidden === true, "E: on the next play, the button stays hidden");
vidE.paused = true; vidE.ended = true; vidE.fire("ended");
assert(btnE.hidden === false, "E: on ended, the button returns (replay)");
sbE.playHfHomeFilm201();
assert(vidE.listeners.play.length === 1 && vidE.listeners.pause.length === 1 && vidE.listeners.ended.length === 1, "E: the listeners wire exactly once, however often the handler runs");
assert(btnE.hidden === true, "E: replaying from the ended state hides the button again (at tap, →207)");

// ---- C. served homepage ----
const s = await boot(8944);
try {
  const served = await (await fetch(s.base + "/")).text();
  const vStart = served.indexOf('id="merchTeaser125"');
  const vSec = served.slice(vStart, served.indexOf("<!-- ============ THE STORE", vStart));
  const vBadges = vSec.indexOf("hft201-badges"), vFilm = vSec.indexOf('id="hfHomeFilm201"'), vTitle = vSec.indexOf("Your moment on a hoodie"), vCta = vSec.indexOf('onclick="openHfChoice()"'), vFilmBtn = vSec.indexOf('id="hfHomeFilmBtn201"');
  assert(vBadges === -1 && vTitle > vSec.indexOf("hft212-head") && vCta > vTitle && vFilmBtn > vCta && vFilm > vFilmBtn, "C: the served section reads card header -> headline -> CTA -> film link -> film (→207 redesign; was pills -> film -> headline -> CTA — →212: header instead of pills)");
  assert(!vSec.includes("The Swag Shop") && vSec.includes("HYPE FRAME™") && vSec.includes('src="/crown.png"'), "C: →212 — the served card header carries the crown + wordmark; no pills");
  assert(vSec.includes("Build your hoodie") && vSec.includes("Pick a play. Make it yours."), "C: the served section carries the renamed CTA and the sub-line (→207)");
  assert(!vSec.includes("hft201-pitch") && !vSec.includes("hft201-facts") && !vSec.includes("hf-example-hoodie-back.jpg") && !vSec.includes("hf-example-lineup.jpg") && !vSec.includes("Drop 001") && !vSec.includes("Coming soon"), "C: the served section is slim — no pitch, no facts, no example thumbnails, no Drop 001 / Coming soon");
  assert(served.slice(served.indexOf('id="hfPriceTop222"'), served.indexOf('id="hfGarment206"')).includes("$110") && !served.slice(served.indexOf('id="merchTeaser125"'), served.indexOf("<!-- ============ THE STORE")).includes("$110"), "C: the served homepage carries the $110 ONLY in the studio, never in the merch section — →215: the one-page studio shows its price (before R215 it appeared nowhere in the document) — →222: it rides under the product name (#hfPriceTop222)");
  assert(served.includes('src="app.js?v=226"') && served.includes('href="styles.css?v=219"'), "C: the served homepage carries the Round 204 pins — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230)");
} finally { s.child.kill(); }

console.log("\nALL R204 CHECKS PASSED");
