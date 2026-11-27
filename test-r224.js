// Round 224 test: upload pipeline repair — the iPhone .mov
// class (2026-11-26 uploads review; play 78).
// Run: node test-r224.js
// The fixture is SYNTHESIZED to carry play 78's three traits:
// an extra audio-typed stream no decoder exists for (an mp4a
// sample entry re-typed 'zzau' with its esds objectType set to
// 0xFF), rotation metadata (-90 in the video tkhd matrix, so
// the clip is portrait via rotation), and a GPS/location tag
// in the global metadata. Boots the server on scratch
// DATA_DIRs:
//   A. Upload path — the fixture uploads and the full chain
//      processes it: the master comes back an .mp4 with no
//      location tag, the rendition is PORTRAIT (rotation-
//      corrected shape, not a stretched 1280x720), a poster
//      exists, and the owner queue does NOT flag the fresh
//      play as missing a rendition. Pins: app.js v221 /
//      styles v214.
//   B. Strip fallback — the compliant variant (same bad
//      stream + GPS, NO rotation, already H.264/faststart)
//      needs no conversion: the strip remux heals it IN
//      PLACE — same .mov filename, GPS gone, the
//      undecodable stream dropped.
//   C. Recovery — a row inserted directly in play 78's
//      state (raw .mov master, empty stream_url, all four
//      stage stamps SET, an upload-era poster + r209
//      record, created 2 days ago) fully heals at boot:
//      converted in place, rendition created, poster
//      rewritten, the r209 record re-evaluated with origin
//      'backfill' (the stamp unblocking works). A healthy
//      control play in the same rendition-less state is
//      left byte- and stamp-identical. The owner queue
//      flags the victim missing_rendition BEFORE the heal
//      lands (checked in the window before the rendition
//      can exist).
// Statics: no "0:a?" survives in server.js; the METADATA
// EXPOSURE marker exists; the r209 backfill selection
// carries the stream condition; the avatar multipart field
// choice (Round 224 scope addition: "image[]" when the
// style reference rides, plain "image" alone) is in place.
// Exits non-zero on failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const probeJson = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]).toString());
const hasLocationTag = (probe) => Object.keys((probe.format && probe.format.tags) || {}).some((k) => /location/i.test(k));

// ---- the play-78-class fixture (box-walk byte patches) ----
function* boxes224(buf, start, end) {
  let off = start;
  while (off + 8 <= end) {
    let size = buf.readUInt32BE(off);
    const type = buf.toString("latin1", off + 4, off + 8);
    let hdr = 8;
    if (size === 1) { size = Number(buf.readBigUInt64BE(off + 8)); hdr = 16; }
    else if (size === 0) { size = end - off; }
    if (size < hdr || off + size > end) return;
    yield { type, start: off, size, hdr, content: off + hdr, end: off + size };
    off += size;
  }
}
const findBox224 = (buf, start, end, type) => { for (const b of boxes224(buf, start, end)) if (b.type === type) return b; return null; };
function patch224(buf, rotate) {
  const moov = findBox224(buf, 0, buf.length, "moov");
  if (!moov) throw new Error("fixture: no moov box");
  let videoTrak = null;
  const audioTraks = [];
  for (const trak of boxes224(buf, moov.content, moov.end)) {
    if (trak.type !== "trak") continue;
    const mdia0 = findBox224(buf, trak.content, trak.end, "mdia");
    const hdlr = mdia0 ? findBox224(buf, mdia0.content, mdia0.end, "hdlr") : null;
    const handler = hdlr ? buf.toString("latin1", hdlr.start + 16, hdlr.start + 20) : "";
    if (handler === "vide") videoTrak = trak;
    else if (handler === "soun") audioTraks.push(trak);
  }
  if (!videoTrak || audioTraks.length < 2) throw new Error("fixture: unexpected trak layout");
  if (rotate) {
    // tkhd v0: the display matrix sits at box start + 48.
    const tkhd = findBox224(buf, videoTrak.content, videoTrak.end, "tkhd");
    [0, 65536, 0, -65536, 0, 0, 0, 0, 0x40000000].forEach((v, i) => buf.writeInt32BE(v, tkhd.start + 48 + i * 4));
  }
  // Second audio trak: re-type its sample entry and poison
  // its esds objectType — ffprobe then reports an audio
  // stream with NO codec, the play-78 trait.
  const trak = audioTraks[1];
  const mdia = findBox224(buf, trak.content, trak.end, "mdia");
  const minf = findBox224(buf, mdia.content, mdia.end, "minf");
  const stbl = findBox224(buf, minf.content, minf.end, "stbl");
  const stsd = findBox224(buf, stbl.content, stbl.end, "stsd");
  const entryStart = stsd.start + 16; // first entry: size at +16, type at +20
  if (buf.toString("latin1", entryStart + 4, entryStart + 8) !== "mp4a") throw new Error("fixture: second audio entry is not mp4a");
  buf.write("zzau", entryStart + 4, "latin1");
  const entrySize = buf.readUInt32BE(entryStart);
  // The esds sits inside a 'wave' wrapper in ffmpeg's mp4a
  // entries — search the entry's boxes recursively.
  const findDeep224 = (start, end) => {
    for (const b of boxes224(buf, start, end)) {
      if (b.type === "esds") return b;
      const inner = findDeep224(b.content, b.end);
      if (inner) return inner;
    }
    return null;
  };
  // Child boxes start past the fixed fields: +36 for a v0
  // sound entry, +52 for v1 (ffmpeg writes v1) — try both.
  let esds = null;
  for (const off of [36, 52]) { esds = findDeep224(entryStart + off, entryStart + entrySize); if (esds) break; }
  if (!esds) throw new Error("fixture: no esds in the second audio entry");
  let p = esds.content + 4; // version/flags
  const readLen224 = () => { let b; do { b = buf[p++]; } while (b & 0x80); };
  if (buf[p] !== 0x03) throw new Error("fixture: esds ES_Descriptor tag missing");
  p++; readLen224();
  p += 2; // ES_ID
  if (buf[p++] !== 0) throw new Error("fixture: esds flags nonzero — the walker assumes none");
  if (buf[p] !== 0x04) throw new Error("fixture: esds DecoderConfigDescriptor tag missing");
  p++; readLen224();
  buf[p] = 0xff; // objectTypeIndication — no decoder exists for 0xFF
}
function buildFixture224(dest, rotate) {
  const raw = dest + ".raw.mov";
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error",
    "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
    "-f", "lavfi", "-i", "sine=frequency=660:duration=3",
    "-map", "0:v", "-map", "1:a", "-map", "2:a", "-shortest",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
    "-metadata", "com.apple.quicktime.location.ISO6709=+40.7168-073.4500/",
    "-metadata", "creation_time=2026-11-08T15:04:05.000000Z",
    "-movflags", "+faststart+use_metadata_tags", raw]);
  const buf = fs.readFileSync(raw);
  patch224(buf, rotate);
  fs.writeFileSync(dest, buf);
  fs.unlinkSync(raw);
  return fs.readFileSync(dest);
}

const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r224-fix-"));
const FIX_ROT = buildFixture224(path.join(fixDir, "fixture-rot.mov"), true);
const FIX_FLAT = buildFixture224(path.join(fixDir, "fixture-flat.mov"), false);
// A healthy, compliant control master for Boot C.
execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3", "-f", "lavfi", "-i", "sine=frequency=440:duration=3", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "30", "-c:a", "aac", "-movflags", "+faststart", path.join(fixDir, "control.mp4")]);
const CONTROL = fs.readFileSync(path.join(fixDir, "control.mp4"));

// Fixture sanity — the traits are really there, and the old
// map really fails on this file class while the new one works.
{
  const pr = probeJson(path.join(fixDir, "fixture-rot.mov"));
  const v = pr.streams.find((s) => s.codec_type === "video");
  const bad = pr.streams[2];
  assert(pr.streams.length === 3 && v.codec_name === "h264" && v.width === 320 && v.height === 240, "fixture: video is 320x240 h264 with two audio-typed streams behind it");
  assert(bad && bad.codec_type === "audio" && !bad.codec_name, "fixture: the third stream is audio-typed with NO codec (undecodable — the play-78 trait)");
  const rot = (v.side_data_list || []).map((sd) => sd.rotation).find((r) => typeof r === "number");
  assert(rot === -90, `fixture: rotation metadata reads -90 (got ${rot})`);
  assert(hasLocationTag(pr), "fixture: the GPS/location tag is present in the global metadata");
  let oldFailed = false;
  try { execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-i", path.join(fixDir, "fixture-rot.mov"), "-map", "0:v:0", "-map", "0:a?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fixDir, "old.mp4")]); } catch { oldFailed = true; }
  assert(oldFailed, "fixture: the OLD map (-map 0:a?) aborts on this file class — the bug reproduces");
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-i", path.join(fixDir, "fixture-rot.mov"), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fixDir, "new.mp4")]);
  const pn = probeJson(path.join(fixDir, "new.mp4"));
  const vn = pn.streams.find((s) => s.codec_type === "video");
  assert(vn.width === 240 && vn.height === 320, `fixture: the NEW map (0:a:0?) converts, and the decoded output is portrait 240x320 (got ${vn.width}x${vn.height})`);
  // The trailing "?" is load-bearing: a clip with NO audio
  // stream must still convert (the Round 186 suite caught
  // the bare 0:a:0 hard-failing exactly there).
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "silent.mp4")]);
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-i", path.join(fixDir, "silent.mp4"), "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fixDir, "silent-out.mp4")]);
  assert(probeJson(path.join(fixDir, "silent-out.mp4")).streams.length === 1, "fixture: the NEW map converts a silent clip (audio absence tolerated)");
  let bareFailed = false;
  try { execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-i", path.join(fixDir, "silent.mp4"), "-map", "0:v:0", "-map", "0:a:0", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", path.join(fixDir, "silent-bare.mp4")]); } catch { bareFailed = true; }
  assert(bareFailed, "fixture: the bare 0:a:0 (no '?') hard-fails a silent clip — the '?' is required, not decoration");
}

// ---- statics ----
assert(!serverJs.includes('"0:a?"'), "statics: no \"0:a?\" greedy audio map survives anywhere in server.js");
assert((serverJs.match(/"-map", "0:a:0\?"/g) || []).length === 6, "statics: all six transcode sites carry the shipped map \"-map 0:a:0?\" (first audio stream only, absence tolerated)");
assert(serverJs.includes("[r224] METADATA EXPOSURE"), "statics: the loud metadata-exposure log marker exists");
assert(serverJs.includes("function r224Backfill(") && serverJs.includes("function r224RecoverPlay(") && serverJs.includes("function r224MissingRendition("), "statics: the Round 224 recovery + visibility helpers exist");
assert(serverJs.includes("missing_rendition: r224MissingRendition(r)"), "statics: the owner queue payload carries missing_rendition");
{
  const i = serverJs.indexOf("async function r209Backfill()");
  const slice = serverJs.slice(i, i + 1600);
  assert(slice.includes("OR stream_url='' OR stream_url IS NULL"), "statics: the r209 backfill selection treats an empty stream_url as not-yet-processed (poster purposes)");
  assert(slice.includes("!r124Compliant(abs, info)"), "statics: ...gated on the master still probing non-compliant, so healthy rendition-less plays are never re-picked");
}
assert(serverJs.includes('ref222 ? "image[]" : "image"') && serverJs.includes('form.append("image[]", new Blob([ref222]'), "statics (scope addition): the avatar request names BOTH image parts \"image[]\" when the style reference rides, and keeps the plain \"image\" field for a single-image request");
{
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  assert(appJs.includes("h.missing_rendition") && appJs.includes("⚠ No rendition"), "statics: the queue card renders the ⚠ No rendition chip from missing_rendition");
}

async function boot(port, extraEnv, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r224-"));
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
    const boundary = "----r224boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, what, timeoutMs = 180000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2500));
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
const queueRow = async (s, tok, id) => {
  const r = await s.j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  return (r.body.highlights || r.body.queue || []).find((h) => h.id === id) || null;
};
const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
const claimApprove = async (s, id) => {
  const claim = await s.j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token;
  const ap = await s.j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(ap.body.status === "approved", "play approved");
  return tok;
};

try {
  // ---------- Boot A: the upload path heals the file class ----------
  const sA = await boot(45241, {});
  try {
    const home = await (await fetch(sA.base + "/")).text();
    assert(home.includes('src="app.js?v=234"') && home.includes('href="styles.css?v=225"'), "A: asset pins — app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238)");
    const up = await sA.upload({ ...F, playerName: "Kameron A.", title: "Touchdown224" }, "fixture-rot.mov", FIX_ROT, "video/quicktime");
    assert(up.status === 201, "A: the play-78-class .mov uploads (201)");
    const id = up.body.id;
    const tok = await claimApprove(sA, id);
    const play = await sA.waitFor(async () => { const p = await boardPlay(sA, id); return p && p.stream_url && p.poster_url ? p : null; }, "A: play gains stream_url + poster_url");
    const upDir = path.join(sA.tmp, "uploads");
    const masterName = path.basename(play.media_url);
    assert(masterName.endsWith(".mp4"), `A: the master was converted in place to .mp4 (${masterName})`);
    const pm = probeJson(path.join(upDir, masterName));
    assert(!hasLocationTag(pm), "A: the served master carries NO location tag");
    // The converted original survives as the enhance stage's
    // -preenhance sibling: it must be PORTRAIT 240x320 — the
    // rotation-corrected shape. (The enhance stage may then
    // content-crop the synthetic pattern, as it would any
    // clip; what Round 224 guarantees is that every stage
    // works in display space, so the rendition must match
    // the final master's shape exactly — never the coded
    // 320x240 stretched into a landscape frame.)
    const preName = fs.readdirSync(upDir).find((n) => n.endsWith("-preenhance.mp4") && !n.includes("-enhanced-"));
    const pv = probeJson(path.join(upDir, preName)).streams.find((x) => x.codec_type === "video");
    assert(pv.width === 240 && pv.height === 320, `A: the converted original is PORTRAIT 240x320 (got ${pv.width}x${pv.height}) — rotation handled at conversion`);
    const streamName = path.basename(play.stream_url);
    const ps = probeJson(path.join(upDir, streamName));
    const vs = ps.streams.find((x) => x.codec_type === "video");
    const vm = pm.streams.find((x) => x.codec_type === "video");
    assert(Math.abs(vs.width / vs.height - vm.width / vm.height) < 0.05, `A: the rendition matches the display master's shape (${vs.width}x${vs.height} vs master ${vm.width}x${vm.height}) — no coded-dims stretch`);
    assert(!(vs.width === 1280 && vs.height === 720), "A: the rendition is NOT the stretched 1280x720 the coded dims would have produced");
    assert(!hasLocationTag(ps), "A: the rendition carries NO location tag");
    assert(fs.existsSync(path.join(upDir, path.basename(play.poster_url.split("?")[0]))), "A: the poster file exists — →232: the payload poster_url carries the cache-bust token; strip it to name the file on disk");
    const qr = await queueRow(sA, tok, id);
    assert(qr && !qr.missing_rendition, "A: the owner queue does NOT flag a fresh play as missing a rendition");
  } finally { await sA.stop(); }

  // ---------- Boot B: the strip fallback heals in place ----------
  const sB = await boot(45242, {});
  try {
    const up = await sB.upload({ ...F, playerName: "Marco B.", title: "Flat224" }, "fixture-flat.mov", FIX_FLAT, "video/quicktime");
    assert(up.status === 201, "B: the compliant variant uploads (201)");
    const id = up.body.id;
    const tok = await claimApprove(sB, id);
    const row0 = await queueRow(sB, tok, id);
    const name0 = path.basename(row0.media_url);
    assert(name0.endsWith(".mov"), `B: the compliant master keeps its .mov name at rest (${name0})`);
    const abs0 = path.join(sB.tmp, "uploads", name0);
    await sB.waitFor(async () => { try { return !hasLocationTag(probeJson(abs0)) ? true : null; } catch { return null; } }, "B: the in-place strip lands", 90000);
    const pb = probeJson(abs0);
    assert(pb.streams.length === 2, `B: the strip dropped the undecodable stream (${pb.streams.length} streams remain)`);
    const rowB = await queueRow(sB, tok, id);
    assert(path.basename(rowB.media_url) === name0, "B: the strip healed the file IN PLACE — media_url unchanged");
  } finally { await sB.stop(); }

  // ---------- Boot C: recovery of a play already in 78's state ----------
  const dirC = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r224c-"));
  const sC0 = await boot(45243, {}, dirC);
  await sC0.stop(); // schema exists; server down for direct inserts
  const upDirC = path.join(dirC, "uploads");
  fs.mkdirSync(upDirC, { recursive: true });
  const victimName = "1799999999999-victim224.mov";
  fs.writeFileSync(path.join(upDirC, victimName), FIX_ROT);
  fs.writeFileSync(path.join(upDirC, "control224.mp4"), CONTROL);
  const stamp = "2026-11-25 00:00:00";
  const enhance0 = JSON.stringify({ r209: { status: "kept-original", origin: "upload" } });
  const dbC = new DatabaseSync(path.join(dirC, "highlighthype.db"));
  const ins = dbC.prepare("INSERT INTO highlights (title, sport, player_name, media_kind, media_url, mime, status, stream_url, poster_url, enhance_json, r195_checked_at, r203_checked_at, r209_checked_at, r213_checked_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
  const vId = Number(ins.run("Victim224", "baseball", "Kameron A.", "file", `/uploads/${victimName}`, "video/quicktime", "approved", "", "", enhance0, stamp, stamp, stamp, stamp, "2026-11-24 20:00:00").lastInsertRowid);
  const cId = Number(ins.run("Control224", "baseball", "Marco B.", "file", "/uploads/control224.mp4", "video/mp4", "approved", "", "", enhance0, stamp, stamp, stamp, stamp, "2026-11-24 20:00:00").lastInsertRowid);
  // The victim's upload-era poster: real JPEG bytes the
  // recovery's regeneration must replace.
  execFileSync("ffmpeg", ["-nostdin", "-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:size=64x64:duration=0.1", "-frames:v", "1", "-q:v", "3", path.join(upDirC, `poster-${vId}.jpg`)]);
  dbC.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/poster-${vId}.jpg`, vId);
  const posterBefore = fs.readFileSync(path.join(upDirC, `poster-${vId}.jpg`));
  dbC.close();

  const sC = await boot(45243, {}, dirC);
  try {
    // Owner visibility BEFORE the heal can land (the
    // rendition cannot exist until the +5s backfill runs).
    const claim = await sC.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const qVictim = await queueRow(sC, tok, vId);
    assert(qVictim && qVictim.missing_rendition === true, "C: the owner queue flags the 78-state play missing_rendition (>24h, rendition-less)");
    const healed = await sC.waitFor(async () => {
      const dbR = new DatabaseSync(path.join(dirC, "highlighthype.db"), { readOnly: true });
      const r = dbR.prepare("SELECT media_url, stream_url, enhance_json FROM highlights WHERE id=?").get(vId);
      dbR.close();
      return r && r.media_url.endsWith(".mp4") && r.stream_url ? r : null;
    }, "C: the victim converts and gains a rendition at boot", 240000);
    assert(!fs.existsSync(path.join(upDirC, victimName)), "C: the raw .mov master is gone (renamed by the in-place conversion)");
    const masterC = path.join(upDirC, path.basename(healed.media_url));
    assert(!hasLocationTag(probeJson(masterC)), "C: the healed master carries NO location tag");
    const psC = probeJson(path.join(upDirC, path.basename(healed.stream_url)));
    const vsC = psC.streams.find((x) => x.codec_type === "video");
    assert(vsC.height > vsC.width, `C: the healed rendition is PORTRAIT (${vsC.width}x${vsC.height})`);
    const posterAfter = fs.readFileSync(path.join(upDirC, `poster-${vId}.jpg`));
    assert(!posterAfter.equals(posterBefore), "C: the poster was rewritten by the recovery (not the upload-era grab)");
    // The stage backfills settle on their own clocks — wait
    // for the smart-poster re-evaluation itself, not just
    // the rendition that raced ahead of it.
    const enhRow = await sC.waitFor(async () => {
      const dbR = new DatabaseSync(path.join(dirC, "highlighthype.db"), { readOnly: true });
      const r = dbR.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(vId);
      dbR.close();
      try { const e = JSON.parse((r && r.enhance_json) || "{}"); return e.r209 && e.r209.origin === "backfill" ? e : null; } catch { return null; }
    }, "C: the smart-poster stage re-evaluates the healed file", 120000);
    assert(enhRow.r209.origin === "backfill", "C: the smart-poster stage re-evaluated the healed file (r209 origin 'backfill' — the stamp unblocking works)");
    const dbR = new DatabaseSync(path.join(dirC, "highlighthype.db"), { readOnly: true });
    const ctl = dbR.prepare("SELECT media_url, r209_checked_at, enhance_json FROM highlights WHERE id=?").get(cId);
    dbR.close();
    // →227: the control's enhance record gains ONLY Round 227's
    // bookkeeping — the R192 backfill's poster (re)creation stamps
    // r227time via the shared poster path, and the r227 backfill
    // records its skipped-unconfigured verdict for that poster.
    // Master, stamps and the pre-existing enhance content are
    // byte-identical; the no-churn rule binds everything else.
    const ctlEj = JSON.parse(ctl.enhance_json || "{}");
    const ctlRec227 = ctlEj.r227; delete ctlEj.r227; delete ctlEj.r227time;
    assert(ctl.media_url === "/uploads/control224.mp4" && ctl.r209_checked_at === stamp && JSON.stringify(ctlEj) === enhance0 && (!ctlRec227 || ctlRec227.decision === "skipped-unconfigured"), "C: the healthy control play is untouched — same master, same stamp, same enhance record (no churn) — →227: modulo the r227 bookkeeping keys only (r227time from the backfill-made poster, plus the r227 record when its pass has landed — skipped-unconfigured in this keyless env)");
  } finally { await sC.stop(); }

  console.log("\nAll Round 224 checks passed.");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
