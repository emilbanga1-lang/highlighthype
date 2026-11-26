// Round 204 test: the homepage Hype Frame feature section is
// SLIMMED (Emil, 2026-11-26, after reviewing Round 201 live).
// Run: node test-r204.js
// What this suite pins down:
//   A. Pins: app.js v205 / styles v202 (both files changed) —
//      →206: app.js now v206 / styles now v203 (Round 205).
//   B. The section (#merchTeaser125, element + id + view-home
//      class unchanged) reads, in DOM order: the label pills
//      row on the film (BOTH "The Swag Shop" and "📸 Hype
//      Frame" pills) -> the film (its own R201 ids) -> the
//      headline "Your moment on a hoodie" -> the "Create
//      yours" CTA (openHfChoice()). REMOVED from the section:
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
//   E. VM drive: the film's play button (hfHomeFilmBtn201,
//      now OUTSIDE the cover) answers to the video's events —
//      visible before play, hidden on play, back on pause,
//      hidden again on the next play, back on ended (replay)
//      — and the listeners wire exactly once.
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
assert(home.includes('href="styles.css?v=203"') && home.includes('src="app.js?v=206"'), "A: asset pins — app.js v205 / styles v202 (Round 204; both files changed) — →206: app.js now v206 (Round 205); styles now v203 (Round 205)");

// ---- B. the slim section: order + removals ----
const secStart = home.indexOf('id="merchTeaser125"');
const secEnd = home.indexOf("<!-- ============ THE STORE", secStart);
assert(secStart > -1 && secEnd > secStart, "B: the merch section is located ahead of the Store section");
const sec = home.slice(secStart, secEnd);
assert(home.includes('<div class="merch-teaser125 view-home" id="merchTeaser125">'), "B: the section element, its id and the view-home class are unchanged (view routing untouched)");

// DOM order: pills row -> film -> headline -> CTA.
const iBadges = sec.indexOf("hft201-badges");
const iFilm = sec.indexOf('id="hfHomeFilm201"');
const iTitle = sec.indexOf("Your moment on a hoodie");
const iCta = sec.indexOf('onclick="openHfChoice()"');
assert(iBadges > -1 && iFilm > iBadges && iTitle > iFilm && iCta > iTitle, "B: DOM order — label pills, then the film, then the headline, then the Create yours CTA");
const badges = sec.slice(iBadges, sec.indexOf("</div>", iBadges));
assert(badges.includes("The Swag Shop") && badges.includes("📸 Hype Frame"), "B: the label row carries BOTH pills — The Swag Shop and 📸 Hype Frame");
assert((sec.match(/hft201-badge"/g) || []).length === 2, "B: exactly two label pills ride the film");
assert(sec.includes('id="hfFilmCoverHome201"') && sec.includes('id="hfHomeFilm201"') && sec.includes('src="/hype-frame-film.mp4?v=7"') && sec.includes('src="/swag/hf-hoodie-softball.jpg"'), "B: the film is unchanged — its own cover / video ids, the shared cut, the softball cover");
assert(sec.includes('id="hfHomeFilmBtn201"') && sec.includes('onclick="playHfHomeFilm201()"'), "B: the film's play button carries its own id and the section handler");
assert(sec.indexOf('id="hfHomeFilmBtn201"') > sec.indexOf('id="hfFilmCoverHome201"') && sec.indexOf('id="hfHomeFilmBtn201"') < iFilm, "B: the play button sits OUTSIDE the cover (a sibling between cover and video), so it can overlay the playing film");
const coverSlice = sec.slice(sec.indexOf('id="hfFilmCoverHome201"'), sec.indexOf("<button", sec.indexOf('id="hfFilmCoverHome201"')));
assert(!coverSlice.includes("hf-film-btn"), "B: no play button remains inside the cover");
assert(sec.includes("Create yours"), "B: the CTA label rides");

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
assert(!home.includes("$110"), "B: the $110 string is absent from the homepage markup entirely (it lives in the studio and /store)");

// The CSS follows the markup: dead rules gone, the new ones ride.
for (const dead of [".hft201-eyebrow", ".hft201-pitch", ".hft201-facts", ".hft201-thumbs", ".hft201-sub", ".hft201-gold"])
  assert(!css.includes(dead), "B: dead CSS removed: " + dead);
assert(css.includes(".hft201-badges{") && css.includes(".hft201-film-btn{") && css.includes("#hfHomeFilmBtn201[hidden]"), "B: the badges row, the film-button stacking and its explicit [hidden] guard ride in styles.css");
assert(css.includes(".hft201-card{") && css.includes(".hft201-title{") && css.includes(".hft201-cta{"), "B: the surviving section styles ride (card / headline / CTA)");

// The /store section is unchanged.
const store = home.slice(secEnd);
assert(store.includes('<span class="crumb">HighlightHype<span class="sep">/</span><b>Store</b><span class="sep">·</span>Drop 001</span>') && store.includes('id="hfFilmCoverStore"') && store.includes('id="hfStoreFilm"'), "B: the /store section is unchanged (crumb + its own film pair)");

// ---- D. VM drive: Create yours opens the choice dialog ----
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
assert(modalEl.hidden === false && choiceEl.hidden === false && pickerEl.hidden === true, "D: Create yours still opens the choice dialog on its choices panel");

// ---- E. VM drive: the film button answers to the video ----
const filmBlock = appJs.slice(appJs.indexOf("let hfHomeFilmWired204"), appJs.indexOf("\n}", appJs.indexOf("function playHfHomeFilm201")) + 2);
assert(filmBlock.includes("function playHfHomeFilm201()") && filmBlock.includes("hfHomeFilmBtnSync204"), "E: the R204 film block is located (wiring flag + sync helper + handler)");
for (const ev of ['"play"', '"pause"', '"ended"'])
  assert(filmBlock.includes("addEventListener(" + ev), "E: the button sync is wired to the video's " + ev + " event");
const vidE = {
  hidden: true, plays: 0, paused: true, ended: false, listeners: {},
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
  fire(ev) { (this.listeners[ev] || []).slice().forEach((fn) => fn()); },
  play() { this.plays++; this.paused = false; this.ended = false; this.fire("play"); return { catch() {} }; },
};
const coverE = { hidden: false }, btnE = { hidden: false };
const elMapE = { "#hfFilmCoverHome201": coverE, "#hfHomeFilm201": vidE, "#hfHomeFilmBtn201": btnE };
const sbE = { console, $: (s) => elMapE[s] || null };
vm.runInContext(filmBlock, vm.createContext(sbE));
assert(btnE.hidden === false, "E: before play, the button is visible over the cover");
sbE.playHfHomeFilm201();
assert(coverE.hidden === true && vidE.hidden === false && vidE.plays === 1, "E: the handler still swaps the cover out and plays the film");
assert(btnE.hidden === true, "E: the moment playback starts (play event), the button disappears");
vidE.paused = true; vidE.fire("pause");
assert(btnE.hidden === false, "E: on pause, the button returns over the paused film");
vidE.paused = false; vidE.fire("play");
assert(btnE.hidden === true, "E: on the next play, the button disappears again");
vidE.paused = true; vidE.ended = true; vidE.fire("ended");
assert(btnE.hidden === false, "E: on ended, the button returns (replay)");
sbE.playHfHomeFilm201();
assert(vidE.listeners.play.length === 1 && vidE.listeners.pause.length === 1 && vidE.listeners.ended.length === 1, "E: the listeners wire exactly once, however often the handler runs");
assert(btnE.hidden === true, "E: replaying from the ended state hides the button again");

// ---- C. served homepage ----
const s = await boot(8944);
try {
  const served = await (await fetch(s.base + "/")).text();
  const vStart = served.indexOf('id="merchTeaser125"');
  const vSec = served.slice(vStart, served.indexOf("<!-- ============ THE STORE", vStart));
  const vBadges = vSec.indexOf("hft201-badges"), vFilm = vSec.indexOf('id="hfHomeFilm201"'), vTitle = vSec.indexOf("Your moment on a hoodie"), vCta = vSec.indexOf('onclick="openHfChoice()"');
  assert(vBadges > -1 && vFilm > vBadges && vTitle > vFilm && vCta > vTitle, "C: the served section reads pills -> film -> headline -> CTA");
  assert(vSec.includes("The Swag Shop") && vSec.includes("📸 Hype Frame"), "C: the served label row carries both pills");
  assert(!vSec.includes("hft201-pitch") && !vSec.includes("hft201-facts") && !vSec.includes("hf-example-hoodie-back.jpg") && !vSec.includes("hf-example-lineup.jpg") && !vSec.includes("Drop 001") && !vSec.includes("Coming soon"), "C: the served section is slim — no pitch, no facts, no example thumbnails, no Drop 001 / Coming soon");
  assert(!served.includes("$110"), "C: the served homepage carries no $110 anywhere");
  assert(served.includes('src="app.js?v=206"') && served.includes('href="styles.css?v=203"'), "C: the served homepage carries the Round 204 pins — →206: app.js now v206 (Round 205); styles now v203 (Round 205)");
} finally { s.child.kill(); }

console.log("\nALL R204 CHECKS PASSED");
