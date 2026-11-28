// Round 202 test: the Hype Frame choice card gains a third
// start — "Use a play already on HighlightHype" (Emil's catch,
// 2026-11-26: a parent whose play is already posted had no path
// from the card; re-uploading the same clip hits the same-clip
// duplicate rule). Run: node test-r202.js
// →205 (2026-11-26, Emil): the Sample start LEAVES the card —
// hfChoiceSample is removed and the card offers TWO starts
// (Posted, Own) under "Two ways to start:". Sample plays stay
// on the boards and in the picker (tagged SAMPLE). Sections B,
// D and F below carry the superseded assertions with →205
// notes; C (eligibility parity) and E are untouched.
// What this suite pins down:
//   A. Pins: app.js v203 / styles v201 — →206: app.js now v206
//      (Round 205); styles now v203 (Round 205) — →207: app.js
//      now v207 / styles now v204 (Round 206).
//   B. The dialog: two options in order (Posted, Own) — →205:
//      the Sample option and "Three ways to start:" are gone,
//      "Two ways to start:" rides instead; the picker panel
//      (search, list, empty state, Back / Not now) and its
//      app.js handlers unchanged.
//   C. ELIGIBILITY PARITY (the correctness core): the per-play
//      Frame buttons (cardHtml, tileHtml, watch view) are
//      unconditional and openHypeFrame resolves ALL_PLAYS +
//      CONTEST.entries — so hfPickerEligible202 must exclude
//      NOTHING: samples, photo plays and link plays are all in,
//      contest-only entries are in, duplicates are deduped,
//      order is newest first.
//      →231 (2026-11-27, Emil): samples can't be used in the
//      studio at all — parity now runs the other way: the picker
//      excludes samples, the per-play Frame buttons are hidden
//      on samples, and openHypeFrame refuses a sample seed.
//      Photo and link plays are still in; dedupe and newest-
//      first order are unchanged. Sections C and D below carry
//      the updated assertions with →231 notes.
//   D. VM drive of the real block: open -> posted -> render,
//      search by athlete / sport / team / no-match, Back, pick
//      (opens the studio with the id, closes both layers and
//      resets the panels), the Own path unchanged, →205: the
//      Sample handler no longer exists, and the honest empty
//      state when nothing is eligible.
//   E. No duplicate element ids across index.html + the strip.
//   F. The served homepage carries the two-way card + picker.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r202-"));
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
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=239"'), "A: asset pins — app.js v203 / styles v201 (Round 202; both files changed) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");

// ---- B. the dialog ----
const mStart = home.indexOf('id="hfChoiceModal"');
const modal = home.slice(mStart, home.indexOf('id="uploadForm"', mStart));
assert(modal.includes("Two ways to start:") && !modal.includes("Three ways to start:"), "B: the sub-copy offers two ways to start — →205: Round 202's 'Three ways to start:' is superseded (the Sample start left the card)");
assert(!home.includes("Three ways") && !appJs.includes("Three ways") && !appJs.includes("three-choice"), "B: no 'three ways' copy survives in the page or the script — →205: the Round 202 no-'two ways' rule is inverted");
const iSample = modal.indexOf('onclick="hfChoiceSample()"'), iPosted = modal.indexOf('onclick="hfChoicePosted()"'), iOwn = modal.indexOf('onclick="hfChoiceOwn()"');
assert(iSample === -1 && !modal.includes("Try it with a sample clip") && !appJs.includes("window.hfChoiceSample"), "B: →205: the Sample option is GONE from the card — no button, no handler (the name survives only in the Round 205 comment noting its removal)");
assert(iPosted > -1 && iOwn > iPosted, "B: the two options render in order — Posted, Own — →205: Round 202's Sample, Posted, Own order is superseded");
assert(modal.includes("Use a play already on HighlightHype") && modal.includes("Pick a posted play — yours or any play on the boards."), "B: the new button's label and sub-line ride");
assert(modal.includes('id="hfChoicePanel"'), "B: the choice panel carries its own id for the swap");
assert(modal.includes('id="hfPickerPanel"') && modal.includes('id="hfPickerSearch202"') && modal.includes('id="hfPickerList202"') && modal.includes('id="hfPickerEmpty202"'), "B: the picker panel and its search / list / empty elements ride");
assert(modal.includes('oninput="hfPickerFilter202(this.value)"'), "B: the search input is wired to the filter handler");
assert(modal.includes('onclick="hfPickerBack202()"') && modal.includes('onclick="closeHfChoice()"'), "B: the picker has a Back path and the shared Not now close");
for (const fn of ["window.hfChoicePosted", "window.hfPickerFilter202", "window.hfPickerBack202", "window.hfPickerPick202", "function hfPickerEligible202(", "function hfPickerRender202(", "function hfPickerReset202("])
  assert(appJs.includes(fn), "B: app.js carries " + fn);
assert(css.includes(".hf-picker-row{") && css.includes(".hf-picker-list{") && css.includes(".hf-picker-search{") && css.includes(".hf-picker-thumb{"), "B: the picker styles ride in styles.css");

// ---- C. eligibility parity (statics) ----
const opener = appJs.slice(appJs.indexOf("window.openHypeFrame = (id)"), appJs.indexOf("initHfStudio(play);", appJs.indexOf("window.openHypeFrame = (id)")));
assert(opener.includes("ALL_PLAYS.find") && opener.includes("CONTEST.entries"), "C: openHypeFrame resolves a play from ALL_PLAYS, then CONTEST.entries — the set the picker must mirror");
const card = appJs.slice(appJs.indexOf("function cardHtml("), appJs.indexOf("function tileHtml("));
const tile = appJs.slice(appJs.indexOf("function tileHtml("), appJs.indexOf("/* Vote hardening"));
assert(card.includes('onclick="openHypeFrame(${h.id})"') && card.includes("Create a Hype Frame"), "C: cardHtml renders its Hype Frame button for every NON-sample play — →231: the button is wrapped in the isSample ternary (hidden on samples); the markup itself rides unchanged");
assert(tile.includes('onclick="event.stopPropagation();openHypeFrame(${h.id})"'), "C: tileHtml renders its Frame button for every NON-sample play — →231: wrapped in the isSample ternary like cardHtml (it sat outside the isSample vote ternary before)");
const elig = appJs.slice(appJs.indexOf("function hfPickerEligible202()"), appJs.indexOf("function hfPickerPoster202("));
assert(elig.includes("ALL_PLAYS") && elig.includes("CONTEST"), "C: the picker's eligible set is built from ALL_PLAYS + CONTEST.entries");
assert(elig.includes("p.isSample") && !elig.includes("media_kind") && !elig.includes("mime"), "C: →231: the eligible set now applies exactly ONE exclusion — samples (parity with the hidden per-play buttons and openHypeFrame's refusal); still NO media-kind exclusion, so photo and link plays stay in");

// ---- D. VM drive ----
function lineSrc(startNeedle) { const i = appJs.indexOf(startNeedle); return appJs.slice(i, appJs.indexOf("\n", i)); }
const escCapSrc = appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("\n", appJs.indexOf("const cap =")));
const blockSrc = appJs.slice(appJs.indexOf("window.openHfChoice"), appJs.indexOf('$$("[data-hf-start]")'));
const mkEl = () => ({ hidden: false, innerHTML: "", textContent: "", value: "", parentElement: null });
const modalEl = mkEl(); modalEl.hidden = true;
const choiceEl = mkEl(), pickerEl = mkEl(); pickerEl.hidden = true;
const searchEl = mkEl(), listEl = mkEl(), emptyEl = mkEl(); emptyEl.hidden = true;
const elMap = { "#hfChoiceModal": modalEl, "#hfChoicePanel": choiceEl, "#hfPickerPanel": pickerEl, "#hfPickerSearch202": searchEl, "#hfPickerList202": listEl, "#hfPickerEmpty202": emptyEl };
const calls = { open: [], submit: 0 };
const P = (o) => ({ media_kind: "file", mime: "video/mp4", media_url: "", poster_url: "", isSample: false, team: "", player_name: "", athlete_label: "", ...o });
const sb = {
  console,
  document: { body: { appendChild() {} } },
  $: (s) => elMap[s] || null,
  ALL_PLAYS: [
    P({ id: 11, title: "Walk-off winner", player_name: "Mia Torres", athlete_label: "Mia T.", team: "Hawks", sport: "baseball", media_url: "/uploads/a.mp4", poster_url: "/posters/a.jpg", created_at: "2026-11-20 10:00:00" }),
    P({ id: 12, title: "Perfect catch photo", athlete_label: "Sam R.", sport: "softball", mime: "image/jpeg", media_url: "/uploads/b.jpg", created_at: "2026-11-22 09:00:00" }),
    P({ id: 13, title: "Coach's film link", athlete_label: "Jo K.", sport: "soccer", media_kind: "embed", media_url: "https://example.com/v", created_at: "2026-11-18 09:00:00" }),
    P({ id: 14, title: "Sample: first hit", athlete_label: "Demo D.", sport: "baseball", isSample: true, poster_url: "/posters/s.jpg", created_at: "2026-11-01 09:00:00" }),
  ],
  CONTEST: { entries: [P({ id: 15, title: "Contest only gem", athlete_label: "Ana P.", sport: "baseball", created_at: "2026-11-25 09:00:00" }), { id: 11, title: "Walk-off winner (contest dupe)" }] },
  openHypeFrame: (id) => calls.open.push(id),
  goSubmit: () => { calls.submit++; },
};
sb.window = sb;
vm.runInContext(escCapSrc + "\n" + lineSrc("function parsePlayDate(") + "\n" + blockSrc, vm.createContext(sb));

const eligibleIds = sb.hfPickerEligible202().map((p) => p.id);
assert(JSON.stringify(eligibleIds) === JSON.stringify([15, 12, 11, 13]), "D: the eligible set — contest-only (15), photo (12), regular (11), link (13) — deduped and newest first — →231: the sample (14) is EXCLUDED now (Round 202's all-in set superseded for samples only)");
sb.openHfChoice();
assert(modalEl.hidden === false && choiceEl.hidden === false && pickerEl.hidden === true, "D: opening the card lands on the choices — →205: two choices now (Posted, Own)");
sb.hfChoicePosted();
assert(choiceEl.hidden === true && pickerEl.hidden === false, "D: the Posted choice swaps the picker panel in");
const rows = (listEl.innerHTML.match(/hf-picker-row/g) || []).length;
assert(rows === 4, "D: the picker lists every eligible play (4 rows — →231: was 5 with the sample)");
for (const t of ["Contest only gem", "Perfect catch photo", "Walk-off winner", "Coach&#39;s film link"])
  assert(listEl.innerHTML.includes(t), "D: the list shows: " + t);
assert(!listEl.innerHTML.includes("Sample: first hit"), "D: →231: the sample play is NOT listed — samples can't be used in the studio at all");
assert(!listEl.innerHTML.includes("contest dupe"), "D: the ALL_PLAYS copy of a duplicated play wins (no dupe row)");
assert(!listEl.innerHTML.includes("⭐ SAMPLE PLAY"), "D: →231: no SAMPLE PLAY tag rides the picker anymore (the sample row itself is gone; the tag survives on the board tiles/cards)");
assert(listEl.innerHTML.includes('src="/posters/a.jpg"') && listEl.innerHTML.includes('src="/uploads/b.jpg"'), "D: rows carry posters — the play's poster, and the photo play's own image as its thumb");
assert(listEl.innerHTML.includes("hf-picker-thumb-none"), "D: the link play (no poster anywhere) falls back to the sport-name thumb");
assert(listEl.innerHTML.includes('onclick="hfPickerPick202(15)"'), "D: rows are wired to the pick handler with the play id");
assert(emptyEl.hidden === true, "D: no empty state while plays are listed");
sb.hfPickerFilter202("Mia");
assert(listEl.innerHTML.includes("Walk-off winner") && !listEl.innerHTML.includes("Perfect catch photo"), "D: search filters by athlete (player_name / label)");
sb.hfPickerFilter202("softball");
assert(listEl.innerHTML.includes("Perfect catch photo") && !listEl.innerHTML.includes("Walk-off winner"), "D: search filters by sport");
sb.hfPickerFilter202("Hawks");
assert(listEl.innerHTML.includes("Walk-off winner") && !listEl.innerHTML.includes("Contest only gem"), "D: search filters by team");
sb.hfPickerFilter202("zzz-no-match");
assert(!listEl.innerHTML.includes("hf-picker-row") && emptyEl.hidden === false && emptyEl.textContent.includes("No plays match"), "D: a fruitless search shows the no-match empty state");
sb.hfPickerFilter202("");
assert((listEl.innerHTML.match(/hf-picker-row/g) || []).length === 4 && emptyEl.hidden === true, "D: clearing the search restores the full list (4 rows — →231: the sample stays out)");
sb.hfPickerBack202();
assert(choiceEl.hidden === false && pickerEl.hidden === true && modalEl.hidden === false, "D: Back returns to the choices without closing the card — →205: two choices now");
sb.hfChoicePosted();
sb.hfPickerPick202(12);
assert(JSON.stringify(calls.open) === JSON.stringify([12]), "D: tapping a row opens the studio with that play's id");
assert(modalEl.hidden === true && choiceEl.hidden === false && pickerEl.hidden === true, "D: the pick closes both layers and resets the panels for the next open");
assert(typeof sb.hfChoiceSample === "undefined", "D: →205: the Sample handler no longer exists — Round 202's Sample-path drive is superseded — →231: sample plays no longer open the studio from anywhere (own cards, picker, deep links — openHypeFrame refuses the seed)");
sb.hfChoiceOwn();
assert(calls.submit === 1 && modalEl.hidden === true, "D: the Own path is unchanged — the upload form opens, the card closes");
sb.ALL_PLAYS = []; sb.CONTEST = { entries: [] };
sb.openHfChoice(); sb.hfChoicePosted();
assert(!listEl.innerHTML.includes("hf-picker-row") && emptyEl.hidden === false && emptyEl.textContent.includes("No plays are up yet"), "D: with nothing eligible, the picker says so honestly (post yours) instead of showing a blank list — →205: the empty text no longer points at the removed sample start");

// ---- E. id uniqueness ----
const stripStart = appJs.indexOf("function hypeFrameStrip126()");
const strip = appJs.slice(stripStart, appJs.indexOf("`;", stripStart)).replace(/\\"/g, '"');
const homeIds = [...home.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const stripIds = [...strip.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
const allIds = [...homeIds, ...stripIds];
assert(new Set(allIds).size === allIds.length, "E: no duplicate element ids across index.html + the strip markup (" + allIds.length + " ids)");
for (const id of ["hfChoicePanel", "hfPickerPanel", "hfPickerSearch202", "hfPickerList202", "hfPickerEmpty202"])
  assert(homeIds.filter((i) => i === id).length === 1, "E: id occurs exactly once: " + id);

// ---- F. served page ----
const s = await boot(8942);
try {
  const served = await (await fetch(s.base + "/")).text();
  assert(served.includes("Two ways to start:") && served.includes('id="hfPickerPanel"') && served.includes('id="hfPickerList202"'), "F: the served homepage carries the card and the picker panel — →205: the two-way card (Round 202's three-way card superseded)");
  assert(served.includes('src="app.js?v=239"') && served.includes('href="styles.css?v=228"'), "F: the served homepage carries the current asset pins — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");
} finally { s.child.kill(); }

console.log("\nALL R202 CHECKS PASSED");
