// Round 200 test: the studio → Shopify payment handoff.
// Run: node test-r200.js
// The model (Emil, 2026-11-26): the studio stays the order book,
// Shopify is the register. The whole handoff ships DARK behind
// HH_SHOPIFY_CHECKOUT=1. What this suite pins down:
//   A. Source: pins are app.js v201 / styles v199; the return
//      landing box is in the studio markup; the client carries
//      the Continue-to-payment step, the return poll and the
//      owner payment chip (VM-driven: exact chip per status,
//      nothing for legacy rows).
//   B. Handoff OFF (real endpoints): the legacy flow is
//      unchanged — 201 with NO checkoutUrl, the owner email
//      fires at create, the row's payment_status reads "", and
//      the public status endpoint returns ONLY {payment_status}.
//      A signed orders/paid webhook against that legacy order
//      alerts the owner and changes NOTHING (no double notify).
//   C. Handoff ON: create stores awaiting_payment, returns the
//      cart permalink for the size's variant (YM and XL ids
//      asserted) carrying the HH Order # property + attribute
//      and a readable Summary, and sends NO owner email. Then,
//      with fixture webhooks signed in-test: a bad signature is
//      401 with no state change; a valid orders/paid flips the
//      order to paid (paid_at + shopify_order_id stored) and
//      fires exactly ONE production email (PAID marker) and
//      exactly ONE parent confirmation; a duplicate delivery
//      sends nothing more; the note_attributes fallback matches
//      a second order; an unmatched payment is 200 + owner
//      alert, no crash; orders/refunded flips a paid order to
//      refunded + owner alert; an unmatched refund is a quiet
//      200.
//   D. Secret unset: the webhook endpoints are inert (503) and
//      the server stays healthy.
//   E. Legacy rows survive a reboot untouched alongside the
//      handoff rows.
// Mail is observed ONLY through the Round 164 HH_MAIL_CAPTURE
// stub. Exits non-zero on failure.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { DatabaseSync } from "node:sqlite";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const SECRET = "r200-test-webhook-secret";
const OWNER = "hello@highlighthype.com";
const GUARDIAN = "paying-parent@example.com";

async function boot(port, extraEnv = {}, dataDir) {
  const tmp = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), "hh-r200-"));
  const capture = path.join(tmp, "mail.jsonl");
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: tmp, AI_VISION_API_KEY: "", SMTP_USER: "hello@highlighthype.com", SMTP_PASS: "test-pass", HH_MAIL_CAPTURE: capture, ...extraEnv },
    stdio: "pipe",
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d; });
  child.stderr.on("data", (d) => { log += d; });
  const base = `http://localhost:${port}`;
  for (let i = 0; i < 50; i++) { try { await fetch(base + "/api/health"); break; } catch { await wait(200); } }
  const j = async (p, opts = {}) => { const r = await fetch(base + p, opts); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const mails = () => { try { return fs.readFileSync(capture, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const waitFor = async (fn, what, timeoutMs = 8000) => {
    const t0 = Date.now();
    for (;;) { const v = fn(); if (v) return v; if (Date.now() - t0 > timeoutMs) throw new Error("timed out waiting for " + what + "\n--- server log tail ---\n" + log.slice(-1500)); await wait(200); }
  };
  const stop = async () => { child.kill("SIGKILL"); await wait(300); };
  return { tmp, child, base, j, mails, waitFor, stop, getLog: () => log };
}

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const orderPayload = (highlightId, extra = {}) => ({ highlightId, customName: "Nick", jersey: "13", branding: true, apparel: "hoodie", colorway: "Black", size: "YM", guardianName: "Pat Parent", guardianEmail: GUARDIAN, image: PNG, ...extra });
const post = (s, p, body, tok) => s.j(p, { method: "POST", headers: { "content-type": "application/json", ...(tok ? { "x-owner-token": tok } : {}) }, body: JSON.stringify(body) });
const sign = (raw) => crypto.createHmac("sha256", SECRET).update(raw).digest("base64");
const webhook = async (s, path, payload, sigOverride) => {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  const r = await fetch(s.base + path, { method: "POST", headers: { "content-type": "application/json", "x-shopify-hmac-sha256": sigOverride !== undefined ? sigOverride : sign(raw) }, body: raw });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const paidPayload = (hhId, shopifyId, viaAttrs = false) => viaAttrs
  ? { id: shopifyId, email: GUARDIAN, total_price: "110.00", note_attributes: [{ name: "HH Order #", value: String(hhId) }], line_items: [{ id: 1, variant_id: 68266140926165, properties: [] }] }
  : { id: shopifyId, email: GUARDIAN, total_price: "110.00", note_attributes: [], line_items: [{ id: 1, variant_id: 68266140926165, properties: [{ name: "HH Order #", value: String(hhId) }, { name: "Summary", value: "x" }] }] };

async function setupPlay(s, tok, title) {
  const id = (await post(s, "/api/highlights", { title, sport: "baseball", playerName: "Nick", jersey: "13", videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", guardianConsent: "true" })).body.id;
  const appr = await post(s, `/api/highlights/${id}/status`, { status: "approved" }, tok);
  assert(appr.body.status === "approved", `setup: play "${title}" approved`);
  return id;
}
const ownerRow = async (s, tok, id) => {
  const r = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": tok } });
  return (r.body.requests || []).find((o) => o.id === id) || null;
};
const payStatus = async (s, id) => s.j(`/api/hype-frame/orders/${id}/payment-status`);

try {
  const appJs = fs.readFileSync(path.join(ROOT, "public", "app.js"), "utf8");
  const homeFile = fs.readFileSync(path.join(ROOT, "public", "index.html"), "utf8");

  // ---------- A. Source + VM drive of the chip ----------
  assert(homeFile.includes('src="app.js?v=227"') && homeFile.includes('href="styles.css?v=219"'), "A: asset pins — app.js now v201 (Round 200); styles keeps v199 (chips ride the existing .tagchip) — →202: app.js now v202 (Round 201); styles now v200 (Round 201) — →203: app.js now v203 (Round 202); styles now v201 (Round 202) — →204: app.js now v204 (Round 203); styles keeps v201 (unchanged this round) — →205: app.js now v205 (Round 204); styles now v202 (Round 204) — →206: app.js now v206 (Round 205); styles now v203 (Round 205) — →207: app.js now v207 (Round 206); styles now v204 (Round 206) — →208: app.js now v208 (Round 207); styles now v205 (Round 207) — →209: app.js now v209 (Round 208); styles keeps v205 (unchanged this round) — →210: app.js now v210 (Round 209); styles now v206 (Round 209) — →211: app.js now v211 (Round 210); styles now v207 (Round 210) — →212: app.js now v212 (Round 211); styles now v208 (Round 211) — →213: app.js now v213 (Round 214); styles now v209 (Round 214) — →214: app.js now v214 (Round 215) — →217: app.js now v215 (Round 217); styles keeps v210 (unchanged this round); styles now v210 (Round 215) — →218: app.js now v216 (Round 218); styles keeps v210 (unchanged this round) — →219: app.js now v217 (Round 219); styles now v211 (Round 219) — →220: app.js now v218 (Round 220); styles now v212 (Round 220) — →221: app.js now v219 (Round 221); styles now v213 (Round 221) — →222: app.js now v220 (Round 222); styles now v214 (Round 222) — →224: app.js now v221 (Round 224); styles keeps v214 (unchanged this round) — →223: app.js now v222 (Round 223); styles now v215 (Round 223) — →226: app.js now v223 (Round 226); styles now v216 (Round 226) — →227: app.js now v224 (Round 227); styles now v217 (Round 227) — →229: app.js now v225 (Round 229); styles now v218 (Round 229) — →230: app.js now v226 (Round 230); styles now v219 (Round 230) — →231: app.js now v227 (Round 231); styles keeps v219 (unchanged this round)");
  assert(homeFile.includes('id="hfReturn200"'), "A: the return landing box is in the studio markup");
  assert(appJs.includes("Continue to payment") && appJs.includes("hfReturnLanding200") && appJs.includes("payment-status"), "A: app.js carries the Continue-to-payment step, the return landing and the status poll");
  const fnSrc = appJs.slice(appJs.indexOf("function hfPayChip200"), appJs.indexOf("\n}", appJs.indexOf("function hfPayChip200")) + 2);
  const chip = vm.runInNewContext("(" + fnSrc.replace("function hfPayChip200", "function") + ")");
  assert(chip("awaiting_payment").includes("Awaiting payment"), "A: chip for awaiting_payment");
  assert(chip("paid").includes("Paid ✓"), "A: chip for paid");
  assert(chip("refunded").includes("Refunded"), "A: chip for refunded");
  assert(chip("") === "" && chip(undefined) === "" && chip(null) === "", "A: legacy rows (no payment status) get NO chip");

  // ---------- B. Handoff OFF: legacy flow byte-for-byte ----------
  {
    const s = await boot(3541, { HH_SHOPIFY_WEBHOOK_SECRET: SECRET });
    try {
      const tok = (await s.j("/api/owner/claim", { method: "POST" })).body.token;
      assert(tok, "B: owner claim returns a token");
      const playId = await setupPlay(s, tok, "Legacy Flow Play");
      const r = await post(s, "/api/hype-frame/orders", orderPayload(playId));
      assert(r.status === 201 && r.body.ok, "B: order created (201) with the handoff off");
      assert(!("checkoutUrl" in r.body), "B: NO checkoutUrl in the response with the handoff off");
      assert(r.body.status === "pending-guardian", "B: status is the legacy pending-guardian");
      const createMail = await s.waitFor(() => s.mails().find((m) => m.to === OWNER && /new Hype Frame request/.test(m.subject || "")), "B: create-time owner email");
      assert(!!createMail, "B: the owner email fires at create, exactly as before");
      const st = await payStatus(s, r.body.id);
      assert(st.status === 200 && st.body.payment_status === "" && Object.keys(st.body).length === 1, "B: status endpoint returns ONLY {payment_status}, '' for a legacy order");
      const row = await ownerRow(s, tok, r.body.id);
      assert(row && (row.payment_status || "") === "", "B: the stored row carries no payment status");

      // A signed paid webhook against the LEGACY order: alert only.
      const before = s.mails().length;
      const wh = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(r.body.id, 900001));
      assert(wh.status === 200 && wh.body.legacy === true, "B: paid webhook for a legacy order is a 200 flagged legacy");
      await s.waitFor(() => s.mails().find((m) => /legacy request/.test(m.subject || "")), "B: owner alert for the legacy payment");
      const st2 = await payStatus(s, r.body.id);
      assert(st2.body.payment_status === "", "B: the legacy order's state is UNCHANGED by the webhook");
      assert(s.mails().filter((m) => m.to === GUARDIAN).length === 0, "B: no parent email for a legacy order");
      assert(s.mails().filter((m) => /Hype Frame order PAID/.test(m.subject || "")).length === 0, "B: no production email for a legacy order (no double notify)");
      assert(s.mails().length >= before + 1, "B: the alert was the only new mail");
    } finally { await s.stop(); }
  }

  // ---------- C. Handoff ON: the full money path ----------
  let cDir, cTok, orderYm, orderXl;
  {
    const s = await boot(3542, { HH_SHOPIFY_CHECKOUT: "1", HH_SHOPIFY_WEBHOOK_SECRET: SECRET });
    cDir = s.tmp;
    try {
      const tok = (await s.j("/api/owner/claim", { method: "POST" })).body.token;
      cTok = tok;
      const playId = await setupPlay(s, tok, "Checkout Play");
      const baseMails = s.mails().length; // the pending-play notification from setup — not an order mail

      // Create (YM): awaiting_payment + the right permalink, no owner mail.
      const r = await post(s, "/api/hype-frame/orders", orderPayload(playId, { size: "YM" }));
      assert(r.status === 201 && r.body.ok, "C: order created (201) with the handoff on");
      orderYm = r.body.id;
      assert(r.body.status === "awaiting_payment" && r.body.paymentStatus === "awaiting_payment", "C: response status is awaiting_payment");
      const url = r.body.checkoutUrl || "";
      assert(url.startsWith("https://shop.highlighthype.com/cart/68266140926165:1"), "C: YM checkout URL is the cart permalink for the YM variant (68266140926165)");
      assert(url.includes(`properties[HH%20Order%20%23]=${orderYm}`), "C: the HH Order # rides as a line-item property");
      assert(url.includes(`attributes[HH%20Order%20%23]=${orderYm}`), "C: the HH Order # rides as a cart attribute (fallback key)");
      const sumMatch = url.match(/properties\[Summary\]=([^&]+)/);
      const summary = sumMatch ? decodeURIComponent(sumMatch[1]) : "";
      assert(summary.includes("Checkout Play") && summary.includes("Size YM") && summary.includes("Black") && summary.includes("Nick"), "C: the Summary property is readable (play, athlete, size, color)");
      assert(!url.includes("#"), "C: the checkout URL contains no raw # (the fragment trap)");
      await wait(700);
      assert(s.mails().filter((m) => m.to === OWNER && /Hype Frame/.test(m.subject || "")).length === 0, "C: NO Hype Frame owner email at create with the handoff on");
      const row = await ownerRow(s, tok, orderYm);
      assert(row && row.payment_status === "awaiting_payment", "C: the stored row is awaiting_payment");
      const st = await payStatus(s, orderYm);
      assert(st.body.payment_status === "awaiting_payment" && Object.keys(st.body).length === 1, "C: status endpoint reports awaiting_payment, status only");

      // Create (XL): the adult variant id.
      const r2 = await post(s, "/api/hype-frame/orders", orderPayload(playId, { size: "XL", guardianEmail: "xl-parent@example.com" }));
      orderXl = r2.body.id;
      assert((r2.body.checkoutUrl || "").includes("/cart/68717544833237:1"), "C: XL checkout URL carries the XL variant (68717544833237)");

      // Bad signature: 401, nothing changes, nothing mails.
      const bad = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(orderYm, 900101), sign("some other body"));
      assert(bad.status === 401, "C: a bad signature is rejected 401");
      assert((await payStatus(s, orderYm)).body.payment_status === "awaiting_payment", "C: state unchanged after the bad signature");
      assert(s.mails().length === baseMails, "C: no mail of any kind after the bad signature");

      // Valid orders/paid (line-item property match): flip + 2 emails.
      const okWh = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(orderYm, 900102));
      assert(okWh.status === 200 && okWh.body.matched === true, "C: valid orders/paid is a matched 200");
      assert((await payStatus(s, orderYm)).body.payment_status === "paid", "C: the order flipped to paid");
      const dbRow = new DatabaseSync(path.join(s.tmp, "highlighthype.db"), { readOnly: true });
      const stored = dbRow.prepare("SELECT payment_status, paid_at, shopify_order_id FROM hype_frame_orders WHERE id=?").get(orderYm);
      dbRow.close();
      assert(stored.payment_status === "paid" && !!stored.paid_at && stored.shopify_order_id === "900102", "C: paid_at stamped and the Shopify order id stored");
      await s.waitFor(() => s.mails().find((m) => /Hype Frame order PAID/.test(m.subject || "")), "C: production email");
      const prodMails = s.mails().filter((m) => m.to === OWNER && /Hype Frame order PAID/.test(m.subject || ""));
      assert(prodMails.length === 1 && /PAID/.test(prodMails[0].body || "") && (prodMails[0].body || "").includes("900102"), "C: exactly ONE production email, with the PAID marker + Shopify order id");
      const parentMail = await s.waitFor(() => s.mails().find((m) => m.to === GUARDIAN && /Payment confirmed/.test(m.subject || "")), "C: parent confirmation email");
      assert((parentMail.body || "").includes(`Order #${orderYm}`) && (parentMail.body || "").includes("5–7 business days"), "C: parent email carries the order # and the 5–7 business day promise");
      assert(typeof parentMail.html === "string" && parentMail.html.includes("https://highlighthype.com/logo-header-gold.png"), "C: parent email is the dark/gold HTML with the hosted header logo");
      assert(s.mails().filter((m) => m.to === GUARDIAN).length === 1, "C: exactly ONE parent email");

      // Duplicate delivery: 200, no second emails, state holds.
      const dup = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(orderYm, 900102));
      assert(dup.status === 200 && dup.body.duplicate === true, "C: duplicate delivery is a 200 flagged duplicate");
      await wait(700);
      assert(s.mails().filter((m) => /Hype Frame order PAID/.test(m.subject || "")).length === 1, "C: still exactly one production email after the duplicate");
      assert(s.mails().filter((m) => m.to === GUARDIAN).length === 1, "C: still exactly one parent email after the duplicate");

      // Fallback match: the XL order pays via note_attributes only.
      const okXl = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(orderXl, 900103, true));
      assert(okXl.status === 200 && okXl.body.matched === true, "C: the cart-attribute fallback matches the XL order");
      assert((await payStatus(s, orderXl)).body.payment_status === "paid", "C: the XL order flipped to paid via the fallback");

      // Unmatched payment: 200 + owner alert, server healthy.
      const un = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(999999, 900104));
      assert(un.status === 200 && un.body.matched === false, "C: an unmatched payment is a 200 (no retry storm)");
      await s.waitFor(() => s.mails().find((m) => /unmatched Shopify payment/.test(m.subject || "")), "C: owner alert for the unmatched payment");
      const health = await fetch(s.base + "/api/health");
      assert(health.ok, "C: server healthy after the unmatched payment");

      // Refund the paid YM order: flip + owner alert.
      const rf = await webhook(s, "/api/webhooks/shopify/orders-refunded", paidPayload(orderYm, 900102));
      assert(rf.status === 200 && rf.body.matched === true, "C: orders/refunded matches the paid order");
      assert((await payStatus(s, orderYm)).body.payment_status === "refunded", "C: the order flipped to refunded");
      await s.waitFor(() => s.mails().find((m) => /REFUNDED/.test(m.subject || "")), "C: owner alert for the refund");
      const rfDup = await webhook(s, "/api/webhooks/shopify/orders-refunded", paidPayload(orderYm, 900102));
      assert(rfDup.status === 200 && rfDup.body.duplicate === true, "C: a duplicate refund is a quiet 200");
      const rfUn = await webhook(s, "/api/webhooks/shopify/orders-refunded", paidPayload(888888, 900105));
      assert(rfUn.status === 200 && rfUn.body.matched === false, "C: an unmatched refund is a quiet 200");
    } finally { await s.stop(); }
  }

  // ---------- D. Secret unset: webhooks inert ----------
  {
    const s = await boot(3543, { HH_SHOPIFY_CHECKOUT: "1" });
    try {
      const wh = await webhook(s, "/api/webhooks/shopify/orders-paid", paidPayload(1, 900201));
      assert(wh.status === 503, "D: with no webhook secret set, orders/paid is inert (503)");
      const wh2 = await webhook(s, "/api/webhooks/shopify/orders-refunded", paidPayload(1, 900201));
      assert(wh2.status === 503, "D: with no webhook secret set, orders/refunded is inert (503)");
      const health = await fetch(s.base + "/api/health");
      assert(health.ok, "D: server healthy with the webhooks inert");
    } finally { await s.stop(); }
  }

  // ---------- E. Legacy rows survive alongside handoff rows ----------
  {
    const dbE = new DatabaseSync(path.join(cDir, "highlighthype.db"));
    dbE.prepare("INSERT INTO hype_frame_orders (highlight_id, print_image, custom_name, jersey, guardian_email, status, colorway) VALUES (1, '', 'Legacy Kid', '7', 'legacy@example.com', 'pending-guardian', 'Pink')").run();
    dbE.close();
    const s = await boot(3544, { HH_SHOPIFY_CHECKOUT: "1", HH_SHOPIFY_WEBHOOK_SECRET: SECRET }, cDir);
    try {
      const list = await s.j("/api/owner/hype-frames", { headers: { "x-owner-token": cTok } });
      const legacy = (list.body.requests || []).find((o) => o.guardian_email === "legacy@example.com");
      assert(legacy && (legacy.payment_status || "") === "" && legacy.colorway === "Pink", "E: the legacy row reads back untouched (no payment status, stored colorway intact)");
      const ym = (list.body.requests || []).find((o) => o.id === orderYm);
      assert(ym && ym.payment_status === "refunded" && ym.shopify_order_id === "900102", "E: the handoff order kept its refunded state + Shopify id across the reboot");
      const xl = (list.body.requests || []).find((o) => o.id === orderXl);
      assert(xl && xl.payment_status === "paid", "E: the fallback-matched order kept its paid state across the reboot");
      const stL = await payStatus(s, legacy.id);
      assert(stL.body.payment_status === "", "E: the status endpoint reads '' for the legacy row");
    } finally { await s.stop(); }
  }

  console.log("\nR200 ALL PASS");
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
