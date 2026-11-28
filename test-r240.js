// Round 240 (2026-11-27): Emil's homepage review fixes.
// Emil reviewed the R230 homepage, praised the layout ("keep
// this layout") and approved this exact mapping ("Yes, it
// maps"):
//   (1) BATTLE LABELING — the homepage card stays "Today's
//       Battle" (it IS the daily matchup; picks stay
//       just-for-fun per Round 179). The skip is relabeled
//       "Try another battle" (same homeBattleSkip230 path into
//       Quick Battles), and ONE clarifier line names the card
//       the official daily matchup whose votes decide today.
//   (2) MOMENT THUMBNAILS — poster re-picks for plays 75 and
//       51, chosen by eye from the videos: 75 → 17.5s (the
//       follow-through), 51 → 4.0s (the tag, no player UI).
//       The posters live in PRODUCTION DATA, not the repo —
//       section E verifies the deploy artifacts + note in
//       ../highlighthype-deploy-r240/ when that folder is
//       present, and pins the server statics the note relies
//       on (posterUrl232's file sig; poster_time precedence;
//       the backfill's re-pick guard that makes the note's
//       DB-first ordering load-bearing).
//   (3) HOMEPAGE LEADERBOARD → TOP 3 — renderHomeLb230 renders
//       3 rows + a "View full leaderboard" link until a
//       full-board landing (homeLbLanding232 — the fame/month
//       links' destination, and the link's own) expands the
//       section to the complete rankings. The full leaderboard
//       itself is unchanged; More Highlights tiles unchanged.
//   (4) ONE-TAP CHECK — the hero's Watch Highlights must open
//       a playable clip in one tap (R223). Section F drives
//       the REAL capture listener → openHeroFeed223 →
//       feedHeroIds223 chain; the final link (openFeed189 →
//       the entry slide's video playing, sound applied first)
//       is pinned statically here and driven for real by
//       test-r196 W1 (openFeed189 settles with the entry
//       video playing) in the standing regression.
// Pins: app.js v236 / styles v226.
// Run: node test-r240.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { execFileSync, spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('src="app.js?v=241"') && home.includes('href="styles.css?v=229"'), "A: asset pins — app.js v236 / styles v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");

// ---- B. statics ----
// B1 (item 1): the clarifier + the relabeled skip.
const battleRender = appJs.slice(appJs.indexOf("function renderHomeBattle230"), appJs.indexOf("function renderHomeFeatured230"));
assert(battleRender.includes(`<p class="hb230-official240">Today's official matchup — votes here decide today's winner.</p>`), "B1: the official-day card carries the one-line clarifier in the practice line's slot");
assert((appJs.split("Today's official matchup — votes here decide today's winner.").length - 1) === 1, "B1: the clarifier copy exists EXACTLY once in app.js — one line, one place");
assert(battleRender.includes("Practice matchup · Picks are just for fun"), "B1: the practice day's own label stands (the clarifier never shows on a practice day — VM-proven in C)");
assert(battleRender.includes('onclick="homeBattleSkip230()">Try another battle →</button>'), "B1: the skip reads 'Try another battle →' and still calls homeBattleSkip230");
assert(!battleRender.includes("Skip matchup"), "B1: no 'Skip matchup' label remains on the homepage card");
assert(home.includes('id="btlSkip">Skip matchup</button>'), "B1: the Battles VIEW's own Daily-card skip is untouched — the relabel is the homepage card only");
const skipFn = appJs.slice(appJs.indexOf("function homeBattleSkip230()"), appJs.indexOf("function renderHomeFeatured230"));
assert(skipFn.includes('switchView("battles")') && skipFn.includes("playAnotherBattle102()"), "B1: the skip's path is unchanged — Battles view + a fresh Quick matchup (behavior driven in C)");
const officialRule = css.slice(css.indexOf(".hb230-official240{"), css.indexOf("}", css.indexOf(".hb230-official240{")) + 1);
const practiceRule = css.slice(css.indexOf(".hb230-practice{"), css.indexOf("}", css.indexOf(".hb230-practice{")) + 1);
assert(officialRule.includes("text-align:center") && officialRule.includes("font-size:13.5px") && practiceRule.includes("font-size:13.5px"), "B1: the clarifier is styled as the practice line's twin (the card's existing small print)");
// B2 (item 3): the short render + the link + the landing expansion.
const lbRender = appJs.slice(appJs.indexOf("function renderHomeLb230"), appJs.indexOf("function renderHomeMore230"));
assert(lbRender.includes("rankedAll.slice(0, 3)") && lbRender.includes("entries.slice(0, 3)"), "B2: BOTH homepage tabs render short — top 3 rows (Hall of Fame from its top-10 ranking; This Month from the entries)");
assert(lbRender.includes("homeLbTailHtml243(rankedAll.length, ranked.length)") && lbRender.includes("homeLbTailHtml243(entries.length, shown240.length)"), "B2: the View-full link renders only while rows remain hidden (never on a short or empty board) — →243: both branches render their tail through homeLbTailHtml243, which returns the expand link when short and the new 'Show less' collapse when expanded (driven in test-r243)");
assert(appJs.includes("View full leaderboard") && appJs.includes('onclick="homeLbMore240()"'), "B2: the link is 'View full leaderboard' and calls homeLbMore240");
const moreFn = appJs.slice(appJs.indexOf("function homeLbMore240()"), appJs.indexOf("function renderHomeLb230"));
assert(moreFn.includes("homeLbFull240 = true") && !moreFn.includes("homeLbLanding232(") && moreFn.includes("renderHomeLb230()"), "B2: the link lands through homeLbLanding232 — the existing full-board landing, on the current tab — →245: NO LONGER. Emil tapped the link standing AT the board and the landing's section-top scroll threw him up to More Highlights; the in-section link now expands in place (state + repaint via renderHomeLb230, re-anchored) and never calls the landing — the landing still serves arrivals from other surfaces (driven in test-r245)");
const landingFn = appJs.slice(appJs.indexOf("function homeLbLanding232(tab)")); // the landing is app.js's last function
assert(landingFn.includes("homeLbFull240 = true") && landingFn.includes("renderHomeLb230()"), "B2: EVERY full-board landing expands the section before repainting — fame/month links keep landing on the complete rankings");
assert(css.includes(".hlb230-more240{"), "B2: the View-full link is styled (the battle skip's quiet text-button treatment)");
const moreRender = appJs.slice(appJs.indexOf("function renderHomeMore230"), appJs.indexOf("function renderHome230()"));
assert(moreRender.includes(".slice(0, 4)") && moreRender.includes("renderHomeLb230()"), "B2: More Highlights itself is unchanged — same 4 tiles, same leaderboard call");
// B3 (item 4): the one-tap chain's links, statically.
assert(home.includes('class="btn btn-lime btn-hero" href="#deck" data-tablink="plays"') && home.includes("Watch Highlights"), "B3: the hero's Watch Highlights anchor stands (btn-hero + data-tablink=\"plays\" — the listener's selector)");
const heroBlock = appJs.slice(appJs.indexOf("function feedHeroIds223"), appJs.indexOf("/* ---------------- Round 230"));
assert(heroBlock.includes("openFeed189(ids, ids[0], null)") && heroBlock.includes('a.btn-hero[data-tablink="plays"]') && heroBlock.includes("{ capture: true }"), "B3: the capture-phase listener claims a hero tap and opens the feed at the board's FIRST play, battle = null");
const activateFn = appJs.slice(appJs.indexOf("function feedActivate189(index)"), appJs.indexOf("function feedSettle189"));
assert(activateFn.indexOf("feedApplySound194(v)") > -1 && activateFn.indexOf("v.play()") > activateFn.indexOf("feedApplySound194(v)"), "B3: activation applies the sound state (muted-first per Round 194) and then plays the settled slide — the feed opens PLAYING, autoplay-safe");

// ---- shared VM sandbox (mirrors test-r232's) ----
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
const documentStub = {
  getElementById: (id) => REG.get(id) || null,
  querySelector: (sel) => (sel === ".hero-ctas" ? ctasEl : null),
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
const P71 = play(71, "Nicholas B.", "athN", { title: "Double", team: "Plainview hawks", voteCount: 6, viewCount: 63 });
const P51 = play(51, "Juliana", "athJ", { title: "Caught stealing home!", sport: "softball", voteCount: 4 });
const P50 = play(50, "Charlotte", "athC", { title: "Gold and silver in both Kata and Kumite", sport: "martialarts", voteCount: 4, viewCount: 59 });
const P201 = play(201, "Extra One", "athE1", { voteCount: 9 });
const P202 = play(202, "Extra Two", "athE2", { voteCount: 8 });

const feedCalls = [], detailCalls = [], calls = { view: [], another: 0 };
const sb = {
  console, document: documentStub, setTimeout, clearTimeout,
  d100: { daily: null },
  CONTEST: { period: "2026-11", entries: [] },
  ALL_PLAYS: [],
  momentChipInline162: () => "",
  dailyPick100: async () => {},
  loadDaily100: async () => {},
  switchView: (v) => { calls.view.push(v); },
  playAnotherBattle102: () => { calls.another++; },
  scrollBoardIntoView122: () => {},
  openPlayDetail: (id) => { detailCalls.push(id); },
  feedEnabled189: () => true,
  feedHeroIds223: () => [75, 71, 50, 77, 78, 51],
  openFeed189: (ids, startId, battle) => { feedCalls.push([ids, startId, battle]); return true; },
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(helpers + "\n" + block230, sb);
const $id = (id) => REG.get(id);
const run = (code) => vm.runInContext(code, sb);
const rowCount = (html) => (html.match(/data-tile-id=/g) || []).length;

// ---- C. VM drive: the battle card (item 1) ----
sb.d100.daily = { available: true, practice: false, a: P77, b: P78, yourPick: null, split: null };
run("renderHomeBattle230()");
let bb = $id("homeBattleBody230").innerHTML;
assert((bb.split("hb230-official240").length - 1) === 1 && bb.includes("Today's official matchup — votes here decide today's winner."), "C: an official day renders the clarifier exactly once");
assert(bb.includes("Try another battle →") && !bb.includes("Skip matchup") && !bb.includes("hb230-practice"), "C: the official card's skip is 'Try another battle' — no old label, no practice line");
sb.d100.daily = { available: true, practice: false, a: P77, b: P78, yourPick: P77.id, split: { aPct: 60, bPct: 40, total: 5 } };
run("renderHomeBattle230()");
bb = $id("homeBattleBody230").innerHTML;
assert(bb.includes("hb230-official240"), "C: the clarifier survives the picked state (the split showing doesn't displace it)");
sb.d100.daily = { available: true, practice: true, a: P77, b: P78, yourPick: null, split: null };
run("renderHomeBattle230()");
bb = $id("homeBattleBody230").innerHTML;
assert(bb.includes("Practice matchup · Picks are just for fun") && !bb.includes("hb230-official240"), "C: a practice day shows its own label and NEVER the official clarifier");
run("homeBattleSkip230()");
assert(calls.view.includes("battles") && calls.another === 1, "C: 'Try another battle' rides the unchanged path — Battles view + a fresh Quick matchup");

// ---- D. VM drive: the homepage leaderboard (item 3) ----
sb.d100.daily = { available: true, practice: false, a: P71, b: P51, yourPick: null, split: null };
sb.CONTEST = { period: "2026-11", entries: [P75, P71, P50, P51, P77] };
sb.ALL_PLAYS = [P75, P71, P50, P51, P77];
run("renderHomeMore230()");
let lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 3 && lb.indexOf('data-tile-id="75"') > -1 && lb.indexOf('data-tile-id="75"') < lb.indexOf('data-tile-id="71"'), "D: the homepage's first render is the TOP 3 — the leader's #1 row first (Kameron's row stays)");
assert(lb.includes("View full leaderboard") && lb.includes('onclick="homeLbMore240()"'), "D: the short render ends with the 'View full leaderboard' link");
assert(run("homeLbFull240") === false, "D: nothing has expanded the section yet");
assert($id("homeMoreGrid230").innerHTML.includes("homeOpenPlay232(50)"), "D: More Highlights tiles render as before alongside the short board");
const scrollsBefore245 = $id("homeMore230").scrolls;
run("homeLbMore240()");
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(run("homeLbFull240") === true && rowCount(lb) === 5 && !lb.includes("View full leaderboard"), "D: the link expands the SAME section to all 5 entries — the complete This Month rankings, no link left over");
assert($id("homeMore230").scrolls === scrollsBefore245, "D: the expansion lands like every full-board landing — the section scrolls into view — →245: NO LONGER. The in-section link expands in place and the section does NOT scroll (the landing's section-top scroll threw Emil up to More Highlights on the live site); the landing + its scroll still serve arrivals from other surfaces (test-r245)");
run("homeLbFull240 = false");
sb.ALL_PLAYS = [P75, P201, P202, P71, P51, P50];
run('homeLbTab230 = "fame"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 3 && lb.indexOf('data-tile-id="75"') > -1 && lb.includes("View full leaderboard"), "D: the Hall of Fame tab is short too — its top 3 (the 14-vote leader first) + the link");
run('homeLbLanding232("fame")');
await wait(160);
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 6 && !lb.includes("View full leaderboard"), "D: a fame landing paints the FULL Hall of Fame ranking (all 6) — landings never land on a short board");
run("homeLbFull240 = false");
sb.CONTEST = { period: "2026-11", entries: [P75, P71] };
run('homeLbTab230 = "month"; renderHomeLb230()');
lb = $id("homeLbRows230").innerHTML;
assert(rowCount(lb) === 2 && !lb.includes("View full leaderboard"), "D: a board with ≤3 entries renders them all with NO link (nothing hidden, nothing to expand)");
sb.CONTEST = { period: "2026-11", entries: [] };
assert(run("renderHomeLb230()") === false && $id("homeLbRows230").innerHTML.includes("No entries yet") && !$id("homeLbRows230").innerHTML.includes("View full leaderboard"), "D: an empty month keeps its empty line and gains no link");

// ---- E. poster re-picks (item 2): server statics + deploy artifacts ----
const ptBlock = serverJs.slice(serverJs.indexOf("let posterTime223"), serverJs.indexOf("poster_time: posterTime223"));
assert(ptBlock.indexOf("r209") > -1 && ptBlock.indexOf("r227time") > ptBlock.indexOf("r209"), "E: poster_time precedence stands — the r209 smart pick wins, the r227time grab record is the fallback (the deploy note writes each play's operative field)");
assert(serverJs.includes("function posterUrl232(") && serverJs.includes("r227PosterSig227(absPoster)") && serverJs.includes('return st.size + ":" + Math.round(st.mtimeMs)'), "E: the cache-bust token is the poster file's own size:mtimeMs sig — a replaced poster file busts itself on every surface");
assert(serverJs.includes('r209ProcessPlay(bins, row.id, "backfill")') && serverJs.includes("no recorded frame"), "E: the boot backfill re-picks a poster with NO recorded frame time — the reason the deploy note's DB-first ordering is load-bearing for play 75");
const deployDir = path.join(ROOT, "..", "highlighthype-deploy-r240");
if (fs.existsSync(deployDir)) {
  const probeDims = (f) => execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", f], { encoding: "utf8" }).trim();
  const p75 = path.join(deployDir, "posters", "poster-75.jpg");
  const p51 = path.join(deployDir, "posters", "poster-51.jpg");
  assert(fs.existsSync(p75) && probeDims(p75) === "1920,1080", "E: the play-75 poster artifact exists at the production poster's exact dimensions (1920x1080)");
  assert(fs.existsSync(p51) && probeDims(p51) === "1556,720", "E: the play-51 poster artifact exists at the production poster's exact dimensions (1556x720)");
  for (const [f, name] of [[p75, "poster-75"], [p51, "poster-51"]]) {
    const buf = fs.readFileSync(f);
    assert(buf[0] === 0xff && buf[1] === 0xd8 && buf.length > 50000, `E: ${name} is an honest JPEG of real size (${buf.length} B) — the pipeline's -q:v 3 grab shape`);
  }
  const note = fs.readFileSync(path.join(deployDir, "DEPLOY-NOTE.md"), "utf8");
  assert(note.includes("17.5") && note.includes("4.0") && note.includes("r227time") && note.includes("r209.chosenTime"), "E: the deploy note carries both poster_time values and the exact enhance_json fields to write (r227time for 75, r209.chosenTime for 51)");
  assert(note.includes("database FIRST") && note.includes("poster-75.jpg") && note.includes("poster-51.jpg"), "E: the deploy note orders the data step FIRST (before the file swap) and names both target files");
} else {
  console.log("ok - E: deploy artifacts folder not present in this checkout — artifact assertions skipped (the posters are a production-data deploy, not repo files)");
}

// ---- F. VM drive: Watch Highlights, one tap (item 4) ----
{
  const listeners = [];
  const tiles = ["75", "71", "50"].map((v) => ({ getAttribute: () => v }));
  const boardEl = { querySelectorAll: () => tiles };
  const docF = {
    addEventListener: (type, fn, opts) => { listeners.push({ type, fn, opts }); },
    querySelector: (sel) => (sel === "#allBoard" ? boardEl : null),
  };
  let feedOn = true, feedResult = true;
  const fCalls = [];
  const sbF = {
    console, document: docF,
    feedEnabled189: () => feedOn,
    openFeed189: (ids, startId, battle) => { fCalls.push([ids, startId, battle]); return feedResult; },
  };
  sbF.window = sbF;
  vm.createContext(sbF);
  vm.runInContext(heroBlock, sbF);
  assert(listeners.length === 1 && listeners[0].type === "click" && listeners[0].opts && listeners[0].opts.capture === true, "F: the hero listener is registered once, on click, in the CAPTURE phase (it runs before the anchor's own deck-scroll handler)");
  let pd = 0, sp = 0;
  const heroEvent = { target: { closest: (sel) => (sel === 'a.btn-hero[data-tablink="plays"]' ? {} : null) }, preventDefault: () => { pd++; }, stopPropagation: () => { sp++; } };
  listeners[0].fn(heroEvent);
  assert(fCalls.length === 1 && JSON.stringify(fCalls[0][0]) === JSON.stringify([75, 71, 50]) && fCalls[0][1] === 75 && fCalls[0][2] === null, "F: ONE tap on Watch Highlights opens the feed at the board's first play, in board order, battle = null");
  assert(pd === 1 && sp === 1, "F: the opened feed CLAIMS the tap (preventDefault + stopPropagation) — the deck scroll does not also fire");
  const otherEvent = { target: { closest: () => null }, preventDefault: () => { pd++; }, stopPropagation: () => { sp++; } };
  listeners[0].fn(otherEvent);
  assert(fCalls.length === 1 && pd === 1, "F: a tap anywhere else is ignored by the listener");
  feedResult = false;
  listeners[0].fn(heroEvent);
  assert(fCalls.length === 2 && pd === 1 && sp === 1, "F: when the feed cannot open, the tap is NOT claimed — it falls through to the standing deck scroll, exactly the pre-R223 behavior");
  feedResult = true; feedOn = false;
  assert(vm.runInContext("window.openHeroFeed223()", sbF) === false, "F: the feed kill switch stands the hero entry down");
  listeners[0].fn(heroEvent);
  assert(pd === 1, "F: with the kill switch off, the hero tap falls through unclaimed");
}

// ---- G. served smoke ----
{
  const tmp = fs.mkdtempSync("/tmp/hh-r240-");
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: "3541", DATA_DIR: tmp },
    stdio: "ignore",
  });
  try {
    let servedHome = "", servedApp = "";
    for (let i = 0; i < 40; i++) {
      try {
        servedHome = await (await fetch("http://127.0.0.1:3541/")).text();
        if (servedHome) break;
      } catch { await wait(250); }
    }
    servedApp = await (await fetch("http://127.0.0.1:3541/app.js")).text();
    assert(servedHome.includes('src="app.js?v=241"') && servedHome.includes('href="styles.css?v=229"'), "G: the served homepage carries the Round 240 pins — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
    assert(servedApp.includes("Today's official matchup — votes here decide today's winner.") && servedApp.includes("Try another battle →") && servedApp.includes("View full leaderboard"), "G: the served app.js carries the clarifier, the relabeled skip and the View-full link");
  } finally {
    child.kill();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nALL R240 CHECKS PASSED");
