// Round 189 test: the TikTok-style watch feed. Run: node test-r189.js
// Boots the server twice on scratch DATA_DIRs:
//   A. Defaults — seeds three tiny video plays + one photo play
//      through the real upload pipeline, approves them, and
//      checks the public payload (musicTrack rides along empty),
//      the served page/app/css wiring, and that a hype cast
//      through the REAL vote endpoint (the exact call the feed's
//      Hype button makes via toggleVote) registers exactly once.
//   B. HH_NO_FEED=1 — the served index.html carries
//      window.HH_NO_FEED189 before app.js (and boot A's does
//      not); the API and boards are untouched.
// The feed's client logic is then driven in a vm slice of the
// served app.js (the house pattern): the sequence builder must
// preserve BOARD order even where hype order differs, the feed
// must open at the tapped play, battle pairing must render the
// head-to-head chrome, the end card must close the feed, a
// feed hype must call toggleVote exactly once, a photo play
// must render as a still (no <video>), the music chip must
// render only for a play carrying a track, and the kill switch
// must route board taps back to openPlayDetail. Exits non-zero
// on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

// ---- fixtures: three tiny distinct clips + one photo ----------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r189-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip1.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip2.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=512x288:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip3.mp4")]);
const CLIPS = [1, 2, 3].map((n) => fs.readFileSync(path.join(fixDir, `clip${n}.mp4`)));
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000000020001e221bc330000000049454e44ae426082", "hex");

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r189-"));
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
    const boundary = "----r189boundary";
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
  // ---------- Boot A: defaults ----------
  const s = await boot(3496, {});
  let appJs = "";
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const up1 = await s.upload({ ...F, playerName: "Nicholas B.", title: "Home Run" }, "clip1.mp4", CLIPS[0], "video/mp4");
    const up2 = await s.upload({ ...F, playerName: "Kameron A.", title: "Walk-Off Hit" }, "clip2.mp4", CLIPS[1], "video/mp4");
    const up3 = await s.upload({ ...F, playerName: "Gia M.", title: "Big Catch" }, "clip3.mp4", CLIPS[2], "video/mp4");
    const up4 = await s.upload({ ...F, playerName: "Photo Kid", title: "Team Photo Moment" }, "play.png", PNG, "image/png");
    assert(up1.status === 201 && up2.status === 201 && up3.status === 201 && up4.status === 201, "A: three video plays + one photo play upload (201)");
    const ids = [up1.body.id, up2.body.id, up3.body.id, up4.body.id];
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    assert(!!tok, "A: owner claim returns a token");
    for (const id of ids) {
      const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
      assert(ap.body.status === "approved", `A: play ${id} approved`);
    }
    const board = await s.waitFor(async () => { const r = await s.j("/api/highlights?division=all&sort=newest"); return r.body.highlights && r.body.highlights.length === 4 ? r.body : null; }, "A: all four plays public");
    const byId = Object.fromEntries(board.highlights.map((h) => [h.id, h]));
    assert(board.highlights.every((h) => h.musicTrack === ""), "A: every public play carries musicTrack (empty — no library exists yet)");
    const photo = byId[up4.body.id];
    assert(photo.media_kind === "file" && (photo.mime || "").startsWith("image/"), "A: the photo play is a photo (media_kind=file, image mime)");

    // Hype through the real endpoint — the exact call the
    // feed's Hype button makes through toggleVote.
    const v1 = await s.j(`/api/highlights/${ids[0]}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "v_feed_a" }) });
    assert(v1.status === 200 && v1.body.voteCount === 1 && v1.body.hasVoted === true, "A: one hype cast registers exactly once (voteCount 1)");
    const after = await s.j("/api/highlights?division=all");
    assert(after.body.highlights.find((h) => h.id === ids[0]).voteCount === 1, "A: the board payload shows the same count — a feed hype counts identically everywhere");

    // Served wiring.
    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('id="feed189"') && home.includes('id="feedTrack189"') && home.includes('id="feedClose189"'), "A: the page carries the feed overlay markup");
    assert(home.includes('id="btlFeedBtn189"'), "A: the Battles view carries the watch-in-feed entry");
    assert(home.includes('src="app.js?v=212"') && home.includes('href="styles.css?v=208"'), "A: asset pins are v189 — →190: app.js now v190 (Round 190); styles keeps v189 (unchanged this round) — →191: app.js + styles now v191 (Round 191) — →192: app.js now v192 (Round 192); styles keeps v191 (unchanged this round) — →193: app.js now v193 (Round 193); styles keeps v191 (unchanged this round) — →194: app.js + styles now v194 (Round 194) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211)");
    assert(!home.includes("window.HH_NO_FEED189=true"), "A: no kill-switch flag stamped in the page by default");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const css = await (await fetch(s.base + "/styles.css")).text();
    assert(appJs.includes("openPlay189") && appJs.includes("feedSequence189") && appJs.includes("openBattleFeed189"), "A: app.js wires the feed entry points");
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.length > 2000 && block.includes("You're all caught up") && block.includes("We believe every young athlete should be celebrated."), "A: the R189 block carries the finite end card + credo");
    assert(!block.includes(".sort("), "A: the feed block NEVER sorts — board order is inherited, never hype-ranked");
    assert(block.includes("toggleVote") && block.includes("sharePlay"), "A: feed hype/share ride the real toggleVote/sharePlay");
    assert(block.includes("Licensed hype track") && block.includes("musicTrack"), "A: the music chip is display-only, keyed on musicTrack");
    assert(css.includes(".feed189") && css.includes("object-fit:contain") && css.includes("scroll-snap-type:y mandatory"), "A: feed CSS — contain fit (never cropped) + scroll-snap");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- Boot B: kill switch ----------
  {
    const s2 = await boot(3497, { HH_NO_FEED: "1" });
    try {
      const home = await (await fetch(s2.base + "/")).text();
      const flagAt = home.indexOf("window.HH_NO_FEED189=true");
      assert(flagAt > -1 && flagAt < home.indexOf('src="app.js'), "B: HH_NO_FEED=1 stamps window.HH_NO_FEED189 into the page BEFORE app.js");
      const health = await fetch(s2.base + "/api/health");
      assert(health.ok, "B: server healthy under the kill switch");
      const board = await s2.j("/api/highlights?division=all");
      assert(board.status === 200 && Array.isArray(board.body.highlights), "B: the board API behaves exactly as today under HH_NO_FEED=1");
    } finally { s2.child.kill(); fs.rmSync(s2.tmp, { recursive: true, force: true }); }
  }

  // ---------- VM: the feed's client logic ----------
  {
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.length > 2000, "VM: R189 block located in the served app.js");
    const PLAYS = {
      11: { id: 11, title: "Home Run", player_name: "Nicholas B.", athlete_label: "Nicholas B.", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/a.mp4", poster_url: "/uploads/poster-a.jpg", voteCount: 5, hasVoted: false },
      12: { id: 12, title: "Walk-Off Hit", player_name: "Kameron A.", athlete_label: "Kameron A.", team: "Rival Sox", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/b.mp4", poster_url: "/uploads/poster-b.jpg", voteCount: 9, hasVoted: false },
      13: { id: 13, title: "Team Photo Moment", player_name: "Photo Kid", athlete_label: "Photo Kid", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "image/png", media_url: "/uploads/p.png", poster_url: "", voteCount: 1, hasVoted: false },
      14: { id: 14, title: "Sample Swing", player_name: "Demo D.", athlete_label: "Demo D.", team: "", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/s.mp4", poster_url: "", voteCount: 3, hasVoted: false, isSample: true },
      15: { id: 15, title: "Scored Big", player_name: "Gia M.", athlete_label: "Gia M.", team: "", sport: "softball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/g.mp4", poster_url: "", voteCount: 0, hasVoted: false, musicTrack: "Victory Lap (Instrumental)" },
    };
    const calls = { vote: [], share: [], detail: [], track: [], view: [] };
    const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null };
    const wrapEl = { hidden: true };
    const sandbox = {
      window: {},
      document: { getElementById: () => null, addEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } } },
      $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
      $$: () => [],
      esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
      findPlay: (id) => PLAYS[id] || null,
      playHasVideo: (h) => h.media_kind === "link_video" || (h.media_kind === "file" && !(h.mime || "").startsWith("image/")),
      posterUrlFor134: (h) => (h.media_kind === "file" && (h.mime || "").startsWith("image/") ? h.media_url : (h.poster_url || "")),
      trackEvent: (kind, id) => calls.track.push([kind, id]),
      toggleVote: async (id) => { calls.vote.push(id); },
      sharePlay: (id) => { calls.share.push(id); },
      openPlayDetail: (id) => { calls.detail.push(id); },
      switchView: (v) => { calls.view.push(v); },
      setMonthSub: () => { calls.view.push("month"); },
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

    // Sequence: board order preserved where hype order differs
    // (hype ranks 12 > 11 > 13; the board says 13, 11, 12).
    const seq = run("feedSequence189([13, 11, 12], 11)");
    assert(seq && seq.ids.join(",") === "13,11,12" && seq.start === 1, "VM: feed sequence = board order (13,11,12), NOT hype order (12,11,13); start at the tapped play");
    assert(run("feedSequence189([13, 11, 12], 13)").start === 0 && run("feedSequence189([13, 11, 12], 12)").start === 2, "VM: start index follows the tapped play (first/last)");
    assert(run("feedSequence189([13, 11, 12], 99)") === null && run("feedSequence189([], 11)") === null, "VM: unknown start / empty board → null (caller falls back to the classic detail)");

    // Slides.
    const vid = run("feedSlideHtml189(findPlay(11), 0, false)");
    assert(vid.includes("<video") && vid.includes('poster="/uploads/poster-a.jpg"') && vid.includes("feed189-bg") && vid.includes("Nicholas B.") && vid.includes("Home Run") && vid.includes("Plainview Hawks"), "VM: a video slide — own-poster blurred backdrop, caption (athlete, title, team)");
    assert(vid.includes('data-feed-hype="11"') && vid.includes('data-feed-count="11"') && vid.includes("feedShare189(11, this)"), "VM: the rail carries the real Hype button + count and the Share button — →190: the rail's visible label + aria read \"Vote\" (the button IS the vote; asserted in test-r190)");
    assert(!vid.includes("feed189-music"), "VM: no music chip on a play with no track attached");
    const pho = run("feedSlideHtml189(findPlay(13), 0, false)");
    assert(pho.includes("<img") && !pho.includes("<video") && pho.includes('data-feed-kind="photo"'), "VM: a photo play renders as a still in the same frame — no broken player");
    const sam = run("feedSlideHtml189(findPlay(14), 0, false)");
    assert(!sam.includes("data-feed-hype") && sam.includes('data-feed-count="14"'), "VM: a sample play keeps the display-only count (no vote button), like the boards");
    const mus = run("feedSlideHtml189(findPlay(15), 0, false)");
    assert(mus.includes("♪ Victory Lap (Instrumental)") && mus.includes("Licensed hype track"), "VM: the music chip renders when (and only when) a track is attached");

    // End card.
    const end = run("feedEndCardHtml189()");
    assert(end.includes("You're all caught up") && end.includes("We believe every young athlete should be celebrated.") && end.includes("Back to the board") && end.includes("See the Leaderboard") && end.includes("feedGo189('month')"), "VM: the end card — caught up, the credo, Back to the board + See the Leaderboard");

    // Open at the tapped play; finite sequence + end card.
    const opened = run("window.openFeed189([13, 11, 12], 11, null)");
    assert(opened === true && wrapEl.hidden === false, "VM: the feed opens at the tapped play");
    const html = trackEl.innerHTML;
    assert(html.indexOf('data-feed-slide="13"') > -1 && html.indexOf('data-feed-slide="13"') < html.indexOf('data-feed-slide="11"') && html.indexOf('data-feed-slide="11"') < html.indexOf('data-feed-slide="12"'), "VM: slides render in board order");
    assert(html.includes('data-feed-end="1"') && html.indexOf('data-feed-end="1"') > html.indexOf('data-feed-slide="12"'), "VM: the end card follows the last play — the feed is finite");
    assert(trackEl.scrollTop === 800, "VM: the track lands scrolled to the tapped play (start × slide height)");
    assert(calls.track.filter(([k, id]) => k === "play_open" && id === 11).length === 1, "VM: opening counts exactly one play_open, for the tapped play");

    // Hype + share from inside the feed.
    await run("window.feedHype189(11, null)");
    assert(calls.vote.length === 1 && calls.vote[0] === 11, "VM: a feed hype calls the real toggleVote exactly once");
    run("window.feedShare189(12, null)");
    assert(calls.share.length === 1 && calls.share[0] === 12, "VM: feed share rides the real sharePlay (the public #play- link)");

    // Battle feed: the dealt pair, head-to-head chrome.
    run("window.openBattleFeed189()");
    const bhtml = trackEl.innerHTML;
    assert(bhtml.includes("feed189-ribbon") && bhtml.includes("VS") && bhtml.includes("Home Run") && bhtml.includes("Walk-Off Hit") && bhtml.includes("Vote for the play you pick"), "VM: battle feed pairs the current matchup — ribbon, both plays, VS bar, the pick prompt — →190: the prompt reads \"Vote for the play you pick\" (the action is named Vote everywhere; Round 190)");
    assert(bhtml.indexOf('data-feed-slide="11"') > -1 && bhtml.indexOf('data-feed-slide="11"') < bhtml.indexOf('data-feed-slide="12"'), "VM: battle slides run A then B — swiping moves to the opponent");

    // Close.
    run("window.closeFeed189()");
    assert(wrapEl.hidden === true && trackEl.innerHTML === "", "VM: close hides the feed and clears the track");

    // Kill switch: taps fall back to the classic detail.
    sandbox.window.HH_NO_FEED189 = true;
    assert(run("window.openFeed189([13, 11, 12], 11, null)") === false && wrapEl.hidden === true, "VM: HH_NO_FEED189 — the feed will not open");
    run("window.openPlay189(11, null)");
    assert(calls.detail.length === 1 && calls.detail[0] === 11, "VM: HH_NO_FEED189 — a board tap opens the classic detail, exactly as before");
    delete sandbox.window.HH_NO_FEED189;
    // And with the feed on, a tap inside a board reads its order.
    const host = { querySelectorAll: () => ["13", "11", "12"].map((v) => ({ getAttribute: () => v })) };
    sandbox.__el189 = { closest: (sel) => (sel.includes("#allBoard") ? host : null) };
    run("window.openPlay189(11, __el189)");
    assert(wrapEl.hidden === false && trackEl.innerHTML.indexOf('data-feed-slide="13"') < trackEl.innerHTML.indexOf('data-feed-slide="11"'), "VM: a board tap opens the feed with the board's own DOM order");
  }

  console.log("\nR189 watch feed: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
