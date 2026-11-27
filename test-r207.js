// Round 207 test: the homepage Hype Frame section is
// REDESIGNED (Emil, 2026-11-26, from his product-hero
// reference; mapping confirmed "Correct on both").
// Run: node test-r207.js
// What this suite pins down:
//   A. Pins: app.js v208 / styles v205 (both files changed).
//   B. The PRODUCT HERO: the section's main visual is the
//      real product photo (/swag/hf-hoodie-softball.jpg —
//      the softball moment printed on the back of a black
//      hoodie) as a STILL at its natural aspect (whole
//      garment, no object-fit crop). No video in the hero.
//      → Round 210 superseded the natural-aspect rendering:
//      the hero is a fixed 4:5 frame and the photo renders
//      at 143% width under object-fit: cover, centering the
//      print (pinned in test-r210); the §B rule assertion
//      below was updated to match.
//   C. The PILLS ride the hero, RAISED: the badges row
//      carries hft207-badges, whose top (6px) sits above
//      the base row's top on the old film cover (12px) —
//      Emil's "moved up a little bit".
//   D. Headline "Your moment on a hoodie" + the sub-line
//      "Pick a play. Make it yours." + the CTA renamed
//      "Build your hoodie →" (same openHfChoice()); the
//      old "Create yours" label is gone from the section.
//   E. The FILM is demoted BELOW the CTA: the "▶ See how
//      it works" affordance is a link-styled button under
//      the CTA; its film box (hfHomeFilmBox207) starts
//      hidden below it, same cover / video / handler ids,
//      still in the hhSilence158 exemption; the board
//      strip's film is untouched.
//      → Round 210 superseded the in-place reveal: the box
//      left the section body for a centered overlay
//      (hfHomeFilmOverlay210 / hfHomeFilmBox210) that the
//      same tap opens; the §E/§F assertions below were
//      updated to the overlay (test-r210 pins it in full).
//   F. VM drives: the CTA opens the choice dialog; the
//      film's INSTANT-HIDE contract on a LAGGING stub
//      (play() neither flips paused nor fires 'play' — the
//      buffering lag behind Emil's 3-second report):
//      hidden at tap BEFORE any play event, box revealed
//      at tap, restored on pause, restored on ended,
//      restored when playback fails to start; listeners
//      wire exactly once. (→210: "box revealed" is now
//      the overlay opening — same contract, new shell.)
//   G. The served homepage carries the redesign, in order,
//      and still carries no $110 anywhere — →215: the $110
//      now lives in the studio's buy card (§G pins it there).
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r207-"));
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
assert(home.includes('href="styles.css?v=217"') && home.includes('src="app.js?v=224"'), "A: asset pins — app.js v208 / styles v205 (Round 207; both files changed) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227)");

// ---- the section ----
const secStart = home.indexOf('id="merchTeaser125"');
const secEnd = home.indexOf("<!-- ============ THE STORE", secStart);
assert(secStart > -1 && secEnd > secStart, "the merch section is located ahead of the Store section");
const sec = home.slice(secStart, secEnd);
assert(home.includes('<div class="merch-teaser125 view-home" id="merchTeaser125">'), "the section element, its id and the view-home class are unchanged (view routing untouched)");

const iHero = sec.indexOf("hft207-hero");
const iHeroImg = sec.indexOf("hft207-hero-img");
const iBadges = sec.indexOf("hft201-badges");
const iBody = sec.indexOf("hft201-body");
const iTitle = sec.indexOf("Your moment on a hoodie");
const iSub = sec.indexOf("Pick a play. Make it yours.");
const iCta = sec.indexOf('onclick="openHfChoice()"');
const iFilmBtn = sec.indexOf('id="hfHomeFilmBtn201"');
const iFilmBox = sec.indexOf('id="hfHomeFilmOverlay210"');
const iFilm = sec.indexOf('id="hfHomeFilm201"');

// ---- B. the product hero ----
assert(iHero > -1 && iHeroImg > iHero && iBody > iHeroImg && sec.indexOf("hft212-head") > -1 && sec.indexOf("hft212-head") < iHero, "B: the card header (hft212-head) opens the card, then the hero block with the hero image, ahead of the body — →212: the header replaces the pills that rode the hero");
const heroSlice = sec.slice(iHero, iBody);
assert(heroSlice.includes('src="/swag/hf-hoodie-nicholas218.jpg"'), "B: the hero is the REAL product photo — →218: Emil's Nicholas front+back shot (hf-hoodie-nicholas218.jpg) replaces the softball hoodie as the card hero");
assert(fs.existsSync(path.join(ROOT, "public/swag/hf-hoodie-nicholas218.jpg")), "B: the hero asset exists in public/swag/ — →218: the Nicholas shot; the softball file stays on disk (the film cover still uses it)");
assert(!heroSlice.includes("<video") && !heroSlice.includes("hf-film-box") && !heroSlice.includes("hfHomeFilm201"), "B: the hero is a STILL — no video and no film box in the hero position (the film left the hero)");
assert(css.includes(".hft207-hero{position:relative;overflow:hidden;border-radius:14px}"), "B: →212 — the hero rule is the rounded natural frame (the →210 fixed 4:5 aspect is superseded; Emil rejected the crop)");
const heroImgRule = (css.match(/\.hft207-hero-img\{[^}]*\}/) || [""])[0];
assert(heroImgRule.includes("width:100%") && heroImgRule.includes("height:auto") && !heroImgRule.includes("object-fit"), "B: →212 — the hero image renders at NATURAL aspect again (the R207 treatment restored): width 100%, height auto, no crop — the →210 143% cover render is superseded");

// ---- C. the pills — →212: REMOVED, replaced by the card header ----
assert(iBadges === -1 && !sec.includes("hft201-badge") && !sec.includes("The Swag Shop") && !css.includes(".hft201-badges{") && !css.includes(".hft207-badges{"), "C: →212 — the pills are gone from the hero (markup + CSS); the branding moved to the card header");
assert(sec.includes("hft212-brand") && sec.includes("HYPE FRAME™") && sec.includes('src="/crown.png"'), "C: →212 — the card header carries the crown + the HYPE FRAME™ wordmark");

// ---- D. headline + sub-line + renamed CTA ----
assert(iTitle > iBody && iSub > iTitle && iCta > iSub, "D: order in the body — headline, then the sub-line, then the CTA");
assert(sec.includes('<p class="hft207-sub">Pick a play. Make it yours.</p>'), "D: the sub-line rides under the headline, word for word");
assert(sec.includes("Build your hoodie →") && sec.includes('onclick="openHfChoice()"'), "D: the CTA is renamed 'Build your hoodie →' on the same openHfChoice() handler");
assert(!sec.includes("Create yours"), "D: the old 'Create yours' label is gone from the section");
assert(css.includes(".hft207-sub{"), "D: the sub-line's style rides in styles.css");

// ---- E. the film, demoted below the CTA ----
assert(iFilmBtn > iCta && iFilmBox > iFilmBtn && iFilm > iFilmBox, "E: DOM order — CTA, then the film link, then the film overlay, then the video (→210: the film lives in the overlay after the section; was the in-place box below the link in Round 207)");
assert(sec.includes('class="hft207-film-link" id="hfHomeFilmBtn201"') && sec.includes('onclick="playHfHomeFilm201()"') && sec.includes("▶ See how it works"), "E: the affordance is the link-styled '▶ See how it works' button (same id, same handler)");
assert(sec.includes('<div class="hf-film-overlay210" id="hfHomeFilmOverlay210" hidden') && !sec.includes("hfHomeFilmBox207"), "E: →210 — the film overlay starts HIDDEN (the in-place hfHomeFilmBox207 reveal is retired)");
const boxSlice = sec.slice(iFilmBox, sec.indexOf("</div>", iFilm) + "</div>".length);
assert(boxSlice.includes('id="hfHomeFilmBox210"') && boxSlice.includes('id="hfFilmCoverHome201"') && boxSlice.includes('id="hfHomeFilm201"') && boxSlice.includes('src="/hype-frame-film.mp4?v=7"'), "E: the overlay's film box keeps the section film's own cover / video ids and the shared cut (→210 box id)");
assert(!boxSlice.includes("hfHomeFilmBtn201"), "E: the play button is NOT inside the film box (it is the link above it)");
assert(appJs.includes('el.id === "hfHomeFilm201"'), "E: the relocated film stays registered in the media-hygiene exemption (hhSilence158)");
const stripStart = appJs.indexOf("function hypeFrameStrip126()");
const strip = appJs.slice(stripStart, appJs.indexOf("`;", stripStart)).replace(/\\"/g, '"');
assert(strip.includes('id="hfFilmCoverFeed126"') && strip.includes('id="hfFeedFilm126"') && strip.includes('onclick="playHfFeedFilm126()"'), "E: the board strip's film (All Hypes) is untouched");
assert(css.includes(".hft207-film-link{") && css.includes(".hf-film-overlay210[hidden]") && css.includes("#hfHomeFilmBtn201[hidden]") && !css.includes("hfHomeFilmBox207"), "E: the film link's style, the overlay's [hidden] guard and the button's [hidden] guard ride in styles.css (→210: the retired box's guard is gone)");
assert(!sec.includes("$110") && !sec.includes("Drop 001") && !sec.includes("Coming soon"), "E: the homepage SECTION stays price-free; no Drop 001 / Coming soon in the section — →215: the $110 now lives in the studio's buy card on the same document (the one-page product page shows its price), no longer nowhere on the page");

// ---- F. VM drives ----
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
assert(modalEl.hidden === false && choiceEl.hidden === false && pickerEl.hidden === true, "F: 'Build your hoodie' still opens the choice dialog on its choices panel (behavior unchanged)");

// The film drive, on a LAGGING stub: play() counts the call
// but neither flips paused nor fires 'play' — the buffering
// lag behind Emil's "the button stays there for 3 seconds".
const filmBlock = appJs.slice(appJs.indexOf("let hfHomeFilmWired204"), appJs.indexOf("\n}", appJs.indexOf("function playHfHomeFilm201")) + 2);
assert(filmBlock.includes("function playHfHomeFilm201()") && filmBlock.includes("hfHomeFilmBtnSync204"), "F: the film block is located (wiring flag + sync helper + handler)");
const vidF = {
  hidden: true, plays: 0, paused: true, ended: false, listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  fire(ev) { (this.listeners[ev] || []).slice().forEach((fn) => fn()); },
  play() { this.plays++; return { catch() {} }; },
};
const coverF = { hidden: false }, btnF = { hidden: false }, boxF = { hidden: true };
const elMapF = { "#hfFilmCoverHome201": coverF, "#hfHomeFilm201": vidF, "#hfHomeFilmBtn201": btnF, "#hfHomeFilmOverlay210": boxF };
const sbF = { console, $: (s) => elMapF[s] || null };
vm.runInContext(filmBlock, vm.createContext(sbF));
assert(btnF.hidden === false && boxF.hidden === true, "F: before the tap, the link is visible and the film overlay is hidden");
sbF.playHfHomeFilm201();
assert(btnF.hidden === true, "F: the button hides INSTANTLY on tap — BEFORE any 'play' event (the 3-second fix)");
assert(boxF.hidden === false && coverF.hidden === true && vidF.hidden === false && vidF.plays === 1, "F: the same tap opens the film overlay, swaps the cover out and starts the film (→210: overlay, not the in-place reveal)");
vidF.paused = false; vidF.fire("play");
assert(btnF.hidden === true, "F: when the lagging 'play' event lands, the button stays hidden");
vidF.paused = true; vidF.fire("pause");
assert(btnF.hidden === false, "F: on pause, the sync restores the button");
sbF.playHfHomeFilm201();
assert(btnF.hidden === true, "F: tapping the restored button hides it instantly again");
vidF.paused = true; vidF.ended = true; vidF.fire("ended");
assert(btnF.hidden === false, "F: on ended, the sync restores the button (replay)");
assert(vidF.listeners.play.length === 1 && vidF.listeners.pause.length === 1 && vidF.listeners.ended.length === 1, "F: the listeners wire exactly once, however often the handler runs");

// Failure path: play() rejects (playback never starts) —
// the sync, called from the rejection path, restores the
// button because the video is still paused.
const vidG = {
  hidden: true, paused: true, ended: false, listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  play() { return { catch(fn) { fn(new Error("autoplay blocked")); } }; },
};
const coverG = { hidden: false }, btnG = { hidden: false }, boxG = { hidden: true };
const elMapG = { "#hfFilmCoverHome201": coverG, "#hfHomeFilm201": vidG, "#hfHomeFilmBtn201": btnG, "#hfHomeFilmOverlay210": boxG };
// Fresh context: the wiring flag is per-context state.
const sbG = { console, $: (s) => elMapG[s] || null };
vm.runInContext(filmBlock, vm.createContext(sbG));
sbG.playHfHomeFilm201();
assert(btnG.hidden === false, "F: if playback fails to start, the button comes back (the rejection path runs the sync)");

// ---- G. served homepage ----
const s = await boot(8947);
try {
  const served = await (await fetch(s.base + "/")).text();
  const vStart = served.indexOf('id="merchTeaser125"');
  const vSec = served.slice(vStart, served.indexOf("<!-- ============ THE STORE", vStart));
  const vHero = vSec.indexOf("hft207-hero"), vTitle = vSec.indexOf("Your moment on a hoodie"), vCta = vSec.indexOf('onclick="openHfChoice()"'), vBtn = vSec.indexOf('id="hfHomeFilmBtn201"'), vFilm = vSec.indexOf('id="hfHomeFilm201"');
  assert(vHero > -1 && vTitle > vHero && vCta > vTitle && vBtn > vCta && vFilm > vBtn, "G: the served section reads hero -> headline -> CTA -> film link -> film");
  assert(vSec.includes('src="/swag/hf-hoodie-nicholas218.jpg"') && vSec.includes('src="/swag/hf-hoodie-softball.jpg"') && vSec.includes("Build your hoodie") && vSec.includes("Pick a play. Make it yours.") && !vSec.includes("Create yours"), "G: the served section carries the product hero, the renamed CTA and the sub-line — and no 'Create yours' — →218: the hero is the Nicholas shot; the softball photo remains only as the film's cover");
  assert(served.slice(served.indexOf('id="hfPriceTop222"'), served.indexOf('id="hfGarment206"')).includes("$110"), "G: the served homepage carries the $110 in the studio — →215: the one-page studio shows its price (before R215 it appeared nowhere in the document) — →222: under the product name (#hfPriceTop222)");
  assert(served.includes('src="app.js?v=224"') && served.includes('href="styles.css?v=217"'), "G: the served homepage carries the Round 207 pins — →209: app.js now v209 (Round 208); styles keeps v205 — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227)");
} finally { s.child.kill(); }

console.log("\nALL R207 CHECKS PASSED");
