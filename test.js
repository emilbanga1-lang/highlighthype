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
  const ALLOW = ["id", "title", "sport", "play_type", "player_name", "story", "media_kind", "media_url", "mime", "embed_url", "host_label", "status", "created_at", "division", "team", "athlete_id", "athlete_tag", "athlete_group", "jersey", "athlete_label", "athlete_collision", "hasGuardianEmail", "hasGuardianText", "hasGuardianPhone", "isSample", "badges", "voteCount", "hasVoted", "crowns", "votesMonth", "views", "battleWins"];
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
    await jB("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: A1 }) });
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
    assert(app100.includes("btl-letter") && app100.includes("btl-yourpick") && !app100.includes("btl-watchtag"), "r102/104: matchup minis render an A/B letter chip and a Your pick tag; the mini Now watching tag is gone (Round 104 — the big player's banner is the single watching marker)");
    assert(app100.includes('textContent = "Pick A"') && app100.includes('textContent = "Pick B"'), "r102: renderers reset the pick buttons to Pick A / Pick B");
    assert(home100.split("Practice matchup · Picks are just for fun").length - 1 === 2 && !home100.includes("Sample pool") && !home100.includes('id="btlPractice"') && !home100.includes("don't cast votes yet"), "r102: exactly one short practice label per section (Daily + Battles), no other practice copy");
    assert(home100.includes("Which Play Wins?") && !home100.includes("hit replay"), "r102: 'Which Play Wins?' is the matchup headline in Daily, Fresh Pairs and Winner Stays");
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
      await jC("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: cr1 }) });
      await jC("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: cr2 }) });
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
      assert(home105.includes('id="dailyStreak105"') && home105.includes('id="dailyTop105"') && home105.includes('id="dailyTopList"') && home105.includes('id="btlShareChallenge"') && home105.includes('id="btlChallengeNote"') && home105.includes('src="app.js?v=111"'), "r105: markup carries the streak line, Top Pickers block, challenge share + note, and current (v111) assets");
      assert(app105.includes("You got challenged — which play wins?") && app105.includes("challenge=${L}-${R}") && app105.includes("btlShare105") && app105.includes("crownsHtml105") && app105.includes("numbersHtml105") && app105.includes("renderStreak105") && app105.includes("🔥 Your streak: "), "r105: app.js wires challenge share + landing, crown/number renderers and the streak display");
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
