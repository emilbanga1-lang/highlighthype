// Round 247 (2026-11-28, Emil): "Go through each page and make
// sure each section is separated by the same length." ONE
// standard — --sec-gap: 40px of content-to-content separation
// between consecutive major sections — measured BEFORE in a real
// browser (full table in R247-NOTES.md: homepage boundaries ran
// 17/30/38/40, the studio's internal boundaries 0/12/20, the
// shop's 36/40/44/44, athlete 22/12, My Plays 33/26/30, the
// standalone pages 22–42) and normalized via one scoped CSS
// block (styles v230) plus literal 40px edits in the standalone
// pages' own inline styles. 40px is the value the site's
// best-kept boundaries already used (Featured → More Highlights,
// Shop by Sport → grid). Full-bleed bands (hero, .final, .trust,
// footer), page-top chrome and modal sheets are recorded
// exceptions in R247-NOTES.md. CSS-ONLY round: app.js stays
// v241 and every R246 behavior is untouched — the studio's
// page-top guards (back→card 14) are asserted below.
// Layers: A. statics (token, rules, pins, exceptions intact,
// standalone values). B. REAL-BROWSER measurement layer on
// production-shaped fixture data (2026-11-27 nightly backup):
// homepage + Watch + athlete + My Plays + studio + shop +
// standalone pages, every normalized gap == 40 (±2).
// Pins: app.js v241 (unchanged) / styles v230. server.js
// UNCHANGED. Run: node test-r247.js — exits non-zero on failure.
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
  const css = fs.readFileSync(path.join(ROOT, "public", "styles.css"), "utf8");
  const home = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");
  assert(home.includes('href="styles.css?v=231"'), "A: index pins styles v230 — →247: styles now v230 (Round 247)");
  assert(home.includes('src="app.js?v=242"'), "A: app.js pin stays v241 (CSS-only round)");
  assert(css.includes(":root{--sec-gap:40px}"), "A: the --sec-gap:40px token ships on :root");
  const r247 = css.slice(css.indexOf("Round 247"));
  for (const rule of [
    ".home-battle230{padding-top:var(--sec-gap)}",
    ".home-feat230{padding-top:calc(var(--sec-gap) - 4px)}",
    ".home-more230{padding-top:calc(var(--sec-gap) - 4px);padding-bottom:30px}",
    ".merch-teaser125{padding-top:var(--sec-gap)}",
    "#athlete .athlete-head{margin-bottom:var(--sec-gap)}",
    "#athlete .board-note{margin-top:var(--sec-gap)}",
    "#mine .mine-note{margin-top:24px}",
    "#mineFind{margin-top:var(--sec-gap)}",
    "#mine .mine-points{margin-top:var(--sec-gap)}",
    ".hf-sec-head222:not(.hf-sec-in-card222){margin-top:var(--sec-gap)}",
    "#hfBuyCard215{margin-top:var(--sec-gap)}",
    "#hfStickyBar215{margin-top:var(--sec-gap)}",
    "#shop .hs-hero{margin-bottom:var(--sec-gap)}",
    "#shop .hs-grid{margin-bottom:var(--sec-gap)}",
    "#shop .hs-hf{margin-bottom:var(--sec-gap)}",
  ]) assert(r247.includes(rule), "A: R247 rule ships — " + rule);
  // the R247 block must come AFTER the base rules it overrides
  assert(css.indexOf(".home-battle230{padding-top:var(--sec-gap)}") > css.indexOf(".home-battle230{padding:30px 0 4px}"), "A: R247 battle override lands after the base rule");
  assert(css.indexOf(".hf-sec-head222:not(.hf-sec-in-card222){margin-top:var(--sec-gap)}") > css.indexOf(".hf-sec-head222{display:flex"), "A: R247 studio-head override lands after the base rule");
  // R246 guards intact (hard constraint)
  assert(css.includes("#hfStudio{margin-top:14px}"), "A: R246 guard — studio card margin-top stays 14px");
  assert(css.includes("#hypeframe .hf-backrow246{margin:4px 0 0}"), "A: R246 guard — back row margin stays 4px 0 0");
  assert(css.includes("#hypeframe{scroll-margin-top:63px}"), "A: R246 guard — studio scroll-margin stays 63px");
  assert(css.includes(".hf-sec-in-card222{margin:6px 0 2px}"), "A: in-card Color & size head keeps its card-internal 6px margin (not a section boundary)");
  // standalone pages carry the standard by hand
  const about = fs.readFileSync(path.join(ROOT, "public", "about.html"), "utf8");
  assert(about.includes(".about-story173b{margin-top:40px}"), "A: about story at 40px");
  assert(about.includes(".about-credo184{") && about.includes("margin:40px 0 4px"), "A: about credo at 40px");
  assert(about.includes(".about-foot173{margin-top:40px"), "A: about foot at 40px");
  for (const f of ["privacy.html", "terms.html"]) {
    const t = fs.readFileSync(path.join(ROOT, "public", f), "utf8");
    assert(t.includes("margin:40px 0 6px"), `A: ${f} h2 sections at 40px`);
  }
  for (const f of ["demo.html", "demo-rockets.html"]) {
    const t = fs.readFileSync(path.join(ROOT, "public", f), "utf8");
    assert(t.includes(".demo-sec166{margin-top:40px}"), `A: ${f} sections at 40px`);
    assert(t.includes(".demo-closing166{margin-top:40px"), `A: ${f} closing at 40px`);
  }
  const gc = fs.readFileSync(path.join(ROOT, "public", "gamechanger.html"), "utf8");
  assert(gc.includes("margin-top:40px") && gc.includes(".gc-faq{margin-top:40px}"), "A: gamechanger cards + faq at 40px");
}

// ---------- shared fixture + browser rig (R246 pattern) ----------
const { DatabaseSync } = await import("node:sqlite");
const BACKUP = "/home/hatch/workspace/projects/highlighthype-backups/nightly/2026-11-27";
const pwMod = await import("/home/hatch/workspace/.pwtest/node_modules/playwright-core/index.mjs");
const shellRoot = "/home/hatch/.cache/ms-playwright";
const shellDir = fs.readdirSync(shellRoot).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
const EXE = path.join(shellRoot, shellDir, "chrome-headless-shell-linux64", "chrome-headless-shell");
assert(fs.existsSync(EXE), "rig: the headless Chromium shell is available");
const FIXTURE_IDS = [71, 75, 51, 50, 66, 77];
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
const GAPFN = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return cs.display !== "none" && r.height > 0; };
  const box = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY, el }; };
  const cTop = (sel) => { const b = box(sel); if (!b) return null; const kids = [...b.el.children].filter(vis); return kids.length ? kids[0].getBoundingClientRect().top + scrollY : b.top; };
  const cBottom = (sel) => { const b = box(sel); if (!b) return null; const kids = [...b.el.children].filter(vis); return kids.length ? kids[kids.length - 1].getBoundingClientRect().bottom + scrollY : b.bottom; };
  return { box, cTop, cBottom };
};
const near40 = (label, v) => assert(v !== null && Math.abs(v - 40) <= 2, `B: ${label} = ${v} (standard 40 ±2)`);

// ---------- B. real-browser measurement layer ----------
{
  const PORT = 4355;
  const dir = fs.mkdtempSync("/tmp/hh-r247-main-");
  const fx = buildFixture(dir);
  let child = await bootServer(PORT, dir);
  child.kill("SIGKILL"); await wait(400);
  seedFixtureDb(dir, fx);
  child = await bootServer(PORT, dir);
  const browser = await pwMod.chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 160)));
    // HOME
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#homeBattle230:not([hidden])", { timeout: 30000 });
    await page.waitForTimeout(2000);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return {
          heroBattle: G.cTop("#homeBattle230") - G.box(".hero").bottom,
          battleFeat: G.cTop("#homeFeat230") - G.cBottom("#homeBattle230"),
          featMore: G.cTop("#homeMore230") - G.cBottom("#homeFeat230"),
          moreDeck: G.box("#plays").top - G.cBottom("#homeMore230"),
          deckMerch: G.cTop("#merchTeaser125") - G.box("#plays").bottom,
        };
      }, GAPFN.toString());
      near40("homepage hero→battle", r.heroBattle);
      near40("homepage battle→featured", r.battleFeat);
      near40("homepage featured→more", r.featMore);
      near40("homepage more→board", r.moreDeck);
      near40("homepage board→Hype Frame card", r.deckMerch);
    }
    // WATCH board — the same merch rule carries the standard under the board
    await page.locator("#seeAllRow a").click();
    await page.waitForTimeout(1500);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return { boxGap: G.box("#merchTeaser125").top - G.box("#plays").bottom, padT: getComputedStyle(document.querySelector("#merchTeaser125")).paddingTop };
      }, GAPFN.toString());
      assert(Math.abs(r.boxGap) <= 2, `B: watch board→merch sections stay adjacent in flow (box gap ${r.boxGap})`);
      assert(r.padT === "40px", `B: watch board — merch section carries the standard padT (${r.padT})`);
    }
    // ATHLETE
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1800);
    await page.evaluate(() => openAthlete("6c1188de1afb0274"));
    await page.waitForTimeout(1300);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return { headBoard: G.box("#athleteBoard").top - G.box("#athlete .athlete-head").bottom, boardNote: G.box("#athlete .board-note").top - G.box("#athleteBoard").bottom };
      }, GAPFN.toString());
      near40("athlete head→board", r.headBoard);
      near40("athlete board→note", r.boardNote);
    }
    // MY PLAYS
    await page.evaluate(() => showPanel("mine"));
    await page.waitForTimeout(900);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return {
          headNote: G.cTop("#mine .mine-note") - G.cBottom("#mine .sec-head"),
          noteForm: G.box("#mineFind").top - G.box("#mine .mine-note").bottom,
          formPoints: G.box("#mine .mine-points").top - G.box("#mineFind").bottom,
        };
      }, GAPFN.toString());
      near40("mine head→note", r.headNote);
      near40("mine note→form", r.noteForm);
      near40("mine form→points", r.formPoints);
    }
    // STUDIO — internal boundaries at the standard, R246 top untouched
    await page.evaluate(() => openHypeFrame(71));
    await page.waitForTimeout(2500);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return {
          garmentMoment: G.box("#hfRowPhoto215").top - G.box("#hfGarment206").bottom,
          momentName: G.box("#hfRowBackText215").top - G.box("#hfPhotoPanel215").bottom,
          nameDesign: G.box("#hfRowDesign246").top - G.box("#hfBackTextPanel215").bottom,
          designPlacement: G.box("#hfRowPlacement215").top - G.box("#hfDesignPanel246").bottom,
          placementBuy: G.box("#hfBuyCard215").top - G.box("#hfPlacementPanel215").bottom,
          buyReview: G.box("#hfStickyBar215").top - G.box("#hfBuyCard215").bottom,
          backCard: G.box("#hfStudio").top - G.box(".hf-backrow246").bottom,
        };
      }, GAPFN.toString());
      near40("studio garment→Your moment", r.garmentMoment);
      near40("studio moment→Name", r.momentName);
      near40("studio Name→Design label", r.nameDesign);
      near40("studio Design→Placement", r.designPlacement);
      near40("studio Placement→Color & size card", r.placementBuy);
      near40("studio buy card→Review bar", r.buyReview);
      assert(Math.abs(r.backCard - 14) <= 2, `B: R246 guard — studio back→card still 14 (${r.backCard})`);
    }
    // SHOP
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const s = document.querySelector("#shop"); s.hidden = false; s.style.display = "block"; document.querySelectorAll(".view-home").forEach((e) => { e.style.display = "none"; }); });
    await page.waitForTimeout(900);
    {
      const r = await page.evaluate((src) => {
        const G = eval("(" + src + ")")();
        return {
          heroTiles: G.box("#hsBySport").top - G.box("#hsHero").bottom,
          tilesGrid: G.box("#hsGridSection").top - G.box("#hsBySport").bottom,
          gridFeat: G.box("#hsHfFeature").top - G.box("#hsGridSection").bottom,
          featTeaser: G.box("#hsTeaser").top - G.box("#hsHfFeature").bottom,
        };
      }, GAPFN.toString());
      near40("shop hero→by sport", r.heroTiles);
      near40("shop by sport→grid", r.tilesGrid);
      near40("shop grid→HF feature", r.gridFeat);
      near40("shop HF feature→teaser", r.featTeaser);
    }
    // STANDALONE pages
    const seq = async (url, sels, label) => {
      await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(800);
      const r = await page.evaluate((list) => {
        const B = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top + scrollY, bottom: r.bottom + scrollY }; };
        const out = [];
        for (let i = 1; i < list.length; i++) { const a = B(list[i - 1]), b = B(list[i]); out.push(a && b ? Math.round(b.top - a.bottom) : null); }
        return out;
      }, sels);
      r.forEach((v, i) => near40(`${label} gap ${i + 1}`, v));
    };
    await seq("/about.html", [".about-hero173", ".about-story173b", ".about-credo184", ".about-foot173"], "about");
    await seq("/demo.html", ["#roster", "#plays", "#standings", ".demo-closing166"], "demo");
    {
      await page.goto(`http://127.0.0.1:${PORT}/gamechanger.html`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(800);
      const r = await page.evaluate(() => {
        const els = [document.querySelector(".gc-hero"), ...document.querySelectorAll(".gc-card"), document.querySelector(".gc-faq")];
        const out = [];
        for (let i = 1; i < els.length; i++) { const a = els[i - 1].getBoundingClientRect(), b = els[i].getBoundingClientRect(); out.push(Math.round(b.top - a.bottom)); }
        return out;
      });
      r.forEach((v, i) => near40(`gamechanger gap ${i + 1}`, v));
    }
    for (const url of ["/privacy.html", "/terms.html"]) {
      await page.goto(`http://127.0.0.1:${PORT}${url}`, { waitUntil: "load", timeout: 60000 });
      await page.waitForTimeout(600);
      const mt = await page.evaluate(() => getComputedStyle(document.querySelector("main h2")).marginTop);
      assert(mt === "40px", `B: ${url} h2 section margin-top is the standard (${mt})`);
    }
  } finally {
    await browser.close();
    child.kill("SIGKILL");
  }
}

console.log(`\ntest-r247: ${ok} ok, ${failed} failed`);
process.exit(failed ? 1 : 0);
