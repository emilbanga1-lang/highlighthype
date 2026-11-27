// Round 229 (2026-11-27) — the studio round: sticky fix, auto
// fence-clean, Print style picker removal. All three are Emil's
// direct asks from 2026-11-27.
//   A. Pins + (a) statics: the pin zone wraps garment + moment +
//      artwork and closes BEFORE the buy card; the sticky rule
//      itself is unchanged (confinement is structural); the
//      product page's reserved bottom padding is the bar's real
//      height (96px), the 118px void is gone.
//      →235: superseded again — the bar went sticky-in-flow and
//      the reserve was deleted outright (padding-bottom:12px).
//   B. (c) statics: no preset buttons/markup/CSS/minis/setter
//      anywhere; compose has no preset branches; the payload
//      carries preset:"hypeframe" + branding:true; the labels
//      map carries only hypeframe.
//   C. (b) server matrix: fence-status detect/auto words across
//      the configuration matrix (no keys / both / vision only /
//      OpenAI only / HH_NO_FENCE / HH_NO_FENCE_AUTO); the
//      fence-detect endpoint answers via the stubbed vision
//      upstream, stands down without calling it when auto is
//      off, 503s with no vision key, 400s a bad body, and
//      rate-limits at 30/hr on its own budget.
//   D. (b) client drive (VM, real fence block): status landing
//      auto-checks the frozen frame; a fence → detect+edit once,
//      cleaned becomes the print source, note + Use original
//      show; re-picking the same frame re-applies from cache
//      with ZERO new calls; Use original reverts and STICKS
//      (re-pick does not re-clean); Use cleaned photo re-applies
//      from cache; a fence-free frame → one detect, no edit, no
//      UI noise; detection unconfigured → no auto calls, the
//      manual step shows exactly as Round 222; an auto failure
//      caches the verdict and surfaces the manual step.
//   E. (c) server: a new order with a legacy preset value
//      (classic) + branding:false stores branding ON; a missing
//      preset/branding stores ON; historical interpretation is
//      untouched (only new payloads).
// Exits non-zero on failure. Anthropic + OpenAI are NEVER really
// called: configured boots point AI_VISION_BASE_URL /
// HF_AVATAR_BASE_URL at in-process stubs (the house pattern).
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AvwEf/9k=";

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));
const prod = studio.slice(studio.indexOf('id="hfProduct215"'), studio.indexOf('id="hfReview215"'));

// ---- A. pins + sticky statics ----
assert(home.includes('src="app.js?v=232"') && home.includes('href="styles.css?v=223"'), "A: asset pins — app.js v225 / styles v218 (Round 229) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236)");
{
  const zoneOpen = prod.indexOf('id="hfPinZone229"');
  const garment = prod.indexOf('id="hfGarment206"');
  const artwork = prod.indexOf('id="hfArtworkPanel215"');
  const zoneClose = prod.indexOf("/hfPinZone229");
  const buy = prod.indexOf('id="hfBuyCard215"');
  const bar = prod.indexOf('id="hfStickyBar215"');
  assert(zoneOpen > -1 && garment > zoneOpen && artwork > garment && zoneClose > artwork && buy > zoneClose && bar > buy, "A: the pin zone wraps garment → moment → artwork and closes BEFORE Color & size; the buy card + Review bar live outside it");
  assert(css.includes("#hfProduct215 .hf-garment206{position:sticky;top:70px;z-index:40"), "A: the sticky rule itself is unchanged — confinement is structural (the parent), not a new position scheme");
  assert(css.includes("#hfProduct215{max-width:560px;margin:0 auto;padding-bottom:12px}") && !css.includes("padding-bottom:118px") && css.includes(".hf-stickybar215{position:sticky;bottom:0"), "A: the product page's bottom padding is normal (12px) and the bar is sticky-in-flow — →235: the 96px reserve this round set is deleted (the fixed bar + reserve still read as a dead band in Emil's 15:06 shot; measured bar height ~81px vs 118px of stacked void)");
  assert(css.includes(".hf-fence-auto229") && css.includes(".hf-fence-auto229[hidden]{display:none}"), "A: the auto fence block's styles + [hidden] guard ship");
}

// ---- B. print-style removal statics ----
{
  assert(!home.includes("data-hf-preset") && !home.includes("hf-presets") && !home.includes(">Print style</h4>"), "B: no Print style picker markup, buttons or heading anywhere in the page (historical round comments may still name it)");
  assert(!appJs.includes("function hfSetPreset") && !appJs.includes("data-hf-preset") && !appJs.includes("function hfRenderPresetMinis206") && !appJs.includes("function hfMiniPoster206"), "B: the preset setter, its wiring and the mini renderer are removed from app.js");
  assert(!css.includes(".hf-preset-mini206") && !css.includes(".hf-presets"), "B: preset + mini styles are removed from the stylesheet");
  const compose = appJs.slice(appJs.indexOf("function composeHfPrint()"), appJs.indexOf("const HF_PRESET_LABELS205"));
  assert(!compose.includes('preset === "signature"') && !compose.includes('preset === "hypeframe"') && compose.includes("hfDrawFormat218(x, W, fc, lay)"), "B: composeHfPrint has no preset branches left — it always composes the Hype Frame format");
  assert(appJs.includes('preset: "hypeframe"') && appJs.includes("branding: true"), "B: the order payload carries the fixed preset + branding:true");
  assert(appJs.includes('HF_PRESET_LABELS205 = { hypeframe: "Hype Frame" }'), "B: the labels map carries only hypeframe (legacy values fall back to it)");
  assert(appJs.includes('hfState.preset = "hypeframe"'), "B: studio open fixes the preset state to hypeframe");
  // Untouched neighbors:
  assert(home.includes('id="hfImageStyles"') && home.includes('data-hf-image-style="avatar"'), "B: the Photo vs Illustrated avatar choice is untouched");
  assert(home.includes('id="hfBackText197"') && home.includes('id="hfLabel218"') && home.includes('id="hfSides"'), "B: name-on-design modes, the design label and print placement are untouched");
}

// ---- C. server matrix ----
async function boot(port, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r229-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HH_NO_FENCE: "", HH_NO_FENCE_AUTO: "", HF_AVATAR_BASE_URL: "", HF_AVATAR_MODEL: "", AI_VISION_BASE_URL: "", ...env },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 60; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); const body = await r.json().catch(() => ({})); return { status: r.status, body }; };
  return { tmp, child, base, j, getLog: () => log, stop: async () => { child.kill("SIGKILL"); await wait(300); } };
}
function stubs(visionPort, openaiPort, fenceAnswer) {
  const calls = { vision: 0, openai: 0 };
  const vision = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { calls.vision++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ fence: fenceAnswer }) }] })); });
  });
  const openai = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { calls.openai++; res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ data: [{ b64_json: PNG.split(",")[1] }] })); });
  });
  return new Promise((resolve) => {
    vision.listen(visionPort, () => openai.listen(openaiPort, () => resolve({
      calls, visionUrl: `http://localhost:${visionPort}`, openaiUrl: `http://localhost:${openaiPort}`,
      close: () => { vision.close(); openai.close(); },
    })));
  });
}
const detect = (s, image) => s.j("/api/hype-frame/fence-detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: image || JPEG }) });

{
  // No keys at all.
  const s = await boot(45301);
  const st = await s.j("/api/hype-frame/fence-status");
  assert(st.body.configured === false && st.body.detect === false && st.body.auto === false, "C: no keys — status reads configured/detect/auto all false");
  const d = await detect(s);
  assert(d.status === 503 && d.body.configured === false, "C: no vision key — fence-detect 503s (never blind-anything)");
  await s.stop();
}
{
  // Both keys, fence present.
  const st = await stubs(45321, 45322, true);
  const s = await boot(45302, { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl });
  const stt = await s.j("/api/hype-frame/fence-status");
  assert(stt.body.configured === true && stt.body.detect === true && stt.body.auto === true, "C: both keys — status reads configured/detect/auto all true");
  const d = await detect(s);
  assert(d.status === 200 && d.body.ok === true && d.body.fence === true && d.body.auto === true, "C: detect answers fence:true through the vision stub");
  assert(st.calls.vision === 1 && st.calls.openai === 0, "C: detection calls vision ONCE and never touches the edit upstream");
  const bad = await s.j("/api/hype-frame/fence-detect", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "nope" }) });
  assert(bad.status === 400, "C: a bad body 400s");
  await s.stop(); st.close();
}
{
  // Both keys, no fence.
  const st = await stubs(45323, 45324, false);
  const s = await boot(45303, { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl });
  const d = await detect(s);
  assert(d.status === 200 && d.body.fence === false, "C: detect answers fence:false when the vision stub says no fence");
  await s.stop(); st.close();
}
{
  // HH_NO_FENCE_AUTO=1: status stands auto down; detect answers without an upstream call.
  const st = await stubs(45325, 45326, true);
  const s = await boot(45304, { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl, HH_NO_FENCE_AUTO: "1" });
  const stt = await s.j("/api/hype-frame/fence-status");
  assert(stt.body.configured === true && stt.body.detect === true && stt.body.auto === false, "C: HH_NO_FENCE_AUTO=1 — detect stays true, auto reads false (manual step returns)");
  const d = await detect(s);
  assert(d.status === 200 && d.body.auto === false && d.body.fence === false && st.calls.vision === 0, "C: with auto off, fence-detect answers fence:false WITHOUT calling the vision upstream");
  await s.stop(); st.close();
}
{
  // Vision only (edit unconfigured) + OpenAI only (detection unconfigured) + HH_NO_FENCE.
  const s1 = await boot(45305, { AI_VISION_API_KEY: "k" });
  const st1 = await s1.j("/api/hype-frame/fence-status");
  assert(st1.body.configured === false && st1.body.detect === false && st1.body.auto === false, "C: vision key but no OpenAI key — detect/auto false (the edit can't run, so auto can't)");
  await s1.stop();
  const s2 = await boot(45306, { OPENAI_API_KEY: "k" });
  const st2 = await s2.j("/api/hype-frame/fence-status");
  assert(st2.body.configured === true && st2.body.detect === false && st2.body.auto === false, "C: OpenAI key but no vision key — the manual step is configured, detect/auto false (today's behavior)");
  await s2.stop();
  const s3 = await boot(45307, { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", HH_NO_FENCE: "1" });
  const st3 = await s3.j("/api/hype-frame/fence-status");
  assert(st3.body.configured === false && st3.body.detect === false && st3.body.auto === false, "C: HH_NO_FENCE=1 stands EVERYTHING down (edit, detect, auto)");
  await s3.stop();
}
{
  // Detect rate budget: 30/hr on its own budget.
  const st = await stubs(45327, 45328, false);
  const s = await boot(45308, { AI_VISION_API_KEY: "k", OPENAI_API_KEY: "k", AI_VISION_BASE_URL: st.visionUrl, HF_AVATAR_BASE_URL: st.openaiUrl });
  let last = null;
  for (let i = 0; i < 30; i++) { last = await detect(s); assert(last.status === 200, "C: detect call " + (i + 1) + " of 30 is inside the budget"); }
  last = await detect(s);
  assert(last.status === 429, "C: the 31st detect in the hour is rate-limited (429) on the detect budget");
  assert(serverJs.includes("const FENCE_DETECT_RATE_LIMIT229 = 30") && serverJs.includes("const FENCE_RATE_LIMIT = 6"), "C: detect has its own 30/hr budget; the shared edit budget stays 6/hr");
  await s.stop(); st.close();
}

// ---- E. order sanitization ----
{
  const s = await boot(45309, {});
  const claim = await s.j("/api/owner/claim", { method: "POST" });
  const tok = claim.body.token;
  const mk = await s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Legacy Preset Play", sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
  const playId = mk.body.id;
  await s.j(`/api/highlights/${playId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
  const payload = (extra) => ({ highlightId: playId, customName: "Nick", jersey: "13", apparel: "hoodie", colorway: "Black", size: "YM", guardianName: "Pat Parent", guardianEmail: "parent@example.com", image: PNG, ...extra });
  const r1 = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({ preset: "classic", branding: false })) });
  assert(r1.status === 201, "E: an order with a legacy preset value is created");
  const r2 = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({})) });
  assert(r2.status === 201, "E: an order with no preset/branding at all is created");
  const list = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  const o1 = list.body.requests.find((q) => q.id === r1.body.id);
  const o2 = list.body.requests.find((q) => q.id === r2.body.id);
  assert(o1.branding === true, "E: legacy preset 'classic' + branding:false stores branding ON (treated as hypeframe)");
  assert(o2.branding === true, "E: missing preset/branding stores branding ON");
  await s.stop();
}

// ---- D. client drive (VM) ----
function fakeCanvas(tag, w, h) {
  const cv = { width: w || 200, height: h || 150, _tag: tag || "x" };
  cv.getContext = () => ({ drawImage(src) { cv._tag = (src && src._tag) || "x"; } });
  cv.toDataURL = () => "data:image/jpeg;base64," + cv._tag + "-" + cv.width + "x" + cv.height;
  return cv;
}
function driveStudio({ statusBody, detectAnswer, detectFails }) {
  const fenceBlock = appJs.slice(appJs.indexOf("let hfFenceStatusPromise222"), appJs.indexOf("/* Part F (Round 206 scope update, Emil): the review stage."));
  const els = {};
  const mkEl = () => ({ hidden: false, textContent: "", disabled: false, _src: "", setAttribute() {}, getAttribute() { return this._src; }, set src(v) { this._src = v; }, get src() { return this._src; } });
  const canvasEl = fakeCanvas("FENCED", 200, 150);
  const calls = { status: 0, detect: 0, remove: 0 };
  const sb = {
    console,
    hfState: {
      play: { id: 9 }, frozen: true, printDataUrl: "", printAspect: 0, seedFrame215: true,
      frameCanvas206: fakeCanvas("FENCED", 200, 150),
      avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, designAspect218: 0, avatarFocus221: null,
      fenceConfigured222: null, fenceBusy222: false, fenceClean222: "",
      fenceDetect229: null, fenceAuto229: null, fenceAutoCache229: {}, fenceAutoKey229: "", fenceAutoClean229: "",
      fenceAutoOriginal229: null, fenceAutoBusy229: false, fenceAutoFailed229: false, fenceAutoToken229: 0,
    },
    $: (sel) => {
      if (sel === "#hfCanvas") return canvasEl;
      return els[sel] || (els[sel] = mkEl());
    },
    $$: () => [],
    document: { createElement: () => fakeCanvas("x", 1, 1) },
    Image: class { set src(v) { this._src = v; this.naturalWidth = 120; this.naturalHeight = 90; queueMicrotask(() => this.onload && this.onload()); } },
    fetch: async (path, opts) => {
      const ok = (body) => ({ ok: true, status: 200, json: async () => body });
      if (path === "/api/hype-frame/fence-status") { calls.status++; return ok(statusBody); }
      if (path === "/api/hype-frame/fence-detect") {
        calls.detect++;
        if (detectFails) return { ok: false, status: 502, json: async () => ({ ok: false, message: "boom" }) };
        // The vision stub answers from the frame's own tag, which
        // rides inside the sent image's data URL (fake canvas
        // toDataURL) — a FENCED frame fences, a CLEAN one doesn't.
        let fence = !!detectAnswer;
        try { fence = String((JSON.parse(opts.body || "{}").image || "")).includes("FENCED"); } catch {}
        return ok({ ok: true, configured: true, auto: true, fence });
      }
      if (path === "/api/hype-frame/remove-fence") { calls.remove++; return ok({ ok: true, configured: true, image: "data:image/png;base64,CLEANED" }); }
      throw new Error("unexpected fetch " + path);
    },
    setTimeout, clearTimeout, AbortController,
    composeHfPrint() { sb.hfState.printDataUrl = "data:print"; sb._composes = (sb._composes || 0) + 1; },
    hfSyncAvatar206() {},
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(fenceBlock, ctx);
  return { sb, calls, els, canvasEl };
}
const settle = async () => { for (let i = 0; i < 30; i++) await wait(10); };

{
  // Auto mode, fence present.
  const { sb, calls, els } = driveStudio({ statusBody: { ok: true, configured: true, detect: true, auto: true }, detectAnswer: true });
  await sb.hfFenceStatus222(); // the status landing itself re-enters the auto flow
  await settle();
  assert(calls.detect === 1 && calls.remove === 1, "D: entering the studio auto-checks the seeded frame — one detect, one edit");
  assert(sb.hfState.fenceAutoClean229 === "data:image/png;base64,CLEANED", "D: the cleaned frame becomes the print source by default");
  assert(els["#hfFenceAutoOriginal229"].hidden === false, "D: the 'Use original' revert is offered");
  assert((els["#hfFenceAutoNote229"].textContent || "").includes("automatically"), "D: the inline note says the fence was removed automatically");
  assert(els["#hfFence222"].hidden === true, "D: the manual panel stands down in auto mode");
  assert(els["#hfFenceAuto229"].hidden === false, "D: the auto block (note + revert) is visible in auto mode — →235: the standing disclosure paragraph was removed from the block (Emil: it takes too much room); only the dynamic note + revert remain");

  // Re-pick the SAME frame: cache re-applies with zero new calls.
  const origFrame = fakeCanvas("FENCED", 200, 150);
  sb.hfState.frameCanvas206 = origFrame;
  sb.hfFenceAutoReset229();
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 1 && calls.remove === 1, "D: re-picking the same frame re-applies from cache — ZERO new detect/edit calls");
  assert(sb.hfState.fenceAutoClean229 === "data:image/png;base64,CLEANED", "D: …and the cleaned frame is the print source again");

  // Use original: reverts and STICKS.
  sb.hfFenceAutoRevert229();
  assert(sb.hfState.fenceAutoClean229 === "" && els["#hfFenceAutoCleaned229"].hidden === false, "D: 'Use original' restores the as-shot frame and offers the cleaned one back");
  sb.hfState.frameCanvas206 = fakeCanvas("FENCED", 200, 150);
  sb.hfFenceAutoReset229();
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 1 && calls.remove === 1 && sb.hfState.fenceAutoClean229 === "", "D: a reverted frame is NOT re-cleaned on re-pick (the parent's choice sticks, still zero new calls)");

  // Use cleaned photo: re-applies from cache.
  sb.hfFenceAutoUseCleaned229();
  await settle();
  assert(sb.hfState.fenceAutoClean229 === "data:image/png;base64,CLEANED" && calls.remove === 1, "D: 'Use cleaned photo' re-applies the cached clean — no new edit call");

  // A different, fence-free frame: one detect, no edit, no UI noise.
  sb.hfState.frameCanvas206 = fakeCanvas("CLEAN", 200, 150);
  sb.hfFenceAutoReset229();
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 2 && calls.remove === 1, "D: a new frame is detected once; a fence-free frame never reaches the edit");
  assert(els["#hfFenceAutoNote229"].textContent === "" && els["#hfFenceAutoActions229"].hidden === true, "D: no fence → no UI noise (note empty, no actions)");
}
{
  // Detection unconfigured → today's behavior: manual step, no auto UI, no auto calls.
  const { sb, calls, els } = driveStudio({ statusBody: { ok: true, configured: true, detect: false, auto: false }, detectAnswer: true });
  await sb.hfFenceStatus222();
  await settle();
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 0 && calls.remove === 0, "D: detection unconfigured — the auto flow makes NO calls");
  assert(els["#hfFence222"].hidden === false, "D: …and the manual Remove-the-fence step shows exactly as in Round 222");
  assert(els["#hfFenceAuto229"].hidden === true, "D: …with no auto UI at all");
}
{
  // Auto failure: verdict cached, manual step surfaces, no retry loop.
  const { sb, calls, els } = driveStudio({ statusBody: { ok: true, configured: true, detect: true, auto: true }, detectFails: true });
  await sb.hfFenceStatus222();
  await settle();
  assert(calls.detect === 1 && sb.hfState.fenceAutoFailed229 === true, "D: a failed auto attempt is recorded (fenceAutoFailed229)");
  assert(els["#hfFence222"].hidden === false, "D: …and the manual step surfaces as the fallback");
  sb.hfAutoFence229();
  await settle();
  assert(calls.detect === 1, "D: the failed frame is not retried in a loop (cached verdict)");
}

console.log("\nALL R229 CHECKS PASSED");
