// Round 201 test: the homepage merch section becomes the
// Hype Frame feature (Emil, 2026-11-26 — Variant B of the
// Nov 26 mock, plus the "See how it works" film he asked to
// add). Run: node test-r201.js
// What this suite pins down:
//   A. Pins: app.js v202 / styles v200.
//   B. The section (#merchTeaser125, element + id + view-home
//      class unchanged): the feature headline, the pitch, the
//      facts ($110, Black or Heather Gray, Youth YXXS–YXL,
//      Adult S–XL, made-to-order 5–7 business days), the
//      finished-example thumbnails, and the CTA wired to
//      openHfChoice(). The film rides with its OWN ids
//      (hfFilmCoverHome201 / hfHomeFilm201 / playHfHomeFilm201).
//      Absent from the section: Drop 001, notify, Coming soon,
//      the .mt125-prod cards, the bottle, the full-store line.
//      → Round 204 (Emil, same day) SLIMMED the section: the
//      eyebrow moved onto the film as a second pill beside
//      The Swag Shop, and the pitch, the facts, the example
//      thumbnails and the sub-line were REMOVED (the price
//      left the homepage with them). The B assertions below
//      were updated to the slimmed shape; test-r204.js pins
//      the new shape in full (DOM order, film-button events).
//      → Round 207 (Emil, same day) REDESIGNED it again from
//      his product-hero reference: the real softball hoodie
//      photo is the hero (the pills ride on IT, raised), the
//      headline gains the "Pick a play. Make it yours."
//      sub-line, the CTA is renamed "Build your hoodie →",
//      and the film is demoted below the CTA (a link reveals
//      its box in place; the button hides instantly on tap).
//      The B assertions below were updated again where the
//      redesign supersedes them; test-r207.js pins the new
//      shape in full.
//      → Round 210 (Emil, same day): the link now opens the
//      film in a centered OVERLAY (hfHomeFilmOverlay210)
//      instead of revealing its box in place — same cover /
//      video / handler ids, so the B/C/E assertions below
//      stand as written (the handler's overlay lookup
//      null-guards in the §E drive); test-r210.js pins the
//      overlay and the centered hero in full.
//   C. The board strip is untouched (its own film ids and
//      handler, still spliced into renderAll's deck) and the
//      two film instances share no ids; no duplicate element
//      ids across index.html + the strip markup.
//   D. The /store section is unchanged (crumb, hero, its own
//      film pair — Drop 001 lives on there).
//   E. VM drive: the section handler and the strip handler
//      each swap ONLY their own cover/film pair — the two
//      films play independently.
//   F. The served homepage (booted server) carries the new
//      section and none of the teaser.
// The Round 126 teaser wiring in app.js is RETAINED on
// purpose (it no-ops without its elements; test-review-fixes
// §41 keeps driving it) — pinned in C.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r201-"));
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
  return { tmp, child, base, getLog: () => log };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=230"') && home.includes('src="app.js?v=241"'), "A: asset pins — app.js v202 / styles v200 (Round 201; both files changed) — →203: app.js now v203 / styles now v201 (Round 202; both files changed again) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v230 (Round 246) — →247: styles now v230 (Round 247)");

// ---- B. the section ----
const secStart = home.indexOf('id="merchTeaser125"');
const secEnd = home.indexOf("<!-- ============ THE STORE", secStart);
assert(secStart > -1 && secEnd > secStart, "B: the merch section is located ahead of the Store section");
const sec = home.slice(secStart, secEnd);
assert(home.includes('<div class="merch-teaser125 view-home" id="merchTeaser125">'), "B: the section element, its id and the view-home class are unchanged (view routing untouched)");
assert(!sec.includes("hft201-eyebrow") && !sec.includes("hft201-badges") && sec.includes("hft212-head") && sec.includes("HYPE FRAME™"), "B: the eyebrow is GONE from below the film (Round 204) — →207: the pills rode the product hero — →212: the pills are REMOVED entirely; the crown + HYPE FRAME™ card header carries the branding");
assert(sec.includes("Your moment on a hoodie"), "B: the feature headline rides");
assert(!sec.includes("Pick a frame from your play") && !sec.includes("hft201-pitch"), "B: the pitch is REMOVED (Round 204 slimming)");
for (const f of ["$110", "Black or Heather Gray", "Youth YXXS–YXL", "Adult S–XL", "Made to order — ships in 5–7 business days"])
  assert(!sec.includes(f), "B: fact REMOVED with the facts row (Round 204): " + f);
assert(!sec.includes('src="/swag/hf-example-hoodie-back.jpg"') && !sec.includes('src="/swag/hf-example-lineup.jpg"') && !sec.includes("hft201-thumbs"), "B: both finished-example thumbnails are REMOVED from the section (Round 204 — the files stay in /swag)");
assert(fs.existsSync(path.join(ROOT, "public/swag/hf-example-hoodie-back.jpg")) && fs.existsSync(path.join(ROOT, "public/swag/hf-example-lineup.jpg")), "B: the example image files themselves were NOT deleted (Round 204 removed their use, not the files)");
assert(sec.includes('onclick="openHfChoice()"') && sec.includes("Build your hoodie"), "B: the CTA opens the studio via openHfChoice() (the board strip's entry) — →207: the CTA is renamed 'Build your hoodie →' (was 'Create yours →')");
assert(sec.includes('id="hfFilmCoverHome201"') && sec.includes('id="hfHomeFilm201"') && sec.includes('onclick="playHfHomeFilm201()"'), "B: the section film carries its OWN cover / video / handler ids");
assert(sec.includes('src="/hype-frame-film.mp4?v=7"') && sec.includes("data-click-play") && sec.includes("playsinline") && sec.includes('preload="none"'), "B: the section film is the shared cut with the house film attributes");
assert(sec.includes('src="/swag/hf-hoodie-softball.jpg"'), "B: the film cover is the softball hoodie finish (the strip/store cover)");
for (const bad of ["Drop 001", "Coming soon", "mt125-prod", "mt126-bottle", "mtProducts126", "Open the full store", "data-store-link"])
  assert(!sec.includes(bad), "B: absent from the section: " + bad);
assert(!/notify/i.test(sec), "B: absent from the section: notify (any case)");
assert(css.includes(".hft201-card{") && css.includes(".hft201-cta{") && css.includes(".hft212-head{") && !css.includes(".hft201-badges{") && !css.includes(".hft201-facts") && !css.includes(".hft201-thumbs") && !css.includes(".hft201-pitch") && !css.includes(".hft201-eyebrow") && !css.includes(".hft201-sub"), "B: the section's styles ride in styles.css — and the removed blocks' rules are gone with them (Round 204) — →212: the pill rules joined the removed set; the card-header rules ride");

// ---- C. the board strip + id uniqueness ----
const stripStart = appJs.indexOf("function hypeFrameStrip126()");
const strip = appJs.slice(stripStart, appJs.indexOf("`;", stripStart)).replace(/\\"/g, '"');
assert(strip.includes('id="hfFilmCoverFeed126"') && strip.includes('id="hfFeedFilm126"') && strip.includes('onclick="playHfFeedFilm126()"'), "C: the board strip's film ids + handler are untouched");
assert(appJs.includes("deckTiles125.splice(2, 0, hypeFrameStrip126())"), "C: renderAll still splices the strip into the deck");
assert(appJs.includes("function playHfHomeFilm201()") && appJs.includes("function playHfFeedFilm126()") && appJs.includes("function playHfStoreFilm()"), "C: three film handlers coexist (section / strip / store)");
assert(!sec.includes("hfFeedFilm126") && !sec.includes("hfFilmCoverFeed126") && !strip.includes("hfHomeFilm201"), "C: the section film and the strip film share no ids");
assert(appJs.includes('el.id === "hfHomeFilm201"'), "C: the section film is registered in the media-hygiene exemption (hhSilence158) like the other films");
assert(appJs.includes('$$(".mt125-prod[data-front][data-back]")') && appJs.includes("teaserVariant126"), "C: the Round 126 teaser wiring is retained in app.js (it no-ops without its elements — the documented Round 201 choice)");
const homeIds = [...home.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const stripIds = [...strip.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const allIds = [...homeIds, ...stripIds];
assert(new Set(allIds).size === allIds.length, "C: no duplicate element ids across index.html + the strip markup (" + allIds.length + " ids)");
assert(homeIds.filter((i) => i === "hfHomeFilm201").length === 1 && homeIds.filter((i) => i === "hfFilmCoverHome201").length === 1, "C: the section film ids occur exactly once in the served page");

// ---- D. the store is unchanged ----
const store = home.slice(secEnd);
assert(store.includes('<span class="crumb">HighlightHype<span class="sep">/</span><b>Store</b><span class="sep">·</span>Drop 001</span>'), "D: the Store crumb still names Drop 001");
assert(store.includes('id="hsHero"') && store.includes("DROP 001 / HYPE SPORTS"), "D: the Store hero still leads Drop 001");
assert(store.includes('id="hfFilmCoverStore"') && store.includes('id="hfStoreFilm"') && store.includes('onclick="playHfStoreFilm()"'), "D: the Store feature's own film pair is untouched");

// ---- E. VM drive: the two handlers are independent ----
function fnSrc(name) {
  const i = appJs.indexOf("function " + name + "(");
  return appJs.slice(i, appJs.indexOf("\n}", i) + 2);
}
const mkVid = () => ({ hidden: true, plays: 0, paused: true, ended: false, listeners: {}, addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }, play() { this.plays++; return { catch() {} }; } });
const coverHome = { hidden: false }, vidHome = mkVid();
const coverFeed = { hidden: false }, vidFeed = mkVid();
const btnHome = { hidden: false };
const elMap = { "#hfFilmCoverHome201": coverHome, "#hfHomeFilm201": vidHome, "#hfHomeFilmBtn201": btnHome, "#hfFilmCoverFeed126": coverFeed, "#hfFeedFilm126": vidFeed };
const sb = { console, $: (s) => elMap[s] || null };
// Round 204: the home handler grew a wiring flag + a button-sync
// helper ahead of it — drive the whole block, not just the handler.
const homeFilmBlock204 = appJs.slice(appJs.indexOf("let hfHomeFilmWired204"), appJs.indexOf("\n}", appJs.indexOf("function playHfHomeFilm201")) + 2);
vm.runInContext(homeFilmBlock204 + "\n" + fnSrc("playHfFeedFilm126"), vm.createContext(sb));
sb.playHfHomeFilm201();
assert(coverHome.hidden === true && vidHome.hidden === false && vidHome.plays === 1, "E: the section handler hides its own cover, reveals and plays its own film");
assert(coverFeed.hidden === false && vidFeed.hidden === true && vidFeed.plays === 0, "E: the strip's film is untouched by the section handler");
sb.playHfFeedFilm126();
assert(coverFeed.hidden === true && vidFeed.hidden === false && vidFeed.plays === 1 && vidHome.plays === 1, "E: the strip handler still works — and only on its own pair");

// ---- F. served page ----
const s = await boot(8941);
try {
  const served = await (await fetch(s.base + "/")).text();
  const sStart = served.indexOf('id="merchTeaser125"');
  const sSec = served.slice(sStart, served.indexOf("<!-- ============ THE STORE", sStart));
  assert(sSec.includes("Your moment on a hoodie") && sSec.includes('id="hfHomeFilm201"') && sSec.includes('onclick="openHfChoice()"'), "F: the served homepage carries the Hype Frame feature section");
  assert(!sSec.includes("mt125-prod") && !/notify/i.test(sSec) && !sSec.includes("Drop 001"), "F: the served section is teaser-free");
} finally { s.child.kill(); }

console.log("\nALL R201 CHECKS PASSED");
