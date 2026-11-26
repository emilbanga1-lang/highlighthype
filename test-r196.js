// Round 196 test: the feed's extra-wide blur fill (Emil
// approved the mock 2026-11-25 — a clip WIDER than 16:9,
// like Juliana's 960×444, gets a blown-up blurred copy of
// the SAME video filling the whole slide behind the sharp
// one; every other shape renders exactly as Round 191 left
// it). Run: node test-r196.js
// Boots the server twice on scratch DATA_DIRs:
//   A. Defaults — checks the v199 pins, the served R196
//      wiring (feedIsWide196 / feedWireFill196 /
//      feedAddFill196 / feedFillPlay196 / the
//      HH_NO_FEEDFILL196 flag read), the .feed196-fill
//      styles, and that feedMediaHtml189's markup carries
//      NO fill (the fill is built lazily, only when a wide
//      shape is proven — rendered slides start byte-
//      identical to Round 194).
//   B. HH_NO_FEEDFILL196=1 — the served page carries
//      window.HH_NO_FEEDFILL196 BEFORE app.js and the board
//      API behaves exactly as today.
// The feed's client logic is then driven in a vm slice of
// the served app.js (the house pattern) with stub slides
// whose videos report real dimensions:
//   World 1 (board feed, observer present) — five plays:
//   960×444 (wide), 1920×1080 (16:9), 720×1280 (portrait),
//   2560×1080 (wide), 1280×720 (16:9). After metadata, fill
//   elements exist ONLY on the two wide slides; each fill
//   shares its main video's src, is marked data-feed-fill,
//   starts muted, and is inserted ahead of the media block.
//   The settled wide slide's fill plays with it and
//   play_open still counts exactly once; settling away
//   pauses it; the warm window stands a far fill down
//   (preload metadata + paused) and warms a near one
//   (preload auto); the sound toggle unmutes the mains
//   and NEVER the fills; a mid-swipe early start starts
//   the incoming wide slide's fill too.
//   World 2 (kill switch) — window.HH_NO_FEEDFILL196 set:
//   no fill is ever built, wide slides behave exactly as
//   in Round 191.
//   World 3 (battle feed, both plays wide) — battle slides
//   get NO fill: battles keep their Round 189 rendering.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r196-"));
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
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  return { tmp, child, base, j, getLog: () => log };
}

// ---- a stub feed world for the vm drives --------------------
// Five plays with REAL shapes: 21 wide (960x444), 22 exactly
// 16:9 (1920x1080), 23 portrait (720x1280), 24 wide
// (2560x1080), 25 exactly 16:9 (1280x720).
const SHAPES = { 21: [960, 444], 22: [1920, 1080], 23: [720, 1280], 24: [2560, 1080], 25: [1280, 720] };
function makeWorld(withIO, opts = {}) {
  const PLAYS = {};
  Object.keys(SHAPES).forEach((id) => {
    PLAYS[id] = { id: Number(id), title: "Play " + id, player_name: "Kid " + id, athlete_label: "Kid " + id, team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v" + id + ".mp4", stream_url: "/uploads/v" + id + "-stream.mp4", poster_url: "/uploads/poster-" + id + ".jpg", voteCount: 0, hasVoted: false };
  });
  const calls = { track: [], vote: [], detail: [] };
  const store = new Map();
  const created = []; // every video the world makes, fills included
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
        if (a === "data-feed-battle") return opts.battle ? "1" : null;
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
    innerHTML: "", clientHeight: 800, scrollTop: 0,
    addEventListener: () => {},
    querySelectorAll: (sel) => {
      if (sel.includes("data-feed-slide")) return sel.includes("data-feed-end") ? [...slides, endSlide] : slides;
      if (sel === "video") return allVideos();
      return [];
    },
    querySelector: () => null,
  };
  const wrapEl = { hidden: true };
  const world = { PLAYS, calls, mains, slides, trackEl, wrapEl, created, io: null, store };
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
    Image: FakeImage,
    btl: { cur: { L: 21, R: 24 } },
    console,
  };
  if (withIO) sandbox.IntersectionObserver = FakeIO;
  sandbox.window.toggleVote = sandbox.toggleVote;
  sandbox.window.sharePlay = sandbox.sharePlay;
  sandbox.window.openPlayDetail = sandbox.openPlayDetail;
  world.sandbox = sandbox;
  world.ctx = vm.createContext(sandbox);
  world.run = (code) => vm.runInContext(code, world.ctx);
  world.opensFor = (id) => calls.track.filter(([k, i]) => k === "play_open" && i === id).length;
  // Report a play's real dimensions through its main video,
  // the way a browser fires loadedmetadata.
  world.fireMeta = (id) => { const v = mains[id]; v.videoWidth = SHAPES[id][0]; v.videoHeight = SHAPES[id][1]; v._fire("loadedmetadata"); };
  return world;
}

try {
  // ---------- Boot A: defaults ----------
  const s = await boot(3519, {});
  let appJs = "";
  try {
    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=209"') && home.includes('href="styles.css?v=205"'), "A: asset pins — app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.includes("feedIsWide196") && block.includes("feedWireFill196") && block.includes("feedAddFill196") && block.includes("feedFillPlay196"), "A: app.js wires the wide test, the fill wiring, the builder and the sync-play");
    assert(block.includes("HH_NO_FEEDFILL196"), "A: app.js reads the HH_NO_FEEDFILL196 kill-switch flag");
    assert(block.includes("feedMainVideo196") && block.includes("feedFillVideo196"), "A: the lifecycle picks the MAIN video by name (a fill never takes the settle/warm/early paths)");
    const mediaFn = block.slice(block.indexOf("function feedMediaHtml189"), block.indexOf("function feedHypeRail189"));
    assert(!mediaFn.includes("feed196-fill"), "A: feedMediaHtml189 renders NO fill markup — slides start byte-identical to Round 194; the fill is built only when a wide shape is proven");
    const css = await (await fetch(s.base + "/styles.css")).text();
    assert(css.includes(".feed196-fill") && css.includes("blur(26px)") && css.includes("object-fit:cover"), "A: styles.css carries the fill (cover, blurred, blown up)");
    assert(css.includes("pointer-events:none"), "A: the fill is pure scenery — pointer-events none");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- Boot B: kill switch ----------
  {
    const s2 = await boot(3520, { HH_NO_FEEDFILL196: "1" });
    try {
      const home = await (await fetch(s2.base + "/")).text();
      const flagAt = home.indexOf("window.HH_NO_FEEDFILL196=true");
      assert(flagAt > -1 && flagAt < home.indexOf('src="app.js'), "B: HH_NO_FEEDFILL196=1 stamps window.HH_NO_FEEDFILL196 into the page BEFORE app.js");
      const board = await s2.j("/api/highlights?division=all");
      assert(board.status === 200 && Array.isArray(board.body.highlights), "B: the board API behaves exactly as today under HH_NO_FEEDFILL196=1");
    } finally { s2.child.kill(); fs.rmSync(s2.tmp, { recursive: true, force: true }); }
  }

  const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
  assert(block.length > 2000, "VM: R189 block located in the served app.js");

  // ---------- World 1: board feed, five shapes ----------
  {
    const w = makeWorld(true);
    vm.runInContext(block, w.ctx);
    const run = w.run, M = w.mains, S = w.slides;

    // The pure shape test, straight.
    assert(run("feedIsWide196(960, 444)") === true, "W1: 960x444 (Juliana's shape) is wider than 16:9");
    assert(run("feedIsWide196(2560, 1080)") === true, "W1: 2560x1080 is wider than 16:9");
    assert(run("feedIsWide196(1920, 1080)") === false, "W1: 1920x1080 is exactly 16:9 — NOT wide");
    assert(run("feedIsWide196(1280, 720)") === false, "W1: 1280x720 is exactly 16:9 — NOT wide");
    assert(run("feedIsWide196(720, 1280)") === false, "W1: portrait is not wide");
    assert(run("feedIsWide196(0, 0)") === false && run("feedIsWide196(100, 0)") === false, "W1: unknown dimensions are never wide");

    const opened = run("window.openFeed189([21, 22, 23, 24, 25], 21, null)");
    assert(opened === true && w.wrapEl.hidden === false, "W1: the feed opens at the wide play");
    assert(S.every((s) => !s._fill), "W1: no fill exists before any dimensions are known");

    [21, 22, 23, 24, 25].forEach((id) => w.fireMeta(id));
    assert(!!S[0]._fill && !!S[3]._fill, "W1: fills are built on the two wider-than-16:9 slides (960x444, 2560x1080)");
    assert(!S[1]._fill && !S[2]._fill && !S[4]._fill, "W1: NO fill on the 16:9 slides or the portrait slide — they render exactly as before");
    const fill = S[0]._fill;
    assert(fill.getAttribute("data-feed-fill") === "1" && fill.className === "feed196-fill", "W1: the fill is marked (data-feed-fill + .feed196-fill)");
    assert(fill.getAttribute("src") === M[21].getAttribute("src"), "W1: the fill shares the main video's source (the R192 rendition)");
    assert(fill.muted === true, "W1: the fill starts muted");
    assert(S[0].classList.contains("feed196-hasfill"), "W1: the wide slide wears .feed196-hasfill");

    // The settled slide: fill plays with the main, and the
    // view still counts exactly once.
    assert(M[21].paused === false && fill.paused === false && fill.playCalls >= 1, "W1: the settled wide slide's fill plays alongside its main video");
    assert(w.opensFor(21) === 1, "W1: play_open counted exactly once for the wide play — the fill never double-counts");

    // Warm window: slide 24 (index 3) is outside ±2 of index
    // 0 — its fill stands down; slide 21's neighborhood is
    // warm.
    assert(S[3]._fill.preload === "metadata" && S[3]._fill.paused === true, "W1: a fill outside the ±2 warm window stands down (preload metadata, paused)");
    run("feedActivate189(2)");
    assert(S[3]._fill.preload === "auto", "W1: settling within ±2 warms the wide neighbor's fill (preload auto)");
    assert(M[21].paused === true && S[0]._fill.paused === true, "W1: settling away pauses the previous slide's main AND fill");

    // Settle onto the second wide slide: its fill plays.
    run("feedActivate189(3)");
    assert(M[24].paused === false && S[3]._fill.paused === false, "W1: settling on the second wide slide plays its fill with it");
    assert(w.opensFor(24) === 1, "W1: the second wide play also counts exactly once");

    // Sound: the toggle unmutes the mains, never the fills.
    run("window.feedToggleSound194()");
    assert(M[21].muted === false && M[24].muted === false, "W1: sound ON unmutes the main videos");
    assert(S[0]._fill.muted === true && S[3]._fill.muted === true, "W1: sound ON never unmutes a fill — the backdrop stays silent");
    run("window.feedToggleSound194()");
    assert(M[24].muted === true && S[3]._fill.muted === true, "W1: sound OFF re-mutes mains and fills alike");

    // Mid-swipe early start: the incoming wide slide's fill
    // starts with its main.
    run("feedActivate189(0)");
    const f24 = S[3]._fill, playsBefore = f24.playCalls;
    w.io.fire(S[3]);
    assert(M[24].playCalls >= 1 && f24.playCalls > playsBefore && f24.paused === false, "W1: an early start mid-swipe starts the incoming wide slide's fill too");
    assert(w.opensFor(24) === 1, "W1: the early start still never counts a view — only the settle does");
  }

  // ---------- World 2: kill switch ----------
  {
    const w = makeWorld(true);
    vm.runInContext(block, w.ctx);
    const run = w.run, S = w.slides;
    w.sandbox.window.HH_NO_FEEDFILL196 = true;
    const opened = run("window.openFeed189([21, 22, 23, 24, 25], 21, null)");
    assert(opened === true, "W2: the feed still opens under HH_NO_FEEDFILL196");
    [21, 24].forEach((id) => w.fireMeta(id));
    assert(S.every((s) => !s._fill), "W2: kill switch — no fill is EVER built, even for 960x444");
    assert(w.mains[21].paused === false, "W2: the wide play itself plays exactly as in Round 191");
    delete w.sandbox.window.HH_NO_FEEDFILL196;
  }

  // ---------- World 3: battle feed — wide plays, no fill ----------
  {
    const w = makeWorld(true, { battle: true });
    vm.runInContext(block, w.ctx);
    const run = w.run, S = w.slides;
    run("window.openBattleFeed189()");
    assert(run("feed189.kind") === "battle", "W3: the battle feed opens");
    [21, 24].forEach((id) => w.fireMeta(id));
    assert(S.every((s) => !s._fill), "W3: battle slides get NO fill even when both plays are wider than 16:9 — battles keep their Round 189 rendering");
  }

  console.log("\nR196 extra-wide feed fill: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
