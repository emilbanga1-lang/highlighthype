// Round 199 test: the Hype Frame studio sells exactly two
// garment colors (Black + Heather Gray) and ten sizes (youth
// YXXS–YXL + adult S–XL). Emil, 2026-11-26: "On the studio
// remove color options and only have black or grey" — and the
// studio size set must match the Shopify product's variants
// (staged the same morning) 1:1 for the payment handoff.
// Run: node test-r199.js
// What this suite pins down:
//   A. Source + served markup: asset pins are app.js v200 /
//      styles v199; HF_COLORWAYS.hoodie is EXACTLY [Black
//      #17171a, Heather Gray #a8abb0] in that order (Black
//      first — the studio-open default reads entry [0]); the
//      removed colors are gone from the block; HF_SIZES is the
//      ten-size list; the studio markup offers all ten sizes
//      under Youth / Adult group labels with YM still the
//      pressed default; the hf strip note now reads youth +
//      adult sizes.
//   B. A vm drive of the real picker code (hfBuildColorButtons
//      / hfPickColor / hfPickSize / hfPrintTone sliced from the
//      served app.js, DOM stubbed): the builder renders TWO
//      swatches with Black pressed by default; picking Heather
//      Gray flips the state, the pressed flags and the print
//      tone (ink on the light garment, bone on Black); picking
//      a removed color ("Pink") is a no-op; adult sizes pick,
//      bogus sizes don't.
//   C. Server (real endpoint): a disallowed colorway — "Pink",
//      "Cream", lowercase "black", or none at all — rejects the
//      order 400 with a message naming the two colors, and no
//      order is stored; "Black" and "Heather Gray" create and
//      store verbatim (surrounding spaces trimmed). Sizes: the
//      adult set joins the whitelist ("L" stores, "s" stores
//      as "S"), an absent size still defaults to "YM", and a
//      bogus size ("XXL") keeps the long-standing sanitize-to-YM
//      behavior — size was ALREADY validated (as a whitelist)
//      before this round, so per the round's rule only its
//      allowed set grows; colorway is the field that rejects.
//   D. Legacy: an order row written directly with a pre-R199
//      colorway ("Pink") reads back through the owner list
//      untouched — no migration, no rewrite.
// Exits non-zero on failure.
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
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r199-"));
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

const GUARDIAN = "colorway-parent@example.com";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const orderPayload = (highlightId, extra = {}) => ({ highlightId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", guardianName: "Pat Parent", guardianEmail: GUARDIAN, image: PNG, ...extra });
const post = (s, p, body, tok) => s.j(p, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { "x-owner-token": tok } : {}) }, body: JSON.stringify(body) });
const SIZES10 = ["YXXS", "YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"];

try {
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const homeFile = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

  // ---------- A. Source: the lists themselves ----------
  const cwStart = appJs.indexOf("const HF_COLORWAYS");
  const cwBlock = appJs.slice(cwStart, appJs.indexOf("\n};", cwStart) + 2);
  const cw = vm.runInNewContext("(" + cwBlock.slice(cwBlock.indexOf("{")) + ")");
  assert(Array.isArray(cw.hoodie) && cw.hoodie.length === 2, "A: HF_COLORWAYS.hoodie has exactly two entries");
  assert(cw.hoodie[0].name === "Black" && cw.hoodie[0].hex === "#17171a", "A: entry 1 is Black #17171a (the default — the studio opens on entry [0])");
  assert(cw.hoodie[1].name === "Heather Gray" && cw.hoodie[1].hex === "#a8abb0", "A: entry 2 is Heather Gray #a8abb0");
  for (const gone of ["Cream", "Pink", "Navy", "Forest Green", "Light Blue", "Olive"])
    assert(!cwBlock.includes(gone), `A: removed colorway is gone from HF_COLORWAYS: ${gone}`);
  const sizesLine = appJs.slice(appJs.indexOf("const HF_SIZES"), appJs.indexOf("\n", appJs.indexOf("const HF_SIZES")));
  const hfSizes = vm.runInNewContext(sizesLine.replace("const HF_SIZES =", "(").replace(/;\s*$/, "") + ")");
  assert(JSON.stringify(hfSizes) === JSON.stringify(SIZES10), "A: HF_SIZES is the ten-size list (6 youth + S/M/L/XL) in order");
  assert(appJs.includes("Front or back print · Youth sizes YXXS–YXL · Adult sizes S–XL"), "A: the hf strip note now reads youth + adult sizes");

  // ---------- B. VM drive: the picker renders + picks ----------
  const line = (marker) => { const i = appJs.indexOf(marker); return appJs.slice(i, appJs.indexOf("\n", i)); };
  const fn = (marker) => { const i = appJs.indexOf(marker); return appJs.slice(i, appJs.indexOf("\n}", i) + 2); };
  const mkBtn = () => ({ type: "", className: "", dataset: {}, attrs: {}, innerHTML: "", _click: null,
    setAttribute(k, v) { this.attrs[k] = v; }, addEventListener(ev, f) { if (ev === "click") this._click = f; } });
  const wrap = { children: [], appendChild(b) { this.children.push(b); } };
  Object.defineProperty(wrap, "childElementCount", { get() { return this.children.length; } });
  const sb = { console };
  sb.window = sb;
  sb.document = { createElement: () => mkBtn() };
  sb.$ = (sel) => (sel === "#hfColors" ? wrap : null);
  sb.$$ = (sel) => (sel.includes("data-hf-color") ? wrap.children : []);
  const ctx = vm.createContext(sb);
  vm.runInContext([
    appJs.slice(appJs.indexOf("const HF_COLORWAYS"), appJs.indexOf("\n};", appJs.indexOf("const HF_COLORWAYS")) + 3),
    line("const HF_PLACEMENT_DEFAULT"),
    line("const hfState = {"),
    line("const HF_SIZES"),
    fn("function hfPrintTone()"),
    // →205: hfPickColor / hfPickSize now also re-sync the order
    // summary — the real summary block rides into the slice so
    // the picks run exactly as served ($ answers null for
    // #hfSummary205 here, so the sync is a no-op in this drive).
    line("const HF_PRESET_LABELS205"),
    fn("function hfSummary205()"),
    fn("function hfSyncSummary205()"),
    fn("function hfPickColor(name)"),
    fn("function hfPickSize(size)"),
    fn("function hfBuildColorButtons()"),
  ].join("\n"), ctx);
  const run = (code) => vm.runInContext(code, ctx);
  run("hfBuildColorButtons()");
  assert(wrap.children.length === 2, "B: the picker renders exactly two swatches");
  assert(wrap.children[0].dataset.hfColor === "Black" && wrap.children[1].dataset.hfColor === "Heather Gray", "B: swatches are Black then Heather Gray");
  assert(wrap.children[0].attrs["aria-pressed"] === "true" && wrap.children[1].attrs["aria-pressed"] === "false", "B: Black is the pressed default");
  assert(wrap.children[0].innerHTML.includes("--sw:#17171a") && wrap.children[1].innerHTML.includes("--sw:#a8abb0"), "B: swatch dots carry the two hexes");
  assert(run("hfState.colorway") === "Black" && run("HF_COLORWAYS.hoodie[0].name") === "Black", "B: studio state opens on Black, matching the open-time default expression");
  assert(run("hfPrintTone()") === "#f6f1e4", "B: print tone on Black is the bone tone (dark garment)");
  wrap.children[1]._click();
  assert(run("hfState.colorway") === "Heather Gray", "B: tapping the Heather Gray swatch selects it");
  assert(wrap.children[0].attrs["aria-pressed"] === "false" && wrap.children[1].attrs["aria-pressed"] === "true", "B: pressed flags follow the pick");
  assert(run("hfPrintTone()") === "#181209", "B: print tone on Heather Gray is the ink tone (light garment)");
  run('hfPickColor("Pink")');
  assert(run("hfState.colorway") === "Heather Gray", "B: picking a removed color (Pink) is a no-op");
  run('hfPickColor("Black")');
  assert(run("hfState.colorway") === "Black", "B: picking Black again restores it");
  run('hfPickSize("L")');
  assert(run("hfState.size") === "L", "B: an adult size (L) picks in the studio");
  run('hfPickSize("XXL")');
  assert(run("hfState.size") === "L", "B: a bogus size (XXL) is a no-op in the picker");
  run('hfPickSize("YXL")');
  assert(run("hfState.size") === "YXL", "B: a youth size still picks");

  // ---------- C. Server: colorway rejects, sizes extend ----------
  const s = await boot(3531);
  try {
    const home = await s.text("/");
    assert(home.includes('src="app.js?v=209"') && home.includes('href="styles.css?v=205"'), "C: asset pins — app.js now v200 (Round 199); styles keeps v199 (unchanged this round) — →201: app.js now v201 (Round 200); styles keeps v199 (unchanged this round) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round)");
    for (const sz of SIZES10)
      assert(home.includes(`data-hf-size="${sz}"`), `C: studio size picker offers ${sz}`);
    assert(home.includes('id="hfSizes"') && home.includes('aria-label="Size"') && home.includes(">Youth</span>") && home.includes(">Adult</span>"), "C: the size picker is one group with Youth / Adult labels");
    assert(home.includes('data-hf-size="YM" aria-pressed="true"'), "C: YM is still the pressed default size");

    const claim = await s.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token; assert(tok, "C: owner claim returns a token");
    const mk = async (title) => (await post(s, "/api/highlights", { title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" })).body.id;
    const playId = await mk("Colorway Play");
    const appr = await post(s, `/api/highlights/${playId}/status`, { status: "approved" }, tok);
    assert(appr.body.status === "approved", "C: play approved for the order tests");
    const ownerRow = async (id) => {
      const r = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
      return (r.body.requests || []).find((o) => o.id === id) || null;
    };
    const ownerCount = async () => (await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } })).body.requests.length;

    // Disallowed colorways reject, with the two colors named.
    let r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "Pink" }));
    assert(r.status === 400 && /Black or Heather Gray/.test(r.body.message || ""), "C: colorway 'Pink' is rejected 400, naming the two colors");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "Cream" }));
    assert(r.status === 400, "C: colorway 'Cream' is rejected 400");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "black" }));
    assert(r.status === 400, "C: lowercase 'black' is rejected 400 (exact names only)");
    const noColor = orderPayload(playId); delete noColor.colorway;
    r = await post(s, "/api/hype-frame/orders", noColor);
    assert(r.status === 400, "C: a missing colorway is rejected 400");
    assert((await ownerCount()) === 0, "C: no rejected order was stored");

    // The two allowed colorways create and store verbatim.
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "Black" }));
    assert(r.status === 201 && r.body.ok, "C: a Black order is created (201)");
    let o = await ownerRow(r.body.id);
    assert(o && o.colorway === "Black", "C: the Black order stores colorway 'Black'");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "Heather Gray" }));
    assert(r.status === 201, "C: a Heather Gray order is created (201)");
    o = await ownerRow(r.body.id);
    assert(o && o.colorway === "Heather Gray", "C: the Heather Gray order stores colorway 'Heather Gray'");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "  Heather Gray  " }));
    assert(r.status === 201, "C: a padded colorway is accepted (trimmed, house style)");
    o = await ownerRow(r.body.id);
    assert(o && o.colorway === "Heather Gray", "C: the padded colorway stores trimmed");

    // Sizes: adult set accepted, defaults + sanitize unchanged.
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { size: "L" }));
    assert(r.status === 201, "C: an order with adult size L is created (201)");
    o = await ownerRow(r.body.id);
    assert(o && o.size === "L", "C: adult size L round-trips to the owner API");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { size: "s" }));
    o = await ownerRow(r.body.id);
    assert(r.status === 201 && o && o.size === "S", "C: lowercase 's' stores as 'S' (existing uppercase normalization)");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { colorway: "Heather Gray", size: "XL" }));
    o = await ownerRow(r.body.id);
    assert(r.status === 201 && o && o.colorway === "Heather Gray" && o.size === "XL", "C: Heather Gray + XL together store correctly");
    r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { size: "XXL" }));
    o = await ownerRow(r.body.id);
    assert(r.status === 201 && o && o.size === "YM", "C: a bogus size (XXL) keeps the pre-R199 sanitize-to-YM behavior");
    const noSize = orderPayload(playId); delete noSize.size;
    r = await post(s, "/api/hype-frame/orders", noSize);
    o = await ownerRow(r.body.id);
    assert(r.status === 201 && o && o.size === "YM", "C: an order without a size still defaults to YM");
    var dataDir = s.tmp;
    var ownerTok = tok; // /api/owner/claim is one-time — Boot D reuses this token
  } finally { await s.stop(); }

  // ---------- D. Legacy: a pre-R199 colorway reads back untouched ----------
  const dbD = new DatabaseSync(path.join(dataDir, "highlighthype.db"));
  dbD.prepare("INSERT INTO hype_frame_orders (highlight_id, print_image, custom_name, jersey, guardian_email, status, colorway) VALUES (1, '', 'Legacy Kid', '7', 'legacy@example.com', 'pending-guardian', 'Pink')").run();
  dbD.close();
  const s2 = await boot(3532, dataDir);
  try {
    const list = await s2.j("/api/owner/hype-frames", { headers: { "x-owner-token": ownerTok } });
    const legacy = (list.body.requests || []).find((o) => o.guardian_email === "legacy@example.com");
    assert(legacy, "D: the legacy order is listed after the round");
    assert(legacy.colorway === "Pink", "D: the legacy order keeps its stored colorway ('Pink') — no migration, no rewrite");
  } finally { await s2.stop(); }

  console.log("\nR199 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
