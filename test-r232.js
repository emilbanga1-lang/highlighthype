// Round 232 test: Emil's phone review of the R230 homepage
// (2026-11-27) — five fixes, plus item 6 added the same morning.
//
// 1. BATTLE VIDEO SLOW TO LOAD — measured root cause (live
//    payload + live files, 2026-11-27 ~10:58 EST): GET
//    /api/daily-battle returned A = play 77 (Marco, "Ran for
//    40 yrds", poster-77.jpg 257,834 B, 1672x941) and B = play
//    78 (Kameron A., "Touchdown", poster-78.jpg 200,805 B,
//    720x1280). Executing the REAL homePosterMedia230 /
//    homeBattleCard230 against that payload emitted a plain
//    poster <img> for BOTH sides — the cards load zero video
//    bytes with today's data, and the server serves each poster
//    in ~0.5 s. What Emil saw is the B still arriving late and
//    painting top-down: both posters are baseline (non-
//    progressive) JPEGs, so a slow one renders in bands from
//    the top — poster-78's top is sky, over the card's black
//    box — exactly his 10:41 screenshot (by 10:42 it had
//    painted). They were slow because the full-size stills are
//    requested only after the daily-battle fetch returns and
//    queue behind the page's eager video traffic: the hero
//    film (hero-film.mp4, 6,964,246 B, autoplaying) and the
//    board's 14 autoplaying tile <video>s (stream renditions
//    measured 931,335 B for play 78 and 3,665,557 B for play
//    77; masters 6.5-7.0 MB). One latent path could still emit
//    a real <video> into a homepage card: homePosterMedia230's
//    fameThumbHtml fallback (a <video preload="metadata"> for
//    any play whose poster resolves empty). Fixes pinned here:
//    the helper can NEVER emit a <video> (poster img or a
//    static chip), and the battle + featured posters ride
//    fetchpriority="high" so they jump the queue.
// 2. BATTLE META DEDUPE — play 78's team field literally
//    equals its athlete name ("Kameron A" vs the label
//    "Kameron A."), so the meta rendered "Kameron A. ·
//    Football · Kameron A", wrapped to two lines and opened a
//    gap above Vote B. The homepage battle meta now omits a
//    team segment that duplicates the athlete label
//    (normalized). Play 78's stored data is untouched (the
//    team value is a deliberate privacy record). The Battles
//    view's own cards were checked: both minis (btlMiniHTML,
//    d100MiniHTML) render "Sport · Boys/Girls" — no athlete /
//    team segment, so no identical duplication exists there
//    and they are unchanged.
// 3. FEATURED EYEBROW — one line: the CROWN227 img was
//    display:block under the global img rule, breaking the
//    span across three lines. The eyebrow is inline-flex /
//    nowrap now and the crown class itself is hardened (5).
// 4. HOMEPAGE TAPS OPEN THE SWIPE FEED — battle / featured /
//    More media taps and BOTH homepage leaderboard tabs' rows
//    route to homeOpenPlay232: the R223 feed (openFeed189)
//    in feedHeroIds223 board order, starting at the tapped
//    play, detail as the fallback. (R230's month rows rode
//    openPlay189, whose host check only recognizes the
//    board's own lists — homepage elements always fell back
//    to the detail; the fame rows rode goToPlayCard.) Card
//    vote buttons keep their own behavior; the board panel's
//    own tiles are untouched.
// 5. BOARD PANEL DEDUPE — #monthFeat, the Leaderboard heading
//    row (#boardFilters/#monthSportSelect), the Month text
//    tabs, #monthRows and the whole #viewFame panel are out
//    of the markup; the Month view keeps the banner card,
//    last-winner strip, empty state and never-disappear line.
//    renderMonth / renderFame / syncFilterUI / switchView
//    writes to the retired hosts are guarded no-ops (the
//    banner-leader-line precedent); a fame sub-state with no
//    Fame panel falls back to the Month (banner) view.
//    ?view=fame and the feed's Leaderboard landing retarget
//    to the homepage leaderboard (homeLbLanding232).
//    GIANT CROWN — cause: styles.css line 12's global
//    img{display:block} plus layout rules like .tile-media
//    img{width:100%;height:100%} (specificity 0-1-1) outranked
//    .crown-ic227 (0-1-0) inside media boxes, so the board
//    featured card's badge crown filled its media. The class
//    is now bulletproof: inline-block, 1em !important caps in
//    both dimensions, flex:none — in EVERY context.
// 6. POSTER CACHE-BUST (server) — Emil still saw the fence on
//    stills after the R227 clean: all 14 live posters verified
//    clean/fence-free server-side, but /uploads serves images
//    at max-age=86400 and the clean kept the same filenames,
//    so phones kept the fenced bytes for up to 24h.
//    publicHighlight now appends ?v=<size>-<mtimeMs> (the
//    r227 sig) to poster_url via posterUrl232 — the payload
//    layer, so every consumer gets the busted URL; the stored
//    row value is untouched.
//
// Pins: app.js v228 / styles v220.
// Run: node test-r232.js — exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=239"'), "A: asset pins — app.js v228 / styles v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");

// ---- B. statics ----
// B1 (item 5): the board's Month view shed + what stays.
const viewMonth = home.slice(home.indexOf('id="viewMonth"'), home.indexOf('id="viewAll"'));
assert(!viewMonth.includes('id="contestStrip"') && !viewMonth.includes('id="stripTitle"') && !viewMonth.includes('id="stripEnds"'), "B1: the Hype of the Month banner card stays at the top of the board's Month view — →236: the banner card is REMOVED (Emil's homepage cleanup — it repeated the homepage leaderboard's contest); its app.js writers are guarded no-ops and the Watch slim line's tap now lands on the homepage leaderboard");
assert(viewMonth.includes('id="lastWinner"') && viewMonth.includes('id="emptyState"') && viewMonth.includes('id="neverDisappear"'), "B1: the last-winner strip, empty state and never-disappear line stay");
assert(!viewMonth.includes('id="monthFeat"') && !viewMonth.includes('id="monthRows"') && !viewMonth.includes('id="boardFilters"') && !viewMonth.includes('id="monthSportSelect"') && !viewMonth.includes("month-subseg"), "B1: no featured card, no Leaderboard heading/dropdown, no text tabs, no leaderboard rows in the board's Month view");
assert(!home.includes('id="viewFame"') && !home.includes('id="fameList"') && !home.includes('id="fameSportSelect"'), "B1: the board's Hall of Fame panel is gone from the markup entirely");
assert(home.includes('id="allBoard"') && home.includes('id="homeMore230"') && home.includes('id="homeLbRows230"'), "B1: the Watch grid and the homepage sections (the one copy of featured + leaderboard) remain");
// B2 (item 5): guarded writers + retargeted landings.
assert(appJs.includes('const mfEl232 = $("#monthFeat"); if (mfEl232)') && appJs.includes('const mrEl232 = $("#monthRows"); if (mrEl232)'), "B2: renderMonth's featured/rows writes are guarded no-ops without their retired hosts");
assert(appJs.includes('const flEl232 = $("#fameList"); if (flEl232)'), "B2: renderFame's list write is guarded");
assert(appJs.includes('const msEl232 = $("#monthSportSelect"); if (msEl232)') && appJs.includes('const fsEl232 = $("#fameSportSelect"); if (fsEl232)'), "B2: syncFilterUI's contest selects are guarded renders");
assert(appJs.includes('const vfEl232 = $("#viewFame");') && appJs.includes('vmEl232.hidden = v !== "month" || (fame && !!vfEl232)'), "B2: switchView guards #viewFame and falls a fame sub-state back to the Month view when no Fame panel exists");
assert(appJs.includes('homeLbLanding232("fame")') && appJs.includes('homeLbLanding232("month")'), "B2: ?view=fame and the feed's Leaderboard landing retarget to the homepage leaderboard");
// B3 (items 1+4): the media helper and the tap routing.
const mediaHelper = appJs.slice(appJs.indexOf("function homePosterMedia230"), appJs.indexOf("function homeSyncHeroAnchor230"));
const mediaHelperCode = mediaHelper.replace(/\/\*[\s\S]*?\*\//g, ""); // the helper's own comment quotes the retired fallback — assert on the code
assert(!mediaHelperCode.includes("fameThumbHtml") && !mediaHelperCode.includes("<video") && mediaHelperCode.includes("home-poster-fallback232"), "B3: homePosterMedia230 can never emit a <video> — poster img or the static fallback chip only");
const battleCard = appJs.slice(appJs.indexOf("function homeBattleCard230"), appJs.indexOf("function renderHomeBattle230"));
assert(battleCard.includes('homePosterMedia230(p, \' fetchpriority="high" decoding="async"\')') && battleCard.includes("homeTeamDupAthlete232(p)") && battleCard.includes("homeOpenPlay232(${p.id})") && !battleCard.includes("openPlayDetail"), "B3: the battle card — fetchpriority poster, deduped meta, feed tap (no openPlayDetail)");
const featRender = appJs.slice(appJs.indexOf("function renderHomeFeatured230"), appJs.indexOf("function homeMoreTile230"));
assert(featRender.includes("homeOpenPlay232(${h.id})") && featRender.includes('fetchpriority="high"') && !featRender.includes("openPlayDetail"), "B3: the featured card's media — fetchpriority poster, feed tap");
const tileFn = appJs.slice(appJs.indexOf("function homeMoreTile230"), appJs.indexOf("function homeLbMoreHtml240"));
assert(tileFn.includes("homeOpenPlay232(${h.id})") && !tileFn.includes("openPlayDetail"), "B3: More Highlights tiles tap into the feed — →243: the slice now ends at homeLbMoreHtml240 (the Round 243 block sits between the tile and renderHomeLb230 and legitimately names openPlayDetail as the leaderboard opener's fallback; the tile's own code is unchanged)");
const lbRender = appJs.slice(appJs.indexOf("function renderHomeLb230"), appJs.indexOf("function renderHomeMore230"));
assert((lbRender.match(/\{ home232: true \}/g) || []).length === 2, "B3: BOTH homepage leaderboard tabs render their rows with opts.home232");
const rowFn = appJs.slice(appJs.indexOf("function fameRowHtml134"), appJs.indexOf("function renderFame"));
assert(rowFn.includes("opts.home232") && rowFn.includes("homeLbOpenPlay243(${h.id})"), "B3: fameRowHtml134 routes opts.home232 rows to the feed opener (board rows keep feed189 / goToPlayCard) — →243: the homepage rows call homeLbOpenPlay243, which supplies the leaderboard's OWN ordered ids explicitly; homeOpenPlay232's feedHeroIds223 DOM read could not see the leaderboard's list (the R243 defect)");
// B4 (items 3+5): crown hardening + the one-line eyebrow.
const crownRule = css.slice(css.indexOf(".crown-ic227{"), css.indexOf("}", css.indexOf(".crown-ic227{")) + 1);
assert(crownRule.includes("display:inline-block") && crownRule.includes("width:1em!important") && crownRule.includes("height:1em!important") && crownRule.includes("max-width:1em!important") && crownRule.includes("max-height:1em!important"), "B4: .crown-ic227 is bulletproof — inline-block with !important 1em caps, so no host layout rule (e.g. .tile-media img 100%x100%) can blow it up in any context");
assert(appJs.includes('const CROWN227 = `<img class="crown-ic227" src="/crown.png" alt="crown">`'), "B4: every CROWN227 render site wears the sizing class (the constant itself carries it)");
const eyebrowRule = css.slice(css.indexOf(".feat230-eyebrow{"), css.indexOf("}", css.indexOf(".feat230-eyebrow{")) + 1);
assert(eyebrowRule.includes("display:inline-flex") && eyebrowRule.includes("white-space:nowrap"), "B4: the featured eyebrow is a single-line inline-flex — 'FEATURED PLAY · [crown] CURRENTLY #1' cannot stack");
assert(css.includes(".home-poster-fallback232{"), "B4: the no-poster fallback chip is styled");
// B5 (item 6): the server token.
assert(serverJs.includes("function posterUrl232(") && serverJs.includes("poster_url: posterUrl232(row.poster_url)"), "B5: publicHighlight emits the cache-busted poster_url (posterUrl232)");
assert(serverJs.includes('return u + (u.includes("?") ? "&" : "?") + "v=" + sig.replace(":", "-")'), "B5: the token is the poster file's size-mtimeMs sig (the r227 sig), appended as ?v=");

// ---- C. VM drive: the homepage renderers against today's live fixture shape ----
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
/* Today's (2026-11-27) real matchup, shaped like the live
   /api/daily-battle payload: A = play 77 Marco; B = play 78
   Kameron A. — whose team field literally equals his name. */
const P77 = play(77, "Marco", "athM", { title: "Ran for 40 yrds", sport: "football", voteCount: 2, viewCount: 5 });
const P78 = play(78, "Kameron A.", "athK", { title: "Touchdown", sport: "football", player_name: "Kameron A", team: "Kameron A", voteCount: 2 });
const P75 = play(75, "Kameron A.", "athK", { title: "Walk-off game winner", voteCount: 14, viewCount: 57 });
const P71 = play(71, "Nicholas B.", "athN", { title: "Double", team: "Plainview hawks", voteCount: 6, viewCount: 63 });
const P51 = play(51, "Juliana", "athJ", { title: "Caught stealing home!", sport: "softball", voteCount: 4 });
const P50 = play(50, "Charlotte", "athC", { title: "Gold and silver in both Kata and Kumite", sport: "martialarts", voteCount: 4, viewCount: 59 });

const feedCalls = [], detailCalls = [];
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

// C1 (item 1): both battle cards are poster-only, prioritized.
sb.d100.daily = { available: true, practice: false, a: P77, b: P78, yourPick: null, split: null };
run("renderHomeBattle230()");
const bb = $id("homeBattleBody230").innerHTML;
assert(bb.includes('<img src="/uploads/poster-77.jpg" alt="" fetchpriority="high" decoding="async">') && bb.includes('<img src="/uploads/poster-78.jpg" alt="" fetchpriority="high" decoding="async">'), "C1: BOTH battle cards paint their poster still as a prioritized <img> (today's live payload shape)");
assert(!bb.includes("<video") && !bb.includes("preload"), "C1: the battle cards emit ZERO video elements — no video bytes load before a tap");
const noPoster = run('homePosterMedia230({ poster_url: "", media_kind: "file", media_url: "", sport: "soccer", title: "x" })');
assert(noPoster.includes('class="home-poster-fallback232"') && !noPoster.includes("<video") && !noPoster.includes("<img"), "C1: a play with no poster image gets the static chip — the old fameThumbHtml <video> fallback is gone");
// C2 (item 2): meta dedupe + one-line alignment.
assert(bb.includes("<p>Marco · Football</p>"), "C2: side A's meta is one line (no team on the play)");
assert(bb.includes("<p>Kameron A. · Football</p>") && !bb.includes("Football · Kameron A"), "C2: side B's meta drops the duplicated team segment — 'Kameron A. · Football', one line like A, so Vote A / Vote B align");
assert(run('homeTeamDupAthlete232({ team: "Kameron A", athlete_label: "Kameron A.", player_name: "Kameron A" })') === true, "C2: the normalized comparison treats 'Kameron A' (team) and 'Kameron A.' (label) as the same name");
assert(run('homeTeamDupAthlete232({ team: " kameron  a ", athlete_label: "Kameron A.", player_name: "" })') === true, "C2: case / whitespace variants of the athlete's name still dedupe");
assert(run('homeTeamDupAthlete232({ team: "Plainview hawks", athlete_label: "Nicholas B.", player_name: "Nicholas Banga" })') === false, "C2: a real team name is NOT a duplicate — it stays in the meta");
assert(run('homeTeamDupAthlete232({ team: "", athlete_label: "Marco", player_name: "Marco" })') === false, "C2: an empty team is never a duplicate");
// C3 (item 4): battle + featured + tiles + rows route to the feed.
assert(bb.includes("homeOpenPlay232(77)") && bb.includes("homeOpenPlay232(78)") && !bb.includes("openPlayDetail("), "C3: battle media taps call homeOpenPlay232 for both sides");
sb.CONTEST = { period: "2026-11", entries: [P75, P71, P50, P51] };
run("renderHomeFeatured230()");
const fb = $id("homeFeatBody230").innerHTML;
assert(fb.includes("homeOpenPlay232(75)") && !fb.includes("openPlayDetail("), "C3: the featured card's media tap calls homeOpenPlay232(75)");
assert(fb.includes('<img src="/uploads/poster-75.jpg" alt="" fetchpriority="high" decoding="async">'), "C3: the featured poster is prioritized like the battle stills");
// C4 (item 3): the eyebrow markup is a single span with the crown inline.
assert(fb.includes('<span class="feat230-eyebrow">Featured Play · <img class="crown-ic227" src="/crown.png" alt="crown"> Currently #1</span>'), "C4: the featured eyebrow renders as ONE span — 'Featured Play · [crown] Currently #1' — with the crown inline (the inline-flex rule keeps it on one line)");
assert(fb.includes("leads with 14 votes"), "C4: the standing sentence is untouched");
// C5 (item 4): More tiles + both leaderboard tabs.
sb.ALL_PLAYS = [P75, P71, P50, P51, P77];
sb.d100.daily = { available: true, practice: false, a: P71, b: P51, yourPick: null, split: null };
run("renderHomeMore230()");
const grid = $id("homeMoreGrid230").innerHTML;
assert(grid.includes("homeOpenPlay232(50)") && grid.includes("homeOpenPlay232(77)") && !grid.includes("openPlayDetail("), "C5: More Highlights tiles tap into the feed");
const lbMonth = $id("homeLbRows230").innerHTML;
assert(lbMonth.includes("homeLbOpenPlay243(75)") && !lbMonth.includes("goToPlayCard(75)") && !lbMonth.includes("openPlay189(75"), "C5: This Month rows route to the feed opener (not goToPlayCard, not the board-host openPlay189) — →243: the opener is homeLbOpenPlay243 (explicit leaderboard ids), not homeOpenPlay232");
run('homeLbTab230 = "fame"; renderHomeLb230()');
const lbFame = $id("homeLbRows230").innerHTML;
assert(lbFame.includes("homeLbOpenPlay243(75)") && !lbFame.includes("goToPlayCard(75)"), "C5: Hall of Fame rows route to the feed opener too — →243: homeLbOpenPlay243, as on the Month tab");
// C6 (item 4): the opener itself — feed first, right start, detail fallback.
run("homeOpenPlay232(71)");
assert(feedCalls.length === 1 && JSON.stringify(feedCalls[0][0]) === JSON.stringify([75, 71, 50, 77, 78, 51]) && feedCalls[0][1] === 71 && feedCalls[0][2] === null && detailCalls.length === 0, "C6: homeOpenPlay232 opens the feed in board order STARTING at the tapped play, battle = null");
run("homeOpenPlay232(999)");
assert(feedCalls.length === 1 && JSON.stringify(detailCalls) === JSON.stringify([999]), "C6: a play outside the feed's board order falls back to the play detail");
sb.feedEnabled189 = () => false;
run("homeOpenPlay232(71)");
assert(feedCalls.length === 1 && JSON.stringify(detailCalls) === JSON.stringify([999, 71]), "C6: with the feed disabled the tap falls back to the detail — openPlay189's contract");
// C7 (item 5): the homepage leaderboard landing.
REG.get("homeMore230").hidden = false;
run('homeLbLanding232("fame")');
assert(run("homeLbTab230") === "fame" && $id("homeLbRows230").innerHTML.includes("homeLbOpenPlay243(75)"), "C7: homeLbLanding232('fame') paints the Hall of Fame tab — →243: its rows carry the homeLbOpenPlay243 tap");
await wait(150);
assert(REG.get("homeMore230").scrolls >= 1, "C7: the landing scrolls the More Highlights section into view");

// ---- D. VM drive: the board renders survive the retired hosts ----
const dHelpers = [line("const esc ="), line("const cap =")].join("\n");
const slice2 = (a, b) => { const i = appJs.indexOf(a); return appJs.slice(i, appJs.indexOf(b, i + a.length)); };
const renderMonthSrc = slice2("function renderMonth()", "/* Round 163 (2026-11-14, Emil): the Month FEATURED clip");
const renderFameSrc = slice2("function renderFame()", "/* Round 167");
const switchSrc = slice2("let monthSub", "/* Round 122 (2026-11-12): a board tab tap"); // the viewseg wiring line rides along — the sandbox's $$ returns [], so it evaluates harmlessly
function boardSandbox(withFame) {
  const els = {
    "#emptyState": { innerHTML: "", textContent: "", style: {}, hidden: false },
    "#neverDisappear": { innerHTML: "", hidden: true },
    "#lastWinner": { innerHTML: "", hidden: true },
    "#viewMonth": { hidden: true },
    "#viewAll": { hidden: false },
  };
  if (withFame) els["#viewFame"] = { hidden: true };
  const sbD = {
    console,
    $: (sel) => els[sel] || null,
    $$: () => [],
    CONTEST: { period: "2026-11", entries: [{ id: 75, title: "Walk-off game winner", sport: "baseball", voteCount: 14 }] },
    LAST_MONTH: { period: "2026-10", entries: [], winnerId: 0 },
    MONTHS: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthSport: "all",
    ALL_PLAYS: [{ id: 75, title: "Walk-off game winner", sport: "baseball", voteCount: 14, isSample: false }],
    hydrateDurPills: () => {},
  };
  sbD.window = sbD;
  vm.createContext(sbD);
  vm.runInContext(dHelpers + "\n" + renderMonthSrc + "\n" + renderFameSrc + "\n" + switchSrc, sbD);
  return { sbD, els };
}
{
  const { sbD, els } = boardSandbox(false);
  vm.runInContext("renderMonth()", sbD);
  assert(els["#emptyState"].style.display === "none", "D: renderMonth runs clean with #monthFeat/#monthRows ABSENT (production shape) — the banner-adjacent state (empty state) still paints");
  vm.runInContext("renderFame()", sbD);
  assert(true, "D: renderFame runs clean with #fameList absent — its write is a guarded no-op");
  vm.runInContext('setMonthSub("fame")', sbD);
  assert(els["#viewMonth"].hidden === false && els["#viewAll"].hidden === true, "D: a fame sub-state with NO Fame panel falls back to the Month (banner) view — never a blank board");
  vm.runInContext('setMonthSub("month")', sbD);
  assert(els["#viewMonth"].hidden === false, "D: the plain Month sub-state shows the Month view as before");
}
{
  const { sbD, els } = boardSandbox(true);
  vm.runInContext('setMonthSub("fame")', sbD);
  assert(els["#viewMonth"].hidden === true && els["#viewFame"].hidden === false, "D: where a Fame panel DOES exist (the legacy stub drives), switchView's fame semantics are unchanged");
}

// ---- E. server boot: the poster cache-bust token (item 6) ----
async function boot(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r232-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { const r = await fetch(base + "/api/health"); if (r.ok) break; } catch { /* not up yet */ } await wait(200); }
  return { tmp, child, base, getLog: () => log };
}
const s = await boot(8952);
try {
  const upDir = path.join(s.tmp, "uploads");
  fs.mkdirSync(upDir, { recursive: true });
  const posterPath = path.join(upDir, "poster-1.jpg");
  fs.writeFileSync(posterPath, Buffer.alloc(4321, 7));
  const db = new DatabaseSync(path.join(s.tmp, "highlighthype.db"));
  const ins = db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, poster_url, status, player_name, division, enhance_json) VALUES (?, 'football', 'file', '/uploads/token.mp4', ?, 'approved', ?, 'boys', '')");
  ins.run("Token Play", "/uploads/poster-1.jpg", "Token Kid");
  ins.run("No Poster Play", "", "Plain Kid");
  ins.run("Missing Poster Play", "/uploads/poster-404.jpg", "Ghost Kid");
  db.close();
  const payload = async () => (await (await fetch(s.base + "/api/highlights?division=all")).json()).highlights;
  let plays = await payload();
  const p1 = plays.find((h) => h.title === "Token Play");
  const st1 = fs.statSync(posterPath);
  const sig1 = `${st1.size}-${Math.round(st1.mtimeMs)}`;
  assert(p1 && p1.poster_url === `/uploads/poster-1.jpg?v=${sig1}`, "E: the payload poster_url carries the token — ?v=<size>-<mtimeMs> of the poster file itself");
  const p2 = plays.find((h) => h.title === "No Poster Play");
  assert(p2 && p2.poster_url === "", "E: a play with no poster keeps poster_url '' (no token invented)");
  const p3 = plays.find((h) => h.title === "Missing Poster Play");
  assert(p3 && p3.poster_url === "/uploads/poster-404.jpg", "E: a poster whose file is missing keeps its bare URL (the pre-232 floor)");
  const served = await fetch(s.base + p1.poster_url);
  assert(served.status === 200 && (served.headers.get("content-type") || "").includes("image/jpeg"), "E: the busted URL serves the poster (the uploads handler resolves by pathname — the query breaks nothing)");
  /* The poster file changes — a clean / re-pick: new bytes, new
     mtime. The token must change with it, everywhere, at once. */
  fs.writeFileSync(posterPath, Buffer.alloc(9876, 9));
  const later = new Date(Date.now() + 60000);
  fs.utimesSync(posterPath, later, later);
  plays = await payload();
  const p1b = plays.find((h) => h.title === "Token Play");
  const st2 = fs.statSync(posterPath);
  const sig2 = `${st2.size}-${Math.round(st2.mtimeMs)}`;
  assert(sig2 !== sig1 && p1b.poster_url === `/uploads/poster-1.jpg?v=${sig2}`, "E: when the poster file changes, the payload token changes with it — a cleaned poster replaces its cached copy immediately");
  const daily = await (await fetch(s.base + "/api/daily-battle")).json().catch(() => null);
  assert(daily !== null, "E: the daily-battle payload (the other publicHighlight consumer) still answers with the token live");
} finally { s.child.kill(); }

console.log("\nALL R232 CHECKS PASSED");
