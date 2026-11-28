// Round 231 test: sample plays can't be used in the Hype Frame
// studio at all (Emil, 2026-11-27 — he picked the studio-wide
// option). Three enforcement layers:
//   1. PICKER: hfPickerEligible202 excludes samples, so the
//      posted-play picker never lists one (and the row's SAMPLE
//      PLAY tag is gone with the rows). A board whose plays are
//      ALL samples lands on the picker's existing honest empty
//      state ("No plays are up yet — post yours"), from where
//      the choice card's own-video path still works.
//   2. DIRECT ENTRY: the per-play Frame buttons in cardHtml,
//      tileHtml and the watch view (watchHtml107) are hidden on
//      samples at render, and openHypeFrame — the one funnel
//      every entry route passes through (buttons, picker, the
//      #hype-frame-<id> deep links, the Round 139 history
//      restore) — refuses a sample seed: it lands the visitor
//      on the choice card and never calls initHfStudio, so the
//      sample's frames never load.
//   3. SERVER GUARD: POST /api/hype-frame/orders rejects an
//      order whose source play is a sample (400, the endpoint's
//      usual { ok:false, message } shape), keyed strictly off
//      the resolved play's is_sample flag. Real plays are
//      unaffected — including the Upload-a-photo studio session,
//      whose order still carries the seeding REAL play's id
//      (hfSubmitOrder206 always sends hfState.play.id; the photo
//      replaces the frame, never the source play), so there is
//      no separate play-less order shape on the wire and the
//      pre-existing missing-play 404 stands unchanged.
// Untouched and NOT re-asserted here beyond a spot check:
// samples on the board / feed / watch page / practice battles
// and the owner queue's sample marking.
// Pins: app.js v227 / styles v219 (styles unchanged this round).
// Run: node test-r231.js — exits non-zero on failure.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r231-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "" },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  return { tmp, child, base, getLog: () => log };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=240"'), "A: asset pins — app.js v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244) — →245: app.js now v240 (Round 245); styles keeps v228 (unchanged this round)");

// ---- B. statics: the three layers ----
const elig = appJs.slice(appJs.indexOf("function hfPickerEligible202()"), appJs.indexOf("function hfPickerPoster202("));
assert(elig.includes("if (p.isSample) continue;"), "B1: the picker's eligible set skips sample plays outright");
const pickerRender = appJs.slice(appJs.indexOf("function hfPickerRender202("), appJs.indexOf("window.hfChoicePosted"));
assert(!pickerRender.includes("SAMPLE PLAY") && !pickerRender.includes("tile-sample-tag"), "B1: the picker row template carries no SAMPLE PLAY tag anymore (no sample rows exist to tag)");
const card = appJs.slice(appJs.indexOf("function cardHtml("), appJs.indexOf("function tileHtml("));
assert(card.includes('h.isSample ? "" : `<button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>`'), "B2: cardHtml withholds its Create a Hype Frame button from sample plays");
const tile = appJs.slice(appJs.indexOf("function tileHtml("), appJs.indexOf("/* Vote hardening"));
assert(tile.includes('h.isSample ? "" : `<button type="button" class="mini-btn tile-hf-btn"'), "B2: tileHtml withholds its 📸 Frame button from sample plays");
const watch = appJs.slice(appJs.indexOf("function watchHtml107("), appJs.indexOf("function renderPlayDetail()"));
assert(watch.includes('h.isSample ? "" : `<button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>`'), "B2: the watch view withholds its Create a Hype Frame button from sample plays");
const ohf = appJs.slice(appJs.indexOf("window.openHypeFrame = (id)"), appJs.indexOf("function initHfStudio"));
assert(ohf.includes("if (play.isSample)") && ohf.indexOf("play.isSample") < ohf.indexOf('showPanel("hypeframe")'), "B2: openHypeFrame checks isSample BEFORE it ever opens the studio panel");
assert(ohf.includes("openHfChoice()"), "B2: the refusal lands the visitor on the choice card (the picker fallback)");
const ordersAt = serverJs.indexOf('if (p === "/api/hype-frame/orders" && req.method === "POST")');
const ordersBlock = serverJs.slice(ordersAt, ordersAt + 2600);
assert(ordersBlock.includes("if (play.is_sample)") && ordersBlock.includes("Sample plays are demos"), "B3: the order endpoint refuses a sample-sourced order with a plain message");
assert(ordersBlock.indexOf("not approved yet") < ordersBlock.indexOf("play.is_sample") && ordersBlock.indexOf("play.is_sample") < ordersBlock.indexOf("guardianEmail"), "B3: the sample refusal sits right after the approved check, ahead of every other validation (no stale client can slip one past)");

// ---- C. VM drive: the real picker with mixed fixtures ----
function lineSrc(startNeedle) { const i = appJs.indexOf(startNeedle); return appJs.slice(i, appJs.indexOf("\n", i)); }
const escCapSrc = appJs.slice(appJs.indexOf("const esc ="), appJs.indexOf("\n", appJs.indexOf("const cap =")));
const pickerBlock = appJs.slice(appJs.indexOf("window.openHfChoice"), appJs.indexOf('$$("[data-hf-start]")'));
const mkEl = () => ({ hidden: false, innerHTML: "", textContent: "", value: "", parentElement: null });
const modalEl = mkEl(); modalEl.hidden = true;
const choiceEl = mkEl(), pickerEl = mkEl(); pickerEl.hidden = true;
const searchEl = mkEl(), listEl = mkEl(), emptyEl = mkEl(); emptyEl.hidden = true;
const elMap = { "#hfChoiceModal": modalEl, "#hfChoicePanel": choiceEl, "#hfPickerPanel": pickerEl, "#hfPickerSearch202": searchEl, "#hfPickerList202": listEl, "#hfPickerEmpty202": emptyEl };
const P = (o) => ({ media_kind: "file", mime: "video/mp4", media_url: "", poster_url: "", isSample: false, team: "", player_name: "", athlete_label: "", ...o });
const sb = {
  console,
  document: { body: { appendChild() {} } },
  $: (s) => elMap[s] || null,
  ALL_PLAYS: [
    P({ id: 11, title: "Walk-off winner", player_name: "Mia Torres", athlete_label: "Mia T.", team: "Hawks", sport: "baseball", media_url: "/uploads/a.mp4", poster_url: "/posters/a.jpg", created_at: "2026-11-20 10:00:00" }),
    P({ id: 14, title: "Sample: first hit", athlete_label: "Demo D.", sport: "baseball", isSample: true, poster_url: "/posters/s.jpg", created_at: "2026-11-26 09:00:00" }),
    P({ id: 12, title: "Perfect catch photo", athlete_label: "Sam R.", sport: "softball", mime: "image/jpeg", media_url: "/uploads/b.jpg", created_at: "2026-11-22 09:00:00" }),
  ],
  CONTEST: { entries: [P({ id: 15, title: "Contest only gem", athlete_label: "Ana P.", sport: "baseball", created_at: "2026-11-25 09:00:00" }), P({ id: 16, title: "Contest sample", athlete_label: "Demo E.", sport: "soccer", isSample: true, created_at: "2026-11-24 09:00:00" })] },
  openHypeFrame: () => {},
  goSubmit: () => {},
};
sb.window = sb;
vm.runInContext(escCapSrc + "\n" + lineSrc("function parsePlayDate(") + "\n" + pickerBlock, vm.createContext(sb));
const eligibleIds = sb.hfPickerEligible202().map((p) => p.id);
assert(JSON.stringify(eligibleIds) === JSON.stringify([15, 12, 11]), "C: eligibility drops BOTH samples (a board sample 14 and a contest-only sample 16) and keeps the real plays, newest first");
sb.openHfChoice(); sb.hfChoicePosted();
assert((listEl.innerHTML.match(/hf-picker-row/g) || []).length === 3, "C: the rendered picker lists exactly the 3 real plays");
assert(!listEl.innerHTML.includes("Sample: first hit") && !listEl.innerHTML.includes("Contest sample") && !listEl.innerHTML.includes("⭐ SAMPLE PLAY"), "C: no sample title and no SAMPLE PLAY tag anywhere in the rendered list");
assert(listEl.innerHTML.includes('onclick="hfPickerPick202(11)"'), "C: real rows stay wired to the pick handler");
sb.ALL_PLAYS = [P({ id: 14, title: "Sample: first hit", isSample: true, created_at: "2026-11-26 09:00:00" })];
sb.CONTEST = { entries: [] };
sb.hfPickerRender202("");
assert(!listEl.innerHTML.includes("hf-picker-row") && emptyEl.hidden === false && emptyEl.textContent.includes("No plays are up yet"), "C: an all-samples board lands on the honest empty state (post yours) — the Upload-a-photo / own-video paths on the choice card stay reachable from there");

// ---- D. VM drive: the real openHypeFrame refuses a sample seed ----
const ohfSrc = appJs.slice(appJs.indexOf("window.openHypeFrame = (id)"), appJs.indexOf("function initHfStudio"));
const callsD = { init: [], panel: [], choice: 0, alerts: [] };
const sbD = {
  console,
  ALL_PLAYS: [
    { id: 11, title: "Walk-off winner", isSample: false },
    { id: 14, title: "Sample: first hit", isSample: true },
  ],
  CONTEST: { entries: [] },
  alert: (m) => callsD.alerts.push(m),
  showHome: () => {},
  closeMenu: () => {},
  showPanel: (p) => callsD.panel.push(p),
  initHfStudio: (play) => callsD.init.push(play.id),
  openHfChoice: () => { callsD.choice++; },
  history: { state: null, replaceState() {} },
  document: { getElementById: () => ({ scrollIntoView() {} }) },
};
sbD.window = sbD;
vm.runInContext(ohfSrc, vm.createContext(sbD));
sbD.openHypeFrame(14);
assert(callsD.init.length === 0 && callsD.panel.length === 0, "D: a sample seed NEVER reaches initHfStudio or the studio panel — the sample's frames never load");
assert(callsD.choice === 1, "D: the refused seed lands on the choice card instead");
sbD.openHypeFrame(11);
assert(JSON.stringify(callsD.init) === JSON.stringify([11]) && callsD.panel.includes("hypeframe"), "D: a real play still seeds the studio exactly as before");
sbD.openHypeFrame(999);
assert(callsD.alerts.length === 1 && callsD.init.length === 1, "D: an unknown id keeps the pre-existing not-on-the-board alert, nothing opens");

// ---- E. server boot: the order guard ----
const s = await boot(8946);
try {
  const j = async (p, opts = {}) => { const r = await fetch(s.base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  const claim = await j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token; assert(tok, "E: owner claim returns token");
  const mk = async (title) => (await j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) })).body.id;
  const realId = await mk("Real Frame Play");
  const sampleId = await mk("Sample Frame Play");
  await j(`/api/highlights/${realId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  const asSample = await j(`/api/highlights/${sampleId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved", sample: true }) });
  assert(asSample.body.isSample === true, "E: the fixture sample is approved AND sample-marked (owner marking untouched)");
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const orderPayload = (highlightId, extra = {}) => ({ highlightId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", guardianName: "Pat Parent", guardianEmail: "frameguardian@example.com", image: PNG, ...extra });
  const post = (payload) => j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  let r = await post(orderPayload(sampleId));
  assert(r.status === 400 && r.body.ok === false && /Sample plays are demos/.test(r.body.message || ""), "E: an order sourced from a SAMPLE play is rejected (400, the endpoint's ok:false shape)");
  r = await post(orderPayload(sampleId, { guardianEmail: "" }));
  assert(r.status === 400 && /Sample plays are demos/.test(r.body.message || ""), "E: the sample refusal fires ahead of the other validations — a sample can't be dressed up to slip past");
  r = await post(orderPayload(realId));
  assert(r.status === 201 && r.body.ok, "E: an order from a REAL play is accepted (201), exactly as before");
  r = await post(orderPayload(realId));
  assert(r.status === 201 && r.body.ok, "E: an Upload-a-photo session's order (same wire shape — it rides the seeding real play, the photo is the print image) is accepted too");
  r = await post(orderPayload(99999));
  assert(r.status === 404, "E: a missing play keeps the pre-existing 404 — the guard changed nothing for non-sample sources");
  const list = await j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  assert(list.status === 200 && list.body.requests.length === 2 && list.body.requests.every((o) => o.highlight_id === realId), "E: only the two real-play orders were stored — the rejected sample orders left no rows");
  const pub = await (await fetch(s.base + "/api/highlights?division=all")).text();
  assert(pub.includes("Sample Frame Play"), "E: spot check — the sample play itself still lives on the board, untouched");
} finally { s.child.kill(); }

console.log("\nALL R231 CHECKS PASSED");
