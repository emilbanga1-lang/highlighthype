// Round 195 test: head trim + sub-720 upscale in the upload
// enhancement chain (Emil's dead-air report, 2026-11-25).
// Run: node test-r195.js
// Boots the server on scratch DATA_DIRs:
//   A. Trim decisions on uploads: (a) ~3s still head + motion
//      → trimmed to a ~0.4s lead, report fields recorded, the
//      true original preserved as -preenhance, poster +
//      rendition made from the TRIMMED file; (b) ~1s still
//      head → no trim; (c) ~8s still head → flagged, no trim;
//      (d) motion from frame one → no trim.
//   B. Upscale decisions on uploads: 640x360 → 1280x720 (x2);
//      960x444 → smaller dim 720 (x1.622); 720x1280 portrait →
//      untouched (exactly at the line); 576x1024 portrait →
//      720x1280 (x1.25); (g) a photo upload is left alone.
//   C. HH_NO_TRIM=1: the 3s-still fixture is NOT trimmed and
//      the rest of the chain (report, poster, rendition) is
//      intact.
//   D. HH_NO_UPSCALE=1: the 640x360 fixture stays 640x360 and
//      the rest of the chain is intact.
//   E. Backfill: seeded legacy plays are evaluated once at
//      boot — a 640x360 clip with a 3s still head gets trim +
//      upscale in ONE pass; a 320x240 clip upscales at the 2x
//      cap (capped noted); an already-trimmed play (recorded
//      outcome, empty stamp) is NOT re-trimmed; a second boot
//      changes nothing (idempotent).
// The trim fixtures are 1280x720 so the upscale stage stays
// out of Boot A (and vice versa: the upscale fixtures move
// from frame one so the trim stage stays out of Boot B).
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { maxBuffer: 32 * 1024 * 1024 });
const probeOf = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const vinfoOf = (file) => { const p = probeOf(file); const v = p.streams.find((s) => s.codec_type === "video"); return { width: v.width, height: v.height, duration: Number(p.format.duration) }; };

// ---- fixtures -------------------------------------------------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r195-fix-"));
const F = (n) => path.join(fixDir, n);
// Motion sources (testsrc2 moves every frame — freezedetect
// can never call it still).
ffgen(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("motion720.mp4")]);
ffgen(["-i", F("motion720.mp4"), "-ss", "1", "-frames:v", "1", F("frame720.png")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("motion360.mp4")]);
ffgen(["-i", F("motion360.mp4"), "-ss", "1", "-frames:v", "1", F("frame360.png")]);
// still+motion: a looped single frame (bit-identical frames =
// a true freeze) followed by the moving clip, with audio.
const stillMotion = (framePng, motion, stillSec, motionSec, out) => {
  ffgen(["-loop", "1", "-t", String(stillSec), "-i", framePng, "-i", motion, "-f", "lavfi", "-i", `sine=frequency=440:duration=${stillSec + motionSec}`,
    "-filter_complex", "[0:v]fps=30,format=yuv420p[sv];[1:v]fps=30,format=yuv420p[mv];[sv][mv]concat=n=2:v=1:a=0[v]",
    "-map", "[v]", "-map", "2:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", out]);
};
stillMotion(F("frame720.png"), F("motion720.mp4"), 3, 3, F("still3.mp4"));   // (a) 6s, onset ~3.0
stillMotion(F("frame720.png"), F("motion720.mp4"), 1, 3, F("still1.mp4"));   // (b) 4s, onset ~1.0
stillMotion(F("frame720.png"), F("motion720.mp4"), 8, 2.5, F("still8.mp4")); // (c) 10.5s, onset ~8.0
stillMotion(F("frame360.png"), F("motion360.mp4"), 3, 3, F("combo360.mp4")); // (E) 640x360, onset ~3.0
ffgen(["-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=4", "-f", "lavfi", "-i", "sine=frequency=440:duration=4", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart", F("motionOnly.mp4")]); // (d)
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("up640.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=960x444:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("up960.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=720x1280:rate=30:duration=2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("port720.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=576x1024:rate=30:duration=2.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("port576.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("legacy240.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:duration=0.1", "-frames:v", "1", "-q:v", "3", F("photo.jpg")]);

async function boot(port, extraEnv, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r195-"));
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
    const boundary = "----r195boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const readRow = (id) => {
    const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
    try { return db.prepare("SELECT id, media_url, poster_url, stream_url, enhance_json, r195_checked_at FROM highlights WHERE id=?").get(id); } finally { db.close(); }
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
  const waitStamp = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r195_checked_at ? r : null; }, what || `r195 stamp on play ${id}`);
  // For uploads: wait for the SETTLED row — stamp set AND
  // enhance_json carrying both the Round 186 report and the
  // r195 evaluation. The boot backfill can legitimately
  // evaluate a fresh upload before its own chain finishes, and
  // the chain's r186 store (a blind replace) can briefly cover
  // the backfill's r195 key; the chain's r195 store lands last,
  // so the settled state is the only stable read.
  const waitSettled = (id, what) => waitFor(() => {
    const r = readRow(id);
    if (!r || !r.r195_checked_at || !r.enhance_json) return null;
    try { const j = JSON.parse(r.enhance_json); return j.status && j.r195 ? r : null; } catch { return null; }
  }, what || `settled r195 state on play ${id}`);
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, upload, readRow, waitFor, waitStamp, waitSettled, stop, getLog: () => log };
}
const FIELDS = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Kid R195" };
const r195Of = (row) => { const j = JSON.parse(row.enhance_json || "{}"); return j.r195 || null; };

const ONLY = process.env.R195_ONLY || "";
try {
  // ---------- Boot A: trim decisions ----------
  if (!ONLY || ONLY === "A") {
  const a = await boot(3521, {});
  try {
    const upDir = path.join(a.tmp, "uploads");
    const ids = {};
    for (const [key, file, title] of [["a", "still3.mp4", "R195 A Trim"], ["b", "still1.mp4", "R195 B Short"], ["c", "still8.mp4", "R195 C Flag"], ["d", "motionOnly.mp4", "R195 D Motion"]]) {
      const up = await a.upload({ ...FIELDS, title }, file, fs.readFileSync(F(file)), "video/mp4");
      assert(up.status === 201, `A(${key}): upload accepted (201)`);
      ids[key] = up.body.id;
    }
    // (a) 3s still head → trimmed to the 0.4s lead.
    const rowA = await a.waitSettled(ids.a, "A(a): settled");
    const rA = r195Of(rowA);
    console.log("A(a) r195:", JSON.stringify(rA));
    assert(rA && rA.trim.status === "trimmed", `A(a): trim status trimmed (got ${rA && rA.trim.status})`);
    // The trim measures the post-R186 display file: testsrc2
    // trips the agent's shake/flicker, and the stabilization
    // pass softens the last ~0.3s of the still, so the onset
    // reads ~2.7s against the fixture's true 3.0s boundary —
    // the conservative direction, inside a ±0.5s window.
    assert(rA.trim.onsetSec >= 2.5 && rA.trim.onsetSec <= 3.5, `A(a): onset ${rA.trim.onsetSec}s ≈ 3.0s`);
    assert(rA.trim.trimmedSec >= 2.1 && rA.trim.trimmedSec <= 3.1, `A(a): trimmed ${rA.trim.trimmedSec}s ≈ 2.6s (onset − 0.4s lead)`);
    assert(rowA.media_url.includes("-trimmed"), `A(a): media_url names the trimmed file (${rowA.media_url})`);
    const outA = vinfoOf(path.join(upDir, path.basename(rowA.media_url)));
    assert(Math.abs(outA.duration - 3.4) <= 0.75, `A(a): output duration ${outA.duration.toFixed(2)}s ≈ 3.4s (6.0 − 2.6)`);
    assert(Math.abs(rA.trim.outputDuration - outA.duration) <= 0.1, "A(a): report outputDuration matches the file");
    assert(rA.preEnhanceFile && fs.existsSync(path.join(upDir, rA.preEnhanceFile)), "A(a): the file R195 displaced is preserved on disk");
    const trueOrigA = JSON.parse(rowA.enhance_json).preEnhanceFile || rA.preEnhanceFile;
    assert(fs.statSync(path.join(upDir, trueOrigA)).size === fs.statSync(F("still3.mp4")).size, "A(a): the TRUE original survives the whole chain byte-for-byte (the chain's first -preenhance file)");
    assert(JSON.parse(rowA.enhance_json).status, "A(a): the Round 186 report survives alongside r195 in enhance_json");
    assert(rowA.poster_url && fs.existsSync(path.join(upDir, path.basename(rowA.poster_url))), "A(a): poster regenerated from the trimmed file");
    const settledA = await a.waitFor(() => { const r = a.readRow(ids.a); return r && r.stream_url ? r : null; }, "A(a): rendition settles");
    const streamA = vinfoOf(path.join(upDir, path.basename(settledA.stream_url)));
    assert(Math.abs(streamA.duration - outA.duration) <= 0.75, `A(a): rendition duration ${streamA.duration.toFixed(2)}s matches the trimmed master (rendition inherited the trim)`);

    // (b) 1s still head → no trim.
    const rowB = await a.waitSettled(ids.b, "A(b): settled");
    const rB = r195Of(rowB);
    console.log("A(b) r195:", JSON.stringify(rB.trim));
    assert(rB.trim.status === "no-trim" && rB.trim.headStillSec < 1.5, `A(b): no-trim with headStill ${rB.trim.headStillSec}s < 1.5s`);
    assert(!rowB.media_url.includes("-trimmed"), "A(b): media_url carries no trimmed file");

    // (c) 8s still head → flagged, no trim.
    const rowC = await a.waitSettled(ids.c, "A(c): settled");
    const rC = r195Of(rowC);
    console.log("A(c) r195:", JSON.stringify(rC.trim));
    assert(rC.trim.status === "flagged" && rC.trim.headStillSec > 6, `A(c): flagged with headStill ${rC.trim.headStillSec}s > 6s cap`);
    assert(!rowC.media_url.includes("-trimmed"), "A(c): a flagged play is NOT trimmed");

    // (d) motion from frame one → no trim.
    const rowD = await a.waitSettled(ids.d, "A(d): settled");
    const rD = r195Of(rowD);
    console.log("A(d) r195:", JSON.stringify(rD.trim));
    assert(rD.trim.status === "no-trim" && rD.trim.headStillSec === 0, "A(d): motion from frame one reads headStill 0, no trim");
    assert(!rowD.media_url.includes("-trimmed"), "A(d): media_url carries no trimmed file");
  } finally { await a.stop(); }
  }

  // ---------- Boot B: upscale decisions + photo ----------
  if (!ONLY || ONLY === "B") {
  const b = await boot(3522, {});
  try {
    const upDir = path.join(b.tmp, "uploads");
    const ids = {};
    for (const [key, file, title] of [["u640", "up640.mp4", "R195 U640"], ["u960", "up960.mp4", "R195 U960"], ["p720", "port720.mp4", "R195 P720"], ["p576", "port576.mp4", "R195 P576"]]) {
      const up = await b.upload({ ...FIELDS, title }, file, fs.readFileSync(F(file)), "video/mp4");
      assert(up.status === 201, `B(${key}): upload accepted (201)`);
      ids[key] = up.body.id;
    }
    const photoUp = await b.upload({ ...FIELDS, title: "R195 Photo" }, "photo.jpg", fs.readFileSync(F("photo.jpg")), "image/jpeg");
    assert(photoUp.status === 201, "B(g): photo upload accepted (201)");

    const rowU = await b.waitSettled(ids.u640, "B(u640): settled");
    const rU = r195Of(rowU);
    console.log("B(u640) r195:", JSON.stringify(rU.upscale));
    assert(rU.upscale.status === "upscaled" && rU.upscale.factor === 2 && rU.upscale.capped === false, "B(u640): upscaled at exactly x2, not capped");
    assert(rU.upscale.sourceWidth === 640 && rU.upscale.sourceHeight === 360 && rU.upscale.outputWidth === 1280 && rU.upscale.outputHeight === 720, "B(u640): report records 640x360 → 1280x720");
    const dimsU = vinfoOf(path.join(upDir, path.basename(rowU.media_url)));
    assert(dimsU.width === 1280 && dimsU.height === 720, `B(u640): file is 1280x720 (got ${dimsU.width}x${dimsU.height})`);
    assert(rowU.media_url.includes("-upscaled"), "B(u640): media_url names the upscaled file");
    const trueOrigU = JSON.parse(rowU.enhance_json).preEnhanceFile || rU.preEnhanceFile;
    assert(trueOrigU && fs.statSync(path.join(upDir, trueOrigU)).size === fs.statSync(F("up640.mp4")).size, "B(u640): true original preserved byte-for-byte (the chain's first -preenhance file)");

    const row9 = await b.waitSettled(ids.u960, "B(u960): settled");
    const r9 = r195Of(row9);
    console.log("B(u960) r195:", JSON.stringify(r9.upscale));
    const dims9 = vinfoOf(path.join(upDir, path.basename(row9.media_url)));
    assert(r9.upscale.status === "upscaled" && Math.abs(r9.upscale.factor - 1.622) < 0.01 && r9.upscale.capped === false, `B(u960): upscaled x${r9.upscale.factor} ≈ 1.622`);
    assert(dims9.height === 720 && Math.abs(dims9.width - 1556) <= 4, `B(u960): file is ${dims9.width}x${dims9.height} — smaller dimension is 720, aspect preserved`);

    const rowP7 = await b.waitSettled(ids.p720, "B(p720): settled");
    const rP7 = r195Of(rowP7);
    console.log("B(p720) r195:", JSON.stringify(rP7.upscale));
    assert(rP7.upscale.status === "not-needed", "B(p720): a 720x1280 portrait (smaller dim exactly 720) is NOT upscaled");
    assert(!rowP7.media_url.includes("-upscaled"), "B(p720): media_url carries no upscaled file");
    const dimsP7 = vinfoOf(path.join(upDir, path.basename(rowP7.media_url)));
    assert(dimsP7.width === 720 && dimsP7.height === 1280, "B(p720): file stays 720x1280");

    const rowP5 = await b.waitSettled(ids.p576, "B(p576): settled");
    const rP5 = r195Of(rowP5);
    console.log("B(p576) r195:", JSON.stringify(rP5.upscale));
    const dimsP5 = vinfoOf(path.join(upDir, path.basename(rowP5.media_url)));
    assert(rP5.upscale.status === "upscaled" && Math.abs(rP5.upscale.factor - 1.25) < 0.01, "B(p576): 576x1024 portrait upscales at x1.25");
    assert(dimsP5.width === 720 && dimsP5.height === 1280, `B(p576): file is 720x1280 (got ${dimsP5.width}x${dimsP5.height})`);

    // (g) the photo is left alone.
    await wait(6000); // let the boot backfill pass over the photo too
    const rowPh = b.readRow(photoUp.body.id);
    assert(rowPh.media_url === photoUp.body.media_url, "B(g): photo media_url unchanged");
    assert(rowPh.poster_url === "" || rowPh.poster_url === null, "B(g): photo gains no poster");
    const photoBase = path.basename(rowPh.media_url).replace(/\.[^.]+$/, "");
    assert(!fs.readdirSync(upDir).some((n) => n.startsWith(photoBase) && (n.includes("-trimmed") || n.includes("-upscaled"))), "B(g): no trimmed/upscaled derivative of the photo exists");
  } finally { await b.stop(); }
  }

  // ---------- Boot C: HH_NO_TRIM=1 ----------
  if (!ONLY || ONLY === "C") {
  const c = await boot(3523, { HH_NO_TRIM: "1" });
  try {
    const up = await c.upload({ ...FIELDS, title: "R195 C NoTrim" }, "still3.mp4", fs.readFileSync(F("still3.mp4")), "video/mp4");
    assert(up.status === 201, "C: upload accepted (201)");
    const row = await c.waitSettled(up.body.id, "C: settled");
    const r = r195Of(row);
    console.log("C r195:", JSON.stringify(r.trim));
    assert(r.trim.status === "skipped" && /HH_NO_TRIM/.test(r.trim.reason || ""), "C(e): trim stage skipped under HH_NO_TRIM=1");
    assert(!row.media_url.includes("-trimmed"), "C(e): the 3s-still clip is NOT trimmed under the kill switch");
    const dimsC = vinfoOf(path.join(c.tmp, "uploads", path.basename(row.media_url)));
    assert(Math.abs(dimsC.duration - 6.0) <= 0.5, `C(e): the display file keeps its full 6.0s (got ${dimsC.duration.toFixed(2)}s)`);
    const settled = await c.waitFor(() => { const x = c.readRow(up.body.id); return x && x.stream_url && x.poster_url ? x : null; }, "C: chain settles (poster + rendition)");
    assert(settled.poster_url && settled.stream_url, "C(e): rest of the chain intact — poster and rendition still made");
    assert(JSON.parse(settled.enhance_json).status, "C(e): the Round 186 report is intact alongside r195");
  } finally { await c.stop(); }
  }

  // ---------- Boot D: HH_NO_UPSCALE=1 ----------
  if (!ONLY || ONLY === "D") {
  const d = await boot(3524, { HH_NO_UPSCALE: "1" });
  try {
    const upDir = path.join(d.tmp, "uploads");
    const up = await d.upload({ ...FIELDS, title: "R195 D NoUpscale" }, "up640.mp4", fs.readFileSync(F("up640.mp4")), "video/mp4");
    assert(up.status === 201, "D: upload accepted (201)");
    const row = await d.waitSettled(up.body.id, "D: settled");
    const r = r195Of(row);
    console.log("D r195:", JSON.stringify(r.upscale));
    assert(r.upscale.status === "skipped" && /HH_NO_UPSCALE/.test(r.upscale.reason || ""), "D: upscale stage skipped under HH_NO_UPSCALE=1");
    assert(!row.media_url.includes("-upscaled"), "D: no upscaled file under the kill switch");
    const dims = vinfoOf(path.join(upDir, path.basename(row.media_url)));
    assert(dims.width === 640 && dims.height === 360, `D: file stays 640x360 (got ${dims.width}x${dims.height})`);
    const settled = await d.waitFor(() => { const x = d.readRow(up.body.id); return x && x.poster_url ? x : null; }, "D: chain settles (poster)");
    assert(settled.poster_url && JSON.parse(settled.enhance_json).status, "D: rest of the chain intact — poster made, Round 186 report present");
  } finally { await d.stop(); }
  }

  // ---------- Boot E: backfill ----------
  if (!ONLY || ONLY === "E") {
  const e1 = await boot(3525, {});
  const eDir = e1.tmp;
  await e1.stop();
  const eUp = path.join(eDir, "uploads");
  fs.mkdirSync(eUp, { recursive: true });
  fs.copyFileSync(F("combo360.mp4"), path.join(eUp, "seedcombo.mp4"));
  fs.copyFileSync(F("legacy240.mp4"), path.join(eUp, "seedlegacy.mp4"));
  fs.copyFileSync(F("motion720.mp4"), path.join(eUp, "seedalready-trimmed.mp4"));
  const alreadyJson = JSON.stringify({ round: 186, status: "no-op", r195: { at: "2026-11-25T00:00:00.000Z", origin: "upload", trim: { status: "trimmed", headStillSec: 3.0, onsetSec: 3.0, trimmedSec: 2.6, leadKeptSec: 0.4, sourceDuration: 6.0 }, upscale: { status: "not-needed", sourceWidth: 1280, sourceHeight: 720 }, preEnhanceFile: "seedalready-preenhance.mp4" } });
  const alreadyBytes = fs.statSync(path.join(eUp, "seedalready-trimmed.mp4")).size;
  {
    const db = new DatabaseSync(path.join(eDir, "highlighthype.db"));
    db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, status, player_name, enhance_json) VALUES ('Seed Combo', 'baseball', 'file', '/uploads/seedcombo.mp4', 'approved', 'Seed Kid', '')").run();
    db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, status, player_name, enhance_json) VALUES ('Seed Legacy', 'baseball', 'file', '/uploads/seedlegacy.mp4', 'approved', 'Seed Kid', '')").run();
    db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, status, player_name, enhance_json) VALUES ('Seed Already', 'baseball', 'file', '/uploads/seedalready-trimmed.mp4', 'approved', 'Seed Kid', ?)").run(alreadyJson);
    db.close();
  }
  const seedIds = {};
  {
    const db = new DatabaseSync(path.join(eDir, "highlighthype.db"), { readOnly: true });
    for (const row of db.prepare("SELECT id, media_url FROM highlights").all()) seedIds[path.basename(row.media_url)] = row.id;
    db.close();
  }
  const e2 = await boot(3526, {}, eDir);
  let comboMedia = "", comboMtime = 0;
  try {
    const combo = await e2.waitStamp(seedIds["seedcombo.mp4"], "E: combo stamp");
    const legacy = await e2.waitStamp(seedIds["seedlegacy.mp4"], "E: legacy stamp");
    const already = await e2.waitStamp(seedIds["seedalready-trimmed.mp4"], "E: already stamp");
    const rCombo = r195Of(combo), rLegacy = r195Of(legacy), rAlready = r195Of(already);
    console.log("E combo r195:", JSON.stringify(rCombo));
    console.log("E legacy r195:", JSON.stringify(rLegacy.upscale));
    assert(rCombo.trim.status === "trimmed" && rCombo.upscale.status === "upscaled", "E(f): the seeded combo play received trim AND upscale in one backfill pass");
    assert(combo.media_url.endsWith("-trimmed-upscaled.mp4"), `E(f): one combined output file (${combo.media_url})`);
    const comboDims = vinfoOf(path.join(eUp, path.basename(combo.media_url)));
    assert(comboDims.width === 1280 && comboDims.height === 720 && Math.abs(comboDims.duration - 3.4) <= 0.75, `E(f): combo output is 1280x720, ${comboDims.duration.toFixed(2)}s ≈ 3.4s`);
    assert(rCombo.preEnhanceFile === "seedcombo-preenhance.mp4" && fs.statSync(path.join(eUp, "seedcombo-preenhance.mp4")).size === fs.statSync(F("combo360.mp4")).size, "E(f): the seed original is preserved byte-for-byte as -preenhance");
    assert(rLegacy.upscale.status === "upscaled" && rLegacy.upscale.capped === true && rLegacy.upscale.factor === 2, "E: the 320x240 legacy play upscales at the 2x cap, capped noted in the report");
    const legacyDims = vinfoOf(path.join(eUp, path.basename(legacy.media_url)));
    assert(legacyDims.width === 640 && legacyDims.height === 480, `E: legacy output is 640x480 (got ${legacyDims.width}x${legacyDims.height})`);
    assert(already.media_url === "/uploads/seedalready-trimmed.mp4" && fs.statSync(path.join(eUp, "seedalready-trimmed.mp4")).size === alreadyBytes, "E(f): the already-trimmed play is NOT re-trimmed (media + bytes unchanged)");
    assert(rAlready.trim.status === "trimmed", "E(f): the recorded trim outcome is honored, not re-decided");
    assert(!fs.readdirSync(eUp).some((n) => n.includes("seedalready-trimmed-trimmed") || n.includes("seedalready-trimmed-upscaled")), "E(f): no second-generation derivative of the already-trimmed play exists");
    await e2.waitFor(() => e2.getLog().includes("[r195] backfill complete (1 trimmed, 2 upscaled, 0 flagged, 3 file plays scanned)") || null, "E: backfill summary line", 120000);
    assert(true, "E: backfill summary reports 1 trimmed, 2 upscaled, 0 flagged, 3 scanned");
    comboMedia = path.basename(combo.media_url);
    comboMtime = fs.statSync(path.join(eUp, comboMedia)).mtimeMs;
  } finally { await e2.stop(); }

  // Idempotency: a second boot over the same data changes nothing.
  const listingBefore = fs.readdirSync(eUp).sort().join("|");
  const e3 = await boot(3527, {}, eDir);
  try {
    await e3.waitFor(() => e3.getLog().includes("[r195] backfill complete (0 trimmed, 0 upscaled, 0 flagged, 0 file plays scanned)") || null, "E: second-boot summary", 120000);
    assert(fs.statSync(path.join(eUp, comboMedia)).mtimeMs === comboMtime, "E(f): second boot leaves the trimmed/upscaled file untouched (idempotent)");
    assert(fs.readdirSync(eUp).sort().join("|") === listingBefore, "E(f): second boot creates no new files");
    assert(!fs.readdirSync(eUp).some((n) => n.includes(".r195tmp")), "E: no R195 temp files remain");
  } finally { await e3.stop(); }
  }

  console.log("\nR195 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
