// Round 235 (2026-11-27) — the studio round from Emil's phone,
// three screenshots + three verbatim asks in nine minutes:
//   14:53 — the studio for play 78 (Kameron, Touchdown) shows
//     the full Hype Frame design on the hoodie but the frame
//     WINDOW IS EMPTY; the ★ Recommended filmstrip frame (0:05)
//     is selected, its own thumbnail shows the photo fine, the
//     second filmstrip frame is solid black, and the ★ badge
//     reads "ecommended". "Even though it shows recommended it
//     doesn't load onto the shirt" + "The frame on the shirt is
//     also too small."
//   14:54 — the same pick, moments later: the photo IS in the
//     window, with "Checking your frame for a fence…" under the
//     preview — the first shot caught a cold player mid-pipeline.
//   14:56 — the Artwork section: "It's weird to say photo here."
//   15:04 — "Let's remove this it takes too much room" (the
//     standing fence disclosure paragraph).
//   15:06 — "There is still too much space the button should be
//     moved up" (dead band before the Review bar).
//   Plus, verbatim: "Pick from video should be above upload
//   from a photo."
//
// ITEM A DIAGNOSIS (evidence, in order of suspicion):
//   - The R229 fence pipeline is EXONERATED: composeHfPrint runs
//     BEFORE hfAutoFence229 is invoked (hfCapturePrint's body,
//     hfSeedPoster215's onload), so a pending check can never
//     hold the photo back — and the 14:54 shot proves the photo
//     paints while a check is still running.
//   - The R232 ?v= poster token is EXONERATED: poster_url is an
//     opaque URL everywhere in the studio (no split/parse).
//   - The service worker is EXONERATED: /uploads/* passes
//     through; data URLs are never intercepted.
//   - GUILTY: hfCapturePrint reset #hfCanvas IN PLACE
//     (c.width = … wipes the canvas) BEFORE drawImage(video),
//     with no pixel validation. On a cold/cellular player,
//     drawImage at the 'seeked' instant can paint NOTHING
//     (WebKit presents the frame a beat after 'seeked') — one
//     unpainted draw destroyed the good seed frame and composed
//     an empty window. The filmstrip's black frame 2 is the
//     same unvalidated draw in hfBuildStrip. The fence check
//     then ran on the blank frame and cleared silently, which
//     is why the 14:53 shot shows no note at all.
// FIX: the draw lands in a scratch canvas and is pixel-probed
// (hfPixelsBlank235: fully transparent, or flat-black, reads
// as "no frame yet" — a real frame, even a dark one, carries a
// bright pixel somewhere). Only painted pixels commit
// (hfCommitCapture235 — the old body, unchanged). A blank draw
// keeps the previous print, retries at 350/800/1500ms
// (hfCaptureRetry235, token-guarded), and on exhaustion leaves
// an honest note in #hfPhotoMsg215 — never a silent empty
// window. hfJumpToFrame's select() hides the instant preview
// only once a capture commits. The filmstrip validates each
// thumb the same way (redraw, re-seek, then skip — a frame
// that can't be produced never renders as a black tile).
// Drive-by: the ★ badge is sized to fit its 86px thumb.
//
// ITEM B (report-only, no template change): geometry measured
// + two mocks built (mock-r235-frame-current.png /
// mock-r235-frame-bigger.png in the project root). The preview
// is NOT under-scaled (≈3% LARGER than a true 12" print on the
// garment photo's panel) — the smallness is the frame's share
// INSIDE the design (397×706 of 720×1023 ≈ 55% of width), a
// template-proportion question for Emil's pick.
//
// ITEM C: Pick from video (row + player area) moved above
// Upload a photo in the moment section — pure ordering.
// ITEM D: the Artwork toggle "Photo" → "Frame", its explainer,
// the section state line and the Review art line renamed
// (display copy only — imageStyle stays "photo").
// ITEM E: the standing fence disclosure paragraph is REMOVED
// from #hfFenceAuto229; the dynamic status line + Use
// original / Use cleaned revert stay. (Supersedes Item D's
// edit inside that paragraph.)
// ITEM F: measured — the Review bar's real height is ~81px
// (compact padding 8+8, the ~46px button, the ~19px note), yet
// the in-flow void stacked after the buy card was 118px (the
// 96px #hfProduct215 reserve + the section's 22px bottom
// padding), and a viewport-fixed bar floats over that whole
// column (Emil's shot: ~163 CSS px from card to bar). The bar
// is now sticky-in-flow: it rests directly below the buy card
// on a 12px margin, pins to the viewport bottom while the
// studio scrolls exactly as before, and can never cover
// content at rest — the reserve is deleted, not re-measured.
//
// Pins: app.js v231 / styles v222.
// Run: node test-r235.js — exits non-zero on failure.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = new URL(".", import.meta.url).pathname;
const assert = (cond, msg) => { if (!cond) throw new Error("FAIL: " + msg); console.log("ok -", msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const home = fs.readFileSync(path.join(ROOT, "public/index.html"), "utf8");
const appJs = fs.readFileSync(path.join(ROOT, "public/app.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "public/styles.css"), "utf8");

// ---- A. pins ----
assert(home.includes('href="styles.css?v=228"') && home.includes('src="app.js?v=239"'), "A: asset pins — app.js now v231 (Round 235); styles now v222 (Round 235) — →236: app.js now v232 (Round 236); styles now v223 (Round 236) — →237: app.js now v233 (Round 237); styles now v224 (Round 237) — →238: app.js now v234 (Round 238); styles now v225 (Round 238) — →239: app.js now v235 (Round 239); styles keeps v225 (unchanged this round) — →240: app.js now v236 (Round 240); styles now v226 (Round 240) — →242: app.js now v237 (Round 242); styles now v227 (Round 242) — →243: app.js now v238 (Round 243); styles keeps v227 (unchanged this round) — →244: app.js now v239 (Round 244); styles now v228 (Round 244)");

// ---- B. Item A statics ----
const captureBlock = appJs.slice(appJs.indexOf("function hfCapturePrint()"), appJs.indexOf("function freezeHfFrame()"));
assert(captureBlock.includes("function hfPixelsBlank235") && captureBlock.includes("function hfCommitCapture235") && captureBlock.includes("function hfCaptureRetry235"), "B: the capture group ships whole inside the established slice — probe, commit, retry");
assert(captureBlock.includes("scratch.getContext(\"2d\").drawImage(v, 0, 0, scratch.width, scratch.height)") && captureBlock.includes("if (hfPixelsBlank235(scratch)) { hfCaptureRetry235(token); return false; }"), "B: a video capture draws into a scratch canvas and a blank probe stands the commit down + schedules the retry");
assert(!captureBlock.includes("c.width = v.videoWidth"), "B: the in-place canvas reset that wiped the seed frame is GONE from the capture path");
assert(captureBlock.includes("x.drawImage(scratch, 0, 0, c.width, c.height)"), "B: the commit copies the validated scratch into #hfCanvas (the old body's state path is unchanged below that line)");
assert(appJs.includes("if (hfPixelsBlank235(cvs)) continue;"), "B: the filmstrip skips a moment whose frame never paints — no black selectable tile");
const jumpBlock = appJs.slice(appJs.indexOf("function hfJumpToFrame"), appJs.indexOf("/* Round 205 still recommendation"));
assert(jumpBlock.includes("if (hfCapturePrint()) { hfHideInstant205();"), "B: a frame tap hides the instant preview only once the capture COMMITS — a blank draw keeps the previous print and the preview");
assert(appJs.includes("if (hfCapturePending235) return;"), "B: Freeze stands down quietly while a capture retry is chasing the frame (no premature 'give it a moment' alert)");
assert(appJs.includes("That frame didn't come through — it may still be loading on this connection. Tap the frame again, or pick a different one."), "B: the honest failure note ships verbatim");

// ---- C. VM drive: seed + picks against a pixel-model player ----
// Play-78-shaped fixture: 720×1280 portrait video, poster_url
// carrying an R232 ?v= token (opaque to the studio).
{
  const seedBlock = appJs.slice(appJs.indexOf("function hfSeedUrl215"), appJs.indexOf("function hfUploadPhoto222"));
  const orderLog = [];
  const fenceSnapshots = [];
  function ctxFor(cv) {
    return {
      drawImage(src) { if (src && src._pix) cv._pix = { ...src._pix }; },
      getImageData(x0, y0, w, h) {
        const d = new Uint8ClampedArray(w * h * 4);
        for (let i = 0, p = 0; i < w * h; i++, p += 4) {
          const l = (cv._pix.max && i % 31 === 0) ? cv._pix.max : cv._pix.lum;
          d[p] = d[p + 1] = d[p + 2] = l; d[p + 3] = cv._pix.alpha;
        }
        return { data: d };
      },
      fillRect() {},
    };
  }
  const mkCanvas = () => {
    const cv = { width: 0, height: 0, _pix: { lum: 0, alpha: 0, max: 0, tag: "" }, _ctx: null,
      getContext() { if (!this._ctx) this._ctx = ctxFor(this); return this._ctx; },
      toDataURL: () => "data:image/png;base64,STUB235" };
    return cv;
  };
  class FakeImage {
    constructor() { FakeImage.last = this; this.naturalWidth = 0; this.naturalHeight = 0; this._pix = { lum: 120, alpha: 255, max: 210, tag: "poster78" }; }
  }
  const hfCanvas = mkCanvas();
  const video = { videoWidth: 720, videoHeight: 1280, readyState: 3, _pix: { lum: 0, alpha: 0, max: 0, tag: "blank" } };
  const msgEl = { textContent: "", hidden: true };
  let hideInstantCalls = 0, photoPickedCalls = 0;
  const sb = {
    console, setTimeout, clearTimeout,
    Image: FakeImage,
    document: { createElement: () => mkCanvas() },
    $: (s) => (s === "#hfCanvas" ? hfCanvas : s === "#hfVideo" ? video : s === "#hfPhotoMsg215" ? msgEl : s === "#hfPhoto" ? { naturalWidth: 0 } : null),
    hfState: { play: null, mediaType: "video", frozen: false, printDataUrl: "", printAspect: 0, frameCanvas206: null, avatarDataUrl206: "data:stale", avatarApplied206: true, avatarPreview206: true, designAspect218: 9, avatarFocus221: {}, fenceClean222: "stale", seedFrame215: false },
    composeHfPrint: () => {
      const fc = sb.hfState.frameCanvas206;
      sb.hfState.printDataUrl = "data:print:" + (fc && fc._pix ? fc._pix.tag : "none");
      sb.hfState.printAspect = fc ? fc.height / fc.width : 0;
      orderLog.push("compose:" + (fc && fc._pix ? fc._pix.tag : "none"));
    },
    hfAutoFence229: () => { orderLog.push("fence"); fenceSnapshots.push(sb.hfState.printDataUrl); },
    hfSyncAvatar206: () => {}, hfSyncFrozenThumb: () => {}, hfGarmentSync206: () => {},
    hfHideInstant205: () => { hideInstantCalls++; },
    hfPhotoPicked215: () => { photoPickedCalls++; },
  };
  sb.window = sb;
  const ctx = vm.createContext(sb);
  vm.runInContext(seedBlock, ctx);
  vm.runInContext(captureBlock, ctx);
  const S = sb.hfState;
  const play78 = { id: 78, media_type: "video", media_url: "/uploads/play-78.mp4", poster_url: "/uploads/poster-78.jpg?v=12345-6789", title: "Touchdown" };
  S.play = play78;

  // C1. The seed: the design's image source is the poster at open.
  sb.hfSeedPoster215(play78);
  const img = FakeImage.last;
  assert(img && img.src === "/uploads/poster-78.jpg?v=12345-6789", "C: the seed loads the poster URL as-is — the R232 ?v= token rides as an opaque URL");
  img.naturalWidth = 720; img.naturalHeight = 1280;
  img.onload();
  assert(S.frozen === true && S.printDataUrl === "data:print:poster78", "C: at open, the design is composed from the seeded poster frame (the hoodie opens finished)");
  assert(orderLog.join(",") === "compose:poster78,fence", "C: the compose lands BEFORE the fence check is invoked — a pending check can never hold the photo back");

  // C2. The cold pick (Emil's 14:53 shot): the draw paints
  // nothing → the previous print survives, untouched.
  video._pix = { lum: 0, alpha: 0, max: 0, tag: "blank" };
  const r2 = sb.hfCapturePrint();
  assert(r2 === false && S.printDataUrl === "data:print:poster78", "C: a blank draw does NOT commit — the seeded print stays on the shirt (never an empty window)");
  assert(!orderLog.includes("compose:blank"), "C: no compose ever ran on the blank frame");

  // C3. The player presents the frame a beat later → the retry
  // commits the REAL picked frame (the ★ 0:05 moment).
  video._pix = { lum: 110, alpha: 255, max: 210, tag: "frame5" };
  await wait(650);
  assert(S.printDataUrl === "data:print:frame5", "C: the retry commits the picked frame once it paints — the design's image source is the recommended frame");
  assert(hideInstantCalls >= 1 && photoPickedCalls >= 1, "C: the landed retry runs the tap's follow-through (instant preview stands down, pick follow-through fires)");

  // C4. A warm pick commits synchronously, like Freeze always did.
  video._pix = { lum: 118, alpha: 255, max: 220, tag: "frame9" };
  const r4 = sb.hfCapturePrint();
  assert(r4 === true && S.printDataUrl === "data:print:frame9", "C: a warm frame tap commits at once — print composed from the tapped frame");

  // C5. A frame that NEVER paints: bounded retries, the
  // previous print kept, and an honest note — no silent void.
  video._pix = { lum: 0, alpha: 0, max: 0, tag: "blank" };
  const r5 = sb.hfCapturePrint();
  assert(r5 === false, "C: the never-painting pick does not commit");
  await wait(3100);
  assert(S.printDataUrl === "data:print:frame9", "C: after the retries exhaust, the previous print is STILL on the shirt");
  assert(msgEl.hidden === false && msgEl.textContent === "That frame didn't come through — it may still be loading on this connection. Tap the frame again, or pick a different one.", "C: the failure surfaces honestly in the moment section's live note");

  // C6. The next good capture clears its own failure note.
  video._pix = { lum: 105, alpha: 255, max: 205, tag: "frame11" };
  assert(sb.hfCapturePrint() === true && msgEl.textContent === "" && msgEl.hidden === true, "C: a landed capture clears the failure note");

  // C7. The fence invariant across every commit above: while
  // any check was pending, the design already carried the
  // original frame (checks swap in later; the window is never
  // empty in between).
  assert(fenceSnapshots.length >= 3 && fenceSnapshots.every((p) => p.startsWith("data:print:")), "C: every fence check was invoked with a finished design already on the shirt — the original paints first, a clean swaps in when ready");

  // C8. The probe itself: what counts as "no frame yet".
  const probe = (pix) => { const c = mkCanvas(); c.width = 720; c.height = 1280; c._pix = pix; return sb.hfPixelsBlank235(c); };
  assert(probe({ lum: 0, alpha: 0, max: 0 }) === true, "C: a fully transparent draw reads blank (nothing presented yet)");
  assert(probe({ lum: 0, alpha: 255, max: 0 }) === true, "C: a flat-black draw reads blank (a fade artifact, not a frame)");
  assert(probe({ lum: 4, alpha: 255, max: 200 }) === false, "C: a DARK but textured frame (bright pixel somewhere) is a real frame — it commits");
  assert(probe({ lum: 110, alpha: 255, max: 210 }) === false, "C: an ordinary frame is not blank");
  assert(sb.hfPixelsBlank235(null) === true, "C: a missing source reads blank, never a crash");
}

// ---- D. Item C: the moment section's rendered order ----
{
  const prod = home.slice(home.indexOf('id="hfProduct215"'), home.indexOf('id="hfReview215"'));
  const mom = prod.slice(prod.indexOf('id="hfPhotoPanel215"'), prod.indexOf('id="hfRowArtwork215"'));
  const at = (id) => mom.indexOf('id="' + id + '"');
  assert(at("hfStripWrap") > -1 && at("hfClipRow211") > at("hfStripWrap") && at("hfClipArea211") > at("hfClipRow211") && at("hfUploadBtn222") > at("hfClipArea211") && at("hfFence222") > at("hfUploadBtn222") && at("hfPhotoMsg215") > at("hfFence222"), "D: the moment section renders filmstrip → Pick from video → Upload a photo → fence step → message (Emil, verbatim: 'Pick from video should be above upload from a photo')");
  assert(mom.includes('aria-controls="hfClipArea211"') && mom.includes('id="hfUploadInput222" accept="image/*"') && mom.includes("📷 Upload a photo"), "D: pure ordering — the clip row's wiring, the upload input and the upload label are byte-identical");
}

// ---- E. Item E: the disclosure paragraph is gone, the dynamic parts stay ----
assert(!home.includes('id="hfFenceAutoDisclosure229"') && !home.includes("remove the fence automatically") && !home.includes("Your original photo is always one tap away"), "E: the standing fence disclosure paragraph is REMOVED from the studio (Emil: 'it takes too much room')");
assert(home.includes('id="hfFenceAutoNote229"') && home.includes('id="hfFenceAutoOriginal229"') && home.includes(">Use original</button>") && home.includes('id="hfFenceAutoCleaned229"'), "E: the dynamic parts stay — the live status line and the Use original / Use cleaned revert controls");
assert(appJs.includes("Checking your frame for a fence…"), "E: the live fence status line still ships in the auto-clean flow");

// ---- F. Item F: the spacing math ----
{
  const barRule = css.slice(css.indexOf(".hf-stickybar215{"), css.indexOf("}", css.indexOf(".hf-stickybar215{")));
  assert(!barRule.includes("position:sticky") && !barRule.includes("position:fixed") && !barRule.includes("bottom:0") && barRule.includes("margin:12px auto 0"), "F: the Review bar rests directly below the buy card on a 12px top margin — →237: UNSTUCK entirely (Emil, 15:50: 'The review hoodie button is now floating' — the sticky bar rode over the ADULT size pills while scrolling): no position:sticky, no position:fixed, no bottom pin — a plain in-flow block that scrolls naturally with the page");
  assert(css.includes("#hfProduct215{max-width:560px;margin:0 auto;padding-bottom:12px}") && !css.includes("padding-bottom:96px"), "F: the fixed-bar reserve is DELETED (the product page ends on a normal 12px padding)");
  assert(css.includes(".hf-stickybar215{padding:8px 12px calc(8px + env(safe-area-inset-bottom,0px))}") && css.includes(".hf-review-btn215{padding:12px}") && css.includes(".hf-stickybar-note215{margin-top:5px}"), "F: the bar's real components ship — compact padding 8+8, the button's 12+12 padding, the note's 5px margin");
  const barHeight = 8 + 8 + (12 + 12 + 21) + (5 + 14); // padding + button (padding + line) + note (margin + line) ≈ 80px
  const oldVoid = 96 + 22; // the R229 reserve + the section's bottom padding at phone widths
  assert(css.includes("#hypeframe{padding:8px 0 22px}") && oldVoid === 118 && oldVoid > barHeight, "F: the measured cause — →244: the ≥1024px override's top padding aligned 18px → 8px with the page-top compaction (the historical void math below is untouched) — the stacked void after the buy card was 118px against the bar's ~" + barHeight + "px real height, all of it reading as one dead band under a fixed bar (Emil's 15:06 shot: ~163 CSS px card → bar)");
}

// ---- G. Item D: the copy mapping (display only) ----
assert(home.includes('data-hf-image-style="photo" aria-pressed="true">Frame</button>'), "G: the Artwork toggle reads 'Frame' — its data-hf-image-style state value stays 'photo'");
assert(home.includes("<b>Frame</b> — your frozen frame, printed just as it is.") && !home.includes("printed as the photo it is"), "G: the explainer reads 'Frame — your frozen frame, printed just as it is.'");
assert(appJs.includes('? "Avatar" : "Frame"') && !appJs.includes('? "Avatar" : "Photo"'), "G: the Artwork section state line renders 'Frame · Hype Frame'");
assert(appJs.includes('"Frame — your frozen frame"') && !appJs.includes('"Real photo — your frozen frame"'), "G: the Review art line reads 'Frame — your frozen frame'");
assert(home.includes("📷 Upload a photo") && home.includes("Upload a photo instead — it becomes the print.") && appJs.includes('imageStyle: "photo"'), "G: 'photo' survives ONLY where a real uploaded photograph is meant — the Upload a photo control + helper are untouched, and the state default is unchanged");

// ---- H. The ★ badge fits its thumb ----
{
  const badge = css.slice(css.indexOf(".hf-thumb .hf-rec-badge205{"), css.indexOf("}", css.indexOf(".hf-thumb .hf-rec-badge205{")));
  assert(badge.includes("font-size:7.5px") && badge.includes("padding:1px 4px") && badge.includes("white-space:nowrap") && badge.includes("max-width:calc(100% - 8px)"), "H: the ★ Recommended badge is sized to its 86px thumb (7.5px type, tight padding, no wrap) — the whole word fits, no more 'ecommended'");
}

console.log("\ntest-r235: all assertions passed");
