// Round 193 test: feed swipe latency (Emil's "very slight
// delay" between videos, 2026-11-25). Run: node test-r193.js
// Boots the server twice on scratch DATA_DIRs:
//   A. Defaults — seeds one clip through the real upload
//      pipeline, approves it, and checks the v193 pin, the
//      served R193 wiring (feedWarm193 neighbor preloading,
//      feedObserve193 + IntersectionObserver at threshold
//      0.5), and that a feed video still RENDERS at
//      preload="metadata" (warming is an activation-time
//      upgrade, not a markup change).
//   B. HH_NO_FEED=1 — the kill switch still stands the feed
//      down exactly as in Round 189.
// The feed's client logic is then driven in a vm slice of the
// served app.js (the house pattern) with stub slides/videos:
//   World 1 (IntersectionObserver present) — opening the feed
//   warms start±1 and start±2 (preload upgraded + load()
//   called) and nothing beyond; the observer is rooted on the
//   track at threshold 0.5; firing it for the incoming slide
//   starts that slide's playback BEFORE the settle without
//   counting a view and without pausing the outgoing slide;
//   the settle (feedOnScroll189 → feedActivate189) then counts
//   exactly one play_open for the incoming play and leaves
//   exactly one video playing; moving activation stands the
//   far slides back down to preload="metadata" without ever
//   pausing the active one; closing disconnects the observer
//   and feedWarm193 is a no-op while the feed is closed.
//   World 2 (no IntersectionObserver) — the feed opens,
//   activates, warms and counts exactly as the pre-193 feed
//   did (plus warming), feed193.observer stays null, and the
//   kill switch still routes taps to the classic detail.
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

// ---- fixture: one tiny clip --------------------------------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r193-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip.mp4")]);
const CLIP = fs.readFileSync(path.join(fixDir, "clip.mp4"));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r193-"));
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
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r193boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, what, timeoutMs = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2000));
      await wait(1000);
    }
  };
  return { tmp, child, base, j, upload, waitFor, getLog: () => log };
}

// ---- a stub feed world for the vm drives --------------------
function makeWorld(withIO) {
  const PLAYS = {};
  [11, 12, 13, 14, 15].forEach((id, i) => {
    PLAYS[id] = { id, title: "Play " + id, player_name: "Kid " + id, athlete_label: "Kid " + id, team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v" + id + ".mp4", poster_url: "/uploads/poster-" + id + ".jpg", voteCount: i, hasVoted: false };
  });
  const calls = { track: [], vote: [], detail: [] };
  const videos = [], slides = [];
  const mkVideo = () => {
    const v = { preload: "metadata", paused: true, playCalls: 0, pauseCalls: 0, loadCalls: 0, addEventListener: () => {}, getAttribute: () => "" };
    v.play = () => { v.playCalls++; v.paused = false; return Promise.resolve(); };
    v.pause = () => { v.pauseCalls++; v.paused = true; };
    v.load = () => { v.loadCalls++; };
    return v;
  };
  [11, 12, 13, 14, 15].forEach((id) => {
    const v = mkVideo();
    videos.push(v);
    slides.push({
      _video: v,
      dataset: {},
      classList: { toggle: () => {}, contains: () => false },
      getAttribute: (a) => (a === "data-feed-kind" ? "video" : ""),
      querySelector: (sel) => (sel.includes("video") ? v : null),
    });
  });
  const endSlide = { dataset: {}, classList: { toggle: () => {}, contains: () => false }, getAttribute: () => "", querySelector: () => null };
  const trackEl = {
    innerHTML: "", clientHeight: 800, scrollTop: 0,
    addEventListener: () => {},
    querySelectorAll: (sel) => {
      if (sel.includes("data-feed-end")) return [...slides, endSlide];
      if (sel.includes("data-feed-slide")) return slides;
      if (sel === "video") return videos;
      return [];
    },
    querySelector: () => null,
  };
  const wrapEl = { hidden: true };
  const world = { PLAYS, calls, videos, slides, trackEl, wrapEl, io: null };
  class FakeIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); world.io = this; }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    fire(target) { this.cb([{ target, isIntersecting: true, intersectionRatio: 0.6 }], this); }
  }
  const sandbox = {
    window: {},
    document: { getElementById: () => null, addEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } } },
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
    requestAnimationFrame: (fn) => { fn(); return 0; },
    btl: { cur: { L: 11, R: 12 } },
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
  return world;
}

try {
  // ---------- Boot A: defaults ----------
  const s = await boot(3511, {});
  let appJs = "";
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const up = await s.upload({ ...F, playerName: "Nicholas B.", title: "Home Run" }, "clip.mp4", CLIP, "video/mp4");
    assert(up.status === 201, "A: a clip uploads (201)");
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const ap = await s.j(`/api/highlights/${up.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": claim.body.token }, body: JSON.stringify({ status: "approved" }) });
    assert(ap.body.status === "approved", "A: the play is approved");
    await s.waitFor(async () => { const r = await s.j("/api/highlights?division=all&sort=newest"); return r.body.highlights && r.body.highlights.length === 1 ? r.body : null; }, "A: the play is public");

    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=224"') && home.includes('href="styles.css?v=217"'), "A: asset pins — app.js v193 (Round 193), styles keeps v191 (unchanged this round) — →194: app.js + styles now v194 (Round 194) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227)");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.includes("feedWarm193") && block.includes('v.preload = "auto"') && block.includes("Math.abs(i - index) <= 2"), "A: app.js wires neighbor warming (±2, preload upgrade)");
    assert(block.includes("feedObserve193") && block.includes("IntersectionObserver") && block.includes("threshold: 0.5"), "A: app.js wires the mid-swipe early start (IntersectionObserver, threshold 0.5)");
    assert(block.includes("feed193.early"), "A: the early-start bookkeeping rides along (feed193.early)");
    const mediaFn = block.slice(block.indexOf("function feedMediaHtml189"), block.indexOf("function feedHypeRail189"));
    assert(mediaFn.includes('preload="metadata"'), "A: a feed video still RENDERS at preload=\"metadata\" — warming upgrades it at activation time, not in markup");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- Boot B: kill switch ----------
  {
    const s2 = await boot(3512, { HH_NO_FEED: "1" });
    try {
      const home = await (await fetch(s2.base + "/")).text();
      const flagAt = home.indexOf("window.HH_NO_FEED189=true");
      assert(flagAt > -1 && flagAt < home.indexOf('src="app.js'), "B: HH_NO_FEED=1 still stamps window.HH_NO_FEED189 into the page BEFORE app.js");
      const board = await s2.j("/api/highlights?division=all");
      assert(board.status === 200 && Array.isArray(board.body.highlights), "B: the board API behaves exactly as today under HH_NO_FEED=1");
    } finally { s2.child.kill(); fs.rmSync(s2.tmp, { recursive: true, force: true }); }
  }

  const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
  assert(block.length > 2000, "VM: R189 block located in the served app.js");

  // ---------- World 1: IntersectionObserver present ----------
  {
    const w = makeWorld(true);
    vm.runInContext(block, w.ctx);
    const run = w.run, V = w.videos;

    const opened = run("window.openFeed189([11, 12, 13, 14, 15], 11, null)");
    assert(opened === true && w.wrapEl.hidden === false, "W1: the feed opens at the tapped play");
    assert(V[0].playCalls === 1 && V[0].paused === false, "W1: the opening slide plays (the settle path, as before)");
    assert(V[1].preload === "auto" && V[1].loadCalls >= 1 && V[2].preload === "auto" && V[2].loadCalls >= 1, "W1: opening warms start+1 and start+2 (preload=\"auto\" + load() called)");
    assert(V[3].preload === "metadata" && V[3].loadCalls === 0 && V[4].preload === "metadata" && V[4].loadCalls === 0, "W1: warming is bounded — slides beyond ±2 stay at preload=\"metadata\" and are never load()ed");
    assert(w.io && w.io.opts && w.io.opts.threshold === 0.5 && w.io.opts.root === w.trackEl, "W1: the early-start observer is rooted on the feed track at threshold 0.5");
    assert(w.slides.every((sl) => w.io.targets.has(sl)), "W1: the observer watches every rendered slide");
    assert(w.opensFor(11) === 1, "W1: opening counts exactly one play_open (the tapped play)");

    // The observer ignores the slide that is already current.
    w.io.fire(w.slides[0]);
    assert(V[0].playCalls === 1, "W1: the observer does not re-play the current slide");

    // Mid-swipe: the incoming slide starts BEFORE the settle…
    w.io.fire(w.slides[1]);
    assert(V[1].playCalls === 1 && V[1].paused === false, "W1: the incoming slide starts playing as soon as it is mostly visible (early start)");
    assert(V[0].paused === false, "W1: the early path never pauses the outgoing slide — pausing stays with the settle");
    assert(w.opensFor(12) === 0, "W1: the early start does NOT count a view — counting stays with feedActivate189");

    // …and the settle makes it authoritative.
    w.trackEl.scrollTop = 800;
    run("feedOnScroll189()");
    assert(V[0].paused === true && V.slice(1).filter((v) => !v.paused).length === 1 && V[1].paused === false, "W1: after the settle exactly one video is playing — the settled slide");
    assert(w.opensFor(12) === 1, "W1: the settle counts exactly one play_open for the incoming play (no double count with the early start)");
    assert(V[3].preload === "auto" && V[3].loadCalls >= 1, "W1: the neighborhood follows activation — slide +2 from the new index warms");
    assert(V[4].preload === "metadata", "W1: the far slide (distance 3) stays stood down");

    // A long jump: far slides stand back down; warming never
    // pauses the active slide.
    run("feedActivate189(4)");
    assert(V[4].paused === false && V[1].paused === true, "W1: activation at the last slide plays it and pauses the previous one");
    assert(V[0].preload === "metadata" && V[1].preload === "metadata", "W1: slides that fall out of the neighborhood stand back down to preload=\"metadata\"");
    assert(V[2].preload === "auto" && V[3].preload === "auto" && V[4].preload === "auto", "W1: the new neighborhood (±2 of the last slide) is warm, the active slide included");

    // Close: the observer lets go, and warming stops with the
    // feed closed.
    run("window.closeFeed189()");
    assert(w.io.targets.size === 0, "W1: closing the feed disconnects the observer");
    const loadsBefore = V[2].loadCalls;
    run("feedWarm193(0)");
    assert(V[2].loadCalls === loadsBefore, "W1: feedWarm193 is a no-op while the feed is closed (no preloading behind the boards)");
  }

  // ---------- World 2: no IntersectionObserver ----------
  {
    const w = makeWorld(false);
    vm.runInContext(block, w.ctx);
    const run = w.run, V = w.videos;

    const opened = run("window.openFeed189([11, 12, 13, 14, 15], 13, null)");
    assert(opened === true && w.wrapEl.hidden === false, "W2: without IntersectionObserver the feed still opens at the tapped play");
    assert(run("feed193.observer") === null, "W2: no observer is created where IntersectionObserver is unavailable");
    assert(V[2].playCalls === 1 && w.opensFor(13) === 1, "W2: the opening slide plays and counts exactly once (the pre-193 settle behavior)");
    assert(V.every((v) => v.preload === "auto"), "W2: warming still applies around the start index (every slide here is within ±2)");
    run("feedActivate189(3)");
    assert(V[3].paused === false && V[2].paused === true && w.opensFor(14) === 1, "W2: activation still moves playback and counts exactly once per play");

    // Kill switch still stands the feed down.
    w.sandbox.window.HH_NO_FEED189 = true;
    run("window.closeFeed189()");
    assert(run("window.openFeed189([11, 12, 13, 14, 15], 11, null)") === false && w.wrapEl.hidden === true, "W2: HH_NO_FEED189 — the feed will not open");
    run("window.openPlay189(11, null)");
    assert(w.calls.detail.length === 1 && w.calls.detail[0] === 11, "W2: HH_NO_FEED189 — a board tap opens the classic detail, exactly as before");
    delete w.sandbox.window.HH_NO_FEED189;
  }

  console.log("\nR193 feed swipe latency: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
