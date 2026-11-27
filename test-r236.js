// Round 236 (2026-11-27) — homepage bottom cleanup, from
// Emil's phone screenshot at 15:26: at the bottom of the
// homepage, directly under the leaderboard rows (ranks 6–8),
// sat the board's segmented control "Watch | Battles | Hype
// of the Month" (Month selected), then the gold banner card
// "HYPE OF THE MONTH · NOVEMBER 2026 — Win a homepage feature
// and a social shoutout. ENDS NOV 30", then "See all plays →"
// and "Posting guidelines", then the HYPE FRAME™ section —
// with the floating volt "+ Post a Play" pill parked over the
// Hype Frame photo. Emil: "This section is confusing down
// here now." The parent mapped the cleanup; Emil approved it
// verbatim: "Clean it up — remove the duplicate tabs and
// banner."
//
// SCOPE (exactly this):
//   (1) The .viewseg tab control is REMOVED from the homepage
//       markup. It duplicated the homepage's own Today's
//       Battle section and full leaderboard directly above it.
//   (2) The #contestStrip banner card is REMOVED from the
//       board's Month view. Its app.js writers
//       (updateContestStrip107's #stripTitle/#stripEnds,
//       switchView's strip write, the click wiring) were
//       already guarded — they stand as no-ops, the Round 134
//       #stripState precedent. The Month view keeps its
//       last-winner strip, empty state and never-disappear
//       line.
//   (3) "See all plays →" and "Posting guidelines" stay put.
//   (4) The floating Post a Play pill stands down on the
//       HOMEPAGE VIEW only: body.plays-view236 (held in sync
//       by showPanel, seeded at boot from the markup's active
//       panel) hides it via styles.css — the header carries
//       the same button on the homepage, and the pill parked
//       over the Hype Frame section photo. Every other panel
//       and page keeps the pill's stock behavior; the element,
//       its click wiring (goSubmit) and its other gates
//       (store / upload / studio / page-sub) are untouched.
//   (5) Reachability audit: switchView remains the single
//       choke point for the three board views and tolerates
//       the missing tab buttons (its .viewseg loop and the
//       Round 122 wiring line iterate an empty set — the
//       wiring line also stays because legacy suites slice
//       switchView by it). Watch is reached via See all plays
//       (kept), the logo (goHome), /?view=all and the feed;
//       Battles via the homepage Today's Battle card (vote +
//       Skip → homeBattleSkip230), /?view=battles deep links
//       and challenge links; Hype of the Month IS the
//       homepage leaderboard — ?view=fame and the feed's
//       Leaderboard already land there (homeLbLanding232),
//       and the Watch view's slim contest line
//       (#contestSlim123, kept — it carries the live contest
//       state on Watch) now lands there too instead of on
//       the banner-less Month panel, with the old switchView
//       landing as its fallback.
//
// Pins: app.js v232 / styles v223.
// Run: node test-r236.js — exits non-zero on failure.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=225"') && home.includes('src="app.js?v=235"'), "A: asset pins — app.js now v232 (Round 236); styles now v223 (Round 236) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round)");

// ---- B. the tab control is gone from the homepage ----
assert(!home.includes('class="viewseg"'), "B: no .viewseg tab control anywhere in the homepage markup");
assert(!home.includes('data-view="all"') && !home.includes('data-view="battles"') && !home.includes('data-view="month"'), "B: no data-view tab buttons (Watch / Battles / Hype of the Month) in the markup");
assert(!home.includes(">Hype of the Month</button>") && (home.match(/>Watch<\/button>/g) || []).length === 1 && home.includes('data-feed-tab="all"'), "B: the board tab labels are gone with the control — the one surviving '>Watch</button>' is the feed's own top tab (data-feed-tab, a different control that stays)");
assert(home.includes("Round 236") && home.includes('id="momentCard162"') && home.indexOf('id="momentCard162"') < home.indexOf('id="boardSportSelect"'), "B: the spotlight card still sits directly above the board's sport dropdown (the pill bar's first control)");

// ---- C. the banner card is gone; its writers stand guarded ----
assert(!home.includes('id="contestStrip"') && !home.includes('id="stripTitle"') && !home.includes('id="stripEnds"'), "C: no #contestStrip / #stripTitle / #stripEnds markup");
assert(!home.includes("banner-eyebrow134") && !home.includes("banner-prize134") && !home.includes("Win a homepage feature and a social shoutout."), "C: the banner card's eyebrow, prize line and copy are gone from the homepage");
const viewMonth = home.slice(home.indexOf('id="viewMonth"'), home.indexOf('id="viewAll"'));
assert(viewMonth.includes('id="lastWinner"') && viewMonth.includes('id="emptyState"') && viewMonth.includes('id="neverDisappear"'), "C: the Month view keeps its last-winner strip, empty state and never-disappear line");
assert(appJs.includes('const t1 = $("#stripTitle")') && appJs.includes("if (t1) t1.textContent") && appJs.includes("if (ends) ends.textContent"), "C: updateContestStrip107's eyebrow/ends writes remain, guarded — no-ops without the card");
assert(appJs.includes('const cs107 = $("#contestStrip"); if (cs107) cs107.hidden'), "C: switchView's strip write remains, guarded — a no-op without the card");
assert(appJs.includes('$("#contestStrip")?.addEventListener'), "C: the strip's click wiring remains on optional chaining — harmless without the element");

// ---- D. the kept doors stay put ----
assert(home.includes('id="seeAllRow"') && home.includes("See all plays →") && home.includes("seeAllPlays()"), "D: 'See all plays →' stays, wired to seeAllPlays()");
assert(home.includes("Posting guidelines") && home.includes("openGuidelines()"), "D: 'Posting guidelines' stays, wired to openGuidelines()");
assert(home.indexOf('id="viewAll"') < home.indexOf('id="seeAllRow"') && home.indexOf('id="viewBattles"') < home.indexOf('id="seeAllRow"'), "D: the see-all row still sits below the board views, in #boardUnder");

// ---- E. the three board views + switchView machinery intact ----
assert(home.includes('id="viewAll"') && home.includes('id="allBoard"') && home.includes('id="viewMonth"') && home.includes('id="viewBattles"') && home.includes('id="dailyCard"'), "E: the Watch, Month and Battles panels all remain in the markup with their core children");
const switchSrc = appJs.slice(appJs.indexOf("function switchView(v)"), appJs.indexOf('$$(".viewseg button").forEach((b) => b.addEventListener("click"'));
assert(switchSrc.includes('$$(".viewseg button")') && switchSrc.includes('$("#viewAll").hidden') && switchSrc.includes("viewBattlesEl") && switchSrc.includes("vmEl232"), "E: switchView still drives all three views; its .viewseg pressed-state loop iterates an empty set (no buttons) without error");
assert(appJs.includes('$$(".viewseg button").forEach((b) => b.addEventListener("click", () => { switchView(b.dataset.view); scrollBoardIntoView122(); }));'), "E: the Round 122 tab wiring line stands (an empty NodeList — no listeners, no error; legacy suites slice switchView by this marker)");
assert(appJs.includes('const csSlim123 = $("#contestSlim123"); if (csSlim123) csSlim123.hidden = v !== "all";') && home.includes('id="contestSlim123"') && home.includes('id="contestSlimText123"'), "E: the Watch view's slim contest line stays, still shown on the Watch view only, still carrying the live contest state");

// ---- F. reachability — every route the tabs used to serve ----
const seeAllSrc = appJs.slice(appJs.indexOf("window.seeAllPlays"), appJs.indexOf("/* ---------------- athlete collection"));
assert(seeAllSrc.includes('showPanel("plays")') && seeAllSrc.includes('switchView("all")'), "F: See all plays still lands on the Watch (All Hypes) view — the full board's door");
const goHomeSrc = appJs.slice(appJs.indexOf("function goHome()"), appJs.indexOf('$$("[data-store-link]")'));
assert(goHomeSrc.includes('switchView("all")'), "F: the logo/home reset still activates the Watch view");
assert(appJs.includes('function homeBattleSkip230()') && appJs.slice(appJs.indexOf("function homeBattleSkip230()"), appJs.indexOf("function renderHomeFeatured230()")).includes('switchView("battles")'), "F: the homepage Today's Battle card still opens the full Battles view (its Skip path)");
assert(appJs.includes('new URLSearchParams(location.search).get("view") === "battles"') && appJs.includes('switchView("battles")'), "F: the /?view=battles deep link still lands on the Battles view");
assert(appJs.includes('get("view") === "all")') || appJs.includes("get(\"view\") === \"all\""), "F: the /?view=all boot landing still stands");
const fameSrc = appJs.slice(appJs.indexOf("(function fameLink94()"), appJs.indexOf("/* ---------------- Upload Assist"));
assert(fameSrc.includes('homeLbLanding232("fame")'), "F: ?view=fame still lands on the homepage leaderboard's Hall of Fame tab");
const feedGoSrc = appJs.slice(appJs.indexOf("window.feedGo189"), appJs.indexOf("window.feedHype189"));
assert(feedGoSrc.includes('homeLbLanding232("month")') && feedGoSrc.includes('switchView(view)'), "F: the feed's Leaderboard landing still goes to the homepage leaderboard; its other tabs still switch views");
const slimHandler = appJs.slice(appJs.indexOf('$("#contestSlim123")?.addEventListener'), appJs.indexOf('$("#contestSlim123")?.addEventListener') + 420);
assert(slimHandler.includes('homeLbLanding232("month")') && slimHandler.includes('switchView("month")') && slimHandler.includes("scrollBoardIntoView122()"), "F: the slim line's tap now lands on the homepage leaderboard (homeLbLanding232), with the old Month-view switch as its fallback");
assert(appJs.includes("function homeLbLanding232(tab)") && appJs.includes('document.getElementById("homeMore230")'), "F: homeLbLanding232 stands — it paints the leaderboard tab and scrolls the More Highlights section in");
const advSrc = appJs.slice(appJs.indexOf("function applyDefaultView()"), appJs.indexOf("/* ---------------- media + cards"));
assert(advSrc.includes('switchView((CONTEST.entries || []).length ? "month" : "all")'), "F: the default landing rule is unchanged (Month when the contest has entries, Watch otherwise)");
const goSubmitSrc = appJs.slice(appJs.indexOf("function goSubmit()"), appJs.indexOf("function openUploadOverlay") > -1 ? appJs.indexOf("function goSubmit()") + 1400 : appJs.indexOf("function goSubmit()") + 1400);
assert(goSubmitSrc.includes('switchView("month")') && goSubmitSrc.includes("openUploadOverlay()"), "F: Post a Play (header pill, floating pill, menu) still enters through goSubmit — Month backdrop + the upload overlay");

// ---- G. the floating pill: homepage-view scoping ----
assert(home.includes('id="floatSubmit"') && home.includes('id="postPlayBtn"'), "G: the floating pill element and the header's Post a Play button both remain in the markup");
assert(appJs.includes('$("#floatSubmit").addEventListener("click", goSubmit);'), "G: the pill's click wiring is untouched (same goSubmit as the header button)");
assert(css.includes("body.plays-view236 .float-submit{display:none}"), "G: styles.css hides the pill under body.plays-view236 (the homepage view)");
assert(css.includes("body.store-open .float-submit{display:none}") && css.includes("body.page-sub .float-submit{display:none}") && css.includes("body.hf-studio-open205 .float-submit{display:none}"), "G: the pill's older gates (store / page-sub / studio) are untouched");
assert(appJs.includes('document.body.classList.toggle("plays-view236", name === "plays")'), "G: showPanel holds body.plays-view236 in sync with the plays panel");
const bootSrc = appJs.slice(appJs.indexOf("(function boot()"), appJs.indexOf("if (typeof hhBoot139"));
assert(bootSrc.includes('const ap236 = document.querySelector(".panel.active")') && bootSrc.includes('ap236.dataset.panel === "plays"'), "G: the boot seeds plays-view236 from the markup's active panel (a plain home load runs no showPanel for it)");

// G-drive: the REAL showPanel, in a VM with a stub DOM — the
// class must follow the panel exactly.
{
  const classes = new Set();
  const classList = {
    toggle: (c, force) => { if (force === undefined) { classes.has(c) ? classes.delete(c) : classes.add(c); } else if (force) classes.add(c); else classes.delete(c); },
    contains: (c) => classes.has(c),
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
  };
  const sandbox = {
    console,
    document: { body: { classList } },
    $: () => null,
    $$: () => [],
    hidePlayDetail: () => {},
  };
  vm.createContext(sandbox);
  const showPanelSrc = appJs.slice(appJs.indexOf("function showPanel(name)"), appJs.indexOf("/* Round 51 (2026-11-08): #menuAllHypes"));
  vm.runInContext(showPanelSrc + "\nthis.__showPanel = showPanel;", sandbox);
  sandbox.__showPanel("plays");
  assert(classes.has("plays-view236") && !classes.has("hf-studio-open205"), "G-drive: showPanel('plays') raises plays-view236 (the pill stands down on the homepage view)");
  sandbox.__showPanel("mine");
  assert(!classes.has("plays-view236"), "G-drive: showPanel('mine') drops plays-view236 (My Plays keeps the pill, as before)");
  sandbox.__showPanel("hypeframe");
  assert(!classes.has("plays-view236") && classes.has("hf-studio-open205"), "G-drive: showPanel('hypeframe') drops plays-view236 and raises the studio gate, exactly as before");
  sandbox.__showPanel("plays");
  assert(classes.has("plays-view236") && !classes.has("hf-studio-open205"), "G-drive: returning to the plays panel restores plays-view236 and clears the studio gate");
}
// G-drive: the REAL boot seed line, evaluated against both
// possible active panels.
{
  const seedLine = appJs.split("\n").find((l) => l.includes("const ap236"));
  assert(!!seedLine, "G: the boot seed line is present verbatim for the drive");
  const run = (panel) => {
    const classes = new Set();
    const sandbox = {
      console,
      document: {
        body: { classList: { toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); }, contains: (c) => classes.has(c) } },
        querySelector: () => ({ dataset: { panel } }),
      },
    };
    vm.createContext(sandbox);
    vm.runInContext(seedLine, sandbox);
    return classes.has("plays-view236");
  };
  assert(run("plays") === true, "G-drive: the boot seed raises plays-view236 when the plays panel booted active (plain homepage load)");
  assert(run("mine") === false, "G-drive: the boot seed leaves plays-view236 off when another panel booted active (page-sub landings)");
}

// ---- H. served smoke: the homepage as shipped ----
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r236-"));
  const port = 19300 + (process.pid % 500);
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" },
    stdio: "pipe",
  });
  try {
    let served = "";
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      try { const r = await fetch(`http://127.0.0.1:${port}/`); if (r.ok) { served = await r.text(); break; } } catch (e) { /* not up yet */ }
      await new Promise((r) => setTimeout(r, 400));
    }
    assert(served.length > 0, "H: the server serves the homepage from a scratch DATA_DIR");
    assert(served.includes('src="app.js?v=235"') && served.includes('href="styles.css?v=225"'), "H: the served homepage carries the v232/v223 pins — →238: served pins now v234/v225 (Round 238)");
    assert(!served.includes('class="viewseg"') && !served.includes('id="contestStrip"'), "H: the served homepage has no tab control and no banner card");
    assert(served.includes('id="seeAllRow"') && served.includes("See all plays →") && served.includes('id="homeLbRows230"'), "H: the served homepage keeps See all plays and the homepage leaderboard");
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log("test-r236: all assertions passed");
