// Round 191 test: the feed design refinement (the design
// review Emil approved 2026-11-25). Run: node test-r191.js
// Boots the server twice on scratch DATA_DIRs:
//   A. Defaults — seeds one portrait clip + one landscape clip
//      through the real upload pipeline, approves them, and
//      checks the served feed header (small HH crest, slim
//      Watch + Battles tabs, NO Hype of the Month tab), the
//      v191 asset pins, the app.js R191 wiring (shape
//      classifier, crown asset, the fixed swipe hint), and the
//      Round 191 CSS (portrait fill, wide band + below-band
//      caption, crown, hint fade).
//   B. HH_NO_FEED=1 — the kill switch still stands the feed
//      down exactly as in Round 189.
// The feed's client logic is then driven in a vm slice of the
// served app.js (the house pattern): feedShape191 classifies
// stubbed dimensions both ways, feedApplyShape191 stamps the
// classes, captions render title-first in the shared renderer
// (the markup both placements use), a title-less play falls
// back to name-first, the rail wears crown.png and no 👑, the
// swipe hint renders once per session and is hidden for good
// after advancing, and the Round 189/190 behaviors (board
// order, hype-once, end card, Vote labels) still hold. Exits
// non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

// ---- fixtures: one portrait clip + one landscape clip --------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r191-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=360x640:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "portrait.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "landscape.mp4")]);
const CLIPS = [fs.readFileSync(path.join(fixDir, "portrait.mp4")), fs.readFileSync(path.join(fixDir, "landscape.mp4"))];

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r191-"));
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
    const boundary = "----r191boundary";
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
  const s = await boot(3501, {});
  let appJs = "";
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const up1 = await s.upload({ ...F, playerName: "Nicholas B.", title: "Home Run" }, "portrait.mp4", CLIPS[0], "video/mp4");
    const up2 = await s.upload({ ...F, playerName: "Kameron A.", title: "Walk-Off Hit" }, "landscape.mp4", CLIPS[1], "video/mp4");
    assert(up1.status === 201 && up2.status === 201, "A: a portrait clip + a landscape clip upload (201)");
    const ids = [up1.body.id, up2.body.id];
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    assert(!!tok, "A: owner claim returns a token");
    for (const id of ids) {
      const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
      assert(ap.body.status === "approved", `A: play ${id} approved`);
    }
    await s.waitFor(async () => { const r = await s.j("/api/highlights?division=all&sort=newest"); return r.body.highlights && r.body.highlights.length === 2 ? r.body : null; }, "A: both plays public");

    // Served wiring: pins + the slimmed feed header.
    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=206"') && home.includes('href="styles.css?v=203"'), "A: asset pins are v191 (Round 191 changed app.js + styles.css) — →192: app.js now v192 (Round 192); styles keeps v191 (unchanged this round) — →193: app.js now v193 (Round 193); styles keeps v191 (unchanged this round) — →194: app.js + styles now v194 (Round 194) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205)");
    const header = home.slice(home.indexOf('id="feed189"'), home.indexOf('id="feedTrack189"'));
    assert(header.includes('src="/crest-watermark.png?v=174"') && header.includes('class="feed191-crest"'), "A: the feed header carries the small HH crest (the site's crest-watermark, pinned as elsewhere on the page)");
    assert(header.includes('data-feed-tab="all"') && header.includes('data-feed-tab="battles"'), "A: the feed header keeps slim Watch + Battles tabs");
    assert(!header.includes('data-feed-tab="month"') && !header.includes("Hype of the Month"), "A: Hype of the Month is OUT of the feed header");
    assert(!header.includes("logo-header-gold") && header.includes('id="feedClose189"'), "A: the wide lockup leaves the feed header; the close button stays");
    appJs = await (await fetch(s.base + "/app.js")).text();
    const css = await (await fetch(s.base + "/styles.css")).text();
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.includes("feedShape191") && block.includes("feedWireShape191") && block.includes("loadedmetadata"), "A: app.js wires the shape classifier (real dimensions, metadata first)");
    const railFn = block.slice(block.indexOf("function feedHypeRail189"), block.indexOf("function feedVsHtml189"));
    assert(railFn.includes('src="crown.png"') && railFn.includes('class="feed191-crown"') && !railFn.includes("👑"), "A: the rail wears the brand's gold crown (public/crown.png) — no 👑 emoji in the rail renderer");
    assert(block.includes("↑ Swipe up for the next play") && !block.includes("Swipe up for the next play ↓"), "A: the swipe hint reads \"↑ Swipe up for the next play\" (arrow matches the words; the old down-arrow hint is gone)");
    assert(block.includes("feed191.hintSeen"), "A: the hint's once-per-session state is wired");
    assert(css.includes(".feed191-portrait") && css.includes("object-fit:cover"), "A: CSS — portrait slides fill the viewer (cover)");
    assert(css.includes(".feed191-wide") && css.includes(".feed191-wide .feed189-caption"), "A: CSS — wide slides get the band layout with the caption below the video");
    assert(css.includes(".feed191-crown") && css.includes("@keyframes feed191hintfade") && css.includes(".feed191-crest"), "A: CSS — the crown mark, the hint's one-time fade, and the slim crest");
  } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }

  // ---------- Boot B: kill switch ----------
  {
    const s2 = await boot(3502, { HH_NO_FEED: "1" });
    try {
      const home = await (await fetch(s2.base + "/")).text();
      const flagAt = home.indexOf("window.HH_NO_FEED189=true");
      assert(flagAt > -1 && flagAt < home.indexOf('src="app.js'), "B: HH_NO_FEED=1 still stamps window.HH_NO_FEED189 into the page BEFORE app.js");
      const board = await s2.j("/api/highlights?division=all");
      assert(board.status === 200 && Array.isArray(board.body.highlights), "B: the board API behaves exactly as today under HH_NO_FEED=1");
    } finally { s2.child.kill(); fs.rmSync(s2.tmp, { recursive: true, force: true }); }
  }

  // ---------- VM: the refined feed logic ----------
  {
    const block = appJs.slice(appJs.indexOf("/* Round 189 (2026-11-25): the watch feed"));
    assert(block.length > 2000, "VM: R189 block located in the served app.js");
    const PLAYS = {
      11: { id: 11, title: "Home Run", player_name: "Nicholas B.", athlete_label: "Nicholas B.", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/a.mp4", poster_url: "/uploads/poster-a.jpg", voteCount: 5, hasVoted: false },
      12: { id: 12, title: "Walk-Off Hit", player_name: "Kameron A.", athlete_label: "Kameron A.", team: "Rival Sox", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/b.mp4", poster_url: "/uploads/poster-b.jpg", voteCount: 9, hasVoted: false },
      13: { id: 13, title: "Team Photo Moment", player_name: "Photo Kid", athlete_label: "Photo Kid", team: "Plainview Hawks", sport: "baseball", media_kind: "file", mime: "image/png", media_url: "/uploads/p.png", poster_url: "", voteCount: 1, hasVoted: false },
      14: { id: 14, title: "Sample Swing", player_name: "Demo D.", athlete_label: "Demo D.", team: "", sport: "baseball", media_kind: "file", mime: "video/mp4", media_url: "/uploads/s.mp4", poster_url: "", voteCount: 3, hasVoted: false, isSample: true },
      16: { id: 16, title: "", player_name: "Solo Kid", athlete_label: "Solo Kid", team: "", sport: "soccer", media_kind: "file", mime: "video/mp4", media_url: "/uploads/t.mp4", poster_url: "", voteCount: 0, hasVoted: false },
    };
    const calls = { vote: [], detail: [] };
    const hintEl = { style: {} };
    const trackEl = { innerHTML: "", clientHeight: 800, scrollTop: 0, addEventListener: () => {}, querySelectorAll: () => [], querySelector: (sel) => (sel.includes("data-feed-hint189") ? hintEl : null) };
    const wrapEl = { hidden: true };
    const sandbox = {
      window: {},
      document: { getElementById: () => null, addEventListener: () => {}, body: { classList: { add: () => {}, remove: () => {} } } },
      $: (sel) => (sel === "#feed189" ? wrapEl : sel === "#feedTrack189" ? trackEl : null),
      $$: () => [],
      esc: (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])),
      cap: (s) => { const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; },
      findPlay: (id) => PLAYS[id] || null,
      playHasVideo: (h) => h.media_kind === "file" && !(h.mime || "").startsWith("image/"),
      posterUrlFor134: (h) => (h.media_kind === "file" && (h.mime || "").startsWith("image/") ? h.media_url : (h.poster_url || "")),
      trackEvent: () => {},
      toggleVote: async (id) => { calls.vote.push(id); },
      sharePlay: () => {},
      openPlayDetail: (id) => { calls.detail.push(id); },
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

    // Shape classification, both ways (stubbed dimensions).
    assert(run("feedShape191(390, 844)") === "portrait" && run("feedShape191(1080, 1920)") === "portrait", "VM: taller-than-wide classifies portrait (fills the viewer)");
    assert(run("feedShape191(1920, 1080)") === "landscape" && run("feedShape191(640, 360)") === "landscape", "VM: wider-than-tall classifies landscape (the GameChanger band)");
    assert(run("feedShape191(500, 500)") === "landscape" && run("feedShape191(0, 0)") === "", "VM: square rides the band treatment; unknown dimensions classify as nothing (base layout kept)");
    const stubSlide = () => {
      const set = new Set();
      return { dataset: {}, _set: set, classList: { toggle: (c, f) => { if (f) set.add(c); else set.delete(c); }, contains: (c) => set.has(c) } };
    };
    const st = stubSlide();
    sandbox.__st191 = st;
    assert(run("feedApplyShape191(__st191, 390, 844)") === "portrait" && st.dataset.feedShape === "portrait" && st.classList.contains("feed191-portrait") && !st.classList.contains("feed191-wide"), "VM: feedApplyShape191 stamps the portrait class + data-feed-shape");
    assert(run("feedApplyShape191(__st191, 1920, 1080)") === "landscape" && st.dataset.feedShape === "landscape" && st.classList.contains("feed191-wide") && !st.classList.contains("feed191-portrait"), "VM: re-classifying with real metadata flips the slide to the wide band");

    // Title-first captions (the one renderer both placements use).
    const slide12 = run("feedSlideHtml189(findPlay(12), 0, false)");
    assert(slide12.indexOf("Walk-Off Hit") > -1 && slide12.indexOf("Walk-Off Hit") < slide12.indexOf("Kameron A. · Baseball"), "VM: caption order is title first (\"Walk-Off Hit\"), then \"Athlete · Sport\" (\"Kameron A. · Baseball\")");
    assert(slide12.includes('<p class="feed189-title">Walk-Off Hit</p>') && slide12.includes('<p class="feed189-athlete">Kameron A. · Baseball</p>') && slide12.includes("Rival Sox"), "VM: the title takes the strong line, the athlete line carries name + sport, the team chip survives");
    const slide16 = run("feedSlideHtml189(findPlay(16), 0, false)");
    assert(slide16.includes('<p class="feed189-title">Solo Kid</p>') && slide16.includes('<p class="feed189-athlete">Soccer</p>') && !slide16.includes('<p class="feed189-title"></p>'), "VM: a title-less play falls back to name-first (name on the hook line, sport beneath) without an empty title line");

    // The crown rail.
    const rail = run("feedHypeRail189(findPlay(11))");
    assert(rail.includes('src="crown.png"') && rail.includes('class="feed191-crown"') && !rail.includes("👑"), "VM: the vote button wears the gold crown asset, not the emoji");
    assert(rail.includes('<span class="feed189-raillabel">Vote</span>') && rail.includes('aria-label="Vote for this play"'), "VM: the rail still reads \"Vote\" (Round 190 holds)");
    const railSample = run("feedHypeRail189(findPlay(14))");
    assert(railSample.includes('src="crown.png"') && !railSample.includes("👑") && !railSample.includes("data-feed-hype"), "VM: the sample chip wears the crown too and stays display-only");

    // The hint: once per session, gone for good after advancing.
    const opened = run("window.openFeed189([13, 11, 12], 11, null)");
    assert(opened === true && wrapEl.hidden === false, "VM: the feed opens at the tapped play");
    const firstHtml = trackEl.innerHTML;
    assert((firstHtml.match(/data-feed-hint189/g) || []).length === 1 && firstHtml.includes("↑ Swipe up for the next play") && !firstHtml.includes("next play ↓"), "VM: the hint renders exactly once, on the first slide, with the up arrow");
    assert(firstHtml.indexOf('data-feed-slide="13"') < firstHtml.indexOf('data-feed-slide="11"') && firstHtml.indexOf('data-feed-slide="11"') < firstHtml.indexOf('data-feed-slide="12"') && firstHtml.includes('data-feed-end="1"'), "VM: board order + the finite end card survive the refinement (Round 189 holds)");
    run("feedActivate189(2)");
    assert(hintEl.style.display === "none", "VM: advancing past the first slide (the start slide is index 1 in this sequence) hides the hint for good");
    run("window.closeFeed189()");
    run("window.openFeed189([13, 11, 12], 11, null)");
    assert(!trackEl.innerHTML.includes("data-feed-hint189"), "VM: re-entry in the same session does NOT re-render the hint (once per session)");

    // A feed vote still rides the real toggleVote, exactly once.
    await run("window.feedHype189(11, null)");
    assert(calls.vote.length === 1 && calls.vote[0] === 11, "VM: a feed vote still calls the real toggleVote exactly once (Round 189/190 hold)");

    // Kill switch still stands the feed down.
    sandbox.window.HH_NO_FEED189 = true;
    run("window.closeFeed189()");
    assert(run("window.openFeed189([13, 11, 12], 11, null)") === false && wrapEl.hidden === true, "VM: HH_NO_FEED189 — the feed will not open");
    run("window.openPlay189(11, null)");
    assert(calls.detail.length === 1 && calls.detail[0] === 11, "VM: HH_NO_FEED189 — a board tap opens the classic detail, exactly as before");
    delete sandbox.window.HH_NO_FEED189;
  }

  console.log("\nR191 feed design refinement: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
