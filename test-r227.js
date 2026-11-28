// Round 227 (2026-11-27) — poster auto-clean, poster_time
// stamping, crown asset, upload text safety, store notify-me.
//   A. Statics + pins: the r227 machinery in server.js, the team
//      hint verbatim in the upload form, CROWN227 at every former
//      emoji site (and the emoji gone from render literals), the
//      notify forms in both coming-soon views, the pickers and
//      the "Ordering opens soon" dead end gone, bottles intact.
//   B. poster_time: an upload's initial grab records r227time
//      (origin "initial") and the payload's poster_time coheres
//      with the stored records; seeded precedence — a real smart
//      pick (r209.chosenTime) beats the initial-grab fallback,
//      the fallback serves alone, neither record → null.
//   C. Poster auto-clean, configured + fence detected: the boot
//      backfill cleans the seeded poster (bytes change, stays a
//      JPEG), preserves the original as poster-<id>-preclean.jpg,
//      records {decision:"cleaned", poster, sig}, never touches
//      the video file; a second boot churns nothing (zero stub
//      calls, poster untouched); a re-picked poster (new bytes
//      under the same name) is processed exactly once more.
//   D. The other verdicts: fence:false → "none" (poster kept, no
//      preclean, edit never called); vision unconfigured →
//      "skipped-unconfigured" (never blind-cleans); the
//      HH_NO_POSTERCLEAN=1 kill switch writes no record at all.
//   E. Text safety: the owner queue flags team "Kameron Angelin"
//      as a full name and an "is only 10" story as an age mention,
//      and leaves "Plainview Hawks" + an age-free story, an
//      allowlisted academy, and all-caps teams unflagged.
//   F. Notify reuse: /api/drop-notify accepts the collection slug
//      + hoodie keys beside the six bottle sports, still rejects
//      an unknown key, and the owner list counts all 19 keys.
//   G. Round 228 (2026-11-27): a sig-matching "skipped-unconfigured"
//      record does NOT settle a poster — unconfigured passes never
//      clean and leave the play retryable, the first configured
//      pass reprocesses it for real (fence poster → "cleaned"),
//      verdict records (none/cleaned/failed) still settle with
//      zero churn, and the backfill logs its unconfigured line
//      exactly once.
// Exits non-zero on failure. Anthropic + OpenAI are NEVER really
// called: configured boots point AI_VISION_BASE_URL /
// HF_AVATAR_BASE_URL at in-process stubs (the house pattern).
import { spawn, execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ---- fixtures: one compliant clip + two distinct poster frames ----
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r227-fix-"));
const CLIP = path.join(fixDir, "clip.mp4");
execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", CLIP]);
const posterAt = (t, out) => execFileSync("ffmpeg", ["-y", "-v", "error", "-ss", String(t), "-i", CLIP, "-frames:v", "1", "-q:v", "3", out]);
const POSTER1 = path.join(fixDir, "poster1.jpg"); posterAt(1.0, POSTER1);
const POSTER2 = path.join(fixDir, "poster2.jpg"); posterAt(2.6, POSTER2);
const CLIP_BYTES = fs.readFileSync(CLIP);
const POSTER1_BYTES = fs.readFileSync(POSTER1);
const POSTER2_BYTES = fs.readFileSync(POSTER2);

async function boot(port, { dir, env = {} } = {}) {
  const tmp = dir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r227-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HH_NO_FENCE: "", HF_AVATAR_BASE_URL: "", HF_AVATAR_MODEL: "", AI_VISION_BASE_URL: "", ...env },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  const upload = async (fields, fname, bytes, ctype) => {
    const boundary = "----r227boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const readRow = (id) => {
    const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
    try { return db.prepare("SELECT id, media_url, poster_url, stream_url, enhance_json, r209_checked_at FROM highlights WHERE id=?").get(id); } finally { db.close(); }
  };
  const waitFor = async (fn, what, timeoutMs = 90000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2500));
      await wait(700);
    }
  };
  return { tmp, child, base, j, upload, readRow, waitFor, getLog: () => log, stop: async () => { child.kill("SIGKILL"); await wait(300); } };
}

function stubs(visionPort, openaiPort, fenceAnswer) {
  const calls = { vision: 0, openai: 0 };
  const vision = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      calls.vision++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ fence: fenceAnswer }) }] }));
    });
  });
  const openai = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      calls.openai++;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG.split(",")[1] }] }));
    });
  });
  return new Promise((resolve) => {
    vision.listen(visionPort, () => openai.listen(openaiPort, () => resolve({
      calls,
      visionUrl: `http://localhost:${visionPort}`,
      openaiUrl: `http://localhost:${openaiPort}`,
      close: () => { vision.close(); openai.close(); },
    })));
  });
}

const STAMP = "2026-11-26T00:00:00.000Z";
function seedVideoPlay(dir, { file, enhanceJson }) {
  const upDir = path.join(dir, "uploads");
  fs.mkdirSync(upDir, { recursive: true });
  fs.copyFileSync(CLIP, path.join(upDir, file));
  const db = new DatabaseSync(path.join(dir, "highlighthype.db"));
  const info = db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, poster_url, status, player_name, enhance_json, stream_url, r195_checked_at, r203_checked_at, r209_checked_at, r213_checked_at) VALUES (?, ?, 'file', ?, '', 'approved', ?, ?, ?, ?, ?, ?, ?)")
    .run("Seeded Play", "baseball", `/uploads/${file}`, "Seed Kid", enhanceJson || "", "/uploads/stream-seed.mp4", STAMP, STAMP, STAMP, STAMP);
  const id = Number(info.lastInsertRowid);
  db.prepare("UPDATE highlights SET poster_url=? WHERE id=?").run(`/uploads/poster-${id}.jpg`, id);
  db.close();
  fs.copyFileSync(POSTER1, path.join(upDir, `poster-${id}.jpg`));
  return id;
}
const ejOf = (row) => { try { return JSON.parse(row.enhance_json || "{}") || {}; } catch { return {}; } };
const sigOf = (abs) => { const st = fs.statSync(abs); return st.size + ":" + Math.round(st.mtimeMs); };

// ================= A. Statics + pins =================
{
  const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
  const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
  const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert(home.includes('src="app.js?v=239"') && home.includes('href="styles.css?v=228"'), "A: asset pins — app.js v224 / styles v217 (Round 227; both files changed) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");
  // Workstream 1+2 machinery.
  assert(serverJs.includes("HH_NO_POSTERCLEAN") && serverJs.includes("r227ProcessPoster227") && serverJs.includes("r227Backfill") && serverJs.includes("skipped-unconfigured") && serverJs.includes("poster-${id}-preclean.jpg"), "A: the poster-clean stage, its kill switch, its unconfigured verdict and the preclean preservation are in server.js");
  assert(serverJs.includes("r227time") && serverJs.includes('origin: "initial"') && serverJs.includes("ej223.r227time"), "A: the initial-grab poster-time record (r227time, origin initial) + the publicHighlight fallback are in server.js");
  assert(serverJs.includes("r227IsSettled228") && serverJs.includes('rec.decision === "none" || rec.decision === "cleaned" || rec.decision === "failed"') && serverJs.includes("[r227] backfill: poster auto-clean not configured (vision key or fence edit missing) — posters left as-is; will retry on a later boot"), "A: Round 228 — the shared settle test (verdicts only, never skipped-unconfigured) + the backfill's unconfigured log line are in server.js");
  assert(serverJs.includes("/api/hype-frame/remove-fence") && serverJs.includes("runHfFence222"), "A: the studio's manual fence endpoint + runner stand untouched");
  // Workstream 4.
  assert(home.includes("Shown publicly — a team or school name works best.") && home.includes('class="small team-hint227"'), "A: the upload form's Team hint rides verbatim under the field");
  assert(serverJs.includes("r227TextFlag") && serverJs.includes("text_flag227: r227TextFlag(r)") && serverJs.includes("Team looks like a full name"), "A: the owner text flag is computed server-side into the queue payload");
  assert(appJs.includes("h.text_flag227") && appJs.includes("⚠ Check text: "), "A: the owner queue renders the flag chip beside the rendition chip");
  // Workstream 3.
  assert(appJs.includes('const CROWN227 = `<img class="crown-ic227" src="/crown.png" alt="crown">`'), "A: the one crown-asset constant exists");
  for (const bad of ['"👑 Your pick"', "👑 Currently #1", "👑 Vote for Hype of the Month", '<span class="crown-chip">👑', "👑 This one won", "👑 WINNER", "👑 Won ", '<span class="vote-chip">👑', "👑 Your pick</span>"])
    assert(!appJs.includes(bad), `A: no emoji crown literal remains in a render path (${bad})`);
  assert((appJs.match(/CROWN227/g) || []).length >= 10, "A: CROWN227 serves every former emoji site (chips, suffix, featured badge + sample, tile sample, watch button, streak, stamps, your-pick, daily + run states)");
  assert(css.includes(".crown-ic227{"), "A: the inline crown style rides (1em, baseline-aligned)");
  assert(home.includes('class="crown-ic227" src="/crown.png" alt="crown"') && !home.includes("👑 Your pick:") && !home.includes(">👑 This one won<"), "A: the static markup (daily strip, Battle Run buttons) wears the asset too");
  // Workstream 5.
  assert(home.includes('id="qvNotifyForm227"') && home.includes('id="hsNotifyForm227"') && home.includes('id="qvEmail227"') && home.includes('id="hsEmail227"'), "A: both coming-soon views carry the notify form");
  assert(!home.includes('id="qvSizes"') && !home.includes('id="hsSizes"') && !home.includes("Ordering opens soon — no orders are being taken yet.") && !home.includes('class="hsv-cta" disabled'), "A: the pickers + the dead-end note + the disabled CTA are gone");
  assert(home.includes('id="qvSwatches"') && home.includes('id="qvGallery"') && home.includes('id="hsThumbs"'), "A: the cards keep name/image/gallery (the swatches navigate the gallery — they stay)");
  assert(home.includes('id="btlNotifyForm"') && appJs.includes("bottle drops") && appJs.includes("notifySubmit227") && appJs.includes('"/api/drop-notify"'), "A: the bottles form + handler stand untouched; the store forms reuse the same endpoint via notifySubmit227");
  assert(serverJs.includes("DROP_NOTIFY_KEYS227") && serverJs.includes('"boys-street"') && serverJs.includes('"hoodie-" + s'), "A: the server allowlist carries the store keys beside the six bottle sports");
  assert(appJs.includes('form183.replaceWith(a183)') || appJs.includes("hsNotifyForm227"), "A: the Round 183 dormant launch block now targets the notify form");
}

// ================= B. poster_time =================
{
  const s = await boot(45241);
  try {
    const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", team: "Plainview Hawks" };
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const owner = { "content-type": "application/json", "x-owner-token": claim.body.token };
    const up = await s.upload({ ...F, playerName: "Kid B", title: "Grab Time" }, "grab.mp4", CLIP_BYTES, "video/mp4");
    assert(up.status === 201, "B: the clip uploads (201)");
    const row = await s.waitFor(() => { const r = s.readRow(up.body.id); const ej = ejOf(r); return ej.r227time && typeof ej.r227time.t === "number" && r.r209_checked_at ? { r, ej } : null; }, "the initial grab's r227time stamp (and the smart-poster stage settled after it)");
    assert(row.ej.r227time.origin === "initial" && row.ej.r227time.t > 0 && row.ej.r227time.t < 4, `B: the initial grab recorded its frame time (r227time.t=${row.ej.r227time.t}, origin "initial")`);
    await s.j(`/api/highlights/${up.body.id}/status`, { method: "POST", headers: owner, body: JSON.stringify({ status: "approved" }) });
    const board = await s.j("/api/highlights?division=all");
    const pub = (board.body.highlights || []).find((h) => h.id === up.body.id);
    const ejNow = ejOf(s.readRow(up.body.id));
    const expected = ejNow.r209 && Number.isFinite(Number(ejNow.r209.chosenTime)) && Number(ejNow.r209.chosenTime) > 0 ? Number(ejNow.r209.chosenTime) : ejNow.r227time.t;
    assert(pub && pub.poster_time === expected, `B: the payload poster_time (${pub && pub.poster_time}) coheres with the stored records (chosenTime wins, else the initial grab)`);
    // Seeded precedence.
    const mk = (enhanceJson, kind) => {
      const db = new DatabaseSync(path.join(s.tmp, "highlighthype.db"));
      const info = db.prepare("INSERT INTO highlights (title, sport, media_kind, media_url, poster_url, status, player_name, enhance_json, stream_url, r195_checked_at, r203_checked_at, r209_checked_at, r213_checked_at) VALUES (?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?)")
        .run("Seed " + kind, "baseball", kind, kind === "file" ? "/uploads/b2.mp4" : "", "/uploads/poster-b2.jpg", "Seed Kid", enhanceJson, "/uploads/stream-seed.mp4", STAMP, STAMP, STAMP, STAMP);
      db.close();
      return Number(info.lastInsertRowid);
    };
    fs.copyFileSync(CLIP, path.join(s.tmp, "uploads", "b2.mp4"));
    const p1 = mk(JSON.stringify({ r209: { chosenTime: 9.5 }, r227time: { t: 1.4, origin: "initial" } }), "file");
    const p2 = mk(JSON.stringify({ r227time: { t: 2.5, origin: "initial" } }), "file");
    const p3 = mk("", "link");
    const board2 = await s.j("/api/highlights?division=all");
    const byId = (id) => (board2.body.highlights || []).find((h) => h.id === id);
    assert(byId(p1) && byId(p1).poster_time === 9.5, "B: a real smart pick (chosenTime 9.5) beats the initial-grab fallback (1.4)");
    assert(byId(p2) && byId(p2).poster_time === 2.5, "B: the initial-grab fallback serves when no smart pick exists");
    assert(byId(p3) && byId(p3).poster_time === null, "B: no record of the frame's time → poster_time stays null (never fabricated)");
  } finally { await s.stop(); }
}

// ================= C. Poster auto-clean =================
{
  const st = await stubs(45261, 45262, true);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r227c-"));
  const env = { AI_VISION_API_KEY: "test-vision-key", OPENAI_API_KEY: "test-openai-key", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl };
  const s = await boot(45242, { dir, env });
  let id;
  try {
    id = seedVideoPlay(dir, { file: "seed-c.mp4", enhanceJson: JSON.stringify({ r227time: { t: 1, origin: "initial" } }) });
    const upDir = path.join(dir, "uploads");
    const posterAbs = path.join(upDir, `poster-${id}.jpg`);
    const row = await s.waitFor(() => { const r = s.readRow(id); const rec = ejOf(r).r227; return rec && rec.decision === "cleaned" ? { r, rec } : null; }, "the backfill's cleaned record");
    assert(row.rec.poster === `poster-${id}.jpg` && row.rec.sig === sigOf(posterAbs), "C: the record names the poster it applies to, signed with the post-clean file state");
    const cleaned = fs.readFileSync(posterAbs);
    assert(!cleaned.equals(POSTER1_BYTES) && cleaned[0] === 0xff && cleaned[1] === 0xd8, "C: the poster file was replaced by the cleaned image (still an honest JPEG)");
    assert(fs.readFileSync(path.join(upDir, `poster-${id}-preclean.jpg`)).equals(POSTER1_BYTES), "C: the pre-clean poster is preserved byte-for-byte as poster-<id>-preclean.jpg");
    assert(fs.readFileSync(path.join(upDir, "seed-c.mp4")).equals(CLIP_BYTES), "C: the VIDEO file is byte-identical — posters are the only thing touched");
    assert(st.calls.vision >= 1 && st.calls.openai >= 1, `C: detection ran first (vision ${st.calls.vision}), the edit second (openai ${st.calls.openai})`);
    assert(Object.keys(row.rec).sort().join(",") === "at,decision,poster,sig", "C: the r227 record is exactly {decision, at, poster, sig}");
  } finally { await s.stop(); }
  // Second boot: no churn.
  const st2 = await stubs(45263, 45264, true);
  const s2 = await boot(45243, { dir, env: { AI_VISION_API_KEY: "test-vision-key", OPENAI_API_KEY: "test-openai-key", AI_VISION_BASE_URL: st2.visionUrl, HF_AVATAR_BASE_URL: st2.openaiUrl } });
  try {
    const posterAbs = path.join(dir, "uploads", `poster-${id}.jpg`);
    const before = fs.readFileSync(posterAbs);
    await s2.waitFor(() => s2.getLog().includes("[r227] backfill complete") || null, "the second boot's r227 backfill");
    assert(st2.calls.vision === 0 && st2.calls.openai === 0, "C: a settled play is never re-processed — zero vision/edit calls on the next boot");
    assert(fs.readFileSync(posterAbs).equals(before), "C: the cleaned poster is byte-identical after the second boot (no churn)");
  } finally { await s2.stop(); st2.close(); }
  // Re-pick: new poster bytes under the same name → processed once.
  const st3 = await stubs(45265, 45266, true);
  fs.copyFileSync(POSTER2, path.join(dir, "uploads", `poster-${id}.jpg`));
  const s3 = await boot(45244, { dir, env: { AI_VISION_API_KEY: "test-vision-key", OPENAI_API_KEY: "test-openai-key", AI_VISION_BASE_URL: st3.visionUrl, HF_AVATAR_BASE_URL: st3.openaiUrl } });
  try {
    const row = await s3.waitFor(() => { const r = s3.readRow(id); const rec = ejOf(r).r227; return rec && rec.decision === "cleaned" && rec.sig === sigOf(path.join(dir, "uploads", `poster-${id}.jpg`)) && st3.calls.vision >= 1 ? { r, rec } : null; }, "the re-picked poster's clean");
    assert(fs.readFileSync(path.join(dir, "uploads", `poster-${id}-preclean.jpg`)).equals(POSTER2_BYTES), "C: the re-pick was processed once — its own bytes are the new preserved preclean");
  } finally { await s3.stop(); st3.close(); }
  st.close();
}

// ================= D. The other verdicts =================
{
  // fence: false → "none".
  const st = await stubs(45267, 45268, false);
  const s = await boot(45245, { env: { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl } });
  try {
    const id = seedVideoPlay(s.tmp, { file: "seed-d.mp4", enhanceJson: JSON.stringify({ r227time: { t: 1, origin: "initial" } }) });
    const rec = await s.waitFor(() => { const r = s.readRow(id); const x = ejOf(r).r227; return x && x.decision ? x : null; }, "the none record");
    assert(rec.decision === "none" && st.calls.vision >= 1 && st.calls.openai === 0, "D: no fence detected → decision 'none', the edit is never called");
    assert(fs.readFileSync(path.join(s.tmp, "uploads", `poster-${id}.jpg`)).equals(POSTER1_BYTES) && !fs.existsSync(path.join(s.tmp, "uploads", `poster-${id}-preclean.jpg`)), "D: the poster stands untouched and no preclean is written");
  } finally { await s.stop(); st.close(); }
  // Vision unconfigured → "skipped-unconfigured", never blind-clean.
  const st2 = await stubs(45269, 45270, true);
  const s2 = await boot(45246, { env: { OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st2.visionUrl, HF_AVATAR_BASE_URL: st2.openaiUrl } });
  try {
    const id = seedVideoPlay(s2.tmp, { file: "seed-e.mp4", enhanceJson: JSON.stringify({ r227time: { t: 1, origin: "initial" } }) });
    const rec = await s2.waitFor(() => { const r = s2.readRow(id); const x = ejOf(r).r227; return x && x.decision ? x : null; }, "the skipped-unconfigured record");
    assert(rec.decision === "skipped-unconfigured" && st2.calls.openai === 0 && fs.readFileSync(path.join(s2.tmp, "uploads", `poster-${id}.jpg`)).equals(POSTER1_BYTES), "D: no vision key → 'skipped-unconfigured' and the poster is NEVER blind-cleaned");
  } finally { await s2.stop(); st2.close(); }
  // Kill switch → no record at all.
  const st3 = await stubs(45271, 45272, true);
  const s3 = await boot(45247, { env: { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st3.visionUrl, HF_AVATAR_BASE_URL: st3.openaiUrl, HH_NO_POSTERCLEAN: "1" } });
  try {
    const id = seedVideoPlay(s3.tmp, { file: "seed-f.mp4", enhanceJson: JSON.stringify({ r227time: { t: 1, origin: "initial" } }) });
    await s3.waitFor(() => s3.getLog().includes("[r227] backfill disabled via HH_NO_POSTERCLEAN") || null, "the kill-switch log line");
    await wait(1500);
    assert(!ejOf(s3.readRow(id)).r227 && st3.calls.vision === 0 && st3.calls.openai === 0, "D: HH_NO_POSTERCLEAN=1 stands the whole stage down — no record, no calls");
  } finally { await s3.stop(); st3.close(); }
}

// ================= E + F. Text flag + notify reuse =================
{
  const s = await boot(45248);
  try {
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const post = (fields) => s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sport: "baseball", playerName: "Kid E", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true", notifyEmail: "p@example.com", ...fields }) });
    const cases = [
      { fields: { title: "Name Case", team: "Kameron Angelin", story: "A walk-off winner" }, want: "Team looks like a full name" },
      { fields: { title: "Age Case", team: "Plainview Hawks", story: "He is only 10 and drove in the winner" }, want: "Age mentioned" },
      { fields: { title: "Clean Case", team: "Plainview Hawks", story: "A walk-off in the last inning" }, want: "" },
      { fields: { title: "Academy Case", team: "Riverdale Academy", story: "Our 9-year-old shortstop turned two" }, want: "Age mentioned" },
      { fields: { title: "Caps Case", team: "HAWKS ELITE", story: "Championship game" }, want: "" },
    ];
    const ids = [];
    for (const c of cases) { const r = await post(c.fields); assert(r.status === 201, `E: upload '${c.fields.title}' accepted (201) — the flag never blocks`); ids.push(r.body.id); }
    const q = await s.j("/api/owner/queue", { headers: { "x-owner-token": tok } });
    const flagOf = (id) => { const row = (q.body.queue || []).find((h) => h.id === id); return row ? row.text_flag227 : null; };
    cases.forEach((c, i) => assert(flagOf(ids[i]) === c.want, `E: '${c.fields.title}' (team "${c.fields.team}") → text_flag227 ${JSON.stringify(c.want)} (got ${JSON.stringify(flagOf(ids[i]))})`));
    const pub = await s.j("/api/highlights?division=all");
    assert(!JSON.stringify(pub.body).includes("text_flag227"), "E: the flag is owner-only — it never rides a public payload");
    // F: notify reuse.
    const dn = (sport, email = "parent@example.com") => s.j("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, sport }) });
    assert((await dn("boys-street")).status === 200, "F: a collection slug (boys-street) is accepted by the bottles' endpoint");
    assert((await dn("hoodie-baseball")).status === 200, "F: a hoodie key (hoodie-baseball) is accepted");
    assert((await dn("football")).status === 200, "F: a bottle sport (football) still works exactly as before");
    assert((await dn("hockey")).status === 400, "F: a bare non-key (hockey) is still rejected — only hoodie-hockey is a key");
    assert((await dn("boys-street", "not-an-email")).status === 400, "F: the bottles' email validation applies to the store keys too");
    const list = await s.j("/api/owner/drop-notifications", { headers: { "x-owner-token": tok } });
    assert(list.body.counts.length === 19 && list.body.counts.find((c) => c.sport === "boys-street").count === 1 && list.body.counts.find((c) => c.sport === "hoodie-baseball").count === 1 && list.body.counts.find((c) => c.sport === "football").count === 1, "F: the owner counts cover all 19 keys with the new signups counted");
  } finally { await s.stop(); }
}

// ================= G. Round 228: skipped-unconfigured never settles =================
const patchRecord228 = (dir, id, decision) => {
  const posterAbs = path.join(dir, "uploads", `poster-${id}.jpg`);
  const db = new DatabaseSync(path.join(dir, "highlighthype.db"));
  const row = db.prepare("SELECT enhance_json FROM highlights WHERE id=?").get(id);
  const ej = (() => { try { return JSON.parse(row.enhance_json || "{}") || {}; } catch { return {}; } })();
  ej.r227time = { t: 1, origin: "initial" };
  ej.r227 = { decision, at: new Date().toISOString(), poster: `poster-${id}.jpg`, sig: sigOf(posterAbs) };
  db.prepare("UPDATE highlights SET enhance_json=? WHERE id=?").run(JSON.stringify(ej), id);
  db.close();
};
{
  // (a) + (b) + (d): unconfigured passes write a sig-matching skipped
  // record and never clean; the first configured pass reprocesses.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r228g-"));
  const LOGLINE228 = "[r227] backfill: poster auto-clean not configured (vision key or fence edit missing) — posters left as-is; will retry on a later boot";
  const stU = await stubs(45273, 45274, true);
  const sU = await boot(45249, { dir, env: { OPENAI_API_KEY: "k", AI_VISION_BASE_URL: stU.visionUrl, HF_AVATAR_BASE_URL: stU.openaiUrl } });
  let id;
  try {
    id = seedVideoPlay(dir, { file: "seed-g.mp4", enhanceJson: JSON.stringify({ r227time: { t: 1, origin: "initial" } }) });
    const rec = await sU.waitFor(() => { const r = sU.readRow(id); const x = ejOf(r).r227; return x && x.decision ? x : null; }, "the unconfigured pass's skipped record");
    assert(rec.decision === "skipped-unconfigured" && rec.poster === `poster-${id}.jpg` && rec.sig === sigOf(path.join(dir, "uploads", `poster-${id}.jpg`)), "G: phase 1 — a sig-matching 'skipped-unconfigured' record is written while the vision key is missing");
    assert(fs.readFileSync(path.join(dir, "uploads", `poster-${id}.jpg`)).equals(POSTER1_BYTES) && stU.calls.vision === 0 && stU.calls.openai === 0, "G: (b) phase 1 — the poster is NOT cleaned while unconfigured (no calls, never blind-clean)");
    await sU.waitFor(() => sU.getLog().includes(LOGLINE228) || null, "the backfill's unconfigured log line");
    assert(sU.getLog().split(LOGLINE228).length - 1 === 1, "G: (d) the backfill logs its unconfigured line exactly once");
  } finally { await sU.stop(); stU.close(); }
  // A second unconfigured boot: still untouched, still unsettled.
  const sU2 = await boot(45250, { dir, env: { OPENAI_API_KEY: "k" } });
  try {
    await sU2.waitFor(() => sU2.getLog().includes("[r227] backfill complete") || null, "the second unconfigured backfill");
    assert(fs.readFileSync(path.join(dir, "uploads", `poster-${id}.jpg`)).equals(POSTER1_BYTES), "G: (b) phase 2 — a second unconfigured pass still leaves the poster untouched");
    const rec2 = ejOf(sU2.readRow(id)).r227;
    assert(rec2 && rec2.decision === "skipped-unconfigured", "G: (b) phase 2 — the record remains 'skipped-unconfigured' (unsettled, retryable)");
    assert(sU2.getLog().includes(LOGLINE228), "G: (d) the second unconfigured boot logs the line too");
  } finally { await sU2.stop(); }
  // The first configured boot: the skipped record must not settle.
  const stC = await stubs(45275, 45276, true);
  const sC = await boot(45251, { dir, env: { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: stC.visionUrl, HF_AVATAR_BASE_URL: stC.openaiUrl } });
  try {
    const rec = await sC.waitFor(() => { const r = sC.readRow(id); const x = ejOf(r).r227; return x && x.decision === "cleaned" ? x : null; }, "the configured pass cleaning the previously-skipped play");
    assert(stC.calls.vision >= 1 && stC.calls.openai >= 1, `G: (a) once configured, the skipped play is REPROCESSED — detection ran (vision ${stC.calls.vision}), then the edit (openai ${stC.calls.openai})`);
    assert(rec.sig === sigOf(path.join(dir, "uploads", `poster-${id}.jpg`)) && fs.readFileSync(path.join(dir, "uploads", `poster-${id}-preclean.jpg`)).equals(POSTER1_BYTES) && !fs.readFileSync(path.join(dir, "uploads", `poster-${id}.jpg`)).equals(POSTER1_BYTES), "G: (a) the record becomes 'cleaned', the poster is replaced, and the original is preserved as preclean");
  } finally { await sC.stop(); stC.close(); }
}
{
  // (c): sig-matching verdict records still settle — no churn.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r228h-"));
  const st = await stubs(45277, 45278, true);
  const s = await boot(45252, { dir, env: { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl } });
  try {
    const decisions = ["none", "cleaned", "failed"];
    const ids = decisions.map((d, i) => { const pid = seedVideoPlay(dir, { file: `seed-h${i}.mp4`, enhanceJson: "" }); patchRecord228(dir, pid, d); return pid; });
    await s.waitFor(() => s.getLog().includes("[r227] backfill complete") || null, "the settled-verdicts backfill");
    assert(st.calls.vision === 0 && st.calls.openai === 0, "G: (c) sig-matching none/cleaned/failed records still settle — zero vision/edit calls on the pass");
    ids.forEach((pid, i) => {
      assert(fs.readFileSync(path.join(dir, "uploads", `poster-${pid}.jpg`)).equals(POSTER1_BYTES), `G: (c) the '${decisions[i]}' play's poster is byte-identical (no churn)`);
      assert(ejOf(s.readRow(pid)).r227.decision === decisions[i], `G: (c) the '${decisions[i]}' record stands unchanged`);
    });
  } finally { await s.stop(); st.close(); }
}

console.log("\ntest-r227: ALL PASSED");
