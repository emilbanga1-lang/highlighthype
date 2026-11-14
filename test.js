// Local end-to-end test. Run: node test.js
// Starts the server on a scratch DATA_DIR, then exercises the API.
// Exits non-zero on any failed assertion. Test data is NOT shipped.
import { spawn, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-"));
const PORT = 3456;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp, BACKUP_TOKEN: "test-backup-token", AI_VISION_API_KEY: "" }, stdio: "pipe" });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  let h = await j("/api/health"); assert(h.body.ok, "health endpoint");
  // 1. Create a link play -> must start pending, must NOT be public
  let created = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Test Dunk", sport: "basketball", playType: "Dunk", playerName: "Nick", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
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
  const ALLOW = ["id", "title", "sport", "play_type", "player_name", "story", "media_kind", "media_url", "poster_url", "mime", "embed_url", "host_label", "status", "created_at", "division", "team", "athlete_id", "athlete_tag", "athlete_group", "jersey", "athlete_label", "athlete_collision", "hasGuardianEmail", "hasGuardianText", "hasGuardianPhone", "isSample", "badges", "voteCount", "hasVoted", "crowns", "votesMonth", "views", "battleWins", "viewCount", "moment_kind", "moment_label"]; // →151: viewCount joins the allowlist deliberately — the same aggregate play_open sum as views, surfaced for the public watch-count chips (Round 151, §59) — →162: moment_kind + moment_label join deliberately — the family's own milestone tag + its display label, public by design (Round 162, §70)
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
  // 5. Contest enter + duplicate refused + winner (owner only).
  // Round 121: entry is gated — the posting guardian proves it with
  // their email, or the owner enters with the token (this play has
  // no guardian email on file, so the owner path is the only door;
  // the dedicated r121 suite below covers the guardian paths).
  let enter = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: id }) });
  assert(enter.body.ok && enter.body.period, "contest enter succeeds after approval (owner override)");
  let dup = await j("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ highlightId: id }) });
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
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="guardianConsent"\r\n\r\ntrue\r\n`),
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
  // 8c. My Highlights (light): athlete lookup by HH tag / guardian email.
  // Self-contained on its own scratch server (the 8b pattern), so it
  // neither consumes the main server's upload budget nor inherits its
  // data. Covers: approved-only results, two athletes behind one
  // guardian email listed unmerged, and no private field in any
  // lookup response.
  const tmp3 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-lookup-"));
  const PORT3 = 3463, base3 = `http://localhost:${PORT3}`;
  const child3 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT3), DATA_DIR: tmp3 }, stdio: "pipe" });
  const j3 = async (p, opts = {}) => { const r = await fetch(base3 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base3 + "/api/health"); break; } catch { await wait(200); } }
    const claim3 = await j3("/api/owner/claim", { method: "POST" });
    const tok3 = claim3.body.token; assert(tok3, "lookup suite: owner claim returns token");
    const mkPlay3 = async (fields) => {
      const r = await j3("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true", ...fields }) });
      assert(r.status === 201, `lookup suite: play created (${fields.title})`);
      return r.body.id;
    };
    const approve3 = async (id) => { const r = await j3(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok3 }, body: JSON.stringify({ status: "approved" }) }); assert(r.body.status === "approved", "lookup suite: play approved"); };
    const G = "guardian@example.com", PHONE = "516-555-0142";
    // Athlete A: one APPROVED play + one PENDING play, same guardian.
    const a1 = await mkPlay3({ title: "A Approved", playerName: "Sam Reyes", team: "Hawks", notifyEmail: G, guardianPhone: PHONE });
    await approve3(a1);
    await mkPlay3({ title: "A Pending", playerName: "Sam Reyes", team: "Hawks", notifyEmail: G });
    // Athlete B: a DIFFERENT athlete behind the SAME guardian email.
    const b1 = await mkPlay3({ title: "B Approved", playerName: "Jamie Reyes", team: "Tigers", notifyEmail: G });
    await approve3(b1);
    // Athlete E: plays exist but NONE approved (pending only).
    await mkPlay3({ title: "E Pending", playerName: "Rio Park", team: "Hawks", notifyEmail: "pendingonly@example.com" });
    const chkA = await j3("/api/athletes/check?name=" + encodeURIComponent("Sam Reyes"));
    const aRow = chkA.body.matches[0]; assert(aRow && aRow.tag && aRow.athleteKey, "lookup suite: athlete A resolvable via duplicate check");
    const chkE = await j3("/api/athletes/check?name=" + encodeURIComponent("Rio Park"));
    const eTag = chkE.body.matches[0]?.tag; assert(eTag, "lookup suite: athlete E has a tag");
    // Tag lookup: A only, and the PENDING play does not count.
    let lk = await j3(`/api/athletes/lookup?tag=${encodeURIComponent(aRow.tag)}`);
    assert(lk.status === 200 && lk.body.athletes.length === 1 && lk.body.athletes[0].athlete_id === aRow.athleteKey, "tag lookup finds the athlete");
    assert(lk.body.athletes[0].playCount === 1, "tag lookup counts APPROVED plays only (pending play invisible)");
    assert(lk.body.athletes[0].tag === aRow.tag && lk.body.athletes[0].team === "Hawks" && /Sam/.test(lk.body.athletes[0].name), "tag lookup returns public name + team + tag");
    lk = await j3(`/api/athletes/lookup?tag=${encodeURIComponent(aRow.tag.toLowerCase())}`);
    assert(lk.body.athletes.length === 1, "tag lookup is case-insensitive");
    lk = await j3(`/api/athletes/lookup?tag=${encodeURIComponent(aRow.athleteKey)}`);
    assert(lk.body.athletes.length === 1 && lk.body.athletes[0].athlete_id === aRow.athleteKey, "lookup also accepts the athlete_id");
    // Email lookup: A and B, listed side by side, never merged.
    lk = await j3(`/api/athletes/lookup?email=${encodeURIComponent(G)}`);
    assert(lk.status === 200 && lk.body.athletes.length === 2, "email lookup lists BOTH athletes behind one guardian email");
    assert(new Set(lk.body.athletes.map((a) => a.athlete_id)).size === 2, "email lookup never merges athletes");
    assert(lk.body.athletes.every((a) => a.playCount === 1), "email lookup counts approved plays only");
    // No-match is one generic empty list in every flavor.
    for (const [q, label] of [[`email=${encodeURIComponent("nobody@example.com")}`, "unknown email"], ["tag=HH-0000", "unknown tag"], [`email=${encodeURIComponent("pendingonly@example.com")}`, "email whose athlete has no approved play"], [`tag=${encodeURIComponent(eTag)}`, "tag of a pending-only athlete"], ["", "empty query"]]) {
      const r = await j3(`/api/athletes/lookup${q ? "?" + q : ""}`);
      assert(r.status === 200 && r.body.ok && Array.isArray(r.body.athletes) && r.body.athletes.length === 0, `lookup no-match is the same generic empty list: ${label}`);
    }
    // Privacy: NO lookup response may carry a guardian email, phone or
    // any private column name — check the raw bodies.
    const rawEmail = await (await fetch(`${base3}/api/athletes/lookup?email=${encodeURIComponent(G)}`)).text();
    const rawTag = await (await fetch(`${base3}/api/athletes/lookup?tag=${encodeURIComponent(aRow.tag)}`)).text();
    for (const raw of [rawEmail, rawTag]) {
      assert(!raw.includes(G) && !raw.includes("pendingonly@example.com"), "lookup response never contains a guardian email");
      assert(!raw.includes(PHONE) && !raw.includes("5165550142"), "lookup response never contains a guardian phone");
      assert(!/"(notify_email|guardian_phone|guardian_email|email_hash|text_consent)"/.test(raw), "lookup response carries no private field names");
    }
    // The id the lookup hands out feeds the EXISTING collection, which
    // serves approved plays only.
    const coll = await j3(`/api/highlights?athlete_id=${encodeURIComponent(aRow.athleteKey)}`);
    assert(coll.body.highlights.length === 1 && coll.body.highlights[0].id === a1, "lookup athlete_id opens the existing collection with approved plays only");
    // Client wiring: the panel form + results live in the page, and
    // app.js drives them into the lookup endpoint.
    const home3 = fs.readFileSync(new URL("public/index.html", import.meta.url), "utf8");
    const app3 = fs.readFileSync(new URL("public/app.js", import.meta.url), "utf8");
    assert(home3.includes('id="mineFind"') && home3.includes('id="mineEmail"') && home3.includes('id="mineTag"') && home3.includes('id="mineFindResults"'), "My Highlights panel carries the lookup form + results");
    assert(app3.includes("/api/athletes/lookup") && app3.includes("mineFind"), "app.js wires the lookup form to the endpoint");
    // Rate limit (LAST in this suite): repeated lookups eventually 429.
    let limited = null;
    for (let i = 0; i < 60 && !limited; i++) { const r = await j3(`/api/athletes/lookup?email=${encodeURIComponent("probe" + i + "@example.com")}`); if (r.status === 429) limited = r; }
    assert(limited && /Too many lookups/.test(limited.body.message || ""), "lookup endpoint rate-limits repeated probing (429)");
  } finally { child3.kill(); fs.rmSync(tmp3, { recursive: true, force: true }); }
  // 8e. Round 121 (2026-11-12): the posting chain — the upload
  // response carries the athlete tag; an EMAIL lookup returns the
  // guardian's own plays in EVERY status (pending included, with
  // inContest flags), never leaking the address; contest entry is
  // gated to the posting guardian (email match, trimmed +
  // case-insensitive) or the owner token, and a play with no
  // guardian email on file refuses everyone but the owner.
  // Own scratch server (the 8c pattern) — fresh rate limiters.
  const tmp5 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r121-"));
  const PORT5 = 3477, base5 = `http://localhost:${PORT5}`;
  const child5 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT5), DATA_DIR: tmp5 }, stdio: "pipe" });
  const j5 = async (p, opts = {}) => { const r = await fetch(base5 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  const enter5 = (payload, tok5) => j5("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json", ...(tok5 ? { "x-owner-token": tok5 } : {}) }, body: JSON.stringify(payload) });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base5 + "/api/health"); break; } catch { await wait(200); } }
    const tok5 = (await j5("/api/owner/claim", { method: "POST" })).body.token; assert(tok5, "r121: owner claim returns token");
    const G5 = "Guardian@Example.com"; // mixed case on purpose: matching is case-insensitive
    const mk5 = async (fields) => {
      const r = await j5("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true", ...fields }) });
      assert(r.status === 201, `r121: play created (${fields.title})`);
      return r.body;
    };
    const approve5 = async (id) => { const r = await j5(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok5 }, body: JSON.stringify({ status: "approved" }) }); assert(r.body.status === "approved", "r121: play approved"); };
    // (1) The upload response carries the athlete's HH tag.
    const up5 = await mk5({ title: "R121 Pending Play", playerName: "Pia", notifyEmail: G5 });
    assert(/^HH-\d{4}$/.test(up5.athlete_tag || ""), "r121: upload response includes the athlete tag (HH-####)");
    // (2) Email lookup: the pending play IS listed, with its status —
    // and the response never carries the address itself.
    let lk5 = await j5(`/api/athletes/lookup?email=${encodeURIComponent("guardian@example.com")}`);
    assert(lk5.status === 200 && Array.isArray(lk5.body.plays) && lk5.body.plays.length === 1, "r121: email lookup returns the guardian's plays");
    const lp5 = lk5.body.plays[0];
    assert(lp5.id === up5.id && lp5.status === "pending" && lp5.inContest === false && lp5.athlete_tag === up5.athlete_tag, "r121: the pending play shows with status=pending + its tag");
    const raw5 = await (await fetch(`${base5}/api/athletes/lookup?email=${encodeURIComponent("guardian@example.com")}`)).text();
    assert(!raw5.includes("guardian@example.com") && !raw5.includes("Guardian@Example.com") && !/"(notify_email|guardian_phone|guardian_email|email_hash|notify_email_hash|text_consent)"/.test(raw5), "r121: lookup response carries no guardian email or private field names");
    // A stranger's email sees nothing; a TAG lookup never returns plays.
    lk5 = await j5(`/api/athletes/lookup?email=${encodeURIComponent("stranger@example.com")}`);
    assert(lk5.body.plays.length === 0 && lk5.body.athletes.length === 0, "r121: an unmatched email returns no plays");
    lk5 = await j5(`/api/athletes/lookup?tag=${encodeURIComponent(up5.athlete_tag)}`);
    assert(Array.isArray(lk5.body.plays) && lk5.body.plays.length === 0, "r121: tag lookups never return the plays list (public path unchanged)");
    // (3) Enter gating on an approved play WITH a guardian email.
    await approve5(up5.id);
    let en5 = await enter5({ highlightId: up5.id });
    assert(en5.status === 403 && /doesn't match the one used to post/.test(en5.body.message), "r121: a stranger's one-tap enter is refused (403, plain-words reason)");
    en5 = await enter5({ highlightId: up5.id, email: "someoneelse@example.com" });
    assert(en5.status === 403 && /doesn't match the one used to post/.test(en5.body.message), "r121: a wrong email is refused with the same message");
    en5 = await enter5({ highlightId: up5.id, email: "  GUARDIAN@example.com " });
    assert(en5.status === 201 && en5.body.ok && en5.body.message === "🏆 Entered! Good luck.", "r121: the posting guardian's email (trimmed, any case) enters the play");
    en5 = await enter5({ highlightId: up5.id, email: "guardian@example.com" });
    assert(en5.body.alreadyEntered === true, "r121: a second guardian enter reports already-entered");
    lk5 = await j5(`/api/athletes/lookup?email=${encodeURIComponent("guardian@example.com")}`);
    assert(lk5.body.plays[0].status === "approved" && lk5.body.plays[0].inContest === true, "r121: the lookup now flags the play approved + entered in the contest");
    // (4) A play with NO guardian email: strangers AND email-guessers
    // are refused; only the owner can enter it.
    const up5b = await mk5({ title: "R121 No Email Play", playerName: "Noe" });
    await approve5(up5b.id);
    en5 = await enter5({ highlightId: up5b.id, email: "guardian@example.com" });
    assert(en5.status === 403 && /no guardian email is on file/.test(en5.body.message), "r121: a no-email play refuses a guardian-path enter");
    en5 = await enter5({ highlightId: up5b.id }, tok5);
    assert(en5.status === 201 && en5.body.ok, "r121: the owner token enters a no-email play (override path)");
    const contest5 = await j5("/api/contest");
    assert(contest5.body.totalEntries === 2, "r121: both gated entries landed on the contest board");
  } finally { child5.kill(); fs.rmSync(tmp5, { recursive: true, force: true }); }
  // 8d. Site stats (first-party, aggregate only): POST /api/track
  // increments daily counters behind a strict allowlist, and
  // GET /api/owner/stats serves the combined owner view. Own scratch
  // server again (the 8b/8c pattern): the track rate limiter and the
  // counters stay isolated from every other suite.
  const tmp4 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-stats-"));
  const PORT4 = 3465, base4 = `http://localhost:${PORT4}`;
  const child4 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT4), DATA_DIR: tmp4 }, stdio: "pipe" });
  const j4 = async (p, opts = {}) => { const r = await fetch(base4 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  const track4 = (evt) => j4("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(evt) });
  try {
    for (let i = 0; i < 50; i++) { try { await fetch(base4 + "/api/health"); break; } catch { await wait(200); } }
    const claim4 = await j4("/api/owner/claim", { method: "POST" });
    const tok4 = claim4.body.token; assert(tok4, "stats suite: owner claim returns token");
    const mkPlay4 = async (title) => {
      const r = await j4("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, sport: "soccer", playerName: "Sam Stats", team: "Hawks", notifyEmail: "stats-guardian@example.com", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
      assert(r.status === 201, `stats suite: play created (${title})`);
      const ap = await j4(`/api/highlights/${r.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok4 }, body: JSON.stringify({ status: "approved" }) });
      assert(ap.body.status === "approved", "stats suite: play approved");
      return r.body.id;
    };
    const sp1 = await mkPlay4("Stats Play One");
    const sp2 = await mkPlay4("Stats Play Two");
    const vt = await j4(`/api/highlights/${sp1}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "stats-voter" }) });
    assert(vt.body.voteCount === 1, "stats suite: vote cast (feeds the existing-system totals)");
    // Valid events: views across the four main views, opens of both
    // plays, and one arrival per referrer flavor.
    for (const [evt, n] of [[{ kind: "view", key: "home" }, 2], [{ kind: "view", key: "store" }, 1], [{ kind: "view", key: "mine" }, 1], [{ kind: "view", key: "how" }, 1], [{ kind: "play_open", key: String(sp1) }, 3], [{ kind: "play_open", key: String(sp2) }, 1], [{ kind: "battle_pick", key: String(sp1) }, 2]]) {
      for (let i = 0; i < n; i++) { const r = await track4(evt); assert(r.status === 200 && r.body.ok, `track accepts ${evt.kind}:${evt.key}`); }
    }
    for (const refKey of ["https://l.instagram.com/some/path?x=1", "www.google.com", "totally-unknown-site.example", "direct"]) {
      const r = await track4({ kind: "referrer", key: refKey });
      assert(r.status === 200 && r.body.ok, `track accepts referrer (normalized server-side): ${refKey.slice(0, 28)}`);
    }
    // Owner stats: auth first, then the combined shape.
    let st = await j4("/api/owner/stats");
    assert(st.status === 403, "owner stats refuses requests with NO token");
    st = await j4("/api/owner/stats", { headers: { "x-owner-token": "wrong-token" } });
    assert(st.status === 403, "owner stats refuses a WRONG token");
    st = await j4("/api/owner/stats", { headers: { "x-owner-token": tok4 } });
    assert(st.status === 200 && st.body.ok, "owner stats answers the owner");
    const V = st.body.views, PO = st.body.playOpens, T = st.body.totals;
    assert(V.today === 5 && V.last7Days === 5 && V.last30Days === 5 && V.allTime === 5, "stats: view totals (today / 7d / 30d / all time) count the tracked views");
    assert(V.byView.home === 2 && V.byView.store === 1 && V.byView.mine === 1 && V.byView.how === 1, "stats: views broken down by main view");
    assert(Array.isArray(V.daily) && V.daily.length === 30 && V.daily[29].count === 5 && V.daily.reduce((s, d) => s + d.count, 0) === 5, "stats: 30-day daily series, zero-filled, sums to the tracked views");
    assert(V.daily[29].day === new Date().toISOString().slice(0, 10), "stats: daily series ends today (UTC)");
    assert(PO.total === 4, "stats: play opens total counts every open");
    assert(PO.top.length === 2 && PO.top[0].id === sp1 && PO.top[0].title === "Stats Play One" && PO.top[0].opens === 3 && PO.top[1].id === sp2 && PO.top[1].opens === 1, "stats: top plays by opens, with titles, most-opened first");
    const refMap = Object.fromEntries((st.body.referrers || []).map((r) => [r.key, r.count]));
    assert(refMap["instagram.com"] === 1 && refMap["google.com"] === 1 && refMap.other === 1 && refMap.direct === 1 && Object.keys(refMap).length === 4, "stats: referrers bucketed (subdomain + full URL -> base host; unknown host -> other; direct stays direct)");
    assert(T.votes === 1 && T.plays.total === 2 && T.plays.approved === 2 && T.plays.pending === 0 && T.plays.hidden === 0, "stats: existing-system totals read from the live tables (votes, plays by status)");
    assert(T.athletes === 1 && T.hypeFrameOrders === 0, "stats: athletes + Hype Frame order counts present (one shared guardian = one athlete)");
    assert(st.body.battles && st.body.battles.total === 2, "stats: battle picks counted (Round 91)");
    // Invalid events: refused with 400 (never a 500), and NOT counted.
    for (const [evt, label] of [[{ kind: "bogus", key: "x" }, "unknown kind"], [{ kind: "view", key: "nope" }, "unknown view key"], [{ kind: "view" }, "missing view key"], [{ kind: "play_open", key: "999999" }, "play that does not exist"], [{ kind: "play_open", key: "abc" }, "non-numeric play key"], [{ kind: "battle_pick", key: "999999" }, "battle pick for a play that does not exist"], [{}, "empty event"]]) {
      const r = await track4(evt);
      assert(r.status === 400, `track refuses with 400: ${label}`);
    }
    const badBody = await fetch(base4 + "/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: "not-json{{" });
    assert(badBody.status === 400, "track refuses a malformed JSON body with 400 (never a 500)");
    st = await j4("/api/owner/stats", { headers: { "x-owner-token": tok4 } });
    assert(st.body.views.allTime === 5 && st.body.playOpens.total === 4, "stats: refused events were not counted");
    // Privacy, at the storage layer: the events table has ONLY
    // day/kind/key/count columns, and no stored row contains an IP
    // or any user-agent text — there is nowhere for either to live.
    let statsDb = null;
    for (let i = 0; i < 10 && !statsDb; i++) { try { statsDb = new DatabaseSync(path.join(tmp4, "highlighthype.db"), { readOnly: true }); } catch { await wait(200); } }
    assert(statsDb, "stats suite: scratch DB opens for the storage audit");
    const cols = statsDb.prepare("PRAGMA table_info(stat_events)").all().map((c) => c.name);
    assert(JSON.stringify(cols) === JSON.stringify(["day", "kind", "key", "count"]), "stat_events columns are exactly day/kind/key/count (no IP, no user agent, no per-visitor field)");
    const rows = statsDb.prepare("SELECT * FROM stat_events").all();
    assert(rows.length === 11, "stat_events key space stays bounded: 4 view keys + 2 plays + 1 battle play + 4 referrer buckets = 11 rows for 15 events");
    const rowsRaw = JSON.stringify(rows);
    assert(!rowsRaw.includes("127.0.0.1") && !/mozilla|user-?agent/i.test(rowsRaw), "no stored stat row contains an IP address or user-agent text");
    statsDb.close();
    // Client wiring: the panel lives in the owner view and app.js
    // drives both the tracker and the stats endpoint.
    const home4 = fs.readFileSync(new URL("public/index.html", import.meta.url), "utf8");
    const app4 = fs.readFileSync(new URL("public/app.js", import.meta.url), "utf8");
    assert(home4.includes('id="ownerStats"'), "owner panel carries the Site stats section");
    assert(app4.includes("/api/track") && app4.includes("trackEvent") && app4.includes("/api/owner/stats"), "app.js wires the tracker + owner stats endpoint");
    // Rate limit (LAST in this suite): the generous per-IP budget
    // eventually trips, and once tripped it stays tripped.
    let floodOk = 0, firstLimitedAt = -1, postLimitOk = 0;
    for (let i = 0; i < 400; i++) {
      const r = await track4({ kind: "view", key: "home" });
      if (r.status === 429) { if (firstLimitedAt < 0) firstLimitedAt = i; }
      else if (r.status === 200) { if (firstLimitedAt >= 0) postLimitOk++; else floodOk++; }
    }
    assert(firstLimitedAt >= 0, "track rate limiter trips under probing (429)");
    assert(floodOk >= 200, "track rate limit is generous (hundreds of events pass before it trips)");
    assert(postLimitOk === 0, "track rate limiter stays tripped once hit");
    st = await j4("/api/owner/stats", { headers: { "x-owner-token": tok4 } });
    assert(st.body.views.allTime <= 5 + 300, "rate-limited events never reach the counters");
  } finally { child4.kill(); fs.rmSync(tmp4, { recursive: true, force: true }); }
  // 8d. Round 100 — Daily Battle, play badges, Hawks Founding
  // Plays, Celebration Spotlight, Battle Run. Runs on its OWN
  // scratch servers so the main suite's upload budget (section 9)
  // is untouched.
  {
    const startSrv100 = async (port, dir) => {
      const ch = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: dir, AI_VISION_API_KEY: "" }, stdio: "pipe" });
      for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/api/health`); break; } catch { await wait(200); } }
      return ch;
    };
    const mkJ100 = (port) => async (p, opts = {}) => { const r = await fetch(`http://localhost:${port}` + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const etDay100 = (offset) => {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      const g = (t) => (parts.find((x) => x.type === t) || {}).value;
      const d = new Date(`${g("year")}-${g("month")}-${g("day")}T12:00:00Z`);
      d.setUTCDate(d.getUTCDate() + offset);
      return d.toISOString().slice(0, 10);
    };
    const up100 = async (jj, tok, fields, sample) => {
      const c = await jj("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true", ...fields }) });
      assert(c.status === 201, `r100 upload: ${fields.title}`);
      const st = await jj(`/api/highlights/${c.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify(sample ? { status: "approved", sample: true } : { status: "approved" }) });
      assert(st.body.ok, `r100 approve: ${fields.title}`);
      return c.body.id;
    };

    // ---- Server A: practice daily, badges, Hawks, spotlight, setter ----
    const tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r100a-"));
    const childA = await startSrv100(3471, tmpA);
    try {
      const jA = mkJ100(3471);
      const tokA = (await jA("/api/owner/claim", { method: "POST" })).body.token;
      assert(tokA, "r100 A: owner claim");
      const s1 = await up100(jA, tokA, { title: "Sample One", sport: "basketball", division: "boys", playerName: "Demo A" }, true);
      const s2 = await up100(jA, tokA, { title: "Sample Two", sport: "basketball", division: "boys", playerName: "Demo B" }, true);
      // Practice daily: only samples approved -> sample matchup.
      let d = await jA("/api/daily-battle");
      assert(d.body.available === true && d.body.practice === true, "r100: daily auto-picks a PRACTICE matchup from the sample pool");
      assert(!("split" in d.body) && !d.body.yourPick, "r100: no split and no pick before picking (anonymous read)");
      d = await jA("/api/daily-battle?voterToken=dp1");
      assert(d.body.yourPick === null && !("split" in d.body), "r100: split stays hidden for a voter who has not picked");
      let pk = await jA("/api/daily-battle/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "dp1", pickId: s1 }) });
      assert(pk.body.yourPick === s1 && pk.body.split && pk.body.split.total === 1 && pk.body.split.aPct + pk.body.split.bPct === 100, "r100: split reveals after picking");
      pk = await jA("/api/daily-battle/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "dp1", pickId: s2 }) });
      assert(pk.body.yourPick === s1 && pk.body.split.total === 1, "r100: a daily pick is LOCKED — a second post cannot change it");
      let pubA = await jA("/api/highlights");
      assert(pubA.body.highlights.find((h) => h.id === s1).voteCount === 0, "r100: practice picks cast NO votes");
      assert(pubA.body.highlights.every((h) => Array.isArray(h.badges) && h.badges.length === 0), "r100: sample plays never carry badges");
      // Real plays: one athlete (Sam) x3 + a lowercase-Hawks play.
      const sam = { playerName: "Sam", notifyEmail: "sam@example.com", team: "Plainview Hawks" };
      const r1 = await up100(jA, tokA, { title: "Real Alpha", sport: "baseball", division: "boys", ...sam });
      const r2 = await up100(jA, tokA, { title: "Real Beta", sport: "baseball", division: "boys", ...sam });
      const r3 = await up100(jA, tokA, { title: "Real Gamma", sport: "soccer", division: "boys", ...sam });
      const h2 = await up100(jA, tokA, { title: "Hawks Two", sport: "football", division: "boys", playerName: "Pat", notifyEmail: "pat@example.com", team: "plainview hawks" });
      const pend = await jA("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Still Pending", sport: "golf", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
      pubA = await jA("/api/highlights");
      const byId = Object.fromEntries(pubA.body.highlights.map((h) => [h.id, h]));
      assert(byId[r1].badges.includes("first_hype"), "r100: the athlete's earliest real play carries First Hype");
      assert(!byId[r2].badges.includes("first_hype") && !byId[r3].badges.includes("first_hype"), "r100: later plays for the same athlete do NOT carry First Hype");
      assert(byId[h2].badges.includes("first_hype"), "r100: a different athlete's first play carries its own First Hype");
      assert(pubA.body.hawksFounding && pubA.body.hawksFounding.count === 4 && pubA.body.hawksFounding.goal === 10, "r100: Hawks founding count = approved non-sample Hawks plays (case-insensitive team match)");
      // Owner setter: auth, locked day, valid set, invalid sets.
      let os = await jA("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: etDay100(1), playAId: r1, playBId: r2 }) });
      assert(os.status === 403, "r100: owner daily setter requires the owner token");
      os = await jA("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ date: etDay100(0), playAId: r1, playBId: r2 }) });
      assert(os.status === 400, "r100: today's matchup is locked once it has picks");
      os = await jA("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ date: etDay100(1), playAId: r1, playBId: r2 }) });
      assert(os.body.ok === true && os.body.practice === false, "r100: owner sets tomorrow's REAL matchup");
      os = await jA("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ date: etDay100(2), playAId: r1, playBId: r1 }) });
      assert(os.status === 400, "r100: owner setter refuses the same play twice");
      os = await jA("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ date: etDay100(2), playAId: r1, playBId: pend.body.id }) });
      assert(os.status === 400, "r100: owner setter refuses a play that is not approved");
      // Celebration spotlight.
      let ce = await jA(`/api/highlights/${r1}/celebration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spotlight: true }) });
      assert(ce.status === 403, "r100: celebration toggle requires the owner token");
      ce = await jA(`/api/highlights/${s1}/celebration`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ spotlight: true }) });
      assert(ce.status === 400, "r100: a sample play cannot hold the Celebration Spotlight");
      ce = await jA(`/api/highlights/${r1}/celebration`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ spotlight: true }) });
      assert(ce.body.ok && ce.body.spotlightId === r1, "r100: spotlight set on a real play");
      pubA = await jA("/api/highlights");
      assert(pubA.body.highlights.find((h) => h.id === r1).badges.includes("best_celebration"), "r100: spotlight shows as the Best Celebration badge");
      ce = await jA(`/api/highlights/${r2}/celebration`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokA }, body: JSON.stringify({ spotlight: true }) });
      assert(ce.body.spotlightId === r2, "r100: setting a new spotlight clears the old one");
      pubA = await jA("/api/highlights");
      assert(!pubA.body.highlights.find((h) => h.id === r1).badges.includes("best_celebration") && pubA.body.highlights.find((h) => h.id === r2).badges.includes("best_celebration"), "r100: exactly one play holds the spotlight");
    } finally { childA.kill(); fs.rmSync(tmpA, { recursive: true, force: true }); }

    // ---- Server B: real daily vote, finalization, Battle Run ----
    const tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r100b-"));
    let childB = await startSrv100(3472, tmpB);
    const jB = mkJ100(3472);
    const tokB = (await jB("/api/owner/claim", { method: "POST" })).body.token;
    const pair = async (sport, t1, t2, who) => [await up100(jB, tokB, { title: t1, sport, division: "boys", playerName: who, notifyEmail: `${who.toLowerCase()}@example.com` }), await up100(jB, tokB, { title: t2, sport, division: "boys", playerName: who, notifyEmail: `${who.toLowerCase()}@example.com` })];
    const [A1, A2] = await pair("baseball", "A One", "A Two", "Al");
    const [B1, B2] = await pair("soccer", "B One", "B Two", "Bo");
    const [C1, C2] = await pair("football", "C One", "C Two", "Cy");
    const [D1, D2] = await pair("hockey", "D One", "D Two", "Di");
    const [E1, E2] = await pair("tennis", "E One", "E Two", "Ed");
    const [G1, G2] = await pair("lacrosse", "G One", "G Two", "Gil");
    const solo = await up100(jB, tokB, { title: "Solo Play", sport: "golf", division: "boys", playerName: "Sol", notifyEmail: "sol@example.com" });
    // Today's daily is the first real same-sport pair (A baseball).
    await jB("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: A1, email: "al@example.com" }) });
    let dB = await jB("/api/daily-battle?voterToken=rb1");
    assert(dB.body.available && dB.body.practice === false && dB.body.a.id === A1 && dB.body.b.id === A2, "r100: today's daily auto-picks the first real same-sport pair");
    let pkB = await jB("/api/daily-battle/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "rb1", pickId: A1 }) });
    assert(pkB.body.yourPick === A1 && pkB.body.split.total === 1, "r100: real daily pick lands and reveals the split");
    let contestB = await jB("/api/contest?voterToken=rb1");
    const entryA1 = contestB.body.entries.find((e) => e.id === A1);
    assert(entryA1 && entryA1.voteCount === 1 && entryA1.hasVoted === true, "r100: a real daily pick casts a normal vote for a contest entry");
    pkB = await jB("/api/daily-battle/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "rb1", pickId: A2 }) });
    assert(pkB.body.yourPick === A1, "r100: real daily pick is locked too");
    let run = await jB("/api/battle-run?voterToken=rb2");
    assert(run.body.available === false && run.body.finalizedCount === 0, "r100: Battle Run locked with no finalized matchups");
    childB.kill();
    await wait(600);
    // Surgery: five finalized decisive dailies + one unfinalized past
    // daily (lazy finalization must close it on the next read).
    const dbB = new DatabaseSync(path.join(tmpB, "highlighthype.db"));
    dbB.exec("PRAGMA busy_timeout=5000");
    const insD = dbB.prepare("INSERT INTO daily_battles(date,play_a_id,play_b_id,practice,finalized,winner_id,final_a_picks,final_b_picks) VALUES(?,?,?,0,?,?,?,?)");
    const insP = dbB.prepare("INSERT INTO daily_battle_picks(daily_id,voter_token,pick_id) VALUES(?,?,?)");
    const seed = (off, a, b, fin, winner, fa, fb, picks) => {
      const info = insD.run(etDay100(off), a, b, fin, winner, fa, fb);
      const did = Number(info.lastInsertRowid);
      for (const [vt, pid] of picks) insP.run(did, vt, pid);
      return did;
    };
    const dA = seed(-6, A1, A2, 1, A1, 3, 1, [["rb1", A1], ["x1", A1], ["x2", A1], ["x3", A2]]);
    seed(-5, B1, B2, 1, B1, 2, 0, [["y1", B1], ["y2", B1]]);
    seed(-4, C1, C2, 1, C2, 1, 4, [["z1", C1], ["z2", C2], ["z3", C2], ["z4", C2], ["z5", C2]]);
    seed(-3, D1, D2, 1, D1, 4, 2, [["w1", D1], ["w2", D1], ["w3", D1], ["w4", D1], ["w5", D2], ["w6", D2]]);
    const dE = seed(-2, E1, E2, 1, E2, 1, 3, [["v1", E1], ["v2", E2], ["v3", E2], ["v4", E2]]);
    seed(-1, G1, G2, 0, null, 0, 0, [["u1", G1], ["u2", G1], ["u3", G2]]);
    dbB.close();
    childB = await startSrv100(3472, tmpB);
    try {
      run = await jB("/api/battle-run?voterToken=rb2");
      assert(run.body.finalizedCount === 6, "r100: lazy finalization closed yesterday's daily (6 decisive finals)");
      assert(run.body.available === true && run.body.matchups.length === 5, "r100: Battle Run available with 5 eligible matchups");
      assert(run.body.matchups.every((m) => !("winnerId" in m) && !("split" in m)), "r100: Battle Run matchups leak NO winner or split before picking");
      run = await jB("/api/battle-run?voterToken=rb1");
      assert(run.body.available === true && run.body.matchups.every((m) => m.dailyId !== dA), "r100: a matchup the voter played live is excluded from their run");
      let rp = await jB("/api/battle-run/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyId: dE, pickId: E1 }) });
      assert(rp.body.correct === false && rp.body.winnerId === E2 && rp.body.split.aPct === 25 && rp.body.split.bPct === 75, "r100: run pick reveals the winner + final split (wrong pick)");
      rp = await jB("/api/battle-run/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyId: dE, pickId: E2 }) });
      assert(rp.body.correct === true, "r100: run pick scores a correct prediction");
      const tr = async (evt) => { const r = await fetch("http://localhost:3472/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(evt) }); return r.status; };
      assert((await tr({ kind: "battle_run_pick", key: String(dE) })) === 200, "r100: track accepts battle_run_pick");
      assert((await tr({ kind: "battle_run_complete", key: "4" })) === 200, "r100: track accepts battle_run_complete");
      assert((await tr({ kind: "battle_run_complete", key: "9" })) === 400, "r100: track refuses an out-of-range run score");
      assert((await tr({ kind: "battle_run_pick", key: "999999" })) === 400, "r100: track refuses a run pick for an unknown daily");
      const pubB = await jB("/api/highlights");
      const byIdB = Object.fromEntries(pubB.body.highlights.map((h) => [h.id, h]));
      assert(byIdB[A1].badges.includes("battle_tested") && byIdB[G2].badges.includes("battle_tested"), "r100: plays from finalized real dailies carry Battle Tested");
      assert(!byIdB[solo].badges.includes("battle_tested") && byIdB[solo].badges.includes("first_hype"), "r100: a play in no daily has no Battle Tested (but keeps First Hype)");
    } finally { childB.kill(); fs.rmSync(tmpB, { recursive: true, force: true }); }

    // Client wiring for the whole round.
    const home100 = await (await fetch(base + "/")).text();
    assert(home100.includes('id="dailyCard"') && home100.includes('id="runCard"') && home100.includes('id="ownerDaily"') && home100.includes('id="odSave"') && !home100.includes('id="hawksCard"'), "r100/108: homepage carries the Daily/Run cards + owner Daily setter — the Hawks Founding card was removed from the homepage in Round 108 (its count stays in the API payload, asserted above)");
    const app100 = await (await fetch(base + "/app.js")).text();
    assert(app100.includes("/api/daily-battle") && app100.includes("/api/battle-run/pick") && app100.includes("drawRunCard100") && app100.includes("matched the crowd") && !app100.includes("renderHawks100"), "r100/108: app.js wires the daily, the run and the share card — the Hawks card renderer was removed in Round 108");
    assert(home100.includes('id="dailyStrip"') && home100.includes('id="dailyStripPick"') && home100.includes('id="dailyStripSplit"') && home100.includes('id="dailyStripShare"'), "r101: a picked Daily Battle carries a collapsed result strip with the pick, split and its own share button");
    assert(app100.includes("setDailyCollapsed100") && app100.includes("pauseDailyPlayer100") && app100.includes("dailyCollapseTimer") && app100.includes("expandDaily100"), "r101: Daily Battle collapse pauses the player, is timed after a fresh pick, and can be re-expanded from the strip");

    // Round 102 — Battles clarity: A/B identity, one practice
    // label, one-pick sentence, section order, next-battle path.
    const css102 = await (await fetch(base + "/styles.css")).text();
    assert(home100.includes('id="dailyPickA">Pick A</button>') && home100.includes('id="dailyPickB">Pick B</button>') && home100.includes('id="btlPickL">Pick A</button>') && home100.includes('id="btlPickR">Pick B</button>'), "r102: Daily + Battles pick buttons are labeled Pick A / Pick B in the markup");
    assert(app100.includes("btl-letter") && app100.includes("btl-yourpick") && !app100.includes("btl-watchtag"), "r102/104: matchup minis render an A/B letter chip and a Your pick tag; the mini Now watching tag is gone (Round 104 — the big player's banner is the single watching marker; Round 117 retires the Quick player's banner too, leaving the .watching outline — Daily/Run banners remain)");
    assert(app100.includes('textContent = "Pick A"') && app100.includes('textContent = "Pick B"'), "r102: renderers reset the pick buttons to Pick A / Pick B");
    assert(home100.split("Practice matchup · Picks are just for fun").length - 1 === 1 && !home100.includes('id="btlPoolNote"') && home100.includes('id="quickSub111"') && !home100.includes("Sample pool") && !home100.includes('id="btlPractice"') && !home100.includes("don't cast votes yet"), "r102/111: the Daily keeps its one short practice label; the Battles pool label is retired in Round 111 — the Quick Battles sub-line is that section's single explainer, no other practice copy");
    assert(home100.includes("Which Play Wins?") && home100.includes('id="quickTitle111">Quick Battles</p>') && !home100.includes("hit replay"), "r102/111: 'Which Play Wins?' remains the Daily matchup headline; the endless pairs are renamed 'Quick Battles' in Round 111");
    assert(app100.includes("split.total === 1") && app100.includes("pick for <b>"), "r102: a one-pick daily shows a sentence instead of a percentage bar");
    assert(app100.includes("splitHtml100(r.split, r.a, r.b, r.yourPick, r.practice)") && app100.includes("splitHtml100(r.split, r.a, r.b, null, r.practice)"), "r102: both daily split renders (card + strip) receive the practice flag for the one-pick sentence");
    assert(home100.includes('id="dailyAnother"') && home100.includes('id="dailyStripAnother"') && app100.includes("playAnotherBattle102"), "r102: 'Play another battle' sits in the Daily result area and on the collapsed strip");
    assert(home100.indexOf('id="dailyCard"') < home100.indexOf('id="btlMatchup"') && home100.indexOf('id="btlMatchup"') < home100.indexOf('id="runCard"'), "r102: Battles view order is Daily Battle, Fresh Pairs / Winner Stays, Battle Run last");
    assert(css102.includes(".btl-mini.watching{border-color:rgba(245,241,230,.8)") && css102.includes("#viewBattles{padding-bottom:24px}"), "r102/104: watching no longer wears the gold outline; the Battles view flows on with 24px (Round 104 drops the 120px Post-pill void — the pill yields via fab-btl-hidden104)");

    // Round 104 — youth Battles fixes: frozen-frame posters across
    // re-renders, Winner Stays pick-button removal, one watching
    // marker, Post-pill yield, gold Next, pill/chip clearance.
    assert(app100.includes("btlPosters104") && app100.includes("btlCapturePoster104") && app100.includes("fabBattles104") && app100.includes('pickL.style.display = "none"'), "r104: minis cache frozen-frame posters across re-renders, the Post pill yields inside Battles, and Winner Stays removes its pick buttons after a pick");
    assert(css102.includes(".btl-next{background:linear-gradient(180deg,var(--gold),#c9932b)") && css102.includes(".btl-stamp{top:40px}") && css102.includes(".btl-yourpick{top:40px}") && css102.includes(".fab-btl-hidden104"), "r104: Next battle wears the gold family, the pick pills sit below the A/B chip row, and the pill yield state is styled");

    // ---- Server C: Round 105 — challenge payload shape, My
    // Highlights numbers, winner crowns, picker streaks ----
    const tmpC = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r105c-"));
    let childC = await startSrv100(3473, tmpC);
    const jC = mkJ100(3473);
    const LONG105 = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const SHORT105 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dailyTitle105 = (dateStr) => { const [, m, d] = dateStr.split("-").map(Number); return `Daily Winner · ${SHORT105[m - 1]} ${d}`; };
    try {
      const tokC = (await jC("/api/owner/claim", { method: "POST" })).body.token;
      assert(tokC, "r105 C: owner claim");
      const cs1 = await up100(jC, tokC, { title: "C Sample One", sport: "basketball", division: "boys", playerName: "Demo A" }, true);
      const cs2 = await up100(jC, tokC, { title: "C Sample Two", sport: "basketball", division: "boys", playerName: "Demo B" }, true);
      const cr1 = await up100(jC, tokC, { title: "C Real One", sport: "baseball", division: "boys", playerName: "Cam", notifyEmail: "cam@example.com" });
      const cr2 = await up100(jC, tokC, { title: "C Real Two", sport: "baseball", division: "boys", playerName: "Cam", notifyEmail: "cam@example.com" });
      // Feature 3 numbers: 3 play opens + 1 vote for cr1.
      for (let i = 0; i < 3; i++) { const tr = await fetch("http://localhost:3473/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "play_open", key: String(cr1) }) }); assert(tr.status === 200, "r105: play_open tracked"); }
      const vt = await jC(`/api/highlights/${cr1}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "n1" }) });
      assert(vt.body.ok && vt.body.voteCount === 1, "r105: vote lands for the numbers test");
      let pubC = await jC("/api/highlights");
      let byIdC = Object.fromEntries(pubC.body.highlights.map((h) => [h.id, h]));
      assert(byIdC[cr1].views === 3 && byIdC[cr1].votesMonth === 1 && byIdC[cr1].battleWins === 0, "r105: numbers payload — views from play_open stats, this month's votes, zero battle wins");
      assert(Array.isArray(byIdC[cr1].crowns) && byIdC[cr1].crowns.length === 0, "r105: crowns payload shape — an empty array before any win");
      assert(byIdC[cs1].views === 0 && byIdC[cs1].votesMonth === 0 && byIdC[cs1].battleWins === 0, "r105: truthful zeros for an untouched play");
      // Surgery: three PRE-finalized days (streak math + no-backfill
      // evidence) and two UNfinalized days the new code must close
      // (a real daily and a PRACTICE daily).
      childC.kill();
      await wait(600);
      const dbC = new DatabaseSync(path.join(tmpC, "highlighthype.db"));
      dbC.exec("PRAGMA busy_timeout=5000");
      const insDC = dbC.prepare("INSERT INTO daily_battles(date,play_a_id,play_b_id,practice,finalized,winner_id,final_a_picks,final_b_picks) VALUES(?,?,?,?,?,?,?,?)");
      const insPC = dbC.prepare("INSERT INTO daily_battle_picks(daily_id,voter_token,pick_id) VALUES(?,?,?)");
      const seedC = (off, a, b, practice, fin, winner, fa, fb, picks) => { const info = insDC.run(etDay100(off), a, b, practice, fin, winner, fa, fb); const did = Number(info.lastInsertRowid); for (const [vtk, pid] of picks) insPC.run(did, vtk, pid); return did; };
      seedC(-3, cs1, cs2, 1, 1, cs1, 3, 0, [["win3", cs1], ["broken", cs1], ["loser1", cs1]]);
      seedC(-2, cs1, cs2, 1, 1, cs1, 3, 0, [["win3", cs1], ["late2", cs1], ["loser1", cs1]]);
      seedC(-1, cs1, cs2, 1, 1, cs2, 1, 3, [["win3", cs2], ["late2", cs2], ["broken", cs2], ["loser1", cs1]]);
      seedC(-4, cr1, cr2, 0, 0, null, 0, 0, [["c1", cr1], ["c2", cr1], ["c3", cr2]]);
      seedC(-5, cs1, cs2, 1, 0, null, 0, 0, [["p1", cs1], ["p2", cs1], ["p3", cs2]]);
      dbC.close();
      childC = await startSrv100(3473, tmpC);
      // Feature 4: the first daily read lazily finalizes days -4/-5.
      let dWin = await jC("/api/daily-battle?voterToken=win3");
      assert(dWin.body.streak && dWin.body.streak.current === 3 && dWin.body.streak.best === 3, "r105: streak — three straight winning picks ending at the latest final = 3");
      assert(Array.isArray(dWin.body.topPickers) && dWin.body.topPickers.length === 2 && dWin.body.topPickers[0].streak === 3 && dWin.body.topPickers.some((t) => t.streak === 2), "r105: Top Pickers — the two streaks >= 2, longest first");
      assert(dWin.body.topPickers.every((t) => /^Fan #[0-9A-F]{4}$/.test(t.tag)) && dWin.body.topPickers[0].tag !== dWin.body.topPickers[1].tag, "r105: Top Pickers rows are distinct anonymous fan tags");
      let dLose = await jC("/api/daily-battle?voterToken=loser1");
      assert(dLose.body.streak.current === 0 && dLose.body.streak.best === 2, "r105: streak — picking the loser on the latest final resets current to 0, best keeps 2");
      let dBroken = await jC("/api/daily-battle?voterToken=broken");
      assert(dBroken.body.streak.current === 1 && dBroken.body.streak.best === 1, "r105: streak — a missed finalized day breaks the chain (win, miss, win = 1)");
      let dAnon = await jC("/api/daily-battle");
      assert(!("streak" in dAnon.body) && Array.isArray(dAnon.body.topPickers), "r105: anonymous reads get Top Pickers but no personal streak");
      // Feature 5: crowns landed at finalization — and ONLY there.
      pubC = await jC("/api/highlights");
      byIdC = Object.fromEntries(pubC.body.highlights.map((h) => [h.id, h]));
      assert(byIdC[cr1].crowns.length === 1 && byIdC[cr1].crowns[0].kind === "daily" && byIdC[cr1].crowns[0].title === dailyTitle105(etDay100(-4)), "r105: lazy finalization crowned the real Daily winner with its dated title");
      assert(byIdC[cr1].battleWins === 1 && byIdC[cr2].crowns.length === 0, "r105: battle wins count the finalized victory; the loser wears no crown");
      assert(byIdC[cs1].crowns.some((c) => c.title === dailyTitle105(etDay100(-5))), "r105: a PRACTICE daily crowns its sample winner too (samples included)");
      assert(!byIdC[cs1].crowns.some((c) => c.title === dailyTitle105(etDay100(-3))) && !byIdC[cs2].crowns.some((c) => c.title === dailyTitle105(etDay100(-1))), "r105: NO backfill — winners finalized before the crown table existed stay uncrowned");
      assert(byIdC[cs1].battleWins === 3 && byIdC[cs2].battleWins === 1, "r105: battle wins count every persisted finalized victory (crowned or not)");
      assert(byIdC[cs1].voteCount === 0 && byIdC[cs1].votesMonth === 0, "r105: practice picks cast NO votes — before, during or after finalization");
      // Monthly crown: awarded at crowning, MOVES on a re-crown.
      const period105 = new Date().toISOString().slice(0, 7);
      const monthlyTitle105 = `Hype of the Month · ${LONG105[Number(period105.slice(5, 7)) - 1]} ${period105.slice(0, 4)}`;
      await jC("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: cr1, email: "cam@example.com" }) });
      await jC("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: cr2, email: "cam@example.com" }) });
      let win = await jC("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokC }, body: JSON.stringify({ highlightId: cr2, period: period105 }) });
      assert(win.body.ok, "r105: owner crowns the month winner");
      pubC = await jC("/api/highlights");
      byIdC = Object.fromEntries(pubC.body.highlights.map((h) => [h.id, h]));
      assert(byIdC[cr2].crowns.some((c) => c.kind === "monthly" && c.title === monthlyTitle105), "r105: the monthly crown lands with its month title");
      assert(!byIdC[cr1].crowns.some((c) => c.kind === "monthly"), "r105: the runner-up holds no monthly crown");
      win = await jC("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tokC }, body: JSON.stringify({ highlightId: cr1, period: period105 }) });
      assert(win.body.ok, "r105: re-crown accepted");
      pubC = await jC("/api/highlights");
      byIdC = Object.fromEntries(pubC.body.highlights.map((h) => [h.id, h]));
      assert(byIdC[cr1].crowns.some((c) => c.kind === "monthly" && c.title === monthlyTitle105) && !byIdC[cr2].crowns.some((c) => c.kind === "monthly"), "r105: a re-crown MOVES the monthly crown to the new winner");
      assert(byIdC[cr1].crowns.filter((c) => c.kind === "daily").length === 1, "r105: the daily crown survives the monthly moves (crowns accumulate per kind)");
      // Client wiring for the round.
      const home105 = await (await fetch("http://localhost:3473/")).text();
      const app105 = await (await fetch("http://localhost:3473/app.js")).text();
      const css105 = await (await fetch("http://localhost:3473/styles.css")).text();
      assert(home105.includes('id="dailyStreak105"') && home105.includes('id="dailyTop105"') && home105.includes('id="dailyTopList"') && home105.includes('id="btlShareChallenge"') && home105.includes('id="btlChallengeNote"') && home105.includes('src="app.js?v=161"'), "r105: markup carries the streak line, Top Pickers block, challenge share + note, and current (v147, →148) assets — →149: now v148 (Round 149) — →150: now v149 (Round 150) — →151: now v150 (Round 151) — →152: now v151 (Round 152) — →153: now v152 (Round 153) — →154: now v153 (Round 154) — →155: now v154 (Round 155) — →156: now v155 (Round 156) — →157: now v156 (Round 157) — →158: now v157 (Round 158) — →159: now v158 (Round 159) — →160: now v159 (Round 160) — →161: now v160 (Round 161) — →162: now v161 (Round 162)");
      assert(app105.includes("You got challenged — which play wins?") && app105.includes("challenge=${L}-${R}") && app105.includes("btlShare105") && app105.includes("crownsHtml105") && app105.includes("numbersHtml105") && app105.includes("renderStreak105") && app105.includes("Your streak: "), "r105/r122: app.js wires challenge share + landing, crown/number renderers and the (Round 122: always-visible) streak display");
      assert(css105.includes(".crown-chip") && css105.includes(".daily-top105") && css105.includes(".play-numbers105") && css105.includes(".btl-challenge-note"), "r105: styles carry the crown chips, Top Pickers block, numbers line and challenge note");
    } finally { childC.kill(); fs.rmSync(tmpC, { recursive: true, force: true }); }
  }

  // 8c. Upload Assist (Round 99): this server runs with an empty
  // AI_VISION_API_KEY, i.e. the assist is OFF — the endpoint must
  // answer {configured:false}, still validate frame shape and the
  // payload cap, and the form must carry the assist markup. (The
  // configured path is rig-verified separately against a stub model;
  // the AI label storage is asserted in test-text-consent.js.)
  const assistOff = await j("/api/upload-assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frames: ["data:image/jpeg;base64,/9j/4AAQSkZJRg=="] }) });
  assert(assistOff.status === 200 && assistOff.body.configured === false, "upload-assist answers {configured:false} with no key set");
  const assistBad = await j("/api/upload-assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frames: ["https://example.com/x.jpg"] }) });
  assert(assistBad.status === 400, "upload-assist rejects non-image frames (400)");
  const bigRes = await fetch(base + "/api/upload-assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frames: ["data:image/jpeg;base64," + "A".repeat(3 * 1024 * 1024)] }) });
  assert(bigRes.status === 413, "upload-assist rejects oversized payloads (413)");
  const homeAi = await (await fetch(base + "/")).text();
  assert(homeAi.includes('id="aiAssist"') && homeAi.includes('id="aiGateOverride"') && homeAi.includes('id="aiField"'), "upload form carries the assist note, gate box and hidden ai field");
  const appAi = await (await fetch(base + "/app.js")).text();
  assert(appAi.includes("/api/upload-assist") && appAi.includes("__uaGateCheck") && appAi.includes("Reading your play"), "app.js wires the upload assist (endpoint, gate check, reading state)");

  // 8e. Round 106 (2026-11-11): Bottles in the Swag Shop — the
  // Hoodies | Bottles toggle (Hoodies is the default), six bottle
  // cards on their front artwork, the bottle view with COMING SOON
  // (NO price anywhere in the bottles markup) and its per-sport
  // drop-alert form, plus the notify backend: server-side email
  // validation, silent dedupe, and an owner-only list endpoint.
  const home106 = await (await fetch(base + "/")).text();
  const app106 = await (await fetch(base + "/app.js")).text();
  const css106 = await (await fetch(base + "/styles.css")).text();
  assert(home106.includes('data-hs-cat="hoodies" role="tab" aria-selected="true"') && home106.includes('data-hs-cat="bottles" role="tab" aria-selected="false"'), "r106: the category toggle renders with Hoodies as the default");
  assert(home106.includes('id="hsBottlePanel" hidden') && ["baseball", "football", "basketball", "soccer", "softball", "volleyball"].every((s) => home106.includes(`data-btl-card="${s}"`) && home106.includes(`/swag/hs/bottle-${s}.jpg`)), "r106: the Bottles panel starts hidden and carries all six bottle cards on their front artwork");
  const btlPanel106 = home106.slice(home106.indexOf('id="hsBottlePanel"'), home106.indexOf('id="hsHfFeature"'));
  const btlView106 = home106.slice(home106.indexOf('id="btlView"'), home106.indexOf('id="sizeGuide"'));
  assert(btlPanel106.length > 0 && btlView106.length > 0 && !btlPanel106.includes("$") && !btlView106.includes("$"), "r106: no price appears anywhere in the bottles markup (pricing is not set)");
  assert(btlView106.includes('id="btlNotifyForm"') && btlView106.includes("Notify me when it drops") && btlView106.includes("COMING SOON") && home106.includes('id="dropNotify"'), "r106: the bottle view carries COMING SOON + the per-sport notify form, and Owner view has the notifications section");
  assert(app106.includes("hsSetCat106") && app106.includes("/api/drop-notify") && app106.includes('q.get("cat")') && app106.includes('q.get("sport")') && app106.includes('q.get("view") !== "shop"'), "r106: app.js wires the toggle, the notify endpoint and the ?view=shop&cat=&sport= deep link");
  assert(css106.includes(".hs-cat-toggle") && css106.includes(".hs-btl-media") && css106.includes(".btlv-notify"), "r106: styles carry the toggle, bottle media and notify button");
  const dnBad = await j("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "not-an-email", sport: "football" }) });
  assert(dnBad.status === 400, "r106: drop-notify rejects a malformed email (400)");
  const dnSport = await j("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "parent@example.com", sport: "hockey" }) });
  assert(dnSport.status === 400, "r106: drop-notify rejects a sport outside the six bottles (400)");
  const dnAnon = await j("/api/owner/drop-notifications");
  assert(dnAnon.status === 403, "r106: the drop-notifications list refuses anonymous reads (403)");
  const dn1 = await j("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "Parent@Example.com", sport: "football" }) });
  assert(dn1.status === 200 && dn1.body.ok, "r106: a valid drop signup succeeds");
  const dn2 = await j("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "parent@example.com", sport: "football" }) });
  assert(dn2.status === 200 && dn2.body.ok, "r106: re-submitting the same email + sport is the same success (silent dedupe)");
  const dnList = await j("/api/owner/drop-notifications", { headers: { "x-owner-token": tok } });
  assert(dnList.body.signups.length === 1 && dnList.body.signups[0].email === "parent@example.com" && dnList.body.signups[0].sport === "football", "r106: the owner list holds exactly one row for the deduped signup (case-normalized)");
  assert(dnList.body.counts.length === 6 && dnList.body.counts.find((c) => c.sport === "football").count === 1, "r106: owner counts cover all six sports with football at 1");
  const pub106 = await j("/api/highlights");
  assert(!JSON.stringify(pub106.body).includes("parent@example.com"), "r106: the notify email never appears in a public payload");

  // 8f. Round 124 — server-side media conversion. Non-H.264
  // uploads are transcoded to H.264/yuv420p/faststart and given a
  // server poster; compliant uploads pass through byte-for-byte;
  // a one-time startup migration converts legacy files
  // (originals preserved, second boot a no-op); and with ffmpeg
  // forced off, the upload path degrades to exactly the pre-124
  // behavior. Own scratch servers (ports 3481–3483) so the main
  // suite's budgets are untouched. Fixtures are tiny clips made
  // with the system ffmpeg.
  {
    const fixDir = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r124-fix-"));
    const ffgen = (args) => execFileSync("ffmpeg", ["-y", "-v", "error", ...args]);
    ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3", "-c:v", "libx265", "-pix_fmt", "yuv420p", "-crf", "30", path.join(fixDir, "hevc.mp4")]);
    ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3", "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "300k", path.join(fixDir, "vp9.webm")]);
    ffgen(["-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", path.join(fixDir, "h264.mp4")]);
    const hevcBytes = fs.readFileSync(path.join(fixDir, "hevc.mp4"));
    const vp9Bytes = fs.readFileSync(path.join(fixDir, "vp9.webm"));
    const h264Bytes = fs.readFileSync(path.join(fixDir, "h264.mp4"));
    const vstreamOf = (file) => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file], { encoding: "utf8" })).streams.find((s) => s.codec_type === "video");
    const startSrv124 = async (port, dir, extraEnv = {}) => {
      const ch = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: dir, AI_VISION_API_KEY: "", ...extraEnv }, stdio: "pipe" });
      let log = ""; ch.stdout.on("data", (d) => { log += d; }); ch.stderr.on("data", (d) => { log += d; });
      for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/api/health`); break; } catch { await wait(200); } }
      return { ch, log: () => log };
    };
    const mkJ124 = (port) => async (p, opts = {}) => { const r = await fetch(`http://localhost:${port}` + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const mpUpload124 = async (jj, fields, fname, ctype, bytes) => {
      const boundary = "----r124boundary";
      const parts = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fname}"\r\nContent-Type: ${ctype}\r\n\r\n`));
      parts.push(bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
      return jj("/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    };
    // (a)+(b) upload-time transcoding on a live server.
    const tmpA124 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r124-a-"));
    const srvA = await startSrv124(3481, tmpA124);
    const jA124 = mkJ124(3481);
    try {
      const upHevc = await mpUpload124(jA124, { title: "R124 HEVC", sport: "martial-arts", guardianConsent: "true", playerName: "Kid A" }, "clip.mp4", "video/mp4", hevcBytes);
      assert(upHevc.status === 201, "r124: HEVC upload accepted (201)");
      assert(/^\/uploads\/poster-\d+\.jpg$/.test(upHevc.body.poster_url || ""), "r124: HEVC upload response carries a poster_url");
      const vsA = vstreamOf(path.join(tmpA124, "uploads", path.basename(upHevc.body.media_url)));
      assert(vsA.codec_name === "h264" && vsA.pix_fmt === "yuv420p", "r124: stored HEVC upload is now H.264/yuv420p");
      const posterDisk = fs.readFileSync(path.join(tmpA124, "uploads", path.basename(upHevc.body.poster_url)));
      assert(posterDisk[0] === 0xff && posterDisk[1] === 0xd8, "r124: poster_url points at a real JPEG on disk");
      const posterHttp = await fetch(`http://localhost:3481${upHevc.body.poster_url}`);
      assert(posterHttp.status === 200 && (posterHttp.headers.get("content-type") || "").includes("image/jpeg"), "r124: poster serves over HTTP as image/jpeg");
      const claimA = await jA124("/api/owner/claim", { method: "POST" });
      await jA124(`/api/highlights/${upHevc.body.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": claimA.body.token }, body: JSON.stringify({ status: "approved" }) });
      const pubA124 = await jA124("/api/highlights");
      const pubPlay = pubA124.body.highlights.find((h) => h.id === upHevc.body.id);
      assert(pubPlay && pubPlay.poster_url === upHevc.body.poster_url, "r124: public payload carries poster_url");
      const upVp9 = await mpUpload124(jA124, { title: "R124 VP9", sport: "soccer", guardianConsent: "true", playerName: "Kid B" }, "clip.webm", "video/webm", vp9Bytes);
      assert(upVp9.status === 201 && upVp9.body.media_url.endsWith(".mp4"), "r124: VP9 upload is stored as .mp4");
      assert(vstreamOf(path.join(tmpA124, "uploads", path.basename(upVp9.body.media_url))).codec_name === "h264", "r124: stored VP9 upload probes H.264");
      const upH = await mpUpload124(jA124, { title: "R124 H264", sport: "soccer", guardianConsent: "true", playerName: "Kid C" }, "good.mp4", "video/mp4", h264Bytes);
      assert(upH.status === 201, "r124: compliant H.264 upload accepted");
      assert(fs.readFileSync(path.join(tmpA124, "uploads", path.basename(upH.body.media_url))).equals(h264Bytes), "r124: compliant H.264 upload stored byte-for-byte (not rewritten)");
      assert(!!upH.body.poster_url, "r124: compliant upload still gets a server poster");
    } finally { srvA.ch.kill(); fs.rmSync(tmpA124, { recursive: true, force: true }); }
    // (c) the one-time migration: seed a legacy play while ffmpeg
    // is forced off (schema created, marker NOT set), then boot
    // normally and watch it convert exactly once.
    const tmpB124 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r124-b-"));
    const srvB1 = await startSrv124(3482, tmpB124, { HH_NO_FFMPEG: "1" });
    srvB1.ch.kill(); await wait(500);
    fs.copyFileSync(path.join(fixDir, "hevc.mp4"), path.join(tmpB124, "uploads", "legacy-hevc.mp4"));
    const seedDb124 = new DatabaseSync(path.join(tmpB124, "highlighthype.db"));
    seedDb124.prepare("INSERT INTO highlights(title,sport,media_kind,media_url,mime,status,player_name,division) VALUES('Legacy HEVC','martial-arts','file','/uploads/legacy-hevc.mp4','video/mp4','approved','Legacy Kid','girls')").run();
    seedDb124.close();
    const srvB2 = await startSrv124(3482, tmpB124);
    const jB124 = mkJ124(3482);
    try {
      let mig = null;
      for (let i = 0; i < 100; i++) { const pp = await jB124("/api/highlights"); mig = pp.body.highlights.find((h) => h.title === "Legacy HEVC"); if (mig && mig.media_url.endsWith("-h264.mp4")) break; await wait(300); }
      assert(mig && mig.media_url === "/uploads/legacy-hevc-h264.mp4", "r124: migration repointed the legacy play at the converted file");
      assert(vstreamOf(path.join(tmpB124, "uploads", "legacy-hevc-h264.mp4")).codec_name === "h264", "r124: migrated file probes H.264");
      const bak124 = path.join(tmpB124, "uploads", "legacy-hevc.hevc-orig.mp4");
      assert(fs.existsSync(bak124) && fs.readFileSync(bak124).equals(hevcBytes), "r124: migration preserved the original file byte-for-byte under the backup name");
      assert(mig.poster_url === "/uploads/poster-1.jpg" && fs.existsSync(path.join(tmpB124, "uploads", "poster-1.jpg")), "r124: migration generated the legacy play's poster");
      const listingBefore = fs.readdirSync(path.join(tmpB124, "uploads")).sort().join("|");
      srvB2.ch.kill(); await wait(500);
      const srvB3 = await startSrv124(3482, tmpB124);
      try {
        await wait(800);
        const pp3 = await jB124("/api/highlights");
        const mig3 = pp3.body.highlights.find((h) => h.title === "Legacy HEVC");
        assert(mig3 && mig3.media_url === "/uploads/legacy-hevc-h264.mp4", "r124: second boot leaves the migrated play untouched (marker no-op)");
        assert(fs.readdirSync(path.join(tmpB124, "uploads")).sort().join("|") === listingBefore, "r124: second boot adds no files (migration ran exactly once)");
      } finally { srvB3.ch.kill(); }
    } finally { try { srvB2.ch.kill(); } catch {} fs.rmSync(tmpB124, { recursive: true, force: true }); }
    // (d) ffmpeg forced off: the upload degrades to pre-124.
    const tmpC124 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r124-c-"));
    const srvC = await startSrv124(3483, tmpC124, { HH_NO_FFMPEG: "1" });
    const jC124 = mkJ124(3483);
    try {
      const upC = await mpUpload124(jC124, { title: "R124 NoFF", sport: "martial-arts", guardianConsent: "true", playerName: "Kid D" }, "clip.mp4", "video/mp4", hevcBytes);
      assert(upC.status === 201, "r124: with ffmpeg unavailable the HEVC upload still succeeds (201)");
      assert(upC.body.poster_url === "", "r124: with ffmpeg unavailable no poster is promised");
      assert(fs.readFileSync(path.join(tmpC124, "uploads", path.basename(upC.body.media_url))).equals(hevcBytes), "r124: with ffmpeg unavailable the original file is kept byte-for-byte");
      assert(srvC.log().includes("HH_NO_FFMPEG"), "r124: the no-ffmpeg state is logged, not silent");
    } finally { srvC.ch.kill(); fs.rmSync(tmpC124, { recursive: true, force: true }); }
    fs.rmSync(fixDir, { recursive: true, force: true });
  }

  // 9. Upload rate limit: 20 POSTs/hour/IP (2 already made above) — the
  // 21st attempt is refused with 429. Runs last; the scratch server is
  // discarded right after.
  for (let i = 0; i < 18; i++) {
    const rr = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `Rate Filler ${i}`, sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    assert(rr.status === 201, `upload ${i + 3} of 20 still allowed`);
  }
  const over = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "One Too Many", sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
  assert(over.status === 429 && /Too many uploads/.test(over.body.message || ""), "21st upload within the hour is rate-limited (429)");
  // 8g. Round 125 — lacrosse joins the taxonomy, and an upload
  // WITHOUT a last initial succeeds end to end. The client now
  // composes playerName from a first-name field + an OPTIONAL
  // last-initial field, so the server sees "Riley" (no initial)
  // or "Riley T". The no-initial fallback is simply the single
  // name: the HH tag never embedded the initial (random
  // HH-####), the display name derives from the tokens present,
  // and resolveAthlete keys identity on name+team+guardian-email
  // hash — two same-name athletes under different guardians must
  // stay two athletes. Own scratch server (port 3485).
  {
    const fixDir125 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r125-fix-"));
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x240:rate=15:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "23", "-movflags", "+faststart", path.join(fixDir125, "clip.mp4")]);
    const clip125 = fs.readFileSync(path.join(fixDir125, "clip.mp4"));
    // →145: the server's upload dedupe hashes the file bytes — the
    // four scenario uploads below are four DIFFERENT plays (other
    // guardians, other athletes) that happen to share one fixture
    // clip, and identical bytes now (correctly) read as a retry of
    // the first. Remux the base clip with a per-upload metadata tag
    // (-c copy, no re-encode) so each scenario upload carries
    // distinct bytes, like four real families' clips would.
    const clip125v = (n) => { const p = path.join(fixDir125, `clip-v${n}.mp4`); execFileSync("ffmpeg", ["-y", "-v", "error", "-i", path.join(fixDir125, "clip.mp4"), "-c", "copy", "-metadata", `comment=fixture-${n}`, p]); return fs.readFileSync(p); };
    const tmp125 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r125-"));
    const ch125 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: "3485", DATA_DIR: tmp125, AI_VISION_API_KEY: "" }, stdio: "pipe" });
    for (let i = 0; i < 50; i++) { try { await fetch("http://localhost:3485/api/health"); break; } catch { await wait(200); } }
    const j125 = async (p, opts = {}) => { const r = await fetch("http://localhost:3485" + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    const up125 = async (fields, variant) => {
      const boundary = "----r125boundary";
      const parts = [];
      for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="clip.mp4"\r\nContent-Type: video/mp4\r\n\r\n`));
      parts.push(clip125v(variant), Buffer.from(`\r\n--${boundary}--\r\n`));
      return j125("/api/highlights", { method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, body: Buffer.concat(parts) });
    };
    try {
      const claim125 = await j125("/api/owner/claim", { method: "POST" });
      const tok125 = claim125.body.token;
      const approve125 = (id) => j125(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok125 }, body: JSON.stringify({ status: "approved" }) });
      // Lacrosse + NO last initial (playerName is the bare first name).
      const lax = await up125({ title: "R125 lacrosse rip", sport: "lacrosse", division: "girls", guardianConsent: "true", playerName: "Riley", notifyEmail: "riley-guardian@example.com"}, 1);
      assert(lax.status === 201, "r125: lacrosse upload WITHOUT a last initial succeeds (201)");
      assert(/^HH-\d{4}$/.test(lax.body.athlete_tag || ""), "r125: the no-initial athlete still gets a sane HH-#### tag (the tag never embedded the initial)");
      await approve125(lax.body.id);
      const pub125 = await j125("/api/highlights");
      const laxPub = pub125.body.highlights.find((h) => h.id === lax.body.id);
      assert(laxPub && laxPub.athlete_id, "r125: the no-initial upload created an athlete (public payload carries its athlete_id)");
      assert(laxPub && laxPub.sport === "lacrosse", "r125: the lacrosse play is public after approval, sport key intact");
      assert(laxPub.athlete_label === "Riley", "r125: a single-token name displays as itself (no dangling initial/period)");
      // My Plays: the guardian's email lookup finds the athlete + play.
      const lk125 = await j125(`/api/athletes/lookup?email=${encodeURIComponent("riley-guardian@example.com")}`);
      assert(lk125.status === 200 && lk125.body.athletes.length === 1 && lk125.body.athletes[0].playCount === 1, "r125: My Plays email lookup returns the no-initial athlete with its approved play");
      // Same name, DIFFERENT guardian: a second athlete, never a merge.
      const lax2 = await up125({ title: "R125 other Riley", sport: "lacrosse", division: "girls", guardianConsent: "true", playerName: "Riley", notifyEmail: "other-riley@example.com"}, 2);
      assert(lax2.status === 201 && lax2.body.athlete_tag !== lax.body.athlete_tag, "r125: a same-name no-initial upload under another guardian gets its OWN HH tag at once (no merge, no crash)");
      await approve125(lax2.body.id);
      // Same guardian again: continuity — the same athlete as upload 1.
      const lax3 = await up125({ title: "R125 Riley again", sport: "lacrosse", division: "girls", guardianConsent: "true", playerName: "Riley", notifyEmail: "riley-guardian@example.com"}, 3);
      assert(lax3.status === 201 && lax3.body.athlete_tag === lax.body.athlete_tag, "r125: the same guardian + same name reuses the same athlete/tag (the email-hash continuity the form's athlete check relies on)");
      await approve125(lax3.body.id);
      const pub125b = await j125("/api/highlights");
      const ids125 = new Set(pub125b.body.highlights.filter((h) => [lax.body.id, lax2.body.id, lax3.body.id].includes(h.id)).map((h) => h.athlete_id));
      assert(ids125.size === 2, "r125: three same-name no-initial plays resolve to exactly TWO athletes — uploads 1+3 share one, upload 2 is distinct");
      // With an initial, the composed name behaves as it always has.
      const withInit = await up125({ title: "R125 with initial", sport: "hockey", division: "boys", guardianConsent: "true", playerName: "Riley T", notifyEmail: "riley-t@example.com"}, 4);
      assert(withInit.status === 201 && withInit.body.athlete_tag !== lax.body.athlete_tag, "r125: 'Riley T' starts its own athlete, distinct from bare 'Riley'");
      await approve125(withInit.body.id);
      const pub125c = await j125("/api/highlights");
      assert(pub125c.body.highlights.find((h) => h.id === withInit.body.id)?.athlete_label === "Riley T.", "r125: the with-initial display name keeps the classic 'First L.' form");
    } finally { ch125.kill(); fs.rmSync(tmp125, { recursive: true, force: true }); fs.rmSync(fixDir125, { recursive: true, force: true }); }
  }

  // 8h. Round 130 (2026-11-13) — contest AUTO-ENTRY. Posting
  // defaults INTO Hype of the Month: the upload carries the
  // guardian's opt-in explicitly (contestOptin=1/0), approval enters
  // an opted-in play in the approval month, samples never enter,
  // legacy uploads (no field) never auto-enter, the guardian can
  // withdraw from My Plays, and the owner-directed migration
  // retro-enters plays 50 + 51 into 2026-11 exactly once.
  {
    const tmp130 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r130-"));
    const PORT130 = 3487, base130 = `http://localhost:${PORT130}`;
    const ch130 = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT130), DATA_DIR: tmp130, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1", MODERATE_TOKEN: ["r130", "mod", "token"].join("-") }, stdio: "pipe" });
    const MODTOK130 = ["r130", "mod", "token"].join("-");
    const j130 = async (p, opts = {}) => { const r = await fetch(base130 + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
    try {
      for (let i = 0; i < 50; i++) { try { await fetch(base130 + "/api/health"); break; } catch { await wait(200); } }
      const tok130 = (await j130("/api/owner/claim", { method: "POST" })).body.token; assert(tok130, "r130: owner claim returns token");
      const G130 = "optin-guardian@example.com";
      const mk130 = async (fields) => {
        const r = await j130("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true", ...fields }) });
        assert(r.status === 201, `r130: play created (${fields.title})`);
        return r.body;
      };
      const approve130 = async (id, extra = {}) => { const r = await j130(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok130 }, body: JSON.stringify({ status: "approved", ...extra }) }); assert(r.body.status === "approved", "r130: play approved via owner status endpoint"); };
      const entries130 = async () => (await j130("/api/contest")).body;
      const lookup130 = async () => (await j130(`/api/athletes/lookup?email=${encodeURIComponent(G130)}`)).body.plays;

      // (1) Opted IN: not entered while pending, entered on approval.
      const inA = await mk130({ title: "R130 Opted In", playerName: "Opti", notifyEmail: G130, contestOptin: "1" });
      assert((await entries130()).totalEntries === 0, "r130: an opted-in play is NOT entered while still pending");
      await approve130(inA.id);
      let c130 = await entries130();
      assert(c130.totalEntries === 1 && c130.entries[0].id === inA.id, "r130: approving an opted-in play enters it in the approval month");
      // Re-approval (hide -> approve) never duplicates the entry.
      await j130(`/api/highlights/${inA.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok130 }, body: JSON.stringify({ status: "hidden" }) });
      await approve130(inA.id);
      assert((await entries130()).totalEntries === 1, "r130: hide -> re-approve does not duplicate the contest entry");

      // (2) Explicitly UNCHECKED: approved, never entered.
      const outB = await mk130({ title: "R130 Opted Out", playerName: "Outi", notifyEmail: G130, contestOptin: "0" });
      await approve130(outB.id);
      assert((await entries130()).totalEntries === 1, "r130: an unchecked play is approved but NOT entered");
      assert((await lookup130()).find((p) => p.id === outB.id)?.inContest === false, "r130: My Plays shows the unchecked play as not in the contest");

      // (3) LEGACY upload (no contestOptin field at all): the
      // pre-130 shape — approved, never auto-entered; the Round 121
      // guardian tap-to-enter remains its path (proven in 8e).
      const legC = await mk130({ title: "R130 Legacy", playerName: "Leg", notifyEmail: G130 });
      await approve130(legC.id);
      assert((await entries130()).totalEntries === 1, "r130: a legacy upload (no opt-in field) is approved but NOT auto-entered");

      // (4) SAMPLE with opt-in: never entered, on either approval
      // path — the owner status call with { sample: true } in the
      // same step, and /moderate approve_sample.
      const samD = await mk130({ title: "R130 Sample OptIn", playerName: "Sam", notifyEmail: G130, contestOptin: "1" });
      await approve130(samD.id, { sample: true });
      assert((await entries130()).totalEntries === 1, "r130: a sample approved with opt-in (owner path, sample flag in the same call) never enters");
      assert((await lookup130()).find((p) => p.id === samD.id)?.inContest === false, "r130: My Plays agrees — the sample is not in the contest");
      const samE = await mk130({ title: "R130 Sample Moderate", playerName: "Sam", notifyEmail: G130, contestOptin: "1" });
      const modSam = await fetch(base130 + "/moderate", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id: String(samE.id), token: MODTOK130, action: "approve_sample" }).toString() });
      assert(modSam.status === 200, "r130: /moderate approve_sample succeeds");
      assert((await entries130()).totalEntries === 1, "r130: a sample approved via /moderate approve_sample never enters");

      // (5) The /moderate plain-approve path auto-enters too.
      const modF = await mk130({ title: "R130 Moderate OptIn", playerName: "Modi", notifyEmail: G130, contestOptin: "1" });
      const modOk = await fetch(base130 + "/moderate", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ id: String(modF.id), token: MODTOK130, action: "approve" }).toString() });
      assert(modOk.status === 200, "r130: /moderate approve succeeds");
      c130 = await entries130();
      assert(c130.totalEntries === 2 && c130.entries.some((e) => e.id === modF.id), "r130: an opted-in play approved via the emailed /moderate link auto-enters");

      // (6) Withdraw: gated like enter; votes stay in history.
      await j130(`/api/highlights/${inA.id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken: "r130-voter" }) });
      c130 = await entries130();
      assert(c130.entries.find((e) => e.id === inA.id)?.voteCount === 1, "r130: the entered play carries its vote before withdrawal");
      const wdBad = await j130("/api/contest/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: inA.id, email: "stranger@example.com" }) });
      assert(wdBad.status === 403, "r130: a stranger cannot withdraw someone else's play (403)");
      const wdOk = await j130("/api/contest/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: inA.id, email: "  OPTIN-GUARDIAN@example.com " }) });
      assert(wdOk.status === 200 && wdOk.body.ok === true, "r130: the posting guardian (trimmed, any case) withdraws the play");
      c130 = await entries130();
      assert(c130.totalEntries === 1 && !c130.entries.some((e) => e.id === inA.id), "r130: the withdrawn play leaves the contest board");
      assert((await lookup130()).find((p) => p.id === inA.id)?.inContest === false, "r130: My Plays reflects the withdrawal");
      const wdAgain = await j130("/api/contest/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: inA.id, email: G130 }) });
      assert(wdAgain.status === 200 && wdAgain.body.notEntered === true, "r130: withdrawing a non-entered play reports notEntered, no error");
      // Re-enter through the existing guardian path: the month's
      // votes were never deleted, so the count comes back with it.
      const reEnter = await j130("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: inA.id, email: G130 }) });
      assert(reEnter.status === 201 && reEnter.body.ok, "r130: the withdrawn play re-enters via the Round 121 guardian path");
      c130 = await entries130();
      assert(c130.entries.find((e) => e.id === inA.id)?.voteCount === 1, "r130: votes cast before withdrawal stayed in history (count returns on re-entry)");

      // (7) Client wiring: pre-checked box, explicit payload, the
      // My Plays withdraw action.
      const home130 = fs.readFileSync(new URL("public/index.html", import.meta.url), "utf8");
      const app130 = fs.readFileSync(new URL("public/app.js", import.meta.url), "utf8");
      assert(/name="contestOptin" checked/.test(home130), "r130: the upload form's contest box is present and PRE-CHECKED");
      assert(app130.includes('fdSend125.set("contestOptin"'), "r130: the submit handler sends the contest state explicitly (1/0)");
      assert(app130.includes("/api/contest/withdraw") && app130.includes("withdrawContest130") && app130.includes("Withdraw from contest"), "r130: My Plays carries the withdraw action wired to the endpoint");
    } finally { ch130.kill(); fs.rmSync(tmp130, { recursive: true, force: true }); }
  }
  // 8h-ii. Round 130 migration: plays 50 + 51 (approved, non-sample)
  // are retro-entered into 2026-11 exactly once; a sample or an
  // unapproved play at those ids is skipped.
  {
    const migBoot = async (dir, port) => {
      const ch = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: dir, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" }, stdio: "pipe" });
      for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/api/health`); break; } catch { await wait(200); } }
      return ch;
    };
    const migSeed = (dir, rows) => {
      const d = new DatabaseSync(path.join(dir, "highlighthype.db"));
      d.prepare("DELETE FROM settings WHERE key='r130_enter_50_51_v1'").run();
      for (const r of rows) d.prepare("INSERT INTO highlights(id,title,sport,media_kind,media_url,status,is_sample) VALUES(?,?,?,'link','https://www.youtube.com/watch?v=dQw4w9WgXcQ',?,?)").run(r.id, r.title, "softball", r.status, r.sample ? 1 : 0);
      d.close();
    };
    const migEntries = (dir) => { const d = new DatabaseSync(path.join(dir, "highlighthype.db"), { readOnly: true }); const rows = d.prepare("SELECT highlight_id, period FROM contest_entries ORDER BY highlight_id").all(); const marker = d.prepare("SELECT value FROM settings WHERE key='r130_enter_50_51_v1'").get(); d.close(); return { rows, marker }; };
    // Happy path: both plays eligible.
    const tmpM130 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r130mig-"));
    let chM = await migBoot(tmpM130, 3488); chM.kill(); await wait(300);
    migSeed(tmpM130, [{ id: 50, title: "R130 Mig Charlotte", status: "approved" }, { id: 51, title: "R130 Mig Janine", status: "approved" }]);
    chM = await migBoot(tmpM130, 3488);
    const mc = await (await fetch("http://localhost:3488/api/contest?period=2026-11")).json();
    assert(mc.totalEntries === 2 && mc.entries.some((e) => e.id === 50) && mc.entries.some((e) => e.id === 51), "r130 migration: plays 50 + 51 are retro-entered into the November 2026 contest");
    chM.kill(); await wait(300);
    chM = await migBoot(tmpM130, 3488); chM.kill(); await wait(300);
    const after3 = migEntries(tmpM130);
    assert(after3.rows.length === 2 && after3.rows.every((r) => r.period === "2026-11") && !!after3.marker, "r130 migration: a second boot adds no duplicates and the marker is set (exactly once)");
    fs.rmSync(tmpM130, { recursive: true, force: true });
    // Skip path: id 50 is a sample, id 51 is still pending.
    const tmpM130b = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r130mig2-"));
    let chM2 = await migBoot(tmpM130b, 3489); chM2.kill(); await wait(300);
    migSeed(tmpM130b, [{ id: 50, title: "R130 Mig Sample", status: "approved", sample: true }, { id: 51, title: "R130 Mig Pending", status: "pending" }]);
    chM2 = await migBoot(tmpM130b, 3489); chM2.kill(); await wait(300);
    const skipped = migEntries(tmpM130b);
    assert(skipped.rows.length === 0 && !!skipped.marker, "r130 migration: a sample at id 50 and a pending play at id 51 are both skipped (no entries, marker still set)");
    fs.rmSync(tmpM130b, { recursive: true, force: true });
  }

  // 8i. Round 131 (2026-11-13) — one-time athlete RENAME. Play 51
  // was uploaded with the guardian's name ("Janine") in the athlete
  // field; the athlete is "Juliana" (the catcher in the play's own
  // story). The startup migration renames her and re-derives the
  // athlete identity with the upload resolver (same team / division
  // / jersey / guardian email), so the end state matches a correct
  // upload. Contest entries + votes key off highlight_id and must
  // be untouched; a play 51 with any other name is left alone.
  {
    const sha131 = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
    const norm131 = (s) => String(s || "").toLowerCase().trim().replace(/\s+/g, " ");
    const boot131 = async (dir, port) => {
      const ch = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(port), DATA_DIR: dir, AI_VISION_API_KEY: "", HH_NO_FFMPEG: "1" }, stdio: "pipe" });
      for (let i = 0; i < 50; i++) { try { await fetch(`http://localhost:${port}/api/health`); break; } catch { await wait(200); } }
      return ch;
    };
    const G131 = "guardian-51@example.com";
    const seed131 = (dir, playerName) => {
      const d = new DatabaseSync(path.join(dir, "highlighthype.db"));
      // The schema-creation boot already set the marker (no play 51
      // existed); clear it so the seeded boot is the one that fires.
      d.prepare("DELETE FROM settings WHERE key='r131_rename_51_v1'").run();
      // The registry row + identity a real upload under this name
      // (same guardian email, no team) would have produced.
      d.prepare("INSERT INTO athletes(athlete_key,tag,name_norm,team_norm,email_hash,display_name,division,jersey) VALUES('oldkey131','HH-1310',?,'',?,?,'girls','')")
        .run(norm131(playerName), sha131(norm131(G131)), playerName);
      d.prepare("INSERT INTO highlights(id,title,sport,division,player_name,story,media_kind,media_url,status,is_sample,team,notify_email,notify_email_hash,athlete_id,athlete_tag,athlete_group,jersey) VALUES(51,'Caught stealing home!','softball','girls',?,'Juliana showing her catcher skills!!','link','https://www.youtube.com/watch?v=dQw4w9WgXcQ','approved',0,'',?,?,'oldkey131','HH-1310',?,'')")
        .run(playerName, G131, sha131(norm131(G131)), norm131(playerName) + "|");
      d.prepare("INSERT INTO contest_entries(highlight_id,period) VALUES(51,'2026-11')").run();
      d.prepare("INSERT INTO votes(highlight_id,voter_token,created_at,period) VALUES(51,'r131-voter',datetime('now'),'2026-11')").run();
      d.close();
    };
    const read131 = (dir) => {
      const d = new DatabaseSync(path.join(dir, "highlighthype.db"), { readOnly: true });
      const out = {
        play: d.prepare("SELECT player_name, athlete_id, athlete_tag, athlete_group FROM highlights WHERE id=51").get(),
        julianaAthletes: d.prepare("SELECT * FROM athletes WHERE name_norm='juliana'").all(),
        oldAthlete: d.prepare("SELECT * FROM athletes WHERE athlete_key='oldkey131'").get(),
        entries: d.prepare("SELECT highlight_id, period FROM contest_entries WHERE highlight_id=51").all(),
        votes: d.prepare("SELECT COUNT(*) c FROM votes WHERE highlight_id=51").get().c,
        marker: d.prepare("SELECT value FROM settings WHERE key='r131_rename_51_v1'").get(),
      };
      d.close();
      return out;
    };
    // Happy path: play 51 displays "Janine" -> becomes "Juliana".
    const tmp131 = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r131-"));
    let ch131 = await boot131(tmp131, 3490); ch131.kill(); await wait(300);
    seed131(tmp131, "Janine");
    ch131 = await boot131(tmp131, 3490);
    const pub131 = await (await fetch("http://localhost:3490/api/highlights")).json();
    const p51 = pub131.highlights.find((h) => h.id === 51);
    assert(p51 && p51.player_name === "Juliana" && p51.athlete_label === "Juliana", "r131: /api/highlights serializes play 51 as Juliana");
    assert(p51.athlete_group === "juliana|" && p51.athlete_id !== "oldkey131", "r131: play 51 carries a NEW athlete identity derived for Juliana");
    const con131 = await (await fetch("http://localhost:3490/api/contest?period=2026-11")).json();
    const e51 = con131.entries.find((e) => e.id === 51);
    assert(e51 && e51.player_name === "Juliana" && e51.voteCount === 1, "r131: /api/contest serializes the entered play 51 as Juliana with its vote intact");
    // The public serializer only exposes athlete_tag on a name
    // collision, so the tag checks read the stored row directly.
    const live131 = read131(tmp131);
    assert(live131.play.athlete_tag !== "" && live131.play.athlete_tag !== "HH-1310" && live131.play.athlete_id === p51.athlete_id, "r131: the stored row carries the new athlete tag (not the guardian-name one)");
    // Upload-equivalence: a fresh upload for Juliana (same guardian
    // email) resolves to the SAME athlete the migration produced —
    // the end state is what a correct upload would have created.
    const up131 = await (await fetch("http://localhost:3490/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "R131 Second Juliana Play", sport: "softball", playerName: "Juliana", notifyEmail: G131, videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) })).json();
    assert(up131.athlete_tag && up131.athlete_tag === live131.play.athlete_tag, "r131: a fresh Juliana upload resolves to the migrated athlete (same tag)");
    ch131.kill(); await wait(300);
    const after131 = read131(tmp131);
    assert(after131.play.player_name === "Juliana" && after131.play.athlete_id === p51.athlete_id && after131.play.athlete_tag === live131.play.athlete_tag, "r131: the stored row matches the serialized identity");
    assert(after131.julianaAthletes.length === 1 && after131.julianaAthletes[0].athlete_key === p51.athlete_id && after131.julianaAthletes[0].email_hash === sha131(norm131(G131)) && after131.julianaAthletes[0].display_name === "Juliana", "r131: exactly one 'juliana' registry row, keyed as the resolver keys it (name + guardian email hash)");
    assert(!!after131.oldAthlete, "r131: the old 'janine' registry row is left in place (registry rows are never deleted)");
    assert(after131.entries.length === 1 && after131.entries[0].period === "2026-11" && after131.votes === 1, "r131: contest entry and vote for play 51 are untouched");
    assert(!!after131.marker, "r131: the migration marker is set");
    // Second boot: nothing changes (marker + name condition).
    ch131 = await boot131(tmp131, 3490); ch131.kill(); await wait(300);
    const again131 = read131(tmp131);
    assert(again131.play.player_name === "Juliana" && again131.play.athlete_id === p51.athlete_id && again131.julianaAthletes.length === 1 && !!again131.marker, "r131: a second boot changes nothing (no duplicate athlete, no re-rename)");
    fs.rmSync(tmp131, { recursive: true, force: true });
    // Skip path: play 51 with a different name is untouched.
    const tmp131b = fs.mkdtempSync(path.join(os.tmpdir(), "hh-test-r131b-"));
    let ch131b = await boot131(tmp131b, 3491); ch131b.kill(); await wait(300);
    seed131(tmp131b, "Somebody Else");
    ch131b = await boot131(tmp131b, 3491); ch131b.kill(); await wait(300);
    const skip131 = read131(tmp131b);
    assert(skip131.play.player_name === "Somebody Else" && skip131.play.athlete_id === "oldkey131" && skip131.julianaAthletes.length === 0 && !!skip131.marker, "r131: a play 51 with a different name is untouched (marker still set, no 'juliana' athlete created)");
    fs.rmSync(tmp131b, { recursive: true, force: true });
  }

  console.log("\nALL TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
