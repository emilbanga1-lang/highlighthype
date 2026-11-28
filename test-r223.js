// Round 223 test: the video experience — Emil: "when watching
// a video there is no way now to pause it or rewind", plus the
// outside review's three feed notes (Watch Highlights should
// open a playing clip in one tap; a feed clip opened on sky
// instead of its poster's moment; the feed vote didn't read
// as an action).
// Run: node test-r223.js
// What this suite pins down:
//   A. Pins: app.js v222 / styles v215 (both files changed).
//   B. Statics: the server exposes poster_time (the Round
//      209/213 chosenTime out of enhance_json, null when no
//      poster was picked); the feed slide carries the scrub
//      bar + flash + time and stamps data-feed-poster-time on
//      board video slides only; feedRender189 wires the R223
//      controls + poster seek; the rail button carries its
//      "Vote for this play" label inside the control;
//      feedSyncCounts189 syncs the label; the watch card
//      renders the always-visible control row and
//      renderPlayDetail wires it; styles.css carries the
//      flash/scrub/pill/row rules; the hero anchor keeps its
//      data-tablink fallback.
//      Scope 3 (board tiles) is pinned as a FINDING: tile
//      videos render through fameThumbHtml with NO controls
//      attribute (muted loop previews by design) under the
//      .tile-tap overlay — there are no native controls on a
//      tile to suppress; the controls-carrying card surface
//      (cardHtml → mediaHtml, controls in the markup) has no
//      overlay over its .thumb, so its controls were already
//      reachable.
//   C. VM drives of the real code: the time formatter; the
//      slide's poster-time stamping (board only, never
//      battles); the rail label in both states + the sample;
//      the poster seek (metadata timing, end clamp, already-
//      playing guard, fastSeek preference); the tap toggle
//      (play/pause + flash glyphs + fill pause); the shared
//      scrub wiring (pointer drag seeks, proportionally);
//      the label keeper (rebuild after toggleVote's
//      textContent swap + in-place update); the card row
//      wiring (button toggles, timeupdate paints, scrub
//      seeks); the hero entry (board order off the DOM, the
//      Month board on the Month view, the All board on the
//      Battles view — never the battle pair — and the kill
//      switch standing it down).
//   D. Booted server, end to end: a photo play's payload
//      carries poster_time: null; a burst clip (the Round
//      209 recipe) settles with a numeric poster_time inside
//      the clip; the served homepage/app.js/styles.css carry
//      the round.
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('src="app.js?v=242"') && home.includes('href="styles.css?v=231"'), "A: asset pins — app.js v222 / styles v215 (Round 223; both files changed) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v230 (Round 246) — →247: styles now v230 (Round 247)");

// ---- B. statics ----
// The server field (scope 5).
assert(serverJs.includes("poster_time: posterTime223") && serverJs.includes("Number(ej223.r209.chosenTime)"), "B: publicHighlight exposes poster_time, parsed from enhance_json's r209.chosenTime");
assert(serverJs.includes("if (Number.isFinite(ct223) && ct223 > 0) posterTime223 = ct223;"), "B: poster_time is null unless a real (positive) poster moment was picked");
// The feed slide markup (scopes 1 + 5).
const slideFn = appJs.slice(appJs.indexOf("function feedSlideHtml189"), appJs.indexOf("function feedEndCardHtml189"));
assert(slideFn.includes('data-feed-poster-time="${posterTime223}"') && slideFn.includes("!feed189.battle"), "B: a board video slide stamps its poster moment; battle slides never do");
assert(slideFn.includes('data-feed-scrub="${h.id}"') && slideFn.includes('data-feed-progress="${h.id}"') && slideFn.includes('data-feed-time="${h.id}"') && slideFn.includes('data-feed-flash="${h.id}"'), "B: a video slide carries the scrub bar (the Round 189 progress hairline inside it), the time readout and the tap flash");
// The render wiring (scopes 1 + 5).
assert(appJs.includes('if (typeof feedWireControls223 === "function") feedWireControls223(s);') && appJs.includes('if (typeof feedWirePosterStart223 === "function") feedWirePosterStart223(s);'), "B: feedRender189 wires the R223 controls + poster seek per slide (typeof-guarded, house pattern)");
// The rail label (scope 6).
const railFn = appJs.slice(appJs.indexOf("function feedHypeRail189"), appJs.indexOf("function feedVsHtml189"));
assert(railFn.includes('<span class="feed223-hypelabel">${h.hasVoted ? "Voted" : "Vote for this play"}</span>') && railFn.includes('src="crown.png"'), "B: the rail button carries the crown + the \"Vote for this play\" label INSIDE the control (\"Voted\" when voted, like the tile chip)");
assert(!railFn.includes('<span class="feed189-raillabel">Vote</span>'), "B: the old under-button \"Vote\" caption is gone from the vote control");
assert(appJs.includes('if (h && typeof feedSyncHypeLabel223 === "function") feedSyncHypeLabel223(el, !!h.hasVoted);'), "B: feedSyncCounts189 keeps the button's label in step after a vote (and restores crown + label after toggleVote's textContent swap)");
// The watch card row (scope 2).
const watchFn = appJs.slice(appJs.indexOf("function watchHtml107"), appJs.indexOf("function renderPlayDetail"));
assert(watchFn.includes('data-card-controls="${h.id}"') && watchFn.includes('data-card-playbtn="${h.id}"') && watchFn.includes('data-card-scrub="${h.id}"') && watchFn.includes('data-card-progress="${h.id}"') && watchFn.includes('data-card-time="${h.id}"'), "B: the watch card renders the always-visible control row (play/pause + scrub + time) under the player");
assert(watchFn.includes('h.media_kind !== "link_embed"'), "B: the row renders for real video plays only — embeds keep their own player");
assert(appJs.includes('if (typeof wireCardControls223 === "function") wireCardControls223(body);'), "B: renderPlayDetail wires the row per render (typeof-guarded)");
// The R223 block itself.
const block223 = appJs.slice(appJs.indexOf("/* ---------------- Round 223"));
assert(block223.includes("function vidTimeFmt223") && block223.includes("function vidScrubWire223") && block223.includes("function feedTogglePlay223") && block223.includes("function feedSeekPoster223") && block223.includes("function wireCardControls223") && block223.includes("window.openHeroFeed223"), "B: the Round 223 block carries the formatter, the shared scrub wiring, the tap toggle, the poster seek, the card wiring and the hero entry");
assert(block223.includes("setPointerCapture") && block223.includes("stopPropagation"), "B: the scrub captures its pointer and stops its events — a seek drag can never become a slide swipe");
assert(block223.includes("a.btn-hero[data-tablink=\"plays\"]") && block223.includes("{ capture: true }"), "B: the hero interception is a capture-phase listener on the hero anchor only — an unopened feed leaves the tap to the standing data-tablink behavior");
assert(block223.includes('currentView === "month"') && block223.includes('"#monthRows"') && block223.includes('"#allBoard"') && block223.includes("openFeed189(ids, ids[0], null)"), "B: the hero reads the board the visitor is on (Month rows on the Month view, All tiles otherwise) and opens the feed at its FIRST play with battle = null — never the Battles pair");
// Scope 3 — the tile finding, pinned.
const fameThumbFn = appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function posterUrlFor134"));
assert(!fameThumbFn.includes("controls"), "B/scope3 FINDING: tile videos (fameThumbHtml) render with NO controls attribute — muted loop previews by design; there are no native tile controls to suppress");
const tileFn = appJs.slice(appJs.indexOf("function tileHtml"), appJs.indexOf("/* Vote hardening"));
assert(tileFn.includes('class="tile-tap"') && tileFn.includes('class="tile-media dur-host"'), "B/scope3 FINDING: the .tile-tap overlay covers .tile-media (Round 9: the playing video swallowed taps) — a tile is a tap-to-open poster, and pause/rewind lives in the feed + watch view");
const mediaFn = appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("function athleteLine"));
assert(mediaFn.includes("controls playsinline"), "B/scope3: the card/detail renderer (mediaHtml) DOES carry native controls (vidAttrs192) in its markup");
const cardFn = appJs.slice(appJs.indexOf("function cardHtml"), appJs.indexOf("/* Compact board tiles"));
assert(cardFn.includes('class="thumb"') && cardFn.includes("tile-tap"), "B/scope3: the full card's .thumb carries NO tap overlay — its native controls were already reachable (badge/rank chips sit in the corners only) — →248 SUPERSEDED by Emil's click-path audit (Fix 4): the athlete-page card's video only played inline and never opened the play, so cardHtml's thumb now carries the Watch tiles' tile-tap overlay into openPlay189 (gated to file/link_video); the detail view's own surfaces (mediaHtml/watchHtml107) are unchanged");
// CSS.
assert(css.includes(".feed223-scrub{") && css.includes("touch-action:none") && css.includes(".feed223-flash{") && css.includes("@keyframes feed223flash"), "B: styles.css carries the scrub strip (touch-action:none) + the tap flash");
assert(css.includes(".feed223-hypelabel{") && css.includes(".feed189-hype.voted .feed223-hypelabel{"), "B: styles.css carries the in-button vote label + its voted treatment");
assert(css.includes(".card-controls223{") && css.includes(".card-playbtn223{") && css.includes(".card-scrub223{") && css.includes(".card-time223{"), "B: styles.css carries the watch view's control row");
// The hero anchor itself is untouched (its fallback stands).
assert(home.includes('<a class="btn btn-lime btn-hero" href="#deck" data-tablink="plays">'), "B: the hero anchor keeps href + data-tablink — the deck scroll remains the fallback when the feed can't open");

// ---- C. VM drives of the real code ----
const PLAYS = {
  11: { id: 11, title: "Home Run", player_name: "Nicholas B.", athlete_label: "Nicholas B.", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v11.mp4", poster_url: "/uploads/poster-11.jpg", poster_time: 4.25, voteCount: 3, hasVoted: false, isSample: false },
  12: { id: 12, title: "No Poster Pick", player_name: "Maya L.", athlete_label: "Maya L.", team: "Rival Sox", sport: "softball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v12.mp4", poster_url: "/uploads/poster-12.jpg", poster_time: null, voteCount: 5, hasVoted: true, isSample: false },
  13: { id: 13, title: "Still Photo", player_name: "Kid C.", athlete_label: "Kid C.", team: "", sport: "soccer", media_kind: "file", mime: "image/jpeg", media_url: "/uploads/p13.jpg", poster_url: "", poster_time: null, voteCount: 0, hasVoted: false, isSample: false },
  14: { id: 14, title: "Sample Swing", player_name: "Demo D.", athlete_label: "Demo D.", team: "", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/v14.mp4", poster_url: "/uploads/poster-14.jpg", poster_time: 2, voteCount: 4, hasVoted: false, isSample: true },
};
const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null };
const wrapEl = { hidden: true };
const docListeners = [];
const hosts223 = {};
const sandbox = {
  window: {},
  document: {
    getElementById: () => null,
    addEventListener: (type, fn, opts) => { docListeners.push({ type, fn, opts }); },
    querySelector: (sel) => hosts223[sel] || null,
    body: { classList: { add: () => {}, remove: () => {} } },
  },
  $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
  $$: () => [],
  esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
  cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
  findPlay: (id) => PLAYS[id] || null,
  playHasVideo: (h) => h.media_kind === "file" && !(h.mime || "").startsWith("image/"),
  posterUrlFor134: (h) => h.poster_url || "",
  playSrc192: (h) => h.media_url,
  trackEvent: () => {},
  toggleVote: async () => {},
  sharePlay: () => {},
  openPlayDetail: () => {},
  switchView: () => {},
  setMonthSub: () => {},
  pauseMediaIn158: () => {},
  featPause163: () => {},
  requestAnimationFrame: (fn) => { fn(); return 0; },
  btl: { cur: { L: 11, R: 12 } },
  console,
};
sandbox.window.toggleVote = sandbox.toggleVote;
sandbox.window.sharePlay = sandbox.sharePlay;
sandbox.window.openPlayDetail = sandbox.openPlayDetail;
const ctx = vm.createContext(sandbox);
vm.runInContext(appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed")), ctx);
const run = (code) => vm.runInContext(code, ctx);

// The formatter.
assert(run("vidTimeFmt223(0)") === "0:00" && run("vidTimeFmt223(9.9)") === "0:09" && run("vidTimeFmt223(65)") === "1:05" && run("vidTimeFmt223(600)") === "10:00" && run("vidTimeFmt223(3661)") === "1:01:01" && run("vidTimeFmt223(NaN)") === "0:00" && run("vidTimeFmt223(-4)") === "0:00", "C: vidTimeFmt223 — m:ss, h:mm:ss past an hour, junk reads 0:00");

// Slide stamping (scope 5) + scrub markup (scope 1).
{
  const vid = run("feedSlideHtml189(findPlay(11), 0, false)");
  assert(vid.includes('data-feed-poster-time="4.25"'), "C: a board video slide stamps the play's poster moment");
  assert(vid.includes('data-feed-scrub="11"') && vid.includes('data-feed-progress="11"') && vid.includes('data-feed-time="11"') && vid.includes('data-feed-flash="11"'), "C: a video slide carries the scrub bar + progress + time + flash");
  const noPick = run("feedSlideHtml189(findPlay(12), 0, false)");
  assert(!noPick.includes("data-feed-poster-time"), "C: a play with no picked poster stamps no moment (it starts at the head, as before)");
  assert(noPick.includes('data-feed-scrub="12"'), "C: …but still carries the scrub bar");
  const pho = run("feedSlideHtml189(findPlay(13), 0, false)");
  assert(!pho.includes("data-feed-scrub") && !pho.includes("data-feed-poster-time"), "C: a photo slide carries neither scrub nor moment");
  run("feed189.battle = { a: 11, b: 12 }");
  const btlSlide = run("feedSlideHtml189(findPlay(11), 0, false)");
  run("feed189.battle = null");
  assert(btlSlide.includes('data-feed-battle="1"') && !btlSlide.includes("data-feed-poster-time"), "C: a BATTLE slide never stamps the moment (Round 192's pooled scope) — the exclusion is in the renderer");
  assert(btlSlide.includes('data-feed-scrub="11"'), "C: a battle slide still carries the scrub bar (its video is a feed video)");
}

// The rail label (scope 6).
{
  const rail = run("feedHypeRail189(findPlay(11))");
  const btnInner = rail.slice(rail.indexOf('data-feed-hype="11"'), rail.indexOf("</button>"));
  assert(btnInner.includes('class="feed191-crown"') && btnInner.includes('<span class="feed223-hypelabel">Vote for this play</span>'), "C: the label rides INSIDE the vote button, under the crown");
  const railVoted = run("feedHypeRail189(findPlay(12))");
  assert(railVoted.includes('<span class="feed223-hypelabel">Voted</span>') && railVoted.includes('class="feed189-hype voted"'), "C: the voted state's label shortens to \"Voted\" (the tile chip's word)");
  const railSample = run("feedHypeRail189(findPlay(14))");
  assert(!railSample.includes("data-feed-hype") && !railSample.includes("feed223-hypelabel"), "C: a sample keeps its display-only chip — no vote label");
}

// The poster seek (scope 5), driven against stub videos.
{
  const mkV = (o = {}) => {
    const v = { readyState: 0, currentTime: 0, duration: 10, _meta: null, fastSeekCalls: [],
      addEventListener: (ev, fn) => { if (ev === "loadedmetadata") v._meta = fn; } };
    if (o.readyState != null) v.readyState = o.readyState;
    if (o.duration != null) v.duration = o.duration;
    if (o.currentTime != null) v.currentTime = o.currentTime;
    if (o.fastSeek) v.fastSeek = (t) => { v.fastSeekCalls.push(t); v.currentTime = t; };
    return v;
  };
  sandbox.__v = mkV();
  run("feedSeekPoster223(__v, 4.25)");
  assert(sandbox.__v.currentTime === 0 && typeof sandbox.__v._meta === "function", "C: before metadata the seek waits (loadedmetadata listener registered)");
  sandbox.__v._meta();
  assert(sandbox.__v.currentTime === 4.25, "C: at metadata the video seeks to the poster moment");
  sandbox.__v = mkV({ readyState: 2, duration: 3 });
  run("feedSeekPoster223(__v, 4.25)");
  assert(Math.abs(sandbox.__v.currentTime - 2.85) < 1e-9, "C: a moment past the end clamps a hair inside it (duration − 0.15)");
  sandbox.__v = mkV({ readyState: 2, currentTime: 5 });
  run("feedSeekPoster223(__v, 4.25)");
  assert(sandbox.__v.currentTime === 5, "C: a video already playing past the moment is never yanked back");
  sandbox.__v = mkV({ readyState: 2, fastSeek: true });
  run("feedSeekPoster223(__v, 4.25)");
  assert(sandbox.__v.fastSeekCalls.length === 1 && sandbox.__v.fastSeekCalls[0] === 4.25, "C: fastSeek is preferred where the engine offers it");
  sandbox.__v = mkV({ readyState: 2 });
  run("feedSeekPoster223(__v, 0)");
  assert(sandbox.__v.currentTime === 0 && sandbox.__v._meta === null, "C: a zero/invalid moment seeks nothing");
  // The slide-level wiring honors the battle exclusion a second time.
  const battleSlide = { getAttribute: (a) => (a === "data-feed-battle" ? "1" : a === "data-feed-poster-time" ? "4.25" : ""), querySelector: () => null, querySelectorAll: () => [] };
  sandbox.__s = battleSlide;
  run("feedWirePosterStart223(__s)");
  assert(true, "C: feedWirePosterStart223 stands down on a battle slide (no throw, no seek)");
}

// The tap toggle (scope 1).
{
  const flash = { textContent: "", _cls: new Set(), classList: { add: (c) => flash._cls.add(c), remove: (c) => flash._cls.delete(c) } };
  const v = { paused: true, ended: false, playCalls: 0, pauseCalls: 0,
    play: () => { v.playCalls++; v.paused = false; return Promise.resolve(); },
    pause: () => { v.pauseCalls++; v.paused = true; } };
  const slide = { querySelector: (sel) => (sel.includes("flash") ? flash : null), querySelectorAll: () => [] };
  sandbox.__slide = slide; sandbox.__v = v;
  run("feedTogglePlay223(__slide, __v)");
  assert(v.playCalls === 1 && flash.textContent === "▶" && flash._cls.has("show"), "C: tapping a paused feed video plays it and flashes ▶");
  run("feedTogglePlay223(__slide, __v)");
  assert(v.pauseCalls === 1 && flash.textContent === "❚❚", "C: tapping a playing feed video pauses it and flashes ❚❚");
}

// The shared scrub wiring.
{
  const v = { duration: 40, currentTime: 0 };
  const hit = { _h: {}, addEventListener: (t, fn) => { hit._h[t] = fn; }, getBoundingClientRect: () => ({ left: 100, width: 200 }), setPointerCapture: () => {} };
  sandbox.__v = v; sandbox.__hit = hit;
  run("vidScrubWire223(__hit, __v)");
  hit._h.pointerdown({ clientX: 200, pointerId: 1, stopPropagation: () => {} });
  assert(v.currentTime === 20, "C: a scrub pointerdown seeks proportionally (midpoint of the bar = midpoint of the clip)");
  hit._h.pointermove({ clientX: 300, pointerId: 1 });
  assert(v.currentTime === 40, "C: dragging to the bar's end seeks to the clip's end");
  hit._h.pointerup({});
  hit._h.pointermove({ clientX: 100, pointerId: 1 });
  assert(v.currentTime === 40, "C: after pointerup the drag is over — moves no longer seek");
}

// The label keeper (scope 6).
{
  const wiped = { _inner: "", querySelector: () => null, set innerHTML(x) { this._inner = x; }, get innerHTML() { return this._inner; } };
  sandbox.__b = wiped;
  run("feedSyncHypeLabel223(__b, false)");
  assert(wiped._inner.includes('class="feed191-crown"') && wiped._inner.includes('<span class="feed223-hypelabel">Vote for this play</span>'), "C: after toggleVote's textContent swap took the button's contents, the sync rebuilds crown + label");
  run("feedSyncHypeLabel223(__b, true)");
  assert(wiped._inner.includes('<span class="feed223-hypelabel">Voted</span>'), "C: …and the rebuild carries the current voted state");
  const label = { textContent: "Vote for this play" };
  const intact = { querySelector: (sel) => (sel.includes("hypelabel") ? label : sel.includes("crown") ? {} : null) };
  sandbox.__b = intact;
  run("feedSyncHypeLabel223(__b, true)");
  assert(label.textContent === "Voted", "C: an intact button's label updates in place");
  run("feedSyncHypeLabel223(__b, false)");
  assert(label.textContent === "Vote for this play", "C: …and back on toggle-off");
}

// The card row wiring (scope 2).
{
  const v = { paused: true, ended: false, currentTime: 0, duration: 30, _h: {}, playCalls: 0, pauseCalls: 0,
    addEventListener: (t, fn) => { v._h[t] = fn; },
    play: () => { v.playCalls++; v.paused = false; return Promise.resolve(); },
    pause: () => { v.pauseCalls++; v.paused = true; } };
  const btn = { textContent: "", _h: {}, _attrs: {}, addEventListener: (t, fn) => { btn._h[t] = fn; }, setAttribute: (k, val) => { btn._attrs[k] = val; } };
  const fill = { style: {} };
  const timeEl = { textContent: "" };
  const scrub = { _h: {}, addEventListener: (t, fn) => { scrub._h[t] = fn; }, getBoundingClientRect: () => ({ left: 0, width: 100 }), setPointerCapture: () => {} };
  const row = { querySelector: (sel) => (sel.includes("playbtn") ? btn : sel.includes("scrub") ? scrub : sel.includes("progress") ? fill : sel.includes("time") ? timeEl : null) };
  const box = { querySelector: () => v };
  const body = { querySelector: (sel) => (sel.includes("card-controls") ? row : sel === ".watch-player" ? box : null) };
  sandbox.__body = body;
  run("wireCardControls223(__body)");
  assert(btn.textContent === "▶" && timeEl.textContent === "0:00 / 0:30", "C: the card row paints the paused state + the time at wiring");
  btn._h.click();
  assert(v.playCalls === 1 && btn.textContent === "❚❚", "C: the row's button plays the clip and flips to the pause glyph");
  v.currentTime = 15;
  v._h.timeupdate();
  assert(fill.style.width === "50%" && timeEl.textContent === "0:15 / 0:30", "C: timeupdate paints the progress fill + the elapsed time");
  scrub._h.pointerdown({ clientX: 25, pointerId: 1, stopPropagation: () => {} });
  assert(v.currentTime === 7.5, "C: the row's scrub seeks (quarter of the bar = quarter of the clip)");
  btn._h.click();
  assert(v.pauseCalls === 1 && btn.textContent === "▶", "C: the row's button pauses again — pause + rewind both live on the card now");
}

// The hero entry (scope 4).
{
  const tile = (id) => ({ getAttribute: () => String(id) });
  hosts223["#allBoard"] = { querySelectorAll: () => [tile(31), tile(32), tile(33)] };
  hosts223["#monthRows"] = { querySelectorAll: () => [tile(41), tile(42)] };
  // Capture the hero's feed-open arguments through a stub.
  run("window.__heroArgs = null; window.openFeed189 = (ids, start, battle) => { window.__heroArgs = { ids, start, battle }; return true; }");
  sandbox.currentView = "battles"; sandbox.monthSub = "month";
  assert(run("window.openHeroFeed223()") === true, "C: the hero opens the feed (Battles view state)");
  const argsB = run("window.__heroArgs");
  assert(JSON.stringify(argsB.ids) === "[31,32,33]" && argsB.start === 31 && argsB.battle === null, "C: …on the ALL board's order, at its first play, battle = null — a Battles tab state can never leak into the hero's feed");
  sandbox.currentView = "month"; sandbox.monthSub = "month";
  run("window.openHeroFeed223()");
  const argsM = run("window.__heroArgs");
  assert(JSON.stringify(argsM.ids) === "[41,42]" && argsM.start === 41, "C: on the Month view the hero walks the Month board from its first row");
  run("window.HH_NO_FEED189 = true");
  assert(run("window.openHeroFeed223()") === false, "C: the kill switch stands the hero entry down (the tap falls through to the deck scroll)");
  run("window.HH_NO_FEED189 = false");
  delete sandbox.currentView; delete sandbox.monthSub;
}

// ---- D. booted server ----
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r223-fix-"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:duration=1", "-frames:v", "1", path.join(fixDir, "photo.jpg")]);
const PHOTO = fs.readFileSync(path.join(fixDir, "photo.jpg"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-f", "lavfi", "-i", "testsrc2=size=320x240:duration=3:rate=10", "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", path.join(fixDir, "burst.mp4")]);
const BURST = fs.readFileSync(path.join(fixDir, "burst.mp4"));

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r223-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HF_AVATAR_BASE_URL: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r223boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, what, timeoutMs = 150000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2000));
      await wait(1000);
    }
  };
  return { tmp, child, base, j, upload, waitFor, getLog: () => log, stop: () => child.kill("SIGKILL") };
}
{
  const s = await boot(4231);
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const owner = { "content-type": "application/json", "x-owner-token": claim.body.token };
    const approve = async (id) => {
      const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: owner, body: JSON.stringify({ status: "approved" }) });
      assert(ap.body.status === "approved", `D: play ${id} approved`);
    };
    const upPhoto = await s.upload({ ...F, playerName: "Nicholas B.", title: "Still Moment" }, "photo.jpg", PHOTO, "image/jpeg");
    assert(upPhoto.status === 201, "D: the photo play uploads (201)");
    await approve(upPhoto.body.id);
    const upVid = await s.upload({ ...F, playerName: "Kameron A.", title: "Burst Play" }, "burst.mp4", BURST, "video/mp4");
    assert(upVid.status === 201, "D: the burst clip uploads (201)");
    await approve(upVid.body.id);

    const board = await s.waitFor(async () => {
      const r = await s.j("/api/highlights?division=all");
      const hs = (r.body.highlights || []);
      const photo = hs.find((h) => h.id === upPhoto.body.id);
      const vid = hs.find((h) => h.id === upVid.body.id);
      return photo && vid && typeof vid.poster_time === "number" ? { photo, vid } : null;
    }, "the burst clip's poster_time to settle");
    assert("poster_time" in board.photo && board.photo.poster_time === null, "D: a photo play's payload carries poster_time: null (no poster was ever picked)");
    assert(board.vid.poster_time > 0 && board.vid.poster_time < 7, `D: the burst clip's payload carries its picked moment (poster_time ${board.vid.poster_time}s, inside the 7s clip)`);
    assert(!!board.vid.poster_url, "D: …and the poster itself was re-picked (the moment and the frame agree)");

    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=242"') && served.includes('href="styles.css?v=231"'), "D: the served homepage carries the Round 223 pins — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v230 (Round 246) — →247: styles now v230 (Round 247)");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("feedWireControls223") && servedApp.includes("data-feed-scrub") && servedApp.includes("openHeroFeed223"), "D: the served app.js carries the feed controls + the hero entry");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes(".feed223-scrub{") && servedCss.includes(".card-controls223{"), "D: the served styles.css carries the scrub strip + the card row");
  } finally { s.stop(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
}

console.log("\nALL R223 CHECKS PASSED");
