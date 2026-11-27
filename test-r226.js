// Round 226 test: Battles upgrade (large Daily cards + Vote A/B
// beneath each preview + poster stills), the catalog-wide YXXS
// cut, the play-78 team correction, and site-level link previews.
// Run: node test-r226.js
// Emil approved all four workstreams 2026-11-27:
//   A. The Daily Battle's A/B previews become LARGE side-by-side
//      cards; a "Vote A" button sits directly beneath preview A
//      and "Vote B" beneath preview B (same ids, same
//      dailyPick100 wiring — picks stay just-for-fun, R179);
//      each preview's still is the play's poster image (the
//      pooled master playback is unchanged, R192). The Quick
//      stage and Battle Run keep the compact format + Pick labels.
//   B. YXXS is cut everywhere: store quick view + Hype Sports
//      size rows, the homepage strip copy, BOTH size guides
//      (unified on the studio's inches table), HF_SIZES, the
//      server order whitelist (a YXXS payload now gets the
//      invalid-size treatment — the sanitize-to-YM fallback,
//      exactly like "XXL"), and the R200 Shopify variant map.
//      Historical orders are untouched.
//   C. Play 78's Team field: "Kameron Angelin" -> "Kameron A".
//      No owner edit path for team exists, so a guarded boot
//      UPDATE fires ONLY on (id=78 AND team exactly
//      'Kameron Angelin') and no-ops forever after.
//   D. Every public HTML page gains a meta description +
//      Open Graph + Twitter card tags (static, site-level;
//      og:image is the stable nicholas218 hoodie asset).
// Pins: app.js v223 / styles v216.
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
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const serverJs = read("server.js");
const appJs = read("public/app.js");
const css = read("public/styles.css");
const home = read("public/index.html");

// ---------- statics: pins ----------
assert(home.includes('src="app.js?v=226"') && home.includes('href="styles.css?v=219"'), "pins: app.js v223 / styles v216");

// ---------- A. Battles statics ----------
{
  const dm = home.slice(home.indexOf('id="dailyMain"'), home.indexOf('id="dailyStrip"'));
  assert(dm.includes('class="daily-voterow226"'), "A: the Daily card carries the Round 226 vote row");
  assert(dm.indexOf('id="dailyMatchup"') < dm.indexOf('daily-voterow226') && dm.indexOf('daily-voterow226') < dm.indexOf('id="dailyPlayer"'), "A: the vote row sits directly beneath the matchup and above the big player");
  assert(dm.includes('id="dailyPickA">Vote A</button>') && dm.includes('id="dailyPickB">Vote B</button>'), "A: the buttons read Vote A / Vote B in the markup");
  assert(!dm.includes("btl-pickrow"), "A: the old pick row below the player is retired from the Daily card");
  assert((home.match(/id="dailyPickA"/g) || []).length === 1 && (home.match(/id="dailyPickB"/g) || []).length === 1, "A: exactly one dailyPickA / dailyPickB exists (ids + wiring preserved)");
  assert(home.includes('id="btlPickL">Pick A</button>') && home.includes('id="btlPickR">Pick B</button>'), "A: the Quick stage buttons keep their Pick A / Pick B labels (out of scope, untouched)");
  const dailyFn = appJs.slice(appJs.indexOf("async function loadDaily100"), appJs.indexOf("async function dailyPick100"));
  assert(dailyFn.includes('textContent = "Vote A"') && dailyFn.includes('textContent = "Vote B"'), "A: loadDaily100 resets the Daily buttons to Vote A / Vote B");
  assert(dailyFn.includes('innerHTML = `${CROWN227} Your pick`') && !dailyFn.includes("👑") && !dailyFn.includes('textContent = "Pick A"') && !dailyFn.includes('textContent = "Pick B"'), "A: the picked state still shows Your pick on the Daily buttons; no Pick A/B labels remain in the Daily renderer — →227: the 👑 emoji is now the /crown.png asset, set via innerHTML with the CROWN227 constant");
  assert(appJs.includes('pickL.textContent = "Pick A"') && appJs.includes('pickR.textContent = "Pick B"'), "A: the Quick stage renderer keeps its Pick A / Pick B resets");
  assert(appJs.includes('bind("dailyPickA", "click", () => dailyPick100("A"))') && appJs.includes('bind("dailyPickB", "click", () => dailyPick100("B"))'), "A: the vote buttons wire to the existing dailyPick100 pick logic, unchanged");
  assert(appJs.includes("data-poster226=") && appJs.includes("opts.poster226") && appJs.includes("poster226: true"), "A: the Daily minis carry the play's poster (poster226) from the Daily call site only");
  assert(appJs.includes("slot.dataset.poster226") && appJs.includes("opts.poster226) { const sp226"), "A: the pooled-media install applies the slot's poster226 as the video still when the flag rides");
  assert(css.includes("#dailyCard{max-width:720px}") && css.includes("#dailyCard .btl-matchup{max-width:none}") && css.includes(".daily-voterow226{") && css.includes(".daily-vote-vs226{flex:0 0 38px}"), "A: the large-format styles ride (720 card, full-width matchup, vote row mirroring the VS geometry)");
}

// ---------- B. YXXS statics ----------
{
  for (const attr of ['data-qv-size="YXXS"', 'data-hs-size="YXXS"', 'data-hf-size="YXXS"'])
    assert(!home.includes(attr), `B: no YXXS size button survives (${attr})`);
  assert(!home.includes("<td>YXXS</td>") && !home.includes("Youth sizes YXXS–YXL"), "B: no YXXS row or size run survives in the page copy");
  assert(home.includes("Youth sizes YXS–YXL · Adult sizes S–XL") || appJs.includes("Youth sizes YXS–YXL · Adult sizes S–XL"), "B: the strip note now reads Youth sizes YXS–YXL");
  const sizesLine = appJs.slice(appJs.indexOf("const HF_SIZES"), appJs.indexOf("\n", appJs.indexOf("const HF_SIZES")));
  const hfSizes = vm.runInNewContext(sizesLine.replace("const HF_SIZES =", "(").replace(/;\s*$/, "") + ")");
  assert(JSON.stringify(hfSizes) === JSON.stringify(["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"]), "B: HF_SIZES is the nine-size list (YXXS gone)");
  assert(serverJs.includes('["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"].includes(String(body.size || "")'), "B: the server order whitelist is the nine-size list");
  assert(!serverJs.includes('YXXS: "68266140827861"'), "B: the Shopify variant map lost its YXXS entry");
  const vm200 = serverJs.slice(serverJs.indexOf("const HF_VARIANTS_200"), serverJs.indexOf("};", serverJs.indexOf("const HF_VARIANTS_200")));
  assert((vm200.match(/: "\d{14}"/g) || []).length === 9, "B: the variant map carries exactly nine variants");
  // The two guides, unified on the studio's inches table.
  const studioGuide = home.slice(home.indexOf('id="hfSizeGuide205"'), home.indexOf('id="hfSizeGuide205"') + 3000);
  assert(!studioGuide.includes("YXXS") && studioGuide.includes("<td>YXS</td><td>28″</td><td>19″</td>"), "B: the studio guide opens at YXS with its inches rows");
  const sg = home.slice(home.indexOf('id="sizeGuide"'), home.indexOf("<!-- ============ FINAL CTA"));
  assert(!sg.includes("Age — general") && !sg.includes("<td>4–5</td>"), "B: the shared guide's ages table is gone");
  assert(sg.includes("<td>YXS</td><td>28″</td><td>19″</td>") && sg.includes("<td>YXL</td><td>36″</td><td>26″</td>") && sg.includes("<td>S</td><td>40″</td><td>27″</td>") && sg.includes("<td>XL</td><td>46″</td><td>30″</td>"), "B: the shared guide carries the studio's inches table (youth + adult)");
  assert(sg.includes("Chest is the garment's width across the chest; length is shoulder to hem. A general guide — between sizes, size up for a growing athlete."), "B: the shared guide's note matches the studio guide's note verbatim");
  assert(sg.includes("Youth sizes: YXS · YS · YM · YL · YXL"), "B: the shared guide's size run starts at YXS");
  assert(!home.includes("Ages are general youth sizing guidance"), "B: no ages-system copy survives anywhere on the page");
}

// ---------- D. Link-preview statics ----------
{
  const OG_IMG = "https://highlighthype.com/swag/hf-hoodie-nicholas218.jpg";
  assert(fs.existsSync(path.join(ROOT, "public/swag/hf-hoodie-nicholas218.jpg")), "D: the og:image asset exists on disk");
  for (const f of ["index.html", "about.html", "demo.html", "demo-rockets.html", "gamechanger.html", "privacy.html", "terms.html", "battles.html"]) {
    const page = read("public/" + f);
    assert(page.includes('name="description" content="'), `D: ${f} carries a meta description`);
    assert(page.includes('property="og:title"') && page.includes('property="og:description"') && page.includes(`property="og:image" content="${OG_IMG}"`), `D: ${f} carries the Open Graph set with the stable og:image`);
    assert(page.includes('name="twitter:card" content="summary_large_image"') && page.includes(`name="twitter:image" content="${OG_IMG}"`), `D: ${f} carries the Twitter card set`);
  }
  assert(home.includes('property="og:url" content="https://highlighthype.com/"'), "D: the homepage canonical og:url is the site root");
  assert(home.includes('property="og:title" content="HighlightHype — Every Athlete Deserves The Hype"'), "D: the homepage og:title mirrors its <title>");
}

// ---------- boots ----------
async function boot(port, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r226-"));
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
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, base, j, stop, getLog: () => log };
}
const seedPlay = (tmp, id, team) => {
  const db = new DatabaseSync(path.join(tmp, "highlighthype.db"));
  db.prepare("INSERT INTO highlights(id,title,sport,media_kind,media_url,status,is_sample,team) VALUES(?,?,?,'link','https://www.youtube.com/watch?v=dQw4w9WgXcQ','approved',0,?)").run(id, "Seed Play " + id, "baseball", team);
  db.close();
};
const boardTeam = async (s, id) => {
  const r = await s.j("/api/highlights?division=all&sort=newest");
  const p = (r.body.highlights || []).find((h) => h.id === id);
  return p ? p.team : null;
};

try {
  // ---------- C + B: correction boot ----------
  const s0 = await boot(45261); const tmpC = s0.tmp; await s0.stop();
  seedPlay(tmpC, 78, "Kameron Angelin");
  seedPlay(tmpC, 79, "Kameron Angelin");
  seedPlay(tmpC, 80, "Kameron A");
  const s1 = await boot(45261, tmpC);
  try {
    assert((await boardTeam(s1, 78)) === "Kameron A", "C: play 78's public Team field now reads 'Kameron A'");
    assert((await boardTeam(s1, 79)) === "Kameron Angelin", "C: another play carrying the same value is untouched (the guard is id + value)");
    assert((await boardTeam(s1, 80)) === "Kameron A", "C: a play already in the standard form is unchanged");
    assert(s1.getLog().includes("[r226] play 78 team corrected"), "C: the correction logged itself at boot");

    // B: order-size behavior against the same boot.
    const claim = await s1.j("/api/owner/claim", { method: "POST" });
    const tok = claim.body.token; assert(tok, "B: owner claim returns a token");
    const post = (p, body, t) => s1.j(p, { method: "POST", headers: { "content-type": "application/json", ...(t ? { "x-owner-token": t } : {}) }, body: JSON.stringify(body) });
    const mk = await post("/api/highlights", { title: "Size Play", sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" });
    const playId = mk.body.id;
    const appr = await post(`/api/highlights/${playId}/status`, { status: "approved" }, tok);
    assert(appr.body.status === "approved", "B: play approved for the order tests");
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const order = (size) => post("/api/hype-frame/orders", { highlightId: playId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", size, guardianName: "Pat Parent", guardianEmail: "parent@example.com", image: PNG });
    const ownerRow = async (id) => (await s1.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } })).body.requests.find((o) => o.id === id);
    let r = await order("YXXS");
    assert(r.status === 201, "B: a YXXS order is still created (invalid-size treatment, not a hard failure)");
    let o = await ownerRow(r.body.id);
    assert(o && o.size === "YM", "B: a YXXS payload stores 'YM' — the same sanitize fallback any invalid size gets (never 'YXXS')");
    r = await order("YXS");
    o = await ownerRow(r.body.id);
    assert(r.status === 201 && o && o.size === "YXS", "B: the smallest surviving size (YXS) stores verbatim");
  } finally { await s1.stop(); }
  const s2 = await boot(45261, tmpC);
  try {
    assert((await boardTeam(s2, 78)) === "Kameron A", "C: a later boot leaves the corrected value in place");
    assert(!s2.getLog().includes("[r226] play 78 team corrected"), "C: the correction no-ops on later boots (no second log line)");
  } finally { await s2.stop(); }

  // ---------- C: the guard blocks any other value ----------
  const t0 = await boot(45262); const tmpG = t0.tmp; await t0.stop();
  seedPlay(tmpG, 78, "Somebody Else");
  const g1 = await boot(45262, tmpG);
  try {
    assert((await boardTeam(g1, 78)) === "Somebody Else", "C: play 78 with any other team value is NOT corrected (exact-match guard)");
    assert(!g1.getLog().includes("[r226] play 78 team corrected"), "C: no correction logged when the guard does not match");
  } finally { await g1.stop(); }

  console.log("\nALL R226 CHECKS PASSED");
} catch (e) {
  console.error(e.message);
  process.exit(1);
}
