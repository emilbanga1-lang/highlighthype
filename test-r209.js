// Round 209 test: bigger ranked-row previews + the smart
// poster (Emil, 2026-11-26: "On Nicholas's double, I see the
// button and the fence before I can tell where Nicholas is…
// show the swing… show the tag at home"). Run: node test-r209.js
//   A. Pins: app.js v210 / styles v206 (both files changed).
//   B. Row statics (styles.css): the →209 block gives the
//      ranked rows a ~40%-of-row thumbnail column (capped),
//      a fixed-height thumb box, the play chip pinned to the
//      thumb's bottom-right (no longer centered), and the
//      votes pill grouped inside .fame-info. Server statics:
//      the stage, its kill switch and the stamp column.
//   C. Row drive (VM, the REAL fameRowHtml134 + helpers):
//      a Month row and a Hall of Fame row both carry rank →
//      thumb (poster img + corner chip, NO <video>) → info
//      group (athlete title, sport line, votes pill INSIDE
//      .fame-info), and the tap attributes are byte-for-byte
//      the pre-209 behavior (Month: openPlay189(id, this);
//      Fame: goToPlayCard(id)).
//   D. Burst clip (near-black still head → sharp action
//      burst → black tail), uploaded: the stage re-picks the
//      poster (status "poster", method blurdetect), the
//      poster is NOT a near-black head frame, and it matches
//      the frame at the recorded chosenTime in the final
//      display file.
//   E. Flat clip (uniform full-frame motion): no decisive
//      peak → status "kept-flat", the poster stays the
//      Round 124 default-freeze poster (matches the frame
//      at ~35% of the final display file).
//   F. Photo play: never enters the stage (no stamp, no
//      r209 key, no poster_url invented).
//   G. HH_NO_SMARTPOSTER=1: the burst clip uploads, status
//      "skipped", poster stays the default-freeze poster.
//   H. Backfill: a seeded legacy burst play (with a
//      default-freeze poster already in place) is
//      re-evaluated once at boot (origin "backfill"); a
//      second boot changes nothing (poster bytes + stamp
//      hold). →213: on the backfill path the R195 trim
//      keeps a shorter lead than on the upload path, so
//      the burst fixture's two whole-frame boundary
//      spikes land inside the R213-excluded head/tail
//      zones and the in-window noise motion is not
//      decisive — the re-evaluation now lands kept-flat
//      and the poster is left untouched (the one-time
//      poster-producing re-pick is pinned by
//      test-r213.js §C instead).
// →213 (2026-11-26): D/E/H now run under the Round 213
// rules (interior candidacy window, concentration tiers,
// r213_checked_at stamped alongside r209_checked_at).
// D and E hold unchanged (on the upload path the burst
// boundary spike sits just inside the interior window;
// the flat clip is still not decisive), and the second
// boot still scans nothing because the first boot's
// evaluation stamps both columns. The Round 213
// behaviors themselves (window math, tiers, the
// one-time library re-pick, overrides) are pinned by
// test-r213.js.
// Uploads are gated on the boot backfills having finished,
// so a boot scan can never meet a fresh upload mid-chain.
// Exits non-zero on failure.
import { spawn, spawnSync, execFileSync } from "node:child_process";
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

const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r209-fix-"));
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
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('src="app.js?v=220"') && home.includes('href="styles.css?v=214"'), "A: asset pins — app.js v210 / styles v206 (Round 209; both files changed) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222)");

// ---- B. statics ----
const css209 = css.slice(css.indexOf("Round 209"));
assert(css209.includes(".fame-row{grid-template-columns:30px min(40%,260px) 1fr;"), "B: the ranked-row grid is rank · ~40% thumb (capped 260px) · info group");
assert(css209.includes(".fame-thumb134{position:relative;width:100%;height:108px;"), "B: the thumb box is full column width at a fixed 108px height, centered cover crop (.fame-thumb img keeps object-fit:cover)");
assert(css209.includes(".fame-play134{left:auto;top:auto;right:6px;bottom:6px;transform:none;"), "B: the play chip is pinned to the thumb's bottom-right corner — the centered overlay is overridden");
assert(css209.includes(".fame-info .fame-votes-pill134{display:inline-block;"), "B: the votes pill groups inside .fame-info");
assert(serverJs.includes("r209PosterAfterR203") && serverJs.includes("HH_NO_SMARTPOSTER") && serverJs.includes("ADD COLUMN r209_checked_at"), "B: the server carries the stage, its kill switch and the stamp column");
assert(serverJs.includes(".then(() => r209PosterAfterR203(id))") && serverJs.indexOf("r209PosterAfterR203(id)") > serverJs.indexOf("r203AfterR195(id)") && serverJs.indexOf("r209PosterAfterR203(id)") < serverJs.indexOf("r192StreamAfterEnhance(id)"), "B: the stage is chained after Round 203 and before the Round 192 rendition");

// ---- C. row drive (VM) ----
{
  const grab = (startNeedle, endNeedle) => appJs.slice(appJs.indexOf(startNeedle), appJs.indexOf(endNeedle, appJs.indexOf(startNeedle)));
  const line = (needle) => appJs.slice(appJs.indexOf(needle), appJs.indexOf("\n", appJs.indexOf(needle)) + 1);
  const src = [
    line("const esc ="),
    line("const cap ="),
    grab("const MOMENT_LABELS162", "function momentChip162"),
    grab("function momentChipInline162", "/* Round 105"),
    grab("function fmtCount151", "function firstNameOf"),
    appJs.slice(appJs.indexOf("function firstNameOf"), appJs.indexOf("\n", appJs.indexOf("function firstNameOf")) + 1),
    grab("function shortTitle", "/* Round 134: the FEATURED card"),
    grab("function posterUrlFor134", "/* Round 134: one Hall of Fame row"),
    grab("function fameRowHtml134", "function renderFame"),
  ].join("\n");
  const sb = { console };
  vm.createContext(sb);
  vm.runInContext(src + "\n;this.__fame = fameRowHtml134;", sb);
  const play = { id: 7, title: "Caught stealing home!", sport: "softball", voteCount: 12, viewCount: 30, media_kind: "file", mime: "video/mp4", media_url: "/uploads/v7.mp4", poster_url: "/uploads/poster-7.jpg", player_name: "Juliana Banga", moment_kind: "" };
  const month = sb.__fame(play, 1, { feed189: true });
  const fame = sb.__fame(play, 0);
  assert(month.includes('<span class="fame-rank">2</span>') && month.includes('src="/uploads/poster-7.jpg"') && month.includes("fame-play134"), "C: the Month row carries rank, the poster thumb and the play chip");
  assert(!month.includes("<video"), "C: the Month row thumb is a still poster — no <video> in the row");
  assert(month.includes('onclick="openPlay189(7, this)"'), "C: the Month row tap is unchanged — openPlay189(id, this) into the feed");
  assert(fame.includes('onclick="goToPlayCard(7)"'), "C: the Hall of Fame row tap is unchanged — goToPlayCard(id)");
  const infoAt = month.indexOf('class="fame-info"'), pillAt = month.indexOf("fame-votes-pill134");
  assert(infoAt !== -1 && pillAt > infoAt && month.includes("12 votes"), "C: the votes pill renders INSIDE .fame-info, grouped with athlete, title and sport");
  assert(month.indexOf('class="fame-rank"') < month.indexOf("fame-thumb134") && month.indexOf("fame-thumb134") < infoAt, "C: row order is rank → thumb → info group");
  assert(month.includes("Juliana · Caught stealing home!") && month.includes("Softball"), "C: athlete-led title and the sport line survive the restructure");
}

// ---- fixtures ----
// Burst: 2s near-black still head, 3s sharp testsrc2 action, 2s black tail.
ffgen(["-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-f", "lavfi", "-i", "testsrc2=size=320x240:duration=3:rate=10", "-f", "lavfi", "-i", "color=c=black:size=320x240:duration=2:rate=10", "-filter_complex", "[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]", "-map", "[v]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("burst.mp4")]);
// Flat: uniform full-frame motion for the whole clip — no peak stands out.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=10:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "veryfast", "-movflags", "+faststart", F("flat.mp4")]);
// A still photo for the photo-play upload.
ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:duration=1", "-frames:v", "1", F("photo.jpg")]);

async function boot(port, extraEnv = {}, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r209-"));
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
    const boundary = "----r209boundary";
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
  const waitStamp = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r209_checked_at ? r : null; }, what || `r209 stamp on play ${id}`);
  const waitSettled = (id, what) => waitFor(() => { const r = readRow(id); return r && r.r209_checked_at && r.stream_url && r.poster_url ? r : null; }, what || `settled chain on play ${id}`);
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, upload, readRow, waitFor, waitBootScans, waitStamp, waitSettled, stop, getLog: () => log };
}
const FIELDS = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Kid R209" };
const r209Of = (row) => { const j = JSON.parse(row.enhance_json || "{}"); return j.r209 || null; };
const ONLY = process.env.R209_ONLY || "";

try {
  // ---------- D: burst upload ----------
  if (!ONLY || ONLY === "D") {
    const a = await boot(3729, {});
    try {
      await a.waitBootScans("D: boot backfills settled");
      const upDir = path.join(a.tmp, "uploads");
      const up = await a.upload({ ...FIELDS, title: "R209 Burst" }, "burst.mp4", fs.readFileSync(F("burst.mp4")), "video/mp4");
      assert(up.status === 201, "D: the burst clip uploads (201)");
      const row = await a.waitSettled(up.body.id, "D: settled");
      const r = r209Of(row);
      console.log("D r209:", JSON.stringify(r));
      assert(r && r.status === "poster", `D: status poster (got ${r && r.status})`);
      assert(r.method === "blurdetect", `D: the sharpest candidate was picked by blurdetect (got ${r.method})`);
      assert(typeof r.peakTime === "number" && typeof r.chosenTime === "number" && Math.abs(r.chosenTime - r.peakTime) <= 1.4, `D: chosenTime ${r.chosenTime}s sits in the ±1s candidate window around the ${r.peakTime}s peak`);
      const disp = path.join(upDir, path.basename(row.media_url));
      const posterFile = path.join(upDir, path.basename(row.poster_url));
      const posterLuma = meanLuma(extractFrame(posterFile));
      assert(posterLuma > 40, `D: the re-picked poster is the bright action frame (mean luma ${posterLuma.toFixed(1)}), not the near-black head`);
      const atChosen = extractFrame(disp, r.chosenTime);
      const dChosen = meanAbsDiff(extractFrame(posterFile), atChosen);
      assert(dChosen < 12, `D: the poster matches the display file's frame at chosenTime (mean abs diff ${dChosen.toFixed(2)})`);
      const headFrame = extractFrame(disp, 0.1);
      const headLuma = meanLuma(headFrame);
      if (headLuma < 10) {
        const dHead = meanAbsDiff(extractFrame(posterFile), headFrame);
        assert(dHead > 25, `D: the poster is decisively NOT the still head frame (diff ${dHead.toFixed(2)} vs the near-black head)`);
      } else {
        console.log("D note: the chain trimmed/altered the head, so the not-the-head read is carried by the luma + chosenTime checks above");
      }
      assert(!fs.readdirSync(upDir).some((n) => n.includes(".r209tmp")), "D: no R209 temp files remain");
    } finally { await a.stop(); }
  }

  // ---------- E: flat upload ----------
  if (!ONLY || ONLY === "E") {
    const b = await boot(3730, {});
    try {
      await b.waitBootScans("E: boot backfills settled");
      const upDir = path.join(b.tmp, "uploads");
      const up = await b.upload({ ...FIELDS, title: "R209 Flat" }, "flat.mp4", fs.readFileSync(F("flat.mp4")), "video/mp4");
      assert(up.status === 201, "E: the flat clip uploads (201)");
      const row = await b.waitSettled(up.body.id, "E: settled");
      const r = r209Of(row);
      console.log("E r209:", JSON.stringify(r));
      assert(r && r.status === "kept-flat", `E: status kept-flat (got ${r && r.status}) — uniform motion has no decisive peak`);
      const disp = path.join(upDir, path.basename(row.media_url));
      const dur = vinfoOf(disp).duration;
      const dFreeze = meanAbsDiff(extractFrame(path.join(upDir, path.basename(row.poster_url))), extractFrame(disp, dur * 0.35));
      assert(dFreeze < 12, `E: the poster is still the Round 124 default-freeze poster (~35% frame; mean abs diff ${dFreeze.toFixed(2)})`);
    } finally { await b.stop(); }
  }

  // ---------- F: photo play ----------
  if (!ONLY || ONLY === "F") {
    const c = await boot(3731, {});
    try {
      await c.waitBootScans("F: boot backfills settled");
      const up = await c.upload({ ...FIELDS, title: "R209 Photo" }, "photo.jpg", fs.readFileSync(F("photo.jpg")), "image/jpeg");
      assert(up.status === 201, "F: the photo uploads (201)");
      await wait(6000);
      const row = c.readRow(up.body.id);
      assert(row && !row.r209_checked_at, "F: the photo play carries no r209 stamp — the stage never entered");
      assert(!r209Of(row), "F: the photo play carries no r209 report");
      assert(!row.poster_url, "F: no poster_url was invented for the photo play");
    } finally { await c.stop(); }
  }

  // ---------- G: kill switch ----------
  if (!ONLY || ONLY === "G") {
    const d = await boot(3732, { HH_NO_SMARTPOSTER: "1" });
    try {
      await d.waitBootScans("G: boot backfills settled (disabled)");
      const upDir = path.join(d.tmp, "uploads");
      const up = await d.upload({ ...FIELDS, title: "R209 Burst KS" }, "burst.mp4", fs.readFileSync(F("burst.mp4")), "video/mp4");
      assert(up.status === 201, "G: the burst clip uploads under the kill switch (201)");
      const row = await d.waitStamp(up.body.id, "G: stamp");
      const r = r209Of(row);
      console.log("G r209:", JSON.stringify(r));
      assert(r && r.status === "skipped" && r.reason === "HH_NO_SMARTPOSTER=1", `G: status skipped under HH_NO_SMARTPOSTER=1 (got ${r && r.status})`);
      const settled = await d.waitSettled(up.body.id, "G: settled");
      const disp = path.join(upDir, path.basename(settled.media_url));
      const dur = vinfoOf(disp).duration;
      const dFreeze = meanAbsDiff(extractFrame(path.join(upDir, path.basename(settled.poster_url))), extractFrame(disp, dur * 0.35));
      assert(dFreeze < 12, `G: the poster stays the default-freeze poster under the kill switch (mean abs diff ${dFreeze.toFixed(2)})`);
    } finally { await d.stop(); }
  }

  // ---------- H: backfill + idempotence ----------
  if (!ONLY || ONLY === "H") {
    const h1 = await boot(3733, {});
    const hDir = h1.tmp;
    await h1.stop();
    const hUp = path.join(hDir, "uploads");
    fs.mkdirSync(hUp, { recursive: true });
    fs.copyFileSync(F("burst.mp4"), path.join(hUp, "seedburst.mp4"));
    // The legacy play's existing poster: the default-freeze frame (~35% — inside the black tail of this fixture).
    execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-ss", "2.45", "-i", path.join(hUp, "seedburst.mp4"), "-frames:v", "1", "-q:v", "3", path.join(hUp, "poster-1.jpg")]);
    let seedId = 0;
    {
      const db = new DatabaseSync(path.join(hDir, "highlighthype.db"));
      const info = db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, poster_url, status, player_name, enhance_json) VALUES ('Seed Burst', 'baseball', 'file', '/uploads/seedburst.mp4', '/uploads/poster-1.jpg', 'approved', 'Seed Kid', '')").run();
      seedId = Number(info.lastInsertRowid);
      db.close();
    }
    // The seeded poster is poster-<seedId>.jpg by the app's own convention — rename to match.
    if (seedId !== 1) { fs.renameSync(path.join(hUp, "poster-1.jpg"), path.join(hUp, `poster-${seedId}.jpg`)); const db = new DatabaseSync(path.join(hDir, "highlighthype.db")); db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/poster-${seedId}.jpg`, seedId); db.close(); }
    const seedPosterBefore = fs.readFileSync(path.join(hUp, `poster-${seedId}.jpg`));
    const h2 = await boot(3734, {}, hDir);
    let stamp1 = "", posterAfter1 = null;
    try {
      const row = await h2.waitStamp(seedId, "H: seed stamp");
      const r = r209Of(row);
      console.log("H r209:", JSON.stringify(r));
      // →213: the seeded play IS re-evaluated once at boot
      // under the new rules (v 213 report, interior window
      // recorded, both stamps set) — but on this backfill
      // path the R195 trim's shorter lead puts the burst
      // fixture's two boundary spikes inside the excluded
      // head/tail zones, so the outcome is kept-flat and
      // the poster is left alone. (test-r213.js §C pins
      // the poster-producing legacy re-pick.)
      assert(r && r.status === "kept-flat" && r.origin === "backfill" && r.v === 213, `H: the seeded legacy play is re-evaluated once by the backfill under R213 (got ${r && r.status}/${r && r.origin}/v${r && r.v})`);
      assert(JSON.stringify(r.window) === "[1,2.9]", `H: the re-evaluation records the interior window [1, 2.9] of the trimmed display file (got ${JSON.stringify(r.window)})`);
      assert(row.r213_checked_at && row.r213_checked_at === row.r209_checked_at, "H: the re-evaluation stamps r213_checked_at alongside r209_checked_at");
      posterAfter1 = fs.readFileSync(path.join(hUp, `poster-${seedId}.jpg`));
      // The poster on disk is the sibling stages' default-
      // freeze poster of the final (trimmed) display file —
      // the R209 stage itself substituted nothing on
      // kept-flat. (Byte-equality with the seeded poster is
      // not the instrument here: the R186/R195 backfills
      // re-create posters for fully-unstamped legacy plays
      // as part of their own normal operation.)
      const hDisp = path.join(hUp, "seedburst-trimmed-upscaled.mp4");
      const hFreeze = meanAbsDiff(extractFrame(path.join(hUp, `poster-${seedId}.jpg`)), extractFrame(hDisp, vinfoOf(hDisp).duration * 0.35));
      assert(hFreeze < 12, `H: kept-flat leaves the poster at the pipeline default freeze of the display file (mean abs diff ${hFreeze.toFixed(2)})`);
      stamp1 = row.r209_checked_at;
      await h2.waitFor(() => h2.getLog().includes("[r209] backfill complete (0 posters re-picked, 1 file plays scanned)") || null, "H: backfill summary line", 120000);
      assert(true, "H: the backfill summary reports the 1 scanned play (0 re-picked under the new rules)");
    } finally { await h2.stop(); }
    const h3 = await boot(3735, {}, hDir);
    try {
      await h3.waitFor(() => h3.getLog().includes("[r209] backfill complete (0 posters re-picked, 0 file plays scanned)") || null, "H: second boot scans nothing", 120000);
      const row = h3.readRow(seedId);
      assert(row.r209_checked_at === stamp1, "H: the second boot leaves the stamp untouched");
      assert(fs.readFileSync(path.join(hUp, `poster-${seedId}.jpg`)).equals(posterAfter1), "H: the second boot leaves the poster bytes untouched — backfill is idempotent");
    } finally { await h3.stop(); }
  }

  console.log("\nR209 ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
