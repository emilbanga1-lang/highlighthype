// Round 188 test: the upload welcome email. Run: node test-r188.js
// Boots the server four times on scratch DATA_DIRs and uploads
// tiny clean clips through the real pipeline:
//   A. Capture on, defaults — a guardian's FIRST play gets
//      subject A with every merge filled and the discount block
//      ABSENT; a same-bytes re-upload dedupes and sends NOTHING
//      new; the SECOND play gets subject B (title lowercased
//      into the sentence); a different guardian starts over at
//      subject A, and HTML in merge values is escaped.
//   B. HH_WELCOME_DISCOUNT=1 — the FAMILY10 block appears.
//   C. HH_NO_WELCOME=1 — the pipeline completes, no welcome is
//      captured, the sent marker stays empty.
//   D. Real SMTP pointed at a dead port — the upload still
//      returns 201, the marker stays empty (the send failed, so
//      the welcome is still owed), and the server stays healthy.
// Mail is observed ONLY through the Round 164 HH_MAIL_CAPTURE
// stub (boot D excepted: nothing is captured there because the
// send itself is the failure under test). Exits non-zero on
// failure.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);

// ---- fixtures: three tiny compliant clips, all distinct bytes --
const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r188-fix-"));
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip1.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip2.mp4")]);
ffgen(["-f", "lavfi", "-i", "testsrc2=size=512x288:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", path.join(fixDir, "clip3.mp4")]);
const CLIP1 = fs.readFileSync(path.join(fixDir, "clip1.mp4"));
const CLIP2 = fs.readFileSync(path.join(fixDir, "clip2.mp4"));
const CLIP3 = fs.readFileSync(path.join(fixDir, "clip3.mp4"));

async function boot(port, extraEnv) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r188-"));
  const capture = path.join(tmp, "mail.jsonl");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", ...extraEnv(capture) },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  // Wait out the boot-time Round 124 migration marker (same
  // discipline as test-r186: never race the upload pipeline).
  for (let i = 0; i < 100; i++) {
    try {
      const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
      const marker = db.prepare("SELECT value FROM settings WHERE key='r124_media_migration_v1'").get();
      db.close();
      if (marker) break;
    } catch {}
    await wait(200);
  }
  const readRow = (id) => {
    const db = new DatabaseSync(path.join(tmp, "highlighthype.db"), { readOnly: true });
    try { return db.prepare("SELECT id, poster_url, enhance_json, welcome_sent_at FROM highlights WHERE id=?").get(id); } finally { db.close(); }
  };
  const mails = () => {
    try { return fs.readFileSync(capture, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };
  const upload = async (fields, fname, bytes) => {
    const boundary = "----r188boundary";
    const parts = [];
    for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: video/mp4\r\n\r\n`));
    parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    const r = await fetch(base + "/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const waitFor = async (fn, what, timeoutMs = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}\n--- server log tail ---\n` + log.slice(-2000));
      await wait(1000);
    }
  };
  return { tmp, child, base, readRow, mails, upload, waitFor, getLog: () => log };
}
const welcomeTo = (mails, to) => mails.filter((m) => m.to === to && (m.subject === "Welcome to the HighlightHype family" || /is live — you should be proud of this one$/.test(m.subject || "")));
const SMTP_ENV = { SMTP_USER: "hello@highlighthype.com", SMTP_PASS: "test-pass" };

try {
  // ---------- Boot A: defaults ----------
  {
    const s = await boot(3492, (capture) => ({ ...SMTP_ENV, HH_MAIL_CAPTURE: capture }));
    try {
      const F = { sport: "baseball", guardianConsent: "true", notifyEmail: "parent@example.com", playerName: "Nicholas B." };
      const up1 = await s.upload({ ...F, title: "Home Run" }, "clip1.mp4", CLIP1);
      assert(up1.status === 201, "A: first upload accepted (201)");
      const id1 = up1.body.id;
      const w1 = await s.waitFor(() => welcomeTo(s.mails(), "parent@example.com")[0], "A: first welcome email");
      assert(w1.subject === "Welcome to the HighlightHype family", "A: first play gets subject A");
      assert(typeof w1.html === "string" && w1.html.length > 500, "A: welcome carries an HTML part");
      assert(w1.html.includes("https://highlighthype.com/logo-header-gold.png"), "A: header uses the site's hosted logo");
      assert(w1.html.includes("Hi there,"), "A: greeting falls back gracefully (no guardian name on file)");
      assert(w1.html.includes("Nicholas B.") && w1.html.includes("Home Run"), "A: athlete + title merges filled");
      assert(w1.html.includes("we believe every young athlete should be celebrated"), "A: credo line present");
      assert(w1.html.includes(`https://highlighthype.com/#play-${id1}`), "A: Watch-the-play links the play's PUBLIC page");
      assert(!w1.html.includes("/moderate") && !w1.html.includes("moderate?id"), "A: no moderation link anywhere in the email");
      const row1 = await s.waitFor(() => { const r = s.readRow(id1); return r && r.poster_url ? r : null; }, "A: poster on the row");
      assert(w1.html.includes(`https://highlighthype.com${row1.poster_url}`), "A: poster image is the play's final hosted poster");
      assert(!w1.html.includes("FAMILY10") && !(w1.body || "").includes("FAMILY10"), "A: discount block ABSENT by default");
      assert((w1.body || "").includes("welcome to the family"), "A: plain-text part carries the welcome copy");
      await s.waitFor(() => { const r = s.readRow(id1); return r && r.welcome_sent_at ? r : null; }, "A: sent marker stamped");
      assert(true, "A: welcome_sent_at stamped after the send");

      // Same bytes again -> Round 145/182 dedupe answers, no new
      // play, and crucially no second welcome.
      const dup = await s.upload({ ...F, title: "Home Run" }, "clip1.mp4", CLIP1);
      assert(dup.status === 200 && dup.body.deduped === true, "A: same-bytes re-upload dedupes");
      await wait(4000);
      assert(welcomeTo(s.mails(), "parent@example.com").length === 1, "A: marker + dedupe — still exactly ONE welcome for the play");

      const up2 = await s.upload({ ...F, title: "Walk-Off Double" }, "clip2.mp4", CLIP2);
      assert(up2.status === 201, "A: second upload accepted (201)");
      const w2 = await s.waitFor(() => welcomeTo(s.mails(), "parent@example.com")[1], "A: second welcome email");
      assert(w2.subject === "Nicholas B.'s walk-off double is live — you should be proud of this one", `A: later play gets subject B with the title lowercased in (got: ${w2.subject})`);
      assert(welcomeTo(s.mails(), "parent@example.com").length === 2, "A: exactly two welcomes for two plays");

      const up3 = await s.upload({ sport: "softball", guardianConsent: "true", notifyEmail: "other@example.com", playerName: "Gia <script>", title: "<b>Bold</b> Play" }, "clip3.mp4", CLIP3);
      assert(up3.status === 201, "A: third upload (different guardian) accepted (201)");
      const w3 = await s.waitFor(() => welcomeTo(s.mails(), "other@example.com")[0], "A: third welcome email");
      assert(w3.subject === "Welcome to the HighlightHype family", "A: a different guardian's first play gets subject A again");
      assert(w3.html.includes("&lt;b&gt;Bold&lt;/b&gt;") && !w3.html.includes("<b>Bold</b>"), "A: HTML in the play title is escaped in the email");
      assert(w3.html.includes("Gia &lt;script&gt;") && !w3.html.includes("Gia <script>"), "A: HTML in the athlete name is escaped in the email");
    } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
  }

  // ---------- Boot B: discount flag on ----------
  {
    const s = await boot(3493, (capture) => ({ ...SMTP_ENV, HH_MAIL_CAPTURE: capture, HH_WELCOME_DISCOUNT: "1" }));
    try {
      const up = await s.upload({ sport: "baseball", guardianConsent: "true", notifyEmail: "flag@example.com", playerName: "Kid B", title: "First Hit" }, "clip1.mp4", CLIP1);
      assert(up.status === 201, "B: upload accepted (201)");
      const w = await s.waitFor(() => welcomeTo(s.mails(), "flag@example.com")[0], "B: welcome email");
      assert(w.html.includes("FAMILY10") && w.html.includes("10% off your first HighlightHype order"), "B: HH_WELCOME_DISCOUNT=1 — the FAMILY10 block is present");
      assert((w.body || "").includes("FAMILY10"), "B: the plain-text part carries the code too");
    } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
  }

  // ---------- Boot C: kill switch ----------
  {
    const s = await boot(3494, (capture) => ({ ...SMTP_ENV, HH_MAIL_CAPTURE: capture, HH_NO_WELCOME: "1" }));
    try {
      const up = await s.upload({ sport: "baseball", guardianConsent: "true", notifyEmail: "mute@example.com", playerName: "Kid C", title: "Quiet Play" }, "clip1.mp4", CLIP1);
      assert(up.status === 201, "C: upload accepted (201)");
      await s.waitFor(() => { const r = s.readRow(up.body.id); return r && r.enhance_json ? r : null; }, "C: pipeline settled (enhance report stored)");
      await wait(3000);
      assert(welcomeTo(s.mails(), "mute@example.com").length === 0, "C: HH_NO_WELCOME=1 — no welcome captured");
      assert(!s.readRow(up.body.id).welcome_sent_at, "C: sent marker stays empty under the kill switch");
    } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
  }

  // ---------- Boot D: mailer failure cannot break the upload ----------
  {
    const s = await boot(3495, () => ({ ...SMTP_ENV, SMTP_HOST: "127.0.0.1", SMTP_PORT: "1" }));
    try {
      const up = await s.upload({ sport: "baseball", guardianConsent: "true", notifyEmail: "down@example.com", playerName: "Kid D", title: "Resilient Play" }, "clip1.mp4", CLIP1);
      assert(up.status === 201, "D: upload returns 201 even with SMTP dead");
      await s.waitFor(() => { const r = s.readRow(up.body.id); return r && r.enhance_json ? r : null; }, "D: pipeline settled (enhance report stored)");
      await wait(5000); // the refused connection fails fast; give the welcome attempt time to fail
      assert(!s.readRow(up.body.id).welcome_sent_at, "D: failed send leaves the marker empty — the welcome is still owed, not lost");
      const health = await fetch(s.base + "/api/health");
      assert(health.ok, "D: server still healthy after the mail failure");
    } finally { s.child.kill(); fs.rmSync(s.tmp, { recursive: true, force: true }); }
  }

  console.log("\nR188 welcome email: ALL PASS");
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  fs.rmSync(fixDir, { recursive: true, force: true });
}
