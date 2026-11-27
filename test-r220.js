// Round 220 test: the fame-row votes pill becomes a REAL vote
// control (Emil: "I want people to be able to vote").
// Run: node test-r220.js
// What this suite pins down:
//   A. Pins: app.js v218 / styles v212 (both files changed —
//      app.js for the pill markup, styles.css for the button
//      rules).
//   B. Statics: fameRowHtml134 builds the pill as the tile
//      chip's button form — a real <button> carrying the pill
//      class + fame-vote-btn220, wired to the SAME toggleVote
//      the board tiles use, with its click AND keydown stopped
//      (so the row's tap / Enter / Space handlers never also
//      fire), aria-pressed + the tile chip's aria-labels, and
//      the "Voted" label swap. Samples keep the R219
//      display-only span. styles.css carries the button reset
//      + the voted / vote-failed treatments.
//   C. VM drives of the real renderer: Month + Hall of Fame
//      pills carry identical wiring; the voted state mirrors
//      the tile chip (label "Voted · N votes", .voted class,
//      aria-pressed="true", remove-vote aria-label); the row
//      tap (openPlay189 Month / goToPlayCard Fame) and the
//      row keydown are byte-unchanged; a sample renders the
//      span with no vote wiring.
//   D. Booted server, end to end: a play is uploaded,
//      approved, entered and CROWNED (contest_winners) — then
//      a vote through the real endpoint still registers. That
//      is the Hall of Fame rule this round implements: Fame
//      plays accept votes (the vote endpoint takes any
//      approved play; Round 182 retirement bars re-ENTERING
//      the contest, never voting). The voter's payloads
//      (contest = month count, highlights = all-time) carry
//      hasVoted, and feeding the payload object back through
//      the renderer flips the pill to its voted state; a
//      second tap toggles off and the pill flips back.
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
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
assert(home.includes('src="app.js?v=224"') && home.includes('href="styles.css?v=217"'), "A: asset pins — app.js v218 / styles v212 (Round 220; both files changed) — →221: app.js now v219, styles now v213 (Round 221; both files changed) — →222: app.js now v220, styles now v214 (Round 222; both files changed) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227)");

// ---- B. statics ----
const fameSlice = appJs.slice(appJs.indexOf("function fameRowHtml134"), appJs.indexOf("function renderFame"));
assert(fameSlice.includes('class="fame-votes-pill134 fame-vote-btn220${h.hasVoted ? " voted" : ""}"'), "B: the pill is a button carrying the pill class + the voted class hook");
assert(fameSlice.includes('onclick="event.stopPropagation();toggleVote(${h.id}, this)"'), "B: the pill wires the SAME toggleVote as the board tiles, click stopped");
assert(fameSlice.includes('onkeydown="event.stopPropagation()"'), "B: the pill stops keydown too — the row's Enter/Space handler can never also fire from the pill");
assert(fameSlice.includes('aria-pressed="${h.hasVoted ? "true" : "false"}"') && fameSlice.includes("You voted for this play — tap to remove your vote") && fameSlice.includes('"Vote for this play"'), "B: aria-pressed + the tile chip's aria-labels (vote / remove-vote)");
assert(fameSlice.includes('${h.hasVoted ? "Voted" : "Vote"} · ${h.voteCount} vote'), "B: the label keeps the R219 format and swaps Vote → Voted in the voted state");
assert(fameSlice.includes('<span class="fame-votes-pill134">Vote · ${h.voteCount} vote'), "B: samples keep the display-only span (no vote affordance, Round 108)");
assert(css.includes(".fame-vote-btn220{font-family:inherit;cursor:pointer}") && css.includes(".fame-vote-btn220.voted{") && css.includes(".fame-vote-btn220.vote-failed{"), "B: styles.css carries the button reset + voted + vote-failed treatments");

// ---- VM drives of the real renderer (the house pattern) ----
const plays = [
  { id: 201, title: "Walk-off game winner", sport: "baseball", division: "boys", athlete_label: "Kameron A.", player_name: "Kameron A.", media_kind: "file", media_url: "/uploads/k.mp4", mime: "video/mp4", poster_url: "/uploads/poster-201.jpg", voteCount: 13, viewCount: 53, moment_kind: "big_play", hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 202, title: "Voted Play", sport: "softball", division: "girls", athlete_label: "Maya L.", player_name: "Maya L.", media_kind: "file", media_url: "/uploads/m.mp4", mime: "video/mp4", poster_url: "/uploads/poster-202.jpg", voteCount: 14, viewCount: 9, hasVoted: true, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 203, title: "Sample Swing", sport: "baseball", division: "boys", athlete_label: "Demo D.", player_name: "Demo D.", media_kind: "file", media_url: "/uploads/d.mp4", mime: "video/mp4", poster_url: "/uploads/poster-203.jpg", voteCount: 4, viewCount: 12, hasVoted: false, isSample: true, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
  { id: 204, title: "Solo Shot", sport: "hockey", division: "boys", athlete_label: "Liam T.", player_name: "Liam T.", media_kind: "file", media_url: "/uploads/l.mp4", mime: "video/mp4", poster_url: "/uploads/poster-204.jpg", voteCount: 1, viewCount: 0, hasVoted: false, isSample: false, isWinner: true, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
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

// ---- C. the pill is a vote button on both boards ----
{
  const monthRow = run("fameRowHtml134(ALL_PLAYS[0], 0, { feed189: true })");
  assert(monthRow.includes('<button type="button" class="fame-votes-pill134 fame-vote-btn220" aria-pressed="false" aria-label="Vote for this play" onclick="event.stopPropagation();toggleVote(201, this)" onkeydown="event.stopPropagation()">Vote · 13 votes</button>'), "C: Month pill — real button, toggleVote wiring, click + keydown stopped, R219 label");
  assert(monthRow.includes('onclick="openPlay189(201, this)"') && monthRow.includes("onkeydown=\"if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlay189(201, this)}\""), "C: the Month ROW's tap + keydown are unchanged (the row still only opens the play)");

  const monthVoted = run("fameRowHtml134(ALL_PLAYS[1], 1, { feed189: true })");
  assert(monthVoted.includes('class="fame-votes-pill134 fame-vote-btn220 voted"') && monthVoted.includes('aria-pressed="true"') && monthVoted.includes('aria-label="You voted for this play — tap to remove your vote"') && monthVoted.includes(">Voted · 14 votes</button>"), "C: Month pill voted state mirrors the tile chip (Voted label, .voted class, aria-pressed, remove-vote aria-label)");

  const fameRow = run("fameRowHtml134(ALL_PLAYS[3], 0)");
  assert(fameRow.includes('<button type="button" class="fame-votes-pill134 fame-vote-btn220" aria-pressed="false" aria-label="Vote for this play" onclick="event.stopPropagation();toggleVote(204, this)" onkeydown="event.stopPropagation()">Vote · 1 vote</button>'), "C: Hall of Fame pill — wired IDENTICALLY to Month (Fame plays accept votes), singular intact");
  assert(fameRow.includes('onclick="goToPlayCard(204)"'), "C: the Fame ROW's tap is unchanged (opens the play card)");
  const fameVoted = run("fameRowHtml134(ALL_PLAYS[1], 2)");
  assert(fameVoted.includes('fame-vote-btn220 voted"') && fameVoted.includes(">Voted · 14 votes</button>") && fameVoted.includes('onclick="event.stopPropagation();toggleVote(202, this)"'), "C: Hall of Fame pill voted state — same treatment as Month");

  const sampleRow = run("fameRowHtml134(ALL_PLAYS[2], 4, { feed189: true })");
  assert(sampleRow.includes('<span class="fame-votes-pill134">Vote · 4 votes</span>') && !sampleRow.includes("toggleVote") && !sampleRow.includes("fame-vote-btn220"), "C: a sample keeps the display-only span — no vote affordance (Round 108)");
}

// ---- D. booted server: a crowned winner still takes votes ----
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r220-fix-"));
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=640x360:duration=1", "-frames:v", "1", path.join(fixDir, "photo.jpg")]);
const PHOTO = fs.readFileSync(path.join(fixDir, "photo.jpg"));

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r220-"));
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
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r220boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  return { tmp, child, base, j, upload, getLog: () => log, stop: () => child.kill("SIGKILL") };
}
{
  const s = await boot(4220);
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const up = await s.upload({ ...F, playerName: "Nicholas B.", title: "Hall of Fame Drive" }, "photo.jpg", PHOTO, "image/jpeg");
    assert(up.status === 201, "D: the play uploads (201)");
    const id = up.body.id;
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    assert(!!tok, "D: owner claim returns a token");
    const owner = { "content-type": "application/json", "x-owner-token": tok };
    const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: owner, body: JSON.stringify({ status: "approved" }) });
    assert(ap.body.status === "approved", "D: the play is approved");
    const en = await s.j("/api/contest/enter", { method: "POST", headers: owner, body: JSON.stringify({ highlightId: id }) });
    assert(en.status === 201, "D: the play is entered in the contest (owner override)");
    const win = await s.j("/api/contest/winner", { method: "POST", headers: owner, body: JSON.stringify({ highlightId: id }) });
    assert(win.status === 200 && win.body.ok, "D: the play is CROWNED this month's winner (a contest_winners record — the Hall of Fame case)");

    const vote = (vt) => s.j(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: vt }) });
    const v1 = await vote("v_r220_a");
    assert(v1.status === 200 && v1.body.voteCount === 1 && v1.body.hasVoted === true, "D: a crowned winner STILL accepts a vote — retirement bars contest re-entry, never voting (the Hall of Fame rule)");

    const board = await s.j("/api/highlights?division=all&voterToken=v_r220_a");
    const mine = (board.body.highlights || []).find((h) => h.id === id);
    assert(mine && mine.hasVoted === true && mine.voteCount === 1, "D: the all-time payload carries the winner with hasVoted + the fresh count (isWinner itself rides only the contest payload — asserted next)");
    const contest = await s.j("/api/contest?voterToken=v_r220_a");
    const entry = (contest.body.entries || []).find((h) => h.id === id);
    assert(entry && entry.isWinner === true && entry.hasVoted === true && entry.voteCount === 1, "D: the contest payload marks the winner and carries hasVoted + the month count for the same voter");

    sb.ALL_PLAYS = [mine];
    const fameVotedRow = run("fameRowHtml134(ALL_PLAYS[0], 0)");
    assert(fameVotedRow.includes('fame-vote-btn220 voted"') && fameVotedRow.includes(">Voted · 1 vote</button>"), "D: the payload object renders the Fame pill in its voted state (count + state came from the server)");
    const monthVotedRow = run(`fameRowHtml134(${JSON.stringify(entry)}, 0, { feed189: true })`);
    assert(monthVotedRow.includes('fame-vote-btn220 voted"') && monthVotedRow.includes(">Voted · 1 vote</button>"), "D: the contest payload object renders the Month pill in its voted state");

    const v2 = await vote("v_r220_a");
    assert(v2.status === 200 && v2.body.voteCount === 0 && v2.body.hasVoted === false, "D: a second tap on the pill toggles the vote back off");
    const board2 = await s.j("/api/highlights?division=all&voterToken=v_r220_a");
    const mine2 = (board2.body.highlights || []).find((h) => h.id === id);
    sb.ALL_PLAYS = [mine2];
    const fameBackRow = run("fameRowHtml134(ALL_PLAYS[0], 0)");
    assert(fameBackRow.includes('aria-pressed="false"') && fameBackRow.includes(">Vote · 0 votes</button>") && !fameBackRow.includes("btn220 voted"), "D: after toggling off, the pill renders the un-voted state again");

    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=224"') && served.includes('href="styles.css?v=217"'), "D: the served homepage carries the Round 220 pins — →221: now the Round 221 pins (app.js v219 / styles v213) — →222: now the Round 222 pins (app.js v220 / styles v214) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227)");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("fame-vote-btn220") && servedApp.includes('onclick="event.stopPropagation();toggleVote(${h.id}, this)"'), "D: the served app.js carries the pill's vote wiring");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes(".fame-vote-btn220.voted{"), "D: the served styles.css carries the voted treatment");
  } finally { s.stop(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
}

console.log("\nALL R220 CHECKS PASSED");
