// Round 198 test: the feed settle guarantee + the swipe
// hint's stacking pin (Emil, on his iPhone hours after Round
// 196 shipped: swipes could come to rest BETWEEN slides —
// two plays on screen at once — and "the swipe icon is
// gone"). Run: node test-r198.js
// What this suite pins down:
//   A. Served pins: app.js v200 / styles v199 (Round 198 set
//      both to v199; Round 199 changed app.js only), the
//      settle corrector is wired into the
//      served app.js (feedSettle198 / feedSettleSoon198, fed
//      from feedOnScroll189, gated on feed198.touching), and
//      the CSS contracts the fix leans on are intact:
//      the track keeps scroll-snap-type:y mandatory, slides
//      keep height:100% + snap-align/stop, the Round 196
//      fill keeps position:absolute + pointer-events:none
//      and gains z-index:0, and the swipe hint's Round 191
//      override carries z-index:6 — above the fill, so the
//      hint can never be painted under the scenery.
//   B. A vm world (the house pattern, stub slides with real
//      shapes, a track stub whose listeners are RECORDED so
//      touch state is fireable, and real timers so the
//      corrector actually runs):
//      - the hint markup renders on the start slide of the
//        first open and is consumed for the session (the
//        Round 191 once-per-session behavior, intact);
//      - the Round 196 fill still builds on the wide slide
//        and NOT on the portrait slide (regression guard);
//      - an off-boundary rest (0.37 of a slide past the
//        active boundary, either direction) is pulled back
//        onto the ACTIVE slide's boundary once scrolling
//        stops — and play_open still counts exactly once,
//        for the settled play only (the corrector never
//        picks a slide, counts, or pauses);
//      - while a finger is down (touchstart fired) the
//        corrector does NOT move the track; on touchend it
//        re-arms and the rest is repaired;
//      - closing the feed clears the corrector's timer.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r198-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log };
}

// ---- a stub feed world for the vm drives (adapted from
// test-r196's world: same five real shapes, but the track
// records its listeners and the sandbox carries real timers
// so the Round 198 corrector runs for real) ----
const SHAPES = { 21: [960, 444], 22: [1920, 1080], 23: [720, 1280], 24: [2560, 1080], 25: [1280, 720] };
function makeWorld() {
  const PLAYS = {};
  Object.keys(SHAPES).forEach((id) => {
    PLAYS[id] = { id: Number(id), title: "Play " + id, player_name: "Kid " + id, athlete_label: "Kid " + id, team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v" + id + ".mp4", stream_url: "/uploads/v" + id + "-stream.mp4", poster_url: "/uploads/poster-" + id + ".jpg", voteCount: 0, hasVoted: false };
  });
  const calls = { track: [], vote: [], detail: [] };
  const store = new Map();
  const created = [];
  const mkVideo = (id) => {
    const handlers = {};
    const v = {
      _id: id, preload: "metadata", muted: true, paused: true, currentTime: 0,
      playCalls: 0, pauseCalls: 0, loadCalls: 0, className: "", dataset: {}, style: {},
      attrs: {}, videoWidth: 0, videoHeight: 0,
      addEventListener: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); },
      _fire: (ev) => { (handlers[ev] || []).forEach((fn) => fn()); },
    };
    v.getAttribute = (k) => (k in v.attrs ? v.attrs[k] : null);
    v.setAttribute = (k, val) => { v.attrs[k] = String(val); };
    v.play = () => { v.playCalls++; v.paused = false; return Promise.resolve(); };
    v.pause = () => { v.pauseCalls++; v.paused = true; };
    v.load = () => { v.loadCalls++; };
    if (id) { v.attrs.src = "/uploads/v" + id + "-stream.mp4"; v.attrs.poster = "/uploads/poster-" + id + ".jpg"; v.src = v.attrs.src; }
    created.push(v);
    return v;
  };
  const mains = {}, slides = [];
  Object.keys(SHAPES).forEach((id) => {
    const v = mkVideo(Number(id));
    mains[id] = v;
    const mediaEl = { _media: true };
    const slide = {
      _main: v, _fill: null, _mediaEl: mediaEl, dataset: {},
      classList: { _set: new Set(), toggle: () => {}, add: function (c) { this._set.add(c); }, contains: function (c) { return this._set.has(c); } },
      getAttribute: (a) => {
        if (a === "data-feed-kind") return "video";
        if (a === "data-feed-battle") return null;
        return null;
      },
      querySelector: (sel) => {
        if (sel.includes(".feed189-media")) return mediaEl;
        if (sel.includes("video")) return v;
        return null;
      },
      querySelectorAll: (sel) => {
        if (sel === "video") return slide._fill ? [slide._fill, v] : [v];
        return [];
      },
      insertBefore: (node, ref) => { if (ref === mediaEl) slide._fill = node; },
      appendChild: (node) => { slide._fill = node; },
    };
    slides.push(slide);
  });
  const endSlide = { dataset: {}, classList: { toggle: () => {}, add: () => {}, contains: () => false }, getAttribute: () => "", querySelector: () => null, querySelectorAll: () => [] };
  const allVideos = () => { const out = []; slides.forEach((s) => { if (s._fill) out.push(s._fill); out.push(s._main); }); return out; };
  const trackEl = {
    innerHTML: "", clientHeight: 800, scrollTop: 0, _handlers: {},
    addEventListener: (ev, fn) => { (trackEl._handlers[ev] = trackEl._handlers[ev] || []).push(fn); },
    querySelectorAll: (sel) => {
      if (sel.includes("data-feed-slide")) return sel.includes("data-feed-end") ? [...slides, endSlide] : slides;
      if (sel === "video") return allVideos();
      return [];
    },
    querySelector: () => null,
  };
  const wrapEl = { hidden: true };
  const world = { PLAYS, calls, mains, slides, trackEl, wrapEl, created, io: null, store };
  world.fireTrack = (ev) => { (trackEl._handlers[ev] || []).forEach((fn) => fn()); };
  class FakeIO {
    constructor(cb, o) { this.cb = cb; this.opts = o; this.targets = new Set(); world.io = this; }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    fire(target) { this.cb([{ target, isIntersecting: true, intersectionRatio: 0.6 }], this); }
  }
  class FakeImage {
    constructor() { this.naturalWidth = 0; this.naturalHeight = 0; world.lastImage = this; }
    set src(v) { this._src = v; }
    get src() { return this._src; }
  }
  const sandbox = {
    window: {},
    document: {
      getElementById: () => null, addEventListener: () => {},
      body: { classList: { add: () => {}, remove: () => {} } },
      createElement: (tag) => (tag === "video" ? mkVideo(0) : {}),
    },
    $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
    $$: () => [],
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
    findPlay: (id) => PLAYS[id] || null,
    playHasVideo: (h) => h.media_kind === "file" && !(h.mime || "").startsWith("image/"),
    posterUrlFor134: (h) => h.poster_url || "",
    trackEvent: (kind, id) => calls.track.push([kind, id]),
    toggleVote: async (id) => { calls.vote.push(id); },
    sharePlay: () => {},
    openPlayDetail: (id) => { calls.detail.push(id); },
    switchView: () => {},
    setMonthSub: () => {},
    pauseMediaIn158: () => {},
    featPause163: () => {},
    hhStorageGet: (k) => store.get(k) || "",
    hhStorageSet: (k, v) => { store.set(k, String(v)); },
    requestAnimationFrame: (fn) => { fn(); return 0; },
    setTimeout, clearTimeout,
    Image: FakeImage,
    IntersectionObserver: FakeIO,
    btl: { cur: { L: 21, R: 24 } },
    console,
  };
  sandbox.window.toggleVote = sandbox.toggleVote;
  sandbox.window.sharePlay = sandbox.sharePlay;
  sandbox.window.openPlayDetail = sandbox.openPlayDetail;
  world.sandbox = sandbox;
  world.ctx = vm.createContext(sandbox);
  world.run = (code) => vm.runInContext(code, world.ctx);
  world.opensFor = (id) => calls.track.filter(([k, i]) => k === "play_open" && i === id).length;
  world.fireMeta = (id) => { const v = mains[id]; v.videoWidth = SHAPES[id][0]; v.videoHeight = SHAPES[id][1]; v._fire("loadedmetadata"); };
  return world;
}

// Extract one CSS rule's body from served styles.css text.
function ruleBody(css, selector, fromIndex) {
  const at = css.indexOf(selector, fromIndex || 0);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return open < 0 || close < 0 ? "" : css.slice(open + 1, close);
}

try {
  // ---------- Boot A: defaults ----------
  const s = await boot(3521, {});
  let appJs = "";
  try {
    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=214"') && home.includes('href="styles.css?v=210"'), "A: asset pins — app.js + styles now v199 (Round 198 changed both) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215); styles now v210 (Round 215)");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.includes("function feedSettle198(") && block.includes("function feedSettleSoon198("), "A: app.js carries the settle corrector and its scheduler");
    const scrollFn = block.slice(block.indexOf("function feedOnScroll189"), block.indexOf("/* Round 198 (2026-11-26): the settle guarantee"));
    assert(scrollFn.includes("feedSettleSoon198()"), "A: feedOnScroll189 re-arms the corrector on every scroll event");
    assert(block.includes("feed198.touching") && block.includes('"touchstart"') && block.includes('"touchend"'), "A: the corrector is gated on touch state (touchstart/touchend wired)");
    const css = await (await fetch(s.base + "/styles.css")).text();
    const trackRule = ruleBody(css, ".feed189-track{");
    assert(trackRule.includes("scroll-snap-type:y mandatory") && trackRule.includes("overflow-y:auto"), "A: the track keeps mandatory vertical snap (the geometry contract the corrector backs up)");
    const slideRule = ruleBody(css, ".feed189-slide{");
    assert(slideRule.includes("height:100%") && slideRule.includes("scroll-snap-align:start") && slideRule.includes("scroll-snap-stop:always"), "A: slides keep exactly one track-height with snap-align start + snap-stop always");
    const fillRule = ruleBody(css, ".feed196-fill{");
    assert(fillRule.includes("position:absolute") && fillRule.includes("pointer-events:none"), "A: the fill stays out of flow and out of the gesture path (absolute, pointer-events none)");
    assert(fillRule.includes("z-index:0"), "A: the fill is pinned as the slide's explicit bottom layer (z-index 0)");
    const hintRule = ruleBody(css, ".feed189-hint{", css.indexOf("/* The swipe hint: its own space"));
    assert(hintRule.includes("z-index:6"), "A: the swipe hint's Round 191 override pins it at z-index 6");
    assert(6 > 0 && hintRule.includes("animation:feed191hintfade"), "A: hint stacking (6) sits above the fill (0) and the once-only fade is unchanged");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
  assert(block.length > 2000, "VM: R189 block located in the served app.js");

  // ---------- World 1: the hint renders once per session ----------
  {
    const w = makeWorld();
    vm.runInContext(block, w.ctx);
    const run = w.run;
    const opened = run("window.openFeed189([21, 22, 23, 24, 25], 23, null)");
    assert(opened === true, "W1: the feed opens at the portrait play");
    const html1 = w.trackEl.innerHTML;
    assert((html1.match(/data-feed-hint189/g) || []).length === 1 && html1.includes("↑ Swipe up for the next play"), "W1: the swipe hint renders exactly once, on the start slide of the first open");
    assert(run("feed191.hintSeen") === true, "W1: the hint is marked seen at render (Round 191's once-per-session rule)");
    run("window.closeFeed189()");
    run("window.openFeed189([21, 22, 23, 24, 25], 23, null)");
    assert(!w.trackEl.innerHTML.includes("data-feed-hint189"), "W1: a second open in the same session renders NO hint — Round 191 behavior intact");
    run("window.closeFeed189()");
  }

  // ---------- World 2: the settle corrector ----------
  {
    const w = makeWorld();
    vm.runInContext(block, w.ctx);
    const run = w.run, S = w.slides, T = w.trackEl;
    const opened = run("window.openFeed189([21, 22, 23, 24, 25], 23, null)");
    assert(opened === true && T.scrollTop === 1600 && run("feed189.index") === 2, "W2: the feed opens settled on slide 3 (index 2, scrollTop 1600)");
    assert(w.opensFor(23) === 1, "W2: the settled play counted exactly once at open");
    [21, 22, 23, 24, 25].forEach((id) => w.fireMeta(id));
    assert(!!S[0]._fill && !S[2]._fill, "W2: regression guard — the wide slide still grows its Round 196 fill; the portrait slide (Nicholas's shape) grows none");

    // Off-boundary rest, forward: 0.37 of a slide past the
    // active boundary. The scroll handler keeps index 2
    // (round(2.37) = 2); once scrolling stops, the rest is
    // pulled back onto slide 3's boundary.
    T.scrollTop = 1600 + 296;
    run("feedOnScroll189()");
    assert(run("feed189.index") === 2, "W2: a 0.37-past rest still belongs to the active slide (the handler's rounding chose it)");
    await wait(320);
    assert(T.scrollTop === 1600, "W2: the off-boundary rest is repaired onto the active slide's boundary once scrolling stops");
    assert(w.opensFor(23) === 1 && w.opensFor(24) === 0, "W2: the repair counted nothing — play_open still exactly once, for the settled play only");

    // Off-boundary rest, backward.
    T.scrollTop = 1600 - 300;
    run("feedOnScroll189()");
    await wait(320);
    assert(T.scrollTop === 1600 && run("feed189.index") === 2, "W2: a backward off-boundary rest is repaired the same way");

    // A clean boundary rest is a strict no-op.
    T.scrollTop = 1600;
    run("feedOnScroll189()");
    await wait(320);
    assert(T.scrollTop === 1600 && w.opensFor(23) === 1, "W2: an on-boundary rest is untouched (no movement, no recount)");

    // A held finger gates the corrector.
    w.fireTrack("touchstart");
    assert(run("feed198.touching") === true, "W2: touchstart marks the track as touched");
    T.scrollTop = 1600 + 296;
    run("feedOnScroll189()");
    await wait(320);
    assert(T.scrollTop === 1896, "W2: while a finger is down the corrector does NOT move the track");
    w.fireTrack("touchend");
    assert(run("feed198.touching") === false, "W2: touchend clears the gate");
    await wait(320);
    assert(T.scrollTop === 1600, "W2: after the finger lifts, the released rest is repaired once momentum dies");

    // Closing the feed disarms the corrector.
    T.scrollTop = 1600 + 296;
    run("feedOnScroll189()");
    run("window.closeFeed189()");
    assert(run("feed198.timer") === null, "W2: closing the feed clears the corrector's timer");
    await wait(320);
    assert(T.scrollTop === 1896, "W2: no correction runs after the feed has closed");
  }

  console.log("\nR198 feed settle guarantee + hint stacking: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
