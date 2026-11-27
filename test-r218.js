// Round 218 test: the Hype Frame FORMAT round (Emil, 2026-11-26).
// Run: node test-r218.js
// What this suite pins down:
//   A. Pins: app.js v216 / styles v210 (styles unchanged).
//   B. Homepage card: the #merchTeaser125 hero is Emil's Nicholas
//      front+back shot (hf-hoodie-nicholas218.jpg, on disk); the
//      softball photo survives only as the film's cover (one
//      reference left in the section) and its file stays on disk.
//   C. Studio garment — Black is the washed-black hoodie from
//      Emil's shot: clean 218 blanks (front has NO crest/number —
//      the studio composites the crest itself), re-measured print
//      zones + crest anchor wired for Black; Heather Gray keeps
//      the R211 blanks. The Artwork row carries the design label
//      field (≤24) and the R197 control is "Name on design" now.
//   D. Avatar path (server): POST /api/hype-frame/avatar takes
//      {image, nameMode, name, number, customText, label, tone};
//      the server sanitizes every slot (charset + caps, number
//      digits-only, label uppercased ≤24, tone pink-or-blue,
//      unknown mode → name) and builds the format prompt from
//      fixed slots — all four name modes verified against a stub
//      upstream; a client-sent "prompt" never reaches upstream.
//   E. Studio (VM): an approved avatar design becomes the print
//      WHOLESALE (composeHfPrint passes the design through —
//      printDataUrl IS the design, aspect from the design); the
//      photo path composes the format on a TRANSPARENT canvas
//      (no full-canvas fill anywhere; name / label / crown /
//      framed photo / branding all drawn; "none" draws no name).
//   F. Screen blend (VM): wherever the design composites onto a
//      garment (studio hero + Review) the print img carries
//      mixBlendMode "screen" so its black ground knocks out —
//      identical on Black, NO black panel on Heather Gray; a
//      photo print clears the blend and the shade layer returns.
//   G. Orders: the payload carries nameMode + designLabel; the
//      server stores name_mode / design_label (guarded columns)
//      and the owner email gains the Round 218 design line; an
//      order without the fields stores the fallback mode + no
//      label.
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
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-r218-"));
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
const merch = home.slice(home.indexOf('id="merchTeaser125"'), home.indexOf("<!-- ============ THE STORE"));

// ---- A. pins ----
assert(home.includes('src="app.js?v=217"') && home.includes('href="styles.css?v=211"'), "A: asset pins — app.js v216 / styles v210 (Round 218; styles unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219)");

// ---- B. Homepage card ----
{
  const hero = merch.slice(merch.indexOf("hft207-hero"), merch.indexOf("hft201-body"));
  assert(hero.includes('src="/swag/hf-hoodie-nicholas218.jpg"'), "B: the card hero is Emil's Nicholas front+back shot (hf-hoodie-nicholas218.jpg)");
  const f = fs.readFileSync(path.join(ROOT, "public/swag/hf-hoodie-nicholas218.jpg"));
  assert(f[0] === 0xff && f[1] === 0xd8, "B: the Nicholas hero is a real JPEG on disk");
  assert((merch.match(/hf-hoodie-softball\.jpg/g) || []).length === 1, "B: the softball photo is referenced exactly once in the section now — the film's cover only");
  assert(fs.existsSync(path.join(ROOT, "public/swag/hf-hoodie-softball.jpg")), "B: the softball file stays on disk (unreferenced by the hero, still the film cover)");
}

// ---- C. Black blanks, zones, label field ----
{
  for (const f of ["hf-blank-front-black218.jpg", "hf-blank-back-black218.jpg"]) {
    assert(appJs.includes("/swag/" + f), "C: app.js points Black at " + f);
    const jpg = fs.readFileSync(path.join(ROOT, "public/swag", f));
    assert(jpg[0] === 0xff && jpg[1] === 0xd8, "C: " + f + " is a real JPEG blank on disk");
  }
  assert(appJs.includes('Black: { front: "/swag/hf-blank-front-black218.jpg", back: "/swag/hf-blank-back-black218.jpg", aspect: 1046 / 1225 }'), "C: the Black garment art is the 218 pair at its measured aspect (1046/1225)");
  assert(appJs.includes('"Heather Gray": { front: "/swag/hf-blank-front-gray211.jpg", back: "/swag/hf-blank-back-gray211.jpg", aspect: 1280 / 1920 }'), "C: Heather Gray keeps the R211 blanks + zones untouched");
  assert(appJs.includes("back: { left: 0.26, top: 0.28, width: 0.49, height: 0.585 }"), "C: the 218 BACK print zone (measured on the washed-black blank: panel seams / hood tip / hem)");
  assert(appJs.includes("front: { left: 0.30, top: 0.315, width: 0.43, height: 0.29 }"), "C: the 218 FRONT print zone (measured: panel / pocket top)");
  assert(appJs.includes("Black: { cx: 0.64, cy: 0.33, w: 0.17 }"), "C: the 218 crest anchor for Black (the blank ships NO crest — the studio composites it)");
  assert(studio.includes('id="hfLabel218"') && studio.includes('maxlength="24"'), "C: the Artwork row carries the design label field (≤24 chars)");
  assert(studio.includes("Name on design") && studio.includes("<dt>Name on design</dt>"), "C: the R197 control + the Review row are 'Name on design' now (same four modes, same fields)");
  assert(appJs.includes("function hfLabelDefault218") && appJs.includes("function hfDesignLabel218") && appJs.includes("function hfDesignTopLine218"), "C: the label default (play title) + design slot helpers ship");
}

// ---- D. Avatar path: slots in, prompt built server-side ----
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
{
  const s = await boot(45218, { OPENAI_API_KEY: "test-key-218", HF_AVATAR_BASE_URL: stubBase });
  try {
    const post = (extra) => s.j("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: PNG, prompt: "CLIENT INJECTION 218", ...extra }) });
    const lastBody = () => stubCalls[stubCalls.length - 1].body;

    let r = await post({ nameMode: "name", name: "Nicholas", label: "Home Run", tone: "blue" });
    assert(r.status === 200 && r.body.image === PNG, "D: name mode — the generation round-trips");
    assert(lastBody().includes('the text "Nicholas" in huge bright blue brush-stroke lettering'), "D: name mode — the top line is the first name in BLUE (boys)");
    assert(lastBody().includes('the label "HOME RUN" in small white letter-spaced capital letters'), "D: the label slot rides uppercased, with its gold-stroke line");
    assert(lastBody().includes("solid black background") && lastBody().includes("gold brush-stroke crown") && lastBody().includes("distressed white grunge frame") && lastBody().includes("stylized illustrated avatar"), "D: the format anatomy is in the server-built prompt (black ground, crown, grunge frame, faithful illustration)");
    assert(!lastBody().includes("CLIENT INJECTION 218"), "D: a client-sent prompt field NEVER reaches upstream");

    r = await post({ nameMode: "name_number", name: "Charlotte", number: "7", label: "Karate", tone: "pink" });
    assert(r.status === 200 && lastBody().includes('the text "Charlotte 7" in huge hot pink brush-stroke lettering'), "D: name_number + pink — the number rides the top line, PINK for girls");
    assert(lastBody().includes('the label "KARATE"'), "D: the label slot uppercases a mixed-case label");

    r = await post({ nameMode: "none", name: "Nicholas", label: "Home Run", tone: "blue" });
    assert(r.status === 200 && lastBody().includes("There is NO name or word line across the top"), "D: none mode — the prompt explicitly forbids a top line");
    assert(!lastBody().includes('the text "'), "D: none mode — no quoted top-line text is built at all (label / crown / frame / branding stay)");

    r = await post({ nameMode: "custom", customText: "Go Hawks!", label: "Playoffs", tone: "blue" });
    assert(r.status === 200 && lastBody().includes('the text "Go Hawks!" in huge bright blue brush-stroke lettering'), "D: custom mode — the family's words are the top line");

    r = await post({ nameMode: "name_number", name: 'Ni"; DROP--', number: "12a3", label: "ABCDEFGHIJKLMNOPQRSTUVWXYZ1234", tone: "blue" });
    assert(r.status === 200 && !lastBody().includes('Ni";') && !lastBody().includes('"; DROP'), "D: slot sanitization strips quote/semicolon injection out of the name");
    assert(lastBody().includes('"123"') || lastBody().includes(" 123"), "D: the number slot is digits-only ('12a3' → '123')");
    assert(lastBody().includes('the label "ABCDEFGHIJKLMNOPQRSTUVWX"') && !lastBody().includes("ABCDEFGHIJKLMNOPQRSTUVWXY"), "D: the label slot caps at 24 chars");

    r = await post({ nameMode: "bogus", tone: "green", name: "Nicholas" });
    assert(r.status === 200 && lastBody().includes('the text "Nicholas" in huge bright blue brush-stroke lettering'), "D: an unknown mode falls back to 'name' and an unknown tone to blue");
  } finally { s.stop(); }
}
stub.close();

// ---- E + F. Studio VM: design-as-print, transparent photo format, screen blend ----
{
  const block = appJs.slice(appJs.indexOf("function hfPrintTone"), appJs.indexOf("\n}", appJs.indexOf("function composeHfPrint")) + 2)
    + "\n" + appJs.slice(appJs.indexOf("const HF_GARMENT_ART206"), appJs.indexOf("function hfFineStep206"));
  const applyBlock = appJs.slice(appJs.indexOf("function hfApplyAvatar206"), appJs.indexOf("\n}", appJs.indexOf("function hfApplyAvatar206")) + 2);

  const calls = [];
  const recCtx = (cv) => {
    const base = { canvas: cv, measureText: (t) => ({ width: String(t).length * 10 }) };
    return new Proxy(base, {
      get(t, k) { if (typeof k === "symbol") return undefined; if (k in t) return t[k]; return (...a) => { calls.push({ m: String(k), a }); }; },
      set(t, k, v) { t[k] = v; if (k === "fillStyle" || k === "strokeStyle") calls.push({ m: "set:" + String(k), a: [v] }); return true; },
    });
  };
  const created = [];
  const mkCanvas = () => { const cv = { width: 0, height: 0, _ctx: null, getContext() { if (!this._ctx) this._ctx = recCtx(this); return this._ctx; }, toDataURL: () => "data:image/png;base64,REC218" }; created.push(cv); return cv; };
  class FakeImage {
    constructor() { this.naturalWidth = 1000; this.naturalHeight = 1250; }
    set src(v) { this._src = v; if (this.onload) queueMicrotask(() => this.onload()); }
    get src() { return this._src; }
  }
  const mkEl = () => ({
    hidden: false, textContent: "", value: "", style: {}, attrs: {}, listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    classList: { set: new Set(), toggle(c, on) { if (on) this.set.add(c); else this.set.delete(c); } },
    setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return k === "src" ? (this._src ?? null) : (this.attrs[k] ?? null); },
    removeAttribute(k) { if (k === "src") this._src = undefined; delete this.attrs[k]; },
    set src(v) { this._src = v; }, get src() { return this._src; },
  });
  const photoStub = { width: 800, height: 450 };
  const els = {
    "#hfCanvas": photoStub,
    "#hfName": { value: "Nicholas" }, "#hfJersey": { value: "25" }, "#hfBackCustom197": { value: "" },
    "#hfLabel218": { value: "HOME RUN" },
    "#hfGarment206": mkEl(), "#hfGarmentImg206": mkEl(), "#hfGarmentPrintArea206": mkEl(),
    "#hfGarmentPrint206": mkEl(), "#hfGarmentBackText206": mkEl(), "#hfGarmentShade211": mkEl(),
    "#hfReviewImg206": mkEl(), "#hfReviewPrintArea206": mkEl(), "#hfReviewPrint206": mkEl(),
    "#hfReviewSize206": mkEl(), "#hfReviewPlacement206": mkEl(), "#hfReviewArt206": mkEl(), "#hfReviewBack206": mkEl(),
  };
  const generic = {};
  const sb = {
    console,
    $: (s) => els[s] || (generic[s] ??= mkEl()),
    $$: () => [],
    document: { createElement: (t) => (t === "canvas" ? mkCanvas() : mkEl()), addEventListener: () => {}, body: mkEl() },
    Image: FakeImage,
    hfState: { play: { id: 7, title: "Home Run", division: "boys" }, frozen: true, printDataUrl: "", printAspect: 0, colorway: "Black", side: "back", garmentView206: "back", preset: "hypeframe", backText: "name", imageStyle: "photo", placement: { cx: 50, cy: 42, size: 78 }, avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, designAspect218: 0, size: "YM", apparel: "hoodie", mediaType: "video" },
    HF_PLACEMENT_DEFAULT: { cx: 50, cy: 42, size: 78 },
    HF_PRESET_LABELS205: { classic: "Classic", signature: "Signature", hypeframe: "Hype Frame" },
    hfPickImageStyle: (s) => { sb.hfState.imageStyle = s; },
    hfSyncAvatar206: () => {},
    esc: (t) => String(t),
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(block, ctx);
  vm.runInContext(appJs.slice(appJs.indexOf("function hfReviewSync206"), appJs.indexOf("async function hfSubmitOrder206")), ctx);
  vm.runInContext(applyBlock, ctx);
  const S = sb.hfState;
  const texts = () => calls.filter((c) => c.m === "fillText").map((c) => String(c.a[0]));

  // E1. Photo path: the format on a transparent canvas.
  calls.length = 0; created.length = 0;
  sb.composeHfPrint();
  await wait(30); // the crown asset lands → one recompose
  const comp = created[created.length - 1];
  assert(S.printDataUrl === "data:image/png;base64,REC218", "E: the photo path composes a PNG print");
  assert(comp && comp.width === 800 && comp.height > 700, "E: the composed canvas adds the format's header + footer around the photo (800 × >700 for an 800×450 frame)");
  assert(!calls.some((c) => c.m === "fillRect" && c.a[2] >= comp.width && c.a[3] >= comp.height * 0.98), "E: NO black fill anywhere — no full-canvas fillRect; the canvas corners stay transparent (Emil: 'get rid of the black background')");
  assert(texts().some((t) => t.toUpperCase() === "NICHOLAS"), "E: the name line is drawn (first name, tone color)");
  assert(texts().includes("HOME RUN"), "E: the design label is drawn");
  assert(texts().includes("HYPE FRAME") && texts().includes("HIGHLIGHT") && texts().includes("HYPE"), "E: the bottom branding is drawn (HYPE FRAME + HIGHLIGHTHYPE)");
  assert(calls.some((c) => c.m === "drawImage" && c.a[0] === photoStub), "E: the real photo is drawn untouched inside the frame");
  assert(calls.some((c) => c.m === "drawImage" && c.a[0] && c.a[0]._src === "/crown.png"), "E: the gold crown is drawn from the site's crown.png asset");
  assert(sb.hfLabelDefault218({ title: "Home Run" }) === "HOME RUN", "E: the label defaults to the play's title, uppercased");

  // E2. "none" mode draws no name line.
  S.backText = "none";
  calls.length = 0;
  sb.composeHfPrint();
  await wait(10);
  assert(!texts().some((t) => t.toUpperCase().includes("NICHOLAS")), "E: 'No name' mode — the composed print carries NO name line (label / crown / branding stay)");
  assert(texts().includes("HOME RUN") && texts().includes("HYPE FRAME"), "E: 'No name' mode — the label + branding still draw");
  S.backText = "name";

  // E3. The approved design becomes the print WHOLESALE.
  S.avatarDataUrl206 = "data:design218";
  sb.hfApplyAvatar206();
  await wait(30);
  assert(S.avatarApplied206 === true && S.designAspect218 === 1.25, "E: applying the design records it + its aspect (1250/1000)");
  assert(S.printDataUrl === "data:design218" && S.printAspect === 1.25, "E: the print IS the design itself — no wrapper composed around it, the order payload carries the design");

  // F. Screen blend on garments.
  const GP = els["#hfGarmentPrint206"], SH = els["#hfGarmentShade211"], GI = els["#hfGarmentImg206"];
  sb.hfGarmentSync206();
  assert(GP.src === "data:design218" && GP.style.mixBlendMode === "screen", "F: the design composites onto the garment with screen blend — its black ground knocks out");
  assert(SH.hidden === true, "F: the soft-light shade layer stands down while the design blends");
  S.colorway = "Heather Gray"; S.garmentView206 = "back";
  sb.hfGarmentSync206();
  assert(GI.src === "/swag/hf-blank-back-gray211.jpg" && GP.style.mixBlendMode === "screen", "F: on Heather Gray the design STILL screen-blends — the elements sit on gray, NO black panel (replaces the old honest-panel behavior)");
  S.avatarApplied206 = false; S.avatarDataUrl206 = ""; S.printDataUrl = "data:print"; S.colorway = "Black";
  sb.hfGarmentSync206();
  assert(GP.src === "data:print" && GP.style.mixBlendMode !== "screen" && SH.hidden === false, "F: a photo print clears the blend and the shade layer returns");
  // Review paints through the same painter: the design blends there too.
  S.avatarApplied206 = true; S.avatarDataUrl206 = "data:design218"; S.printDataUrl = "data:design218";
  sb.hfReviewSync206();
  assert(els["#hfReviewPrint206"].style.mixBlendMode === "screen", "F: the Review screen composites the design on the garment with screen blend — never a standalone black rectangle");
}

// ---- G. Orders: payload + storage + owner email ----
{
  const submitBlock = appJs.slice(appJs.indexOf("async function hfSubmitOrder206"), appJs.indexOf("(function wireHf206()"));
  assert(submitBlock.includes("nameMode: hfState.backText") && submitBlock.includes("designLabel: hfDesignLabel218()"), "G: the order payload carries nameMode + designLabel with the back-text info");
  assert(serverJs.includes("ADD COLUMN name_mode") && serverJs.includes("ADD COLUMN design_label"), "G: the server stores both in guarded columns");
  assert(serverJs.includes("production knocks the black out for the DTF print"), "G: the owner email notes production knocks the design's black out for DTF (the payload keeps the design as generated)");

  const capture = path.join(os.tmpdir(), `hh-r218-mail-${Date.now()}.jsonl`);
  const s = await boot(45219, { SMTP_USER: "hello@highlighthype.com", SMTP_PASS: "test-pass", HH_MAIL_CAPTURE: capture });
  try {
    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token;
    const mk = await s.j("/api/highlights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Design Order Play", sport: "baseball", playerName: "Nick", jersey: "25", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" }) });
    const playId = mk.body.id;
    await s.j(`/api/highlights/${playId}/status`, { method: "POST", headers: { "content-type": "application/json", "x-owner-token": tok }, body: JSON.stringify({ status: "approved" }) });
    const payload = (extra = {}) => ({ highlightId: playId, customName: "Nick", jersey: "25", branding: true, apparel: "hoodie", colorway: "Black", size: "YM", guardianName: "Pat Parent", guardianEmail: "designparent@example.com", image: PNG, ...extra });
    let r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload({ nameMode: "name_number", designLabel: "Home Run Moment" })) });
    assert(r.status === 201, "G: a design order is created");
    const designId = r.body.id;
    r = await s.j("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) });
    const plainId = r.body.id;
    r = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
    const byId = (id) => r.body.requests.find((q) => q.id === id);
    assert(byId(designId).name_mode === "name_number" && byId(designId).design_label === "HOME RUN MOMENT", "G: name_mode + design_label round-trip to the owner API (label sanitized + uppercased server-side)");
    assert(byId(plainId).name_mode === "name" && !byId(plainId).design_label, "G: an order without the design fields stores the fallback mode (name_mode mirrors the back-text choice, default 'name') and no label");
    let mail = "";
    for (let i = 0; i < 20 && !mail.includes("Round 218 format"); i++) { await wait(150); try { mail = fs.readFileSync(capture, "utf8"); } catch { /* not yet */ } }
    assert(mail.includes("Design (Round 218 format): name mode name_number") && mail.includes("HOME RUN MOMENT"), "G: the owner email carries the design line (mode + label)");
  } finally { s.stop(); }
}

console.log("\nALL R218 CHECKS PASSED");
