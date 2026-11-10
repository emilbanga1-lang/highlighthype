// Local end-to-end test. Run: node test.js
// Starts the server on a scratch DATA_DIR, then exercises the API.
// Exits non-zero on any failed assertion. Test data is NOT shipped.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  // 9. Upload rate limit: 20 POSTs/hour/IP (2 already made above) — the
  // 21st attempt is refused with 429. Runs last; the scratch server is
  // discarded right after.
  for (let i = 0; i < 18; i++) {
    const rr = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `Rate Filler ${i}`, sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    assert(rr.status === 201, `upload ${i + 3} of 20 still allowed`);
  }
  const over = await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "One Too Many", sport: "baseball", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
  assert(over.status === 429 && /Too many uploads/.test(over.body.message || ""), "21st upload within the hour is rate-limited (429)");
  console.log("\nALL TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
