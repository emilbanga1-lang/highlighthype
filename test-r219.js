// Round 219 test: two small Emil fixes on the contest surfaces.
// Run: node test-r219.js
// What this suite pins down:
//   A. Pins: app.js v217 / styles v211 (both files changed —
//      app.js for the markup, styles.css for the meta-row rule).
//      →220: app.js now v218, styles now v212 (Round 220).
//   B. The featured #1 card (featCardHtml134): the moment chip
//      (the "🔥 Big Play" badge) and the watches count share ONE
//      meta line (.feat-meta-row219) under the title — Emil:
//      "To gain space where it says big play — same line can
//      have 53 watches." Either half renders alone when the
//      other is absent; neither → no row. The old stacked rows
//      (the chip's moment-row162 paragraph, the feat-views151
//      paragraph) are gone from the featured card; the big gold
//      "Vote for this play" button is untouched.
//   C. The leaderboard rows (fameRowHtml134, shared by This
//      Month + Hall of Fame): the votes pill reads
//      "Vote · N votes" — a bare "N votes" read as a stat, not
//      as the way to vote (Emil). Text only: the pill's class,
//      its place in .fame-info, and the row's tap wiring
//      (openPlay189 for Month, goToPlayCard for Fame, no
//      toggleVote on the row) are exactly as built.
//      →220: the pill is now a real toggleVote BUTTON (Emil:
//      "I want people to be able to vote") — the R219 label
//      format is kept for the un-voted state, the click is
//      stopped so the row tap still only opens the play, and
//      the voted state mirrors the tile chip. §C below asserts
//      the new wiring; test-r220.js owns the round's suite.
//   D. Untouched surfaces stay untouched: the board tile's
//      vote chip already reads "Vote · N" (asserted so the
//      sweep that changed the pill can never "fix" it into a
//      duplicate), the full card's button reads "Vote", and
//      the featured card's sample state stays a static chip.
// Exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins ----
assert(home.includes('src="app.js?v=241"') && home.includes('href="styles.css?v=229"'), "A: asset pins — app.js v217 / styles v211 (Round 219; both files changed) — →220: app.js now v218, styles now v212 (Round 220; both files changed) — →221: app.js now v219, styles now v213 (Round 221; both files changed) — →222: app.js now v220, styles now v214 (Round 222; both files changed) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");

// ---- B/C statics ----
assert(css.includes(".feat-meta-row219{display:flex") && css.includes(".feat-meta-row219 .feat-views151{margin:0}"), "B: the meta row ships as a flex row and the watches span loses its block margin inside it");
const featSlice = appJs.slice(appJs.indexOf("function featCardHtml134"), appJs.indexOf("function renderMonth"));
assert(featSlice.includes("feat-meta-row219") && featSlice.includes("momentChipInline162(h)"), "B: the featured card builds the one-line meta row from the chip's inline form");
assert(!appJs.includes('<p class="feat-views151">'), "B: the stacked watches paragraph is gone from app.js (the watches count is a span in the meta row now)");
assert(appJs.includes('fame-votes-pill134">Vote · ${h.voteCount} vote'), "C: the fame pill's source label reads \"Vote · N votes\" — →220: this exact source line is now the SAMPLE branch; real plays render the button form asserted next");
assert(appJs.includes('class="fame-votes-pill134 fame-vote-btn220') && appJs.includes('onclick="event.stopPropagation();toggleVote(${h.id}, this)"'), "C: →220: the fame pill's real-play form is a toggleVote button with its click stopped (Round 220)");

// ---- VM drives of the real renderers (the house pattern) ----
const plays = [
  { id: 201, title: "Walk-off game winner", sport: "baseball", division: "boys", athlete_label: "Kameron A.", player_name: "Kameron A.", media_kind: "file", media_url: "/uploads/k.mp4", mime: "video/mp4", poster_url: "/uploads/poster-201.jpg", voteCount: 13, viewCount: 53, moment_kind: "big_play", hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 202, title: "Quiet Clip", sport: "baseball", division: "boys", athlete_label: "Sam R.", player_name: "Sam R.", media_kind: "file", media_url: "/uploads/s.mp4", mime: "video/mp4", poster_url: "/uploads/poster-202.jpg", voteCount: 2, viewCount: 7, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 203, title: "Comeback Kid", sport: "softball", division: "girls", athlete_label: "Maya L.", player_name: "Maya L.", media_kind: "file", media_url: "/uploads/m.mp4", mime: "video/mp4", poster_url: "/uploads/poster-203.jpg", voteCount: 4, viewCount: 0, moment_kind: "comeback", hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 204, title: "Plain Play", sport: "hockey", division: "boys", athlete_label: "Liam T.", player_name: "Liam T.", media_kind: "file", media_url: "/uploads/l.mp4", mime: "video/mp4", poster_url: "/uploads/poster-204.jpg", voteCount: 1, viewCount: 0, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 205, title: "Sample Swing", sport: "baseball", division: "boys", athlete_label: "Demo D.", player_name: "Demo D.", media_kind: "file", media_url: "/uploads/d.mp4", mime: "video/mp4", poster_url: "/uploads/poster-205.jpg", voteCount: 4, viewCount: 12, hasVoted: false, isSample: true, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
];
const doc = {
  querySelector: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
  body: { classList: { add: () => {}, remove: () => {} } },
};
const sb = {
  console, window: {},
  document: doc,
  $: (sel) => doc.querySelector(sel),
  $$: () => [],
  location: { hash: "" },
  history: { replaceState: () => {} },
  switchView: () => {},
  showHome: () => {},
  showPanel: () => {},
  ownerToken: () => "",
  ALL_PLAYS: plays,
  CONTEST: { monthKey: "2026-11", monthLabel: "November 2026", entries: [plays[0]], winner: null },
};
const ctx = vm.createContext(sb);
vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), ctx);
vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), ctx);
vm.runInContext(appJs.slice(appJs.indexOf("function shortTitle"), appJs.indexOf("function renderMonth")), ctx);
vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function guardianPlaysHtml121")), ctx);
const run = (code) => vm.runInContext(code, ctx);

// ---- B. the featured card's one-line meta row ----
{
  const feat = run("featCardHtml134(ALL_PLAYS[0])");
  const rowAt = feat.indexOf('class="feat-meta-row219"');
  assert(rowAt > -1, "B: a #1 with a moment tag + watches renders the meta row");
  const row = feat.slice(rowAt, feat.indexOf("feat-vote134"));
  assert(row.includes("🔥 Big Play") && row.includes("▶ 53 watches"), "B: the badge and the watches count sit in the SAME row (🔥 Big Play · ▶ 53 watches)");
  assert(row.indexOf("🔥 Big Play") < row.indexOf("▶ 53 watches"), "B: the badge leads, the watches follow on the line");
  assert(!feat.includes("moment-row162") && !feat.includes('<p class="feat-views151">'), "B: neither stacked row survives on the featured card");
  assert(feat.includes(">Vote for this play</span>") && feat.includes("toggleVote(201, this)") && feat.includes("13 votes"), "B: the big gold vote button is untouched (label, wiring, live count)");

  const viewsOnly = run("featCardHtml134(ALL_PLAYS[1])");
  assert(viewsOnly.includes('class="feat-meta-row219"') && viewsOnly.includes("▶ 7 watches") && !viewsOnly.includes("moment-chip162"), "B: watches alone still get the row (no chip, no empty badge slot)");

  const chipOnly = run("featCardHtml134(ALL_PLAYS[2])");
  assert(chipOnly.includes('class="feat-meta-row219"') && chipOnly.includes("💪 Comeback") && !chipOnly.includes("watches"), "B: a moment tag alone still gets the row (no watches text)");

  const neither = run("featCardHtml134(ALL_PLAYS[3])");
  assert(!neither.includes("feat-meta-row219"), "B: no tag and no watches → no meta row at all (no empty band)");

  const sample = run("featCardHtml134(ALL_PLAYS[4])");
  assert(sample.includes('class="feat-vote134 is-static"') && !sample.includes("toggleVote"), "D: the featured sample state stays a static chip (no vote wiring to relabel)");
}

// ---- C. the fame pill says Vote ----
// →220: the pill is a real vote button now — the label format
// is R219's, the element and wiring are Round 220's. The row
// tap assertions keep their meaning: the ROW's own onclick
// still opens the play; toggleVote lives only on the pill.
{
  const monthRow = run("fameRowHtml134(ALL_PLAYS[0], 0, { feed189: true })");
  assert(monthRow.includes('<button type="button" class="fame-votes-pill134 fame-vote-btn220"') && monthRow.includes(">Vote · 13 votes</button>"), "C: the Month row's pill reads \"Vote · 13 votes\" — →220: as a real <button> (Round 220)");
  assert(monthRow.includes('onclick="openPlay189(201, this)"') && monthRow.includes('onclick="event.stopPropagation();toggleVote(201, this)"'), "C: the Month row's tap wiring is unchanged (the row opens the feed) — →220: and the pill carries toggleVote with its click stopped (Round 220)");
  const fameRow = run("fameRowHtml134(ALL_PLAYS[3], 3)");
  assert(fameRow.includes(">Vote · 1 vote</button>"), "C: the Hall of Fame row's pill reads \"Vote · 1 vote\" (singular intact) — →220: button form (Round 220)");
  assert(fameRow.includes('onclick="goToPlayCard(204)"') && fameRow.includes('onclick="event.stopPropagation();toggleVote(204, this)"'), "C: the Hall of Fame row's tap wiring is unchanged (opens the play card) — →220: Fame pills vote identically (Round 220)");
}

// ---- D. already-Vote surfaces unchanged ----
{
  const tile = run("tileHtml(ALL_PLAYS[0])");
  assert(tile.includes("Vote · <b>13</b>") && tile.includes('onclick="event.stopPropagation();toggleVote(201, this)"'), "D: the board tile's vote chip still reads \"Vote · N\" exactly as built (not double-labeled)");
  const card = run("cardHtml(ALL_PLAYS[0])");
  assert(card.includes('class="votebtn"') && card.includes(">Vote</button>"), "D: the full card's vote button still reads \"Vote\"");
}

// ---- Served ----
async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r219-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HF_AVATAR_BASE_URL: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log, stop: () => child.kill("SIGKILL") };
}
{
  const s = await boot(4219);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=241"') && served.includes('href="styles.css?v=229"'), "served: the homepage carries the Round 219 pins — →220: now the Round 220 pins (app.js v218 / styles v212) — →221: now the Round 221 pins (app.js v219 / styles v213) — →222: now the Round 222 pins (app.js v220 / styles v214) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round) — →246: app.js now v241 (Round 246); styles now v229 (Round 246)");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("feat-meta-row219") && servedApp.includes('fame-votes-pill134">Vote · '), "served: app.js carries the meta row + the Vote pill — →220: the sample-span source line still ships; the button form rides pill220 (Round 220)");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes(".feat-meta-row219{display:flex"), "served: styles.css carries the meta-row rule");
  } finally { s.stop(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
}

console.log("\nALL R219 CHECKS PASSED");
