// Round 248 (2026-11-28, Emil — "Fix all 4 audit findings in
// one round"): the four defects from the overnight click-path
// audit (132 paths: 116 work · 12 gated · 4 broken), each fixed
// and each proven with REAL CLICKS in a real browser — the
// audit exists because handler-only tests kept passing broken
// controls, so every fix below is asserted on its VISIBLE
// outcome after a real tap, never on handler wiring alone.
//   1. Homepage "Try another battle →" rotated nothing (it
//      navigated to the Battles view). Now it deals a
//      just-for-fun matchup IN PLACE from btlPairs (the daily
//      pair filtered out), picks are local-only, and "Today's
//      official matchup ↑" restores the daily card.
//   2. Watch-board cards had no Share (the ⋮ was decorative).
//      The ⋮ is gone; a labeled 🔗 Share rides sharePlay.
//   3. The A2HS bar covered the footer's "Our Story" link.
//      body.a2hs-open161/steps161 now grow footer clearance
//      in the bar's own heights (118/200px).
//   4. Athlete-page card videos never opened the play.
//      cardHtml's thumb gains the Watch tile's .tile-tap
//      layer → openPlay189 (file / link_video media only).
// Layers: A. statics (pins v242/v231, code shapes, fallback
// order). B. REAL-BROWSER layer on production-shaped fixture
// data (2026-11-27 nightly backup): one section per fix.
// Pins: app.js v242 / styles v231. server.js UNCHANGED.
// Run: node test-r248.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
let ok = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { ok++; }
  else { failed++; console.log("FAIL:", msg); }
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- A. statics ----------
{
  const app = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert(home.includes('src="app.js?v=242"'), "A: index pins app.js v242 (Round 248)");
  assert(home.includes('href="styles.css?v=231"'), "A: index pins styles v231 (Round 248)");

  // Fix 1 — the rotation exists and the skip tries it BEFORE the old path
  assert(app.includes("const homeFun248 = {"), "A1: the fun-rotation state ships");
  assert(app.includes("function homeFunDeal248(advance)"), "A1: the dealer ships");
  assert(app.includes("function homeFunPick248(slot)"), "A1: the local-only pick ships");
  assert(app.includes("function homeBattleOfficial248()"), "A1: the return-to-official ships");
  const skipFn = app.slice(app.indexOf("function homeBattleSkip230()"), app.indexOf("function renderHomeFeatured230()"));
  assert(skipFn.includes("homeFunDeal248(homeFun248.on)"), "A1: the skip deals in place");
  assert(skipFn.indexOf("homeFunDeal248(homeFun248.on)") < skipFn.indexOf('switchView("battles")'), "A1: the in-place deal is tried BEFORE the Battles-view fallback");
  assert(skipFn.includes('switchView("battles")') && skipFn.includes("playAnotherBattle102()"), "A1: the pre-248 fallback path survives intact (VM sandboxes + no-pair days ride it)");
  const cardFn = app.slice(app.indexOf("function homeBattleCard230("), app.indexOf("function renderHomeBattle230()"));
  assert(cardFn.includes('r.fun248 ? "homeFunPick248" : "homeBattlePick230"'), "A1: fun cards wire local picks; daily cards keep the daily pick");
  const funPick = app.slice(app.indexOf("function homeFunPick248(slot)"), app.indexOf("function homeBattleOfficial248()"));
  assert(!funPick.includes("api(") && !funPick.includes("dailyPick100") && !funPick.includes("toggleVote"), "A1: the fun pick fires NO vote/pick API — local state + trackEvent only (Round 179)");
  const pairsFn = app.slice(app.indexOf("function homeFunPairs248()"), app.indexOf("function homeFunDeal248(advance)"));
  assert(pairsFn.includes("btlPairs()") && pairsFn.includes("d.a.id") && pairsFn.includes("d.b.id"), "A1: the fun pool is the Battles rotation (btlPairs) with the daily pair filtered out");

  // Fix 2 — Share on tiles, dead glyph gone
  const tileFn = app.slice(app.indexOf("function tileHtml("), app.indexOf("/* Vote hardening"));
  assert(tileFn.includes('class="mini-btn tile-share-btn248"') && tileFn.includes("sharePlay(${h.id}, this)"), "A2: tileHtml renders a labeled Share riding sharePlay");
  assert(!tileFn.includes("tile-dots") && !tileFn.includes("⋮"), "A2: the decorative ⋮ glyph is gone from the tile markup");
  assert(!css.includes(".tile-dots"), "A2: the dead .tile-dots CSS rule is gone");

  // Fix 3 — footer clearance in the bar's own heights
  const r248css = css.slice(css.indexOf("Round 248"));
  assert(r248css.includes("body.a2hs-open161 footer{padding-bottom:118px}"), "A3: footer clearance while the bar shows (118px — the R161 bar height)");
  assert(r248css.includes("body.a2hs-steps161 footer{padding-bottom:200px}"), "A3: footer clearance while the iOS steps are open (200px)");
  assert(css.indexOf("body.a2hs-open161 footer{") > css.indexOf(".a2hs161{position:fixed"), "A3: the clearance rules land after the bar's own rules");
  assert(r248css.includes(".hb230-official248{margin-top:6px}"), "A3: the official-matchup return button spacing ships");

  // Fix 4 — the tap layer on full cards, gated to direct media
  const cardFn2 = app.slice(app.indexOf("function cardHtml("), app.indexOf("function tileHtml("));
  assert(cardFn2.includes('class="tile-tap"') && cardFn2.includes("openPlay189(${h.id}, this)"), "A4: cardHtml's thumb carries the Watch-tile tap layer into openPlay189 (feed on boards, detail fallback elsewhere — its designed contract)");
  assert(cardFn2.includes('h.media_kind === "file" || h.media_kind === "link_video"'), "A4: the tap layer is gated to file / link_video media (embeds + watch-links keep their own surfaces)");

  // Fix 5 — the studio landing scroll: instant + re-asserted, never one smooth throw
  const openFn = app.slice(app.indexOf("window.openHypeFrame = (id)"), app.indexOf("function initHfStudio(play)"));
  assert(openFn.includes("hfScrollStudioTop248()"), "A5: openHypeFrame lands via the guarded studio-top scroll");
  assert(!openFn.includes('scrollIntoView({ behavior: "smooth" })'), "A5: the one-shot SMOOTH scrollIntoView that threw Emil to the bottom is gone from the entry");
  const guardFn = app.slice(app.indexOf("function hfScrollStudioTop248()"), app.indexOf("function initHfStudio(play)"));
  assert(guardFn.includes('style.scrollBehavior = "auto"') && guardFn.includes("rootEl && rootEl.style"), "A5: the jump suspends the global smooth behavior (a true instant landing) — defensively, so VM sandboxes without documentElement can't throw it");
  assert(guardFn.includes("later248(reassert, 300)") && guardFn.includes("later248(reassert, 800)") && guardFn.includes("later248(reassert, 1600)") && guardFn.includes("later248(reassert, 2800)") && guardFn.includes('typeof setTimeout === "function"'), "A5: the landing is re-asserted as the entry repaints land (300/800/1600/2800ms, via a guarded scheduler)");
  assert(guardFn.includes('"touchstart"') && guardFn.includes('"wheel"'), "A5: a user scroll gesture cancels the re-assertions (the guard never fights the user)");
  assert(app.includes("function hfCancelStudioTop248()") && app.includes('if (name !== "hypeframe" && typeof hfCancelStudioTop248 === "function") hfCancelStudioTop248();'), "A5: leaving the studio panel retires the guard — the Back button's origin-scroll restore (hfBack246) is never fought (the r246 E(f) catch)");
}

// ---------- shared fixture + browser rig (R247 pattern) ----------
const { DatabaseSync } = await import("node:sqlite");
const BACKUP = "/home/hatch/workspace/projects/highlighthype-backups/nightly/2026-11-27";
const pwMod = await import("/home/hatch/workspace/.pwtest/node_modules/playwright-core/index.mjs");
const shellRoot = "/home/hatch/.cache/ms-playwright";
const shellDir = fs.readdirSync(shellRoot).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
const EXE = path.join(shellRoot, shellDir, "chrome-headless-shell-linux64", "chrome-headless-shell");
assert(fs.existsSync(EXE), "rig: the headless Chromium shell is available");
const FIXTURE_IDS = [71, 75, 51, 50, 66, 77, 78, 76];
function buildFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });
  const src = new DatabaseSync(path.join(BACKUP, "highlighthype.db"), { readOnly: true });
  const rows = {};
  for (const id of FIXTURE_IDS) {
    rows[id] = src.prepare("SELECT * FROM highlights WHERE id=?").get(id);
    if (!rows[id]) throw new Error("backup missing play " + id);
    for (const f of [rows[id].media_url, rows[id].poster_url, rows[id].stream_url]) {
      if (!f) continue;
      const name = path.basename(String(f).split("?")[0]);
      const from = path.join(BACKUP, "uploads", name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(dir, "uploads", name));
    }
  }
  const entries = FIXTURE_IDS.flatMap((id) => src.prepare("SELECT * FROM contest_entries WHERE highlight_id=?").all(id));
  const votes = FIXTURE_IDS.flatMap((id) => src.prepare("SELECT * FROM votes WHERE highlight_id=?").all(id));
  src.close();
  const livePoster = "/tmp/r246/poster-71.jpg";
  if (fs.existsSync(livePoster)) fs.copyFileSync(livePoster, path.join(dir, "uploads", "poster-71.jpg"));
  return { rows, entries, votes };
}
function seedFixtureDb(dir, fx) {
  const db = new DatabaseSync(path.join(dir, "highlighthype.db"));
  const cols = Object.keys(fx.rows[FIXTURE_IDS[0]]);
  const ins = db.prepare(`INSERT INTO highlights (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);
  for (const id of FIXTURE_IDS) { const r = fx.rows[id]; ins.run(...cols.map((c) => r[c])); }
  if (fx.entries.length) {
    const eCols = Object.keys(fx.entries[0]);
    const eIns = db.prepare(`INSERT INTO contest_entries (${eCols.join(",")}) VALUES (${eCols.map(() => "?").join(",")})`);
    for (const e of fx.entries) eIns.run(...eCols.map((c) => e[c]));
  }
  if (fx.votes.length) {
    const vCols = Object.keys(fx.votes[0]);
    const vIns = db.prepare(`INSERT INTO votes (${vCols.join(",")}) VALUES (${vCols.map(() => "?").join(",")})`);
    for (const v of fx.votes) vIns.run(...vCols.map((c) => v[c]));
  }
  db.close();
}
const KILL_SWITCHES = { HH_NO_ENHANCE: "1", HH_NO_POSTERCLEAN: "1", HH_NO_REFRAME: "1", HH_NO_SMARTPOSTER: "1", HH_NO_STREAM: "1", HH_NO_TRIM: "1", HH_NO_UPSCALE: "1" };
async function bootServer(port, dir) {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OPENAI_API_KEY: "", AI_VISION_API_KEY: "", ...KILL_SWITCHES },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return child; } catch { /* not up yet */ }
    await wait(250);
  }
  child.kill("SIGKILL");
  throw new Error("FAIL: the server did not boot on port " + port);
}
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const pairOf = () => [...document.querySelectorAll("#homeBattleBody230 .hb230-card")].map((c) => {
  const m = (c.querySelector(".hb230-media").getAttribute("onclick") || "").match(/homeOpenPlay232\((\d+)\)/);
  return m ? Number(m[1]) : null;
});

// ---------- B. real-browser layer ----------
{
  const PORT = 4361;
  const dir = fs.mkdtempSync("/tmp/hh-r248-main-");
  const fx = buildFixture(dir);
  let child = await bootServer(PORT, dir);
  child.kill("SIGKILL"); await wait(400);
  seedFixtureDb(dir, fx);
  child = await bootServer(PORT, dir);
  const browser = await pwMod.chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  try {
    const ctx = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
    });
    await ctx.grantPermissions(["clipboard-write", "clipboard-read"], { origin: `http://127.0.0.1:${PORT}` }).catch(() => {});
    const page = await ctx.newPage();
    page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 160)));
    const posts = [];
    page.on("request", (r) => { if (r.method() === "POST") posts.push(r.url()); });
    // The main page never shows the A2HS bar (dismissed) — B3 owns the bar.
    // Share is forced down its clipboard path with a recording stub.
    await page.addInitScript(() => {
      try { localStorage.setItem("hh_a2hs_dismissed161", "1"); } catch { /* fine */ }
      window.__shared248 = [];
      try { Object.defineProperty(navigator, "share", { value: undefined, configurable: true }); } catch { /* fine */ }
      try { Object.defineProperty(navigator, "canShare", { value: undefined, configurable: true }); } catch { /* fine */ }
      try {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async (t) => { window.__shared248.push(String(t)); }, readText: async () => window.__shared248[window.__shared248.length - 1] || "" },
          configurable: true,
        });
      } catch { /* the real clipboard + the button flip still prove the path */ }
    });

    // ===== B1. Fix 1 — the homepage battle skip rotates in place =====
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#homeBattle230:not([hidden])", { timeout: 30000 });
    await page.waitForTimeout(1500);
    const daily = await page.evaluate(pairOf);
    assert(daily.length === 2 && daily[0] && daily[1], `B1: the daily matchup renders two plays (${daily})`);
    const dailySet = [...daily].sort((a, b) => a - b).join("-");
    assert(await page.evaluate(() => document.querySelector("#homeBattleBody230").innerHTML.includes("hb230-official240")), "B1: the daily card wears the official clarifier before any skip");
    const postsBefore1 = posts.length;
    await page.locator("#homeBattleBody230 .hb230-skip:not(.hb230-official248)").click();
    await page.waitForTimeout(700);
    const fun1 = await page.evaluate(pairOf);
    assert(fun1.length === 2 && fun1[0] && fun1[1], `B1: after one tap the card still shows a full matchup (${fun1})`);
    assert(fun1.join("-") !== daily.join("-"), `B1: TAP 1 CHANGES THE MATCHUP — daily ${daily} → fun ${fun1} (the audit's dead button now moves)`);
    assert([...fun1].sort((a, b) => a - b).join("-") !== dailySet, `B1: the fun pairing is a DIFFERENT pairing, not the daily pair re-dealt (${fun1} vs daily ${daily})`);
    assert(await page.evaluate(() => document.querySelector("#homeBattleBody230").innerHTML.includes("Practice matchup · Picks are just for fun")), "B1: the fun card wears the practice label");
    assert(await page.evaluate(() => !document.querySelector("#homeBattleBody230").innerHTML.includes("hb230-official240")), "B1: the official clarifier is gone while a fun matchup shows");
    assert(await page.evaluate(() => location.pathname === "/" && !document.querySelector("#viewBattles.active, #battles.active")), "B1: the tap did NOT navigate away to the Battles view");
    await page.locator("#homeBattleBody230 .hb230-skip:not(.hb230-official248)").click();
    await page.waitForTimeout(700);
    const fun2 = await page.evaluate(pairOf);
    assert(fun2.join("-") !== fun1.join("-"), `B1: TAP 2 ROTATES AGAIN — ${fun1} → ${fun2}`);
    assert([...fun2].sort((a, b) => a - b).join("-") !== [...fun1].sort((a, b) => a - b).join("-"), `B1: tap 2 is a different pairing again (${fun2} vs ${fun1})`);
    await page.locator("#homeBattleBody230 .hb230-skip:not(.hb230-official248)").click();
    await page.waitForTimeout(700);
    const fun3 = await page.evaluate(pairOf);
    assert(fun3.join("-") !== fun2.join("-"), `B1: TAP 3 ROTATES AGAIN — ${fun2} → ${fun3}`);
    // a fun pick is local only
    await page.locator("#homePickA230").click();
    await page.waitForTimeout(700);
    assert(await page.evaluate(() => document.querySelector("#homeBattleBody230").innerHTML.includes("Your pick")), "B1: a fun Vote tap marks 'Your pick' on the card");
    const badPosts = posts.slice(postsBefore1).filter((u) => u.includes("/daily-battle/pick") || /\/api\/highlights\/\d+\/vote/.test(u));
    assert(badPosts.length === 0, `B1: skips + the fun pick fired NO daily-pick and NO contest-vote POSTs (${JSON.stringify(badPosts)})`);
    // back to the official matchup
    await page.locator(".hb230-official248").click();
    await page.waitForTimeout(700);
    const restored = await page.evaluate(pairOf);
    assert(restored.join("-") === daily.join("-"), `B1: 'Today's official matchup ↑' restores the daily pairing (${restored} = ${daily})`);
    assert(await page.evaluate(() => document.querySelector("#homeBattleBody230").innerHTML.includes("hb230-official240")), "B1: the official clarifier is back with the daily card");

    // ===== B2. Fix 2 — Share on Watch-board cards =====
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector(".tile .tile-share-btn248", { timeout: 20000 });
    await page.waitForTimeout(800);
    const tileInfo = await page.evaluate(() => ({
      tiles: document.querySelectorAll(".tile").length,
      shares: document.querySelectorAll(".tile .tile-share-btn248").length,
      dots: document.querySelectorAll(".tile-dots").length,
    }));
    assert(tileInfo.tiles > 0 && tileInfo.shares === tileInfo.tiles, `B2: every Watch tile carries a Share button (${tileInfo.shares}/${tileInfo.tiles})`);
    assert(tileInfo.dots === 0, "B2: no decorative ⋮ glyph remains on any tile");
    const firstTileId = await page.evaluate(() => document.querySelector(".tile").getAttribute("data-tile-id"));
    const postsBefore2 = posts.length;
    await page.locator(`.tile[data-tile-id="${firstTileId}"] .tile-share-btn248`).click();
    let flipped = false, sharedUrl = "";
    for (let i = 0; i < 30 && !flipped; i++) {
      await page.waitForTimeout(120);
      const st = await page.evaluate(() => ({
        label: (document.querySelector(".tile .tile-share-btn248") || {}).textContent || "",
        shared: window.__shared248 || [],
      }));
      if (st.label.includes("Link copied")) flipped = true;
      if (st.shared.length) sharedUrl = st.shared[st.shared.length - 1];
    }
    assert(flipped, "B2: tapping Share flips the button to 'Link copied ✓' — the share/copy path ran end to end");
    assert(sharedUrl.includes(`#play-${firstTileId}`), `B2: the shared payload is THIS play's link (${sharedUrl})`);
    assert(posts.slice(postsBefore2).length === 0, "B2: sharing fires no POSTs at all");

    // ===== B4. Fix 4 — athlete-page card media opens the play =====
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1500);
    await page.evaluate(() => openAthlete("bf76409cc549a0b2"));
    await page.waitForSelector("#athleteBoard .card .thumb .tile-tap", { timeout: 20000 });
    await page.waitForTimeout(600);
    const cardId = await page.evaluate(() => document.querySelector("#athleteBoard .card").getAttribute("data-play-id"));
    await page.locator(`#athleteBoard .card[data-play-id="${cardId}"] .thumb .tile-tap`).click();
    /* openPlay189's contract: a board tile opens the feed; any
       other surface takes its designed fallback, the play
       detail. The athlete card rides the same entry — the
       assertion is that THE PLAY OPENS (detail panel for the
       tapped play, or the feed at it), where before the tap
       did nothing at all. */
    let opened = null;
    for (let i = 0; i < 25 && !opened; i++) {
      await page.waitForTimeout(200);
      opened = await page.evaluate(() => {
        const f = document.querySelector("#feed189");
        if (f && !f.hidden && typeof feed189 !== "undefined" && feed189.open) return { via: "feed", id: feed189.ids[feed189.index] };
        const d = document.querySelector("#playDetail");
        if (d && !d.hidden && typeof detailPlayId !== "undefined" && detailPlayId != null) return { via: "detail", id: detailPlayId };
        return null;
      });
    }
    assert(!!opened, "B4: tapping the athlete card's media OPENS THE PLAY — the audit's dead video now opens");
    assert(opened && String(opened.id) === String(cardId), `B4: the play that opens is the tapped card's play (${opened && opened.via} → ${opened && opened.id} = card ${cardId})`);
    if (opened && opened.via === "detail") {
      await page.evaluate(() => { if (typeof hidePlayDetail === "function") hidePlayDetail(); });
      await page.waitForTimeout(400);
    }

    // ===== B5. Fix 5 — picking a video keeps the studio at its top =====
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#homeBattle230:not([hidden])", { timeout: 30000 });
    await page.waitForTimeout(1200);
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector('.tile[data-tile-id="75"] .tile-hf-btn', { timeout: 20000 });
    await page.locator('.tile[data-tile-id="75"] .tile-hf-btn').click();
    await page.waitForTimeout(1800);
    const topCheck = async () => page.evaluate(() => {
      const hf = document.querySelector("#hypeframe");
      const g = document.querySelector("#hfGarment206");
      const gr = g ? g.getBoundingClientRect() : null;
      return {
        y: Math.round(scrollY),
        maxY: document.documentElement.scrollHeight - window.innerHeight,
        hfAbsTop: hf ? Math.round(hf.getBoundingClientRect().top + scrollY) : null,
        garmentInView: !!gr && gr.top >= -10 && gr.top < window.innerHeight,
        playId: typeof hfState !== "undefined" && hfState.play ? hfState.play.id : null,
      };
    });
    const entry = await topCheck();
    assert(entry.playId === 75 && entry.garmentInView, `B5: entering the studio from a tile lands at the working top (play ${entry.playId}, scrollY ${entry.y})`);
    // Re-pick a DIFFERENT video from the studio's play picker (Emil's exact path)
    await page.evaluate(() => openHfChoice());
    await page.waitForTimeout(500);
    await page.evaluate(() => window.hfChoicePosted());
    await page.waitForTimeout(500);
    await page.locator(".hf-picker-row", { hasText: "Double" }).first().click();
    await page.waitForTimeout(250);
    /* Simulate the iOS failure mid-flight: the entry repaints
       (poster seed, garment load, strip build) let scroll
       anchoring throw the viewport to the page bottom. The
       guard's timed re-assertions must bring it back — and
       hold it — at the studio top. */
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1650);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(1700);
    const settled = await topCheck();
    assert(settled.playId === 71, `B5: the picker tap switched the studio to the picked play (Double, id ${settled.playId})`);
    assert(settled.garmentInView, `B5: after the pick the garment preview — the working area — is IN VIEW (scrollY ${settled.y})`);
    assert(settled.y < settled.maxY - 200, `B5: the viewport is NOT at the page bottom (scrollY ${settled.y} vs max ${settled.maxY}) — Emil's size/Review/footer landing is fixed`);
    assert(Math.abs(settled.y - (settled.hfAbsTop - 50)) <= 45, `B5: the viewport rests at the studio top (scrollY ${settled.y}, studio abs top ${settled.hfAbsTop})`);

    // ===== B3. Fix 3 — footer links clear of the A2HS bar =====
    const ctx3 = await browser.newContext({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPHONE_UA,
    });
    const p3 = await ctx3.newPage();
    p3.on("pageerror", (e) => console.log("pageerror(B3):", String(e).slice(0, 160)));
    await p3.addInitScript(() => { try { localStorage.setItem("hh_a2hs_visits161", "1"); } catch { /* fine */ } });
    await p3.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    let barUp = false;
    for (let i = 0; i < 40 && !barUp; i++) {
      await p3.waitForTimeout(250);
      barUp = await p3.evaluate(() => { const b = document.querySelector("#a2hsBar161"); return !!b && !b.hidden && document.body.classList.contains("a2hs-open161"); });
    }
    assert(barUp, "B3: the A2HS bar shows for a return iOS visit (the audit's precondition)");
    /* The page scrolls SMOOTHLY (scroll-behavior:smooth) — a
       same-task rect read catches scrollY mid-animation, so
       scroll, let it settle, THEN measure. */
    const hitTest = async () => {
      await p3.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await p3.waitForTimeout(800);
      return p3.evaluate(() => {
        const link = document.querySelector('footer a[href="/about"]');
        if (!link) return { err: "no link" };
        const r = link.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return { cx, cy, hitLink: !!hit && (hit === link || link.contains(hit)), hitDesc: hit ? (hit.id || hit.className || hit.tagName) : "none" };
      });
    };
    await p3.waitForTimeout(400);
    const hit1 = await hitTest();
    assert(hit1.hitLink, `B3: at max scroll with the bar UP, the Our Story link's center hits the LINK, not the bar (hit: ${hit1.hitDesc})`);
    // expand the iOS steps — the taller bar state must clear too
    await p3.locator("#a2hsBtn161").click();
    await p3.waitForTimeout(500);
    assert(await p3.evaluate(() => document.body.classList.contains("a2hs-steps161")), "B3: the bar's How button still expands the iOS steps");
    const hit2 = await hitTest();
    assert(hit2.hitLink, `B3: with the steps OPEN, the Our Story link's center still hits the LINK (hit: ${hit2.hitDesc})`);
    // a real tap on the link navigates
    await p3.touchscreen.tap(hit2.cx, hit2.cy);
    await p3.waitForTimeout(1500);
    assert(await p3.evaluate(() => location.pathname.replace(/\/$/, "") === "/about" || location.pathname.includes("about")), `B3: a real tap on Our Story navigates to the About page (${await p3.evaluate(() => location.pathname)})`);
    // dismiss still works and the clearance leaves with the bar
    await p3.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    let barUp2 = false;
    for (let i = 0; i < 40 && !barUp2; i++) {
      await p3.waitForTimeout(250);
      barUp2 = await p3.evaluate(() => { const b = document.querySelector("#a2hsBar161"); return !!b && !b.hidden; });
    }
    assert(barUp2, "B3: the bar returns on the next visit (not dismissed yet)");
    await p3.locator("#a2hsX161").click();
    await p3.waitForTimeout(500);
    const afterX = await p3.evaluate(() => ({
      hidden: document.querySelector("#a2hsBar161").hidden,
      open: document.body.classList.contains("a2hs-open161"),
      pad: getComputedStyle(document.querySelector("footer")).paddingBottom,
    }));
    assert(afterX.hidden && !afterX.open, "B3: the ✕ still dismisses the bar");
    assert(afterX.pad !== "118px" && afterX.pad !== "200px", `B3: the footer clearance leaves with the bar (padding-bottom back to ${afterX.pad})`);
    await ctx3.close();
  } finally {
    await browser.close();
    child.kill("SIGKILL");
  }
}

console.log(`\ntest-r248: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
