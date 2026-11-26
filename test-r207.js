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
//   F. VM drives: the CTA opens the choice dialog; the
//      film's INSTANT-HIDE contract on a LAGGING stub
//      (play() neither flips paused nor fires 'play' — the
//      buffering lag behind Emil's 3-second report):
//      hidden at tap BEFORE any play event, box revealed
//      at tap, restored on pause, restored on ended,
//      restored when playback fails to start; listeners
//      wire exactly once.
//   G. The served homepage carries the redesign, in order,
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
assert(home.includes('href="styles.css?v=205"') && home.includes('src="app.js?v=209"'), "A: asset pins — app.js v208 / styles v205 (Round 207; both files changed) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");

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
const iFilmBox = sec.indexOf('id="hfHomeFilmBox207"');
const iFilm = sec.indexOf('id="hfHomeFilm201"');

// ---- B. the product hero ----
assert(iHero > -1 && iHeroImg > iHero && iBadges > iHero && iBody > iBadges, "B: the hero block (hft207-hero) opens the card and carries the hero image and the pills, ahead of the body");
const heroSlice = sec.slice(iHero, iBody);
assert(heroSlice.includes('src="/swag/hf-hoodie-softball.jpg"'), "B: the hero is the REAL product photo — the softball hoodie (hf-hoodie-softball.jpg)");
assert(fs.existsSync(path.join(ROOT, "public/swag/hf-hoodie-softball.jpg")), "B: the hero asset exists in public/swag/");
assert(!heroSlice.includes("<video") && !heroSlice.includes("hf-film-box") && !heroSlice.includes("hfHomeFilm201"), "B: the hero is a STILL — no video and no film box in the hero position (the film left the hero)");
assert(css.includes(".hft207-hero{position:relative}"), "B: the hero is the pills' positioning context");
const heroImgRule = (css.match(/\.hft207-hero-img\{[^}]*\}/) || [""])[0];
assert(heroImgRule.includes("width:100%") && heroImgRule.includes("height:auto") && !heroImgRule.includes("object-fit"), "B: the hero image renders at its NATURAL aspect (width 100%, height auto, no object-fit crop) — the whole garment, nothing cropped away");

// ---- C. the pills, raised ----
assert(sec.includes('class="hft201-badges hft207-badges"'), "C: the badges row carries the R207 raised-position class alongside the base row class");
const badges = sec.slice(iBadges, sec.indexOf("</div>", iBadges));
assert(badges.includes("The Swag Shop") && badges.includes("📸 Hype Frame"), "C: the label row carries BOTH pills — The Swag Shop and 📸 Hype Frame");
assert((sec.match(/hft201-badge"/g) || []).length === 2, "C: exactly two label pills ride the hero");
const baseTop = Number((css.match(/\.hft201-badges\{[^}]*top:(\d+)px/) || [])[1]);
const heroTop = Number((css.match(/\.hft207-badges\{top:(\d+)px\}/) || [])[1]);
assert(heroTop > -1 && baseTop > -1 && heroTop < baseTop, "C: the hero pills sit HIGHER than the film-cover row did (" + heroTop + "px < " + baseTop + "px — Emil's 'moved up a little bit')");

// ---- D. headline + sub-line + renamed CTA ----
assert(iTitle > iBody && iSub > iTitle && iCta > iSub, "D: order in the body — headline, then the sub-line, then the CTA");
assert(sec.includes('<p class="hft207-sub">Pick a play. Make it yours.</p>'), "D: the sub-line rides under the headline, word for word");
assert(sec.includes("Build your hoodie →") && sec.includes('onclick="openHfChoice()"'), "D: the CTA is renamed 'Build your hoodie →' on the same openHfChoice() handler");
assert(!sec.includes("Create yours"), "D: the old 'Create yours' label is gone from the section");
assert(css.includes(".hft207-sub{"), "D: the sub-line's style rides in styles.css");

// ---- E. the film, demoted below the CTA ----
assert(iFilmBtn > iCta && iFilmBox > iFilmBtn && iFilm > iFilmBox, "E: DOM order — CTA, then the film link, then the film box, then the video (the film lives below the CTA now)");
assert(sec.includes('class="hft207-film-link" id="hfHomeFilmBtn201"') && sec.includes('onclick="playHfHomeFilm201()"') && sec.includes("▶ See how it works"), "E: the affordance is the link-styled '▶ See how it works' button (same id, same handler)");
assert(sec.includes('<div class="hf-film-box hft207-film" id="hfHomeFilmBox207" hidden>'), "E: the film box starts HIDDEN below the link");
const boxSlice = sec.slice(iFilmBox, sec.indexOf("</div>", iFilm) + "</div>".length);
assert(boxSlice.includes('id="hfFilmCoverHome201"') && boxSlice.includes('id="hfHomeFilm201"') && boxSlice.includes('src="/hype-frame-film.mp4?v=7"'), "E: the film box keeps the section film's own cover / video ids and the shared cut");
assert(!boxSlice.includes("hfHomeFilmBtn201"), "E: the play button is NOT inside the film box (it is the link above it)");
assert(appJs.includes('el.id === "hfHomeFilm201"'), "E: the relocated film stays registered in the media-hygiene exemption (hhSilence158)");
const stripStart = appJs.indexOf("function hypeFrameStrip126()");
const strip = appJs.slice(stripStart, appJs.indexOf("`;", stripStart)).replace(/\\"/g, '"');
assert(strip.includes('id="hfFilmCoverFeed126"') && strip.includes('id="hfFeedFilm126"') && strip.includes('onclick="playHfFeedFilm126()"'), "E: the board strip's film (All Hypes) is untouched");
assert(css.includes(".hft207-film-link{") && css.includes("#hfHomeFilmBox207[hidden]") && css.includes("#hfHomeFilmBtn201[hidden]"), "E: the film link's style, the film box's [hidden] guard and the button's [hidden] guard ride in styles.css");
assert(!home.includes("$110") && !sec.includes("Drop 001") && !sec.includes("Coming soon"), "E: the homepage stays price-free; no Drop 001 / Coming soon in the section");

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
const elMapF = { "#hfFilmCoverHome201": coverF, "#hfHomeFilm201": vidF, "#hfHomeFilmBtn201": btnF, "#hfHomeFilmBox207": boxF };
const sbF = { console, $: (s) => elMapF[s] || null };
vm.runInContext(filmBlock, vm.createContext(sbF));
assert(btnF.hidden === false && boxF.hidden === true, "F: before the tap, the link is visible and the film box is hidden");
sbF.playHfHomeFilm201();
assert(btnF.hidden === true, "F: the button hides INSTANTLY on tap — BEFORE any 'play' event (the 3-second fix)");
assert(boxF.hidden === false && coverF.hidden === true && vidF.hidden === false && vidF.plays === 1, "F: the same tap reveals the film box in place, swaps the cover out and starts the film");
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
const elMapG = { "#hfFilmCoverHome201": coverG, "#hfHomeFilm201": vidG, "#hfHomeFilmBtn201": btnG, "#hfHomeFilmBox207": boxG };
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
  assert(vSec.includes('src="/swag/hf-hoodie-softball.jpg"') && vSec.includes("Build your hoodie") && vSec.includes("Pick a play. Make it yours.") && !vSec.includes("Create yours"), "G: the served section carries the product hero, the renamed CTA and the sub-line — and no 'Create yours'");
  assert(!served.includes("$110"), "G: the served homepage carries no $110 anywhere");
  assert(served.includes('src="app.js?v=209"') && served.includes('href="styles.css?v=205"'), "G: the served homepage carries the Round 207 pins — →209: app.js now v209 (Round 208); styles keeps v205");
} finally { s.child.kill(); }

console.log("\nALL R207 CHECKS PASSED");
