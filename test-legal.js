// Legal pages test (2026-11-03 follow-up). Run: node test-legal.js
// Verifies /terms and /privacy load, footer links exist on the homepage
// (single site-wide footer — shown on home and Store views), key content
// markers are present, and no private guardian-contact field data appears.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-legal-test-"));
const PORT = 3458;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ["server.js"], { cwd: new URL(".", import.meta.url).pathname, env: { ...process.env, PORT: String(PORT), DATA_DIR: tmp }, stdio: "pipe" });
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, text: await r.text() }; };
try {
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }

  const home = await get("/");
  assert(home.status === 200, "homepage loads");
  assert(home.text.includes('href="/terms"') && home.text.includes('href="/privacy"'), "footer has Terms + Privacy links (site-wide footer: home and Store views)");

  const terms = await get("/terms");
  assert(terms.status === 200, "/terms loads");
  for (const marker of ["Terms of Use", "Hype of the Month", "7 days", "never for sale", "Last updated: November 2026", "hello@highlighthype.com"])
    assert(terms.text.includes(marker), `/terms contains: ${marker}`);
  assert(!terms.text.includes("guardian_phone") && !terms.text.includes("text_consent"), "/terms contains no private field internals");

  const privacy = await get("/privacy");
  assert(privacy.status === 200, "/privacy loads");
  for (const marker of ["Privacy Policy", "never sell", "under 13", "Last updated: November 2026", "hello@highlighthype.com", "automated assistant"])
    assert(privacy.text.includes(marker), `/privacy contains: ${marker}`);
  assert(!privacy.text.includes("guardian_phone") && !privacy.text.includes("text_consent"), "/privacy contains no private field internals");

  // Dead-end sweep (Round 2, 2026-11-05): the standalone legal pages
  // must carry a visible route back to the homepage.
  assert(terms.text.includes('href="/"') && terms.text.includes("← Back to HighlightHype") && terms.text.includes("HighlightHype home"), "/terms has visible home links (back link + footer)");
  assert(privacy.text.includes('href="/"') && privacy.text.includes("← Back to HighlightHype") && privacy.text.includes("HighlightHype home"), "/privacy has visible home links (back link + footer)");

  const termsFile = await get("/terms.html");
  assert(termsFile.status === 200, "/terms.html also serves directly");

  console.log("\nALL LEGAL-PAGE TESTS PASSED");
} finally {
  child.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}
