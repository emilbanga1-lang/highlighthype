// Round 213 test: smart-poster robustness (Emil, 2026-11-26,
// from the live site: R209 re-picked Juliana's "Caught
// stealing home!" poster to a garbage frame — her
// GameChanger screen recording rotates to portrait in its
// last ~2s, the app page + play-by-play text fills the
// frame, and that whole-frame lurch won the motion peak
// and the sharpness score). Run: node test-r213.js
//   A. Statics: the r213_checked_at column, the window +
//      concentration machinery, the dual stamp and the
//      either-stamp backfill selection are in server.js;
//      the client pins are UNCHANGED (app.js v212 /
//      styles v208 — this is a server-only round).
//   B. Juliana fixture (the production clip, seeded as a
//      legacy play already evaluated under the R209 rules
//      with its poster on the garbage rotation frame):
//      one boot re-picks it under R213 — status poster,
//      v 213, window ≈ [1.83, 20.17], chosenTime inside
//      the window and NOT in the final 3s — and a second
//      boot changes nothing.
//   C. Guards: a legacy burst play stamped under the old
//      rules is re-picked once (both stamps advance); the
//      Round 124 override play (id 50) is re-evaluated to
//      kept-override with its poster bytes untouched; a
//      second boot scans nothing.
//   D. Mid-clip transition (upload): teleporting-patch
//      regional action around a 1.5s full-frame page
//      takeover — tier 1 fires, ≥2 transition steps are
//      counted, and neither peakTime nor chosenTime lands
//      in the takeover zone; the poster is an action
//      frame, not the page.
//   E. Short clips (uploads): a 5s clip gets the clamped
//      window [1, 2.5]; a 3.5s clip falls back to the
//      full-range window [0, 3.5]; both evaluate cleanly.
//   F. Flat clip (uniform full-frame motion, upload):
//      still kept-flat under the new rules, window
//      [1, 1.5], poster stays the default-freeze poster.
// Uploads are gated on the boot backfills having finished,
// so a boot scan can never meet a fresh upload mid-chain.
// Exits non-zero on failure.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const JULIANA = path.join(ROOT, "../highlighthype-backups/nightly/2026-11-26/uploads/1794584938088-4c697f0da163.mp4");
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { maxBuffer: 32 * 1024 * 1024 });
const probeOf = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8" }));
const vinfoOf = (file) => { const p = probeOf(file); const v = p.streams.find((s) => s.codec_type === "video"); return { width: v.width, height: v.height, duration: Number(p.format.duration) }; };

const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r213-fix-"));
const F = (n) => path.join(fixDir, n);
let frameN = 0;
function extractFrame(file, atSec) {
  const out = F(`frame-${frameN++}.png`);
  const args = ["-nostdin", "-y", "-v", "error"];
  if (atSec !== null && atSec !== undefined) args.push("-ss", String(atSec));
  args.push("-i", file, "-frames:v", "1", out);
  execFileSync("ffmpeg", args);
  return out;
}
function yavgOf(file, vfPrefix) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "info", "-i", file, "-vf", `${vfPrefix || ""}signalstats,metadata=print:key=lavfi.signalstats.YAVG`, "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
  const m = String(r.stderr || "").match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return m ? Number(m[1]) : NaN;
}
const meanLuma = (img) => yavgOf(img, "");
function meanAbsDiff(imgA, imgB) {
  const r = spawnSync("ffmpeg", ["-nostdin", "-v", "info", "-i", imgA, "-i", imgB, "-filter_complex", "blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG", "-frames:v", "1", "-f", "null", "-"], { encoding: "utf8" });
  const m = String(r.stderr || "").match(/lavfi\.signalstats\.YAVG=([\d.]+)/);
  return m ? Number(m[1]) : NaN;
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. statics ----
assert(home.includes('src="app.js?v=215"') && home.includes('href="styles.css?v=210"'), "A: client pins unchanged — app.js v212 / styles v208 (Round 213 is server-only) — →214: pins now v213/v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215)");
assert(serverJs.includes("ADD COLUMN r213_checked_at"), "A: the r213_checked_at stamp column exists");
assert(serverJs.includes("function r213Window") && serverJs.includes("R213_TRANS_SHARE") && serverJs.includes("R213_BLOCK_FRAC"), "A: the interior-window + concentration machinery is present");
assert(serverJs.includes("r209_checked_at=?, r213_checked_at=?"), "A: an evaluation stamps r209_checked_at and r213_checked_at in the same write");
assert(serverJs.includes("r213_checked_at='' OR r213_checked_at IS NULL"), "A: the boot backfill selects on either stamp being empty (the one-time R213 re-pick)");
assert(serverJs.includes("HH_NO_SMARTPOSTER") && serverJs.includes("r209PosterAfterR203"), "A: the stage and its kill switch are intact");

// ---- fixtures ----
// Burst (mirrors test-r209): near-black head → sharp action → black tail.
ffgen(["-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-f", "lavfi", "-i", "testsrc2=size=320x240:duration=3:rate=10", "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("burst.mp4")]);
// Flat: uniform full-frame motion for the whole clip.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("flat.mp4")]);
// Regional action segment (duration T): a static busy patch on a dark
// field, teleporting between two spots at 1.1s and 2.5s — sustained
// regional action beats with quiet holds between them.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=160x120:duration=0.1", "-frames:v", "1", F("patch.png")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:duration=0.1", "-frames:v", "1", "-vf", "hflip,hue=h=120", F("page.png")]);
function segAction(name, secs) {
  ffgen(["-f", "lavfi", "-i", `color=c=0x202020:size=320x240:rate=10:duration=${secs}`, "-loop", "1", "-framerate", "10", "-i", F("patch.png"),
    "-filter_complex", "[0:v][1:v]overlay=x='if(lt(t,1.1),20,if(lt(t,2.5),140,20))':y=60[v]", "-map", "[v]", "-t", String(secs),
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", F(name)]);
}
segAction("segA1.mp4", 5);
segAction("segA2.mp4", 5.5);
// The "app page": one busy full-frame still, flipped + hue-shifted, held.
ffgen(["-loop", "1", "-framerate", "10", "-i", F("page.png"), "-t", "1.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", F("segPage.mp4")]);
// Mid-clip transition: action (0–5) → page takeover (5–6.5) → action (6.5–12).
ffgen(["-i", F("segA1.mp4"), "-i", F("segPage.mp4"), "-i", F("segA2.mp4"), "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("midtrans.mp4")]);
// Short clips for §E: the same teleporting patch at 5s; testsrc2 at 3.5s.
segAction("clip5.mp4", 5);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=3.5", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("clip35.mp4")]);

async function boot(port, extraEnv = {}, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r213-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r213boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const readRow = (id) => {
    const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
    try { return db.prepare("SELECT id, media_url, poster_url, stream_url, enhance_json, r209_checked_at, r213_checked_at FROM highlights WHERE id=?").get(id); } finally { db.close(); }
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
  const waitBootScans = (what) => waitFor(() => (log.includes("[r209] backfill complete") || log.includes("[r209] backfill disabled")) || null, what || "boot backfills settled", 120000);
  const waitStamp213 = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r213_checked_at ? r : null; }, what || `r213 stamp on play ${id}`);
  const waitSettled = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r213_checked_at && r.stream_url && r.poster_url ? r : null; }, what || `settled chain on play ${id}`);
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, upload, readRow, waitFor, waitBootScans, waitStamp213, waitSettled, stop, getLog: () => log };
}
const FIELDS = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Kid R213" };
const r209Of = (row) => { const j = JSON.parse(row.enhance_json || "{}"); return j.r209 || null; };
const OLD_STAMP = "2026-11-26T15:10:00.000Z";
const SKIP_STAMP = "2026-11-26T00:00:00.000Z";
function seedPlay(dir, { file, srcFile, posterAt, title, sport, player, enhanceJson, explicitId }) {
  const upDir = path.join(dir, "uploads");
  fs.mkdirSync(upDir, { recursive: true });
  fs.copyFileSync(srcFile, path.join(upDir, file));
  const db = new DatabaseSync(path.join(dir, "highlighthype.db"));
  let id;
  if (explicitId) {
    db.prepare("INSERT INTO highlights (id, title, sport, media_kind, media_url, poster_url, status, player_name, enhance_json, r195_checked_at, r203_checked_at, r209_checked_at) VALUES (?, ?, ?, 'file', ?, '', 'approved', ?, ?, ?, ?, ?)").run(explicitId, title, sport, `/uploads/${file}`, player, enhanceJson || "", SKIP_STAMP, SKIP_STAMP, OLD_STAMP);
    id = explicitId;
  } else {
    const info = db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, poster_url, status, player_name, enhance_json, r195_checked_at, r203_checked_at, r209_checked_at) VALUES (?, ?, 'file', ?, '', 'approved', ?, ?, ?, ?, ?)").run(title, sport, `/uploads/${file}`, player, enhanceJson || "", SKIP_STAMP, SKIP_STAMP, OLD_STAMP);
    id = Number(info.lastInsertRowid);
  }
  db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/poster-${id}.jpg`, id);
  db.close();
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-ss", String(posterAt), "-i", path.join(upDir, file), "-frames:v", "1", "-q:v", "3", path.join(upDir, `poster-${id}.jpg`)]);
  return id;
}
const ONLY = process.env.R213_ONLY || "";

try {
  // ---------- B: Juliana fixture — legacy play re-picked once ----------
  if (!ONLY || ONLY === "B") {
    assert(fs.existsSync(JULIANA), "B: the production Juliana fixture is present in the nightly backup");
    const b1 = await boot(3741, {});
    const bDir = b1.tmp;
    await b1.stop();
    const D = vinfoOf(JULIANA).duration;
    const oldReport = JSON.stringify({ r209: { at: OLD_STAMP, origin: "backfill", status: "poster", peakTime: 21.0, chosenTime: 21.2, method: "blurdetect", peak: 32.5, background: 1.64, candidates: 6, chosenBlur: 4.9, chosenLuma: 120.5, lumaGate: 42.2 } });
    const jid = seedPlay(bDir, { file: "juliana.mp4", srcFile: JULIANA, posterAt: 21.2, title: "Juliana · Caught stealing home!", sport: "softball", player: "Juliana", enhanceJson: oldReport });
    const bUp = path.join(bDir, "uploads");
    const garbagePoster = fs.readFileSync(path.join(bUp, `poster-${jid}.jpg`));
    const b2 = await boot(3742, {}, bDir);
    let stamp213 = "", posterAfter = null;
    try {
      const row = await b2.waitStamp213(jid, "B: Juliana r213 stamp");
      const r = r209Of(row);
      console.log("B r209:", JSON.stringify(r));
      assert(r && r.status === "poster" && r.origin === "backfill", `B: the legacy play is re-picked by the backfill (got ${r && r.status}/${r && r.origin})`);
      assert(r.v === 213, "B: the new report is marked v 213 (evaluated under the new rules)");
      const w0 = Math.max(1.0, 0.08 * D), w1 = D - Math.max(2.5, 0.12 * D);
      assert(Array.isArray(r.window) && Math.abs(r.window[0] - w0) < 0.06 && Math.abs(r.window[1] - w1) < 0.06, `B: the report window is the interior window [${r.window}] ≈ [${w0.toFixed(2)}, ${w1.toFixed(2)}]`);
      assert(typeof r.chosenTime === "number" && r.chosenTime >= r.window[0] && r.chosenTime <= r.window[1], `B: chosenTime ${r.chosenTime}s sits inside the interior window`);
      assert(r.chosenTime <= D - 3, `B: chosenTime ${r.chosenTime}s is NOT in the final 3s of the ${D.toFixed(2)}s clip (the rotation tail)`);
      assert(r.chosenTime >= 12, `B: chosenTime ${r.chosenTime}s lands in the steal-action zone of the clip (not the quiet early game)`);
      posterAfter = fs.readFileSync(path.join(bUp, `poster-${jid}.jpg`));
      assert(!posterAfter.equals(garbagePoster), "B: the garbage rotation-frame poster was replaced");
      stamp213 = row.r213_checked_at;
      assert(row.r209_checked_at > OLD_STAMP, "B: the r209 stamp advanced alongside the r213 stamp");
    } finally { await b2.stop(); }
    const b3 = await boot(3743, {}, bDir);
    try {
      await b3.waitFor(() => b3.getLog().includes("[r209] backfill complete (0 posters re-picked, 0 file plays scanned)") || null, "B: second boot scans nothing", 120000);
      const row = b3.readRow(jid);
      assert(row.r213_checked_at === stamp213, "B: the second boot leaves both stamps untouched — the re-pick happened exactly once");
      assert(fs.readFileSync(path.join(bUp, `poster-${jid}.jpg`)).equals(posterAfter), "B: the second boot leaves the poster bytes untouched");
    } finally { await b3.stop(); }
  }

  // ---------- C: guards — legacy re-pick + override ----------
  if (!ONLY || ONLY === "C") {
    const c1 = await boot(3744, {});
    const cDir = c1.tmp;
    await c1.stop();
    const legacyId = seedPlay(cDir, { file: "legacyburst.mp4", srcFile: F("burst.mp4"), posterAt: 6.5, title: "Legacy Burst", sport: "baseball", player: "Legacy Kid", enhanceJson: JSON.stringify({ r209: { at: OLD_STAMP, origin: "backfill", status: "poster", peakTime: 2.2, chosenTime: 2.2, method: "blurdetect", peak: 47.7, background: 7.5, candidates: 6 } }) });
    const overrideId = seedPlay(cDir, { file: "overrideburst.mp4", srcFile: F("burst.mp4"), posterAt: 0.5, title: "Override Burst", sport: "baseball", player: "Override Kid", enhanceJson: "", explicitId: 50 });
    assert(overrideId === 50, "C: the override play is seeded at id 50 (the Round 124 freeze-override id)");
    const cUp = path.join(cDir, "uploads");
    const overridePosterBefore = fs.readFileSync(path.join(cUp, "poster-50.jpg"));
    const c2 = await boot(3745, {}, cDir);
    try {
      const lrow = await c2.waitStamp213(legacyId, "C: legacy r213 stamp");
      const lr = r209Of(lrow);
      console.log("C legacy r209:", JSON.stringify(lr));
      assert(lr && lr.status === "poster" && lr.v === 213 && lr.origin === "backfill", `C: the old-rules play is re-picked once under R213 (got ${lr && lr.status}, v ${lr && lr.v})`);
      assert(Array.isArray(lr.window) && Math.abs(lr.window[0] - 1) < 0.06 && Math.abs(lr.window[1] - 4.5) < 0.06, `C: the burst clip's window is [1, 4.5] (got [${lr.window}])`);
      assert(meanLuma(extractFrame(path.join(cUp, `poster-${legacyId}.jpg`))) > 40, "C: the re-picked legacy poster is the bright action frame, not the black tail frame it replaced");
      const orow = await c2.waitStamp213(overrideId, "C: override r213 stamp");
      const orr = r209Of(orow);
      console.log("C override r209:", JSON.stringify(orr));
      assert(orr && orr.status === "kept-override" && orr.chosenTime === 1.5 && orr.method === "freeze-override", `C: the override play is re-evaluated to kept-override at its hand-set 1.5s (got ${orr && orr.status}/${orr && orr.chosenTime})`);
      assert(fs.readFileSync(path.join(cUp, "poster-50.jpg")).equals(overridePosterBefore), "C: the override play's poster bytes are untouched — never re-picked");
    } finally { await c2.stop(); }
    const c3 = await boot(3746, {}, cDir);
    try {
      await c3.waitFor(() => c3.getLog().includes("[r209] backfill complete (0 posters re-picked, 0 file plays scanned)") || null, "C: second boot scans nothing", 120000);
      assert(true, "C: the second boot is a no-op for both plays (idempotent re-pick)");
    } finally { await c3.stop(); }
  }

  // ---------- D: mid-clip transition (upload) ----------
  if (!ONLY || ONLY === "D") {
    const d = await boot(3747, {});
    try {
      await d.waitBootScans("D: boot backfills settled");
      const upDir = path.join(d.tmp, "uploads");
      const up = await d.upload({ ...FIELDS, title: "R213 MidTrans" }, "midtrans.mp4", fs.readFileSync(F("midtrans.mp4")), "video/mp4");
      assert(up.status === 201, "D: the mid-transition clip uploads (201)");
      const row = await d.waitSettled(up.body.id, "D: settled");
      const r = r209Of(row);
      console.log("D r209:", JSON.stringify(r));
      assert(r && r.status === "poster", `D: status poster (got ${r && r.status})`);
      assert(r.tier === 1, `D: tier 1 fired — the action won without the transition steps (got tier ${r.tier})`);
      assert(typeof r.transSteps === "number" && r.transSteps >= 2, `D: the two takeover cuts are counted transition-class (got ${r.transSteps})`);
      const disp = path.join(upDir, path.basename(row.media_url));
      const dur = vinfoOf(disp).duration;
      assert(Math.abs(dur - 12) < 0.2, `D: the final display file keeps the 12s timeline (got ${dur.toFixed(2)}s)`);
      assert(Array.isArray(r.window) && Math.abs(r.window[0] - 1) < 0.06 && Math.abs(r.window[1] - 9.5) < 0.06, `D: the window is [1, 9.5] (got [${r.window}])`);
      const inPageZone = (t) => t >= 4.95 && t <= 6.55;
      assert(!inPageZone(r.peakTime), `D: peakTime ${r.peakTime}s is not in the page-takeover zone (5.0–6.5s)`);
      assert(!inPageZone(r.chosenTime), `D: chosenTime ${r.chosenTime}s is not in the page-takeover zone (5.0–6.5s)`);
      assert(r.chosenTime >= r.window[0] && r.chosenTime <= r.window[1], `D: chosenTime ${r.chosenTime}s sits inside the interior window`);
      const posterFile = path.join(upDir, path.basename(row.poster_url));
      const dChosen = meanAbsDiff(extractFrame(posterFile), extractFrame(disp, r.chosenTime));
      assert(dChosen < 12, `D: the poster matches the display file's frame at chosenTime (mean abs diff ${dChosen.toFixed(2)})`);
      const dPage = meanAbsDiff(extractFrame(posterFile), extractFrame(disp, 5.7));
      assert(dPage > 25, `D: the poster is decisively NOT the takeover page's frame (diff ${dPage.toFixed(2)})`);
    } finally { await d.stop(); }
  }

  // ---------- E: short clips ----------
  if (!ONLY || ONLY === "E") {
    const e = await boot(3748, {});
    try {
      await e.waitBootScans("E: boot backfills settled");
      const upDir = path.join(e.tmp, "uploads");
      const up1 = await e.upload({ ...FIELDS, title: "R213 Clip5" }, "clip5.mp4", fs.readFileSync(F("clip5.mp4")), "video/mp4");
      assert(up1.status === 201, "E: the 5s clip uploads (201)");
      const row1 = await e.waitSettled(up1.body.id, "E: 5s settled");
      const r1 = r209Of(row1);
      console.log("E clip5 r209:", JSON.stringify(r1));
      const dur1 = vinfoOf(path.join(upDir, path.basename(row1.media_url))).duration;
      assert(Math.abs(dur1 - 5) < 0.15, `E: the 5s clip's final display duration is ~5s (got ${dur1.toFixed(2)}s)`);
      assert(r1 && Array.isArray(r1.window) && Math.abs(r1.window[0] - 1) < 0.06 && Math.abs(r1.window[1] - 2.5) < 0.06, `E: the 5s clip's window clamps to [1, 2.5] (got [${r1 && r1.window}])`);
      assert(r1.status === "poster" || r1.status === "kept-flat", `E: the 5s clip evaluates cleanly (got ${r1.status})`);
      if (r1.status === "poster") assert(r1.chosenTime >= r1.window[0] && r1.chosenTime <= r1.window[1], `E: the 5s clip's chosenTime ${r1.chosenTime}s sits inside its clamped window`);
      const up2 = await e.upload({ ...FIELDS, title: "R213 Clip35" }, "clip35.mp4", fs.readFileSync(F("clip35.mp4")), "video/mp4");
      assert(up2.status === 201, "E: the 3.5s clip uploads (201)");
      const row2 = await e.waitSettled(up2.body.id, "E: 3.5s settled");
      const r2 = r209Of(row2);
      console.log("E clip35 r209:", JSON.stringify(r2));
      const dur2 = vinfoOf(path.join(upDir, path.basename(row2.media_url))).duration;
      assert(Math.abs(dur2 - 3.5) < 0.15, `E: the 3.5s clip's final display duration is ~3.5s (got ${dur2.toFixed(2)}s)`);
      assert(r2 && Array.isArray(r2.window) && Math.abs(r2.window[0] - 0) < 0.06 && Math.abs(r2.window[1] - 3.5) < 0.06, `E: the 3.5s clip falls back to the full-range window [0, 3.5] (got [${r2 && r2.window}])`);
      assert(r2.status === "poster" || r2.status === "kept-flat", `E: the 3.5s clip evaluates cleanly under the fallback (got ${r2.status})`);
    } finally { await e.stop(); }
  }

  // ---------- F: flat clip stays kept-flat ----------
  if (!ONLY || ONLY === "F") {
    const f = await boot(3749, {});
    try {
      await f.waitBootScans("F: boot backfills settled");
      const upDir = path.join(f.tmp, "uploads");
      const up = await f.upload({ ...FIELDS, title: "R213 Flat" }, "flat.mp4", fs.readFileSync(F("flat.mp4")), "video/mp4");
      assert(up.status === 201, "F: the flat clip uploads (201)");
      const row = await f.waitSettled(up.body.id, "F: settled");
      const r = r209Of(row);
      console.log("F r209:", JSON.stringify(r));
      assert(r && r.status === "kept-flat", `F: status kept-flat under the new rules (got ${r && r.status}) — uniform motion has no decisive peak`);
      assert(Array.isArray(r.window) && Math.abs(r.window[0] - 1) < 0.06 && Math.abs(r.window[1] - 1.5) < 0.06, `F: the 4s clip's window is [1, 1.5] (got [${r.window}])`);
      const disp = path.join(upDir, path.basename(row.media_url));
      const dur = vinfoOf(disp).duration;
      const dFreeze = meanAbsDiff(extractFrame(path.join(upDir, path.basename(row.poster_url))), extractFrame(disp, dur * 0.35));
      assert(dFreeze < 12, `F: the poster is still the Round 124 default-freeze poster (~35% frame; mean abs diff ${dFreeze.toFixed(2)})`);
    } finally { await f.stop(); }
  }

  console.log("\nR213 ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
