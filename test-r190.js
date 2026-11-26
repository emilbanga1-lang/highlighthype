// Round 190 test: the vote button says "Vote" everywhere it
// appears. Run: node test-r190.js
// Emil confirmed the Hype button IS the vote (it runs through
// toggleVote) and directed: "Change it everywhere the vote
// button appears." Most surfaces already read Vote (tile pill,
// full card, featured/detail button, watch view — asserted here
// so they can never silently regress); the surfaces that still
// named the action "Hype" were the Round 189 watch feed's rail
// (visible label + aria-label) and its battle prompt. This
// suite boots the server once, checks the served pins + app.js
// strings, proves a vote through the REAL endpoint (the exact
// call every relabeled button makes via toggleVote) registers
// exactly once and toggles back off, then drives the real
// renderers in vm slices (the house pattern):
//   - tileHtml:        "Vote · N" / voted state "Voted · N"
//   - cardHtml:        "Vote" / voted state "You voted — tap to remove"
//   - featCardHtml134: "Vote for this play" / "✓ Voted for this play"
//     (the Month board's featured card — the play detail's
//     full-width vote action)
//   - fameRowHtml134:  the Month / Hall of Fame row carries NO
//     vote button of its own — a display-only "N votes" pill;
//     its tap opens the feed (Month) whose rail is the Vote
//     button asserted below
//   - watchHtml107 via openPlayDetail: "👑 Vote for Hype of the
//     Month" (the contest proper noun stays in the label)
//   - the R189 feed block: rail label + aria read "Vote", the
//     battle prompt reads "Vote for the play you pick", the
//     voted state stays style-only, a feed vote calls
//     toggleVote exactly once, samples stay display-only
// and sweeps every rendered output + the served app.js for any
// vote button still labeled "Hype". Battles pick controls
// ("Pick A/B", "✓ Your pick") are just-for-fun picks (Round
// 179), NOT votes — asserted untouched. Exits non-zero on
// failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r190-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip1.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip2.mp4")]);
const CLIPS = [1, 2].map((n) => fs.readFileSync(path.join(fixDir, `clip${n}.mp4`)));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r190-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r190boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, what, timeoutMs = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2000));
      await wait(1000);
    }
  };
  return { tmp, child, base, j, upload, waitFor, getLog: () => log };
}

try {
  // ---------- Boot: defaults ----------
  const s = await boot(3498, {});
  let appJs = "";
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const up1 = await s.upload({ ...F, playerName: "Nicholas B.", title: "Home Run" }, "clip1.mp4", CLIPS[0], "video/mp4");
    const up2 = await s.upload({ ...F, playerName: "Kameron A.", title: "Walk-Off Hit" }, "clip2.mp4", CLIPS[1], "video/mp4");
    assert(up1.status === 201 && up2.status === 201, "boot: two plays upload (201)");
    const ids = [up1.body.id, up2.body.id];
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    assert(!!tok, "boot: owner claim returns a token");
    for (const id of ids) {
      const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
      assert(ap.body.status === "approved", `boot: play ${id} approved`);
    }
    await s.waitFor(async () => { const r = await s.j("/api/highlights?division=all&sort=newest"); return r.body.highlights && r.body.highlights.length === 2 ? r.body : null; }, "boot: both plays public");

    // The toggle behind every relabeled button: one tap = one
    // vote, a second tap removes it. Exactly-once semantics.
    const vote = (id, vt) => s.j(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: vt }) });
    const v1 = await vote(ids[0], "v_r190_a");
    assert(v1.status === 200 && v1.body.voteCount === 1 && v1.body.hasVoted === true, "endpoint: a vote from the relabeled button registers exactly once (voteCount 1)");
    const v2 = await vote(ids[0], "v_r190_a");
    assert(v2.status === 200 && v2.body.voteCount === 0 && v2.body.hasVoted === false, "endpoint: the same button toggles the vote back off (it is a toggle, not a counter)");
    const v3 = await vote(ids[0], "v_r190_b");
    assert(v3.status === 200 && v3.body.voteCount === 1, "endpoint: a second voter adds exactly one more (no double-count)");

    // Served wiring + the app.js string sweep.
    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=202"'), "pins: app.js rides ?v=190 (Round 190 changed app.js) — →191: app.js now v191 (Round 191) — →192: app.js now v192 (Round 192) — →193: app.js now v193 (Round 193) — →194: app.js + styles now v194 (Round 194) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201)");
    assert(home.includes('href="styles.css?v=200"'), "pins: styles.css keeps ?v=189 (unchanged this round — the standing pin discipline) — →191: styles now v191 (Round 191 changed styles.css) — →194: styles now v194 (Round 194 changed styles.css) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201)");
    appJs = await (await fetch(s.base + "/app.js")).text();
    assert(!appJs.includes('aria-label="Hype this play"'), "sweep: no vote button anywhere still carries the \"Hype this play\" aria-label");
    assert(!appJs.includes(">Hype</span>"), "sweep: no rail/button label still renders a bare \"Hype\"");
    assert(!appJs.includes("Hype the play you pick"), "sweep: the old battle prompt is gone");
    assert(appJs.includes("Vote for the play you pick"), "feed: the battle prompt reads \"Vote for the play you pick\"");
    assert(appJs.includes('aria-label="Vote for this play"'), "feed: the rail button's aria-label reads \"Vote for this play\"");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- VM: the board surfaces ----------
  {
    const plays = [
      { id: 101, title: "Big Play", sport: "baseball", division: "boys", athlete_label: "Jayden", player_name: "Jayden", media_kind: "file", media_url: "/uploads/a.mp4", mime: "video/mp4", voteCount: 5, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
      { id: 102, title: "Voted Play", sport: "softball", division: "girls", athlete_label: "Maya", player_name: "Maya", media_kind: "file", media_url: "/uploads/b.png", mime: "image/png", voteCount: 9, hasVoted: true, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" },
    ];
    const entry = { id: 104, title: "Contest Play", sport: "hockey", division: "boys", athlete_label: "Liam", player_name: "Liam", media_kind: "file", media_url: "/uploads/d.mp4", mime: "video/mp4", voteCount: 7, hasVoted: false, isSample: false, isWinner: false, prizeEligible: true, hasGuardianEmail: true, created_at: "2026-11-05T00:00:00Z" };
    const bodyEl = { innerHTML: "" };
    const wrapEl = { hidden: true, querySelector: () => ({ focus: () => {} }) };
    const doc = {
      querySelector: (sel) => (sel === "#playDetail" ? wrapEl : sel === "#playDetailBody" ? bodyEl : null),
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
      ALL_PLAYS: [...plays, entry],
      CONTEST: { monthKey: "2026-11", monthLabel: "November 2026", entries: [entry], winner: null },
    };
    const ctx = vm.createContext(sb);
    vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("function shortTitle"), appJs.indexOf("function renderMonth")), ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function guardianPlaysHtml121")), ctx);
    vm.runInContext(appJs.slice(appJs.indexOf("let detailPlayId"), appJs.indexOf("/* ---------------- athlete collection")), ctx);
    vm.runInContext("var openPlayDetail = window.openPlayDetail, closePlayDetail = window.closePlayDetail, goToPlayCard = window.goToPlayCard;", ctx);
    const run = (code) => vm.runInContext(code, ctx);

    // Board tile.
    const tile = run("tileHtml(ALL_PLAYS[0])");
    assert(tile.includes('class="vote-chip vote-chip-btn vote-pill153"') && tile.includes("Vote · <b>5</b>") && tile.includes('onclick="event.stopPropagation();toggleVote(101, this)"'), "tile: the vote button reads \"Vote · N\" and wires the real toggleVote");
    const tileVoted = run("tileHtml(ALL_PLAYS[1])");
    assert(tileVoted.includes("Voted · <b>9</b>") && tileVoted.includes('aria-pressed="true"'), "tile: the already-voted state label reads \"Voted · N\"");

    // Full card (athlete pages + card contexts).
    const card = run("cardHtml(ALL_PLAYS[0])");
    assert(card.includes('class="votebtn"') && card.includes(">Vote</button>") && card.includes("toggleVote(101, this)"), "card: the vote button reads \"Vote\"");
    const cardVoted = run("cardHtml(ALL_PLAYS[1])");
    assert(cardVoted.includes("You voted — tap to remove"), "card: the already-voted state label reads \"You voted — tap to remove\"");

    // The Month board's featured card (the detail's full-width
    // vote action).
    const feat = run("featCardHtml134(ALL_PLAYS[0])");
    assert(feat.includes('class="feat-vote134"') && feat.includes(">Vote for this play</span>") && feat.includes("toggleVote(101, this)"), "Month featured card: the vote button reads \"Vote for this play\"");
    const featVoted = run("featCardHtml134(ALL_PLAYS[1])");
    assert(featVoted.includes("✓ Voted for this play"), "Month featured card: the already-voted state label reads \"✓ Voted for this play\"");

    // Month / Hall of Fame rows: no vote button of their own —
    // a display-only votes pill; the Month row's tap opens the
    // feed, whose rail (asserted below) is the Vote button.
    const row = run("fameRowHtml134(ALL_PLAYS[0], 0, { feed189: true })");
    assert(row.includes('class="fame-votes-pill134"') && row.includes("5 votes") && row.includes("openPlay189(101, this)") && !row.includes("toggleVote"), "Month row: display-only \"N votes\" pill, no vote button on the row — its tap opens the feed's Vote button");
    const fameRow = run("fameRowHtml134(ALL_PLAYS[0], 0)");
    assert(fameRow.includes("5 votes") && !fameRow.includes("toggleVote") && fameRow.includes("goToPlayCard(101)"), "Hall of Fame row: same display-only pill, classic card tap, no vote button");

    // Play detail (watch view).
    run("openPlayDetail(104)");
    assert(bodyEl.innerHTML.includes('class="votebtn watch-votebtn"') && bodyEl.innerHTML.includes("👑 Vote for Hype of the Month") && bodyEl.innerHTML.includes("toggleVote(104, this)"), "detail: the watch vote button reads \"Vote for Hype of the Month\" (contest proper noun kept) via toggleVote");
    run("openPlayDetail(102)");
    assert(bodyEl.innerHTML.includes("You voted — tap to remove"), "detail: the already-voted state label reads \"You voted — tap to remove\"");

    // The sweep over rendered output: no rendered vote button
    // on any surface still reads "Hype" as its action label.
    const rendered = [tile, tileVoted, card, cardVoted, feat, featVoted, row, fameRow, bodyEl.innerHTML].join("\n");
    assert(!/>Hype</.test(rendered) && !rendered.includes('aria-label="Hype'), "sweep: no rendered vote button anywhere still reads \"Hype\"");
  }

  // ---------- VM: the R189 feed block ----------
  {
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.length > 2000, "feed VM: R189 block located in the served app.js");
    const PLAYS = {
      11: { id: 11, title: "Home Run", player_name: "Nicholas B.", athlete_label: "Nicholas B.", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/a.mp4", poster_url: "/uploads/poster-a.jpg", voteCount: 5, hasVoted: false },
      12: { id: 12, title: "Walk-Off Hit", player_name: "Kameron A.", athlete_label: "Kameron A.", team: "Rival Sox", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/b.mp4", poster_url: "/uploads/poster-b.jpg", voteCount: 9, hasVoted: true },
      14: { id: 14, title: "Sample Swing", player_name: "Demo D.", athlete_label: "Demo D.", team: "", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/s.mp4", poster_url: "", voteCount: 3, hasVoted: false, isSample: true },
    };
    const calls = { vote: [] };
    const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null };
    const wrapEl2 = { hidden: true };
    const sandbox = {
      window: {},
      document: { getElementById: () => null, addEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } } },
      $: (sel) => (sel === "#feed189" ? wrapEl2 : sel === "#feedTrack189" ? trackEl : null),
      $$: () => [],
      esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
      findPlay: (id) => PLAYS[id] || null,
      playHasVideo: (h) => h.media_kind === "file" && !(h.mime || "").startsWith("image/"),
      posterUrlFor134: (h) => h.poster_url || "",
      trackEvent: () => {},
      toggleVote: async (id) => { calls.vote.push(id); },
      sharePlay: () => {},
      openPlayDetail: () => {},
      switchView: () => {},
      setMonthSub: () => {},
      pauseMediaIn158: () => {},
      featPause163: () => {},
      requestAnimationFrame: (fn) => { fn(); return 0; },
      btl: { cur: { L: 11, R: 12 } },
      console,
    };
    sandbox.window.toggleVote = sandbox.toggleVote;
    sandbox.window.sharePlay = sandbox.sharePlay;
    sandbox.window.openPlayDetail = sandbox.openPlayDetail;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(block, ctx);
    const run = (code) => vm.runInContext(code, ctx);

    const rail = run("feedHypeRail189(findPlay(11))");
    assert(rail.includes('data-feed-hype="11"') && rail.includes('aria-label="Vote for this play"') && rail.includes('<span class="feed189-raillabel">Vote</span>'), "feed rail: the button's visible label + aria read \"Vote\"");
    assert(!rail.includes("Hype this play") && !rail.includes(">Hype</span>"), "feed rail: nothing on the button still reads \"Hype\"");
    const railVoted = run("feedHypeRail189(findPlay(12))");
    assert(railVoted.includes('class="feed189-hype voted"') && railVoted.includes('aria-pressed="true"') && railVoted.includes('<span class="feed189-raillabel">Vote</span>'), "feed rail: the voted state stays style-only (.voted + aria-pressed) — the label reads \"Vote\" in both states, as mocked");
    const railSample = run("feedHypeRail189(findPlay(14))");
    assert(!railSample.includes("data-feed-hype") && railSample.includes(">Sample</span>"), "feed rail: a sample play stays display-only (no vote button to relabel)");

    const slide = run("feedSlideHtml189(findPlay(11), 0, false)");
    assert(slide.includes('<span class="feed189-raillabel">Vote</span>'), "feed slide: the rail on a full slide reads \"Vote\"");

    run("window.openBattleFeed189()");
    assert(trackEl.innerHTML.includes("Vote for the play you pick") && !trackEl.innerHTML.includes("Hype the play you pick"), "feed battle: the prompt reads \"Vote for the play you pick\"");

    await run("window.feedHype189(11, null)");
    assert(calls.vote.length === 1 && calls.vote[0] === 11, "feed: a vote from the relabeled button calls the real toggleVote exactly once");

    // Battles caution: Quick Battles picks are just-for-fun
    // (Round 179) and are NOT the vote button — untouched.
    assert(appJs.includes('pickL.textContent = "Pick A"') && appJs.includes('textContent = "✓ Your pick"'), "battles: the pick controls keep their pick labels (picks are not votes — Round 179)");
  }

  console.log("\nR190 vote-button relabel: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
