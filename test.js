// Local end-to-end test. Run: node test.js
// Starts the server on a scratch DATA_DIR, then exercises the API.
// Exits non-zero on any failed assertion. Test data is NOT shipped.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-"));
const PORT = 3456;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, BACKUP_TOKEN: "test-backup-token" }, stdio: "pipe" });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  let h = await j("/api/health"); assert(h.body.ok, "health endpoint");
  // 1. Create a link play -> must start pending, must NOT be public
  let created = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Test Dunk", sport: "basketball", playType: "Dunk", playerName: "Nick", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }) });
  assert(created.status === 201 && created.body.status === "pending", "new play starts pending");
  const id = created.body.id;
  let pub = await j("/api/highlights"); assert(pub.body.highlights.length === 0, "pending play is not public");
  // 2. Contest enter before approval must be refused
  let early = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) });
  assert(early.status === 404, "contest enter refused while pending");
  // 3. Owner claim (once), then approve
  let claim = await j("/api/owner/claim", { method: "POST" }); assert(claim.body.token, "owner claim returns token once");
  const tok = claim.body.token;
  let claim2 = await j("/api/owner/claim", { method: "POST" }); assert(claim2.status === 409, "second owner claim refused");
  let queue = await j("/api/owner/queue"); assert(queue.status === 403, "queue requires owner token");
  queue = await j("/api/owner/queue", { headers: { "x-owner-token": tok } }); assert(queue.body.queue.length === 1, "owner queue lists pending play");
  let appr = await j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  assert(appr.body.status === "approved", "owner approves play");
  pub = await j("/api/highlights"); assert(pub.body.highlights.length === 1, "approved play is public");
  // 3b. Public shape is an explicit allowlist (hardening): every field the
  // client uses is present, and NO internal pre-review JSON leaks.
  const ALLOW = ["id", "title", "sport", "play_type", "player_name", "story", "media_kind", "media_url", "mime", "embed_url", "host_label", "status", "created_at", "division", "team", "athlete_id", "athlete_tag", "athlete_group", "jersey", "athlete_label", "athlete_collision", "hasGuardianEmail", "hasGuardianText", "hasGuardianPhone", "isSample", "voteCount", "hasVoted"];
  const pubKeys = Object.keys(pub.body.highlights[0]);
  assert(ALLOW.every((k) => pubKeys.includes(k)), "public play carries every allowlisted field the client uses");
  assert(pubKeys.every((k) => ALLOW.includes(k)), "public play carries NOTHING outside the allowlist");
  const pubRaw = await (await fetch(base + "/api/highlights")).text();
  assert(!pubRaw.includes('"review"') && !pubRaw.includes("checkedAt") && !pubRaw.includes("FLAGGED"), "no pre-review internals in the public API response");
  // 3c. Security headers on a page route and an API route.
  for (const hp of ["/", "/api/health"]) {
    const hr = await fetch(base + hp);
    assert(hr.headers.get("strict-transport-security") === "max-age=31536000; includeSubDomains", `HSTS header on ${hp}`);
    assert(hr.headers.get("x-content-type-options") === "nosniff", `nosniff header on ${hp}`);
    assert(hr.headers.get("referrer-policy") === "same-origin", `Referrer-Policy header on ${hp}`);
    assert(hr.headers.get("content-security-policy") === "frame-ancestors 'self'", `frame-ancestors-only CSP on ${hp}`);
  }
  // 4. Vote toggle: one per voter, tap again removes
  let v1 = await j(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "tester-1" }) });
  assert(v1.body.voteCount === 1 && v1.body.hasVoted, "first vote counts");
  let v2 = await j(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "tester-1" }) });
  assert(v2.body.voteCount === 0 && !v2.body.hasVoted, "second tap removes vote");
  await j(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "tester-1" }) });
  // 5. Contest enter + duplicate refused + winner (owner only)
  let enter = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) });
  assert(enter.body.ok && enter.body.period, "contest enter succeeds after approval");
  let dup = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) });
  assert(dup.body.alreadyEntered, "duplicate contest entry refused");
  let contest = await j("/api/contest"); assert(contest.body.totalEntries === 1 && contest.body.entries[0].voteCount === 1, "contest leaderboard shows entry + votes");
  let winNo = await j("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) });
  assert(winNo.status === 403, "winner marking requires owner token");
  let win = await j("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: id }) });
  assert(win.body.ok, "owner marks winner");
  contest = await j("/api/contest"); assert(contest.body.entries[0].isWinner, "winner badge present in contest list");
  // 6. Report + hide
  let rep = await j(`/api/highlights/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "test report" }) });
  assert(rep.body.ok, "report succeeds");
  let reps = await j("/api/owner/reports", { headers: { "x-owner-token": tok } }); assert(reps.body.reports.length === 1, "owner sees report");
  let hide = await j(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "hidden" }) });
  assert(hide.body.status === "hidden", "owner hides play");
  pub = await j("/api/highlights"); assert(pub.body.highlights.length === 0, "hidden play leaves public board");
  // 7. File upload (small PNG via multipart)
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const boundary = "----testboundary";
  const parts = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPhoto Play\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="sport"\r\n\r\nsoccer\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.png"\r\nContent-Type: image/png\r\n\r\n`),
    png, Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  let up = await j("/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: parts });
  assert(up.status === 201 && up.body.status === "pending", "file upload creates pending play");
  // 8. Backup endpoints (hardening): token-gated, snapshot + manifest + file.
  const BT = { "x-backup-token": "test-backup-token" };
  for (const bp of ["/api/backup/db", "/api/backup/manifest", "/api/backup/file?path=uploads%2Fx.png"]) {
    const noTok = await fetch(base + bp);
    assert(noTok.status === 403, `backup route refuses requests with NO token: ${bp.split("?")[0]}`);
    const wrongTok = await fetch(base + bp, { headers: { "x-backup-token": "wrong-token" } });
    assert(wrongTok.status === 403, `backup route refuses a WRONG token: ${bp.split("?")[0]}`);
  }
  const man = await j("/api/backup/manifest", { headers: BT });
  assert(man.status === 200 && man.body.ok && typeof man.body.generatedAt === "string" && typeof man.body.dbSize === "number" && man.body.dbSize > 0 && Array.isArray(man.body.files), "manifest returns generatedAt + db size + file list");
  const upEntry = man.body.files.find((f) => f.path.startsWith("uploads/"));
  assert(upEntry && upEntry.size === png.length, "manifest lists the uploaded file with its real size");
  const fileRes = await fetch(`${base}/api/backup/file?path=${encodeURIComponent(upEntry.path)}`, { headers: BT });
  const fileBytes = Buffer.from(await fileRes.arrayBuffer());
  assert(fileRes.status === 200 && fileBytes.length === upEntry.size && fileBytes.subarray(0, 4).toString("hex") === "89504e47", "backup /file serves the seeded upload byte-for-byte");
  for (const evil of ["../server.js", "..%2F..%2Fserver.js", "highlighthype.db", "/etc/passwd", "uploads/../../server.js"]) {
    const er = await fetch(`${base}/api/backup/file?path=${evil}`, { headers: BT });
    assert(er.status === 400 || er.status === 403, `backup /file refuses escape attempt: ${evil}`);
  }
  const dbRes = await fetch(base + "/api/backup/db", { headers: BT });
  const dbBytes = Buffer.from(await dbRes.arrayBuffer());
  assert(dbRes.status === 200 && (dbRes.headers.get("content-disposition") || "").includes("highlighthype-db.sqlite") && dbBytes.subarray(0, 15).toString() === "SQLite format 3", "backup /db streams a real SQLite snapshot download");
  // 8b. With BACKUP_TOKEN unset the feature is OFF (403 even with a token).
  const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-notoken-"));
  const env2 = { ...process.env, PORT: "3459", DATA_DIR: tmp2 }; delete env2.BACKUP_TOKEN;
  const child2 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: env2, stdio: "pipe" });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch("http://localhost:3459/api/health"); break; } catch { await wait(200); } }
    for (const bp of ["/api/backup/db", "/api/backup/manifest", "/api/backup/file?path=uploads%2Fx.png"]) {
      const r = await fetch("http://localhost:3459" + bp, { headers: BT });
      assert(r.status === 403, `BACKUP_TOKEN unset -> 403 even with a token header: ${bp.split("?")[0]}`);
    }
  } finally { child2.kill(); fs.rmSync(tmp2, { recursive: true, force: true }); }
  // 9. Upload rate limit: 20 POSTs/hour/IP (2 already made above) — the
  // 21st attempt is refused with 429. Runs last; the scratch server is
  // discarded right after.
  for (let i = 0; i < 18; i++) {
    const rr = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `Rate Filler ${i}`, sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }) });
    assert(rr.status === 201, `upload ${i + 3} of 20 still allowed`);
  }
  const over = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "One Too Many", sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }) });
  assert(over.status === 429 && /Too many uploads/.test(over.body.message || ""), "21st upload within the hour is rate-limited (429)");
  console.log("\nALL TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
