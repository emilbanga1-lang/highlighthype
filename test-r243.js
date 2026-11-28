// Round 243 (2026-11-27): Emil's two live-site leaderboard
// defects after Round 240.
//   (A) "In the leaderboard when you select a video we again
//       lost the tik tok version of swiping through videos."
//       Root cause (code evidence in app.js's Round 243
//       block): the homepage rows called homeOpenPlay232,
//       which reads its feed list from feedHeroIds223 — a
//       DOM read of #monthRows (retired from the markup in
//       Round 232) or #allBoard (the Watch board, Watch
//       order, Watch filters). The leaderboard's own list
//       was never supplied: an absent/filtered/foreign list
//       meant openFeed189 was never reached and the tap fell
//       back to the static detail; a reached feed swiped in
//       Watch order, not ranking order. The fix: rows call
//       homeLbOpenPlay243, which opens the feed with
//       homeLbIds243 — the leaderboard's OWN ordered ids
//       (This Month: CONTEST.entries; Hall of Fame: the
//       top-10 ranking homeLbFameRanked243 computes, the
//       same computation that renders the rows).
//   (B) "There is also no way to collapse it." The expanded
//       homepage board gains "Show less" (homeLbLess243) —
//       the expand control's mirror, same spot, same
//       .hlb230-more240 style — collapsing to the top 3 with
//       the tab preserved. Boards of ≤3 and empty boards
//       show neither control.
// This suite VM-drives the REAL handlers end to end: the
// real fameRowHtml134 rows, the real renderHomeLb230, the
// real homeLbOpenPlay243 and the real R189 feed core
// (openFeed189 / feedOnScroll189 / feedActivate189) — the
// assertions read the feed's own state (feed189.ids /
// feed189.index / the rendered track), never just a stub's
// call log. A scroll step (track.scrollTop + feedOnScroll189)
// is the swipe.
// Pins: app.js v238 / styles v227 (styles unchanged — the
// collapse control reuses .hlb230-more240).
// Run: node test-r243.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins + statics ----
assert(home.includes('src="app.js?v=241"') && home.includes('href="styles.css?v=229"'), "A: asset pins — app.js v238 (Round 243); styles keeps v227 (unchanged this round — the collapse control reuses .hlb230-more240) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
const rowFn = appJs.slice(appJs.indexOf("function fameRowHtml134"), appJs.indexOf("function renderFame"));
assert(rowFn.includes("homeLbOpenPlay243(${h.id})") && !rowFn.includes("opts.home232 ? `homeOpenPlay232"), "A: homepage leaderboard rows (opts.home232) call homeLbOpenPlay243 — the explicit-list opener, not homeOpenPlay232");
const lbBlock = appJs.slice(appJs.indexOf("/* ---------------- Round 243"), appJs.indexOf("function renderHomeLb230"));
assert(lbBlock.includes("function homeLbIds243") && lbBlock.includes("function homeLbFameRanked243") && lbBlock.includes("homeLbOpenPlay243"), "A: the Round 243 block carries the explicit ids builder, the shared Fame ranking and the opener");
const opener = appJs.slice(appJs.indexOf("window.homeLbOpenPlay243"), appJs.indexOf("function renderHomeLb230"));
assert(opener.includes("homeLbIds243()") && opener.includes("window.openFeed189(ids, nid, null)"), "A: the opener opens the feed with the leaderboard's own ids at the tapped play");
assert(!opener.includes("feedHeroIds223") && !opener.includes("querySelector") && !opener.includes("#allBoard") && !opener.includes("#monthRows"), "A: the opener consults NO DOM — no #allBoard/#monthRows scavenging (the defect's mechanism is gone from this path)");
assert(lbBlock.includes('onclick="homeLbLess243()">Show less</button>') && lbBlock.includes('class="hlb230-more240"'), "B: 'Show less' renders in the expand control's own style class (.hlb230-more240)");
const lessFn = appJs.slice(appJs.indexOf("function homeLbLess243()"), appJs.indexOf("/* The tail control"));
assert(lessFn.includes("homeLbFull240 = false") && lessFn.includes("renderHomeLb230()"), "B: homeLbLess243 collapses the state and repaints (no landing, no scroll — the tab and place are preserved) — →245: the repaint is now followed by homeLbReanchor245, a RESTORING scroll only: the bare repaint left the scroll position numerically put while the rows' height vanished, carrying Emil past the board into the next section; the re-anchor holds the leaderboard head on screen (and settles it at the top when the collapse started from the board's tail) — driven for real in test-r245");
const lbRender = appJs.slice(appJs.indexOf("function renderHomeLb230"), appJs.indexOf("function renderHomeMore230"));
assert(lbRender.includes("homeLbTailHtml243(rankedAll.length, ranked.length)") && lbRender.includes("homeLbTailHtml243(entries.length, shown240.length)"), "B: BOTH tabs render their tail through homeLbTailHtml243 (expand when short, collapse when expanded)");
assert(lbRender.includes("const rankedAll = homeLbFameRanked243();"), "A: the Fame rows render from homeLbFameRanked243 — the same computation that builds the feed list");
assert(css.includes(".hlb230-more240{"), "B: the shared tail-control style stands (styles.css untouched this round)");

// ---- shared VM sandbox: real helpers + real feed core + real R230/R232/R243 block ----
function mkEl(id) {
  return {
    id: id || "", innerHTML: "", hidden: false, disabled: false, children: [], attrs: {}, listeners: {}, scrolls: 0,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) REG.set(c.id, c); return c; },
    remove() { if (this.id) REG.delete(this.id); },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    scrollIntoView() { this.scrolls++; },
  };
}
const REG = new Map();
const ctasEl = mkEl(""); ctasEl.className = "hero-ctas";
for (const id of ["homeBattle230", "homeBattleBody230", "homeFeat230", "homeFeatBody230", "homeMore230", "homeMoreGrid230", "homeLbRows230", "homeLbTabMonth230", "homeLbTabFame230"])
  REG.set(id, mkEl(id));
const wrapEl = { hidden: true };
const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null };
const documentStub = {
  getElementById: (id) => REG.get(id) || null,
  querySelector: (sel) => (sel === ".hero-ctas" ? ctasEl : null),
  createElement: () => mkEl(""),
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
};
const line = (anchor) => { const i = appJs.indexOf(anchor); return appJs.slice(i, appJs.indexOf("\n", i)); };
const slice = (a, b) => appJs.slice(appJs.indexOf(a), appJs.indexOf(b));
const helpers = [
  line("const esc ="), line("const cap ="), line("const MONTHS ="), line("const CROWN227 ="),
  slice("function fmtCount151", "function fullName153"),
  slice("function shortTitle", "function featCardHtml134"),
  slice("function fameThumbHtml", "function renderFame"),
  slice("function splitHtml100", "/* ---- Daily Battle ---- */"),
].join("\n");
const feedCore = slice("/* Round 189 (2026-11-25): the watch feed", "/* ---------------- Round 230");
const block230 = appJs.slice(appJs.indexOf("/* ---------------- Round 230"));
const play = (id, label, athleteId, extra = {}) => ({
  id, title: "Play " + id, sport: "baseball", team: "", player_name: label, athlete_label: label,
  athlete_id: athleteId, media_kind: "file", mime: "video/mp4", media_url: "/uploads/x" + id + ".mp4",
  poster_url: "/uploads/poster-" + id + ".jpg", voteCount: 0, viewCount: 0, hasVoted: false, isSample: false, ...extra,
});
const P75 = play(75, "Kameron A.", "athK", { title: "Walk-off game winner", voteCount: 14, viewCount: 57 });
const P71 = play(71, "Nicholas B.", "athN", { title: "Double", team: "Plainview hawks", voteCount: 6, viewCount: 63 });
const P50 = play(50, "Charlotte", "athC", { title: "Gold and silver in both Kata and Kumite", sport: "martialarts", voteCount: 4, viewCount: 59 });
const P51 = play(51, "Juliana", "athJ", { title: "Caught stealing home!", sport: "softball", voteCount: 4 });
const P77 = play(77, "Marco", "athM", { title: "Ran for 40 yrds", sport: "football", voteCount: 2, viewCount: 5 });
const P201 = play(201, "Extra One", "athE1", { voteCount: 9 });
const P202 = play(202, "Extra Two", "athE2", { voteCount: 8 });
const PLAYS = Object.fromEntries([P75, P71, P50, P51, P77, P201, P202].map((p) => [p.id, p]));
const MONTH_IDS = [75, 71, 50, 51, 77];            // CONTEST.entries order
const FAME_IDS = [75, 201, 202, 71, 51, 50, 77];   // votes desc, id desc on ties (51 before 50)
const detailCalls = [], trackCalls = [];
const store = new Map();
const sb = {
  console, document: documentStub, setTimeout, clearTimeout,
  $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
  $$: () => [],
  requestAnimationFrame: (fn) => { fn(); return 0; },
  d100: { daily: null },
  CONTEST: { period: "2026-11", entries: [P75, P71, P50, P51, P77] },
  ALL_PLAYS: [P51, P77, P75, P50, P71, P201, P202],
  momentChipInline162: () => "",
  dailyPick100: async () => {},
  loadDaily100: async () => {},
  switchView: () => {},
  playAnotherBattle102: () => {},
  scrollBoardIntoView122: () => {},
  findPlay: (id) => PLAYS[id] || null,
  playHasVideo: (h) => h.media_kind === "file" && !(h.mime || "").startsWith("image/"),
  posterUrlFor134: (h) => h.poster_url || "",
  trackEvent: (kind, id) => { trackCalls.push([kind, id]); },
  toggleVote: async () => {},
  sharePlay: () => {},
  openPlayDetail: (id) => { detailCalls.push(id); },
  pauseMediaIn158: () => {},
  featPause163: () => {},
  hhStorageGet: (k) => store.get(k) || "",
  hhStorageSet: (k, v) => { store.set(k, String(v)); },
  btl: { cur: { L: 75, R: 71 } },
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(helpers + "\n" + feedCore + "\n" + block230, sb);
const $id = (id) => REG.get(id);
const run = (code) => vm.runInContext(code, sb);
const rowCount = (html) => (html.match(/data-tile-id=/g) || []).length;
const feedIds = () => run("JSON.stringify(feed189.ids)");
const closeFeed = () => { run("window.closeFeed189()"); trackEl.scrollTop = 0; };

// ---- C. Defect A: row taps open the swipe feed with the leaderboard's own list ----
// Short This Month board.
run("homeLbFull240 = false");
run('homeLbTab230 = "month"; renderHomeLb230()');
let lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 3 && lb.includes("homeLbOpenPlay243(75)") && lb.includes("homeLbOpenPlay243(71)"), "C: the short This Month board renders its rows wired to homeLbOpenPlay243");
assert(JSON.stringify(run("homeLbIds243()")) === JSON.stringify(MONTH_IDS), "C: homeLbIds243 (month) is the entries' own order — the full list, not the 3 rendered rows");
run("homeLbOpenPlay243(71)");
assert(run("feed189.open") === true && wrapEl.hidden === false, "C: a row tap on the SHORT month board opens the feed (no static-detail fallback)");
assert(feedIds() === JSON.stringify(MONTH_IDS) && run("feed189.index") === 1 && run("feed189.ids[feed189.index]") === 71, "C: the feed's list is the leaderboard's full order and it starts AT the tapped play (index 1 = play 71)");
assert(trackEl.innerHTML.indexOf('data-feed-slide="75"') > -1 && trackEl.innerHTML.indexOf('data-feed-slide="75"') < trackEl.innerHTML.indexOf('data-feed-slide="71"') && trackEl.innerHTML.indexOf('data-feed-slide="71"') < trackEl.innerHTML.indexOf('data-feed-slide="50"') && trackEl.innerHTML.indexOf('data-feed-end="1"') > trackEl.innerHTML.indexOf('data-feed-slide="77"'), "C: the rendered slides run in ranking order with the 'caught up' end card last — the TikTok feed, finite");
trackEl.scrollTop = 2 * 800; run("feedOnScroll189()");
assert(run("feed189.index") === 2 && run("feed189.ids[feed189.index]") === 50, "C: a swipe (scroll settle) moves to the NEXT ranked play (71 → 50)");
assert(trackCalls.filter(([k, id]) => k === "play_open" && id === 50).length === 1, "C: the swipe counts the settled play exactly once (feedActivate189 is doing the work)");
closeFeed();
// Expanded This Month board.
run("homeLbMore240()");
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 5, "C: the expanded month board renders all 5 rows");
run("homeLbOpenPlay243(77)");
assert(feedIds() === JSON.stringify(MONTH_IDS) && run("feed189.index") === 4, "C: a row tap on the EXPANDED month board opens the same full list at the tapped play (last row, index 4)");
closeFeed();
// Hall of Fame, short then expanded.
run("homeLbFull240 = false");
run('homeLbTab230 = "fame"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 3 && lb.indexOf('data-tile-id="75"') < lb.indexOf('data-tile-id="201"'), "C: the short Fame board renders its top 3 in ranking order");
assert(JSON.stringify(run("homeLbIds243()")) === JSON.stringify(FAME_IDS), "C: homeLbIds243 (fame) is the computed ranking — votes desc, id desc on the 4-vote tie (51 before 50), top 10");
run("homeLbOpenPlay243(202)");
assert(feedIds() === JSON.stringify(FAME_IDS) && run("feed189.index") === 2 && run("feed189.ids[feed189.index]") === 202, "C: a row tap on the SHORT Fame board opens the feed with the Fame ranking at the tapped play");
trackEl.scrollTop = 3 * 800; run("feedOnScroll189()");
assert(run("feed189.index") === 3 && run("feed189.ids[feed189.index]") === 71, "C: a swipe moves to the next Fame-ranked play (202 → 71)");
closeFeed();
run('homeLbLanding232("fame")');
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 7, "C: the expanded Fame board renders the full ranking (7)");
run("homeLbOpenPlay243(50)");
assert(feedIds() === JSON.stringify(FAME_IDS) && run("feed189.index") === 5, "C: a row tap on the EXPANDED Fame board opens the same ranking at the tapped play (last, index 5)");
closeFeed();
// Fallback contract: a stale id falls to the detail, exactly like openPlay189.
run("homeLbOpenPlay243(999)");
assert(detailCalls.includes(999) && run("feed189.open") === false, "C: a play no longer on the list falls back to the static detail — the feed never opens on a wrong list");

// ---- D. Defect B: collapse ----
run("homeLbFull240 = false");
run('homeLbTab230 = "month"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(lb.includes("View full leaderboard") && !lb.includes("Show less"), "D: the short board shows 'View full leaderboard' and no 'Show less'");
run("homeLbMore240()");
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 5 && lb.includes('onclick="homeLbLess243()">Show less</button>') && !lb.includes("View full leaderboard"), "D: the expanded board shows 'Show less' in the expand control's spot — and no expand link");
run("homeLbLess243()");
lb = $id("homeLbRows230").innerHTML;
assert(run("homeLbFull240") === false && rowCount(lb) === 3 && lb.includes("View full leaderboard") && !lb.includes("Show less"), "D: 'Show less' collapses back to exactly the top 3 with 'View full leaderboard' restored");
assert(run("homeLbTab230") === "month", "D: the collapse preserves the tab (still This Month)");
// Tab switch keeps the expansion state; collapse works there too.
run('homeLbLanding232("fame")');
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 7 && lb.includes("Show less"), "D: a fame landing expands the Fame tab with 'Show less' showing");
run('homeLbTab230 = "month"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 5 && lb.includes("Show less"), "D: switching tabs preserves the expanded state (R240's rule) — month shows all 5 + 'Show less'");
run("homeLbLess243()");
assert(run("homeLbTab230") === "month" && rowCount($id("homeLbRows230").innerHTML) === 3, "D: collapse on the switched tab keeps that tab and returns to its top 3");
// ≤3 and empty states: neither control, in either expansion state.
run("homeLbFull240 = false");
sb.CONTEST = { period: "2026-11", entries: [P75, P71] };
run('homeLbTab230 = "month"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 2 && !lb.includes("View full leaderboard") && !lb.includes("Show less"), "D: a 2-entry board shows NEITHER control");
run("homeLbFull240 = true; renderHomeLb230()");
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 2 && !lb.includes("Show less") && !lb.includes("View full leaderboard"), "D: a ≤3 board shows no 'Show less' even in the expanded state (nothing to collapse)");
run("homeLbFull240 = false");
sb.CONTEST = { period: "2026-11", entries: [] };
assert(run("renderHomeLb230()") === false && $id("homeLbRows230").innerHTML.includes("No entries yet") && !$id("homeLbRows230").innerHTML.includes("Show less") && !$id("homeLbRows230").innerHTML.includes("View full leaderboard"), "D: an empty month shows its empty line and NEITHER control");
sb.ALL_PLAYS = [];
run('homeLbTab230 = "fame"; renderHomeLb230()');
assert($id("homeLbRows230").innerHTML.includes("No plays yet") && !$id("homeLbRows230").innerHTML.includes("Show less"), "D: an empty Hall of Fame likewise shows no collapse control");

// ---- E. served smoke ----
{
  const tmp = fs.mkdtempSync("/tmp/hh-r243-");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: "3543", DATA_DIR: tmp },
    stdio: "ignore",
  });
  try {
    let servedHome = "", servedApp = "";
    for (let i = 0; i < 40; i++) {
      try {
        servedHome = await (await fetch("http://127.0.0.1:3543/")).text();
        if (servedHome) break;
      } catch { await wait(250); }
    }
    servedApp = await (await fetch("http://127.0.0.1:3543/app.js")).text();
    assert(servedHome.includes('src="app.js?v=241"') && servedHome.includes('href="styles.css?v=229"'), "E: the served homepage carries the Round 243 pins — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
    assert(servedApp.includes("homeLbOpenPlay243") && servedApp.includes("homeLbIds243") && servedApp.includes("Show less"), "E: the served app.js carries the explicit leaderboard opener and the collapse control");
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nALL R243 CHECKS PASSED");
