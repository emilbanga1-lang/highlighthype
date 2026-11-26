// Round 206 test: the hoodie preview round (Emil, 2026-11-26).
// Run: node test-r206.js
// What this suite pins down:
//   A. Pins: app.js v207 / styles v204 (both files changed) —
//      →208: app.js now v208 / styles now v205 (Round 207).
//   B. Part A statics: the on-garment preview block in the studio
//      (stage, garment img, print area + print img, back-words
//      treatment, front/back flip, wide-shot note); app.js points
//      at the four derived garment illustrations; the SVGs exist
//      on disk with the baked-in street graphics stripped.
//   C. Part A drive (VM): hfGarmentSync206 — front view shows the
//      print at its placement; back view shows the embroidered
//      words (name / custom / none), the garment follows the
//      colorway, the print rides the side it sits on, a wide
//      frame flags the print-area outline + note, and nothing
//      shows before a freeze.
//   D. Part C: fine scrubbing — the ±0.1s steppers ride
//      hfJumpToFrame (so the capture uses the nudged time),
//      accumulate from the picked frame, clamp at the ends, and
//      stand down for photo plays; the fine readout format.
//   E. Part E: the three style minis ride the preset buttons;
//      hfSyncFrozenThumb re-renders minis + garment on every
//      recompose (the choke-point hooks).
//   F. Part B statics: the avatar panel + the verbatim consent
//      line in the studio; the client posts ONLY {image} (no
//      prompt field can exist); the order payload carries
//      avatarGenerated; the server carries the locked prompt
//      constant, the OPENAI_API_KEY gate and the kill switch.
//   G. Part B server, NO key: status {configured:false}, the
//      generate endpoint answers 503 {configured:false}.
//   H. Part B server, fake key + stub upstream: status true; a
//      generation round-trips the stub's PNG; the stub saw the
//      Bearer key, model gpt-image-1 and the LOCKED prompt — a
//      client-sent "prompt" field never reaches upstream; a
//      malformed frame is a 400.
//   I. Part B kill switch: HH_NO_AVATAR=1 with a key set still
//      answers configured:false / 503.
//   J. Part B rate limit: 6 generations per IP per hour — the
//      7th is a 429.
//   K. Order marking: avatarGenerated + imageStyle avatar stores
//      avatar_generated=1 (owner API + the owner email's AI
//      avatar line); avatar style alone stays "illustrate
//      first"; a photo order's flag is ignored.
//   L. Served: the homepage carries the pins + studio blocks;
//      the garment SVGs serve.
//   Scope update (Emil, later on 2026-11-26, from his
//   configurator mockup):
//   M. Layout + the preview-only flip: the garment preview is
//      the studio's hero (above the grid); the sections run
//      Your moment → Artwork → Hoodie color → Size →
//      personalization; the preview defaults to Black + BACK;
//      driving the flip changes ONLY garmentView206 — the
//      order payload built from the state is byte-identical
//      before/after flips, and two orders posted around flips
//      store identically server-side.
//   N. The avatar approval gate + the review stage: a finished
//      generation previews on the garment WITHOUT becoming the
//      print (no auto-apply in the maker); the form CTA is
//      "Review hoodie request" (+ "No payment today"); the
//      review reflects color / size / placement / artwork /
//      back text (VM drive of hfReviewSync206) and the send
//      behind it (hfSubmitOrder206) posts the pre-R206 payload
//      shape, while the bare form submit no longer posts.
// Exits non-zero on failure. The real OpenAI API is NEVER
// called: no key exists locally, and the configured boots point
// HF_AVATAR_BASE_URL at an in-process stub.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r206-"));
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
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));

// ---- A. pins ----
assert(home.includes('href="styles.css?v=205"') && home.includes('src="app.js?v=209"'), "A: asset pins — app.js v207 / styles v204 (Round 206; both files changed) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");

// ---- B. Part A statics ----
for (const id of ["hfGarment206", "hfGarmentStage206", "hfGarmentImg206", "hfGarmentPrintArea206", "hfGarmentPrint206", "hfGarmentBackText206", "hfGarmentWide206"])
  assert(studio.includes(`id="${id}"`), "B: garment preview carries #" + id);
assert(studio.includes('data-hf-garment-view="front"') && studio.includes('data-hf-garment-view="back"'), "B: the preview flips front / back");
assert(studio.includes("Preview — your design on the hoodie"), "B: the preview is labeled as a preview");
for (const f of ["hf-garment-front-black206.svg", "hf-garment-back-black206.svg", "hf-garment-front-gray206.svg", "hf-garment-back-gray206.svg"]) {
  assert(appJs.includes("/swag/" + f), "B: app.js points at " + f);
  const svg = fs.readFileSync(path.join(ROOT, "public/swag", f), "utf8");
  assert(svg.includes("<svg") && svg.includes('viewBox="0 0 640 720"'), "B: " + f + " is the 640x720 garment illustration");
  assert(!svg.includes(">HYPE<") && !svg.includes('<g opacity="1">'), "B: " + f + " has the baked-in street graphics stripped (blank garment)");
}
assert(css.includes(".hf-garment-stage206{") && css.includes("aspect-ratio:640/720") && css.includes(".hf-garment206[hidden]{display:none}"), "B: garment CSS — the stage keeps the illustration's aspect, [hidden] guarded");
assert(css.includes(".hf-review206[hidden]{display:none}") && css.includes(".hf-changeframe206[hidden]{display:none}"), "B: review + change-frame CSS guards ship");
// Scope update layout (see also M): hero position + section order.
assert(studio.indexOf('id="hfGarment206"') > -1 && studio.indexOf('id="hfGarment206"') < studio.indexOf('class="hf-grid"'), "B: the garment preview is the studio's hero — above the controls grid");
const ord206 = [">Your moment</h4>", ">Artwork</h4>", ">Hoodie color</h4>", "Size <button", ">Personalization</h4>"].map((n) => studio.indexOf(n));
assert(ord206.every((i) => i > -1) && ord206.every((v, i) => i === 0 || v > ord206[i - 1]), "B: the sections run Your moment → Artwork → Hoodie color → Size → personalization (Emil's mockup order)");
assert(studio.includes('id="hfChangeFrame206"') && studio.includes(">Change frame</button>"), "B: 'Your moment' carries the Change frame action");
assert(studio.includes('id="hfReview206"') && studio.includes('id="hfReviewSend206"') && studio.includes('id="hfReviewSize206"') && studio.includes('id="hfReviewPlacement206"') && studio.includes('id="hfReviewArt206"'), "B: the review stage ships (garment + size / placement / artwork rows + send)");

// ---- C. Part A drive (VM) ----
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
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "GO HAWKS!" },
  };
  const flips = [{ dataset: { hfGarmentView: "front" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
                 { dataset: { hfGarmentView: "back" }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }];
  const sb = {
    console,
    $: (s) => els[s] || null,
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: { frozen: true, printDataUrl: "data:print", colorway: "Black", side: "front", garmentView206: "front", backText: "name", placement: { cx: 50, cy: 42, size: 78 }, avatarPreview206: false, avatarDataUrl206: "", avatarApplied206: false },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfPrintTone: () => "#f6f1e4",
  };
  sb.window = sb;
  vm.runInContext(block, vm.createContext(sb));
  const S = sb.hfState, G = els["#hfGarment206"], GI = els["#hfGarmentImg206"], GA = els["#hfGarmentPrintArea206"], GP = els["#hfGarmentPrint206"], GB = els["#hfGarmentBackText206"], GW = els["#hfGarmentWide206"];

  sb.hfGarmentSync206();
  assert(G.hidden === false, "C: a frozen frame shows the garment preview");
  assert(GI.src === "/swag/hf-garment-front-black206.svg", "C: front view wears the Black front illustration");
  assert(GA.hidden === false && GP.src === "data:print", "C: the composed print rides the front (the side it sits on)");
  assert(GP.style.width === "78%" && GP.style.left === "50%" && GP.style.top === "42%", "C: the print sits at its true placement (size / cx / cy)");
  assert(GA.classList.set.has("hf-garment-area-wide206") && GW.hidden === false, "C: Part D — a 16:9 frame flags the wide-shot outline + note");
  assert(GB.hidden === true, "C: no back words on the front view");

  S.garmentView206 = "back";
  sb.hfGarmentSync206();
  assert(GI.src === "/swag/hf-garment-back-black206.svg", "C: the flip shows the garment's back");
  assert(GB.hidden === false && GB.textContent === "NICK", "C: the back carries the embroidered name treatment");
  assert(GA.hidden === true, "C: a front-side print stays off the back view");

  S.backText = "custom";
  sb.hfGarmentSync206();
  assert(GB.textContent === "GO HAWKS!", "C: 'Your own words' ride the back verbatim");
  S.backText = "none";
  sb.hfGarmentSync206();
  assert(GB.hidden === true, "C: 'No name' leaves a clean back");

  S.backText = "name"; S.side = "back";
  sb.hfGarmentSync206();
  assert(GA.hidden === false && GP.src === "data:print", "C: a back-side print joins the words on the back view");
  S.garmentView206 = "front";
  sb.hfGarmentSync206();
  assert(GA.hidden === true, "C: ...and leaves the front clean");

  S.colorway = "Heather Gray";
  sb.hfGarmentSync206();
  assert(GI.src === "/swag/hf-garment-front-gray206.svg", "C: the garment follows the Heather Gray colorway");

  els["#hfCanvas"] = { width: 720, height: 1280 }; // portrait art: not wide
  sb.hfGarmentSync206();
  assert(!GA.classList.set.has("hf-garment-area-wide206") && GW.hidden === true, "C: Part D — a portrait frame clears the wide-shot flag");

  // Approval gate: an unapproved generation previews on the
  // garment while the print art stays the photo composition.
  S.garmentView206 = "front"; S.side = "front"; S.avatarDataUrl206 = "data:avatar"; S.avatarPreview206 = true;
  sb.hfGarmentSync206();
  assert(GP.src === "data:avatar", "C: an unapproved avatar previews on the garment in place of the print");
  assert(S.printDataUrl === "data:print", "C: ...while the order's print art is still the photo composition");
  S.avatarPreview206 = false;
  sb.hfGarmentSync206();
  assert(GP.src === "data:print", "C: standing the preview down restores the photo print on the garment");

  S.frozen = false;
  sb.hfGarmentSync206();
  assert(G.hidden === true, "C: no freeze, no garment preview");
}

// ---- D. Part C: fine scrubbing ----
{
  assert(studio.includes('id="hfFineRow206"') && studio.includes('id="hfFineBack206"') && studio.includes('id="hfFineFwd206"') && studio.includes('id="hfFineTime206"'), "D: the fine-scrub row rides the studio (steppers + readout)");
  const fineBlock = appJs.slice(appJs.indexOf("function hfFineStep206"), appJs.indexOf("/* Part E:"));
  assert(fineBlock.includes("hfJumpToFrame(target, null)"), "D: fine steps ride the tap path — the print capture uses the nudged time");
  const jumps = [];
  const sb = {
    console,
    $: (s) => (s === "#hfVideo" ? { currentTime: 2, duration: 12 } : null),
    hfState: { mediaType: "video", frameTime205: 4 },
    hfJumpToFrame: (t) => { jumps.push(t); sb.hfState.frameTime205 = t; },
  };
  sb.window = sb;
  vm.runInContext(fineBlock, vm.createContext(sb));
  sb.hfFineStep206(0.1);
  assert(jumps.length === 1 && Math.abs(jumps[0] - 4.1) < 1e-9, "D: +0.1s nudges the picked frame to 4.1");
  sb.hfFineStep206(0.1);
  assert(Math.abs(jumps[1] - 4.2) < 1e-9, "D: repeated taps accumulate from the picked frame (4.2), not the landed position");
  sb.hfFineStep206(-0.1);
  assert(Math.abs(jumps[2] - 4.1) < 1e-9, "D: −0.1s steps back to 4.1");
  sb.hfState.frameTime205 = 0;
  sb.hfFineStep206(-0.1);
  assert(jumps[3] === 0, "D: the nudge clamps at the start of the clip");
  sb.hfState.mediaType = "image";
  const before = jumps.length;
  sb.hfFineStep206(0.1);
  assert(jumps.length === before, "D: fine scrubbing stands down for photo plays");
  const fmtBlock = appJs.slice(appJs.indexOf("function hfFineFmt206"), appJs.indexOf("\n}", appJs.indexOf("function hfFineFmt206")) + 2);
  const sb2 = { console }; sb2.window = sb2;
  vm.runInContext(fmtBlock, vm.createContext(sb2));
  assert(sb2.hfFineFmt206(4.3) === "0:04.3" && sb2.hfFineFmt206(62.5) === "1:02.5", "D: the fine readout names tenths (0:04.3 / 1:02.5)");
  const wire = appJs.slice(appJs.indexOf("(function wireHf206()"), appJs.indexOf("/* Round 200"));
  assert(wire.includes("hfFineStep206(-0.1)") && wire.includes("hfFineStep206(0.1)"), "D: the steppers are wired to the fine step");
}

// ---- E. Part E: style minis ----
{
  for (const p of ["classic", "signature", "hypeframe"])
    assert(studio.includes(`data-hf-preset-mini="${p}"`), "E: the " + p + " style button carries a live mini rendering");
  assert(appJs.includes("function hfRenderPresetMinis206") && appJs.includes("hfGrungeFrame(cx2") && appJs.includes("hfDrawLockup(cx2"), "E: minis mirror the real composition (grunge frame + lockup reused)");
  const syncBody = appJs.slice(appJs.indexOf("function hfSyncFrozenThumb"), appJs.indexOf("function hfOpenLightbox128"));
  assert(syncBody.includes("hfGarmentSync206()") && syncBody.includes("hfRenderPresetMinis206()"), "E: the compose choke point re-syncs the garment preview + minis on every recompose");
  assert(css.includes(".hf-preset-mini206{"), "E: mini styling rides the stylesheet");
}

// ---- F. Part B statics ----
{
  const panel = studio.slice(studio.indexOf('id="hfAvatarPanel206"'), studio.indexOf('id="hfColors"'));
  assert(panel.includes("Avatar previews are made by OpenAI's image AI — your chosen frame is sent to OpenAI to create it."), "F: the consent line sits in the avatar panel, verbatim");
  assert(panel.indexOf("hfAvatarConsent206") < panel.indexOf("hfAvatarMake206"), "F: the consent line reads BEFORE the Make button — nothing is sent before it's seen");
  for (const id of ["hfAvatarMake206", "hfAvatarStatus206", "hfAvatarResult206", "hfAvatarImg206", "hfAvatarUse206", "hfAvatarPhoto206"])
    assert(panel.includes(`id="${id}"`), "F: the avatar panel carries #" + id);
  const makeBlock = appJs.slice(appJs.indexOf("async function hfMakeAvatar206"), appJs.indexOf("function hfApplyAvatar206"));
  assert(makeBlock.includes('fetch("/api/hype-frame/avatar"') && makeBlock.includes("JSON.stringify({ image })"), "F: the maker posts ONLY the frame image");
  assert(!makeBlock.includes("prompt"), "F: no client field can reach the style prompt (the word never appears in the maker)");
  assert(makeBlock.includes("AbortController") && makeBlock.includes("120000"), "F: the generation carries a timeout — the UI never hangs forever");
  assert(!makeBlock.includes("hfApplyAvatar206(") && makeBlock.includes("avatarPreview206 = true"), "F: approval gate — a finished generation only PREVIEWS (avatarPreview206); it never auto-applies to the print");
  assert(appJs.includes("avatarGenerated: hfState.avatarApplied206 === true"), "F: the order payload marks a chosen studio avatar");
  assert(serverJs.includes("const HF_AVATAR_PROMPT206 =") && serverJs.includes("stylized illustrated avatar"), "F: the locked style prompt is a server-side constant");
  assert(serverJs.includes('process.env.OPENAI_API_KEY') && serverJs.includes('process.env.HH_NO_AVATAR !== "1"'), "F: the server gates on OPENAI_API_KEY + the HH_NO_AVATAR kill switch");
  assert(serverJs.includes('"/api/hype-frame/avatar-status"') && serverJs.includes('"/api/hype-frame/avatar"'), "F: both avatar routes exist");
  assert(serverJs.includes("avatarRateLimited") && serverJs.includes("AVATAR_RATE_LIMIT = 6"), "F: the paid endpoint carries its per-IP rate limit");
  assert(serverJs.includes("ADD COLUMN avatar_generated") && serverJs.includes("avatar_generated: body.avatarGenerated === true"), "F: the order stores the avatar_generated mark (guarded column)");
}

// ---- G. Part B server: no key ----
{
  const s = await boot(3526);
  try {
    let r = await s.j("/api/hype-frame/avatar-status");
    assert(r.status === 200 && r.body.configured === false, "G: no key — the status probe answers configured:false");
    r = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG }) });
    assert(r.status === 503 && r.body.configured === false, "G: no key — generation answers 503 {configured:false} and never reaches upstream");
  } finally { s.stop(); }
}

// ---- H + J share a stub upstream ----
const stubCalls = [];
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    stubCalls.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ data: [{ b64_json: PNG.split(",")[1] }] }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const stubBase = `http://127.0.0.1:${stub.address().port}`;

// ---- H. Part B server: fake key + stub upstream ----
{
  const s = await boot(3626, { OPENAI_API_KEY: "test-key-206", HF_AVATAR_BASE_URL: stubBase });
  try {
    let r = await s.j("/api/hype-frame/avatar-status");
    assert(r.body.configured === true, "H: with a key configured the status probe answers true");
    const before = stubCalls.length;
    r = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG, prompt: "CLIENT INJECTION", note: "ignore the recipe" }) });
    assert(r.status === 200 && r.body.ok === true && r.body.image === PNG, "H: a generation round-trips the upstream PNG as a data URL");
    assert(stubCalls.length === before + 1, "H: exactly one upstream call was made");
    const call = stubCalls[stubCalls.length - 1];
    assert(call.headers.authorization === "Bearer test-key-206", "H: the server authenticates with the env key (never a client value)");
    assert(call.body.includes('name="model"') && call.body.includes("gpt-image-1"), "H: the upstream call names the gpt-image-1 family");
    assert(call.body.includes("stylized illustrated avatar"), "H: the upstream call carries the LOCKED style prompt");
    assert(!call.body.includes("CLIENT INJECTION"), "H: a client-sent prompt field NEVER reaches upstream");
    r = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "not-a-data-url" }) });
    assert(r.status === 400, "H: a malformed frame is a 400, not an upstream call");
    assert(stubCalls.length === before + 1, "H: the malformed frame never reached upstream");
  } finally { s.stop(); }
}

// ---- I. Part B kill switch ----
{
  const s = await boot(3726, { OPENAI_API_KEY: "test-key-206", HF_AVATAR_BASE_URL: stubBase, HH_NO_AVATAR: "1" });
  try {
    let r = await s.j("/api/hype-frame/avatar-status");
    assert(r.body.configured === false, "I: HH_NO_AVATAR=1 stands the maker down even with a key set");
    r = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG }) });
    assert(r.status === 503 && r.body.configured === false, "I: the kill switch answers 503 {configured:false}");
  } finally { s.stop(); }
}

// ---- J. Part B rate limit ----
{
  const s = await boot(3826, { OPENAI_API_KEY: "test-key-206", HF_AVATAR_BASE_URL: stubBase });
  try {
    let last = null;
    for (let i = 0; i < 6; i++) last = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG }) });
    assert(last.status === 200, "J: six generations inside the hour pass");
    const seventh = await s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG }) });
    assert(seventh.status === 429, "J: the seventh generation in the window is a 429");
  } finally { s.stop(); }
}
stub.close();

// ---- K. Order marking ----
{
  const capture = path.join(os.tmpdir(), `hh-r206-mail-${Date.now()}.jsonl`);
  const s = await boot(3926, { SMTP_USER: "hello@highlighthype.com", SMTP_PASS: "test-pass", HH_MAIL_CAPTURE: capture });
  try {
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    assert(tok, "K: owner claim returns a token");
    const mk = await s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Avatar Order Play", sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    const playId = mk.body.id;
    const appr = await s.j(`/api/highlights/${playId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    assert(appr.body.status === "approved", "K: the play is approved for the order tests");
    const payload = (extra = {}) => ({ highlightId: playId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", size: "YM", guardianName: "Pat Parent", guardianEmail: "avatarparent@example.com", image: PNG, ...extra });
    let r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({ imageStyle: "avatar", avatarGenerated: true })) });
    assert(r.status === 201, "K: a studio-avatar order is created");
    const genId = r.body.id;
    r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({ imageStyle: "avatar" })) });
    const fulfillId = r.body.id;
    r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({ imageStyle: "photo", avatarGenerated: true })) });
    const photoId = r.body.id;
    r = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
    const byId = (id) => r.body.requests.find((q) => q.id === id);
    assert(byId(genId).avatar_generated === 1 && byId(genId).image_style === "avatar", "K: the generated-avatar mark round-trips to the owner API");
    assert(!byId(fulfillId).avatar_generated, "K: avatar style alone (fulfillment illustration) carries no generated mark");
    assert(!byId(photoId).avatar_generated, "K: a photo order's avatarGenerated claim is ignored");
    let mail = "";
    for (let i = 0; i < 20 && !mail.includes("AI avatar"); i++) { await wait(150); try { mail = fs.readFileSync(capture, "utf8"); } catch { /* not yet */ } }
    assert(mail.includes("AI avatar — generated in the studio (OpenAI); the print image on file IS the finished avatar"), "K: the owner email names the studio-generated avatar (no re-illustration)");
    assert(mail.includes("Avatar — illustrate the frame before printing"), "K: the fulfillment-avatar order keeps the illustrate-first line");
  } finally { s.stop(); }
}

// ---- L. Served ----
{
  const s = await boot(4026);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=209"') && served.includes('href="styles.css?v=205"'), "L: the served homepage carries the Round 206 pins — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");
    assert(served.includes('id="hfGarment206"') && served.includes('id="hfAvatarPanel206"') && served.includes("Avatar previews are made by OpenAI's image AI"), "L: the served studio carries the garment preview + avatar panel + consent line");
    const svgRes = await fetch(s.base + "/swag/hf-garment-front-black206.svg");
    const svgText = await svgRes.text();
    assert(svgRes.status === 200 && svgText.includes("<svg"), "L: the garment illustration serves");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("hfGarmentSync206") && servedApp.includes("hfMakeAvatar206"), "L: the served app.js carries the round");
  } finally { s.stop(); }
}

// ---- M. Scope update: the flip is preview-only (payload-identical) ----
{
  assert(appJs.includes('garmentView206: "back"'), "M: the garment preview's default view is the BACK (Emil's mockup starting look)");
  const garmentBlock = appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const wireAll = appJs.slice(appJs.indexOf("(function wireHf206()"), appJs.indexOf("/* Round 200"));
  const wireBlock = wireAll.slice(0, wireAll.lastIndexOf("})();") + 5);
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", style: {}, attrs: {}, listeners: {},
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    set src(v) { this._src = v; }, get src() { return this._src; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    scrollIntoView() {},
  });
  const els = {
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentBackText206": mkEl(), "#hfGarmentWide206": mkEl(),
    "#hfCanvas": { width: 1280, height: 720 },
    "#hfName": { value: "Nick" }, "#hfJersey": { value: "13" }, "#hfBackCustom197": { value: "" },
    "#hfGuardianName": { value: "Pat Parent" }, "#hfGuardianEmail": { value: "flipparent@example.com" },
    "#hfReview206": mkEl(), "#hfReviewImg206": mkEl(), "#hfReviewPrintArea206": mkEl(), "#hfReviewPrint206": mkEl(),
    "#hfReviewSize206": mkEl(), "#hfReviewPlacement206": mkEl(), "#hfReviewArt206": mkEl(), "#hfReviewBack206": mkEl(), "#hfReviewMsg206": mkEl(),
  };
  const generic = {};
  const flips = ["front", "back"].map((v) => ({ dataset: { hfGarmentView: v }, attrs: {}, listeners: {}, setAttribute(k, val) { this.attrs[k] = val; }, addEventListener(ev, fn) { this.listeners[ev] = fn; } }));
  const sb = {
    console,
    $: (s) => els[s] || (generic[s] ??= mkEl()),
    $$: (s) => (s.includes("data-hf-garment-view") ? flips : []),
    hfState: { play: { id: 0 }, frozen: true, printDataUrl: "data:print", colorway: "Black", size: "YM", side: "front", preset: "hypeframe", apparel: "hoodie", imageStyle: "photo", backText: "name", garmentView206: "back", placement: { cx: 50, cy: 42, size: 78 }, avatarApplied206: false, avatarPreview206: false, avatarDataUrl206: "" },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    HF_PRESET_LABELS205: { classic: "Classic", signature: "Signature", hypeframe: "Hype Frame" },
    hfPrintTone: () => "#f6f1e4",
    api: async () => { throw new Error("api must not be called by the flip"); },
    esc: (t) => String(t),
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(garmentBlock, ctx);
  // hfReviewSync206 rides along for N below; run the review fns too.
  vm.runInContext(appJs.slice(appJs.indexOf("function hfReviewSync206"), appJs.indexOf("async function hfSubmitOrder206")), ctx);
  vm.runInContext(wireBlock, ctx);
  const S = sb.hfState;
  // The payload exactly as hfSubmitOrder206 builds it from live state.
  const buildPayload = () => JSON.stringify({
    highlightId: S.play.id,
    customName: els["#hfName"].value.trim(),
    jersey: els["#hfJersey"].value.trim(),
    backText: S.backText,
    backTextCustom: els["#hfBackCustom197"].value.trim(),
    branding: S.preset === "hypeframe",
    apparel: S.apparel,
    side: S.side,
    imageStyle: S.imageStyle,
    avatarGenerated: S.avatarApplied206 === true,
    colorway: S.colorway,
    size: S.size,
    placement: S.placement,
    guardianName: els["#hfGuardianName"].value.trim(),
    guardianEmail: els["#hfGuardianEmail"].value.trim(),
    image: S.printDataUrl,
  });
  const placementBefore = JSON.stringify(S.placement);
  sb.hfGarmentSync206();
  const payloadBefore = buildPayload();
  flips[0].listeners.click(); // preview → front
  assert(S.garmentView206 === "front", "M: the flip actually flips the preview (front)");
  flips[1].listeners.click(); // preview → back
  flips[0].listeners.click(); // preview → front again
  assert(S.garmentView206 === "front" && flips[0].attrs["aria-pressed"] === "true", "M: repeated flips keep tracking the preview view");
  assert(S.side === "front" && JSON.stringify(S.placement) === placementBefore, "M: the flips never touched the order's side or placement");
  const payloadAfter = buildPayload();
  assert(payloadAfter === payloadBefore, "M: the order payload built after flips is BYTE-IDENTICAL to the one built before");

  // Server half: both payloads store identically.
  const s = await boot(4126);
  try {
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const mk = await s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Flip Proof Play", sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    S.play.id = mk.body.id;
    await s.j(`/api/highlights/${S.play.id}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    S.printDataUrl = PNG; // the server only accepts real image data URLs
    const pA = buildPayload();
    flips[1].listeners.click(); flips[0].listeners.click();
    const pB = buildPayload();
    assert(pA === pB, "M: payload identity holds around the server posts too");
    const rA = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: pA });
    const rB = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: pB });
    assert(rA.status === 201 && rB.status === 201, "M: both orders are created");
    const list = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
    const oA = list.body.requests.find((q) => q.id === rA.body.id), oB = list.body.requests.find((q) => q.id === rB.body.id);
    const pick = (o) => JSON.stringify({ side: o.side, placement: o.placement, colorway: o.colorway, size: o.size, image_style: o.image_style });
    assert(pick(oA) === pick(oB) && oA.side === "front", "M: the stored orders are identical in side / placement / colorway / size / style");
  } finally { s.stop(); }

  // ---- N. Scope update: the review stage reflects + sends the same payload ----
  const submitBlock = appJs.slice(appJs.indexOf("async function hfSubmitOrder206"), appJs.indexOf("(function wireHf206()"));
  assert(submitBlock.includes('api("/api/hype-frame/orders"'), "N: the review's send posts to the same orders endpoint");
  for (const f of ["highlightId", "customName", "jersey", "backText", "backTextCustom", "branding", "apparel", "side", "imageStyle", "avatarGenerated", "colorway", "size", "placement", "guardianName", "guardianEmail", "image: hfState.printDataUrl"]) {
    assert(submitBlock.includes(f), "N: the send payload still carries " + f);
  }
  const formListener = appJs.slice(appJs.indexOf('"#hfOrderForm").addEventListener("submit"'), appJs.indexOf('"#hfOrderForm").addEventListener("submit"') + 800);
  assert(formListener.includes("hfOpenReview206()") && !formListener.includes("/api/hype-frame/orders"), "N: the bare form submit validates + opens the review — it no longer posts directly");
  assert(studio.includes(">Review hoodie request</button>") && studio.includes("No payment today"), "N: the CTA + its 'No payment today' sub-line ship");
  // Drive the review sync with a fully-specified order state.
  Object.assign(S, { side: "back", colorway: "Heather Gray", size: "YL", placement: { cx: 50, cy: 46, size: 80 }, preset: "classic", imageStyle: "avatar", avatarApplied206: true });
  sb.hfReviewSync206();
  assert(els["#hfReviewImg206"].src === "/swag/hf-garment-back-gray206.svg", "N: the review shows the garment AS ORDERED (Heather Gray, back — the print's side, not the preview flip)");
  assert(els["#hfReviewPrint206"].src === S.printDataUrl, "N: the review garment carries the composed print");
  assert(els["#hfReviewSize206"].textContent === "Heather Gray hoodie · Youth L", "N: the review names the color + size");
  assert(els["#hfReviewPlacement206"].textContent.startsWith("Back print") && els["#hfReviewPlacement206"].textContent.includes("Classic"), "N: the review names the placement + style");
  assert(els["#hfReviewArt206"].textContent.includes("AI avatar"), "N: the review names the approved AI avatar as the artwork");
  assert(els["#hfReviewBack206"].textContent.includes("Nick"), "N: the review names the embroidered back text");
  Object.assign(S, { side: "front", colorway: "Black", imageStyle: "photo", avatarApplied206: false });
  sb.hfReviewSync206();
  assert(els["#hfReviewImg206"].src === "/swag/hf-garment-front-black206.svg" && els["#hfReviewPlacement206"].textContent.startsWith("Front print") && els["#hfReviewArt206"].textContent.includes("Real photo"), "N: the review follows a change back to a front photo order");
}

console.log("\nALL R206 CHECKS PASSED");
