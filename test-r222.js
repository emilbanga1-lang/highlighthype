// Round 222 test: the studio rebuild + fence removal + the
// avatar style anchor (Emil, 2026-11-26). Spec:
// files/r222-studio-layout-spec-2026-11-26.md.
// Run: node test-r222.js
// What this suite pins down:
//   A. Pins: app.js v220 / styles v214.
//   B. Layout statics: the product page reads title →
//      "$110 · Made to order" → pinned garment → sections in
//      the order moment → artwork → color & size → compact
//      sticky Review bar; the sections stand open; the moment
//      section runs strip → Upload a photo → fence → Pick
//      from video; the header pill stands down while the
//      studio is open and the menu carries Post a Play; the
//      upload flow carries the fence shooting tip; Review's
//      submit is "Send order request" + the verbatim line.
//   C. Sizes: the studio picker offers exactly 9 sizes (no
//      YXXS button, none pressed) while the server's 10-size
//      map (Shopify variants) and the size guide keep YXXS.
//   D. The no-preselected-size gate (VM, real wiring):
//      Review holds with the size prompt until a size is
//      tapped; hfValidateOrder206 returns the size message;
//      the summary + review lines read "Pick a size";
//      hfPickSize rejects YXXS in the studio.
//   E. The fence endpoint (stub upstream): status/config
//      gates (no key → false/503; HH_NO_FENCE → false/503),
//      the remove-fence-only prompt round-trips, bad bodies
//      400, the 7th call in an hour 429s; the client's
//      approval flow statics (Use swaps the print source,
//      Keep discards, never automatic).
//   F. The avatar style anchor (stub upstream): the request
//      carries TWO image parts — the photo first, then the
//      tone-matched reference asset's exact bytes (blue →
//      boys, pink → girls) — and the prompt carries the
//      duty split + exact-lettering clause with every R218
//      slot and R221 composition lock intact.
//   G. The distinct-first strip picker (VM, pure function):
//      each still's luma signature is compared against the
//      last DISTINCT still kept — near-identical runs dedupe,
//      the ★ leads, unreadable stills never suppress, and
//      nothing is removed (the full strip follows in order).
//   H. Served: pins + the rebuild's code/markup/styles.
// Exits non-zero on failure. The real OpenAI API is NEVER
// called: configured boots point HF_AVATAR_BASE_URL at an
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r222-"));
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", OPENAI_API_KEY: "", HH_NO_AVATAR: "", HH_NO_FENCE: "", HF_AVATAR_BASE_URL: "", HF_AVATAR_MODEL: "", ...extraEnv },
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

function stubUpstream() {
  const calls = [];
  const stub = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      calls.push(Buffer.concat(chunks));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data: [{ b64_json: PNG.split(",")[1] }] }));
    });
  });
  return { calls, stub };
}

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");
const serverJs = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const studio = home.slice(home.indexOf('id="hypeframe"'), home.indexOf('id="how"'));
const prod = studio.slice(studio.indexOf('id="hfProduct215"'), studio.indexOf('id="hfReview215"'));

// ---- A. pins ----
assert(home.includes('src="app.js?v=236"') && home.includes('href="styles.css?v=226"'), "A: asset pins — app.js v220 / styles v214 (Round 222; both files changed) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240)");

// ---- B. Layout statics ----
{
  const at = (id) => prod.indexOf(`id="${id}"`);
  assert(at("hfProductTitle215") > -1 && at("hfPriceTop222") > at("hfProductTitle215") && at("hfGarment206") > at("hfPriceTop222"), "B: the page reads title → price line → garment");
  assert(prod.includes("$110 · Made to order"), "B: '$110 · Made to order' rides under the product name (verbatim)");
  assert(at("hfRowPhoto215") > at("hfGarment206") && at("hfRowArtwork215") > at("hfPhotoPanel215") && at("hfBuyCard215") > at("hfArtworkPanel215") && at("hfStickyBar215") > at("hfBuyCard215"), "B: the sections run in order — moment → artwork → color & size → the sticky Review bar");
  assert(prod.includes(">Your moment</span>") && prod.includes(">Artwork</span>") && prod.includes(">Color &amp; size</span>"), "B: the three section heads name themselves (Your moment / Artwork / Color & size)");
  assert((prod.match(/class="hf-optpanel215 hf-sec-body222" id="hf\w+Panel215">/g) || []).length === 4 && !prod.includes('Panel215" hidden'), "B: all four sections stand open — nothing to expand");
  assert(prod.slice(prod.indexOf('id="hfGarment206"'), prod.indexOf('id="hfPhotoPanel215"')).includes('id="hfRowPhoto215"') && prod.includes('id="hfRowPhotoState215"'), "B: Change photo (the moment section, carrying its state line) sits directly under the mockup");
  assert(!css.includes("#hfProduct215 .hf-garment206{position:sticky") && !css.includes("#hfProduct215 .hf-garment206{position:fixed"), "B: the garment preview is pinned (sticky) at the top of the product page — →238: UNPINNED at Emil's word ('I don't like the hoodie scroll on the hype frame order page. It's hard to use the page.') — the garment rule carries no positioning; the preview is a plain in-flow card that scrolls away with the page");
  assert(css.includes("body.hf-studio-open205 #postPlayBtn{display:none}"), "B: the header's Post a Play pill stands down while the studio is open");
  const menu = home.slice(home.indexOf('id="navMenu"'), home.indexOf("</header>"));
  assert(menu.includes('id="menuPost222"') && menu.includes("+ Post a Play"), "B: the menu carries the Post a Play entry");
  assert(appJs.includes('$("#menuPost222")?.addEventListener("click", () => { closeMenu(false); goSubmit(); })'), "B: the menu entry runs the same goSubmit as the pill");
  // The moment section's internal order: strip → upload → fence → clip.
  const mom = prod.slice(prod.indexOf('id="hfPhotoPanel215"'), prod.indexOf('id="hfRowArtwork215"'));
  assert(mom.indexOf('id="hfStripWrap"') > -1 && mom.indexOf('id="hfClipRow211"') > mom.indexOf('id="hfStripWrap"') && mom.indexOf('id="hfUploadBtn222"') > mom.indexOf('id="hfClipRow211"') && mom.indexOf('id="hfFence222"') > mom.indexOf('id="hfUploadBtn222"'), "B: the moment section runs filmstrip → Pick from video → Upload a photo → fence step — →235: Emil moved Pick from video above Upload a photo (R222 shipped strip → upload → fence → clip); ids, handlers and behavior unchanged");
  assert(mom.includes('id="hfUploadInput222"') && mom.includes('accept="image/*"'), "B: Upload a photo fronts a hidden image file input");
  assert(mom.includes("Upload a photo</button>"), "B: the Upload a photo entry is labeled");
  assert(css.includes("#hfClipArea211 video#hfVideo{") && css.includes("max-height:300px"), "B: the Pick from video player is compact (the video caps at 300px tall)");
  // The upload flow's fence shooting tip.
  const upload = home.slice(home.indexOf('id="dropzone"'), home.indexOf('id="hypeframe"'));
  assert(upload.includes("Rest your phone's lens right against the chain-link — the fence nearly disappears from the shot."), "B: the upload flow carries the fence shooting tip (lens against the chain-link)");
  // Review copy, verbatim.
  const review = studio.slice(studio.indexOf('id="hfReview215"'));
  assert(review.includes(">Send order request</button>"), "B: the Review submit is 'Send order request'");
  assert(review.includes("No payment today. A parent or guardian confirms first."), "B: the verbatim line rides directly under it — 'No payment today. A parent or guardian confirms first.'");
  assert(!home.includes("Send hoodie request"), "B: the retired R205/R215 submit label is gone (the #hfNoPay205 email-field explainer is a separate element and stays)");
  const buySec = prod.slice(prod.indexOf('id="hfBuyCard215"'), prod.indexOf('id="hfStickyBar215"'));
  assert(buySec.includes('id="hfSizes"') && buySec.includes('id="hfSizeGuideBtn205"') && buySec.includes('id="hfSizeMsg222"') && buySec.indexOf('id="hfSizeMsg222"') > buySec.indexOf('id="hfSizes"'), "B: the size guide button stays beside the picker and the gate prompt sits under it");
}

// ---- C. Sizes ----
{
  const buttons = prod.match(/data-hf-size="(\w+)"/g) || [];
  assert(buttons.length === 9, "C: the studio picker renders exactly 9 size buttons");
  assert(!prod.includes('data-hf-size="YXXS"'), "C: YXXS is NOT a studio size button");
  assert(!/data-hf-size="\w+" aria-pressed="true"/.test(prod), "C: no size button ships pressed — nothing is preselected");
  assert(serverJs.includes('["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"].includes(String(body.size || "")') && !serverJs.includes('YXXS: "68266140827861"'), "C: the server's 10-size order validation + the Shopify variant map are untouched (both keep YXXS) — →226: SUPERSEDED — YXXS is cut catalog-wide: the order validation is the nine-size list and the variant map dropped the YXXS entry");
  assert(!studio.slice(studio.indexOf('id="hfSizeGuide205"'), studio.indexOf('id="hfSizeGuide205"') + 3000).includes("YXXS"), "C: the size GUIDE still documents YXXS (it describes the store's full range) — →226: SUPERSEDED — the guide no longer documents YXXS (catalog-wide cut)");
}

// ---- D. The size gate (VM) ----
{
  const fn = (name) => {
    const start = appJs.indexOf("function " + name);
    assert(start > -1, "D: extractor found " + name);
    let depth = 0;
    const open = appJs.indexOf("{", start);
    for (let i = open; i < appJs.length; i++) {
      if (appJs[i] === "{") depth++;
      else if (appJs[i] === "}") { depth--; if (!depth) return appJs.slice(start, i + 1); }
    }
    throw new Error("unbalanced " + name);
  };
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", disabled: false, style: {}, attrs: {}, listeners: {},
    addEventListener(ev, f) { this.listeners[ev] = f; },
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; },
    scrollIntoView() {},
  });
  const els = {};
  const generic = {};
  const sb = {
    console,
    $: (s) => els[s] || (generic[s] ??= mkEl()),
    $$: () => [],
    HF_PRESET_LABELS205: { hypeframe: "Hype Frame" }, // →229: the fixture mirrors the shipped map — only hypeframe survives
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    hfState: { play: { id: 9, title: "Double" }, frozen: true, printDataUrl: "data:print", size: "", colorway: "Black", side: "back", preset: "hypeframe", apparel: "hoodie", imageStyle: "photo", backText: "name", placement: { cx: 50, cy: 42, size: 78 }, avatarApplied206: false, screen215: "product", clipOpen211: false },
    hfGarmentSync206: () => {},
    hfGarmentPaint211: () => {},
    hfGarmentBackText206: () => "",
    hfSetClipOpen211: () => {},
    hfCustomTextError197: () => "",
  };
  sb.window = sb;
  els["#hfProduct215"] = mkEl(); els["#hfReview215"] = mkEl(); els["#hfReview215"].hidden = true;
  els["#hfGuardianEmail"] = Object.assign(mkEl(), { value: "" });
  els["#hfBackCustom197"] = Object.assign(mkEl(), { value: "" });
  els["#hfJersey"] = Object.assign(mkEl(), { value: "" });
  const ctx = vm.createContext(sb);
  const sizesConst = appJs.slice(appJs.indexOf("const HF_STUDIO_SIZES222"), appJs.indexOf("];", appJs.indexOf("const HF_STUDIO_SIZES222")) + 2);
  vm.runInContext([sizesConst, fn("hfClearSize222"), fn("hfPickSize"), fn("hfSummary205"), fn("hfSyncSummary205"), fn("hfValidateOrder206"), fn("hfReviewSync206"), fn("hfShowScreen215")].join("\n"), ctx);
  vm.runInContext("(" + fn("wireHf222") + ")();", ctx);
  const S = sb.hfState;

  const el = (s) => sb.$(s);
  assert(sb.hfSummary205().includes("Pick a size"), "D: with no size picked, the order summary reads 'Pick a size' (never a silent default)");
  sb.hfReviewSync206();
  assert(el("#hfReviewSize206").textContent.includes("Pick a size"), "D: the Review size line reads 'Pick a size' too");
  assert(sb.hfValidateOrder206() === "Pick a size first — tap a size in the Color & size section.", "D: the send-time validation returns the size message when no size is picked");
  // The Review gate: frozen frame, no size → hold + prompt.
  el("#hfReviewBtn215").listeners.click();
  assert(S.screen215 === "product" && els["#hfReview215"].hidden === true, "D: the Review gate HOLDS on the product page while no size is picked");
  assert(el("#hfSizeMsg222").hidden === false && el("#hfSizeMsg222").textContent.includes("Pick a size first"), "D: ...and shows the clear size prompt");
  // YXXS cannot be picked in the studio.
  sb.hfPickSize("YXXS");
  assert(S.size === "", "D: hfPickSize('YXXS') is a no-op in the studio (removed from the studio list only)");
  // Pick a real size → the gate opens.
  sb.hfPickSize("YM");
  assert(S.size === "YM" && el("#hfSizeMsg222").hidden === true, "D: picking a size clears the gate prompt");
  el("#hfReviewBtn215").listeners.click();
  assert(S.screen215 === "review" && els["#hfReview215"].hidden === false, "D: with a size picked, Review opens");
  assert(sb.hfValidateOrder206() === "A parent/guardian email is required so we can confirm before printing.", "D: past the size check, validation moves on to the next rule (the size gate is a gate, not a wall)");
  // Clearing returns to the unpicked state.
  sb.hfClearSize222();
  assert(S.size === "" && sb.hfSummary205().includes("Pick a size"), "D: hfClearSize222 returns the studio to no-size-chosen");
}

// ---- E. The fence endpoint ----
{
  // Statics first: route, kill switch, rate limit, prompt.
  assert(serverJs.includes('p === "/api/hype-frame/remove-fence" && req.method === "POST"') && serverJs.includes('p === "/api/hype-frame/fence-status" && req.method === "GET"'), "E: the fence routes ship (POST remove-fence + GET fence-status)");
  assert(serverJs.includes('process.env.HH_NO_FENCE !== "1"') && serverJs.includes("const FENCE_RATE_LIMIT = 6"), "E: the fence has its own kill switch (HH_NO_FENCE) and the avatar-consistent rate limit (6/IP/60min)");
  assert(serverJs.includes("Remove the chain-link fence from this photo") && serverJs.includes("do not stylize or illustrate — return the same photograph, cleaned of the fence"), "E: the server prompt is remove-fence-only — everything else preserved exactly");
  // Client approval-flow statics.
  const fenceMarkup = prod.slice(prod.indexOf('id="hfFence222"'), prod.indexOf('id="hfPhotoMsg215"')); // →235: the slice used to end at hfClipRow211 — the clip row moved ABOVE the fence step (Item C), so the fence block now runs to the photo message line
  assert(fenceMarkup.includes("Fence removal is done by OpenAI's image AI — your photo is sent to OpenAI to clean it. Nothing is sent until you tap the button below."), "E: the fence step carries its own disclosure line (mirrors the avatar consent)");
  assert(fenceMarkup.includes("The AI rebuilds what the fence hid, so look the cleaned photo over before you approve it."), "E: ...plus the honest note — the model rebuilds what the fence hid, so check before approving");
  assert(fenceMarkup.includes(">Use the cleaned photo</button>") && fenceMarkup.includes(">Keep the original</button>"), "E: the cleaned photo needs an explicit approval — 'Use the cleaned photo' or 'Keep the original'");
  const useFn = appJs.slice(appJs.indexOf("function hfUseFence222"), appJs.indexOf("function hfKeepFence222"));
  // →229: the swap itself moved into the shared hfApplyCleanedFrame229 (manual approval + auto-apply share it).
  const applyFn = appJs.slice(appJs.indexOf("function hfApplyCleanedFrame229"), appJs.indexOf("function hfUseFence222"));
  assert(useFn.includes("hfApplyCleanedFrame229") && applyFn.includes("frameCanvas206") && applyFn.includes("composeHfPrint()"), "E: approving swaps the cleaned photo into the print source (capture canvas + frame snapshot) and recomposes — →229: via the shared hfApplyCleanedFrame229");
  assert(appJs.includes("hfFencePost229(\"/api/hype-frame/remove-fence\"") && appJs.includes("fenceConfigured222 === true"), "E: the client posts to the fence endpoint and shows the step only when the status says configured — →229: via the shared hfFencePost229 helper");

  const post = (s, body) => s.j("/api/hype-frame/remove-fence", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  // Unconfigured: no key.
  const s0 = await boot(45234);
  try {
    const st = await s0.j("/api/hype-frame/fence-status");
    assert(st.status === 200 && st.body.configured === false, "E: with no OPENAI_API_KEY the fence status reads unconfigured");
    const r = await post(s0, { image: PNG });
    assert(r.status === 503 && r.body.ok === false, "E: ...and the endpoint answers 503 (the step simply never shows)");
  } finally { s0.stop(); }

  // Kill switch: key set, HH_NO_FENCE=1.
  const s1 = await boot(45235, { OPENAI_API_KEY: "test-key-222", HH_NO_FENCE: "1" });
  try {
    const st = await s1.j("/api/hype-frame/fence-status");
    assert(st.body.configured === false, "E: HH_NO_FENCE=1 stands the step down even with a key set");
    const r = await post(s1, { image: PNG });
    assert(r.status === 503, "E: ...and the endpoint 503s under the kill switch");
  } finally { s1.stop(); }

  // Configured round-trip + prompt + rate limit (one boot, counted calls).
  const up = stubUpstream();
  await new Promise((r) => up.stub.listen(0, "127.0.0.1", r));
  const stubBase = `http://127.0.0.1:${up.stub.address().port}`;
  const s2 = await boot(45232, { OPENAI_API_KEY: "test-key-222", HF_AVATAR_BASE_URL: stubBase, HF_AVATAR_MODEL: "test-model-222" });
  try {
    const st = await s2.j("/api/hype-frame/fence-status");
    assert(st.body.configured === true, "E: with a key set (and no kill switch) the fence status reads configured");
    const r = await post(s2, { image: PNG });
    assert(r.status === 200 && r.body.ok === true && r.body.image === PNG, "E: the fence removal round-trips through the stub upstream");
    const bodyBuf = up.calls[up.calls.length - 1];
    const body = bodyBuf.toString("latin1");
    assert(body.includes("Remove the chain-link fence from this photo") && body.includes("Change nothing else") && body.includes("return the same photograph, cleaned of the fence"), "E: the upstream request carries the remove-fence-only prompt");
    assert(!body.includes("brush-stroke") && !body.includes("HYPE FRAME"), "E: ...and NONE of the avatar's format language (no stylizing rides along)");
    assert((body.match(/name="image"; filename=/g) || []).length === 1, "E: the fence request sends exactly ONE image (no style reference)");
    assert(!(body.match(/name="image\[\]"/g) || []).length, "E: →224: the single-image fence request uses NO \"image[]\" field (single-image requests keep the plain \"image\" name)");
    assert(body.includes('name="model"') && body.includes("test-model-222"), "E: the fence call uses the same env model as the avatar (HF_AVATAR_MODEL)");
    for (let i = 0; i < 5; i++) {
      const rr = await post(s2, { image: PNG });
      assert(rr.status === 200, `E: call ${i + 2} of 6 within the hour still succeeds`);
    }
    const r7 = await post(s2, { image: PNG });
    assert(r7.status === 429 && r7.body.ok === false, "E: the 7th fence call in the hour is rate-limited (429), matching the avatar");
  } finally { s2.stop(); }

  // Bad bodies on a fresh configured boot.
  const s3 = await boot(45233, { OPENAI_API_KEY: "test-key-222", HF_AVATAR_BASE_URL: stubBase });
  try {
    const r1 = await post(s3, {});
    assert(r1.status === 400, "E: a body with no image is a 400");
    const r2 = await post(s3, { image: "data:text/plain;base64,aGVsbG8=" });
    assert(r2.status === 400, "E: a non-image data URL is a 400");
  } finally { s3.stop(); }
  up.stub.close();
}

// ---- F. The avatar style anchor ----
{
  const boysRef = fs.readFileSync(path.join(ROOT, "assets/hf-avatar-ref-boys.jpg"));
  const girlsRef = fs.readFileSync(path.join(ROOT, "assets/hf-avatar-ref-girls.jpg"));
  const jpegDims = (buf) => {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xc0 || m === 0xc2) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      if (m === 0xd8 || m === 0xd9 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return null;
  };
  for (const [name, buf] of [["boys", boysRef], ["girls", girlsRef]]) {
    assert(buf[0] === 0xff && buf[1] === 0xd8, `F: the ${name} reference asset is a JPEG`);
    const d = jpegDims(buf);
    assert(d && Math.max(d.w, d.h) <= 1024, `F: the ${name} reference asset's long side is ≤1024px (${d ? d.w + "×" + d.h : "unparsed"})`);
  }
  assert(serverJs.includes("hf-avatar-ref-boys.jpg") && serverJs.includes("hf-avatar-ref-girls.jpg"), "F: the server loads both reference assets at startup");
  assert(serverJs.includes('form.append("image[]", new Blob([ref222]'), "F: the avatar request appends the reference as a second image part — →224: under the field name \"image[]\" (OpenAI's edits endpoint rejects two parts both named \"image\" with a fast 400; the R222 live test 502'd on exactly that)");
  assert(serverJs.includes('ref222 ? "image[]" : "image"'), "F: →224: the image field name is chosen by whether a reference rides — multi-image uses \"image[]\", a single-image request keeps the plain \"image\" field exactly as before");

  const up = stubUpstream();
  await new Promise((r) => up.stub.listen(0, "127.0.0.1", r));
  const stubBase = `http://127.0.0.1:${up.stub.address().port}`;
  const s = await boot(45231, { OPENAI_API_KEY: "test-key-222", HF_AVATAR_BASE_URL: stubBase });
  try {
    const post = (tone) => s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG, nameMode: "name", name: "Nicholas", label: "Double", tone }) });
    const rb = await post("blue");
    assert(rb.status === 200 && rb.body.image === PNG, "F: the anchored generation round-trips (blue tone)");
    const bufB = up.calls[up.calls.length - 1];
    const strB = bufB.toString("latin1");
    assert((strB.match(/name="image\[\]"; filename=/g) || []).length === 2, "F: the avatar request carries exactly TWO image parts — →224: both under the field name \"image[]\" (photo first, reference second)");
    assert(!(strB.match(/name="image"; filename=/g) || []).length, "F: →224: NO part of the anchored request uses the plain \"image\" field name (the upstream 400 that failed the R222 live test)");
    assert(strB.indexOf('filename="frame.png"') > -1 && strB.indexOf('filename="frame.png"') < strB.indexOf('filename="style-reference.jpg"'), "F: the photo rides first, the style reference second");
    assert(bufB.includes(boysRef) && !bufB.includes(girlsRef), "F: the blue tone attaches the BOYS reference asset's exact bytes (and not the girls')");
    assert(strB.includes("Two images are attached: the photo to illustrate, and a finished Hype Frame design that is the house style reference."), "F: the prompt names the second image's role");
    assert(strB.includes("Take the illustration STYLE from the reference design") && strB.includes("Take the SCENE from the photo alone"), "F: the prompt carries the duty split (style from the reference, scene from the photo)");
    assert(strB.includes("Render the name and label text exactly as given in this prompt, letter for letter, in the reference design's brush script"), "F: the prompt carries the exact-lettering clause");
    assert(strB.includes("Keep the photo's exact camera angle, framing and composition"), "F: the R221 composition lock survives verbatim");
    assert(strB.includes('the words "HYPE FRAME" in huge white brush-stroke lettering') && strB.includes('the text "Nicholas" in huge bright blue brush-stroke lettering'), "F: the R218 format slots survive verbatim");
    const rp = await post("pink");
    assert(rp.status === 200, "F: the anchored generation round-trips (pink tone)");
    const bufP = up.calls[up.calls.length - 1];
    assert(bufP.includes(girlsRef) && !bufP.includes(boysRef), "F: the pink tone attaches the GIRLS reference asset's exact bytes (and not the boys')");
  } finally { s.stop(); }
  up.stub.close();

  // Client crop statics: athlete-dominant default + the 2× send.
  assert(appJs.includes("Math.round(srcW * 0.55)"), "F: the avatar crop's default width is 55% of the frame (athlete-dominant)");
  assert(appJs.includes("Math.min(2, 2048 / Math.max(crop221.w, crop221.h))"), "F: the crop is sent upscaled 2× (cap 2048 long side)");
}

// ---- G. The distinct-first strip picker (VM) ----
{
  const fn = (name) => {
    const start = appJs.indexOf("function " + name);
    assert(start > -1, "G: extractor found " + name);
    let depth = 0;
    const open = appJs.indexOf("{", start);
    for (let i = open; i < appJs.length; i++) {
      if (appJs[i] === "{") depth++;
      else if (appJs[i] === "}") { depth--; if (!depth) return appJs.slice(start, i + 1); }
    }
    throw new Error("unbalanced " + name);
  };
  const sb = { console };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  const consts = appJs.slice(appJs.indexOf("const HF_DISTINCT_MIN222"), appJs.indexOf("function hfDistinctPick222"));
  vm.runInContext([consts, fn("hfDistinctPick222")].join("\n"), ctx);
  // Frames carry a luma signature (the R205 downscale); a
  // constant signature of value v diffs as exactly |va − vb|.
  const mkFrame = (v) => ({ lum: v === null ? null : [v, v, v, v] });
  const brightness = [10, 10, 10, 50, 50, 90, 10, 130, 130, 170, 210, 250];
  const frames = brightness.map(mkFrame);
  const order = sb.hfDistinctPick222(frames, 3);
  assert(order.length === 12 && order[0] === 3, "G: the ★ frame leads and nothing is removed (all 12 stills ride)");
  assert(order.join(",") === "3,0,5,6,7,9,10,11,1,2,4,8", "G: near-identical runs dedupe against the last distinct still — the distinct set leads, the rest follow in original order (got " + order.join(",") + ")");
  const identical = Array.from({ length: 12 }, () => mkFrame(42));
  assert(sb.hfDistinctPick222(identical, 0).join(",") === "0,1,2,3,4,5,6,7,8,9,10,11", "G: a run of identical frames leads with the ★ alone (the order is untouched)");
  const chain = [mkFrame(42), mkFrame(null), mkFrame(42)];
  assert(sb.hfDistinctPick222(chain, null).join(",") === "0,1,2", "G: an unreadable still is never suppressed — and never suppresses its neighbor either");
  const spread = Array.from({ length: 12 }, (_, i) => mkFrame(i * 30));
  const capped = sb.hfDistinctPick222(spread, 11);
  assert(capped[0] === 11 && capped.length === 12, "G: a ★ past the distinct cap is still moved to the front");
  assert(appJs.includes("hfDistinctStrip222(strip)"), "G: the built strip is reordered through the distinct-first pass");
}

// ---- H. Served ----
{
  const s = await boot(45236);
  try {
    const served = await (await fetch(s.base + "/")).text();
    assert(served.includes('src="app.js?v=236"') && served.includes('href="styles.css?v=226"'), "H: the served homepage carries the Round 222 pins — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round) — →232: app.js now v228 (Round 232); styles now v220 (Round 232) — →233: app.js now v229 (Round 233); styles now v221 (Round 233) — →234: app.js now v230 (Round 234); styles keeps v221 (unchanged this round) — →235: app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240)");
    assert(served.includes('id="hfProduct215"') && served.includes('id="hfPriceTop222"') && served.includes('id="hfFence222"') && served.includes('id="menuPost222"') && served.includes("Send order request"), "H: the served studio is the rebuilt studio (price line, fence step, menu entry, renamed submit)");
    const servedApp = await (await fetch(s.base + "/app.js")).text();
    assert(servedApp.includes("function wireHf222") && servedApp.includes("function hfDistinctPick222") && servedApp.includes("HF_STUDIO_SIZES222") && servedApp.includes("function hfMakeFence222"), "H: the served app.js carries the rebuild (wiring, distinct picker, studio sizes, fence flow)");
    const servedCss = await (await fetch(s.base + "/styles.css")).text();
    assert(!servedCss.includes("#hfProduct215 .hf-garment206{position:sticky") && servedCss.includes("body.hf-studio-open205 #postPlayBtn{display:none}"), "H: the served styles carry the pinned garment + the pill stand-down — →238: the served garment rule is unpinned (no sticky positioning); the pill stand-down stands");
  } finally { s.stop(); }
}

console.log("\nALL R222 CHECKS PASSED");
