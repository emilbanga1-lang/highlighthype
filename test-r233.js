// Round 233 test: Emil (2026-11-27) — "when not on WiFi the
// site takes a long time to load." Parent measured the live
// homepage at ~42 MB of eager weight: hero-film.mp4 6,964,246 B
// autoplaying + all 14 board tiles autoplaying their stream
// renditions at once (~32.1 MB) + ~2.9 MB of posters + ~355 KB
// of text assets. Emil chose "do both":
//
// 1. BOARD TILES ON-SCREEN ONLY — fameThumbHtml gains an
//    opts.gate233 form (threaded from tileHtml, the board grid's
//    tile): no src, no poster, no autoplay — both URLs ride in
//    data-src233 / data-poster233 at preload="none".
//    bindTileGate233 (called from renderAll2 after every board
//    render) observes the gated videos with ONE shared
//    IntersectionObserver (rootMargin 400px): approaching tiles
//    get poster + src and play; departed tiles pause and unload
//    back to their poster. Re-renders disconnect the old
//    observer first — no stacking, no stranded players. No
//    IntersectionObserver → every tile loads immediately
//    (today's behavior). The rest133 form, the up-next rail,
//    the detail/watch player, the feed, Battles and the studio
//    are untouched.
// 2. LIGHTER HERO ON CELLULAR — public/hero-film-lite.mp4
//    (1,759,358 B; H.264 1280x720 ~368 kbps + AAC 64 kbps;
//    32.08 s, faststart; audio KEPT — the hero's sound is
//    user-audible via the Round 125 preference and the Sound
//    button, so the drop-audio condition never held). The hero
//    <video> carries data-src (full) + data-src-lite and no
//    src; heroConnClass233 / heroFilmUrl233 / heroHeld233 pick
//    before any hero byte moves: connection API — saveData or
//    2g/slow-2g → "tap" (nothing fetched, poster + #heroPlay233;
//    a tap loads the LITE film through the Round 125 start),
//    3g → lite autoplay, 4g → full autoplay; no API (iOS
//    Safari) — viewport ≤820px → lite, larger → full. All three
//    hero start paths (controller, showHome, studio-exit
//    resume) route through the pick and respect the hold.
//    — →239: 3g and the no-API phone fallback now start on
//    the new "mobile" mid tier (hero-film-mobile.mp4, ~1.17
//    Mbps) instead of lite, and a fallback start self-
//    upgrades to the full film once playback runs smoothly
//    (Round 239; test-r239.js). The tap class is unchanged.
//
// Pins: app.js v229 / styles v221. — →234: app.js now v230
// (Round 234); styles keeps v221 (unchanged this round).
// Run: node test-r233.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins + the lite asset ----
assert(home.includes('href="styles.css?v=229"') && home.includes('src="app.js?v=241"'), "A: asset pins — app.js v229 / styles v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
const fullSize = fs.statSync(path.join(ROOT, "public/hero-film.mp4")).size;
const liteSize = fs.statSync(path.join(ROOT, "public/hero-film-lite.mp4")).size;
assert(fullSize === 6964246, "A: the full hero film is untouched (6,964,246 B)");
assert(liteSize > 1400000 && liteSize < 1900000, "A: hero-film-lite.mp4 is in the 1.5–1.8 MB target band (actual " + liteSize + " B)");

// ---- B. statics ----
// B1: the gated tile form.
const fameFn = appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("/* Round 134: one Hall of Fame row"));
assert(fameFn.includes("opts.gate233") && fameFn.includes('data-src233="${src233}"') && fameFn.includes('data-poster233="${esc(poster233)}"'), "B1: fameThumbHtml's gate233 form holds the video + poster URLs in data attributes");
assert(fameFn.includes('preload="none" class="tile-vid233"'), "B1: the gated form renders preload=\"none\" — no fetch state at render");
const gatedLine = fameFn.split("\n").find((l) => l.includes("tile-vid233"));
assert(gatedLine && !gatedLine.includes("autoplay") && !gatedLine.includes(" src="), "B1: the gated template line carries no src and no autoplay");
assert(fameFn.includes('opts.rest133 ? "" : " autoplay"') && fameFn.includes('preload="metadata"></video>'), "B1: the legacy form is intact — rest133 rests, every other legacy caller still autoplays at preload=\"metadata\"");
const tileFn = appJs.slice(appJs.indexOf("function tileHtml("), appJs.indexOf("/* Vote hardening"));
assert(tileFn.includes("Object.assign({}, opts, { gate233: true })"), "B1: tileHtml threads gate233 into fameThumbHtml (board grid tiles only)");
const renderAll2Fn = appJs.slice(appJs.indexOf("function renderAll2()"), appJs.indexOf("function renderPlayDetail"));
assert(renderAll2Fn.includes("bindTileGate233()") && !renderAll2Fn.includes("bindTileGate233(b233)"), "B1: renderAll2 binds the gate after every board render — →234: the bind is DOCUMENT-WIDE (bindTileGate233() with no root), not scoped to #allBoard: a scoped bind makes coverage depend on the container a renderer used, so any gated tile outside #allBoard would sit unobserved forever (Round 234)");
// B2: the gate machinery.
assert(appJs.includes("function bindTileGate233(") && appJs.includes("function tileGateLoad233(") && appJs.includes("function tileGateUnload233("), "B2: the gate machinery exists (bind / load / unload)");
assert(appJs.includes('rootMargin: "400px 0px 400px 0px"') && appJs.includes('querySelectorAll("video[data-src233]:not(.vfill)")'), "B2: one shared observer, 400px rootMargin, .vfill clones never observed");
assert(appJs.includes("tileGateObs233.disconnect()"), "B2: re-binding disconnects the previous observer (no stacking, no stranded players)");
// B3: the hero pick.
const heroTag = home.slice(home.indexOf('<video id="heroVideo"'), home.indexOf(">", home.indexOf('<video id="heroVideo"')) + 1);
assert(heroTag.includes('data-src="/hero-film.mp4"') && heroTag.includes('data-src-lite="/hero-film-lite.mp4"') && heroTag.includes('data-src-mobile="/hero-film-mobile.mp4"') && !heroTag.includes(" src="), "B3: the hero carries both film URLs in data attributes and NO src — nothing is fetched before the pick — →239: a third URL rides along (data-src-mobile, the mid tier)");
assert(home.includes('id="heroPlay233"') && home.includes('class="hero-play233" id="heroPlay233" hidden'), "B3: the tap-to-play button ships hidden in the hero");
assert(appJs.includes("function heroConnClass233(") && appJs.includes("function heroFilmUrl233(") && appJs.includes("function heroHeld233("), "B3: the pick functions exist (class / url / held)");
assert(appJs.includes('const held233 = (typeof heroHeld233 === "function") && heroHeld233(v);') && appJs.includes('$("#heroPlay233")'), "B3: the hero controller computes the hold and wires #heroPlay233");
assert(appJs.includes("heroHeld233(hv)") && appJs.includes("heroHeld233(hv214)"), "B3: showHome and the studio-exit resume both respect the hold");
assert(!appJs.includes("hv.src = hv.dataset.src") && !appJs.includes("hv214.src = hv214.dataset.src"), "B3: no hero start path assigns the full film directly anymore — all route through the pick");
assert(css.includes(".hero-play233{") && css.includes(".hero-play233[hidden]{display:none}"), "B3: the tap-to-play button is styled, and [hidden] really hides it");

// ---- C. VM drives: the tile templates ----
const line = (anchor) => { const i = appJs.indexOf(anchor); return appJs.slice(i, appJs.indexOf("\n", i)); };
const helpers = [
  line("const esc ="), line("const cap ="), line("const CROWN227 ="),
  appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("/* Round 134: one Hall of Fame row")),
].join("\n");
const sbC = { console };
sbC.window = sbC;
vm.createContext(sbC);
vm.runInContext(helpers, sbC);
const runC = (code) => vm.runInContext(code, sbC);
const playVid = { id: 901, media_kind: "file", mime: "video/mp4", media_url: "/uploads/x901.mp4", poster_url: "/uploads/poster-901.jpg", sport: "football", title: "T" };
sbC.__p = playVid;
const gated = runC("fameThumbHtml(__p, { gate233: true })");
assert(gated.includes('data-src233="/uploads/x901.mp4"') && gated.includes('data-poster233="/uploads/poster-901.jpg"'), "C: the gated tile carries its video + poster URLs in data attributes");
assert(!gated.includes(" src=") && !gated.includes("autoplay") && !gated.includes('poster="'), "C: the gated tile renders with NO src, NO poster attribute, NO autoplay — zero fetch state");
const legacy = runC("fameThumbHtml(__p, {})");
assert(legacy.includes('src="/uploads/x901.mp4"') && legacy.includes("autoplay") && legacy.includes('preload="metadata"'), "C: the legacy form (up-next rail and friends) is byte-for-byte the old behavior");
const rest = runC("fameThumbHtml(__p, { rest133: true })");
assert(rest.includes('src="/uploads/x901.mp4"') && !rest.includes("autoplay"), "C: the rest133 form still rests on its poster with a src and no autoplay");
const both = runC("fameThumbHtml(__p, { gate233: true, rest133: true })");
assert(!both.includes("data-src233") && both.includes('src="/uploads/x901.mp4"'), "C: rest133 wins over gate233 — a resting tile is never gated");
const imgPlay = runC("fameThumbHtml({ media_kind: 'file', mime: 'image/jpeg', media_url: '/uploads/pic.jpg' }, { gate233: true })");
assert(imgPlay.startsWith("<img"), "C: image plays still render their photo, gate or not");

// ---- D. VM drives: the gate machinery ----
function mkVid233(url, poster, isFill) {
  const v = {
    attrs: {}, plays: 0, pauses: 0, loads: 0, preload: "", parentElement: null,
    classList: { contains: (c) => c === "vfill" && !!isFill, add() {}, remove() {} },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, val) { this.attrs[k] = String(val); },
    removeAttribute(k) { delete this.attrs[k]; },
    play() { this.plays++; return { catch() {} }; },
    pause() { this.pauses++; },
    load() { this.loads++; },
  };
  if (url) v.setAttribute("data-src233", url);
  if (poster) v.setAttribute("data-poster233", poster);
  return v;
}
function ioWorld(withIO) {
  const instances = [];
  class IOStub {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observed = new Set(); this.disconnects = 0; instances.push(this); }
    observe(el) { this.observed.add(el); }
    unobserve(el) { this.observed.delete(el); }
    disconnect() { this.disconnects++; this.observed.clear(); }
    fire(el, isIntersecting) { this.cb([{ target: el, isIntersecting }], this); }
  }
  const sb = { console };
  if (withIO) sb.IntersectionObserver = IOStub;
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(helpers, sb);
  return { sb, instances };
}
{
  const { sb, instances } = ioWorld(true);
  const run = (code) => vm.runInContext(code, sb);
  const v1 = mkVid233("/uploads/a.mp4", "/uploads/pa.jpg");
  const v2 = mkVid233("/uploads/b.mp4", "/uploads/pb.jpg");
  const fill = mkVid233(null, null, true); fill.setAttribute("src", "/uploads/a.mp4");
  v1.parentElement = { querySelectorAll: () => [fill] };
  const root = { querySelectorAll: () => [v1, v2] };
  sb.__root = root;
  run("bindTileGate233(__root)");
  assert(instances.length === 1 && instances[0].observed.size === 2, "D: one observer binds both gated tiles");
  assert(String(instances[0].opts.rootMargin).includes("400px"), "D: the observer pre-loads 400px out");
  assert(!v1.getAttribute("src") && v1.plays === 0 && !v2.getAttribute("src"), "D: at bind, tiles hold no src and have not played — no video bytes off-screen");
  instances[0].fire(v1, true);
  assert(v1.getAttribute("src") === "/uploads/a.mp4" && v1.getAttribute("poster") === "/uploads/pa.jpg" && v1.plays === 1, "D: approaching assigns poster + src and plays");
  instances[0].fire(v1, false);
  assert(v1.pauses >= 1 && !v1.getAttribute("src") && !fill.getAttribute("src"), "D: leaving pauses and unloads the tile AND its .vfill clone — back to the poster, connection freed");
  instances[0].fire(v1, true);
  assert(v1.getAttribute("src") === "/uploads/a.mp4" && v1.plays === 2, "D: re-approaching reloads and plays again");
  run("bindTileGate233(__root)");
  assert(instances.length === 2 && instances[0].disconnects === 1 && instances[1].observed.size === 2, "D: a re-render disconnects the old observer and binds a fresh one — no duplicates, no leaks");
  const fillTile = mkVid233("/uploads/c.mp4", "/uploads/pc.jpg", true);
  instances[1].fire(fillTile, true);
  assert(!fillTile.getAttribute("src") && fillTile.plays === 0, "D: a .vfill clone is never gate-loaded even if it reaches the callback");
}
{
  const { sb } = ioWorld(false);
  const run = (code) => vm.runInContext(code, sb);
  const v1 = mkVid233("/uploads/a.mp4", "/uploads/pa.jpg");
  sb.__root = { querySelectorAll: () => [v1] };
  run("bindTileGate233(__root)");
  assert(v1.getAttribute("src") === "/uploads/a.mp4" && v1.plays === 1, "D: with no IntersectionObserver the gate degrades to today — tiles load immediately");
}

// ---- E. VM drives: the hero pick matrix ----
const heroCode = appJs.slice(appJs.indexOf("function heroConnClass233"), appJs.indexOf("function heroMusicWanted125"));
function heroWorld(conn, innerWidth) {
  const sb = { console, window: { innerWidth }, document: { documentElement: { clientWidth: innerWidth } } };
  if (conn !== undefined) sb.navigator = { connection: conn };
  vm.createContext(sb);
  vm.runInContext(heroCode, sb);
  return sb;
}
const heroEl = () => ({ dataset: { src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4" } });
{
  let sb = heroWorld({ effectiveType: "4g" }, 1440); let el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "full" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film.mp4" && vm.runInContext("heroHeld233(__el)", sb) === false, "E: 4g → the full film, autoplay (no hold)");
  sb = heroWorld({ effectiveType: "3g" }, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "mobile" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film-mobile.mp4" && vm.runInContext("heroHeld233(__el)", sb) === false, "E: 3g → the lite film, autoplay (no hold) — →239: 3g → the MOBILE mid tier, autoplay (no hold), no self-upgrade (reported connection)");
  sb = heroWorld({ effectiveType: "2g" }, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "tap" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film-lite.mp4" && vm.runInContext("heroHeld233(__el)", sb) === true, "E: 2g → held on the poster; the tap would load the LITE film");
  el.dataset.hh233started = "1";
  assert(vm.runInContext("heroHeld233(__el)", sb) === false, "E: after the tap the hold lifts");
  sb = heroWorld({ effectiveType: "slow-2g" }, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "tap", "E: slow-2g → tap");
  sb = heroWorld({ effectiveType: "4g", saveData: true }, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "tap", "E: saveData beats 4g → tap");
  sb = heroWorld(undefined, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "mobile", "E: no connection API (iOS Safari), phone viewport → lite — →239: → the MOBILE mid tier (the lite pick was the blur), with the self-upgrade armed");
  sb = heroWorld(undefined, 1440);
  assert(vm.runInContext("heroConnClass233()", sb) === "full", "E: no connection API, desktop viewport → full");
  sb = heroWorld({ effectiveType: "4g" }, 1440); el = heroEl(); sb.__el = el;
  vm.runInContext("heroFilmUrl233(__el)", sb);
  sb.navigator.connection = { effectiveType: "3g" };
  assert(vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film.mp4" && el.dataset.hh233cls === "full", "E: the pick memoizes on the element — every restart path agrees on one film");
}

console.log("test-r233: all checks passed");
