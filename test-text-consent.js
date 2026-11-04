// Follow-up test (2026-11-03): guardian mobile + text opt-in at upload.
// Run: node test-text-consent.js
// Starts the server on a scratch DATA_DIR with NO Twilio env vars and
// exercises: capture + consent storage, public stripping, owner-only
// visibility, prize eligibility (email OR consented phone), invalid
// phone handling, and the inert SMS no-op log line on winner marking.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-text-test-"));
const PORT = 3457;
const base = `http://localhost:${PORT}`;
const env = { ...process.env, PORT: String(PORT), DATA_DIR: tmp };
delete env.TWILIO_ACCOUNT_SID; delete env.TWILIO_AUTH_TOKEN; delete env.TWILIO_FROM;
const child = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env, stdio: "pipe" });
let serverLog = "";
child.stdout.on("data", (d) => { serverLog += d.toString(); });
child.stderr.on("data", (d) => { serverLog += d.toString(); });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const text = await r.text(); let body = {}; try { body = JSON.parse(text); } catch {} return { status: r.status, body, raw: text }; };
const post = (p, payload, tok) => j(p, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { "x-owner-token": tok } : {}) }, body: JSON.stringify(payload) });
const upload = (payload) => post("/api/highlights", { sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ...payload });
const approve = (id, tok) => post(`/api/highlights/${id}/status`, { status: "approved" }, tok);
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  let h = await j("/api/health"); assert(h.body.ok, "health endpoint");

  let claim = await post("/api/owner/claim", {}); assert(claim.body.token, "owner claim returns token");
  const tok = claim.body.token;

  // --- Play A: guardian phone + consent, NO email ---
  const PHONE_A = "516-555-0142";
  let a = await upload({ title: "Play A", playerName: "Sam Carter", team: "Plainview Hawks", guardianPhone: PHONE_A, textConsent: "on" });
  assert(a.status === 201 && a.body.status === "pending", "A: upload with phone+consent starts pending");
  const idA = a.body.id;

  // Owner queue: forbidden without token, shows phone + consent with token
  let q0 = await j("/api/owner/queue"); assert(q0.status === 403 && !q0.raw.includes(PHONE_A), "owner queue requires token and leaks no phone anonymously");
  let q = await j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  const qA = q.body.queue.find((x) => x.id === idA);
  assert(qA && qA.guardian_phone === PHONE_A, "A: owner queue shows guardian phone (owner only)");
  assert(qA && qA.text_consent === true, "A: owner queue shows text_consent = true");
  assert(qA && qA.guardian_email === "", "A: guardian email empty as expected");

  await approve(idA, tok);

  // Public board: present, but phone stripped everywhere
  let pub = await j("/api/highlights");
  assert(pub.body.highlights.length === 1, "A: approved play is public");
  assert(!pub.raw.includes(PHONE_A) && !pub.raw.includes("5165550142") && !pub.raw.includes("guardian_phone") && !pub.raw.includes("text_consent"), "A: public /api/highlights contains NO phone or private field names");
  const pubA = pub.body.highlights[0];
  assert(pubA.hasGuardianText === true && pubA.hasGuardianEmail === false, "A: public booleans — hasGuardianText true, hasGuardianEmail false");

  // Athlete collection: same stripping
  let coll = await j(`/api/highlights?athlete_id=${encodeURIComponent(pubA.athlete_id)}`);
  assert(coll.body.highlights.length === 1 && coll.body.highlights[0].id === idA, "A: athlete collection returns the play");
  assert(!coll.raw.includes(PHONE_A) && !coll.raw.includes("guardian_phone"), "A: athlete collection contains NO phone");

  // Contest: prize-eligible via consented phone alone
  let eA = await post("/api/contest/enter", { highlightId: idA }); assert(eA.body.ok, "A: contest enter succeeds");
  let contest = await j("/api/contest");
  assert(!contest.raw.includes(PHONE_A) && !contest.raw.includes("guardian_phone"), "contest response contains NO phone");
  assert(contest.body.entries.find((x) => x.id === idA)?.prizeEligible === true, "A: prizeEligible TRUE with consented phone and no email");

  // --- Play B: phone WITHOUT consent, no email → stored for owner, NOT textable, NOT eligible ---
  const PHONE_B = "516-555-9999";
  let b = await upload({ title: "Play B", playerName: "Jo Lee", team: "Plainview Hawks", guardianPhone: PHONE_B });
  const idB = b.body.id;
  await approve(idB, tok);
  await post("/api/contest/enter", { highlightId: idB });
  q = await j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  const qB = q.body.queue.find((x) => x.id === idB);
  assert(qB.guardian_phone === PHONE_B && qB.text_consent === false, "B: owner sees phone with text_consent = false (not textable)");
  contest = await j("/api/contest");
  assert(contest.body.entries.find((x) => x.id === idB)?.prizeEligible === false, "B: prizeEligible FALSE — phone without consent does not count");
  pub = await j("/api/highlights");
  assert(!pub.raw.includes(PHONE_B), "B: public board contains NO phone");

  // --- Play C: neither phone nor email → not eligible (rule not weakened) ---
  let c = await upload({ title: "Play C", playerName: "Pat Kim" });
  const idC = c.body.id;
  await approve(idC, tok);
  await post("/api/contest/enter", { highlightId: idC });
  contest = await j("/api/contest");
  assert(contest.body.entries.find((x) => x.id === idC)?.prizeEligible === false, "C: prizeEligible FALSE with no guardian contact at all");

  // --- Play D: email only → eligible (existing rule preserved) ---
  let d = await upload({ title: "Play D", playerName: "Rue Fox", notifyEmail: "parent@example.com" });
  const idD = d.body.id;
  await approve(idD, tok);
  await post("/api/contest/enter", { highlightId: idD });
  contest = await j("/api/contest");
  assert(contest.body.entries.find((x) => x.id === idD)?.prizeEligible === true, "D: prizeEligible TRUE with guardian email only");
  assert(!contest.raw.includes("parent@example.com"), "D: contest response contains NO guardian email");

  // --- Play E: garbage phone + consent → phone dropped, not textable ---
  let e = await upload({ title: "Play E", playerName: "Mel Ray", guardianPhone: "123", textConsent: "on" });
  const idE = e.body.id;
  q = await j("/api/owner/queue", { headers: { "x-owner-token": tok } });
  const qE = q.body.queue.find((x) => x.id === idE);
  assert(qE.guardian_phone === "", "E: too-short phone is dropped at capture");
  await approve(idE, tok);
  pub = await j("/api/highlights");
  assert(pub.body.highlights.find((x) => x.id === idE)?.hasGuardianText === false, "E: hasGuardianText false after phone dropped");

  // --- Winner marking: A (consented phone) → no warning + inert SMS log; C → warning ---
  serverLog = "";
  let winA = await post("/api/contest/winner", { highlightId: idA }, tok);
  assert(winA.body.ok && winA.body.warning === "", "winner A: no contact warning (consented phone reaches guardian)");
  await wait(400);
  assert(serverLog.includes("[sms] TWILIO_* env vars not set"), "winner A: SMS path is INERT without Twilio env — log line proves no text was sent");
  let winC = await post("/api/contest/winner", { highlightId: idC }, tok);
  assert(winC.body.ok && /cannot be contacted/.test(winC.body.warning || ""), "winner C: warning fires when no guardian contact exists");

  console.log("\nALL TEXT-OPT-IN TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
