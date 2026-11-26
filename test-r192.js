// Round 192 test: streaming renditions + homepage load
// discipline (Emil's slow-homepage report, 2026-11-25).
// Run: node test-r192.js
// Boots the server on scratch DATA_DIRs:
//   A. Defaults — uploads a clip through the real pipeline and
//      checks: the play gains a stream_url rendition (smaller,
//      faststart, ≤720p) while media_url (the master) is
//      untouched; /uploads Range serving answers 206 with the
//      right Content-Range for master AND rendition (it was
//      never the bug — R117 — and must not regress); video
//      cache headers are long-cache immutable while posters
//      stay on the one-day policy; the v192 pin rides the page.
//   B. HH_NO_STREAM192=1 on A's data — the payload serves ''
//      for stream_url (master playback restored) and a fresh
//      upload under the switch generates NO rendition (the
//      DB row itself stays '').
//   C. Backfill — a video play whose poster + rendition are
//      wiped (row blanked, files deleted) regains both at
//      boot with no re-upload; a photo play and a link play
//      are left alone; a second boot changes nothing
//      (idempotent — rendition file mtime is stable, no temp
//      files are left behind).
// The client wiring is then driven in a vm slice of the served
// app.js (the house pattern): playSrc192 prefers the rendition
// and falls back to the master; mediaHtml's rest form (board
// cards) carries preload="metadata" and no autoplay while the
// watch form keeps preload="auto" + autoplay; fameThumbHtml
// loads the rendition; a Leaderboard row renders its poster
// as an <img> and falls back to the sport plate without one.
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

// ---- fixtures: one fat-master landscape clip + one photo ----
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r192-fix-"));
// A phone-like master: 640x360 at CRF 18 (fat for its size), with audio.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", "-c:a", "aac", path.join(fixDir, "clip.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:duration=0.1", "-frames:v", "1", "-q:v", "3", path.join(fixDir, "photo.jpg")]);
// A second, distinct clip for Boot B — the same bytes as Boot A's
// upload would (correctly) trip the all-time media-hash dedupe.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=512x288:rate=30:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-movflags", "+faststart", path.join(fixDir, "clip2.mp4")]);
const CLIP = fs.readFileSync(path.join(fixDir, "clip.mp4"));
const CLIP2 = fs.readFileSync(path.join(fixDir, "clip2.mp4"));
const PHOTO = fs.readFileSync(path.join(fixDir, "photo.jpg"));

async function boot(port, extraEnv, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r192-"));
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
    const boundary = "----r192boundary";
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
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, j, upload, waitFor, stop, getLog: () => log };
}
const boardPlay = async (s, id) => {
  const r = await s.j("/api/highlights?division=all&sort=newest");
  return (r.body.highlights || []).find((h) => h.id === id) || null;
};
const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };

try {
  // ---------- Boot A: defaults ----------
  const s = await boot(3512, {});
  let streamName = "", masterName = "", posterName = "";
  try {
    const up = await s.upload({ ...F, playerName: "Kameron A.", title: "Walk-Off" }, "clip.mp4", CLIP, "video/mp4");
    assert(up.status === 201, "A: clip uploads (201)");
    const id = up.body.id;
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    assert(ap.body.status === "approved", "A: play approved");

    const play = await s.waitFor(async () => { const p = await boardPlay(s, id); return p && p.stream_url && p.poster_url ? p : null; }, "A: play gains stream_url + poster_url");
    assert(play.stream_url.endsWith("-stream.mp4"), `A: stream_url names the rendition sibling (${play.stream_url})`);
    assert(!play.media_url.includes("-stream"), "A: media_url still names the master");
    masterName = path.basename(play.media_url);
    streamName = path.basename(play.stream_url);
    posterName = path.basename(play.poster_url);
    const upDir = path.join(s.tmp, "uploads");
    const masterBytes = fs.statSync(path.join(upDir, masterName)).size;
    const streamBytes = fs.statSync(path.join(upDir, streamName)).size;
    assert(streamBytes < masterBytes, `A: rendition is smaller than the master (${streamBytes} < ${masterBytes})`);
    // Faststart: moov ahead of mdat in the rendition's head.
    const head = fs.readFileSync(path.join(upDir, streamName)).subarray(0, 1024 * 1024);
    assert(head.indexOf("moov") !== -1 && (head.indexOf("mdat") === -1 || head.indexOf("moov") < head.indexOf("mdat")), "A: rendition is faststart (moov before mdat)");
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", path.join(upDir, streamName)]).toString());
    const v = probe.streams.find((x) => x.codec_type === "video");
    assert(v.codec_name === "h264" && v.pix_fmt === "yuv420p" && v.width <= 1280 && v.height <= 720, `A: rendition is H.264/yuv420p within 720p (${v.width}x${v.height})`);

    // Range serving — master and rendition alike (the R117 contract).
    for (const [label, name, size] of [["master", masterName, masterBytes], ["rendition", streamName, streamBytes]]) {
      const rr = await fetch(`${s.base}/uploads/${name}`, { headers: { Range: "bytes=100-199" } });
      const buf = Buffer.from(await rr.arrayBuffer());
      assert(rr.status === 206 && rr.headers.get("content-range") === `bytes 100-199/${size}` && buf.length === 100 && rr.headers.get("accept-ranges") === "bytes", `A: Range bytes=100-199 on the ${label} → 206 with the exact Content-Range`);
      const tail = await fetch(`${s.base}/uploads/${name}`, { headers: { Range: "bytes=-64" } });
      const tbuf = Buffer.from(await tail.arrayBuffer());
      const fileTail = fs.readFileSync(path.join(upDir, name)).subarray(size - 64);
      assert(tail.status === 206 && tbuf.equals(fileTail), `A: suffix Range on the ${label} returns the file's actual tail`);
    }
    // Cache policy: videos immutable-long, posters one-day.
    const mv = await fetch(`${s.base}/uploads/${masterName}`);
    await mv.arrayBuffer();
    assert((mv.headers.get("cache-control") || "").includes("immutable"), "A: video cache-control is long-cache immutable");
    const pi = await fetch(`${s.base}/uploads/${posterName}`);
    await pi.arrayBuffer();
    const pcc = pi.headers.get("cache-control") || "";
    assert(pcc.includes("max-age=86400") && !pcc.includes("immutable"), "A: poster cache-control stays on the one-day policy (posters regenerate in place)");

    const home = await (await fetch(s.base + "/")).text();
    assert(home.includes('src="app.js?v=209"') && home.includes('href="styles.css?v=205"'), "A: asset pins — app.js v192 (Round 192), styles keeps v191 — →193: app.js now v193 (Round 193) — →194: app.js + styles now v194 (Round 194) — →197: app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");
    const appJs = await (await fetch(s.base + "/app.js?v=209")).text();
    assert(appJs.includes("function playSrc192"), "A: served app.js carries playSrc192");
    assert(appJs.split("playSrc192").length - 1 >= 4, "A: playSrc192 is wired into mediaHtml, fameThumbHtml and the feed renderer (helper + call sites)");
    assert(appJs.includes("rest192"), "A: served app.js carries the rest192 at-rest card form");
  } finally { await s.stop(); }

  // ---------- Boot B: kill switch on A's data ----------
  const s2 = await boot(3513, { HH_NO_STREAM192: "1" }, s.tmp);
  try {
    const list = await s2.j("/api/highlights?division=all&sort=newest");
    const old = (list.body.highlights || [])[0];
    assert(old && old.stream_url === "", "B: HH_NO_STREAM192=1 serves stream_url '' (clients fall back to the master)");
    const up2 = await s2.upload({ ...F, playerName: "Nicholas B.", title: "Double" }, "clip2.mp4", CLIP2, "video/mp4");
    assert(up2.status === 201, "B: upload under the kill switch still succeeds (201)");
    await wait(12000); // the pipeline chain settles well inside this on a 3s clip
    const dbB = new DatabaseSync(path.join(s2.tmp, "highlighthype.db"), { readOnly: true });
    const rowB = dbB.prepare("SELECT stream_url FROM highlights WHERE id=?").get(up2.body.id);
    dbB.close();
    assert(rowB && rowB.stream_url === "", "B: no rendition is generated under the kill switch (row stays '')");
    assert(!fs.readdirSync(path.join(s2.tmp, "uploads")).some((n) => n.endsWith(".r192tmp.mp4")), "B: no rendition temp files left behind");
  } finally { await s2.stop(); }

  // ---------- Boot C: backfill ----------
  const s3 = await boot(3514, {});
  let cDir = "";
  try {
    const vUp = await s3.upload({ ...F, playerName: "Juliana", title: "Caught Stealing" }, "clip.mp4", CLIP, "video/mp4");
    const pUp = await s3.upload({ ...F, playerName: "Maya", title: "Team Photo" }, "photo.jpg", PHOTO, "image/jpeg");
    assert(vUp.status === 201 && pUp.status === 201, "C: video + photo uploads succeed (201)");
    const claim3 = await s3.j("/api/owner/claim", { method: "POST" });
    for (const pid of [vUp.body.id, pUp.body.id]) await s3.j(`/api/highlights/${pid}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": claim3.body.token }, body: JSON.stringify({ status: "approved" }) });
    const vPlay = await s3.waitFor(async () => { const p = await boardPlay(s3, vUp.body.id); return p && p.stream_url && p.poster_url ? p : null; }, "C: video play settles with rendition + poster");
    cDir = s3.tmp;
    // Wipe the play's poster + rendition (row AND files), and seed
    // a link play directly — then reboot: the backfill must heal
    // the video play and leave photo + link plays untouched.
    const dbC = new DatabaseSync(path.join(cDir, "highlighthype.db"));
    dbC.prepare("UPDATE highlights SET poster_url='', stream_url='' WHERE id=?").run(vUp.body.id);
    dbC.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, status, player_name) VALUES ('Linked Clip', 'soccer', 'link_video', 'https://example.com/clip.mp4', 'approved', 'Link Kid')").run();
    dbC.close();
    const upC = path.join(cDir, "uploads");
    fs.unlinkSync(path.join(upC, path.basename(vPlay.poster_url)));
    fs.unlinkSync(path.join(upC, path.basename(vPlay.stream_url)));
    await s3.stop();

    const s4 = await boot(3515, {}, cDir);
    try {
      const healed = await s4.waitFor(async () => { const p = await boardPlay(s4, vUp.body.id); return p && p.stream_url && p.poster_url ? p : null; }, "C: backfill restores poster + rendition");
      assert(healed.poster_url === vPlay.poster_url && healed.stream_url === vPlay.stream_url, "C: backfill restores the same poster + rendition URLs");
      const photo = await boardPlay(s4, pUp.body.id);
      assert(photo && photo.stream_url === "" && photo.poster_url === "", "C: photo play is left alone (no rendition, no poster)");
      const dbC2 = new DatabaseSync(path.join(cDir, "highlighthype.db"), { readOnly: true });
      const link = dbC2.prepare("SELECT stream_url, poster_url FROM highlights WHERE media_kind='link_video'").get();
      dbC2.close();
      assert(link && link.stream_url === "" && link.poster_url === "", "C: link play is left alone by the backfill");
      var healedStreamMtime = fs.statSync(path.join(upC, path.basename(healed.stream_url))).mtimeMs;
      var healedStreamName = path.basename(healed.stream_url);
    } finally { await s4.stop(); }

    // Idempotency: a second boot regenerates nothing.
    const s5 = await boot(3516, {}, cDir);
    try {
      await wait(14000); // the backfill starts ~5s after boot by design; give its scan time to finish and log
      assert(fs.statSync(path.join(upC, healedStreamName)).mtimeMs === healedStreamMtime, "C: second boot leaves the rendition untouched (idempotent)");
      assert(!fs.readdirSync(upC).some((n) => n.includes(".r192tmp")), "C: no rendition temp files remain after the backfill boots");
      const logTail = s5.getLog();
      assert(logTail.includes("[r192] backfill complete (0 renditions made, 0 posters made"), "C: second backfill reports nothing to do");
    } finally { await s5.stop(); }
  } catch (e) { if (s3.child.exitCode === null) await s3.stop(); throw e; }

  // ---------- VM drive: the client wiring ----------
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const sb = { console, setTimeout, clearTimeout, window: {}, document: undefined, navigator: {}, localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("/* ---------------- data")), ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("function mediaHtml"), appJs.indexOf("/* ---------------- views")), ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("function shortTitle"), appJs.indexOf("function renderMonth")), ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("function fameThumbHtml"), appJs.indexOf("function guardianPlaysHtml121")), ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("/* ---------------- Round 192")), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  const withStream = { id: 7, media_kind: "file", mime: "video/mp4", media_url: "/uploads/x.mp4", stream_url: "/uploads/x-stream.mp4", poster_url: "/uploads/poster-7.jpg", sport: "baseball", title: "Walk-Off", player_name: "Kameron A.", voteCount: 3, viewCount: 9 };
  const noStream = { ...withStream, stream_url: "" };
  assert(run(`playSrc192(${JSON.stringify(withStream)})`) === "/uploads/x-stream.mp4", "VM: playSrc192 prefers the rendition");
  assert(run(`playSrc192(${JSON.stringify(noStream)})`) === "/uploads/x.mp4", "VM: playSrc192 falls back to the master when no rendition exists");
  assert(run(`playSrc192(${JSON.stringify({ media_kind: "link_video", media_url: "https://cdn.example/v.mp4", stream_url: "/uploads/x-stream.mp4" })})`) === "https://cdn.example/v.mp4", "VM: playSrc192 never renditions a link play");
  const rest = run(`mediaHtml(${JSON.stringify(withStream)}, { rest192: true })`);
  assert(rest.includes('src="/uploads/x-stream.mp4"') && rest.includes('preload="metadata"') && !rest.includes("autoplay") && !rest.includes('preload="auto"'), "VM: board-card media rests on the poster — rendition src, preload=metadata, no autoplay");
  const watch = run(`mediaHtml(${JSON.stringify(withStream)})`);
  assert(watch.includes('src="/uploads/x-stream.mp4"') && watch.includes('preload="auto"') && watch.includes("autoplay"), "VM: watch/detail media keeps preload=auto + autoplay, on the rendition");
  const restMaster = run(`mediaHtml(${JSON.stringify(noStream)}, { rest192: true })`);
  assert(restMaster.includes('src="/uploads/x.mp4"'), "VM: a rendition-less play's card loads the master (fallback intact)");
  const thumb = run(`fameThumbHtml(${JSON.stringify(withStream)}, {})`);
  assert(thumb.includes('src="/uploads/x-stream.mp4"'), "VM: board tiles load the rendition");
  const rowImg = run(`fameRowHtml134(${JSON.stringify(withStream)}, 0)`);
  assert(rowImg.includes('<img src="/uploads/poster-7.jpg"'), "VM: a Leaderboard row with a poster renders the poster as an <img>");
  const rowFallback = run(`fameRowHtml134(${JSON.stringify({ ...withStream, poster_url: "" })}, 1)`);
  assert(rowFallback.includes("fame-thumb-fallback134") && !rowFallback.includes("<img"), "VM: a poster-less row renders the sport-plate fallback, never a black <video>");
  const feedSlice = appJs.slice(appJs.indexOf("function feedMediaHtml189"), appJs.indexOf("function feedHypeRail189"));
  assert(feedSlice.includes("playSrc192"), "VM: the watch feed's video renderer loads through playSrc192");

  console.log("\nR192 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
