// Round 246 (2026-11-27, Emil — phone review of the R244/R245
// studio, 22:29–22:48): seven fixes.
//   (a) RECOMMENDED FRAME — play 71's ★ + default landed on
//       0:11/0:12 (empty fence frames) again. Play 71's
//       poster_time is NULL (only 3 of 14 plays carry one), so
//       the R244 anchor never fired; the scorer fallback's RAW
//       frame-diff motion term crowned the camera pan (a pan
//       maximizes frame diffs; a chain-link fence maximizes
//       sharpness). The poster itself shows the ~11.5s wide
//       dugout view, so poster-matching would reproduce the
//       bug. The scorer now scores LOCAL motion (pair energy ×
//       (1 − maskFrac)) and pan-gates frames whose adjacent
//       pairs move wholesale (maskFrac ≥ 0.35).
//   (b) FENCE AUTO PATH — the client's edit timeout equaled
//       the server's upstream abort (120s = 120s, no transit
//       budget), and any failure stood auto mode down for the
//       whole session. Now: a ~90s whole-run budget (the edit
//       gets what remains), failure reasons recorded on the
//       note's dataset.fenceFail246 + console, failures cached
//       per frame (no session stand-down), one plain fallback
//       line, and a retry that genuinely re-runs.
//   (c) TOP SPACING — scroll-margin-top 63px on the panel, the
//       back row's margins cut (16px → 4px top / 0 bottom), the
//       studio card's top margin 34px → 14px (scoped).
//   (d) ARTWORK SECTION DELETED — explainer, OpenAI disclosure,
//       crop control, maker panel, Use-avatar/Use-photo. The
//       avatar lifecycle lives in the preview card (progress /
//       ready / failure+retry / NEW "Make it again"); the
//       Frame pill stands an applied avatar down (the deleted
//       "Use my photo"'s job); Design label is its own section.
//   (e) MANUAL FENCE SECTION DELETED — the auto flow is the
//       only fence surface; payload never carried fence fields.
//   (f) BACK NAVIGATION — the studio's Back button returns to
//       the view the studio was opened FROM (home / watch /
//       feed / detail), restoring view + scroll; it no longer
//       rides the generic panel handler to the Watch board.
//   (g) FEED FRAME ENTRY — the playing video's rail gains a
//       📸 Frame item (non-sample plays) opening the studio
//       for that play; Back returns to the feed as left.
// Layers: A. statics (pins, deletions, payload, copy). B. VM
// scorer units (the real hfScoreStills205 on synthetic
// pan-vs-subject frames; the real play-71 strip when the
// diagnosis scratch is present). C. REAL-CLICK browser layer
// on production-shaped fixture data (the 2026-11-27 nightly
// backup): (a) star+default, (c) spacing, (d) DOM surface.
// D. REAL-CLICK fence + avatar against the real server with
// latency/shape-realistic upstream stubs (HF_AVATAR_BASE_URL
// + AI_VISION_BASE_URL seams; no real OpenAI/Anthropic calls):
// cleaned frame lands in the garment preview; stubbed failure
// → bounded plain fallback + diagnostics + working retry;
// avatar auto-start, "Make it again", Frame-pill stand-down.
// E. REAL-CLICK back navigation (home / watch / detail) and
// the feed Frame entry + back-to-feed.
// Pins: app.js v241 / styles v230. server.js UNCHANGED.
// Run: node test-r246.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import http from "node:http";
import { spawn } from "node:child_process";

const ROOT = "/home/hatch/workspace/projects/highlighthype-hosting";
const PUB = path.join(ROOT, "public");
const BACKUP = "/home/hatch/workspace/projects/highlighthype-backups/nightly/2026-11-27";
let failures = 0, oks = 0;
function assert(cond, msg) { if (cond) { oks++; console.log("ok -", msg); } else { failures++; console.error("FAIL -", msg); } }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const html = fs.readFileSync(path.join(PUB, "index.html"), "utf8");
const app = fs.readFileSync(path.join(PUB, "app.js"), "utf8");
const css = fs.readFileSync(path.join(PUB, "styles.css"), "utf8");

// ---------- A. statics ----------
assert(html.includes('src="app.js?v=241"'), "A: app.js pin v241");
assert(html.includes('href="styles.css?v=230"'), "A: styles pin v230 — →247: styles now v230 (Round 247)");
for (const gone of ["hfRowArtwork215", "hfArtworkPanel215", "hfAvatarPanel206", "hfAvatarMake206", "hfAvatarUse206", "hfAvatarPhoto206", "hfAvatarCropStage221", "hfAvatarImg206", "hfFence222", "hfFenceBtn222", "hfFenceUse222", "hfFenceKeep222", "hfFenceImg222", "hfRowArtworkState215", "hfAvatarStatus206", "hfAvatarResult206", "hfFenceStatus222", "hfFenceResult222"]) {
  assert(!html.includes('id="' + gone + '"'), `A: index.html no longer carries #${gone} (d/e)`);
  assert(!app.includes('$("#' + gone + '")'), `A: app.js no longer queries #${gone} (d/e)`);
}
for (const here of ["hfRowDesign246", "hfDesignPanel246", "hfRowDesignState246", "hfAvatarAgain246", "hfBackBtn246", "hfLabel218", "hfAvatarCard244", "hfFenceAutoNote229", "hfFenceAutoRetry244"]) {
  assert(html.includes('id="' + here + '"'), `A: index.html carries #${here}`);
}
assert(!html.includes("OpenAI"), "A: index.html never names OpenAI (d/e — no generation mechanics in customer copy)");
assert(!app.includes("how the image is being generated") && !app.includes("sent to OpenAI"), "A: app.js carries no generation-mechanics copy");
const backBtnTag = (html.match(/<button[^>]*id="hfBackBtn246"[^>]*>/) || [""])[0];
assert(backBtnTag && !backBtnTag.includes("data-panel-btn"), "A: the studio Back button does NOT ride the generic panel handler (f)");
assert(app.includes("function hfCaptureOrigin246()") && app.includes("window.hfBack246"), "A: origin capture + hfBack246 exist (f)");
assert(app.includes("window.feedFrame246") && app.includes("feed189-frame246"), "A: the feed Frame entry exists (g)");
assert(app.includes('"We couldn\'t clean this frame — try another frame."') || app.includes("We couldn't clean this frame — try another frame."), "A: the ONE plain fence fallback line is the failure copy (b/e)");
assert(!app.includes("or use the manual fence step below") && !app.includes("the manual fence step is below"), "A: no copy points at the deleted manual fence step (e)");
for (const goneFn of ["function hfMakeFence222", "function hfUseFence222", "function hfKeepFence222", "function hfFenceNote222", "function hfSyncAvatarCrop221", "function hfAvatarCropTap221", "function hfAvatarCropSrc221"]) {
  assert(!app.includes(goneFn), `A: ${goneFn} is deleted (d/e)`);
}
assert(app.includes("avatarGenerated: hfState.avatarApplied206 === true") && app.includes("imageStyle: hfState.imageStyle") && app.includes("designLabel: hfDesignLabel218()"), "A: the order payload carries the avatar choice exactly as before (d)");
assert(app.includes("PAN246 = 0.35") && app.includes("(1 - p.maskFrac)"), "A: the scorer scores local motion and pan-gates (a)");
const modeBody = (app.match(/function hfFenceAutoMode229\(\) \{[^}]*\}/) || [""])[0];
assert(modeBody.includes("fenceAuto229 === true") && !modeBody.includes("fenceAutoFailed229"), "A: a failed fence attempt no longer stands auto mode down for the session (b)");
assert(app.includes("BUDGET246 = 90000") && app.includes("dataset.fenceFail246"), "A: the fence run is budgeted (~90s) and records failure diagnostics (b)");
assert(css.includes("#hypeframe{scroll-margin-top:63px}") && css.includes("#hfStudio{margin-top:14px}") && css.includes(".hf-backrow246{margin:4px 0 0}"), "A: the Round 246 spacing rules are in styles.css (c)");
assert(css.includes(".feed189-frame246{"), "A: the feed Frame button is styled (g)");
const rowsBody = (app.match(/const HF_ROWS215 = \{[^}]*\}/) || [""])[0];
assert(rowsBody.includes("design:") && !rowsBody.includes("artwork:"), "A: the section rows name a Design row, not Artwork (d)");

// ---------- B. scorer units (the real hfScoreStills205) ----------
{
  const fnStart = app.indexOf("function hfScoreStills205");
  const fnEnd = app.indexOf("\n}\n", fnStart) + 3;
  assert(fnStart > 0 && fnEnd > fnStart, "B: hfScoreStills205 located in app.js");
  const ctx = { Math, Float32Array, console };
  vm.createContext(ctx);
  vm.runInContext(app.slice(fnStart, fnEnd), ctx);
  const W = 48, H = 85, N = W * H;
  const checker = (shift) => { const a = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) a[y * W + x] = ((x + shift + y) % 2) * 200 + 20; return a; };
  const f0 = checker(0);
  const withBlock = (bx) => { const a = f0.slice(); for (let y = 38; y < 48; y++) for (let x = bx; x < bx + 10; x++) a[y * W + x] = 255; return a; };
  // f0 is a fade-in frame (mean < 10 — excluded, and its pair
  // is excluded with it, mirroring the classic black 0:00).
  // A subject appears at f1 and keeps moving across f2–f3
  // (local changes only); f4/f5 are wholesale checker shifts —
  // the camera-pan signature (every pixel flips; maskFrac ~1).
  // The R244 scorer crowned the pan on sharpness; the winner
  // must come from the subject run — deterministically f2
  // (the first frame whose INCOMING pair carries the subject's
  // motion, with the best-centred mask of the tied pair).
  const fade = new Float32Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) fade[y * W + x] = ((x + y) % 2) * 8 + 2;
  const frames = [fade, withBlock(15), withBlock(19), withBlock(23), checker(1), checker(0)].map((lum) => ({ lum, w: W, h: H }));
  const rec = ctx.hfScoreStills205(frames);
  assert(rec === 2, `B: the scorer crowns the subject's motion frame (rec=${rec}), never a camera-pan frame`);
  const stripPath = "/tmp/r246/strip71.json";
  if (fs.existsSync(stripPath)) {
    const strip = JSON.parse(fs.readFileSync(stripPath, "utf8"));
    const real = ctx.hfScoreStills205(strip.map((lum) => ({ lum: Float32Array.from(lum), w: W, h: H })));
    assert(real >= 1 && real <= 3, `B: on the REAL play-71 strip the scorer crowns the at-bat (rec=${real} ∈ 1..3)`);
  } else {
    console.log("note - B: /tmp/r246/strip71.json absent; the real-strip unit is skipped (the browser layer §C covers the real data)");
  }
}

// ---------- shared fixture + browser rig ----------
const { DatabaseSync } = await import("node:sqlite");
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
async function bootServer(port, dir, extraEnv) {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, PORT: String(port), DATA_DIR: dir, OPENAI_API_KEY: "", AI_VISION_API_KEY: "", ...KILL_SWITCHES, ...(extraEnv || {}) },
    stdio: "ignore",
  });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/api/health`); if (r.ok) return child; } catch { /* not up yet */ }
    await wait(250);
  }
  child.kill("SIGKILL");
  throw new Error("FAIL: the server did not boot on port " + port);
}
async function bootSeeded(port, dir, extraEnv) {
  const fx = buildFixture(dir);
  let child = await bootServer(port, dir, extraEnv);
  child.kill("SIGKILL");
  await wait(400);
  seedFixtureDb(dir, fx);
  child = await bootServer(port, dir, extraEnv);
  return { child, fx };
}
async function newPage(browser, port) {
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  page.on("pageerror", (e) => console.log("pageerror:", String(e).slice(0, 200)));
  await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: "load", timeout: 60000 });
  return page;
}
const settleScroll = async (page) => {
  let last = -1, stable = 0;
  for (let i = 0; i < 34 && stable < 3; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (Math.abs(y - last) <= 0.5) stable++; else stable = 0;
    last = y;
    await page.waitForTimeout(120);
  }
};
const waitFor = async (page, fn, timeoutMs, label) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await page.evaluate(fn);
    if (v) return v;
    await page.waitForTimeout(400);
  }
  throw new Error("FAIL: timed out waiting for " + label);
};

// ---------- C. real-click: (a) star+default, (c) spacing, (d) DOM ----------
{
  const PORT = 4346;
  const dir = fs.mkdtempSync("/tmp/hh-r246-main-");
  const { child, fx } = await bootSeeded(PORT, dir);
  assert(fx.rows[71] && fx.rows[71].poster_time == null, "C: the fixture's play 71 carries poster_time NULL, exactly like production (the anchor cannot fire — the scorer must decide)");
  const browser = await pwMod.chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  try {
    const page = await newPage(browser, PORT);
    await page.waitForSelector("#seeAllRow a", { timeout: 30000 });
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector('button.tile-hf-btn[onclick*="openHypeFrame(71)"]', { state: "visible", timeout: 30000 });
    await page.locator('button.tile-hf-btn[onclick*="openHypeFrame(71)"]').first().click();
    const star = await waitFor(page, () => {
      const badge = document.querySelector("#hfStrip .hf-rec-badge205");
      const btn = badge ? badge.closest("button") : null;
      return (btn && typeof hfState !== "undefined" && hfState.frameTime205 != null) ? { starT: btn.dataset.hfT, frameTime205: hfState.frameTime205 } : null;
    }, 90000, "the play-71 strip to build and commit its pick");
    assert(["1", "2", "3"].includes(String(star.starT)), `C(a): fresh entry on play 71 stars the at-bat frame (★ = 0:0${star.starT})`);
    assert(Number(star.starT) === Number(star.frameTime205), `C(a): the DEFAULT selection is the starred frame (selected 0:0${star.frameTime205})`);
    const label = await page.evaluate(() => (document.querySelector("#hfSelected205") || {}).textContent || "");
    assert(label.includes("0:0" + star.starT), `C(a): the selection label names the at-bat ("${label.trim()}")`);

    // (c) spacing — card gap raw (structural), header gap at the
    // margin-honored rest (a controlled scrollIntoView, the same
    // call the studio entry makes; the headless boot's raw entry
    // rest under-slides by a 14px collapsing boot element — see
    // R246-NOTES (c)).
    const gaps1 = await page.evaluate(() => {
      const back = document.querySelector("#hfBackBtn246");
      const card = document.querySelector("#hfStudio");
      return { backToCard: Math.round(card.getBoundingClientRect().top - back.getBoundingClientRect().bottom) };
    });
    assert(gaps1.backToCard >= 12 && gaps1.backToCard <= 16, `C(c): back→card gap is ${gaps1.backToCard}px (target 12–16)`);
    await page.evaluate(() => document.querySelector("#hypeframe").scrollIntoView());
    await settleScroll(page);
    const gaps2 = await page.evaluate(() => {
      const hdr = document.querySelector("header");
      const back = document.querySelector("#hfBackBtn246");
      return { headerToBack: Math.round(back.getBoundingClientRect().top - hdr.getBoundingClientRect().bottom) };
    });
    assert(gaps2.headerToBack >= 10 && gaps2.headerToBack <= 14, `C(c): header→back gap is ${gaps2.headerToBack}px at the panel's rest (target 10–14)`);

    // (d) the deleted surfaces are gone from the live DOM; the
    // kept controls are present.
    const dom = await page.evaluate(() => ({
      artwork: !!document.querySelector("#hfRowArtwork215, #hfArtworkPanel215, #hfAvatarPanel206, #hfFence222"),
      design: !!document.querySelector("#hfDesignPanel246"),
      again: !!document.querySelector("#hfAvatarAgain246"),
      back: !!document.querySelector("#hfBackBtn246"),
      studioText: (document.querySelector("#hypeframe") || {}).textContent || "",
    }));
    assert(!dom.artwork, "C(d/e): no Artwork section, avatar maker panel, or manual fence section in the live studio DOM");
    assert(dom.design && dom.again && dom.back, "C(d/f): the Design section, the card's Make-it-again, and the new Back button are present");
    assert(!dom.studioText.includes("OpenAI"), "C(d): the rendered studio never names OpenAI");

    // ---------- E. back navigation + the feed entry ----------
    // E1 homepage origin: the site menu's 📸 Hype Frame (the
    // global entry, offered on the homepage) → the play picker
    // → the studio; Back returns to the homepage's month view
    // (the generic handler used to dump every exit on the
    // Watch board).
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#menuBtn", { state: "visible", timeout: 30000 });
    await page.locator("#menuBtn").click();
    await page.waitForSelector("#menuHf125", { state: "visible", timeout: 15000 });
    await page.locator("#menuHf125").click();
    await page.waitForSelector('.hf-choice-btn[onclick*="hfChoicePosted"]', { state: "visible", timeout: 15000 });
    await page.locator('.hf-choice-btn[onclick*="hfChoicePosted"]').click();
    await page.waitForSelector('.hf-picker-row[onclick*="hfPickerPick202(71)"]', { state: "visible", timeout: 15000 });
    await page.locator('.hf-picker-row[onclick*="hfPickerPick202(71)"]').click();
    await page.waitForSelector("#hfBackBtn246", { state: "visible", timeout: 30000 });
    await page.locator("#hfBackBtn246").click();
    await page.waitForTimeout(900);
    const homeBack = await page.evaluate(() => ({
      playsActive: document.querySelector('[data-panel="plays"]').classList.contains("active"),
      viewMonth: !document.querySelector("#viewMonth").hidden,
      viewAll: !document.querySelector("#viewAll").hidden,
      studioActive: document.querySelector('[data-panel="hypeframe"]').classList.contains("active"),
    }));
    assert(homeBack.playsActive && homeBack.viewMonth && !homeBack.viewAll && !homeBack.studioActive, "E(f): Back from a homepage (menu) entry returns to the homepage month view (not the Watch board)");

    // E2 watch origin: the Watch (all) view + its scroll are
    // restored (the deep tile's chip sets the scroll).
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#seeAllRow a", { timeout: 30000 });
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector('#viewAll button.tile-hf-btn[onclick*="openHypeFrame(77)"]', { state: "visible", timeout: 30000 });
    await page.evaluate(() => { const b = document.querySelector('#viewAll button.tile-hf-btn[onclick*="openHypeFrame(77)"]'); const r = b.getBoundingClientRect(); window.scrollTo(0, window.scrollY + r.top - 300); });
    await settleScroll(page);
    const watchY = await page.evaluate(() => Math.round(window.scrollY));
    await page.locator('#viewAll button.tile-hf-btn[onclick*="openHypeFrame(77)"]').first().click();
    await page.waitForSelector("#hfBackBtn246", { state: "visible", timeout: 30000 });
    await page.locator("#hfBackBtn246").click();
    await settleScroll(page);
    await page.waitForTimeout(400);
    const watchBack = await page.evaluate(() => ({ viewAll: !document.querySelector("#viewAll").hidden, viewMonth: !document.querySelector("#viewMonth").hidden, y: Math.round(window.scrollY) }));
    assert(watchBack.viewAll && !watchBack.viewMonth, "E(f): Back from a Watch-board entry returns to the Watch board");
    assert(Math.abs(watchBack.y - watchY) <= 160, `E(f): …and restores the Watch scroll (${watchY} → ${watchBack.y}; the board's late-loading posters shift absolute Y, so the restore is approximate by nature)`);

    // E3 detail origin: the detail overlay reopens. (The
    // overlay is opened through its own entry — with the
    // fixture's plays it renders only inside other surfaces —
    // so it is opened directly here; the studio entry and the
    // Back under test are real clicks, and the origin capture
    // happens inside openHypeFrame either way.)
    await page.evaluate(() => window.openPlayDetail(71));
    await page.waitForSelector("#playDetail:not([hidden])", { timeout: 15000 });
    await page.locator('#playDetailBody button[onclick*="openHypeFrame(71)"]').first().click();
    await page.waitForSelector("#hfBackBtn246", { state: "visible", timeout: 30000 });
    await page.locator("#hfBackBtn246").click();
    await page.waitForTimeout(900);
    const detailBack = await page.evaluate(() => ({ detail: !document.querySelector("#playDetail").hidden }));
    assert(detailBack.detail, "E(f): Back from a detail entry reopens the play detail");

    // E4 (g) the feed: a per-play Frame entry, studio for that
    // play, Back returns to the feed as left. A Watch tile's
    // tap area opens the feed on that play.
    await page.evaluate(() => window.closePlayDetail && window.closePlayDetail());
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "load", timeout: 60000 });
    await page.waitForSelector("#seeAllRow a", { timeout: 30000 });
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector('.tile-tap[onclick*="openPlay189(71, this)"]', { state: "visible", timeout: 30000 });
    await page.locator('.tile-tap[onclick*="openPlay189(71, this)"]').first().click();
    const feedState = await waitFor(page, () => {
      const f = document.querySelector("#feed189");
      return (f && !f.hidden && typeof feed189 !== "undefined" && feed189.open) ? { id: feed189.ids[feed189.index], index: feed189.index } : null;
    }, 30000, "the video feed to open");
    const frameBtns = await page.locator(".feed189-frame246:visible").count();
    assert(frameBtns >= 1, "E(g): the playing video's rail carries a 📸 Frame entry");
    await page.locator(`.feed189-slide[data-feed-slide="${feedState.id}"] .feed189-frame246`).click();
    const studioPlay = await waitFor(page, () => (typeof hfState !== "undefined" && hfState.play ? { id: hfState.play.id } : null), 30000, "the studio to open from the feed");
    assert(studioPlay.id === feedState.id, `E(g): the studio opens FOR the feed's play (${feedState.id})`);
    await page.locator("#hfBackBtn246").click();
    const feedBack = await waitFor(page, () => {
      const f = document.querySelector("#feed189");
      return (f && !f.hidden && typeof feed189 !== "undefined" && feed189.open) ? { index: feed189.index } : null;
    }, 30000, "the feed to be restored");
    assert(feedBack.index === feedState.index, "E(g/f): Back returns to the feed at the same slide");
  } finally {
    await browser.close();
    child.kill("SIGKILL");
  }
}

// ---------- D. real-click fence + avatar against stubbed upstreams ----------
{
  const PORT = 4347, STUB = 4348;
  const dir = fs.mkdtempSync("/tmp/hh-r246-stub-");
  let stubMode = "ok";
  const stubCounts = { detect: 0, edits: 0 };
  const magentaB64 = await new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "color=magenta:size=64x64", "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"], { stdio: ["ignore", "pipe", "ignore"] });
    const chunks = [];
    ff.stdout.on("data", (c) => chunks.push(c));
    ff.on("close", () => resolve(Buffer.concat(chunks).toString("base64")));
    ff.on("error", reject);
  });
  assert(magentaB64.length > 100, "D: the stub's cleaned-frame PNG is generated (solid magenta — unmistakable in the preview)");
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      if (req.url.startsWith("/v1/messages")) {
        stubCounts.detect++;
        setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text: "{\"fence\": true}" }] })); }, 250);
      } else if (req.url.startsWith("/v1/images/edits")) {
        stubCounts.edits++;
        if (stubMode === "fail") { res.writeHead(500, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { message: "stub boom" } })); return; }
        setTimeout(() => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ b64_json: magentaB64 }] })); }, 700);
      } else { res.writeHead(404); res.end("{}"); }
    });
  });
  await new Promise((r) => stub.listen(STUB, "127.0.0.1", r));
  const { child } = await bootSeeded(PORT, dir, {
    OPENAI_API_KEY: "dummy-oai", AI_VISION_API_KEY: "dummy-vis",
    HF_AVATAR_BASE_URL: `http://127.0.0.1:${STUB}`, AI_VISION_BASE_URL: `http://127.0.0.1:${STUB}`,
  });
  const browser = await pwMod.chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  try {
    const page = await newPage(browser, PORT);
    const fenceApplied = () => {
      const b = document.querySelector("#hfFenceAutoOriginal229");
      return b && !b.hidden;
    };
    // D1: the auto clean lands — the CLEANED frame reaches the
    // garment preview (magenta probe across the studio's
    // canvases) and the revert toggle shows.
    await page.waitForSelector("#seeAllRow a", { timeout: 30000 });
    await page.locator("#seeAllRow a").click();
    await page.waitForSelector('button.tile-hf-btn[onclick*="openHypeFrame(71)"]', { state: "visible", timeout: 30000 });
    await page.locator('button.tile-hf-btn[onclick*="openHypeFrame(71)"]').first().click();
    await waitFor(page, fenceApplied, 90000, "the auto fence clean to apply on play 71");
    assert(true, "D(b): selecting a fence frame lands the CLEANED frame (the auto block offers the original back)");
    const magenta = await page.evaluate(() => {
      let found = 0;
      for (const c of document.querySelectorAll("#hypeframe canvas")) {
        try {
          const g = c.getContext("2d");
          const d = g.getImageData(0, 0, c.width, c.height).data;
          for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 90 && d[i + 2] > 200) found++;
        } catch { /* tainted or 3d canvas */ }
      }
      return found;
    });
    assert(magenta > 500, `D(b): the cleaned (magenta) frame is IN the garment preview (${magenta} magenta pixels)`);

    // D2: avatar lifecycle in the card — auto-start on the pill,
    // ready state, "Make it again", Frame pill stands it down.
    await page.locator('#hfImageStyles [data-hf-image-style="avatar"]').click();
    await waitFor(page, () => { const b = document.querySelector("#hfAvatarAgain246"); return b && !b.hidden; }, 90000, "the avatar to generate and land");
    const readyNote = await page.evaluate(() => (document.querySelector("#hfAvatarCardNote244") || {}).textContent || "");
    assert(readyNote.includes("Your avatar is ready"), `D(d): the card reports the avatar ready ("${readyNote.trim()}") and offers Make it again`);
    const editsBefore = stubCounts.edits;
    await page.locator("#hfAvatarAgain246").click();
    await waitFor(page, () => { const b = document.querySelector("#hfAvatarAgain246"); return b && !b.hidden; }, 90000, "the avatar to regenerate");
    assert(stubCounts.edits > editsBefore, "D(d): Make it again genuinely regenerates (a new upstream edit call)");
    await page.locator('#hfImageStyles [data-hf-image-style="photo"]').click();
    await page.waitForTimeout(400);
    const stoodDown = await page.evaluate(() => ({ style: hfState.imageStyle, applied: hfState.avatarApplied206 }));
    assert(stoodDown.style === "photo" && stoodDown.applied === false, "D(d): the Frame pill stands the avatar down — the photo is the print again (the deleted 'Use my photo' behavior)");

    // D3: stubbed failure → the bounded plain fallback, the
    // recorded reason, and a retry that genuinely re-runs.
    stubMode = "fail";
    await page.locator("#hfBackBtn246").click();
    await page.waitForTimeout(800);
    // (Back returned to the Watch board — D1's origin — so the
    // board's chips are already on screen.)
    await page.waitForSelector('button.tile-hf-btn[onclick*="openHypeFrame(75)"]', { state: "visible", timeout: 30000 });
    await page.locator('button.tile-hf-btn[onclick*="openHypeFrame(75)"]').first().click();
    const failed = await waitFor(page, () => {
      const n = document.querySelector("#hfFenceAutoNote229");
      const r = document.querySelector("#hfFenceAutoRetry244");
      return (n && n.textContent.includes("We couldn't clean this frame") && r && !r.hidden) ? { reason: n.dataset.fenceFail246 || "" } : null;
    }, 90000, "the fence failure fallback on play 75");
    assert(failed.reason.includes("http-502"), `D(b): the failure reason is recorded on the note's dataset — the server's own status + words for the stubbed upstream 500 ("${failed.reason}")`);
    stubMode = "ok";
    await page.locator("#hfFenceAutoRetry244").click();
    await waitFor(page, fenceApplied, 90000, "the retry to land the clean");
    assert(true, "D(b): after the stub recovers, Retry genuinely re-runs and the cleaned frame lands");
  } finally {
    await browser.close();
    child.kill("SIGKILL");
    stub.close();
  }
}

console.log(`\n${oks} ok, ${failures} failed`);
process.exit(failures ? 1 : 0);
