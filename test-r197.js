// Round 197 test: Hype Frame back-text options (Emil, 2026-11-25 —
// parent feedback with the first delivered sweatshirt: no name,
// name + number, or their own words instead of the name).
// Run: node test-r197.js
// Boots the server on scratch DATA_DIRs:
//   A. Defaults — the studio markup + served wiring carry the
//      four-option picker; orders placed through the real endpoint:
//      the untouched default flow stores back_text 'name' and the
//      confirmation line is the name (today's behavior); name +
//      number stores the jersey DIGITS and confirms "Name · #N";
//      name + number with no digits is rejected; 'none' stores and
//      confirms as no back text; custom words at exactly 16 chars
//      pass and store verbatim, 17 chars / empty / emoji / control
//      characters are rejected with a clear message (server path);
//      basic punctuation passes. The owner list carries the
//      production instruction (backTextToEmbroider, "" = NO BACK
//      TEXT) and the custom-review flag; the owner-only reviewed
//      endpoint sets it and the flag clears.
//   B. Legacy — a row written with only the pre-R197 columns (what
//      the guarded migrations leave behind) reads back as option 1
//      ('name') with the name as its instruction, no data change.
// The client validator is then driven in a vm slice of the served
// app.js: hfCustomTextError197 mirrors the server rules.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(port, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r197-"));
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
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const text = async (p) => { const r = await fetch(base + p); return r.text(); };
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, j, text, stop, getLog: () => log };
}

const GUARDIAN = "backtext-parent@example.com";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const orderPayload = (highlightId, extra = {}) => ({ highlightId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", guardianName: "Pat Parent", guardianEmail: GUARDIAN, image: PNG, ...extra });
const post = (s, p, body, tok) => s.j(p, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { "x-owner-token": tok } : {}) }, body: JSON.stringify(body) });

try {
  // ---------- Boot A: the four options end to end ----------
  const s = await boot(3521);
  try {
    const home = await s.text("/");
    assert(home.includes('src="app.js?v=238"') && home.includes('href="styles.css?v=227"'), "A: asset pins — app.js now v197 (Round 197); styles keeps v194 (unchanged this round) — →198: app.js + styles now v198 (Round 196 changed both) — →199: app.js + styles now v199 (Round 198) — →200: app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round)");
    for (const v of ["name", "name_number", "none", "custom"])
      assert(home.includes(`data-hf-back-text="${v}"`), `A: studio picker carries the back-text option: ${v}`);
    assert(home.includes('id="hfBackText197"') && home.includes('id="hfBackCustom197"') && home.includes('id="hfBackCustomRow197"'), "A: studio markup carries the picker, the custom-words input and its row");
    const appJs = await s.text("/app.js");
    assert(appJs.includes("function hfPickBackText197") && appJs.includes("function hfCustomTextError197"), "A: served app.js carries the R197 picker + validator");
    assert(appJs.includes("backText: hfState.backText") && appJs.includes("backTextCustom:"), "A: the order payload sends the back-text choice + custom words");
    assert(appJs.includes("Back text: No back text") && appJs.includes("backTextToEmbroider"), "A: the confirmation names the embroidered back text (or 'No back text')");
    assert(appJs.includes("CUSTOM TEXT — REVIEW") && appJs.includes("hfMarkBackTextReviewed197") && appJs.includes("NO BACK TEXT"), "A: the owner view renders the production instruction + the custom-review flag");

    // Setup: an approved play to order from.
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token; assert(tok, "A: owner claim returns a token");
    const mk = async (title) => (await post(s, "/api/highlights", { title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" })).body.id;
    const playId = await mk("Back Text Play");
    const appr = await post(s, `/api/highlights/${playId}/status`, { status: "approved" }, tok);
    assert(appr.body.status === "approved", "A: play approved for the order tests");
    const ownerRow = async (id) => {
      const r = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
      return (r.body.requests || []).find((o) => o.id === id) || null;
    };

    // 1. Default flow: parent touches nothing (no backText fields).
    let r = await post(s, "/api/hype-frame/orders", orderPayload(playId));
    assert(r.status === 201 && r.body.ok, "A: default order is created (201)");
    assert(r.body.backTextToEmbroider === "Nick", "A: default confirmation line is the player's name");
    const defId = r.body.id;
    let o = await ownerRow(defId);
    assert(o && o.back_text === "name" && o.back_text_custom === "" && o.back_text_reviewed === false, "A: default order stores back_text 'name', no custom words, not flagged");
    assert(o.backTextToEmbroider === "Nick", "A: owner instruction for the default order is the name");

    // 2. Name + number: digits are stored, confirmation renders them.
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "name_number", jersey: "#13" }));
    assert(r.status === 201, "A: name + number order is created (201)");
    assert(r.body.backTextToEmbroider === "Nick · #13", "A: name + number confirmation renders 'Nick · #13'");
    o = await ownerRow(r.body.id);
    assert(o.back_text === "name_number" && o.jersey === "13", "A: name + number stores the jersey digits only ('13')");
    assert(o.backTextToEmbroider === "Nick · #13", "A: owner instruction renders name + number");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "name_number", jersey: "abc" }));
    assert(r.status === 400 && /jersey number/i.test(r.body.message || ""), "A: name + number with no digits is rejected with a clear message");

    // 3. No name: stored, and every surface says no back text.
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "none" }));
    assert(r.status === 201 && r.body.backTextToEmbroider === "", "A: no-name order is created; its embroider line is empty (= No back text)");
    o = await ownerRow(r.body.id);
    assert(o.back_text === "none" && o.backTextToEmbroider === "", "A: owner instruction for the no-name order is empty (renders NO BACK TEXT)");

    // 4. Custom words: exactly 16 chars pass, stored verbatim.
    const SIXTEEN = "GO PLAINVIEW !!!"; assert(SIXTEEN.length === 16, "fixture: the custom line is exactly 16 characters");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: `  ${SIXTEEN}  ` }));
    assert(r.status === 201, "A: custom order at exactly 16 characters is created (201)");
    assert(r.body.backTextToEmbroider === SIXTEEN, "A: custom confirmation line is the parent's words, trimmed");
    const customId = r.body.id;
    o = await ownerRow(customId);
    assert(o.back_text === "custom" && o.back_text_custom === SIXTEEN && o.back_text_reviewed === false, "A: custom order stores the words and starts UNREVIEWED");
    assert(o.backTextToEmbroider === SIXTEEN, "A: owner instruction for the custom order is the exact string");

    // Custom validation failures (server path).
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "GO PLAINVIEW !!!!" }));
    assert(r.status === 400 && /16 characters/.test(r.body.message || ""), "A: 17-character custom line is rejected (16-char limit named)");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "" }));
    assert(r.status === 400 && /Write the words/.test(r.body.message || ""), "A: empty custom line is rejected with a clear message");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "   " }));
    assert(r.status === 400, "A: whitespace-only custom line is rejected (trimmed, then empty)");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "GO 🥎 TEAM" }));
    assert(r.status === 400 && /embroidery can't stitch/.test(r.body.message || ""), "A: emoji in custom words is rejected (embroidery constraint)");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "GO\u0007TEAM" }));
    assert(r.status === 400, "A: a control character in custom words is rejected");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { backText: "custom", backTextCustom: "MIA'S #1 FAN!" }));
    assert(r.status === 201 && r.body.backTextToEmbroider === "MIA'S #1 FAN!", "A: basic punctuation (apostrophe, #, !) passes");

    // The reviewed flag: owner-only, sets, and clears in the list.
    r = await s.j(`/api/owner/hype-frames/${customId}/back-text-reviewed`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert(r.status === 403, "A: marking reviewed requires owner auth (403 without token)");
    r = await post(s, `/api/owner/hype-frames/${customId}/back-text-reviewed`, {}, tok);
    assert(r.status === 200 && r.body.backTextReviewed === true, "A: owner marks the custom order reviewed");
    o = await ownerRow(customId);
    assert(o.back_text_reviewed === true, "A: the owner list now shows the custom order reviewed (flag cleared)");
    r = await post(s, "/api/owner/hype-frames/999999/back-text-reviewed", {}, tok);
    assert(r.status === 404, "A: marking a nonexistent order reviewed 404s cleanly");

    // Guardian privacy is unchanged by the new fields.
    const pub = await s.text("/api/highlights?division=all");
    assert(!pub.includes(GUARDIAN) && !pub.includes(SIXTEEN), "A: neither the guardian email nor custom back words leak into public payloads");
    var dataDir = s.tmp;
    var ownerTok = tok; // /api/owner/claim is one-time — Boot B reuses this token
  } finally { await s.stop(); }

  // ---------- Boot B: a legacy row reads back as option 1 ----------
  // A row written with ONLY the pre-R197 columns is what the guarded
  // migrations leave behind (new columns take their defaults). Seed
  // it directly, reboot on the same DATA_DIR, and read it back.
  const dbB = new DatabaseSync(path.join(dataDir, "highlighthype.db"));
  dbB.prepare("INSERT INTO hype_frame_orders (highlight_id, print_image, custom_name, jersey, guardian_email, status) VALUES (1, '', 'Legacy Kid', '7', 'legacy@example.com', 'pending-guardian')").run();
  dbB.close();
  const s2 = await boot(3522, dataDir);
  try {
    const list = await s2.j("/api/owner/hype-frames", { headers: { "x-owner-token": ownerTok } });
    const legacy = (list.body.requests || []).find((o) => o.guardian_email === "legacy@example.com");
    assert(legacy, "B: the legacy order is listed after the migration");
    assert(legacy.back_text === "name" && legacy.back_text_custom === "" && legacy.back_text_reviewed === false, "B: legacy order reads back as option 1 (name) with no data change");
    assert(legacy.backTextToEmbroider === "Legacy Kid", "B: legacy order's production instruction is its stored name");
  } finally { await s2.stop(); }

  // ---------- VM drive: the client validator mirrors the server ----------
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const sb = { console };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(appJs.slice(appJs.indexOf("const HF_BACK_TEXT_197"), appJs.indexOf("function hfPickBackText197")), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  assert(run(`hfCustomTextError197("GO PLAINVIEW !!!")`) === "", "VM: client validator passes exactly 16 characters");
  assert(/16 characters/.test(run(`hfCustomTextError197("GO PLAINVIEW !!!!")`)), "VM: client validator rejects 17 characters");
  assert(/Write the words/.test(run(`hfCustomTextError197("   ")`)), "VM: client validator rejects an empty line");
  assert(/embroidery can't stitch/.test(run(`hfCustomTextError197("GO 🥎 TEAM")`)), "VM: client validator rejects emoji");
  assert(run(`hfCustomTextError197("MIA'S #1 FAN!")`) === "", "VM: client validator passes basic punctuation");

  console.log("\nR197 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
