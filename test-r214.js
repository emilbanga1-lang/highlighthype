// Round 214 test: the studio stands alone — while the Hype
// Frame studio is the active panel, the whole home marketing
// stack stands down (Emil, 2026-11-26: "when someone clicks
// into the page to create one the hero area should not also be
// on the page"; options-widget pick: hide the WHOLE home
// stack; follow-up the same evening named #merchTeaser125 —
// "in studio when you scroll down you don't need to see the
// hype frame section from the home page").
// Run: node test-r214.js
// What this suite pins down:
//   A. Pins: app.js v213 / styles v209 (both files changed) —
//      →214: app.js now v214 / styles now v210 (Round 215).
//   B. The CSS: under body.hf-studio-open205 (the Round 205
//      body class showPanel already toggles) every .view-home
//      element is display:none, with the ONE carve-out the
//      Store doesn't need — #deck hosts the panels (its only
//      children are the six panels; only the active one
//      renders), so it stays display:block or the studio would
//      hide itself. The R205 pill rule and the body.store-open
//      rule are untouched.
//   C. The markup enumeration: exactly six .view-home elements
//      (hero #top, #deck, .owner-strip, #merchTeaser125 — the
//      homepage Hype Frame card Emil named, .final, .trust);
//      the studio section itself carries no view-home; the
//      footer carries none and stays; the studio keeps its own
//      Back to the board button.
//   D. VM drive of showPanel: hypeframe sets the class and
//      pauses EVERY .view-home video without playing the hero;
//      leaving to plays (or any other panel) clears the class
//      and restarts the hero under the Round 125 preference
//      (hh_music "off" → muted, otherwise sound on) with the
//      data-src lazy load honored; a plain panel switch with
//      no studio visit never force-plays the hero; the
//      store-open gate keeps the resume out of the Store's own
//      entry/exit path.
//   E. Entry funnel (statics): exactly two showPanel(
//      "hypeframe") call sites — openHypeFrame and the Round
//      200 return landing; the picker pick, the #hype-frame-
//      boot route, the hashchange route and the Round 139
//      history restore all reach the studio THROUGH
//      openHypeFrame; the choice modal's own-video path
//      (hfChoiceOwn → goSubmit) does NOT open the studio
//      panel; the body class is toggled in exactly one place.
//   F. Exit/restore (statics): the panel-button handler is
//      unchanged (showPanel + the #deck scroll — the deck is
//      the panel host, never hidden, so board entry lands as
//      it always has); openHypeFrame scrolls the studio panel
//      itself into view; goHome routes through showPanel(
//      "plays"); showHome carries the Round 214 guard (no hero
//      restart while the studio class is set — showPanel owns
//      the resume on studio exit).
//   G. Served: the homepage carries the new pins and the
//      teaser; the served CSS carries both R214 rules; the
//      served app.js carries the round's wiring.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r214-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log, stop: () => child.kill("SIGKILL") };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=222"') && home.includes('src="app.js?v=231"'), "A: asset pins — app.js v213 / styles v209 (Round 214; both files changed) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235)");

// ---- B. the CSS hide rule + the deck carve-out ----
assert(css.includes("body.hf-studio-open205 .view-home{display:none}"), "B: while the studio is open, every .view-home element is display:none under the Round 205 body class");
assert(css.includes("body.hf-studio-open205 #deck.view-home{display:block}"), "B: the deck carve-out — #deck hosts the panels and stays, or the studio would hide itself");
assert(css.includes("body.hf-studio-open205 .float-submit{display:none}"), "B: the Round 205 floating-pill rule rides the same body class, untouched");
assert(css.includes("body.store-open .view-home{display:none}"), "B: the Store's own home-stack rule is untouched (the shop lives outside the deck, so it needs no carve-out)");

// ---- C. the markup enumeration ----
for (const frag of ['class="hero view-home" id="top"', 'class="deck view-home" id="deck"', 'class="view-home owner-strip"', 'class="merch-teaser125 view-home" id="merchTeaser125"', 'class="final view-home"', 'class="trust view-home"', 'class="home-battle230 view-home" id="homeBattle230"', 'class="home-feat230 view-home" id="homeFeat230"', 'class="home-more230 view-home" id="homeMore230"'])
  assert(home.includes(frag), "C: home-stack element ships — " + frag);
assert((home.match(/class="[^"]*view-home/g) || []).length === 9, "C: exactly nine elements carry .view-home — the enumerated hide set is complete — →230: the B2 homepage's three sections (Today's Battle / Featured / More Highlights) join the home stack as .view-home elements, so the hide set grows from six to nine");
assert(home.includes('<section class="panel" id="hypeframe" data-panel="hypeframe">'), "C: the studio section is a plain panel — it does NOT carry view-home, so the hide can never take it");
assert(home.includes('id="merchTeaser125"'), "C: #merchTeaser125 (the homepage Hype Frame card Emil named) is in the hide set via its view-home class");
assert(home.includes("<footer>") && !/<footer[^>]*view-home/.test(home), "C: the footer carries no view-home — it stays while the studio is open");
{
  const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));
  assert(studio.includes('data-panel-btn="plays"') && studio.includes("Back to the board"), "C: the studio keeps its own Back to the board exit (a panel button — the restore path)");
}

// ---- D. VM drive of showPanel: class + hero pause/resume ----
{
  const classes = new Set();
  const body = { classList: {
    toggle: (c, force) => { if (force) classes.add(c); else classes.delete(c); },
    contains: (c) => classes.has(c),
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
  } };
  const mkVideo = () => ({
    dataset: { src: "/hero-film.mp4" }, _src: "", muted: false, playCount: 0, pauseCount: 0,
    getAttribute(a) { return a === "src" ? (this._src || null) : null; },
    set src(v) { this._src = v; }, get src() { return this._src; },
    play() { this.playCount++; return Promise.resolve(); },
    pause() { this.pauseCount++; },
  });
  const hero = mkVideo(), extra = mkVideo();
  const panels = ["plays", "hypeframe", "athlete"].map((p) => ({ dataset: { panel: p }, classList: { toggle: () => {} } }));
  let musicPref = null;
  const sb = {
    console,
    document: { body },
    $: (sel) => (sel === "#heroVideo" ? hero : null),
    $$: (sel) => (sel === ".panel[data-panel]" ? panels : sel === ".view-home video" ? [hero, extra] : []),
    hidePlayDetail: () => {},
    hhStorageGet: () => musicPref,
  };
  sb.window = sb;
  const spStart = appJs.indexOf("function showPanel(name)");
  const showPanelSrc = appJs.slice(spStart, appJs.indexOf('$$("[data-panel-btn]").forEach((b) => b.addEventListener', spStart));
  vm.runInContext(showPanelSrc, vm.createContext(sb));

  sb.showPanel("hypeframe");
  assert(classes.has("hf-studio-open205"), "D: opening the studio sets body.hf-studio-open205 (the hide + pill stand-down engage)");
  assert(hero.pauseCount === 1 && extra.pauseCount === 1, "D: studio entry pauses EVERY .view-home video — the hero cannot play, audibly or at all, behind the hidden stack");
  assert(hero.playCount === 0, "D: studio entry never starts the hero");

  sb.showPanel("plays");
  assert(!classes.has("hf-studio-open205"), "D: leaving to the board clears the class — the whole stack is restored");
  assert(hero.playCount === 1 && hero.muted === false && hero._src === "/hero-film.mp4", "D: studio exit restarts the hero under the Round 125 preference (music ON when hh_music is unset) and honors the data-src lazy load");

  sb.showPanel("plays");
  assert(hero.playCount === 1, "D: a panel switch with no studio visit before it never force-plays the hero — other panels' behavior is unchanged");

  musicPref = "off";
  sb.showPanel("hypeframe");
  assert(hero.pauseCount === 2, "D: re-entering the studio pauses the home films again");
  sb.showPanel("athlete");
  assert(!classes.has("hf-studio-open205") && hero.playCount === 2 && hero.muted === true, "D: leaving the studio to ANY panel restores the stack and restarts the hero — muted when the visitor muted it (hh_music off)");

  sb.showPanel("hypeframe");
  classes.add("store-open");
  sb.showPanel("plays");
  assert(hero.playCount === 2, "D: the store-open gate keeps the resume out of the Store's path — showStore/showHome keep their own hero handling");
}

// ---- E. entry funnel statics ----
assert((appJs.match(/showPanel\("hypeframe"\)/g) || []).length === 2, "E: exactly two showPanel(\"hypeframe\") call sites — openHypeFrame and the Round 200 return landing; every studio entry funnels through showPanel");
assert((appJs.match(/classList\.toggle\("hf-studio-open205"/g) || []).length === 1, "E: the studio body class is toggled in exactly one place (showPanel) — no entry path can bypass the hide");
{
  const ohf = appJs.slice(appJs.indexOf("window.openHypeFrame"), appJs.indexOf("function initHfStudio"));
  assert(ohf.includes('showPanel("hypeframe")'), "E: openHypeFrame (play cards, play detail, the posted-play picker) activates the studio through showPanel — →231: sample plays funnel here too but are refused BEFORE showPanel (they land on the choice card instead)");
  assert(ohf.includes('getElementById("hypeframe").scrollIntoView'), "E: studio entry scrolls the studio PANEL into view — never a hidden home-stack element");
  const landing = appJs.slice(appJs.indexOf("async function hfReturnLanding200"), appJs.indexOf("async function hfReturnLanding200") + 700);
  assert(landing.includes('showPanel("hypeframe")'), "E: the Shopify return landing (/?hf_order=) opens the studio through showPanel");
  assert(appJs.includes("window.hfPickerPick202 = (id) => { closeHfChoice(); openHypeFrame(id); }"), "E: the Round 202 picker pick reaches the studio through openHypeFrame");
  assert((appJs.match(/openHypeFrame\(Number\(hm\[1\]\)\)/g) || []).length === 2, "E: the #hype-frame-<id> deep link reaches the studio through openHypeFrame on BOTH routes (boot + hashchange)");
  const apply = appJs.slice(appJs.indexOf("function hhApply139"), appJs.indexOf("function hhSettle139"));
  assert(apply.includes("openHypeFrame(place.hf)"), "E: the Round 139 history restore re-enters the studio through openHypeFrame (browser Back/Forward included)");
  assert(appJs.includes("window.hfChoiceOwn = () => { closeHfChoice(); goSubmit(); }"), "E: the choice modal's own-video path goes to the upload flow (goSubmit) — it never opens the studio panel, so the hide never engages there");
}

// ---- F. exit / restore statics ----
{
  const handler = appJs.slice(appJs.indexOf('$$("[data-panel-btn]").forEach((b) => b.addEventListener'), appJs.indexOf("/* Round 51"));
  assert(handler.includes("showPanel(b.dataset.panelBtn)") && handler.includes('document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" })'), "F: the panel-button handler is unchanged — panel switch + the #deck scroll (the deck is the panel host and is never hidden, so board entry lands exactly as before)");
  const goHomeSrc = appJs.slice(appJs.indexOf("function goHome()"), appJs.indexOf('window.addEventListener("hashchange"'));
  assert(goHomeSrc.includes('showPanel("plays")'), "F: the logo / home navigation restores through showPanel(\"plays\") — class cleared, stack back, hero resumed");
  const showHomeSrc = appJs.slice(appJs.indexOf("function showHome()"), appJs.indexOf("\nfunction ", appJs.indexOf("function showHome()") + 10));
  assert(showHomeSrc.includes('!document.body.classList.contains("hf-studio-open205")'), "F: showHome carries the Round 214 guard — no hero restart while the studio class is set; showPanel owns the resume on studio exit");
  assert(showPanelSrcIncludes214(), "F: showPanel carries the Round 214 media wiring (wasStudio214 + the .view-home video sweep)");
  function showPanelSrcIncludes214() {
    const s = appJs.indexOf("function showPanel(name)");
    const src = appJs.slice(s, appJs.indexOf('$$("[data-panel-btn]").forEach((b) => b.addEventListener', s));
    return src.includes("wasStudio214") && src.includes('$$(".view-home video")');
  }
}

// ---- G. served ----
{
  const s = await boot(41214);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=231"') && served.includes('href="styles.css?v=222"'), "G: the served homepage carries the Round 214 pins — →221: now app.js v219 / styles v213 (Round 221) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235)");
    assert(served.includes('id="merchTeaser125"') && served.includes('class="merch-teaser125 view-home"'), "G: the served homepage still ships the teaser on the home page — it is hidden only while the studio is open");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes("body.hf-studio-open205 .view-home{display:none}") && servedCss.includes("body.hf-studio-open205 #deck.view-home{display:block}"), "G: the served styles carry the hide rule + the deck carve-out");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("wasStudio214") && servedApp.includes('$$(".view-home video")'), "G: the served app.js carries the round's media wiring");
  } finally { s.stop(); }
}

console.log("\nALL R214 CHECKS PASSED");
