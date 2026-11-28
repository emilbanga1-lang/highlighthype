// Round 241 (2026-11-27) — one-time server migration for the
// R240 poster re-picks. Posters and their frame-time records
// live in the production DATA_DIR, not the repo, and there is
// no write path to production data from outside — so the
// server applies the R240 re-pick itself at boot (the R227
// backfill pattern), from the spec in the r240 deploy note:
//   play 75 (Kameron A., "Walk-off game winner") → 17.5s, via
//     enhance_json.r227time {origin:"repick-r240"}; its r209
//     kept-flat record (chosenTime null) is NOT touched.
//   play 51 (Juliana, "Caught stealing home!") → 4.0s, via
//     enhance_json.r209.chosenTime = 4.0 (superseding the R213
//     pick at 16.083) + an r241 idempotency marker.
//   A. Statics: the migration exists, is invoked in the listen
//      callback ahead of every backfill timer, writes records
//      before any grab (phase 1 has no await), grabs through
//      r124MakePoster (the pipeline's own grab shape), and the
//      client is untouched (pins still v236 / v226)
//      — →242: the client has since moved to v237 / v227;
//      this suite's §A pin assertion follows the sweep.
//   B. Seeded boot (the 2026-11-27 nightly backup's DB + the
//      two source videos + the two old posters): both records
//      land, both posters are re-grabbed byte-identical to the
//      pipeline binary's own grab and perceptually identical
//      (dHash 0) to the R240 references — the references were
//      encoded by a different ffmpeg build, so their JPEG
//      bytes differ while the frames are the same. Play 75's
//      r209 is byte-identical
//      to the seed's, play 51's r209 differs ONLY in chosenTime,
//      and /api/highlights reports poster_time 17.5 / 4.0 with
//      fresh ?v= tokens.
//   C. Second boot on the migrated data is a strict no-op:
//      poster md5s AND mtimes unchanged, enhance_json strings
//      unchanged.
//   D. Ordering proof: a boot with the R227 backfill ARMED (no
//      HH_NO_POSTERCLEAN; still unconfigured, so it can only
//      record "skipped-unconfigured") visits both plays and
//      does NOT re-pick play 75 — the recorded r227time from
//      phase 1 is what its re-pick gate sees.
//   E. Skips: a missing play and an absent source video are
//      logged and skipped; boot does not fail and nothing is
//      written for either.
// Exits non-zero on failure. No external API is ever called:
// every boot runs with an empty vision key, and the configured
// stages are stood down except where a section says otherwise.
import { execFileSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const md5 = (buf) => crypto.createHash("md5").update(buf).digest("hex");

const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");

const BACKUP = path.join(ROOT, "..", "highlighthype-backups", "nightly", "2026-11-27");
const REF_DIR = path.join(ROOT, "..", "highlighthype-deploy-r240", "posters");
const V75 = "1794695420867-8f5df70347ec-trimmed.mp4";
const V51 = "1794584938088-4c697f0da163-trimmed-upscaled.mp4";
const REF75 = md5(fs.readFileSync(path.join(REF_DIR, "poster-75.jpg")));
const REF51 = md5(fs.readFileSync(path.join(REF_DIR, "poster-51.jpg")));
assert(REF75 === "cc392777bbd99513cabdcc0098cf6c42" && REF51 === "f7aa4751a8a4adee4a8f4eaa8a0fca49", "REF: the R240 reference posters on disk match the deploy note's md5s");
// Frame fidelity, two layers. The R240 reference posters were
// encoded by a different ffmpeg build than the one the server
// pipeline resolves (r124ResolveBins → node_modules
// ffmpeg-static 7.0.2; the references came from ffmpeg 8.1.2):
// the JPEG bytes differ (139,915 vs 139,829 B; 73,414 vs
// 73,329 B) while the decoded frames are identical. So: byte
// equality is asserted against a grab made with the PIPELINE's
// own binary (deterministic — the same binary production
// runs), and frame identity against the hand-picked references
// is asserted perceptually (dHash distance 0, same dimensions).
const PIPE_FFMPEG = fs.existsSync(path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg"))
  ? path.join(ROOT, "node_modules", "ffmpeg-static", "ffmpeg") : "ffmpeg";
function pipeGrabMd5(srcAbs, t) {
  const out = path.join(fs.mkdtempSync("/tmp/hh-r241-grab-"), "grab.jpg");
  execFileSync(PIPE_FFMPEG, ["-y", "-v", "error", "-ss", String(t), "-i", srcAbs, "-frames:v", "1", "-q:v", "3", out]);
  const m = md5(fs.readFileSync(out));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return m;
}
function dhash(file) {
  const raw = execFileSync("ffmpeg", ["-v", "error", "-i", file, "-vf", "scale=9:8", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 20 });
  let bits = "";
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) bits += raw[r * 9 + c] > raw[r * 9 + c + 1] ? "1" : "0";
  return bits;
}
const dhashDist = (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++; return d; };
const PIPE75 = pipeGrabMd5(path.join(BACKUP, "uploads", V75), 17.5);
const PIPE51 = pipeGrabMd5(path.join(BACKUP, "uploads", V51), 4.0);
const DH_REF75 = dhash(path.join(REF_DIR, "poster-75.jpg"));
const DH_REF51 = dhash(path.join(REF_DIR, "poster-51.jpg"));

// ---- A. statics ----
{
  assert(home.includes('src="app.js?v=237"') && home.includes('href="styles.css?v=227"'), "A: client pins unchanged (v236 / v226) — Round 241 is server + tests only — →242: pins now v237 / v227 (Round 242)");
  const fnAt = serverJs.indexOf("async function r241RepickPosters()");
  assert(fnAt > -1 && serverJs.includes("repick-r240") && serverJs.includes("R241_REPICKS"), "A: the r241 migration, its re-pick table and the repick-r240 marker ship in server.js");
  const callAt = serverJs.indexOf("r241RepickPosters();");
  const r227TimerAt = serverJs.indexOf("r227Backfill(); }, 8000");
  assert(callAt > -1 && r227TimerAt > -1 && callAt < r227TimerAt, "A: the migration is invoked in the listen callback BEFORE the backfill timers (the R227 re-pick gate at 8s can only ever see the recorded times)");
  const phase1 = serverJs.slice(fnAt, serverJs.indexOf("// ---- Phase 2", fnAt));
  const phase1Code = phase1.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  assert(!/\bawait\b/.test(phase1Code) && phase1.includes("r241WriteEj241"), "A: phase 1 (records) contains no await — both frame-time records are durable inside the listen callback, database first");
  const phase2 = serverJs.slice(serverJs.indexOf("// ---- Phase 2", fnAt), serverJs.indexOf("server.listen", fnAt));
  assert(phase2.includes("r124MakePoster("), "A: phase 2 grabs through r124MakePoster — the pipeline's own grab (-ss before -i, -frames:v 1, -q:v 3, serialized)");
  const mig = serverJs.slice(serverJs.indexOf("const R241_REPICKS"), fnAt + phase1.length + 200);
  assert(mig.includes('ej.r227time = { t: spec.t, origin: "repick-r240"'), "A: play 75's record is the r227time slot with origin repick-r240");
  assert(mig.includes("ej.r209.chosenTime = spec.t") && mig.includes('ej.r241 = { origin: "repick-r240"'), "A: play 51's record is r209.chosenTime plus the r241 idempotency marker");
  const branch75 = mig.slice(mig.indexOf("if (spec.id === 75) {"), mig.indexOf("} else {", mig.indexOf("if (spec.id === 75) {")));
  assert(branch75.length > 100 && !branch75.includes("chosenTime"), "A: the play-75 branch never writes a chosenTime — its kept-flat r209 record is untouched by construction");
}

// ---- boot harness ----
const STAND_DOWN = {
  AI_VISION_API_KEY: "", OPENAI_API_KEY: "",
  HH_NO_WELCOME: "1", HH_NO_STREAM192: "1", HH_NO_TRIM: "1", HH_NO_UPSCALE: "1",
  HH_NO_REFRAME: "1", HH_NO_SMARTPOSTER: "1", HH_NO_POSTERCLEAN: "1",
};
function seedScratch() {
  const tmp = fs.mkdtempSync("/tmp/hh-r241-");
  fs.mkdirSync(path.join(tmp, "uploads"), { recursive: true });
  fs.copyFileSync(path.join(BACKUP, "highlighthype.db"), path.join(tmp, "highlighthype.db"));
  for (const f of [V75, V51, "poster-75.jpg", "poster-51.jpg"])
    fs.copyFileSync(path.join(BACKUP, "uploads", f), path.join(tmp, "uploads", f));
  return tmp;
}
async function boot(tmp, port, extraEnv = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, "server.js")], {
    env: { ...process.env, ...STAND_DOWN, ...extraEnv, PORT: String(port), DATA_DIR: tmp },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 60 && !up; i++) {
    try { const r = await fetch(base + "/"); up = r.status === 200; } catch { await wait(250); }
  }
  assert(up, `boot on port ${port} serves the homepage`);
  return { child, base, getLog: () => log };
}
const sql = (tmp, q) => JSON.parse(execFileSync("sqlite3", ["-readonly", "-json", "-cmd", ".timeout 5000", path.join(tmp, "highlighthype.db"), q], { encoding: "utf8" }) || "[]");
const ejOf = (tmp, id) => { const rows = sql(tmp, `SELECT enhance_json FROM highlights WHERE id=${id}`); return rows.length ? JSON.parse(rows[0].enhance_json || "{}") : null; };
async function highlights(base) { return (await (await fetch(base + "/api/highlights?division=all")).json()).highlights || []; }
async function waitFor(fn, timeoutMs, label) {
  const t0 = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error("FAIL: timed out waiting for " + label); await wait(300); }
}

// ---- B. seeded boot: the migration applies ----
const tmpB = seedScratch();
const seedEj75 = ejOf(tmpB, 75), seedEj51 = ejOf(tmpB, 51);
assert(seedEj75 && seedEj75.r209 && seedEj75.r209.chosenTime === null && !seedEj75.r227time, "B: seed sanity — play 75 is kept-flat (chosenTime null) with no r227time, exactly the production state the note describes");
assert(seedEj51 && seedEj51.r209 && seedEj51.r209.chosenTime === 16.083, "B: seed sanity — play 51 carries the R213 pick at 16.083");
const oldPoster75 = fs.statSync(path.join(tmpB, "uploads", "poster-75.jpg"));
const oldToken75 = `?v=${oldPoster75.size}-${Math.round(oldPoster75.mtimeMs)}`;
{
  const s = await boot(tmpB, 3543);
  try {
    // Wait for the FILE swap as well as the records: poster_time
    // flips in phase 1 (database first, by design), a beat before
    // the grab lands — the token assertion below must observe the
    // post-grab state.
    await waitFor(async () => md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-75.jpg"))) === PIPE75 && md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-51.jpg"))) === PIPE51 ? true : null, 30000, "both poster grabs to land");
    const board = await waitFor(async () => {
      const hs = await highlights(s.base);
      const h75 = hs.find((h) => h.id === 75), h51 = hs.find((h) => h.id === 51);
      return h75 && h51 && h75.poster_time === 17.5 && h51.poster_time === 4.0 ? { h75, h51 } : null;
    }, 30000, "the API to report the re-picked poster_times");
    assert(board.h75.poster_time === 17.5 && board.h51.poster_time === 4.0, "B: /api/highlights reports poster_time 17.5 (play 75) and 4.0 (play 51)");
    assert(board.h75.poster_url.includes("poster-75.jpg?v=") && !board.h75.poster_url.includes(oldToken75), "B: play 75's poster_url carries a FRESH ?v= token (the R232 self-busting property — the swap needs no restart)");
    assert(md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-75.jpg"))) === PIPE75, "B: poster-75.jpg is byte-identical to the pipeline binary's own grab at 17.5s");
    assert(md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-51.jpg"))) === PIPE51, "B: poster-51.jpg is byte-identical to the pipeline binary's own grab at 4.0s");
    assert(dhashDist(dhash(path.join(tmpB, "uploads", "poster-75.jpg")), DH_REF75) === 0, "B: poster-75.jpg is perceptually IDENTICAL to the R240 reference (dHash distance 0 — the same follow-through frame; only the JPEG encoder build differs)");
    assert(dhashDist(dhash(path.join(tmpB, "uploads", "poster-51.jpg")), DH_REF51) === 0, "B: poster-51.jpg is perceptually IDENTICAL to the R240 reference (dHash distance 0 — the same tag frame, no baked-in player UI)");
    const ej75 = ejOf(tmpB, 75), ej51 = ejOf(tmpB, 51);
    assert(ej75.r227time && ej75.r227time.t === 17.5 && ej75.r227time.origin === "repick-r240", "B: play 75's r227time records the re-pick (t 17.5, origin repick-r240)");
    assert(JSON.stringify(ej75.r209) === JSON.stringify(seedEj75.r209), "B: play 75's r209 kept-flat record is byte-identical to the seed's — untouched");
    assert(ej51.r209.chosenTime === 4.0 && ej51.r241 && ej51.r241.origin === "repick-r240" && ej51.r241.t === 4.0, "B: play 51's chosenTime is superseded to 4.0 and the r241 marker is written");
    const r209Rest = { ...ej51.r209 }; delete r209Rest.chosenTime;
    const seedRest = { ...seedEj51.r209 }; delete seedRest.chosenTime;
    assert(JSON.stringify(r209Rest) === JSON.stringify(seedRest), "B: play 51's r209 differs from the seed ONLY in chosenTime — the rest of the R213 record stands");
    assert(s.getLog().includes("[r241] play 75: poster re-grabbed at 17.5s") && s.getLog().includes("[r241] play 51: poster re-grabbed at 4s"), "B: the boot log records both grabs");
  } finally { s.child.kill(); }
}

// ---- C. second boot: strict no-op ----
{
  const before75 = fs.statSync(path.join(tmpB, "uploads", "poster-75.jpg"));
  const before51 = fs.statSync(path.join(tmpB, "uploads", "poster-51.jpg"));
  const ej75Before = JSON.stringify(ejOf(tmpB, 75)), ej51Before = JSON.stringify(ejOf(tmpB, 51));
  const s = await boot(tmpB, 3544);
  try {
    await wait(6000); // well past the point a wrongful re-grab (sub-second) would land
    const after75 = fs.statSync(path.join(tmpB, "uploads", "poster-75.jpg"));
    const after51 = fs.statSync(path.join(tmpB, "uploads", "poster-51.jpg"));
    assert(md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-75.jpg"))) === PIPE75 && after75.mtimeMs === before75.mtimeMs, "C: second boot does not re-grab or rewrite poster-75.jpg (md5 + mtime unchanged)");
    assert(md5(fs.readFileSync(path.join(tmpB, "uploads", "poster-51.jpg"))) === PIPE51 && after51.mtimeMs === before51.mtimeMs, "C: second boot does not re-grab or rewrite poster-51.jpg (md5 + mtime unchanged)");
    assert(JSON.stringify(ejOf(tmpB, 75)) === ej75Before && JSON.stringify(ejOf(tmpB, 51)) === ej51Before, "C: second boot rewrites neither play's enhance_json — the migration has retired itself");
    assert(!s.getLog().includes("[r241] play 75: poster re-grabbed") && !s.getLog().includes("[r241] play 51: poster re-grabbed"), "C: the second boot's log shows no r241 grabs");
  } finally { s.child.kill(); }
  fs.rmSync(tmpB, { recursive: true, force: true });
}

// ---- D. ordering proof: the R227 backfill, armed, cannot re-pick ----
{
  const tmpD = seedScratch();
  const s = await boot(tmpD, 3545, { HH_NO_POSTERCLEAN: "" }); // r227 armed but unconfigured (no vision key)
  try {
    await waitFor(async () => md5(fs.readFileSync(path.join(tmpD, "uploads", "poster-75.jpg"))) === PIPE75 ? true : null, 30000, "the r241 grab on the r227-armed boot");
    // The backfill fires at 8s; wait until it has visited BOTH plays.
    await waitFor(async () => {
      const a = ejOf(tmpD, 75), b = ejOf(tmpD, 51);
      return a && b && a.r227 && b.r227 ? true : null;
    }, 45000, "the R227 backfill to visit both plays");
    const ej75 = ejOf(tmpD, 75), ej51 = ejOf(tmpD, 51);
    assert(ej75.r227.decision === "skipped-unconfigured" && ej51.r227.decision === "skipped-unconfigured", "D: the R227 backfill visited both plays (and, unconfigured, only recorded its skip — the accepted follow-on stands down exactly as designed)");
    assert(ej75.r209.chosenTime === null && ej75.r227time && ej75.r227time.t === 17.5 && ej75.r227time.origin === "repick-r240", "D: play 75 was NOT re-picked — chosenTime is still null and the recorded frame time is still the R240 re-pick's (the phase-1 record is what the re-pick gate saw)");
    assert(md5(fs.readFileSync(path.join(tmpD, "uploads", "poster-75.jpg"))) === PIPE75 && md5(fs.readFileSync(path.join(tmpD, "uploads", "poster-51.jpg"))) === PIPE51 && dhashDist(dhash(path.join(tmpD, "uploads", "poster-75.jpg")), DH_REF75) === 0 && dhashDist(dhash(path.join(tmpD, "uploads", "poster-51.jpg")), DH_REF51) === 0, "D: both posters are still the R240 reference frames after the backfill's pass");
    assert(ej51.r209.chosenTime === 4.0, "D: play 51's chosenTime is still 4.0 after the backfill's pass");
  } finally { s.child.kill(); }
  fs.rmSync(tmpD, { recursive: true, force: true });
}

// ---- E. skips: missing play, absent video ----
{
  const tmpE = seedScratch();
  execFileSync("sqlite3", [path.join(tmpE, "highlighthype.db"), "DELETE FROM highlights WHERE id=75"]);
  fs.unlinkSync(path.join(tmpE, "uploads", V51));
  const seedEj51E = ejOf(tmpE, 51);
  const poster51Before = md5(fs.readFileSync(path.join(tmpE, "uploads", "poster-51.jpg")));
  const s = await boot(tmpE, 3546);
  try {
    await wait(3000);
    assert(s.getLog().includes("[r241] play 75: not found — R240 re-pick skipped"), "E: the missing play is logged and skipped");
    assert(s.getLog().includes("[r241] play 51: source video absent"), "E: the absent source video is logged and skipped");
    assert(JSON.stringify(ejOf(tmpE, 51)) === JSON.stringify(seedEj51E), "E: nothing is written for the skipped play (no marker, chosenTime still 16.083 — a frame time never claims a frame the poster does not show)");
    assert(md5(fs.readFileSync(path.join(tmpE, "uploads", "poster-51.jpg"))) === poster51Before, "E: the skipped play's poster file is untouched");
    const hs = await highlights(s.base);
    assert(Array.isArray(hs), "E: boot did not fail — the API serves normally after both skips");
  } finally { s.child.kill(); }
  fs.rmSync(tmpE, { recursive: true, force: true });
}

console.log("\nALL R241 CHECKS PASSED");
