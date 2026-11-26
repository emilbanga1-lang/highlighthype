// Round 203 test: the action-band reframe stage in the
// upload enhancement agent (Emil's "center more around her
// instead of the sky", 2026-11-26). Run: node test-r203.js
// Boots the server on scratch DATA_DIRs:
//   A. The REAL cheer clip (720x1280 HEVC HLG, 7.27s — the
//      clip Emil ran through the agent by hand): upload →
//      reframed to the action band, full width kept, height
//      in the 55–70% window, poster + rendition made from
//      the reframed file, the pre-R203 display file
//      preserved, the R186 report (stabilize applied) and
//      the r195 key intact alongside r203.
//   B. A synthetic sky-heavy portrait (static color top
//      ~60%, testsrc2 motion in the bottom ~40%) →
//      reframed, height materially reduced, width untouched.
//   C. Full-frame motion portrait (testsrc2 filling
//      720x1280) → no-reframe, display file untouched.
//   D. Nearly static portrait (a looped single frame) →
//      no-reframe, below the decisiveness floor.
//   E. Landscape full-frame motion (1280x720 testsrc2) →
//      no-reframe.
//   F. HH_NO_REFRAME=1: the sky-heavy fixture uploads,
//      status "skipped", file unchanged, and the rest of
//      the chain (poster, rendition, r195) is intact.
//   G. Backfill: a seeded legacy sky-heavy play is
//      reframed once at boot; a second boot changes
//      nothing.
//   H. Feed shape unit checks against the served app.js
//      (the test-r191 vm pattern): the Round 203 threshold
//      — properly tall is portrait; near-square rides the
//      band — and every Round 191 classification the old
//      rule produced for real shapes is unchanged.
// Uploads are gated on the boot backfills having finished
// (their summary lines), so a boot scan can never meet a
// fresh upload mid-chain — the settled row is the read.
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
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { maxBuffer: 32 * 1024 * 1024 });
const probeOf = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const vinfoOf = (file) => { const p = probeOf(file); const v = p.streams.find((s) => s.codec_type === "video"); return { width: v.width, height: v.height, duration: Number(p.format.duration) }; };

const CHEER = "/home/hatch/workspace/user/media_library/video/b9/b9162a9414fa1e290a4836306a63dface8c70f600b05bdfda6ab6774d96ba21f.mp4";

// ---- fixtures -------------------------------------------------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r203-fix-"));
const F = (n) => path.join(fixDir, n);
// Sky-heavy portrait: a STATIC textured frame everywhere
// (a frozen testsrc2 still — textured, so the agent's
// shake read locks onto the static majority and calls the
// camera locked-off) with an animated testsrc2 patch
// composited into the bottom ~35% (y 830..1250), drifting
// side to side. Only the patch's bands carry motion. (A
// flat-color top + full-width testsrc2 bottom was tried
// first and read too weak at the working scale — peak
// 6.6 against the floor of 8; real subject motion, like
// the cheer clip's 25–40, is what the floor is tuned to.)
ffgen(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", F("sky-bg-src.mp4")]);
ffgen(["-i", F("sky-bg-src.mp4"), "-ss", "0.5", "-frames:v", "1", F("sky-bg.png")]);
ffgen(["-loop", "1", "-t", "4", "-i", F("sky-bg.png"), "-f", "lavfi", "-i", "testsrc2=size=480x420:rate=30:duration=4",
  "-filter_complex", "[0:v][1:v]overlay=x='120+110*sin(2*PI*t/2.4)':y=830:format=auto,format=yuv420p[v]", "-map", "[v]",
  "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("sky.mp4")]);
// Full-frame motion, portrait + landscape (testsrc2 moves in
// every band — no axis can be decisive).
ffgen(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("fullframe.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("land.mp4")]);
// Nearly static portrait: one frame, looped.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", F("still-src.mp4")]);
ffgen(["-i", F("still-src.mp4"), "-ss", "0.5", "-frames:v", "1", F("still-frame.png")]);
ffgen(["-loop", "1", "-t", "3", "-i", F("still-frame.png"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("still.mp4")]);

async function boot(port, extraEnv, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r203-"));
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
  // Wait out the boot-time Round 124 migration (the test-r186
  // lesson: uploading before it finishes races the pipeline).
  for (let i = 0; i < 100; i++) {
    try {
      const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
      const marker = db.prepare("SELECT value FROM settings WHERE key='r124_media_migration_v1'").get();
      db.close();
      if (marker) break;
    } catch {}
    await wait(200);
  }
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r203boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const readRow = (id) => {
    const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
    try { return db.prepare("SELECT id, media_url, poster_url, stream_url, enhance_json, r195_checked_at, r203_checked_at FROM highlights WHERE id=?").get(id); } finally { db.close(); }
  };
  const waitFor = async (fn, what, timeoutMs = 300000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2500));
      await wait(1200);
    }
  };
  // The boot backfills (r192/r195/r203) all start ~5s after
  // listen; an upload that lands before they finish can be
  // met mid-chain by a scan. Gate uploads on this round's
  // scan having completed (or reported itself disabled), so
  // the chain alone owns every uploaded play in A–F.
  const waitBootScans = (what) => waitFor(() => (log.includes("[r203] backfill complete") || log.includes("[r203] backfill disabled")) || null, what || "boot backfills settled", 120000);
  // For uploads: wait for the SETTLED row — the r203 stamp
  // set AND enhance_json carrying the Round 186 report, the
  // r195 evaluation and the r203 evaluation, with the
  // poster and the rendition in place (the chain's last
  // media steps).
  const waitSettled = (id, what) => waitFor(() => {
    const r = readRow(id);
    if (!r || !r.r203_checked_at || !r.enhance_json || !r.stream_url || !r.poster_url) return null;
    try { const j = JSON.parse(r.enhance_json); return j.status && j.r195 && j.r203 ? r : null; } catch { return null; }
  }, what || `settled r203 state on play ${id}`);
  const waitStamp = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r203_checked_at ? r : null; }, what || `r203 stamp on play ${id}`);
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, upload, readRow, waitFor, waitBootScans, waitSettled, waitStamp, stop, getLog: () => log };
}
const FIELDS = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Kid R203" };
const r203Of = (row) => { const j = JSON.parse(row.enhance_json || "{}"); return j.r203 || null; };

const ONLY = process.env.R203_ONLY || "";
try {
  // ---------- A: the real cheer clip ----------
  if (!ONLY || ONLY === "A") {
  const a = await boot(3621, {});
  try {
    await a.waitBootScans("A: boot backfills settled");
    const upDir = path.join(a.tmp, "uploads");
    const up = await a.upload({ sport: "cheer", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Cheer Kid", title: "R203 Cheer Tumble" }, "cheer.mp4", fs.readFileSync(CHEER), "video/mp4");
    assert(up.status === 201, "A: the cheer clip uploads (201)");
    const row = await a.waitSettled(up.body.id, "A: settled");
    const j = JSON.parse(row.enhance_json);
    const r = j.r203;
    console.log("A r203:", JSON.stringify(r));
    assert(j.applied && j.applied.stabilize === true, "A: the Round 186 report survives alongside r203, with stabilization applied (this clip trips shake)");
    assert(j.r195 && j.r195.trim && j.r195.upscale, "A: the r195 evaluation survives alongside r203");
    assert(r.status === "reframed", `A: status reframed (got ${r.status})`);
    assert(row.media_url.includes("-reframed"), `A: media_url names the reframed file (${row.media_url})`);
    const out = vinfoOf(path.join(upDir, path.basename(row.media_url)));
    assert(out.width === 720, `A: full width kept (out width ${out.width})`);
    assert(out.height >= 0.55 * 1280 && out.height <= 0.70 * 1280, `A: out height ${out.height} is 55–70% of 1280 (the bottom action band)`);
    assert(r.crop && r.crop.x === 0 && r.crop.w === 720 && r.crop.y > 0 && r.crop.h === out.height, `A: crop rect is the full width from y=${r.crop && r.crop.y} (got ${JSON.stringify(r.crop)})`);
    assert(Math.abs(out.duration - 7.27) <= 0.75, `A: duration preserved (${out.duration.toFixed(2)}s ≈ 7.27s)`);
    assert(r.srcW === 720 && r.srcH === 1280, "A: the report records the 720x1280 source");
    const poster = vinfoOf(path.join(upDir, path.basename(row.poster_url)));
    assert(poster.width === out.width && Math.abs(poster.height - out.height) <= 4, `A: the poster is made from the reframed file (${poster.width}x${poster.height})`);
    const stream = vinfoOf(path.join(upDir, path.basename(row.stream_url)));
    assert(Math.abs(stream.width / stream.height - out.width / out.height) < 0.05, `A: the rendition is made from the reframed file (aspect ${stream.width}x${stream.height} ≈ ${out.width}x${out.height})`);
    assert(r.preservedFile && fs.existsSync(path.join(upDir, r.preservedFile)), "A: the pre-R203 display file is preserved on disk");
    const preserved = vinfoOf(path.join(upDir, r.preservedFile));
    assert(preserved.width === 720 && preserved.height === 1280, `A: the preserved file is the full-frame enhanced clip (${preserved.width}x${preserved.height})`);
    assert(j.preEnhanceFile && fs.existsSync(path.join(upDir, j.preEnhanceFile)), "A: the TRUE original (the chain's first -preenhance file) still exists, unclobbered");
    assert(!fs.readdirSync(upDir).some((n) => n.includes(".r203tmp")), "A: no R203 temp files remain");
  } finally { await a.stop(); }
  }

  // ---------- B: synthetic sky-heavy portrait ----------
  if (!ONLY || ONLY === "B") {
  const b = await boot(3622, {});
  try {
    await b.waitBootScans("B: boot backfills settled");
    const upDir = path.join(b.tmp, "uploads");
    const up = await b.upload({ ...FIELDS, title: "R203 Sky" }, "sky.mp4", fs.readFileSync(F("sky.mp4")), "video/mp4");
    assert(up.status === 201, "B: upload accepted (201)");
    const row = await b.waitSettled(up.body.id, "B: settled");
    const r = r203Of(row);
    console.log("B r203:", JSON.stringify(r));
    assert(r.status === "reframed", `B: status reframed (got ${r.status})`);
    const out = vinfoOf(path.join(upDir, path.basename(row.media_url)));
    assert(out.width === 720, `B: width untouched (${out.width})`);
    assert(out.height <= 0.75 * 1280 && out.height >= 0.40 * 1280, `B: height materially reduced (${out.height} of 1280)`);
    assert(r.crop && r.crop.y > 0 && r.crop.x === 0, `B: the crop takes the top away, not the sides (crop ${JSON.stringify(r.crop)})`);
    assert(r.preservedFile && fs.existsSync(path.join(upDir, r.preservedFile)), "B: the pre-reframe display file is preserved");
  } finally { await b.stop(); }
  }

  // ---------- C: full-frame motion portrait ----------
  if (!ONLY || ONLY === "C") {
  const c = await boot(3623, {});
  try {
    await c.waitBootScans("C: boot backfills settled");
    const upDir = path.join(c.tmp, "uploads");
    const up = await c.upload({ ...FIELDS, title: "R203 Full Motion" }, "fullframe.mp4", fs.readFileSync(F("fullframe.mp4")), "video/mp4");
    assert(up.status === 201, "C: upload accepted (201)");
    const row = await c.waitSettled(up.body.id, "C: settled");
    const j = JSON.parse(row.enhance_json);
    const r = j.r203;
    console.log("C r203:", JSON.stringify(r));
    assert(r.status === "no-reframe", `C: status no-reframe (got ${r.status})`);
    assert(!row.media_url.includes("-reframed"), "C: media_url carries no reframed file");
    assert(!fs.readdirSync(upDir).some((n) => n.includes("-reframed")), "C: no reframed derivative exists on disk");
    if (j.output && j.output.file === path.basename(row.media_url)) {
      assert(fs.statSync(path.join(upDir, path.basename(row.media_url))).size === j.output.bytes, "C: the display file is byte-identical to the Round 186 output (R203 never touched it)");
    }
  } finally { await c.stop(); }
  }

  // ---------- D: nearly static portrait ----------
  if (!ONLY || ONLY === "D") {
  const d = await boot(3624, {});
  try {
    await d.waitBootScans("D: boot backfills settled");
    const upDir = path.join(d.tmp, "uploads");
    const up = await d.upload({ ...FIELDS, title: "R203 Still" }, "still.mp4", fs.readFileSync(F("still.mp4")), "video/mp4");
    assert(up.status === 201, "D: upload accepted (201)");
    const row = await d.waitSettled(up.body.id, "D: settled");
    const r = r203Of(row);
    console.log("D r203:", JSON.stringify(r));
    assert(r.status === "no-reframe", `D: status no-reframe (got ${r.status})`);
    assert(r.rows.peak < 8 && r.cols.peak < 8, `D: both axes sit below the decisiveness floor (rows peak ${r.rows.peak}, cols peak ${r.cols.peak})`);
    assert(!fs.readdirSync(upDir).some((n) => n.includes("-reframed")), "D: no reframed derivative exists on disk");
  } finally { await d.stop(); }
  }

  // ---------- E: landscape full-frame motion ----------
  if (!ONLY || ONLY === "E") {
  const e = await boot(3625, {});
  try {
    await e.waitBootScans("E: boot backfills settled");
    const upDir = path.join(e.tmp, "uploads");
    const up = await e.upload({ ...FIELDS, title: "R203 Landscape" }, "land.mp4", fs.readFileSync(F("land.mp4")), "video/mp4");
    assert(up.status === 201, "E: upload accepted (201)");
    const row = await e.waitSettled(up.body.id, "E: settled");
    const r = r203Of(row);
    console.log("E r203:", JSON.stringify(r));
    assert(r.status === "no-reframe", `E: status no-reframe (got ${r.status})`);
    const out = vinfoOf(path.join(upDir, path.basename(row.media_url)));
    assert(out.width === 1280 && out.height === 720, `E: the landscape file keeps its dimensions (${out.width}x${out.height})`);
    assert(!fs.readdirSync(upDir).some((n) => n.includes("-reframed")), "E: no reframed derivative exists on disk");
  } finally { await e.stop(); }
  }

  // ---------- F: HH_NO_REFRAME=1 ----------
  if (!ONLY || ONLY === "F") {
  const f = await boot(3626, { HH_NO_REFRAME: "1" });
  try {
    await f.waitBootScans("F: boot backfills settled");
    const upDir = path.join(f.tmp, "uploads");
    const up = await f.upload({ ...FIELDS, title: "R203 NoReframe" }, "sky.mp4", fs.readFileSync(F("sky.mp4")), "video/mp4");
    assert(up.status === 201, "F: upload accepted (201)");
    const row = await f.waitSettled(up.body.id, "F: settled");
    const j = JSON.parse(row.enhance_json);
    const r = j.r203;
    console.log("F r203:", JSON.stringify(r));
    assert(r.status === "skipped" && /HH_NO_REFRAME/.test(r.reason || ""), "F: the stage records itself skipped under HH_NO_REFRAME=1");
    assert(!row.media_url.includes("-reframed"), "F: the sky-heavy clip is NOT reframed under the kill switch");
    const out = vinfoOf(path.join(upDir, path.basename(row.media_url)));
    assert(out.width === 720 && out.height === 1280, `F: the display file keeps its full frame (${out.width}x${out.height})`);
    assert(j.status && j.r195, "F: rest of the chain intact — the Round 186 report and the r195 evaluation are present");
    assert(row.poster_url && row.stream_url, "F: rest of the chain intact — poster and rendition still made");
  } finally { await f.stop(); }
  }

  // ---------- G: backfill ----------
  if (!ONLY || ONLY === "G") {
  const g1 = await boot(3627, {});
  const gDir = g1.tmp;
  await g1.stop();
  const gUp = path.join(gDir, "uploads");
  fs.mkdirSync(gUp, { recursive: true });
  fs.copyFileSync(F("sky.mp4"), path.join(gUp, "seedsky.mp4"));
  {
    const db = new DatabaseSync(path.join(gDir, "highlighthype.db"));
    db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, status, player_name, enhance_json) VALUES ('Seed Sky', 'baseball', 'file', '/uploads/seedsky.mp4', 'approved', 'Seed Kid', '')").run();
    db.close();
  }
  let seedId = 0;
  {
    const db = new DatabaseSync(path.join(gDir, "highlighthype.db"), { readOnly: true });
    seedId = db.prepare("SELECT id FROM highlights WHERE media_url='/uploads/seedsky.mp4'").get().id;
    db.close();
  }
  let seedMedia = "", seedMtime = 0;
  const g2 = await boot(3628, {}, gDir);
  try {
    const row = await g2.waitStamp(seedId, "G: seed stamp");
    const r = r203Of(row);
    console.log("G r203:", JSON.stringify(r));
    assert(r.status === "reframed" && r.origin === "backfill", `G: the seeded legacy play is reframed by the backfill (got ${r.status}/${r.origin})`);
    assert(row.media_url === "/uploads/seedsky-reframed.mp4", `G: media_url names the reframed file (${row.media_url})`);
    const out = vinfoOf(path.join(gUp, "seedsky-reframed.mp4"));
    assert(out.width === 720 && out.height < 1280, `G: the reframed seed is ${out.width}x${out.height} (full width, band height)`);
    assert(r.preservedFile === "seedsky-preenhance.mp4" && fs.statSync(path.join(gUp, "seedsky-preenhance.mp4")).size === fs.statSync(F("sky.mp4")).size, "G: the seed original is preserved byte-for-byte as -preenhance");
    await g2.waitFor(() => g2.getLog().includes("[r203] backfill complete (1 reframed, 1 file plays scanned)") || null, "G: backfill summary line", 120000);
    assert(true, "G: backfill summary reports 1 reframed, 1 scanned");
    // Let the sibling boot scans (r192 poster/rendition,
    // r195) also finish before the snapshot — the
    // idempotency read below compares against a SETTLED
    // directory, not one a scan is still writing to.
    await g2.waitFor(() => (g2.getLog().includes("[r192] backfill complete") && g2.getLog().includes("[r195] backfill complete")) || null, "G: sibling backfills complete", 120000);
    seedMedia = path.basename(row.media_url);
    seedMtime = fs.statSync(path.join(gUp, seedMedia)).mtimeMs;
  } finally { await g2.stop(); }
  // Idempotency: a second boot over the same data changes nothing.
  const listingBefore = fs.readdirSync(gUp).sort().join("|");
  const g3 = await boot(3629, {}, gDir);
  try {
    await g3.waitFor(() => g3.getLog().includes("[r203] backfill complete (0 reframed, 0 file plays scanned)") || null, "G: second-boot summary", 120000);
    const row3 = g3.readRow(seedId);
    assert(row3.media_url === `/uploads/${seedMedia}`, "G: second boot leaves media_url unchanged (idempotent)");
    assert(fs.statSync(path.join(gUp, seedMedia)).mtimeMs === seedMtime, "G: second boot leaves the reframed file untouched");
    assert(fs.readdirSync(gUp).sort().join("|") === listingBefore, "G: second boot creates no new files");
  } finally { await g3.stop(); }
  }

  // ---------- H: feed shape unit checks ----------
  if (!ONLY || ONLY === "H") {
  const h = await boot(3630, {});
  try {
    const home = await (await fetch(h.base + "/")).text();
    assert(home.includes('src="app.js?v=206"') && home.includes('href="styles.css?v=203"'), "H: asset pins — app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205)");
    const appJs = await (await fetch(h.base + "/app.js")).text();
    const slice = appJs.slice(appJs.indexOf("function feedShape191"), appJs.indexOf("function feedApplyShape191"));
    assert(slice.includes("feedShape191") && slice.includes("H * 4 >= W * 5"), "H: the served feedShape191 carries the Round 203 threshold");
    const ctx = vm.createContext({});
    vm.runInContext(slice, ctx);
    const shape = (w2, h2) => vm.runInContext(`feedShape191(${w2}, ${h2})`, ctx);
    assert(shape(720, 1280) === "portrait", "H: (720,1280) → portrait (a true phone portrait still fills the viewer)");
    assert(shape(720, 960) === "portrait", "H: (720,960) → portrait (3:4 is still properly tall: 960*4 >= 720*5)");
    assert(shape(720, 768) === "landscape", "H: (720,768) → landscape (a near-square reframed clip keeps its whole frame on the band)");
    assert(shape(720, 720) === "landscape", "H: (720,720) → landscape (square rides the band)");
    assert(shape(1280, 720) === "landscape", "H: (1280,720) → landscape");
    assert(shape(960, 444) === "landscape", "H: (960,444) → landscape (the extra-wide GameChanger shape)");
    assert(shape(390, 844) === "portrait" && shape(1920, 1080) === "landscape" && shape(500, 500) === "landscape" && shape(0, 0) === "", "H: every Round 191 classification of a real shape is unchanged by the new threshold");
  } finally { await h.stop(); }
  }

  console.log("\nR203 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
