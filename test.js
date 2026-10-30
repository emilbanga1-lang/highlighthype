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
const child = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp }, stdio: "pipe" });
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
  console.log("\nALL TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
