// Round 221 test: the avatar fidelity fix (Emil, 2026-11-26).
// Run: node test-r221.js
// Why: the first live R218 generation (Nicholas's "Double") came
// back as an invented generic at-bat — the model was fed the
// whole wide frame and re-drew a scene around the small athlete
// in it. Emil picked the fix: a stricter prompt + a zoomed crop.
// What this suite pins down:
//   A. Pins: app.js v219 / styles v213 (both files changed).
//   B. Server prompt: hfAvatarPrompt218's illustration paragraph
//      carries the composition-lock clauses (exact camera angle /
//      framing / composition, no camera move, nobody or nothing
//      added or removed, the same instant) AND every R218 format
//      slot survives verbatim (additions only).
//   C. Crop math (hfAvatarCrop221): width = 65% of frame width,
//      height = width × 1.25 (height-clamped for wide frames),
//      centered on the focus (default center), clamped fully
//      inside the frame at all four corners and for out-of-range
//      focus values. — →222: the default crop tightens to 55%
//      of frame width (athlete-dominant: the athlete fills the
//      crop instead of sitting small inside the whole scene).
//   D. The panel + Make flow (VM, real hfMakeAvatar206): the
//      crop preview shows the frame with the crop box at the
//      focus; a tap re-centers it; the posted {image} is the
//      CROP rendered from the crop rect (dims + the 9-arg
//      drawImage source rect), capped at 1024 long side; the
//      R218 design slots ride unchanged and the approval gate
//      still only previews. — →222: the crop is sent UPSCALED
//      2× (cap 2048 long side) so the tighter crop still feeds
//      the model a full-size image.
//   E. The photo path is untouched: hfDrawFormat218 /
//      composeHfPrint never reference the crop, and the order
//      payload gains no crop fields.
//   F. Markup + CSS: the crop block lives inside
//      #hfAvatarPanel206 with the verbatim caption; the styles
//      ship.
//   G. Served: pins + the crop code come off a booted server.
// Exits non-zero on failure. The real OpenAI API is NEVER
// called: the configured boot points HF_AVATAR_BASE_URL at an
// in-process stub.
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

async function boot(port, extraEnv = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r221-"));
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
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");

// ---- A. pins ----
assert(home.includes('src="app.js?v=221"') && home.includes('href="styles.css?v=214"'), "A: asset pins — app.js v219 / styles v213 (Round 221; both files changed) — →222: app.js now v220, styles now v214 (Round 222; both files changed) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round)");

// ---- B. Server prompt: composition lock added, R218 slots verbatim ----
const stubCalls = [];
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    stubCalls.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.split(",")[1] }] }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubBase = `http://127.0.0.1:${stub.address().port}`;
{
  const s = await boot(45221, { OPENAI_API_KEY: "test-key-221", HF_AVATAR_BASE_URL: stubBase });
  try {
    const r = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG, nameMode: "name", name: "Nicholas", label: "Double", tone: "blue" }) });
    assert(r.status === 200 && r.body.image === PNG, "B: the generation round-trips through the stub upstream");
    const body = stubCalls[stubCalls.length - 1];
    assert(body.includes("Keep the photo's exact camera angle, framing and composition — redraw THIS scene from THIS viewpoint and do not move the camera."), "B: composition lock — same camera angle / framing / composition, no camera move");
    assert(body.includes("Do not add or remove people or objects: whoever and whatever is in the photo stays in the picture, and nothing that is not in the photo appears."), "B: composition lock — nobody and nothing added or removed");
    assert(body.includes("The athlete's pose, body position and action must match the photo's moment exactly — the same instant, not a similar play."), "B: composition lock — the exact same instant, not a similar play");
    assert(body.includes('the text "Nicholas" in huge bright blue brush-stroke lettering'), "B: R218 slot verbatim — the name top line");
    assert(body.includes('the label "DOUBLE" in small white letter-spaced capital letters'), "B: R218 slot verbatim — the label line (uppercased server-side)");
    assert(body.includes("solid black background") && body.includes("gold brush-stroke crown") && body.includes("distressed white grunge frame"), "B: R218 format anatomy verbatim — black ground, crown, grunge frame");
    assert(body.includes('the words "HYPE FRAME" in huge white brush-stroke lettering') && body.includes('"HIGHLIGHTHYPE" in small white letter-spaced capital letters with the word HYPE in gold'), "B: R218 branding verbatim — HYPE FRAME + HIGHLIGHTHYPE");
    assert(body.includes("illustrate the scene that is actually there instead of inventing a new one."), "B: R218 fidelity sentence verbatim — the clauses are additions, nothing was rewritten away");
    assert(body.includes("The athlete's face is a stylized illustration, never photorealistic."), "B: R218 stylized-face rule verbatim");
  } finally { s.stop(); }
}
stub.close();
assert(serverJs.includes("function hfAvatarPrompt218"), "B: the prompt is still built server-side by hfAvatarPrompt218");

// ---- C + D. Studio VM: crop math, preview, tap, and the Make payload ----
{
  const drawLog = [];
  const mkCanvas = () => {
    const cv = { width: 0, height: 0, getContext() { return { drawImage: (...a) => drawLog.push({ cv, a }) }; }, toDataURL: () => `data:image/jpeg;base64,FAKE_${cv.width}x${cv.height}` };
    return cv;
  };
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", disabled: false, style: {}, attrs: {}, listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    removeAttribute(k) { if (k === "src") this._src = undefined; delete this.attrs[k]; },
    set src(v) { this._src = v; }, get src() { return this._src; },
  });
  const stageEl = Object.assign(mkEl(), { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 355 }) });
  const framePortrait = { width: 720, height: 1280 };
  const els = {
    "#hfName": { value: "Nicholas Banga" }, "#hfJersey": { value: "" }, "#hfBackCustom197": { value: "" },
    "#hfLabel218": { value: "Double" },
    "#hfAvatarPanel206": mkEl(), "#hfAvatarMake206": mkEl(), "#hfAvatarStatus206": mkEl(),
    "#hfAvatarResult206": mkEl(), "#hfAvatarImg206": mkEl(), "#hfAvatarUse206": mkEl(), "#hfAvatarPhoto206": mkEl(),
    "#hfAvatarCrop221": mkEl(), "#hfAvatarCropImg221": mkEl(), "#hfAvatarCropBox221": mkEl(),
    "#hfAvatarCropDot221": mkEl(), "#hfAvatarCropStage221": stageEl,
    "#hfCanvas": mkEl(),
  };
  const generic = {};
  const posts = [];
  const sb = {
    console, setTimeout, clearTimeout, AbortController,
    $: (s) => els[s] || (generic[s] ??= mkEl()),
    $$: () => [],
    document: { createElement: (t) => (t === "canvas" ? mkCanvas() : mkEl()), addEventListener: () => {}, body: mkEl() },
    fetch: async (url, opts) => { posts.push({ url, opts }); return { ok: true, json: async () => ({ ok: true, image: "data:gen221" }) }; },
    hfState: { play: { id: 9, title: "Double", division: "boys" }, frozen: true, frameCanvas206: framePortrait, backText: "name", imageStyle: "avatar", avatarConfigured206: true, avatarBusy206: false, avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, avatarFocus221: null, designAspect218: 0, printDataUrl: "", printAspect: 0, side: "back", colorway: "Black", garmentView206: "back", size: "YM", apparel: "hoodie", preset: "hypeframe", placement: { cx: 50, cy: 42, size: 78 }, mediaType: "video" },
    hfGarmentSync206: () => {},
    composeHfPrint: () => {},
    hfPickImageStyle: () => {},
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(appJs.slice(appJs.indexOf("const HF_TONE_BLUE218"), appJs.indexOf("function hfLabelDefault218")), ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("let hfAvatarStatusPromise206"), appJs.indexOf("/* Part F (Round 206 scope update")), ctx);
  const S = sb.hfState;
  const crop = (w, h, f) => sb.hfAvatarCrop221(w, h, f);
  const eq = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

  // C. Crop math. — →222: 55% width (athlete-dominant).
  assert(eq(crop(720, 1280, null), { x: 162, y: 393, w: 396, h: 495 }), "C: portrait frame, default focus — 55% width (396) × 1.25 (495), centered (162, 393) — →222: tightened from the R221 65% crop (468×585 at 126, 348)");
  assert(eq(crop(1920, 1080, null), { x: 528, y: 0, w: 864, h: 1080 }), "C: wide frame — the 1.25 height clamps to the frame height and the width follows (864 × 1080; unchanged by →222: the height clamp governs wide frames)");
  assert(eq(crop(720, 1280, { x: 0, y: 0 }), { x: 0, y: 0, w: 396, h: 495 }), "C: focus top-left — the crop clamps to the corner");
  assert(eq(crop(720, 1280, { x: 1, y: 1 }), { x: 324, y: 785, w: 396, h: 495 }), "C: focus bottom-right — the crop clamps inside (324, 785)");
  assert(eq(crop(720, 1280, { x: 0, y: 1 }), { x: 0, y: 785, w: 396, h: 495 }) && eq(crop(720, 1280, { x: 1, y: 0 }), { x: 324, y: 0, w: 396, h: 495 }), "C: the other two corners clamp the same way");
  assert(eq(crop(720, 1280, { x: 2, y: -1 }), { x: 324, y: 0, w: 396, h: 495 }), "C: an out-of-range focus is clamped to the frame before the math");
  for (const [w, h] of [[720, 1280], [1920, 1080], [1280, 720], [100, 80], [4000, 3000], [300, 300]]) {
    for (const f of [null, { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.3, y: 0.8 }]) {
      const c = crop(w, h, f);
      assert(c.x >= 0 && c.y >= 0 && c.x + c.w <= w && c.y + c.h <= h && c.w >= 1 && c.h >= 1, `C: the crop stays fully inside a ${w}×${h} frame (focus ${JSON.stringify(f)})`);
    }
  }

  // D1. The preview: frame shown, crop box at the default center.
  sb.hfSyncAvatarCrop221();
  const wrap = els["#hfAvatarCrop221"], box = els["#hfAvatarCropBox221"], dot = els["#hfAvatarCropDot221"], pimg = els["#hfAvatarCropImg221"];
  const pct = (v) => parseFloat(v);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert(wrap.hidden === false, "D: with a frozen frame the crop preview shows");
  assert(String(pimg.src).includes("FAKE_288x512"), "D: the preview renders the frame itself (512-capped: 288×512 for a 720×1280 frame)");
  assert(near(pct(box.style.left), 22.5) && near(pct(box.style.top), 30.703125) && near(pct(box.style.width), 55) && near(pct(box.style.height), 38.671875), "D: the crop box marks exactly the default crop (left 22.5%, top 30.703125%, 55% × 38.671875%) — →222: the athlete-dominant 55% box (was 17.5% / 27.1875% / 65% × 45.703125% in R221)");
  assert(dot.style.left === "50%" && dot.style.top === "50%", "D: the focus marker starts at the frame's center");

  // D2. Taps re-center.
  sb.hfAvatarCropTap221({ clientX: 0, clientY: 0 });
  assert(S.avatarFocus221.x === 0 && S.avatarFocus221.y === 0 && box.style.left === "0%" && box.style.top === "0%", "D: a tap at the corner moves the focus there and the crop follows (clamped)");
  sb.hfAvatarCropTap221({ clientX: 200, clientY: 355 });
  assert(S.avatarFocus221.x === 1 && S.avatarFocus221.y === 1 && near(pct(box.style.left), 45) && near(pct(box.style.top), 61.328125), "D: a tap at the far corner re-centers the crop on it (box at 45% / 61.328125%) — →222: follows the 55% crop (was 35% / 54.296875%)");

  // D3. Make posts the CROP.
  S.avatarFocus221 = { x: 0, y: 0.5 };
  drawLog.length = 0; posts.length = 0;
  await sb.hfMakeAvatar206();
  assert(posts.length === 1 && posts[0].url === "/api/hype-frame/avatar", "D: Make posts once to the avatar endpoint");
  const sent = JSON.parse(posts[0].opts.body);
  assert(sent.image === "data:image/jpeg;base64,FAKE_792x990", "D: the posted image is the CROP's canvas upscaled 2× (792×990 from the 396×495 crop), not the full 720×1280 frame — →222: R221 posted the crop at native size (468×585)");
  const nine = drawLog.filter((d) => d.a.length === 9 && d.a[0] === framePortrait);
  assert(nine.length === 1 && nine[0].a[1] === 0 && nine[0].a[2] === 393 && nine[0].a[3] === 396 && nine[0].a[4] === 495, "D: the crop is drawn from the crop rect (source 0, 393, 396×495 — focus {0, 0.5} clamped)");
  assert(sent.nameMode === "name" && sent.name === "Nicholas" && sent.label === "DOUBLE" && sent.tone === "blue", "D: the R218 design slots ride unchanged (name mode, first name, label, tone)");
  assert(S.avatarDataUrl206 === "data:gen221" && S.avatarPreview206 === true && S.avatarApplied206 === false, "D: the approval gate is intact — a finished generation only PREVIEWS");

  // D4. A big frame: the crop renders capped at 2048 on its long side.
  S.frameCanvas206 = { width: 2400, height: 1600 };
  S.avatarFocus221 = null;
  drawLog.length = 0; posts.length = 0;
  await sb.hfMakeAvatar206();
  const sent2 = JSON.parse(posts[0].opts.body);
  assert(sent2.image === "data:image/jpeg;base64,FAKE_1638x2048", "D: a 2400×1600 frame's crop (1280×1600) posts at the 2048 cap (1638×2048) — →222: R221 capped the send at 1024 (819×1024)");
  S.frameCanvas206 = framePortrait;
}

// ---- E. Photo path + order payload untouched ----
{
  const fmt = appJs.slice(appJs.indexOf("function hfDrawFormat218"), appJs.indexOf("\n}", appJs.indexOf("function composeHfPrint")) + 2);
  assert(!fmt.includes("Crop221") && !fmt.includes("avatarFocus221"), "E: the format composer + print composition never reference the crop — the photo path uses the full frame as today");
  const submit = appJs.slice(appJs.indexOf("async function hfSubmitOrder206"), appJs.indexOf("(function wireHf206()"));
  assert(!submit.includes("Crop221") && !submit.includes("avatarFocus221"), "E: the order payload gains no crop fields — the crop is a send-time choice only");
  const makeBlock = appJs.slice(appJs.indexOf("async function hfMakeAvatar206"), appJs.indexOf("function hfApplyAvatar206"));
  assert(makeBlock.includes("hfAvatarCrop221(src.width, src.height, hfState.avatarFocus221)"), "E: the crop is applied exactly where the avatar image is built (the Make flow)");
}

// ---- F. Markup + CSS ----
{
  const panel = home.slice(home.indexOf('id="hfAvatarPanel206"'), home.indexOf('id="hfLabel218"'));
  for (const id of ["hfAvatarCrop221", "hfAvatarCropStage221", "hfAvatarCropImg221", "hfAvatarCropBox221", "hfAvatarCropDot221"]) {
    assert(panel.includes(`id="${id}"`), "F: the avatar panel carries #" + id);
  }
  assert(panel.includes("This is what the artist sees — tap the photo to center on your athlete."), "F: the crop caption ships verbatim");
  assert(panel.indexOf('id="hfAvatarConsent206"') < panel.indexOf('id="hfAvatarCrop221"') && panel.indexOf('id="hfAvatarCrop221"') < panel.indexOf('id="hfAvatarMake206"'), "F: the crop preview sits between the consent line and the Make button");
  assert(css.includes(".hf-avatar-crop-stage221{") && css.includes(".hf-avatar-crop-box221{") && css.includes(".hf-avatar-crop-dot221{"), "F: the crop styles ship (stage, box, focus dot)");
}

// ---- G. Served ----
{
  const s = await boot(45222);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=221"') && served.includes('href="styles.css?v=214"'), "G: the served homepage carries the Round 221 pins — →222: now the Round 222 pins (app.js v220 / styles v214) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round)");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("function hfAvatarCrop221") && servedApp.includes("hfAvatarCrop221(src.width, src.height, hfState.avatarFocus221)"), "G: the served app.js carries the crop math + the Make-flow crop");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(servedCss.includes(".hf-avatar-crop221{"), "G: the served styles.css carries the crop rules");
  } finally { s.stop(); }
}

console.log("\nALL R221 CHECKS PASSED");
