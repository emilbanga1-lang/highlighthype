// Round 186 end-to-end calibration test. Run: node test-r186.js
// Boots the server on a scratch DATA_DIR and uploads four clips:
//   1. POSITIVE — the real 2026-11-24 phone recording of a TV
//      (shaky + flickery + room around the picture). The agent
//      must enhance it: stabilize + crop + deflicker.
//   2. NEGATIVE — a synthetic "field" scene with a slow, steady
//      pan (deliberate camera motion, progressive, no flicker).
//      The agent must be a complete no-op.
//   3. GPS — a compliant H.264 carrying location metadata. The
//      stored display file must come out metadata-clean via the
//      strip remux (or an encode), with the outcome recorded.
//   4. INTERLACED — a tinterlaced control clip. idet must convict
//      it and yadif must be the applied adjustment.
// The enhancement stage is fire-and-forget, so the test polls
// highlights.enhance_json in the scratch DB until the report
// lands (the same second-connection read the Round 124 suite
// uses to seed its migration fixture). Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r186-"));
const PORT = 3491;
const base = `http://localhost:${PORT}`;
const POSITIVE = path.join(os.homedir(), "workspace/user/media_library/video/08/083f92587ddf80a3e2b6c34be32a772884d22e6c3b687a1e016802acbcf46ddc.mp4");
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
const probeOf = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const vstreamOf = (file) => probeOf(file).streams.find((s) => s.codec_type === "video");

// ---- fixtures -------------------------------------------------
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r186-fix-"));
ffgen(["-f", "lavfi", "-i", "color=c=0x2e8b2e:size=1280x720:rate=30:duration=6", "-vf", "drawbox=x=0:y=356:w=1280:h=5:color=white:t=fill,drawbox=x=637:y=0:w=5:h=720:color=white:t=fill,drawbox=x=490:y=210:w=300:h=300:color=white:t=4,drawbox=x=60:y=140:w=180:h=440:color=white:t=4,drawbox=x=1040:y=140:w=180:h=440:color=white:t=4,drawbox=x='100+90*sin(t*0.9)':y=300:w=14:h=22:color=white:t=fill,drawbox=x='880+130*cos(t*0.7)':y=420:w=14:h=22:color=black:t=fill,drawbox=x='500+200*sin(t*1.7)':y='350+60*sin(t*2.3)':w=8:h=8:color=yellow:t=fill,format=yuv420p", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", path.join(fixDir, "scene.mp4")]);
ffgen(["-i", path.join(fixDir, "scene.mp4"), "-f", "lavfi", "-i", "sine=frequency=440:duration=6", "-vf", "crop=640:360:x='300+120*(t/6)':y='180+40*(t/6)'", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", path.join(fixDir, "clean.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-metadata", "location=+40.7128-074.0060/", "-metadata", "com.apple.quicktime.location.ISO6709=+40.7128-074.0060+010.000/", path.join(fixDir, "gps.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x480:rate=60:duration=5", "-vf", "tinterlace=interleave_top,format=yuv420p", "-c:v", "libx264", "-crf", "23", "-preset", "veryfast", path.join(fixDir, "interlaced.mp4")]);

const child = spawn(process.execPath, ["server.js"], { cwd: ROOT, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, AI_VISION_API_KEY: "" }, stdio: "pipe" });
let serverLog = "";
child.stdout.on("data", (d) => { serverLog += d; });
child.stderr.on("data", (d) => { serverLog += d; });

const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
const mpUpload = async (fields, fname, ctype, bytes) => {
  const boundary = "----r186boundary";
  const parts = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
  parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
  return j("/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
};
const readRow = (id) => {
  const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
  try { return db.prepare("SELECT id, media_url, poster_url, enhance_json FROM highlights WHERE id=?").get(id); } finally { db.close(); }
};
const waitReport = async (id, timeoutMs = 240000) => {
  const t0 = Date.now();
  for (;;) {
    const row = readRow(id);
    // Round 195 note: enhance_json is shared now — the boot
    // backfill's r195 evaluation can land first on a fresh
    // upload, so "some JSON" is not yet the R186 report. The
    // agent's report is the object carrying a status.
    if (row && row.enhance_json) { const parsed = JSON.parse(row.enhance_json); if (parsed && parsed.status) return { row, report: parsed }; }
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for the r186 report on play ${id}`);
    await wait(1500);
  }
};

try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  // Wait out the boot-time Round 124 migration: on a fresh
  // DATA_DIR it scans the (empty) highlights table and sets its
  // marker. Uploading before it finishes lets the migration and
  // the upload pipeline race over the same file (observed live:
  // the migration converted the just-uploaded HEVC play itself).
  for (let i = 0; i < 100; i++) {
    try {
      const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
      const marker = db.prepare("SELECT value FROM settings WHERE key='r124_media_migration_v1'").get();
      db.close();
      if (marker) break;
    } catch {}
    await wait(200);
  }
  const FIELDS = { sport: "soccer", guardianConsent: "true", playerName: "Kid R186" };

  // 1. POSITIVE — the TV recording.
  assert(fs.existsSync(POSITIVE), "positive calibration clip exists");
  const upPos = await mpUpload({ ...FIELDS, title: "R186 Positive" }, "soccer-tv.mp4", "video/mp4", fs.readFileSync(POSITIVE));
  assert(upPos.status === 201, "positive: upload accepted (201)");
  const pos = await waitReport(upPos.body.id);
  console.log("positive report:", JSON.stringify(pos.report, null, 1));
  assert(pos.report.status === "enhanced", `positive: status enhanced (got ${pos.report.status}${pos.report.reason ? ": " + pos.report.reason : ""})`);
  assert(pos.report.applied.stabilize === true, "positive: stabilization applied");
  assert(pos.report.applied.crop === true, "positive: crop applied");
  assert(pos.report.applied.deflicker === true, "positive: deflicker applied");
  assert(pos.report.metadata_stripped === true, "positive: metadata_stripped recorded true");
  assert(pos.row.media_url.endsWith("-enhanced.mp4"), "positive: media_url points at the enhanced file");
  const outFile = path.join(tmp, "uploads", path.basename(pos.row.media_url));
  const outVs = vstreamOf(outFile);
  assert(outVs.codec_name === "h264" && outVs.pix_fmt === "yuv420p", "positive: output is H.264/yuv420p");
  assert(outVs.width >= 680 && outVs.width <= 720, `positive: output width ${outVs.width} in [680,720] (room's sides removed or kept, no more)`);
  assert(outVs.height >= 420 && outVs.height <= 640, `positive: output height ${outVs.height} in [420,640] (shelf + cabinet removed; hand-made reference crop is 1062x672 upscaled from ~708x448)`);
  const outDur = Number(probeOf(outFile).format.duration);
  assert(Math.abs(outDur - 7.44) <= 0.5, `positive: duration ${outDur.toFixed(2)}s within 0.5s of 7.44s`);
  assert(pos.report.preEnhanceFile && fs.existsSync(path.join(tmp, "uploads", pos.report.preEnhanceFile)), "positive: pre-enhancement file preserved on disk");
  assert(pos.row.poster_url && fs.existsSync(path.join(tmp, "uploads", path.basename(pos.row.poster_url))), "positive: poster regenerated and present");

  // 2. NEGATIVE — clean synthetic pan.
  const upNeg = await mpUpload({ ...FIELDS, title: "R186 Negative" }, "clean.mp4", "video/mp4", fs.readFileSync(path.join(fixDir, "clean.mp4")));
  assert(upNeg.status === 201, "negative: upload accepted (201)");
  const neg = await waitReport(upNeg.body.id);
  console.log("negative report:", JSON.stringify(neg.report, null, 1));
  assert(neg.report.status === "no-op", `negative: status no-op (got ${neg.report.status})`);
  assert(!neg.report.applied.deinterlace && !neg.report.applied.crop && !neg.report.applied.stabilize && !neg.report.applied.deflicker, "negative: nothing applied");
  assert(neg.row.media_url === upNeg.body.media_url, "negative: media_url unchanged");
  const negBase = path.basename(neg.row.media_url).replace(/\.[^.]+$/, "");
  assert(!fs.existsSync(path.join(tmp, "uploads", `${negBase}-enhanced.mp4`)) && !fs.existsSync(path.join(tmp, "uploads", `${negBase}-preenhance.mp4`)), "negative: no enhanced/preenhance files created");

  // 3. GPS — metadata strip on a compliant passthrough file.
  const upGps = await mpUpload({ ...FIELDS, title: "R186 GPS" }, "gps.mp4", "video/mp4", fs.readFileSync(path.join(fixDir, "gps.mp4")));
  assert(upGps.status === 201, "gps: upload accepted (201)");
  const gps = await waitReport(upGps.body.id);
  console.log("gps report:", JSON.stringify(gps.report, null, 1));
  assert(gps.report.metadata_stripped === true, "gps: metadata_stripped true");
  assert(gps.report.metadata_action === "remux" || gps.report.metadata_action === "encode", `gps: strip happened via remux or encode (got ${gps.report.metadata_action})`);
  const storedTags = probeOf(path.join(tmp, "uploads", path.basename(gps.row.media_url))).format.tags || {};
  assert(!Object.keys(storedTags).some((k) => /location|iso6709|xyz/i.test(k)), "gps: stored display file carries no location tags");

  // 4. INTERLACED control.
  const upInt = await mpUpload({ ...FIELDS, title: "R186 Interlaced" }, "interlaced.mp4", "video/mp4", fs.readFileSync(path.join(fixDir, "interlaced.mp4")));
  assert(upInt.status === 201, "interlaced: upload accepted (201)");
  const intR = await waitReport(upInt.body.id);
  console.log("interlaced report:", JSON.stringify(intR.report, null, 1));
  assert(intR.report.assessment.interlace && intR.report.assessment.interlace.triggered === true, "interlaced: idet convicted the control clip");
  assert(intR.report.status === "enhanced" && intR.report.applied.deinterlace === true, "interlaced: yadif applied via the enhancement encode");

  console.log("\nR186 end-to-end: ALL PASS");
} catch (e) {
  console.error(e.message);
  console.error("--- server log tail ---\n" + serverLog.slice(-3000));
  process.exitCode = 1;
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.rmSync(fixDir, { recursive: true, force: true });
}
