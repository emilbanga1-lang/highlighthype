// Round 208 test: the print-side default flips to Back (Emil, 2026-11-26).
// Run: node test-r208.js
// What this suite pins down:
//   A. Pins: app.js v209 (this round); styles keeps v205.
//      →210: app.js now v210 / styles now v206 (Round 209).
//   B. Statics: every place the default lives now says Back —
//      the hfState literal, the initHfStudio reset, the picker
//      markup's pressed button, hfPickSide's fallback, the
//      server sanitizer, the DB column default for a fresh DB,
//      and the owner email / Owner view side fallbacks.
//   C. Studio drive (VM, the REAL hfState literal + hfPickSide):
//      the studio opens on side "back"; an explicit Front pick
//      still flows into state (and would ride the payload); a
//      bogus pick lands on "back" — the client fallback agrees
//      with the server's.
//   D. Preview coherence (VM, hfGarmentSync206 on the real
//      opening state): with side + view both "back", the
//      composed print shows on the opening back view — the
//      Round 206 tension (back view opened on the name alone)
//      is resolved; flipping the VIEW to front hides the print
//      area (the print sits on the back) without touching side.
//   E. Server: an order with no side stores "back"; a bogus
//      side stores "back"; explicit "front" / "back" (any case)
//      pass through exactly; the owner API reflects each.
// Stored orders from before the flip are untouched by design —
// nothing here migrates or rewrites a row.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r208-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HF_AVATAR_BASE_URL: "", ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  return { tmp, child, base, j, getLog: () => log, stop: () => child.kill("SIGKILL") };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));

// ---- A. pins ----
assert(home.includes('src="app.js?v=237"') && home.includes('href="styles.css?v=227"'), "A: asset pins — app.js v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242)");

// ---- B. statics: the default's every home now says Back ----
assert(appJs.includes('apparel: "hoodie", side: "back", imageStyle: "photo"'), "B: the hfState literal opens on side 'back'");
const initBody = appJs.slice(appJs.indexOf("function initHfStudio"), appJs.indexOf("function hfPickColor")); // →229: slice end was hfSetPreset — retired with the picker
assert(initBody.includes('hfPickSide("back")') && !initBody.includes('hfPickSide("front")'), "B: initHfStudio resets the side picker to Back for each new play");
assert(studio.includes('data-hf-side="back" aria-pressed="true"') && studio.includes('data-hf-side="front" aria-pressed="false"'), "B: the picker markup's pressed button is Back");
const pickSideBody = appJs.slice(appJs.indexOf("function hfPickSide"), appJs.indexOf("function hfPickImageStyle"));
assert(pickSideBody.includes('side === "front" ? "front" : "back"'), "B: hfPickSide's fallback lands on 'back' (explicit front/back unchanged)");
assert(serverJs.includes('String(body.side || "").trim().toLowerCase() === "front" ? "front" : "back"'), "B: the server sanitizer's fallback is 'back'");
assert(serverJs.includes("ADD COLUMN side TEXT DEFAULT 'back'"), "B: the DB column default for a fresh DB is 'back'");
assert(serverJs.includes('order.side === "front" ? "Front" : "Back"'), "B: the owner email's side fallback agrees (Back)");
assert(appJs.includes('o.side === "front" ? "Front" : "Back"'), "B: the Owner view's side fallback agrees (Back)");

// ---- C. studio drive: the real hfState literal + hfPickSide ----
{
  const litStart = appJs.indexOf("const hfState = {");
  const litText = appJs.slice(litStart, appJs.indexOf("\n", litStart));
  const sideBtns = ["front", "back"].map((v) => ({ dataset: { hfSide: v }, attrs: {}, setAttribute(k, val) { this.attrs[k] = val; } }));
  const sb = {
    console,
    $: () => null,
    $$: (s) => (s.includes("data-hf-side") ? sideBtns : []),
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfSyncSummary205: () => {},
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(litText.replace("const hfState", "globalThis.hfState"), ctx);
  vm.runInContext(pickSideBody, ctx);
  const S = sb.hfState;
  assert(S.side === "back", "C: the studio opens with side 'back'");
  assert(S.garmentView206 === "back", "C: the garment preview still opens on the back view (Round 206)");
  sb.hfPickSide("front");
  assert(S.side === "front", "C: an explicit Front pick still flows into state");
  assert(sideBtns[0].attrs["aria-pressed"] === "true" && sideBtns[1].attrs["aria-pressed"] === "false", "C: the picker pressed state follows the Front pick");
  sb.hfPickSide("back");
  assert(S.side === "back" && sideBtns[1].attrs["aria-pressed"] === "true", "C: picking Back restores side + pressed state");
  sb.hfPickSide("sideways");
  assert(S.side === "back", "C: a bogus pick lands on 'back' — client fallback agrees with the server");
}

// ---- D. preview coherence: the opening back view carries the print ----
{
  const block = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", style: {}, attrs: {},
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    set src(v) { this._src = v; }, get src() { return this._src; },
  });
  const els = {
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentBackText206": mkEl(), "#hfGarmentWide206": mkEl(),
    "#hfCanvas": { width: 1280, height: 720 },
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
  };
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                 { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    // The studio's opening state after Round 208: side + view both back.
    hfState: { frozen: true, printDataUrl: "data:print", colorway: "Black", side: "back", garmentView206: "back", backText: "name", placement: { cx: 50, cy: 42, size: 78 }, avatarPreview206: false, avatarDataUrl206: "", avatarApplied206: false },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfPrintTone: () => "#f6f1e4",
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(block, ctx);
  sb.hfGarmentSync206();
  assert(els["#hfGarment206"].hidden === false && els["#hfGarmentPrintArea206"].hidden === false && els["#hfGarmentPrint206"].src === "data:print", "D: the opening back view shows the composed print (the Round 206 tension is resolved)");
  assert(els["#hfGarmentBackText206"].hidden === true && els["#hfGarmentBackText206"].textContent === "", "D: →218: the embroidered back-name treatment is RETIRED — the name rides INSIDE the print artwork, so the back view carries no separate words element");
  sb.hfState.garmentView206 = "front";
  sb.hfGarmentSync206();
  assert(els["#hfGarmentPrintArea206"].hidden === true, "D: the front view hides the print area (the print sits on the back)");
  assert(sb.hfState.side === "back", "D: flipping the view never touched the order's side");
}

// ---- E. server: the stored default ----
{
  const s = await boot(4128);
  try {
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const mk = await s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Side Default Play", sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    const playId = mk.body.id;
    await s.j(`/api/highlights/${playId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    const payload = (extra = {}) => ({ highlightId: playId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", guardianName: "Pat Parent", guardianEmail: "sideparent@example.com", image: PNG, ...extra });
    const post = async (extra) => {
      const r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload(extra)) });
      assert(r.status === 201, "E: order created (" + JSON.stringify(extra) + ")");
      return r.body.id;
    };
    const noSideId = await post({});
    const bogusId = await post({ side: "sideways" });
    const frontId = await post({ side: "front" });
    const backId = await post({ side: "back" });
    const frontCapsId = await post({ side: "Front" });
    const list = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
    const byId = (id) => list.body.requests.find((q) => q.id === id);
    assert(byId(noSideId).side === "back", "E: an order without a side stores 'back'");
    assert(byId(bogusId).side === "back", "E: a bogus side is sanitized to 'back'");
    assert(byId(frontId).side === "front", "E: an explicit 'front' stores 'front' exactly");
    assert(byId(backId).side === "back", "E: an explicit 'back' stores 'back' exactly");
    assert(byId(frontCapsId).side === "front", "E: an explicit 'Front' (any case) still stores 'front'");
  } finally { s.stop(); }
}

console.log("\nALL R208 CHECKS PASSED");
