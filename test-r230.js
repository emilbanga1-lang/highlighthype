// Round 230 (2026-11-27) — the B2 homepage rebuild, approved by
// Emil from the B2 mock with his own revisions:
//   A. Statics: pins v226/v219; the hero keeps its film + Watch
//      Highlights and gains ONLY the explainer line (verbatim)
//      in markup — the battle anchor is JS-inserted, never
//      static; the three new sections ship in B2 order on the
//      home flow (hero → battle → featured → more → merch →
//      final → trust → footer), carry .view-home + hidden, and
//      Hype Stories has NO homepage section (its menu link and
//      its own panel page are untouched).
//   B. Wiring statics: renderAll calls renderHome230 behind the
//      house typeof guard; loadDaily100 re-renders the home
//      sections at BOTH exits; the R230 block calls the same
//      dailyPick100 / toggleVote the board uses and makes NO
//      api() calls of its own (no new endpoints — server.js
//      carries no Round 230 code).
//   C. VM drive of the real R230 block against a fake DOM:
//      battle card renders from d100.daily (poster stills, name
//      below the image, Vote A/Vote B); the hero anchor appears
//      with a battle and is REMOVED without one; a home pick
//      calls dailyPick100 with the same slot and the picked
//      state re-renders (crown Your pick + split); a pick made
//      "on the Battles surface" (state changed + the
//      loadDaily100 hook path) shows identically at home; the
//      loader is kicked exactly once when the daily hasn't
//      landed; the featured card combines play + standing from
//      a CONTEST-shaped payload; More Highlights excludes the
//      battle pair + featured athlete BY IDENTITY (athlete_id,
//      and by label when an id is missing — the featured
//      athlete's other plays go too); the leaderboard inside
//      the section is complete (every entry, leader first) and
//      its Hall of Fame tab mirrors renderFame's ranking
//      (samples excluded, top 10); Skip rides the Battles
//      view's own another-battle path.
//   D. Server boot: the /api/daily-battle + /api/contest
//      payload shapes the renderers consume (a/b/yourPick,
//      entries[0] with voteCount/athlete fields), and a pick
//      persists server-side for the same voter token — the
//      shared-state contract both surfaces rely on.
// Pins: app.js v226 / styles v219. Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const home = read("public/index.html");
const appJs = read("public/app.js");
const css = read("public/styles.css");
const serverJs = read("server.js");

// ---------- A. statics: pins, hero, section order, stories ----------
assert(home.includes('src="app.js?v=228"') && home.includes('href="styles.css?v=220"'), "A: asset pins — app.js v226 / styles v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232)");
{
  const hero = home.slice(home.indexOf('<div class="hero view-home"'), home.indexOf('id="homeBattle230"'));
  assert(hero.includes('id="heroVideo"') && hero.includes('data-src="/hero-film.mp4"'), "A: the hero film is untouched (same video, same source)");
  assert(hero.includes("Watch Highlights"), "A: the hero keeps its gold Watch Highlights button");
  assert(hero.includes('<p class="hero-explainer230">Watch youth sports highlights. Vote for your favorite plays.</p>'), "A: Emil's explainer line rides under the hero CTAs, verbatim");
  assert(!hero.includes("heroBattleLink230"), "A: the battle anchor is NOT static markup — it renders only on a battle day (JS-inserted)");
  assert(appJs.includes('link.id = "heroBattleLink230"') && appJs.includes('link.textContent = "Vote in Today\'s Battle ↓"') && appJs.includes('link.href = "#homeBattle230"'), "A: app.js creates the hero battle anchor (id, label, target) when a battle is available");
}
{
  const order = ['<div class="hero view-home"', 'id="homeBattle230"', 'id="homeFeat230"', 'id="homeMore230"', 'id="plays"', 'id="merchTeaser125"', 'class="final view-home"', 'class="trust view-home"', "<footer"];
  const idx = order.map((s) => home.indexOf(s));
  assert(idx.every((i) => i > -1), "A: every B2 section marker is present on the page");
  assert(idx.every((v, i) => i === 0 || v > idx[i - 1]), "A: home-flow order is hero → Today's Battle → Featured → More Highlights → board → Hype Frame → final CTA → trust → footer");
  for (const id of ["homeBattle230", "homeFeat230", "homeMore230"]) {
    const tag = home.slice(home.indexOf(`id="${id}"`) - 60, home.indexOf(`id="${id}"`) + 30);
    assert(tag.includes("view-home") && tag.includes("hidden"), `A: #${id} carries .view-home and starts hidden (its renderer unhides it only with content)`);
  }
  const battle = home.slice(home.indexOf('id="homeBattle230"'), home.indexOf('id="homeFeat230"'));
  assert(battle.includes("Today's Battle") && battle.includes("Which play wins?") && battle.includes('id="homeBattleBody230"'), "A: the battle section carries its eyebrow, Emil's question and the render host");
  const more = home.slice(home.indexOf('id="homeMore230"'), home.indexOf('id="plays"'));
  assert(more.includes("More Highlights") && more.includes("Leaderboard") && more.includes('id="homeMoreGrid230"') && more.includes('id="homeLbRows230"') && more.includes('id="homeLbTabMonth230"') && more.includes('id="homeLbTabFame230"'), "A: the More Highlights section carries the tiles grid, the Leaderboard heading, its two tabs and the rows host — the leaderboard lives INSIDE the section");
  const homeFlow = home.slice(home.indexOf('<div class="hero view-home"'), home.indexOf('id="plays"'));
  assert(!homeFlow.includes('data-panel="stories"') && !homeFlow.includes('class="stories') && !homeFlow.includes("stories-title"), "A: no Hype Stories section anywhere in the homepage's home flow (the stories panel is a separate page-mode panel, checked below)");
  assert(home.includes('<a href="/stories">Hype Stories</a>'), "A: the hamburger-menu Hype Stories link is untouched");
  assert(home.includes('<section class="stories panel" id="stories" data-panel="stories">'), "A: Hype Stories keeps its own panel page (menu-only, as ruled)");
  assert(css.includes(".home-battle230[hidden]") && css.includes(".hb230-grid{") && css.includes(".feat230{") && css.includes(".hm230-grid{") && css.includes(".hero-battle-link230{") && css.includes(".hero-explainer230{"), "A: the Round 230 styles ship (hidden guards, battle grid, featured card, tiles grid, hero anchor + explainer)");
}

// ---------- B. wiring statics ----------
{
  const renderAllLine = appJs.slice(appJs.indexOf("function renderAll()"), appJs.indexOf("\n", appJs.indexOf("function renderAll()")));
  assert(renderAllLine.includes('if (typeof renderHome230 === "function") renderHome230();'), "B: renderAll calls the home orchestrator behind the house typeof guard");
  const dailyFn = appJs.slice(appJs.indexOf("async function loadDaily100"), appJs.indexOf("async function dailyPick100"));
  assert((dailyFn.match(/renderHome230\(\)/g) || []).length >= 2, "B: loadDaily100 re-renders the home sections at BOTH exits (unavailable + complete) — the shared-state hook");
  const block230 = appJs.slice(appJs.indexOf("/* ---------------- Round 230"));
  assert(block230.includes('dailyPick100(slot)') && block230.includes("toggleVote(${h.id}, this)"), "B: the home surfaces call the board's own dailyPick100 and toggleVote — no parallel pick/vote logic");
  assert(!block230.includes("api("), "B: the Round 230 block makes no api() calls of its own — it renders state the board already loads (no new endpoints)");
  assert(block230.includes("CONTEST.entries") && block230.includes("fameRowHtml134") && block230.includes("homeSameAthlete230"), "B: featured + leaderboard read CONTEST.entries through the shared row renderer; exclusions run through the athlete-identity helper");
  assert(!serverJs.includes("renderHome230") && !serverJs.includes("homeBattle"), "B: server.js carries no Round 230 code — the round is client-only — →232: still true of the R230 block itself; Round 232 item 6 adds a separate server change (posterUrl232's cache-bust token in publicHighlight), covered in test-r232");
}

// ---------- C. VM drive ----------
function mkEl(id) {
  return {
    id: id || "", innerHTML: "", hidden: false, disabled: false, children: [], attrs: {}, listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { this.children.push(c); c._parent = this; if (c.id) REG.set(c.id, c); return c; },
    remove() { if (this.id) REG.delete(this.id); if (this._parent) { const i = this._parent.children.indexOf(this); if (i > -1) this._parent.children.splice(i, 1); this._parent = null; } },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
  };
}
const REG = new Map();
const ctasEl = mkEl(""); ctasEl.className = "hero-ctas";
for (const id of ["homeBattle230", "homeBattleBody230", "homeFeat230", "homeFeatBody230", "homeMore230", "homeMoreGrid230", "homeLbRows230", "homeLbTabMonth230", "homeLbTabFame230"])
  REG.set(id, mkEl(id));
REG.get("homeBattle230").hidden = true; REG.get("homeFeat230").hidden = true; REG.get("homeMore230").hidden = true;
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
const P75 = play(75, "Kameron A.", "athK", { title: "Walk-off game winner to make the playoffs", voteCount: 14, viewCount: 56, moment_kind: "big_play" });
const P78 = play(78, "Kameron A.", "athK", { title: "Touchdown", sport: "football", voteCount: 2 });
const P99 = play(99, "Kameron A.", "", { title: "Name-only Kameron play", voteCount: 1 });
const P71 = play(71, "Nicholas B.", "athN", { title: "Double", team: "Plainview hawks", voteCount: 6, viewCount: 63 });
const P51 = play(51, "Juliana", "athJ", { title: "Caught stealing home!", sport: "softball", voteCount: 4 });
const P50 = play(50, "Charlotte", "athC", { title: "Gold and silver in both Kata and Kumite", sport: "martialarts", voteCount: 4, viewCount: 59 });
const P77 = play(77, "Marco", "athM", { title: "Ran for 40 yrds", sport: "football", voteCount: 2, viewCount: 5 });
const P76 = play(76, "Aaron D", "athA", { title: "GOAL!!!", sport: "soccer", voteCount: 3, viewCount: 16 });
const P66 = play(66, "christian", "athCh", { title: "Second homer", voteCount: 5, viewCount: 32 });

const calls = { pick: [], load: 0, view: [], another: 0 };
const sb = {
  console, document: documentStub, setTimeout, clearTimeout,
  d100: { daily: null, dailyWatch: "A", dailyCollapsed: false, dailyJustPicked: false, dailyCollapseTimer: null, run: null, runState: null, scrollDaily: false },
  CONTEST: { period: "2026-11", entries: [] },
  ALL_PLAYS: [],
  momentChipInline162: (h) => (h && h.moment_kind ? `<span class="moment-chip162">🔥 Big Play</span>` : ""),
  dailyPick100: async (slot) => { calls.pick.push(slot); const r = sb.d100.daily; r.yourPick = slot === "A" ? r.a.id : r.b.id; r.split = { aPct: 60, bPct: 40, total: 5 }; },
  loadDaily100: async () => { calls.load++; },
  switchView: (v) => { calls.view.push(v); },
  playAnotherBattle102: () => { calls.another++; },
  scrollBoardIntoView122: () => {},
  openPlayDetail: () => {},
};
sb.window = sb;
vm.createContext(sb);
vm.runInContext(helpers + "\n" + block230, sb);
const $id = (id) => REG.get(id);

try {
  // C1: battle available, unpicked — card + hero anchor render from d100.daily.
  sb.d100.daily = { available: true, practice: false, date: "2026-11-27", a: P71, b: P51, yourPick: null, split: null };
  vm.runInContext("renderHomeBattle230()", sb);
  assert($id("homeBattle230").hidden === false, "C: the battle section unhides when a matchup is available");
  const bb = $id("homeBattleBody230").innerHTML;
  assert(bb.includes('src="/uploads/poster-71.jpg"') && bb.includes('src="/uploads/poster-51.jpg"'), "C: the battle thumbnails are the plays' poster stills");
  assert(bb.includes("homeBattlePick230('A')") && bb.includes("homeBattlePick230('B')") && bb.includes(">Vote A</button>") && bb.includes(">Vote B</button>"), "C: Vote A / Vote B sit beneath their sides, wired to the home pick entry");
  assert(bb.indexOf("poster-71.jpg") < bb.indexOf("<h4>Double</h4>") && bb.includes("Nicholas B. · Baseball · Plainview hawks"), "C: play name + athlete sit BELOW the image (mock layout)");
  const anchor = ctasEl.children.find((c) => c.id === "heroBattleLink230");
  assert(anchor && anchor.href === "#homeBattle230" && anchor.textContent === "Vote in Today's Battle ↓", "C: the hero gains its 'Vote in Today's Battle' anchor beside Watch Highlights");

  // C2: a home pick calls the SAME dailyPick100 and re-renders the picked state.
  await vm.runInContext("homeBattlePick230('A')", sb);
  assert(JSON.stringify(calls.pick) === JSON.stringify(["A"]), "C: the home Vote A button calls dailyPick100('A') — the Battles view's own pick function");
  const bb2 = $id("homeBattleBody230").innerHTML;
  assert(bb2.includes("Your pick") && bb2.includes("/crown.png") && bb2.includes("disabled") && bb2.includes("60%"), "C: after the pick the home card shows the crown Your pick state, disabled buttons and the split — the battles card's exact picked state");

  // C3: a pick made on the Battles surface shows identically at home (hook path).
  sb.d100.daily = { available: true, practice: false, date: "2026-11-27", a: P71, b: P51, yourPick: P51.id, split: { aPct: 25, bPct: 75, total: 8 } };
  vm.runInContext("renderHome230()", sb);
  const bb3 = $id("homeBattleBody230").innerHTML;
  assert(bb3.includes("Your pick") && bb3.includes("75%"), "C: state picked elsewhere (d100.daily) renders identically at home after the orchestrator runs — one source of truth");

  // C4: no-battle day — section hidden, anchor REMOVED.
  sb.d100.daily = { available: false };
  vm.runInContext("renderHomeBattle230()", sb);
  assert($id("homeBattle230").hidden === true && !ctasEl.children.some((c) => c.id === "heroBattleLink230") && !REG.has("heroBattleLink230"), "C: on a no-battle day the section hides and the hero anchor is not rendered");

  // C5: the orchestrator kicks the shared loader exactly once before the daily lands.
  sb.d100.daily = null; calls.load = 0;
  vm.runInContext("renderHome230(); renderHome230();", sb);
  assert(calls.load === 1, "C: with no daily state yet, renderHome230 kicks loadDaily100 exactly once (the hook re-renders when it lands)");

  // C6: featured card — play + standing from the CONTEST payload.
  sb.CONTEST = { period: "2026-11", entries: [P75, P71, P50] };
  vm.runInContext("renderHomeFeatured230()", sb);
  const fb = $id("homeFeatBody230").innerHTML;
  assert($id("homeFeat230").hidden === false, "C: the featured section unhides with entries present");
  assert(fb.includes("Featured Play") && fb.includes("Currently #1") && fb.includes("/crown.png"), "C: the combined card carries the Featured Play eyebrow with the crown asset");
  assert(fb.includes("Kameron A.") && fb.includes("Walk-off game winner") && fb.includes("🔥 Big Play") && fb.includes("56 watches"), "C: the card shows the leader's name, short title, moment chip and watches — from the payload, not hardcoded");
  assert(fb.includes("Hype of the Month · November 2026") && fb.includes("Kameron A. leads with 14 votes") && fb.includes("Win a homepage feature and a social shoutout."), "C: the monthly standing is folded into the SAME card (period, leader, count, prize line)");
  assert(fb.includes("toggleVote(75, this)") && fb.includes("14 votes"), "C: the card's vote button is the contest toggleVote with the live month count");
  sb.CONTEST = { period: "2026-11", entries: [] };
  vm.runInContext("renderHomeFeatured230()", sb);
  assert($id("homeFeat230").hidden === true, "C: no entries — the featured section hides (no placeholder card)");

  // C7: More Highlights exclusions — by athlete identity.
  sb.CONTEST = { period: "2026-11", entries: [P75, P71, P50, P51] };
  sb.d100.daily = { available: true, practice: false, a: P71, b: P51, yourPick: null, split: null };
  sb.ALL_PLAYS = [P75, P71, P50, P51, P77, P76, P66, P78, P99];
  vm.runInContext("renderHomeMore230()", sb);
  const grid = $id("homeMoreGrid230").innerHTML;
  for (const id of [50, 77, 76, 66]) assert(grid.includes(`homeOpenPlay232(${id})`), `C: More Highlights shows play ${id} (a different athlete) — →232: tile media taps route to the swipe feed (homeOpenPlay232), not openPlayDetail`);
  for (const id of [75, 71, 51, 78, 99]) assert(!grid.includes(`homeOpenPlay232(${id})`), `C: More Highlights excludes play ${id} (featured / battle-pair athlete — 78 + 99 prove identity, not play id: same athlete_id, and same label with no id)`);
  assert(grid.indexOf("homeOpenPlay232(50)") < grid.indexOf("homeOpenPlay232(77)") && grid.indexOf("homeOpenPlay232(77)") < grid.indexOf("homeOpenPlay232(76)"), "C: tiles keep the payload's order");

  // C8: the leaderboard inside the section — complete, leader first; Fame tab mirrors renderFame.
  const lb = $id("homeLbRows230").innerHTML;
  assert([75, 71, 50, 51].every((id) => lb.includes(`data-tile-id="${id}"`)), "C: the This Month leaderboard renders EVERY contest entry inside the More Highlights section");
  assert(lb.indexOf('data-tile-id="75"') < lb.indexOf('data-tile-id="71"'), "C: the leader's #1 row is present and first — standings stay complete");
  const sample = play(500, "Demo Kid", "athS", { voteCount: 999, isSample: true });
  sb.ALL_PLAYS = [P75, P71, P50, P51, P77, P76, P66, P78, sample,
    play(201, "Extra One", "athE1", { voteCount: 9 }), play(202, "Extra Two", "athE2", { voteCount: 8 }), play(203, "Extra Three", "athE3", { voteCount: 7 }), play(204, "Extra Four", "athE4", { voteCount: 6 })];
  $id("homeLbTabFame230").listeners.click();
  const fame = $id("homeLbRows230").innerHTML;
  assert(!fame.includes('data-tile-id="500"'), "C: the Hall of Fame tab excludes samples (renderFame's rule)");
  assert((fame.match(/data-tile-id=/g) || []).length === 10, "C: the Hall of Fame tab caps at the top 10, like renderFame");
  assert(fame.indexOf('data-tile-id="75"') > -1 && fame.indexOf('data-tile-id="75"') < fame.indexOf('data-tile-id="201"'), "C: the Fame ranking sorts by all-time votes (14-vote leader ahead of the 9-vote play)");
  assert($id("homeLbTabFame230").attrs["aria-pressed"] === "true" && $id("homeLbTabMonth230").attrs["aria-pressed"] === "false", "C: the tabs track the active list");

  // C9: Skip rides the Battles view's own another-battle path.
  vm.runInContext("homeBattleSkip230()", sb);
  assert(calls.view.includes("battles") && calls.another === 1, "C: Skip opens the Battles view and deals the fresh matchup (playAnotherBattle102) — no home-grown skip logic");

  console.log("\nVM DRIVE PASSED");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

// ---------- D. server boot: payload shapes + pick persistence ----------
async function boot(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r230-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "" },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  return { tmp, j, stop: async () => { child.kill("SIGKILL"); await wait(300); }, getLog: () => log };
}
try {
  const s = await boot(45310);
  try {
    const post = (p, body, t) => s.j(p, { method: "POST", headers: { "content-type": "application/json", ...(t ? { "x-owner-token": t } : {}) }, body: JSON.stringify(body) });
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token; assert(tok, "D: owner claim returns a token");
    const mk = async (title, name) => {
      const r = await post("/api/highlights", { title, sport: "baseball", playerName: name, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" });
      const id = r.body.id;
      await post(`/api/highlights/${id}/status`, { status: "approved" }, tok);
      return id;
    };
    const idA = await mk("Daily A Play", "Alpha Kid");
    const idB = await mk("Daily B Play", "Beta Kid");
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
    const set = await post("/api/owner/daily-battle", { date: today, playAId: idA, playBId: idB }, tok);
    assert(set.body && set.body.a && set.body.b, "D: the owner daily setter deals today's matchup");
    const d1 = await s.j("/api/daily-battle?voterToken=r230voter");
    assert(d1.body.available === true && d1.body.a.id === idA && d1.body.b.id === idB && d1.body.yourPick === null, "D: /api/daily-battle serves {available, a, b, yourPick} — the exact shape renderHomeBattle230 consumes");
    assert(d1.body.a.athlete_id && d1.body.a.athlete_label && d1.body.a.poster_url !== undefined, "D: the daily plays carry athlete_id / athlete_label / poster_url (identity + stills for the home card)");
    const pick = await post("/api/daily-battle/pick", { voterToken: "r230voter", pickId: idB });
    assert(pick.body.yourPick === idB, "D: the pick endpoint records the voter's pick");
    const d2 = await s.j("/api/daily-battle?voterToken=r230voter");
    assert(d2.body.yourPick === idB && d2.body.split && d2.body.split.total >= 1, "D: the pick persists for the same voter token with a split — both surfaces read this one state");
    const enter = await post("/api/contest/enter", { highlightId: idA }, tok);
    assert(enter.status === 201 && enter.body.ok === true, "D: the play enters the contest (owner-token override path)");
    const c = await s.j("/api/contest?voterToken=r230voter");
    const e0 = (c.body.entries || [])[0];
    assert(e0 && e0.id === idA && typeof e0.voteCount === "number" && e0.athlete_id && e0.athlete_label && typeof c.body.period === "string", "D: /api/contest entries[0] carries voteCount + athlete identity + the period — the featured card's data shape");
  } finally { await s.stop(); }
  console.log("\nALL R230 CHECKS PASSED");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
