// Round 217 test: tap-to-play latency (Emil, 2026-11-26 —
// "When you click a video there is a slight delay before it
// plays", on the This Month leaderboard). Run: node test-r217.js
// What this suite pins down:
//   A. Pins: app.js v215 / styles v210 (styles unchanged).
//   B. Served wiring: the R217 block rides the served app.js —
//      the pointerdown warm (initTapWarm217), the board warm
//      (tapWarmBoard217) hooked into renderAll behind a typeof
//      guard, the entry-slide head start inside openFeed189
//      (entry video load() + feedWarm193(seq.start) in the
//      tap's own task, before the rAF activation), and Up-next
//      rows carrying data-tile-id so a press on them warms too.
//   C. The R193 discipline is untouched: feed videos still
//      RENDER at preload="metadata" (warming is a runtime
//      upgrade, never markup) and feedWarm193 still no-ops
//      while the feed is closed (checked in the vm below).
//   D. VM drives of the served feed+R217 slice (stub world in
//      the Round 193 pattern, with an instrumented document):
//      - a pointerdown on a board row warms THAT play's
//        rendition (playSrc192 source) at preload="auto" with
//        load() called — before any click/open runs; a press
//        on a photo play or off-tile warms nothing; a press
//        inside the feed warms nothing.
//      - tapWarmSrc217 is pure: rendition when present, master
//        URL otherwise, "" for photo/embed plays.
//      - openPlay189: at the moment the open call RETURNS
//        (the rAF activation still queued), the entry slide's
//        video is already preload="auto" with load() called
//        and its ±2 neighborhood is warm; after the rAF the
//        entry plays and exactly one play_open is counted —
//        the feed's order and behavior are unchanged.
//      - tapWarmBoard217 warms the first 3 VIDEO plays of the
//        Month board at metadata level only (a photo play in
//        the first rows does not consume a slot, the 4th video
//        play stays cold), and a later pointerdown upgrades
//        a board-warmed source to "auto".
//      - the pool is capped: warming many sources keeps at
//        most TAP_WARM_MAX217 elements, oldest evicted first.
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
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r217-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip.mp4")]);
const CLIP = fs.readFileSync(path.join(fixDir, "clip.mp4"));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r217-"));
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
    const boundary = "----r217boundary";
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
// Round 193's world, plus: the document records its listeners
// (so the suite can fire the R217 pointerdown) and mints pool
// videos through createElement; rows/hosts model the boards.
function makeWorld(boardIds) {
  const BOARD = boardIds || [11, 12, 13, 14, 15];
  const PLAYS = {};
  [11, 12, 13, 14, 15].forEach((id, i) => {
    PLAYS[id] = { id, title: "Play " + id, player_name: "Kid " + id, athlete_label: "Kid " + id, team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v" + id + ".mp4", stream_url: "/uploads/v" + id + ".s192.mp4", poster_url: "/uploads/poster-" + id + ".jpg", voteCount: i, hasVoted: false };
  });
  PLAYS[16] = { id: 16, title: "Photo play", player_name: "Kid 16", athlete_label: "Kid 16", team: "", sport: "baseball", media_kind: "file", mime: "image/jpeg", media_url: "/uploads/p16.jpg", poster_url: "", voteCount: 0, hasVoted: false };
  const calls = { track: [], detail: [] };
  const docListeners = {};
  const poolVideos = [];
  const mkPoolVideo = () => {
    const v = { preload: "", src: "", muted: false, playsInline: false, loadCalls: 0, pauseCalls: 0, _removed: false,
      load() { this.loadCalls++; }, pause() { this.pauseCalls++; }, removeAttribute(n) { if (n === "src") this._removed = true; } };
    poolVideos.push(v);
    return v;
  };
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
      _video: v, dataset: {},
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
  // Board rows + host, in the world's board order.
  const rows = {};
  BOARD.forEach((id) => {
    const row = {
      _id: id,
      getAttribute: (a) => (a === "data-tile-id" ? String(id) : null),
      closest(sel) {
        if (sel === "[data-tile-id]") return row;
        if (sel.includes("#allBoard") || sel.includes("#monthRows")) return monthHost;
        if (sel.includes("#feed189")) return null;
        return null;
      },
    };
    rows[id] = row;
  });
  const monthHost = {
    querySelectorAll: (sel) => (sel === "[data-tile-id]" ? BOARD.map((id) => rows[id]) : []),
  };
  const feedRow = {
    getAttribute: (a) => (a === "data-tile-id" ? "13" : null),
    closest(sel) { if (sel === "[data-tile-id]") return feedRow; if (sel.includes("#feed189")) return feedRow; return null; },
  };
  const rafQueue = [];
  const world = { PLAYS, calls, videos, slides, trackEl, wrapEl, rows, feedRow, poolVideos, rafQueue, io: null };
  class FakeIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); world.io = this; }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    fire(target) { this.cb([{ target, isIntersecting: true, intersectionRatio: 0.6 }], this); }
  }
  const sandbox = {
    window: {},
    document: {
      getElementById: () => null,
      addEventListener: (type, fn) => { (docListeners[type] = docListeners[type] || []).push(fn); },
      createElement: (tag) => (tag === "video" ? mkPoolVideo() : {}),
      querySelector: (sel) => (sel === "#monthRows" ? monthHost : null),
      body: { classList: { add: () => {}, remove: () => {} } },
    },
    $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
    $$: () => [],
    esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
    cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
    findPlay: (id) => PLAYS[id] || null,
    playHasVideo: (h) => h.media_kind === "link_video" || (h.media_kind === "file" && !(h.mime || "").startsWith("image/")),
    posterUrlFor134: (h) => h.poster_url || "",
    trackEvent: (kind, id) => calls.track.push([kind, id]),
    toggleVote: async () => {},
    sharePlay: () => {},
    openPlayDetail: (id) => { calls.detail.push(id); },
    switchView: () => {},
    setMonthSub: () => {},
    pauseMediaIn158: () => {},
    featPause163: () => {},
    requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
    btl: { cur: { L: 11, R: 12 } },
    IntersectionObserver: FakeIO,
    console,
  };
  sandbox.window.toggleVote = sandbox.toggleVote;
  sandbox.window.sharePlay = sandbox.sharePlay;
  sandbox.window.openPlayDetail = sandbox.openPlayDetail;
  sandbox.rows = rows;
  world.sandbox = sandbox;
  world.ctx = vm.createContext(sandbox);
  world.run = (code) => vm.runInContext(code, world.ctx);
  world.firePointerdown = (target) => { (docListeners.pointerdown || []).forEach((fn) => fn({ target })); };
  world.flushRaf = () => { const q = rafQueue.splice(0); q.forEach((fn) => fn()); };
  world.opensFor = (id) => calls.track.filter(([k, i]) => k === "play_open" && i === id).length;
  return world;
}

try {
  // ---------- Boot A: defaults, served wiring ----------
  const s = await boot(3531, {});
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
    assert(home.includes('src="app.js?v=234"') && home.includes('href="styles.css?v=225"'), "A: asset pins — app.js now v215 (Round 217); styles keeps v210 (unchanged this round) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238)");
    appJs = await (await fetch(s.base + "/app.js")).text();

    const block217 = appJs.slice(appJs.indexOf("/* ---------------- Round 217"));
    assert(block217.length > 1500, "B: the Round 217 block rides the served app.js");
    assert(block217.includes("initTapWarm217") && block217.includes('"pointerdown"'), "B: the pointerdown warm is wired (capture-phase listener)");
    assert(block217.includes("tapWarmBoard217") && block217.includes("TAP_WARM_BOARD_N217 = 3") && block217.includes('"metadata"'), "B: the board warm is capped at 3 and metadata-level");
    assert(block217.includes("TAP_WARM_MAX217 = 6"), "B: the warm pool is capped at 6 elements");
    const renderAllFn = appJs.slice(appJs.indexOf("function renderAll()"), appJs.indexOf("function renderAll2"));
    assert(renderAllFn.includes('typeof tapWarmBoard217 === "function") tapWarmBoard217()'), "B: renderAll calls the board warm behind the house typeof guard");
    const openFeedFn = appJs.slice(appJs.indexOf("window.openFeed189"), appJs.indexOf("window.openPlay189"));
    assert(openFeedFn.includes("entryV217") && openFeedFn.includes("feedWarm193(seq.start)") && openFeedFn.indexOf("feedWarm193(seq.start)") < openFeedFn.indexOf("const jump"), "B: openFeed189 warms the entry neighborhood + load()s the entry video BEFORE the rAF activation");
    assert(appJs.includes('class="upnext-row" data-tile-id="${p.id}"'), "B: Up-next rows carry data-tile-id — a press on them warms the next play too");
    const mediaFn = appJs.slice(appJs.indexOf("function feedMediaHtml189"), appJs.indexOf("function feedHypeRail189"));
    assert(mediaFn.includes('preload="metadata"') && !mediaFn.includes('preload="auto"'), "C: feed videos still RENDER at preload=\"metadata\" — the R193 discipline stands (warming is runtime, never markup)");
    const warmFn = appJs.slice(appJs.indexOf("function feedWarm193"), appJs.indexOf("function feedObserve193"));
    assert(warmFn.includes("if (!feed189.open) return;"), "C: feedWarm193 still no-ops while the feed is closed — the feed's own slides never warm behind the boards");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
  assert(block.length > 2000, "VM: the R189+ slice (feed through Round 217) is located in the served app.js");

  // ---------- D1: tapWarmSrc217 purity ----------
  {
    const w = makeWorld();
    w.run(block);
    assert(w.run("tapWarmSrc217(findPlay(13))") === "/uploads/v13.s192.mp4", "D1: a play with a rendition warms the RENDITION source");
    w.PLAYS[13].stream_url = "";
    assert(w.run("tapWarmSrc217(findPlay(13))") === "/uploads/v13.mp4", "D1: no rendition yet — the warm falls back to the same master URL the player would load");
    assert(w.run("tapWarmSrc217(findPlay(16))") === "", "D1: a photo play warms nothing");
    assert(w.run('tapWarmSrc217({ id: 99, media_kind: "link_embed", embed_url: "https://x" })') === "", "D1: an embed warms nothing");
    assert(w.run('tapWarmSrc217({ id: 98, media_kind: "link_video", media_url: "https://cdn.example/x.mp4" })') === "https://cdn.example/x.mp4", "D1: a direct link video warms its URL");
  }

  // ---------- D2: pointerdown warms before the click ----------
  {
    const w = makeWorld([16, 11, 12, 13, 14]);
    w.run(block);
    w.firePointerdown(w.rows[13]);
    assert(w.poolVideos.length === 1 && w.poolVideos[0].src === "/uploads/v13.s192.mp4", "D2: a press on play 13's row creates exactly one pool warmer, for its rendition");
    assert(w.poolVideos[0].preload === "auto" && w.poolVideos[0].loadCalls >= 1, "D2: the press warms at preload=\"auto\" with load() called — the fetch starts during the press, before any click");
    w.firePointerdown(w.rows[13]);
    assert(w.poolVideos.length === 1, "D2: a second press on the same play reuses the pooled warmer (keyed by src)");
    w.firePointerdown(w.rows[16]);
    assert(w.poolVideos.length === 1, "D2: a press on the photo play warms nothing");
    w.firePointerdown({ closest: () => null });
    assert(w.poolVideos.length === 1, "D2: a press off any tile warms nothing");
    w.firePointerdown(w.feedRow);
    assert(w.poolVideos.length === 1, "D2: a press inside the feed never warms (the feed's own machinery owns playback there)");
  }

  // ---------- D3: the open — entry fetching before the rAF ----------
  {
    const w = makeWorld();
    w.run(block);
    w.run("window.openPlay189(13, rows[13])");
    const V = w.videos; // slides are plays 11..15 in board order; 13 is index 2
    assert(w.run("feed189.open") === true, "D3: the feed opened on the tapped play");
    assert(JSON.stringify(w.run("feed189.ids")) === JSON.stringify([11, 12, 13, 14, 15]), "D3: the feed's sequence is the board's rendered order, untouched");
    assert(V[2].preload === "auto" && V[2].loadCalls >= 1, "D3: at open-call return (activation still queued) the ENTRY video is already preload=\"auto\" with load() called — its fetch started in the tap's task");
    assert(V[1].preload === "auto" && V[1].loadCalls >= 1 && V[3].preload === "auto" && V[3].loadCalls >= 1, "D3: the entry's neighbors are warm before the first frame too");
    assert(V[2].playCalls === 0 && w.opensFor(13) === 0, "D3: nothing has played or counted yet — activation is still the rAF's job, exactly as before");
    w.flushRaf();
    assert(V[2].playCalls === 1 && V[2].paused === false, "D3: the rAF activation plays the (already fetching) entry video");
    assert(w.opensFor(13) === 1, "D3: exactly one play_open is counted for the entry");
    assert(V.filter((v) => !v.paused).length === 1, "D3: exactly one video is playing after the settle — the swipe machinery is unregressed");
  }

  // ---------- D4: the board warm ----------
  {
    const w = makeWorld([16, 11, 12, 13, 14]);
    w.run(block);
    w.run("tapWarmBoard217()");
    const srcs = w.poolVideos.map((v) => v.src);
    assert(srcs.length === 3, "D4: the board warm creates exactly 3 warmers (the cap)");
    assert(srcs.includes("/uploads/v11.s192.mp4") && srcs.includes("/uploads/v12.s192.mp4") && srcs.includes("/uploads/v13.s192.mp4"), "D4: the first three VIDEO plays warm — the leading photo play does not consume a slot");
    assert(!srcs.includes("/uploads/v14.s192.mp4"), "D4: the 4th video play stays cold");
    assert(w.poolVideos.every((v) => v.preload === "metadata" && v.loadCalls >= 1), "D4: board warmers fetch at metadata level only — no data blowup behind the board");
    w.run("tapWarmBoard217()");
    assert(w.poolVideos.length === 3, "D4: a re-render re-warms nothing (the pool is keyed by src)");
    w.firePointerdown(w.rows[11]);
    const v11 = w.poolVideos.find((v) => v.src === "/uploads/v11.s192.mp4");
    assert(v11 && v11.preload === "auto", "D4: a press on a board-warmed play upgrades its warm to \"auto\" in place");
  }

  // ---------- D5: the pool cap ----------
  {
    const w = makeWorld();
    w.run(block);
    for (let i = 0; i < 9; i++) w.run(`tapWarmFetch217("/uploads/x${i}.mp4", "auto")`);
    assert(w.run("tapWarm217.pool.size") <= 6, "D5: the pool never exceeds TAP_WARM_MAX217 elements");
    assert(w.run('tapWarm217.pool.has("/uploads/x0.mp4")') === false && w.run('tapWarm217.pool.has("/uploads/x8.mp4")') === true, "D5: eviction is oldest-first — the earliest warms leave, the latest stay");
  }

  console.log("\nALL R217 CHECKS PASSED");
} catch (e) {
  console.error(e && e.stack || e);
  process.exit(1);
}
