// Round 245 (2026-11-27): the homepage leaderboard's own
// controls must act IN PLACE. Emil, on the live site after
// Round 243 (21:49–21:50):
//   (1) "When I click view full leader board this happens" —
//       the page threw him UP to the More Highlights grid.
//       Root cause (proven pre-fix with real mouse clicks on
//       the real page in headless Chromium, production-shaped
//       data): homeLbMore240 rode homeLbLanding232, the
//       landing helper built for arrivals from OTHER surfaces.
//       Its courtesy scroll targets the top of the WHOLE
//       combined section (#homeMore230) — and the section's
//       top is More Highlights, the leaderboard below it. The
//       click DID expand the rows (3 → 8), then, 61ms later,
//       scrollIntoView({behavior:"smooth", block:"start"})
//       fired on #homeMore230 and the page animated from
//       scrollY 2661 (leaderboard head at −129) to 1908
//       (section top at 0, "MORE HIGHLIGHTS" at y=64, the
//       leaderboard head pushed down to y=624, the viewport
//       filled by #homeMoreGrid230).
//   (2) "When clicking show less this Happens" — he landed on
//       the Watch board. The instrumented real click's call
//       log was EMPTY: no scrollIntoView, no switchView, no
//       hashchange. homeLbLess243 only repainted the rows
//       shorter; the repaint removed 680px of height (rows
//       box 1108 → 428) while scrollY stayed numerically put
//       (the repaint replaces the rows box's whole contents —
//       the very nodes scroll anchoring would track), so the
//       sections below jumped up by the removed height: the
//       deck went from y=687 to y=74 and filled his screen.
//       A scroll-anchoring failure, not a navigation.
// The fix distinguishes the doors by entry point: the two
// in-section controls (each called ONLY by its own button)
// expand/collapse with no landing and no courtesy scroll;
// the collapse re-anchors via homeLbReanchor245 (hold the
// leaderboard head's on-screen position across the repaint;
// if the collapse started at the tail of the long board and
// left the head above the viewport, settle the head at the
// top of the screen). Arrivals from other surfaces — the
// feed's end card (feedGo189), fame/month links, the Watch
// contest line, ?view=fame — keep homeLbLanding232 exactly.
// Layers: A. statics. B. VM drive of the real handlers with
// a simulated head + scrollBy (the R243 harness, extended).
// C. REAL-CLICK layer: the real server, seeded with fixture
// plays, driven in headless Chromium with real mouse clicks
// on the real rendered buttons — the layer whose absence let
// both defects ship under R243's handler-only assertions.
// Pins: app.js v240 / styles v228 (styles unchanged).
// Run: node test-r245.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const slice = (a, b) => appJs.slice(appJs.indexOf(a), b ? appJs.indexOf(b) : undefined);

// ---- A. statics ----
assert(home.includes('src="app.js?v=241"') && home.includes('href="styles.css?v=230"'), "A: asset pins — app.js v240 / styles v228 (Round 245; styles unchanged this round) — →246: app.js now v241 / styles now v230 (Round 246) — →247: styles now v230 (Round 247)");
const moreFn = slice("function homeLbMore240()", "function renderHomeLb230");
assert(moreFn.includes("homeLbFull240 = true") && moreFn.includes("renderHomeLb230()") && !moreFn.includes("homeLbLanding232("), "A: the in-section expand sets the state and repaints WITHOUT the landing helper (the defect-1 mechanism is out of this path)");
assert(moreFn.includes("homeLbReanchor245(topBefore245, false)"), "A: the expand re-anchors in place (growth downward, no courtesy scroll)");
const lessFn = slice("function homeLbLess243()", "/* The tail control");
assert(lessFn.includes("homeLbFull240 = false") && lessFn.includes("renderHomeLb230()") && lessFn.includes("homeLbReanchor245(topBefore245, true)"), "A: the collapse repaints short and re-anchors as a collapse (the defect-2 compensation rides this path)");
const block245 = slice("/* ---------------- Round 245", "function renderHomeMore230");
assert(block245.includes("function homeLbHeadTop245()") && block245.includes("function homeLbReanchor245(topBefore, collapsed)"), "A: the Round 245 block carries the head reader + the re-anchor, between the renderer and More Highlights");
assert(block245.indexOf("function renderHomeLb230") === -1 && appJs.indexOf("/* ---------------- Round 245") > appJs.indexOf("function renderHomeLb230"), "A: the Round 245 block sits after renderHomeLb230 (the renderers it serves are untouched)");
const landingFn = slice("function homeLbLanding232(tab)");
assert(landingFn.includes("homeLbFull240 = true") && landingFn.includes("renderHomeLb230()") && landingFn.includes('getElementById("homeMore230")') && landingFn.includes("scrollIntoView"), "A: the ARRIVAL door stands exactly as built — homeLbLanding232 still expands, repaints and scrolls the section in");
const feedGo = slice("window.feedGo189", "window.feedHype189");
assert(feedGo.includes('homeLbLanding232("month")'), "A: the feed end card's Leaderboard landing still routes through homeLbLanding232 (arrivals keep their behavior)");
assert(appJs.includes('onclick="homeLbMore240()">View full leaderboard</button>') && appJs.includes('onclick="homeLbLess243()">Show less</button>'), "A: the two tail buttons still call the two in-section handlers");

// ---- B. VM drive (the R243 sandbox + a simulated head & scrollBy) ----
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
const headEl = { _top: 120, getBoundingClientRect() { return { top: this._top }; } };
const scrollByCalls = [];
const wrapEl = { hidden: true };
const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null };
const documentStub = {
  getElementById: (id) => REG.get(id) || null,
  querySelector: (sel) => (sel === ".hero-ctas" ? ctasEl : sel === ".hlb230-head" ? headEl : null),
  createElement: () => mkEl(""),
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
};
const line = (anchor) => { const i = appJs.indexOf(anchor); return appJs.slice(i, appJs.indexOf("\n", i)); };
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
const PLAYS = Object.fromEntries([P75, P71, P50, P51, P77].map((p) => [p.id, p]));
const detailCalls = [], trackCalls = [];
const store = new Map();
const sb = {
  console, document: documentStub, setTimeout, clearTimeout,
  $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
  $$: () => [],
  requestAnimationFrame: (fn) => { fn(); return 0; },
  scrollBy: (x, dy) => { scrollByCalls.push([x, dy]); headEl._top -= dy; },
  d100: { daily: null },
  CONTEST: { period: "2026-11", entries: [P75, P71, P50, P51, P77] },
  ALL_PLAYS: [P51, P77, P75, P50, P71],
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

// B1: expand in place, head on screen — no landing scroll, no scrollBy, head unmoved.
run("homeLbFull240 = false");
run('homeLbTab230 = "month"; renderHomeLb230()');
headEl._top = 120; scrollByCalls.length = 0;
run("homeLbMore240()");
await wait(220); // the old landing's deferred scroll (60ms) would have fired by now
assert(run("homeLbFull240") === true && rowCount($id("homeLbRows230").innerHTML) === 5, "B: the in-section expand paints the full board (5 rows)");
assert($id("homeMore230").scrolls === 0, "B: …and the section is NEVER scrolled (the landing's scrollIntoView stays out of the in-section path)");
assert(scrollByCalls.length === 0 && headEl._top === 120, "B: …with no compensating scroll either — the head stays exactly where it was (growth is downward)");
assert(run("homeLbTab230") === "month", "B: the expand preserves the tab");
// B2: collapse with the head on screen — delta zero, no rescue, no scroll at all.
headEl._top = 100; scrollByCalls.length = 0;
run("homeLbLess243()");
assert(run("homeLbFull240") === false && rowCount($id("homeLbRows230").innerHTML) === 3, "B: the collapse repaints the top 3");
assert(scrollByCalls.length === 0 && headEl._top === 100, "B: with the head on screen the collapse needs NO scroll — the head does not move a pixel");
// B3: collapse from the tail of the long board — the head starts above the
// viewport; the re-anchor settles it at the top of the screen.
run("homeLbMore240()");
headEl._top = -516; scrollByCalls.length = 0;
run("homeLbLess243()");
assert(rowCount($id("homeLbRows230").innerHTML) === 3, "B: the tail-posture collapse still repaints the top 3");
assert(scrollByCalls.length === 1 && scrollByCalls[0][0] === 0 && scrollByCalls[0][1] === -516, "B: …and exactly one restoring scroll fires — by the head's own overshoot (−516), nothing else");
assert(headEl._top === 0, "B: the head ends settled at the top of the screen — the collapsed board is what the visitor is looking at");
// B4: the re-anchor's delta step, unit-driven — a repaint that shifted the
// head is undone precisely; a settled head is left alone.
headEl._top = 260; scrollByCalls.length = 0;
run("homeLbReanchor245(200, false)");
assert(scrollByCalls.length === 1 && scrollByCalls[0][1] === 60 && headEl._top === 200, "B: a repaint that pushed the head down 60px is scrolled back by exactly 60");
headEl._top = 200; scrollByCalls.length = 0;
run("homeLbReanchor245(200, true)");
assert(scrollByCalls.length === 0 && headEl._top === 200, "B: a settled head (on screen) is left untouched even on the collapse path");
// B5: the arrival door still lands — expanded, with its scroll.
run("homeLbFull240 = false");
run('homeLbTab230 = "month"; renderHomeLb230()');
run('homeLbLanding232("month")');
await wait(220);
assert(run("homeLbFull240") === true && rowCount($id("homeLbRows230").innerHTML) === 5 && $id("homeMore230").scrolls >= 1, "B: an arrival through homeLbLanding232 still lands EXPANDED with the section scrolled in (other surfaces unchanged)");

// ---- C. real-click layer: served page + headless Chromium ----
{
  const { DatabaseSync } = await import("node:sqlite");
  const pwMod = await import("/home/hatch/workspace/.pwtest/node_modules/playwright-core/index.mjs");
  const shellRoot = "/home/hatch/.cache/ms-playwright";
  const shellDir = fs.readdirSync(shellRoot).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const EXE = path.join(shellRoot, shellDir, "chrome-headless-shell-linux64", "chrome-headless-shell");
  assert(fs.existsSync(EXE), "C: the headless Chromium shell is available (the R244 probe's browser)");

  const PORT = 4245;
  const tmp = fs.mkdtempSync("/tmp/hh-r245-");
  const boot = async () => {
    const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
      env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, OPENAI_API_KEY: "", AI_VISION_API_KEY: "" },
      stdio: "ignore",
    });
    for (let i = 0; i < 60; i++) {
      try { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); if (r.ok) return child; } catch { /* not up yet */ }
      await wait(250);
    }
    child.kill("SIGKILL");
    throw new Error("FAIL: C: the server did not boot");
  };

  let child = await boot();
  child.kill("SIGKILL");
  await wait(400);
  // Seed: 6 approved plays, entered this period, distinct vote counts.
  const period = new Date().toISOString().slice(0, 7);
  fs.mkdirSync(path.join(tmp, "uploads"), { recursive: true });
  const posterSrc = fs.readdirSync(path.join(ROOT, "..", "highlighthype-backups", "nightly", "2026-11-27", "uploads")).filter((f) => /^poster-.*\.jpg$/.test(f)).sort();
  const db = new DatabaseSync(path.join(tmp, "highlighthype.db"));
  const votesWanted = [12, 9, 7, 5, 3, 1];
  for (let n = 1; n <= 6; n++) {
    const id = 900 + n;
    if (posterSrc[n - 1]) fs.copyFileSync(path.join(ROOT, "..", "highlighthype-backups", "nightly", "2026-11-27", "uploads", posterSrc[n - 1]), path.join(tmp, "uploads", `poster-${id}.jpg`));
    db.prepare("INSERT INTO highlights (id, title, sport, player_name, media_kind, media_url, status, is_sample, poster_url) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, "Fixture Play " + n, "baseball", "Fixture " + n, "file", `/uploads/probe245-${id}.mp4`, "approved", 0, `/uploads/poster-${id}.jpg`);
    db.prepare("INSERT INTO contest_entries (highlight_id, period) VALUES (?,?)").run(id, period);
    for (let v = 0; v < votesWanted[n - 1]; v++)
      db.prepare("INSERT INTO votes (highlight_id, voter_token, period) VALUES (?,?,?)").run(id, `probe245-voter-${id}-${v}`, period);
  }
  db.close();

  child = await boot();
  const browser = await pwMod.chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#homeLbRows230 .fame-row", { timeout: 30000 });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      window.__log245 = [];
      const log = (kind, detail) => { try { window.__log245.push({ kind, detail: String(detail).slice(0, 120) }); } catch (e) {} };
      const siv = Element.prototype.scrollIntoView;
      Element.prototype.scrollIntoView = function (opts) { log("scrollIntoView", (this.id || this.className || this.tagName) + " " + JSON.stringify(opts || {})); return siv.call(this, opts); };
      if (typeof window.switchView === "function") { const sv = window.switchView; window.switchView = function (v) { log("switchView", v); return sv.call(this, v); }; }
      if (typeof window.homeLbLanding232 === "function") { const hl = window.homeLbLanding232; window.homeLbLanding232 = function (t) { log("homeLbLanding232", t); return hl.call(this, t); }; }
      window.addEventListener("hashchange", () => log("hashchange", location.hash));
    });
    // The page's CSS smooth-scrolls even programmatic jumps, so a
    // positioning scroll must be allowed to SETTLE before any
    // snapshot or click — otherwise the tap lands mid-animation
    // and the animation itself masquerades as a post-click scroll.
    const settleScroll = async () => {
      let last = -1, stable = 0;
      for (let i = 0; i < 34 && stable < 3; i++) {
        const y = await page.evaluate(() => window.scrollY);
        if (Math.abs(y - last) <= 0.5) stable++; else stable = 0;
        last = y;
        await page.waitForTimeout(120);
      }
    };
    const snap = () => page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      rows: document.querySelectorAll("#homeLbRows230 .fame-row").length,
      headTop: Math.round(document.querySelector(".hlb230-head").getBoundingClientRect().top),
      sectionTop: Math.round(document.getElementById("homeMore230").getBoundingClientRect().top),
      viewAllHidden: document.getElementById("viewAll").hidden,
      hash: location.hash,
      log: (window.__log245 || []).splice(0, window.__log245.length),
    }));
    const s0 = await snap();
    assert(s0.rows === 3, "C: the served page renders the short board first (top 3 of 6 fixtures)");

    // C1: expand in place — a real mouse click with the button fully in
    // view (so the harness itself never scrolls; the head's on-screen
    // case is pinned in §B, here the head must simply not move).
    await page.evaluate(() => { const b = [...document.querySelectorAll("#homeLbRows230 button.hlb230-more240")][0]; const r = b.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 480); });
    await settleScroll();
    const before1 = await snap();
    await page.locator("#homeLbRows230 button.hlb230-more240", { hasText: "View full leaderboard" }).click();
    await page.waitForTimeout(600);
    const after1 = await snap();
    assert(after1.rows === 6, "C: a REAL click on 'View full leaderboard' expands to all 6 rows");
    assert(Math.abs(after1.scrollY - before1.scrollY) <= 1, `C: …the page does not scroll (scrollY ${before1.scrollY} → ${after1.scrollY})`);
    assert(Math.abs(after1.headTop - before1.headTop) <= 2, `C: …the leaderboard head does not move on screen (${before1.headTop} → ${after1.headTop})`);
    assert(!after1.log.some((l) => l.kind === "scrollIntoView") && !after1.log.some((l) => l.kind === "homeLbLanding232") && !after1.log.some((l) => l.kind === "switchView"), "C: …and nothing else fires — no scrollIntoView, no landing, no view switch (the defect-1 signature is gone)");

    // C2: collapse from Emil's posture — the button low on the screen,
    // the head far above the viewport.
    await page.evaluate(() => { const b = [...document.querySelectorAll("#homeLbRows230 button.hlb230-more240")][0]; const r = b.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - Math.round(window.innerHeight * 0.78)); });
    await settleScroll();
    const before2 = await snap();
    assert(before2.headTop < -100, `C: collapse posture set — the head starts above the viewport (${before2.headTop})`);
    await page.locator("#homeLbRows230 button.hlb230-more240", { hasText: "Show less" }).click();
    await page.waitForTimeout(700);
    const after2 = await snap();
    const atCenter = await page.evaluate(() => { const el = document.elementFromPoint(195, 300); return el ? (el.closest("#homeLbRows230") ? "leaderboard-rows" : el.closest("#homeMore230") ? "leaderboard-section" : el.closest("#deck") ? "deck" : el.tagName + "." + el.className) : "none"; });
    assert(after2.rows === 3, "C: a REAL click on 'Show less' collapses back to the top 3");
    assert(Math.abs(after2.headTop) <= 3, `C: …and the leaderboard head settles at the top of the screen (${after2.headTop}) — the collapsed board is what fills the view`);
    assert(atCenter === "leaderboard-rows" || atCenter === "leaderboard-section", `C: …the viewport's center is leaderboard content, not the following sections (got: ${atCenter})`);
    assert(after2.viewAllHidden === true && after2.hash === before2.hash && !after2.log.some((l) => l.kind === "switchView"), "C: …the app never leaves the home view — no view switch, no hash change (the defect-2 impression is gone)");

    // C3: an arrival from another surface keeps the landing behavior —
    // the feed end card's own path (feedGo189), driven for real.
    await page.evaluate(() => { window.scrollTo(0, 0); });
    await settleScroll();
    await snap(); // drain the log
    await page.evaluate(() => window.feedGo189("month"));
    await page.waitForTimeout(250);
    const mid3 = await snap();
    assert(mid3.rows === 6, "C: the feed end-card landing (feedGo189) still lands EXPANDED (all 6 rows)");
    let secTop = null;
    for (let i = 0; i < 16 && (secTop === null || Math.abs(secTop) > 2); i++) { await page.waitForTimeout(250); secTop = Math.round(await page.evaluate(() => document.getElementById("homeMore230").getBoundingClientRect().top)); }
    assert(secTop !== null && Math.abs(secTop) <= 2, `C: …and still scrolls the section into view (section top ${secTop}) — arrivals unchanged`);
    assert(mid3.log.some((l) => l.kind === "homeLbLanding232") && mid3.log.some((l) => l.kind === "scrollIntoView" && l.detail.includes("homeMore230")), "C: the arrival rode the landing helper — its call and its section scrollIntoView are both in the log (the exact signature the in-section controls no longer produce)");
    assert(!pageErrors.some((e) => e.includes("homeLb") || e.includes("245")), "C: no leaderboard page errors across the whole real-click drive");
  } finally {
    await browser.close();
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("\nALL R245 CHECKS PASSED");
