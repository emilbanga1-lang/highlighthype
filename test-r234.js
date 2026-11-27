// Round 234 test: Emil's phone screenshot 2026-11-27 13:32,
// taken ON WiFi — "Still some load issues": the homepage
// MORE HIGHLIGHTS section's four tiles (Nicholas B. Double,
// Juliana Caught stealing home!, Charlotte kata/kumite,
// christian Second…) sat solid BLACK — no poster still, no
// video, only the ▶ count chip and the title/vote rows. The
// Featured Play card above them rendered normally.
//
// DIAGNOSIS (parent's suspected cause checked, and REFUTED
// in its mechanism): the suspicion was that R233's gate
// (fameThumbHtml opts.gate233 → <video data-src233 …
// class="tile-vid233">) leaks into the homepage sections and
// strands tiles in a container bindTileGate233 never
// observes. The emitter census says otherwise — pinned in §B:
// the gate233 template occurs EXACTLY ONCE in app.js
// (fameThumbHtml's gate branch) and gate233 is threaded
// EXACTLY ONCE (tileHtml), whose only caller is renderAll2
// into #allBoard, which R233 bound. The homepage sections
// never emit gated tiles at all: battle / featured / More
// media are homePosterMedia230 <img> stills (R232 made the
// helper video-free), the homepage leaderboard rows are
// poster <img> thumbs (fameRowHtml134), the spotlight and
// board featured cards ride the deliberately-ungated rest133
// form, and the up-next rail the legacy form. The live
// busted poster URLs serve 200 image/jpeg at the right
// sizes, and live app.js is byte-identical to this copy.
//
// THE ACTUAL CAUSE, from the same screenshot: the More
// stills were the ONLY homepage section stills still on
// loading="lazy" — battle + featured have ridden
// fetchpriority="high" since R232 and they PAINTED in that
// shot, while the page-load bar was still running. WebKit
// defers lazy images behind the page's video traffic (the
// autoplaying hero; the gated board renditions pre-rolling
// within the gate's 400px rootMargin below the fold), so
// the section sat on its black .hm230-media ground. A still
// that is a tile's WHOLE content cannot be lazy.
//
// FIXES PINNED HERE:
// 1. More Highlights stills are eager: homeMoreTile230 now
//    passes decoding="async" instead of loading="lazy" to
//    homePosterMedia230. Tap behavior unchanged
//    (homeOpenPlay232, R232).
// 2. Gate coverage is DOCUMENT-WIDE, so the suspected
//    failure mode can never occur with any future renderer:
//    renderAll2 and renderHome230 both call
//    bindTileGate233() with no root — the binder rescans the
//    whole document (disconnect/rebind hygiene unchanged:
//    one shared observer, .vfill never observed, no-IO
//    fallback loads immediately). §C renders the board grid
//    AND every homepage section into one stub document and
//    proves every emitted gated tile is registered with the
//    gate and loads on approach — and that no gated tile
//    exists in the document without coverage.
//
// Pins: app.js v230 / styles v221 (styles unchanged).
// Run: node test-r234.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=221"') && home.includes('src="app.js?v=230"'), "A: asset pins — app.js v230 / styles v221 (Round 234; styles unchanged)");

// ---- B. statics ----
// B1: the emitter census — exactly one gated template, one threading site.
assert((appJs.match(/class="tile-vid233"/g) || []).length === 1, "B1: exactly ONE template in app.js can emit a .tile-vid233 element (fameThumbHtml's gate233 branch)");
assert((appJs.match(/gate233: true/g) || []).length === 1 && appJs.includes("Object.assign({}, opts, { gate233: true })"), "B1: gate233 is threaded exactly once — tileHtml, the board grid's tile (renderAll2's caller chain only)");
// B2: document-wide binds at both render funnels.
const renderAll2Fn = appJs.slice(appJs.indexOf("function renderAll2()"), appJs.indexOf("function renderPlayDetail"));
assert(renderAll2Fn.includes("bindTileGate233();") && !renderAll2Fn.includes("bindTileGate233(b233)"), "B2: renderAll2 binds the gate DOCUMENT-WIDE (no #allBoard scope) after every board render");
const renderHomeFn = appJs.slice(appJs.indexOf("function renderHome230()"), appJs.indexOf("(function homeLbWire230()"));
assert(renderHomeFn.includes("bindTileGate233();"), "B2: renderHome230 ends with the document-wide gate bind — the homepage render funnel establishes coverage too");
assert(appJs.includes('rootMargin: "400px 0px 400px 0px"') && appJs.includes("tileGateObs233.disconnect()"), "B2: R233 hygiene intact — one shared observer, 400px rootMargin, disconnect before rebind");
// B3: the More still is eager now; taps unchanged.
const moreTileFn = appJs.slice(appJs.indexOf("function homeMoreTile230"), appJs.indexOf("function renderHomeLb230"));
const moreTileCode = moreTileFn.replace(/\/\*[\s\S]*?\*\//g, ""); // the R234 comment itself quotes the retired attribute — assert on the code
assert(!moreTileCode.includes('loading="lazy"') && moreTileCode.includes("homePosterMedia230(h, ' decoding=\"async\"')"), "B3: More Highlights stills fetch with the render (decoding=\"async\") — no loading=\"lazy\" deferral");
assert(moreTileFn.includes("homeOpenPlay232(${h.id})") && !moreTileFn.includes("openPlayDetail("), "B3: More tiles keep their R232 tap — the swipe feed via homeOpenPlay232");

// ---- C. VM drive: one stub document, board grid + every homepage section ----
function mkEl(id) {
  return {
    id: id || "", innerHTML: "", hidden: false, disabled: false, children: [], attrs: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); if (c.id) REG.set(c.id, c); return c; },
    remove() { if (this.id) REG.delete(this.id); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    scrollIntoView() {},
  };
}
const REG = new Map();
const ctasEl = mkEl(""); ctasEl.className = "hero-ctas";
for (const id of ["allBoard", "homeBattle230", "homeBattleBody230", "homeFeat230", "homeFeatBody230", "homeMore230", "homeMoreGrid230", "homeLbRows230", "homeLbTabMonth230", "homeLbTabFame230"])
  REG.set(id, mkEl(id));

/* Stub <video> elements for gated tiles, keyed by clip URL so
   identity is stable across rebinds — the way a real DOM's
   elements persist while an observer is replaced. The document
   stub's querySelectorAll rebuilds the gated-video list from
   the CURRENT innerHTML of every registered host, mirroring
   what a browser would find in the document. */
function mkVid234(url, poster) {
  const v = {
    attrs: {}, plays: 0, pauses: 0, loads: 0, preload: "", parentElement: null,
    classList: { contains: () => false, add() {}, remove() {} },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    setAttribute(k, val) { this.attrs[k] = String(val); },
    removeAttribute(k) { delete this.attrs[k]; },
    play() { this.plays++; return { catch() {} }; },
    pause() { this.pauses++; },
    load() { this.loads++; },
  };
  v.setAttribute("data-src233", url);
  if (poster) v.setAttribute("data-poster233", poster);
  return v;
}
const vidByUrl = new Map();
const gatedRe = /<video data-src233="([^"]+)"(?: data-poster233="([^"]+)")?[^>]*class="tile-vid233">/g;
function scanGated234() {
  const out = [];
  for (const el of REG.values()) {
    const html = el.innerHTML || "";
    gatedRe.lastIndex = 0;
    let m;
    while ((m = gatedRe.exec(html))) {
      if (!vidByUrl.has(m[1])) vidByUrl.set(m[1], mkVid234(m[1], m[2] || null));
      out.push(vidByUrl.get(m[1]));
    }
  }
  return out;
}
const ioInstances = [];
class IOStub234 {
  constructor(cb, opts) { this.cb = cb; this.opts = opts; this.observed = new Set(); this.disconnects = 0; ioInstances.push(this); }
  observe(el) { this.observed.add(el); }
  unobserve(el) { this.observed.delete(el); }
  disconnect() { this.disconnects++; this.observed.clear(); }
  fire(el, isIntersecting) { this.cb([{ target: el, isIntersecting }], this); }
}
const documentStub = {
  getElementById: (id) => REG.get(id) || null,
  querySelector: (sel) => (sel === ".hero-ctas" ? ctasEl : null),
  querySelectorAll: (sel) => (String(sel).includes("data-src233") ? scanGated234() : []),
  createElement: () => mkEl(""),
};
const line = (anchor) => { const i = appJs.indexOf(anchor); return appJs.slice(i, appJs.indexOf("\n", i)); };
const slice = (a, b) => appJs.slice(appJs.indexOf(a), appJs.indexOf(b));
const block230 = appJs.slice(appJs.indexOf("/* ---------------- Round 230"));
const helpers = [
  line("const esc ="), line("const cap ="), line("const MONTHS ="), line("const CROWN227 ="),
  slice("function fmtCount151", "function fullName153"),
  slice("function shortTitle", "function featCardHtml134"),
  slice("function fameThumbHtml", "function renderFame"),
  slice("function tileInfoHtml", "/* Vote hardening"),
  slice("function splitHtml100", "/* ---- Daily Battle ---- */"),
].join("\n");
const play = (id, label, athleteId, extra = {}) => ({
  id, title: "Play " + id, sport: "baseball", team: "", player_name: label, athlete_label: label,
  athlete_id: athleteId, media_kind: "file", mime: "video/mp4", media_url: "/uploads/x" + id + ".mp4",
  poster_url: "/uploads/poster-" + id + ".jpg", voteCount: 0, viewCount: 0, hasVoted: false, isSample: false, ...extra,
});
const P77 = play(77, "Marco", "athM", { title: "Ran for 40 yrds", sport: "football", voteCount: 2, viewCount: 5 });
const P78 = play(78, "Kameron A.", "athK", { title: "Touchdown", sport: "football", player_name: "Kameron A", team: "Kameron A", voteCount: 2 });
const P75 = play(75, "Kameron A.", "athK", { title: "Walk-off game winner", voteCount: 14, viewCount: 57 });
const P71 = play(71, "Nicholas B.", "athN", { title: "Double", team: "Plainview hawks", voteCount: 6, viewCount: 65 });
const P51 = play(51, "Juliana", "athJ", { title: "Caught stealing home!", sport: "softball", voteCount: 4, viewCount: 51 });
const P50 = play(50, "Charlotte", "athC", { title: "Gold and silver in both Kata and Kumite", sport: "martialarts", voteCount: 4, viewCount: 59 });

function world234(withIO) {
  const sb = {
    console, document: documentStub, setTimeout, clearTimeout,
    d100: { daily: null },
    CONTEST: { period: "2026-11", entries: [] },
    ALL_PLAYS: [],
    momentChipInline162: () => "",
    dailyPick100: async () => {},
    loadDaily100: async () => {},
    switchView: () => {},
    playAnotherBattle102: () => {},
    scrollBoardIntoView122: () => {},
    openPlayDetail: () => {},
    feedEnabled189: () => true,
    feedHeroIds223: () => [75, 71, 50, 77, 78, 51],
    openFeed189: () => true,
    hydrateDurPills: () => {},
  };
  if (withIO) sb.IntersectionObserver = IOStub234;
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(helpers + "\n" + block230, sb);
  /* tileHtml's duration pill is orthogonal to the gate — stub
     it if the loaded slices did not provide it. */
  vm.runInContext("if (typeof durPillHtml === 'undefined') durPillHtml = () => '';", sb);
  return sb;
}

{
  const sb = world234(true);
  const run = (code) => vm.runInContext(code, sb);
  const $id = (id) => REG.get(id);
  /* The board grid write, exactly as renderAll2 performs it
     (tileHtml per play into #allBoard), then renderAll2's own
     gate call — document-wide since R234 (pinned in B2). */
  sb.ALL_PLAYS = [P71, P51, P50];
  $id("allBoard").innerHTML = [P71, P51, P50].map((h, i) => run(`tileHtml(${JSON.stringify(h)}, { rank: ${i + 1} })`)).join("");
  run("bindTileGate233()");
  assert(ioInstances.length === 1 && ioInstances[0].observed.size === 3, "C: the board render binds the gate — all 3 gated board tiles observed");
  /* The homepage sections render into the SAME document
     (renderHome230 renders battle, featured, More and the
     leaderboard, then rebinds the gate document-wide). */
  sb.CONTEST = { period: "2026-11", entries: [P75, P71, P50, P51] };
  sb.ALL_PLAYS = [P75, P71, P50, P51, P77];
  sb.d100.daily = { available: true, practice: false, a: P71, b: P51, yourPick: null, split: null };
  run("renderHome230()");
  assert(ioInstances.length === 2 && ioInstances[0].disconnects === 1, "C: the homepage render rebinds the gate — old observer disconnected once, no stacking");
  /* Coverage: every gated tile emitted ANYWHERE in the
     document is registered with the live observer — and the
     observer holds nothing else. */
  const emitted = scanGated234();
  const live = ioInstances[ioInstances.length - 1];
  assert(emitted.length === 3 && emitted.every((v) => live.observed.has(v)) && live.observed.size === emitted.length, "C: EVERY gated tile in the document is gate-registered after the homepage render — none stranded, none extra");
  /* The homepage sections themselves emit no gated tiles and
     no video at all (the census, driven): their media are
     poster <img> stills. */
  const bb = $id("homeBattleBody230").innerHTML, fb = $id("homeFeatBody230").innerHTML, grid = $id("homeMoreGrid230").innerHTML, lb = $id("homeLbRows230").innerHTML;
  assert(!bb.includes("data-src233") && !fb.includes("data-src233") && !grid.includes("data-src233") && !lb.includes("data-src233"), "C: battle / featured / More / leaderboard emit ZERO gated tiles — the gate never reaches the homepage sections");
  assert(!bb.includes("<video") && !fb.includes("<video") && !grid.includes("<video"), "C: battle / featured / More emit ZERO <video> elements — poster stills only, as R232 built them");
  /* The symptom fix, driven: the More stills are eager. */
  assert(grid.includes('<img src="/uploads/poster-50.jpg" alt="" decoding="async">') && grid.includes('<img src="/uploads/poster-77.jpg" alt="" decoding="async">') && !grid.includes('loading="lazy"'), "C: More Highlights stills render eager (decoding=\"async\", NO loading=\"lazy\") — they paint with the section");
  assert(bb.includes('fetchpriority="high"') && fb.includes('fetchpriority="high"'), "C: battle + featured stills keep their R232 fetchpriority — the sections that painted in Emil's screenshot are unchanged");
  /* Every registered tile loads on approach, unloads on leave. */
  for (const v of emitted) {
    live.fire(v, true);
    assert(v.getAttribute("src") === v.getAttribute("data-src233") && v.getAttribute("poster") === v.getAttribute("data-poster233") && v.plays === 1, "C: approaching loads poster + src and plays — " + v.getAttribute("data-src233"));
  }
  const first = emitted[0];
  live.fire(first, false);
  assert(first.pauses >= 1 && !first.getAttribute("src"), "C: leaving pauses and unloads — the tile returns to its poster");
  /* The .vfill guard survives document-wide binding. */
  const fill = mkVid234("/uploads/fill.mp4", null);
  fill.classList = { contains: (c) => c === "vfill", add() {}, remove() {} };
  live.fire(fill, true);
  assert(!fill.getAttribute("src") && fill.plays === 0, "C: a .vfill clone reaching the callback is never gate-loaded");
}

// ---- D. no-IntersectionObserver fallback, document scope ----
{
  const sb = world234(false);
  const run = (code) => vm.runInContext(code, sb);
  REG.get("allBoard").innerHTML = [P71, P51].map((h, i) => run(`tileHtml(${JSON.stringify(h)}, { rank: ${i + 1} })`)).join("");
  vidByUrl.clear();
  run("bindTileGate233()");
  const vids = scanGated234();
  assert(vids.length === 2 && vids.every((v) => v.getAttribute("src") === v.getAttribute("data-src233") && v.plays === 1), "D: with no IntersectionObserver the document-wide bind loads every gated tile immediately (R233's degrade-to-today)");
}

console.log("\nALL R234 CHECKS PASSED");
