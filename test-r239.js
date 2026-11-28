// Round 239 test: Emil (2026-11-27) — "The hero video is
// blurry now." Root cause: Round 233's connection pick falls
// back to viewport width when the Network Information API is
// absent, and iOS Safari has no such API at all — so EVERY
// iPhone was served hero-film-lite.mp4 (video ~368 kbps)
// even on fast WiFi. The full film's video runs ~1.62 Mbps;
// the lite encode is visibly soft at hero size.
//
// The fix, in three parts:
// 1. NEW MID TIER — public/hero-film-mobile.mp4: 1280x720,
//    H.264 video ~1.17 Mbps (CRF 24, maxrate 1150k) + AAC
//    64 kbps exactly as the lite encode handled audio,
//    faststart, 32.08 s — 4,957,910 B next to lite's
//    1,759,358 B and the full film's 6,964,246 B. The hero
//    <video> gains data-src-mobile; the lite file stays the
//    bottom tier (the tap class still loads it on tap).
// 2. SELECTION — saveData or 2g/slow-2g → "tap" (unchanged);
//    3g → "mobile" (was lite); 4g / unrecognized → "full"
//    (unchanged); NO connection info → phone viewport
//    "mobile" (was lite), larger viewport "full" (unchanged).
//    The pick records hh239noconn on the dataset when the
//    class came from the no-API fallback.
// 3. AUTO-UPGRADE — heroArmUpgrade239 arms only a fallback-
//    started mobile hero: six accumulated seconds of smooth
//    playback (timeupdate deltas, never paused, >= 1.5 s
//    buffered ahead) trigger a detached preload of the full
//    film seeked to the hero's position; the swap switches
//    src, restores currentTime on loadedmetadata and
//    replays, and on 'playing' the dataset memo moves to
//    the full film. A waiting/stalled before the swap lands
//    cancels for the page view; a mid-swap error falls back
//    to the mid tier at the same position. Reported
//    connections and saveData never upgrade.
//
// Pins: app.js v235 / styles v225 (styles unchanged this
// round — the fix is JS + one data attribute + one asset).
// — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round)
// Run: node test-r239.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins + the mobile asset (ffprobe) ----
assert(home.includes('src="app.js?v=240"') && home.includes('href="styles.css?v=228"'), "A: asset pins — app.js v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");
const heroTag = home.slice(home.indexOf('<video id="heroVideo"'), home.indexOf(">", home.indexOf('<video id="heroVideo"')) + 1);
assert(heroTag.includes('data-src="/hero-film.mp4"') && heroTag.includes('data-src-lite="/hero-film-lite.mp4"') && heroTag.includes('data-src-mobile="/hero-film-mobile.mp4"') && !heroTag.includes(" src="), "A: the hero carries all three film URLs in data attributes and NO src — nothing is fetched before the pick");
const probe = (f) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration,size,bit_rate", "-show_entries", "stream=codec_type,codec_name,width,height,bit_rate", "-of", "json", path.join(ROOT, "public", f)], { encoding: "utf8" }));
const pFull = probe("hero-film.mp4"), pLite = probe("hero-film-lite.mp4"), pMob = probe("hero-film-mobile.mp4");
const vRate = (p) => Number(p.streams.find((s) => s.codec_type === "video").bit_rate);
const aRate = (p) => { const a = p.streams.find((s) => s.codec_type === "audio"); return a ? Number(a.bit_rate) : 0; };
const vStream = (p) => p.streams.find((s) => s.codec_type === "video");
assert(fs.statSync(path.join(ROOT, "public/hero-film.mp4")).size === 6964246 && fs.statSync(path.join(ROOT, "public/hero-film-lite.mp4")).size === 1759358, "A: the full and lite films are untouched (6,964,246 B / 1,759,358 B)");
assert(vStream(pMob).width === 1280 && vStream(pMob).height === 720 && vStream(pMob).codec_name === "h264", "A: hero-film-mobile.mp4 is H.264 1280x720, same frame as the other tiers");
assert(vRate(pMob) >= 1000000 && vRate(pMob) <= 1300000, "A: mobile video bitrate is in the ~1.0–1.2 Mbps target band (actual " + vRate(pMob) + " bps)");
assert(vRate(pMob) > vRate(pLite) * 2.5 && vRate(pMob) < vRate(pFull), "A: mobile video bitrate sits between the tiers — >2.5x lite's " + vRate(pLite) + ", under full's " + vRate(pFull));
assert(aRate(pMob) > 0 && Math.abs(aRate(pMob) - aRate(pLite)) < 3000, "A: audio is KEPT and handled exactly as the lite encode handled it (AAC ~64 kbps; mobile " + aRate(pMob) + " vs lite " + aRate(pLite) + ")");
assert(Math.abs(Number(pMob.format.duration) - Number(pFull.format.duration)) < 0.5, "A: mobile duration matches the full film (" + pMob.format.duration + "s vs " + pFull.format.duration + "s)");
const mobSize = fs.statSync(path.join(ROOT, "public/hero-film-mobile.mp4")).size;
assert(mobSize > 1759358 && mobSize < 6964246, "A: mobile size is a sane mid tier (actual " + mobSize + " B, between lite and full)");
{
  const head = Buffer.alloc(300000);
  const fd = fs.openSync(path.join(ROOT, "public/hero-film-mobile.mp4"), "r");
  fs.readSync(fd, head, 0, head.length, 0); fs.closeSync(fd);
  assert(head.indexOf("moov") > 0 && head.indexOf("moov") < head.indexOf("mdat"), "A: mobile is faststart (moov before mdat) — playback starts before the file lands");
}

// ---- B. statics ----
assert(appJs.includes("function heroConnInfo239(") && appJs.includes("function heroUpgradeEligible239(") && appJs.includes("function heroArmUpgrade239("), "B: the Round 239 machinery exists (connection read / eligibility / arm)");
const classFn = appJs.slice(appJs.indexOf("function heroConnClass233"), appJs.indexOf("function heroConnInfo239"));
assert(classFn.includes('if (et === "3g") return "mobile"') && classFn.includes('? "mobile" : "full"'), "B: the class pick — reported 3g and the no-API phone fallback both land on \"mobile\"");
assert(classFn.includes('if (conn.saveData) return "tap"') && classFn.includes('et === "2g" || et === "slow-2g"') && classFn.includes('return "full"'), "B: the rest of the matrix stands — saveData/2g/slow-2g → tap, 4g/unrecognized → full");
const urlFn = appJs.slice(appJs.indexOf("function heroFilmUrl233"), appJs.indexOf("function heroHeld233"));
assert(urlFn.includes('d.srcMobile') && urlFn.includes('"/hero-film-mobile.mp4"') && urlFn.includes("hh239noconn"), "B: heroFilmUrl233 resolves the mobile tier from data-src-mobile and records whether the pick had connection info");
assert((appJs.match(/heroArmUpgrade239\(v\)/g) || []).length >= 2, "B: the hero controller arms the upgrade on the standing start AND on a bfcache pageshow restore");
assert(appJs.includes("function bindTileGate233(") && appJs.includes('rootMargin: "400px 0px 400px 0px"'), "B: Round 233/234 board-tile gating is untouched");
assert(css.includes(".hero-play233{"), "B: hero styles stand (no CSS change this round)");

// ---- C. VM drives: the selection matrix ----
const heroCode = appJs.slice(appJs.indexOf("function heroConnClass233"), appJs.indexOf("function heroMusicWanted125"));
function heroWorld(conn, innerWidth) {
  const sb = { console, window: { innerWidth }, document: { documentElement: { clientWidth: innerWidth } } };
  if (conn !== undefined) sb.navigator = conn === null ? {} : { connection: conn };
  vm.createContext(sb);
  vm.runInContext(heroCode, sb);
  return sb;
}
const heroEl = () => ({ dataset: { src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" } });
{
  let sb = heroWorld({ effectiveType: "4g" }, 1440); let el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "full" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film.mp4", "C: 4g → the full film (unchanged)");
  sb = heroWorld({ effectiveType: "3g" }, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "mobile" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film-mobile.mp4" && vm.runInContext("heroHeld233(__el)", sb) === false, "C: 3g → the MOBILE mid tier, autoplay (no hold)");
  assert(el.dataset.hh239noconn === "" && vm.runInContext("heroUpgradeEligible239(__el)", sb) === false, "C: a reported 3g records that connection info existed — never upgrade-eligible");
  sb = heroWorld({ effectiveType: "2g" }, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "tap" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film-lite.mp4" && vm.runInContext("heroHeld233(__el)", sb) === true, "C: 2g → held on the poster; the tap still loads the LITE film (bottom tier unchanged)");
  sb = heroWorld({ effectiveType: "slow-2g" }, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "tap", "C: slow-2g → tap (unchanged)");
  sb = heroWorld({ effectiveType: "4g", saveData: true }, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "tap", "C: saveData beats 4g → tap (unchanged)");
  sb = heroWorld(undefined, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "mobile" && vm.runInContext("heroFilmUrl233(__el)", sb) === "/hero-film-mobile.mp4", "C: no connection API (iOS Safari), phone viewport → the MOBILE mid tier (was lite — the blur)");
  assert(el.dataset.hh239noconn === "1" && vm.runInContext("heroUpgradeEligible239(__el)", sb) === true, "C: the fallback pick records hh239noconn — this is the one upgrade-eligible start");
  sb = heroWorld(null, 390); el = heroEl(); sb.__el = el;
  assert(vm.runInContext("heroConnClass233()", sb) === "mobile" && vm.runInContext("heroUpgradeEligible239(__el)", sb) === true, "C: a navigator with no .connection is the same no-info case → mobile + eligible");
  sb = heroWorld(undefined, 1440);
  assert(vm.runInContext("heroConnClass233()", sb) === "full", "C: no connection API, desktop viewport → full (unchanged)");
  sb = heroWorld({ effectiveType: "5g" }, 390);
  assert(vm.runInContext("heroConnClass233()", sb) === "full", "C: an unrecognized effectiveType → full (unchanged)");
}

// ---- D. VM drives: the upgrade state machine ----
function mkVid239(dataset) {
  const listeners = {};
  const v = {
    dataset: dataset || {}, attrs: {}, src: "", currentTime: 0, duration: 32.083, paused: false, ended: false,
    muted: true, readyState: 4, plays: 0, loads: 0,
    buffered: { length: 1, start: () => 0, end: () => 40 },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    removeEventListener(ev, fn) { const a = listeners[ev] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
    fire(ev) { (listeners[ev] || []).slice().forEach((fn) => fn()); },
    listenerCount(ev) { return (listeners[ev] || []).length; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, val) { this.attrs[k] = String(val); },
    removeAttribute(k) { delete this.attrs[k]; },
    play() { this.plays++; this.paused = false; return { catch() {} }; },
    pause() { this.paused = true; },
    load() { this.loads++; },
  };
  return v;
}
function upgradeWorld(conn) {
  const created = [];
  const sb = {
    console, window: { innerWidth: 390 },
    document: {
      documentElement: { clientWidth: 390 },
      createElement: (tag) => { const el = mkVid239({}); el.tagName = tag; created.push(el); return el; },
    },
  };
  if (conn !== undefined) sb.navigator = conn === null ? {} : { connection: conn };
  vm.createContext(sb);
  vm.runInContext(heroCode, sb);
  return { sb, created };
}
const tick239 = (v, n, step) => { for (let i = 0; i < n; i++) { v.currentTime += (step || 0.25); v.fire("timeupdate"); } };
{
  // Happy path: fallback start, smooth playback, invisible swap.
  const { sb, created } = upgradeWorld(undefined);
  const run = (code) => vm.runInContext(code, sb);
  const el = mkVid239({ src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" });
  sb.__el = el;
  el.src = run("heroFilmUrl233(__el)");
  assert(el.src === "/hero-film-mobile.mp4", "D: the fallback hero starts on the mobile tier");
  assert(run("heroArmUpgrade239(__el)") === true && el.dataset.hh239armed === "1", "D: the upgrade arms on a fallback mobile start");
  assert(run("heroArmUpgrade239(__el)") === false, "D: arming twice is a no-op");
  tick239(el, 10);
  assert(created.length === 0, "D: 2.5 smooth seconds in — no preload yet (the window is 6s)");
  tick239(el, 18);
  assert(created.length === 1 && created[0].src === "/hero-film.mp4", "D: after 6+ smooth seconds the full film preloads in a detached element");
  const pre = created[0];
  pre.fire("canplay");
  assert(pre.currentTime === el.currentTime, "D: the preloader is seeked to the hero's position, so its buffer covers the swap point");
  pre.fire("seeked");
  assert(el.src === "/hero-film.mp4", "D: the swap switches the hero's src to the full film");
  const atSwap = 28 * 0.25;
  el.currentTime = 0; /* the browser resets position on a src change — the restore must undo this */
  el.fire("loadedmetadata");
  assert(Math.abs(el.currentTime - atSwap) < 0.001 && el.plays >= 1, "D: loadedmetadata restores the exact playback position and replays — no restart from 0");
  el.fire("playing");
  assert(el.dataset.hh239done === "1" && el.dataset.hh233cls === "full" && run("heroFilmUrl233(__el)") === "/hero-film.mp4", "D: on playing, the upgrade is done and the memoized pick moves to the full film for every restart path");
  assert(el.muted === true, "D: muted state rode through the swap untouched");
  assert(el.listenerCount("timeupdate") === 0 && el.listenerCount("waiting") === 0, "D: the state machine cleans its listeners up after the swap");
}
{
  // A stall before the swap cancels the upgrade for the page view.
  const { sb, created } = upgradeWorld(undefined);
  const run = (code) => vm.runInContext(code, sb);
  const el = mkVid239({ src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" });
  sb.__el = el;
  el.src = run("heroFilmUrl233(__el)");
  assert(run("heroArmUpgrade239(__el)") === true, "D: stall case — the upgrade arms");
  tick239(el, 8);
  el.fire("waiting");
  assert(el.dataset.hh239dead === "1", "D: a waiting event before the swap cancels the upgrade");
  tick239(el, 40);
  assert(created.length === 0 && el.src === "/hero-film-mobile.mp4", "D: after a stall, no preload ever starts and the hero stays on the mobile tier");
  assert(run("heroArmUpgrade239(__el)") === false, "D: a cancelled upgrade never re-arms this page view");
}
{
  // Starved buffer and paused playback never accumulate smooth time.
  const { sb, created } = upgradeWorld(undefined);
  const run = (code) => vm.runInContext(code, sb);
  const el = mkVid239({ src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" });
  sb.__el = el;
  el.src = run("heroFilmUrl233(__el)");
  run("heroArmUpgrade239(__el)");
  el.buffered = { length: 1, start: () => 0, end: () => el.currentTime + 0.5 };
  tick239(el, 40);
  assert(created.length === 0, "D: with under 1.5s buffered ahead, smooth time never accumulates — no upgrade on a struggling connection");
  el.buffered = { length: 1, start: () => 0, end: () => 40 };
  el.paused = true;
  tick239(el, 40);
  assert(created.length === 0, "D: paused playback does not accumulate smooth time either");
  el.paused = false;
  tick239(el, 28);
  assert(created.length === 1, "D: once playback is genuinely smooth again, the upgrade proceeds");
}
{
  // Reported connections never arm, even on the mobile tier.
  const { sb, created } = upgradeWorld({ effectiveType: "3g" });
  const run = (code) => vm.runInContext(code, sb);
  const el = mkVid239({ src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" });
  sb.__el = el;
  el.src = run("heroFilmUrl233(__el)");
  assert(el.src === "/hero-film-mobile.mp4" && run("heroArmUpgrade239(__el)") === false, "D: a reported-3g mobile start never arms the upgrade");
  tick239(el, 40);
  assert(created.length === 0 && el.src === "/hero-film-mobile.mp4", "D: the reported pick stands for the whole page view");
}
{
  // A mid-swap error falls back to the mobile tier at the same position.
  const { sb, created } = upgradeWorld(undefined);
  const run = (code) => vm.runInContext(code, sb);
  const el = mkVid239({ src: "/hero-film.mp4", srcLite: "/hero-film-lite.mp4", srcMobile: "/hero-film-mobile.mp4" });
  sb.__el = el;
  el.src = run("heroFilmUrl233(__el)");
  run("heroArmUpgrade239(__el)");
  tick239(el, 28);
  const pre = created[0];
  pre.fire("canplay"); pre.fire("seeked");
  assert(el.src === "/hero-film.mp4", "D: error case — the swap began");
  el.fire("error");
  assert(el.src === "/hero-film-mobile.mp4" && el.dataset.hh239dead === "1", "D: a mid-swap error falls back to the mobile tier and retires the upgrade");
  el.currentTime = 0;
  el.fire("loadedmetadata");
  assert(Math.abs(el.currentTime - 28 * 0.25) < 0.001, "D: the fallback restores the same playback position");
}

console.log("test-r239: all checks passed");
