// Round 194 test: the feed's sound toggle (Emil, swiping
// the feed, 2026-11-25: "I am not hearing anything play
// from the videos" — every feed video rendered muted and
// the feed offered no way to turn sound on). Run:
// node test-r194.js
// Boots the server twice on scratch DATA_DIRs:
//   A. Defaults — seeds one clip through the real upload
//      pipeline, approves it, and checks the v194 pins, the
//      served top bar (the speaker button #feedSound194
//      rides LEFT of the close button), the served R194
//      wiring (feedToggleSound194 / feedApplySound194 /
//      feedSyncSoundBtn194 / the hhFeedSound preference),
//      the .feed194-sound styles, and that a feed video
//      still RENDERS with the muted attribute (sound is a
//      runtime state, never a markup change).
//   B. HH_NO_FEED=1 — the kill switch still stands the feed
//      down exactly as in Round 189.
// The feed's client logic is then driven in a vm slice of
// the served app.js (the house pattern) with stub
// slides/videos, a stub sound button and a stub safe-store:
//   World 1 (fresh profile, IntersectionObserver present)
//   — the feed opens muted with the toggle in the off
//   state; tapping the toggle unmutes the active video IN
//   PLACE (no extra play/pause calls) and every neighbor
//   with it, and persists hhFeedSound=on; a later settle
//   and a later mid-swipe early start both produce videos
//   with muted=false; toggling off re-mutes everything at
//   once; close + reopen restores the saved choice and the
//   button state — both ways.
//   World 2 (saved preference ON, battle feed) — the
//   toggle starts in the on state (synced at init), the
//   feed opens with sound, and battle slides follow the
//   same sound state as board slides.
//   World 3 (no IntersectionObserver) — the toggle still
//   works through the settle path alone, and the kill
//   switch still routes taps to the classic detail.
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
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r194-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip.mp4")]);
const CLIP = fs.readFileSync(path.join(fixDir, "clip.mp4"));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r194-"));
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
    const boundary = "----r194boundary";
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
function makeWorld(withIO, seedStore) {
  const PLAYS = {};
  [11, 12, 13, 14, 15].forEach((id, i) => {
    PLAYS[id] = { id, title: "Play " + id, player_name: "Kid " + id, athlete_label: "Kid " + id, team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v" + id + ".mp4", poster_url: "/uploads/poster-" + id + ".jpg", voteCount: i, hasVoted: false };
  });
  const calls = { track: [], vote: [], detail: [] };
  const store = new Map(Object.entries(seedStore || {}));
  const videos = [], slides = [];
  const mkVideo = () => {
    /* A freshly rendered feed video carries the muted
       attribute, so its muted property starts true. */
    const v = { preload: "metadata", muted: true, paused: true, playCalls: 0, pauseCalls: 0, loadCalls: 0, addEventListener: () => {}, getAttribute: () => "" };
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
  /* The top-bar sound button: a real class set + attribute
     store, so the sync's class/aria flips are observable. */
  const btnClasses = new Set();
  const soundBtn = {
    attrs: { "aria-pressed": "false", "aria-label": "Turn sound on" },
    classList: {
      toggle: (name, force) => { if (force === undefined) { btnClasses.has(name) ? btnClasses.delete(name) : btnClasses.add(name); } else if (force) btnClasses.add(name); else btnClasses.delete(name); },
      contains: (name) => btnClasses.has(name),
      add: (name) => btnClasses.add(name),
      remove: (name) => btnClasses.delete(name),
    },
    setAttribute: (k, v) => { soundBtn.attrs[k] = String(v); },
    getAttribute: (k) => (k in soundBtn.attrs ? soundBtn.attrs[k] : null),
  };
  const world = { PLAYS, calls, videos, slides, trackEl, wrapEl, io: null, store, soundBtn, btnClasses };
  class FakeIO {
    constructor(cb, opts) { this.cb = cb; this.opts = opts; this.targets = new Set(); world.io = this; }
    observe(t) { this.targets.add(t); }
    unobserve(t) { this.targets.delete(t); }
    disconnect() { this.targets.clear(); }
    fire(target) { this.cb([{ target, isIntersecting: true, intersectionRatio: 0.6 }], this); }
  }
  const sandbox = {
    window: {},
    document: { getElementById: (id) => (id === "feedSound194" ? soundBtn : null), addEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } } },
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
  const s = await boot(3513, {});
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
    assert(home.includes('src="app.js?v=227"') && home.includes('href="styles.css?v=219"'), "A: asset pins — app.js + styles now v194 (Round 194 changed both) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round)");
    const header = home.slice(home.indexOf('id="feed189"'), home.indexOf('id="feedTrack189"'));
    assert(header.includes('id="feedSound194"') && header.includes('class="feed194-sound"'), "A: the feed top bar carries the sound toggle button");
    assert(header.indexOf('id="feedSound194"') < header.indexOf('id="feedClose189"'), "A: the sound toggle rides LEFT of the close button");
    assert(header.includes('aria-label="Turn sound on"') && header.includes('aria-pressed="false"') && header.includes('onclick="feedToggleSound194()"'), "A: the toggle renders in the OFF state (label + aria-pressed) wired to feedToggleSound194");
    assert(header.includes('class="ic-off"') && header.includes('class="ic-on"') && header.includes("<svg"), "A: the toggle's two states are inline SVGs (muted speaker / speaker with waves) — no emoji icon");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.includes("feedToggleSound194") && block.includes("feedApplySound194") && block.includes("feedSyncSoundBtn194"), "A: app.js wires the toggle, the per-video apply and the button sync");
    assert(block.includes('hhStorageGet("hhFeedSound")') && block.includes('hhStorageSet("hhFeedSound"'), "A: the sound choice persists through the app's safe storage (hhFeedSound)");
    const mediaFn = block.slice(block.indexOf("function feedMediaHtml189"), block.indexOf("function feedHypeRail189"));
    assert(mediaFn.includes("muted"), "A: a feed video still RENDERS muted — sound is a runtime state applied to the element, never a markup change");
    const css = await (await fetch(s.base + "/styles.css")).text();
    assert(css.includes(".feed194-sound") && css.includes(".feed194-sound.sound-on .ic-on"), "A: styles.css carries the toggle's chrome and the .sound-on icon swap");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- Boot B: kill switch ----------
  {
    const s2 = await boot(3514, { HH_NO_FEED: "1" });
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

  // ---------- World 1: fresh profile, observer present ----------
  {
    const w = makeWorld(true, null);
    vm.runInContext(block, w.ctx);
    const run = w.run, V = w.videos, B = w.soundBtn;

    const opened = run("window.openFeed189([11, 12, 13, 14, 15], 11, null)");
    assert(opened === true && w.wrapEl.hidden === false, "W1: the feed opens at the tapped play");
    assert(run("feed194.sound") === false, "W1: a fresh profile (no saved preference) defaults to sound OFF");
    assert(V.every((v) => v.muted === true), "W1: every feed video starts muted");
    assert(!w.btnClasses.has("sound-on") && B.attrs["aria-pressed"] === "false" && B.attrs["aria-label"] === "Turn sound on", "W1: the toggle renders its off state (no .sound-on, aria-pressed false, label offers to turn sound on)");
    assert(w.store.get("hhFeedSound") === undefined, "W1: merely opening the feed writes no preference — only a toggle does");

    // The toggle: unmute everything, the playing one in place.
    const playsBefore = V[0].playCalls, pausesBefore = V[0].pauseCalls;
    run("window.feedToggleSound194()");
    assert(run("feed194.sound") === true, "W1: the toggle turns the sound state on");
    assert(V.every((v) => v.muted === false), "W1: the toggle unmutes EVERY video in the track — active, early-started and warmed neighbors alike");
    assert(V[0].playCalls === playsBefore && V[0].pauseCalls === pausesBefore && V[0].paused === false, "W1: the playing video unmutes IN PLACE — no re-play, no pause, no restart");
    assert(w.store.get("hhFeedSound") === "on", "W1: the choice persists (hhFeedSound=on)");
    assert(w.btnClasses.has("sound-on") && B.attrs["aria-pressed"] === "true" && B.attrs["aria-label"] === "Turn sound off", "W1: the toggle flips to its on state (class, aria-pressed, label)");

    // A settle after enabling: the newly active video plays
    // with sound.
    w.trackEl.scrollTop = 800;
    run("feedOnScroll189()");
    assert(V[1].paused === false && V[1].muted === false, "W1: activation after enabling produces a video with muted=false");

    // A mid-swipe early start after enabling: same.
    w.io.fire(w.slides[2]);
    assert(V[2].playCalls === 1 && V[2].muted === false, "W1: the early-started video also starts with muted=false (state applied before play)");

    // Toggling back off re-mutes everything at once.
    run("window.feedToggleSound194()");
    assert(V.every((v) => v.muted === true) && w.store.get("hhFeedSound") === "off", "W1: toggling off re-mutes every video immediately and persists off");
    assert(!w.btnClasses.has("sound-on") && B.attrs["aria-label"] === "Turn sound on", "W1: the toggle is back to its off state");

    // Close + reopen: the saved OFF choice is restored.
    run("window.closeFeed189()");
    V.forEach((v) => { v.muted = true; }); // a real re-render creates fresh muted elements
    assert(run("window.openFeed189([11, 12, 13, 14, 15], 12, null)") === true, "W1: the feed reopens");
    assert(run("feed194.sound") === false && V.every((v) => v.muted === true) && !w.btnClasses.has("sound-on"), "W1: reopening restores the saved OFF choice — videos muted, button off");

    // And the saved ON choice likewise.
    run("window.feedToggleSound194()");
    run("window.closeFeed189()");
    V.forEach((v) => { v.muted = true; }); // fresh render again
    assert(run("window.openFeed189([11, 12, 13, 14, 15], 11, null)") === true, "W1: the feed reopens once more");
    assert(run("feed194.sound") === true && V[0].muted === false && w.btnClasses.has("sound-on") && B.attrs["aria-label"] === "Turn sound off", "W1: reopening restores the saved ON choice — the opening video is unmuted and the button shows on");
  }

  // ---------- World 2: saved preference ON + battle feed ----------
  {
    const w = makeWorld(true, { hhFeedSound: "on" });
    vm.runInContext(block, w.ctx);
    const run = w.run, V = w.videos;

    assert(run("feed194.sound") === true, "W2: the saved ON preference seeds the sound state at load");
    assert(w.btnClasses.has("sound-on") && w.soundBtn.attrs["aria-pressed"] === "true", "W2: the toggle starts in the on state (synced at init, before any open)");
    const opened = run("window.openFeed189([11, 12, 13, 14, 15], 13, null)");
    assert(opened === true && V[2].muted === false && V.every((v) => v.muted === false), "W2: the feed opens WITH sound — the activation applied the saved state to every video");

    // Battle slides follow the same state.
    run("window.closeFeed189()");
    V.forEach((v) => { v.muted = true; }); // fresh render
    run("window.openBattleFeed189()");
    assert(run("feed189.kind") === "battle", "W2: the battle feed opens");
    assert(V[0].muted === false, "W2: a battle slide's video carries the ON state");
    run("window.feedToggleSound194()");
    assert(V.every((v) => v.muted === true), "W2: toggling off re-mutes the battle slides too");
    run("window.feedToggleSound194()");
    assert(V[0].muted === false && V[1].muted === false, "W2: toggling back on unmutes both battle plays");
  }

  // ---------- World 3: no IntersectionObserver + kill switch ----------
  {
    const w = makeWorld(false, null);
    vm.runInContext(block, w.ctx);
    const run = w.run, V = w.videos;

    const opened = run("window.openFeed189([11, 12, 13, 14, 15], 11, null)");
    assert(opened === true && run("feed193.observer") === null, "W3: without IntersectionObserver the feed still opens, no observer created");
    assert(V.every((v) => v.muted === true), "W3: the feed opens muted (default off)");
    run("window.feedToggleSound194()");
    assert(V.every((v) => v.muted === false), "W3: the toggle unmutes without the early-start path existing");
    run("feedActivate189(2)");
    assert(V[2].muted === false && V[2].paused === false, "W3: a settle activation after enabling plays with sound");

    // Kill switch still stands the feed down.
    w.sandbox.window.HH_NO_FEED189 = true;
    run("window.closeFeed189()");
    assert(run("window.openFeed189([11, 12, 13, 14, 15], 11, null)") === false && w.wrapEl.hidden === true, "W3: HH_NO_FEED189 — the feed will not open");
    run("window.openPlay189(11, null)");
    assert(w.calls.detail.length === 1 && w.calls.detail[0] === 11, "W3: HH_NO_FEED189 — a board tap opens the classic detail, exactly as before");
    delete w.sandbox.window.HH_NO_FEED189;
  }

  console.log("\nR194 feed sound toggle: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
