// HighlightHype front end (2026-11-03 design port).
// Voter identity = a random token stored in this browser (one vote per
// browser per play per month). Owner identity = a token stored the
// same way. Athlete identity is server-side (athlete_id); the name is
// only a label.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
/* Safe storage (Round 2, 2026-11-05): a shared link opened inside an
   in-app browser (Messages etc.) can make localStorage throw or be
   unavailable, which used to break voting outright. Every token read
   and write goes through this helper: localStorage inside try/catch
   first, then a first-party cookie, then an in-memory value for the
   current page session. Storage failures must never break the page. */
const hhMemoryStore = new Map();
function hhStorageGet(key) {
  try {
    const value = window.localStorage.getItem(key);
    if (value) { hhMemoryStore.set(key, value); return value; }
  } catch { /* restricted storage: fall through to the cookie */ }
  try {
    const prefix = `${encodeURIComponent(key)}=`;
    const part = document.cookie.split(";").map((p) => p.trim()).find((p) => p.startsWith(prefix));
    if (part) {
      const value = decodeURIComponent(part.slice(prefix.length));
      if (value) { hhMemoryStore.set(key, value); return value; }
    }
  } catch { /* cookies unavailable too: use memory below */ }
  return hhMemoryStore.get(key) || "";
}
function hhStorageSet(key, value) {
  hhMemoryStore.set(key, value);
  try { window.localStorage.setItem(key, value); return; } catch { /* fall through to the cookie */ }
  try { document.cookie = `${encodeURIComponent(key)}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/; SameSite=Lax`; } catch { /* memory copy above still serves this session */ }
}
const voterToken = hhStorageGet("hh_voter") || (() => { const t = "v_" + Math.random().toString(36).slice(2) + Date.now(); hhStorageSet("hh_voter", t); return t; })();
const ownerToken = () => hhStorageGet("hh_owner_token");
const setOwnerToken = (token) => { if (token) hhStorageSet("hh_owner_token", token); };
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...(ownerToken() ? { "x-owner-token": ownerToken() } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Request failed");
  return j;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => { if (s === "fieldhockey") return "Field Hockey"; if (s === "hockey") return "Ice Hockey"; if (s === "martialarts") return "Martial Arts"; if (s === "track") return "Track & Field"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
/* ---------------- site stats (first-party, aggregate only) ------
   The server keeps DAILY COUNTERS only (POST /api/track): how many
   times each main view was shown, each play's detail opened, and
   which referrer buckets visitors arrived from. Nothing here
   identifies anyone — no cookie is set, no id is sent, and a call
   carries only the event kind plus a fixed key (a view name, a
   play id, or a referrer HOST — never a full URL). Firing is
   fire-and-forget (sendBeacon when available, keepalive fetch
   otherwise) and every failure is swallowed: stats must never
   break or slow the page. */
function trackEvent(kind, key) {
  try {
    const payload = JSON.stringify({ kind, key: String(key ?? "") });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/track", new Blob([payload], { type: "application/json" }));
    } else if (typeof fetch === "function") {
      fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true }).catch(() => {});
    }
  } catch { /* stats are best-effort only */ }
}
/* Where this page load came from, reduced to a host. An empty
   referrer — or one of our own pages (a return from /terms, say) —
   counts as "direct"; the server buckets the host again, and
   anything unrecognizable collapses to "other" there. */
function trackReferrer() {
  let key = "direct";
  try {
    const ref = document.referrer || "";
    if (ref) { const host = new URL(ref).hostname; if (host && host !== location.hostname) key = host; }
  } catch { /* keep "direct" */ }
  trackEvent("referrer", key);
}
/* ---------------- Round 159: visitor sources ------------------
   ONE arrival event per browser session: where this visitor came
   from, reduced to a bare HOST — the payload carries the
   referrer's hostname only, never its URL, path or query — plus
   any UTM campaign tags on our own link and the view landed on.
   The once-only flag lives in sessionStorage (it dies with the
   tab; no cookie is set and nothing persists between visits),
   and the owner panel is never counted: an owner checking the
   site is not audience. The server classifies the host (direct /
   search / social / other) and keeps daily counters only — see
   recordVisitSource159 in server.js. Fire-and-forget like every
   trackEvent; a failure here must never break the page. */
function landingView159() {
  try {
    const path = location.pathname.replace(/\/+$/, "") || "/";
    const view = new URLSearchParams(location.search).get("view");
    if (path === "/store" || ["#shop", "#hype-girls", "#hype-boys"].includes(location.hash)) return "store";
    if (path === "/stories" || location.hash === "#stories") return "stories";
    if (view === "battles") return "battles";
    if (view === "month") return "month";
    if (view === "all") return "board";
  } catch { /* fall through to home */ }
  return "home";
}
function trackVisitSource159() {
  try {
    if (location.hash === "#owner") return;
    let seen159 = "";
    try { seen159 = sessionStorage.getItem("hhVisitSource159") || ""; } catch { /* storage blocked: count the arrival anyway */ }
    if (seen159) return;
    try { sessionStorage.setItem("hhVisitSource159", "1"); } catch { /* storage blocked: the flag is best-effort too */ }
    let host159 = "";
    try { if (document.referrer) host159 = new URL(document.referrer).hostname || ""; } catch { host159 = ""; }
    const q159 = new URLSearchParams(location.search);
    const payload159 = JSON.stringify({ kind: "visit_source", host: host159, utmSource: q159.get("utm_source") || "", utmMedium: q159.get("utm_medium") || "", utmCampaign: q159.get("utm_campaign") || "", landing: landingView159() });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/track", new Blob([payload159], { type: "application/json" }));
    } else if (typeof fetch === "function") {
      fetch("/api/track", { method: "POST", headers: { "content-type": "application/json" }, body: payload159, keepalive: true }).catch(() => {});
    }
  } catch { /* stats are best-effort only */ }
}
/* Round 6 (2026-11-05): Dance, Golf, Swimming, Tennis, Track & Field
   and Wrestling join the list (youth rerun v3: kids in those sports
   had to pick "Other"). Alphabetical, with "other" keeping its
   long-standing slot between Lacrosse and Soccer. This constant, the
   upload form's <option> list and cap()'s special labels are the
   three places a sport lives; the server stores whatever key it is
   sent (lowercased), so no server list needs to match. */
const SPORTS = ["baseball", "basketball", "cheer", "dance", "fieldhockey", "football", "golf", "gymnastics", "hockey", "lacrosse", "martialarts", "other", "soccer", "softball", "swimming", "tennis", "track", "volleyball", "wrestling"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ---------------- data ---------------- */
let ALL_PLAYS = [];      // approved, all-time (from /api/highlights?division=all)
let CONTEST = { period: "", entries: [], winnerId: null };
let LAST_MONTH = { period: "", entries: [], winnerId: null }; // previous period's contest (Round 9 winner strip)
let currentView = "month";
let monthDiv = "boys", monthSport = "all";
let allDiv = "all", allSport = "all", allSearch = "";
/* Round 162: the Firsts & Milestones lane — session-only board
   state like its neighbours (never persisted). ON narrows the
   Watch board to the heart kinds (MOMENT_HEART162); OFF is the
   board exactly as it was. */
let lane162 = false;
/* Default landing view (Round 8, 2026-11-05): the site used to land
   on the Hype of the Month board unconditionally — a dead first
   screen whenever the month has no contest entries yet (samples
   can never be entries), while All Hypes holds every play. The
   default is now decided ONCE, when the first data load lands and
   BEFORE the first board render (so there is no visible view
   flash): land on All Hypes unless this month's contest already
   has at least one entry, in which case the Month board stays the
   front door. boot() sets bootHashTarget when the URL hash routes
   somewhere explicit (a shared #play-, an athlete, the studio, the
   store, a team board, the owner panel) — an explicit target always
   wins over the default rule, and manual switching is untouched. */
let defaultViewPending = true;
let bootHashTarget = false;

async function loadData() {
  const [h, c] = await Promise.all([
    api(`/api/highlights?division=all&sort=top&voterToken=${voterToken}`),
    api(`/api/contest?voterToken=${voterToken}`),
  ]);
  ALL_PLAYS = h.highlights || [];
  /* Round 108: the payload's hawksFounding count is still served
     (owner/API data), but the public Founding Plays card it fed
     is removed — no renderer consumes it on the homepage now. */
  CONTEST = c;
  /* Round 9: fetch the PREVIOUS month's contest too — the server
     already records each period's winner (contest_winners), and
     renderMonth turns it into the "Last month" winner strip.
     Best-effort only: a failed fetch leaves LAST_MONTH empty and
     the strip simply never renders — no placeholder, no fake
     winner. The fetch completes BEFORE applyDefaultView/renderAll,
     so the round-8 order (view decision, then first render) is
     unchanged. */
  LAST_MONTH = { period: "", entries: [], winnerId: null };
  const prevPeriod = prevPeriodOf(CONTEST.period);
  if (prevPeriod) {
    try {
      const pc = await api(`/api/contest?period=${prevPeriod}&voterToken=${voterToken}`);
      if (pc && pc.period === prevPeriod) LAST_MONTH = pc;
    } catch (e) { /* strip stays hidden */ }
  }
  applyDefaultView();
  renderAll();
  /* Round 86 (2026-11-09, Emil): an in-site "All Hypes / Watch
     Highlights" tap from a sub-page flagged its intent before
     navigating — land on the board, once. A fresh /?view=all visit
     carries no flag and opens at the top (Round 82 stands). */
  try {
    if (sessionStorage.getItem("hhGotoBoard86")) {
      sessionStorage.removeItem("hhGotoBoard86");
      document.getElementById("plays")?.scrollIntoView();
    }
  } catch (err) {}
  /* Round 162: the Moment That Mattered pick rides its own
     tiny endpoint, fetched AFTER the first render (best-effort,
     like the last-month strip): a failure leaves SPOTLIGHT162
     null and the card simply never renders — no placeholder,
     no broken promise on the homepage. On success the card is
     painted straight away (renderAll already ran). */
  try {
    const s162 = await api("/api/spotlight");
    SPOTLIGHT162 = s162 && s162.spotlight ? s162.spotlight : null;
  } catch (e) { SPOTLIGHT162 = null; }
  if (typeof renderSpotlight162 === "function") { try { renderSpotlight162(); } catch (e) { /* the card is decoration — a render hiccup never breaks the board load */ } }
}
/* Round 162: the current Moment That Mattered payload (a
   publicHighlight, with its story ALREADY consent-gated by the
   server — absent consent means an empty story here, so this
   renderer can quote h.story blindly and never leak one). */
let SPOTLIGHT162 = null;
function renderSpotlight162() {
  let host = null;
  try { host = $("#momentCard162"); } catch (e) { return; }
  if (!host) return;
  const h = SPOTLIGHT162;
  if (!h) { host.hidden = true; host.innerHTML = ""; return; }
  const name = (typeof fullName153 === "function" ? fullName153(h) : "") || h.player_name || h.athlete_label || "";
  host.innerHTML = `<article class="moment-card162">
    <p class="moment-eyebrow162">💛 MOMENT THAT MATTERED</p>
    <div class="tile-media dur-host moment-media162">${fameThumbHtml(h, { rest133: true })}<span class="tile-tap" aria-hidden="true" onclick="event.stopPropagation();openPlayDetail(${h.id})"></span></div>
    <div class="moment-body162">
      <h3 class="moment-name162">${esc(name)}</h3>
      <p class="moment-title162">${esc(shortTitle(h.title))}</p>
      ${typeof momentChip162 === "function" ? momentChip162(h) : ""}
      ${h.story ? `<p class="moment-story162">&ldquo;${esc(h.story)}&rdquo;</p>` : ""}
    </div>
  </article>`;
  host.hidden = false;
}
/* The period ("YYYY-MM") right before the given one. */
function prevPeriodOf(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period || "");
  if (!m) return "";
  let y = Number(m[1]), mo = Number(m[2]) - 1;
  if (mo === 0) { mo = 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, "0")}`;
}
function applyDefaultView() {
  if (!defaultViewPending) return;
  defaultViewPending = false;
  if (bootHashTarget) return;
  switchView((CONTEST.entries || []).length ? "month" : "all");
}

/* ---------------- media + cards ---------------- */
function mediaHtml(h, opts = {}) {
  /* Round 123: every video this renders carries the Round 118
     poster pattern from FIRST paint (banked action frame when one
     exists, else the branded placeholder; the attribute set is
     computed by posterAttr123 in the Round 123 block, reached
     through a typeof guard so sandbox slices without it render
     exactly as before).
     Round 192: uploaded-file videos load the streaming
     rendition when the play has one (playSrc192 in the Round
     192 block, typeof-guarded the same way) — the master stays
     canonical for downloads and the Hype Frame studio, never
     for in-page playback. And opts.rest192 (board cards pass
     it) drops preload="auto" + autoplay for preload="metadata":
     at rest the card paints its poster and fetches only the
     clip's metadata, so a homepage of cards no longer pulls
     megabytes of video before anyone taps. The watch/detail
     form (no opts) keeps preload="auto" + autoplay — opening
     a play IS the intent to watch it. */
  const poster123 = (typeof posterAttr123 === "function") ? posterAttr123(h) : "";
  const rest192 = !!(opts && opts.rest192);
  const vidAttrs192 = rest192 ? `controls playsinline muted loop preload="metadata"` : `controls playsinline muted loop preload="auto" autoplay`;
  if (h.media_kind === "file") {
    if ((h.mime || "").startsWith("image/")) return `<img src="${esc(h.media_url)}" alt="">`;
    const src192 = (typeof playSrc192 === "function") ? playSrc192(h) : h.media_url;
    return `<video src="${esc(src192)}"${poster123} ${vidAttrs192}></video>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${esc(h.embed_url)}" allowfullscreen title="Embedded play"></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${esc(h.media_url)}"${poster123} ${vidAttrs192}></video>`;
  return `<a class="watch-link" href="${esc(h.media_url)}" target="_blank" rel="noopener">▶ Watch on ${esc(h.host_label || "link")} ↗</a>`;
}
function athleteLine(h) {
  if (!h.player_name && !h.athlete_label) return "";
  const label = h.athlete_label || h.player_name;
  const parts = [label];
  if (h.jersey) parts.push("#" + h.jersey);
  if (h.team) parts.push(h.team);
  const tag = h.athlete_tag ? ` <span class="tagchip">${esc(h.athlete_tag)}</span>` : "";
  if (h.athlete_id) return `<p class="meta">Athlete: <button type="button" class="athlete-link" onclick="openAthlete('${esc(h.athlete_id)}')">${esc(parts.join(" · "))}</button>${tag}</p>`;
  return `<p class="meta">Athlete: ${esc(parts.join(" · "))}${tag}</p>`;
}
/* Round 100 (2026-11-11): play badges — the server computes the
   keys (badgesFor in server.js; samples always []), the client only
   labels them. Gold chips, one row, on tiles and full cards alike.
   Call sites use a typeof guard because test sandboxes slice app.js
   by function-name anchors and a slice may not include this helper. */
const BADGE_LABELS100 = { first_hype: "First Hype", battle_tested: "Battle Tested", best_celebration: "Best Celebration" };
function badgesHtml100(h) {
  if (!h || h.isSample || !Array.isArray(h.badges) || !h.badges.length) return "";
  return `<p class="play-badges">${h.badges.map((b) => `<span class="badge-chip">${BADGE_LABELS100[b] || esc(b)}</span>`).join("")}</p>`;
}
/* Round 162 (2026-11-14): milestone tags — the label copy of
   the server's MOMENT_LABELS162 (server.js single-sources the
   kinds; the client labels for rendering, same split as the
   Round 100 badges). The chip rides the badge-row area on
   cards (never the meta line); untagged plays render NOTHING —
   the row simply doesn't exist, exactly like an unbadged play.
   MOMENT_HEART162 = the Firsts & Milestones lane's kinds:
   big_play is tagged and chipped, but it plays on the main
   board, not in the lane. */
const MOMENT_LABELS162 = { first: "🌟 First Ever", personal_best: "📈 Personal Best", comeback: "💪 Comeback", big_play: "🔥 Big Play", effort: "❤️ Great Effort" };
const MOMENT_HEART162 = ["first", "personal_best", "comeback", "effort"];
function momentChip162(h) {
  if (!h || !h.moment_kind || !MOMENT_LABELS162[h.moment_kind]) return "";
  return `<p class="play-badges moment-row162"><span class="moment-chip162">${MOMENT_LABELS162[h.moment_kind]}</span></p>`;
}
function momentChipInline162(h) {
  if (!h || !h.moment_kind || !MOMENT_LABELS162[h.moment_kind]) return "";
  return `<span class="moment-chip162">${MOMENT_LABELS162[h.moment_kind]}</span>`;
}
/* Round 105 (2026-11-11): winner crowns — the server PERSISTS the
   records (play_crowns; samples included, they never expire), the
   client only renders them. Compact form (tiles, battle minis):
   the LATEST crown plus a "+N more" chip. Full form (cards — the
   athlete page and the play detail): every crown the play holds. */
/* Round 227 (2026-11-27): the crown asset on the text line. The
   👑 emoji is retired from every user-facing render path (site
   audit — consistency with the feed rail, which has worn the
   brand's gold crown since Round 191); this inline <img> is the
   one replacement everywhere (chips, badges, vote buttons, battle
   states), styled by .crown-ic227 to sit on the text line. Plain-
   text contexts (share strings) keep the emoji — an <img> cannot
   ride in shared text. */
const CROWN227 = `<img class="crown-ic227" src="/crown.png" alt="crown">`;
function crownsHtml105(h, full) {
  if (!h || !Array.isArray(h.crowns) || !h.crowns.length) return "";
  if (full) return `<p class="play-crowns">${h.crowns.map((c) => `<span class="crown-chip">${CROWN227} ${esc(c.title)}</span>`).join("")}</p>`;
  const more = h.crowns.length > 1 ? `<span class="crown-chip crown-more">+${h.crowns.length - 1} more</span>` : "";
  return `<p class="play-crowns"><span class="crown-chip">${CROWN227} ${esc(h.crowns[0].title)}</span>${more}</p>`;
}
function crownSuffix105(h) { return h && Array.isArray(h.crowns) && h.crowns.length ? ` · ${CROWN227} ${h.crowns[0].title}` : ""; }
/* Round 105: the My Highlights numbers line (Feature 3) — votes
   this month, views, Daily Battle wins, straight from the payload.
   Truthful zeros render like any other number. */
function numbersHtml105(h) {
  if (!h) return "";
  const vm = h.votesMonth || 0, vw = h.views || 0, bw = h.battleWins || 0;
  return `<p class="play-numbers105"><span><b>${vm}</b> vote${vm === 1 ? "" : "s"} this month</span><span><b>${vw}</b> view${vw === 1 ? "" : "s"}</span><span><b>${bw}</b> battle win${bw === 1 ? "" : "s"}</span></p>`;
}
function cardHtml(h, opts = {}) {
  const votes = opts.monthVotes != null ? opts.monthVotes : h.voteCount;
  const voteLabel = opts.monthVotes != null ? "this month" : "all-time";
  return `<article class="card" data-play-id="${h.id}">
    <div class="thumb">${mediaHtml(h, { rest192: true })}${h.isWinner ? `<span class="badge" style="background:#fff;color:#0a0a0a">🏆 Hype of the Month winner</span>` : ""}${opts.rank && !h.isSample ? `<span class="ranktag">#${opts.rank}</span>` : ""}</div>
    <div class="card-body">
      <h3>${esc(h.title)}</h3>
      <p class="meta"><b>${esc(cap(h.sport))}</b>${h.play_type ? ` · ${esc(h.play_type)}` : ""} · ${h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed"}</p>
      ${h.isSample ? `<p class="sample-line"><span class="sample-badge">⭐ SAMPLE PLAY</span></p><p class="meta sample-note">Sample play — posted by HighlightHype to show how it works.</p>` : ""}
      ${athleteLine(h)}
      ${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}
      ${typeof momentChip162 === "function" ? momentChip162(h) : ""}
      ${typeof crownsHtml105 === "function" ? crownsHtml105(h, true) : ""}
      ${opts.numbers && typeof numbersHtml105 === "function" ? numbersHtml105(h) : ""}
      ${h.story ? `<p class="meta">${esc(h.story)}</p>` : ""}
      ${opts.prizeEligible === false ? `<p><span class="tagchip warn">Can't be featured — no parent/guardian contact on file</span></p>` : ""}
      <div class="votes">
        ${h.isSample ? `<span class="tile-demo-tag" title="Sample play — a demo, not in the contest">Demo</span>` : `<button type="button" class="votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id}, this)">${h.hasVoted ? "You voted — tap to remove" : "Vote"}</button>`}
        <span class="votecount"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>
      </div>
      <div class="card-actions">
        ${h.isSample ? "" : `<button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>`}
        ${enterControl182(h, enteredNow179(h.id) ? ENTERED_BTN179 : "")}
        <button type="button" class="mini-btn" onclick="sharePlay(${h.id}, this)">🔗 Share</button>
        ${playHasVideo(h) ? `<button type="button" class="mini-btn" onclick="saveClip(${h.id}, this)">⬇ Save clip</button>` : ""}
        <button type="button" class="mini-btn" onclick="reportPlay(${h.id})">🚩 Report</button>
        ${ownerToken() && opts.inContest ? `<button type="button" class="mini-btn" onclick="markWinner(${h.id})">Mark winner (owner)</button>` : ""}
      </div>
      <div class="card-msg" data-enter-msg${ENTER_MSGS.has(h.id) ? "" : " hidden"}>${ENTER_MSGS.get(h.id) || ""}</div>
      <div class="card-msg" data-report-msg${REPORT_MSGS.has(h.id) ? "" : " hidden"}>${REPORT_MSGS.get(h.id) || ""}</div>
    </div>
  </article>`;
}
/* Compact board tiles (Round 8, 2026-11-05): the two board lists
   (Hype of the Month + All Hypes) render THESE instead of full
   cards — six stacked cards were six phone screens of scrolling.
   A tile is thumbnail-first, Store-product-card style: the play's
   media via the Hall of Fame's fameThumbHtml (file/link videos play
   in place, muted + loop, preload="metadata"; images show; embeds
   and watch-links get the sport-name face), then title, sport ·
   division, the athlete's name, the SAMPLE badge, the vote count
   and a compact Vote button wired to the same toggleVote (guard,
   retry and voted state included — its click is stopped so it can
   never also open the detail). Tapping anywhere else on the tile
   opens the play's FULL card (cardHtml, every action) in the play
   detail overlay — see openPlayDetail. Athlete pages keep the full
   cards; only the two board lists tile. */
/* Round 9 tap layer: on Nicholas's phone (an in-app browser) the
   playing <video> surface swallowed taps on the media area, so
   tiles "did nothing". A transparent .tile-tap span now sits over
   the media (above the video, below the winner badge / rank chip;
   the Vote button lives in .tile-body and is untouched) and opens
   the same detail. The tile's own click/keyboard handlers stay. */
/* Round 14 (2026-11-06): YouTube-style tile furniture, from the
   owner's look-and-feel comparison against YouTube.
   (1) DURATION PILL: a small black pill at the thumbnail's
   bottom-right ("0:08") — the corner YouTube trains eyes to check.
   The API returns NO duration, and no tile text ever carried one,
   so the value comes from the tile's own <video> element metadata
   (fameThumbHtml already renders that video with
   preload="metadata"): the pill renders empty + hidden,
   hydrateDurPills fills it when loadedmetadata lands, and a
   per-media_url cache (TILE_DURATIONS) lets re-renders — every
   vote refresh rebuilds the boards — paint it instantly with no
   flicker. Image / embed / watch-link plays have no client-side
   duration and get no pill. The pill is visual only
   (pointer-events:none) and sits in the one media corner nothing
   else uses: the winner badge owns top-left, the rank tag
   top-right, and the SAMPLE badge lives in the tile body below.
   (2) INFO LINE: "<first name> · <N> votes · <age>" in the tile's
   grey secondary style, under the Sport · Division line. It
   replaces the old name-only line (the athlete's first name rides
   here now, YouTube-metadata style) and uses ONLY fields the API
   already returns — athlete label / player name, the same vote
   count the tile's vote row shows, and created_at. The site does
   not track views, so no view count is shown or invented. */
const TILE_DURATIONS = new Map(); // media_url -> seconds (video metadata)
function fmtDur(t) { t = Math.max(0, Math.floor(Number(t) || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
function playHasVideo(h) { return h.media_kind === "link_video" || (h.media_kind === "file" && !(h.mime || "").startsWith("image/")); }
function durPillHtml(h) {
  if (!playHasVideo(h)) return "";
  /* Round 192: fillDurPill caches under the <video>'s actual
     src, which for an uploaded play is now the streaming
     rendition — check the rendition key as well as the
     master's, so a re-render still paints the pill instantly. */
  const secs = TILE_DURATIONS.get(h.media_url) ?? (h.stream_url ? TILE_DURATIONS.get(h.stream_url) : undefined);
  if (secs != null) return `<span class="dur-pill" aria-hidden="true">${fmtDur(secs)}</span>`;
  return `<span class="dur-pill" aria-hidden="true" hidden></span>`;
}
function fillDurPill(host) {
  const pill = host.querySelector(".dur-pill");
  const video = host.querySelector("video");
  if (!pill || !video || !(video.duration > 0)) return;
  const src = video.getAttribute("src");
  if (src) TILE_DURATIONS.set(src, video.duration);
  pill.textContent = fmtDur(video.duration);
  pill.hidden = false;
}
/* Wire every rendered .dur-host (tile media + Up-next thumbs) to
   fill its pill from its own video's metadata. Idempotent: filling
   an already-filled pill writes the same text, and re-renders
   build fresh elements that this pass wires again. Called at the
   end of the board renders and the detail render. */
/* Round 107 (2026-11-12): vertical-clip treatment for the feed.
   A portrait clip in a 16:9 thumb used to be cropped to a sliver
   by object-fit:cover. When a thumb's own metadata says portrait,
   the host is marked .is-vertical and a blurred clone of the same
   clip is parked behind it as the fill — CSS centers the real
   clip, full height, over the blur (the approved mock's
   treatment). The fill is decorative: muted, paused, aria-hidden,
   and it never takes taps (the tap layer rides above it). */
function markVertical107(host) {
  const video = host.querySelector("video");
  if (!video) return;
  if (!(video.videoWidth > 0) || !(video.videoHeight > video.videoWidth)) return;
  if (!host.classList || host.classList.contains("is-vertical")) return;
  host.classList.add("is-vertical");
  try {
    const fill = video.cloneNode();
    fill.classList.add("vfill");
    fill.removeAttribute("autoplay");
    fill.removeAttribute("controls");
    fill.setAttribute("aria-hidden", "true");
    fill.setAttribute("tabindex", "-1");
    fill.muted = true;
    host.insertBefore(fill, video);
    if (typeof fill.pause === "function") fill.pause();
  } catch (e) { /* the mark alone still centers the clip via CSS */ }
}
/* Round 134 (2026-11-13): the Month FEATURED preview's portrait
   treatment. Same geometry as markVertical107 — the host is
   marked .is-vertical so the settled CSS centers the sharp clip
   at full frame height — but the blurred fill behind it is a
   copy of the play's POSTER IMAGE (an <img>, styled by the
   .pfill134 rule), never a second <video>: the Month preview
   rests on its poster (Round 133) and a video clone would be a
   playing surface in waiting. No poster on file (the degraded
   path) still gets the mark — the clip centers over black.
   The poster is read from the element's own poster attribute,
   which posterAttr123 resolved per play (server poster first,
   then the URL-keyed banked frame) — the fill is always the
   play's OWN frame (§43's pairing invariant). */
function markPosterFill134(host) {
  const video = host.querySelector("video:not(.vfill)");
  if (!video) return;
  if (!(video.videoWidth > 0) || !(video.videoHeight > video.videoWidth)) return;
  if (!host.classList || host.classList.contains("is-vertical")) return;
  host.classList.add("is-vertical");
  let poster = "";
  try { poster = video.getAttribute("poster") || ""; } catch (e) { poster = ""; }
  if (!poster) return;
  try {
    const fill = document.createElement("img");
    fill.className = "pfill134";
    fill.src = poster;
    fill.alt = "";
    fill.setAttribute("aria-hidden", "true");
    host.insertBefore(fill, video);
  } catch (e) { /* the mark alone still centers the clip via CSS */ }
}
/* Round 142 (2026-11-13): the FEATURED stage fits the clip.
   The fixed 16:9 stage left a portrait #1 (Charlotte's kata
   reel) as a ~⅓-width sliver between wide blurred sides. When
   the featured clip is PORTRAIT, its host gains .feat-tall142
   and the styles.css rule gives the stage a ~4:5 aspect (with
   a desktop height cap) — the sharp clip, already centered at
   full stage height by the .is-vertical rule, renders roughly
   twice as wide, contain-fit as always: nothing is cropped,
   her full movement stays in frame. Landscape stays 16:9
   exactly as before.
   Orientation signal, in order: (1) the poster image's
   natural dimensions — the public payload carries no stored
   media dimensions, and the server poster IS the clip's own
   frame, so its shape is the clip's shape; (2) the video's
   own metadata, the same signal markPosterFill134 trusts.
   Neither known → no mark → today's 16:9 stage (the fallback
   is the pre-142 card, never a broken one). */
function markFeatStage142(host) {
  if (!host.classList || typeof host.classList.contains !== "function") return;
  if (!host.classList.contains("feat-media134")) return;
  if (host.classList.contains("feat-tall142")) return;
  const video = host.querySelector("video:not(.vfill)");
  if (!video) return;
  if (video.videoWidth > 0 && video.videoHeight > video.videoWidth) { host.classList.add("feat-tall142"); return; }
  let poster = "";
  try { poster = video.getAttribute("poster") || ""; } catch (e) { poster = ""; }
  if (!poster) return;
  try {
    const img = new Image();
    img.onload = () => { if (img.naturalHeight > img.naturalWidth) host.classList.add("feat-tall142"); };
    img.src = poster;
  } catch (e) { /* no Image in this context — the 16:9 stage stays */ }
}
function hydrateDurPills() {
  $$(".dur-host").forEach((host) => {
    const video = host.querySelector("video");
    if (!video) return;
    /* Round 133 (2026-11-13): a Month host is never marked
       vertical THE PREVIEW WAY and never gains a .vfill clone —
       the fill is preview dressing for a playing clip, and Month
       tiles rest on their poster (see renderMonth). The duration
       pill and the frame bank wire exactly as before on every
       host; Watch, Battles, detail and athlete hosts mark
       exactly as before. The closest() probe is guarded the
       same way the Round 113 wiring guards it — sandbox hosts
       without it simply mark as they always did.
       Round 134 (2026-11-13): the Month view's only media host
       is now the FEATURED preview, and it DOES take a fill —
       markPosterFill134, the poster-IMAGE fill (an <img>, not
       a video clone). The Round 133 invariant stands untouched:
       no Month video ever autoplays, drifts, or gains a .vfill
       clone; the fill is a still of the play's own poster. */
    let monthHost133 = false;
    try { monthHost133 = typeof host.closest === "function" && !!host.closest("#viewMonth"); } catch (e) { monthHost133 = false; }
    if (video.readyState >= 1) { fillDurPill(host); if (monthHost133) markPosterFill134(host); else markVertical107(host); markFeatStage142(host); }
    video.addEventListener("loadedmetadata", () => { fillDurPill(host); if (monthHost133) markPosterFill134(host); else markVertical107(host); markFeatStage142(host); }, { once: true });
    /* Round 123: board media feeds the frame bank too — a tile
       playing past its freeze point banks the frame that every
       other surface's poster then upgrades from (the bank used
       to fill only from Battles and the watch view, so a play
       browsed board-only kept the placeholder forever). */
    if (typeof bankSurfaceFrame123 === "function") {
      try { bankSurfaceFrame123(host.querySelector("video:not(.vfill)") || video); } catch (e) { /* banking is a bonus */ }
    }
  });
}
/* Round 151 (2026-11-13): watch counts on the videos. The
   count is the payload's viewCount — the play_open events
   POST /api/track already records every time a play opens (the
   same counter behind the owner stats' "Most opened plays").
   Nothing new is counted; the number is simply shown where the
   videos live. One formatter everywhere: exact under 1,000,
   compact above (1.2k). */
function fmtCount151(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  if (v < 1000) return String(v);
  const k = Math.round(v / 100) / 10;
  return (Number.isInteger(k) ? String(k) : k.toFixed(1)) + "k";
}
function watchesText151(v) { return `${fmtCount151(v)} watch${Number(v) === 1 ? "" : "es"}`; }
/* The quiet poster chip for board tiles + the featured card:
   bottom-right, the corner opposite the duration pill's board
   spot. Shown only once a play has actually been watched — a
   wall of zeroes on brand-new plays helps nobody. */
function viewsChip151(h) {
  const v = Number(h && h.viewCount) || 0;
  if (v < 1) return "";
  return `<span class="views-chip151" aria-label="${v} view${v === 1 ? "" : "s"}">▶ ${fmtCount151(v)}</span>`;
}
function firstNameOf(h) { const label = h.athlete_label || h.player_name || ""; return label.trim().split(/\s+/)[0] || ""; }
/* created_at arrives as SQLite UTC text ("2026-11-05 21:59:00") or
   ISO; normalize the space form to explicit UTC before parsing, so
   ages never shift with the viewer's timezone. */
function parsePlayDate(s) { if (!s) return NaN; let t = String(s).trim().replace(" ", "T"); if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(t)) t += "Z"; return Date.parse(t); }
function humanAge(createdAt, now = Date.now()) {
  const then = parsePlayDate(createdAt);
  if (!Number.isFinite(then)) return "";
  const secs = Math.floor((now - then) / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 52) return `${weeks}w ago`;
  return `${Math.floor(weeks / 52)}y ago`;
}
function tileInfoHtml(h, votes, voteLabel) {
  /* Round 45 (2026-11-08): ONE muted line under the title.
     Round 153 (2026-11-14): the HYBRID line, from Emil's pick of
     the YouTube-mock exploration — "Full Name · Sport · ▶ views ·
     N votes" in the variant's single-line form. The name is the
     fullest the payload carries (player_name; athlete_label —
     the site's "First L." display name — is only the fallback);
     views are the Round 151 play_open count via fmtCount151;
     votes stay the count this card already showed (all-time, or
     the month count when threaded), now labeled plainly "votes".
     Division and time-ago leave the card (both still live on
     the play detail view). The line is a flex row: the NAME
     segment alone may ellipsis — the counts never truncate.
     voteLabel is accepted for signature compatibility and is no
     longer rendered here (the action row's sample chip still
     carries it). */
  const name = fullName153(h);
  const rest = `${esc(cap(h.sport))} · ▶ ${fmtCount151(h.viewCount)} · <b>${votes}</b> vote${votes === 1 ? "" : "s"}`;
  return `<p class="tile-meta tile-info tile-meta153">${name ? `<span class="meta-name153">${esc(name)}</span><span class="meta-rest153"> · ${rest}</span>` : `<span class="meta-rest153">${rest}</span>`}</p>`;
}
/* Round 153 (2026-11-14): the hybrid card's name + avatar
   helpers, adapted from the YouTube mock's tileHtmlYT (the
   variant Emil reviewed side by side with the live board).
   The avatar is an initials disc whose background hue is
   hashed from the name — no athlete photos exist in the
   data, so the disc is an identity mark, not a portrait. */
function fullName153(h) {
  return String((h && (h.player_name || h.athlete_label)) || "").trim();
}
function avatarInitials153(name) {
  const t = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!t.length) return "HH";
  return ((t[0][0] || "H") + (t.length > 1 ? (t[t.length - 1][0] || "") : "")).toUpperCase();
}
function avatarHue153(name) { let x = 0; for (const c of String(name || "")) x = (x * 31 + c.charCodeAt(0)) % 360; return x; }
function avatarDisc153(h) {
  const name = fullName153(h);
  return `<span class="tile-avatar153" style="--avh153:${avatarHue153(name)}" aria-hidden="true">${esc(avatarInitials153(name))}</span>`;
}
/* Round 107 (2026-11-12): the hybrid feed card. The tile is now a
   big single-column feed card in the approved redesign: 16:9 media
   (sample tag on the thumb, duration pill at bottom-left), title
   with the ⋮ affordance, the merged info line, badges + crowns,
   and a gold vote-count chip. Kept from the compact tile: the tap
   layer (Round 9), the play disc element (Round 45 — restyled off
   in the feed by Round 107 CSS), and the 📸 Frame chip (Round 32),
   so every existing entry point still works from the card.
   Round 108 (2026-11-12, Emil — "How do they vote now?"): voting
   RETURNS to the tile. Round 107 had moved it to the watch view
   only; the gold chip is a real vote button again for real plays
   ("👑 Vote · N" / "👑 Voted · N"), wired to the same toggleVote
   as the watch view (identical server semantics), its click
   stopped so it can never also open the watch view. Samples keep
   the display-only chip — no vote affordance, as ever.
   Round 153 (2026-11-14): the HYBRID card — Emil reviewed the
   YouTube-grammar mock against this card and picked the blend:
   the stage and poster identity stay exactly as they were, and
   the body takes the variant's three best parts — an avatar
   disc + FULL athlete name beside the title, ONE meta line
   whose counts cannot truncate, and the Vote button as a
   solid lime pill (the variant's form, no crown in its label —
   crowns still live in the badge/crown rows and the sample
   chip).
   Round 181 (2026-11-14): VARIANT A, Emil's pick of the card
   mocks — the badge / moment / crown rows and the votes row
   merge into ONE action row (.tile-actrow181): the chips
   cluster left (.tile-chips181, internal wrap allowed), the
   Vote + Frame buttons right at their current sizes. The
   stacked rows cost the card ~69px of dead space under every
   play; the row gives it back. Samples keep the display-only
   chip in the buttons' slot, as ever. */
function tileHtml(h, opts = {}) {
  const votes = opts.monthVotes != null ? opts.monthVotes : h.voteCount;
  const voteLabel = opts.monthVotes != null ? "this month" : "all-time";
  return `<article class="tile" data-tile-id="${h.id}" role="button" tabindex="0" aria-label="${esc(h.title)} — open the play" onclick="openPlay189(${h.id}, this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlay189(${h.id}, this)}">
    <div class="tile-media dur-host">${fameThumbHtml(h, Object.assign({}, opts, { gate233: true }))}<span class="tile-tap" aria-hidden="true" onclick="event.stopPropagation();openPlay189(${h.id}, this)"></span><span class="tile-disc" aria-hidden="true"><svg width="17" height="19" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span>${h.isSample ? `<span class="tile-sample-tag">⭐ SAMPLE PLAY</span>` : ""}${h.isWinner ? `<span class="badge" style="background:#fff;color:#0a0a0a">🏆 Hype of the Month winner</span>` : ""}${opts.rank && !h.isSample ? `<span class="ranktag">#${opts.rank}</span>` : ""}${durPillHtml(h)}${viewsChip151(h)}</div>
    <div class="tile-body">
      <div class="tile-head153">
        ${avatarDisc153(h)}
        <div class="tile-head-main153">
          <div class="tile-toprow">
            <h3 class="tile-title">${esc(h.title)}</h3>
            <span class="tile-dots" aria-hidden="true">⋮</span>
          </div>
          ${tileInfoHtml(h, votes, voteLabel)}
        </div>
      </div>
      <div class="tile-actrow181">
        <div class="tile-chips181">${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}${typeof momentChip162 === "function" ? momentChip162(h) : ""}${typeof crownsHtml105 === "function" ? crownsHtml105(h) : ""}</div>
        <div class="tile-votes">
          ${h.isSample ? `<span class="vote-chip">${CROWN227} <b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>` : `<button type="button" class="vote-chip vote-chip-btn vote-pill153${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)">${h.hasVoted ? "Voted" : "Vote"} · <b>${votes}</b></button>`}
          ${h.isSample ? "" : `<button type="button" class="mini-btn tile-hf-btn" onclick="event.stopPropagation();openHypeFrame(${h.id})" aria-label="Create a Hype Frame from this play">📸 Frame</button>`}
        </div>
      </div>
    </div>
  </article>`;
}
/* Vote hardening (Round 2, 2026-11-05): a network/fetch failure gets
   ONE automatic retry; a final failure is reported inline on the
   button in friendly words (never a raw alert); and the post-vote
   board refresh runs in its own try/catch so a refresh hiccup can
   never masquerade as a vote failure. Server errors (a real API
   refusal) are not retried — only transport failures are. */
const isNetworkFailure = (e) => !!e && (e.name === "TypeError" || /failed to fetch|network|load failed/i.test(e.message || ""));
window.toggleVote = async (id, btn) => {
  /* In-flight guard (Fixes batch, 2026-11-05): voting is a toggle, so
     on a slow connection an impatient second tap used to fire a
     PARALLEL request that toggled the vote straight back off — the
     user cancelled their own vote and thought voting was broken.
     While a request for this button is in flight, further clicks are
     ignored and the button shows a pending state so the tap visibly
     registered. The guard releases on EVERY exit path (finally),
     including the failure paths, where the label is first restored
     so showVoteFailure captures the real original. */
  if (btn && btn.dataset.voteBusy === "1") return;
  const original = btn ? btn.textContent : "";
  if (btn) {
    btn.dataset.voteBusy = "1";
    btn.disabled = true;
    btn.classList.add("vote-pending");
    btn.textContent = "Voting…";
  }
  const failVote = () => {
    if (btn) {
      btn.textContent = original;
      btn.disabled = false;
      btn.classList.remove("vote-pending");
    }
    showVoteFailure(btn);
  };
  const postVote = () => api(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken }) });
  try {
    try {
      await postVote();
    } catch (firstError) {
      if (!isNetworkFailure(firstError)) {
        failVote();
        return;
      }
      try {
        await postVote();
      } catch {
        failVote();
        return;
      }
    }
    try { await loadData(); } catch { /* the vote landed; a failed refresh is not a vote error */ }
  } finally {
    if (btn) {
      delete btn.dataset.voteBusy;
      btn.disabled = false;
      btn.classList.remove("vote-pending");
      // On success the re-render has already replaced this button (or
      // is about to); on failure showVoteFailure owns the label. Only
      // restore when the button still shows the pending label.
      if (!btn.classList.contains("vote-failed") && btn.textContent === "Voting…") btn.textContent = original;
    }
  }
};
function showVoteFailure(btn) {
  if (!btn) return;
  const original = btn.textContent;
  btn.textContent = "Didn't go through — tap to try again";
  btn.classList.add("vote-failed");
  setTimeout(() => {
    if (!btn.isConnected) return;
    btn.textContent = original;
    btn.classList.remove("vote-failed");
  }, 3600);
}
/* Enter-contest feedback (Fixes batch, 2026-11-05): the enter flow
   used native confirm()/alert(), which in-app browsers can block or
   auto-dismiss — the button read as completely dead (a tester tapped
   twice and saw nothing). All enter feedback is now INLINE on the
   card: a per-card message slot in cardHtml, fed from ENTER_MSGS so
   a board re-render can neither duplicate the slot nor drop a
   message mid-flow.
   Round 121 (2026-11-12): WHAT entering means changed. The one-tap
   button let any visitor enter anyone's play (the youth-agent test
   entered Charlotte's play as a total stranger). Entering is now
   the POSTING GUARDIAN's call: the button opens an inline confirm —
   "type the email you posted this play with" — and the server
   matches it against the play's guardian email on file (403 with a
   plain-words reason on mismatch). The owner enters directly (api()
   rides the owner token; the server accepts it as the override).
   Plays with NO guardian email on file don't render the button at
   all (cardHtml / watchHtml107 gate on hasGuardianEmail); if this
   flow is somehow reached for one, it explains instead of posting.
   The old "Enter anyway" door is closed — that was the hole. */
const ENTER_MSGS = new Map();
function setEnterMsg(id, html) {
  if (html) ENTER_MSGS.set(id, html); else ENTER_MSGS.delete(id);
  $$(`.card[data-play-id="${id}"] [data-enter-msg]`).forEach((slot) => {
    slot.innerHTML = html || "";
    slot.hidden = !html;
  });
}
/* Round 179: is this play entered in the CURRENT contest? The
   entries list is already on the client (it renders the Month
   board), so the Enter control can show an entered state instead
   of inviting entry again — the girl tester tapped Enter on an
   already-entered play and got an email prompt, never an
   "Entered ✓". The entered control is informational only: a
   disabled button, no handler, no prompt. */
function enteredNow179(id) { return (CONTEST.entries || []).some((p) => p.id === id); }
const ENTERED_BTN179 = `<button type="button" class="mini-btn" disabled>🏆 Entered ✓</button>`;
/* Round 182 (2026-11-14): the contest-integrity states. A play
   that has won a month is RETIRED — where the Enter control
   would sit, it shows its winner state instead (the same words
   as the Month board's winner badge, so the two surfaces agree).
   A play whose athlete won LAST month shows the champions
   sit-out state for this month. Both are disabled informational
   controls like Entered ✓ — no handler, no prompt — rendered
   from the server's payload flags (contestRetired /
   contestSitOut); the server enforces both rules at every entry
   path, so these are the honest face of a refusal that would
   otherwise read as a broken button. Precedence in
   enterControl182: retired first (a winner is a winner in every
   month, its entry month included), then Entered ✓, then
   sit-out, then the live Enter control with its Round 121
   guardian-email gate. */
const WINNER_BTN182 = `<button type="button" class="mini-btn" disabled>🏆 Hype of the Month winner</button>`;
const SITOUT_BTN182 = `<button type="button" class="mini-btn" disabled>🏆 Champions sit out this month after a win — back next month</button>`;
function enterControl182(h, enteredHtml) {
  if (!h || h.isSample) return "";
  if (h.contestRetired) return WINNER_BTN182;
  if (enteredHtml) return enteredHtml;
  if (h.contestSitOut) return SITOUT_BTN182;
  if (!h.hasGuardianEmail && !ownerToken()) return "";
  return `<button type="button" class="mini-btn" onclick="enterContest(${h.id}, this)">🏆 Enter this play</button>`;
}
window.enterContest = (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || CONTEST.entries.find((p) => p.id === id);
  // Sample plays (Round 7): the Enter button is hidden on their cards;
  // this guards the flow itself if it is ever triggered another way.
  // The server refuses samples too, with the same message.
  if (play && play.isSample) {
    setEnterMsg(id, `<p class="card-msg-text">Sample plays can't enter Hype of the Month.</p>`);
    return;
  }
  // Round 182: the integrity states guard the flow itself too
  // (a stale render could still carry a live button) — the same
  // words the server answers with, said in place.
  if (play && play.contestRetired) {
    setEnterMsg(id, `<p class="card-msg-text">This play already won Hype of the Month — winning plays retire to the Hall of Fame and can't enter again.</p>`);
    return;
  }
  if (play && play.contestSitOut) {
    setEnterMsg(id, `<p class="card-msg-text">Champions sit out this month after a win — back next month.</p>`);
    return;
  }
  // Owner override: no form — api() sends the owner token and the
  // server enters on it.
  if (typeof ownerToken === "function" && ownerToken()) return submitContestEntry(id);
  if (play && !play.hasGuardianEmail) {
    setEnterMsg(id, `<p class="card-msg-text">This play can't be entered online — no guardian email is on file for it. The owner can enter it for you.</p>`);
    return;
  }
  setEnterMsg(id, `<form class="enter-form" onsubmit="submitContestEntry(${id}, this); return false">
    <p class="card-msg-text">Parents/guardians: enter the email you posted this play with to enter it.</p>
    <input type="email" name="guardianEmail" required placeholder="Email used to post this play" autocomplete="email" aria-label="Email used to post this play">
    <div class="card-msg-btns">
      <button type="submit" class="mini-btn">🏆 Enter this play</button>
      <button type="button" class="mini-btn" onclick="enterContestDismiss(${id})">Not now</button>
    </div>
  </form>`);
};
window.enterContestDismiss = (id) => setEnterMsg(id, "");
async function submitContestEntry(id, formEl) {
  const email = formEl && formEl.guardianEmail ? String(formEl.guardianEmail.value || "").trim() : "";
  setEnterMsg(id, `<p class="card-msg-text">Entering…</p>`);
  try {
    const payload = { highlightId: id };
    if (email) payload.email = email;
    const r = await api("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    setEnterMsg(id, `<p class="card-msg-text ok">${esc(r.message)}</p>`);
    await loadData();
  } catch (e) {
    setEnterMsg(id, `<p class="card-msg-text err">${esc(e.message)}</p>`);
  }
  return false;
}
window.submitContestEntry = submitContestEntry;
/* Report feedback (Round 6, 2026-11-05): reporting used to run
   through the browser's built-in prompt and alert dialogs, which
   in-app browsers can swallow entirely — the button read as
   completely dead (youth rerun v3). It now mirrors the enter-contest
   pattern above: an inline panel in a per-card slot fed from
   REPORT_MSGS, so a board re-render can neither duplicate the panel
   nor drop it mid-flow. The API contract is unchanged — POST
   /api/highlights/:id/report with { reason }, an empty reason still
   landing as "Reported by a user" (now client-side, matching the
   server's own default). Cancel closes the panel and sends nothing. */
const REPORT_MSGS = new Map();
function setReportMsg(id, html) {
  if (html) REPORT_MSGS.set(id, html); else REPORT_MSGS.delete(id);
  $$(`.card[data-play-id="${id}"] [data-report-msg]`).forEach((slot) => {
    slot.innerHTML = html || "";
    slot.hidden = !html;
  });
}
window.reportPlay = (id) => {
  setReportMsg(id, `<p class="card-msg-text">Report this play? The owner reviews every report.</p>
    <label class="report-reason">Reason (optional)
      <textarea data-report-reason rows="2" maxlength="500" placeholder="What's wrong with this play?"></textarea>
    </label>
    <div class="card-msg-btns">
      <button type="button" class="mini-btn" onclick="sendReport(${id}, this)">Send report</button>
      <button type="button" class="mini-btn" onclick="cancelReport(${id})">Cancel</button>
    </div>`);
};
window.cancelReport = (id) => setReportMsg(id, "");
window.sendReport = async (id, btn) => {
  const card = btn ? btn.closest(`.card[data-play-id="${id}"]`) : null;
  const ta = card ? card.querySelector("[data-report-reason]") : null;
  const reason = (ta && ta.value.trim()) || "Reported by a user";
  setReportMsg(id, `<p class="card-msg-text">Sending…</p>`);
  try {
    const r = await api(`/api/highlights/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
    setReportMsg(id, `<p class="card-msg-text ok">${esc(r.message)}</p>`);
  } catch (e) {
    setReportMsg(id, `<p class="card-msg-text err">${esc(e.message)}</p>`);
  }
};
window.markWinner = async (id) => { try { const r = await api("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); if (r.warning) alert(r.warning); await loadData(); } catch (e) { alert(e.message); } };
/* Round 34 (2026-11-07, Emil): grab-the-video sharing. Save clip
   downloads the play's video file outright. Share now prefers handing
   the phone's share sheet the VIDEO FILE itself — that's what posts
   natively to TikTok / Reels / Instagram — and falls back to the
   link flow when file sharing isn't offered. Link-embed plays have
   no file: Save hides for them and Share stays link-only. */
function findPlay(id) { return ALL_PLAYS.find((p) => p.id === id) || (CONTEST.entries || []).find((p) => p.id === id); }
function clipFileName(h) {
  const slug = String(h.title || "play").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "play";
  return `highlighthype-${slug}.mp4`;
}
async function fetchClipFile(h) {
  const r = await fetch(h.media_url);
  if (!r.ok) throw new Error("clip fetch failed");
  const blob = await r.blob();
  return new File([blob], clipFileName(h), { type: blob.type || h.mime || "video/mp4" });
}
window.saveClip = async (id, btn) => {
  const h = findPlay(id);
  if (!h || !playHasVideo(h)) return;
  const original = btn ? btn.innerHTML : "";
  if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
  try {
    const file = await fetchClipFile(h);
    const objUrl = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = objUrl; a.download = file.name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(objUrl), 4000);
    if (btn) btn.textContent = "Saved ✓";
  } catch {
    window.open(h.media_url, "_blank");
    if (btn) btn.textContent = "Opened — save from there";
  }
  if (btn) setTimeout(() => { btn.disabled = false; btn.innerHTML = original; }, 2000);
};
window.sharePlay = async (id, btn) => {
  const url = `${location.origin}${location.pathname}#play-${id}`;
  // Round 34: the video file first, where the device accepts files.
  const h = findPlay(id);
  if (h && playHasVideo(h) && navigator.canShare) {
    try {
      const file = await fetchClipFile(h);
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "HighlightHype" });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
  }
  // Native share sheet where the device offers one (2026-11-04); the
  // clipboard/prompt flow stays as the fallback.
  if (navigator.share) {
    try { await navigator.share({ title: "HighlightHype", url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    // Visible confirmation ON the clicked button (hardening follow-up,
    // 2026-11-04): on desktop there is no share sheet, and an alert()
    // alone proved easy to miss/auto-dismiss — the label flip cannot
    // be missed and needs no dismissal. Restores itself in ~2s.
    if (btn) {
      const original = btn.innerHTML;
      btn.textContent = "Link copied ✓";
      btn.classList.add("share-copied");
      setTimeout(() => { btn.innerHTML = original; btn.classList.remove("share-copied"); }, 2000);
    } else {
      alert("Link copied! Share it anywhere.");
    }
  }
  catch { prompt("Copy this play link:", url); }
};
/* Round 172 (2026-11-14): share the ATHLETE PAGE — the second
   parent surface that had no Share (My Plays rows, above, ride
   sharePlay). The same fallback chain — native share sheet,
   else clipboard with the "Link copied ✓" flip on the clicked
   button, else a prompt — but the payload is the collection
   URL (#athlete-<id>) with the athlete's name in the
   title/text; there is no clip file to offer for a page. The
   header button's data-athlete-id is (re)stamped by
   openAthlete on every render, so it always names the athlete
   on screen. */
window.shareAthlete = async (athleteId, btn) => {
  if (!athleteId) return;
  const url = `${location.origin}${location.pathname}#athlete-${athleteId}`;
  const name = ($("#athleteName")?.textContent || "").trim() || "This athlete";
  if (navigator.share) {
    try { await navigator.share({ title: `${name} · HighlightHype`, text: `Watch ${name}'s highlights on HighlightHype`, url }); return; }
    catch (e) { if (e && e.name === "AbortError") return; }
  }
  try {
    await navigator.clipboard.writeText(url);
    if (btn) {
      const original = btn.innerHTML;
      btn.textContent = "Link copied ✓";
      btn.classList.add("share-copied");
      setTimeout(() => { btn.innerHTML = original; btn.classList.remove("share-copied"); }, 2000);
    } else {
      alert("Link copied! Share it anywhere.");
    }
  }
  catch { prompt("Copy this athlete page link:", url); }
};

/* ---------------- medals (podium) ---------------- */
function medalSvg(rank) {
  const conf = { 1: ["rib-g", "disc-g", "#fff3b0", "#f5d76e", "#e3b93e", "#a87c14", "#8a650f", "rgba(90,60,0,.45)", "rgba(90,60,0,.38)"], 2: ["rib-s", "disc-s", "#ffffff", "#e8ebef", "#ccd0d6", "#8f97a1", "#6d747d", "rgba(40,45,52,.45)", "rgba(40,45,52,.36)"], 3: ["rib-b", "disc-b", "#ffd9b0", "#eda96a", "#c97e3f", "#8a5225", "#71431f", "rgba(70,38,10,.45)", "rgba(70,38,10,.38)"] }[rank];
  if (!conf) return "";
  const [rib, disc, s0, s1, s2, s3, ring, stroke, star] = conf;
  return `<span class="medal"><svg width="32" height="42" viewBox="0 0 40 52" aria-hidden="true" focusable="false"><defs><linearGradient id="${rib}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9ff4d"/><stop offset="1" stop-color="#9ec400"/></linearGradient><radialGradient id="${disc}" cx="0.35" cy="0.3" r="0.95"><stop offset="0" stop-color="${s0}"/><stop offset="0.45" stop-color="${s1}"/><stop offset="0.8" stop-color="${s2}"/><stop offset="1" stop-color="${s3}"/></radialGradient></defs><path d="M12 0h6.5L20 19h-5.2z" fill="url(#${rib})"/><path d="M28 0h-6.5L20 19h5.2z" fill="url(#${rib})" opacity="0.82"/><rect x="16.8" y="15" width="6.4" height="6" rx="2.4" fill="${ring}"/><circle cx="20" cy="36" r="15" fill="url(#${disc})"/><circle cx="20" cy="36" r="15" fill="none" stroke="${stroke}" stroke-width="1"/><circle cx="20" cy="36" r="11" fill="none" stroke="${stroke}" stroke-width="1.4"/><path d="M20 29.6l1.9 4.1 4.5.5-3.3 3 .9 4.4-4-2.3-4 2.3.9-4.4-3.3-3 4.5-.5z" fill="${star}"/><ellipse cx="14.5" cy="29" rx="5.5" ry="3.6" fill="#ffffff" opacity="0.35" transform="rotate(-24 14.5 29)"/></svg></span>`;
}

/* ---------------- views ---------------- */
function divMatch(h, div) {
  if (div === "all") return true;
  const d = h.division || "coed";
  return d === div || d === "coed"; // older coed plays show on both boards
}
/* Round 134 (2026-11-13, Emil): SHORT TITLES for the contest
   surfaces — the featured card, the Month leaderboard rows and
   the Hall of Fame rows show a play's FIRST SENTENCE only: the
   title up to the first sentence-ending punctuation (. ! ?)
   that is followed by more text (the punctuation itself drops
   with the cut). No such point — single-sentence titles — keeps
   the whole title (a trailing "!" or "?" is part of the title's
   energy and stays; a lone trailing "." is trimmed). Display
   only: the stored title is never modified, and the play view
   keeps the FULL title.
   "Gold and silver in both Kata and Kumite. These are the
    highlights" → "Gold and silver in both Kata and Kumite"
   "Caught stealing home!" → "Caught stealing home!" */
function shortTitle(title) {
  const t = String(title || "").trim();
  const m = t.match(/[.!?]/);
  if (m && t.slice(m.index + 1).trim()) return t.slice(0, m.index).trim();
  return t.replace(/\.$/, "").trim();
}
/* Round 134: the FEATURED card — Emil's mockup, one card for
   the current #1 entry. The preview is the play's own media
   via fameThumbHtml with the Round 133 rest opt (poster-rest,
   no autoplay); portrait clips take the poster-image fill via
   hydrateDurPills' Month branch. The tap layer opens the play
   exactly like a board tile's. The vote button is the tile
   vote action (toggleVote) in the mockup's full-width gold
   form — label left-of-center, the live count at the right
   end; the voted state re-renders from hasVoted after every
   refresh, like the tile chip.
   Round 142 (2026-11-13): the body tightens to Emil's
   endorsed order — media → the athlete · SHORT title line →
   the full-width gold vote button DIRECTLY beneath it, so
   the button reads as part of the clip block. The Sport ·
   Division sub-line leaves the featured card (the leaderboard
   rows, the Fame rows and the play view keep theirs), and the
   stage itself adapts to the clip — see markFeatStage142.
   →163 (2026-11-14): the media itself is now a living muted
   showcase (see the Round 163 block below) — the tap layer
   calls featTap163 (sound on + the one counted watch, then
   play/pause), NOT openPlayDetail; the play still opens from
   its leaderboard row and everywhere else it always did. */
function featCardHtml134(h) {
  const votes = h.voteCount;
  const name = firstNameOf(h);
  /* Round 219 (2026-11-26, Emil): the moment chip (the
     "🔥 Big Play" badge) and the watches count share ONE meta
     line under the title — "To gain space where it says big
     play — same line can have 53 watches." The two stacked
     rows (the chip's moment-row162 paragraph + the
     feat-views151 paragraph) collapse into a single flex row
     (.feat-meta-row219), saving the card a full line of
     height. Either half renders alone when the other is
     absent; neither → no row at all. The chip rides its
     inline form (momentChipInline162) here; every other
     surface keeps the block chip (momentChip162) as built. */
  const chip219 = typeof momentChipInline162 === "function" ? momentChipInline162(h) : "";
  const views219 = Number(h.viewCount) >= 1 ? `<span class="feat-views151">▶ ${watchesText151(h.viewCount)}</span>` : "";
  const meta219 = chip219 || views219 ? `<div class="feat-meta-row219">${chip219}${views219}</div>` : "";
  return `<article class="feat-card134" data-feat-id="${h.id}">
    <div class="tile-media dur-host feat-media134">${fameThumbHtml(h, { rest133: true })}<span class="feat-badge134">${CROWN227} Currently #1</span><span class="tile-tap" aria-hidden="true" onclick="event.stopPropagation();featTap163(${h.id})"></span><span class="feat-disc134" aria-hidden="true"><svg width="26" height="30" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span>${viewsChip151(h)}</div>
    <div class="feat-body134">
      <h3 class="feat-title134">${esc(name ? `${name} · ` : "")}${esc(shortTitle(h.title))}</h3>
      ${meta219}
      ${h.isSample ? `<span class="feat-vote134 is-static">${CROWN227} <b>${votes}</b> this month vote${votes === 1 ? "" : "s"}</span>` : `<button type="button" class="feat-vote134${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)"><span class="feat-vote-label134">${h.hasVoted ? "✓ Voted for this play" : "Vote for this play"}</span><span class="feat-vote-count134">${votes} vote${votes === 1 ? "" : "s"}</span></button>`}
    </div>
  </article>`;
}
/* Round 134: one compact leaderboard row — rank chip, the
   athlete-led short title over the sport, and the month vote
   count with its chevron at the right. The whole row opens
   the play, like the podium rows never could.
   Round 147 (2026-11-13, Emil): RETIRED — the Month rows adopt
   the Hall of Fame row design wholesale, so renderMonth calls
   the shared fameRowHtml134 (rank, poster thumb with the play
   icon, athlete-led short title, sport line, compact votes
   pill). The payload decides the numbers: /api/contest
   overrides each entry's voteCount with the MONTH count and
   sorts by it, so the one renderer shows this month's votes
   here and all-time votes in the Hall of Fame. The lb CSS
   stays in styles.css, as the podium's did when its writer
   retired. */
function renderMonth() {
  const entries = CONTEST.entries || [];
  const [y, m] = (CONTEST.period || "").split("-").map(Number);
  const btTag125 = $("#boardTag"); if (btTag125 && y && m) { btTag125.textContent = `The board · ${MONTHS[m - 1]}`; }
  /* Round 134 (2026-11-13, Emil's mockup): the podium and the
     Month tile deck retire. The tab is now: banner card (in
     markup) → the FEATURED card for the current #1 → the
     Leaderboard heading + sport dropdown + text tabs (markup)
     → compact rows for every entry. The featured play is the
     contest's #1 in the payload's own order — the same leader
     the banner used to name — and is NOT narrowed by the sport
     filter (the spotlight is the contest leader; the rows
     below carry the filter).
     Round 147 (2026-11-13): the rows are the Hall of Fame
     rows (fameRowHtml134) — same design, month numbers. */
  const feat134 = entries.length ? entries[0] : null;
  /* Round 163: a rebuild retires the outgoing featured element
     (a refresh may crown a new #1) — pause it explicitly before
     its markup leaves, so no stale clip keeps playing. */
  if (typeof featPause163 === "function") featPause163();
  /* Round 232 (2026-11-27, Emil): #monthFeat and #monthRows are
     retired from the board markup — the R230 homepage sections
     carry the featured card and the leaderboard now, and the
     board's Month view keeps only the banner, the last-winner
     strip, the empty state and the never-disappear line. Both
     writes below are guarded no-ops when their host is absent
     (the same pattern as the banner's retired leader line);
     the contest data flow above and below is untouched. */
  const mfEl232 = $("#monthFeat"); if (mfEl232) mfEl232.innerHTML = feat134 ? featCardHtml134(feat134) : "";
  /* Round 132 (2026-11-13): the contest is ONE combined board —
     the entry list ignores the Boys/Girls division entirely
     (the seg is hidden on this tab, and whatever division state
     happens to be stored, every entry renders). The sport
     filter keeps its current behavior. Watch keeps its own
     division filtering in renderAll2, untouched. */
  const filtered = entries.filter((h) => monthSport === "all" || h.sport === monthSport);
  const mrEl232 = $("#monthRows"); if (mrEl232) mrEl232.innerHTML = filtered.map((h, i) => fameRowHtml134(h, i, { feed189: true })).join("");
  hydrateDurPills();
  /* Round 163: after every rebuild, if the Month view is the
     one on screen, the (possibly new) #1's showcase starts —
     featEnter163 gates on the live view itself. */
  if (typeof featEnter163 === "function") featEnter163();
  $("#emptyState").style.display = filtered.length ? "none" : "block";
  /* Round 86 (2026-11-09): when the month has NO entries at all, the
     empty state explains what this board is — the real contest — and
     that the All Hypes plays are samples. A merely filtered-to-zero
     grid keeps the generic line. */
  if (entries.length === 0) $("#emptyState").innerHTML = "<b>Hype of the Month is the real contest.</b> No entries yet this month — post a play, and once it\u2019s approved and entered it competes here. The plays in All Hypes right now are samples that show how it works.";
  else $("#emptyState").textContent = "No plays here yet — be the first to post one.";
  /* Round 9: (a) the never-disappear line — keyed to the CURRENT
     MONTH's entries (not the filtered list): whenever the month has
     no entries at all, say plainly that plays don't delete when a
     month ends. (b) Last month's winner strip — renders ONLY when
     the previous period actually crowned a winner whose play is
     still on that period's board; otherwise the strip stays empty
     and hidden (true today: no contest has ever had entries). */
  const nd = $("#neverDisappear");
  if (nd) nd.hidden = entries.length !== 0;
  const strip = $("#lastWinner");
  if (strip) {
    const wEntry = LAST_MONTH.winnerId ? (LAST_MONTH.entries || []).find((e) => e.id === LAST_MONTH.winnerId) : null;
    if (wEntry) {
      const pm = Number((LAST_MONTH.period || "").slice(5, 7));
      strip.innerHTML = `<button type="button" class="last-winner-btn" onclick="openPlayDetail(${wEntry.id})">🏆 Last month (${MONTHS[pm - 1] || ""}): ${esc(wEntry.title)} — ${esc(wEntry.athlete_label || wEntry.player_name || "")}</button>`;
      strip.hidden = false;
    } else { strip.innerHTML = ""; strip.hidden = true; }
  }
}
/* Round 163 (2026-11-14, Emil): the Month FEATURED clip is a
   living showcase — entering the Month view starts the current
   #1's clip playing MUTED and LOOPING on its own. Round 133's
   poster-rest retires for the featured card only; the rows,
   the board tiles, Battles, the hero and every other surface
   keep their behavior exactly. Three rules keep it honest:
   (1) The autoplay is a SHOWCASE, not a watch — it never fires
   play_open. A view counts only when a visitor taps the
   player: the tap turns the sound ON and records exactly one
   watch through the very call the play-open path uses
   (trackEvent("play_open", id) — the Round 151 counter). Later
   taps just play/pause, standard-player style; the watch
   never double-counts on the same rendered card.
   (2) Leaving the Month view PAUSES the featured player
   explicitly. The trap: the Round 158 sweep deliberately
   skips muted previews, and a muted playing showcase has
   exactly that shape — so featPause163 rides the same choke
   points as the sweep (switchView / showPanel /
   openPlayDetail / hidePlayDetail / showStore) alongside it,
   and the sweep's treatment of everything else is untouched.
   (3) A refused play() (data-saver, low power) is swallowed —
   the poster rests and the tap still works, the hero
   controller's posture; no preference key is ever written
   here. Whoever holds #1 is showcased — no play-specific
   logic; renderMonth re-enters after every rebuild, so a
   refresh that crowns a new #1 starts the NEW clip (the old
   element is paused first, at the top of renderMonth). */
function featVideo163() {
  const host = $("#monthFeat");
  if (!host || typeof host.querySelector !== "function") return null;
  return host.querySelector("video:not(.vfill)");
}
function featSyncDisc163(v) {
  try {
    const host = v && typeof v.closest === "function" ? v.closest(".feat-media134") : null;
    if (host && host.classList) host.classList.toggle("feat-playing163", !v.paused);
  } catch (e) { /* the disc is decoration */ }
}
function featWire163(v) {
  if (!v || typeof v.addEventListener !== "function") return;
  if (v.dataset && v.dataset.featWired163 === "1") return;
  try { v.dataset.featWired163 = "1"; } catch (e) { /* fine */ }
  v.addEventListener("play", () => featSyncDisc163(v));
  v.addEventListener("pause", () => featSyncDisc163(v));
  featSyncDisc163(v);
}
function featEnter163() {
  try {
    if (typeof currentView === "undefined" || currentView !== "month") return;
    if (typeof monthSub !== "undefined" && monthSub === "fame") return;
    const view = $("#viewMonth");
    if (view && view.hidden) return;
    const v = featVideo163();
    if (!v) return; // no #1 — or an image/embed #1: the tab's states carry it
    featWire163(v);
    v.muted = true; // the showcase is always muted — sound is the tap's gift
    try { v.loop = true; } catch (e) { /* the markup already loops */ }
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    featSyncDisc163(v);
  } catch (e) { /* the showcase is a bonus — it must never break the tab */ }
}
function featPause163() {
  const v = featVideo163();
  if (!v) return;
  if (!v.paused) { try { v.pause(); } catch (e) { /* fine */ } }
  featSyncDisc163(v);
}
/* The featured tap (Round 163): the featured media's tap layer
   calls this instead of opening the play. The first tap on the
   muted showcase turns the sound ON and records the one
   counted watch (the play_open trackEvent, exactly as
   openPlayDetail records an open). After that the player is
   the visitor's: taps toggle play/pause. A featured play with
   no playable video element (an image or embed #1) keeps the
   pre-163 behavior — the tap opens the play. A plain function
   declaration, not a window.* assignment: the renderMonth
   code slices run in vm sandboxes with no window object, and
   a declaration is inert there while still landing on the
   global scope the inline onclick resolves in the browser. */
function featTap163(id) {
  const v = featVideo163();
  if (!v) { openPlayDetail(id); return; }
  featWire163(v);
  if (v.muted) {
    v.muted = false;
    if (!(v.dataset && v.dataset.featCounted163 === "1")) {
      try { if (v.dataset) v.dataset.featCounted163 = "1"; } catch (e) { /* fine */ }
      if (typeof trackEvent === "function") trackEvent("play_open", id);
    }
    if (v.paused) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
  } else if (v.paused) {
    const p = v.play(); if (p && p.catch) p.catch(() => {});
  } else {
    try { v.pause(); } catch (e) { /* fine */ }
  }
  featSyncDisc163(v);
}
/* Hall of Fame thumbnails (Round 5, 2026-11-05): image plays keep
   their photo; video plays — uploaded files and direct link videos,
   the same two kinds the board cards play — get a REAL playing video
   (muted, looping, inline) instead of the old sport-name placeholder.
   Anything else (embeds, watch-links) keeps the sport-name fallback. */
function fameThumbHtml(h, opts) {
  if (h.media_kind === "file" && (h.mime || "").startsWith("image/")) return `<img src="${esc(h.media_url)}" alt="">`;
  /* Round 123: board tiles wear the Round 118 poster pattern from
     first paint too (see mediaHtml) — a tile never sits black while
     its clip loads. */
  /* Round 133 (2026-11-13): opts.rest133 (Month entry tiles only,
     threaded from renderMonth via tileHtml) drops the autoplay
     attribute — the tile rests on its poster frame and the clip
     plays only in the detail view on tap. Every other caller
     (Watch tiles, Hall of Fame thumbs) renders exactly as
     before, autoplay included. */
  /* Round 233 (2026-11-27, Emil — "when not on WiFi the site
     takes a long time to load"): opts.gate233 (board tiles only,
     threaded from tileHtml) renders the tile WITHOUT a src and
     WITHOUT a poster — both URLs ride in data attributes and
     bindTileGate233's IntersectionObserver assigns them only as
     the tile approaches the viewport, plays it while it is on
     screen, and unloads it when it leaves, so a board of tiles
     fetches no video bytes (and no below-fold posters) before
     anyone scrolls to them. The rest133 form and every other
     caller render exactly as before. */
  if ((h.media_kind === "file" || h.media_kind === "link_video") && opts && opts.gate233 && !opts.rest133) {
    const src233 = esc((typeof playSrc192 === "function") ? playSrc192(h) : h.media_url);
    const poster233 = (typeof posterUrlFor134 === "function") ? posterUrlFor134(h) : "";
    return `<video data-src233="${src233}"${poster233 ? ` data-poster233="${esc(poster233)}"` : ""} muted loop playsinline preload="none" class="tile-vid233"></video>`;
  }
  if (h.media_kind === "file" || h.media_kind === "link_video") return `<video src="${esc((typeof playSrc192 === "function") ? playSrc192(h) : h.media_url)}"${(typeof posterAttr123 === "function") ? posterAttr123(h) : ""} muted loop playsinline${opts && opts.rest133 ? "" : " autoplay"} preload="metadata"></video>`;
  return `<span style="display:grid;place-items:center;height:100%;color:#fff;font-weight:800">${esc(cap(h.sport))}</span>`;
}
/* Round 134 (2026-11-13): the poster URL for a play, as a raw
   string — the same resolution posterAttr123 performs for the
   attribute (server poster_url first, then the URL-keyed
   banked/branded frame). Image plays wear their own file.
   Used by the Hall of Fame's poster thumbnails. */
function posterUrlFor134(h) {
  try {
    if (!h) return "";
    if (h.media_kind === "file" && (h.mime || "").startsWith("image/")) return h.media_url || "";
    if (h.poster_url) return h.poster_url;
    if (typeof btlPosterFor118 === "function") return btlPosterFor118(h.media_url || "", h.sport || "", h.title || "") || "";
  } catch (e) { /* fall through to empty */ }
  return "";
}
/* Round 233 (2026-11-27): the board-tile gate. fameThumbHtml's
   gate233 form renders a tile video with NO src and NO poster —
   data-src233 / data-poster233 carry the URLs. One shared
   IntersectionObserver (rootMargin 400px, so a tile is ready
   just before it scrolls in) assigns poster + src and plays on
   approach, and pauses + unloads (src removed, load()) when the
   tile leaves, returning it to its poster and freeing the
   connection. bindTileGate233 runs after every render that
   can produce gated tiles — Round 234: document-wide, from
   renderAll2 and renderHome230, so coverage never depends
   on the container a tile landed in. It disconnects the
   previous observer first, so re-renders
   (tab switches, filters, sport selects) never stack observers
   and never leave a detached tile playing. With no
   IntersectionObserver the gate degrades to today: every tile
   loads immediately. The .vfill blur clones markVertical107
   inserts are never observed (the :not(.vfill) selector), and
   an unload sweeps a same-host clone's src too, so a departed
   tile holds no video bytes at all. var (not let) for the
   observer handle: the declaration must be safe to read from
   any render path, hoisted like the functions around it. */
var tileGateObs233 = null;
function tileGateLoad233(v) {
  if (!v || typeof v.getAttribute !== "function") return;
  if (v.getAttribute("src")) return;
  const url = v.getAttribute("data-src233");
  if (!url) return;
  const poster = v.getAttribute("data-poster233");
  if (poster && !v.getAttribute("poster")) v.setAttribute("poster", poster);
  v.setAttribute("src", url);
  try { v.preload = "auto"; } catch (e) { /* the src is what matters */ }
  try { v.load(); } catch (e) { /* older engines start on play() */ }
  try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* a refused autoplay leaves the poster — the tap still opens the play */ }
}
function tileGateUnload233(v) {
  if (!v) return;
  const sweep = (el) => {
    if (!el || typeof el.getAttribute !== "function") return;
    try { el.pause(); } catch (e) { /* fine */ }
    if (el.getAttribute("src")) { el.removeAttribute("src"); try { el.load(); } catch (e) { /* fine */ } }
  };
  sweep(v);
  try {
    const host = v.parentElement;
    if (host && typeof host.querySelectorAll === "function") host.querySelectorAll("video.vfill").forEach(sweep);
  } catch (e) { /* the clone sweep is a bonus — the tile's own unload already landed */ }
}
function bindTileGate233(root) {
  const scope = root || (typeof document !== "undefined" ? document : null);
  if (!scope || typeof scope.querySelectorAll !== "function") return;
  let vids = [];
  try { vids = Array.prototype.slice.call(scope.querySelectorAll("video[data-src233]:not(.vfill)")); } catch (e) { return; }
  if (!vids.length) { if (tileGateObs233) { try { tileGateObs233.disconnect(); } catch (e) { /* fine */ } tileGateObs233 = null; } return; }
  if (typeof IntersectionObserver === "undefined") { vids.forEach(tileGateLoad233); return; }
  if (tileGateObs233) { try { tileGateObs233.disconnect(); } catch (e) { /* fine */ } tileGateObs233 = null; }
  tileGateObs233 = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en || !en.target || (en.target.classList && en.target.classList.contains("vfill"))) return;
      if (en.isIntersecting) tileGateLoad233(en.target); else tileGateUnload233(en.target);
    });
  }, { rootMargin: "400px 0px 400px 0px", threshold: 0 });
  vids.forEach((v) => tileGateObs233.observe(v));
}
/* Round 134: one Hall of Fame row — rank, a POSTER thumbnail
   with the play icon on it (no autoplaying video thumb: the
   old video thumb + the wide votes column squeezed the
   caption to five lines on phones), the athlete-led SHORT
   title, the sport, and the all-time count as a compact pill
   at the right. The whole row still opens the play's card
   (goToPlayCard), as before. An empty team shows NOTHING —
   the "No team tagged" placeholder is gone.
   Round 147 (2026-11-13): this is now THE contest row —
   renderMonth renders the This Month leaderboard with it
   too. Same markup, same tap; the /api/contest payload's
   voteCount override (month count, month order) is what
   makes the shared pill tell the month story on that tab.
   Round 209 (2026-11-26, Emil): the row's preview grows —
   the thumbnail takes ~40% of the row's width at a fixed
   height (styles.css .fame-thumb134 →209), the play icon
   leaves the thumb's center for a small dark chip in its
   bottom-right corner (.fame-play134 →209), and the votes
   pill moves into .fame-info so the right column groups
   athlete, title, sport line and votes. Every row element
   and the tap behavior are unchanged; the poster the thumb
   shows is now action-picked server-side (Round 209).
   Round 219 (2026-11-26, Emil): the pill's label gains the
   word Vote — "Vote · N votes" — because a bare "N votes"
   read as a stat, not as the way to vote. Text only: the
   pill's class, its place in .fame-info and the row's tap
   behavior are exactly as built.
   Round 220 (2026-11-26, Emil — "I want people to be able
   to vote"): the pill becomes a REAL vote control — the
   board tile chip's button form (Rounds 108/153): a
   <button> wired to the same toggleVote, its click AND
   keydown stopped so the row's own tap / Enter / Space
   handlers never also fire. The voted state mirrors the
   tile chip: "Voted" wording, the .voted class,
   aria-pressed, the remove-vote aria-label; after a toggle
   toggleVote's loadData refresh re-renders the row with
   the fresh count and state, like every vote surface.
   BOTH boards get the button: Hall of Fame plays accept
   votes exactly like Month plays — the vote endpoint
   takes any approved play, and a Fame row's destination
   (the play card via goToPlayCard) has always carried a
   live Vote button; Round 182's retirement bars a winner
   from re-ENTERING the contest, never from being voted
   on. Samples keep the display-only span — they never
   reach this renderer (the contest query excludes them,
   renderFame filters them), and the standing rule is
   samples get no vote affordance (Round 108). */
function fameRowHtml134(h, i, opts = {}) {
  const name = firstNameOf(h);
  const poster = posterUrlFor134(h);
  const thumb = poster
    ? `<img src="${esc(poster)}" alt="" loading="lazy"><span class="fame-play134" aria-hidden="true"><svg width="11" height="12" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span>`
    : `<span class="fame-thumb-fallback134">${esc(cap(h.sport))}</span>`;
  /* Round 189: Month-board rows (renderMonth passes
     opts.feed189) open the watch feed at the row's play; Hall
     of Fame rows keep the classic goToPlayCard tap. */
  /* Round 232: opts.home232 — the HOMEPAGE leaderboard's rows
     open the swipe feed at the tapped play (Emil: "We lost
     the swipe concept"), via homeOpenPlay232 in the Round 232
     block. The board's own rows keep feed189 / goToPlayCard. */
  const tap134 = opts && opts.home232 ? `homeOpenPlay232(${h.id})` : opts && opts.feed189 ? `openPlay189(${h.id}, this)` : `goToPlayCard(${h.id})`;
  /* Round 220: the votes pill — a real toggleVote button for
     real plays (see the block above), the R219 display span
     for samples. */
  const pill220 = h.isSample
    ? `<span class="fame-votes-pill134">Vote · ${h.voteCount} vote${h.voteCount === 1 ? "" : "s"}</span>`
    : `<button type="button" class="fame-votes-pill134 fame-vote-btn220${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)" onkeydown="event.stopPropagation()">${h.hasVoted ? "Voted" : "Vote"} · ${h.voteCount} vote${h.voteCount === 1 ? "" : "s"}</button>`;
  return `<div class="fame-row${i === 0 ? " top" : ""}" data-tile-id="${h.id}" role="button" tabindex="0" title="See this play's card" onclick="${tap134}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${tap134}}">
      <span class="fame-rank">${i + 1}</span>
      <span class="fame-thumb fame-thumb134">${thumb}</span>
      <div class="fame-info"><h4>${esc(name ? `${name} · ` : "")}${esc(shortTitle(h.title))}</h4><p>${esc(cap(h.sport))}${Number(h.viewCount) >= 1 ? ` · ▶ ${fmtCount151(h.viewCount)}` : ""}${typeof momentChipInline162 === "function" && momentChipInline162(h) ? ` · ${momentChipInline162(h)}` : ""}</p>${pill220}</div>
    </div>`;
}
function renderFame() {
  // Hall of Fame (Round 7): sample plays are demos — their votes are
  // real demo votes, but a sample must never take a Hall of Fame slot.
  // This ranking is computed here (from ALL_PLAYS) and nowhere else,
  // so the filter lives at the computation point; contest exclusion
  // is additionally enforced server-side.
  /* Round 134 (2026-11-13): the Fame sport dropdown rides the
     SAME shared contest sport state as the Month board
     (monthSport) and filters this all-time list by sport —
     ranking preserved, up to 10 shown. */
  const rankedAll = [...ALL_PLAYS].filter((h) => !h.isSample).sort((a, b) => b.voteCount - a.voteCount || b.id - a.id);
  const ranked = rankedAll.filter((h) => monthSport === "all" || h.sport === monthSport).slice(0, 10);
  /* Round 232 (2026-11-27): #fameList is retired from the board
     markup — the Hall of Fame lives in the homepage leaderboard
     (renderHomeLb230 computes the same ranking). Guarded write:
     a no-op in the shipped page; the computation above stays
     for its other readers. */
  const flEl232 = $("#fameList"); if (flEl232) flEl232.innerHTML = ranked.length ? ranked.map((h, i) => fameRowHtml134(h, i)).join("") : `<p style="color:var(--muted)">${rankedAll.length ? "No plays in this sport yet — try All Sports." : "No plays yet — the Hall of Fame fills in as plays are posted and voted on."}</p>`;
}
/* Round 167 (2026-11-14): renderMine is GONE. It populated
   the "Athletes on the board" directory (#mineAthletes) that
   sat under the My Plays lookup — every athlete with an
   approved play, on a page headed "My Plays · Private". The
   lookup itself was always private, but the directory read
   to parents as if My Plays showed everyone's plays, so the
   directory and its renderer were removed outright. The
   email/tag lookup below is untouched; public collections
   stay reachable from play cards and the tag field. */
/* My Plays lookup (light, no accounts): the panel's form asks the
   server who/what sits behind a guardian email or an HH tag
   (GET /api/athletes/lookup).
   Round 121 (2026-11-12) split the two paths by what they may show:
   - TAG: the athlete's PUBLIC collection — approved plays only,
     opened through openAthlete exactly as before (one match opens
     it, several matches render the pick list; athletes are never
     merged).
   - EMAIL: the guardian's OWN plays — every status, pending
     included — rendered right here with a status chip each. This
     is the "where did my play go?" answer the youth-agent test
     couldn't find. The server only returns a play when the email
     matches that play's guardian contact on file, and never
     returns the address itself.
   If both fields are filled, the tag wins — it's the more
   specific of the two. */
/* Round 179: reel ready state — ids whose reel finished building
   (or was already cached) this session, so a re-rendered My Plays
   row keeps the ready label instead of reverting to "Get the
   reel". The server also sends reelReady per play in the lookup
   (a cache that predates this session). */
const reelsReady179 = new Set();
const REEL_READY_LABEL179 = "🎬 Your reel is ready — tap to watch/download";
function guardianPlaysHtml121(plays) {
  const chip = (p) => {
    // Round 182: after the entered chip, the integrity states —
    // a retired winner and a sit-out month read as facts about
    // the play, not as a missing Enter button. (A retired play
    // that is somehow still entered keeps the entered chip:
    // inContest is checked first, exactly as before.)
    if (p.status === "approved") return `<span class="status-chip chip-live">✅ Live on the board</span>` + (p.inContest ? ` <span class="status-chip chip-contest">🏆 Entered in Hype of the Month</span>` : p.contestRetired ? ` <span class="status-chip chip-contest">🏆 Hype of the Month winner — retired to the Hall of Fame</span>` : p.contestSitOut ? ` <span class="status-chip chip-contest">🏆 Champions sit out this month — back next month</span>` : "");
    if (p.status === "pending") return `<span class="status-chip chip-review">⏳ In review</span>`;
    return `<span class="status-chip chip-off">Not on the board</span>`;
  };
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  /* Round 169 (2026-11-14): the row is STACKED at every width.
     Rounds 121–168 laid it out as one flex line — a flex:1 text
     div squeezed beside up to three .mini-btn buttons — and at
     phone width the text collapsed into a one-word ribbon, the
     chips ballooned, and the last button overflowed the row AND
     the viewport (body scrollWidth 396 on a 390px phone), which
     is what let the whole page pan left/right on Dyanna's phone.
     Now: title + meta full-width with natural wrapping, chips
     inline at natural size, and the buttons in their own
     wrapping actions row underneath (.mine-play-actions). */
  return `<p class="mine-find-msg" style="margin-top:0">Your plays — every play posted with that email:</p>` + plays.map((p) => {
    /* Round 172 (2026-11-14): APPROVED rows gain 🔗 Share,
       riding the existing sharePlay (play cards and the watch
       view have had it since Round 34) — view, share, reel,
       withdraw. Pending / not-on-the-board plays are not
       public, so they get NO Share: the gate is the status
       alone. The actions row wraps (Round 169), so the extra
       button cannot reopen the phone overflow. */
    const actions = [
      p.status === "approved" && p.athlete_id ? `<button type="button" class="mini-btn" onclick="openAthlete('${esc(p.athlete_id)}')">See plays →</button>` : "",
      p.status === "approved" ? `<button type="button" class="mini-btn" onclick="sharePlay(${p.id}, this)">🔗 Share</button>` : "",
      p.status === "approved" && p.canReel ? `<button type="button" class="mini-btn" onclick="getReel165(${p.id}, this)">${p.reelReady || reelsReady179.has(p.id) ? REEL_READY_LABEL179 : "🎬 Get the reel"}</button>` : "",
      p.inContest ? `<button type="button" class="mini-btn" onclick="withdrawContest130(${p.id}, this)">Withdraw from contest</button>` : "",
    ].filter(Boolean).join("");
    return `
    <div class="queue-item mine-play-row">
      <div class="mine-play-main"><b>${esc(p.title)}</b><br><span style="color:var(--muted)">${esc(p.athlete_label || "")}${p.athlete_tag ? ` · <span class="tagchip">${esc(p.athlete_tag)}</span>` : ""} · ${esc(cap(p.sport))}${p.team ? ` · ${esc(p.team)}` : ""}${when(p.created_at) ? ` · posted ${esc(when(p.created_at))}` : ""}</span><br>${chip(p)}</div>
      ${actions ? `<div class="mine-play-actions">${actions}</div>` : ""}
    </div>`;
  }).join("");
}
/* Round 130 (2026-11-13): withdraw from Hype of the Month, right
   where the guardian sees the entered chip. The email they just
   looked up with rides along — the server matches it against the
   email used to post the play (the Round 121 rule, mirrored at
   /api/contest/withdraw) — and the list re-renders from a fresh
   lookup so the chip and button reflect reality. An error keeps
   the button and says why, in place. */
window.withdrawContest130 = async (id, btn) => {
  const email = ($("#mineEmail")?.value || "").trim();
  if (btn) { btn.disabled = true; btn.textContent = "Withdrawing…"; }
  try {
    await api("/api/contest/withdraw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id, email }) });
    const findForm = $("#mineFind");
    if (findForm) findForm.requestSubmit();
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = "Withdraw from contest"; btn.insertAdjacentHTML("afterend", `<p class="mine-find-msg">${esc(e.message)}</p>`); }
  }
};
/* Round 165 (2026-11-14): "Get the reel" — the guardian who
   posted a play downloads its branded reel MP4 (sting + the
   clip + crest watermark), generated on the server the first
   time and cached after that. The email they just looked up
   with rides along, exactly like the withdraw above — the
   server matches it against the play's guardian email on file
   and only then builds or serves the file. The answer is the
   video itself, not JSON, so this goes through fetch + blob
   (the Owner view's print-image download pattern), not api().
   An error keeps the button and says why, in place. */
window.getReel165 = async (id, btn) => {
  const email = ($("#mineEmail")?.value || "").trim();
  const label = "🎬 Get the reel";
  /* Round 179: the button used to reset to "Get the reel" the
     moment the download fired — after a long silent wait it read
     as "nothing happened" (both youth testers). Now a finished
     build lands on a READY state that stays: the label says the
     reel is ready and tapping again re-serves it (the server
     answers from its cache, so the second tap is fast). A play
     already known ready skips the "Making…" label entirely. */
  const wasReady179 = reelsReady179.has(id);
  if (btn) { btn.disabled = true; if (!wasReady179) btn.textContent = "Making your reel… first one takes a few seconds"; }
  try {
    const r = await fetch(`/api/highlights/${id}/reel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.message || "The reel couldn't be made right now."); }
    const blob = await r.blob();
    const m = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = m ? m[1] : `highlighthype-reel-${id}.mp4`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    reelsReady179.add(id);
    if (btn) { btn.disabled = false; btn.textContent = REEL_READY_LABEL179; }
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = reelsReady179.has(id) ? REEL_READY_LABEL179 : label; btn.insertAdjacentHTML("afterend", `<p class="mine-find-msg">${esc(e.message)}</p>`); }
  }
};
$("#mineFind").addEventListener("submit", async (e) => {
  e.preventDefault();
  const box = $("#mineFindResults");
  const email = $("#mineEmail").value.trim();
  const tag = $("#mineTag").value.trim();
  if (!email && !tag) { box.innerHTML = `<p class="mine-find-msg">Enter the guardian email from the upload, or the athlete's HH tag.</p>`; return; }
  box.innerHTML = `<p class="mine-find-msg">Looking…</p>`;
  try {
    const q = tag ? `tag=${encodeURIComponent(tag)}` : `email=${encodeURIComponent(email)}`;
    const d = await api(`/api/athletes/lookup?${q}`);
    if (!tag) {
      const plays = d.plays || [];
      if (plays.length) { box.innerHTML = guardianPlaysHtml121(plays); return; }
      box.innerHTML = `<p class="mine-find-msg">No plays found for that email yet. Double-check it's the email used to post the play — or try the athlete's HH tag to see their public plays.</p>`;
      return;
    }
    const list = d.athletes || [];
    if (!list.length) { box.innerHTML = `<p class="mine-find-msg">No approved plays found for that tag yet. Plays appear once the owner approves them — if you just posted, check back soon, or look the play up with the guardian email instead.</p>`; return; }
    if (list.length === 1) { box.innerHTML = ""; openAthlete(list[0].athlete_id); return; }
    box.innerHTML = `<p class="mine-find-msg" style="margin-top:0">More than one athlete matches — pick yours:</p>` + list.map((a) => `
      <div class="queue-item" style="display:flex;gap:14px;align-items:center">
        <div class="athlete-avatar" aria-hidden="true">${esc((a.name || "?")[0].toUpperCase())}</div>
        <div style="flex:1"><b>${esc(a.name)}</b>${a.team ? ` · ${esc(a.team)}` : ""}${a.tag ? ` · <span class="tagchip">${esc(a.tag)}</span>` : ""}<br><span style="color:var(--muted)">${a.playCount} public play${a.playCount === 1 ? "" : "s"}</span></div>
        <button type="button" class="mini-btn" onclick="openAthlete('${esc(a.athlete_id)}')">See all plays →</button>
      </div>`).join("");
  } catch (err) { box.innerHTML = `<p class="mine-find-msg">${esc(err.message)}</p>`; }
});
/* Round 217: after every board render, the first few board
   plays' renditions warm at metadata level (tapWarmBoard217 in
   the Round 217 block — capped, detached elements, typeof-
   guarded like every cross-block call). */
function renderAll() { syncFilterUI(); renderMonth(); renderFame(); renderAll2(); renderPlayDetail(); highlightSharedPlay(); if (typeof updateContestStrip107 === "function") updateContestStrip107(); if (typeof renderSpotlight162 === "function") renderSpotlight162(); if (typeof tapWarmBoard217 === "function") tapWarmBoard217(); if (typeof renderHome230 === "function") renderHome230(); }
/* Round 107 (2026-11-12): the hybrid contest strip + the Month
   panel's sub line — both filled from the live contest payload on
   every render, with honest states only: no entries says so, no
   votes says so, otherwise the current leader is named. The end
   date comes from the contest period itself (last day of the
   month), never a hard-coded day. */
function updateContestStrip107() {
  const entries = CONTEST.entries || [];
  const total = entries.reduce((s, e) => s + (e.voteCount || 0), 0);
  /* Round 121: the empty state tells the ONE entry story — post a
     play; once it's approved, the parent/guardian who posted it
     can enter it. (The youth-agent test found three different
     stories in three places.) */
  /* Round 125 (2026-11-13, Dyanna): with entries, the state line
     names the leading ATHLETE and their vote count — "Charlotte
     leads with 12 votes" — on both the Month strip and the Watch
     slim line. renderAll re-runs this after every data refresh,
     so a vote cast or an entry added in-session updates it in
     real time. The zero-entries invite text is unchanged. */
  const lead125 = entries.length ? entries.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0))[0] : null;
  const leadName125 = lead125 ? (firstNameOf(lead125) || lead125.title || "A play") : "";
  const state = !entries.length
    ? "No entries yet — post a play with the contest box checked (it's on by default) and it's in once approved"
    : !total
      ? "No votes yet — every vote counts"
      : `${leadName125} leads with ${lead125.voteCount} vote${lead125.voteCount === 1 ? "" : "s"}`;
  const [y, m] = (CONTEST.period || "").split("-").map(Number);
  const label107 = CONTEST.monthLabel || (y && m ? `${MONTHS[m - 1]} ${y}` : "");
  const t1 = $("#stripTitle"), t2 = $("#stripState"), ends = $("#stripEnds");
  /* Round 134 (2026-11-13): the banner is a card now — #stripTitle
     is its gold EYEBROW (uppercased by CSS); the dynamic leader
     line no longer paints in the banner at all (the #stripState
     element retired — the guarded t2 write below simply no-ops
     on the Month tab; the Watch slim line further down still
     carries the live state).
     Round 136 (2026-11-13, Emil): the card's big "Hype of the
     Month" title is dropped — the tab already says it — and the
     eyebrow carries name + period instead: "Hype of the Month ·
     November 2026", so the card still reads on its own in a
     screenshot. */
  if (t1) t1.textContent = label107 ? `Hype of the Month · ${label107}` : "Hype of the Month";
  if (t2) t2.textContent = state;
  const endsTxt = y && m ? `Ends ${MONTHS[m - 1].slice(0, 3)} ${new Date(y, m, 0).getDate()}` : "";
  if (ends) ends.textContent = endsTxt;
  const ms = $("#monthSub107");
  if (ms) ms.textContent = `${label107 ? `${label107} · ` : ""}${!entries.length ? "No entries yet — post a play with the contest box checked (it's on by default), and once it's approved it's in." : !total ? "No votes yet — every play is tied at 0. The first vote takes the lead." : "Every vote counts."}${endsTxt ? ` Voting ends ${endsTxt.replace("Ends ", "")}.` : ""}`;
  /* Round 123: the Watch view's slim contest line — the same live
     state in one line: month name, the honest entries count, and
     the tail that fits the state (enter while it's empty, vote
     once there's a board). */
  const slim123 = $("#contestSlimText123");
  if (slim123) {
    const monthName123 = m ? MONTHS[m - 1] : "";
    slim123.textContent = !entries.length
      ? `🏆 Hype of the Month${monthName123 ? ` — ${monthName123}` : ""}: no entries yet · Post a play to enter →`
      : !total
        ? `🏆 Hype of the Month${monthName123 ? ` — ${monthName123}` : ""}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} · No votes yet — cast the first vote →`
        : `🏆 Hype of the Month${monthName123 ? ` — ${monthName123}` : ""}: ${leadName125} leads with ${lead125.voteCount} vote${lead125.voteCount === 1 ? "" : "s"} · Vote now →`;
  }
}
/* Round 126 (2026-11-13, Emil's phone review of Round 125):
   the mid-feed Hype Frame slot keeps its Round 125 place and
   splice (INSIDE the Watch deck after the third tile of the
   CURRENT filtered list — it follows the filters like a tile
   does; fewer than 3 matching plays, it doesn't render; never
   on Month or Battles), but the big purple SVG-hoodie banner
   (441px tall at 390px wide) is replaced by a COMPACT strip in
   the PRE-125 homepage treatment: the Hype Frame film under
   its finished-hoodie cover (the playHfStoreFilm pattern —
   playHfFeedFilm126 swaps the film in on tap), the HYPE FRAME
   lockup + "Your moment on a hoodie", the pre-125 four steps
   compressed to one mini row, and the Create action opening
   the same choice card as every other generic Hype Frame
   entry (openHfChoice). Emil: the banner was "too big and
   doesn't look like what we had before — bring that back but
   make it take less space." NO price — teasers tease; prices
   live inside the Store only.
   Round 129 (2026-11-13, Emil's phone review of the strip:
   "The video is really small in hype frame section"): the
   layout inverts — the film leaves its small left box and
   takes the FULL CARD WIDTH at 16:9 across the TOP of the
   card, and the copy stacks below it (lockup, steps, Create
   row). The numbered mini-row steps retire here: the arrow
   line is the steps presentation at every width now. Slot,
   cover, one-tap swap and the Create action are unchanged;
   the stacked layout lives in the Round 129 styles.css block
   (the 126 classes stay). */
function hypeFrameStrip126() {
  return `<div class="hf-strip126"><div class="hf-strip-film126"><div class="hf-film-box"><div class="hf-film-cover" id="hfFilmCoverFeed126"><img src="/swag/hf-hoodie-softball.jpg" alt="Example finish: a softball player's frozen contact moment printed on the back of a black hoodie, with the Hype Frame frame and script" loading="lazy" decoding="async"><button type="button" class="hf-film-btn hf-film-btn-sm126" onclick="playHfFeedFilm126()">▶ See how it works</button></div><video id="hfFeedFilm126" data-click-play src="/hype-frame-film.mp4?v=7" controls playsinline preload="none" hidden></video></div></div><div class="hf-strip-copy126"><p class="hf-strip-lockup126"><span class="hf-strip-tag126">📸 Hype Frame</span><b>Your moment on a hoodie</b></p><p class="hf-strip-stepsline126">Your video <span>→</span> pick a frame <span>→</span> photo or avatar <span>→</span> we take care of the rest</p><p class="hf-strip-cta126"><button type="button" class="hf-strip-btn126" onclick="openHfChoice()">Create a Hype Frame →</button> <span class="hf-strip-note126">Front or back print · Youth sizes YXS–YXL · Adult sizes S–XL</span></p></div></div>`;
}
function renderAll2() { /* All Hypes view */
  // Round 10 (2026-11-05): the "All teams" filter is GONE at the
  // owner's direction — control, option population and the team
  // clause all removed; filtering behaves as if the team is always
  // "all" (team names still match through the search box). No API
  // change: loadData never sent a team parameter (the server's
  // /api/highlights team param simply stays at its "all" default).
  const q = allSearch.toLowerCase();
  /* Round 162: the lane read is typeof-guarded (the syncFilterUI
     currentView precedent) — in the app lane162 is always the
     module state; a partial slice without it reads as OFF,
     which is the pre-162 board exactly. */
  const laneOn162 = typeof lane162 !== "undefined" && !!lane162 && typeof MOMENT_HEART162 !== "undefined";
  const filtered = ALL_PLAYS.filter((h) =>
    divMatch(h, allDiv) &&
    (allSport === "all" || h.sport === allSport) &&
    /* Round 162: the lane clause composes with sport + division
       exactly like the clauses around it — heart kinds only;
       big_play and untagged plays fall out while it's on. */
    (!laneOn162 || MOMENT_HEART162.includes(h.moment_kind)) &&
    (!q || [h.title, h.player_name, h.story, h.team, h.sport].join(" ").toLowerCase().includes(q)));
  $("#allCount").textContent = `${filtered.length} plays`;
  const emptyEl = $("#allEmpty");
  /* Round 162: an empty LANE gets its own honest line (no plays
     yet is a state, not a failed search); every other empty
     board keeps the generic line. */
  /* Round 179: the empty-lane line names what the lane collects
     (the heart kinds) and where Big Play lives instead — the
     girl tester found a 🔥 Big Play tag on the board, opened
     this lane, and read the old line as "nothing is tagged." */
  emptyEl.textContent = laneOn162 && !filtered.length ? "No First Ever, Personal Best, Comeback, or Great Effort plays here yet — they show up as families tag their moments. 🔥 Big Play moments live on the main board." : "No plays match — try a different board, sport, or search.";
  const allTiles = filtered.map((h, i) => tileHtml(h, { rank: i + 1 }));
  /* Round 125→126: the mid-feed Hype Frame slot splices into
     the deck after the third tile of the filtered list (deck
     index 2 = overall tile #3, the featured slot holding #1);
     fewer than 3 tiles, no slot. Round 126 replaced the slot's
     contents (the tall SVG banner) with the compact film strip
     — see hypeFrameStrip126 above. */
  const deckTiles125 = allTiles.slice(1);
  if (allTiles.length >= 3) deckTiles125.splice(2, 0, hypeFrameStrip126());
  $("#allBoard").innerHTML = allTiles.length ? `<div class="tile-featured-slot">${allTiles[0]}</div>` + (allTiles.length > 1 ? `<div class="tile-deck">${deckTiles125.join("")}</div>` : "") : "";
  hydrateDurPills();
  /* Round 233: bind the tile gate to the fresh grid — the
     binder disconnects the previous observer, so a re-render
     never stacks observers or strands a playing tile.
     Round 234 (2026-11-27): the bind is DOCUMENT-WIDE, not
     scoped to #allBoard. A scoped bind makes gate coverage
     depend on which container a renderer happened to use —
     a gated tile rendered anywhere else would sit unobserved
     at zero fetch state forever (a permanently black tile).
     The binder now rescans the whole document after every
     render that can produce gated tiles (here, and at the
     end of renderHome230), so no gated tile can exist in
     the document without gate coverage. */
  if (typeof bindTileGate233 === "function") bindTileGate233();
  emptyEl.style.display = filtered.length ? "none" : "block";
  /* Round 86 (2026-11-09): while every play on the board is a sample,
     the strip above the grid says so plainly — demos vs the contest. */
  const sampleStrip86 = $("#allSampleStrip");
  if (sampleStrip86) sampleStrip86.hidden = !(ALL_PLAYS.length > 0 && ALL_PLAYS.every((h) => h.isSample));
}
/* ---------------- play detail (Round 8, 2026-11-05) ----------------
   The boards are compact tiles now; the FULL card lives here, in an
   overlay panel (the store quick view's pattern: fixed overlay,
   backdrop, ← Back affordance, Escape closes) holding the exact
   cardHtml render — every action (Vote, Enter, Share, Report,
   Hype Frame, owner Mark winner) works from the detail exactly as
   it did on the board, because it IS the same card. A contest entry
   opens with its month context (month votes, in-contest, prize
   eligibility), any other play with its all-time card. renderAll
   re-renders the open detail after every data refresh, so vote /
   enter state stays live; the enter + report message slots ride in
   ENTER_MSGS / REPORT_MSGS, so a mid-flow re-render can neither
   drop nor duplicate them. */
let detailPlayId = null;
let handledPlayHash = "";
/* Round 15 (2026-11-06): autoplay-advance state — session-only.
   detailAutoplay starts ON at page load (the owner's call) and is
   never persisted anywhere; detailPlayedIds is the per-detail-
   session set of plays already watched, so autoplay can walk the
   Up next pool exactly once and never cycle. The set resets when
   a detail is opened fresh from outside (see openPlayDetail). */
let detailAutoplay = true;
const detailPlayedIds = new Set();
let detailEndedVideo = null;
let detailEndedHandler = null;
/* Round 107 (2026-11-12): the watch view. The play detail is no
   longer the full board card in an overlay — it renders the
   approved hybrid watch layout into the same #playDetail sheet
   (restyled as a full page under the header by Round 107 CSS):
   player first, title, sport · division · athlete line, crowns +
   badges, the big gold Vote button with its count for real plays
   (samples keep the Demo treatment — no live vote button), then
   the Round 14/15 Up next queue with its Autoplay advance,
   unchanged. The full card's working parts all survive the move:
   the wrapper is still a .card[data-play-id], so the enter +
   report message slots (ENTER_MSGS / REPORT_MSGS) paint exactly
   where they did, and Enter / Share / Save clip / Report / owner
   Mark winner ride in one slim actions row under the vote. The
   full cardHtml card itself is untouched — athlete pages still
   render it. */
function watchHtml107(h, entry) {
  const votes = h.voteCount;
  const voteLabel = entry ? "this month" : "all-time";
  const label = h.athlete_label || h.player_name || "";
  const athleteBit = label
    ? (h.athlete_id ? `<button type="button" class="athlete-link watch-athlete" onclick="openAthlete('${esc(h.athlete_id)}')">${esc(label)}</button>` : esc(label))
    : "";
  /* Round 223 (2026-11-27): the watch view gains an ALWAYS-
     visible control row under the player — play/pause, a
     scrub bar and the time. The native chrome fades out
     while a clip plays (Rounds 140/143), which left Emil
     with "no way to pause it or rewind" mid-clip; this row
     never fades and is wired per render by
     wireCardControls223. Video plays only: embeds carry
     their own player and photo plays have nothing to scrub.
     The native controls stay exactly as they were. */
  const cardControls223 = (typeof playHasVideo === "function" ? playHasVideo(h) : false) && h.media_kind !== "link_embed"
    ? `<div class="card-controls223" data-card-controls="${h.id}"><button type="button" class="card-playbtn223" data-card-playbtn="${h.id}" aria-label="Pause the play">❚❚</button><div class="card-scrub223" data-card-scrub="${h.id}"><span data-card-progress="${h.id}"></span></div><span class="card-time223" data-card-time="${h.id}">0:00 / 0:00</span></div>`
    : "";
  return `<article class="card watch-card" data-play-id="${h.id}">
    <div class="watch-player">${mediaHtml(h)}</div>
    ${cardControls223}
    <div class="watch-meta">
      <h2 class="watch-title">${esc(h.title)}</h2>
      <p class="watch-line"><b>${esc(cap(h.sport))}</b>${h.play_type ? ` · ${esc(h.play_type)}` : ""} · ${h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed"}${athleteBit ? ` · ${athleteBit}` : ""}</p>
      <p class="watch-views151">👁 ${fmtCount151(h.viewCount)} view${Number(h.viewCount) === 1 ? "" : "s"}</p>
      ${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}
      ${typeof momentChip162 === "function" ? momentChip162(h) : ""}
      ${typeof crownsHtml105 === "function" ? crownsHtml105(h, true) : ""}
      ${h.isSample ? `<p class="sample-line"><span class="sample-badge">⭐ SAMPLE PLAY</span> <span class="watch-demo">Demo</span></p><p class="meta sample-note">Sample play — posted by HighlightHype to show how it works.</p>` : ""}
      ${h.story ? `<p class="meta">${esc(h.story)}</p>` : ""}
      ${entry && entry.prizeEligible === false ? `<p><span class="tagchip warn">Can't be featured — no parent/guardian contact on file</span></p>` : ""}
    </div>
    <div class="watch-vote">
      ${h.isSample ? "" : `<button type="button" class="votebtn watch-votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id}, this)">${h.hasVoted ? "You voted — tap to remove" : `${CROWN227} Vote for Hype of the Month`}</button>`}
      <p class="watch-count"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</p>
    </div>
    <div class="card-actions watch-actions">
      ${h.isSample ? "" : `<button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>`}
      ${enterControl182(h, entry ? ENTERED_BTN179 : "")}
      <button type="button" class="mini-btn" onclick="sharePlay(${h.id}, this)">🔗 Share</button>
      ${playHasVideo(h) ? `<button type="button" class="mini-btn" onclick="saveClip(${h.id}, this)">⬇ Save clip</button>` : ""}
      <button type="button" class="mini-btn" onclick="reportPlay(${h.id})">🚩 Report</button>
      ${ownerToken() && entry ? `<button type="button" class="mini-btn" onclick="markWinner(${h.id})">Mark winner (owner)</button>` : ""}
    </div>
    <div class="card-msg" data-enter-msg${ENTER_MSGS.has(h.id) ? "" : " hidden"}>${ENTER_MSGS.get(h.id) || ""}</div>
    <div class="card-msg" data-report-msg${REPORT_MSGS.has(h.id) ? "" : " hidden"}>${REPORT_MSGS.get(h.id) || ""}</div>
  </article>`;
}
function renderPlayDetail() {
  const body = $("#playDetailBody");
  if (!body || detailPlayId == null) return;
  const entry = (CONTEST.entries || []).find((p) => p.id === detailPlayId);
  const play = entry || ALL_PLAYS.find((p) => p.id === detailPlayId);
  if (!play) { hidePlayDetail(); return; }
  body.innerHTML = watchHtml107(entry || play, entry) + upNextHtml(play);
  hydrateDurPills();
  if (typeof wireWatchVertical113 === "function") wireWatchVertical113(body);
  /* Round 123: the watch player joins the Round 118/119 pattern —
     poster confirmed at open and the per-play start offset (the
     SAME btlStartOffset119 map Battles reads) applied before
     playback settles, so a black-intro clip opens on its action
     in Watch too. Guarded like the wiring above it. */
  if (typeof wireWatch123 === "function") wireWatch123(body, play);
  if (typeof wireWatchChrome140 === "function") wireWatchChrome140(body);
  /* Round 223: the always-visible control row (play/pause +
     scrub + time) wires to the fresh player — every detail
     render rebuilds the card's DOM, so the wiring re-attaches
     here alongside the chrome fade. */
  if (typeof wireCardControls223 === "function") wireCardControls223(body);
  wireDetailAutoplay(play);
}
/* Round 14 (2026-11-06): "Up next" in the play detail — the third
   owner-approved borrow from the YouTube comparison. Below the full
   card, up to 4 OTHER approved plays (ALL_PLAYS is the approved
   set; the open play is always excluded): same sport first, then
   votes descending, then newest. Each row is a compact horizontal
   card — poster thumb with its duration pill, title, athlete first
   name + votes — and tapping it goes through openPlayDetail, so
   the dialog swaps in place (full card render, vote state, sample
   pill), the #play- hash follows, and this list rebuilds around
   the new play. With no other approved plays the section renders
   nothing at all. Because renderPlayDetail appends it, the section
   is identical however the detail was opened — All Hypes tile, Month
   tile, athlete-page card link, Hall of Fame, shared #play- link.
   Round 15 (2026-11-06) supersedes Round 14's "no autoplay" line:
   the pool now also excludes this detail session's already-played
   plays (detailPlayedIds), and the section heading carries the
   Autoplay toggle — see wireDetailAutoplay below. */
function upNextFor(play) {
  const stamp = (p) => { const t = parsePlayDate(p.created_at); return Number.isFinite(t) ? t : (p.id || 0); };
  return ALL_PLAYS.filter((p) => p.id !== play.id && !detailPlayedIds.has(p.id)).sort((a, b) =>
    ((b.sport === play.sport) - (a.sport === play.sport)) ||
    ((b.voteCount || 0) - (a.voteCount || 0)) ||
    (stamp(b) - stamp(a)) ||
    (b.id - a.id)).slice(0, 4);
}
function autoplayToggleHtml() {
  return `<button type="button" class="autoplay-toggle${detailAutoplay ? " on" : ""}" onclick="toggleDetailAutoplay()" aria-pressed="${detailAutoplay ? "true" : "false"}" aria-label="Autoplay: roll into the next play automatically">Autoplay <span class="autoplay-state">${detailAutoplay ? "On" : "Off"}</span></button>`;
}
function upNextHtml(play) {
  const next = upNextFor(play);
  if (!next.length) return "";
  const rows = next.map((p) => {
    const first = firstNameOf(p);
    return `<button type="button" class="upnext-row" data-tile-id="${p.id}" onclick="openPlayDetail(${p.id})" aria-label="Up next: ${esc(p.title)}">
      <span class="upnext-thumb dur-host">${fameThumbHtml(p)}${durPillHtml(p)}</span>
      <span class="upnext-text"><span class="upnext-name">${esc(p.title)}</span><span class="upnext-meta">${first ? `${esc(first)} · ` : ""}${p.voteCount || 0} vote${p.voteCount === 1 ? "" : "s"}</span></span>
    </button>`;
  }).join("");
  /* Round 86 (2026-11-09): the queue sorts same-sport first, but when
     NO queued clip shares the open play's sport, "Up next" overpromises
     — the section honestly becomes Explore other sports. */
  const upHead86 = next.some((p) => p.sport === play.sport) ? "Up next" : "Explore other sports";
  return `<div class="upnext"><div class="upnext-head"><h4 class="upnext-title">${upHead86}</h4>${autoplayToggleHtml()}</div>${rows}</div>`;
}
/* Round 15: the Autoplay switch flips the session variable and
   repaints ITSELF in place — a full detail re-render would restart
   the playing video, so the toggle never goes through one. */
window.toggleDetailAutoplay = () => {
  detailAutoplay = !detailAutoplay;
  $$(".autoplay-toggle").forEach((btn) => paintAutoplayToggle(btn));
};
function paintAutoplayToggle(btn) {
  if (!btn) return;
  if (typeof btn.setAttribute === "function") btn.setAttribute("aria-pressed", detailAutoplay ? "true" : "false");
  if (btn.classList && typeof btn.classList.toggle === "function") btn.classList.toggle("on", detailAutoplay);
  const state = typeof btn.querySelector === "function" ? btn.querySelector(".autoplay-state") : null;
  if (state) state.textContent = detailAutoplay ? "On" : "Off";
}
/* Round 15: autoplay-advance wiring. renderPlayDetail calls this
   after every detail render (opens, swaps and data refreshes all
   rebuild the card's DOM, so the handler is re-attached to the
   fresh <video> each time and torn down from the discarded one).
   Only real video plays wire up: image plays have no <video>, and
   embeds are iframes with no ended semantics the page can hear.
   The shared mediaHtml renders detail videos with a loop
   attribute, under which the ended event can never fire — the
   detail's own copy has it removed here (board thumbs and athlete
   cards, rendered by other paths, keep looping). Only the ended
   event advances: pausing, seeking and looping never do. */
function teardownDetailAutoplay() {
  if (detailEndedVideo && detailEndedHandler && typeof detailEndedVideo.removeEventListener === "function") detailEndedVideo.removeEventListener("ended", detailEndedHandler);
  detailEndedVideo = null;
  detailEndedHandler = null;
}
function wireDetailAutoplay(play) {
  teardownDetailAutoplay();
  if (!play || !playHasVideo(play)) return;
  const body = $("#playDetailBody");
  const video = body && typeof body.querySelector === "function" ? body.querySelector("video") : null;
  if (!video || typeof video.addEventListener !== "function") return;
  if (typeof video.removeAttribute === "function") video.removeAttribute("loop");
  const fromId = play.id;
  detailEndedHandler = () => advanceDetailAutoplay(fromId);
  detailEndedVideo = video;
  video.addEventListener("ended", detailEndedHandler);
}
function advanceDetailAutoplay(fromId) {
  if (!detailAutoplay) return;
  if (detailPlayId !== fromId) return; // a stale handler on a swapped-out play
  const entry = (CONTEST.entries || []).find((p) => p.id === fromId);
  const play = entry || ALL_PLAYS.find((p) => p.id === fromId);
  if (!play) return;
  const next = upNextFor(play)[0];
  if (!next) return; // pool exhausted: stop at the end — no wrap, no replay
  openPlayDetail(next.id);
}
window.openPlayDetail = (id, opts = {}) => {
  const exists = ALL_PLAYS.some((p) => p.id === id) || (CONTEST.entries || []).some((p) => p.id === id);
  if (!exists) return;
  /* Round 15 session bookkeeping: opening while NO detail is open
     (board tile, athlete page, Hall of Fame, winner strip) — or an
     explicitly fresh route (a shared #play- link) — starts a new
     played set; opening while a detail IS open can only be an
     Up-next tap or an autoplay advance, and ADDS to the set. */
  if (detailPlayId == null || opts.fresh) detailPlayedIds.clear();
  detailPlayedIds.add(id);
  detailPlayId = id;
  // Site stats: every open counts — a fresh open, an Up-next tap,
  // and an autoplay advance all land here, and each one IS a view
  // of the play.
  if (typeof trackEvent === "function") trackEvent("play_open", id);
  renderPlayDetail();
  const wrap = $("#playDetail");
  if (!wrap) return;
  wrap.hidden = false;
  wrap.scrollTop = 0; // an Up-next swap (Round 14) starts at the new play's top
  document.body.classList.add("detail-open");
  /* Round 158: opening the watch view is a view change —
     every panel falls silent behind the overlay (a battle
     left playing, an unmuted board tile, the studio), so
     the detail is the only thing that can make sound. The
     detail's own player lives outside the panels and is
     untouched; muted board previews keep previewing. */
  if (typeof pauseMediaIn158 === "function") $$(".panel[data-panel]").forEach((p) => pauseMediaIn158(p, false));
  /* Round 163: the featured showcase pauses behind the detail
     too — it is muted, so the sweep above leaves it alone. */
  if (typeof featPause163 === "function") featPause163();
  /* Round 139: the detail gets its OWN history entry, pushed
     with the #play- hash as its URL — browser Back closes the
     play onto the board beneath it, and the board's entry
     keeps its clean URL (a replaceState here rewrites the
     BOARD entry's URL to #play-, and the renderAll hash route
     would resurrect the play on the next data refresh).
     Outside the settled in-app flow (boot deep links, hash
     routes — keepHash) the old replace stands, now preserving
     history.state so a snapshot survives the hash write. */
  if (!opts.keepHash) {
    const pushed139 = typeof hhNavPush139 === "function" && hhNavPush139(typeof hhPlace139 === "function" ? hhPlace139() : null, `#play-${id}`);
    if (!pushed139) history.replaceState(history.state, "", `#play-${id}`);
  }
  wrap.querySelector(".play-detail-back")?.focus();
};
/* Round 148 (2026-11-13): the Round 140 watch-chrome state is
   declared HERE, above hidePlayDetail, on purpose. hidePlayDetail
   runs during boot() on the page-sub routes (showPanel is called
   by the boot router for /my-highlights, /how-it-works and
   /stories), and its teardownWatchChrome140 call reads these —
   when the declarations lived down in the Round 140 block (after
   boot in source order) the read hit the `let` TDZ, threw, and
   boot died before the panel toggled or loadData ran: the
   sub-pages rendered as the bare board chrome over a black void.
   The Round 140/143 functions themselves stay in their block. */
let watchChromeVideo140 = null;
let watchChromeOff140 = null;
/* Round 158 (2026-11-14, HOTFIX): the Battles audio leak —
   Emil, watching Nicholas's clip in Battles, tapped over to
   All videos and the battle kept playing; he could still hear
   it. Root cause, verified in the rig on the unmodified tree:
   NO view switch paused anything. switchView only toggled
   `hidden` (a display:none video keeps playing, sound and
   all), showPanel swapped panels the same way, and even
   hidePlayDetail left the detail's own video running behind
   the closed overlay. Seven driven paths leaked: Battles ->
   All, Battles -> Month, Battles -> detail open, Daily ->
   All, detail -> close, studio -> panel switch, detail ->
   browser Back.
   The invariant this round installs: ONLY THE VIEW YOU ARE
   LOOKING AT CAN MAKE SOUND. One sweep, pauseMediaIn158,
   called from every view-switch choke point — switchView
   (board tabs), showPanel (panels), openPlayDetail /
   hidePlayDetail (the watch overlay), btlPlayBig118 (a
   battle starting silences its sibling players), showHome
   (leaving the Store) — and browser Back rides the same
   functions through hhApply139, so popstate is covered by
   construction. PAUSE ONLY: currentTime and src are never
   touched, nothing auto-resumes; returning to a view finds
   its players paused where they were (the designed
   exceptions stay designed: showHome still restarts the
   hero when coming back from the Store, and the hero —
   ambient home chrome under its own Round 125 controller
   and the visitor's standing mute — lives outside every
   swept root and is never swept).
   What gets silenced inside a swept root (hhSilence158):
   anything playing that is not muted, plus the dedicated
   sound surfaces by structure — the .btl-player and
   .watch-player videos and the studio / story / store /
   feed films — muted or not, because those are watch
   surfaces a visitor unmutes. Muted previews (board and
   athlete tiles, battle minis, .vfill fills) are NOT
   silenced: they make no sound, and pausing them would
   freeze the board's living previews for no audible gain;
   a tile a visitor deliberately unmuted is caught by the
   not-muted rule like everything else.
   Declared HERE, with the Round 148 state, on purpose:
   hidePlayDetail and showPanel run during boot() on the
   page-sub routes, and these helpers must resolve from any
   call site in any order — plain function declarations, no
   state, every call site typeof-guarded like the house
   pattern, every element touch try/caught (the vm suites
   drive these functions against partial DOMs). */
function hhSilence158(el) {
  try {
    if (!el || el.paused) return false;
    if (!el.muted) return true;
    if (el.id === "hfVideo" || el.id === "storyVideo" || el.id === "swagVideo" || el.id === "hfStoreFilm" || el.id === "hfFeedFilm126" || el.id === "hfHomeFilm201") return true;
    if (typeof el.closest === "function" && (el.closest(".btl-player") || el.closest(".watch-player") || el.closest("#playDetail"))) return true;
    return false;
  } catch (e) { return false; }
}
function pauseMediaIn158(root, force, exceptRoot) {
  try {
    if (!root || typeof root.querySelectorAll !== "function") return;
    root.querySelectorAll("video, audio").forEach((el) => {
      try {
        if (exceptRoot && typeof exceptRoot.contains === "function" && exceptRoot.contains(el)) return;
        if (!force && !hhSilence158(el)) return;
        if (typeof el.pause === "function") el.pause();
      } catch (e) { /* one bad element never breaks a view switch */ }
    });
  } catch (e) { /* media hygiene is best-effort — navigation is not */ }
}
function hidePlayDetail() {
  teardownDetailAutoplay(); // Round 15: nothing advances in the background once closed
  if (typeof teardownWatchChrome140 === "function") teardownWatchChrome140(); // Round 140: no stray chrome fade timer past close
  /* Round 158: closing the watch view stops its player —
     the hidden overlay's video otherwise kept playing (and
     sounding) behind the board. Force: a muted-but-playing
     detail clip stops too; the next open re-renders the
     body anyway, so nothing here needs a resume path. */
  if (typeof pauseMediaIn158 === "function") pauseMediaIn158($("#playDetail"), true);
  /* Round 163: the featured showcase is paused at this choke
     point too — and it never resumes on its own here; the
     next Month entry restarts it (featEnter163). */
  if (typeof featPause163 === "function") featPause163();
  const wrap = $("#playDetail");
  if (wrap) wrap.hidden = true;
  document.body.classList.remove("detail-open");
  detailPlayId = null;
}
/* The explicit close affordances (← Back, backdrop, Escape): hide
   the detail AND drop its #play- hash, so a later data refresh
   can't resurrect a detail the visitor already closed. Panel
   navigation hides it via hidePlayDetail (in showPanel) without
   touching the hash — the #play- hashchange route reads the hash
   AFTER showPanel runs. */
window.closePlayDetail = () => {
  const was = detailPlayId;
  /* Round 139: when the current history entry is the one this
     detail pushed, the on-screen Back IS the browser Back —
     stepping back lands on the previous view through the same
     popstate path (a later Forward reopens the play). A detail
     on the visit's first entry (a shared #play- link) closes in
     place instead: Back there must still leave the site. */
  const st139 = (typeof history !== "undefined" && history.state && history.state.hh139) || null;
  if (was != null && st139 && st139.pushed && st139.place && st139.place.detail === was
      && typeof hhSettled139 !== "undefined" && hhSettled139
      && !(typeof hhRestoring139 !== "undefined" && hhRestoring139)) {
    history.back();
    return;
  }
  hidePlayDetail();
  if (was != null && (location.hash === `#play-${was}` || location.hash === `#watch-${was}`)) history.replaceState(history.state, "", "#top");
  if (typeof hhRecord139 === "function") hhRecord139();
};
$$("[data-detail-close]").forEach((el) => el.addEventListener("click", () => window.closePlayDetail()));
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && detailPlayId != null) window.closePlayDetail(); });
/* Shared-play links (#play-<id>) open the play's detail (Round 8):
   the overlay replaces Round 5's flash + scroll-to-card. Behind the
   detail, land on the board the play belongs to — the Month board
   for a contest entry, All Hypes for everything else (the old
   fallback's destination) — so closing the detail leaves the
   visitor somewhere sensible. A play that doesn't exist does
   nothing, as before. handledPlayHash makes the renderAll-driven
   calls idempotent: the hash is routed once, not on every refresh
   (the hashchange route resets it to force a fresh routing). */
function highlightSharedPlay() {
  /* Round 107: #watch-<id> is the watch view's own deep link and
     routes exactly like the original #play-<id> contract (which
     stays live — shares already in the wild carry it). */
  const pm = location.hash.match(/^#(?:play|watch)-(\d+)$/);
  if (!pm) { handledPlayHash = ""; return; }
  if (handledPlayHash === location.hash) return;
  handledPlayHash = location.hash;
  const id = Number(pm[1]);
  if (detailPlayId === id) return;
  const entry = (CONTEST.entries || []).find((p) => p.id === id);
  if (!entry && !ALL_PLAYS.some((p) => p.id === id)) return;
  switchView(entry ? "month" : "all");
  openPlayDetail(id, { keepHash: true, fresh: true });
}
/* Hall of Fame rows open the play's detail (Round 8, 2026-11-05):
   same destination as a shared link — leave the store, land on the
   plays panel, open the full card in the detail overlay (which
   sets the #play-<id> hash, the shared-link URL contract). */
window.goToPlayCard = (id) => {
  showHome();
  showPanel("plays");
  openPlayDetail(id);
};

/* Montage strips (Round 10, 2026-11-05): the homepage's three sport
   strips are real buttons — tapping one lands on All Hypes with the
   All-board sport filter set to that sport, through the same state
   the dropdown writes (allSport + syncFilterUI + renderAll2), so
   the dropdown, the board and the counts all agree afterwards. A
   sport with no plays falls back to "All sports" inside
   syncFilterUI, exactly as a stale dropdown selection does. */
window.goToSportBoard = (sport) => {
  showHome();
  showPanel("plays");
  allSport = sport;
  syncFilterUI();
  switchView("all");
  renderAll2();
  $("#viewAll")?.scrollIntoView({ behavior: "smooth", block: "start" });
};
/* Round 44 (2026-11-08): "See all plays" under the clips — the All
   Hypes view with NO sport change (the browse row's job), landing
   at the board head rather than mid-list. */
window.seeAllPlays = () => {
  showHome();
  showPanel("plays");
  switchView("all");
  renderAll2();
  $("#deck")?.scrollIntoView({ behavior: "smooth", block: "start" });
};

/* ---------------- athlete collection ---------------- */
window.openAthlete = async (athleteId) => {
  showPanel("athlete");
  if (typeof hhSetAthlete139 === "function") hhSetAthlete139(athleteId);
  /* Round 139: the athlete page gets its own history entry,
     pushed with its #athlete- hash as the URL (the play
     detail's pattern) — browser Back returns to the view the
     visitor came from. Boot deep links keep the replace. */
  const pushed139 = typeof hhNavPush139 === "function" && hhNavPush139(typeof hhPlace139 === "function" ? hhPlace139() : null, `#athlete-${athleteId}`);
  if (!pushed139) history.replaceState(history.state, "", `#athlete-${athleteId}`);
  try {
    const d = await api(`/api/highlights?division=all&athlete_id=${encodeURIComponent(athleteId)}&voterToken=${voterToken}`);
    const plays = d.highlights || [];
    const first = plays[0];
    const label = first ? (first.athlete_label || first.player_name || "Athlete") : "Athlete";
    $("#athleteAvatar").textContent = (label || "?")[0].toUpperCase();
    $("#athleteName").textContent = label;
    const meta = [];
    if (first?.jersey) meta.push("#" + first.jersey);
    if (first?.team) meta.push(first.team);
    if (first) meta.push(first.division === "girls" ? "Girls" : "Boys");
    if (first?.athlete_tag) meta.push(first.athlete_tag);
    $("#athleteMeta").textContent = meta.join(" · ");
    $("#athleteCount").textContent = plays.length;
    /* Round 172: the header's Share button always names the
       athlete on screen — shareAthlete reads this stamp. */
    const shareBtn172 = $("#athleteShareBtn");
    if (shareBtn172) shareBtn172.dataset.athleteId = athleteId;
    $("#athleteBoard").innerHTML = plays.map((h) => cardHtml(h, { numbers: true })).join("");
    $("#athleteEmpty").style.display = plays.length ? "none" : "block";
  } catch (e) { $("#athleteEmpty").textContent = "Could not load this athlete's plays: " + e.message; $("#athleteEmpty").style.display = "block"; }
  document.getElementById("athlete").scrollIntoView({ behavior: "smooth" });
};

/* ---------------- panels / menu / store ---------------- */
const menuBtn = $("#menuBtn"), navMenu = $("#navMenu");
function closeMenu(focusBack = true) { navMenu.hidden = true; menuBtn.setAttribute("aria-expanded", "false"); if (focusBack) menuBtn.focus(); }
menuBtn.addEventListener("click", () => { const open = navMenu.hidden; navMenu.hidden = !open; menuBtn.setAttribute("aria-expanded", String(open)); });
document.addEventListener("click", (e) => { if (!navMenu.hidden && !e.target.closest(".nav")) closeMenu(false); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !navMenu.hidden) closeMenu(); });
/* Round 125 (2026-11-13): the ☰ menu's Hype Frame entry — the
   studio's generic front door since Round 86 (sample clip into
   the studio, or your own video into the form). */
$("#menuHf125")?.addEventListener("click", () => { closeMenu(false); openHfChoice(); });
/* Round 222: the menu's Post a Play entry — the header pill
   stands down while the studio is open, so the upload entry
   rides in the menu (same goSubmit as the pill + the FAB). */
$("#menuPost222")?.addEventListener("click", () => { closeMenu(false); goSubmit(); });
function showPanel(name) {
  // Any panel navigation leaves the play detail behind (Round 8):
  // the overlay belongs to the boards, and panels (athlete, studio,
  // store…) replace the view. hidePlayDetail leaves the hash alone —
  // the #play- route reads it after showPanel runs.
  hidePlayDetail();
  /* Round 214: remember whether the studio was the panel being
     left — the media block below needs the pre-toggle state. */
  const wasStudio214 = !!(document.body && document.body.classList && typeof document.body.classList.contains === "function" && document.body.classList.contains("hf-studio-open205"));
  /* Round 205 (2026-11-26, Emil): while the Hype Frame studio is
     the active panel, the floating Post a Play pill stands down —
     it parked over the studio's own controls (the Avatar option,
     the send button). styles.css hides it under
     body.hf-studio-open205, the body.store-open / body.upload-open
     pattern; the pill itself and its menu entry are untouched. */
  if (document.body && document.body.classList && typeof document.body.classList.toggle === "function") document.body.classList.toggle("hf-studio-open205", name === "hypeframe");
  $$(".panel[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  $$("[data-panel-btn]").forEach((b) => { if (b.dataset.panelBtn) b.setAttribute("aria-current", String(b.dataset.panelBtn === name)); });
  /* Round 158: a panel switch is a view change — the panels
     left behind fall silent (the studio's clip when leaving
     the studio, the story episode, the boards), the newly
     active panel's media untouched. */
  if (typeof pauseMediaIn158 === "function") $$(".panel[data-panel]").forEach((p) => { if (p.dataset.panel !== name) pauseMediaIn158(p, false); });
  /* Round 163: a panel switch leaves the boards behind — the
     featured showcase pauses with them; returning to the plays
     panel re-enters it when Month is the live board view
     (featEnter163 gates on that itself). */
  if (name === "plays") { if (typeof featEnter163 === "function") featEnter163(); }
  else if (typeof featPause163 === "function") featPause163();
  /* Round 214 (2026-11-26, Emil): the studio stands alone — entering
     it silences the home films with the same sweep showStore uses
     (the stack itself is hidden by styles.css under the Round 205
     body class), and leaving it for any other panel restarts the
     hero under the standing Round 125 preference (music ON unless
     the visitor muted it — hh_music), exactly as showHome does, so
     the hero never stays dead after a studio visit. The Store keeps
     its own entry/exit handling: a studio → Store hop is paused by
     showStore and resumed on the way back through showPanel, and
     the store-open gate keeps this block out of that path. */
  if (name === "hypeframe") { $$(".view-home video").forEach((v) => v.pause()); }
  else if (wasStudio214 && !(document.body && document.body.classList && document.body.classList.contains("store-open"))) {
    const hv214 = $("#heroVideo");
    if (hv214) { /* Round 233: same connection pick + held gate as showHome. */ if (!((typeof heroHeld233 === "function") && heroHeld233(hv214))) { if (hv214.dataset && !hv214.getAttribute("src")) { const u214 = (typeof heroFilmUrl233 === "function") ? heroFilmUrl233(hv214) : hv214.dataset.src; if (u214) hv214.src = u214; } hv214.muted = (typeof hhStorageGet === "function") ? hhStorageGet("hh_music") === "off" : false; const p214 = hv214.play(); if (p214 && p214.catch) p214.catch(() => {}); } }
  }
  // Site stats: count the MAIN views only. Athlete pages and the
  // Hype Frame studio are steps inside a visit, not front doors, so
  // they are deliberately not counted as views.
  const viewKey = { plays: "home", mine: "mine", how: "how" }[name];
  if (viewKey && typeof trackEvent === "function") trackEvent("view", viewKey);
  /* Round 139: a panel switch is a place — record it. */
  if (typeof hhRecord139 === "function") hhRecord139();
}
$$("[data-panel-btn]").forEach((b) => b.addEventListener("click", () => { showHome(); closeMenu(false); if (location.hash.startsWith("#hype-frame")) history.replaceState(history.state, "", "#top"); showPanel(b.dataset.panelBtn); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));
/* Round 51 (2026-11-08): #menuAllHypes is a real link (/?view=all)
   now — no click handler; the boot router applies the view. */
/* Round 94 (2026-11-10, Emil): three tabs — Watch / Battles /
   Hype of the Month. The Hall of Fame is the Month tab's All-time
   sub-view (monthSub), and the division segs ride the pill row;
   switchView drives their visibility. */
let monthSub = "month";
function setMonthSub(s) { monthSub = s === "fame" ? "fame" : "month"; switchView("month"); }
function switchView(v) {
  if (v === "fame") { monthSub = "fame"; v = "month"; }
  currentView = v;
  $$(".viewseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  const fame = v === "month" && monthSub === "fame";
  /* Round 232 (2026-11-27): #viewFame is retired from the markup
     (the Hall of Fame is the homepage leaderboard's second tab
     now). Guarded writes; and when a fame sub-state is asked
     for but no Fame panel exists, the Month (banner) view
     shows instead of a blank board — a stale saved place or
     the feed's old Leaderboard landing can never strand the
     visitor on an empty panel. */
  const vfEl232 = $("#viewFame");
  const vmEl232 = $("#viewMonth"); if (vmEl232) vmEl232.hidden = v !== "month" || (fame && !!vfEl232);
  if (vfEl232) vfEl232.hidden = !fame;
  $("#viewAll").hidden = v !== "all";
  $$(".month-subseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.msub === monthSub)));
  /* Round 132: the Boys/Girls seg no longer shows on the Month
     tab (one combined contest — see renderMonth), so it stays
     hidden on every view; the element, the monthDiv state and
     its button wiring remain in place, dormant. The Watch
     view's own seg (#allDivSeg, next line) is unchanged. */
  const mSeg94 = $("#monthDivSeg"); if (mSeg94) mSeg94.hidden = true;
  const aSeg94 = $("#allDivSeg"); if (aSeg94) aSeg94.hidden = v !== "all";
  /* Round 162: the lane toggle is a Watch-board filter — its
     row follows the same visibility rule as the Watch seg. */
  const laneRow162 = $("#laneRow162"); if (laneRow162) laneRow162.hidden = v !== "all";
  const viewBattlesEl = $("#viewBattles"); if (viewBattlesEl) viewBattlesEl.hidden = v !== "battles";
  const chip125 = $("#chipMonth"); if (chip125) chip125.style.display = v === "month" ? "" : "none";
  /* Round 107: the contest strip belongs to the Watch feed only —
     Battles and the Month panel carry their own headers.
     Round 123: the strip MOVED into the Month panel — it now
     shows on the Month view (the fame sub-view hides the whole
     panel, strip included), and the slim one-line replacement
     (#contestSlim123) takes the old Watch-only rule. */
  const cs107 = $("#contestStrip"); if (cs107) cs107.hidden = v !== "month";
  const csSlim123 = $("#contestSlim123"); if (csSlim123) csSlim123.hidden = v !== "all";
  /* Round 133 (2026-11-13): the board section's crowd-photo
     backdrop (.board-bg) is switched OFF on the Month view.
     The Month tab is a text surface — gold strip, prize line,
     leaderboard rows — and the photo smeared behind all of it
     read as a stray image behind everything (Emil: "what is
     also that image behind everything"). With it off, the tab
     rests on #plays' plain dark gradient. "fame" normalizes
     to "month" at the top of this function, so the Hall of
     Fame sub-view is covered; Watch and Battles restore the
     backdrop exactly as before. */
  const bb133 = $(".board-bg"); if (bb133) bb133.style.display = v === "month" ? "none" : "";
  /* Round 134 (2026-11-13): the shared header sport dropdown
     leaves the top of the Month tab — the Leaderboard heading
     row carries the Month board's own dropdown now (Emil's
     mockup: "the clip appears sooner"). It hides for the whole
     Month view (the Hall of Fame sub-view included — its own
     heading carries a dropdown on the same shared state) and
     restores exactly as before on Watch and Battles, whose
     filtering still runs through it. */
  const dd134 = $(".sport-dd125"); if (dd134) dd134.style.display = v === "month" ? "none" : "";
  const seeAllRow = $("#seeAllRow"); if (seeAllRow) seeAllRow.hidden = v === "all";
  /* Round 125: the board's heading band is gone (Dyanna: the
     page IS the board), so the title/intro writes land only if
     the elements ever come back — guarded, never required. */
  const bt125 = $("#boardTitle"); if (bt125) bt125.innerHTML = v === "month" ? (fame ? `Hall of <span class="lime">Fame</span>` : `Hype of the Month`) : v === "battles" ? `Hype <span class="lime">Battles</span>` : `All <span class="lime">Hypes</span>`;
  /* Round 69 (2026-11-09, Emil): each board tab explains itself. */
  const bi125 = $("#boardIntro"); if (bi125) bi125.textContent = v === "month" ? (fame ? "The most-voted plays of all time." : "Post a play with the contest box checked — it's in once approved. Your votes crown the winner.") : v === "battles" ? "Two plays go head to head. Which Play Wins?" : "Watch plays from every sport.";
  if (v === "battles" && typeof initBattles === "function") initBattles();
  /* Round 158: a board-tab switch is a view change — the
     views left behind fall silent (Emil's Battles leak: the
     big battle player kept sounding under All videos). The
     newly active view's media is untouched: its muted
     previews keep previewing, its featured clip keeps its
     state. The hero is home chrome, outside every board
     view, and is not swept here. */
  if (typeof pauseMediaIn158 === "function") {
    const active158 = v === "all" ? "#viewAll" : v === "battles" ? "#viewBattles" : (fame ? "#viewFame" : "#viewMonth");
    ["#viewAll", "#viewMonth", "#viewFame", "#viewBattles"].forEach((sel) => { if (sel !== active158) pauseMediaIn158($(sel), false); });
  }
  /* Round 163: the featured showcase rides the same switch —
     entering the Month view starts it (muted + looping);
     leaving for any other view pauses it EXPLICITLY, because
     the sweep above skips muted previews by design and the
     playing showcase has exactly that shape. */
  if (v === "month" && !fame) { if (typeof featEnter163 === "function") featEnter163(); }
  else if (typeof featPause163 === "function") featPause163();
  /* Round 139: a board-view switch is a place — record it. */
  if (typeof hhRecord139 === "function") hhRecord139();
}
$$(".viewseg button").forEach((b) => b.addEventListener("click", () => { switchView(b.dataset.view); scrollBoardIntoView122(); }));
/* Round 122 (2026-11-12): a board tab tap takes you TO the board.
   The youth-agent test tapped Battles, watched the hero sit still
   (the panels swap far below it), and concluded nothing happened.
   Skip only when the board is already PARKED at its scroll-margin
   position — "somewhere on screen" isn't enough, because the
   panels render well below the section top and can still sit
   under the fold. (The rig's first pass caught exactly that.) */
function scrollBoardIntoView122() {
  const el = document.getElementById("plays");
  if (!el || typeof el.getBoundingClientRect !== "function") return;
  const go = () => {
    const r = el.getBoundingClientRect();
    let parked = 76;
    try { parked = parseFloat(getComputedStyle(el).scrollMarginTop) || 76; } catch { /* keep the default */ }
    if (Math.abs(r.top - parked) <= 12) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(go); else go();
}
/* ================= Round 139 (2026-11-13): in-app history ====
   Emil: "When on a page and I click the browser back button it
   takes me to the swag store." The mechanism: this app never
   called pushState and had no popstate listener — every in-app
   view switch (board tabs, panels, the Store overlay, the
   studio) mutated the DOM only, and the deep-link routes wrote
   their hashes with replaceState, so in-app browsing recorded
   NO history at all. The Store is also a real page (the header
   and ☰ menu link plainly to /store, and coming home from it
   is a real navigation), so a session that touched /store had
   it sitting in the tab's history — and the first browser Back
   from anywhere in the app popped straight back to it.
   The fix is a small place model at the existing chokepoints:
   switchView / showPanel / showStore / showHome schedule a
   coalesced record (one push per user action, snapshotted from
   live state at flush time); the three hash-writing opens
   (play detail, athlete, studio) push their own entry
   synchronously WITH their hash as the entry's URL, before a
   replaceState can rewrite the previous entry's URL; popstate
   re-applies the recorded place through the same functions.
   While boot settles, records only re-snapshot the first entry
   (replaceState) — Back from a fresh visit's first view still
   leaves the site. Every legacy replaceState now preserves
   history.state, so a snapshot survives a hash rewrite. */
let hhSettled139 = false;
let hhRestoring139 = false;
let hhSuppressHash139 = false;
let hhCurrentPlace139 = null;
let hhRecordQueued139 = false;
let hhStoreTarget139 = null;
let hhAthleteId139 = null;
function hhSetStoreTarget139(t) { hhStoreTarget139 = t || null; }
function hhSetAthlete139(id) { hhAthleteId139 = id || null; }
function hhPlace139(over) {
  let panel = "plays";
  try {
    const act = document.querySelector(".panel.active");
    if (act && act.dataset && act.dataset.panel) panel = act.dataset.panel;
  } catch (e) { /* keep the default */ }
  const place = {
    panel,
    view: typeof currentView === "string" && currentView ? currentView : "all",
    msub: typeof monthSub === "string" && monthSub ? monthSub : "month",
    store: !!(document.body && document.body.classList && document.body.classList.contains("store-open")),
    storeTarget: hhStoreTarget139 || null,
    detail: typeof detailPlayId === "number" ? detailPlayId : null,
    hf: panel === "hypeframe" && typeof hfState !== "undefined" && hfState && hfState.play ? hfState.play.id : null,
    athlete: panel === "athlete" ? hhAthleteId139 || null : null,
  };
  if (over) Object.assign(place, over);
  return place;
}
function hhEq139(a, b) {
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
}
function hhRecord139() {
  if (hhRecordQueued139) return;
  hhRecordQueued139 = true;
  const run = () => { hhRecordQueued139 = false; hhFlush139(); };
  if (typeof queueMicrotask === "function") queueMicrotask(run);
  else if (typeof Promise !== "undefined") Promise.resolve().then(run);
  else run();
}
function hhFlush139() {
  try {
    if (hhRestoring139) { hhCurrentPlace139 = hhPlace139(); return; }
    const place = hhPlace139();
    if (!hhSettled139) {
      history.replaceState({ hh139: { place, pushed: false } }, "");
      hhCurrentPlace139 = place;
      return;
    }
    if (hhCurrentPlace139 && hhEq139(place, hhCurrentPlace139)) return;
    history.pushState({ hh139: { place, pushed: true } }, "");
    hhCurrentPlace139 = place;
  } catch (e) { /* history is an enhancement — never break navigation */ }
}
/* Synchronous push for the hash-writing opens: the entry must
   exist BEFORE the open rewrites the hash, and it carries the
   hash as its own URL, so the previous entry keeps its URL. */
function hhNavPush139(place, url) {
  try {
    if (!place || !hhSettled139 || hhRestoring139) return false;
    if (hhCurrentPlace139 && hhEq139(place, hhCurrentPlace139)) return false;
    history.pushState({ hh139: { place, pushed: true } }, "", url);
    hhCurrentPlace139 = place;
    return true;
  } catch (e) { return false; }
}
function hhApply139(place) {
  hhRestoring139 = true;
  hhSuppressHash139 = true;
  setTimeout(() => { hhRestoring139 = false; hhSuppressHash139 = false; }, 0);
  try {
    if (place.store) showStore(place.storeTarget || null);
    else showHome();
    if (place.panel === "hypeframe" && place.hf != null) openHypeFrame(place.hf);
    else if (place.panel === "athlete" && place.athlete) openAthlete(place.athlete);
    else showPanel(place.panel);
    if (place.panel === "plays") {
      if (place.view === "month") setMonthSub(place.msub);
      else { monthSub = place.msub === "fame" ? "fame" : "month"; switchView(place.view); }
    }
    if (place.detail != null) openPlayDetail(place.detail, { keepHash: true });
    else if (typeof detailPlayId === "number") hidePlayDetail();
  } catch (e) { /* a failed restore leaves the current view — never a blank page */ }
  hhCurrentPlace139 = place;
  hhRecord139();
}
function hhSettle139() {
  if (hhSettled139) return;
  hhSettled139 = true;
  try {
    const place = hhPlace139();
    history.replaceState({ hh139: { place, pushed: false } }, "");
    hhCurrentPlace139 = place;
  } catch (e) { /* as above */ }
}
function hhBoot139() {
  hhRecord139();
  setTimeout(() => { hhSettle139(); }, 6000);
}
if (typeof window !== "undefined" && window && typeof window.addEventListener === "function") {
  window.addEventListener("popstate", (e) => {
    const st139 = e && e.state && e.state.hh139;
    if (st139 && st139.place) { hhApply139(st139.place); return; }
    /* A same-document entry without a Round 139 snapshot:
       resync the tracker to the live view under the restoring
       flag — a pop must never turn into a push. */
    hhRestoring139 = true;
    hhSuppressHash139 = true;
    setTimeout(() => { hhRestoring139 = false; hhSuppressHash139 = false; }, 0);
    hhRecord139();
  });
}
/* Round 137 (2026-11-13): an msub tap re-parks the board,
   exactly like a board tab tap (Round 122 wiring, above).
   The sub-view switch alone never scrolled: Emil, down at
   the Month tab's text tabs, tapped Hall of Fame and landed
   mid-list — the tall Month content above the tabs (banner +
   featured card) left the layout, the page shrank, and the
   browser kept/clamped his scroll depth inside the shorter
   Fame panel, past its heading block. switchView is
   synchronous and scrollBoardIntoView122 measures on the
   next frame, so the parked landing is measured against the
   final layout in both directions. */
$$(".month-subseg button").forEach((b) => b.addEventListener("click", () => { setMonthSub(b.dataset.msub); scrollBoardIntoView122(); }));
/* Round 35 (2026-11-07): two-stage store-entry scroll. The store
   flips from display:none and its images keep loading in, which can
   cancel or strand a lone smooth scroll — the usability audit caught
   the Hype Girls entry landing at the store top instead of the NEXT
   DROP teaser, while the near-top Boys grid target survived. Scroll
   smooth first; shortly after, if the target still isn't on screen,
   jump straight to it. */
function scrollToStoreEl(el) {
  setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  setTimeout(() => {
    const r = el.getBoundingClientRect();
    if (r.top > window.innerHeight || r.bottom < 0) el.scrollIntoView({ behavior: "auto", block: "start" });
  }, 800);
}
function showStore(target) {
  if (typeof trackEvent === "function") trackEvent("view", "store");
  document.body.classList.add("store-open");
  window.scrollTo(0, 0);
  $$(".view-home video").forEach((v) => v.pause());
  /* Round 163: the featured showcase pauses as the Store
     opens — named explicitly at this choke point (the blanket
     pause above already reaches it; the round keeps its
     pause points explicit rather than incidental). */
  if (typeof featPause163 === "function") featPause163();
  const sv = $("#swagVideo");
  if (sv) {
    // Round 9 (2026-11-05): the film HAS quiet sound again (Nicholas
    // asked for sound; owner approved). Round 10 tried a stadium
    // crowd bed; Round 11 (2026-11-05) reverted to the quiet music
    // bed at Nicholas's verdict — he didn't like the crowd. Browsers only allow
    // muted autoplay, so every store entry (re)starts muted and the
    // speaker toggle below the film is the unmute path; its label
    // syncs off the muted state.
    sv.muted = true;
    const p = sv.play(); if (p && p.catch) p.catch(() => {});
  }
  // Round 27 (2026-11-06): the division blocks are gone from the
  // store, so the homepage entry card's #hype-girls / #hype-boys
  // links land on the new sections instead — Girls scrolls to the
  // NEXT DROP teaser (where the Hot Pink Hype Street hoodie lives),
  // Boys to the Hype Sports grid. Other targets scroll as before.
  const storeTargetEl = target === "hype-girls" ? document.getElementById("hsTeaser")
    : target === "hype-boys" ? document.getElementById("hsGridSection")
    : target ? document.getElementById(target) : null;
  if (storeTargetEl) scrollToStoreEl(storeTargetEl);
  /* Round 139: entering the Store is a place — record it (and
     remember the target so a history restore lands on the
     same section). */
  if (typeof hhSetStoreTarget139 === "function") hhSetStoreTarget139(target || null);
  if (typeof hhRecord139 === "function") hhRecord139();
}
function showHome() {
  setStoreFocus(null);
  /* Round 139: leaving the Store is a place change — record it
     (the flush dedupes when the store wasn't open). */
  if (typeof hhRecord139 === "function") hhRecord139();
  if (!document.body.classList.contains("store-open")) return;
  document.body.classList.remove("store-open");
  /* Round 158: leaving the Store silences the Store's own
     films (the swag film, the store's Hype Frame film) —
     showStore already pauses every home video on the way
     in; this is the symmetric half. Force: neither film is
     a preview, and showStore restarts the swag film muted
     on entry by design. */
  if (typeof pauseMediaIn158 === "function") pauseMediaIn158($("#shop"), true);
  if (location.hash === "#shop") history.replaceState(history.state, "", "#top");
  /* Round 125 (2026-11-13, Dyanna): returning home restarts the
     hero at the visitor's standing sound preference — music ON
     unless they muted it themselves (hh_music, kept by the
     Round 2 storage helper). Round 98's always-muted restart is
     retired: by the time a visitor comes back from the Store
     they have interacted with the page, so an unmuted start is
     allowed, and a rejection just leaves it muted until the
     next tap. The typeof guard keeps this block runnable in
     isolation (the Round 26 behavioral suite drives showHome
     in a vm without the storage helper in scope). */
  /* Round 214: while the studio is the active panel the hero is
     hidden (styles.css) and must NOT restart here — showPanel
     owns the hero's resume on studio exit. Every caller that
     pairs showHome with a panel switch is unaffected: showPanel
     runs immediately after and performs the resume. */
  const hv = $("#heroVideo"); if (hv && !document.body.classList.contains("hf-studio-open205")) { /* Round 233: the resume routes through the connection pick and respects a held (tap-class, not yet tapped) hero. */ if (!((typeof heroHeld233 === "function") && heroHeld233(hv))) { if (hv.dataset && !hv.getAttribute("src")) { const u233 = (typeof heroFilmUrl233 === "function") ? heroFilmUrl233(hv) : hv.dataset.src; if (u233) hv.src = u233; } hv.muted = (typeof hhStorageGet === "function") ? hhStorageGet("hh_music") === "off" : false; const p = hv.play(); if (p && p.catch) p.catch(() => {}); } }
  /* Round 48 (2026-11-08): the old homepage-film resume is retired —
     the homepage Hype Frame film is click-to-play now (Emil: no
     autoplay competing with the hero), so returning home must NOT
     start it. The studio film still resumes on studio open. */
  // Round 11 fix (2026-11-05): showStore() pauses the montage clips
  // too, and nothing resumed them — after one Store visit the three
  // sport strips froze on their posters for the rest of the session.
  $$(".montage video").forEach((v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
  /* Round 163: coming home from the Store re-enters the live
     board view — if that is the Month view, its featured
     showcase restarts muted alongside the hero (featEnter163
     gates on the view itself). */
  if (typeof featEnter163 === "function") featEnter163();
}
/* Round 48 (2026-11-08): the homepage Hype Frame film was
   click-to-play — playHfHomeFilm swapped its cover for the
   film. Round 125 (2026-11-13): the homepage Hype Frame
   section is gone (see index.html), so the function left
   with it; the studio's own film wiring is separate and
   untouched. */
/* Round 11 (2026-11-05): the montage clips keep themselves honest —
   play while at least ~25% of a strip is on screen, pause when it
   scrolls away. A clip whose autoplay stalled (or that a Store visit
   paused) restarts when it scrolls back into view instead of sitting
   on its poster; off-screen clips stop burning CPU. */
function watchMontageVideos() {
  if (typeof IntersectionObserver === "undefined") return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (e.intersectionRatio >= 0.25) { const p = e.target.play(); if (p && p.catch) p.catch(() => {}); }
      else e.target.pause();
    });
  }, { threshold: [0, 0.25] });
  $$(".montage video").forEach((v) => io.observe(v));
}
watchMontageVideos();
/* One home reset for every logo / home link (2026-11-04): leave the
   store, land on the plays board, scroll to the top, and drop a stale
   Hype Frame deep link so it can't reopen the studio. */
function goHome() {
  /* Round 51 (2026-11-08): from a real sub-page (/my-highlights,
     /how-it-works, /store), "home" is a real navigation — a panel
     switch there would surface the board under the wrong URL. */
  if (location.pathname.replace(/\/+$/, "") !== "") { location.href = "/"; return; }
  showHome();
  showPanel("plays");
  /* Round 132 (2026-11-13): the logo is the way back to the
     board from ANY tab — activate the Watch view. Before, the
     tap only scrolled: from the Month tab the Month panel
     stayed on screen, so the tap read as dead there. */
  switchView("all");
  /* Round 181 (2026-11-14, Emil): "When you click the
     highlighthype in the header when on another page it
     doesn't bring you to the top." The R132 landing parked at
     the BOARD (scrollBoardIntoView122) — below the hero — so
     from any other view the tap landed mid-page, not at the
     top. The logo means the TOP of the homepage (this reset's
     original 2026-11-04 contract): scroll to 0, now and again
     on the next frame so a settling layout can't strand the
     landing. Back keeps its Round 139 restore — only the
     logo resets. A deep-link hash that would resurrect a
     view on the next data refresh (a play, an athlete, the
     studio) is dropped to #top — the closePlayDetail
     precedent — and the R139 record then pushes the board
     entry wearing the clean URL. */
  window.scrollTo(0, 0);
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => window.scrollTo(0, 0));
  if (location.hash.startsWith("#hype-frame") || /^#(?:play|watch)-\d+$/.test(location.hash) || location.hash.startsWith("#athlete-")) history.replaceState(history.state, "", "#top");
}
$$("[data-store-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); closeMenu(false); showStore(a.dataset.storeTarget || null); }));
$$("[data-home-link]").forEach((b) => b.addEventListener("click", () => goHome()));
/* Round 132: preventDefault — the anchor's href="#top" jump
   targets the hero and would override goHome's landing
   a beat later; goHome alone decides where a logo tap lands
   (→181: that landing is the page top — see goHome). */
$$(".brand").forEach((b) => b.addEventListener("click", (e) => { e.preventDefault(); goHome(); }));
window.addEventListener("hashchange", () => {
  /* Round 139: a hashchange that arrives with a history
     traversal belongs to the popstate handler — the snapshot
     being restored already describes the destination, and
     re-routing the hash here would fight the restore. */
  if (typeof hhSuppressHash139 !== "undefined" && hhSuppressHash139) return;
  if (location.hash === "#post") goSubmit();
  if (location.hash === "#shop") showStore();
  /* Round 108: same-page #stories navigation opens the panel. */
  if (location.hash === "#stories") { showHome(); closeMenu(false); showPanel("stories"); window.scrollTo(0, 0); }
  if (location.hash === "#hype-girls" || location.hash === "#hype-boys") showStore(location.hash.slice(1));
  const hm = location.hash.match(/^#hype-frame-(\d+)$/);
  if (hm) openHypeFrame(Number(hm[1]));
  const pm = location.hash.match(/^#play-(\d+)$/);
  if (pm) { showHome(); showPanel("plays"); handledPlayHash = ""; highlightSharedPlay(); }
});
function goSubmit() {
  showHome(); closeMenu(false); showPanel("plays"); switchView("month");
  /* Round 22 (2026-11-06) opened the form as a full-screen
     overlay on phones only (styles.css: body.upload-open turns
     #uploadForm into a fixed, independently scrolling layer);
     desktops kept the in-page form and an anchor scroll to it.
     Round 24 (2026-11-06) removes the width branch entirely:
     feedback item 5 ("reduce homepage length") takes the form
     OUT of the page flow at every width (styles.css holds it
     display:none until body.upload-open), so the overlay is
     the only way in, on every screen. */
  openUploadOverlay();
}
/* Round 22: the overlay is the SAME form node — never cloned or
   duplicated — so a half-filled form keeps every field (and the
   picked clip) across open/close. upload-used persists after the
   first open: it retires the plays panel's entry animation, whose
   fill-both transform would otherwise become the fixed form's
   containing block and trap it inside the panel instead of the
   viewport (and would replay the panel fade on every close).
   Round 62c (2026-11-08): on iOS the form STILL rendered as a
   blurred, ghosted layer inside the panel (Emil, Safari +
   in-app browser) — an animated/filtered ancestor was poisoning
   the fixed layer despite upload-used. The robust fix: while the
   overlay is open the form node is reparented to <body> (moved,
   not cloned — field state survives), and restored to its exact
   original spot on close. No ancestor can trap it at body level. */
let uploadHomeSpot = null;
function openUploadOverlay() {
  const f = document.getElementById("uploadForm");
  try {
    if (f && f.parentNode !== document.body) {
      uploadHomeSpot = document.createComment("upload-form-home");
      f.parentNode.insertBefore(uploadHomeSpot, f);
      document.body.appendChild(f);
    }
  } catch (_) { /* sandboxes without a full DOM skip the move */ }
  document.body.classList.add("upload-open", "upload-used");
  if (f) f.scrollTop = 0;
}
function closeUploadOverlay() {
  document.body.classList.remove("upload-open");
  const f = document.getElementById("uploadForm");
  try {
    if (f && uploadHomeSpot && uploadHomeSpot.parentNode) {
      uploadHomeSpot.parentNode.insertBefore(f, uploadHomeSpot);
      uploadHomeSpot.remove();
    }
  } catch (_) { /* same guard as open */ }
  uploadHomeSpot = null;
}
$("#floatSubmit").addEventListener("click", goSubmit);
/* Round 11 (2026-11-05) hid the pill while the in-page form was
   on screen — an observer faded it out, because its fixed perch
   landed on the form's Girls toggle at phone widths and ate the
   tap. Round 24 (2026-11-06) RETIRES that observer and its fade
   rule: the form is no longer in the page flow at any width, so
   there is nothing in-flow left to watch — a display:none target
   would never intersect, and the observer would be dead weight
   running against a hidden element. The pill's visibility is
   purely state-driven now: visible whenever the overlay is
   closed, hidden while body.upload-open (styles.css) — the same
   end state phones have had since Round 22. */
$$("[data-submit-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); goSubmit(); }));
/* Round 22: the overlay's ✕ and the Escape key close it. Closing
   only drops body.upload-open — the form (and anything typed or
   picked in it) stays exactly as it was. Round 24: the handler
   was never width-scoped, so Escape now closes the overlay at
   every width — before, the overlay simply never opened on
   desktop for it to close. */
$("#uploadClose")?.addEventListener("click", closeUploadOverlay);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && document.body.classList.contains("upload-open")) closeUploadOverlay(); });
$$("[data-tablink]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showHome(); showPanel(a.dataset.tablink); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));

/* ---------------- filters ---------------- */
// Sport filters are DYNAMIC (Emil, 2026-11-04): "All sports" plus one
// entry per sport that actually has plays in the data behind that
// view — the month filter follows this month's contest entries (for
// the selected board), the All Hypes filter follows every approved
// play (for the selected board). No plays in a sport = no entry.
// Round 5 (2026-11-05): the entries moved from pill rows into native
// <select> dropdowns (one per board view) to give the homepage its
// vertical space back — native on purpose, so iOS opens its own
// reliable picker. Same options, same per-view state, same filtering.
function sportsInData(plays) {
  const present = new Set(plays.map((h) => h.sport).filter(Boolean));
  return SPORTS.filter((s) => present.has(s));
}
function renderSportSelect(el, current, sports, cb) {
  el.innerHTML = [`<option value="all"${current === "all" ? " selected" : ""}>All sports</option>`,
    ...sports.map((s) => `<option value="${s}"${current === s ? " selected" : ""}>${cap(s)}</option>`)].join("");
  el.value = current;
  el.onchange = () => cb(el.value);
}
function syncFilterUI() {
  // Fall back to "All sports" when the selected sport has no plays left
  // in the current data (its option is gone, so the filter must not stick).
  /* Round 132: the Month sport list derives from ALL contest
     entries — the division no longer narrows the contest
     (see renderMonth), so a sport whose entries are all in the
     "other" division must not vanish from the dropdown. */
  const monthSports = sportsInData(CONTEST.entries || []);
  if (monthSport !== "all" && !monthSports.includes(monthSport)) monthSport = "all";
  /* Round 179 (2026-11-14, the girl tester's #1 fix): the board
     sport list derives from ALL plays, exactly like the Round 132
     month fix — it used to derive from the plays matching the
     current DIVISION, so picking Softball and then tapping Boys
     or Girls silently reset the sport to All Sports and showed
     baseball. Sport and division now compose: changing one never
     clears the other, and an empty combination is just an empty
     board. The fallback below only fires when the sport has no
     plays left ANYWHERE (its option is truly gone). */
  const allSports = sportsInData(ALL_PLAYS);
  if (allSport !== "all" && !allSports.includes(allSport)) allSport = "all";
  /* Round 232 (2026-11-27): #monthSportSelect and #fameSportSelect
     are retired with the board's leaderboard — both contest
     selects are guarded renders now (no-ops in the shipped
     page; the shared monthSport state itself is unchanged). */
  const msEl232 = $("#monthSportSelect"); if (msEl232) renderSportSelect(msEl232, monthSport, monthSports, (s) => { monthSport = s; syncFilterUI(); renderMonth(); });
  /* Round 134: the Hall of Fame's dropdown is the SAME shared
     contest sport state (monthSport, the same contest-derived
     option list) — picking a sport in either contest surface
     filters both, and the Fame list re-renders on the change. */
  const fsEl232 = $("#fameSportSelect"); if (fsEl232) renderSportSelect(fsEl232, monthSport, monthSports, (s) => { monthSport = s; syncFilterUI(); renderFame(); });
  renderSportSelect($("#allSportSelect"), allSport, allSports, (s) => { allSport = s; syncFilterUI(); renderAll2(); });
  $$("#monthDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === monthDiv)); b.onclick = () => { monthDiv = b.dataset.div; syncFilterUI(); renderMonth(); }; });
  $$("#allDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === allDiv)); b.onclick = () => { allDiv = b.dataset.div; syncFilterUI(); renderAll2(); }; });
  /* Round 162: the lane toggle mirrors lane162 — pressed state
     + the .on fill are re-asserted on every sync, so a data
     refresh can never leave the chip lying about the board. */
  const laneBtn162 = $("#laneToggle162");
  if (laneBtn162) { laneBtn162.setAttribute("aria-pressed", String(lane162)); laneBtn162.classList.toggle("on", lane162); laneBtn162.onclick = () => { lane162 = !lane162; syncFilterUI(); renderAll2(); }; }
  // Round 62 (2026-11-08): the shared sport control mirrors the
  // current view's sport (Month reads monthSport, the other views
  // allSport) — the fallbacks above have already run by here.
  // Round 125 (2026-11-13): the control is the #boardSportSelect
  // dropdown now, not the pill bar — same mirror, one value write.
  const spCurrent = (typeof currentView !== "undefined" && currentView === "month") ? monthSport : allSport;
  const boardSel125 = $("#boardSportSelect");
  if (boardSel125) boardSel125.value = spCurrent;
}
/* Round 47 (2026-11-08): the search box is retired from the board
   (Emil: "we can always add that again later") — allSearch stays ""
   and the filter in renderAll2 is dormant; re-adding the input plus
   its input-listener restores it. */

/* ---------------- Swag film: pause to shop the look ---------------- */
// Emil's vision (2026-11-04): a kid pauses the Drop 001 film and can jump
// to the swag in the scene they paused on. (This film overlay was briefly
// called "Hype Frame"; Emil moved that name to the freeze-frame studio
// below the same day, so the film keeps the plain description.) Scene
// cuts verified from the actual media with ffmpeg scene detection: the
// 9.504s film cuts at exactly 2.5s, 5.0s and 7.5s —
//   0.0–2.5  Girls hoodies      -> #hype-girls
//   2.5–5.0  Boys hoodies       -> #hype-boys
//   5.0–7.5  Hype All Day hoodie -> #coordinating (coordinating tees area)
//   7.5–end  End card           -> #collections (the full Drop 001 boards)
// Preview only: the button says "View this look" — no prices, no cart,
// no checkout anywhere in this flow.
/* Store v4 film (2026-11-04): 10-second clips of youth wearing the
   actual Drop 001 designs; film v5 cut the retried Boys Unleashed clip
   in as the fifth scene (50s total, Girls first).
   Store v6 film (2026-11-04): Emil asked for Boys first and a faster,
   more energetic cut — the same five clips recut Boys-first, each scene
   7.0s at ~1.3x speed (~35s total): Boys Street (0-7s), Boys Athletics
   (7-14s), Boys Unleashed (14-21s), Girls Street (21-28s), Girls
   Essentials (28s-end).
   Film v7 (2026-11-04): Emil asked for true widescreen (no blurred-fill
   borders) and sports-theme backgrounds — five NEW native 1280x720
   clips, a different sport setting per scene, real movement at natural
   speed, each trimmed to 7.0s (35s total, same boundaries): Boys Street
   on a basketball court (0-7s), Boys Athletics on a baseball field
   (7-14s), Boys Unleashed on a football field (14-21s), Girls Street on
   a soccer field (21-28s), Girls Essentials on a running track
   (28s-end).
   Film v8 (2026-11-05): the film is SILENT (no audio track — Emil
   reversed the music add), and scenes 2 + 4 are now BACK views: Boys
   Athletics from behind (HYPE / H / ATHLETIC CLUB back print, baseball
   field) and Girls Street from behind (hibiscus + HYPE script back
   print, soccer field at sunset). Same order, 7.0s scenes, same
   pause-to-shop boundaries. A docked pause/play button sits in the
   film's bottom-right corner (the floating hint pill is gone).
   Each scene's card targets that collection's grid card by slug. The old
   film's title-card and Hype All Day scenes are gone with the old film.
   Round 3 (2026-11-05): Emil — each model clip felt too long. The same
   five scenes are recut to 4.0s each (20.0s total, still silent), each
   trimmed around its best moment (the two back views keep the back
   print readable): Boys Street 0-4s (from 1.5-5.5s of the v8 cut),
   Boys Athletics 4-8s, Boys Unleashed 8-12s, Girls Street 12-16s,
   Girls Essentials 16s-end. The pause-to-shop boundaries below are
   the new 4s grid: scene k covers [4k, 4k+4). */
const FILM_SCENES = [
  { until: 4, title: "The Boys Hype Street hoodie", sub: "You paused on the Boys Street scene — washed black with the crown HYPE chest.", btn: "View this look", target: "boys-street" },
  { until: 8, title: "The Boys Hype Athletics hoodie", sub: "You paused on the Boys Athletics scene — cream varsity with green stripes, Hype Is Earned.", btn: "View this look", target: "boys-athletics" },
  { until: 12, title: "The Boys Hype Unleashed hoodie", sub: "You paused on the Boys Unleashed scene — blue and yellow lightning print, It's Hype or Nothing.", btn: "View this look", target: "boys-unleashed" },
  { until: 16, title: "The Girls Hype Street hoodie", sub: "You paused on the Girls Street scene — washed charcoal with the hibiscus HYPE print.", btn: "View this look", target: "girls-street" },
  { until: Infinity, title: "The Girls Hype Essentials hoodie", sub: "You paused on the Girls Essentials scene — the pink hoodie, The Hype Starts Here.", btn: "View this look", target: "girls-essentials" },
];
function filmSceneAt(t) {
  return FILM_SCENES.find((s) => t < s.until) || FILM_SCENES[FILM_SCENES.length - 1];
}
(function () {
  const v = $("#swagVideo"), card = $("#swagShopCard");
  if (!v || !card) return;
  const film = v.closest(".swag-film");
  const title = $("#sscTitle"), sub = $("#sscSub"), btn = $("#sscBtn");
  let scene = FILM_SCENES[0];
  function showCard() {
    scene = filmSceneAt(v.currentTime || 0);
    title.textContent = scene.title;
    sub.textContent = scene.sub;
    btn.textContent = scene.btn;
    card.hidden = false;
    if (film) film.classList.add("film-paused");
  }
  function hideCard() {
    card.hidden = true;
    if (film) film.classList.remove("film-paused");
  }
  v.addEventListener("pause", showCard);
  v.addEventListener("seeked", () => { if (v.paused) showCard(); });
  v.addEventListener("play", hideCard);
  v.addEventListener("playing", hideCard);
  btn.addEventListener("click", () => goToStoreScene(scene.target));
  // Pause control (2026-11-05): a real button docked in the film's
  // bottom-right corner — same pill pattern as the homepage hero's
  // control bar — replaces the old floating hint pill. Tapping the
  // film still toggles playback too, and pausing surfaces the scene
  // card above via the pause listener (pause-to-shop).
  const pauseBtn = $("#swagPauseBtn");
  const syncPauseBtn = () => {
    if (!pauseBtn) return;
    pauseBtn.innerHTML = v.paused ? "▶ <span>Play</span>" : "❚❚ <span>Pause</span>";
    pauseBtn.setAttribute("aria-label", v.paused ? "Play the film" : "Pause the film");
  };
  v.addEventListener("pause", syncPauseBtn);
  v.addEventListener("play", syncPauseBtn);
  pauseBtn?.addEventListener("click", (e) => { e.stopPropagation(); if (v.paused) v.play(); else v.pause(); });
  syncPauseBtn();
  // Sound toggle (Round 9, 2026-11-05): the film's audio bed is the
  // hero's master music mixed LOW (0.2 gain in the file itself) —
  // "quiet, like stadium ambience". The film autoplays muted
  // (browser rule); this docked speaker button, beside Pause in the
  // same controls cluster, is the only unmute path. It flips the
  // SAME media element's muted flag, so pausing the film pauses its
  // sound too, and the label re-syncs on every volumechange
  // (including showStore's reset-to-muted on store entry).
  const soundBtn = $("#swagSoundBtn");
  const syncSoundBtn = () => {
    if (!soundBtn) return;
    soundBtn.innerHTML = v.muted ? "🔇 <span>Sound off</span>" : "🔊 <span>Sound on</span>";
    soundBtn.setAttribute("aria-label", v.muted ? "Turn the film's sound on" : "Mute the film");
    soundBtn.setAttribute("aria-pressed", v.muted ? "false" : "true");
  };
  v.addEventListener("volumechange", syncSoundBtn);
  soundBtn?.addEventListener("click", (e) => { e.stopPropagation(); v.muted = !v.muted; syncSoundBtn(); });
  syncSoundBtn();
  v.addEventListener("click", () => { if (v.paused) v.play(); else v.pause(); });
})();

/* ---------------- Store: division doors + focus (2026-11-04/05) ----
   Nov 5 (Overtime pattern, Emil): the landing is film → Boys DOOR →
   Girls DOOR → Hype Frame DOOR. The doors are the three banners; NO
   products are expanded on the landing (the grids are CSS-hidden
   until a division is focused). Tapping a door (anywhere on the
   banner, or its button) enters focus mode
   (body[data-store-focus="boys"|"girls"]), which hides the film,
   the store bar/head, and the other division's block, and pins the
   focused block's grid under a slim focus bar; the focus bar's exit
   returns to the doors landing. Also entered from the film overlay
   Shop Boys/Girls links, #hype-boys / #hype-girls links, and the
   film's pause-to-shop card (which focuses the paused scene's
   division and lands on its card).
   Round 4 (2026-11-05): the Hype Frame door is a focus door too —
   it enters body[data-store-focus="hypeframe"], which hides the
   film, the store bar/head and ALL three door blocks, and reveals
   the Hype Frame creative + finished-product examples as their own
   panel under the same focus bar (title "Hype Frame"); the focus
   bar's exit is the back path to the doors. The creative is NOT in
   the landing's always-visible flow anymore (CSS-gated). */
const storeState = { focus: null };
function setStoreFocus(div) {
  storeState.focus = div || null;
  if (div) document.body.dataset.storeFocus = div; else delete document.body.dataset.storeFocus;
  const bar = $("#storeFocusBar");
  if (bar) {
    bar.hidden = !div;
    if (div) $("#storeFocusTitle").textContent = div === "hypeframe" ? "Hype Frame" : `Hype ${div === "girls" ? "Girls" : "Boys"} — Drop 001`;
  }
}
function openStoreHf() {
  setStoreFocus("hypeframe");
  setTimeout(() => document.getElementById("storeFocusBar")?.scrollIntoView({ behavior: "smooth" }), 60);
}
function flashStoreCards(selector) {
  const cards = $$(selector || ".prod-card");
  cards.forEach((c) => { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); });
  setTimeout(() => cards.forEach((c) => c.classList.remove("flash")), 2400);
}
function goToStoreScene(target) {
  // Film scenes target a single collection card by slug — focus that
  // card's division, scroll to the card, flash it.
  const sceneCard = document.querySelector(`.prod-card[data-slug="${target}"]`);
  if (sceneCard) {
    setStoreFocus(sceneCard.dataset.division);
    setTimeout(() => { sceneCard.scrollIntoView({ behavior: "smooth", block: "center" }); flashStoreCards(`.prod-card[data-slug="${target}"]`); }, 60);
    return;
  }
  if (target === "hype-girls" || target === "hype-boys") {
    const div = target === "hype-girls" ? "girls" : "boys";
    setStoreFocus(div);
    setTimeout(() => document.getElementById("storeFocusBar")?.scrollIntoView({ behavior: "smooth" }), 60);
    flashStoreCards(`.prod-card[data-division="${div}"]`);
  } else {
    // "coordinating" / "collections": the full landing is the destination.
    setStoreFocus(null);
    document.getElementById("collections")?.scrollIntoView({ behavior: "smooth" });
    flashStoreCards();
  }
}
$$("[data-hero-shop]").forEach((b) => b.addEventListener("click", () => goToStoreScene(b.dataset.heroShop === "girls" ? "hype-girls" : "hype-boys")));
$$("[data-store-focus]").forEach((b) => b.addEventListener("click", () => {
  if (b.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }
  goToStoreScene(b.dataset.storeFocus === "girls" ? "hype-girls" : "hype-boys");
}));
/* The whole banner is the door (2026-11-05): tapping anywhere on it
   opens that door, not just on the underlined button. Round 4: the
   Hype Frame banner routes to its panel (openStoreHf) the same way
   the division banners route to their focus. */
$$(".store-banner").forEach((banner) => banner.addEventListener("click", (e) => {
  if (e.target.closest("[data-store-focus]")) return; // the button has its own handler
  const btn = banner.querySelector("[data-store-focus]");
  if (!btn) return;
  if (btn.dataset.storeFocus === "hypeframe") { openStoreHf(); return; }
  goToStoreScene(btn.dataset.storeFocus === "girls" ? "hype-girls" : "hype-boys");
}));
$("#storeFocusExit")?.addEventListener("click", () => { setStoreFocus(null); document.getElementById("collections")?.scrollIntoView({ behavior: "smooth" }); });
$$(".prod-card").forEach((card) => {
  const flip = card.querySelector("[data-flip]");
  if (flip) flip.addEventListener("click", (e) => {
    e.stopPropagation();
    const back = card.classList.toggle("show-back");
    flip.textContent = back ? "⇄ Front" : "⇄ Back";
    flip.setAttribute("aria-label", `Flip ${card.querySelector("h4").textContent} card to the ${back ? "front" : "back"} view`);
  });
  card.addEventListener("click", () => openQuickView(card));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openQuickView(card); } });
});
/* Store v8 (2026-11-04): quick-view product data lives here, not in
   card chrome — the cards are name + price + size run (Overtime-style),
   and the quick view carries the story plus the full colorway gallery.
   Round 2 (2026-11-05): the gallery LEADS with the design's real
   lookbook photos (front, then back — /swag/<slug>-<side>.jpg, the
   same photos the product cards now show), and the flat board
   illustrations recolored per colorway at build time
   (/swag/qv/<slug>-<color>-<side>.svg) follow after them. */
const QV_PRODUCTS = {
  "boys-street": { side: "Boys Collection · Crown motif", slogan: "Hype Is Life", desc: "Everyday style. Youth culture.", leadPhoto: "/swag/boys-street-model.jpg", colors: [["Black", "#2e2e31"], ["Denim Blue", "#3f5f82"], ["Gray", "#8b8e93"], ["Olive", "#5f6a45"]] },
  "boys-athletics": { side: "Boys Collection · Crown motif", slogan: "Hype Is Earned", desc: "Performance. Pride. Community.", colors: [["Cream", "#f3e7cf"], ["Heather Gray", "#a8abb0"], ["Forest Green", "#1e5138"], ["Navy", "#1c3054"]] },
  "boys-unleashed": { side: "Boys Collection · Crown motif", slogan: "It’s Hype or Nothing", desc: "Bold designs. High energy. No limits.", colors: [["Blue Lightning", "#37b6ff"], ["Fire Orange", "#ff7a1a"], ["Purple Lightning", "#7e22ce"], ["Teal Lightning", "#14b8a6"]] },
  "girls-street": { side: "Girls Collection · Tiara motif", slogan: "Hype Is Life", desc: "Everyday style. Youth culture.", leadPhoto: "/swag/girls-street-model.jpg", colors: [["Black", "#2d2d31"], ["Pink", "#efa7c6"], ["Cream", "#f3e7cf"], ["Light Blue", "#a9d7f0"]] },
  "girls-athletics": { side: "Girls Collection · Tiara motif", slogan: "Hype Is Earned", desc: "Performance. Pride. Community.", colors: [["Cream", "#f3e7cf"], ["Forest Green", "#1e5138"], ["Navy", "#1c3054"], ["Heather Gray", "#a8abb0"]] },
  "girls-essentials": { side: "Girls Collection · Tiara motif", slogan: "The Hype Starts Here", desc: "Comfort. Creativity. Confidence.", colors: [["Sky Blue", "#8ec9ee"], ["Cream", "#f3e7cf"], ["Pink", "#f6a8c5"], ["Lavender", "#c2ade0"]] },
};
const qvColorSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
/* Gallery layout (Round 2): frame 0 = real FRONT photo, frame 1 =
   real BACK photo, then two frames per colorway (front, back) of the
   illustration gallery. Total frames = colors * 2 + 2.
   Round 20 (2026-11-06): the two lead cards (boys-street,
   girls-street) carry a leadPhoto — the new model shot — which is
   PREPENDED as frame 0, ahead of the front/back photos; those
   galleries have colors * 2 + 3 frames and the model frame counts
   as the FRONT side for the toggle. */
let qvGalleryState = { slug: "", colors: [], photos: 2 };
function qvFrameCount() { return qvGalleryState.colors.length * 2 + (qvGalleryState.photos || 2); }
function qvSyncGallery() {
  const g = $("#qvGallery"); if (!g || !qvGalleryState.colors.length) return;
  const w = g.clientWidth || 1;
  const photos = qvGalleryState.photos || 2;
  const idx = Math.min(qvFrameCount() - 1, Math.max(0, Math.round(g.scrollLeft / w)));
  const isPhoto = idx < photos;
  const ci = isPhoto ? -1 : Math.floor((idx - photos) / 2);
  const sideIdx = isPhoto ? (idx === photos - 1 ? 1 : 0) : (idx - photos) % 2;
  $("#qvColorName").textContent = isPhoto ? "Real photo" : qvGalleryState.colors[ci][0];
  $("#qvSideLabel").textContent = sideIdx ? "Back" : "Front";
  $$("#qvSwatches .qv-swatch").forEach((b, i) => b.setAttribute("aria-pressed", String(i === ci)));
  $$("#qvSides .qv-side-btn").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.qvSide) === sideIdx)));
}
/* FRONT / BACK without swiping (2026-11-05; Round 2 retarget): the
   toggle scrolls the gallery to the REAL PHOTO frames (frame 0 =
   front photo, frame 1 = back photo). The color buttons above it
   (the swatch row) jump to a colorway's front illustration frame,
   which now sits after the two photo frames. */
$$("#qvSides .qv-side-btn").forEach((b) => b.addEventListener("click", () => {
  const g = $("#qvGallery"); if (!g || !qvGalleryState.colors.length) return;
  const w = g.clientWidth || 1;
  /* Round 20: with a lead model frame, BACK lives at frame
     photos-1 (not frame 1); FRONT is always frame 0. */
  const target = b.dataset.qvSide === "1" ? (qvGalleryState.photos || 2) - 1 : 0;
  g.scrollTo({ left: target * w, behavior: "smooth" });
}));
function openQuickView(card) {
  const qv = $("#quickView"); if (!qv) return;
  const slug = card.dataset.slug;
  const data = QV_PRODUCTS[slug]; if (!data) return;
  qvGalleryState = { slug, colors: data.colors, photos: data.leadPhoto ? 3 : 2 };
  const title = card.querySelector("h4").textContent;
  $("#qvSide").textContent = data.side;
  $("#qvTitle").textContent = title;
  $("#qvSlogan").textContent = data.slogan;
  $("#qvDesc").textContent = data.desc;
  $("#qvColors").textContent = data.colors.map((c) => c[0]).join(" · ");
  const g = $("#qvGallery");
  const leadFrame = data.leadPhoto ? `<figure class="qv-frame qv-frame-photo"><img src="${data.leadPhoto}" alt="${esc(title)} hoodie — model photo with the gold crest" loading="lazy" decoding="async" /><figcaption>Model · Photo</figcaption></figure>` : "";
  const photoFrames = leadFrame + ["front", "back"].map((sd) => `<figure class="qv-frame qv-frame-photo"><img src="/swag/${slug}-${sd}.jpg" alt="${esc(title)} hoodie — real ${sd} photo" loading="lazy" decoding="async" /><figcaption>${sd} · Photo</figcaption></figure>`).join("");
  const colorFrames = data.colors.map(([name]) => ["front", "back"].map((sd) => `<figure class="qv-frame"><img src="/swag/qv/${slug}-${qvColorSlug(name)}-${sd}.svg" alt="${esc(title)} hoodie in ${esc(name)} — ${sd} illustration" loading="lazy" decoding="async" /><figcaption>${sd}</figcaption></figure>`).join("")).join("");
  g.innerHTML = photoFrames + colorFrames;
  g.scrollLeft = 0;
  $("#qvSwatches").innerHTML = data.colors.map(([name, hex], i) => `<button type="button" class="qv-swatch" data-qv-color="${i}" aria-pressed="false"><span class="swatch" style="--sw:${hex}"></span>${esc(name)}</button>`).join("");
  $$("#qvSwatches .qv-swatch").forEach((b) => b.addEventListener("click", () => {
    g.scrollTo({ left: (qvGalleryState.photos + Number(b.dataset.qvColor) * 2) * (g.clientWidth || 1), behavior: "smooth" });
  }));
  qvSyncGallery();
  // Price is set ($69.99 across Drop 001 youth hoodies). Round 227:
  // the size selector is GONE — the coming-soon card's only action
  // is the notify-me capture, which resets each time the quick view
  // opens so one product's confirmation never greets another.
  const qvMsg227 = $("#qvNotifyMsg227"); if (qvMsg227) { qvMsg227.textContent = ""; qvMsg227.classList.remove("ok"); }
  const qvEmail227 = $("#qvEmail227"); if (qvEmail227) qvEmail227.value = "";
  qv.hidden = false;
  document.body.classList.add("qv-open");
  qv.querySelector(".qv-close")?.focus();
  requestAnimationFrame(qvSyncGallery);
}
$("#qvGallery")?.addEventListener("scroll", () => requestAnimationFrame(qvSyncGallery), { passive: true });
/* Round 227: the quick view's size-button wiring left with the
   picker it served — the card's action is the notify form now. */
function closeQuickView() {
  const qv = $("#quickView"); if (!qv) return;
  qv.hidden = true;
  document.body.classList.remove("qv-open");
}
$$("[data-qv-close]").forEach((el) => el.addEventListener("click", closeQuickView));
/* Dead-end sweep (Round 2, 2026-11-05): the open quick view covers
   the header logo, so the panel carries its own Home button — close
   the dialog, then the standard goHome() reset. */
$("#qvHome")?.addEventListener("click", () => { closeQuickView(); goHome(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQuickView(); });

/* ---------------- Round 27 (2026-11-06): Hype Sports store --------
   The store is rebuilt around Hype Sports: hero, Shop by Sport
   tiles, filter chips + a six-hoodie grid, a per-sport product
   view, a Hype Frame feature, and the NEXT DROP teaser (Drop 002),
   where the Hot Pink Hype Street hoodie keeps its quick view (the
   teaser card below feeds openQuickView like the old cards did).
   Sample phase throughout: prices show ($69.99), the CTA is a
   disabled COMING SOON, size selection is display state only —
   no cart, no checkout, no orders. */

/* ---------------- Round 183 (2026-11-15): Shopify prep wiring ----
   INVISIBLE and DORMANT by design. The Shopify store Emil created
   today (6kk7gm-8d.myshopify.com, trial plan) holds Drop 001 as
   DRAFT products; this map ties the store's products to their
   Shopify counterparts so launch day is a flag flip, not a rebuild.
   While HH_SHOP_LIVE183 is false, NOTHING changes: no network calls,
   no Shopify JS, no embeds — the COMING SOON rendering below runs
   exactly as before, byte for byte.
   Keys are the site's own identifiers: the HS_PRODUCTS keys for the
   hoodies that exist here, the SPORTS taxonomy key (martialarts)
   for martial arts, and hypeframe for the Hype Frame product.
   All six site hoodies are mapped. The Shopify MARTIAL ARTS
   hoodie has no site store product yet, so its entry is
   config-only for now. HYPE FRAME is config-only BY DESIGN: its
   flow is the custom studio + order form, never a buy-button
   swap — the entry exists only so the whole product mapping
   lives in one place. Every GID and handle below is API-verified
   against the store (volleyball and the hypeframe handle
   confirmed 2026-11-15, after the volleyball draft was created
   to complete the six). */
const HH_SHOP_LIVE183 = false;
const HH_SHOPIFY_MAP183 = {
  baseball:    { gid: "gid://shopify/Product/15536451190997", handle: "hype-sports-hoodie-baseball",    url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-baseball" },
  softball:    { gid: "gid://shopify/Product/15536451289301", handle: "hype-sports-hoodie-softball",    url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-softball" },
  basketball:  { gid: "gid://shopify/Product/15536451354837", handle: "hype-sports-hoodie-basketball",  url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-basketball" },
  football:    { gid: "gid://shopify/Product/15536451485909", handle: "hype-sports-hoodie-football",    url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-football" },
  soccer:      { gid: "gid://shopify/Product/15536451518677", handle: "hype-sports-hoodie-soccer",      url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-soccer" },
  volleyball:  { gid: "gid://shopify/Product/15536475898069", handle: "hype-sports-hoodie-volleyball",  url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-volleyball" },
  martialarts: { gid: "gid://shopify/Product/15536451551445", handle: "hype-sports-hoodie-martial-arts", url: "https://6kk7gm-8d.myshopify.com/products/hype-sports-hoodie-martial-arts" },
  hypeframe:   { gid: "gid://shopify/Product/15536451584213", handle: "hype-frame-hoodie-your-highlight-printed", url: "https://6kk7gm-8d.myshopify.com/products/hype-frame-hoodie-your-highlight-printed" },
};
const HS_PRODUCTS = {
  baseball: { n: "001", name: "Baseball", line: "Built for the diamond. Made for the hype.", price: "$69.99", gallery: [["/swag/hs/baseball-front.jpg", "Front"], ["/swag/hs/baseball-back.jpg", "Back"], ["/swag/hs/baseball-detail-chest.jpg", "Chest detail"], ["/swag/hs/baseball-detail-sleeve.jpg", "Sleeve detail"], ["/swag/hs/baseball-detail-fabric.jpg", "Fabric"], ["/swag/hs/baseball-detail-tag.jpg", "Hem tag"]] },
  football: { n: "002", name: "Football", line: "Friday lights. Full send.", price: "$69.99", gallery: [["/swag/hs/football-front.jpg", "Front"], ["/swag/hs/football-back.jpg", "Back"], ["/swag/hs/football-detail-chest.png", "Chest detail"]] },
  basketball: { n: "003", name: "Basketball", line: "Built for the blacktop. Ready for the lights.", price: "$69.99", gallery: [["/swag/hs/basketball-front.jpg", "Front"], ["/swag/hs/basketball-back.jpg", "Back"], ["/swag/hs/basketball-detail-chest.png", "Chest detail"]] },
  soccer: { n: "004", name: "Soccer", line: "Top corner is a lifestyle.", price: "$69.99", gallery: [["/swag/hs/soccer-front.jpg", "Front"], ["/swag/hs/soccer-back.jpg", "Back"], ["/swag/hs/soccer-detail-chest.png", "Chest detail"]] },
  softball: { n: "005", name: "Softball", line: "Yellow ball. Loud bat. Louder hype.", price: "$69.99", gallery: [["/swag/hs/softball-front.jpg", "Front"], ["/swag/hs/softball-back.jpg", "Back"], ["/swag/hs/softball-detail-chest.png", "Chest detail"]] },
  volleyball: { n: "006", name: "Volleyball", line: "All hustle above the net.", price: "$69.99", gallery: [["/swag/hs/volleyball-front.jpg", "Front"], ["/swag/hs/volleyball-back.jpg", "Back"], ["/swag/hs/volleyball-detail-chest.png", "Chest detail"]] },
};
const hsState = { sport: null, frame: 0 };
function hsFrameAlt(sport, label) {
  const p = HS_PRODUCTS[sport];
  if (label === "Front") return `${p.name} Hype Hoodie — front: black hoodie with the gold crest and ${p.name.toUpperCase()} in plain caps at the left chest`;
  if (label === "Back") return `${p.name} Hype Hoodie — back: giant ball print with a gold crown and HYPE brush letters`;
  if (label === "Chest detail") return "Chest detail: crest with sport name";
  return `${p.name} Hype Hoodie — ${label.toLowerCase()}`;
}
function hsSetFrame(i) {
  const p = HS_PRODUCTS[hsState.sport]; if (!p) return;
  hsState.frame = Math.max(0, Math.min(p.gallery.length - 1, i));
  const [src, label] = p.gallery[hsState.frame];
  const img = $("#hsMainImg");
  img.src = src;
  img.alt = hsFrameAlt(hsState.sport, label);
  $$("#hsThumbs .hsv-thumb").forEach((b, bi) => b.setAttribute("aria-pressed", String(bi === hsState.frame)));
  $$("#hsDots .hsv-dot").forEach((d, di) => d.classList.toggle("on", di === hsState.frame));
  $$(".hsv-side-btn").forEach((b) => b.setAttribute("aria-pressed", String((b.dataset.hsSide === "front" && hsState.frame === 0) || (b.dataset.hsSide === "back" && hsState.frame === 1))));
}
function hsSetTab(name) {
  $$(".hsv-tab-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.hsTab === name)));
  $$(".hsv-tab-panel").forEach((p) => { p.hidden = p.dataset.hsPanel !== name; });
}
function openHsView(sport) {
  const p = HS_PRODUCTS[sport]; if (!p) return;
  const view = $("#hsView"); if (!view) return;
  hsState.sport = sport;
  $("#hsEyebrow").textContent = `HYPE SPORTS / ${p.n}`;
  $("#hsTitle").textContent = `${p.name} Hype Hoodie`;
  $("#hsLine").textContent = p.line;
  $("#hsPrice").textContent = p.price;
  $("#hsDesc").textContent = `The ${p.name} Hype Hoodie from Hype Sports Drop 001 — a black premium youth hoodie with the gold crest and ${p.name.toUpperCase()} in plain caps at the left chest, a crown print on the sleeve, and the giant ball graphic with crown and HYPE brush letters across the back. ${p.line} Sample phase — sales open soon.`;
  $("#hsThumbs").innerHTML = p.gallery.map(([src, label], i) => `<button type="button" class="hsv-thumb" data-hs-thumb="${i}" aria-pressed="false" aria-label="Show image: ${esc(label)}"><img src="${src}" alt="" loading="lazy" decoding="async" /></button>`).join("");
  $$("#hsThumbs .hsv-thumb").forEach((b) => b.addEventListener("click", () => hsSetFrame(Number(b.dataset.hsThumb))));
  $("#hsDots").innerHTML = p.gallery.map((_, i) => `<button type="button" class="hsv-dot" data-hs-dot="${i}" aria-label="Show image ${i + 1} of ${p.gallery.length}"></button>`).join("");
  $$("#hsDots .hsv-dot").forEach((b) => b.addEventListener("click", () => hsSetFrame(Number(b.dataset.hsDot))));
  /* Round 227: the size picker is gone — the notify form resets
     each open, like the quick view's. */
  const hsMsg227 = $("#hsNotifyMsg227"); if (hsMsg227) { hsMsg227.textContent = ""; hsMsg227.classList.remove("ok"); }
  const hsEmail227 = $("#hsEmail227"); if (hsEmail227) hsEmail227.value = "";
  hsSetTab("desc");
  hsSetFrame(0);
  view.hidden = false;
  document.body.classList.add("hsv-open");
  view.querySelector(".hsv-close")?.focus();
  /* Round 183 dormant Shopify path: while HH_SHOP_LIVE183 is false
     this block NEVER runs — the view renders exactly as the markup
     stands, untouched. At launch (flag flipped true), a mapped
     sport swaps its call-to-action for a link to the Shopify
     product (all six HS_PRODUCTS sports are mapped); an unmapped
     sport keeps the coming-soon rendering. Hype Frame never comes
     through here — it is excluded by design (see HH_SHOPIFY_MAP183).
     Round 227: the CTA this block swaps is now the notify form
     (the disabled COMING SOON button it originally targeted was
     retired with the size picker) — at launch the form hides and
     a BUY NOW link takes its place. */
  if (HH_SHOP_LIVE183) {
    const shop183 = HH_SHOPIFY_MAP183[sport];
    const form183 = view.querySelector("#hsNotifyForm227");
    if (shop183 && form183) {
      const a183 = document.createElement("a");
      a183.className = "hsv-cta";
      a183.href = shop183.url;
      a183.textContent = "BUY NOW";
      form183.replaceWith(a183);
    }
  }
}
function closeHsView() {
  const view = $("#hsView"); if (!view) return;
  view.hidden = true;
  document.body.classList.remove("hsv-open");
}
$$("[data-hs-open]").forEach((el) => el.addEventListener("click", (e) => { e.stopPropagation(); openHsView(el.dataset.hsOpen); }));
/* Round 52 (2026-11-08): Shop by Sport tiles JUMP to their hoodie
   card instead of opening the product view — Emil's store flow:
   tile -> its hoodie, hoodie -> product page. The card flashes
   once so the eye lands on it. */
$$("[data-hs-jump]").forEach((el) => el.addEventListener("click", () => {
  const card = document.querySelector(`[data-hs-card="${el.dataset.hsJump}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.remove("hs-flash"); void card.offsetWidth; card.classList.add("hs-flash");
  setTimeout(() => card.classList.remove("hs-flash"), 1300);
}));
$$(".hs-card").forEach((card) => {
  card.addEventListener("click", () => openHsView(card.dataset.hsCard));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openHsView(card.dataset.hsCard); } });
});
$$("[data-hs-close]").forEach((el) => el.addEventListener("click", closeHsView));
$$(".hsv-side-btn").forEach((b) => b.addEventListener("click", () => hsSetFrame(b.dataset.hsSide === "back" ? 1 : 0)));
/* Round 28 (2026-11-06): gallery navigation on the product-view
   stage — phones get dots, not thumbs, and Emil found he "can't
   swipe between front and back". A clear horizontal swipe moves
   one frame (hsSetFrame clamps at both ends, no wraparound);
   listeners are passive so the panel's own scrolling is never
   fought. Pointer events cover mouse/pen drags as a fallback
   (touch pointers are left to the touch handlers). Arrow keys
   navigate while the view is open. */
const hsMedia28 = document.querySelector(".hsv-media");
if (hsMedia28) {
  const HS_SWIPE_MIN = 40;
  let hsTouchX = null;
  hsMedia28.addEventListener("touchstart", (e) => { hsTouchX = e.changedTouches[0].clientX; }, { passive: true });
  hsMedia28.addEventListener("touchend", (e) => {
    if (hsTouchX === null) return;
    const dx = e.changedTouches[0].clientX - hsTouchX;
    hsTouchX = null;
    if (Math.abs(dx) >= HS_SWIPE_MIN) hsSetFrame(hsState.frame + (dx < 0 ? 1 : -1));
  }, { passive: true });
  let hsPtrX = null;
  hsMedia28.addEventListener("dragstart", (e) => e.preventDefault());
  hsMedia28.addEventListener("pointerdown", (e) => { if (e.pointerType !== "touch") hsPtrX = e.clientX; });
  hsMedia28.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch" || hsPtrX === null) return;
    const dx = e.clientX - hsPtrX;
    hsPtrX = null;
    if (Math.abs(dx) >= HS_SWIPE_MIN) hsSetFrame(hsState.frame + (dx < 0 ? 1 : -1));
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
  const hsView28 = $("#hsView");
  if (!hsView28 || hsView28.hidden) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
  e.preventDefault();
  hsSetFrame(hsState.frame + (e.key === "ArrowRight" ? 1 : -1));
});
/* Round 227: the product view's size-button wiring left with the
   picker it served — the view's action is the notify form now. */
$$(".hsv-tab-btn").forEach((b) => b.addEventListener("click", () => hsSetTab(b.dataset.hsTab)));
$$("#hsChips .hs-chip").forEach((chip) => chip.addEventListener("click", () => {
  $$("#hsChips .hs-chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
  const f = chip.dataset.hsFilter;
  $$(".hs-card").forEach((card) => { card.hidden = f !== "all" && card.dataset.hsCard !== f; });
}));
$("#hsShopBtn")?.addEventListener("click", () => document.getElementById("hsBySport")?.scrollIntoView({ behavior: "smooth" }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHsView(); });

/* The shared youth size guide: ONE overlay (#sizeGuide), opened by
   every product-view Size Guide link. (Round 29 removed the menu's
   entry; the overlay and this wiring are unchanged.) */
function openSizeGuide() {
  const sg = $("#sizeGuide"); if (!sg) return;
  sg.hidden = false;
  document.body.classList.add("sg-open");
  sg.querySelector(".sg-close")?.focus();
}
function closeSizeGuide() {
  const sg = $("#sizeGuide"); if (!sg) return;
  sg.hidden = true;
  document.body.classList.remove("sg-open");
}
$$("[data-size-guide-open]").forEach((el) => el.addEventListener("click", () => { closeMenu(false); openSizeGuide(); }));
$$("[data-sg-close]").forEach((el) => el.addEventListener("click", closeSizeGuide));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSizeGuide(); });

/* Round 29 (2026-11-06): the menu's expandable sports group is
   gone — Emil slimmed the menu to four items. The store's own
   tiles and cards still open product views (data-hs-open /
   openHsView, wired above); nothing else used the group's wiring. */

/* NEXT DROP teaser: the Hot Pink Hype Street hoodie keeps its quick
   view — the teaser card carries the girls-street slug + title the
   QV reader expects (openQuickView reads data-slug and the h4). */
const hsTeaserCard = document.querySelector(".hs-teaser-card");
if (hsTeaserCard) {
  hsTeaserCard.addEventListener("click", () => openQuickView(hsTeaserCard));
  hsTeaserCard.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openQuickView(hsTeaserCard); } });
}

/* ---------------- Hype Frame studio ---------------- */
// Emil's product concept (2026-11-04): a real freeze-frame from the
// athlete's OWN highlight, printed on premium youth apparel.
//   1. Select your highlight from an uploaded video (the play card button).
//   2. Freeze your favorite frame using a video timeline (scrub, ±1s
//      step buttons, freeze — works while the video plays).
//   3. Pick a print style — Classic (photo only), Signature (photo +
//      name / jersey caption), or Hype Frame (grunge frame around the
//      photo + the HYPE FRAME script lockup under it, drawn onto the
//      print image itself). The print always sits at the fixed
//      default placement on the garment.
//   4. Order with parent or guardian approval (an order REQUEST — no
//      payment, no price; the owner confirms with the guardian first).
// Round 2 (2026-11-05): the on-screen garment preview was removed
// (too confusing), and with it the apparel / side / colorway pickers —
// the payload carried fixed defaults. Round 3 (2026-11-05, later the
// same day): Emil brought back exactly two pickers — hoodie COLOR and
// youth SIZE (see hfPickColor / hfPickSize). The preview, the garment
// picker and the side toggle stay removed: apparel is always
// "hoodie", side always "front". The colorway list below is the
// picker's single source of truth, and the composed print's
// frame/lockup tone follows the chosen garment color.
// Capture is client-side canvas work: play videos are same-origin hosted
// files, so drawImage + toDataURL work. Link-posted plays can't be
// captured (cross-origin embeds) — the studio says so instead of failing.
// Round 199 (2026-11-26, Emil): the garment comes in exactly two
// colors now — Black and Heather Gray. The server enforces the
// same two names on order creation; orders already on file keep
// whatever colorway they carry.
const HF_COLORWAYS = {
  hoodie: [
    { name: "Black", hex: "#17171a" }, { name: "Heather Gray", hex: "#a8abb0" },
  ],
};
// Placement is stored as percentages RELATIVE to the garment's print
// area (cx/cy = the print's center, size = print width as % of the
// area's width), and the order request carries it to the server for
// the printer to reproduce.
/* Print size raised 66% -> 78% (2026-11-05): the print read small and
   washed on the garment at 66%. ONE shared default — the composed
   print's placement values and the order payload both read it
   (server fallback default matches). */
const HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 78 };
// Round 206 state: garmentView206 (the on-garment preview's
// front/back VIEW — preview-only, never the order's side; opens
// on "back" per Emil's mockup), the avatar maker's fields (the
// generated avatar's data URL; avatarApplied206 = it IS the
// print art after the parent's explicit approval;
// avatarPreview206 = it is previewing on the garment, not yet
// approved; avatarConfigured206 = the server's word on the
// maker, null = not asked yet), and frameCanvas206 — the frozen
// frame's canvas snapshot (the photo the avatar reverts to; a
// canvas clone, so reverting never re-seeks the video).
const hfState = { play: null, mediaType: "", apparel: "hoodie", side: "back", imageStyle: "photo", colorway: "Black", size: "", frozen: false, printDataUrl: "", printAspect: 0, placement: { ...HF_PLACEMENT_DEFAULT }, preset: "hypeframe", backText: "name", frameTime205: null, garmentView206: "back", avatarDataUrl206: "", avatarApplied206: false, avatarPreview206: false, avatarConfigured206: null, avatarBusy206: false, frameCanvas206: null, clipOpen211: false, screen215: "product", designAspect218: 0, avatarFocus221: null, seedFrame215: false, fenceConfigured222: null, fenceBusy222: false, fenceClean222: "", fenceDetect229: null, fenceAuto229: null, fenceAutoCache229: {}, fenceAutoKey229: "", fenceAutoClean229: "", fenceAutoOriginal229: null, fenceAutoBusy229: false, fenceAutoFailed229: false, fenceAutoToken229: 0 };
// Round 215 state: screen215 (the one-page studio's two
// screens — "product" / "review" — presentation only, never
// read by the order path; the Round 211 step211 / stepMax211
// retired with the stepper) and clipOpen211 (the Pick from
// video player area inside the Change photo panel, collapsed
// by default for video plays).
// Round 222 state: size starts EMPTY — no size is preselected
// any more (the R215 "YM" default is removed at Emil's
// direction; the Review gate requires an explicit pick);
// seedFrame215 marks a poster-seeded frame (the ★ recommended
// frame replaces it when the strip is scored — the default
// print is the recommended frame's artwork, never the raw
// poster — while a parent's own freeze is never overridden);
// fenceConfigured222 / fenceBusy222 / fenceClean222 run the
// fence-removal step (null = not asked yet; fenceClean222 is
// the cleaned photo awaiting the parent's approval).
// Round 229 state: preset is FIXED to "hypeframe" (the Print
// style picker is removed — every design is the format);
// fenceDetect229 / fenceAuto229 carry the fence-status word on
// detection + auto-clean (null = not asked yet);
// fenceAutoCache229 maps a frame's content key to its verdict
// ({status:"none"|"cleaned"|"failed", clean, choice}) so the
// same frame never triggers a second detect/edit call in the
// session; fenceAutoKey229 / fenceAutoClean229 /
// fenceAutoOriginal229 track the currently applied auto-clean
// (the cleaned data URL + the as-shot canvas it replaced, for
// the one-tap revert); fenceAutoFailed229 surfaces the manual
// step as the fallback when an auto attempt fails.
// (Store v8: the Hype Frame lockup — purple crown, script, underline —
// is drawn as canvas vector work in hfDrawLockup, so the old crown.png
// image loader is gone.)

window.openHypeFrame = (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || (CONTEST.entries || []).find((p) => p.id === id);
  if (!play) { alert("That play isn't on the board anymore."); return; }
  /* Round 231 (2026-11-27, Emil): sample plays can't be used in
     the studio at all. Every entry route funnels through here —
     the per-play Frame buttons (now hidden on samples at render),
     the posted-play picker (which excludes samples since this
     round), the #hype-frame-<id> deep links (boot + hashchange)
     and the Round 139 history restore — so this one refusal
     covers all of them: a sample seed attempt lands on the
     choice card instead, and the sample's frames never load.
     The server refuses sample-sourced orders too (defense in
     depth). Samples everywhere else are untouched. */
  if (play.isSample) { if (typeof openHfChoice === "function") openHfChoice(); return; }
  showHome(); closeMenu(false); showPanel("hypeframe");
  /* Round 139: the studio gets its own history entry, pushed
     with its #hype-frame- hash as the URL (the play detail's
     pattern) — browser Back returns to the view the visitor
     came from. Boot deep links keep the replace. */
  const pushed139 = typeof hhNavPush139 === "function" && hhNavPush139(typeof hhPlace139 === "function" ? hhPlace139({ hf: id }) : null, `#hype-frame-${id}`);
  if (!pushed139) history.replaceState(history.state, "", `#hype-frame-${id}`);
  initHfStudio(play);
  // Round 127: the studio film that used to be restarted here is
  // gone with the payoff stack — the studio opens at the tool.
  document.getElementById("hypeframe").scrollIntoView({ behavior: "smooth" });
};
function initHfStudio(play) {
  hfState.play = play;
  hfState.frozen = false;
  hfState.printDataUrl = "";
  hfState.printAspect = 0;
  hfState.placement = { ...HF_PLACEMENT_DEFAULT };
  $("#hfPlayLine").textContent = `From the play “${play.title}” — freeze the frame, make it yours, and send the request. A parent or guardian confirms before anything is printed.`;
  $("#hfName").value = play.athlete_label || play.player_name || "";
  $("#hfJersey").value = play.jersey || "";
  hfState.preset = "hypeframe"; // Round 229: fixed — the Print style picker is gone
  $("#hfMsg").textContent = "";
  // The garment stays fixed (hoodie); color, size AND print side are
  // the family's choice — the side picker returned in Round 35
  // (2026-11-07, Emil). Reset all three pickers for the new play.
  hfState.apparel = "hoodie";
  hfPickSide("back");
  hfPickImageStyle("photo");
  // Round 197: the back-text choice resets to the player's name for
  // each new play, and any typed custom words are cleared.
  hfPickBackText197("name");
  const hfBackCustomEl197 = $("#hfBackCustom197");
  if (hfBackCustomEl197) hfBackCustomEl197.value = "";
  // Round 218: the design label starts from the play's title
  // (uppercased, sanitized, capped) — the parent shortens it in
  // the Artwork row if it runs long.
  const hfLabelEl218 = $("#hfLabel218");
  if (hfLabelEl218) hfLabelEl218.value = hfLabelDefault218(play);
  hfPickColor((HF_COLORWAYS.hoodie[0] || {}).name || "Black");
  hfClearSize222(); // Round 222: no preselected size — the parent taps one (the Review gate holds until then)
  const v = $("#hfVideo"), photo = $("#hfPhoto"), scrubRow = $("#hfScrubRow"), freezeBtn = $("#hfFreeze"), linkNote = $("#hfLinkNote");
  v.pause(); v.removeAttribute("src"); v.removeAttribute("poster"); v.load();
  photo.removeAttribute("src");
  if (play.media_kind === "file" && (play.mime || "").startsWith("image/")) {
    hfState.mediaType = "image";
    photo.src = play.media_url; photo.hidden = false;
    v.hidden = true; scrubRow.style.display = "none"; linkNote.hidden = true; freezeBtn.disabled = false;
  } else if (play.media_kind === "file") {
    hfState.mediaType = "video";
    v.src = play.media_url; v.hidden = false;
    // Round 124: the studio player never opens on a black box —
    // it wears the play's poster (the server's poster_url first,
    // else the banked frame / branded placeholder) while the
    // clip loads and before the first frame is frozen.
    try { const hp = play.poster_url || (typeof btlPosterFor118 === "function" ? btlPosterFor118(play.media_url || "", play.sport || "", play.title || "") : ""); if (hp) v.poster = hp; } catch (e) { /* the poster is a bonus */ }
    photo.hidden = true; scrubRow.style.display = ""; linkNote.hidden = true; freezeBtn.disabled = false;
  } else {
    hfState.mediaType = "link";
    v.hidden = true; photo.hidden = true; scrubRow.style.display = "none";
    linkNote.hidden = false; freezeBtn.disabled = true;
  }
  // Round 127: the video wrap (player + overlay chrome) follows
  // the video's own visibility, and the player chrome resets —
  // a fresh play starts behind the first-play overlay again.
  const vWrap127 = $("#hfVideoWrap127"); if (vWrap127) vWrap127.hidden = v.hidden;
  hfResetPlayer127();
  hfSetSelected205(null); // Round 205: a new play starts with no frame picked
  hfBuildStrip();
  hfSyncFrozenThumb(); // new play: no print yet — confirmation hidden, Freeze label restored
  // Round 206: a new play resets the whole round — garment
  // preview back to the front view, the avatar maker cleared
  // (a generated avatar belongs to the previous play's frame),
  // the fine-scrub row follows the media kind, the style minis
  // re-render from the new play's poster, and the one-time
  // avatar configured check kicks off.
  hfState.garmentView206 = "back"; // Round 206 scope update: the preview opens on the back (Emil's mockup starting look), Black by the color reset above
  hfState.avatarDataUrl206 = "";
  hfState.avatarApplied206 = false;
  hfState.avatarPreview206 = false;
  hfState.avatarBusy206 = false;
  hfState.frameCanvas206 = null;
  hfState.designAspect218 = 0;
  hfState.avatarFocus221 = null;
  // Round 222: a new play resets the fence step too (a cleaned
  // photo belongs to the previous play's frame) and the seed
  // marker (this play has not seeded yet).
  hfState.fenceClean222 = "";
  hfState.fenceBusy222 = false;
  // Round 229: a new play resets the auto-clean too — verdict
  // cache, applied tracking, the session fallback, and any
  // in-flight run (token bump) all belong to the previous play.
  hfState.fenceAutoCache229 = {};
  hfState.fenceAutoKey229 = "";
  hfState.fenceAutoClean229 = "";
  hfState.fenceAutoOriginal229 = null;
  hfState.fenceAutoBusy229 = false;
  hfState.fenceAutoFailed229 = false;
  hfState.fenceAutoToken229 = (hfState.fenceAutoToken229 || 0) + 1;
  hfState.seedFrame215 = false;
  const fineRow206 = $("#hfFineRow206");
  if (fineRow206) fineRow206.hidden = hfState.mediaType !== "video";
  const fineTime206 = $("#hfFineTime206");
  if (fineTime206) fineTime206.textContent = "";
  hfGarmentSync206();
  hfSyncAvatar206();
  hfAvatarStatus206();
  // Round 215: a new play restarts the one-page studio on the
  // product page — the title names the athlete, the clip area
  // is labeled for this play and starts collapsed (photo and
  // link plays open it instead: their content IS the moment
  // picker), and the poster seed puts the play's frame on the
  // hoodie (hfSeedPoster215 — the garment already wears the
  // poster provisionally from the hfGarmentSync206 above, so
  // the seed swaps it for the composed print behind the same
  // geometry when it lands).
  // Round 222: the R215 option rows are gone — the sections
  // stand open in working order — and the seed is only the
  // provisional opener: when the filmstrip lands, the ★
  // recommended frame takes over as the default print
  // (hfRecommend205 reads seedFrame215).
  const title215 = $("#hfProductTitle215");
  if (title215) { const who215 = (play.athlete_label || play.player_name || "").trim(); title215.textContent = who215 ? `${who215}'s Hype Frame Hoodie` : "Your Hype Frame Hoodie"; }
  const sub215 = $("#hfProductSub215");
  if (sub215) sub215.textContent = hfState.mediaType === "link" ? `From the play “${play.title}”.` : `From the play “${play.title}” — the frame is already on the hoodie.`;
  hfShowScreen215("product", true);
  hfSyncClipRow211();
  hfSetClipOpen211(hfState.mediaType !== "video");
  if (typeof hfSyncRowStates215 === "function") hfSyncRowStates215();
  const photoMsg215 = $("#hfPhotoMsg215");
  if (photoMsg215) { photoMsg215.hidden = true; photoMsg215.textContent = ""; }
  hfSeedPoster215(play);
  if (typeof hfFenceStatus222 === "function") hfFenceStatus222(); // Round 222: the fence step's one-time configured check
  if (typeof hfSyncFence222 === "function") hfSyncFence222();
}
/* Frame filmstrip (2026-11-05): thumbnails captured client-side from
   the play's own video at ~1s intervals (coarser for long clips, max
   ~30 thumbs) in a scrollable strip under the video. Tapping one
   seeks the studio video to that moment and pauses — the kid then
   hits Freeze, or nudges with the ±1s buttons. Captures run on a
   detached video element so the studio player is never disturbed;
   plays are same-origin files, so the canvas is not tainted.
   Round 127 (2026-11-13): the tap now also PICKS the frame — see
   hfJumpToFrame; the Freeze button remains for scrub-and-freeze. */
let hfStripToken = 0;
/* Round 124: when a clip's frames can't be captured at all —
   the pre-conversion HEVC dead end (a browser that can't decode
   the file gets a black studio video and an empty strip) — the
   strip says so out loud instead of sitting silently empty. */
function hfStripNote124() {
  const strip = $("#hfStrip");
  if (!strip || strip.querySelector(".hf-strip-note")) return;
  const p = document.createElement("p");
  p.className = "hf-strip-note";
  p.textContent = "Couldn't pull frames from this clip — try a different play, or post it again so we can convert it.";
  strip.appendChild(p);
}
function hfBuildStrip() {
  const wrap = $("#hfStripWrap"), strip = $("#hfStrip");
  if (!wrap || !strip) return;
  const token = ++hfStripToken;
  strip.innerHTML = "";
  if (hfState.mediaType !== "video" || !hfState.play) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const cap = document.createElement("video");
  cap.muted = true; cap.playsInline = true; cap.preload = "auto";
  cap.src = hfState.play.media_url;
  // If the capture video never even reaches metadata (an
  // undecodable file can stall there), the note still lands.
  const slowTimer = setTimeout(() => {
    if (token === hfStripToken && !wrap.hidden && strip.querySelectorAll(".hf-thumb").length === 0) hfStripNote124();
  }, 6000);
  const cvs = document.createElement("canvas");
  cap.addEventListener("loadedmetadata", async () => {
    clearTimeout(slowTimer);
    const dur = cap.duration || 0;
    if (token !== hfStripToken) return;
    if (!dur) { hfStripNote124(); return; }
    const step = dur > 30 ? Math.ceil(dur / 30) : 1;
    const x = cvs.getContext("2d");
    for (let t = 0; t < dur; t += step) {
      if (token !== hfStripToken) return;
      await new Promise((res) => {
        const done = () => { cap.removeEventListener("seeked", done); res(); };
        cap.addEventListener("seeked", done);
        setTimeout(res, 1500); // never hang the strip on a stuck seek
        try { cap.currentTime = Math.min(t, Math.max(0, dur - 0.05)); } catch { res(); }
      });
      if (token !== hfStripToken || !cap.videoWidth) continue;
      cvs.width = 128;
      cvs.height = Math.max(1, Math.round(128 * cap.videoHeight / cap.videoWidth));
      x.drawImage(cap, 0, 0, cvs.width, cvs.height);
      const b = document.createElement("button");
      b.type = "button"; b.className = "hf-thumb";
      b.dataset.hfT = String(t); // Round 205: the still recommendation reads each thumb's moment back
      b.setAttribute("aria-label", `Jump to ${hfFmtTime(t)}`);
      const im = document.createElement("img");
      im.alt = ""; im.src = cvs.toDataURL("image/jpeg", 0.72);
      const lab = document.createElement("span");
      lab.textContent = hfFmtTime(t);
      b.appendChild(im); b.appendChild(lab);
      b.addEventListener("click", () => hfJumpToFrame(t, b));
      strip.appendChild(b);
    }
    // Round 124: the capture ran to completion and produced
    // NOTHING (every seek came back frameless) — say so.
    if (token === hfStripToken && strip.querySelectorAll(".hf-thumb").length === 0) hfStripNote124();
    // Round 205: with the strip complete, score its stills and
    // pre-pick the strongest frame (badge + selection) — the
    // family can always tap another thumb instead.
    if (token === hfStripToken && strip.querySelectorAll(".hf-thumb").length) await hfRecommend205(strip, token);
    // Round 222: with the ★ known, re-lead the strip with the
    // distinct shots (spread/deduped, ★ first).
    if (token === hfStripToken) hfDistinctStrip222(strip);
    cap.removeAttribute("src"); cap.load();
  });
}
/* Round 127 (2026-11-13, Emil: "when you click on the frames you
   have to hit it twice"): ONE tap now picks the frame. Verified
   diagnosis: no handler was eating the first tap — the thumbnail
   carries a plain click listener, touch-action:manipulation and
   no hover rule. hfJumpToFrame simply never set the selection:
   a tap sought + paused + lit the thumb, but hfState.frozen was
   only ever set by the separate Freeze button, so choosing a
   frame always took a second hit. Now the tap seeks, and when
   the seek lands the frame is captured + composed through the
   same choke point as Freeze (hfCapturePrint). The tap token
   keeps rapid successive taps from composing a stale frame —
   only the latest tap's seek captures. */
let hfTapToken127 = 0;
/* Round 205 (2026-11-26, Emil): the tap IS the selection, and it
   answers instantly. The label names the picked moment the moment
   it's tapped ("Frame selected · 0:04"), and the thumbnail's own
   already-loaded frame fills the player box right away
   (#hfInstant205 over the video) — the seek + full-res capture
   still compose the print behind it, and the overlay clears when
   that capture lands, so what gets submitted is unchanged: the
   full-resolution composed print, never the thumbnail. */
function hfSetSelected205(t) {
  const el = $("#hfSelected205");
  hfState.frameTime205 = (typeof t === "number" && isFinite(t)) ? t : null;
  // Round 215: the Change photo row's state names the picked frame.
  if (typeof hfSyncRowStates215 === "function") hfSyncRowStates215();
  if (!el) return;
  if (hfState.frameTime205 == null) { el.hidden = true; el.textContent = ""; return; }
  el.textContent = `Frame selected · ${hfFmtTime(hfState.frameTime205)}`;
  el.hidden = false;
  // Round 206: the fine-scrub readout names the EXACT picked
  // time (tenths included) next to the ±0.1s steppers.
  const fine206 = $("#hfFineTime206");
  if (fine206) fine206.textContent = hfFineFmt206(hfState.frameTime205);
}
/* Round 206: m:ss.d — the fine-scrub readout's format (the
   strip labels and the selection label keep whole seconds). */
function hfFineFmt206(t) {
  t = Math.max(0, Number(t) || 0);
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(1)}`;
}
function hfShowInstant205(btn) {
  const img = $("#hfInstant205"); if (!img) return;
  const thumb = btn && btn.querySelector ? btn.querySelector("img") : null;
  const src = thumb && thumb.src;
  if (!src) { hfHideInstant205(); return; }
  img.src = src;
  img.hidden = false;
}
function hfHideInstant205() {
  const img = $("#hfInstant205");
  if (img) { img.hidden = true; img.removeAttribute("src"); }
}
function hfJumpToFrame(t, btn) {
  const v = $("#hfVideo"); if (!v) return;
  v.pause();
  hfSetSelected205(t);
  hfShowInstant205(btn);
  const target = v.duration ? Math.min(Math.max(0, t), v.duration) : Math.max(0, t);
  const scrub = $("#hfScrub"); if (scrub) scrub.value = target;
  hfUpdateTime();
  $$("#hfStrip .hf-thumb").forEach((el) => el.classList.toggle("active", el === btn));
  if (hfState.mediaType !== "video") return;
  const token = ++hfTapToken127;
  // Round 215: a thumbnail tap (btn set) inside the Change
  // photo panel is the pick — once the capture lands,
  // hfPhotoPicked215 runs (in R215 it closed the panel and
  // scrolled the hoodie back into view). Round 222: the helper
  // is a no-op — the moment section stands open and the pinned
  // hoodie has already updated in view. The fine steppers pass
  // no button and never call it.
  const select = () => { if (token === hfTapToken127) { hfCapturePrint(); hfHideInstant205(); if (btn) hfPhotoPicked215(); } };
  if (v.readyState >= 2 && v.videoWidth && Math.abs((v.currentTime || 0) - target) < 0.05) { select(); return; }
  const onSeeked = () => { v.removeEventListener("seeked", onSeeked); select(); };
  v.addEventListener("seeked", onSeeked);
  if (v.duration) { try { v.currentTime = target; } catch { onSeeked(); } }
}
/* Round 215: after a filmstrip pick inside the Change photo
   panel, close the panel and scroll the garment back into
   view — the hoodie already shows the new frame.
   Round 222: retired — the panel it closed is now the
   always-open Your moment section, and the garment preview is
   pinned above it, so a pick needs no close and no scroll:
   the hoodie updates in place, already in view. Kept as a
   no-op: hfJumpToFrame still calls it on a thumbnail pick. */
function hfPhotoPicked215() {}
/* Round 205 still recommendation (Emil: "Can an agent recommend
   which still to use?"): the strip's OWN thumbnails are scored
   locally, in the browser, the moment the strip lands — no
   server, no vision model. Three signals, all from small canvas
   downscales of the thumbnails already on screen:
     sharpness — mean squared luma gradient; motion blur flattens
       it, and blur is what ruins a print;
     action — frame-difference energy against the neighbouring
       stills, peaking where the play happens (the same signal
       family as Round 203's band analysis, kept tiny);
     placement — the moving subject (the frame-diff mask) should
       cover a sane share of the frame, sit near the middle and
       not hug the edges, so the athlete reads on fabric.
   A near-black / blank still (Emil's black 0:00 and 0:01
   thumbnails) is DISQUALIFIED outright — it can never win. The
   winner wears a "Recommended" badge and is pre-selected through
   the same one-tap path as a manual pick; any other tap
   overrides it. Scoring runs after the strip renders and never
   blocks the studio opening. */
function hfThumbLuma205(img) {
  const W = 48;
  const iw = img.naturalWidth || 16, ih = img.naturalHeight || 9;
  const H = Math.max(1, Math.round(W * ih / iw));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(img, 0, 0, W, H);
  const d = x.getImageData(0, 0, W, H).data;
  const lum = new Float32Array(W * H);
  for (let i = 0, p = 0; i < lum.length; i++, p += 4) lum[i] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
  return { lum, w: W, h: H };
}
function hfScoreStills205(frames) {
  const n = frames.length;
  if (!n) return -1;
  const stats = frames.map((f) => {
    const { lum, w, h } = f;
    let sum = 0;
    for (let i = 0; i < lum.length; i++) sum += lum[i];
    let g = 0, gc = 0;
    for (let y = 0; y < h; y++) for (let xx = 0; xx < w - 1; xx++) { const dd = lum[y * w + xx + 1] - lum[y * w + xx]; g += dd * dd; gc++; }
    for (let y = 0; y < h - 1; y++) for (let xx = 0; xx < w; xx++) { const dd = lum[(y + 1) * w + xx] - lum[y * w + xx]; g += dd * dd; gc++; }
    return { mean: sum / lum.length, sharp: gc ? g / gc : 0, w, h };
  });
  // Pairwise frame differences: motion energy + the moving
  // subject's mask (share of frame, centroid, edge contact).
  // A pair touching a near-black still is EXCLUDED: a fade from
  // black (the classic black 0:00 thumb) differs from the first
  // real frame everywhere, which is a fade artifact, not action —
  // it carries no subject and must not crown the first frame.
  const pairs = [];
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1], b = frames[i];
    if (a.lum.length !== b.lum.length || stats[i - 1].mean < 10 || stats[i].mean < 10) { pairs.push(null); continue; }
    const { lum, w, h } = b;
    let diff = 0, mask = 0, mx = 0, my = 0, edge = 0;
    for (let k = 0; k < lum.length; k++) {
      const dd = Math.abs(lum[k] - a.lum[k]);
      diff += dd;
      if (dd > 22) {
        mask++;
        const px = k % w, py = (k / w) | 0;
        mx += px; my += py;
        if (px === 0 || py === 0 || px === w - 1 || py === h - 1) edge++;
      }
    }
    pairs.push({
      energy: diff / lum.length,
      maskFrac: mask / lum.length,
      cx: mask ? (mx / mask) / Math.max(1, w - 1) : 0.5,
      cy: mask ? (my / mask) / Math.max(1, h - 1) : 0.5,
      edgeFrac: mask ? edge / mask : 0,
    });
  }
  const pairAt = (i) => (i > 0 ? pairs[i - 1] : pairs[0]) || null; // frame i's mask: the pair that ENDS at i (frame 0: the pair that starts at it)
  const motionAt = (i) => Math.max(pairs[i - 1] ? pairs[i - 1].energy : 0, pairs[i] ? pairs[i].energy : 0);
  const ok = stats.map((s) => s.mean >= 10); // near-black / blank stills never win
  if (!ok.some(Boolean)) return -1;
  const norm = (vals) => { const m = Math.max(...vals, 1e-9); return vals.map((v) => v / m); };
  const sharpN = norm(stats.map((s) => s.sharp));
  const motionN = norm(stats.map((_, i) => motionAt(i)));
  let best = -1, bestScore = -Infinity;
  for (let i = 0; i < n; i++) {
    if (!ok[i]) continue;
    const pr = pairAt(i);
    let place = 0.5; // neutral when there is no motion read (single still)
    if (pr) {
      const cover = pr.maskFrac <= 0.005 ? 0 : pr.maskFrac >= 0.65 ? 0.35 : 1; // a subject, not nothing and not the whole frame
      const dx = pr.cx - 0.5, dy = pr.cy - 0.45;
      const centre = Math.max(0, 1 - Math.hypot(dx, dy) * 1.7);
      place = cover * (0.35 + 0.65 * centre) * (1 - 0.55 * pr.edgeFrac);
    }
    const score = 0.5 * sharpN[i] + 0.3 * motionN[i] + 0.45 * place * Math.min(1, sharpN[i] + 0.25);
    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}
async function hfRecommend205(strip, token) {
  const thumbs = [...strip.querySelectorAll(".hf-thumb")];
  if (!thumbs.length) return;
  const imgs = thumbs.map((b) => b.querySelector("img")).filter(Boolean);
  if (imgs.length !== thumbs.length) return;
  // The thumbnails are data URLs minted moments ago; wait for
  // their pixels before scoring (never blocks the studio — the
  // strip is already on screen and tappable).
  await Promise.all(imgs.map((im) => (im.complete && im.naturalWidth) ? null : new Promise((res) => { im.addEventListener("load", res, { once: true }); im.addEventListener("error", res, { once: true }); })));
  if (token !== hfStripToken) return;
  let frames;
  try { frames = imgs.map((im) => hfThumbLuma205(im)); } catch { return; }
  const best = hfScoreStills205(frames);
  if (best < 0 || token !== hfStripToken) return;
  const btn = thumbs[best];
  if (!btn || btn.querySelector(".hf-rec-badge205")) return;
  const badge = document.createElement("span");
  badge.className = "hf-rec-badge205";
  badge.textContent = "★ Recommended";
  btn.appendChild(badge);
  btn.setAttribute("aria-label", `${btn.getAttribute("aria-label") || ""} — recommended frame`);
  // Pre-select the winner through the one-tap path — unless the
  // family has already picked a frame themselves.
  // Round 222: the winner also replaces the poster SEED — the
  // studio's default print is the ★ frame's finished artwork,
  // never the raw poster (Emil: the Double's poster is mostly
  // fence). The seed only holds the fort until the strip is
  // scored; a frame the parent froze themselves
  // (seedFrame215 false) is never overridden.
  if (hfState.frameTime205 == null && (!hfState.frozen || hfState.seedFrame215)) hfJumpToFrame(Number(btn.dataset.hfT || 0), btn);
}
/* Round 222 (2026-11-26, Emil): the filmstrip leads with a few
   DISTINCT shots. A 1s-interval strip opens with near-identical
   runs (his example: 0:04–0:07 all look the same), so after the
   recommendation scores the stills, the strip is re-led by a
   spread, deduped selection — ★ first — chosen by comparing
   each still's luma signature (the Round 205 downscale) against
   the last DISTINCT still kept: under the difference floor two
   stills read as the same shot. Nothing is removed — the full
   strip follows the distinct set in its original order, and
   every thumbnail keeps its one-tap pick. The pick itself is a
   pure function of the luma frames + the ★ index. */
const HF_DISTINCT_MIN222 = 5; // mean absolute luma difference (0–255) under which two stills read as the same shot
const HF_DISTINCT_MAX222 = 8; // the distinct set never leads with more than this many stills
function hfDistinctPick222(frames, starIdx) {
  const n = frames.length;
  const all = frames.map((_, i) => i);
  if (n < 2) return all;
  const diff = (a, b) => {
    const la = frames[a] && frames[a].lum, lb = frames[b] && frames[b].lum;
    if (!la || !lb || la.length !== lb.length || !la.length) return Infinity; // an unreadable pair never suppresses a still
    let s = 0;
    for (let i = 0; i < la.length; i++) s += Math.abs(la[i] - lb[i]);
    return s / la.length;
  };
  const kept = [];
  let last = -1;
  for (let i = 0; i < n && kept.length < HF_DISTINCT_MAX222; i++) {
    if (i === starIdx) { kept.push(i); last = i; continue; } // the ★ still always makes the distinct set
    if (last < 0 || diff(i, last) > HF_DISTINCT_MIN222) { kept.push(i); last = i; }
  }
  const hasStar = starIdx != null && starIdx >= 0 && starIdx < n;
  if (hasStar && !kept.includes(starIdx)) kept.unshift(starIdx);
  const head = hasStar && kept.includes(starIdx) ? [starIdx, ...kept.filter((i) => i !== starIdx)] : kept;
  const rest = all.filter((i) => !head.includes(i));
  return [...head, ...rest];
}
function hfDistinctStrip222(strip) {
  const thumbs = [...strip.querySelectorAll(".hf-thumb")];
  if (thumbs.length < 2) return;
  const imgs = thumbs.map((b) => b.querySelector("img")).filter(Boolean);
  if (imgs.length !== thumbs.length) return;
  if (imgs.some((im) => !im.naturalWidth)) return; // stills not decoded yet — leave the strip as built
  let frames;
  try { frames = imgs.map((im) => hfThumbLuma205(im)); } catch { return; }
  const star = thumbs.findIndex((b) => !!b.querySelector(".hf-rec-badge205"));
  const order = hfDistinctPick222(frames, star >= 0 ? star : null);
  if (order.every((v, i) => v === i)) return;
  for (const i of order) strip.appendChild(thumbs[i]); // appendChild moves the node — the distinct set leads, the rest follow in order
}
function hfFmtTime(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
function hfUpdateTime() {
  const v = $("#hfVideo");
  $("#hfTime").textContent = `${hfFmtTime(v.currentTime)} / ${hfFmtTime(v.duration)}`;
}
/* The capture half of a freeze, shared by the Freeze button and
   the Round 127 one-tap filmstrip pick: draw the CURRENT frame
   (video or photo) into the print canvas and compose it. Returns
   false when there is nothing capturable yet. */
function hfCapturePrint() {
  const c = $("#hfCanvas"), x = c.getContext("2d");
  if (hfState.mediaType === "video") {
    const v = $("#hfVideo");
    if (!v.videoWidth || v.readyState < 2) return false;
    c.width = v.videoWidth; c.height = v.videoHeight;
    x.drawImage(v, 0, 0, c.width, c.height);
  } else if (hfState.mediaType === "image") {
    const im = $("#hfPhoto");
    if (!im.naturalWidth) return false;
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    x.drawImage(im, 0, 0, c.width, c.height);
  } else {
    return false;
  }
  hfState.frozen = true;
  hfState.seedFrame215 = false; // Round 222: a real capture — the ★ pre-select never overrides the parent's own frame
  // Round 206: snapshot the raw frame (the avatar maker sends
  // THIS to OpenAI, and "Use my photo" restores it verbatim),
  // and stand the avatar down — it was made from whatever frame
  // was frozen before, never from this new one.
  try {
    if (!hfState.frameCanvas206) hfState.frameCanvas206 = document.createElement("canvas");
    hfState.frameCanvas206.width = c.width; hfState.frameCanvas206.height = c.height;
    hfState.frameCanvas206.getContext("2d").drawImage(c, 0, 0);
  } catch { hfState.frameCanvas206 = null; }
  hfState.avatarDataUrl206 = "";
  hfState.avatarApplied206 = false;
  hfState.avatarPreview206 = false;
  hfState.designAspect218 = 0;
  hfState.avatarFocus221 = null; // Round 221: a new frame re-centers the avatar crop
  hfState.fenceClean222 = ""; // Round 222: a cleaned photo belongs to the frame it cleaned
  if (typeof hfFenceAutoReset229 === "function") hfFenceAutoReset229(); // Round 229: …and so does an auto-clean
  if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
  if (typeof hfSyncFence222 === "function") hfSyncFence222();
  composeHfPrint();
  if (typeof hfAutoFence229 === "function") hfAutoFence229(); // Round 229: a picked/frozen frame is auto-checked + cleaned
  return true;
}
function freezeHfFrame() {
  if (!hfState.play) { alert("Pick a play on the board first."); return; }
  if (hfState.mediaType === "video") $("#hfVideo").pause(); // freeze works mid-play: stop on this exact frame first
  if (hfCapturePrint()) {
    // Round 205: a Freeze is a frame selection too — the label
    // names the moment, and the video itself is showing the real
    // frame now, so the instant preview stands down.
    hfHideInstant205();
    if (hfState.mediaType === "video") hfSetSelected205($("#hfVideo").currentTime || 0);
    return;
  }
  if (hfState.mediaType === "video") alert("Give the video a moment to load, then freeze again.");
  else if (hfState.mediaType === "image") alert("Give the photo a moment to load, then freeze again.");
  else alert("This play was posted as a link, so a frame can't be frozen from it here.");
}
/* Round 127 studio player chrome: #hfVideo carries NO native
   controls (iOS's big center play button sat on the paused frame
   Emil was trying to judge). The custom overlay (#hfBigPlay127)
   starts the FIRST play only; once playback has started it never
   covers the picture again. Tapping the video surface toggles
   play/pause with a brief corner flash (#hfTapFlash127) as the
   only feedback; the persistent play/pause lives in the scrub
   row (#hfPlayBtn127). A paused frame is completely clean. */
let hfPlayed127 = false;
let hfFlashTimer127 = 0;
function hfSyncPlayBtn127() {
  const v = $("#hfVideo"), b = $("#hfPlayBtn127");
  if (!v || !b) return;
  const playing = !v.paused && !v.ended;
  b.textContent = playing ? "❚❚" : "▶";
  b.setAttribute("aria-label", playing ? "Pause" : "Play");
}
function hfFlash127(playing) {
  const f = $("#hfTapFlash127"); if (!f) return;
  f.textContent = playing ? "▶" : "❚❚";
  f.classList.add("show127");
  clearTimeout(hfFlashTimer127);
  hfFlashTimer127 = setTimeout(() => f.classList.remove("show127"), 650);
}
function hfTogglePlay127(fromSurface) {
  const v = $("#hfVideo"); if (!v) return;
  if (v.paused || v.ended) { const p = v.play(); if (p && p.catch) p.catch(() => {}); if (fromSurface) hfFlash127(true); }
  else { v.pause(); if (fromSurface) hfFlash127(false); }
}
function hfResetPlayer127() {
  hfPlayed127 = false;
  const big = $("#hfBigPlay127"); if (big) big.hidden = false;
  const f = $("#hfTapFlash127"); if (f) f.classList.remove("show127");
  hfHideInstant205(); // Round 205: no stale instant preview on a fresh play
  hfSyncPlayBtn127();
}
// Print tone for the Hype Frame frame + lockup: bone on dark garments,
// ink on light ones, derived from the selected colorway's hex.
function hfPrintTone() {
  const list = HF_COLORWAYS[hfState.apparel] || [];
  const cw = list.find((k) => k.name === hfState.colorway) || list[0];
  const hex = (cw && cw.hex) || "#17171a";
  const n = parseInt(hex.slice(1), 16);
  const lum = (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255;
  return lum > 0.55 ? "#181209" : "#f6f1e4";
}
// The poster's grunge frame: each edge is walked in short segments
// with jittered offsets and occasional gaps, over three passes of
// varying weight and alpha — a rough brush stroke, not a ruler line.
// A fixed seed keeps the frame identical on every recompose.
function hfGrungeFrame(x, W, H, tone) {
  let seed = 20261104;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const ins = W * 0.016;
  x.save();
  x.strokeStyle = tone; x.lineCap = "round";
  for (const [wf, alpha] of [[0.020, 0.35], [0.013, 0.85], [0.007, 0.9]]) {
    const lw = Math.max(2, W * wf);
    x.lineWidth = lw; x.globalAlpha = alpha;
    const edges = [
      [ins, ins, W - ins, ins], [W - ins, ins, W - ins, H - ins],
      [W - ins, H - ins, ins, H - ins], [ins, H - ins, ins, ins],
    ];
    for (const [x1, y1, x2, y2] of edges) {
      const len = Math.hypot(x2 - x1, y2 - y1), steps = Math.max(8, Math.round(len / (W * 0.055)));
      for (let i = 0; i < steps; i++) {
        if (rnd() < 0.10) continue; // distressed gap in the stroke
        const t0 = i / steps, t1 = (i + 1) / steps;
        const j = () => (rnd() - 0.5) * lw * 1.1;
        x.beginPath();
        x.moveTo(x1 + (x2 - x1) * t0 + j(), y1 + (y2 - y1) * t0 + j());
        x.lineTo(x1 + (x2 - x1) * t1 + j(), y1 + (y2 - y1) * t1 + j());
        x.stroke();
      }
    }
  }
  x.restore();
}
// The lockup band under the photo: purple crown (the poster's accent),
// HYPE FRAME in a heavy italic with a slight tilt (brush-script
// stand-in from the loaded font stack — no external font files), a
// purple brush underline swash, and HIGHLIGHTHYPE small beneath.
function hfDrawLockup(x, W, H, bandH, tone) {
  const cx = W / 2;
  x.save();
  x.textAlign = "center"; x.textBaseline = "middle";
  const cw = W * 0.115, ch = cw * 0.56, crownX = cx - cw / 2, crownY = H + bandH * 0.04;
  x.fillStyle = "#8b3dff";
  x.beginPath();
  x.moveTo(crownX, crownY + ch);
  x.lineTo(crownX + cw * 0.06, crownY + ch * 0.18);
  x.lineTo(crownX + cw * 0.30, crownY + ch * 0.52);
  x.lineTo(crownX + cw * 0.50, crownY);
  x.lineTo(crownX + cw * 0.70, crownY + ch * 0.52);
  x.lineTo(crownX + cw * 0.94, crownY + ch * 0.18);
  x.lineTo(crownX + cw, crownY + ch);
  x.closePath(); x.fill();
  const fs = Math.round(W * 0.088);
  x.translate(cx, H + bandH * 0.56); x.rotate(-0.018);
  x.font = `italic 900 ${fs}px Archivo, "Arial Black", Arial, sans-serif`;
  try { x.letterSpacing = "1px"; } catch {}
  x.fillStyle = tone;
  x.fillText("HYPE FRAME", 0, 0);
  const tw = x.measureText("HYPE FRAME").width;
  x.strokeStyle = "#8b3dff"; x.lineCap = "round"; x.lineWidth = Math.max(3, W * 0.011);
  x.beginPath();
  x.moveTo(-tw * 0.52, fs * 0.52);
  x.quadraticCurveTo(0, fs * 0.66, tw * 0.52, fs * 0.44);
  x.stroke();
  x.restore();
  const fs2 = Math.max(11, Math.round(W * 0.030));
  x.save();
  x.textAlign = "center"; x.textBaseline = "middle";
  x.font = `800 ${fs2}px Archivo, Arial, sans-serif`;
  try { x.letterSpacing = "5px"; } catch {}
  x.globalAlpha = 0.85; x.fillStyle = tone;
  x.fillText("HIGHLIGHTHYPE", cx, H + bandH * 0.90);
  x.restore();
}
/* Round 218 (2026-11-26, Emil): the Hype Frame FORMAT — the
   print design from Emil's Nicholas artwork, applied to every
   order. Top to bottom: the athlete's name in huge brush
   lettering (BLUE for boys, PINK for girls — sampled from his
   artwork: #0a63f0 / #f00080), a gold brush crown at the top
   right, the moment's short label in small letter-spaced
   capitals with a thin gold stroke beneath, the moment inside
   a distressed white frame, then HYPE FRAME in huge white
   brush lettering with HIGHLIGHTHYPE beneath. The PHOTO path
   composes it here on a TRANSPARENT canvas — no background
   fill anywhere (Emil: "get rid of the black background"): the
   DTF print carries the elements only, like the shop's own
   transparent test files. The AVATAR path generates the same
   format server-side on solid black (the model needs the
   ground) and the garment previews knock the black out with
   screen blend (hfGarmentPaint211). */
const HF_TONE_BLUE218 = "#0a63f0";
const HF_TONE_PINK218 = "#f00080";
const HF_GOLD218 = "#f0b400";
const HF_BONE218 = "#f6f1e4";
function hfTone218() {
  return (hfState.play && hfState.play.division) === "girls" ? "pink" : "blue";
}
function hfToneColor218() { return hfTone218() === "pink" ? HF_TONE_PINK218 : HF_TONE_BLUE218; }
/* The design's name slot: the format prints the athlete's FIRST
   name. The name field itself still carries the full name for
   the order, exactly as before. */
function hfDesignFirstName218() {
  const n = ($("#hfName") ? $("#hfName").value.trim() : "");
  return n.split(/\s+/)[0] || "";
}
const HF_LABEL_RE218 = /^[\p{L}\p{N} .,'&#!-]*$/u;
function hfDesignLabel218() {
  const raw = (($("#hfLabel218") ? $("#hfLabel218").value : "") || "").trim().replace(/\s+/g, " ");
  return (HF_LABEL_RE218.test(raw) ? raw : "").slice(0, 24).toUpperCase();
}
function hfLabelDefault218(play) {
  return String((play && play.title) || "").replace(/[^\p{L}\p{N} .,'&#!-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 24).toUpperCase();
}
/* The format's top line, from the R197 name-mode choice (the
   studio's "Name on design" control): the name, the name with
   the number riding with it, nothing, or the custom words. */
function hfDesignTopLine218() {
  if (hfState.backText === "none") return "";
  if (hfState.backText === "custom") return ($("#hfBackCustom197") ? $("#hfBackCustom197").value.trim() : "");
  const first = hfDesignFirstName218();
  if (hfState.backText === "name_number") {
    const num = ($("#hfJersey") ? $("#hfJersey").value.trim().replace(/^#/, "").replace(/\D/g, "") : "");
    return [first, num].filter(Boolean).join(" ");
  }
  return first;
}
/* The crown asset for the composed design (public/crown.png —
   gold on transparency, the same crown the homepage card
   header wears). Loaded lazily; a compose that beats the load
   draws without it and the load's arrival recomposes. */
let hfCrownImg218 = null;
function hfCrown218() {
  if (!hfCrownImg218) {
    hfCrownImg218 = new Image();
    hfCrownImg218.onload = () => { if (hfState.frozen && typeof composeHfPrint === "function") composeHfPrint(); };
    hfCrownImg218.src = "/crown.png";
  }
  return (hfCrownImg218.naturalWidth || 0) > 0 ? hfCrownImg218 : null;
}
/* Format geometry, in units of the canvas width W — pure math,
   shared by the full-size composition and the style minis, so
   the mini mirrors the real composition exactly. The photo is
   contain-fit into the frame (never cropped); the canvas
   height adapts to the photo's shape between the header and
   the branding footer. */
function hfFormatLayout218(W, artW, artH, hasTop) {
  const frameW = W * 0.90;
  const maxFrameH = W * 0.98;
  const aW = Math.max(1, artW || 1), aH = Math.max(1, artH || 1);
  const scale = Math.min(frameW / aW, maxFrameH / aH);
  const fw = Math.max(1, Math.round(aW * scale)), fh = Math.max(1, Math.round(aH * scale));
  const headerH = hasTop ? W * 0.235 : W * 0.125;
  const footerH = W * 0.205;
  return { headerH, footerH, fw, fh, frameX: Math.round((W - fw) / 2), frameY: Math.round(headerH), totalH: Math.round(headerH + fh + footerH) };
}
/* Draw the format onto a 2d context of width W. NOTHING fills
   the background — the canvas stays transparent outside the
   elements (the name, the label + gold rule, the crown, the
   framed photo, the branding). */
function hfDrawFormat218(x, W, art, lay) {
  const top = hfDesignTopLine218();
  const label = hfDesignLabel218();
  const cx = W / 2;
  x.save();
  x.textAlign = "center"; x.textBaseline = "middle";
  if (top) {
    const fs = Math.round(W * 0.115);
    x.save();
    x.translate(cx, W * 0.082); x.rotate(-0.012);
    x.font = `italic 900 ${fs}px Archivo, "Arial Black", Arial, sans-serif`;
    x.fillStyle = hfToneColor218();
    x.fillText(top.toUpperCase(), 0, 0);
    x.restore();
  }
  if (label) {
    const ly = top ? W * 0.168 : W * 0.062;
    const fs2 = Math.max(10, Math.round(W * 0.033));
    x.save();
    x.font = `800 ${fs2}px Archivo, Arial, sans-serif`;
    try { x.letterSpacing = Math.max(2, Math.round(W * 0.008)) + "px"; } catch {}
    x.fillStyle = HF_BONE218;
    x.fillText(label, cx, ly);
    x.restore();
    x.save();
    x.strokeStyle = HF_GOLD218; x.lineCap = "round"; x.lineWidth = Math.max(2, W * 0.007);
    x.beginPath();
    x.moveTo(cx - W * 0.30, ly + W * 0.034);
    x.quadraticCurveTo(cx, ly + W * 0.042, cx + W * 0.30, ly + W * 0.030);
    x.stroke();
    x.restore();
  }
  const crown = hfCrown218();
  if (crown) {
    const cw = W * 0.155, ch = cw * (crown.naturalHeight / crown.naturalWidth);
    x.drawImage(crown, W - cw - W * 0.035, W * 0.012, cw, ch);
  }
  x.drawImage(art, lay.frameX, lay.frameY, lay.fw, lay.fh);
  x.save();
  x.translate(lay.frameX, lay.frameY);
  hfGrungeFrame(x, lay.fw, lay.fh, HF_BONE218);
  x.restore();
  const fy = lay.frameY + lay.fh;
  const fs3 = Math.round(W * 0.098);
  x.save();
  x.translate(cx, fy + lay.footerH * 0.42); x.rotate(-0.015);
  x.font = `italic 900 ${fs3}px Archivo, "Arial Black", Arial, sans-serif`;
  x.fillStyle = HF_BONE218;
  x.fillText("HYPE FRAME", 0, 0);
  x.restore();
  const fs4 = Math.max(10, Math.round(W * 0.030));
  x.save();
  x.font = `800 ${fs4}px Archivo, Arial, sans-serif`;
  try { x.letterSpacing = Math.max(2, Math.round(W * 0.010)) + "px"; } catch {}
  const total = x.measureText("HIGHLIGHTHYPE").width;
  const hiW = x.measureText("HIGHLIGHT").width;
  x.textAlign = "left";
  x.fillStyle = HF_BONE218;
  x.fillText("HIGHLIGHT", cx - total / 2, fy + lay.footerH * 0.80);
  x.fillStyle = HF_GOLD218;
  x.fillText("HYPE", cx - total / 2 + hiW, fy + lay.footerH * 0.80);
  x.restore();
  x.restore();
}

/* Freeze confirmation (Fixes batch, 2026-11-05): Round 2 removed the
   studio preview, and with it went the ONLY visible sign that a
   freeze had worked — users tapped Freeze and saw nothing change.
   This is deliberately NOT the apparel preview coming back (no
   garment mock, no pickers): the composed print itself, shown small
   under the freeze row, plus the Freeze button relabels. Synced from
   composeHfPrint — the single choke point every recompose flows
   through (freeze, print-style preset, name/jersey edits) — so the
   thumbnail always tracks the current print, and it hides again
   whenever there is no print (new play opened, not frozen yet). */
const HF_FREEZE_LABEL = "📸 Freeze this frame";
function hfSyncFrozenThumb() {
  const wrap = $("#hfFrozenWrap"), img = $("#hfFrozenImg"), btn = $("#hfFreeze");
  if (!wrap || !img) return;
  if (hfState.frozen && hfState.printDataUrl) {
    img.src = hfState.printDataUrl;
    wrap.hidden = false;
    if (btn) btn.textContent = "Frame frozen ✓ — tap to re-freeze";
  } else {
    wrap.hidden = true;
    img.removeAttribute("src");
    if (btn) btn.textContent = HF_FREEZE_LABEL;
  }
  // Round 206: the on-garment preview rides the same choke
  // point, so it tracks every recompose (freeze, colorway, name
  // edit, avatar apply/revert). (→229: the print-style minis
  // rode here too — retired with the Print style picker.)
  if (typeof hfGarmentSync206 === "function") hfGarmentSync206();
  // Round 206 scope update: the "Change frame" action under the
  // picked-frame thumbnail shows exactly when a frame is picked.
  const changeFrame206 = $("#hfChangeFrame206");
  if (changeFrame206) changeFrame206.hidden = !(hfState.frozen && hfState.printDataUrl);
}
/* Round 128 (2026-11-13, Emil): tap the composed print → see it
   BIG. The lightbox reads hfState.printDataUrl at OPEN time, so
   it always shows the CURRENT composition (a name, preset or
   colorway edit recomposes it). One tap only — the two-tap flow
   was just removed in Round 127; ✕, a backdrop tap, or Esc
   closes, and closing restores the page exactly as it was. */
function hfOpenLightbox128() {
  const lb = $("#hfLightbox128"), im = $("#hfLightboxImg128");
  if (!lb || !im || !hfState.frozen || !hfState.printDataUrl) return;
  im.src = hfState.printDataUrl;
  lb.hidden = false;
  document.body.style.overflow = "hidden";
}
function hfCloseLightbox128() {
  const lb = $("#hfLightbox128"), im = $("#hfLightboxImg128");
  if (!lb || lb.hidden) return;
  lb.hidden = true;
  if (im) im.removeAttribute("src");
  document.body.style.overflow = "";
}
(function wireHfLightbox128() {
  const wrap = $("#hfFrozenWrap"), lb = $("#hfLightbox128"), closeBtn = $("#hfLightboxClose128");
  if (wrap) {
    wrap.addEventListener("click", hfOpenLightbox128);
    wrap.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hfOpenLightbox128(); } });
  }
  if (closeBtn) closeBtn.addEventListener("click", hfCloseLightbox128);
  if (lb) lb.addEventListener("click", (e) => { if (e.target === lb) hfCloseLightbox128(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hfCloseLightbox128(); });
})();
// Compose the FINAL print image: the frozen frame, the optional HYPE
// FRAME poster treatment (grunge frame + lockup band), and the name /
// jersey caption under the frame. The submitted order carries this
// exact image — what is composed here is what would print. (Round 2:
// the composition is no longer shown on a garment preview in the
// studio; it lives in hfState and rides on the order payload.)
function composeHfPrint() {
  if (!hfState.frozen) { hfState.printDataUrl = ""; hfState.printAspect = 0; hfSyncFrozenThumb(); return; }
  // Round 218: an approved avatar design IS the print, wholesale —
  // the generated design already carries the name, label, crown,
  // frame and branding, so it is never re-wrapped or recomposed;
  // the order's print image is the design itself.
  if (hfState.avatarApplied206 && hfState.avatarDataUrl206) {
    hfState.printDataUrl = hfState.avatarDataUrl206;
    hfState.printAspect = hfState.designAspect218 || 0;
    hfSyncFrozenThumb();
    return;
  }
  const fc = $("#hfCanvas");
  const W = fc.width, H = fc.height;
  // Round 229 (2026-11-27, Emil): the Print style presets are
  // GONE — every design is the Hype Frame format, so the photo
  // path always composes the format (the Classic photo-only and
  // Signature caption-band branches are retired with the picker).
  // Round 218: the photo path composes the FORMAT around the
  // real photo on a transparent canvas (hfDrawFormat218) —
  // the photo itself stays a photo, untouched inside the
  // distressed frame; only the elements are drawn around it.
  const lay = hfFormatLayout218(W, W, H, !!hfDesignTopLine218());
  const c = document.createElement("canvas");
  c.width = W; c.height = lay.totalH;
  const x = c.getContext("2d");
  hfDrawFormat218(x, W, fc, lay);
  hfState.printDataUrl = c.toDataURL("image/png");
  hfState.printAspect = c.height / c.width;
  hfSyncFrozenThumb();
}
/* Round 205 (2026-11-26, Emil): the order summary line above the
   email field — the order at a glance, rebuilt from live state on
   every pick (color, size, side, print style), in the studio's
   own vocabulary: "Black hoodie · Youth M · Front print · Hype
   Frame". Youth sizes carry their Y in the picker (YM) and read
   as "Youth M" here. */
/* Round 229: only the Hype Frame label survives — the preset
   state is fixed to "hypeframe" and any legacy value falls back
   to this label through the || at each lookup. */
const HF_PRESET_LABELS205 = { hypeframe: "Hype Frame" };
function hfSummary205() {
  // Round 222: an unpicked size reads as itself — never as a
  // silent YM (there is no default size any more).
  const size = hfState.size || "";
  const sizeLabel = !size ? "Pick a size" : size.startsWith("Y") ? `Youth ${size.slice(1)}` : `Adult ${size}`;
  const sideLabel = hfState.side === "back" ? "Back print" : "Front print";
  return `${hfState.colorway} hoodie · ${sizeLabel} · ${sideLabel} · ${HF_PRESET_LABELS205[hfState.preset] || "Hype Frame"}`;
}
function hfSyncSummary205() {
  const el = $("#hfSummary205");
  if (el) el.textContent = hfSummary205();
}
/* Round 229: hfSetPreset is RETIRED with the Print style
   picker — hfState.preset is fixed to "hypeframe" at state
   creation and at every studio open; nothing can change it. */
// Hoodie color + youth size (Round 3, 2026-11-05): Emil reversed the
// Round 2 simplification for these two fields. The color drives the
// composed print's frame tone (hfPrintTone reads hfState.colorway), so
// picking one re-composes a frozen print exactly like a style change.
// The garment stays "hoodie" and the side stays "front" — there is
// still no apparel mock, garment picker or side toggle.
// Round 199: adult sizes (S–XL) join the six youth sizes — the
// same ten the Shopify product carries, so the payment handoff
// maps 1:1. One list: hfPickSize validates against it and the
// server mirrors it.
// Round 226 (2026-11-27, Emil): YXXS is cut CATALOG-WIDE — the
// list below is the nine surviving sizes, and the studio list
// is the same nine (Round 222's studio-only cut is superseded).
const HF_SIZES = ["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"];
/* Round 222 (2026-11-26, Emil): the STUDIO offers nine of the
   ten — YXXS is not offered here ("get rid of XXS — they
   tighten up onto one line"), while it stays in the store, in
   HF_SIZES above, in the server's whitelist and in the Shopify
   variant map. hfPickSize validates against THIS list, so a
   studio pick can never be YXXS.
   →226: the cut went catalog-wide — this list and HF_SIZES are
   now the same nine; the server whitelist and the Shopify
   variant map dropped YXXS too. */
const HF_STUDIO_SIZES222 = ["YXS", "YS", "YM", "YL", "YXL", "S", "M", "L", "XL"];
function hfPickColor(name) {
  const list = HF_COLORWAYS[hfState.apparel] || [];
  if (!list.some((k) => k.name === name)) return;
  hfState.colorway = name;
  $$("#hfColors [data-hf-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfColor === name)));
  hfSyncSummary205();
  if (hfState.frozen) composeHfPrint();
  // Round 206: the garment preview wears the picked colorway —
  // synced explicitly (not only via a recompose) so the garment
  // illustration follows even before a frame is frozen.
  if (typeof hfGarmentSync206 === "function") hfGarmentSync206();
}
function hfPickSize(size) {
  if (!HF_STUDIO_SIZES222.includes(size)) return; // Round 222: the studio's nine — YXXS is not offered here (→226: cut catalog-wide)
  hfState.size = size;
  $$("#hfSizes [data-hf-size]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfSize === size)));
  hfSyncSummary205();
  // Round 222: a pick answers the Review gate's size prompt.
  const sizeMsg222 = $("#hfSizeMsg222");
  if (sizeMsg222) { sizeMsg222.hidden = true; sizeMsg222.textContent = ""; }
}
/* Round 222: NO preselected size — a new play starts sizeless
   (the R215 YM default is gone at Emil's direction) and the
   Review gate holds until the parent taps a size. */
function hfClearSize222() {
  hfState.size = "";
  $$("#hfSizes [data-hf-size]").forEach((b) => b.setAttribute("aria-pressed", "false"));
  const sizeMsg222 = $("#hfSizeMsg222");
  if (sizeMsg222) { sizeMsg222.hidden = true; sizeMsg222.textContent = ""; }
  hfSyncSummary205();
}
/* Print side (RESTORED in Round 35, 2026-11-07 — Emil's call after
   the usability audit): the picker was removed in the Round 3 studio
   revision, but the order payload, the server column, the owner
   email and the Owner view carried the side all along — orders just
   always said Front. Now the family picks; default stayed Front
   until Round 208 (2026-11-26, Emil) flipped it to Back: the
   framed print is a back print (his configurator mockup, the DTF
   shop's back-print format, the hoodie-back example photo) and
   the front carries the embroidered crest. Front remains fully
   selectable; only the fallback/default changed. */
function hfPickSide(side) {
  hfState.side = side === "front" ? "front" : "back";
  $$("#hfSides [data-hf-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfSide === hfState.side)));
  hfSyncSummary205();
  // Round 206 (scope update, Emil): the garment preview's
  // front/back flip is a VIEW control only — it never mutates
  // the print side, the placement, or anything on the order.
  // Picking a print side here just re-renders the preview (so
  // it stays truthful about which view carries the print);
  // the preview's own view is NOT changed by this picker.
  if (typeof hfGarmentSync206 === "function") hfGarmentSync206();
  if (typeof hfSyncRowStates215 === "function") hfSyncRowStates215();
}
/* Photo or Avatar (Round 38, 2026-11-08 — Twinkie's idea, approved by
   Twinkie + Nicholas): 'photo' prints the frozen frame as-is; 'avatar'
   has the frame illustrated at fulfillment. The choice rides on the
   order exactly like the print side; default is the real photo, reset
   for each new play. */
function hfPickImageStyle(style) {
  hfState.imageStyle = style === "avatar" ? "avatar" : "photo";
  $$("#hfImageStyles [data-hf-image-style]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfImageStyle === hfState.imageStyle)));
  // Round 206: the avatar maker panel follows the style pick
  // (it also kicks the one-time configured check).
  if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
  if (typeof hfSyncRowStates215 === "function") hfSyncRowStates215();
}
/* Words on the back (Round 197, 2026-11-25 — parent feedback Emil
   received with the first delivered sweatshirt): the embroidered
   back text is the family's choice — the player's name (the
   default, exactly as before), name + jersey number, no name at
   all, or their own short line of words. The choice rides on the
   order; the name/number fields stay the order's name data, and a
   custom line is validated here AND on the server (16 characters,
   stitchable characters only — the server copy enforces). The
   owner reads every custom line before production: the Owner view
   flags unreviewed custom orders (see hfMarkBackTextReviewed197). */
const HF_BACK_TEXT_197 = ["name", "name_number", "none", "custom"];
const HF_CUSTOM_TEXT_RE197 = /^[\p{L}\p{N} .,'&#!-]+$/u;
function hfCustomTextError197(raw) {
  const t = String(raw || "").trim();
  if (!t) return "Write the words you'd like on the back — or pick one of the other back-text options.";
  if (t.length > 16) return "Custom words are limited to 16 characters — the embroidery space across the back is tight.";
  if (!HF_CUSTOM_TEXT_RE197.test(t)) return "Custom words can use letters, numbers, spaces and basic punctuation only — embroidery can't stitch emoji or other symbols.";
  return "";
}
function hfPickBackText197(choice) {
  hfState.backText = HF_BACK_TEXT_197.includes(choice) ? choice : "name";
  $$("#hfBackText197 [data-hf-back-text]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfBackText === hfState.backText)));
  const customRow = $("#hfBackCustomRow197");
  if (customRow) customRow.hidden = hfState.backText !== "custom";
  // Round 205: the jersey number field shows ONLY when it affects
  // the design — the Name + number choice. Its value is left in
  // place while hidden (the Signature caption still reads it);
  // the digits-required validation for name_number is unchanged.
  const jerseyRow205 = $("#hfJerseyRow205");
  if (jerseyRow205) jerseyRow205.hidden = hfState.backText !== "name_number";
  // With "No name" or "Your own words" picked, the name/number
  // fields no longer decide the back — disable them so the form
  // never implies otherwise. Their values stay put (the composed
  // print's Signature caption still reads them).
  const lockName = hfState.backText === "none" || hfState.backText === "custom";
  const nameEl = $("#hfName"), jerseyEl = $("#hfJersey");
  if (nameEl) nameEl.disabled = lockName;
  if (jerseyEl) jerseyEl.disabled = lockName;
  // Round 206: the garment preview's back shows the picked
  // treatment — it follows the choice even when the composed
  // print itself doesn't change (the Classic style).
  // Round 218: the choice IS the design's top line now — a
  // frozen format print recomposes on the pick.
  if (hfState.frozen && typeof composeHfPrint === "function") composeHfPrint();
  if (typeof hfGarmentSync206 === "function") hfGarmentSync206();
  if (typeof hfSyncRowStates215 === "function") hfSyncRowStates215();
}
function hfBuildColorButtons() {
  const wrap = $("#hfColors");
  if (!wrap || wrap.childElementCount) return;
  for (const k of HF_COLORWAYS.hoodie) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hf-color";
    b.dataset.hfColor = k.name;
    b.setAttribute("aria-pressed", String(hfState.colorway === k.name));
    b.setAttribute("aria-label", `Hoodie color ${k.name}`);
    b.innerHTML = `<span class="hf-color-dot" style="--sw:${k.hex}"></span>${k.name}`;
    b.addEventListener("click", () => hfPickColor(k.name));
    wrap.appendChild(b);
  }
}
(function () {
  const v = $("#hfVideo");
  if (!v) return;
  v.addEventListener("loadedmetadata", () => { $("#hfScrub").max = v.duration || 0; hfUpdateTime(); });
  v.addEventListener("timeupdate", () => { $("#hfScrub").value = v.currentTime || 0; hfUpdateTime(); });
  /* Round 127: custom player chrome — overlay starts the first
     play, the surface toggles after that, the scrub-row button
     is the persistent control (see hfTogglePlay127). */
  const bigPlay127 = $("#hfBigPlay127"), playBtn127 = $("#hfPlayBtn127");
  if (bigPlay127) bigPlay127.addEventListener("click", () => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
  if (playBtn127) playBtn127.addEventListener("click", () => hfTogglePlay127(false));
  v.addEventListener("click", () => { if (hfPlayed127) hfTogglePlay127(true); });
  v.addEventListener("play", () => { hfPlayed127 = true; const big = $("#hfBigPlay127"); if (big) big.hidden = true; hfHideInstant205(); hfSyncPlayBtn127(); });
  v.addEventListener("pause", hfSyncPlayBtn127);
  v.addEventListener("ended", hfSyncPlayBtn127);
  $("#hfScrub").addEventListener("input", (e) => { hfHideInstant205(); if (v.duration) { v.currentTime = Number(e.target.value); hfUpdateTime(); } });
  $("#hfFreeze").addEventListener("click", freezeHfFrame);
  // Step buttons nudge the playhead ±1s (paused) so the exact moment is
  // easy to land on before freezing.
  const hfSeek = (d) => { if (v.duration) { v.pause(); v.currentTime = Math.min(Math.max(0, (v.currentTime || 0) + d), Math.max(0, v.duration - 0.05)); hfUpdateTime(); } };
  $("#hfStepBack").addEventListener("click", () => hfSeek(-1));
  $("#hfStepFwd").addEventListener("click", () => hfSeek(1));
  ["hfName", "hfJersey", "hfLabel218"].forEach((id) => { const el218 = $("#" + id); if (el218) el218.addEventListener("input", () => { if (hfState.frozen) composeHfPrint(); if (typeof hfGarmentSync206 === "function") hfGarmentSync206(); }); });
  // Round 206: the custom back words feed the garment preview's
  // back treatment live, like the name fields above.
  // Round 218: they are the design's top line now — a frozen
  // print recomposes on the edit too.
  const hfBackCustomInput206 = $("#hfBackCustom197");
  if (hfBackCustomInput206) hfBackCustomInput206.addEventListener("input", () => { if (hfState.frozen) composeHfPrint(); if (typeof hfGarmentSync206 === "function") hfGarmentSync206(); });
  // Color + size pickers (Round 3): color buttons are built from
  // HF_COLORWAYS so the list lives in exactly one place; size buttons
  // are static markup wired here.
  hfBuildColorButtons();
  $$("#hfSizes [data-hf-size]").forEach((b) => b.addEventListener("click", () => hfPickSize(b.dataset.hfSize)));
  $$("#hfSides [data-hf-side]").forEach((b) => b.addEventListener("click", () => hfPickSide(b.dataset.hfSide)));
  $$("#hfImageStyles [data-hf-image-style]").forEach((b) => b.addEventListener("click", () => hfPickImageStyle(b.dataset.hfImageStyle)));
  $$("#hfBackText197 [data-hf-back-text]").forEach((b) => b.addEventListener("click", () => hfPickBackText197(b.dataset.hfBackText)));
  // Round 205: the size guide expander beside the Size heading.
  const sgBtn205 = $("#hfSizeGuideBtn205"), sgPanel205 = $("#hfSizeGuide205");
  if (sgBtn205 && sgPanel205) sgBtn205.addEventListener("click", () => { sgPanel205.hidden = !sgPanel205.hidden; sgBtn205.setAttribute("aria-expanded", String(!sgPanel205.hidden)); });
  hfSyncSummary205(); // Round 205: the order summary starts in sync with the default picks
  // Print placement is FIXED at the default (2026-11-04): no drag, no
  // placement controls and no garment preview; the order carries the
  // default placement, the fixed garment (hoodie), the chosen print
  // side (picker restored Round 35), colorway and size.
  $("#hfOrderForm").addEventListener("submit", (e) => {
    e.preventDefault();
    // Round 211 → 215: the form lives ON the Review screen
    // now, so its submit IS the send — hfSubmitOrder206
    // validates first (a failure keeps the parent on Review
    // with the error in #hfMsg) and posts the exact pre-R206
    // payload: same endpoint, same responses, same Round 200
    // checkout handoff. (Rounds 206–210 routed this through
    // the review stage's separate "Send hoodie request"
    // button.)
    hfSubmitOrder206();
  });
})();

/* Round 206 (2026-11-26, Emil): the hoodie preview round.
   Scope update (Emil, later the same day, from his configurator
   mockup): the garment preview is the studio's HERO — it sits
   at the top of the studio and opens on the BLACK hoodie, BACK
   view, with the Round 205 recommended frame already selected
   and composited; the controls below it run Your moment →
   Artwork → Hoodie color → Size → personalization. The
   front/back flip is a VIEW control only (it can never touch
   hfState.side, the placement, or the order), a generated
   avatar PREVIEWS on the garment behind an explicit approval
   gate before it can become the print, and the order is sent
   from a REVIEW stage (Part F below).
   A. ON-GARMENT PREVIEW (#hfGarment206): the composed print
      composited onto the hoodie itself — clean garment
      illustrations derived from the shop's own quick-view
      artwork (public/swag/hf-garment-*-206.svg, graphics
      stripped), front and back with a flip toggle. The front
      shows the print at its true placement (hfState.placement);
      the back shows the embroidered-words treatment for the
      picked back-text choice (the print joins it there when
      the print side is Back). It rides hfSyncFrozenThumb — the
      compose choke point — plus the color/side/back-text
      pickers, so it tracks every change live. (This is a new
      Emil-directed preview, not the Round 2 mock: fresh names
      throughout, hfGarmentSync206 and friends.)
   B. AVATAR MAKER (#hfAvatarPanel206): with the Avatar style
      picked and the server reporting the maker configured
      (OPENAI_API_KEY; HH_NO_AVATAR stands it down), the frozen
      frame can be turned into an OpenAI illustration in the
      studio. The consent line sits over the button — nothing
      leaves the site until it's tapped. A generated avatar can
      become the print art itself (it replaces the frame in
      #hfCanvas and composes like any frame; the order then
      carries avatarGenerated so the owner knows the print
      image IS the finished avatar), and "Use my photo" always
      restores the frozen frame from its canvas snapshot.
   C. FINE SCRUBBING (#hfFineRow206): ±0.1s steppers around the
      picked frame, riding the Round 127 tap path so the print
      capture uses the nudged time.
   D. WIDE-SHOT FOOTPRINT: composeHfPrint never crops — the
      full frame always prints. For a frame wider than the
      garment's print area, the preview outlines that area
      (dashed) and says what that means, so the band the print
      occupies on the garment is no surprise.
   E. STYLE MINIS: each print-style button renders a miniature
      of the current art composed in that style (the frozen
      frame once one exists, the play's poster before that). */
/* Round 211 (2026-11-26, Emil): the garment is a PHOTOREAL
   blank photo now (the hf-blank-*211.jpg ghost-mannequin
   shots), one per colorway × view. Geometry measured from the
   assets themselves (visual grounding, 2026-11-26):
   - Black (1344×1792, 3:4): the back panel runs between the
     sleeve seams x .195–.805, the hood tip lands y≈.35, the
     ribbed hem tops y≈.81; the chest zone x .268–.748 with
     the kangaroo pocket topping y≈.63.
   - Heather Gray (1280×1920, 2:3): back panel x .175–.825,
     hood tip y≈.41, hem top y≈.835; chest x .250–.765,
     pocket top y≈.632.
   The print zones below are insets of those panels (fractions
   of the PHOTO — the stage wraps the photo, so stage
   fractions ARE photo fractions). `aspect` is each photo's
   w/h, which the print-fit math needs. The crest anchor is
   the wearer's left chest (the viewer's right): the point the
   embroidered crest's glyph centers on; the crest art
   (crest-watermark.png) is the gold crest on a black ground,
   worn with mix-blend-mode:screen so the ground drops out
   over either colorway, and its glyph centers at (.50, .52)
   of the art. */
const HF_GARMENT_ART206 = {
  Black: { front: "/swag/hf-blank-front-black218.jpg", back: "/swag/hf-blank-back-black218.jpg", aspect: 1046 / 1225 },
  "Heather Gray": { front: "/swag/hf-blank-front-gray211.jpg", back: "/swag/hf-blank-back-gray211.jpg", aspect: 1280 / 1920 },
};
const HF_GARMENT_AREA211 = {
  Black: {
    back: { left: 0.27, top: 0.365, width: 0.46, height: 0.42 },
    front: { left: 0.30, top: 0.315, width: 0.40, height: 0.30 },
  },
  "Heather Gray": {
    back: { left: 0.26, top: 0.425, width: 0.48, height: 0.375 },
    front: { left: 0.29, top: 0.315, width: 0.42, height: 0.30 },
  },
};
const HF_GARMENT_CREST211 = {
  Black: { cx: 0.635, cy: 0.335, w: 0.17 },
  "Heather Gray": { cx: 0.65, cy: 0.335, w: 0.17 },
};
/* Round 218 (2026-11-26, Emil): the Black garment is now HIS
   washed-black hoodie — clean blank front/back photos generated
   in the exact style of his front-and-back product shot (warm
   brown backdrop, faded wash), cropped to the garment. Geometry
   measured from the new assets (visual grounding, 2026-11-26):
   back panel seams x .180–.831, hood tip y≈.263, hem top y≈.890;
   front panel x .192–.845, pocket top y≈.622. Zones are insets
   of those panels by the same proportions Round 211 used; the
   crest anchor is the wearer's left chest. Heather Gray keeps
   the Round 211 blanks, zones and anchor (looked up first here,
   falling back to the 211 tables). */
const HF_GARMENT_AREA218 = {
  Black: {
    back: { left: 0.26, top: 0.28, width: 0.49, height: 0.585 },
    front: { left: 0.30, top: 0.315, width: 0.43, height: 0.29 },
  },
};
const HF_GARMENT_CREST218 = {
  Black: { cx: 0.64, cy: 0.33, w: 0.17 },
};
const HF_CREST_ART_ASPECT211 = 1100 / 1122; // crest-watermark.png, h/w

/* Round 211: the play's poster URL (its own, else the board's
   per-sport fallback) — the provisional art the garment wears
   before a frame is captured. */
function hfPosterUrl211(play) {
  if (!play) return "";
  try {
    return play.poster_url || (typeof btlPosterFor118 === "function" ? btlPosterFor118(play.media_url || "", play.sport || "", play.title || "") : "") || "";
  } catch { return ""; }
}

/* Round 215: the poster SEED. The one-page studio opens on the
   finished hoodie, so the play's poster becomes the frozen
   frame at open — loaded at natural size into the capture
   canvas and composed through the same composeHfPrint a
   hand-frozen frame gets, which is what makes the avatar
   maker, the order payload and Review work on it exactly as
   on a manual freeze. The seed URL is deliberately narrower
   than hfPosterUrl211: the play's own poster, or (video) the
   banked board frame — NEVER the branded placeholder poster,
   which is a graphic, not a moment, and must never become a
   submittable print. Photo plays seed from the photo itself
   (the same source hfCapturePrint's image path draws); link
   plays have no still and never seed. Any failure — no URL,
   a load error, an empty compose — leaves the studio exactly
   as it behaved before: unfrozen, the filmstrip path. */
function hfSeedUrl215(play) {
  if (!play) return "";
  if (play.media_type === "image") return play.media_url || "";
  if (play.media_type === "video") {
    if (play.poster_url) return play.poster_url;
    try {
      const banked = (typeof btlPosters104 !== "undefined" && play.media_url) ? btlPosters104[play.media_url] : "";
      return banked || "";
    } catch { return ""; }
  }
  return "";
}
let hfSeedToken215 = 0;
function hfSeedPoster215(play) {
  const url = hfSeedUrl215(play);
  if (!url || hfState.frozen) return;
  const token = ++hfSeedToken215;
  const img = new Image();
  img.onload = () => {
    // A newer play (or a manual freeze) supersedes this seed.
    if (token !== hfSeedToken215 || hfState.play !== play || hfState.frozen) return;
    try {
      const c = $("#hfCanvas"); if (!c) return;
      const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h) return;
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      // The capture path's state, exactly as hfCapturePrint
      // leaves it: frozen, the frame canvas snapshotted, the
      // avatar stood down (it was made from whatever frame was
      // frozen before, never from this one), the print composed.
      hfState.frozen = true;
      // Round 222: the seed is marked as a seed — the ★
      // recommended frame replaces it when the strip is scored
      // (the default print is the recommended frame's finished
      // artwork, never the raw poster). A parent's own freeze
      // clears the mark in hfCapturePrint and is never replaced.
      hfState.seedFrame215 = true;
      try {
        if (!hfState.frameCanvas206) hfState.frameCanvas206 = document.createElement("canvas");
        hfState.frameCanvas206.width = w; hfState.frameCanvas206.height = h;
        hfState.frameCanvas206.getContext("2d").drawImage(c, 0, 0);
      } catch { hfState.frameCanvas206 = null; }
      hfState.avatarDataUrl206 = "";
      hfState.avatarApplied206 = false;
      hfState.avatarPreview206 = false;
      hfState.designAspect218 = 0;
      hfState.avatarFocus221 = null; // Round 221: a seeded frame starts with a centered avatar crop
      hfState.fenceClean222 = ""; // Round 222: a cleaned photo belongs to the frame it cleaned
      if (typeof hfFenceAutoReset229 === "function") hfFenceAutoReset229(); // Round 229: …and so does an auto-clean
      if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
      if (typeof hfSyncFence222 === "function") hfSyncFence222();
      composeHfPrint();
      if (!hfState.printDataUrl) throw new Error("empty print");
      if (typeof hfAutoFence229 === "function") hfAutoFence229(); // Round 229: the seeded frame is auto-checked + cleaned on entry
    } catch {
      // Fall back to the pre-seed behavior: no frozen frame.
      hfState.frozen = false;
      hfState.seedFrame215 = false;
      hfState.printDataUrl = "";
      hfState.printAspect = 0;
      hfState.frameCanvas206 = null;
      hfState.avatarFocus221 = null;
      hfSyncFrozenThumb();
      hfGarmentSync206();
    }
  };
  img.onerror = () => {};
  img.src = url;
}

/* Round 222 (2026-11-26, Emil): Upload a photo — when the clip
   has no strong frame, a photo becomes the print source. The
   uploaded image takes the exact seat a frozen frame takes:
   the capture canvas + the frameCanvas206 snapshot carry it,
   the avatar stands down (it was made from another frame),
   the fence step can clean it, and composeHfPrint builds the
   finished artwork from it. The order payload is unchanged —
   the photo rides as the print image, like any frozen frame. */
function hfUploadPhoto222(file) {
  if (!file) return;
  const note222 = (text) => { const m = $("#hfPhotoMsg215"); if (m) { m.textContent = text; m.hidden = false; } };
  let url = "";
  try { url = URL.createObjectURL(file); } catch { note222("That photo couldn't be read — try another one."); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const w = img.naturalWidth || 0, h = img.naturalHeight || 0;
      if (!w || !h) throw new Error("empty image");
      const c = $("#hfCanvas"); if (!c) throw new Error("no canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, 0, 0, w, h);
      hfState.frozen = true;
      hfState.seedFrame215 = false; // the parent's own pick — the ★ pre-select never overrides it
      try {
        if (!hfState.frameCanvas206) hfState.frameCanvas206 = document.createElement("canvas");
        hfState.frameCanvas206.width = w; hfState.frameCanvas206.height = h;
        hfState.frameCanvas206.getContext("2d").drawImage(c, 0, 0);
      } catch { hfState.frameCanvas206 = null; }
      hfState.avatarDataUrl206 = "";
      hfState.avatarApplied206 = false;
      hfState.avatarPreview206 = false;
      hfState.designAspect218 = 0;
      hfState.avatarFocus221 = null;
      hfState.fenceClean222 = "";
      if (typeof hfFenceAutoReset229 === "function") hfFenceAutoReset229(); // Round 229: an auto-clean belongs to the frame it cleaned
      hfSetSelected205(null); // the pick is a photo, not a video frame — the "Frame selected" label stands down
      if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
      if (typeof hfSyncFence222 === "function") hfSyncFence222();
      composeHfPrint();
      if (typeof hfAutoFence229 === "function") hfAutoFence229(); // Round 229: an uploaded photo is auto-checked + cleaned too
      note222("Your photo is on the hoodie — it's the print now. Pick a frame instead any time.");
    } catch {
      note222("That photo couldn't be read — try another one.");
    } finally { URL.revokeObjectURL(url); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); note222("That photo couldn't be read — try another one."); };
  img.src = url;
}

/* Round 211: one stage painter for every garment stage (the
   studio hero and the Review step's compact stage). refs =
   { img, area, print, shade, crest, backText } — any may be
   null. opts = { view, printSrc, words }: the garment view to
   draw, the art to wear ("" = no print), and the back-text
   treatment ("" = none). The print is FIT inside the zone:
   placement (cx/cy/size) maps into the zone, a name band is
   reserved at the zone's top on the back (the embroidered
   words sit INSIDE the zone above the frame, never across
   the hood), and a print taller than the zone scales down to
   fit — the preview never spills over the hood or the hem.
   The shade layer (the same photo, soft-light) is clipped to
   the print's exact rect, so the fabric's folds shade the
   print and it sits IN the cloth. Preview-only throughout:
   the order's placement values are never touched. */
function hfGarmentPaint211(refs, opts) {
  if (!refs || !refs.img) return { printHere: false };
  const P = (n) => (Math.round(n * 1000) / 1000) + "%"; // percent strings, float dust rounded off
  const art = HF_GARMENT_ART206[hfState.colorway] || HF_GARMENT_ART206.Black;
  const areas = HF_GARMENT_AREA218[hfState.colorway] || HF_GARMENT_AREA211[hfState.colorway] || HF_GARMENT_AREA211.Black;
  const view = opts.view === "front" ? "front" : "back";
  const src = view === "back" ? art.back : art.front;
  if (refs.img.getAttribute("src") !== src) refs.img.src = src;
  if (refs.shade && refs.shade.getAttribute("src") !== src) refs.shade.src = src;
  const area = view === "back" ? areas.back : areas.front;
  const printHere = !!opts.printSrc && ((view === "front") === (hfState.side !== "back"));
  if (refs.area && refs.print) {
    refs.area.hidden = !printHere;
    // Round 218: an approved avatar design is composited with
    // screen blend — its black background knocks out against the
    // garment, so the design's elements sit directly on the
    // garment color (identical on Black; on Heather Gray there
    // is NO black panel). Any other print clears the blend.
    if (refs.print) refs.print.style.mixBlendMode = (printHere && opts.blendScreen) ? "screen" : "";
    if (printHere) {
      refs.area.style.left = P(area.left * 100);
      refs.area.style.top = P(area.top * 100);
      refs.area.style.width = P(area.width * 100);
      refs.area.style.height = P(area.height * 100);
      if (refs.print.getAttribute("src") !== opts.printSrc) refs.print.src = opts.printSrc;
      // Fit math, in stage fractions. The art actually loaded
      // on the img wins (composed print, avatar, or poster);
      // hfState.printAspect covers the not-yet-loaded moment.
      let aspect = hfState.printAspect || 0;
      if (refs.print.naturalWidth) aspect = refs.print.naturalHeight / refs.print.naturalWidth;
      const pl = hfState.placement || HF_PLACEMENT_DEFAULT;
      // Round 218: the embroidered-name band is RETIRED — the
      // name lives inside the artwork now, so no band is
      // reserved at the zone's top; the print fits the full zone.
      const availH = area.height;
      let wFrac = (pl.size / 100) * area.width;
      let hFrac = aspect > 0 ? wFrac * aspect * art.aspect : 0;
      if (hFrac > availH) { wFrac *= availH / hFrac; hFrac = availH; }
      const cxStage = area.left + (pl.cx / 100) * area.width;
      const cyStage = area.top + (pl.cy / 100) * availH;
      refs.print.style.width = P(wFrac / area.width * 100);
      refs.print.style.left = pl.cx + "%";
      refs.print.style.top = P((cyStage - area.top) / area.height * 100);
      if (refs.shade) {
        // Round 218: with the screen-blended design the blend
        // itself seats the art in the cloth — the soft-light
        // shade pass stands down (it would double-process it).
        if (opts.blendScreen) { refs.shade.hidden = true; }
        else {
          refs.shade.hidden = false;
          refs.shade.style.clipPath = `inset(${P((cyStage - hFrac / 2) * 100)} ${P((1 - cxStage - wFrac / 2) * 100)} ${P((1 - cyStage - hFrac / 2) * 100)} ${P((cxStage - wFrac / 2) * 100)})`;
        }
      }
      // Round 215: the Round 206 Part D wide-frame dashed
      // outline is RETIRED — the product-page garment preview
      // never draws a print guide. A wide frame's band across
      // the zone is visible in the preview itself (and in the
      // frozen thumb inside Change photo); no dashed box.
    } else {
      if (refs.shade) refs.shade.hidden = true;
    }
  } else if (refs.shade) {
    refs.shade.hidden = true;
  }
  // The front's embroidered crest: it rides the front view
  // whenever the print itself is on the back — with a front
  // print, the print IS the front design.
  if (refs.crest) {
    const crest = HF_GARMENT_CREST218[hfState.colorway] || HF_GARMENT_CREST211[hfState.colorway] || HF_GARMENT_CREST211.Black;
    const showCrest = view === "front" && hfState.side === "back";
    refs.crest.hidden = !showCrest;
    if (showCrest) {
      const hFrac = crest.w * HF_CREST_ART_ASPECT211 * art.aspect;
      refs.crest.style.width = P(crest.w * 100);
      refs.crest.style.left = P((crest.cx - crest.w * 0.50) * 100);
      refs.crest.style.top = P((crest.cy - hFrac * 0.52) * 100);
    }
  }
  if (refs.backText) {
    // Round 218: the back-words treatment is retired with the
    // embroidered band — the element stays in the markup (older
    // suites pin it) but the painter never shows it: the name
    // is part of the artwork itself now.
    refs.backText.hidden = true;
    refs.backText.textContent = "";
  }
  return { printHere };
}

function hfGarmentBackText206() {
  const name = ($("#hfName") ? $("#hfName").value.trim() : "");
  const jersey = ($("#hfJersey") ? $("#hfJersey").value.trim().replace(/^#/, "") : "");
  if (hfState.backText === "none") return "";
  if (hfState.backText === "custom") return ($("#hfBackCustom197") ? $("#hfBackCustom197").value.trim() : "");
  if (hfState.backText === "name_number") return [name, jersey ? "#" + jersey : ""].filter(Boolean).join("  ");
  return name;
}

function hfGarmentSync206() {
  const wrap = $("#hfGarment206"); if (!wrap) return;
  // Round 211: the garment IS the studio's first screen — it
  // shows whenever a play is open (a frozen print is no longer
  // the gate). Before a frame is captured the print area
  // carries the play's poster as the suggested frame, so the
  // studio opens settled on the hoodie — no video-first flash,
  // no layout jump; the full-res capture replaces the poster
  // behind the same geometry when it lands.
  const show = !!(hfState.play || (hfState.frozen && hfState.printDataUrl));
  wrap.hidden = !show;
  if (!show) return;
  const view = hfState.garmentView206 === "back" ? "back" : "front";
  $$("#hfGarment206 [data-hf-garment-view]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfGarmentView === view)));
  // The garment shows what WILL print: while an avatar
  // preview waits for the family's call it is the preview
  // (approval flips it — hfApplyAvatar206); otherwise the
  // composed print; before capture, the poster.
  const previewSrc206 = (hfState.avatarPreview206 && hfState.avatarDataUrl206 && !hfState.avatarApplied206) ? hfState.avatarDataUrl206 : hfState.printDataUrl;
  const printSrc = (hfState.frozen && previewSrc206) ? previewSrc206 : hfPosterUrl211(hfState.play);
  hfGarmentPaint211({
    img: $("#hfGarmentImg206"), area: $("#hfGarmentPrintArea206"), print: $("#hfGarmentPrint206"),
    shade: $("#hfGarmentShade211"), crest: $("#hfGarmentCrest211"), backText: $("#hfGarmentBackText206"),
    // Round 218: when the garment is wearing the generated
    // design (previewing or approved), it composites with
    // screen blend so the design's black knocks out.
  }, { view, printSrc, words: "", blendScreen: !!(hfState.avatarDataUrl206 && printSrc === hfState.avatarDataUrl206) });
  // Round 215: the wide-frame note that used to follow the
  // paint is gone with the dashed guide (see hfGarmentPaint211).
}

/* Round 215: the one-page studio's two screens. Screen state
   is presentation only — hfState.screen215 tracks where the
   parent is; every value the order reads lives in the same
   hfState fields as always, so moving between the product
   page and Review can never change an order (the payload
   invariant is pinned in test-r215). Entering Review re-syncs
   the as-ordered render; returning to the product page
   re-syncs the garment. (Replaces the Round 211 three-step
   hfGoStep211 — the stepper, its pills and the hero that
   moved between step slots are retired; the garment hero
   lives on the product page.) */
function hfShowScreen215(name, instant) {
  const review = name === "review";
  hfState.screen215 = review ? "review" : "product";
  const prod = $("#hfProduct215"), rev = $("#hfReview215");
  if (prod) prod.hidden = review;
  if (rev) rev.hidden = !review;
  if (review) hfReviewSync206();
  else hfGarmentSync206();
  const studio = $("#hfStudio");
  if (studio && !instant) studio.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* Round 215: the product page's four option rows — quiet and
   collapsed by default (Emil: minimize scrolling). Each row's
   button names the current choice (hfSyncRowStates215) and
   toggles its panel (hfSetRow215); the panels host the same
   controls the steps used to spread across two screens.
   Round 222: the rows are RETIRED — the layout Emil rejected
   hid the working controls behind them. The sections stand
   open in working order (moment → artwork → color & size);
   the row/panel ids survive as the section heads/bodies and
   hfSyncRowStates215 still names each section's current
   choice in its head. hfSetRow215 / hfRowOpen215 remain as
   no-op shims for the older flows that still call them (the
   Change frame action) — there is nothing to open or close. */
const HF_ROWS215 = {
  photo: ["#hfRowPhoto215", "#hfPhotoPanel215"],
  artwork: ["#hfRowArtwork215", "#hfArtworkPanel215"],
  placement: ["#hfRowPlacement215", "#hfPlacementPanel215"],
  backtext: ["#hfRowBackText215", "#hfBackTextPanel215"],
};
function hfSetRow215(row, open) { /* Round 222: no-op — the sections stand open. */ }
function hfRowOpen215(row) { return true; /* Round 222: every section is open. */ }
function hfSyncRowStates215() {
  const photo = $("#hfRowPhotoState215");
  if (photo) photo.textContent = hfState.frameTime205 != null ? `Frame ${hfFmtTime(hfState.frameTime205)}` : (hfState.frozen ? "Frame picked" : "");
  const art = $("#hfRowArtworkState215");
  if (art) art.textContent = `${hfState.imageStyle === "avatar" ? "Avatar" : "Photo"} · ${HF_PRESET_LABELS205[hfState.preset] || "Hype Frame"}`;
  const place = $("#hfRowPlacementState215");
  if (place) place.textContent = hfState.side === "front" ? "Front" : "Back";
  const bt = $("#hfRowBackTextState215");
  if (bt) bt.textContent = { name: "Name", name_number: "Name + number", none: "No name", custom: "Your own words" }[hfState.backText] || "Name";
}

/* Round 211 → 215: the Pick from video row — the play's poster
   thumb on a collapsed bar inside the Change photo panel; the
   player area expands in place under it (hfSetClipOpen211). */
function hfSyncClipRow211() {
  const label = $("#hfClipRowLabel211"), thumb = $("#hfClipRowThumb211");
  const play = hfState.play;
  if (label) label.textContent = hfState.mediaType === "image" ? "Your photo" : hfState.mediaType === "link" ? "Posted as a link" : "Pick from video";
  if (thumb) {
    const url = hfState.mediaType === "image" && play ? (play.media_url || "") : hfPosterUrl211(play);
    thumb.hidden = !url;
    if (url && thumb.getAttribute("src") !== url) thumb.src = url;
  }
}
function hfSetClipOpen211(open) {
  hfState.clipOpen211 = !!open;
  const area = $("#hfClipArea211"), row = $("#hfClipRow211");
  if (area) area.hidden = !open;
  if (row) row.setAttribute("aria-expanded", String(!!open));
}

/* Part C: fine scrubbing — nudge the picked frame by a tenth
   of a second through the same seek-and-capture path a strip
   tap uses, so the composed print follows the nudged time. */
function hfFineStep206(d) {
  const v = $("#hfVideo"); if (!v || hfState.mediaType !== "video") return;
  const base = (typeof hfState.frameTime205 === "number") ? hfState.frameTime205 : (v.currentTime || 0);
  const dur = v.duration || 0;
  let target = base + d;
  target = dur ? Math.min(Math.max(0, target), Math.max(0, dur - 0.05)) : Math.max(0, target);
  target = Math.round(target * 10) / 10;
  hfJumpToFrame(target, null);
}
/* Round 229: Part E (the print-style minis — hfMiniPoster206 /
   hfRenderPresetMinis206 and their poster loader) is RETIRED
   with the Print style picker: no preset buttons, no minis. */

/* Part B: the avatar maker. The configured check runs once per
   page (the status endpoint is the server's word on
   OPENAI_API_KEY + the HH_NO_AVATAR kill switch); until it
   answers — and whenever it answers no — the studio is exactly
   the Round 38 flow. */
let hfAvatarStatusPromise206 = null;
function hfAvatarStatus206() {
  if (hfState.avatarConfigured206 !== null) { hfSyncAvatar206(); return Promise.resolve(hfState.avatarConfigured206); }
  if (!hfAvatarStatusPromise206) {
    hfAvatarStatusPromise206 = fetch("/api/hype-frame/avatar-status")
      .then((r) => r.json())
      .then((j) => { hfState.avatarConfigured206 = !!(j && j.configured); hfSyncAvatar206(); return hfState.avatarConfigured206; })
      .catch(() => { hfState.avatarConfigured206 = false; hfSyncAvatar206(); return false; });
  }
  return hfAvatarStatusPromise206;
}
function hfAvatarNote206(text) {
  const el = $("#hfAvatarStatus206"); if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}
function hfSyncAvatar206() {
  const panel = $("#hfAvatarPanel206"); if (!panel) return;
  if (hfState.avatarConfigured206 === null) hfAvatarStatus206();
  const show = hfState.avatarConfigured206 === true && hfState.imageStyle === "avatar";
  panel.hidden = !show;
  if (!show) return;
  const make = $("#hfAvatarMake206");
  if (make) {
    make.disabled = !hfState.frozen || hfState.avatarBusy206;
    make.textContent = hfState.avatarBusy206 ? "Creating your avatar…" : (hfState.avatarDataUrl206 ? "✨ Make it again" : "✨ Make my avatar");
  }
  const result = $("#hfAvatarResult206");
  if (result) {
    const has = !!hfState.avatarDataUrl206;
    result.hidden = !has;
    if (has) { const im = $("#hfAvatarImg206"); if (im && im.getAttribute("src") !== hfState.avatarDataUrl206) im.src = hfState.avatarDataUrl206; }
  }
  const useBtn = $("#hfAvatarUse206"), photoBtn = $("#hfAvatarPhoto206");
  if (useBtn) useBtn.setAttribute("aria-pressed", String(hfState.avatarApplied206 === true));
  if (photoBtn) photoBtn.setAttribute("aria-pressed", String(hfState.avatarApplied206 !== true));
  hfSyncAvatarCrop221();
}
/* Round 221 (Emil, from the first live R218 test): the maker
   was fed the WHOLE frame and invented a generic scene around
   the small athlete in it. The panel now shows a zoomed crop of
   the frame — exactly what the model will see — and the parent
   taps the photo to center the crop on their athlete. The crop
   is a send-time choice only: the photo path still composes the
   full frame, no order field changes, and the generated design
   keeps the R218 flow (its own aspect is recorded at approval,
   designAspect218 — the crop never reaches it). Focus is stored
   as fractions of the frame (avatarFocus221, null = center) and
   resets whenever a new frame is frozen or seeded.
   Round 222: the default crop tightens to ATHLETE-DOMINANT —
   55% of the frame's width (still 4:5) — in the framing spirit
   of Emil's reference designs, where the athlete fills most of
   the frame; at the R221 width the athlete still arrived small
   and the gear (bat, helmet, feet) came back garbled. The Make
   flow also sends the crop UPSCALED 2× now (hfMakeAvatar206),
   so those details arrive with real pixels. Tap-to-center is
   unchanged. */
function hfAvatarCrop221(srcW, srcH, focus) {
  const fx = focus && isFinite(focus.x) ? Math.min(1, Math.max(0, focus.x)) : 0.5;
  const fy = focus && isFinite(focus.y) ? Math.min(1, Math.max(0, focus.y)) : 0.5;
  let cw = Math.max(1, Math.round(srcW * 0.55));
  let ch = Math.round(cw * 1.25);
  if (ch > srcH) { ch = srcH; cw = Math.max(1, Math.round(ch / 1.25)); }
  if (cw > srcW) { cw = srcW; ch = Math.round(cw * 1.25); }
  const x = Math.round(Math.min(Math.max(fx * srcW - cw / 2, 0), Math.max(0, srcW - cw)));
  const y = Math.round(Math.min(Math.max(fy * srcH - ch / 2, 0), Math.max(0, srcH - ch)));
  return { x, y, w: cw, h: ch };
}
function hfAvatarCropSrc221() {
  const src = hfState.frameCanvas206;
  if (!src || !src.width || !src.height) return "";
  const scale = Math.min(1, 512 / Math.max(src.width, src.height));
  const tc = document.createElement("canvas");
  tc.width = Math.max(1, Math.round(src.width * scale));
  tc.height = Math.max(1, Math.round(src.height * scale));
  tc.getContext("2d").drawImage(src, 0, 0, tc.width, tc.height);
  return tc.toDataURL("image/jpeg", 0.85);
}
function hfSyncAvatarCrop221() {
  const wrap = $("#hfAvatarCrop221"); if (!wrap) return;
  const src = hfState.frameCanvas206;
  if (!src || !src.width || !src.height) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const img = $("#hfAvatarCropImg221");
  if (img) { const u = hfAvatarCropSrc221(); if (u && img.getAttribute("src") !== u) img.src = u; }
  const crop = hfAvatarCrop221(src.width, src.height, hfState.avatarFocus221);
  const box = $("#hfAvatarCropBox221");
  if (box) {
    box.style.left = (crop.x / src.width * 100) + "%";
    box.style.top = (crop.y / src.height * 100) + "%";
    box.style.width = (crop.w / src.width * 100) + "%";
    box.style.height = (crop.h / src.height * 100) + "%";
  }
  const dot = $("#hfAvatarCropDot221");
  if (dot) {
    const f = hfState.avatarFocus221;
    const fx = f && isFinite(f.x) ? Math.min(1, Math.max(0, f.x)) : 0.5;
    const fy = f && isFinite(f.y) ? Math.min(1, Math.max(0, f.y)) : 0.5;
    dot.style.left = (fx * 100) + "%";
    dot.style.top = (fy * 100) + "%";
  }
}
function hfAvatarCropTap221(ev) {
  const stage = $("#hfAvatarCropStage221");
  if (!stage || !hfState.frameCanvas206) return;
  const r = stage.getBoundingClientRect();
  if (!r || !r.width || !r.height) return;
  const cx = ev && isFinite(ev.clientX) ? ev.clientX : r.left + r.width / 2;
  const cy = ev && isFinite(ev.clientY) ? ev.clientY : r.top + r.height / 2;
  hfState.avatarFocus221 = {
    x: Math.min(1, Math.max(0, (cx - r.left) / r.width)),
    y: Math.min(1, Math.max(0, (cy - r.top) / r.height)),
  };
  hfSyncAvatarCrop221();
}
async function hfMakeAvatar206() {
  if (hfState.avatarBusy206) return;
  if (!hfState.frozen || !hfState.frameCanvas206) { hfAvatarNote206("Freeze a frame first — the avatar is made from your frozen still."); return; }
  // Round 218: the design's text slots ride along with the
  // frame — the name modes that need words check them before
  // anything is sent, so a design never comes back missing the
  // line the family picked.
  const mode218 = hfState.backText;
  const first218 = hfDesignFirstName218();
  const jersey218 = ($("#hfJersey") ? $("#hfJersey").value.replace(/\D/g, "").slice(0, 3) : "");
  const custom218 = ($("#hfBackCustom197") ? $("#hfBackCustom197").value.trim() : "");
  if ((mode218 === "name" || mode218 === "name_number") && !first218) { hfAvatarNote206("Add the athlete's name under “Name on design” first — it prints at the top of the design."); return; }
  if (mode218 === "name_number" && !jersey218) { hfAvatarNote206("Add the jersey number under “Name on design” — you picked name + number."); return; }
  if (mode218 === "custom" && !custom218) { hfAvatarNote206("Write your words under “Name on design” first — they print at the top of the design."); return; }
  hfState.avatarBusy206 = true;
  hfSyncAvatar206();
  hfAvatarNote206("Creating your avatar… this can take up to a minute. Your photo stays put until it's ready.");
  try {
    // Round 221: the frame the maker sees is the panel's zoomed
    // CROP of the frozen still (hfAvatarCrop221, centered on
    // the parent's tap). A tight crop hands the model the
    // actual athlete to illustrate instead of a wide scene to
    // invent around. The crop plus the design slots above are
    // posted; the recipe that assembles them lives server-side
    // and can't be reached from here.
    // Round 222: the crop is athlete-dominant (55% of the
    // frame's width at 4:5) and sent UPSCALED 2× as a JPEG —
    // long side capped at 2048 — so the gear and anatomy the
    // first live tests garbled (the bat's color, the helmet
    // worn straight, the feet) arrive with real pixels.
    const src = hfState.frameCanvas206;
    const crop221 = hfAvatarCrop221(src.width, src.height, hfState.avatarFocus221);
    const scale = Math.min(2, 2048 / Math.max(crop221.w, crop221.h));
    const tc = document.createElement("canvas");
    tc.width = Math.max(1, Math.round(crop221.w * scale));
    tc.height = Math.max(1, Math.round(crop221.h * scale));
    tc.getContext("2d").drawImage(src, crop221.x, crop221.y, crop221.w, crop221.h, 0, 0, tc.width, tc.height);
    const image = tc.toDataURL("image/jpeg", 0.87);
    const design218 = { nameMode: mode218, name: first218, number: jersey218, customText: custom218, label: hfDesignLabel218(), tone: hfTone218() };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 120000);
    let j = null;
    try {
      const r = await fetch("/api/hype-frame/avatar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image, nameMode: design218.nameMode, name: design218.name, number: design218.number, customText: design218.customText, label: design218.label, tone: design218.tone }), signal: ctl.signal });
      j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok || !j.image) throw new Error((j && j.message) || "The avatar maker couldn't finish that one.");
    } finally { clearTimeout(timer); }
    hfState.avatarDataUrl206 = j.image;
    // Approval gate (Round 206 scope update, Emil): the avatar
    // PREVIEWS on the garment — the order's print art is still
    // the photo. It becomes the print only when the parent taps
    // "Use this avatar" (hfApplyAvatar206); ignoring it, or
    // tapping "Use my photo", keeps the photo.
    hfState.avatarPreview206 = true;
    hfGarmentSync206();
    hfAvatarNote206("Your avatar is ready — it's previewing on the hoodie above. Tap “Use this avatar” to make it your print — until then, your print is still the photo.");
  } catch (e) {
    hfAvatarNote206(((e && e.message) || "The avatar maker couldn't finish that one.") + " Your photo print still works — try again any time.");
  } finally {
    hfState.avatarBusy206 = false;
    hfSyncAvatar206();
  }
}
/* Choosing the avatar. Round 218: the approved design becomes
   the print WHOLESALE — it is a complete artwork (name, label,
   crown, framed illustration, branding), so it is NOT drawn
   into the frame canvas and no wrapper is composed around it:
   composeHfPrint passes it through as the print image itself,
   and the garment preview composites it with screen blend so
   its black ground knocks out. Only the design's aspect is
   recorded here, for the garment fit math before it loads. The
   frozen frame's canvas snapshot is untouched, so "Use my
   photo" restores the photo path exactly. */
function hfApplyAvatar206() {
  if (!hfState.avatarDataUrl206) return;
  const im = new Image();
  im.onload = () => {
    hfState.designAspect218 = (im.naturalWidth || 0) > 0 ? (im.naturalHeight / im.naturalWidth) : 0;
    hfState.avatarApplied206 = true;
    hfState.avatarPreview206 = false; // approved: it IS the print now, no longer a preview
    if (hfState.imageStyle !== "avatar") hfPickImageStyle("avatar");
    composeHfPrint();
    hfSyncAvatar206();
  };
  im.onerror = () => hfAvatarNote206("That avatar image didn't load — your photo print still works.");
  im.src = hfState.avatarDataUrl206;
}
/* Reverting: the frozen frame's canvas snapshot goes back —
   no re-seek, no re-capture, the exact still they froze. */
function hfUsePhoto206() {
  // Declining the avatar: the preview stands down first; if the
  // avatar had been approved into the print, the frozen frame's
  // canvas snapshot goes back — no re-seek, no re-capture, the
  // exact still they froze.
  hfState.avatarPreview206 = false;
  const snap = hfState.frameCanvas206, c = $("#hfCanvas");
  if (!hfState.avatarApplied206) { hfGarmentSync206(); hfSyncAvatar206(); return; }
  if (!snap || !c) return;
  c.width = snap.width; c.height = snap.height;
  c.getContext("2d").drawImage(snap, 0, 0);
  hfState.avatarApplied206 = false;
  composeHfPrint();
  hfSyncAvatar206();
}
/* Round 222 (2026-11-26, Emil): fence removal — the photo
   path's optional clean-up step. The configured check mirrors
   the avatar's (its own status endpoint: OPENAI_API_KEY + the
   HH_NO_FENCE kill switch); until it answers yes — and
   whenever it answers no — the step simply doesn't show, and
   the photo path behaves exactly as before. The flow copies
   the avatar's shape on purpose: an explicit send (the current
   print-source photo, downscaled to <=1024px JPEG), then a
   result the parent APPROVES ("Use the cleaned photo") or
   declines ("Keep the original") — never automatic, never
   silent. (→229: Emil reversed the never-automatic rule — the
   studio now auto-cleans on entry/pick with a revert, below;
   this manual flow remains as the fallback and for sessions
   where detection/auto is off.) Approval swaps the cleaned photo into the capture
   canvas + the frame snapshot, so it becomes the print source
   and the avatar maker's starting frame in one move. */
let hfFenceStatusPromise222 = null;
function hfFenceStatus222() {
  if (hfState.fenceConfigured222 !== null) { hfSyncFence222(); return Promise.resolve(hfState.fenceConfigured222); }
  if (!hfFenceStatusPromise222) {
    hfFenceStatusPromise222 = fetch("/api/hype-frame/fence-status")
      .then((r) => r.json())
      .then((j) => {
        hfState.fenceConfigured222 = !!(j && j.configured);
        // Round 229: the same status carries detection + auto.
        hfState.fenceDetect229 = !!(j && j.detect);
        hfState.fenceAuto229 = !!(j && j.auto);
        hfSyncFence222();
        // A frame frozen before the status landed gets its
        // auto check now (the common seed path races the fetch).
        if (typeof hfAutoFence229 === "function") hfAutoFence229();
        return hfState.fenceConfigured222;
      })
      .catch(() => { hfState.fenceConfigured222 = false; hfState.fenceDetect229 = false; hfState.fenceAuto229 = false; hfSyncFence222(); return false; });
  }
  return hfFenceStatusPromise222;
}
function hfFenceNote222(text) {
  const el = $("#hfFenceStatus222"); if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}
/* Round 229: is the studio in AUTO mode for this session? Auto
   needs the server's word on both detection and auto (fence-
   status), and stands down the moment an auto attempt fails
   (the manual step takes over as the fallback). */
function hfFenceAutoMode229() {
  return hfState.fenceAuto229 === true && !hfState.fenceAutoFailed229;
}
function hfSyncFence222() {
  const block = $("#hfFence222"); if (!block) return;
  if (hfState.fenceConfigured222 === null && hfState.frozen) hfFenceStatus222();
  // Round 229: in auto mode the manual panel stands down (the
  // auto note under the garment carries the state + revert);
  // it returns only as the fallback when an auto attempt failed.
  const auto229 = hfState.fenceAuto229 === true;
  const show = hfState.fenceConfigured222 === true && hfState.frozen && !!hfState.frameCanvas206 && (!auto229 || hfState.fenceAutoFailed229);
  block.hidden = !show;
  if (typeof hfSyncFenceAuto229 === "function") hfSyncFenceAuto229();
  if (!show) return;
  const btn = $("#hfFenceBtn222");
  if (btn) { btn.disabled = !!hfState.fenceBusy222; btn.textContent = hfState.fenceBusy222 ? "Removing the fence…" : "Remove the fence"; }
  const result = $("#hfFenceResult222");
  if (result) {
    const has = !!hfState.fenceClean222;
    result.hidden = !has;
    if (has) { const im = $("#hfFenceImg222"); if (im && im.getAttribute("src") !== hfState.fenceClean222) im.src = hfState.fenceClean222; }
  }
}
/* The downscale both fence sends share (manual Round 222 +
   auto Round 229): the print-source snapshot at <=1024px JPEG. */
function hfFenceSendImage229(src) {
  const scale = Math.min(1, 1024 / Math.max(src.width, src.height));
  const tc = document.createElement("canvas");
  tc.width = Math.max(1, Math.round(src.width * scale));
  tc.height = Math.max(1, Math.round(src.height * scale));
  tc.getContext("2d").drawImage(src, 0, 0, tc.width, tc.height);
  return tc.toDataURL("image/jpeg", 0.87);
}
async function hfFencePost229(path, image, timeoutMs) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 120000);
  try {
    const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image }), signal: ctl.signal });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) throw new Error((j && j.message) || "That step couldn't finish.");
    return j;
  } finally { clearTimeout(timer); }
}
async function hfMakeFence222() {
  if (hfState.fenceBusy222) return;
  const src = hfState.frameCanvas206;
  if (!hfState.frozen || !src || !src.width) { hfFenceNote222("Pick a frame or a photo first — fence removal works on your print photo."); return; }
  hfState.fenceBusy222 = true;
  hfSyncFence222();
  hfFenceNote222("Removing the fence… this can take up to a minute. Your original photo stays put until you approve the cleaned one.");
  try {
    const j = await hfFencePost229("/api/hype-frame/remove-fence", hfFenceSendImage229(src));
    hfState.fenceClean222 = j.image;
    hfFenceNote222("Here's your photo with the fence removed — check it over. It becomes your print only if you tap “Use the cleaned photo”.");
  } catch (e) {
    hfFenceNote222(((e && e.message) || "Fence removal couldn't finish that one.") + " Your photo still works as it is.");
  } finally {
    hfState.fenceBusy222 = false;
    hfSyncFence222();
  }
}
/* The swap both approvals share (manual Round 222 "Use the
   cleaned photo" + the Round 229 auto-apply): the cleaned photo
   takes the print source's seat — the capture canvas + the
   frame snapshot are swapped, the avatar stands down (it was
   made from the fenced photo), and the print recomposes from
   the cleaned photo. Returns via the Image onload, like the
   Round 222 flow always did. */
function hfApplyCleanedFrame229(url, onDone) {
  const im = new Image();
  im.onload = () => {
    const c = $("#hfCanvas"); if (!c) { if (onDone) onDone(false); return; }
    const w = im.naturalWidth || 0, h = im.naturalHeight || 0;
    if (!w || !h) { if (onDone) onDone(false); return; }
    c.width = w; c.height = h;
    c.getContext("2d").drawImage(im, 0, 0, w, h);
    try {
      if (!hfState.frameCanvas206) hfState.frameCanvas206 = document.createElement("canvas");
      hfState.frameCanvas206.width = w; hfState.frameCanvas206.height = h;
      hfState.frameCanvas206.getContext("2d").drawImage(c, 0, 0);
    } catch { hfState.frameCanvas206 = null; }
    hfState.frozen = true;
    hfState.seedFrame215 = false;
    hfState.avatarDataUrl206 = "";
    hfState.avatarApplied206 = false;
    hfState.avatarPreview206 = false;
    hfState.designAspect218 = 0;
    hfState.avatarFocus221 = null;
    hfState.fenceClean222 = "";
    if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
    composeHfPrint();
    hfSyncFence222();
    if (onDone) onDone(true);
  };
  im.onerror = () => { if (onDone) onDone(false); };
  im.src = url;
}
/* Approval: the cleaned photo takes the print source's seat —
   the capture canvas + the frame snapshot are swapped, the
   avatar stands down (it was made from the fenced photo), and
   the print recomposes from the cleaned photo. Declining just
   drops the cleaned copy; the original never moved. */
function hfUseFence222() {
  const url = hfState.fenceClean222;
  if (!url) return;
  hfApplyCleanedFrame229(url, (ok) => {
    if (!ok) { hfFenceNote222("That cleaned photo didn't load — your original is still your print."); return; }
    hfFenceNote222("The cleaned photo is your print now — and the avatar maker starts from it too.");
    const m = $("#hfPhotoMsg215");
    if (m) { m.textContent = "Cleaned photo on the hoodie — fence removed."; m.hidden = false; }
  });
}
function hfKeepFence222() {
  hfState.fenceClean222 = "";
  hfSyncFence222();
  hfFenceNote222("Kept your original photo — it's still your print.");
}

/* ================= Round 229 (2026-11-27, Emil): studio auto
   fence-clean =================
   "As soon as someone goes into a hype frame studio, we should
   automatically remove the fence." Entering the studio — and
   every frame pick / freeze / photo upload after it — checks
   the print-source frame and cleans it automatically:
   DETECTION FIRST (POST /api/hype-frame/fence-detect, the
   Round 227 vision question), and only on a fence does the
   ordinary Round 222 edit run; the CLEANED frame then becomes
   the print source by default, with an inline note + a one-tap
   "Use original" revert riding under the garment preview (the
   OpenAI disclosure lives in the same block, on screen before
   any frame is sent). The avatar maker starts from the print
   source, so it inherits the cleaned frame.
   CACHE: a frame's verdict is keyed by a content hash of a
   small thumbnail of the frame snapshot — the same frame never
   triggers a second detect/edit call in the session, and a
   frame the parent reverted stays reverted (choice:"original")
   until they tap "Use cleaned photo".
   DEGRADE (mirrors the server's fence-status word):
   - detection not configured (no vision key) → fenceAuto229
     false → today's behavior exactly: the manual step shows
     when the edit is configured, no auto UI at all;
   - HH_NO_FENCE_AUTO=1 → auto false, detect true → same
     manual behavior (the server's detect endpoint also stands
     down, answering fence:false without an upstream call);
   - edit unconfigured (no OpenAI key) → configured false →
     manual step hidden as today, no auto-clean;
   - an auto attempt FAILS → fenceAutoFailed229 surfaces the
     manual step as the fallback for the rest of the session. */
/* A NEW frame (capture / seed / upload) retires the previous
   frame's auto-clean tracking — the applied key, the cleaned
   URL and the revert snapshot all belong to the frame they
   cleaned. The verdict CACHE survives (it is keyed by frame
   content), and any in-flight auto run is invalidated. Called
   at the same points the Round 222 flow clears fenceClean222. */
function hfFenceAutoReset229() {
  hfState.fenceAutoKey229 = "";
  hfState.fenceAutoClean229 = "";
  hfState.fenceAutoOriginal229 = null;
  hfState.fenceAutoToken229 = (hfState.fenceAutoToken229 || 0) + 1;
  if (typeof hfSyncFenceAuto229 === "function") hfSyncFenceAuto229();
}
function hfFenceFrameKey229(src) {
  try {
    const tw = 96, th = Math.max(1, Math.round(tw * src.height / Math.max(1, src.width)));
    const tc = document.createElement("canvas");
    tc.width = tw; tc.height = th;
    tc.getContext("2d").drawImage(src, 0, 0, tw, th);
    const d = tc.toDataURL("image/jpeg", 0.6);
    let h1 = 5381, h2 = 52711;
    for (let i = 0; i < d.length; i++) { const ch = d.charCodeAt(i); h1 = ((h1 * 33) ^ ch) >>> 0; h2 = ((h2 * 31) + ch) >>> 0; }
    return src.width + "x" + src.height + ":" + h1.toString(36) + "." + h2.toString(36) + "." + d.length;
  } catch { return ""; }
}
function hfFenceAutoNote229(text) {
  const el = $("#hfFenceAutoNote229"); if (!el) return;
  el.textContent = text || "";
  el.hidden = !text;
}
function hfSyncFenceAuto229() {
  const box = $("#hfFenceAuto229"); if (!box) return;
  const auto = hfState.fenceAuto229 === true;
  box.hidden = !auto;
  if (!auto) return;
  const actions = $("#hfFenceAutoActions229");
  const origBtn = $("#hfFenceAutoOriginal229"), cleanBtn = $("#hfFenceAutoCleaned229");
  const key = hfState.fenceAutoKey229;
  const entry = key ? hfState.fenceAutoCache229[key] : null;
  const applied = !!(entry && entry.status === "cleaned" && entry.choice !== "original" && hfState.fenceAutoClean229);
  const reverted = !!(entry && entry.status === "cleaned" && entry.choice === "original");
  if (actions) actions.hidden = !(applied || reverted);
  if (origBtn) origBtn.hidden = !applied;
  if (cleanBtn) cleanBtn.hidden = !reverted;
  if (!hfState.fenceAutoBusy229) {
    if (applied) hfFenceAutoNote229("Fence removed from your photo automatically — the cleaned photo is your print. Not happy with it? Use your original instead.");
    else if (reverted) hfFenceAutoNote229("Using your original photo, fence and all. The cleaned version is still here if you want it.");
    else hfFenceAutoNote229("");
  }
}
function hfAutoFence229() {
  if (hfState.fenceAuto229 === null) { hfFenceStatus222(); return; } // the status landing re-enters via hfFenceStatus222
  if (!hfFenceAutoMode229()) { hfSyncFence222(); return; }
  const src = hfState.frameCanvas206;
  if (!hfState.frozen || !src || !src.width || hfState.avatarApplied206) return;
  if (hfState.fenceAutoBusy229) return;
  const key = hfFenceFrameKey229(src);
  if (!key) return;
  const entry = hfState.fenceAutoCache229[key];
  if (entry) {
    // Cached verdict: never a second call. A cleaned frame the
    // parent hasn't decided on (e.g. re-frozen after browsing
    // away) re-applies for free; a reverted one stays reverted.
    if (entry.status === "cleaned" && entry.choice !== "original" && hfState.fenceAutoKey229 !== key) {
      hfState.fenceAutoKey229 = key;
      hfState.fenceAutoClean229 = entry.clean;
      hfState.fenceAutoOriginal229 = document.createElement("canvas");
      hfState.fenceAutoOriginal229.width = src.width; hfState.fenceAutoOriginal229.height = src.height;
      hfState.fenceAutoOriginal229.getContext("2d").drawImage(src, 0, 0);
      hfApplyCleanedFrame229(entry.clean, () => hfSyncFenceAuto229());
    } else if (entry.status === "cleaned") {
      hfState.fenceAutoKey229 = key;
      hfSyncFenceAuto229();
    }
    return;
  }
  hfState.fenceAutoBusy229 = true;
  hfState.fenceAutoKey229 = key;
  const token229 = (hfState.fenceAutoToken229 = (hfState.fenceAutoToken229 || 0) + 1);
  hfSyncFenceAuto229();
  hfFenceAutoNote229("Checking your frame for a fence…");
  (async () => {
    try {
      const image = hfFenceSendImage229(src);
      const det = await hfFencePost229("/api/hype-frame/fence-detect", image, 60000);
      if (token229 !== hfState.fenceAutoToken229) return; // a newer frame (or play) superseded this check
      if (det.auto === false) { // the server stood auto down mid-session (kill switch) — manual behavior returns
        hfState.fenceAuto229 = false;
        hfState.fenceAutoCache229[key] = { status: "none" };
        hfFenceAutoNote229("");
        return;
      }
      if (!det.fence) {
        hfState.fenceAutoCache229[key] = { status: "none" };
        hfFenceAutoNote229(""); // no fence → no UI noise
        return;
      }
      const cleaned = await hfFencePost229("/api/hype-frame/remove-fence", image);
      if (token229 !== hfState.fenceAutoToken229) return; // superseded while the edit ran — never apply a stale frame
      hfState.fenceAutoCache229[key] = { status: "cleaned", clean: cleaned.image, choice: "auto" };
      hfState.fenceAutoClean229 = cleaned.image;
      // The as-shot frame, kept for the one-tap revert.
      hfState.fenceAutoOriginal229 = document.createElement("canvas");
      hfState.fenceAutoOriginal229.width = src.width; hfState.fenceAutoOriginal229.height = src.height;
      hfState.fenceAutoOriginal229.getContext("2d").drawImage(src, 0, 0);
      hfApplyCleanedFrame229(cleaned.image, (ok) => {
        if (!ok) { hfState.fenceAutoFailed229 = true; hfFenceAutoNote229("The cleaned photo didn't load — your original is still your print, and the manual fence step is below if you want it."); }
        hfSyncFenceAuto229();
      });
    } catch (e) {
      // A failed auto attempt never blocks the parent: the
      // original stands, the verdict is cached (no retry loop
      // on this frame), and the manual step surfaces.
      hfState.fenceAutoCache229[key] = { status: "failed" };
      hfState.fenceAutoFailed229 = true;
      hfFenceAutoNote229("The automatic fence check didn't finish — your photo works as it is, and the manual fence step is below if you want it.");
    } finally {
      if (token229 === hfState.fenceAutoToken229) { hfState.fenceAutoBusy229 = false; hfSyncFence222(); }
    }
  })();
}
/* "Use original": the as-shot frame retakes the print source's
   seat (the exact inverse of hfApplyCleanedFrame229), and the
   frame's cache entry remembers the choice — re-picking the
   same frame never re-cleans it against the parent's call. */
function hfFenceAutoRevert229() {
  const orig = hfState.fenceAutoOriginal229;
  const key = hfState.fenceAutoKey229;
  if (!orig || !orig.width) return;
  const c = $("#hfCanvas"); if (!c) return;
  c.width = orig.width; c.height = orig.height;
  c.getContext("2d").drawImage(orig, 0, 0);
  try {
    if (!hfState.frameCanvas206) hfState.frameCanvas206 = document.createElement("canvas");
    hfState.frameCanvas206.width = orig.width; hfState.frameCanvas206.height = orig.height;
    hfState.frameCanvas206.getContext("2d").drawImage(orig, 0, 0);
  } catch { hfState.frameCanvas206 = null; }
  hfState.frozen = true;
  hfState.seedFrame215 = false;
  hfState.avatarDataUrl206 = "";
  hfState.avatarApplied206 = false;
  hfState.avatarPreview206 = false;
  hfState.designAspect218 = 0;
  hfState.avatarFocus221 = null;
  hfState.fenceClean222 = "";
  if (key && hfState.fenceAutoCache229[key]) hfState.fenceAutoCache229[key].choice = "original";
  hfState.fenceAutoClean229 = "";
  if (typeof hfSyncAvatar206 === "function") hfSyncAvatar206();
  composeHfPrint();
  hfSyncFence222();
  const m = $("#hfPhotoMsg215");
  if (m) { m.textContent = "Original photo on the hoodie — fence and all."; m.hidden = false; }
}
/* "Use cleaned photo" (after a revert): the cached cleaned
   frame retakes the seat — no new detect/edit call. */
function hfFenceAutoUseCleaned229() {
  const key = hfState.fenceAutoKey229;
  const entry = key ? hfState.fenceAutoCache229[key] : null;
  if (!entry || entry.status !== "cleaned" || !entry.clean) return;
  entry.choice = "auto";
  hfState.fenceAutoClean229 = entry.clean;
  hfApplyCleanedFrame229(entry.clean, (ok) => {
    if (ok) {
      const m = $("#hfPhotoMsg215");
      if (m) { m.textContent = "Cleaned photo on the hoodie — fence removed."; m.hidden = false; }
    }
    hfSyncFenceAuto229();
  });
}

/* Part F (Round 206 scope update, Emil): the review stage.
   The form's CTA is "Review hoodie request"; the review shows
   the hoodie AS ORDERED (the garment view the print sits on —
   the preview flip's current view is irrelevant here), the
   size, the print placement and the artwork, and the request
   is sent from the review by hfSubmitOrder206 — the exact
   pre-R206 send path (same payload built from the same live
   state, same responses), so the review is a confirmation
   view over the order, never a second order path. */
function hfValidateOrder206() {
  if (!hfState.play) return "Pick a play on the board first — Hype Frame starts from an approved play.";
  if (!hfState.frozen || !hfState.printDataUrl) return "Freeze a frame first — the print starts from your frozen still.";
  // Round 222: no preselected size — an order can never ride
  // on a size nobody picked (the Review gate holds first;
  // this is the same rule at the send itself).
  if (!hfState.size) return "Pick a size first — tap a size in the Color & size section.";
  if (!$("#hfGuardianEmail").value.trim()) return "A parent/guardian email is required so we can confirm before printing.";
  // Round 197: the back-text choice is validated before the
  // request leaves — the server enforces the same rules.
  if (hfState.backText === "custom") {
    const err197 = hfCustomTextError197($("#hfBackCustom197").value);
    if (err197) return err197;
  }
  if (hfState.backText === "name_number" && !$("#hfJersey").value.replace(/\D/g, "")) {
    return "Add the jersey number — you picked name + number for the back.";
  }
  return "";
}
function hfReviewSync206() {
  const view = hfState.side === "back" ? "back" : "front"; // the garment as ordered
  // Round 211: the Review stage paints through the same
  // painter as the hero (photoreal blank, fit math, shade
  // layer, front crest) — the garment as ordered, compact.
  hfGarmentPaint211({
    img: $("#hfReviewImg206"), area: $("#hfReviewPrintArea206"), print: $("#hfReviewPrint206"),
    shade: $("#hfReviewShade211"), crest: $("#hfReviewCrest211"), backText: null,
    // Round 218: an approved design shows composited on the
    // ordered garment with screen blend — never as a standalone
    // black rectangle.
  }, { view, printSrc: hfState.printDataUrl, words: "", blendScreen: hfState.avatarApplied206 === true });
  // Round 211: the summary headline in the mockup's form,
  // derived from live state — "Black hoodie" over
  // "Back print · Hype Frame".
  const titleEl211 = $("#hfReviewTitle211");
  if (titleEl211) titleEl211.textContent = `${hfState.colorway} hoodie`;
  const lineEl211 = $("#hfReviewLine211");
  if (lineEl211) lineEl211.textContent = `${hfState.side === "back" ? "Back" : "Front"} print · ${HF_PRESET_LABELS205[hfState.preset] || "Hype Frame"}`;
  const sizeEl = $("#hfReviewSize206");
  if (sizeEl) { const s = hfState.size || ""; sizeEl.textContent = s ? `${hfState.colorway} hoodie · ${s.startsWith("Y") ? "Youth " + s.slice(1) : "Adult " + s}` : `${hfState.colorway} hoodie · Pick a size`; }
  const placeEl = $("#hfReviewPlacement206");
  if (placeEl) { const pl = hfState.placement || HF_PLACEMENT_DEFAULT; placeEl.textContent = `${hfState.side === "back" ? "Back" : "Front"} print · centered ${pl.cx}% / ${pl.cy}% · ${pl.size}% size · ${HF_PRESET_LABELS205[hfState.preset] || "Hype Frame"} style`; }
  const artEl = $("#hfReviewArt206");
  if (artEl) artEl.textContent = hfState.imageStyle === "avatar"
    ? (hfState.avatarApplied206 ? "Illustrated avatar — the AI avatar you approved in the studio" : "Illustrated avatar — illustrated from your frame before printing")
    : "Real photo — your frozen frame";
  const backEl = $("#hfReviewBack206");
  if (backEl) { const words = hfGarmentBackText206(); backEl.textContent = words ? `In the design: “${words}”` : "No name in the design"; }
}
/* Round 211 → 215: the Round 206 review stage became the
   studio's Review screen — hfOpenReview206 / hfCloseReview206
   are gone with the stage's markup. Entering the screen runs
   hfReviewSync206 (hfShowScreen215), and the form that lives
   on the screen submits the send directly. */
async function hfSubmitOrder206() {
  const msg = $("#hfReviewMsg206") || $("#hfMsg");
  const formMsg = $("#hfMsg");
  const err206 = hfValidateOrder206();
  if (err206) { if (msg) msg.textContent = err206; return; }
  hfReviewSync206(); // the send always matches what the review shows now
  const guardianEmail = $("#hfGuardianEmail").value.trim();
  if (msg) msg.textContent = "Sending your request…";
  try {
    const r = await api("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      highlightId: hfState.play.id,
      customName: $("#hfName").value.trim(),
      jersey: $("#hfJersey").value.trim(),
      backText: hfState.backText,
      backTextCustom: $("#hfBackCustom197").value.trim(),
      branding: true, // Round 229: every design is the Hype Frame format — branding is always on
      preset: "hypeframe", // Round 229: the fixed format, named for the server (which treats any legacy value as hypeframe too)
      apparel: hfState.apparel,
      side: hfState.side,
      imageStyle: hfState.imageStyle,
      avatarGenerated: hfState.avatarApplied206 === true,
      colorway: hfState.colorway,
      size: hfState.size,
      placement: hfState.placement,
      guardianName: $("#hfGuardianName").value.trim(),
      guardianEmail,
      image: hfState.printDataUrl,
      // Round 218: the design's name mode + label ride with the
      // back-text info (nameMode mirrors the backText choice
      // under its design name; the server stores both).
      nameMode: hfState.backText,
      designLabel: hfDesignLabel218(),
    }) });
    // Round 200: when the server hands back a checkout URL, the
    // order is saved as awaiting payment and the end state is a
    // "Continue to payment" step — the parent taps through to
    // Shopify themselves (never an instant auto-redirect, so the
    // saved order + what happens next is clear first). After
    // paying, Shopify sends them back to /?hf_order=<id>, where
    // hfReturnLanding200 confirms the payment landed.
    if (r.checkoutUrl) {
      const html206 = `${esc(r.message)}${r.backTextToEmbroider ? ` Back text: “${esc(r.backTextToEmbroider)}”` : " Back text: No back text"}<br><a class="btn btn-lime" style="margin-top:10px" href="${esc(r.checkoutUrl)}">Continue to payment →</a><br><span class="small">Order #${r.id} · $110 at Shopify checkout (codes apply there). You’ll come back here after paying — we’ll confirm here and by email.</span>`;
      if (msg) msg.innerHTML = html206;
      if (formMsg && formMsg !== msg) formMsg.innerHTML = html206;
      return;
    }
    // Round 197: the confirmation names exactly what will be
    // embroidered across the back — or, for the no-name choice,
    // says so plainly.
    const done206 = r.message + (r.backTextToEmbroider ? ` Back text: “${r.backTextToEmbroider}”` : " Back text: No back text");
    if (msg) msg.textContent = done206;
    if (formMsg && formMsg !== msg) formMsg.textContent = done206;
  } catch (err) { if (msg) msg.textContent = "Error: " + err.message; }
}
(function wireHf206() {
  $$("#hfGarment206 [data-hf-garment-view]").forEach((b) => b.addEventListener("click", () => { hfState.garmentView206 = b.dataset.hfGarmentView === "back" ? "back" : "front"; hfGarmentSync206(); }));
  const fineBack206 = $("#hfFineBack206"), fineFwd206 = $("#hfFineFwd206");
  if (fineBack206) fineBack206.addEventListener("click", () => hfFineStep206(-0.1));
  if (fineFwd206) fineFwd206.addEventListener("click", () => hfFineStep206(0.1));
  const make206 = $("#hfAvatarMake206");
  if (make206) make206.addEventListener("click", () => { hfMakeAvatar206(); });
  // Round 221: tapping the crop preview re-centers the avatar's
  // crop on the athlete.
  const cropStage221 = $("#hfAvatarCropStage221");
  if (cropStage221) cropStage221.addEventListener("click", (ev) => hfAvatarCropTap221(ev));
  const use206 = $("#hfAvatarUse206"), photo206 = $("#hfAvatarPhoto206");
  if (use206) use206.addEventListener("click", () => hfApplyAvatar206());
  if (photo206) photo206.addEventListener("click", () => hfUsePhoto206());
  // "Your moment": the Change frame action returns the parent
  // to the picking surface (the strip / player) from the
  // picked-frame thumbnail. Round 215: the picking surface
  // lives inside the Change photo panel — open it first.
  const change206 = $("#hfChangeFrame206");
  if (change206) change206.addEventListener("click", () => {
    if (typeof hfSetRow215 === "function") hfSetRow215("photo", true);
    const target = ($("#hfStripWrap") && !$("#hfStripWrap").hidden) ? $("#hfStripWrap") : $("#hfVideoWrap127");
    if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
  });
})();

/* Round 215: the one-page wiring — the sticky bar's
   "Review hoodie →" carries the old step gate (a frame must
   exist before Review means anything); Review's back
   affordance returns to the product page with every choice
   intact (everything lives in hfState); the Pick from video
   row keeps its expand/collapse.
   Round 222: the wiring grows up with the rebuild — the
   option-row toggles are gone with the rows; the Review gate
   gains the SIZE check (no size is preselected, so Review
   holds with a clear prompt until one is tapped); Upload a
   photo and the fence step wire here too. */
(function wireHf222() {
  const reviewBtn215 = $("#hfReviewBtn215");
  if (reviewBtn215) reviewBtn215.addEventListener("click", () => {
    if (!hfState.frozen || !hfState.printDataUrl) {
      const m = $("#hfPhotoMsg215");
      if (m) { m.textContent = "Pick the frame for the hoodie first — tap a still, upload a photo, or pick from the video and freeze the moment."; m.hidden = false; }
      const p = $("#hfPhotoPanel215");
      if (p) p.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    // Round 222: the size gate — no size is preselected, so
    // Review holds here with a clear prompt until one is tapped.
    if (!hfState.size) {
      const m = $("#hfSizeMsg222");
      if (m) { m.textContent = "Pick a size first — tap one above, then Review."; m.hidden = false; }
      const sz = $("#hfSizes");
      if (sz) sz.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    hfShowScreen215("review");
  });
  const back215 = $("#hfReviewBack215");
  if (back215) back215.addEventListener("click", () => hfShowScreen215("product"));
  const clipRow211 = $("#hfClipRow211");
  if (clipRow211) clipRow211.addEventListener("click", () => hfSetClipOpen211(!hfState.clipOpen211));
  // Round 222: Upload a photo — the button fronts the hidden
  // file input; the picked image becomes the print source.
  const upBtn222 = $("#hfUploadBtn222"), upIn222 = $("#hfUploadInput222");
  if (upBtn222 && upIn222) {
    upBtn222.addEventListener("click", () => upIn222.click());
    upIn222.addEventListener("change", () => { hfUploadPhoto222(upIn222.files && upIn222.files[0]); upIn222.value = ""; });
  }
  // Round 222: the fence step — make / approve / keep.
  const fenceBtn222 = $("#hfFenceBtn222");
  if (fenceBtn222) fenceBtn222.addEventListener("click", () => { hfMakeFence222(); });
  const fenceUse222 = $("#hfFenceUse222");
  if (fenceUse222) fenceUse222.addEventListener("click", () => { hfUseFence222(); });
  const fenceKeep222 = $("#hfFenceKeep222");
  if (fenceKeep222) fenceKeep222.addEventListener("click", () => { hfKeepFence222(); });
  // Round 229: the auto-clean revert / re-apply.
  const fenceAutoOrig229 = $("#hfFenceAutoOriginal229");
  if (fenceAutoOrig229) fenceAutoOrig229.addEventListener("click", () => { hfFenceAutoRevert229(); });
  const fenceAutoCleanBtn229 = $("#hfFenceAutoCleaned229");
  if (fenceAutoCleanBtn229) fenceAutoCleanBtn229.addEventListener("click", () => { hfFenceAutoUseCleaned229(); });
})();

/* Round 200 (2026-11-26): the payment return landing + owner
   payment chips. After Shopify checkout, the parent lands back
   on /?hf_order=<id> (the checkout's return points here). The
   landing opens the studio panel and polls the order's payment
   status — the endpoint returns ONLY the status, no order
   detail — until the orders/paid webhook lands (normally a few
   seconds) or the poll budget runs out (~60s, after which the
   copy tells the parent the confirmation email is the record). */
async function hfReturnLanding200() {
  const box = $("#hfReturn200");
  const id = Number(new URLSearchParams(location.search).get("hf_order") || "");
  if (!box || !Number.isInteger(id) || id <= 0) return;
  showHome(); closeMenu(false); showPanel("hypeframe");
  box.hidden = false;
  box.innerHTML = `<b>Welcome back — checking your payment…</b><br><span class="small">Order #${id}. Shopify confirms payments within a few seconds; this page updates itself.</span>`;
  box.scrollIntoView({ behavior: "smooth", block: "center" });
  const render200 = (st) => {
    if (st === "paid") { box.innerHTML = `<b>✅ Payment confirmed — your Hype Frame is in production.</b><br><span class="small">Order #${id}. Made to order — ships in 5–7 business days. A confirmation email is on its way to the parent/guardian email on the order.</span>`; return true; }
    if (st === "refunded") { box.innerHTML = `<b>This order was refunded.</b><br><span class="small">Order #${id}. Questions? Email hello@highlighthype.com.</span>`; return true; }
    if (st === "") { box.innerHTML = `<b>That order doesn’t use online payment.</b><br><span class="small">Order #${id} is a classic order request — we’ll email the parent/guardian to confirm before anything is printed.</span>`; return true; }
    return false; // awaiting_payment — keep polling
  };
  for (let i = 0; i < 24; i++) {
    try {
      const r = await api(`/api/hype-frame/orders/${id}/payment-status`);
      if (render200(r.payment_status)) return;
    } catch { /* a transient miss just costs one poll cycle */ }
    if (i === 0) box.innerHTML = `<b>Waiting for payment…</b><br><span class="small">Order #${id}. If you just paid, hold on — Shopify’s confirmation is on its way. If you didn’t finish paying, your order is saved; the studio can send you back to checkout.</span>`;
    await new Promise((res) => setTimeout(res, 2500));
  }
  box.innerHTML = `<b>Still waiting for Shopify’s confirmation.</b><br><span class="small">Order #${id}. Don’t pay twice — your confirmation email is the record once the payment lands, and the order is saved either way. Questions? Email hello@highlighthype.com.</span>`;
}
/* Round 200: the Owner view's payment chip for a Hype Frame
   order — shown only when the order carries a payment status
   (legacy request rows render nothing extra, exactly as
   before). Inline colors on the house .tagchip, the same
   pattern as the Round 197 custom-text chip. */
function hfPayChip200(paymentStatus) {
  if (paymentStatus === "awaiting_payment") return ` <span class="tagchip" style="background:#3a2f10;color:#e8cf8f">Awaiting payment</span>`;
  if (paymentStatus === "paid") return ` <span class="tagchip" style="background:#1f5c2e;color:#fff">Paid ✓</span>`;
  if (paymentStatus === "refunded") return ` <span class="tagchip" style="background:#7a1f1f;color:#fff">Refunded</span>`;
  return "";
}

/* Photo/Avatar example swipe (Round 40, 2026-11-08): every cream-
   hoodie example (homepage, studio, Store feature) is a two-slide
   native swipe — Photo first, Avatar second. The labeled chips stay
   in sync whether the visitor swipes the track or taps a chip. */
$$("[data-hf-swipe]").forEach((root) => {
  const track = root.querySelector(".hf-swipe-track");
  const chips = [...root.querySelectorAll("[data-hf-chip]")];
  if (!track || chips.length !== 2) return;
  const setActive = (i) => chips.forEach((c, j) => c.setAttribute("aria-pressed", String(i === j)));
  let ticking = false;
  track.addEventListener("scroll", () => {
    if (ticking) return; ticking = true;
    requestAnimationFrame(() => { ticking = false; setActive(track.clientWidth ? Math.round(track.scrollLeft / track.clientWidth) : 0); });
  }, { passive: true });
  chips.forEach((c, i) => c.addEventListener("click", (e) => { e.stopPropagation(); track.scrollTo({ left: i * track.clientWidth, behavior: "smooth" }); setActive(i); })); // stopPropagation (Round 43): store cards open the product view on card click — a chip tap must not
});

/* ---------------- hero ---------------- */
// Round 30 (Emil + Dyanna, 2026-11-07): the hero film is now the B15
// commercial. The old playback chrome (progress bar, seconds timer,
// "Tap for sound" pill) is GONE.
// Round 125 (2026-11-13, Dyanna): the hero music is ON by
// default — the speaker icon is a MUTE choice now, not an
// unmute chore, and the Round 98 always-muted rule is retired.
// Browser autoplay policy still applies: an audible start is
// attempted first, and where the browser requires an
// interaction first, the film starts muted and the FIRST
// pointer/key interaction turns the sound on automatically
// (unless the visitor muted it themselves). A visitor's own
// mute is remembered through the Round 2 storage helper under
// hh_music ("off" = muted; anything else, including no stored
// value, = ON) — across the session and across visits, the
// same pattern as hh_voter / hh_owner_token. This is the
// film's master music bed only; per-moment sound effects stay
// rejected, exactly as before.
/* Round 233 (2026-11-27, Emil — "when not on WiFi the site
   takes a long time to load"): the hero film is picked by
   connection class BEFORE any hero byte is fetched — the
   <video> carries data-src (full) and data-src-lite (the
   1.76 MB rendition next to the 6.96 MB original) and no src,
   and the pick below is the only assignment path (the hero
   controller, showHome, and the studio-exit resume all route
   through heroFilmUrl233 / heroHeld233).
   Classes: "full" — the original film, autoplay as always;
   "lite" — hero-film-lite.mp4, autoplay; "tap" — NOTHING is
   fetched or started: the preloaded poster carries the hero
   and #heroPlay233 offers the film; a tap loads the LITE film
   and starts it under the standing Round 125 sound rules.
   With a Network Information API: saveData or 2g/slow-2g →
   tap; 3g → lite; 4g (and anything unrecognized) → full.
   Without it (iOS Safari): a phone-class viewport (≤820px)
   → lite; anything larger → full. The pick memoizes on the
   element's dataset, so every restart path agrees. */
function heroConnClass233() {
  let conn = null;
  try { conn = (typeof navigator !== "undefined" && navigator) ? navigator.connection : null; } catch (e) { conn = null; }
  if (conn) {
    if (conn.saveData) return "tap";
    const et = String(conn.effectiveType || "");
    if (et === "2g" || et === "slow-2g") return "tap";
    if (et === "3g") return "lite";
    return "full";
  }
  let w = 0;
  try { w = ((typeof window !== "undefined" && window && window.innerWidth) || (typeof document !== "undefined" && document.documentElement && document.documentElement.clientWidth) || 0); } catch (e) { w = 0; }
  return (w && w <= 820) ? "lite" : "full";
}
function heroFilmUrl233(v) {
  if (!v) return "";
  const d = (v.dataset && typeof v.dataset === "object") ? v.dataset : null;
  if (d && d.hh233url) return d.hh233url;
  const cls = heroConnClass233();
  const url = cls === "full" ? ((d && d.src) || "/hero-film.mp4") : ((d && d.srcLite) || "/hero-film-lite.mp4");
  if (d) { try { d.hh233url = url; d.hh233cls = cls; } catch (e) { /* a read-only dataset stub just recomputes next time */ } }
  return url;
}
/* True while the hero must stay a poster: a tap-class
   connection whose visitor has not tapped #heroPlay233 yet.
   Every hero start path checks this first, so returning home
   or leaving the studio can never smuggle the film in. */
function heroHeld233(v) {
  if (!v) return false;
  heroFilmUrl233(v);
  const d = (v.dataset && typeof v.dataset === "object") ? v.dataset : null;
  return !!d && d.hh233cls === "tap" && d.hh233started !== "1";
}
function heroMusicWanted125() { return hhStorageGet("hh_music") !== "off"; }
(function () {
  const v = $("#heroVideo"), mute = $("#heroMute");
  if (!v) return;
  /* Round 77 (2026-11-09, Emil): on the sub-pages (/my-highlights,
     /how-it-works, /store) the hero is hidden — its film must never
     start there, sound included. A #shop deep link is the same:
     showStore owns the screen. The film starts on the homepage
     only. */
  const heroPath = location.pathname.replace(/\/+$/, "") || "/";
  if (heroPath !== "/" || ["#shop", "#hype-girls", "#hype-boys"].includes(location.hash)) { v.pause(); return; }
  /* Round 97 (2026-11-10): the film's URL lives in data-src so a
     sub-page load never fetches the 6.9 MB hero; it is assigned
     only here, on the home route, right before playback. */
  /* Round 233: WHICH film is assigned is the connection pick
     (heroFilmUrl233 — full or lite), and on a tap-class
     connection nothing is assigned at all: heroHeld233 stays
     true until the visitor taps #heroPlay233, and the start
     below is replaced by that button's wiring. */
  const held233 = (typeof heroHeld233 === "function") && heroHeld233(v);
  if (!held233 && v.dataset && !v.getAttribute("src")) { const u233 = (typeof heroFilmUrl233 === "function") ? heroFilmUrl233(v) : v.dataset.src; if (u233) v.src = u233; }
  const setIcon = () => { if (!mute) return; mute.classList.toggle("is-muted", v.muted); mute.setAttribute("aria-label", v.muted ? "Unmute the film" : "Mute the film"); };
  /* Round 125: keep the icon synced with ANY later muted change
     (showHome's preference restart, the icon tap, the first-tap
     unmute below). */
  v.addEventListener("volumechange", setIcon);
  let armFirstTap125 = () => {};
  const startHero125 = () => {
    if (!heroMusicWanted125()) { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); setIcon(); return; }
    v.muted = false;
    const p = v.play();
    if (p && p.catch) p.catch(() => {
      /* Autoplay policy said no: run muted for now and let the
         first interaction turn the sound on. The icon stays
         truthful throughout — it shows the muted state until
         the sound is actually on. */
      v.muted = true; setIcon(); armFirstTap125();
      /* Round 160 (2026-11-14, HOTFIX): the rejection must be
         followed by a MUTED re-play, or the film never moves
         on iOS. Safari evaluates the element's own autoplay
         attempt with the muted state standing at load time —
         muted=false here — and does not re-attempt when muted
         flips afterwards; Chromium's muted-autoplay rescue
         masked the gap on desktop, so the poster froze with a
         muted badge on Emil's phone (hero frozen, badge muted,
         2026-11-14 10:23) until a first tap rescued it through
         armFirstTap125. The retry starts the film muted —
         motion beats a frozen poster — WITHOUT writing
         hh_music: the saved preference stays authoritative,
         and the armed first-tap handler still turns the sound
         on at the visitor's first interaction exactly as
         before. If even muted autoplay is refused (Low Power
         Mode), the second catch swallows and the first tap
         remains the way in — no worse than before this round. */
      const q160 = v.play(); if (q160 && q160.catch) q160.catch(() => {});
    });
    setIcon();
  };
  armFirstTap125 = () => {
    const onTap = (e) => {
      /* A tap ON the speaker icon is the toggle's business —
         its own click handler below reads the same tap as the
         visitor's explicit choice. */
      if (e.target && e.target.closest && e.target.closest("#heroMute")) return;
      window.removeEventListener("pointerdown", onTap);
      window.removeEventListener("keydown", onTap);
      if (!heroMusicWanted125() || !v.muted) return;
      v.muted = false;
      const q = v.play(); if (q && q.catch) q.catch(() => {});
      setIcon();
    };
    window.addEventListener("pointerdown", onTap);
    window.addEventListener("keydown", onTap);
  };
  /* A back/forward-cache restore reruns no scripts — re-apply
     the standing preference (Round 98's blanket re-mute is
     retired with the always-muted rule). */
  window.addEventListener("pageshow", (e) => { if (e.persisted) startHero125(); });
  /* Round 233: on a tap-class connection the hero opens on its
     poster — the autoplay attribute comes off (so no later src
     assignment can self-start the film) and #heroPlay233 is
     shown; its tap marks the hero started, loads the LITE film
     and runs the standing Round 125 start (sound preference
     and all). Every other class starts exactly as before. */
  if (held233) {
    v.removeAttribute("autoplay");
    const pb233 = $("#heroPlay233");
    if (pb233) {
      pb233.hidden = false;
      pb233.addEventListener("click", () => {
        try { v.dataset.hh233started = "1"; } catch (e) { /* a stub dataset cannot hold the flag — the src below still starts this once */ }
        pb233.hidden = true;
        if (!v.getAttribute("src")) { const u233b = (typeof heroFilmUrl233 === "function") ? heroFilmUrl233(v) : (v.dataset && v.dataset.srcLite); if (u233b) v.src = u233b; }
        startHero125();
      });
    }
  } else {
    startHero125();
  }
  mute?.addEventListener("click", () => {
    v.muted = !v.muted;
    hhStorageSet("hh_music", v.muted ? "off" : "on");
    if (!v.muted) { const q = v.play(); if (q && q.catch) q.catch(() => {}); }
    setIcon();
  });
})();

/* ---------------- countdown ---------------- */
(function () {
  const cd = $("#countdown"); if (!cd) return;
  const pad = (n) => String(n).padStart(2, "0");
  function tick() {
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const diff = end - now;
    if (diff <= 0) { cd.textContent = "closed"; return; }
    const d = Math.floor(diff / 86400000), h = Math.floor(diff % 86400000 / 3600000), m = Math.floor(diff % 3600000 / 60000), s = Math.floor(diff % 60000 / 1000);
    cd.textContent = `${d}d ${pad(h)}h ${pad(m)}m ${pad(s)}s`;
    setTimeout(tick, 1000);
  }
  tick();
})();

/* ---------------- upload dropzone ---------------- */
// Front end for the SAME file input the form has always submitted
// (name="file"): tap/click/keyboard opens the native picker, drag &
// drop assigns the file to the input. Once a clip is picked it PREviews
// playing right in the dropzone with a clear "✓ Your clip is in" state
// (Quick Upload, 2026-11-04). Uploads are file-only — the old
// paste-a-link option was removed earlier (Emil, 2026-11-04).
(function () {
  const dz = $("#dropzone"), input = $("#fileInput"), fileLine = $("#dzFile");
  if (!dz || !input) return;
  const preview = $("#dzPreview"), pVideo = $("#dzVideo"), pImg = $("#dzImg");
  let previewUrl = "";
  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B";
  function showFile() {
    const f = input.files && input.files[0];
    dz.classList.toggle("has-file", !!f);
    if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = ""; }
    if (f) {
      fileLine.textContent = `✓ Your clip is in — ${f.name} · ${fmtSize(f.size)}. Tap the clip to change it.`;
      fileLine.hidden = false;
      previewUrl = URL.createObjectURL(f);
      const isVideo = (f.type || "").startsWith("video/");
      pVideo.hidden = !isVideo; pImg.hidden = isVideo;
      if (isVideo) { pVideo.src = previewUrl; const p = pVideo.play(); if (p && p.catch) p.catch(() => {}); }
      else pImg.src = previewUrl;
      preview.hidden = false;
    } else {
      fileLine.textContent = ""; fileLine.hidden = true;
      preview.hidden = true;
      pVideo.removeAttribute("src"); pVideo.load(); pImg.removeAttribute("src");
    }
  }
  window.resetDropzone = () => { input.value = ""; showFile(); };
  dz.addEventListener("click", (e) => { if (window.__hhUploadLock145) return; if (e.target !== input) input.click(); });
  dz.addEventListener("keydown", (e) => { if (window.__hhUploadLock145) return; if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  input.addEventListener("change", showFile);
  ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove("drag"); }));
  dz.addEventListener("drop", (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) { try { input.files = e.dataTransfer.files; } catch { /* picker still works */ } showFile(); }
  });
})();

/* ---------------- quick upload picks (2026-11-04) ---------------- */
// The wizard is gone: one screen. Division is a big Boys/Girls toggle
// (default Boys) writing the hidden division field; sport is a native
// dropdown (round 5b, 2026-11-05 — one-tap pills until the owner asked
// for dropdowns everywhere) whose <select> IS the sport field
// (name="sport"). Either way the payload carries the same
// name="division" / name="sport" values it always has, so the API,
// pre-review and athlete checks are untouched. Validation happens
// once, at submit (see below).
function setDivPick(div) {
  const form = $("#uploadForm"); if (!form) return;
  form.elements.division.value = div;
  $$("[data-div-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.divPick === div)));
}
function setSportPick(sport) {
  const form = $("#uploadForm"); if (!form) return;
  // Round 5b: the sport control is a native <select name="sport">, so
  // the field the payload has always read is the select itself; the
  // select needs no click wiring (its value is read at submit).
  if (form.elements.sport) form.elements.sport.value = sport || "";
}
/* Round 162: the milestone pick — the same quick-pick shape as
   the division toggle (buttons write a hidden field), with one
   difference: NOTHING is pre-selected and tapping the lit chip
   again clears it, because the question is skippable and
   "untagged" is a real answer. The hidden momentKind field is
   what FormData carries; the server validates against its
   allowlist, so a hand-built payload can never store junk. */
function setMomentPick162(kind) {
  const form = $("#uploadForm"); if (!form || !form.elements.momentKind) return;
  const next162 = form.elements.momentKind.value === kind ? "" : (kind || "");
  form.elements.momentKind.value = next162;
  $$("[data-moment-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.momentPick === next162 && next162 !== "")));
}
window.syncMomentPick162 = () => { const form = $("#uploadForm"); if (form && form.elements.momentKind) form.elements.momentKind.value = ""; $$("[data-moment-pick]").forEach((b) => b.setAttribute("aria-pressed", "false")); };
$$("[data-moment-pick]").forEach((b) => b.addEventListener("click", () => setMomentPick162(b.dataset.momentPick)));
$$("[data-div-pick]").forEach((b) => b.addEventListener("click", () => setDivPick(b.dataset.divPick)));
// After a successful submit the form resets; re-sync the toggle and
// the sport dropdown with the reset field values (Boys, no sport).
window.syncQuickPicks = () => { setDivPick("boys"); setSportPick(""); if (window.syncMomentPick162) window.syncMomentPick162(); };

/* ---------------- upload + athlete prompt ---------------- */
/* Round 145 (2026-11-13, Emil's own ask): the upload button
   LOCKS while a post is going out — submit button disabled and
   relabeled "Posting your play…", file input disabled, dropzone
   locked — and the submit handler refuses re-entry in flight, so
   a double-tap (or a panicked re-tap on a slow connection, the
   exact gesture that filled the queue with duplicate pendings
   during the crash window) can never fire a second upload. An
   error hands everything back for a retry; success leaves the
   lock on because the success screen has replaced the form
   ("Post another play" unlocks). */
let uploadInFlight145 = false;
function setUploadLock145(form, locked) {
  uploadInFlight145 = locked;
  window.__hhUploadLock145 = locked;
  if (!form) return;
  const btn = form.querySelector('button[type="submit"]');
  if (btn) {
    if (!btn.dataset.label145) btn.dataset.label145 = btn.textContent;
    btn.disabled = locked;
    btn.textContent = locked ? "Posting your play…" : btn.dataset.label145;
  }
  if (form.elements && form.elements.file) form.elements.file.disabled = locked;
  const dz = $("#dropzone"); if (dz) dz.classList.toggle("locked145", locked);
}
let athleteCheckDoneFor = "";
$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  // Round 145: a second submit while one is in flight is a no-op.
  if (uploadInFlight145) return;
  const form = e.target;
  const msg = $("#uploadMsg");
  // Quick-upload validation (2026-11-04): the clip, the athlete's first
  // name and one sport tap are required; division defaults to Boys.
  // "What happened?" is optional — blank becomes "<Name>'s highlight".
  const fileEl = form.elements.file;
  if (!fileEl || !fileEl.files || !fileEl.files.length) { msg.textContent = "Add your clip first — tap the box at the top to pick it from your camera roll."; $("#dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const name = String(form.elements.playerName.value || "").trim();
  if (!name) { msg.textContent = "Add the athlete's first name — every hype needs its athlete."; form.elements.playerName.focus(); return; }
  /* Round 125 (2026-11-13, Dyanna): the last initial is its own
     OPTIONAL field now. The payload's playerName is composed
     here — "First" alone, or "First L" with the initial — so
     the server, the display-name derivation ("First L."), the
     athlete group/tag logic and My Plays all see exactly the
     name shape they always have. No initial, no problem: the
     single-name path is the one Charlotte posted under. */
  const lastInitial125 = (String(form.elements.lastInitial ? form.elements.lastInitial.value : "") || "").replace(/[^A-Za-z]/g, "").slice(0, 1).toUpperCase();
  const fullName125 = lastInitial125 ? `${name} ${lastInitial125}` : name;
  if (!String(form.elements.sport.value || "").trim()) { msg.textContent = "Tap the sport — one tap is all it takes."; $("#sportSelect")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  // Guardian attestation (Round 21, 2026-11-06): the one required
  // checkbox — the poster confirms they are the athlete's
  // parent/guardian or have the guardian's permission. The server
  // enforces it too (400); this check just answers in place, in the
  // same inline style as the validations above.
  if (!form.elements.guardianConsent || !form.elements.guardianConsent.checked) { msg.textContent = "Please confirm you're the parent/guardian, or have their permission, to post this video."; $(".guardian-block")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  // Upload Assist gate (Round 99): a confident AI "not a play" holds
  // the submit here so the guardian sees the gate note (and its
  // override). __uaGateCheck is defined by the assist wiring at the
  // end of this file and returns true whenever the assist is off,
  // unsure, already overridden, or reading a different file — so
  // without the assist this submit behaves exactly as it always has.
  if (typeof window.__uaGateCheck === "function" && !window.__uaGateCheck(form)) return;
  if (!String(form.elements.title.value || "").trim()) form.elements.title.value = `${name}'s highlight`;
  const fd = new FormData(form);
  // Duplicate-name check: if this name already belongs to an athlete and
  // the uploader hasn't answered the prompt for this exact name yet, ask
  // "same athlete or a different athlete with the same name?" first.
  if (fullName125 && athleteCheckDoneFor !== fullName125.toLowerCase()) {
    try {
      const chk = await api(`/api/athletes/check?name=${encodeURIComponent(fullName125)}`);
      if (chk.matches && chk.matches.length) {
        const box = $("#athletePrompt");
        box.innerHTML = `<h4>Is this the same athlete?</h4>
          <p>We already have ${chk.matches.length === 1 ? "an athlete" : "athletes"} named <b>${esc(fullName125)}</b>. Pick the right one — or tell us this is a different athlete with the same name. We never merge two athletes just because the name matches.</p>
          ${chk.matches.map((a) => `<label><input type="radio" name="athletePick" value="${esc(a.athleteKey)}"> Same athlete — ${esc(a.displayName)}${a.team ? ` · ${esc(a.team)}` : ""} <span class="tagchip">${esc(a.tag)}</span> · ${a.playCount} play${a.playCount === 1 ? "" : "s"} so far</label>`).join("")}
          <label><input type="radio" name="athletePick" value="__new"> A different athlete with the same name</label>
          <p style="margin-top:10px"><button type="button" class="mini-btn" id="athleteContinue">Continue →</button></p>`;
        // The prompt interrupts the submit right where it sits (above
        // the Post button); its Continue files the choice and resumes
        // the same submit, so no entered data or chosen file is lost.
        box.hidden = false;
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        $("#athleteContinue").onclick = () => {
          const pick = box.querySelector("input[name='athletePick']:checked");
          if (!pick) { alert("Pick one so we file this play under the right athlete."); return; }
          if (pick.value === "__new") { form.elements.athleteChoice.value = "new"; form.elements.athleteKey.value = ""; }
          else { form.elements.athleteChoice.value = "same"; form.elements.athleteKey.value = pick.value; }
          athleteCheckDoneFor = fullName125.toLowerCase();
          box.hidden = true;
          form.requestSubmit();
        };
        return;
      }
    } catch { /* if the check fails, submit normally — server still never merges by name alone */ }
  }
  msg.textContent = "Uploading…";
  try {
    const fdSend125 = new FormData(form);
    fdSend125.set("playerName", fullName125);
    /* Round 130: the contest box's state goes EXPLICITLY — "1" or
       "0" — never left to FormData's checkbox omission, so the
       server can tell "guardian unchecked it" from "old client
       that never had the box" (a missing field is legacy and is
       never auto-entered; see server.js contest_optin note). */
    fdSend125.set("contestOptin", form.elements.contestOptin && form.elements.contestOptin.checked ? "1" : "0");
    // Round 145: the lock engages HERE, at the point of no return —
    // every earlier exit (a validation message, the AI gate, the
    // athlete prompt's interrupt-and-resume) leaves the form fully
    // usable, and from here to the response nothing can re-enter.
    // It MUST come after the FormData above is built: a disabled
    // file input is left OUT of FormData entirely, so locking one
    // line earlier would strip the clip from its own upload (the
    // r145 rig caught exactly that — the server answered 400
    // "Upload a file or paste a video link.").
    setUploadLock145(form, true);
    const r = await fetch("/api/highlights", { method: "POST", body: fdSend125 });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Upload failed");
    // Round 121: capture the posting email BEFORE the reset wipes
    // it — the success screen's My Plays jump pre-fills it.
    const postedEmail121 = String(form.elements.notifyEmail ? form.elements.notifyEmail.value : "").trim();
    form.reset();
    if (window.resetDropzone) window.resetDropzone();
    if (window.syncQuickPicks) window.syncQuickPicks();
    form.elements.athleteChoice.value = ""; form.elements.athleteKey.value = "";
    athleteCheckDoneFor = "";
    $("#athletePrompt").hidden = true;
    // Round 145: a deduped answer is a SUCCESS, not an error —
    // the clip already landed once; show the variant screen.
    // Round 155: a fast-laned answer is a success too — the play
    // is already live, so the screen says so (4th argument).
    showUploadSuccess121(j.athlete_tag || "", postedEmail121, j.deduped ? (j.status || "pending") : null, !j.deduped && !!j.fastLaned);
  } catch (err) { setUploadLock145(form, false); msg.textContent = "Error: " + err.message; }
});

/* Round 121 (2026-11-12): the post-success screen. The form body
   swaps for the #uploadSuccess panel (.upload-done hides every
   other form child in CSS): what happens next, the athlete's HH
   tag big enough to screenshot, and a jump straight into My Plays
   pre-filled with the email just posted with. "Post another play"
   hands the (already reset) form back. */
let lastPostedEmail121 = "";
function showUploadSuccess121(tag, email, dedupStatus145, fastLaned155) {
  const form = $("#uploadForm");
  const panel = $("#uploadSuccess");
  if (!form || !panel) { const m = $("#uploadMsg"); if (m) m.textContent = "Thanks! Your play is in review and will appear once the owner approves it."; return; }
  lastPostedEmail121 = email || "";
  const tagEl = $("#uploadSuccessTag"), tagline = $("#uploadSuccessTagline");
  if (tagEl) tagEl.textContent = tag || "";
  if (tagline) tagline.hidden = !tag;
  /* Round 145: the dedupe variant — the server answered from an
     earlier copy of the same clip, so the headline says exactly
     that and the steps swap for the existing play's status line
     (in review / live). A plain success restores the defaults,
     so the panel never carries a stale variant. */
  const checkEl145 = $("#uploadSuccessCheck"), stepsEl145 = $("#uploadSuccessSteps"), statusEl145 = $("#uploadSuccessStatus145");
  if (dedupStatus145) {
    if (checkEl145) checkEl145.textContent = "This clip is already in — no need to post it twice.";
    if (stepsEl145) stepsEl145.hidden = true;
    if (statusEl145) {
      statusEl145.textContent = dedupStatus145 === "approved" ? "It's already live on the board. 🎉" : dedupStatus145 === "pending" ? "It's in review — once the owner approves it, it's live on the board." : "It's already on file — the owner has it.";
      statusEl145.hidden = false;
    }
  } else if (fastLaned155) {
    /* Round 155: the fast-lane variant — a trusted family's
       play skipped the queue and is already live, so the
       review steps don't apply; the status line reuses the
       exact approved wording the dedupe variant uses for a
       live play. Not a new screen: same panel, same elements. */
    if (checkEl145) checkEl145.textContent = "🎉 Your play is in!";
    if (stepsEl145) stepsEl145.hidden = true;
    if (statusEl145) { statusEl145.textContent = "It's already live on the board. 🎉"; statusEl145.hidden = false; }
  } else {
    if (checkEl145) checkEl145.textContent = "🎉 Your play is in!";
    if (stepsEl145) stepsEl145.hidden = false;
    if (statusEl145) { statusEl145.textContent = ""; statusEl145.hidden = true; }
  }
  const msg = $("#uploadMsg"); if (msg) msg.textContent = "";
  form.classList.add("upload-done");
  panel.hidden = false;
  form.scrollTop = 0;
  if (typeof form.scrollIntoView === "function") form.scrollIntoView({ block: "start" });
}
$("#uploadSuccessAnother")?.addEventListener("click", () => {
  const form = $("#uploadForm"), panel = $("#uploadSuccess");
  if (panel) panel.hidden = true;
  if (form) { form.classList.remove("upload-done"); form.scrollTop = 0; setUploadLock145(form, false); }
});
$("#uploadSuccessPlays")?.addEventListener("click", () => {
  const form = $("#uploadForm"), panel = $("#uploadSuccess");
  if (panel) panel.hidden = true;
  if (form) { form.classList.remove("upload-done"); setUploadLock145(form, false); }
  closeUploadOverlay();
  showPanel("mine");
  document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" });
  if (lastPostedEmail121) {
    const emailEl = $("#mineEmail"), findForm = $("#mineFind");
    if (emailEl) emailEl.value = lastPostedEmail121;
    if (findForm) setTimeout(() => findForm.requestSubmit(), 350);
  }
});

/* ---------------- owner ---------------- */
/* Round 159: "Where visitors come from" — renders the .sources
   block of GET /api/owner/stats (last 30 days of the visit_*
   counters): class rows with shares, the top source hosts, and
   a Campaigns list that exists ONLY when UTM-tagged visits do.
   This supersedes the old coarse referrer-bucket list in this
   spot (the endpoint still returns `referrers` and the per-load
   bucket counter still runs — the series is unbroken, it just
   no longer renders here). With nothing recorded yet the block
   says so plainly: counting starts with this round, nothing is
   backfilled. */
/* Round 164: "Trending nudges" — renders the .nudges block of
   GET /api/owner/stats: this period's guardian nudge sends by
   kind, the rally state (window + guardians mailed), and the
   last few sends from nudge_log. Counts are sends, not opens —
   we don't track opens, so the block says exactly what it
   knows. */
function nudgesHtml164(n) {
  const num = (x) => esc(Number(x || 0).toLocaleString("en-US"));
  if (!n) return "<p>No nudge data yet.</p>";
  const c = n.counts || {};
  const r = n.rally || {};
  let out = `<p>🏆 Took #1 — <b>${num(c.first)}</b> · Top 3 — <b>${num(c.top3)}</b> · Month-end rally — <b>${num(c.rally)}</b></p>`;
  out += `<p>Month-end rally (${esc(n.period || "")}): ${r.inWindow ? `<b>window open</b> — voting ends ${esc(r.endsLabel || "")}` : `window opens <b>${esc(r.windowOpens || "")}</b> · voting ends ${esc(r.endsLabel || "")}`} · sent to <b>${num(r.sentGuardians)}</b> guardian${Number(r.sentGuardians || 0) === 1 ? "" : "s"}</p>`;
  const rec = Array.isArray(n.recent) ? n.recent : [];
  if (rec.length) {
    const kind164 = { first: "🏆 took #1", top3: "🏆 entered Top 3", rally: "📣 month-end rally" };
    out += rec.map((x) => {
      const d = new Date(x.sent_at);
      const when = isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
      return `<p>${esc(x.athlete || "Athlete")} — ${esc(kind164[x.kind] || x.kind || "")} at #${num(x.rank)}${when ? ` · ${esc(when)}` : ""}</p>`;
    }).join("");
  } else out += "<p>No nudges sent yet this month.</p>";
  return out;
}
function sourcesHtml159(src) {
  const num = (n) => esc(Number(n || 0).toLocaleString("en-US"));
  const s = src || {};
  const total = Number(s.total || 0);
  if (!total) return "<p>No visits recorded yet — sources appear here as people arrive.</p>";
  const bc = s.byClass || {};
  const row159 = (label, n) => { const c = Number(n || 0); return `<p>${esc(label)} — <b>${num(c)}</b> · ${Math.round((c / total) * 100)}%</p>`; };
  let out = `<p><b>${num(total)}</b> visit${total === 1 ? "" : "s"} in the last 30 days</p>`;
  out += row159("Direct", bc.direct) + row159("Search", bc.search) + row159("Social", bc.social) + row159("Other", bc.other);
  const hosts = Array.isArray(s.topHosts) ? s.topHosts : [];
  if (hosts.length) out += `<h5 class="stats-sub159">Top sources</h5>` + hosts.map((h) => `<p>${esc(h.label || h.host)}${h.label && h.label !== h.host ? ` <span style="color:var(--muted)">(${esc(h.host)})</span>` : ""} — ${num(h.count)}</p>`).join("");
  const camps = Array.isArray(s.campaigns) ? s.campaigns : [];
  if (camps.length) out += `<h5 class="stats-sub159">Campaigns</h5>` + camps.map((c) => `<p>${esc(c.campaign)}${c.source ? ` · ${esc(c.source)}` : ""} — ${num(c.count)}</p>`).join("");
  return out;
}
/* Site stats panel (owner view): renders GET /api/owner/stats —
   the aggregate counters (views, play opens, referrers) plus the
   existing-system totals the endpoint reads from the live tables.
   Counting started the day this shipped, so early on the honest
   answer for most rows is zero. */
function statsHtml(st) {
  const v = st.views || {}, po = st.playOpens || {}, t = st.totals || {}, pl = t.plays || {};
  const num = (n) => esc(Number(n || 0).toLocaleString("en-US"));
  const card = (label, n) => `<div class="queue-item stats-card"><b class="stats-num">${num(n)}</b><br><span style="color:var(--muted)">${esc(label)}</span></div>`;
  const cards = card("Views today", v.today) + card("Views · last 7 days", v.last7Days) + card("Views · last 30 days", v.last30Days) + card("Views · all time", v.allTime) + card("Play opens · all time", po.total) + card("Battle picks · all time", (st.battles || {}).total);
  const byView = Object.entries(v.byView || {}).map(([k, n]) => `${esc(k)}: <b>${num(n)}</b>`).join(" · ");
  /* Round 151: the 30-day series as a CSS bar strip — every day
     gets a bar (height against the busiest day, a floor sliver
     for any nonzero day), the exact count rides the bar's
     tooltip, and a caption names the range + the busiest day.
     Pure divs: no chart library, no canvas. */
  const daily151 = Array.isArray(v.daily) ? v.daily : [];
  const maxDay151 = daily151.reduce((mx, d) => Math.max(mx, Number(d.count) || 0), 0);
  const daily = daily151.length ? `<div class="stats-bars151" role="img" aria-label="Views by day for the last 30 days">${daily151.map((d) => { const c = Number(d.count) || 0; const pct = maxDay151 > 0 ? (c > 0 ? Math.max(6, Math.round((c / maxDay151) * 100)) : 0) : 0; return `<span class="stats-bar151" style="height:${pct}%" title="${esc(d.day)} — ${num(c)} view${c === 1 ? "" : "s"}"></span>`; }).join("")}</div><p class="stats-bars-cap151">${esc(daily151[0].day)} → ${esc(daily151[daily151.length - 1].day)} · busiest day: ${num(maxDay151)} view${maxDay151 === 1 ? "" : "s"}</p>` : "<p>No views recorded yet.</p>";
  const top = (po.top || []).length ? po.top.map((p) => `<p><b>${esc(p.title)}</b> — ${num(p.opens)} open${p.opens === 1 ? "" : "s"}</p>`).join("") : "<p>No play opens recorded yet.</p>";
  const refs = sourcesHtml159(st.sources);
  const sys = `<p>Total votes: <b>${num(t.votes)}</b> · Plays: <b>${num(pl.total)}</b> (${num(pl.approved)} approved, ${num(pl.pending)} pending, ${num(pl.hidden)} hidden) · Hype Frame orders: <b>${num(t.hypeFrameOrders)}</b> · Athletes: <b>${num(t.athletes)}</b></p>`;
  const stories151 = st.stories || {};
  return `<div class="stats-cards">${cards}</div>
    <p>Views by page (all time): ${byView}</p>
    ${sys}
    <h4 class="stats-sub">Views by day (last 30 days)</h4>${daily}
    <h4 class="stats-sub">Most opened plays</h4>${top}
    <h4 class="stats-sub">Hype Stories</h4><p><b>${num(stories151.total)}</b> total watch${Number(stories151.total) === 1 ? "" : "es"}</p>${(stories151.byEpisode && stories151.byEpisode.length) ? stories151.byEpisode.map((e) => `<p>${esc(e.episode)} — ${num(e.opens)} watch${e.opens === 1 ? "" : "es"}</p>`).join("") : "<p>No story watches recorded yet.</p>"}
    <h4 class="stats-sub">Where visitors come from</h4>${refs}
    <h4 class="stats-sub">Trending nudges (this month)</h4>${nudgesHtml164(st.nudges)}
    <p style="color:var(--muted)">Counts are daily totals only — no visitor is identified or followed. Counting started when this shipped; earlier visits were never recorded.</p>`;
}
/* Round 149: the storage meter block under Site stats, fed by
   GET /api/owner/storage. A meter bar (lime normally, gold at
   >=75%, red at >=90%), the used/free line, a compact breakdown
   and the biggest-files list. When the endpoint's mount numbers
   are null (statfs unavailable) the bar and the used/free line
   are skipped and the breakdown stands alone. */
function fmtBytes149(b) {
  const n = Number(b || 0);
  if (n >= 1073741824) { const g = n / 1073741824; return (g >= 100 ? Math.round(g) : Math.round(g * 10) / 10) + " GB"; }
  if (n >= 1048576) return Math.round(n / 1048576) + " MB";
  if (n >= 1024) return Math.round(n / 1024) + " KB";
  return n + " B";
}
function storageHtml149(so) {
  const meter = (so.totalBytes != null && typeof so.usedPct === "number")
    ? `<div class="storage-bar149"><div class="storage-fill149${so.usedPct >= 90 ? " crit149" : so.usedPct >= 75 ? " warn149" : ""}" style="width:${Math.min(100, Math.max(0, so.usedPct))}%"></div></div>
    <p>${fmtBytes149(so.usedBytes)} of ${fmtBytes149(so.totalBytes)} used · ${fmtBytes149(so.freeBytes)} free</p>`
    : "";
  const big = (so.biggest || []).length ? `<h4 class="stats-sub">Biggest files</h4>` + so.biggest.map((f) => `<div class="storage-big149"><span><b>${esc(f.title)}</b>${f.player_name ? ` — ${esc(f.player_name)}` : ""} <span class="tagchip">${esc(f.status)}</span></span><b>${fmtBytes149(f.bytes)}</b></div>`).join("") : "";
  return `<h4 class="stats-sub">Storage</h4>
    ${meter}
    <p>Uploads <b>${fmtBytes149(so.uploadsBytes)}</b> · Database <b>${fmtBytes149(so.dbBytes)}</b> · Hype Frame prints <b>${fmtBytes149(so.hypeFramesBytes)}</b> · Reels <b>${fmtBytes149(so.reelsBytes)}</b> · Waiting in queue: <b>${Number(so.pendingCount || 0)}</b> play${Number(so.pendingCount || 0) === 1 ? "" : "s"}, <b>${fmtBytes149(so.pendingBytes)}</b></p>
    ${big}`;
}
/* Round 145: the last queue loadOwner rendered — deletePlay and
   the duplicate-group actions look plays up here (status, votes,
   contest entry) instead of re-fetching. */
let ownerQueue145 = [];
/* ================================================================
   Round 157 — the Moderation queue gains a New | All filter
   (Emil, 2026-11-14: "We should have a filter for new videos
   and then all videos. It's confusing right now when you see
   all videos by default."). A segmented pill bar (the Round
   141 idiom: one dark bar, the active pill filled lime) sits
   at the top of the queue:
     New — PENDING plays only, the count on the pill. This is
       the DEFAULT view: the panel opens on the work, not the
       archive, and with nothing waiting it reads as one calm
       "🎉 All caught up — no new plays waiting" line.
     All — exactly the list the queue has always rendered:
       same plays, same order, same cards, same detail.
   The switch is a pure re-render of the queue this panel
   already loaded (ownerQueue145) — nothing is re-fetched and
   nothing is re-ordered. The choice is panel state only
   (queueView157): never persisted, so a fresh page load
   always opens on New. Switching views CLEARS the Round 150
   batch selection and its tally line — a selection made
   against one list never silently applies to the other
   (predictable beats clever). Batch actions and Review mode
   are untouched: in New view the head's pending set IS the
   whole list; in All view the head receives liveQueue146
   exactly as before. renderOwnerQueue157 below IS the render
   loadOwner has always done (the Round 145 duplicate
   grouping, the Round 146 trash split, the Round 150 cards +
   head), lifted out of loadOwner so the filter can re-run it
   on demand; loadOwner still owns the fetch, the selection
   prune, and every other panel section.
   ================================================================ */
let queueView157 = "new";
function queueFilterHtml157(pendCount) {
  return `<div class="qfilter157" role="group" aria-label="Queue view"><button type="button" aria-pressed="${queueView157 === "new"}" onclick="setQueueView157('new')">New (${pendCount})</button><button type="button" aria-pressed="${queueView157 === "all"}" onclick="setQueueView157('all')">All</button></div>`;
}
window.setQueueView157 = (v) => {
  const next157 = v === "all" ? "all" : "new";
  if (next157 === queueView157) return;
  queueView157 = next157;
  batchSel150.clear();
  batchMsg150 = "";
  renderOwnerQueue157();
};
function renderOwnerQueue157() {
    /* Round 145: duplicate grouping. Pending plays that share a
       normalized athlete name + title (trim, collapse whitespace,
       lowercase) are copies of one clip — the crash-retry pile-up
       left dozens. The FIRST copy in the list gets a group header
       with one Delete-all-copies action. Groups are pending-only
       by construction: an approved twin is never in a group, and
       when one exists the header says the live play is not
       touched. */
    const norm145 = (s) => String(s || "").trim().replace(/\s+/g, " ").toLowerCase();
    const pendGroups145 = new Map();
    for (const h of ownerQueue145) {
      if (h.status !== "pending") continue;
      const key = norm145(h.player_name) + "|" + norm145(h.title);
      if (!pendGroups145.has(key)) pendGroups145.set(key, []);
      pendGroups145.get(key).push(h);
    }
    const liveKeys145 = new Set(ownerQueue145.filter((h) => h.status === "approved").map((h) => norm145(h.player_name) + "|" + norm145(h.title)));
    const emittedGroups145 = new Set();
    const groupHeader145 = (h) => {
      const key = norm145(h.player_name) + "|" + norm145(h.title);
      const g = pendGroups145.get(key);
      if (!g || g.length < 2 || emittedGroups145.has(key)) return "";
      emittedGroups145.add(key);
      const ids = g.map((x) => x.id).join(",");
      return `<div class="queue-item queue-group145"><b>${g.length} copies of '${esc(h.title)}' — ${esc(h.player_name || h.athlete_label || "no athlete")}</b>${liveKeys145.has(key) ? `<br><span>One copy is live on the board — the live play is not touched.</span>` : ""}<br><label class="qsel150"><input type="checkbox" data-qsel-group="${ids}" ${g.every((x) => batchSel150.has(x.id)) ? "checked" : ""} onchange="toggleBatchGroup150('${ids}', this.checked)"> Select all ${g.length} copies for batch actions</label><div class="qa"><button type="button" class="mini-btn" onclick="deletePendingGroup145('${ids}')">Delete all copies</button></div></div>`;
    };
    /* Round 146: trashed plays leave the queue list entirely —
       they render in the Trash section below instead. (The
       grouping above reads ownerQueue145 but only ever groups pending
       rows, so a trashed copy can never join a delete-all group.) */
    const liveQueue146 = ownerQueue145.filter((h) => h.status !== "trashed");
    /* Round 157: the view's rows — New keeps only the pendings,
       All keeps the whole live list; the order is untouched
       either way, and All renders exactly what it always has. */
    const pendRows157 = liveQueue146.filter((h) => h.status === "pending");
    const viewRows157 = queueView157 === "all" ? liveQueue146 : pendRows157;
    /* Round 150: the cards render into a variable first — the
       queue head (Select all + Review mode + the batch bar) is
       prepended below, and each PENDING card carries a batch
       checkbox whose state comes from batchSel150. */
    const queueCards150 = viewRows157.map((h) => groupHeader145(h) + `<div class="queue-item">${h.status === "pending" ? `<label class="qsel150"><input type="checkbox" class="qsel-box150" data-qsel="${h.id}" ${batchSel150.has(h.id) ? "checked" : ""} onchange="toggleBatchSel150(${h.id}, this.checked)"> Select for batch actions</label><br>` : ""}<b>${esc(h.title)}</b> — ${esc(h.sport)} — status: <b>${esc(h.status)}</b>${h.isSample ? ` — <span class="tagchip">⭐ Sample play</span>` : ""}${h.fast_laned_at ? ` — <span class="tagchip">⚡ Fast lane</span>` : ""}${h.missing_rendition ? ` — <span class="tagchip">⚠ No rendition</span>` : ""}${h.text_flag227 ? ` — <span class="tagchip warn">⚠ Check text: ${esc(h.text_flag227)}</span>` : ""} — ${h.voteCount} votes
      ${h.player_name ? `<br>Athlete: ${esc(h.athlete_label || h.player_name)}${h.athlete_tag ? ` · ${esc(h.athlete_tag)}` : ""}${h.team ? ` · ${esc(h.team)}` : ""}` : ""}
      ${(() => { const bits = [];
        if (h.guardian_email) bits.push(`${esc(h.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(h.guardian_email)}?subject=${encodeURIComponent("HighlightHype — " + h.title)}">✉️ Contact guardian</a>`);
        if (h.guardian_phone) bits.push(`${esc(h.guardian_phone)} <a class="mini-btn" style="text-decoration:none" href="tel:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">📞 Call</a> <a class="mini-btn" style="text-decoration:none" href="sms:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">💬 Text</a> ${h.text_consent ? `<span class="tagchip">Text opt-in: YES</span>` : `<span class="tagchip warn">No text opt-in — do not text</span>`}`);
        return bits.length ? `<br>Parent/guardian (owner only): ${bits.join("<br>")}` : `<br><span style="color:var(--muted)">No parent/guardian contact on file — can't be featured as a winner.</span>`; })()}
      ${h.guardian_consent_at ? `<br>Guardian consent ✓ ${esc(new Date(h.guardian_consent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}` : ""}
      ${h.story_consent ? `<br><span class="tagchip">⭐ Story OK — may feature as a Hype Story</span>${h.story_text ? `<br>“What made this moment matter?” ${esc(h.story_text)}` : ""}` : (h.story_text ? `<br><span style="color:var(--muted)">Story note (no story permission given):</span> ${esc(h.story_text)}` : "")}
      <br><label class="moment-set162">Moment tag: <select class="moment-select162" aria-label="Milestone tag for this play" onchange="setMomentKind162(${h.id}, this.value)"><option value="">None</option>${Object.entries(typeof MOMENT_LABELS162 !== "undefined" ? MOMENT_LABELS162 : {}).map(([k, l]) => `<option value="${k}"${h.moment_kind === k ? " selected" : ""}>${l}</option>`).join("")}</select></label>${h.moment_kind && typeof momentChipInline162 === "function" ? ` ${momentChipInline162(h)}` : ""}
      ${h.guardian_email ? `<br>Guardian email: <b>${esc(h.guardian_email)}</b>` : `<br><label class="moment-set162">Guardian email: <input type="email" id="gemail162-${h.id}" placeholder="parent/guardian email" size="26" autocomplete="off"> <button type="button" class="mini-btn" onclick="setGuardianEmail162(${h.id})">Save</button></label> <span style="color:var(--muted)">— none on file; attach one so this family can find the play in My Plays.</span>`}
      ${h.review ? `<p>🤖 Pre-review: <b>${esc(h.review.verdict)}</b>${h.review.flags && h.review.flags.length ? `<br>${h.review.flags.map((f) => "• " + esc(f)).join("<br>")}` : ""}<br><i>First-pass check only — it does not approve the play. Watch it yourself before approving.</i></p>` : ""}
      ${h.ai ? `<p>🤖 AI: <b>${esc(h.ai.sport || "?")}</b> · ${esc(h.ai.division || "?")} · gate <b>${esc(h.ai.gate === "play" ? "pass" : h.ai.gate || "?")}</b>${typeof h.ai.confidence === "number" ? ` (${Math.round(h.ai.confidence * 100)}%)` : ""}${h.ai.reason ? ` — ${esc(h.ai.reason)}` : ""}<br><i>AI first pass — its suggestions were shown to the guardian, who could edit them. It never approves a play.</i></p>` : ""}
      <div class="qa"><button type="button" class="mini-btn" onclick="setStatus(${h.id},'approved')">Approve</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'hidden')">Hide</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'pending')">Back to review</button><button type="button" class="mini-btn" onclick="deletePlay(${h.id})">Delete</button>${h.isSample ? `<button type="button" class="mini-btn" onclick="setSample(${h.id},'${h.status}',false)">Remove sample mark</button>` : `<button type="button" class="mini-btn" onclick="setSample(${h.id},'approved',true)">Approve as Sample play</button>`}${h.status === "approved" && !h.isSample ? `<button type="button" class="mini-btn" onclick="setCelebration(${h.id},${h.celebration_spotlight ? "false" : "true"})">${h.celebration_spotlight ? "★ Celebration spotlight: ON — tap to remove" : "Celebration spotlight"}</button>` : ""}</div></div>`).join("");
    const body157 = queueView157 === "new" && !pendRows157.length
      ? `<p class="queue-empty157">🎉 All caught up — no new plays waiting</p>`
      : (queueCards150 || "<p>Queue is empty.</p>");
    $("#queue").innerHTML = queueFilterHtml157(pendRows157.length) + queueHead150(viewRows157) + body157;
}

async function loadOwner() {
  if (!ownerToken()) { $("#ownerStatus").textContent = "Not claimed on this device yet."; $("#queue").innerHTML = ""; $("#reports").innerHTML = ""; $("#ownerStats").innerHTML = ""; const dnEl = $("#dropNotify"); if (dnEl) dnEl.innerHTML = ""; const trEl146 = $("#trash146"); if (trEl146) trEl146.innerHTML = ""; const mlEl146 = $("#modLog146"); if (mlEl146) mlEl146.innerHTML = ""; const oaEl152 = $("#ownerAccess152"); if (oaEl152) oaEl152.innerHTML = ""; const flEl155 = $("#fastLane155"); if (flEl155) flEl155.innerHTML = ""; const msEl162 = $("#momentSpotlight162"); if (msEl162) msEl162.innerHTML = ""; const soEl149 = $("#ownerStorage149"); if (soEl149) soEl149.innerHTML = ""; /* Round 150: no owner, no review session or batch state. */ if (typeof closeReview150 === "function") closeReview150(true); batchSel150.clear(); batchMsg150 = ""; return; }
  try {
    const q = await api("/api/owner/queue");
    ownerQueue145 = q.queue;
    /* Round 150: a fresh queue load prunes the batch selection —
       ids that are no longer pending (acted on, trashed, gone)
       fall out of the set before the cards re-render. */
    pruneBatchSel150(q.queue);
    $("#ownerStatus").textContent = "Owner access active on this device.";
    renderOwnerQueue157();
    const trashRows146 = q.queue.filter((h) => h.status === "trashed");
    /* Round 146: the Trash section. Poster thumb, title, athlete,
       when it was trashed + the status a Restore lands on, and
       the whole days left before the auto-purge — with Restore
       and Delete forever per play. The copy carries the rule the
       owner needs at restore time: the play comes back as it
       was, but its contest entry is NOT recreated. */
    const trashEl146 = $("#trash146");
    if (trashEl146) trashEl146.innerHTML = trashRows146.length ? trashRows146.map((h) => `<div class="queue-item trash146-item">
      ${h.poster_url ? `<img class="trash146-thumb" src="${esc(h.poster_url)}" alt="">` : ""}
      <div class="trash146-body"><b>${esc(h.title)}</b>${h.player_name ? ` — ${esc(h.athlete_label || h.player_name)}` : ""}${h.isSample ? ` — <span class="tagchip">⭐ Sample play</span>` : ""}<br>
      <span style="color:var(--muted)">Trashed ${esc(h.trashed_at || "")} · was <b>${esc(h.status_before_trash || "pending")}</b> · ${h.trash_days_left == null ? "" : h.trash_days_left === 0 ? "<b>auto-purges today</b>" : `<b>${h.trash_days_left} day${h.trash_days_left === 1 ? "" : "s"}</b> left to restore`}</span><br>
      <span style="color:var(--muted)">Restoring puts the play back as it was; contest entry is not automatic.</span>
      <div class="qa"><button type="button" class="mini-btn" onclick="restorePlay146(${h.id})">Restore</button><button type="button" class="mini-btn" onclick="purgePlay146(${h.id})">Delete forever</button></div></div>
    </div>`).join("") : "<p>Trash is empty — deleted plays land here for 7 days before they are gone for good.</p>";
    if (typeof buildOwnerDaily100 === "function") buildOwnerDaily100(q.queue);
    const rep = await api("/api/owner/reports");
    $("#reports").innerHTML = rep.reports.map((r) => `<p>Play #${r.highlight_id}: ${esc(r.reason)} (${esc(r.created_at)})</p>`).join("") || "<p>No reports.</p>";
    // Site stats (owner only): a failure here must not take the
    // queue down with it, so it rides in its own try, same pattern
    // as the Hype Frame requests below.
    try {
      const st = await api("/api/owner/stats");
      $("#ownerStats").innerHTML = statsHtml(st);
    } catch { $("#ownerStats").innerHTML = "<p>Could not load site stats.</p>"; }
    // Round 149: the storage meter rides the same refresh as
    // Site stats, in its own try — a failed storage fetch renders
    // a note in its block and never touches the rest of the panel.
    try {
      const so149 = await api("/api/owner/storage");
      const soEl149 = $("#ownerStorage149");
      if (soEl149) soEl149.innerHTML = storageHtml149(so149);
    } catch { const soEl149 = $("#ownerStorage149"); if (soEl149) soEl149.innerHTML = "<h4 class=\"stats-sub\">Storage</h4><p>Storage unavailable right now.</p>"; }
    // Hype Frame requests (owner only): print image thumbnails are fetched
    // as blobs through the owner-authorized image endpoint — the images
    // are never publicly served. Guardian email is owner-visible here only.
    try {
      const hf = await api("/api/owner/hype-frames");
      let hfHtml = "";
      for (const o of hf.requests) {
        let src = "";
        try { const ir = await fetch(o.imageUrl, { headers: { "x-owner-token": ownerToken() } }); if (ir.ok) src = URL.createObjectURL(await ir.blob()); } catch {}
        hfHtml += `<div class="queue-item hf-req">
          ${src ? `<img class="hf-req-img" src="${src}" alt="Hype Frame print image">` : (o.print_image ? `<p><i>Print image on file (preview unavailable here).</i></p>` : `<p><i>No print image on file for this order.</i></p>`)}
          <div class="hf-req-body">
            <b>${esc(o.play_title || "Play #" + o.highlight_id)}</b> — status: <b>${esc(o.status)}</b>${hfPayChip200(o.payment_status)}<br>
            Print: ${esc(o.custom_name || "—")}${o.jersey ? ` · #${esc(o.jersey)}` : ""} · HYPE FRAME branding: ${o.branding ? "yes" : "no"}<br>
            Back text: <b>${o.backTextToEmbroider ? esc(o.backTextToEmbroider) : "NO BACK TEXT"}</b>${o.back_text === "custom" ? (o.back_text_reviewed ? ` <span style="color:var(--muted)">(custom text — reviewed ✓)</span>` : ` <span class="tagchip" style="background:#7a1f1f;color:#fff">⚠ CUSTOM TEXT — REVIEW</span> <button type="button" class="mini-btn" onclick="hfMarkBackTextReviewed197(${o.id})">Mark reviewed</button>`) : ""}<br>
            Apparel: ${esc(o.apparel)} · ${esc(o.colorway)} · Size: ${esc(o.size || "YM")} · Print side: ${o.side === "front" ? "Front" : "Back"} · Image: ${o.image_style === "avatar" ? (o.avatar_generated ? "AI avatar (studio-generated — the print image IS the avatar)" : "Avatar (illustrate first)") : "Real photo"}<br>
            ${(() => { try { const p = JSON.parse(o.placement || ""); return p && p.cx != null ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size<br>` : ""; } catch { return ""; } })()}
            ${src ? `<a class="mini-btn" style="text-decoration:none" href="${src}" download="hypeframe-order-${o.id}.png">⬇ Download print image</a><br>` : ""}
            Parent/guardian (owner only): ${o.guardian_name ? `${esc(o.guardian_name)} — ` : ""}${esc(o.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(o.guardian_email)}?subject=${encodeURIComponent("HighlightHype — your Hype Frame request")}">✉️ Contact guardian</a><br>
            <span style="color:var(--muted)">${esc(o.created_at)} — confirm with the guardian before printing anything.</span>
          </div>
        </div>`;
      }
      $("#hfRequests").innerHTML = hfHtml || "<p>No Hype Frame requests yet.</p>";
    } catch { $("#hfRequests").innerHTML = "<p>Could not load Hype Frame requests.</p>"; }
    // Drop notifications (owner only, Round 106): per-key counts
    // plus the signup emails — the emails live ONLY in this owner
    // surface. Own try, same pattern as stats/Hype Frames.
    // Round 227: the keys now include the coming-soon store cards
    // (collection slugs + hoodie-<sport>), so the row label names
    // what was actually signed up for — only the six bottle sports
    // read "bottle".
    try {
      const dn = await api("/api/owner/drop-notifications");
      const dnLabel227 = (k) => k.startsWith("hoodie-") ? `${cap(k.slice(7))} hoodie` : (typeof BTL106 !== "undefined" && BTL106[k] ? `${cap(k)} bottle` : cap(k.replace(/-/g, " ")));
      const dnCounts = (dn.counts || []).map((c) => `${esc(dnLabel227(c.sport))}: <b>${c.count}</b>`).join(" · ");
      const dnRows = (dn.signups || []).map((s) => `<p><b>${esc(s.email)}</b> — ${esc(dnLabel227(s.sport))} <span style="color:var(--muted)">(${esc(s.created_at)})</span></p>`).join("");
      $("#dropNotify").innerHTML = `<p>${dnCounts || "No signups yet."}</p>${dnRows}`;
    } catch { $("#dropNotify").innerHTML = "<p>Could not load drop notifications.</p>"; }
    // Moderation log (owner only, Round 146): the last 50 actions,
    // newest first — time, action, play, actor. Own try, same
    // pattern as the sections above.
    try {
      const ml = await api("/api/owner/moderation-log");
      const mlEl = $("#modLog146");
      if (mlEl) mlEl.innerHTML = (ml.entries || []).length ? ml.entries.map((e) => `<p class="modlog146-row"><span style="color:var(--muted)">${esc(e.created_at)}</span> — <b>${esc(e.action)}</b> — ${esc(e.play_title || ("Play #" + e.play_id))} <span style="color:var(--muted)">(by ${esc(e.actor)}${e.detail ? ` — ${esc(e.detail)}` : ""})</span></p>`).join("") : "<p>No moderation actions recorded yet.</p>";
    } catch { const mlEl = $("#modLog146"); if (mlEl) mlEl.innerHTML = "<p>Could not load the moderation log.</p>"; }
    // Owner access (owner only, Round 152): named passcodes —
    // metadata list + mint form + the once-only reveal. Own try,
    // same pattern; refreshOwnerAccess152 preserves a fresh
    // reveal across the re-render.
    try {
      const tk152 = await api("/api/owner/tokens");
      ownerTokens152 = tk152.tokens || [];
      renderOwnerAccess152();
    } catch { const oaEl = $("#ownerAccess152"); if (oaEl) oaEl.innerHTML = "<p>Could not load the passcode list.</p>"; }
    // Fast lane (owner only, Round 155): the trusted-guardian
    // list + the "awaiting your look" strip of fast-laned plays.
    // Own try, same pattern as the sections above.
    try {
      const tr155 = await api("/api/owner/trusted");
      trustedGuardians155 = tr155.guardians || [];
      fastLaneRecent155 = tr155.recent || [];
      textAlerts156 = tr155.textAlerts156 || null;
      renderFastLane155();
    } catch { const flEl = $("#fastLane155"); if (flEl) flEl.innerHTML = "<p>Could not load the fast-lane list.</p>"; }
    // Moment That Mattered (owner only, Round 162): the current
    // pick + the picker list. Own try, same pattern as above.
    try {
      const ss162 = await api("/api/owner/spotlight-state");
      renderSpotlightPanel162(ss162);
    } catch { const msEl = $("#momentSpotlight162"); if (msEl) msEl.innerHTML = "<p>Could not load the spotlight.</p>"; }
  } catch (e) { $("#ownerStatus").textContent = "Owner access was refused on this device: " + e.message; }
}
/* Round 162: the panel's Moment That Mattered section — the
   current pick (name, title, kind chip, when, by whom) with
   Remove, then every pickable play (approved, story or tag)
   with its Feature button. The pick already live wears a note
   instead of a second Feature button (re-setting is a no-op
   the API would happily log — better to not offer it). */
function renderSpotlightPanel162(state) {
  const el = $("#momentSpotlight162"); if (!el) return;
  const cur = state && state.current ? state.current : null;
  const picker = (state && state.picker) || [];
  const curHtml = cur
    ? `<div class="queue-item"><b>Now featuring:</b> ${esc(cur.player_name || "")} — ${esc(cur.title)}${cur.moment_label ? ` ${esc(cur.moment_label)}` : ""}<br><span style="color:var(--muted)">Set ${cur.set_at ? esc(new Date(cur.set_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })) : ""}${cur.set_by ? ` by ${esc(cur.set_by)}` : ""}${cur.status !== "approved" ? ` — <span class="tagchip warn">not live right now (${esc(cur.status)}) — the homepage card is hidden until it's approved again</span>` : ""}</span><div class="qa"><button type="button" class="mini-btn" onclick="setSpotlight162(null)">Remove</button></div></div>`
    : `<p style="color:var(--muted)">No Moment That Mattered is set — the homepage card stays hidden until you feature one.</p>`;
  const pickerHtml = picker.length
    ? picker.map((r) => `<div class="queue-item"><b>${esc(r.player_name || "")}</b> — ${esc(r.title)}${r.moment_label ? ` ${esc(r.moment_label)}` : ""}<br><span style="color:var(--muted)">${r.has_story ? (r.story_consent ? "Has a story — consent given, it can be quoted on the card." : "Has a story — NO story consent, the card shows name + moment only.") : "No story — featured on name + moment."}</span><div class="qa">${cur && cur.play_id === r.id ? `<span class="tagchip">⭐ Currently featured</span>` : `<button type="button" class="mini-btn" onclick="setSpotlight162(${r.id})">Feature</button>`}</div></div>`).join("")
    : `<p style="color:var(--muted)">Nothing to feature yet — plays appear here once they're approved and carry a story or a milestone tag.</p>`;
  el.innerHTML = curHtml + pickerHtml;
}
/* Round 152: named owner passcodes — the Owner access block.
   ownerTokens152 caches the metadata list (NEVER a value or a
   hash — the API doesn't send them); passcodeReveal152 holds a
   freshly minted plaintext only until it is dismissed, because
   the server shows it exactly once. The block re-renders from
   the cache so a reveal survives a list refresh. */
let ownerTokens152 = [];
let passcodeReveal152 = null;
const fmtDate152 = (ts) => { if (!ts) return ""; const d = new Date(String(ts).replace(" ", "T") + "Z"); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
function renderOwnerAccess152() {
  const el = $("#ownerAccess152"); if (!el) return;
  const rows = (ownerTokens152 || []).map((t) => `<div class="queue-item access152-item">
    <b>${esc(t.name)}</b> — ${t.revoked ? `<span class="tagchip warn">Revoked</span>` : `<span class="tagchip">Active</span>`}<br>
    <span style="color:var(--muted)">Created ${esc(fmtDate152(t.created_at))} · Last used ${t.last_used_at ? esc(fmtDate152(t.last_used_at)) : "never"}</span>
    ${t.revoked ? "" : `<div class="qa"><button type="button" class="mini-btn" onclick="revokePasscode152(${t.id})">Revoke</button></div>`}
  </div>`).join("");
  el.innerHTML = `<p>Each person can have their own owner passcode — it goes in the same paste box above, on their own phone. If a phone is lost, revoke just that person's passcode here; the others keep working. Actions taken with a passcode appear in the moderation log under that name.</p>
  ${rows || "<p>No named passcodes yet — the main owner token is the only way in.</p>"}
  ${passcodeReveal152 ? `<div class="access152-reveal"><b>New passcode for ${esc(passcodeReveal152.name)} — shown only once:</b>
    <p class="access152-code"><code id="revealCode152">${esc(passcodeReveal152.token)}</code> <button type="button" class="mini-btn" onclick="copyPasscode152()">Copy</button></p>
    <p>Give this to ${esc(passcodeReveal152.name)} — it gets pasted into the owner box on their phone. It won't be shown again.</p>
    <p><button type="button" class="mini-btn" onclick="dismissReveal152()">Done — hide it</button></p></div>` : ""}
  <p><input id="mintName152" type="text" placeholder="Name — e.g. Dyanna" size="24" maxlength="40"> <button type="button" class="mini-btn" onclick="mintPasscode152()">Create passcode</button></p>
  <p id="mintMsg152" style="color:var(--muted)"></p>`;
}
async function refreshOwnerAccess152() {
  try { const tk = await api("/api/owner/tokens"); ownerTokens152 = tk.tokens || []; } catch {}
  renderOwnerAccess152();
}
window.mintPasscode152 = async () => {
  const inp = $("#mintName152"); const name = inp ? inp.value.trim() : "";
  const msg = $("#mintMsg152");
  if (!name) { if (msg) msg.textContent = "Type the person's name first."; return; }
  try {
    const r = await api("/api/owner/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
    passcodeReveal152 = { name: r.name, token: r.token };
    await refreshOwnerAccess152();
  } catch (e) { if (msg) msg.textContent = e.message; else alert(e.message); }
};
window.revokePasscode152 = async (id) => {
  const t = (ownerTokens152 || []).find((x) => x.id === id);
  const name = t ? t.name : "this";
  if (!confirm(`Revoke ${name}'s passcode? Their phone loses owner access right away. This can't be undone — mint a fresh passcode to let them back in.`)) return;
  try {
    await api("/api/owner/tokens/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    if (passcodeReveal152 && t && passcodeReveal152.name === t.name) passcodeReveal152 = null;
    await refreshOwnerAccess152();
  } catch (e) { alert(e.message); }
};
window.copyPasscode152 = async () => {
  const code = $("#revealCode152"); if (!code) return;
  const text = code.textContent;
  try { await navigator.clipboard.writeText(text); } catch {
    const range = document.createRange(); range.selectNodeContents(code);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    try { document.execCommand("copy"); } catch {}
  }
};
window.dismissReveal152 = () => { passcodeReveal152 = null; renderOwnerAccess152(); };
/* Round 155: the trusted-family fast lane block. The caches
   hold METADATA only (the API never sends an email or a hash):
   labels, stamps, active/revoked. The strip lists the most
   recent fast-laned plays that are still live; each row's
   Trash button calls the panel's ordinary deletePlay, so a
   live play gets the same name-it-first dialog (Round 145)
   and the same 7-day Trash move as any panel delete — the
   strip invents no delete path of its own. */
let trustedGuardians155 = [];
let fastLaneRecent155 = [];
/* Round 156: the owner text-alert status (counts + booleans
   only — the API never sends the numbers). The line renders
   at the top of the Fast lane section: on with its number
   count, or off naming exactly what Render still needs. */
let textAlerts156 = null;
function textAlertLine156() {
  const s = textAlerts156;
  if (!s) return "";
  if (s.on) return `<p>📱 <b>Text alerts: on</b> — ${s.numbers} number${s.numbers === 1 ? "" : "s"} get a text with the review link when a new play lands in the queue.</p>`;
  const missing = [!s.configured ? "OWNER_ALERT_PHONES" : "", !s.twilio ? "Twilio" : ""].filter(Boolean).join(" + ");
  return `<p>📱 <b>Text alerts: off</b> — needs ${missing} in Render.</p>`;
}
function renderFastLane155() {
  const el = $("#fastLane155"); if (!el) return;
  const rows = (trustedGuardians155 || []).map((g) => `<div class="queue-item fastlane155-item">
    <b>${esc(g.label)}</b> — ${g.revoked ? `<span class="tagchip warn">Revoked</span>` : `<span class="tagchip">Active</span>`}<br>
    <span style="color:var(--muted)">Added ${esc(fmtDate152(g.created_at))} · Last upload through the lane ${g.last_used_at ? esc(fmtDate152(g.last_used_at)) : "never"}</span>
    ${g.revoked ? "" : `<div class="qa"><button type="button" class="mini-btn" onclick="revokeTrusted155(${g.id})">Revoke</button></div>`}
  </div>`).join("");
  const strip = (fastLaneRecent155 || []).length ? `<h4 class="fastlane155-striphead">Fast-laned — awaiting your look</h4>` + fastLaneRecent155.map((p) => `<div class="queue-item fastlane155-strip-row">
    <b>⚡ ${esc(p.title)}</b>${p.athlete ? ` — ${esc(p.athlete)}` : ""}${p.label ? ` <span style="color:var(--muted)">(via ${esc(p.label)})</span>` : ""}<br>
    <span style="color:var(--muted)">Went live ${esc(fmtDate152(p.fast_laned_at))} without waiting in the queue.</span>
    <div class="qa"><button type="button" class="mini-btn" onclick="deletePlay(${p.id})">Trash</button></div>
  </div>`).join("") : "";
  el.innerHTML = `<p>Families on this list skip the review queue — their plays go live right away. You can undo any of them from here. The Upload Assist check still runs first: a clip it flags as not-a-play waits for you like any other upload, trusted or not.</p>
  ${textAlertLine156()}
  ${strip}
  ${rows || "<p>No families on the fast lane yet — every upload waits in the queue.</p>"}
  <p><input id="trustedEmail155" type="email" placeholder="Guardian email" size="26"> <input id="trustedLabel155" type="text" placeholder="Label — e.g. The Millers — Hawks" size="26" maxlength="60"> <button type="button" class="mini-btn" onclick="addTrusted155()">Add to fast lane</button></p>
  <p id="trustedMsg155" style="color:var(--muted)"></p>`;
}
async function refreshFastLane155() {
  try { const tr = await api("/api/owner/trusted"); trustedGuardians155 = tr.guardians || []; fastLaneRecent155 = tr.recent || []; textAlerts156 = tr.textAlerts156 || null; } catch {}
  renderFastLane155();
}
window.addTrusted155 = async () => {
  const emailEl = $("#trustedEmail155"), labelEl = $("#trustedLabel155"), msg = $("#trustedMsg155");
  const email = emailEl ? emailEl.value.trim() : "";
  const label = labelEl ? labelEl.value.trim() : "";
  if (!email) { if (msg) msg.textContent = "Type the guardian's email first."; return; }
  if (!label) { if (msg) msg.textContent = "Give the family a label — e.g. The Millers — Hawks."; return; }
  try {
    const r = await api("/api/owner/trusted", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, label }) });
    await refreshFastLane155();
    const m2 = $("#trustedMsg155");
    if (m2) m2.textContent = r.reactivated ? `${r.label} is back on the fast lane.` : `${r.label} is on the fast lane — their next upload goes live right away.`;
  } catch (e) { if (msg) msg.textContent = e.message; else alert(e.message); }
};
window.revokeTrusted155 = async (id) => {
  const g = (trustedGuardians155 || []).find((x) => x.id === id);
  const label = g ? g.label : "this family";
  if (!confirm(`Take ${label} off the fast lane? Their next upload waits in the review queue again. Plays already live stay live.`)) return;
  try {
    await api("/api/owner/trusted/revoke", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
    await refreshFastLane155();
  } catch (e) { alert(e.message); }
};
window.setStatus = async (id, status) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); loadOwner(); loadData(); };
// Sample flag (Round 7): rides the same status call — one tap in the
// owner queue approves AND flags a play as a sample (or removes the
// mark, keeping the play's current status).
window.setSample = async (id, status, sample) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, sample }) }); loadOwner(); loadData(); };
/* Round 100: Celebration Spotlight — one tap in the owner queue.
   The server clears every other play when one is set, so at most
   one play ever carries the Best Celebration badge. */
window.setCelebration = async (id, on) => { await api(`/api/highlights/${id}/celebration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spotlight: !!on }) }); loadOwner(); loadData(); };
/* Round 162: the queue card's milestone select — the same
   one-call owner action shape as setCelebration: POST the new
   kind ("" clears), then refresh the panel AND the board (the
   chip + the lane read the same payload). A refused call (the
   API's 400 for a hand-built kind) surfaces as the plain alert
   the other queue actions use, and nothing re-renders. */
window.setMomentKind162 = async (id, value) => { try { await api("/api/owner/moment-kind", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, kind: value || null }) }); } catch (e) { alert(e.message); return; } loadOwner(); loadData(); };
/* Round 162: the Moment That Mattered pick — Feature / Remove
   from the panel section both land here; null clears. The
   homepage card re-renders off the same loadData refresh. */
window.setSpotlight162 = async (playId) => { try { await api("/api/owner/spotlight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ playId }) }); } catch (e) { alert(e.message); return; } loadOwner(); loadData(); };
/* Round 162 (Feature 3): attach a guardian email to a play
   that was posted phone-only — the queue row's inline input.
   The endpoint validates the shape and answers in plain
   words; a refusal alerts and leaves the panel exactly as it
   was, a success re-renders queue + board (the play's
   prize-eligibility/contact state reads the same payload). */
window.setGuardianEmail162 = async (id) => { const inp = document.getElementById("gemail162-" + id); const email = inp ? inp.value.trim() : ""; if (!email) { alert("Type the guardian's email first."); return; } try { await api("/api/owner/guardian-email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, email }) }); } catch (e) { alert(e.message); return; } loadOwner(); loadData(); };
window.deletePlay = async (id) => {
  /* Round 145: an APPROVED (live) play never deletes from the
     bare confirm — it takes the dedicated dialog below, which
     names the play, its votes and its contest entry. Pending and
     hidden plays keep the one-tap confirm they always had.
     Round 146: the delete itself is now a move to Trash (the
     server flips the status; files + votes are kept), so the
     confirm says so — nothing here is permanent any more. */
  const row145 = (ownerQueue145 || []).find((h) => h.id === id);
  if (row145 && row145.status === "approved") { openDeleteLive145(row145); return; }
  if (!confirm("Move this play to Trash? It leaves the board, and you can restore it from the Trash for 7 days.")) return;
  await api(`/api/highlights/${id}`, { method: "DELETE" });
  loadOwner(); loadData();
};
/* Round 145: delete EVERY pending copy in a duplicate group —
   one confirmation naming the count and the title, then the
   existing owner delete per id, then one queue refresh.
   Round 146: those deletes are Trash moves now (the same owner
   path), so the copies land in the Trash — restorable for 7
   days like any other trashed play. */
window.deletePendingGroup145 = async (idsCsv) => {
  const ids = String(idsCsv || "").split(",").map((s) => Number(s)).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) return;
  const first145 = (ownerQueue145 || []).find((h) => h.id === ids[0]);
  const title145 = first145 ? first145.title : "this play";
  if (!confirm(`Move all ${ids.length} pending copies of '${title145}' to Trash? They can be restored for 7 days. (A live play with this title is not touched.)`)) return;
  for (const id of ids) { await api(`/api/highlights/${id}`, { method: "DELETE" }); }
  loadOwner(); loadData();
};
/* Round 145: the delete-a-live-play dialog (#deleteLiveModal145
   in index.html). It exists because the 2026-11-13 hand-cleanup
   deleted three LIVE plays that wore the same titles as their
   pending duplicates. Cancel carries the focus on open, so the
   red button is never the default action. */
let deleteLiveId145 = null;
function openDeleteLive145(h) {
  const modal = $("#deleteLiveModal145"), txt = $("#deleteLiveText145");
  if (!modal || !txt) { // markup missing (older cached page): fall back to a named confirm
    if (confirm(`Move the LIVE play "${h.title}" to Trash? It leaves the board right away, and you can restore it for 7 days.`)) {
      api(`/api/highlights/${h.id}`, { method: "DELETE" }).then(() => { loadOwner(); loadData(); });
    }
    return;
  }
  deleteLiveId145 = h.id;
  const who145 = h.athlete_label || h.player_name || "no athlete";
  txt.textContent = `"${h.title}" — ${who145} is LIVE on the board with ${h.voteCount || 0} all-time vote${h.voteCount === 1 ? "" : "s"}${h.contest_entry_period ? `, and it's entered in Hype of the Month (${h.contest_entry_period})` : ""}.`;
  modal.hidden = false;
  const cancel145 = $("#deleteLiveCancel145"); if (cancel145) cancel145.focus();
}
function closeDeleteLive145() { const modal = $("#deleteLiveModal145"); if (modal) modal.hidden = true; deleteLiveId145 = null; }
$("#deleteLiveCancel145")?.addEventListener("click", closeDeleteLive145);
$("#deleteLiveModal145")?.querySelector("[data-dellive-cancel]")?.addEventListener("click", closeDeleteLive145);
$("#deleteLiveConfirm145")?.addEventListener("click", async () => {
  const id = deleteLiveId145;
  closeDeleteLive145();
  if (id == null) return;
  await api(`/api/highlights/${id}`, { method: "DELETE" });
  loadOwner(); loadData();
});
/* Round 146: the Trash actions. Restore flips the play back to
   its pre-trash status server-side — files and votes were kept
   the whole time, so the play comes back whole; the contest
   entry is NOT recreated (the Trash row says so). A failed
   restore (e.g. the video file went missing) alerts the reason
   and leaves the play in the Trash. Delete forever is the
   panel's one permanent gesture and names itself as final. */
/* Round 197: the owner has read a custom back-text line — set the
   order's reviewed flag server-side and reload the panel so the
   flag clears. The one moderation gesture this feature has. */
window.hfMarkBackTextReviewed197 = async (id) => {
  try { await api(`/api/owner/hype-frames/${id}/back-text-reviewed`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
  catch (e) { alert(e.message); }
  loadOwner();
};
window.restorePlay146 = async (id) => {
  try { await api(`/api/highlights/${id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }); }
  catch (e) { alert(e.message); }
  loadOwner(); loadData();
};
window.purgePlay146 = async (id) => {
  const row146 = (ownerQueue145 || []).find((h) => h.id === id);
  const name146 = row146 ? `"${row146.title}"` : "this play";
  if (!confirm(`Delete ${name146} FOREVER? The play, its video file and its votes are permanently deleted. This cannot be undone.`)) return;
  await api(`/api/highlights/${id}/purge`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  loadOwner(); loadData();
};
/* ================================================================
   Round 150 — swipe review mode + batch actions (Phase 5 of the
   owner-panel program). Everything here is CLIENT-side: the
   batch runner and the review session drive the EXISTING
   per-play owner endpoints one play at a time — approve is
   POST /api/highlights/:id/status {status:"approved"}, trash
   is DELETE /api/highlights/:id (the Round 146 Trash move),
   undo-of-a-trash is POST /api/highlights/:id/restore. No new
   server endpoints, so moderation semantics + the moderation
   log are exactly the ones the single-play buttons produce.
   ================================================================ */
const batchSel150 = new Set();
let batchMsg150 = "";
let batchBusy150 = false;
function pendingIds150() {
  return (ownerQueue145 || []).filter((h) => h.status === "pending").map((h) => h.id);
}
function pruneBatchSel150(queue) {
  const pend = new Set((queue || []).filter((h) => h.status === "pending").map((h) => h.id));
  for (const id of [...batchSel150]) if (!pend.has(id)) batchSel150.delete(id);
}
function batchBarHtml150() {
  const n = batchSel150.size;
  if (!n) return "";
  const dis = batchBusy150 ? " disabled" : "";
  return `<div class="batch-bar150"><b>${n} selected</b><button type="button" class="mini-btn" ${dis} onclick="runBatch150('approved')">Approve ${n} selected</button><button type="button" class="mini-btn" ${dis} onclick="runBatch150('trash')">Move ${n} to Trash</button><button type="button" class="mini-btn" ${dis} onclick="clearBatchSel150()">Clear</button><span class="batch-prog150" id="batchProg150"></span></div>`;
}
function queueHead150(rows) {
  const pend = (rows || []).filter((h) => h.status === "pending");
  const msg = `<p class="batch-msg150" id="batchMsg150">${esc(batchMsg150)}</p>`;
  if (!pend.length) return batchMsg150 ? msg : "";
  const allOn = pend.every((h) => batchSel150.has(h.id));
  return `<div class="queue-head150"><label class="qsel150"><input type="checkbox" id="qselAll150" ${allOn ? "checked" : ""} onchange="toggleBatchAll150(this.checked)"> Select all pending (${pend.length})</label><button type="button" class="mini-btn" onclick="openReview150()">▶ Review mode</button></div><div id="batchBar150">${batchBarHtml150()}</div>${msg}`;
}
function syncBatchUi150() {
  document.querySelectorAll(".qsel-box150").forEach((cb) => { cb.checked = batchSel150.has(Number(cb.dataset.qsel)); });
  document.querySelectorAll("[data-qsel-group]").forEach((cb) => {
    const ids = String(cb.dataset.qselGroup || "").split(",").map(Number).filter((n) => Number.isInteger(n) && n > 0);
    const on = ids.filter((id) => batchSel150.has(id)).length;
    cb.checked = ids.length > 0 && on === ids.length;
    cb.indeterminate = on > 0 && on < ids.length;
  });
  const all = $("#qselAll150");
  if (all) {
    const pend = pendingIds150();
    const on = pend.filter((id) => batchSel150.has(id)).length;
    all.checked = pend.length > 0 && on === pend.length;
    all.indeterminate = on > 0 && on < pend.length;
  }
  const bar = $("#batchBar150"); if (bar) bar.innerHTML = batchBarHtml150();
  const m = $("#batchMsg150"); if (m) m.textContent = batchMsg150;
}
window.toggleBatchSel150 = (id, on) => { if (on) batchSel150.add(Number(id)); else batchSel150.delete(Number(id)); syncBatchUi150(); };
window.toggleBatchGroup150 = (idsCsv, on) => {
  for (const s of String(idsCsv || "").split(",")) { const id = Number(s); if (!Number.isInteger(id) || id <= 0) continue; if (on) batchSel150.add(id); else batchSel150.delete(id); }
  syncBatchUi150();
};
window.toggleBatchAll150 = (on) => {
  for (const id of pendingIds150()) { if (on) batchSel150.add(id); else batchSel150.delete(id); }
  syncBatchUi150();
};
window.clearBatchSel150 = () => { batchSel150.clear(); batchMsg150 = ""; syncBatchUi150(); };
/* The batch runner: strictly sequential (one request in flight
   at a time, in selection order), a live "Approving k of N…"
   progress label, and ONE tally line at the end that names any
   failures by play id. A batch trash takes ONE confirm for the
   whole batch. Succeeded ids leave the selection; failed ids
   stay selected so the owner can retry or use their cards. */
window.runBatch150 = async (action) => {
  if (batchBusy150) return;
  const pend = new Set(pendingIds150());
  const ids = [...batchSel150].filter((id) => pend.has(id));
  if (!ids.length) { syncBatchUi150(); return; }
  if (action === "trash" && !confirm(`Move ${ids.length} selected play${ids.length === 1 ? "" : "s"} to Trash? They leave the board right away and can be restored from the Trash for 7 days.`)) return;
  batchBusy150 = true; syncBatchUi150();
  const failed = [];
  let done = 0;
  for (let i = 0; i < ids.length; i++) {
    const bp = $("#batchProg150");
    if (bp) bp.textContent = action === "trash" ? `Moving ${i + 1} of ${ids.length} to Trash…` : `Approving ${i + 1} of ${ids.length}…`;
    try {
      if (action === "trash") await api(`/api/highlights/${ids[i]}`, { method: "DELETE" });
      else await api(`/api/highlights/${ids[i]}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
      done++; batchSel150.delete(ids[i]);
    } catch { failed.push(ids[i]); }
  }
  batchBusy150 = false;
  batchMsg150 = action === "trash"
    ? `${done} moved to Trash${failed.length ? ` — failed: ${failed.map((id) => "#" + id).join(", ")} (still selected; try those from their cards)` : ""}.`
    : `${done} approved${failed.length ? ` — failed: ${failed.map((id) => "#" + id).join(", ")} (still selected; try those from their cards)` : ""}.`;
  await loadOwner(); loadData();
};
/* ---------------- Round 150: review mode ----------------
   The session walks a SNAPSHOT of the pending ids taken when
   it opens, but every render and every action re-reads the
   live queue data (ownerQueue145, refreshed before each
   action): a play that was approved, trashed or deleted
   elsewhere mid-session is skipped, never acted on blind.
   Undo reverses a TRASH through the restore endpoint. There
   is no un-approve endpoint, so after an approve the Undo
   button disables and the note says where the undo lives —
   the semantics stay honest. */
const REVIEW_SWIPE_THRESHOLD150 = 90;
let reviewState150 = null;
async function refreshOwnerQueue150() {
  const q = await api("/api/owner/queue");
  ownerQueue145 = q.queue;
  return q.queue;
}
function reviewMediaHtml150(h) {
  if (!h) return "";
  if (h.media_kind === "link_embed" && h.embed_url) return `<iframe src="${esc(h.embed_url)}" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen title="Embedded play"></iframe>`;
  if (h.media_kind === "file" && /\.(jpe?g|png|gif|webp)$/i.test(h.media_url || "")) return `<img src="${esc(h.media_url)}" alt="">`;
  if (h.media_kind === "link_watch") return `<p class="review-nomedia150">No inline preview for a linked clip — <a href="${esc(h.media_url || "#")}" target="_blank" rel="noopener">watch it at ${esc(h.host_label || "the source")} ↗</a> before deciding.</p>`;
  if (h.media_url) return `<video src="${esc(h.media_url)}"${h.poster_url ? ` poster="${esc(h.poster_url)}"` : ""} playsinline preload="metadata"></video>`;
  return `<p class="review-nomedia150">No preview available for this play.</p>`;
}
function resetReviewCard150() {
  const card = $("#reviewCard150"); if (card) { card.style.transition = ""; card.style.transform = ""; }
  const tint = $("#reviewTint150"); if (tint) tint.style.opacity = "0";
}
function renderReview150() {
  const st = reviewState150; if (!st) return;
  while (st.idx < st.list.length) {
    const row = (ownerQueue145 || []).find((h) => h.id === st.list[st.idx]);
    if (row && row.status === "pending") break;
    st.idx++;
  }
  const done150 = st.idx >= st.list.length;
  const prog = $("#reviewProgress150"); if (prog) prog.textContent = done150 ? "Done" : `${st.idx + 1} of ${st.list.length}`;
  const card = $("#reviewCard150"); if (card) card.hidden = done150;
  const done = $("#reviewDone150"); if (done) done.hidden = !done150;
  const last = st.lastAction;
  const undoBtn = $("#reviewUndo150"); if (undoBtn) undoBtn.disabled = !(last && last.action === "trash") || st.busy;
  const apBtn = $("#reviewApprove150"); if (apBtn) apBtn.disabled = done150 || st.busy;
  const trBtn = $("#reviewTrash150"); if (trBtn) trBtn.disabled = done150 || st.busy;
  const actions = $("#reviewActions150");
  if (actions) actions.hidden = done150 && !(last && last.action === "trash");
  const note = $("#reviewNote150");
  if (note) {
    if (last && last.action === "approved") { note.hidden = false; note.textContent = "Approved — to undo, trash it from Live plays in the panel."; }
    else note.hidden = true;
  }
  if (done150) { resetReviewCard150(); return; }
  const h = (ownerQueue145 || []).find((x) => x.id === st.list[st.idx]);
  const media = $("#reviewMedia150"); if (media) media.innerHTML = reviewMediaHtml150(h);
  const meta = $("#reviewMeta150");
  if (meta) meta.innerHTML = `<b class="review-athlete150">${esc(h.athlete_label || h.player_name || "No athlete")}</b><div class="review-title150">${esc(h.title)}</div><div class="review-sub150">${esc(cap(h.sport))} · ${esc(cap(h.division))}${h.isSample ? ` · <span class="tagchip">⭐ Sample play</span>` : ""} · Submitted ${esc(new Date(h.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }))}</div>${h.review ? `<p class="review-verdict150">🤖 Pre-review: <b>${esc(h.review.verdict)}</b>${h.review.flags && h.review.flags.length ? `<br>${h.review.flags.map((f) => "• " + esc(f)).join("<br>")}` : ""}<br><i>First-pass check only — it does not approve the play. Watch it yourself before approving.</i></p>` : ""}`;
  resetReviewCard150();
}
window.openReview150 = () => {
  const ids = pendingIds150();
  if (!ids.length) return;
  reviewState150 = { list: ids, idx: 0, lastAction: null, busy: false };
  const m = $("#reviewModal150"); if (!m) { reviewState150 = null; return; }
  m.hidden = false;
  document.addEventListener("keydown", reviewKeys150);
  renderReview150();
};
window.closeReview150 = (silent) => {
  const m = $("#reviewModal150"); if (m) m.hidden = true;
  reviewState150 = null;
  reviewDrag150 = null;
  document.removeEventListener("keydown", reviewKeys150);
  if (!silent) { loadOwner(); loadData(); }
};
function reviewKeys150(e) {
  if (!reviewState150) return;
  if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "")) return;
  if (e.key === "ArrowRight") { e.preventDefault(); reviewAct150("approved"); }
  else if (e.key === "ArrowLeft") { e.preventDefault(); reviewAct150("trash"); }
  else if (e.key === "Escape") { e.preventDefault(); closeReview150(); }
}
window.reviewAct150 = async (action) => {
  const st = reviewState150; if (!st || st.busy) return;
  const myIdx = st.idx;
  const id = st.list[myIdx]; if (id == null) return;
  st.busy = true;
  try {
    await refreshOwnerQueue150();
    const row = (ownerQueue145 || []).find((h) => h.id === id);
    if (!row || row.status !== "pending") { if (st.idx === myIdx) st.idx++; return; }
    if (action === "trash") await api(`/api/highlights/${id}`, { method: "DELETE" });
    else await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
    st.lastAction = { id, action, idx: myIdx };
    if (st.idx === myIdx) st.idx++;
  } catch (e) { alert(e.message); }
  finally { st.busy = false; renderReview150(); }
};
window.reviewUndo150 = async () => {
  const st = reviewState150; if (!st || st.busy) return;
  const last = st.lastAction;
  if (!last || last.action !== "trash") return;
  st.busy = true; renderReview150();
  try {
    await api(`/api/highlights/${last.id}/restore`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await refreshOwnerQueue150();
    st.idx = last.idx;
    st.lastAction = null;
  } catch (e) { alert(e.message); }
  finally { st.busy = false; renderReview150(); }
};
/* The swipe: pointer drag on the card — the card follows, a
   green/red tint past the threshold names the action, release
   at >= REVIEW_SWIPE_THRESHOLD150 px commits, anything less
   springs back. Mouse drags run the same path (the rig drives
   it that way). A real drag also swallows the click that would
   otherwise toggle the video's play/pause on release. */
let reviewDrag150 = null;
let reviewSwallowClick150 = 0;
function reviewDragStart150(e) {
  const st = reviewState150;
  if (!st || st.busy || st.idx >= st.list.length) return;
  if (e.button != null && e.button !== 0) return;
  reviewDrag150 = { id: e.pointerId, x0: e.clientX, dx: 0, moved: false };
  try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
}
function reviewDragMove150(e) {
  const d = reviewDrag150; if (!d || e.pointerId !== d.id) return;
  d.dx = e.clientX - d.x0;
  if (Math.abs(d.dx) > 8) d.moved = true;
  const card = $("#reviewCard150"); if (!card) return;
  card.style.transition = "none";
  card.style.transform = `translateX(${d.dx}px)`;
  const tint = $("#reviewTint150"), glyph = $("#reviewTintGlyph150");
  if (tint) {
    tint.style.opacity = String(Math.min(0.85, Math.abs(d.dx) / 140));
    tint.classList.toggle("ok150", d.dx >= 0);
    tint.classList.toggle("no150", d.dx < 0);
  }
  if (glyph) glyph.textContent = d.dx >= 0 ? "✓ APPROVE" : "🗑 TRASH";
}
function reviewDragEnd150(e) {
  const d = reviewDrag150; if (!d || (e && e.pointerId !== d.id)) return;
  reviewDrag150 = null;
  if (d.moved) reviewSwallowClick150 = Date.now() + 300;
  const card = $("#reviewCard150"); if (card) { card.style.transition = ""; card.style.transform = ""; }
  const tint = $("#reviewTint150"); if (tint) tint.style.opacity = "0";
  /* A pointercancel means the browser took the gesture over
     (scroll, interruption) — that is a spring-back, never a
     commit, however far the card had travelled. */
  if (e && e.type === "pointercancel") return;
  if (Math.abs(d.dx) >= REVIEW_SWIPE_THRESHOLD150) reviewAct150(d.dx > 0 ? "approved" : "trash");
}
const reviewCardEl150 = $("#reviewCard150");
if (reviewCardEl150) {
  reviewCardEl150.addEventListener("pointerdown", reviewDragStart150);
  reviewCardEl150.addEventListener("pointermove", reviewDragMove150);
  reviewCardEl150.addEventListener("pointerup", reviewDragEnd150);
  reviewCardEl150.addEventListener("pointercancel", reviewDragEnd150);
}
const reviewMediaEl150 = $("#reviewMedia150");
if (reviewMediaEl150) reviewMediaEl150.addEventListener("click", (e) => {
  if (Date.now() < reviewSwallowClick150) return;
  const v = e.target;
  if (v && v.tagName === "VIDEO") {
    try { if (v.paused) { const pr = v.play(); if (pr && typeof pr.catch === "function") pr.catch(() => {}); } else v.pause(); } catch {}
  }
});
$("#reviewApprove150")?.addEventListener("click", () => reviewAct150("approved"));
$("#reviewTrash150")?.addEventListener("click", () => reviewAct150("trash"));
$("#reviewUndo150")?.addEventListener("click", () => reviewUndo150());
$("#reviewExit150")?.addEventListener("click", () => closeReview150());
$("#reviewClose150")?.addEventListener("click", () => closeReview150());

const ownerBtnEl = $("#ownerBtn"); if (ownerBtnEl) ownerBtnEl.addEventListener("click", () => { showHome(); $("#ownerPanel").classList.remove("hidden"); loadOwner(); $("#ownerPanel").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("#saveTokenBtn").addEventListener("click", () => { const t = $("#tokenInp").value.trim(); if (!t) return alert("Paste an owner token first."); setOwnerToken(t); $("#tokenInp").value = ""; alert("Owner token saved on this device."); loadOwner(); });
$("#claimBtn").addEventListener("click", async () => { try { const r = await api("/api/owner/claim", { method: "POST" }); setOwnerToken(r.token); alert("Owner claimed on this device. The token is saved in this browser."); loadOwner(); } catch (e) { alert(e.message); } });
const modLinkBtnEl = $("#modLinkBtn"); if (modLinkBtnEl) modLinkBtnEl.addEventListener("click", async () => { const m = $("#modLinkMsg"); m.textContent = "Sending…"; try { const r = await api("/api/moderate/request"); m.textContent = r.message; } catch (e) { m.textContent = e.message; } });

/* ---------------- boot / hashes ---------------- */
(function boot() {
  /* Round 51 (2026-11-08, Emil): the main sections are REAL pages.
     The server already serves this app for any path, so
     /my-highlights, /how-it-works and /store boot straight into
     their view: page-sub hides the home flow (hero, trust, CTAs)
     so the page reads as its own page, and the route counts as an
     explicit target so the default landing rule leaves it alone.
     /?view=all is the menu's All Hypes landing. */
  const bootPath = location.pathname.replace(/\/+$/, "") || "/";
  let bootPathTarget = false;
  if (bootPath === "/my-highlights") { document.body.classList.add("page-sub"); showPanel("mine"); bootPathTarget = true; }
  else if (bootPath === "/how-it-works") { document.body.classList.add("page-sub"); showPanel("how"); bootPathTarget = true; }
  /* Round 108 (2026-11-12, Emil): Hype Stories is a menu page now
     (/stories), booting exactly like How It Works. */
  else if (bootPath === "/stories") { document.body.classList.add("page-sub"); showPanel("stories"); bootPathTarget = true; }
  else if (bootPath === "/store") { showStore(); bootPathTarget = true; }
  if (bootPathTarget) bootHashTarget = true;
  if (bootPath === "/" && new URLSearchParams(location.search).get("view") === "all") { switchView("all"); bootHashTarget = true; /* Round 82 (2026-11-09, Emil's pick): Watch Highlights opens at the TOP like the homepage — hero playing as normal, All Hypes preselected below. The Round 77 board jump and Round 80 hero pause are retired at his direction. */ }
  const am = location.hash.match(/^#athlete-(.+)$/);
  const hm = location.hash.match(/^#hype-frame-(\d+)$/);
  // Explicit hash targets (Round 8): any of these wins over the
  // default landing-view rule in applyDefaultView.
  if (am || hm || /^#(?:play|watch)-\d+$/.test(location.hash)) bootHashTarget = true;
  syncFilterUI();
  loadData().then(() => { if (am) openAthlete(am[1]); if (hm) openHypeFrame(Number(hm[1])); if (typeof hhSettle139 === "function") hhSettle139(); });
  if (location.hash === "#shop") { bootHashTarget = true; showStore(); }
  /* Round 108: the pre-108 homepage anchor #stories (shared links,
     old bookmarks) lands on the Stories panel now that the section
     has left the homepage flow. */
  if (location.hash === "#stories") { bootHashTarget = true; showPanel("stories"); window.scrollTo(0, 0); }
  if (location.hash === "#hype-girls" || location.hash === "#hype-boys") { bootHashTarget = true; showStore(location.hash.slice(1)); }
  if (location.hash === "#owner") { bootHashTarget = true; $("#ownerPanel").classList.remove("hidden"); loadOwner(); }
  // Round 24: #post is the upload form heading's id — the target
  // external links (shares, emails) have always pointed at. The
  // form has no in-page position anymore, so the deep link opens
  // the overlay instead of anchor-jumping to a hidden element.
  if (location.hash === "#post") { bootHashTarget = true; goSubmit(); }
  /* Round 200: a parent returning from Shopify checkout lands on
     /?hf_order=<id> — open the return view (it polls the order's
     payment status and confirms in place). */
  if (new URLSearchParams(location.search).has("hf_order")) { bootHashTarget = true; hfReturnLanding200(); }
  // Site stats: one referrer event per page load, plus the landing
  // view. Store deep links already counted themselves through the
  // showStore hook above, and #post counted "home" through
  // goSubmit → showPanel — every other landing (plain home, a
  // shared #play-, an athlete, the owner panel) starts on the home
  // boards, so it counts "home" here.
  trackReferrer();
  trackVisitSource159();
  if (!bootPathTarget && !["#shop", "#hype-girls", "#hype-boys", "#post", "#stories"].includes(location.hash)) trackEvent("view", "home");
  /* Round 139: arm in-app history — the boot entry gets its
     first snapshot now and settles when loadData lands (the
     hook above), with a plain timer as the fallback. */
  if (typeof hhBoot139 === "function") hhBoot139();
})();

/* ===== Rounds 62 + 67: board controls =====
   The sport pill bar filtered the visible board in place (Month
   writes monthSport; Fame jumps to All Hypes like the old browse
   row did; All writes allSport). Round 67 (2026-11-09, Emil): the
   bar is one sideways-scrolling row (no More button), and each
   view's division seg sits visible in its board-tools row - the
   Filter popover is retired. The sport <select> stays in the DOM,
   CSS-hidden, because renderSportSelect/syncFilterUI run on it.
   Round 125 (2026-11-13, Dyanna): the pill bar is ONE dropdown
   (#boardSportSelect, the full sport list in static markup). The
   change handler below is the pill tap, verbatim in effect:
   same state writes, same renders, same syncFilterUI fallbacks
   (a sport with no plays in the current data lands back on All
   Sports, exactly as a pill tap on it did). */
const boardSportSel125 = $("#boardSportSelect");
if (boardSportSel125) boardSportSel125.addEventListener("change", () => {
  const sp = boardSportSel125.value;
  if (currentView === "month" && monthSub === "fame") { allSport = sp; syncFilterUI(); switchView("all"); renderAll2(); }
  else if (currentView === "month") { monthSport = sp; syncFilterUI(); renderMonth(); }
  else { allSport = sp; syncFilterUI(); if (currentView !== "all") switchView("all"); renderAll2(); }
});
window.openGuidelines = () => { const m = $("#guidelinesModal"); if (!m) return; if (m.parentElement !== document.body) document.body.appendChild(m); m.hidden = false; };
document.addEventListener("keydown", (e) => { if (e.key === "Escape") window.closeGuidelines(); });
window.closeGuidelines = () => { const m = $("#guidelinesModal"); if (m) m.hidden = true; };

/* ===== Round 63 (2026-11-08): Hype Stories player =====
   Cover tap (or the Watch story button) swaps the still for the
   episode and plays it inline; the first play counts one
   story_open for the episode in the built-in stats. */
(function wireStory63() {
  const cover = document.getElementById("storyCover");
  const vid = document.getElementById("storyVideo");
  const watch = document.getElementById("storyWatch");
  if (!cover || !vid) return;
  let counted = false;
  const start = () => {
    cover.hidden = true;
    vid.hidden = false;
    if (!counted) { counted = true; try { trackEvent("story_open", "ep01"); } catch {} }
    const pr = vid.play();
    if (pr && pr.catch) pr.catch(() => {});
  };
  cover.addEventListener("click", start);
  if (watch) watch.addEventListener("click", start);
})();

/* ===== Round 69 (2026-11-09, Emil): the floating Post button
   hides itself whenever a submit control is already on screen
   (hero, board band, story link, final section) and returns when
   none is visible. No observer support = it simply stays. ===== */
(function fabAutoHide69() {
  const fab = document.getElementById("floatSubmit");
  if (!fab || !("IntersectionObserver" in window)) return;
  const targets = document.querySelectorAll("[data-submit-link], .story-card");
  if (!targets.length) return;
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); });
    fab.classList.toggle("fab-auto-hidden", seen.size > 0);
  }, { threshold: 0.2 });
  targets.forEach((t) => io.observe(t));
})();

/* ===== Round 70 (2026-11-09): story player grows tall on play.
   The Round 63 wiring swaps cover -> video; this adds the tall
   shape + a close button that returns to the wide poster. ===== */
(function storyTall70() {
  const cover = document.getElementById("storyCover");
  const video = document.getElementById("storyVideo");
  const close = document.getElementById("storyClose");
  if (!cover || !video || !close) return;
  const media = cover.closest(".story-media");
  cover.addEventListener("click", () => { if (media) media.classList.add("playing"); close.hidden = false; });
  const toPoster = () => {
    try { video.pause(); video.currentTime = 0; } catch (e) {}
    video.hidden = true; cover.hidden = false; close.hidden = true;
    if (media) media.classList.remove("playing");
  };
  close.addEventListener("click", toPoster);
  /* Round 71 (2026-11-09): when the episode ends, return to the
     wide poster instead of sitting on the player's black end
     frame — the poster + play disc is the replay button. */
  video.addEventListener("ended", toPoster);
  /* Round 81 note (2026-11-09): do NOT add a click-to-pause
     handler here — with native controls on, a picture click
     already toggles play/pause in the browser, and a second
     handler fires after it and toggles straight back (verified:
     one click produced pause+play events, net zero). The pause
     fix is the height cap in styles.css, which keeps the
     control bar on screen. */
})();

/* Round 83 (2026-11-09, Emil): the store's Hype Frame feature
   runs the same film as the homepage — its own cover + video
   pair, same behavior as playHfHomeFilm. */
function playHfStoreFilm() {
  const cover = $("#hfFilmCoverStore"), vid = $("#hfStoreFilm");
  if (!vid) return;
  if (cover) cover.hidden = true;
  vid.hidden = false;
  const p = vid.play(); if (p && p.catch) p.catch(() => {});
}

/* Round 126 (2026-11-13): the Watch feed's compact Hype Frame
   strip runs the same film with the same cover swap as the
   pre-125 homepage section and the store feature above.
   Round 129 restacked the strip around the film (full-width
   on top); this swap is untouched — one tap, cover out, film
   in, playing. */
function playHfFeedFilm126() {
  const cover = $("#hfFilmCoverFeed126"), vid = $("#hfFeedFilm126");
  if (!vid) return;
  if (cover) cover.hidden = true;
  vid.hidden = false;
  const p = vid.play(); if (p && p.catch) p.catch(() => {});
}

/* Round 201 (2026-11-26, Emil): the homepage merch section's
   own film instance — the same cover swap as the feed strip's
   (above) and the store feature's (playHfStoreFilm), on its
   own ids so all three films play and pause independently.
   Round 204 (Emil, same day): the film's play button
   (hfHomeFilmBtn201) lives OUTSIDE the cover now and answers
   to the video's own events — visible only while the film is
   NOT playing (never started, paused, or ended) and gone the
   moment playback starts, so no route (the button, the
   native controls, an end-of-film pause) leaves it sitting
   on a playing video. The listeners wire once, lazily, on
   the first play through this handler — the only route that
   can reveal the video at all.
   Round 207 (Emil, same day): the film is DEMOTED below the
   section's CTA — the product photo is the hero now, and
   the button is an understated "▶ See how it works" link
   under the Build your hoodie CTA; tapping it reveals the
   film box (hfHomeFilmBox207) in place and starts the film.
   The button also hides INSTANTLY on tap now: Emil watched
   the R204 button sit there for ~3 seconds after tapping,
   because it waited for the real 'play' event, which lags
   while the video buffers. The tap hides it optimistically;
   the sync (still wired to play/pause/ended) remains the
   authority that restores it — on pause, on ended, and via
   the play() promise's rejection path if playback fails to
   start at all.
   Round 210 (Emil, same day): the film OPENS AS AN OVERLAY
   — "I don't like how the video opens underneath." The
   in-place reveal is retired: the same cover / video pair
   now lives in a centered lightbox (hfHomeFilmOverlay210,
   the Round 128 idiom) and the tap opens THAT and starts
   the film. The instant-hide contract is unchanged (the
   link hides at tap; the sync restores it on pause/ended,
   and a failed start now also closes the overlay, landing
   the visitor back on the restored link). ✕, a backdrop
   tap (the overlay's own inline handler) or Escape closes
   via closeHfHomeFilm210, which pauses the film, restores
   the page scroll and returns focus to the link. */
let hfHomeFilmWired204 = false;
function hfHomeFilmBtnSync204() {
  const btn = $("#hfHomeFilmBtn201"), vid = $("#hfHomeFilm201");
  if (!btn || !vid) return;
  btn.hidden = !(vid.paused || vid.ended);
}
function closeHfHomeFilm210() {
  const ov = $("#hfHomeFilmOverlay210");
  if (!ov || ov.hidden) return;
  const vid = $("#hfHomeFilm201");
  if (vid && typeof vid.pause === "function" && !vid.paused) { try { vid.pause(); } catch (e) { /* fine */ } }
  ov.hidden = true;
  if (typeof document !== "undefined" && document.body && document.body.style) document.body.style.overflow = "";
  const btn = $("#hfHomeFilmBtn201");
  if (btn) { btn.hidden = false; if (typeof btn.focus === "function") { try { btn.focus(); } catch (e) { /* fine */ } } }
}
function playHfHomeFilm201() {
  const cover = $("#hfFilmCoverHome201"), vid = $("#hfHomeFilm201");
  if (!vid) return;
  if (!hfHomeFilmWired204 && typeof vid.addEventListener === "function") {
    hfHomeFilmWired204 = true;
    vid.addEventListener("play", hfHomeFilmBtnSync204);
    vid.addEventListener("pause", hfHomeFilmBtnSync204);
    vid.addEventListener("ended", hfHomeFilmBtnSync204);
  }
  // Round 207: hide the link the moment it is tapped — do
  // NOT wait for the (buffering-lagged) 'play' event.
  // Round 210: and open the film overlay over the page —
  // the section itself no longer grows to hold the film.
  const btn = $("#hfHomeFilmBtn201"); if (btn) btn.hidden = true;
  const ov = $("#hfHomeFilmOverlay210");
  if (ov) {
    if (typeof document !== "undefined" && document.body && ov.parentElement !== document.body) document.body.appendChild(ov);
    ov.hidden = false;
    if (typeof document !== "undefined" && document.body && document.body.style) document.body.style.overflow = "hidden";
    const x = $("#hfHomeFilmClose210"); if (x && typeof x.focus === "function") { try { x.focus(); } catch (e) { /* fine */ } }
  }
  if (cover) cover.hidden = true;
  vid.hidden = false;
  const p = vid.play(); if (p && p.catch) p.catch(() => { closeHfHomeFilm210(); hfHomeFilmBtnSync204(); });
}
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHfHomeFilm210(); });

/* Round 84 (2026-11-09, Emil): warm the store's landing pictures
   in the background once the page settles, so clicking Swag Shop
   shows them instantly instead of popping in one by one. Skips
   the store page itself and data-saver connections. Round 97
   (2026-11-10): home route only — sub-page visits no longer spend
   ~0.8 MB warming a store the visitor may never open. */
(function warmStore84() {
  if ((location.pathname.replace(/\/+$/, "") || "/") !== "/") return;
  if (navigator.connection && navigator.connection.saveData) return;
  const imgs = ["tile-baseball", "tile-basketball", "tile-football", "tile-soccer", "tile-softball", "tile-volleyball"].map((n) => "/swag/hs/" + n + ".jpg")
    .concat(["night-baseball", "night-basketball", "night-football", "night-soccer", "night-softball", "night-volleyball"].map((n) => "/swag/hs/" + n + ".jpg"))
    .concat(["/swag/hs/football-back.jpg"]);
  const warm = () => imgs.forEach((src) => { const i = new Image(); i.src = src; });
  if ("requestIdleCallback" in window) requestIdleCallback(warm, { timeout: 4000 });
  else setTimeout(warm, 2500);
})();

/* Round 85 (2026-11-09, youth tester rerun): once the visitor scrolls
   past the hero, the floating Submit pill collapses to a compact
   round button so it stops parking on top of board tiles mid-browse;
   near the top it keeps its full label ("Post a Play" since the
   Round 123 one-label sweep). The Round 69
   auto-hide near in-page Submit links is unchanged. */
(function fabCompact85() {
  const fab = document.getElementById("floatSubmit");
  if (!fab) return;
  let ticking = false;
  const apply = () => { ticking = false; fab.classList.toggle("fab-compact85", window.scrollY > 520); };
  window.addEventListener("scroll", () => { if (!ticking) { ticking = true; requestAnimationFrame(apply); } }, { passive: true });
  apply();
})();

/* Round 86 (2026-11-09, kid-experience feedback): the "Create a Hype
   Frame" entry points (homepage section + Store feature) open a
   choice card instead of landing on the board. Originally: Sample
   -> the studio with a sample play loaded; Own video -> the upload
   form (which now opens with the parent/guardian banner). The
   Sample start left the card in Round 205 — see the note below.
   Round 202 (2026-11-26, Emil's catch): a parent whose play is
   ALREADY posted had no path from this card — finding the play's
   own card was the only route, and re-uploading the same clip hits
   the same-clip duplicate rule. The card gains a third choice:
   pick a posted play. The picker offers EXACTLY the plays
   openHypeFrame can resolve (ALL_PLAYS, plus any contest entries
   not already in ALL_PLAYS) — the per-play Frame buttons in
   cardHtml, tileHtml and the watch view are unconditional
   (samples, photo plays and link plays all open the studio from
   their own cards), so the picker excludes nothing; sample rows
   keep their ⭐ SAMPLE PLAY tag, as the tiles show it.
   (→231: samples are excluded now — see the Round 231 note
   below.)
   Round 205 (2026-11-26, Emil): the Sample choice LEAVES the
   card — hfChoiceSample is gone and the card offers two starts
   (a posted play, or your own video). Sample plays are
   untouched: they stay on the boards and in the picker, and
   their own cards still open the studio directly.
   Round 231 (2026-11-27, Emil) SUPERSEDES that last part:
   sample plays can't be used in the studio at all — the picker
   excludes them (hfPickerEligible202), the per-play Frame
   buttons are hidden on samples (cardHtml, tileHtml, the
   watch view), openHypeFrame refuses a sample seed by landing
   the visitor on this choice card instead, and the server
   rejects sample-sourced orders. Samples stay on the boards,
   the feed, the watch page and practice battles, unchanged. */
window.openHfChoice = () => { const m = $("#hfChoiceModal"); if (!m) return; if (m.parentElement !== document.body) document.body.appendChild(m); hfPickerReset202(); m.hidden = false; };
window.closeHfChoice = () => { const m = $("#hfChoiceModal"); if (m) m.hidden = true; hfPickerReset202(); };
window.hfChoiceOwn = () => { closeHfChoice(); goSubmit(); };
/* Round 202: the posted-play picker. The two panels swap inside
   the one modal; hfPickerReset202 always lands back on the choice
   panel, so every exit (a pick, the backdrop, Not now, Escape)
   leaves the card ready to reopen on the choices. (Round 205:
   two choices now — the Sample start left the card.) */
function hfPickerReset202() {
  const choice = $("#hfChoicePanel"), picker = $("#hfPickerPanel");
  if (choice) choice.hidden = false;
  if (picker) picker.hidden = true;
}
function hfPickerEligible202() {
  const seen = new Set(), out = [];
  for (const p of [...(ALL_PLAYS || []), ...((CONTEST && CONTEST.entries) || [])]) {
    if (!p || p.id == null || seen.has(p.id)) continue;
    if (p.isSample) continue; // Round 231: samples are out of the studio entirely — never listed
    seen.add(p.id); out.push(p);
  }
  const stamp = (p) => { const t = parsePlayDate(p.created_at); return Number.isFinite(t) ? t : (p.id || 0); };
  return out.sort((a, b) => stamp(b) - stamp(a) || (b.id || 0) - (a.id || 0));
}
function hfPickerPoster202(p) {
  if (p.poster_url) return p.poster_url;
  if (p.media_kind === "file" && (p.mime || "").startsWith("image/") && p.media_url) return p.media_url;
  if (typeof btlPosterFor118 === "function") { try { return btlPosterFor118(p.media_url || "", p.sport || "", p.title || "") || ""; } catch (e) { return ""; } }
  return "";
}
function hfPickerRender202(q) {
  const list = $("#hfPickerList202"), empty = $("#hfPickerEmpty202");
  if (!list) return;
  const eligible = hfPickerEligible202();
  const needle = String(q || "").trim().toLowerCase();
  const hits = needle ? eligible.filter((p) => [p.title, p.player_name, p.athlete_label, p.team, p.sport].join(" ").toLowerCase().includes(needle)) : eligible;
  list.innerHTML = hits.map((p) => {
    const poster = hfPickerPoster202(p);
    const who = [p.athlete_label || p.player_name || "", cap(p.sport), p.team || ""].filter(Boolean).join(" · ");
    return `<button type="button" class="hf-picker-row" onclick="hfPickerPick202(${p.id})">${poster ? `<img class="hf-picker-thumb" src="${esc(poster)}" alt="" loading="lazy">` : `<span class="hf-picker-thumb hf-picker-thumb-none">${esc(cap(p.sport || "Play"))}</span>`}<span class="hf-picker-main"><b>${esc(p.title)}</b><span>${esc(who)}</span></span></button>`;
  }).join("");
  if (empty) {
    if (!eligible.length) { empty.textContent = "No plays are up yet — post yours to get started."; empty.hidden = false; }
    else if (!hits.length) { empty.textContent = "No plays match that search — try a different title, athlete, team or sport."; empty.hidden = false; }
    else empty.hidden = true;
  }
}
window.hfChoicePosted = () => {
  const choice = $("#hfChoicePanel"), picker = $("#hfPickerPanel");
  if (!choice || !picker) return;
  const search = $("#hfPickerSearch202"); if (search) search.value = "";
  hfPickerRender202("");
  choice.hidden = true; picker.hidden = false;
};
window.hfPickerFilter202 = (v) => hfPickerRender202(v);
window.hfPickerBack202 = () => hfPickerReset202();
window.hfPickerPick202 = (id) => { closeHfChoice(); openHypeFrame(id); };
$$("[data-hf-start]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openHfChoice(); }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeHfChoice(); });

/* Round 86 (2026-11-09, Emil): the "All Hypes" menu link and the
   "Watch Highlights" header link point at /?view=all — a full page
   load that lands on the hero, which reads as "it took me back to
   the home page." A tap INSIDE the site means "take me to the
   board": on the homepage it switches in place and scrolls to the
   board; from a sub-page it flags the intent (consumed in loadData)
   so the landing goes to the board. Fresh visits to /?view=all
   carry no flag and still open at the top — Round 82 stands. */
$$('a[href="/?view=all"]').forEach((a) => a.addEventListener("click", (e) => {
  const onHome = (location.pathname.replace(/\/+$/, "") || "/") === "/";
  if (onHome) {
    e.preventDefault(); closeMenu(false); showHome(); showPanel("plays"); switchView("all");
    document.getElementById("plays")?.scrollIntoView({ behavior: "smooth" });
  } else { try { sessionStorage.setItem("hhGotoBoard86", "1"); } catch (err) {} }
}));

/* Round 91 (2026-11-10): Hype Battles — head-to-head voting on the
   board, promoted from the hidden preview page after Emil's and
   Nicholas's tests. Fresh pairs by default; Winner stays keeps a
   champion only against a NEW challenger (never the clip it just
   beat — Emil's catch on the preview). Pairing prefers real
   same-sport Hype of the Month matchups, then same-sport sample
   pairs, then mixed approved pairs. Round 179 (2026-11-14,
   Emil): battle picks are JUST FOR FUN — a pick records the
   battle result and fires a battle_pick stat, and NEVER creates,
   removes, or alters a Hype of the Month contest vote (Rounds
   91–178 coupled a real-pair pick to a real vote, invisibly;
   both testers flagged it as the site's #1 fairness issue).
   Contest votes change only through the explicit Vote buttons.
   Appended at the end of app.js per the sandbox-slice rule; every
   element lookup is guarded. */
const btl = { mode: "fresh", battle: 0, pairIdx: 0, flip: false, cur: { L: null, R: null }, watching: "L", champ: null, streak: 0, lastBeaten: null, picked: false, pairReal: false, built: false, deferMedia111: false };
function btlPairs() {
  const bySport = (list) => { const m = new Map(); list.forEach((p) => { if (!m.has(p.sport)) m.set(p.sport, []); m.get(p.sport).push(p.id); }); return m; };
  const pairsOf = (m) => { const out = []; m.forEach((ids) => { for (let i = 0; i + 1 < ids.length; i += 2) out.push([ids[i], ids[i + 1]]); }); return out; };
  const real = pairsOf(bySport((CONTEST.entries || []).filter((p) => !p.isSample)));
  if (real.length) return { pairs: real, real: true };
  const sample = pairsOf(bySport(ALL_PLAYS.filter((p) => p.isSample)));
  if (sample.length) return { pairs: sample, real: false };
  const ids = ALL_PLAYS.map((p) => p.id);
  const mixed = []; for (let i = 0; i + 1 < ids.length; i += 2) mixed.push([ids[i], ids[i + 1]]);
  return { pairs: mixed, real: false };
}
function btlDealFresh() {
  const { pairs, real } = btlPairs();
  btl.pairReal = real;
  if (!pairs.length) { btl.cur = { L: null, R: null }; return; }
  const pair = pairs[btl.pairIdx % pairs.length];
  const order = btl.flip ? [pair[1], pair[0]] : pair;
  btl.cur = { L: order[0], R: order[1] };
  btl.watching = "L";
}
function btlMiniHTML(slot) {
  const p = findPlay(btl.cur[slot]);
  if (!p) return "";
  const isChamp = btl.mode === "stay" && btl.champ === p.id;
  const showStreak = isChamp && btl.streak >= 2;
  /* Round 102: every mini carries its A/B letter (L = A, R = B,
     matching the Pick A / Pick B buttons); the .watching class
     lights the pale outline — watching no longer borrows the gold
     outline, which is reserved for the pick. Round 104: the mini's
     own Now watching tag is gone — the big player's banner is the
     single watching marker (the testers saw it said twice).
     Round 117: the Quick player's banner is retired too — the
     .watching outline alone marks the clip in the big player.
     Round 179: NO winner crowns (crownsHtml105) on the minis —
     a Quick matchup only ever renders UNPICKED, and pre-crowned
     contenders read as "game already over" (both youth testers).
     Crowns stay on the board, athlete pages and detail cards. */
  const letter = slot === "L" ? "A" : "B";
  return `<article class="btl-mini${showStreak ? " has-streak" : ""}" id="btlMini${slot}" data-slot="${slot}">
    <span class="btl-video-slot111" data-btl-media111 data-url="${esc(p.media_url)}" data-sport="${esc(cap(p.sport))}" data-title="${esc(p.title)}" role="img" aria-label="${esc(p.title)} — clip loading"></span>
    <span class="btl-letter" aria-hidden="true">${letter}</span>
    ${showStreak ? `<span class="btl-streak">${CROWN227} Won ${btl.streak} in a row</span>` : ""}
    <span class="btl-stamp">${CROWN227} WINNER</span>
    <div class="btl-mbody"><p class="btl-mtitle">${esc(p.title)}</p><p class="btl-mmeta">${esc(cap(p.sport))} · ${p.division === "girls" ? "Girls" : "Boys"}${Number(p.viewCount) >= 1 ? ` · ▶ ${fmtCount151(p.viewCount)}` : ""}</p></div>
  </article>`;
}
function btlRenderCount() {
  const el = document.getElementById("btlCount");
  if (el) el.textContent = "Battle " + (btl.battle + 1) + (btl.mode === "stay" && btl.champ ? " · Champion: " + (findPlay(btl.champ) || {}).title + (btl.streak >= 2 ? " · Won " + btl.streak + " in a row" : "") : "");
}
function btlRender() {
  const main = document.getElementById("btlMain");
  const empty = document.getElementById("btlEmpty");
  const note = document.getElementById("btlPoolNote");
  const has = !!(btl.cur.L && btl.cur.R);
  if (main) main.hidden = !has;
  if (empty) empty.hidden = has;
  if (note) note.hidden = !has || btl.pairReal;
  if (!has) return;
  btl.picked = false;
  const matchup = document.getElementById("btlMatchup");
  if (matchup) {
    /* Round 111: retire the outgoing minis' <video> elements into
       the session pool BEFORE the re-render discards them, then let
       the installer fill the new slots — pooled elements keep their
       downloaded data and frozen frame. The very first Battles
       render defers the (below-fold) Quick media so it cannot
       compete with the Daily pair for bandwidth. */
    if (typeof btlRetireMatchup111 === "function") btlRetireMatchup111(matchup);
    matchup.innerHTML = btlMiniHTML("L") + '<div class="btl-vs">VS</div>' + btlMiniHTML("R");
    if (typeof btlInstallMedia111 === "function") btlInstallMedia111(matchup, { eager: !btl.deferMedia111 });
    btl.deferMedia111 = false;
    matchup.querySelectorAll(".btl-mini").forEach((el) => { el.addEventListener("click", () => btlWatch(el.dataset.slot)); });
  }
  const pickL = document.getElementById("btlPickL"), pickR = document.getElementById("btlPickR");
  if (pickL) { pickL.disabled = false; pickL.style.display = ""; pickL.textContent = "Pick A"; }
  if (pickR) { pickR.disabled = false; pickR.style.display = ""; pickR.textContent = "Pick B"; }
  const next = document.getElementById("btlNext"); if (next) next.classList.remove("show");
  const skip = document.getElementById("btlSkip"); if (skip) skip.style.display = "";
  btlRenderCount();
  btlWatch(btl.watching, true);
}
function btlMiniFrame(v) {
  if (!v) return;
  const grab = () => { if (v.currentTime >= 0.55) { v.pause(); v.removeEventListener("timeupdate", grab); } };
  v.addEventListener("timeupdate", grab);
  try { const p = v.play(); if (p && p.catch) p.catch(() => v.removeEventListener("timeupdate", grab)); } catch (e) { v.removeEventListener("timeupdate", grab); }
  setTimeout(() => { if (!v.paused) v.pause(); v.removeEventListener("timeupdate", grab); }, 2600);
}
function btlWatch(slot, keepPaused) {
  btl.watching = slot;
  const p = findPlay(btl.cur[slot]);
  const player = document.getElementById("btlPlayer");
  if (!p || !player) return;
  const miniL = document.getElementById("btlMiniL"), miniR = document.getElementById("btlMiniR");
  if (miniL) miniL.classList.toggle("watching", slot === "L");
  if (miniR) miniR.classList.toggle("watching", slot === "R");
  /* Round 118: note the selection and paint its poster BEFORE any
     load — on Battles open (this keepPaused call) the big player
     must present side A as a loaded, watchable clip (poster up),
     never a black void whose only affordance is a native play
     button over nothing. */
  if (typeof btlSelNote118 === "function") btlSelNote118(player, p);
  if (typeof btlBigPoster118 === "function") btlBigPoster118(player, p);
  /* Round 154: shape the stage for THIS side's clip before it
     loads (poster signal; metadata sync confirms). */
  if (typeof markBtlStage154 === "function") markBtlStage154(player, p);
  /* Round 117: if the element already carries this clip's src but
     sits in a media error state (a failed fetch leaves error set and
     a same-src tap would otherwise change nothing), force a fresh
     load — a tap must always be able to recover the player. */
  if (player.getAttribute("src") !== p.media_url || player.error) { player.src = p.media_url; player.load(); }
  /* Round 119: a black-intro clip (offset map) starts at its
     offset, not on black — the seek lands as soon as metadata
     allows, BEFORE first playback, so the resting frame (this
     keepPaused open state included) is past the black too. */
  if (typeof btlSeekOffset119 === "function") btlSeekOffset119(player);
  /* Round 117: the "Now watching" banner is retired on the Quick
     player — it repeated the mini card's title a second time. The
     tapped mini's gold .watching outline is the marker now. (The
     Daily and Battle Run players keep their banners via d100Watch.) */
  if (!keepPaused) { if (typeof btlPlayBig118 === "function") btlPlayBig118(player, false); else { try { player.play(); } catch { /* autoplay refusal is fine */ } } }
}
function btlNewChallenger() {
  const src = btl.pairReal ? (CONTEST.entries || []).filter((p) => !p.isSample) : ALL_PLAYS;
  const pool = src.map((p) => p.id).filter((id) => id !== btl.champ && id !== btl.lastBeaten);
  if (!pool.length) return null;
  const champPlay = findPlay(btl.champ);
  const same = champPlay ? pool.filter((id) => (findPlay(id) || {}).sport === champPlay.sport) : [];
  const pickFrom = same.length ? same : pool;
  return pickFrom[btl.battle % pickFrom.length];
}
function btlNext() {
  btl.battle++;
  const player = document.getElementById("btlPlayer"); if (player) player.pause();
  if (btl.mode === "fresh") { btl.pairIdx++; btl.flip = !btl.flip; btlDealFresh(); }
  else {
    const challenger = btlNewChallenger();
    if (challenger == null) { btlDealFresh(); }
    else {
      const loserSlot = btl.cur.L === btl.champ ? "R" : "L";
      btl.cur[loserSlot] = challenger;
      btl.watching = loserSlot;
    }
  }
  btlRender();
}
async function btlPick(slot) {
  if (btl.picked || !btl.cur[slot]) return;
  btl.picked = true;
  const winnerId = btl.cur[slot];
  const loserSlot = slot === "L" ? "R" : "L";
  const loserId = btl.cur[loserSlot];
  const player = document.getElementById("btlPlayer"); if (player) player.pause();
  const mini = document.getElementById("btlMini" + slot); if (mini) mini.classList.add("winner");
  const pickL = document.getElementById("btlPickL"), pickR = document.getElementById("btlPickR");
  /* Round 104: in Winner Stays the pick buttons leave with the
     pick — the WINNER stamp, the count line and Next battle carry
     the result (the testers stared at the dim dead pair and the
     "Not this time" wording). Fresh pairs keeps the disabled
     pair exactly as before. */
  if (btl.mode === "stay") {
    if (pickL) pickL.style.display = "none";
    if (pickR) pickR.style.display = "none";
  } else {
    if (pickL) pickL.disabled = true;
    if (pickR) pickR.disabled = true;
    const loserBtn = document.getElementById("btlPick" + loserSlot); if (loserBtn) loserBtn.textContent = "Not this time";
    /* Round 122: the CHOSEN side says so — a still-"Pick B"-looking
       button on the winner read as tappable in the youth test. */
    const chosenBtn = document.getElementById("btlPick" + slot); if (chosenBtn) chosenBtn.textContent = "✓ Your pick";
  }
  const skip = document.getElementById("btlSkip"); if (skip) skip.style.display = "none";
  const next = document.getElementById("btlNext"); if (next) next.classList.add("show");
  trackEvent("battle_pick", winnerId);
  /* Round 179: NO vote here anymore — a Quick Battle pick used
     to post a real contest vote for the winner (when the pair
     was real and the visitor hadn't voted yet), with nothing on
     screen saying so. Decoupled at Emil's direction: battles are
     just for fun; the Vote buttons are the only way a contest
     vote changes. Battle results, percentages, streaks and
     crowns below are untouched. */
  if (btl.mode === "stay") {
    btl.lastBeaten = loserId;
    if (btl.champ === winnerId) btl.streak++; else { btl.champ = winnerId; btl.streak = 1; }
    btlRenderCount();
  }
}
function btlSkip() {
  if (btl.mode === "stay" && btl.champ && !btl.picked) {
    btl.battle++;
    const challengerSlot = btl.cur.L === btl.champ ? "R" : "L";
    btl.lastBeaten = btl.cur[challengerSlot];
    const challenger = btlNewChallenger();
    if (challenger != null) { btl.cur[challengerSlot] = challenger; btl.watching = challengerSlot; btlRender(); return; }
  }
  btlNext();
}
function btlSetMode(m) {
  btl.mode = m; btl.battle = 0; btl.pairIdx = 0; btl.flip = false; btl.champ = null; btl.streak = 0; btl.lastBeaten = null;
  const f = document.getElementById("btlModeFresh"), s = document.getElementById("btlModeStay");
  if (f) f.classList.toggle("on", m === "fresh");
  if (s) s.classList.toggle("on", m === "stay");
  btlDealFresh();
  btlRender();
}
function initBattles() {
  if (!btl.built) { btl.built = true; btl.deferMedia111 = true; btlDealFresh(); }
  btlRender();
}
(function battlesWire91() {
  const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  bind("btlPickL", "click", () => btlPick("L"));
  bind("btlPickR", "click", () => btlPick("R"));
  bind("btlNext", "click", btlNext);
  bind("btlSkip", "click", btlSkip);
  bind("btlModeFresh", "click", () => btlSetMode("fresh"));
  bind("btlModeStay", "click", () => btlSetMode("stay"));
  try {
    if (new URLSearchParams(location.search).get("view") === "battles" && typeof applyDefaultView === "function") {
      // Ride applyDefaultView itself: loadData calls it after the
      // first fetch lands, so switching right after it runs cannot
      // be overridden — no matter when loadData was invoked.
      let btlDeepLink91 = true;
      const origApplyDefault91 = applyDefaultView;
      applyDefaultView = function (...args) {
        const r = origApplyDefault91.apply(this, args);
        if (btlDeepLink91) {
          btlDeepLink91 = false;
          switchView("battles");
          const playsEl = document.getElementById("plays");
          if (playsEl) playsEl.scrollIntoView();
        }
        return r;
      };
    }
  } catch { /* deep link is a nicety, never a breaker */ }
})();

/* Round 94: a ?view=fame link lands on the Month tab's All-time sub-view. */
(function fameLink94() {
  if (new URLSearchParams(location.search).get("view") !== "fame") return;
  if (typeof applyDefaultView !== "function") return;
  const prevAD = applyDefaultView;
  /* Round 232 (2026-11-27): the board's Fame panel is retired —
     ?view=fame lands on the HOMEPAGE leaderboard's Hall of Fame
     tab instead (homeLbLanding232 in the Round 232 block paints
     the tab and scrolls the section into view). The default
     view still runs first, exactly as before. */
  applyDefaultView = function () { prevAD(); if (typeof homeLbLanding232 === "function") homeLbLanding232("fame"); };
})();


/* ---------------- Upload Assist (Round 99, 2026-11-11) ----------------
   When a guardian picks a clip, the browser pulls ~5 frames off it
   (offscreen <video> + <canvas>, at 10/30/50/70/90% of the runtime)
   and asks POST /api/upload-assist for a first pass: sport / division
   / a hype-tone title + story, prefilled as EDITABLE suggestions —
   and a gateway verdict that keeps obvious non-plays (screen
   recordings, random clips) out of the owner queue. A confident
   "not_a_play" holds the submit inline, ALWAYS with an override that
   files the play for owner review anyway — never a dead end. If the
   assist is unconfigured, slow, or fails, the form behaves exactly as
   it did before this round: nothing here is required, the guardian
   consent and required fields are untouched, and every play still
   starts pending for a human owner decision. Emil's addition: the
   same pass doubles as the garbage gateway. */
(function () {
  const form = document.getElementById("uploadForm");
  const input = document.getElementById("fileInput");
  const wrap = document.getElementById("aiAssist");
  const note = document.getElementById("aiAssistNote");
  const gateBox = document.getElementById("aiGateBox");
  const gateReason = document.getElementById("aiGateReason");
  const overrideBtn = document.getElementById("aiGateOverride");
  const aiField = document.getElementById("aiField");
  if (!form || !input || !wrap || !note || !gateBox || !aiField) return;
  const state = { fileKey: "", result: null, blocked: false, override: false, sportTouched: false, divTouched: false };
  const fileKeyOf = (f) => (f ? f.name + "|" + f.size + "|" + f.lastModified : "");
  const currentKey = () => fileKeyOf(input.files && input.files[0]);

  if (form.elements.sport) form.elements.sport.addEventListener("change", () => { state.sportTouched = true; });
  document.querySelectorAll("[data-div-pick]").forEach((b) => b.addEventListener("click", () => { state.divTouched = true; }));

  function showNote(text) { wrap.hidden = false; note.hidden = !text; note.textContent = text || ""; }
  function hideAll() { wrap.hidden = true; gateBox.hidden = true; note.textContent = ""; }
  function reset() {
    state.result = null; state.blocked = false; state.override = false;
    state.sportTouched = false; state.divTouched = false;
    aiField.value = ""; hideAll();
  }

  // Snapshot one still from a picked PHOTO (downscaled the same way).
  function grabImageFrame(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, 512 / (img.naturalWidth || 512));
          const c = document.createElement("canvas");
          c.width = Math.max(2, Math.round((img.naturalWidth || 512) * scale));
          c.height = Math.max(2, Math.round((img.naturalHeight || 288) * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve([c.toDataURL("image/jpeg", 0.8)]);
        } catch { resolve([]); }
        URL.revokeObjectURL(url);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve([]); };
      img.src = url;
    });
  }

  // Pull ~5 frames off a picked VIDEO. Any failure resolves with
  // whatever frames we got (possibly none) — the assist just skips.
  function grabFrames(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.muted = true; v.playsInline = true; v.preload = "auto"; v.src = url;
      const frames = [];
      let finished = false;
      const done = () => { if (finished) return; finished = true; try { URL.revokeObjectURL(url); } catch {} resolve(frames); };
      setTimeout(done, 12000);
      v.addEventListener("error", done, { once: true });
      v.addEventListener("loadedmetadata", () => {
        const dur = v.duration;
        if (!dur || !isFinite(dur) || !(v.videoWidth > 0)) return done();
        const canvas = document.createElement("canvas");
        const scale = Math.min(1, 512 / v.videoWidth);
        canvas.width = Math.max(2, Math.round(v.videoWidth * scale));
        canvas.height = Math.max(2, Math.round(v.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        const stops = [0.1, 0.3, 0.5, 0.7, 0.9].map((f) => Math.min(dur - 0.05, Math.max(0.05, dur * f)));
        let i = 0;
        const step = () => {
          if (finished) return;
          if (i >= stops.length) return done();
          const t = stops[i++];
          let advanced = false;
          const advance = () => {
            if (advanced || finished) return;
            advanced = true;
            if (v.readyState >= 2) {
              try { ctx.drawImage(v, 0, 0, canvas.width, canvas.height); const d = canvas.toDataURL("image/jpeg", 0.72); if (d && d.length > 200) frames.push(d); } catch {}
            }
            step();
          };
          v.addEventListener("seeked", advance, { once: true });
          setTimeout(advance, 3000);
          try { v.currentTime = t; } catch { advance(); }
        };
        step();
      }, { once: true });
    });
  }

  function applyResult(res) {
    state.result = res;
    aiField.value = JSON.stringify(res);
    // Prefill as a first pass the guardian checks — never stomp a
    // field the guardian already filled in or picked themselves.
    if (res.sport && !state.sportTouched && !String(form.elements.sport.value || "").trim()) setSportPick(res.sport);
    if (res.division && !state.divTouched) setDivPick(res.division);
    if (res.title && form.elements.title && !String(form.elements.title.value || "").trim()) form.elements.title.value = res.title;
    if (res.story && form.elements.story && !String(form.elements.story.value || "").trim()) form.elements.story.value = res.story;
    const bits = [res.sport, res.division].filter(Boolean).join(" · ");
    if (res.gate === "not_a_play" && Number(res.confidence) >= 0.85) {
      state.blocked = true;
      gateReason.textContent = res.reason || "";
      gateBox.hidden = false;
      showNote("🤖 AI suggestion — check it" + (bits ? ": " + bits : ""));
    } else {
      showNote("🤖 AI suggestion — check it" + (bits ? ": " + bits : "") + ". You can change anything before posting.");
    }
  }

  async function analyze(file) {
    reset();
    state.fileKey = fileKeyOf(file);
    showNote("🔎 Reading your play…");
    let frames = [];
    try { frames = (file.type || "").startsWith("image/") ? await grabImageFrame(file) : await grabFrames(file); } catch { frames = []; }
    if (state.fileKey !== currentKey()) return; // a different file was picked mid-flight
    if (!frames.length) { hideAll(); return; }
    try {
      const r = await fetch("/api/upload-assist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ frames }) });
      const j = await r.json();
      if (state.fileKey !== currentKey()) return;
      if (!j || !j.configured || !j.result) { hideAll(); return; } // unconfigured or failed: form exactly as before
      applyResult(j.result);
    } catch { if (state.fileKey === currentKey()) hideAll(); }
  }

  // The submit handler's gate hook (defined here so the handler can
  // guard on its existence): true = let the submit through.
  window.__uaGateCheck = function (f) {
    if (!state.blocked || state.override) return true;
    const file = f && f.elements && f.elements.file && f.elements.file.files && f.elements.file.files[0];
    if (!file || fileKeyOf(file) !== state.fileKey) return true;
    wrap.hidden = false;
    gateBox.hidden = false;
    gateBox.scrollIntoView({ behavior: "smooth", block: "center" });
    const msg = document.getElementById("uploadMsg");
    if (msg) msg.textContent = "Our helper doesn't think this is a sports play — check the note above, or send it for owner review anyway.";
    return false;
  };

  if (overrideBtn) overrideBtn.addEventListener("click", () => {
    state.override = true;
    state.blocked = false;
    try { aiField.value = JSON.stringify(state.result ? Object.assign({}, state.result, { gate: "override" }) : { gate: "override" }); } catch {}
    gateBox.hidden = true;
    showNote("Got it — sending it for owner review anyway. 🤖");
    form.requestSubmit();
  });

  input.addEventListener("change", () => {
    const f = input.files && input.files[0];
    if (f) analyze(f); else reset();
  });
})();

/* ---------------- Round 100 (2026-11-11): Daily Battle, Battle Run,
   Hawks Founding Plays, owner Daily setter ----------------
   Daily Battle: ONE matchup per ET day (the same one the day's
   TikTok / Instagram "Which Play Wins?" post points at, deep link
   /?view=battles&daily=1). The split is hidden until you pick; the
   pick is locked server-side (one per voter per day). Round 179:
   a pick — real or practice — casts NOTHING; battles are just
   for fun and never touch contest votes (the Round 100–178
   server-side vote coupling is removed).
   Battle Run: predict the crowd winner across five FINALIZED real
   Daily Battles you didn't play live; the end screen generates the
   share card (story 1080x1920 + feed 1080x1350) for Instagram /
   TikTok. Appended at the end of app.js per the sandbox-slice rule;
   every lookup is guarded. */
const d100 = { daily: null, dailyWatch: "A", dailyCollapsed: false, dailyJustPicked: false, dailyCollapseTimer: null, run: null, runState: null, scrollDaily: false };
try { d100.scrollDaily = new URLSearchParams(location.search).get("daily") === "1"; } catch { /* no deep link */ }
function etTodayClient100() {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t) => (parts.find((x) => x.type === t) || {}).value || "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}
function d100MiniHTML(prefix, slot, p, opts) {
  if (!p) return "";
  /* Round 102: A/B letter chip (slot IS the letter here) and a
     Your pick tag that only the Daily card's .picked class
     reveals. Round 104: no Now watching tag on the mini — the big
     player's banner is the single watching marker.
     Round 179: winner crowns (crownsHtml105) render only when the
     caller passes opts.crowns — an UNPICKED matchup wears none,
     so the game never looks already decided (both youth testers
     flagged the pre-crowned contenders). The Daily passes its
     picked state (crowns return in the result state); Battle Run
     passes false (its matchup is a guess until picked, and a
     crown would leak the historical winner). */
  const crowns179 = opts && opts.crowns && typeof crownsHtml105 === "function" ? crownsHtml105(p) : "";
  /* Round 226: the Daily card's previews are large — their
     still is the play's own poster image. The slot carries it
     (poster226) and the media install applies it to the pooled
     video, ahead of any banked-frame upgrade. */
  const poster226 = opts && opts.poster226 ? ` data-poster226="${esc(p.poster_url || "")}"` : "";
  return `<article class="btl-mini" id="${prefix}Mini${slot}" data-slot="${slot}">
    <span class="btl-video-slot111" data-btl-media111 data-url="${esc(p.media_url)}" data-sport="${esc(cap(p.sport))}" data-title="${esc(p.title)}"${poster226} role="img" aria-label="${esc(p.title)} — clip loading"></span>
    <span class="btl-letter" aria-hidden="true">${slot}</span>
    <span class="btl-stamp">${CROWN227} WINNER</span>
    <span class="btl-yourpick">${CROWN227} Your pick</span>
    <div class="btl-mbody"><p class="btl-mtitle">${esc(p.title)}</p><p class="btl-mmeta">${esc(cap(p.sport))} · ${p.division === "girls" ? "Girls" : "Boys"}${Number(p.viewCount) >= 1 ? ` · ▶ ${fmtCount151(p.viewCount)}` : ""}</p>${typeof badgesHtml100 === "function" ? badgesHtml100(p) : ""}${crowns179}</div>
  </article>`;
}
function d100Watch(prefix, slot, play) {
  const player = document.getElementById(prefix + "Player");
  if (!player || !play) return;
  const mA = document.getElementById(prefix + "MiniA"), mB = document.getElementById(prefix + "MiniB");
  if (mA) mA.classList.toggle("watching", slot === "A");
  if (mB) mB.classList.toggle("watching", slot === "B");
  /* Round 118: selection note + poster, same as the Quick player —
     the Daily / Battle Run big players never sit black either, and
     a stale error state now forces a reload here too (the Round 117
     btlWatch rule, extended). */
  if (typeof btlSelNote118 === "function") btlSelNote118(player, play);
  if (typeof btlBigPoster118 === "function") btlBigPoster118(player, play);
  /* Round 154: same per-side adaptive stage as the Quick
     player (Daily Battle + Battle Run share this watch). */
  if (typeof markBtlStage154 === "function") markBtlStage154(player, play);
  if (player.getAttribute("src") !== play.media_url || player.error) { player.src = play.media_url; player.load(); }
  /* Round 119: same black-intro offset seek as btlWatch. */
  if (typeof btlSeekOffset119 === "function") btlSeekOffset119(player);
  const label = document.getElementById(prefix + "NowLabel");
  /* Round 179: the watching label's crown suffix follows the
     same rule as the minis — it names a contender's crown only
     once the matchup is picked (Daily, after your pick); on an
     unpicked matchup (and always in Battle Run) it stays off. */
  const crownOk179 = prefix === "daily" && typeof d100 !== "undefined" && d100.daily && !!d100.daily.yourPick;
  if (label) label.textContent = "Now watching: " + play.title + (crownOk179 && typeof crownSuffix105 === "function" ? crownSuffix105(play) : "");
  if (typeof btlPlayBig118 === "function") btlPlayBig118(player, false); else { try { player.play(); } catch { /* autoplay refusal is fine */ } }
}
function d100WireMatchup(prefix, plays, onWatch, opts) {
  const matchup = document.getElementById(prefix + "Matchup");
  if (!matchup) return;
  /* Round 111: same pooled-media path as the Quick Battles render
     (Daily + Battle Run media is always eager — it is either the
     top card or a run the visitor just started). */
  if (typeof btlRetireMatchup111 === "function") btlRetireMatchup111(matchup);
  matchup.innerHTML = d100MiniHTML(prefix, "A", plays.A, opts) + '<div class="btl-vs">VS</div>' + d100MiniHTML(prefix, "B", plays.B, opts);
  if (typeof btlInstallMedia111 === "function") btlInstallMedia111(matchup, { eager: true, poster226: !!(opts && opts.poster226) });
  matchup.querySelectorAll(".btl-mini").forEach((el) => {
    el.addEventListener("click", () => onWatch(el.dataset.slot));
  });
}
function splitHtml100(split, a, b, yourPickId, practice) {
  /* Round 102: a lone pick gets a sentence, not a 100% bar — one
     pick shouldn't carry the weight of a landslide. */
  if (split && split.total === 1) {
    const only = split.aPct >= 100 ? a : b;
    return `<p class="split-line">1 ${practice ? "practice " : ""}pick for <b>${esc(only.title)}</b>.</p>`;
  }
  const yours = yourPickId ? (yourPickId === a.id ? a : b) : null;
  return `<div class="split-bar"><span class="split-a" style="width:${split.aPct}%"></span></div>
  <p class="split-line"><b>${split.aPct}%</b> ${esc(a.title)} · <b>${split.bPct}%</b> ${esc(b.title)} — ${split.total} pick${split.total === 1 ? "" : "s"}${yours ? ` · Your pick: <b>${esc(yours.title)}</b>` : ""}</p>`;
}

/* ---- Daily Battle ---- */
function pauseDailyPlayer100() {
  const player = document.getElementById("dailyPlayer");
  if (!player) return;
  try { player.pause(); } catch { /* an unloaded player is already stopped */ }
}
function setDailyCollapsed100(collapsed) {
  const main = document.getElementById("dailyMain"), strip = document.getElementById("dailyStrip");
  if (!main || !strip) return;
  d100.dailyCollapsed = !!collapsed;
  if (collapsed) pauseDailyPlayer100();
  main.hidden = !!collapsed;
  strip.hidden = !collapsed;
  strip.setAttribute("aria-expanded", collapsed ? "false" : "true");
  /* Round 112: the collapsed state now folds the WHOLE card — the
     slim class hides the header stack + the strip's button row via
     CSS (styles.css Round 112 block); DOM and handlers unchanged. */
  const card = document.getElementById("dailyCard");
  if (card) card.classList.toggle("daily-slim112", !!collapsed);
}
function expandDaily100() {
  const r = d100.daily;
  if (!r || !r.available || !r.yourPick) return;
  if (d100.dailyCollapseTimer) { clearTimeout(d100.dailyCollapseTimer); d100.dailyCollapseTimer = null; }
  setDailyCollapsed100(false);
  const slot = d100.dailyWatch === "B" ? "B" : "A";
  d100Watch("daily", slot, slot === "A" ? r.a : r.b);
}
async function loadDaily100() {
  const card = document.getElementById("dailyCard");
  if (!card) return;
  let r = null;
  try { r = await api(`/api/daily-battle?voterToken=${encodeURIComponent(voterToken)}`); } catch { /* card shows its empty state */ }
  d100.daily = r;
  const main = document.getElementById("dailyMain"), empty = document.getElementById("dailyEmpty");
  const practice = document.getElementById("dailyPractice"), dateEl = document.getElementById("dailyDate");
  const strip = document.getElementById("dailyStrip"), stripPick = document.getElementById("dailyStripPick"), stripSplit = document.getElementById("dailyStripSplit");
  if (!r || !r.available) { d100.dailyCollapsed = false; if (card) card.classList.remove("daily-slim112"); if (main) main.hidden = true; if (strip) strip.hidden = true; if (empty) empty.hidden = false; if (practice) practice.hidden = true; if (typeof renderHome230 === "function") renderHome230(); return; }
  if (empty) empty.hidden = true;
  if (main) main.hidden = false;
  if (strip) strip.hidden = true;
  if (practice) practice.hidden = !r.practice;
  if (dateEl) dateEl.textContent = r.date;
  /* Round 179: crowns ride the minis only once the visitor has
     picked (the result state) — never on the unpicked matchup. */
  d100WireMatchup("daily", { A: r.a, B: r.b }, (slot) => { d100.dailyWatch = slot; d100Watch("daily", slot, slot === "A" ? r.a : r.b); }, { crowns: !!r.yourPick, poster226: true });
  const pickA = document.getElementById("dailyPickA"), pickB = document.getElementById("dailyPickB");
  const split = document.getElementById("dailySplit");
  const anotherRow = document.getElementById("dailyAnotherRow");
  if (r.yourPick) {
    if (pickA) { pickA.disabled = true; if (r.yourPick === r.a.id) pickA.innerHTML = `${CROWN227} Your pick`; else pickA.textContent = "Vote A"; }
    if (pickB) { pickB.disabled = true; if (r.yourPick === r.b.id) pickB.innerHTML = `${CROWN227} Your pick`; else pickB.textContent = "Vote B"; }
    const pickedMini = document.getElementById("dailyMini" + (r.yourPick === r.a.id ? "A" : "B"));
    if (pickedMini) pickedMini.classList.add("picked");
    if (split && r.split) { split.innerHTML = splitHtml100(r.split, r.a, r.b, r.yourPick, r.practice); split.hidden = false; }
    if (anotherRow) anotherRow.hidden = false;
    const pickedPlay = r.yourPick === r.a.id ? r.a : r.b;
    if (stripPick) stripPick.textContent = pickedPlay.title;
    if (stripSplit && r.split) stripSplit.innerHTML = splitHtml100(r.split, r.a, r.b, null, r.practice);
    setDailyCollapsed100(!d100.dailyJustPicked);
  } else {
    d100.dailyCollapsed = false;
    if (card) card.classList.remove("daily-slim112");
    if (pickA) { pickA.disabled = false; pickA.textContent = "Vote A"; }
    if (pickB) { pickB.disabled = false; pickB.textContent = "Vote B"; }
    if (anotherRow) anotherRow.hidden = true;
    if (split) { split.hidden = true; split.innerHTML = ""; }
    if (stripPick) stripPick.textContent = "";
    if (stripSplit) stripSplit.innerHTML = "";
    if (strip) strip.hidden = true;
  }
  const player = document.getElementById("dailyPlayer");
  if (!d100.dailyCollapsed && player) {
    if (!player.getAttribute("src")) d100Watch("daily", "A", r.a);
    else {
      /* Round 102: the matchup re-render wipes the .watching class —
         restore the tag/label for the loaded play without touching
         playback (the gold outline still belongs to the pick). */
      const wSlot = d100.dailyWatch === "B" ? "B" : "A";
      const wmA = document.getElementById("dailyMiniA"), wmB = document.getElementById("dailyMiniB");
      if (wmA) wmA.classList.toggle("watching", wSlot === "A");
      if (wmB) wmB.classList.toggle("watching", wSlot === "B");
      const wLabel = document.getElementById("dailyNowLabel");
      if (wLabel) { const wp = wSlot === "A" ? r.a : r.b; wLabel.textContent = "Now watching: " + wp.title + (r.yourPick && typeof crownSuffix105 === "function" ? crownSuffix105(wp) : ""); }
    }
  }
  if (d100.scrollDaily) {
    d100.scrollDaily = false;
    card.classList.add("daily-flash");
    setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  }
  /* Round 230: the homepage battle card renders from this same
     state — every loadDaily100 completion re-renders the home
     sections (the battle card, and More Highlights' exclusion
     set, which depends on the pair). */
  if (typeof renderHome230 === "function") renderHome230();
}
async function dailyPick100(slot) {
  const r = d100.daily;
  if (!r || !r.available || r.yourPick) return;
  const pickId = slot === "A" ? r.a.id : r.b.id;
  const pickA = document.getElementById("dailyPickA"), pickB = document.getElementById("dailyPickB");
  if (pickA) pickA.disabled = true;
  if (pickB) pickB.disabled = true;
  try {
    const out = await api("/api/daily-battle/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken, pickId }) });
    d100.daily = out;
    d100.dailyJustPicked = true;
    await loadDaily100();
    d100.dailyJustPicked = false;
    if (d100.dailyCollapseTimer) clearTimeout(d100.dailyCollapseTimer);
    d100.dailyCollapseTimer = setTimeout(() => {
      d100.dailyCollapseTimer = null;
      if (d100.daily && d100.daily.yourPick) setDailyCollapsed100(true);
    }, 1600);
    if (!r.practice) { try { await loadData(); } catch { /* board refresh is a bonus */ } }
  } catch {
    if (pickA) pickA.disabled = false;
    if (pickB) pickB.disabled = false;
  }
}
async function dailyShare100() {
  const url = "https://highlighthype.com/?view=battles&daily=1";
  const text = "Which Play Wins? Vote in today's Daily Battle 👑";
  if (navigator.share) { try { await navigator.share({ title: "HighlightHype Daily Battle", text, url }); return; } catch { /* fall through to copy */ } }
  await copyText100(`${text} ${url}`);
  document.querySelectorAll("#dailyShare,#dailyStripShare").forEach((btn) => { const old = btn.textContent; btn.textContent = "Link copied ✓"; setTimeout(() => { btn.textContent = old; }, 2200); });
}

/* ---- Hawks Founding Plays ----
   Round 108 (2026-11-12, Emil): the public card and its renderer
   are removed with the homepage section. The /api/highlights
   payload still carries hawksFounding (owner/API data) — nothing
   on the public surface renders it now. */

/* ---- Battle Run ---- */
async function loadRun100() {
  const locked = document.getElementById("runLocked");
  const startRow = document.getElementById("runStartRow");
  if (!locked) return;
  if (d100.runState) return; // a run in progress is never re-dealt by a view switch
  let r = null;
  try { r = await api(`/api/battle-run?voterToken=${encodeURIComponent(voterToken)}`); } catch { /* locked text below */ }
  d100.run = r;
  if (!r || !r.available) {
    const n = r && typeof r.finalizedCount === "number" ? r.finalizedCount : 0;
    locked.textContent = `${n} of 5 finalized matchups ready — Battle Run unlocks at 5. Daily Battles finish one per day, so check back as the board fills in.`;
    locked.hidden = false;
    if (startRow) startRow.hidden = true;
    return;
  }
  locked.textContent = "Five finished Daily Battles. Pick who the crowd picked — the result stays hidden until you choose.";
  locked.hidden = false;
  if (startRow) startRow.hidden = false;
}
function runStart100() {
  if (!d100.run || !d100.run.available) return;
  d100.runState = { matchups: d100.run.matchups, idx: 0, score: 0, picked: false, completed: false };
  const locked = document.getElementById("runLocked"); if (locked) locked.hidden = true;
  const startRow = document.getElementById("runStartRow"); if (startRow) startRow.hidden = true;
  const end = document.getElementById("runEnd"); if (end) end.hidden = true;
  const main = document.getElementById("runMain"); if (main) main.hidden = false;
  runRender100();
}
function runRender100() {
  const st = d100.runState;
  if (!st) return;
  const m = st.matchups[st.idx];
  st.picked = false;
  const step = document.getElementById("runStep");
  if (step) step.textContent = `Matchup ${st.idx + 1} of ${st.matchups.length} · ${m.date} — who won the crowd?`;
  /* Round 179: no crowns on a Run matchup — it is unpicked by
     design, and a crown chip would leak the historical winner. */
  d100WireMatchup("run", { A: m.a, B: m.b }, (slot) => d100Watch("run", slot, slot === "A" ? m.a : m.b), { crowns: false });
  const pA = document.getElementById("runPickA"), pB = document.getElementById("runPickB");
  if (pA) { pA.disabled = false; pA.innerHTML = `${CROWN227} This one won`; }
  if (pB) { pB.disabled = false; pB.innerHTML = `${CROWN227} This one won`; }
  const reveal = document.getElementById("runReveal"); if (reveal) { reveal.hidden = true; reveal.innerHTML = ""; }
  const next = document.getElementById("runNext"); if (next) next.classList.remove("show");
  const player = document.getElementById("runPlayer");
  if (player) { player.removeAttribute("src"); player.load(); d100Watch("run", "A", m.a); }
}
async function runPick100(slot) {
  const st = d100.runState;
  if (!st || st.picked) return;
  st.picked = true;
  const m = st.matchups[st.idx];
  const pickId = slot === "A" ? m.a.id : m.b.id;
  const pA = document.getElementById("runPickA"), pB = document.getElementById("runPickB");
  if (pA) pA.disabled = true;
  if (pB) pB.disabled = true;
  /* Round 122: same chosen-state label as Quick Battles. */
  const chosenRun = document.getElementById(slot === "A" ? "runPickA" : "runPickB"); if (chosenRun) chosenRun.textContent = "✓ Your pick";
  trackEvent("battle_run_pick", m.dailyId);
  let out = null;
  try { out = await api("/api/battle-run/pick", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dailyId: m.dailyId, pickId }) }); } catch { /* reveal stays hidden */ }
  if (!out || !out.ok) return;
  if (out.correct) st.score++;
  const winnerSlot = out.winnerId === m.a.id ? "A" : "B";
  const winnerMini = document.getElementById("runMini" + winnerSlot);
  if (winnerMini) winnerMini.classList.add("winner");
  const reveal = document.getElementById("runReveal");
  if (reveal) {
    reveal.innerHTML = `<p class="split-line">${out.correct ? "<b>✓ Matched the crowd</b>" : "<b>Crowd went the other way</b>"} — final split: <b>${out.split.aPct}%</b> ${esc(out.titles.a)} · <b>${out.split.bPct}%</b> ${esc(out.titles.b)}</p>`;
    reveal.hidden = false;
  }
  const next = document.getElementById("runNext");
  if (next) { next.textContent = st.idx + 1 >= st.matchups.length ? "See my score →" : "Next matchup →"; next.classList.add("show"); }
}
function runNext100() {
  const st = d100.runState;
  if (!st || !st.picked) return;
  st.idx++;
  if (st.idx < st.matchups.length) { runRender100(); return; }
  // End screen.
  st.completed = true;
  const main = document.getElementById("runMain"); if (main) main.hidden = true;
  const end = document.getElementById("runEnd"); if (end) end.hidden = false;
  const score = document.getElementById("runScore");
  if (score) score.textContent = `You matched the crowd ${st.score}/5`;
  trackEvent("battle_run_complete", String(st.score));
}
function runCaptions100() {
  const score = d100.runState ? d100.runState.score : 0;
  const link = "https://highlighthype.com/?view=battles&daily=1";
  return {
    tiktok: `I matched the crowd ${score}/5 in the HighlightHype Battle Run 👑 Think you can go 5/5? Play today's Daily Battle: ${link} #YouthSports #WhichPlayWins #HighlightHype #TravelBall #SportsTikTok`,
    insta: `I matched the crowd ${score}/5 in the HighlightHype Battle Run 👑 Think you know the crowd? Play today's Daily Battle — link in bio. @HighlightHype_Official ${link} #YouthSports #WhichPlayWins #HighlightHype #TravelBall #YouthBaseball`,
  };
}
async function copyText100(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
function runMsg100(msg) { const el = document.getElementById("runShareMsg"); if (el) el.textContent = msg; }
function loadImg100(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
async function drawRunCard100(w, h, score) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const x = c.getContext("2d");
  x.fillStyle = "#0a0a0a"; x.fillRect(0, 0, w, h);
  const lw = Math.max(6, Math.round(w * 0.012));
  x.strokeStyle = "#f0b93e"; x.lineWidth = lw;
  x.strokeRect(lw, lw, w - 2 * lw, h - 2 * lw);
  // Layout runs off a cursor anchored to the DRAWN logo height: the
  // lockup is a tall crest + wordmark image, so fixed fractions of h
  // overlapped it (first rig pass). Logo height is capped at 26% of
  // the card so the tighter 4:5 feed size keeps the same stack.
  let y = h * 0.045;
  try {
    const img = await loadImg100("/logo-crest-lockup.png");
    const aspect = img.height / img.width;
    const iw = Math.min(w * 0.56, (h * 0.26) / aspect);
    const ih = iw * aspect;
    x.drawImage(img, (w - iw) / 2, y, iw, ih);
    y += ih;
  } catch { y += w * 0.18; /* the card still reads fine without the crest */ }
  x.textAlign = "center";
  x.fillStyle = "#f5f1e6";
  x.font = `900 ${Math.round(w * 0.088)}px system-ui, -apple-system, sans-serif`;
  y += w * 0.115;
  x.fillText("I MATCHED", w / 2, y);
  y += w * 0.105;
  x.fillText("THE CROWD", w / 2, y);
  x.fillStyle = "#f0b93e";
  x.font = `900 ${Math.round(w * 0.30)}px system-ui, -apple-system, sans-serif`;
  y += w * 0.265;
  x.fillText(`${score}/5`, w / 2, y);
  x.font = `800 ${Math.round(w * 0.042)}px system-ui, -apple-system, sans-serif`;
  y += w * 0.125;
  x.fillText("BATTLE RUN · HIGHLIGHTHYPE", w / 2, y);
  x.fillStyle = "#e8e2d2";
  x.font = `700 ${Math.round(w * 0.036)}px system-ui, -apple-system, sans-serif`;
  y += w * 0.062;
  x.fillText("YOUR MOMENT. YOUR HYPE.", w / 2, y);
  x.fillStyle = "#9a937f";
  x.font = `600 ${Math.round(w * 0.030)}px system-ui, -apple-system, sans-serif`;
  const dateStr = new Date().toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });
  x.fillText(dateStr, w / 2, h * 0.895);
  x.fillText("highlighthype.com", w / 2, h * 0.895 + w * 0.045);
  return c;
}
async function shareRunCard100() {
  const score = d100.runState ? d100.runState.score : 0;
  const canvas = await drawRunCard100(1080, 1920, score);
  const done = (ok) => runMsg100(ok ? "Card ready — post it anywhere." : "");
  if (canvas.toBlob) {
    canvas.toBlob(async (blob) => {
      if (blob) {
        const file = new File([blob], "highlighthype-battle-run.png", { type: "image/png" });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: "HighlightHype Battle Run", text: `I matched the crowd ${score}/5 👑` }); runMsg100("Shared ✓"); return; } catch { /* fall through to download */ }
        }
        const a = document.createElement("a");
        a.download = "highlighthype-battle-run-story.png";
        a.href = URL.createObjectURL(blob);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        done(true);
        return;
      }
      done(false);
    }, "image/png");
  }
}
async function downloadRunCard100(w, h, name) {
  const score = d100.runState ? d100.runState.score : 0;
  const canvas = await drawRunCard100(w, h, score);
  const a = document.createElement("a");
  a.download = name;
  a.href = canvas.toDataURL("image/png");
  a.click();
  runMsg100("Card downloaded ✓");
}

/* ---- Owner Daily Battle setter ---- */
function buildOwnerDaily100(queue) {
  const selA = document.getElementById("odPlayA"), selB = document.getElementById("odPlayB");
  if (!selA || !selB) return;
  const approved = (queue || []).filter((h) => h.status === "approved");
  const opts = approved.map((h) => `<option value="${h.id}">${esc(h.title)} — ${esc(cap(h.sport))}${h.isSample ? " (sample)" : ""}</option>`).join("");
  selA.innerHTML = opts;
  selB.innerHTML = opts;
  if (approved.length > 1) selB.selectedIndex = 1;
  const dateInp = document.getElementById("odDate");
  if (dateInp && !dateInp.value) dateInp.value = etTodayClient100();
  showTodayDaily100();
}
async function showTodayDaily100() {
  const el = document.getElementById("odCurrent");
  if (!el) return;
  try {
    const r = await api("/api/daily-battle");
    el.textContent = r && r.available ? `Today (${r.date}): ${r.a.title} vs ${r.b.title}${r.practice ? " — practice" : ""}` : "No matchup for today yet.";
  } catch { el.textContent = ""; }
}
async function ownerDailySave100() {
  const msg = document.getElementById("odMsg");
  const date = (document.getElementById("odDate") || {}).value || etTodayClient100();
  const playAId = Number((document.getElementById("odPlayA") || {}).value);
  const playBId = Number((document.getElementById("odPlayB") || {}).value);
  if (!playAId || !playBId) { if (msg) msg.textContent = "Pick two approved plays first."; return; }
  if (msg) msg.textContent = "Saving…";
  try {
    const r = await api("/api/owner/daily-battle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date, playAId, playBId }) });
    if (msg) msg.textContent = `Saved ✓ ${r.date}: ${r.a.title} vs ${r.b.title}${r.practice ? " (practice)" : ""}`;
    showTodayDaily100();
    loadDaily100();
  } catch (e) { if (msg) msg.textContent = e.message; }
}

/* Wiring: ride initBattles (called by switchView whenever Battles
   opens) the same way Round 91 rides applyDefaultView. */
(function round100Wire() {
  const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  bind("dailyPickA", "click", () => dailyPick100("A"));
  bind("dailyPickB", "click", () => dailyPick100("B"));
  bind("dailyShare", "click", dailyShare100);
  bind("dailyStripShare", "click", dailyShare100);
  const dailyStrip = document.getElementById("dailyStrip");
  if (dailyStrip) {
    dailyStrip.addEventListener("click", (e) => { if (!e.target.closest("button")) expandDaily100(); });
    dailyStrip.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); expandDaily100(); } });
  }
  bind("runStart", "click", runStart100);
  bind("runPickA", "click", () => runPick100("A"));
  bind("runPickB", "click", () => runPick100("B"));
  bind("runNext", "click", runNext100);
  bind("runShareBtn", "click", shareRunCard100);
  bind("runDlStory", "click", () => downloadRunCard100(1080, 1920, "highlighthype-battle-run-story.png"));
  bind("runDlFeed", "click", () => downloadRunCard100(1080, 1350, "highlighthype-battle-run-feed.png"));
  bind("runCopyTiktok", "click", async () => { runMsg100((await copyText100(runCaptions100().tiktok)) ? "TikTok caption copied ✓" : "Copy failed — long-press to copy from a screenshot instead."); });
  bind("runCopyInsta", "click", async () => { runMsg100((await copyText100(runCaptions100().insta)) ? "Instagram caption copied ✓" : "Copy failed — long-press to copy from a screenshot instead."); });
  bind("runAgain", "click", () => { d100.runState = null; const end = document.getElementById("runEnd"); if (end) end.hidden = true; loadRun100().then(() => runStart100()); });
  bind("odSave", "click", ownerDailySave100);
  if (typeof initBattles === "function") {
    const origInit100 = initBattles;
    initBattles = function (...args) {
      const r = origInit100.apply(this, args);
      loadDaily100();
      loadRun100();
      return r;
    };
  }
})();

/* ---------------- Round 102 (2026-11-11): Battles clarity —
   A/B identity, one practice label, the path to the next battle.
   The A/B chips, watching tags and Pick A / Pick B labels live in
   the Round 91 / Round 100 renderers above; this block only adds
   the "Play another battle" wiring: after a Daily pick, one tap
   deals a Fresh Pairs matchup and scrolls it into view. Works from
   the expanded card and from the collapsed strip alike (the strip's
   own click handler ignores button clicks, so no expand fires). */
function playAnotherBattle102() {
  if (typeof btlSetMode === "function") btlSetMode("fresh");
  const main = document.getElementById("btlMain");
  if (main) setTimeout(() => main.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}
(function round102Wire() {
  const bind = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  bind("dailyAnother", "click", playAnotherBattle102);
  bind("dailyStripAnother", "click", playAnotherBattle102);
})();

/* Round 103 (2026-11-11, Emil): the Store hero "CREATE A HYPE FRAME"
   tap did nothing on his iPhone, though the Round 86 per-element
   binding (line ~2689) checks out in Chromium — those three anchors
   were the only modal entry points depending on a one-time
   addEventListener pass, while every other modal on the site opens
   through parse-time inline handlers. Two extra layers now cover the
   tap: the anchors carry inline onclick="openHfChoice();return false"
   (index.html), and this document-level delegation opens the choice
   card for ANY [data-hf-start] tap that reaches the document —
   present or future CTAs, cloned or re-rendered nodes included.
   openHfChoice is idempotent, so layers firing together are a no-op. */
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest("[data-hf-start]") : null;
  if (a) { e.preventDefault(); openHfChoice(); }
});

/* ---------------- Round 104 (2026-11-11): youth Battles fixes —
   frozen-frame posters for re-rendered minis, and a Battles-only
   Post-pill yield. Appended at the end per the sandbox-slice rule;
   every lookup is guarded. */

/* Fix 1: a pick rebuilds the matchup (the Daily re-renders through
   loadDaily100; the Battles panel through btlRender), discarding
   the mini <video> elements that had frozen on a real frame — the
   fresh elements sit black until they reload and re-freeze
   (measured 70-95% black pixels at +600ms post-pick). Capture each
   mini's frozen frame as a poster, cache it by clip URL, and hand
   it to any later-created mini for the same clip, so re-renders
   paint a real frame instantly in every state. */
const btlPosters104 = {};
function btlCapturePoster104(v) {
  try {
    const key = v.getAttribute("src") || "";
    if (!key || btlPosters104[key]) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    const cw = 320, ch = Math.max(1, Math.round((cw * h) / w));
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0, cw, ch);
    /* Never bank a black frame: during a stall a capture can draw
       the clip's black first frame even at the freeze point (the
       slow upload's first banked poster measured 100% black). A
       rejected capture simply retries on a later pass. */
    try {
      const px = ctx.getImageData(0, 0, cw, ch).data;
      let black = 0, total = 0;
      for (let i = 0; i < px.length; i += 16) { total++; if (px[i] < 14 && px[i + 1] < 14 && px[i + 2] < 14) black++; }
      if (total && black / total >= 0.85) return;
    } catch { /* if the readback is unavailable, keep the poster */ }
    const url = c.toDataURL("image/jpeg", 0.72);
    if (url && url.length > 100) {
      btlPosters104[key] = url;
      /* Round 118: a big player (or its blurred fill) showing this
         clip may still carry the branded placeholder poster — swap
         in the real frame the moment it banks. */
      if (typeof btlUpgradeBigPoster118 === "function") btlUpgradeBigPoster118(key);
      /* Round 123: the same swap for the board tiles, the watch
         player and athlete-page cards wearing this clip. */
      if (typeof upgradeSurfacePosters123 === "function") upgradeSurfacePosters123(key);
    }
  } catch { /* a clip that refuses capture keeps the old behavior */ }
}
const btlMiniFrame91 = btlMiniFrame;
btlMiniFrame = function (v) {
  if (!v) return;
  const key = v.getAttribute("src") || "";
  if (key && btlPosters104[key]) { try { v.poster = btlPosters104[key]; } catch { /* the poster is a bonus */ } }
  btlMiniFrame91(v);
  if (!key) return;
  /* Round 119: a black-intro clip (offset map) freezes AT its
     offset, not at 0.5s — a poster banked from inside the black
     intro would be a black frame (and btlCapturePoster104's own
     black-frame rejection would keep refusing the capture,
     leaving the clip to fall back on the placeholder forever).
     Non-offset clips keep the stock 0.5 / 0.6 freeze points. */
  const fzAt104 = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(key) : 0.5;
  const fzTo104 = fzAt104 > 0.5 ? fzAt104 + 0.05 : 0.6;
  const cap = () => { if (v.currentTime >= fzAt104) { btlCapturePoster104(v); v.removeEventListener("timeupdate", cap); } };
  v.addEventListener("timeupdate", cap);
  setTimeout(() => v.removeEventListener("timeupdate", cap), 3200);
  /* A slow clip can stall before the freeze point (the real
     upload did: still at 0.04s seconds after creation, first
     frame black, nothing captured — and every re-render restarts
     the stall). And once a re-created video gets its first frame,
     the browser paints THAT instead of the poster — for clips
     whose first frame is black, the poster window can close
     before the freeze. So seek the mini to the freeze point as
     soon as its first frame lands (or after a short stall): the
     seeked frame paints even while the download catches up, and
     the capture banks it as the poster for the next re-render. */
  let seekTried104 = false;
  const seekFreeze104 = () => {
    if (seekTried104) return;
    seekTried104 = true;
    try {
      if (!v.isConnected || v.currentTime >= fzAt104) return;
      const onSeek = () => { btlCapturePoster104(v); v.removeEventListener("seeked", onSeek); };
      v.addEventListener("seeked", onSeek);
      v.currentTime = fzTo104;
      setTimeout(() => v.removeEventListener("seeked", onSeek), 4000);
    } catch { /* seeking is best-effort */ }
  };
  /* Queue the freeze seek immediately: a seek requested before
     the first frame arrives means the first frame PAINTED is the
     freeze frame — the clip's black first frame never gets a
     window to cover the poster. The loadeddata / stall retries
     below still run if this early seek didn't take. */
  try {
    if (v.currentTime < fzAt104) {
      const onEarlySeek = () => { btlCapturePoster104(v); v.removeEventListener("seeked", onEarlySeek); };
      v.addEventListener("seeked", onEarlySeek);
      setTimeout(() => v.removeEventListener("seeked", onEarlySeek), 4000);
      v.currentTime = fzTo104;
    }
  } catch { /* best-effort */ }
  if (v.readyState >= 2 && v.currentTime < fzAt104) seekFreeze104();
  else v.addEventListener("loadeddata", seekFreeze104, { once: true });
  setTimeout(seekFreeze104, 1200);
};

/* Fix 4: in the Battles view the floating Post pill yields whenever
   a battle stage element (matchup, player, pick buttons, result
   lines) enters the pill's bottom-right corner zone — it fades out
   instead of sitting on a clip, and returns everywhere else. It
   toggles its own class, so the Round 69 submit-link auto-hide
   never fights it; the observed elements live only in the Battles
   view, so other tabs keep the pill's stock behavior. */
(function fabBattles104() {
  const fab = document.getElementById("floatSubmit");
  if (!fab || !("IntersectionObserver" in window)) return;
  const ids = ["dailyMatchup", "dailyPlayer", "dailyPickA", "dailyPickB", "dailySplit", "dailyStrip", "dailyStreak105", "dailyTop105", "btlMatchup", "btlPlayerBox", "btlPickL", "btlPickR", "btlNext", "btlCount", "runMatchup", "runPlayer", "runPickA", "runPickB", "runReveal"];
  const targets = ids.map((id) => document.getElementById(id)).filter(Boolean);
  if (!targets.length) return;
  const zoneW = 150, zoneH = 84;
  const left = Math.max(0, window.innerWidth - zoneW), top = Math.max(0, window.innerHeight - zoneH);
  const seen = new Set();
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) seen.add(e.target); else seen.delete(e.target); });
    fab.classList.toggle("fab-btl-hidden104", seen.size > 0);
  }, { rootMargin: `-${top}px 0px 0px -${left}px`, threshold: 0 });
  targets.forEach((t) => io.observe(t));
})();

/* ---------------- Round 105 (2026-11-11): challenge links,
   picker streak + Top Pickers display — the client half of
   Features 2 and 4 (crowns and numbers render from the payload
   via crownsHtml105 / numbersHtml105 near badgesHtml100).
   Appended at the end per the sandbox-slice rule; every lookup
   is guarded. */

/* Feature 4 display: read the streak + Top Pickers off the daily
   payload after every loadDaily100 pass (initial load and the
   post-pick refresh alike, by riding the function itself).
   The Top Pickers block renders only when the server sent at
   least one qualifying picker (>= 2).
   Round 122 (2026-11-12): the streak line is ALWAYS on the Daily
   card now — Round 105 hid it at 0 and showed nothing before a
   first pick, so the youth-agent tester picked, looked for the
   promised streak ("Streaks count here"), and found air. States:
   real + no pick yet invites; real + picked shows the count from
   the same server streak store Top Pickers ranks (today's pick
   joins it when the day finalizes); practice explains itself.
   The collapsed strip (Round 112) carries the count too. */
function renderStreak105() {
  let r = null;
  try { r = d100.daily; } catch { r = null; }
  const line = document.getElementById("dailyStreak105");
  if (line) {
    const n = r && r.streak ? (r.streak.current || 0) : 0;
    if (!r || !r.available) { line.hidden = true; line.textContent = ""; }
    else if (r.practice && r.yourPick) { line.textContent = "Practice pick — streaks start with the first real Daily Battle."; line.hidden = false; }
    else if (r.practice) { line.textContent = "Practice matchup — streaks start with the first real Daily Battle."; line.hidden = false; }
    /* Round 179: a fresh pick with no finalized days behind it
       never presents a bare "Your streak: 0" as the reward (both
       youth testers read it as "my pick didn't count") — confirm
       the pick and say when it counts instead. A streak of 1+
       keeps the count line below. */
    else if (r.yourPick && n === 0) { line.textContent = "✓ Pick locked in — tonight's winner is crowned at day's end; your streak counts finalized days."; line.hidden = false; }
    else if (r.yourPick) { line.textContent = `Your streak: ${n} 🔥 — pick tomorrow's winner to keep it going`; line.hidden = false; }
    else { line.textContent = "Pick today's winner to start your streak 🔥"; line.hidden = false; }
  }
  const stripStreak = document.getElementById("dailyStripStreak");
  /* Round 179: the collapsed strip carries the count only once
     it is 1+ — a "· 🔥 0" chip is the same bare-zero problem in
     miniature. */
  if (stripStreak) stripStreak.textContent = r && r.available && !r.practice && r.yourPick && (r.streak ? (r.streak.current || 0) : 0) >= 1 ? ` · 🔥 ${r.streak ? (r.streak.current || 0) : 0}` : "";
  const block = document.getElementById("dailyTop105"), list = document.getElementById("dailyTopList");
  if (block && list) {
    const top = r && Array.isArray(r.topPickers) ? r.topPickers : [];
    if (top.length) {
      list.innerHTML = top.map((t) => `<p class="daily-top-row"><span>${esc(t.tag)}</span><b>🔥 ${t.streak}</b></p>`).join("");
      block.hidden = false;
    } else { block.hidden = true; list.innerHTML = ""; }
  }
}
if (typeof loadDaily100 === "function") {
  const origLoadDaily105 = loadDaily100;
  loadDaily100 = async function (...args) {
    const out = await origLoadDaily105.apply(this, args);
    try { renderStreak105(); } catch { /* display only — never break the Daily */ }
    return out;
  };
}

/* Round 179 (2026-11-14): the first Quick Battle of a session
   must not be today's Daily Battle pair re-dealt — both youth
   testers hit the identical matchup back-to-back and read it as
   copy-paste. The Daily payload lands AFTER the first Quick deal
   (initBattles deals, then loadDaily100 fetches), so the check
   rides loadDaily100: the first time a daily payload is on hand
   and Battles is built with an untouched deal showing, if the
   dealt pair IS the daily pair (either order) and another real
   pair exists, advance one pair and re-deal. Once per session;
   a challenge landing (?challenge=) deals its pair on purpose
   and is never overridden; a pick already made locks the deal. */
let btlDailyChecked179 = false;
function btlAvoidDailyPair179() {
  if (btlDailyChecked179) return;
  if (typeof btl === "undefined" || !btl.built || btl.picked) return;
  const d = (typeof d100 !== "undefined" && d100.daily) || null;
  if (!d) return; // daily not loaded yet — a later load re-checks
  btlDailyChecked179 = true;
  if (!d.available || !d.a || !d.b) return; // no daily today — nothing to avoid
  try { if (new URLSearchParams(location.search).get("challenge")) return; } catch { /* no URL to read — proceed */ }
  if (!btl.cur || !btl.cur.L || !btl.cur.R) return;
  if (!((btl.cur.L === d.a.id && btl.cur.R === d.b.id) || (btl.cur.L === d.b.id && btl.cur.R === d.a.id))) return;
  const { pairs } = btlPairs();
  if (!pairs || pairs.length < 2) return; // no alternative pair exists — unavoidable
  btl.pairIdx = (btl.pairIdx + 1) % pairs.length;
  btlDealFresh();
  btlRender();
}
if (typeof loadDaily100 === "function") {
  const origLoadDaily179 = loadDaily100;
  loadDaily100 = async function (...args) {
    const out = await origLoadDaily179.apply(this, args);
    try { btlAvoidDailyPair179(); } catch { /* a re-deal must never break the Daily */ }
    return out;
  };
}

/* Feature 2: challenge a friend — the share carries THIS matchup's
   two play ids; the landing (below) rebuilds the exact pair in
   the Fresh Pairs stage. navigator.share where the device offers
   it, copy-link fallback with inline feedback (the dailyShare100
   pattern). Pick rules on the landing are the stock ones — and
   since Round 179 every battle pick is just for fun: no pick,
   challenge pairs included, ever casts a contest vote. */
async function btlShare105() {
  const L = typeof btl !== "undefined" && btl.cur ? btl.cur.L : null;
  const R = typeof btl !== "undefined" && btl.cur ? btl.cur.R : null;
  if (!L || !R) return;
  const url = `https://highlighthype.com/?view=battles&challenge=${L}-${R}`;
  const text = "I challenge you — Which Play Wins? 👑";
  if (navigator.share) { try { await navigator.share({ title: "HighlightHype Battles", text, url }); return; } catch { /* fall through to copy */ } }
  const ok = typeof copyText100 === "function" ? await copyText100(`${text} ${url}`) : false;
  const msg = document.getElementById("btlShareMsg");
  if (msg && ok) { msg.textContent = "Challenge link copied ✓"; setTimeout(() => { msg.textContent = ""; }, 2200); }
}
(function round105Wire() {
  const btn = document.getElementById("btlShareChallenge");
  if (btn) btn.addEventListener("click", btlShare105);
  /* Challenge landing: ?view=battles&challenge=<idA>-<idB>. Rides
     applyDefaultView — loadData calls it once the plays land —
     exactly like the Round 91/94 deep links, so a FRESH visitor
     (no token, no state) lands in Battles on the exact pair. If
     either play is missing or unapproved (findPlay only searches
     the public approved sets), the normal deal stands and a
     one-line note says the challenge play is gone. Applies once:
     later data refreshes never re-deal somebody's game. */
  let challenge105 = null;
  try {
    const m = (new URLSearchParams(location.search).get("challenge") || "").match(/^(\d+)-(\d+)$/);
    if (m && m[1] !== m[2]) challenge105 = { a: Number(m[1]), b: Number(m[2]) };
  } catch { /* no challenge in the URL */ }
  if (!challenge105 || typeof applyDefaultView !== "function") return;
  const prevAD105 = applyDefaultView;
  let applied105 = false;
  applyDefaultView = function (...args) {
    const out = prevAD105.apply(this, args);
    if (applied105) return out;
    applied105 = true;
    try {
      if (typeof switchView === "function") switchView("battles");
      const note = document.getElementById("btlChallengeNote");
      const pa = typeof findPlay === "function" ? findPlay(challenge105.a) : null;
      const pb = typeof findPlay === "function" ? findPlay(challenge105.b) : null;
      if (pa && pb && typeof btlRender === "function") {
        btl.mode = "fresh";
        const fBtn = document.getElementById("btlModeFresh"), sBtn = document.getElementById("btlModeStay");
        if (fBtn) fBtn.classList.add("on");
        if (sBtn) sBtn.classList.remove("on");
        btl.battle = 0; btl.champ = null; btl.streak = 0; btl.lastBeaten = null;
        btl.cur = { L: challenge105.a, R: challenge105.b };
        btl.watching = "L";
        const realIds = new Set((CONTEST.entries || []).filter((p) => !p.isSample).map((p) => p.id));
        btl.pairReal = realIds.has(challenge105.a) && realIds.has(challenge105.b);
        btl.built = true;
        btlRender();
        if (note) { note.textContent = "You got challenged — which play wins?"; note.hidden = false; }
      } else if (note) {
        note.textContent = "That challenge play is gone — here's a fresh matchup instead.";
        note.hidden = false;
      }
      const playsEl = document.getElementById("plays");
      if (playsEl) playsEl.scrollIntoView();
    } catch { /* a challenge link must never break the page */ }
    return out;
  };
})();

/* ===== Round 106 (2026-11-11, Emil): Bottles in the Swag Shop ====
   A Hoodies | Bottles toggle under Shop by Sport (Hoodies default).
   The tiles keep ONE sport selection across both categories: the
   existing tile wiring jumps to the hoodie card; the listener below
   records the pick, and in Bottles the same pick jumps to that
   sport's bottle card — so Football -> flip -> football bottle.
   Bottle cards open a bottle view (the .hsv shell): front + back
   on a switch, COMING SOON with NO price, and a per-sport drop
   alert (POST /api/drop-notify; the emails are owner-only, listed
   in Owner view). The teaser deep link ?view=shop&cat=bottles
   (&sport=football) cold-opens the shop on the Bottles tab. */
const BTL106 = {
  baseball: { name: "Baseball", front: "/swag/hs/bottle-baseball.jpg" },
  football: { name: "Football", front: "/swag/hs/bottle-football.jpg" },
  basketball: { name: "Basketball", front: "/swag/hs/bottle-basketball.jpg" },
  soccer: { name: "Soccer", front: "/swag/hs/bottle-soccer.jpg" },
  softball: { name: "Softball", front: "/swag/hs/bottle-softball.jpg" },
  volleyball: { name: "Volleyball", front: "/swag/hs/bottle-volleyball.jpg" },
};
const BTL106_BACK = "/swag/hs/bottle-back.jpg";
const hsCat106 = { cat: "hoodies", sport: null };
function hsJump106(card) {
  if (!card) return;
  card.scrollIntoView({ behavior: "smooth", block: "center" });
  card.classList.remove("hs-flash"); void card.offsetWidth; card.classList.add("hs-flash");
  setTimeout(() => card.classList.remove("hs-flash"), 1300);
}
function hsMarkSport106() {
  $$("[data-hs-jump]").forEach((t) => t.setAttribute("aria-pressed", String(t.dataset.hsJump === hsCat106.sport)));
}
function hsSetCat106(cat, jump) {
  hsCat106.cat = cat === "bottles" ? "bottles" : "hoodies";
  $$(".hs-cat-btn").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.hsCat === hsCat106.cat)));
  const hp = $("#hsHoodiePanel"), bp = $("#hsBottlePanel");
  if (hp) hp.hidden = hsCat106.cat !== "hoodies";
  if (bp) bp.hidden = hsCat106.cat !== "bottles";
  if (jump && hsCat106.sport) {
    const sel = hsCat106.cat === "bottles" ? `[data-btl-card="${hsCat106.sport}"]` : `[data-hs-card="${hsCat106.sport}"]`;
    setTimeout(() => hsJump106(document.querySelector(sel)), 60);
  }
}
$$(".hs-cat-btn").forEach((b) => b.addEventListener("click", () => hsSetCat106(b.dataset.hsCat, true)));
$$("[data-hs-jump]").forEach((el) => el.addEventListener("click", () => {
  hsCat106.sport = el.dataset.hsJump || null;
  hsMarkSport106();
  if (hsCat106.cat === "bottles") hsJump106(document.querySelector(`[data-btl-card="${hsCat106.sport}"]`));
}));
/* Bottle view: the hoodie product view's twin, minus price/sizes —
   a bottle is COMING SOON until Emil sets pricing, and the only
   action is the drop alert for THIS sport. */
const btlState106 = { sport: null, side: "front" };
function btlSetSide106(side) {
  const p = BTL106[btlState106.sport]; if (!p) return;
  btlState106.side = side === "back" ? "back" : "front";
  const img = $("#btlMainImg"); if (!img) return;
  img.src = btlState106.side === "back" ? BTL106_BACK : p.front;
  img.alt = btlState106.side === "back"
    ? `${p.name} Hype Bottle — back: the gold HH crest with HIGHLIGHTHYPE and “Your moment. Your hype.” (the same back on every bottle)`
    : `${p.name} Hype Bottle — front`;
  $$("[data-btl-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.btlSide === btlState106.side)));
}
function openBtlView106(sport) {
  const p = BTL106[sport]; if (!p) return;
  const view = $("#btlView"); if (!view) return;
  btlState106.sport = sport;
  $("#btlTitle").textContent = `${p.name} Hype Bottle`;
  const hp = HS_PRODUCTS[sport];
  $("#btlLine").textContent = hp ? hp.line : "";
  $("#btlDesc").textContent = `The ${p.name} Hype Bottle from Hype Sports — a black 32oz bottle with the giant ${p.name.toLowerCase()} graphic, gold crown and HYPE brush letters on the front, and the gold HH crest on the back. Bottles drop after the hoodies: leave an email and we'll tell you the moment this one goes live.`;
  const msg = $("#btlNotifyMsg"); if (msg) { msg.textContent = ""; msg.classList.remove("ok"); }
  btlSetSide106("front");
  view.hidden = false;
  document.body.classList.add("hsv-open");
  view.querySelector(".hsv-close")?.focus();
}
function closeBtlView106() {
  const view = $("#btlView"); if (!view) return;
  view.hidden = true;
  document.body.classList.remove("hsv-open");
}
$$(".hs-btl-card").forEach((card) => {
  card.addEventListener("click", () => openBtlView106(card.dataset.btlCard));
  card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openBtlView106(card.dataset.btlCard); } });
});
$$("[data-btl-close]").forEach((el) => el.addEventListener("click", closeBtlView106));
$$("[data-btl-side]").forEach((b) => b.addEventListener("click", () => btlSetSide106(b.dataset.btlSide)));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBtlView106(); });
$("#btlNotifyForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const sport = btlState106.sport; if (!sport) return;
  const input = $("#btlEmail"), btn = $("#btlNotifyBtn"), msg = $("#btlNotifyMsg");
  const email = (input?.value || "").trim();
  const say = (text, ok) => { if (msg) { msg.textContent = text; msg.classList.toggle("ok", !!ok); } };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("That email doesn't look right — check it and try again.", false); input?.focus(); return; }
  if (btn) btn.disabled = true;
  try {
    await api("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, sport }) });
    say(`You're on the list ✓ — we'll email you when the ${BTL106[sport].name} bottle drops.`, true);
  } catch (err) { say(err.message || "That signup didn't go through — please try again.", false); }
  if (btn) btn.disabled = false;
});
/* Round 227 (2026-11-27): the coming-soon store cards — the six
   collection quick views and the per-sport Hype Sports hoodies —
   reuse the bottles' notify-me capture above: this helper is that
   handler's exact flow (same email check, same /api/drop-notify
   POST, same confirmation shape, same error behavior),
   parameterized only by the form it serves and the signup key +
   product name it confirms. The bottles handler itself is
   untouched; the server allowlist grew the store keys beside the
   six bottle sports (DROP_NOTIFY_KEYS227). */
async function notifySubmit227(e, formSel, key, name) {
  e.preventDefault();
  if (!key) return;
  const form = $(formSel); if (!form) return;
  const input = form.querySelector('input[type="email"]'), btn = form.querySelector('button[type="submit"]'), msg = form.querySelector(".btlv-msg");
  const email = (input?.value || "").trim();
  const say = (text, ok) => { if (msg) { msg.textContent = text; msg.classList.toggle("ok", !!ok); } };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { say("That email doesn't look right — check it and try again.", false); input?.focus(); return; }
  if (btn) btn.disabled = true;
  try {
    await api("/api/drop-notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, sport: key }) });
    say(`You're on the list ✓ — we'll email you when the ${name} opens for orders.`, true);
  } catch (err) { say(err.message || "That signup didn't go through — please try again.", false); }
  if (btn) btn.disabled = false;
}
$("#qvNotifyForm227")?.addEventListener("submit", (e) => notifySubmit227(e, "#qvNotifyForm227", qvGalleryState.slug, $("#qvTitle")?.textContent || "this one"));
$("#hsNotifyForm227")?.addEventListener("submit", (e) => notifySubmit227(e, "#hsNotifyForm227", hsState.sport ? "hoodie-" + hsState.sport : "", $("#hsTitle")?.textContent || "this one"));
/* Round 126 (2026-11-13, Emil's phone review of Round 125):
   the homepage merch teaser's wiring. The Round 125 per-sport
   drop-notify form is GONE from the teaser (Emil: "get rid of
   the section about when your sport drops") — its handler left
   with it; the Store's own notify (the bottle form just above)
   is untouched. What the teaser carries now:
   (a) Each sweatshirt card defaults to its BACK view and wears
   the Swag Shop's Front/Back switch (the hsv-side pattern:
   two labeled buttons, aria-pressed follows the side); the
   buttons swap the photo + alt in place, and the card's own
   store link is a separate element, untouched.
   (b) The products render in TWO layouts Emil is choosing
   between — A (default): the two hoodies in a row with the
   bottle in its own slim row underneath; B: one hoodie
   (Baseball) + the bottle in a single two-card row. ?teaser=B
   flips it (localStorage hh_teaser works too); the deploy
   hard-codes his pick and the variant code comes out. */
$$(".mt125-prod[data-front][data-back]").forEach((card) => {
  const img = card.querySelector("img");
  if (!img) return;
  card.querySelectorAll(".mt126-side-btn").forEach((b) => b.addEventListener("click", () => {
    const side = b.dataset.mtSide === "front" ? "front" : "back";
    img.src = side === "back" ? card.dataset.back : card.dataset.front;
    if (side === "back" && img.dataset.altBack) img.alt = img.dataset.altBack;
    if (side === "front" && img.dataset.altFront) img.alt = img.dataset.altFront;
    card.querySelectorAll(".mt126-side-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));
});
(function teaserVariant126() {
  const wrap = $("#mtProducts126");
  if (!wrap) return;
  let v = "";
  try { v = (new URLSearchParams(location.search).get("teaser") || hhStorageGet("hh_teaser") || "").toUpperCase(); } catch { /* params/storage unavailable — default A */ }
  if (v !== "B") return;
  wrap.dataset.teaserVariant = "B";
  const hoodies = wrap.querySelector(".mt126-hoodies");
  const bb = wrap.querySelector('[data-prod="basketball-hoodie"]');
  const bottleRow = wrap.querySelector(".mt126-bottle-row");
  const bottle = wrap.querySelector('[data-prod="bottle"]');
  if (bb) bb.hidden = true;
  if (bottle && hoodies) { bottle.classList.add("mt126-bottle-inrow"); hoodies.appendChild(bottle); }
  if (bottleRow) bottleRow.hidden = true;
})();
/* Teaser deep link: ?view=shop&cat=bottles opens the store on the
   Bottles tab; &sport=football also carries the sport pick across,
   so a parent arriving from the football bottle post lands on the
   football bottle. The /store path accepts the same params. Runs
   once at script end (boot has already opened /store itself); a
   bad link must never break the page. */
(function round106DeepLink() {
  try {
    const q = new URLSearchParams(location.search);
    const onStorePath = (location.pathname.replace(/\/+$/, "") || "/") === "/store";
    if (q.get("view") !== "shop" && !onStorePath) return;
    const cat = q.get("cat"), sport = q.get("sport");
    if (cat !== "bottles" && !BTL106[sport]) return;
    if (!document.body.classList.contains("store-open")) showStore();
    if (BTL106[sport]) { hsCat106.sport = sport; hsMarkSport106(); }
    if (cat === "bottles") hsSetCat106("bottles", false);
    if (hsCat106.sport) {
      const sel = hsCat106.cat === "bottles" ? `[data-btl-card="${hsCat106.sport}"]` : `[data-hs-card="${hsCat106.sport}"]`;
      setTimeout(() => hsJump106(document.querySelector(sel)), 350);
    }
  } catch { /* a deep link must never break the page */ }
})();

/* Round 107 (2026-11-12): hybrid header + contest strip wiring.
   The header's Post a Play pill routes to the same goSubmit as
   the FAB and the hero's Submit link (the upload overlay). The
   contest strip is a shortcut to the Month board. Both are
   guarded so a missing element can never break the page. */
$("#postPlayBtn")?.addEventListener("click", () => goSubmit());
$("#contestStrip")?.addEventListener("click", () => { switchView("month"); $("#contestStrip")?.blur(); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); });
$("#contestStrip")?.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); switchView("month"); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); } });
/* Round 107: the watch view's deep link is #watch-<id> — it
   routes to the watch view exactly like the original #play-<id>
   (highlightSharedPlay accepts both, and closing drops either).
   openPlayDetail keeps writing #play-<id>: that is the share
   contract every existing shared link carries (Round 8), and
   both hashes land on the same watch view. */

/* ---------------- Round 111 (2026-11-12): Battles load-delay fix —
   pooled mini media, instant posters, deferred offscreen media,
   idle warm-up of the coming pairs. Emil's phone report: tapping
   into Battles / cycling pairs sat on black boxes while clips
   loaded. The mechanics he hit: every render built brand-new
   <video preload="auto"> elements (Round 91/100), the sample clips
   are 5–14 MB MP4s whose moov atom sits at the END of the file, and
   Round 104's captured posters only exist after a clip has already
   frozen once in the session — a first-time pair had no poster at
   all, and a re-render threw away the loaded elements entirely.
   Now the renderers emit media slots (btlMiniHTML / d100MiniHTML)
   and this block fills them:
   - a slot always paints immediately: the slot itself is a branded
     frame, and the installed <video> carries a poster from the
     moment it exists (the Round 104 captured frame when one is
     banked, otherwise a generated branded sport poster);
   - <video> elements are pooled by clip URL for the whole session
     and parked in an offscreen box instead of being discarded, so
     cycling pairs, switching modes, or leaving and returning to
     Battles reuses the SAME element — no re-download, no re-decode;
   - the first Battles render defers the below-fold Quick Battles
     media until it nears the viewport, so it cannot compete with
     the Daily pair for bandwidth;
   - once the on-screen pairs settle, the coming Fresh pairs are
     warmed one clip at a time in the pool (next pair first), so a
     Next tap usually swaps in an element that already holds its
     frozen frame.
   Appended at the end per the sandbox-slice rule; the renderers
   reach these helpers through typeof guards. */
const btlMediaByUrl111 = new Map();
const btlWarmAttempted111 = new Set();
let btlWarmTimer111 = null;

function btlPlaceholderPoster111(sport, title) {
  const s = String(sport || "Hype").toUpperCase().slice(0, 24);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360' viewBox='0 0 640 360'>`
    + `<defs><radialGradient id='g' cx='50%' cy='0%' r='130%'><stop offset='0%' stop-color='#26220f'/><stop offset='55%' stop-color='#131315'/><stop offset='100%' stop-color='#0a0a0a'/></radialGradient></defs>`
    + `<rect width='640' height='360' fill='url(#g)'/>`
    + `<circle cx='320' cy='158' r='46' fill='none' stroke='#f0b93e' stroke-width='3' opacity='0.9'/>`
    + `<path d='M306 132 L348 158 L306 184 Z' fill='#f0b93e'/>`
    + `<text x='320' y='66' text-anchor='middle' font-family='Arial, sans-serif' font-size='17' font-weight='700' letter-spacing='4' fill='#e8e2d2'>HIGHLIGHTHYPE</text>`
    + `<text x='24' y='330' font-family='Arial, sans-serif' font-size='19' font-weight='800' letter-spacing='2' fill='#f5f1e6'>${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</text>`
    + `</svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function btlWarmBox111() {
  let box = document.getElementById("btlWarmBox111");
  if (!box) {
    box = document.createElement("div");
    box.id = "btlWarmBox111";
    box.setAttribute("aria-hidden", "true");
    box.style.cssText = "position:fixed;left:-9999px;top:0;width:160px;height:90px;overflow:hidden;opacity:.01;pointer-events:none";
    document.body.appendChild(box);
  }
  return box;
}
function btlRegisterMedia111(v) {
  const url = (v && (v.dataset.btlUrl111 || v.getAttribute("src"))) || "";
  if (!url) return "";
  v.dataset.btlUrl111 = url;
  let set = btlMediaByUrl111.get(url);
  if (!set) { set = new Set(); btlMediaByUrl111.set(url, set); }
  set.add(v);
  return url;
}
function btlConfigureMedia111(v, data) {
  v.muted = true;
  v.playsInline = true;
  v.preload = "metadata";
  const url = data.url || v.dataset.btlUrl111 || "";
  const actual = (typeof btlPosters104 !== "undefined" && url) ? btlPosters104[url] : "";
  try {
    if (actual) v.poster = actual;
    else if (!v.poster) v.poster = btlPlaceholderPoster111(data.sport, data.title);
  } catch { /* the poster is a bonus, never a breaker */ }
}
function btlObtainMedia111(data) {
  const url = data.url || "";
  const set = btlMediaByUrl111.get(url);
  if (set) {
    for (const v of set) {
      if (!v.closest(".btl-mini")) { btlConfigureMedia111(v, data); return v; }
    }
  }
  const v = document.createElement("video");
  v.src = url;
  v.dataset.btlUrl111 = url;
  btlRegisterMedia111(v);
  btlConfigureMedia111(v, data);
  return v;
}
function btlRetireMatchup111(matchup) {
  if (!matchup) return;
  matchup.querySelectorAll(".btl-mini video:not(.vfill)").forEach((v) => {
    const url = btlRegisterMedia111(v);
    /* Round 119: the retire-capture threshold follows the same
       freeze point as the wiring (offset clips bank at the offset). */
    const fzRet111 = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(url) : 0.5;
    if (url && v.currentTime >= fzRet111 && typeof btlCapturePoster104 === "function") btlCapturePoster104(v);
    if (url && typeof btlPosters104 !== "undefined" && btlPosters104[url]) { try { v.poster = btlPosters104[url]; } catch { /* bonus */ } }
    try { v.pause(); } catch { /* already stopped */ }
    try { btlWarmBox111().appendChild(v); } catch { /* parking is best-effort */ }
  });
}
function btlWireMedia111(v) {
  if (!v) return;
  const url = v.dataset.btlUrl111 || v.getAttribute("src") || "";
  const actual = (typeof btlPosters104 !== "undefined" && url) ? btlPosters104[url] : "";
  if (actual) { try { v.poster = actual; } catch { /* bonus */ } }
  /* Round 119: "frame ready" for an offset clip means parked AT
     the offset (a frame inside its black intro is not a frame
     worth settling on); other clips keep the 0.5s point. */
  const fzWire111 = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(url) : 0.5;
  if (v.currentTime >= fzWire111) { v.dataset.btlFrameReady111 = "1"; try { v.pause(); } catch { /* fine */ } return; }
  const wiredAt = Number(v.dataset.btlFrameWiredAt111 || 0);
  if (v.dataset.btlFrameWired111 === "1" && Date.now() - wiredAt < 3500) {
    /* Still inside the first wiring's freeze window — the earlier
       handlers own the seek; just resume playback toward it. */
    try { const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch { /* fine */ }
    return;
  }
  v.dataset.btlFrameWired111 = "1";
  v.dataset.btlFrameWiredAt111 = String(Date.now());
  if (typeof btlMiniFrame === "function") btlMiniFrame(v);
  const mark = () => { if (v.currentTime >= fzWire111) { v.dataset.btlFrameReady111 = "1"; if (typeof refreshFillPoster113 === "function") refreshFillPoster113(v); v.removeEventListener("timeupdate", mark); } };
  v.addEventListener("timeupdate", mark);
  setTimeout(() => v.removeEventListener("timeupdate", mark), 4000);
}
const btlMediaObserver111 = (() => {
  try {
    if (!("IntersectionObserver" in window)) return null;
    return new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (!e.isIntersecting) return;
        const slot = e.target;
        btlMediaObserver111.unobserve(slot);
        setTimeout(() => { if (slot._btlInstall111) slot._btlInstall111(); }, 600);
      });
    }, { rootMargin: "600px 0px" });
  } catch { return null; }
})();
function btlInstallMedia111(matchup, opts = {}) {
  if (!matchup) return;
  matchup.querySelectorAll("[data-btl-media111]").forEach((slot) => {
    if (slot.dataset.btlInstalled111 === "1") return;
    const install = () => {
      if (slot.dataset.btlInstalled111 === "1" || !slot.isConnected) return;
      slot.dataset.btlInstalled111 = "1";
      const v = btlObtainMedia111({ url: slot.dataset.url || "", sport: slot.dataset.sport || "", title: slot.dataset.title || "" });
      slot.replaceWith(v);
      btlWireMedia111(v);
      /* Round 226: a poster226 slot (the Daily's large cards)
         pins the play's own poster image as the video's still,
         applied after the wiring so the banked-frame poster
         never covers it at install time. Playback itself is
         the pooled master, unchanged (Round 192). */
      if (opts.poster226) { const sp226 = slot.dataset.poster226 || ""; if (sp226) { try { v.poster = sp226; } catch { /* the poster is a bonus */ } } }
      if (typeof btlMarkVertical113 === "function") btlMarkVertical113(v);
    };
    slot._btlInstall111 = install;
    const r = slot.getBoundingClientRect();
    const near = r.top < window.innerHeight && r.bottom > 0;
    if (opts.eager || near || !btlMediaObserver111) install();
    else btlMediaObserver111.observe(slot);
  });
  btlScheduleWarm111();
}
function btlWarmCandidates111() {
  const out = [];
  const seen = new Set();
  const push = (p) => {
    if (!p || !p.media_url || seen.has(p.media_url)) return;
    if (p.media_kind && p.media_kind !== "file" && p.media_kind !== "link_video") return;
    seen.add(p.media_url);
    out.push(p);
  };
  try {
    const { pairs } = btlPairs();
    if (pairs && pairs.length) {
      const start = (btl.pairIdx + 1) % pairs.length;
      for (let k = 0; k < pairs.length; k++) (pairs[(start + k) % pairs.length] || []).forEach((id) => push(findPlay(id)));
    }
  } catch { /* no pair list yet */ }
  try { if (typeof d100 !== "undefined" && d100.daily && d100.daily.available) { push(d100.daily.a); push(d100.daily.b); } } catch { /* daily not loaded */ }
  return out.slice(0, 12);
}
function btlBattlesSettled111() {
  const vs = [...document.querySelectorAll("#viewBattles .btl-mini video:not(.vfill)")];
  return vs.every((v) => v.currentTime >= 0.5 || v.readyState >= 2);
}
function btlScheduleWarm111() {
  if (btlWarmTimer111) return;
  btlWarmTimer111 = setTimeout(() => { btlWarmTimer111 = null; btlWarmStep111(0); }, 3000);
}
function btlWarmStep111(retries) {
  if (!btlBattlesSettled111() && retries < 8) {
    btlWarmTimer111 = setTimeout(() => { btlWarmTimer111 = null; btlWarmStep111(retries + 1); }, 1000);
    return;
  }
  const next = btlWarmCandidates111().find((p) => !btlWarmAttempted111.has(p.media_url) && !(btlMediaByUrl111.get(p.media_url) && btlMediaByUrl111.get(p.media_url).size));
  if (!next) return;
  btlWarmAttempted111.add(next.media_url);
  const v = btlObtainMedia111({ url: next.media_url, sport: cap(next.sport), title: next.title });
  try { btlWarmBox111().appendChild(v); } catch { /* warming is best-effort */ }
  btlWireMedia111(v);
  btlWarmTimer111 = setTimeout(() => { btlWarmTimer111 = null; btlWarmStep111(0); }, 1100);
}

/* ---------------- Round 113 (2026-11-12): the vertical treatment
   leaves the feed — watch view + Battles get the blurred fill too.
   Trigger: the site's FIRST REAL UPLOAD (play 50, Charlotte, martial
   arts) is a portrait clip stored landscape-coded (1214x720) with a
   -90 degree display matrix, so it DISPLAYS at 720x1214. Engines
   report videoWidth/videoHeight as the DISPLAY dimensions (verified
   in Chromium with structurally identical rotated twins: 720x1214),
   so the Round 107 metadata check itself is sound — the problem was
   reach: only .dur-host thumbs (feed tiles + Up-next rows) were ever
   wired to it. The watch player (.watch-player is not a .dur-host)
   showed the clip pillarboxed on black — Emil: "it's centered right
   now" — and the Battles minis + big players render every clip with
   object-fit:cover and no marking path at all, so a portrait clip
   there was cropped to its middle band. This block generalizes the
   R107 mark (host gets .is-vertical, a blurred paused clone fills
   the sides, the real clip stays FULL and centered — object-fit
   contain, never cropped) to the three remaining surfaces:
   - the watch view player (wired per detail render);
   - Battles minis (wired at pooled-media install; the fill is a
     plain DOM sibling, never pooled — the Round 111 retire/settled
     selectors now skip .vfill);
   - the Battles big players (#btlPlayer / #dailyPlayer /
     #runPlayer share .btl-player): a persistent loadedmetadata
     listener re-syncs the mark on every clip change, both ways, so
     a landscape clip after a portrait one sheds the fill.
   Display layer only: the uploaded file is never touched. */
function vfillClone113(video, opts) {
  const fill = video.cloneNode();
  fill.classList.add("vfill");
  fill.removeAttribute("id");
  fill.removeAttribute("autoplay");
  fill.removeAttribute("controls");
  fill.setAttribute("aria-hidden", "true");
  fill.setAttribute("tabindex", "-1");
  fill.muted = true;
  /* Round 118: EVERY fill is inert now, not just the minis'. Before,
     only the Battles-mini call site passed noFetch — the big-player
     fill (syncBtlPlayer113) and the watch-view fill were full
     clones carrying the same src and preload, inserted live: a
     second element fetching the same file alongside the real
     player (for a portrait clip in the big player, a second 11 MB
     HEVC download racing the player on iOS's strict media budget).
     A fill's whole job is a blurred backdrop, and under a 16px blur
     the banked poster frame IS that backdrop — so every fill is now
     poster-only: preload "none", src removed outright (no resource
     selection can ever run), load() never called on it. It keeps
     the source's poster (cloneNode carries the attribute) and the
     poster refresh paths upgrade it when the real frame banks.
     CSS already gives every .vfill pointer-events:none, so a fill
     can never intercept a tap meant for the player either. */
  try { fill.preload = "none"; } catch (e) { /* default preload is fine too */ }
  fill.removeAttribute("src");
  if (typeof fill.pause === "function") fill.pause();
  return fill;
}
function markHostVertical113(host, video, opts) {
  if (!host || !video) return false;
  if (!(video.videoWidth > 0) || !(video.videoHeight > video.videoWidth)) return false;
  if (host.classList.contains("is-vertical")) return true;
  host.classList.add("is-vertical");
  try { host.insertBefore(vfillClone113(video, opts), video); } catch (e) { /* the mark alone still centers the clip via CSS */ }
  return true;
}
function whenMeta113(video, fn) {
  if (video.readyState >= 1) { fn(); return; }
  video.addEventListener("loadedmetadata", fn, { once: true });
}
function wireWatchVertical113(body) {
  const box = body ? body.querySelector(".watch-player") : null;
  if (!box) return;
  const video = box.querySelector("video:not(.vfill)");
  if (!video) return;
  whenMeta113(video, () => {
    if (!markHostVertical113(box, video)) return;
    /* Round 118: the fill no longer fetches the clip — it paints a
       poster. Hand it this clip's banked frame if one exists, and
       bank the frame at the usual freeze point if it doesn't (the
       watch video autoplays, so the freeze point arrives on its
       own); the fill upgrades the moment the capture lands. */
    const fill = box.querySelector("video.vfill");
    if (!fill) return;
    const url = video.getAttribute("src") || "";
    if (url && typeof btlPosters104 !== "undefined" && btlPosters104[url]) { try { fill.poster = btlPosters104[url]; } catch (e) { /* bonus */ } return; }
    /* Round 123: the freeze point follows the clip's start offset
       (btlFreezeAt119) — banking an offset clip at the stock 0.5s
       could freeze its transition frame as the poster. */
    const fz113 = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(url) : 0.5;
    const cap = () => {
      if (video.currentTime >= fz113) {
        if (typeof btlCapturePoster104 === "function") btlCapturePoster104(video);
        if (url && typeof btlPosters104 !== "undefined" && btlPosters104[url]) { try { fill.poster = btlPosters104[url]; } catch (e) { /* bonus */ } }
        video.removeEventListener("timeupdate", cap);
      }
    };
    video.addEventListener("timeupdate", cap);
    setTimeout(() => video.removeEventListener("timeupdate", cap), 5000);
  });
}
function btlMarkVertical113(v) {
  if (!v || v.classList.contains("vfill")) return;
  const host = typeof v.closest === "function" ? v.closest(".btl-mini") : null;
  if (!host) return;
  whenMeta113(v, () => markHostVertical113(host, v, { noFetch: true }));
}
function refreshFillPoster113(v) {
  try {
    if (typeof btlCapturePoster104 === "function") btlCapturePoster104(v);
    if (typeof btlPosters104 === "undefined") return;
    const url = v.dataset.btlUrl111 || v.getAttribute("src") || "";
    const actual = url ? btlPosters104[url] : "";
    if (!actual) return;
    const host = typeof v.closest === "function" ? v.closest(".btl-mini") : null;
    const fill = host ? host.querySelector("video.vfill") : null;
    if (fill) fill.poster = actual;
  } catch (e) { /* the poster upgrade is a bonus, never a breaker */ }
}
function syncBtlPlayer113(player) {
  const box = typeof player.closest === "function" ? player.closest(".btl-player") : null;
  if (!box) return;
  const portrait = player.videoWidth > 0 && player.videoHeight > player.videoWidth;
  const old = box.querySelector("video.vfill");
  if (old) old.remove();
  if (portrait) {
    box.classList.add("is-vertical");
    /* Round 154: the tall stage rides the same metadata sync —
       a portrait clip's stage adapts here even when no poster
       signal arrived first. */
    box.classList.add("btl-tall154");
    try {
      box.insertBefore(vfillClone113(player), player);
      /* Round 118: the fill is poster-only now — make sure it wears
         the selected clip's poster even when the clone was taken
         before the player's own poster was set. */
      const fill = box.querySelector("video.vfill");
      if (fill && typeof btlPosterFor118 === "function") {
        const fp = btlPosterFor118(player.getAttribute("src") || "", player.dataset.btlSelSport118 || "", player.dataset.btlSelTitle118 || "");
        if (fp) { try { fill.poster = fp; } catch (e) { /* the poster is a bonus */ } }
      }
    } catch (e) { /* mark alone still applies contain */ }
  } else {
    box.classList.remove("is-vertical");
    /* Round 154: a landscape clip after a portrait one sheds
       the tall stage too — the sync runs both ways. */
    box.classList.remove("btl-tall154");
  }
}
function wireBtlPlayer113(id) {
  const player = document.getElementById(id);
  if (!player) return;
  player.addEventListener("loadedmetadata", () => syncBtlPlayer113(player));
  player.addEventListener("emptied", () => syncBtlPlayer113(player));
  if (player.readyState >= 1) syncBtlPlayer113(player);
}
wireBtlPlayer113("btlPlayer");
wireBtlPlayer113("dailyPlayer");
wireBtlPlayer113("runPlayer");
/* Round 154 (2026-11-14): the Battles big-player stage adapts
   to the clip, the Round 142 featured-stage treatment brought
   to Battles. Round 113 already CONTAINED a portrait clip in
   the big player (no crop), but the video element kept its
   fixed 16:9 aspect — the contained portrait rendered as a
   skinny pillar-boxed strip in the middle of a wide stage
   (Emil, on his phone: the Battles portrait problem the board
   and Month tab no longer have). Now the stage itself adapts:
   the .btl-player box gains .btl-tall154 and the styles.css
   rule gives the video element a ~4:5 stage (640px height
   cap, contain — the Round 113 blur fill backs it). Landscape
   stays 16:9 exactly as before.
   Orientation signal, in the Round 142 order: (1) the play's
   SERVER poster — poster_url is the clip's own frame, so its
   shape is the clip's shape — marks the stage at selection
   time, BEFORE any metadata lands, so the stage never starts
   in the wrong shape and jumps; (2) the video's own metadata,
   confirmed both ways by syncBtlPlayer113 on every
   loadedmetadata (it adds/removes .btl-tall154 in lockstep
   with .is-vertical). Only the server poster is trusted for
   the early mark — the banked-frame / branded-placeholder
   fallbacks are not the clip's stored frame. Neither signal
   → no mark → today's 16:9 stage (the fallback is the
   pre-154 player, never a broken one). The poster probe is
   token-guarded by media_url: a slow poster load for the
   side the viewer already switched away from cannot re-mark
   the stage for the new clip. Each big player is marked from
   its own selection only — in a mixed-orientation matchup
   the two sides adapt independently (the stage shows one
   side at a time; switching sides re-marks it). */
function markBtlStage154(player, play) {
  if (!player || typeof player.closest !== "function") return;
  const box = player.closest(".btl-player");
  if (!box || !box.classList) return;
  if (player.videoWidth > 0 && player.videoHeight > 0) {
    if (player.videoHeight > player.videoWidth) box.classList.add("btl-tall154"); else box.classList.remove("btl-tall154");
    return;
  }
  const forUrl = (play && play.media_url) || "";
  /* The selection token stamps BEFORE the poster check: even a
     poster-less new selection retires the previous side's
     in-flight poster probe. */
  try { player.dataset.btlStageUrl154 = forUrl; } catch (e) { /* the token is best-effort */ }
  const poster = (play && play.poster_url) || "";
  if (!poster) return;
  try {
    const img = new Image();
    img.onload = () => {
      try { if ((player.dataset.btlStageUrl154 || "") !== forUrl) return; } catch (e) { /* no token store — apply anyway */ }
      if (img.naturalHeight > img.naturalWidth) box.classList.add("btl-tall154");
      else if (img.naturalWidth > 0) box.classList.remove("btl-tall154");
    };
    img.src = poster;
  } catch (e) { /* no Image in this context — metadata sync decides */ }
}

/* ---------------- Round 118 (2026-11-12): Battles big-player
   hardening. After Round 117's server Range fixes (verified live),
   Emil's iPhone STILL showed the Quick Battles big player as a
   black void. His follow-up evidence is decisive about where the
   fault is NOT: both clips play fine once he taps a mini FIRST and
   then taps play on the big player — so the files, the server, and
   basic playback are all sound. What fails is the big player's
   DEFAULT state and interaction order:
   - it carried NO poster, so on Battles open it presented as a
     black rectangle with iOS's native play disc floating over
     nothing — indistinguishable from "didn't load";
   - nothing on the page guaranteed that activating the player
     directly (no mini tap first) ran a clean load+play of the clip
     btlWatch had loaded paused — the play() calls in btlWatch /
     d100Watch swallowed every rejection silently, and an element
     left in an error / no-source state by an interrupted first
     fetch had no recovery path short of the mini-tap sequence
     that happened to re-drive it;
   - for a portrait pick, Round 113's big-player fill was a second
     full <video> for the same src (see vfillClone113 — now
     poster-only everywhere).
   This block is the client-side answer, in four parts:
   1. Posters: btlWatch / d100Watch note the selection and paint
      the big player's poster (Round 104 banked frame when one
      exists, the branded placeholder otherwise) BEFORE loading, so
      a selected clip never sits as a pure black void; when the
      real frame banks later, btlUpgradeBigPoster118 swaps it in.
   2. btlPlayBig118 is the one hardened play path: a broken element
      (media error, NETWORK_NO_SOURCE / NETWORK_EMPTY, or no data)
      gets a fresh src + load() first; a rejected play() retries
      exactly once after re-assigning src + load(); a second failure
      shows the visible retry overlay instead of silent black.
   3. Each big player answers a tap on ITSELF: a click on the
      player surface while it is paused runs btlPlayBig118 for the
      clip IT has loaded (its own noted selection) — opening Battles
      and tapping the big player directly plays side A, no mini tap
      required. (The battles players use native controls; the disc
      in Emil's screenshot is iOS's own button over a poster-less
      element. This handler makes the page's own mechanics back
      that tap up instead of depending on the element's state.)
      (Round 119 correction: the handler no longer reads
      player.paused at click time — on iOS the native toggle lands
      BEFORE the click reaches page handlers, so a pause tap
      arrived already-paused and got played again. Intent is now
      captured at pointerdown; see the wiring below.)
   4. A media error on a big player earns ONE silent reload for
      that URL; a second error for the same URL raises the retry
      overlay. canplay / playing clears the slate.
   Appended at the end per the sandbox-slice rule; the watch
   functions reach these helpers through typeof guards, and the
   wiring below is guarded per element. */
function btlPosterFor118(url, sport, title) {
  if (url && typeof btlPosters104 !== "undefined" && btlPosters104[url]) return btlPosters104[url];
  if (typeof btlPlaceholderPoster111 === "function") return btlPlaceholderPoster111(cap(sport || ""), title || "");
  return "";
}
function btlSelNote118(player, play) {
  if (!player || !play) return;
  try {
    player.dataset.btlSelUrl118 = play.media_url || "";
    player.dataset.btlSelSport118 = play.sport || "";
    player.dataset.btlSelTitle118 = play.title || "";
    /* Round 119: stamp the clip's start offset (the black-intro
       map, btlStartOffset119) with the selection, so the seek
       helper and the play path's reloads can land past the black. */
    player.dataset.btlSelOffset119 = (typeof btlOffsetFor119 === "function") ? String(btlOffsetFor119(play) || "") : "";
  } catch (e) { /* the note is best-effort */ }
}
function btlBigPoster118(player, play) {
  if (!player || !play) return;
  // Round 124: the server poster (poster_url) is the first choice
  // on Battles surfaces too, and it is final — the player is
  // marked so the banking upgrade below never replaces it. The
  // banked frame / branded placeholder remains the fallback.
  const serverPoster = play.poster_url || "";
  const poster = serverPoster || btlPosterFor118(play.media_url || "", play.sport || "", play.title || "");
  if (!poster) return;
  try { player.dataset.posterServer124 = serverPoster ? "1" : ""; } catch (e) { /* best-effort */ }
  try { player.poster = poster; } catch (e) { /* the poster is a bonus */ }
  const box = typeof player.closest === "function" ? player.closest(".btl-player") : null;
  const fill = box ? box.querySelector("video.vfill") : null;
  if (fill) { try { fill.poster = poster; } catch (e) { /* bonus */ } }
}
function btlUpgradeBigPoster118(url) {
  if (!url || typeof btlPosters104 === "undefined") return;
  const actual = btlPosters104[url];
  if (!actual) return;
  ["btlPlayer", "dailyPlayer", "runPlayer"].forEach((id) => {
    const p = document.getElementById(id);
    if (!p || p.getAttribute("src") !== url) return;
    if (p.dataset && p.dataset.posterServer124 === "1") return; // Round 124: a server poster is final
    try { p.poster = actual; } catch (e) { /* bonus */ }
    const box = typeof p.closest === "function" ? p.closest(".btl-player") : null;
    const fill = box ? box.querySelector("video.vfill") : null;
    if (fill) { try { fill.poster = actual; } catch (e) { /* bonus */ } }
  });
}
function btlRetryBtn118(player) {
  const box = player && typeof player.closest === "function" ? player.closest(".btl-player") : null;
  if (!box) return null;
  let btn = box.querySelector(".btl-retry118");
  if (!btn) {
    btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btl-retry118";
    btn.textContent = "Couldn't load — tap to retry";
    btn.hidden = true;
    btn.setAttribute("aria-label", "Couldn't load this clip — tap to retry");
    btn.addEventListener("click", (ev) => { ev.preventDefault(); ev.stopPropagation(); btlPlayBig118(player, true); });
    box.appendChild(btn);
  }
  return btn;
}
function btlShowRetry118(player, show) {
  const btn = btlRetryBtn118(player);
  if (btn) btn.hidden = !show;
}
function btlPlayBig118(player, force) {
  if (!player) return;
  btlShowRetry118(player, false);
  /* Round 158: a battle starting silences every other
     audible player, so two sound-carrying players never
     overlap — the sibling big players on this same screen
     (a Daily left playing while a Quick battle starts),
     and any watch / studio / story player left running
     elsewhere. The target's own box (its blur fill rides
     with it) is exempt; cross-view sources were already
     silenced by the view sweeps on the way here, this is
     the same-screen catch. Every battle play funnels
     through this one hardened path, so the sweep lives
     here and nowhere else needs it. */
  if (typeof pauseMediaIn158 === "function") {
    const box158 = typeof player.closest === "function" ? player.closest(".btl-player") : null;
    pauseMediaIn158($("#viewBattles"), false, box158);
    pauseMediaIn158($("#playDetail"), false);
    pauseMediaIn158($("#hypeframe"), false);
    pauseMediaIn158($("#stories"), false);
  }
  const url = player.dataset.btlSelUrl118 || "";
  const reload = () => {
    if (url && player.getAttribute("src") !== url) { try { player.src = url; } catch (e) { /* best-effort */ } }
    try { player.load(); } catch (e) { /* best-effort */ }
    /* Round 119: load() lands back at 0 — a black-intro clip must
       not restart on its black frames after a recovery reload. */
    if (typeof btlSeekOffset119 === "function") btlSeekOffset119(player);
  };
  /* A broken element gets a fresh load BEFORE any play attempt:
     a media error, NETWORK_EMPTY (0) / NETWORK_NO_SOURCE (3), or
     readyState 0 with nothing loaded all mean play() alone would
     go nowhere. A forced call (the retry button) always reloads. */
  if (force || player.error || player.networkState === 0 || player.networkState === 3 || (player.readyState === 0 && !player.currentSrc)) reload();
  const go = (retried) => {
    let pr = null;
    try { pr = player.play(); } catch (e) { pr = Promise.reject(e); }
    if (pr && typeof pr.catch === "function") {
      pr.catch(() => {
        if (!retried) { reload(); go(true); }
        else btlShowRetry118(player, true);
      });
    }
  };
  go(false);
}
["btlPlayer", "dailyPlayer", "runPlayer"].forEach((id) => {
  const player = document.getElementById(id);
  if (!player) return;
  /* Round 119: the tap contract, made ordering-safe. Round 118's
     handler read player.paused AT CLICK TIME — but the native
     controls toggle play/pause BEFORE the click event reaches
     page handlers (the toggle is the media element's own internal
     handling, upstream of the host element's listeners). A tap on
     a PLAYING clip therefore arrived already-paused, and the
     handler "helpfully" played it again: pause could never hold,
     while play (toggled first, seen as playing) appeared to work.
     Intent is now judged from the state captured at POINTERDOWN,
     which precedes any native toggle:
       - playing at pointerdown → the tap means pause: the site
         does nothing, and the native pause stands;
       - paused at pointerdown → the tap means play: the hardened
         path runs (a duplicate native play() is harmless, and
         this path is the recovery when the element is in a state
         the native toggle cannot drive);
       - pointerdown in the native control bar (the bottom strip)
         → the native controls own the click entirely;
       - no pointerdown at all (keyboard / synthetic click) →
         left to the native controls alone.
     A user pause is thus never mistaken for a play request or an
     error, and the Round 118 retry overlay is untouched. */
  let btlTap119 = null;
  player.addEventListener("pointerdown", (ev) => {
    if (!ev || ev.isPrimary === false || (typeof ev.button === "number" && ev.button !== 0)) { btlTap119 = null; return; }
    let ctrl = false;
    try {
      const r = player.getBoundingClientRect();
      if (r && r.height > 0 && typeof ev.clientY === "number") ctrl = (ev.clientY - r.top) > (r.height - 52);
    } catch (e) { /* geometry is best-effort */ }
    btlTap119 = { playing: !player.paused, ctrl, t: Date.now() };
  });
  player.addEventListener("pointercancel", () => { btlTap119 = null; });
  player.addEventListener("click", () => {
    const tap = btlTap119; btlTap119 = null;
    if (!tap) return;
    if (Date.now() - tap.t > 1000) return;
    if (tap.ctrl || tap.playing) return;
    if (!player.dataset.btlSelUrl118) return;
    btlPlayBig118(player, false);
  });
  /* One silent reload per failing URL; the second failure for the
     same URL surfaces the retry overlay. Errors from a torn-down
     previous selection (src already moved on) are ignored. */
  player.addEventListener("error", () => {
    const url = player.dataset.btlSelUrl118 || "";
    if (!url || player.getAttribute("src") !== url) return;
    if (player.dataset.btlErrUrl118 === url) { btlShowRetry118(player, true); return; }
    player.dataset.btlErrUrl118 = url;
    try { player.load(); } catch (e) { /* best-effort */ }
    /* Round 119: the silent reload lands at 0 like any load() —
       re-apply the noted offset so an offset clip recovers past
       its black intro, not on it. */
    if (typeof btlSeekOffset119 === "function") btlSeekOffset119(player);
  });
  ["canplay", "playing"].forEach((ev) => player.addEventListener(ev, () => {
    delete player.dataset.btlErrUrl118;
    btlShowRetry118(player, false);
  }));
});

/* ---------------- Round 119 (2026-11-12): Battles — pause must
   hold, and black-intro clips start past the black. Two fixes on
   the live v120 build, both from Emil's phone:

   1. PAUSE. Once Charlotte's clip started in the big player, no
      tap would pause it. The cause was Round 118's own surface
      handler: it read player.paused at click time, but the native
      controls toggle BEFORE the click reaches page handlers, so a
      pause tap arrived already-paused and the handler played the
      clip again (play only *appeared* fine — toggled first, seen
      as playing, handler stood down). The wiring above is
      corrected in place: intent is captured at pointerdown, and
      control-bar taps and pointer-less clicks belong to the
      native controls alone.

   2. BLACK INTRO. Charlotte's clip (play 50) opens with ~1s of
      black frames: the big player rested on black and playback
      started on black. This block is the per-play start-offset
      mechanism for the Battles big players ONLY (the Watch view
      and the feed never consult it):
      - btlStartOffset119 maps play id → seconds (50 → 1.5). Add
        a future play by adding a line here.
      - btlSelNote118 stamps the offset on the player with the
        selection; btlWatch / d100Watch then call
        btlSeekOffset119, which seeks as soon as metadata allows
        and BEFORE first playback — the resting frame and the
        first played frame both sit at the offset.
      - Every load() path re-applies it (btlPlayBig118's recovery
        reload and the error listener's silent reload), because a
        load() otherwise lands back at 0, on the black.
      - The poster pipeline freezes offset clips AT the offset:
        btlFreezeAt119(url) drives the Round 104 capture
        threshold / seek targets and the Round 111 frame-ready /
        retire points, so the banked poster is the first real
        frame instead of the black intro.
      Clips with no map entry behave exactly as before. */
const btlStartOffset119 = { 50: 1.5 };
function btlOffsetFor119(play) {
  if (!play) return 0;
  const off = btlStartOffset119[play.id];
  return (typeof off === "number" && off > 0) ? off : 0;
}
function btlOffsetForUrl119(url) {
  if (!url) return 0;
  try {
    const lists = [ALL_PLAYS, (typeof CONTEST !== "undefined" && CONTEST && CONTEST.entries) || []];
    for (const list of lists) {
      for (const p of list) { if (p && p.media_url === url) { const o = btlOffsetFor119(p); if (o) return o; } }
    }
  } catch (e) { /* the lookup is best-effort */ }
  return 0;
}
/* The freeze point for a clip's poster pipeline: the offset for
   mapped clips (freeze on the first real frame), the stock 0.5s
   for everything else. */
function btlFreezeAt119(url) {
  const o = btlOffsetForUrl119(url);
  return o > 0 ? o : 0.5;
}
/* Seek a big player to its noted selection offset. Reads the
   CURRENT note at fire time, so a stale registration from an
   earlier selection can never seek a newer clip to an old offset;
   registers a one-time metadata listener when the data isn't in
   yet, which is what puts the seek before first playback. */
function btlSeekOffset119(player) {
  if (!player) return;
  const doSeek = () => {
    const off = parseFloat((player.dataset && player.dataset.btlSelOffset119) || "0") || 0;
    if (!off) return;
    if (player.readyState >= 1 && player.currentTime < off - 0.05) {
      try { player.currentTime = off; } catch (e) { /* seeking is best-effort */ }
    }
  };
  if (player.readyState >= 1) doSeek();
  player.addEventListener("loadedmetadata", function btlOffMeta119() {
    player.removeEventListener("loadedmetadata", btlOffMeta119);
    doSeek();
  });
}

/* ---------------- Round 123 (2026-11-12): posters on every
   surface, the contest strip's move, one upload label. From the
   outside review Emil approved: (1) clicking Watch Highlights
   could land on a big black preview — Battles got posters in
   Round 118, the board/watch/athlete surfaces never did; (2) the
   Watch feed should lead with plays, the contest banner belongs
   inside its own tab; (3) every upload CTA should read the same
   words — "Post a Play" (the label sweep itself is markup, in
   index.html). Appended at the end per the sandbox-slice rule;
   the renderers reach these helpers through typeof guards. */

/* The poster attribute set for a play's <video>: Round 124's
   server-generated poster (poster_url) is the FIRST choice — it
   is the play's freeze-point frame, extracted server-side, and
   it is final (no data hook: the banking upgrade never replaces
   it). Without one, the Round 104 banked frame when one exists,
   else the Round 111 branded placeholder — plus the data hook
   the upgrade pass matches on. Non-video plays get nothing. Any
   failure degrades to no attribute (the pre-123 behavior),
   never a broken render. */
function posterAttr123(h) {
  try {
    if (!h) return "";
    const isVid = h.media_kind === "link_video" || (h.media_kind === "file" && !(h.mime || "").startsWith("image/"));
    if (!isVid || !h.media_url) return "";
    if (h.poster_url) return ` poster="${esc(h.poster_url)}"`;
    if (typeof btlPosterFor118 !== "function") return "";
    const p = btlPosterFor118(h.media_url, h.sport || "", h.title || "");
    if (!p) return "";
    return ` poster="${p}" data-poster123="${esc(h.media_url)}"`;
  } catch (e) { return ""; }
}
/* When a frame banks (btlCapturePoster104 calls this next to the
   Round 118 big-player upgrade), every surface video wearing
   that clip — board tiles, the watch player, athlete cards, and
   any vfill clone (cloneNode carries the data hook) — swaps its
   placeholder for the real frame. */
function upgradeSurfacePosters123(url) {
  try {
    if (!url || typeof btlPosters104 === "undefined") return;
    const actual = btlPosters104[url];
    if (!actual) return;
    document.querySelectorAll("video[data-poster123]").forEach((v) => {
      if (v.getAttribute("data-poster123") === url) { try { v.poster = actual; } catch (e) { /* bonus */ } }
      /* Round 134: a Month featured preview's poster-IMAGE fill
         (img.pfill134, markPosterFill134) wears the same frame —
         when the bank upgrades the video's poster, the fill
         upgrades with it, so the blur behind the clip is never
         a stale placeholder. */
      if (v.getAttribute("data-poster123") === url) { try { const f = v.parentElement ? v.parentElement.querySelector("img.pfill134") : null; if (f) f.src = actual; } catch (e) { /* bonus */ } }
    });
  } catch (e) { /* the upgrade is a bonus, never a breaker */ }
}
/* Board banking (wired from hydrateDurPills): a tile video that
   plays past its freeze point — the offset for mapped clips, the
   stock 0.5s otherwise — banks its frame into btlPosters104 via
   the same capture the Battles wiring uses (black frames are
   rejected inside the capture itself). One wiring per element;
   a banked URL is never re-wired. */
function bankSurfaceFrame123(v) {
  try {
    if (!v || typeof v.addEventListener !== "function" || !v.dataset || v.dataset.bankWired123 === "1") return;
    /* Round 192: bank under the MASTER url, not the element's
       src — a rendition-carrying tile's src is the stream file,
       but every poster lookup (btlPosterFor118) keys on
       media_url. posterAttr123 already stamps the master url
       on exactly the elements that need banking (the
       data-poster123 hook), so prefer it when present. */
    const url = v.getAttribute("data-poster123") || v.getAttribute("src") || "";
    if (!url) return;
    if (typeof btlPosters104 !== "undefined" && btlPosters104[url]) return;
    v.dataset.bankWired123 = "1";
    const fz = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(url) : 0.5;
    const cap = () => {
      if (v.currentTime >= fz) {
        if (typeof btlCapturePoster104 === "function") btlCapturePoster104(v);
        try { v.removeEventListener("timeupdate", cap); } catch (e) { /* fine */ }
      }
    };
    v.addEventListener("timeupdate", cap);
    if (typeof setTimeout === "function") setTimeout(() => { try { v.removeEventListener("timeupdate", cap); } catch (e) { /* fine */ } }, 12000);
  } catch (e) { /* banking from the board is a bonus */ }
}
/* Watch-detail wiring (called from renderPlayDetail): confirm the
   player's poster at open, stamp the play's start offset from
   the SINGLE map (btlStartOffset119, read through btlOffsetFor119)
   and seek with the Round 119 helper before playback settles —
   then bank the clip's frame at its freeze point as it plays, so
   the poster upgrades from placeholder to the action frame (at
   the offset for mapped clips) in place. */
function wireWatch123(body, play) {
  try {
    if (!body || !play || typeof body.querySelector !== "function") return;
    const box = body.querySelector(".watch-player");
    if (!box) return;
    const video = box.querySelector("video:not(.vfill)");
    if (!video) return;
    // Round 124: the server poster wins at open too; the banked
    // frame / placeholder is the fallback for plays without one.
    const p = play.poster_url || (typeof btlPosterFor118 === "function" ? btlPosterFor118(play.media_url || "", play.sport || "", play.title || "") : "");
    if (p) { try { video.poster = p; } catch (e) { /* bonus */ } }
    const off = (typeof btlOffsetFor119 === "function") ? btlOffsetFor119(play) : 0;
    if (off > 0) {
      try { video.dataset.btlSelOffset119 = String(off); } catch (e) { /* best-effort */ }
      if (typeof btlSeekOffset119 === "function") btlSeekOffset119(video);
    }
    const url = play.media_url || video.getAttribute("src") || "";
    if (!url || typeof video.addEventListener !== "function") return;
    if (typeof btlPosters104 !== "undefined" && btlPosters104[url]) return;
    const fz = (typeof btlFreezeAt119 === "function") ? btlFreezeAt119(url) : 0.5;
    const cap = () => {
      if (video.currentTime >= fz) {
        if (typeof btlCapturePoster104 === "function") btlCapturePoster104(video);
        try { video.removeEventListener("timeupdate", cap); } catch (e) { /* fine */ }
      }
    };
    video.addEventListener("timeupdate", cap);
    if (typeof setTimeout === "function") setTimeout(() => { try { video.removeEventListener("timeupdate", cap); } catch (e) { /* fine */ } }, 8000);
  } catch (e) { /* the wiring is a bonus, never a breaker */ }
}
/* Round 140 (2026-11-13): the play detail's native player chrome
   never faded on Emil's iPhone — open a play and the big center
   pause cluster (with the rest of the native bar) sat on the
   picture for the whole clip: "it starts playing but the pause
   is on stays there." The detail video is a plain native-controls
   element (mediaHtml) with no app overlay of its own, so the app
   now manages the chrome's visibility itself, standard-player
   style: while the clip is PLAYING, the controls attribute is
   removed ~2s after playback starts and the whole native bar —
   center cluster included — goes with it; PAUSE (or the clip
   ending) brings it straight back and it stays while paused; a
   tap on the bare picture, or a mouse move over the player on
   desktop, brings it back and re-arms the fade. The controls
   themselves are untouched: same native scrubber, mute and
   fullscreen buttons, just not parked on the picture. As built
   in Round 140 this covered the detail player only — board
   tiles rest on posters (Round 133) and the Battles big
   player was left out (its own tap-to-play wiring).
   Round 143 (2026-11-13): Emil, in Quick Battles — "it's also
   delayed before the pause button goes away." The fade core
   is now ONE shared helper, attachChromeFade143(video, box):
   wireWatchChrome140 delegates to it for the detail player
   (rewire-per-render lifecycle — its element is rebuilt per
   open), and wireBtlChrome143 (below) wires the three Battles
   big players to it once at startup — #btlPlayer (Quick),
   #dailyPlayer (Daily), #runPlayer (Battle Run), the
   persistent native-controls players; their clip changes,
   picks and pauses all surface as play/pause events on the
   same element, which is all the helper follows. Same ~2s
   fade, same restore on pause/tap. The Battles minis never
   carried native chrome (muted frame-grab previews), so
   there is nothing to fade on them. */
/* Round 148 (2026-11-13): watchChromeVideo140 / watchChromeOff140
   are DECLARED up by hidePlayDetail (the detail-close state block
   above it), not here — hidePlayDetail runs during boot() on the
   page-sub routes (/my-highlights, /how-it-works, /stories) via
   showPanel, long before execution reaches this Round 140 block,
   and reading a `let` in its TDZ threw "Cannot access
   'watchChromeOff140' before initialization", killing boot and
   leaving those pages on the empty plays panel. The functions
   stay here; only the declarations moved. */
function teardownWatchChrome140() {
  if (watchChromeOff140) { try { watchChromeOff140(); } catch (e) { /* fine */ } watchChromeOff140 = null; }
  watchChromeVideo140 = null;
}
function wireWatchChrome140(body) {
  teardownWatchChrome140();
  if (!body || typeof body.querySelector !== "function") return;
  const box = body.querySelector(".watch-player");
  if (!box) return;
  const video = box.querySelector("video:not(.vfill)");
  if (!video || typeof video.addEventListener !== "function") return;
  watchChromeVideo140 = video;
  /* Round 143: the fade itself lives in the shared helper
     below; this wrapper keeps the detail player's lifecycle —
     tear the previous open's wiring down, attach fresh. */
  watchChromeOff140 = attachChromeFade143(video, box);
}
/* The shared chrome fade (Rounds 140 + 143): attach to ONE
   native-controls video and its hover box; returns a teardown
   that clears any pending fade, detaches the listeners and
   restores the controls. While the clip plays, the controls
   attribute drops ~2s in; pause/ended restores it at once and
   it stays; a tap on the bare picture (or a desktop mouse
   move) brings it back and re-arms the fade. */
function attachChromeFade143(video, hoverBox) {
  if (!video || typeof video.addEventListener !== "function") return function () {};
  let chromeTimer143 = 0;
  const HIDE_MS140 = 2000;
  const arm140 = () => {
    if (chromeTimer143) { try { clearTimeout(chromeTimer143); } catch (e) { /* fine */ } chromeTimer143 = 0; }
    if (video.paused || video.ended) return;
    chromeTimer143 = setTimeout(() => {
      chromeTimer143 = 0;
      if (!video.paused && !video.ended) { try { video.removeAttribute("controls"); } catch (e) { /* fine */ } }
    }, HIDE_MS140);
  };
  const show140 = () => {
    if (chromeTimer143) { try { clearTimeout(chromeTimer143); } catch (e) { /* fine */ } chromeTimer143 = 0; }
    try { video.setAttribute("controls", ""); } catch (e) { /* fine */ }
  };
  const onPlay140 = () => arm140();
  const onPause140 = () => show140();
  const onTap140 = () => { try { if (!video.hasAttribute("controls")) { show140(); arm140(); } } catch (e) { /* fine */ } };
  const onMove140 = () => { try { if (!video.paused && !video.hasAttribute("controls")) { show140(); arm140(); } } catch (e) { /* fine */ } };
  video.addEventListener("play", onPlay140);
  video.addEventListener("playing", onPlay140);
  video.addEventListener("pause", onPause140);
  video.addEventListener("ended", onPause140);
  video.addEventListener("click", onTap140);
  if (hoverBox && typeof hoverBox.addEventListener === "function") hoverBox.addEventListener("mousemove", onMove140);
  arm140(); // autoplay may already be running by the time this wires
  return function teardownChromeFade143() {
    if (chromeTimer143) { try { clearTimeout(chromeTimer143); } catch (e) { /* fine */ } chromeTimer143 = 0; }
    video.removeEventListener("play", onPlay140);
    video.removeEventListener("playing", onPlay140);
    video.removeEventListener("pause", onPause140);
    video.removeEventListener("ended", onPause140);
    video.removeEventListener("click", onTap140);
    if (hoverBox && typeof hoverBox.removeEventListener === "function") hoverBox.removeEventListener("mousemove", onMove140);
    try { video.setAttribute("controls", ""); } catch (e) { /* fine */ }
  };
}
/* The slim contest line on Watch: a tap opens the Month board,
   with the Round 122 scroll so the tap visibly lands somewhere. */
$("#contestSlim123")?.addEventListener("click", () => { switchView("month"); scrollBoardIntoView122(); $("#contestSlim123")?.blur(); });

/* Round 143 (2026-11-13): the Battles big players get the same
   chrome fade as the play detail (attachChromeFade143, above).
   The three players are persistent elements — never rebuilt —
   so each is wired ONCE here; every later clip change flows
   through the same element, and playing / pausing / a pick all
   surface as the play/pause events the helper already follows
   (btlPick and the Daily/Run picks pause their player, which
   restores the chrome; a tap on the faded picture brings it
   back and re-arms). No mechanics change: the R118 self-tap
   handler (a tap while PAUSED plays the loaded clip) is
   untouched — the fade's tap handler acts only while playing
   with the chrome down, the one state R118 ignores. */
function wireBtlChrome143() {
  ["btlPlayer", "dailyPlayer", "runPlayer"].forEach((id) => {
    const player = document.getElementById(id);
    if (!player) return;
    const box = typeof player.closest === "function" ? player.closest(".btl-player") : null;
    attachChromeFade143(player, box || player);
  });
}
wireBtlChrome143();

/* ============ Round 161 (2026-11-14): installable web app (PWA)
   Emil: "Let's try this" — the middle path between the browser
   and a native app. Three client pieces, all fail-safe (a
   PWA problem must never break the page):
   1. registerSW161 — registers /sw.js on window load. The
      worker is conservative: network-first HTML, cache-first
      only for ?v=-pinned assets + brand images/icons, and it
      never touches /api, media or /moderate (see sw.js; its
      cache version constant is HH_SW_VERSION — bump it WITH
      the ?v= pin).
   2. a2hsGate161 — the pure show/don't-show decision for the
      Add to Home Screen hint (kept pure so §69 can run it in
      a vm): never when already standalone, never after a
      dismissal, never in a first visit's first seconds — a
      return visit (visits >= 2) earns it at once, a first
      visit after ~25s. Then: a captured Chromium install
      prompt wins ("prompt"); iOS Safari, which has no prompt,
      gets the Share-sheet walkthrough ("ios"); anything else
      (Android with no prompt event) shows nothing rather than
      dead instructions.
   3. initA2HS161 — the wiring: counts visits in the safe
      storage helper, captures beforeinstallprompt, fires it
      from the bar's button, expands the iOS steps, and treats
      ✕ / a completed install as a permanent dismissal. */
function registerSW161() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const doRegister161 = () => {
      try {
        const reg161 = navigator.serviceWorker.register("/sw.js");
        if (reg161 && reg161.catch) reg161.catch(() => { /* a failed worker never breaks the page */ });
      } catch { /* fine */ }
    };
    if (document.readyState === "complete") doRegister161();
    else window.addEventListener("load", doRegister161);
  } catch { /* fine */ }
}
registerSW161();

function a2hsGate161(env) {
  if (!env || env.standalone || env.dismissed) return "";
  if (env.visits < 2 && env.elapsedMs < 25000) return "";
  if (env.hasPrompt) return "prompt";
  if (env.isIOS) return "ios";
  return "";
}

function a2hsStandalone161() {
  try {
    if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches) return true;
    return typeof navigator !== "undefined" && navigator.standalone === true;
  } catch { return false; }
}
function a2hsIsIOS161() {
  try {
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    if (!/iPhone|iPad|iPod/i.test(ua)) return false;
    if (/Instagram|FBAN|FBAV|CriOS|FxiOS|EdgiOS/i.test(ua)) return false;
    return true;
  } catch { return false; }
}

function initA2HS161() {
  const bar = document.getElementById("a2hsBar161");
  if (!bar) return;
  const btn = document.getElementById("a2hsBtn161");
  const xBtn = document.getElementById("a2hsX161");
  const steps = document.getElementById("a2hsSteps161");
  const startedAt161 = Date.now();
  let visits161 = 0;
  try { visits161 = parseInt(hhStorageGet("hh_a2hs_visits161") || "0", 10) || 0; } catch { visits161 = 0; }
  visits161 += 1;
  try { hhStorageSet("hh_a2hs_visits161", String(visits161)); } catch { /* fine */ }
  let prompt161 = null;
  let shown161 = "";
  const hide161 = (permanent) => {
    bar.hidden = true;
    document.body.classList.remove("a2hs-open161");
    document.body.classList.remove("a2hs-steps161");
    shown161 = "";
    if (permanent) { try { hhStorageSet("hh_a2hs_dismissed161", "1"); } catch { /* fine */ } }
  };
  const evaluate161 = () => {
    if (shown161) return;
    let dismissed161 = false;
    try { dismissed161 = hhStorageGet("hh_a2hs_dismissed161") === "1"; } catch { dismissed161 = false; }
    const mode161 = a2hsGate161({
      standalone: a2hsStandalone161(),
      dismissed: dismissed161,
      visits: visits161,
      elapsedMs: Date.now() - startedAt161,
      hasPrompt: !!prompt161,
      isIOS: a2hsIsIOS161(),
    });
    if (!mode161) return;
    shown161 = mode161;
    if (btn) btn.textContent = mode161 === "prompt" ? "Install" : "How";
    bar.hidden = false;
    document.body.classList.add("a2hs-open161");
  };
  window.addEventListener("beforeinstallprompt", (e) => {
    try { e.preventDefault(); } catch { /* fine */ }
    prompt161 = e;
    evaluate161();
  });
  window.addEventListener("appinstalled", () => hide161(true));
  if (btn) btn.addEventListener("click", async () => {
    if (shown161 === "prompt" && prompt161) {
      try {
        prompt161.prompt();
        const choice161 = await prompt161.userChoice;
        prompt161 = null;
        if (choice161 && choice161.outcome === "accepted") hide161(true);
        else hide161(false);
      } catch { hide161(false); }
    } else if (shown161 === "ios" && steps) {
      const open161 = steps.hidden;
      steps.hidden = !open161;
      document.body.classList.toggle("a2hs-steps161", open161);
    }
  });
  if (xBtn) xBtn.addEventListener("click", () => hide161(true));
  evaluate161();
  setTimeout(evaluate161, 25000);
}
initA2HS161();


/* Round 189 (2026-11-25): the watch feed — a TikTok-style
   full-screen mode inside Watch, built exactly as mocked and
   approved by Emil (feed-mock-2026-11-25). The boards do not
   change: tapping a play on a board (Watch tiles, Hype of the
   Month rows) opens the feed AT that play, and swiping walks
   the plays OF THE BOARD THE VISITOR CAME FROM, in the board's
   own rendered order — read off the board's DOM ([data-tile-id]
   in document order), NEVER re-sorted here. Fair order is a
   hard rule: votes decide winners and votes are never sold, so
   the feed carries no engagement ranking and no algorithmic
   recommendations. The feed is FINITE: after the board's last
   play it ends on the "You're all caught up" card — no infinite
   scroll. Battles get the head-to-head treatment: entered from
   the Battles view, the current Quick Battles pair becomes two
   slides wearing the BATTLE ribbon and the VS bar, swiping
   moves to the opponent's play, and hyping from inside the
   feed goes through the SAME toggleVote as every other surface
   (the real vote endpoint — a feed hype counts identically
   everywhere; Quick Battle PICKS stay just-for-fun, untouched).
   Videos play at their OWN aspect (object-fit: contain) over a
   blurred, darkened copy of the play's own poster — never
   force-cropped; muted autoplay for the in-view slide follows
   the site's existing preview behavior, off-view slides pause.
   Photo plays ride the same frame as a still — no broken
   player, and they keep their place in the board's sequence.
   Music: the chip renders ONLY when a play carries a track
   name (h.musicTrack — a server field that is empty on every
   play today; no licensed library exists yet, so there is NO
   picker and NO placeholder track anywhere in this block).
   Share rides the real sharePlay — the play's PUBLIC #play-
   link, never a moderation link. Kill switch: HH_NO_FEED=1
   makes the server stamp window.HH_NO_FEED189 into index.html;
   every entry point here then stands down and board taps keep
   the classic openPlayDetail path, exactly as before the feed
   existed. Appended at the end of app.js per the sandbox-slice
   rule; every element lookup is guarded and every cross-block
   call is typeof-guarded, so partial slices behave as before.
   Round 191 (2026-11-25, the design review Emil approved):
   the feed's chrome slims and the play takes the visual
   weight. (1) The header (index.html) is now a small HH crest
   + slim Watch/Battles tabs + close — Hype of the Month is
   out of the feed header. (2) Slides are classified by their
   REAL shape (feedShape191/feedWireShape191 below): portrait
   clips FILL the viewer; wide GameChanger clips run
   edge-to-edge with the ENTIRE frame visible (never cropped)
   and their caption sits directly BELOW the video band — the
   blurred-fill backdrop is gone for both classified shapes.
   (3) The swipe hint reads "↑ Swipe up for the next play",
   sits in its own space clear of every caption, shows ONCE
   per page session (feed191.hintSeen), then fades and never
   reappears. (4) The rail vote button wears the brand's gold
   crown (public/crown.png, the standalone crown asset the
   site ships) instead of the emoji crown. (5) Captions are
   TITLE-first: the play's title is the first line, then
   "Athlete · Sport" — a title-less play falls back to
   name-first. Everything else — board order, the finite end
   card, toggleVote, the kill switch — is exactly as built.
   Round 193 (2026-11-25): swipe latency — neighbor
   preloading + mid-swipe early playback (feed193 below).
   Round 194 (2026-11-25): the feed's sound toggle
   (feed194 below) — the speaker button in the top bar,
   left of the close button.
   Round 196 (2026-11-26): extra-wide clips — wider than
   16:9, like Juliana's 960×444 — get a blurred, blown-up
   copy of the SAME video filling the whole slide behind
   the sharp one (feed196 below); the sharp video, the
   caption placement and every other shape are exactly as
   Round 191 left them.
   Round 198 (2026-11-26): the settle guarantee + hint
   stacking (feed198 below) — Round 196's fill is the first
   full-screen, continuously playing, filtered + transformed
   VIDEO layer inside a snap slide, and on Emil's iPhone the
   native snap could lose its point around it: swipes came
   to rest between slides and the swipe hint went missing.
   The DOM/CSS contract itself never broke (slides are
   exactly one track-height; snap points sit at exact
   multiples), so Round 198 enforces the settle in JS and
   pins the hint's stacking in CSS rather than trusting the
   engine's compositor.
   Round 203 (2026-11-26): the shape threshold moves —
   "portrait" now means properly tall (see feedShape191
   below), because Round 203's action-band reframe can
   hand the feed a near-square clip whose whole frame
   must survive. */
const feed189 = { open: false, kind: "board", ids: [], index: -1, start: 0, battle: null, counted: new Set() };
const feed191 = { hintSeen: false };
/* Round 193 (2026-11-25): the slight delay between swipes.
   A swiped-to slide used to start cold — preload="metadata"
   only, and playback began when the scroll SETTLED — so every
   swipe paid a network fetch before its first frame. Two
   changes, both inside this block:
   (1) feedWarm193 keeps the settled slide's neighborhood
   (±2) at preload="auto" with load() called, so the next
   swipe's video is already buffered; slides that fall out of
   the neighborhood stand back down to preload="metadata".
   Warming runs only while the feed is open — nothing is
   preloaded on the boards behind it.
   (2) feedObserve193's IntersectionObserver starts an
   incoming slide's playback the moment it is mostly visible
   (threshold 0.5) instead of waiting for the settle.
   feedActivate189 remains the single source of truth for the
   current index, view counting (feed189.counted / play_open),
   hint dismissal and pausing: the early path only ever PLAYS
   a not-yet-active slide and records it in feed193.early,
   and the settle pass plays the settled slide and pauses
   every other — so a view is still counted exactly once and
   two videos never keep playing once a swipe lands. Where
   IntersectionObserver is unavailable there is no early
   path and the feed behaves exactly as before. The poster
   attribute already rides every video slide, so the poster
   visual holds until the first frame — no black flash to
   fix in markup. */
const feed193 = { early: new Set(), observer: null };
/* Round 194 (2026-11-25): the feed's sound toggle. Emil,
   swiping the feed: "I am not hearing anything play from
   the videos." He was right — every feed video renders
   with the muted attribute (feedMediaHtml189) and the feed
   offered no way to turn sound on. The fix is a speaker
   button in the top bar (index.html, left of the close
   button; two inline SVGs, the .sound-on class picks which
   shows). The rules:
   - Muted stays the DEFAULT: a fresh feed session starts
     with sound off (autoplay policy + courtesy), and the
     markup keeps rendering muted — sound is a runtime
     state applied to the elements, never a markup change.
   - feed194.sound is the single source of truth. It is
     seeded from the saved preference (hhFeedSound, through
     the app's safe-storage helpers) and re-read at every
     feed open; the toggle flips it, persists it, applies
     it to EVERY video in the track at once (the playing
     one unmutes in place — no restart) and re-syncs the
     button.
   - Every path that can start a video applies the state
     BEFORE it plays — feedActivate189 (the settle),
     feedObserve193 (the mid-swipe early start) and
     feedWarm193 (the neighborhood warm) all run each video
     through feedApplySound194 — so a video that starts
     after sound was enabled plays WITH sound, on board
     slides and battle slides alike.
   - Autoplay honesty: a saved ON preference cannot force
     audible autoplay where the browser demands a gesture
     first — a refused play() is swallowed exactly as
     before and the poster rests; the toggle is always one
     tap away in the top bar and tapping it IS a gesture.
     No silent-audio unlock tricks, deliberately. */
function feedSoundPref194() {
  try { return typeof hhStorageGet === "function" && hhStorageGet("hhFeedSound") === "on"; } catch (e) { return false; }
}
const feed194 = { sound: feedSoundPref194() };
function feedApplySound194(v) {
  if (!v) return;
  /* Round 196: a blur-fill backdrop is ALWAYS muted — it is
     scenery, never a sound source — so the sound state never
     reaches it, whichever way the toggle sits. */
  try { if (typeof v.getAttribute === "function" && v.getAttribute("data-feed-fill")) { v.muted = true; return; } } catch (e) {}
  try { v.muted = !feed194.sound; } catch (e) { /* a video that refuses a mute flip never breaks the feed */ }
}
function feedSyncSoundBtn194() {
  try {
    const btn = typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById("feedSound194") : null;
    if (!btn) return;
    if (btn.classList && typeof btn.classList.toggle === "function") btn.classList.toggle("sound-on", !!feed194.sound);
    if (typeof btn.setAttribute === "function") {
      btn.setAttribute("aria-pressed", feed194.sound ? "true" : "false");
      btn.setAttribute("aria-label", feed194.sound ? "Turn sound off" : "Turn sound on");
    }
  } catch (e) { /* the button is chrome — a sync hiccup never breaks the feed */ }
}
window.feedToggleSound194 = () => {
  feed194.sound = !feed194.sound;
  try { if (typeof hhStorageSet === "function") hhStorageSet("hhFeedSound", feed194.sound ? "on" : "off"); } catch (e) { /* persistence is best-effort; the in-session state above still holds */ }
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (track && typeof track.querySelectorAll === "function") track.querySelectorAll("video").forEach((v) => feedApplySound194(v));
  feedSyncSoundBtn194();
};
function feedSlides193() {
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track || typeof track.querySelectorAll !== "function") return [];
  return [...track.querySelectorAll("[data-feed-slide], [data-feed-end]")];
}
function feedWarm193(index) {
  if (!feed189.open) return;
  feedSlides193().forEach((s, i) => {
    /* Round 196: the MAIN video is picked by name now — a
       wide slide can carry a blur-fill <video> ahead of it
       in the DOM, and the warm window belongs to the sharp
       copy. */
    const v = feedMainVideo196(s);
    /* Round 196: a slide's blur fill rides the SAME warm
       window — warmed (preload auto + load) inside ±2 so an
       incoming wide slide's backdrop is buffered too, and
       stood down outside it (preload metadata + paused) so
       far slides never hold a playing or fetching fill. */
    const fill = feedFillVideo196(s);
    if (fill) {
      try { fill.muted = true; } catch (e) {}
      try {
        if (Math.abs(i - index) <= 2) {
          if (fill.preload !== "auto") fill.preload = "auto";
          if (i !== index && typeof fill.load === "function") fill.load();
        } else {
          if (fill.preload !== "metadata") fill.preload = "metadata";
          try { fill.pause(); } catch (e) {}
        }
      } catch (e) { /* a fill that refuses a preload hint never breaks the feed */ }
    }
    if (!v) return;
    /* Round 194: a warmed video carries the current sound
       state before it can ever be played. */
    feedApplySound194(v);
    try {
      if (Math.abs(i - index) <= 2) {
        if (v.preload !== "auto") v.preload = "auto";
        if (i !== index && typeof v.load === "function") v.load();
      } else if (v.preload !== "metadata") v.preload = "metadata";
    } catch (e) { /* preload is a hint — a video that refuses it never breaks the feed */ }
  });
}
function feedObserve193() {
  if (typeof IntersectionObserver === "undefined") return;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track) return;
  try {
    if (!feed193.observer) {
      feed193.observer = new IntersectionObserver((entries) => {
        if (!feed189.open) return;
        const slides = feedSlides193();
        (entries || []).forEach((en) => {
          if (!en || !en.isIntersecting) return;
          const idx = slides.indexOf(en.target);
          if (idx < 0 || idx === feed189.index) return;
          const s = slides[idx];
          /* Round 196: the early start drives the MAIN video
             (a wide slide's fill rides along via feedFillPlay196,
             never instead of it). */
          const v = s ? feedMainVideo196(s) : null;
          if (!v) return;
          /* Round 194: the early start applies the sound
             state BEFORE it plays — an early-started video
             is never a muted surprise after sound was on. */
          feedApplySound194(v);
          feed193.early.add(idx);
          try { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* a refused early play: the settle pass plays it instead */ }
          /* Round 196: the incoming wide slide's backdrop
             starts with it, so the fill is already moving
             when the swipe lands. */
          feedFillPlay196(feedFillVideo196(s), v);
        });
      }, { root: track, threshold: 0.5 });
    }
    feed193.observer.disconnect();
    feedSlides193().forEach((s) => { try { feed193.observer.observe(s); } catch (e) {} });
  } catch (e) { feed193.observer = null; }
}
function feedEnabled189() { return !(typeof window !== "undefined" && window && window.HH_NO_FEED189); }
/* The sequence builder — PURE on purpose (the suites drive it
   in a vm): the board's ids, in the board's order, untouched,
   plus the index of the tapped play. An unknown start id
   returns null and the caller falls back to the classic
   detail, so a stale board can never open a wrong feed. */
function feedSequence189(boardIds, startId) {
  const ids = (Array.isArray(boardIds) ? boardIds : []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  const start = ids.indexOf(Number(startId));
  if (!ids.length || start < 0) return null;
  return { ids, start };
}
/* The board's order, read off its rendered DOM: the tiles and
   rows of the board the tapped element lives in, in document
   order. This is the board's existing order BY CONSTRUCTION —
   the feed inherits it and never computes one of its own. */
function feedBoardIds189(el) {
  try {
    if (!el || typeof el.closest !== "function") return null;
    const host = el.closest("#allBoard, #monthRows");
    if (!host || typeof host.querySelectorAll !== "function") return null;
    const ids = [...host.querySelectorAll("[data-tile-id]")].map((n) => Number(typeof n.getAttribute === "function" ? n.getAttribute("data-tile-id") : 0)).filter((n) => n > 0);
    return ids.length ? ids : null;
  } catch (e) { return null; }
}
function feedSlideKind189(h) {
  if (!h) return "link";
  if (h.media_kind === "file" && (h.mime || "").startsWith("image/")) return "photo";
  if (h.media_kind === "link_embed") return "embed";
  const hasVideo = typeof playHasVideo === "function" ? playHasVideo(h) : (h.media_kind === "file" || h.media_kind === "link_video");
  return hasVideo ? "video" : "link";
}
/* Round 191: the slide's shape from the media's real pixel
   dimensions — a portrait clip fills the viewer; anything
   else takes the "landscape" wide-band treatment (the whole
   frame visible, caption below the band). PURE on purpose
   (the suites drive it in a vm).
   Round 203 (2026-11-26): "portrait" now means PROPERLY
   tall — H at least 1.25× W (integer math: H * 4 >= W * 5).
   Round 203's action-band reframe can hand the feed a
   near-square clip (a 720×1280 sky-heavy upload reframed
   to 720×768); under the old taller-than-wide rule that
   clip took the portrait cover treatment and the feed
   side-cropped ~40% of it away — the athlete the reframe
   exists to center could be cut. Near-square clips now
   ride the band treatment and keep their whole frame.
   True phone portraits are unaffected (720×1280 and even
   a 3:4 clip's 720×960 still classify portrait). */
function feedShape191(w, h) {
  const W = Number(w) || 0, H = Number(h) || 0;
  if (!W || !H) return "";
  return H * 4 >= W * 5 ? "portrait" : "landscape";
}
function feedApplyShape191(slide, w, h) {
  if (!slide) return "";
  const shape = feedShape191(w, h);
  if (!shape) return "";
  try { if (slide.dataset) slide.dataset.feedShape = shape; } catch (e) {}
  if (slide.classList && typeof slide.classList.toggle === "function") {
    slide.classList.toggle("feed191-portrait", shape === "portrait");
    slide.classList.toggle("feed191-wide", shape === "landscape");
  }
  return shape;
}
/* Round 191: wire one rendered slide's shape classification.
   The video's loadedmetadata dimensions are the truth; the
   POSTER's dimensions are the pre-metadata stand-in so the
   layout settles before the video can report (a poster answer
   never overrides a metadata answer). Photo plays classify
   off their own image. Embed/link slides keep the Round 189
   treatment — there are no pixels of ours to measure. Every
   lookup is guarded; a stub or a partial slice just never
   classifies and the slide keeps the base layout. */
function feedWireShape191(slide) {
  try {
    if (!slide || typeof slide.querySelector !== "function") return;
    const kind = typeof slide.getAttribute === "function" ? slide.getAttribute("data-feed-kind") : "";
    const media = slide.querySelector("video, img");
    if (!media) return;
    let metaDone = false;
    const applyMeta = (w, h) => { if (Number(w) > 0 && Number(h) > 0) { metaDone = true; feedApplyShape191(slide, w, h); } };
    const applyStandIn = (w, h) => { if (!metaDone && Number(w) > 0 && Number(h) > 0) feedApplyShape191(slide, w, h); };
    if (kind === "video") {
      if (typeof media.addEventListener === "function") media.addEventListener("loadedmetadata", () => applyMeta(media.videoWidth, media.videoHeight));
      if (media.videoWidth > 0) applyMeta(media.videoWidth, media.videoHeight);
      const poster = typeof media.getAttribute === "function" ? media.getAttribute("poster") : "";
      if (poster && typeof Image !== "undefined") {
        const probe = new Image();
        probe.onload = () => applyStandIn(probe.naturalWidth, probe.naturalHeight);
        probe.src = poster;
      }
    } else if (kind === "photo") {
      if (typeof media.addEventListener === "function") media.addEventListener("load", () => applyMeta(media.naturalWidth, media.naturalHeight));
      if (media.complete && media.naturalWidth > 0) applyMeta(media.naturalWidth, media.naturalHeight);
    }
  } catch (e) { /* an unclassified slide keeps the base layout — classification never breaks the feed */ }
}
/* Round 196 (2026-11-26): the extra-wide blur fill. Round
   191 retired the blurred backdrop for classified shapes:
   portrait fills the viewer, and a wide clip runs edge-to-
   edge with its caption below the band — which leaves a
   clip WIDER than the viewer's own 16:9 (Juliana's 960×444
   "Caught stealing home!" is the case on the board) floating
   in dead space above and below its band. This round fills
   ONLY that case, exactly as mocked and approved:
   - Behind the sharp video, the whole slide is filled by a
     blown-up, blurred copy of the SAME video (the same R192
     rendition source), playing in loose sync — play/pause
     together, a one-time drift nudge at play time; no frame-
     sync machinery for a backdrop.
   - The sharp video is untouched: edge-to-edge full width,
     completely visible, never cropped; the caption stays
     directly below the band (the .feed191-wide layout).
   - At-or-narrower than 16:9 — portrait, square, standard
     landscape — gets NO fill element and NO behavior change.
   - Battle slides are left untouched, deliberately.
   - The fill is scenery: always muted (feedApplySound194
     refuses to unmute it), never counted (play_open still
     counts exactly once, in feedActivate189 alone), and it
     rides the Round 193 warm window — warmed inside ±2,
     stood down (metadata + paused) outside it.
   - Kill switch: HH_NO_FEEDFILL196=1 makes the server stamp
     window.HH_NO_FEEDFILL196 into index.html and no fill is
     ever built.
   The fill is created lazily — when the slide's real shape
   is known (loadedmetadata, with the poster probe as the
   pre-metadata stand-in, mirroring feedWireShape191) — so
   the rendered markup of every slide is byte-identical to
   Round 194 until a wide shape is proven. */
function feedFillEnabled196() { return !(typeof window !== "undefined" && window && window.HH_NO_FEEDFILL196); }
/* Wider than 16:9, strictly — a true 16:9 clip (1920×1080,
   1280×720) is NOT wide for this purpose. Integer cross-
   multiplication, no float fuzz. PURE on purpose. */
function feedIsWide196(w, h) {
  const W = Number(w) || 0, H = Number(h) || 0;
  if (!W || !H) return false;
  return W * 9 > H * 16;
}
function feedIsFill196(v) {
  try { return !!(v && typeof v.getAttribute === "function" && v.getAttribute("data-feed-fill")); } catch (e) { return false; }
}
/* A slide's blur fill, or null. Found by attribute, never by
   position — the fill sits BEFORE the media block in the
   DOM (it is the backdrop), so a bare querySelector("video")
   would return the scenery instead of the play. */
function feedFillVideo196(slide) {
  try {
    if (!slide || typeof slide.querySelectorAll !== "function") return null;
    const vs = slide.querySelectorAll("video");
    for (let i = 0; i < vs.length; i++) if (feedIsFill196(vs[i])) return vs[i];
  } catch (e) {}
  return null;
}
/* A slide's MAIN (sharp) video, or null — the first video
   that is not a fill. Falls back to the plain selector on
   partial slices whose stubs grow no fills. */
function feedMainVideo196(slide) {
  try {
    if (!slide) return null;
    if (typeof slide.querySelectorAll === "function") {
      const vs = slide.querySelectorAll("video");
      for (let i = 0; i < vs.length; i++) if (!feedIsFill196(vs[i])) return vs[i];
      return null;
    }
    if (typeof slide.querySelector === "function") return slide.querySelector("video");
  } catch (e) {}
  return null;
}
/* Start a fill alongside its main video: re-seat it near the
   main video's position when it has drifted (a blurred
   backdrop earns a nudge, not a sync engine), then play.
   Always muted. A refused play is swallowed like every
   other feed play. */
function feedFillPlay196(fill, main) {
  if (!fill) return;
  try { fill.muted = true; } catch (e) {}
  try {
    if (main && typeof fill.currentTime === "number" && typeof main.currentTime === "number" && Math.abs(fill.currentTime - main.currentTime) > 1.5) fill.currentTime = main.currentTime;
  } catch (e) { /* a fill that refuses to seek still plays */ }
  try { const pr = fill.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* a refused fill play leaves the poster backdrop — the pre-196 look */ }
}
function feedAddFill196(slide, main) {
  try {
    if (!feedFillEnabled196() || !slide || !main) return null;
    const existing = feedFillVideo196(slide);
    if (existing) return existing;
    if (typeof document === "undefined" || typeof document.createElement !== "function") return null;
    const src = typeof main.getAttribute === "function" ? main.getAttribute("src") : main.src;
    if (!src) return null;
    const fill = document.createElement("video");
    fill.className = "feed196-fill";
    if (typeof fill.setAttribute === "function") {
      fill.setAttribute("data-feed-fill", "1");
      fill.setAttribute("aria-hidden", "true");
      fill.setAttribute("playsinline", "");
    }
    try { fill.dataset.feedFill = "1"; } catch (e) {}
    fill.muted = true;
    fill.playsInline = true;
    fill.loop = true;
    fill.preload = "metadata";
    if (typeof fill.setAttribute === "function") fill.setAttribute("src", src);
    fill.src = src;
    /* The backdrop goes in ahead of the media block (and
       after the retired poster backdrop div) so it paints
       behind everything the slide already had. */
    const media = typeof slide.querySelector === "function" ? slide.querySelector(".feed189-media") : null;
    if (media && typeof slide.insertBefore === "function") slide.insertBefore(fill, media);
    else if (typeof slide.appendChild === "function") slide.appendChild(fill);
    else return null;
    if (slide.classList && typeof slide.classList.add === "function") slide.classList.add("feed196-hasfill");
    /* Join the lifecycle at whatever point the slide is in:
       the settled slide's fill starts now; a neighbor inside
       the warm window buffers; anything farther waits. */
    if (feed189.open && typeof feedSlides193 === "function") {
      const slides = feedSlides193();
      const idx = slides.indexOf(slide);
      if (idx === feed189.index) feedFillPlay196(fill, main);
      else if (idx >= 0 && Math.abs(idx - feed189.index) <= 2) {
        fill.preload = "auto";
        if (typeof fill.load === "function") fill.load();
      }
    }
    return fill;
  } catch (e) { return null; }
}
/* Round 196: wire one rendered slide's fill decision. The
   video's loadedmetadata dimensions are the truth; the
   POSTER's dimensions are the pre-metadata stand-in (a
   poster answer never overrides a metadata answer) — the
   same discipline as feedWireShape191, and the two wirings
   listen side by side. Only board video slides are wired:
   battle slides keep their Round 189 rendering untouched,
   and photo/embed/link slides have no motion to fill with. */
function feedWireFill196(slide) {
  try {
    if (!feedFillEnabled196()) return;
    if (!slide || typeof slide.querySelector !== "function") return;
    if (typeof slide.getAttribute === "function") {
      if (slide.getAttribute("data-feed-kind") !== "video") return;
      if (slide.getAttribute("data-feed-battle")) return;
    }
    const media = slide.querySelector("video");
    if (!media) return;
    let metaDone = false;
    const consider = (w, h) => { if (Number(w) > 0 && Number(h) > 0 && feedIsWide196(w, h)) feedAddFill196(slide, media); };
    const applyMeta = (w, h) => { metaDone = true; consider(w, h); };
    const applyStandIn = (w, h) => { if (!metaDone) consider(w, h); };
    if (typeof media.addEventListener === "function") media.addEventListener("loadedmetadata", () => applyMeta(media.videoWidth, media.videoHeight));
    if (media.videoWidth > 0) applyMeta(media.videoWidth, media.videoHeight);
    const poster = typeof media.getAttribute === "function" ? media.getAttribute("poster") : "";
    if (poster && typeof Image !== "undefined") {
      const probe = new Image();
      probe.onload = () => applyStandIn(probe.naturalWidth, probe.naturalHeight);
      probe.src = poster;
    }
  } catch (e) { /* an unfilled wide slide keeps the Round 191 band look — the fill never breaks the feed */ }
}
function feedMediaHtml189(h, kind) {
  const poster = typeof posterUrlFor134 === "function" ? posterUrlFor134(h) : "";
  if (kind === "photo") return `<img class="feed189-fit" src="${esc(h.media_url)}" alt="">`;
  if (kind === "embed") return `<iframe class="feed189-fit" src="${esc(h.embed_url || "")}" allowfullscreen title="Embedded play"></iframe>`;
  if (kind === "video") return `<video class="feed189-fit" src="${esc((typeof playSrc192 === "function") ? playSrc192(h) : h.media_url)}"${poster ? ` poster="${esc(poster)}"` : ""} playsinline muted loop preload="metadata"></video>`;
  return `<a class="feed189-watchlink" href="${esc(h.media_url)}" target="_blank" rel="noopener">▶ Watch on ${esc(h.host_label || "link")} ↗</a>`;
}
function feedHypeRail189(h) {
  const count = `<span class="feed189-count" data-feed-count="${h.id}">${h.voteCount || 0}</span>`;
  /* Round 191: the rail wears the brand's gold crown mark —
     public/crown.png, the standalone gold crown asset the
     site ships — in place of the emoji, on the vote button
     and the sample chip alike (the chip is the same rail
     slot). The crown is a flat silhouette, so the voted
     state's gold disc darkens it to black via CSS filter. */
  const crown = `<img class="feed191-crown" src="crown.png" alt="" aria-hidden="true">`;
  /* Sample plays keep the boards' rule: a display-only count,
     no vote affordance. */
  if (h.isSample) return `<div class="feed189-railitem"><span class="feed189-samplechip" aria-hidden="true">${crown}</span>${count}<span class="feed189-raillabel">Sample</span></div>`;
  /* Round 190 (2026-11-25, Emil): the rail names the action
     "Vote" — this button IS the vote (it runs through the real
     toggleVote), and the action is labeled Vote everywhere it
     appears. The voted state stays style-only (.voted +
     aria-pressed), exactly as the mock drew it.
     Round 223 (2026-11-27, outside review): the label moves
     INSIDE the button and reads "Vote for this play" in full —
     the crown disc + a small "Vote" caption under it read as
     decoration, not as the way to vote. The label is part of
     the tappable control now; the voted state shortens it to
     "Voted", mirroring the board tile chip (Rounds 108/153).
     feedSyncCounts189 keeps the label in step after a vote
     (feedSyncHypeLabel223). The count keeps its own span. */
  return `<div class="feed189-railitem"><button type="button" class="feed189-hype${h.hasVoted ? " voted" : ""}" data-feed-hype="${h.id}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="Vote for this play" onclick="feedHype189(${h.id}, this)">${crown}<span class="feed223-hypelabel">${h.hasVoted ? "Voted" : "Vote for this play"}</span></button>${count}</div>`;
}
function feedVsHtml189(current) {
  const b = feed189.battle;
  if (!b || typeof findPlay !== "function") return "";
  const a = findPlay(b.a), c = findPlay(b.b);
  if (!a || !c) return "";
  const av = a.voteCount || 0, cv = c.voteCount || 0;
  const pct = (av + cv) > 0 ? Math.round((av / (av + cv)) * 100) : 50;
  const side = (p, v) => `<div class="feed189-vs-side${current && p.id === current.id ? " now" : ""}"><b>${esc(p.athlete_label || p.player_name || "")}</b><span>${esc(p.title)}</span><b class="feed189-vs-count" data-feed-count="${p.id}">${v}</b></div>`;
  const curName = current ? (current.athlete_label || current.player_name || "") : "";
  return `<div class="feed189-vs">${side(a, av)}<div class="feed189-vs-mid">VS</div>${side(c, cv)}<div class="feed189-vs-split"><span data-feed-split189 style="width:${pct}%"></span></div><p class="feed189-vs-prompt">Vote for the play you pick${curName ? ` — you're watching ${esc(curName)}'s; swipe for the other` : ""}.</p></div>`;
}
function feedSlideHtml189(h, i, showHint) {
  const kind = feedSlideKind189(h);
  const poster = typeof posterUrlFor134 === "function" ? posterUrlFor134(h) : "";
  const name = h.athlete_label || h.player_name || "";
  /* Round 191: the caption is TITLE-first — the play's title
     is the hook line ("Walk-off game winner"), then
     "Athlete · Sport" beneath it; the team keeps its chip.
     A play with no title falls back to name-first (the name
     takes the hook line, the sport rides beneath it). The
     same markup serves both caption placements — the
     portrait overlay and the wide below-the-band block are
     pure CSS (the slide's feed191-portrait / feed191-wide
     classes from feedWireShape191). */
  const title = String(h.title || "").trim();
  const line1 = title || name;
  const line2 = title ? [name, h.sport ? cap(h.sport) : ""].filter(Boolean).join(" · ") : (h.sport ? cap(h.sport) : "");
  /* Round 223: a board video slide carries the play's smart-
     poster moment (h.poster_time, the Round 209/213 chosen
     time the server now exposes) so the clip can START there
     instead of at 0:00 (feedWirePosterStart223). Battle
     slides are excluded — their pooled playback stays as
     Round 192 scoped it — and a play with no picked poster
     carries no attribute and starts at the head as before. */
  const posterTime223 = kind === "video" && !feed189.battle && Number(h.poster_time) > 0 ? Number(h.poster_time) : 0;
  return `<section class="feed189-slide" data-feed-slide="${h.id}" data-feed-kind="${kind}"${feed189.battle ? ` data-feed-battle="1"` : ""}${posterTime223 ? ` data-feed-poster-time="${posterTime223}"` : ""}>
    ${poster ? `<div class="feed189-bg" style="background-image:url(&quot;${esc(poster)}&quot;)"></div>` : `<div class="feed189-bg feed189-bg-plain"></div>`}
    <div class="feed189-media">${feedMediaHtml189(h, kind)}</div>
    ${feed189.battle ? `<div class="feed189-ribbon">⚔️ Battle</div>` : ""}
    ${feed189.battle ? feedVsHtml189(h) : ""}
    <div class="feed189-caption">
      ${line1 ? `<p class="feed189-title">${esc(line1)}</p>` : ""}
      ${line2 ? `<p class="feed189-athlete">${esc(line2)}</p>` : ""}
      ${h.team ? `<p class="feed189-tags"><span class="feed189-team">${esc(h.team)}</span></p>` : ""}
      ${h.musicTrack ? `<p class="feed189-music">♪ ${esc(h.musicTrack)} <span>Licensed hype track</span></p>` : ""}
    </div>
    <div class="feed189-rail">
      ${feedHypeRail189(h)}
      <div class="feed189-railitem"><button type="button" class="feed189-share" aria-label="Share this play" onclick="feedShare189(${h.id}, this)">🔗</button><span class="feed189-raillabel">Share</span></div>
    </div>
    ${kind === "video" ? `<div class="feed223-flash" data-feed-flash="${h.id}" aria-hidden="true"></div><div class="feed223-scrub" data-feed-scrub="${h.id}"><div class="feed189-progress"><span data-feed-progress="${h.id}"></span></div><span class="feed223-time" data-feed-time="${h.id}">0:00 / 0:00</span></div>` : ""}
    ${showHint ? `<p class="feed189-hint" data-feed-hint189>↑ Swipe up for the next play</p>` : ""}
  </section>`;
}
function feedEndCardHtml189() {
  return `<section class="feed189-slide feed189-end" data-feed-end="1">
    <div class="feed189-end-inner">
      <p class="feed189-end-big">You're all caught up</p>
      <p class="feed189-credo">We believe every young athlete should be celebrated.</p>
      <p class="feed189-end-btns"><button type="button" class="btn btn-lime" onclick="closeFeed189()">Back to the board</button>
      <button type="button" class="mini-btn" onclick="feedGo189('month')">See the Leaderboard</button></p>
    </div>
  </section>`;
}
function feedRender189(seq, battle) {
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track) return false;
  feed189.ids = seq.ids;
  feed189.start = seq.start;
  feed189.battle = battle || null;
  feed189.kind = battle ? "battle" : "board";
  feed189.counted = new Set();
  /* Round 191: the swipe hint shows ONCE per page session —
     on the first slide of the first feed that has a next
     play — then never again (feed191.hintSeen survives
     close/re-entry; feedActivate189 hides it for good once
     the visitor swipes away). */
  const wantHint = seq.ids.length > 1 && !feed191.hintSeen;
  const slides = seq.ids.map((id, i) => {
    const h = typeof findPlay === "function" ? findPlay(id) : null;
    return h ? feedSlideHtml189(h, i, i === seq.start && wantHint) : "";
  }).join("");
  if (wantHint) feed191.hintSeen = true;
  track.innerHTML = slides + feedEndCardHtml189();
  /* Round 191: classify each slide by its media's real shape
     (portrait fills, wide runs edge-to-edge — see
     feedWireShape191). */
  if (typeof track.querySelectorAll === "function") track.querySelectorAll("[data-feed-slide]").forEach((s) => { feedWireShape191(s); feedWireFill196(s); /* Round 223: tap-to-pause + the scrub bar, and the start-at-the-poster-moment seek — cross-block, so typeof-guarded like every call out of this block. */ if (typeof feedWireControls223 === "function") feedWireControls223(s); if (typeof feedWirePosterStart223 === "function") feedWirePosterStart223(s); });
  if (typeof track.querySelectorAll === "function") track.querySelectorAll("video").forEach((v) => {
    if (typeof v.addEventListener !== "function") return;
    v.addEventListener("timeupdate", () => {
      try {
        const slide = typeof v.closest === "function" ? v.closest("[data-feed-slide]") : null;
        const bar = slide && typeof slide.querySelector === "function" ? slide.querySelector("[data-feed-progress]") : null;
        if (bar && v.duration > 0) bar.style.width = Math.round((v.currentTime / v.duration) * 100) + "%";
      } catch (e) { /* a progress bar never breaks playback */ }
    });
  });
  /* Round 193: (re)observe the fresh slides so an incoming
     slide can start playing mid-swipe (see feedObserve193). */
  feedObserve193();
  return true;
}
function feedActivate189(index) {
  feed189.index = index;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (track && typeof track.querySelectorAll === "function") {
    feedSlides193().forEach((s, i) => {
      /* Round 196: the MAIN video drives the settle (a wide
         slide's fill follows it, below). */
      const v = feedMainVideo196(s);
      const fill = feedFillVideo196(s);
      if (fill) {
        if (i === index) feedFillPlay196(fill, v);
        else { try { fill.pause(); } catch (e) {} }
      }
      if (!v) return;
      /* Round 194: every activation restates the sound
         state on every slide's video before the settled one
         plays (the others are paused anyway — restating
         keeps them honest for their own turn). */
      feedApplySound194(v);
      if (i === index) { try { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* a refused autoplay leaves the poster resting */ } }
      else { try { v.pause(); } catch (e) {} }
    });
    /* Round 193: the settle is authoritative — the loop above
       paused every early-started slide that isn't this one,
       so the early set starts fresh from here. */
    feed193.early.clear();
    const hint = typeof track.querySelector === "function" ? track.querySelector("[data-feed-hint189]") : null;
    /* Round 191: once the visitor swipes off the first slide
       the hint is gone for good (its CSS fade handles the
       rest) — it never reappears on a swipe back. */
    if (hint && hint.style && index !== feed189.start) hint.style.display = "none";
  }
  const id = feed189.ids[index];
  if (id && !feed189.counted.has(id)) {
    feed189.counted.add(id);
    if (typeof trackEvent === "function") trackEvent("play_open", id);
  }
  /* Round 193: warm the neighborhood around the settled slide
     so the next swipe starts from buffered data (feedWarm193
     is a no-op while the feed is closed). */
  feedWarm193(index);
}
function feedOnScroll189() {
  if (!feed189.open) return;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track) return;
  const h = track.clientHeight || 0;
  if (!h) return;
  const idx = Math.round((track.scrollTop || 0) / h);
  if (idx !== feed189.index) feedActivate189(idx);
  /* Round 198: every scroll event re-arms the settle
     corrector — it fires only once scrolling has stopped. */
  feedSettleSoon198();
}
/* Round 198 (2026-11-26): the settle guarantee. Emil, on his
   iPhone hours after Round 196 shipped: "some issues on the
   swiping" — a swipe could come to rest BETWEEN slides (his
   screenshot: Nicholas's slide filling the top two-thirds,
   the next play's video below the seam) — "and the swipe
   icon is gone." The geometry contract never actually broke:
   every slide is exactly one track-height and the snap
   points sit at exact multiples (verified in a real engine).
   What Round 196 changed is the slide's CONTENTS: the fill
   is a full-screen <video>, playing, with a blur(26px)
   filter and a scale(1.12) transform — the first layer of
   its kind inside a snap slide since Round 191 retired the
   blurred poster backdrop, and that one was a still image.
   Around such a layer iOS's compositor can drop the native
   scroll-snap mid-gesture, and the track coasts to a stop
   off-boundary. So the settle is enforced here instead of
   trusted to the engine: when scrolling STOPS — no scroll
   event for a beat, and no finger down — an off-boundary
   rest is pulled onto the ACTIVE slide's boundary.
   feedActivate189 remains the only place that sets the
   index, counts play_open and pauses: the corrector never
   picks a slide, it only aligns the track to the slide the
   scroll handler already chose, so wherever native snap
   landed cleanly it is a strict no-op. It never fights a
   held finger (feed198.touching gates it; lifting the
   finger re-arms it, so a released rest is still repaired
   once momentum dies). */
const feed198 = { timer: null, touching: false };
function feedSettle198() {
  feed198.timer = null;
  if (feed198.touching || !feed189.open) return;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track) return;
  const h = track.clientHeight || 0;
  if (!h || feed189.index < 0) return;
  const target = feed189.index * h;
  try { if (Math.abs((track.scrollTop || 0) - target) > 1) track.scrollTop = target; } catch (e) { /* a track that refuses the nudge keeps the native rest — the feed never breaks over a repair */ }
}
function feedSettleSoon198() {
  try { if (feed198.timer) clearTimeout(feed198.timer); } catch (e) { /* no timer support in a partial slice — the native snap is the fallback, exactly as before */ }
  try { feed198.timer = setTimeout(feedSettle198, 140); } catch (e) { feed198.timer = null; }
}
window.openFeed189 = (ids, startId, battle) => {
  if (!feedEnabled189()) return false;
  const seq = feedSequence189(ids, startId);
  if (!seq) return false;
  const wrap = typeof $ === "function" ? $("#feed189") : null;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!wrap || !track) return false;
  if (!feedRender189(seq, battle)) return false;
  /* Round 194: the sound state is read fresh at every open
     — the saved preference wins (it may have changed in
     another tab) — and the top-bar toggle is synced to it
     before the first slide starts; the opening activation
     then applies it to every rendered video. */
  feed194.sound = feedSoundPref194();
  feedSyncSoundBtn194();
  wrap.hidden = false;
  feed189.open = true;
  try { if (typeof document !== "undefined" && document.body && document.body.classList) document.body.classList.add("feed-open189"); } catch (e) {}
  /* Round 158's invariant, mirrored: opening the feed is a view
     change — every panel falls silent behind it. */
  if (typeof pauseMediaIn158 === "function" && typeof $$ === "function") $$(".panel[data-panel]").forEach((p) => pauseMediaIn158(p, false));
  if (typeof featPause163 === "function") featPause163();
  /* Round 217 (2026-11-26): the entry slide starts fetching in
     the tap's own task. Until now the first frame waited on
     the rAF below: every slide renders preload="metadata", so
     feedActivate189's play() was the first thing to pull media
     data — a cold open paid the board render + a frame + a
     network fetch in series. Warm the neighborhood now (the
     same feedWarm193 call the settle makes; it re-runs there,
     idempotently) and put the entry slide's own video into
     load() explicitly, so the activation's play() lands on an
     element already fetching. */
  try {
    const entryV217 = feedMainVideo196(feedSlides193()[seq.start]);
    if (entryV217) {
      try { entryV217.preload = "auto"; } catch (e) {}
      try { if (typeof entryV217.load === "function") entryV217.load(); } catch (e) {}
    }
    feedWarm193(seq.start);
  } catch (e) { /* an unwarmed open is the pre-217 open — never a broken one */ }
  const jump = () => { try { track.scrollTop = seq.start * (track.clientHeight || 0); } catch (e) {} feedActivate189(seq.start); };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(jump); else jump();
  return true;
};
/* The board tap: Watch tiles and Month rows land here. Feed on
   and a readable board order → the feed; anything else (kill
   switch, an element outside a known board, a play the board
   no longer shows) → the classic detail, exactly as before. */
window.openPlay189 = (id, el) => {
  if (feedEnabled189()) {
    const ids = feedBoardIds189(el);
    if (ids && window.openFeed189(ids, id, null)) return;
  }
  if (typeof window.openPlayDetail === "function") window.openPlayDetail(id);
};
window.openBattleFeed189 = () => {
  if (!feedEnabled189()) return;
  let pair = null;
  try { if (typeof btl !== "undefined" && btl && btl.cur && btl.cur.L && btl.cur.R) pair = [btl.cur.L, btl.cur.R]; } catch (e) {}
  if (!pair && typeof btlPairs === "function") { try { const p = btlPairs(); if (p && Array.isArray(p.pairs) && p.pairs.length) pair = p.pairs[0]; } catch (e) {} }
  if (!pair) return;
  window.openFeed189(pair, pair[0], { a: pair[0], b: pair[1] });
};
window.closeFeed189 = () => {
  /* Round 193: stop watching the outgoing slides and forget
     any early starts — nothing warms or early-plays while the
     feed is closed. */
  if (feed193.observer) { try { feed193.observer.disconnect(); } catch (e) {} }
  feed193.early.clear();
  /* Round 198: no settle correction outlives the feed. */
  try { if (feed198.timer) clearTimeout(feed198.timer); } catch (e) {}
  feed198.timer = null;
  feed198.touching = false;
  const wrap = typeof $ === "function" ? $("#feed189") : null;
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (track && typeof track.querySelectorAll === "function") track.querySelectorAll("video").forEach((v) => { try { v.pause(); } catch (e) {} });
  if (track) track.innerHTML = "";
  if (wrap) wrap.hidden = true;
  feed189.open = false;
  feed189.ids = [];
  feed189.battle = null;
  feed189.index = -1;
  try { if (typeof document !== "undefined" && document.body && document.body.classList) document.body.classList.remove("feed-open189"); } catch (e) {}
};
/* The feed's top tabs and the end card's Leaderboard button:
   leave the feed, land on the named board. The Leaderboard
   lives on the Month tab (setMonthSub pins the This Month
   sub-view, exactly like the tab itself).
   Round 232 (2026-11-27): the board's leaderboard is retired —
   the Leaderboard now lives in the homepage's More Highlights
   section, so the 'month' landing goes there (This Month tab,
   section scrolled into view) via homeLbLanding232. */
window.feedGo189 = (view) => {
  window.closeFeed189();
  if (view === "month" && typeof homeLbLanding232 === "function") homeLbLanding232("month");
  else if (view === "month" && typeof setMonthSub === "function") setMonthSub("month");
  else if (typeof switchView === "function") switchView(view);
};
/* A hype from the feed IS a hype: the same toggleVote (the real
   vote endpoint, the same voter token, the same in-flight
   guard and refresh) as the boards and the watch view. After
   it settles, the slide's counts repaint from the fresh data
   loadData already pulled. */
window.feedHype189 = async (id, btn) => {
  if (typeof window.toggleVote === "function") { try { await window.toggleVote(id, btn); } catch (e) {} }
  feedSyncCounts189();
};
window.feedShare189 = (id, btn) => { if (typeof window.sharePlay === "function") window.sharePlay(id, btn); };
function feedSyncCounts189() {
  const track = typeof $ === "function" ? $("#feedTrack189") : null;
  if (!track || typeof track.querySelectorAll !== "function" || typeof findPlay !== "function") return;
  track.querySelectorAll("[data-feed-count]").forEach((el) => {
    const h = findPlay(Number(typeof el.getAttribute === "function" ? el.getAttribute("data-feed-count") : 0));
    if (h) el.textContent = String(h.voteCount || 0);
  });
  track.querySelectorAll("[data-feed-hype]").forEach((el) => {
    const h = findPlay(Number(typeof el.getAttribute === "function" ? el.getAttribute("data-feed-hype") : 0));
    if (h && el.classList && typeof el.classList.toggle === "function") { el.classList.toggle("voted", !!h.hasVoted); if (typeof el.setAttribute === "function") el.setAttribute("aria-pressed", h.hasVoted ? "true" : "false"); }
    /* Round 223: the button's visible label tracks the voted
       state too ("Vote for this play" / "Voted") — and the
       sync restores the crown + label if toggleVote's
       textContent swap (its "Voting…" pending state) took
       them off the button while the vote was in flight. */
    if (h && typeof feedSyncHypeLabel223 === "function") feedSyncHypeLabel223(el, !!h.hasVoted);
  });
  if (feed189.battle) {
    const bar = typeof track.querySelector === "function" ? track.querySelector("[data-feed-split189]") : null;
    const a = findPlay(feed189.battle.a), c = findPlay(feed189.battle.b);
    if (bar && bar.style && a && c) {
      const av = a.voteCount || 0, cv = c.voteCount || 0;
      bar.style.width = ((av + cv) > 0 ? Math.round((av / (av + cv)) * 100) : 50) + "%";
    }
  }
}
(function initFeed189() {
  try {
    /* Round 194: the sound toggle starts in the saved
       preference's state, before the feed is ever opened. */
    feedSyncSoundBtn194();
    const track = typeof $ === "function" ? $("#feedTrack189") : null;
    if (track && typeof track.addEventListener === "function") track.addEventListener("scroll", () => { if (typeof requestAnimationFrame === "function") requestAnimationFrame(feedOnScroll189); else feedOnScroll189(); }, { passive: true });
    /* Round 198: the settle corrector never fights a held
       finger — touch state gates it, and lifting the finger
       re-arms it so a released-between-slides rest is still
       repaired once momentum dies. */
    if (track && typeof track.addEventListener === "function") {
      track.addEventListener("touchstart", () => { feed198.touching = true; }, { passive: true });
      const touchDone198 = () => { feed198.touching = false; feedSettleSoon198(); };
      track.addEventListener("touchend", touchDone198, { passive: true });
      track.addEventListener("touchcancel", touchDone198, { passive: true });
    }
    const btn = typeof document !== "undefined" && typeof document.getElementById === "function" ? document.getElementById("btlFeedBtn189") : null;
    if (btn && typeof btn.addEventListener === "function") {
      if (!feedEnabled189()) btn.hidden = true;
      btn.addEventListener("click", () => window.openBattleFeed189());
    }
    if (typeof document !== "undefined" && typeof document.addEventListener === "function") document.addEventListener("keydown", (e) => { if (e && e.key === "Escape" && feed189.open) window.closeFeed189(); });
  } catch (e) { /* the feed is an enhancement — a wiring hiccup never breaks the boards */ }
})();

/* ---------------- Round 192 (2026-11-25): streaming renditions ----------------
   The playback source for a play: the Round 192 streaming
   rendition (stream_url — a ~1 MB faststart H.264 sibling the
   server generates from the final display file) when the play
   has one, else the master media_url exactly as before. Only
   uploaded-file videos ever carry a rendition; photo plays,
   link videos and embeds resolve to media_url untouched.
   In-page players (mediaHtml, fameThumbHtml, the watch feed)
   reach this through a typeof guard, so a sandbox slice
   without this block renders the master — the pre-192
   behavior. Downloads (saveClip) and the Hype Frame studio
   deliberately do NOT use this helper: they work from the
   master, which stays canonical. */
function playSrc192(h) {
  if (!h) return "";
  if (h.media_kind === "file" && h.stream_url) return h.stream_url;
  return h.media_url || "";
}

/* ---------------- Round 217 (2026-11-26): tap-to-play latency ----------------
   Emil, on his phone, on the This Month leaderboard: "When you
   click a video there is a slight delay before it plays." The
   trace of a leaderboard tap, before this round:
   (1) The row's handler is onclick — on a phone, click lands
       at finger-LIFT. Nothing at all loads during the press.
   (2) openFeed189 then builds EVERY slide of the board in one
       synchronous innerHTML write, and defers activation to
       requestAnimationFrame.
   (3) Only then does feedActivate189 call play() — on an
       element rendered preload="metadata", so the media fetch
       itself starts last: press time + full render + a frame
       + a cold network fetch, all in series, before frame one.
   The classic detail path had the same click-timing + cold
   fetch (its markup was already right: preload="auto" +
   autoplay + the rendition). And Round 193's warming never
   runs while the feed is closed, so every first open was
   cold. Three bounded changes, all aimed at starting the
   RIGHT fetch earlier — the players, the feed's order and
   behavior, and the R193/R198 swipe machinery are untouched:
   (a) POINTERDOWN WARM. A capture-phase pointerdown listener
       (below) resolves the tapped [data-tile-id] surface —
       board tiles, Month/Fame rows, Up-next rows (which gain
       the attribute this round) — to its play and starts
       loading the play's R192 playback source (playSrc192:
       the rendition when one exists, never a download/master
       path beyond what the player itself would load) into a
       detached pool <video> at preload="auto". /uploads media
       is served immutable for a year (Round 192), so the
       player element — feed slide or detail player — reuses
       those bytes from cache when its own load starts a beat
       later. The pool is keyed by src, capped at
       TAP_WARM_MAX217 with oldest-first eviction, and a
       re-press on a warm src is a no-op beyond load().
   (b) ENTRY-SLIDE HEAD START. openFeed189 now warms the
       entry slide's neighborhood and load()s the entry video
       synchronously, in the tap's task, before the rAF
       activation (see the Round 217 note there) — play()
       lands on an element already fetching.
   (c) BOARD WARM. After each board render (the renderAll
       hook), the first TAP_WARM_BOARD_N217 video plays of
       the Month board (else the Watch board) warm at
       preload="metadata" through the same pool — metadata
       only, so the board never pulls megabytes unprompted;
       a press on one of them upgrades its warm to "auto".
       This is a deliberate, narrow exception to Round 193's
       "nothing is preloaded behind the boards": that rule
       still holds for the feed's own slides (feedWarm193 is
       untouched and still a no-op while the feed is closed)
       — the board warm lives in detached elements, capped,
       and fetches headers, not data.
   Battles' pooled player keeps the master by design (Round
   192) and carries no data-tile-id, so it never warms here.
   Everything is guarded: a slice without the helpers, a
   browser without Pointer Events, a play without a video —
   each degrades to exactly the pre-217 tap. */
const tapWarm217 = { pool: new Map() };
const TAP_WARM_MAX217 = 6;
const TAP_WARM_BOARD_N217 = 3;
/* The playback source a tap should warm for a play — the
   same source its player will load (playSrc192), or "" for
   anything that is not an in-page video play (photo plays,
   embeds, watch-links warm nothing). PURE on purpose. */
function tapWarmSrc217(h) {
  try {
    if (!h) return "";
    const hasVideo = typeof playHasVideo === "function" ? playHasVideo(h) : (h.media_kind === "file" || h.media_kind === "link_video");
    if (!hasVideo) return "";
    if (h.media_kind === "file" && (h.mime || "").startsWith("image/")) return "";
    return (typeof playSrc192 === "function") ? playSrc192(h) : (h.media_url || "");
  } catch (e) { return ""; }
}
/* Start (or upgrade) the fetch of one source in the pool.
   level "metadata" fetches headers only; "auto" pulls data.
   Returns the pool element, or null when warming is
   impossible in this slice. */
function tapWarmFetch217(src, level) {
  if (!src || typeof document === "undefined" || typeof document.createElement !== "function") return null;
  try {
    let v = tapWarm217.pool.get(src);
    if (!v) {
      v = document.createElement("video");
      try { v.muted = true; } catch (e) {}
      try { v.playsInline = true; } catch (e) {}
      v.preload = level;
      v.src = src;
      tapWarm217.pool.set(src, v);
      while (tapWarm217.pool.size > TAP_WARM_MAX217) {
        const oldest = tapWarm217.pool.keys().next().value;
        if (oldest === src) break;
        const ov = tapWarm217.pool.get(oldest);
        tapWarm217.pool.delete(oldest);
        try { ov.pause(); } catch (e) {}
        try { ov.removeAttribute("src"); } catch (e) {}
        try { if (typeof ov.load === "function") ov.load(); } catch (e) {}
      }
    } else if (level === "auto" && v.preload !== "auto") {
      v.preload = "auto";
    }
    if (typeof v.load === "function") v.load();
    return v;
  } catch (e) { return null; }
}
/* Warm one play at a level; returns the warmed source (""
   when the play has nothing warmable). */
function tapWarmPlay217(h, level) {
  const src = tapWarmSrc217(h);
  if (src) tapWarmFetch217(src, level);
  return src;
}
/* The board warm: the first few video plays of the rendered
   Month board (its rows are the board's order by
   construction), else the Watch board's tiles — metadata
   level, capped, idempotent across re-renders (the pool is
   keyed by src, so a refresh re-warms nothing). Called from
   renderAll through a typeof guard. */
function tapWarmBoard217() {
  try {
    if (typeof document === "undefined" || typeof document.querySelector !== "function") return;
    let ids = [];
    for (const sel of ["#monthRows", "#allBoard"]) {
      const host = document.querySelector(sel);
      if (!host || typeof host.querySelectorAll !== "function") continue;
      ids = [...host.querySelectorAll("[data-tile-id]")].map((n) => Number(typeof n.getAttribute === "function" ? n.getAttribute("data-tile-id") : 0)).filter((n) => n > 0);
      if (ids.length) break;
    }
    let warmed = 0;
    const seen = new Set();
    for (const id of ids) {
      if (warmed >= TAP_WARM_BOARD_N217) break;
      if (seen.has(id)) continue;
      seen.add(id);
      const h = typeof findPlay === "function" ? findPlay(id) : null;
      if (h && tapWarmPlay217(h, "metadata")) warmed++;
    }
  } catch (e) { /* a cold board is the pre-217 board — warming never breaks a render */ }
}
(function initTapWarm217() {
  try {
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return;
    document.addEventListener("pointerdown", (e) => {
      try {
        const t = e && e.target;
        if (!t || typeof t.closest !== "function") return;
        const host = t.closest("[data-tile-id]");
        if (!host || typeof host.getAttribute !== "function") return;
        /* The feed and the studio never warm from a press —
           their surfaces carry no board tile ids today; the
           guard keeps that true by construction. */
        if (typeof host.closest === "function" && host.closest("#feed189, #hypeframe")) return;
        const id = Number(host.getAttribute("data-tile-id"));
        if (!(id > 0)) return;
        const h = typeof findPlay === "function" ? findPlay(id) : null;
        if (h) tapWarmPlay217(h, "auto");
      } catch (err) { /* a press that warms nothing is just a press */ }
    }, { capture: true, passive: true });
  } catch (e) { /* no Pointer Events, no warm — taps behave exactly as before */ }
})();

/* ---------------- Round 223 (2026-11-27): the video experience ----------------
   Emil, watching the feed: "there is no way now to pause it
   or rewind." He was right on every surface: the feed had no
   pause and no scrub at all (autoplay + swipe only); the
   watch view's native chrome fades out ~2s into playback
   (Rounds 140/143) and takes the scrubber with it; and the
   board tiles never carried controls (see the tile note in
   this block). The same evening's outside review added three
   more: the hero's Watch Highlights should open a PLAYING
   clip in the feed in one tap (it scrolled to the board and
   kept whatever tab was selected — even Battles); a feed
   clip opened on its 0:00 frame ("mostly sky") instead of
   the moment its poster shows; and the feed's vote — a crown
   disc with a small caption — didn't read as an action.
   Six pieces, all in this block except the markup hooks:
   (1) Feed tap-to-pause/play with a brief center icon flash,
       plus a draggable scrub bar with the time, riding the
       bottom of every video slide (the Round 189 progress
       hairline lives inside it and keeps painting as before).
   (2) The watch view's always-visible control row (markup
       in watchHtml107): play/pause + scrub + time, wired per
       render by wireCardControls223. It sits OUTSIDE the
       player, so the chrome fade can never take it.
   (3) Board tiles — the finding: tile videos render through
       fameThumbHtml with NO controls attribute (muted loop
       previews by design, Rounds 8/133), and the .tile-tap
       overlay covers .tile-media so the media surface itself
       never takes a tap (Round 9: the playing video swallowed
       taps in in-app browsers; the overlay is what makes a
       tile open its play). There are no suppressed controls
       to un-suppress — a tile is a tap-to-open poster, and
       the controls live one tap in, in the feed (piece 1) and
       the watch view (piece 2 + its native chrome). The
       controls-carrying card surface (cardHtml → mediaHtml
       with rest192, athlete pages) has NO overlay over its
       .thumb — badge/rank chips sit in the corners only — so
       its native controls were already reachable. Pinned in
       test-r223; tiles are NOT redesigned.
   (4) The hero's Watch Highlights enters the feed at the
       first play of the board the visitor is on (the Month
       board on the Month view, the All Hypes board otherwise
       — never the Battles pair), playing, under the standing
       feed sound default (Round 194: a fresh session starts
       muted). A capture-phase document listener intercepts
       the hero anchor ONLY when the feed actually opens;
       otherwise the tap falls through to the standing
       data-tablink behavior (scroll to the deck) untouched.
   (5) A board feed slide STARTS at its play's smart-poster
       moment: publicHighlight now exposes poster_time (the
       Round 209/213 chosenTime), feedSlideHtml189 stamps it
       on the slide, and feedWirePosterStart223 seeks the
       main video there once its metadata lands (fastSeek
       where available). Battle slides are excluded (Round
       192's pooled-player scope), as are plays with no
       picked poster. Round 217's warming is untouched — the
       seek rides the metadata event the warm already pulls.
   (6) The feed rail's vote button carries its label INSIDE
       the control: "Vote for this play" (markup in
       feedHypeRail189), shortening to "Voted" in the voted
       state like the tile chip. toggleVote is untouched;
       feedSyncCounts189's repaint keeps the label in step
       (feedSyncHypeLabel223) — and restores the crown +
       label when toggleVote's textContent pending swap
       ("Voting…") took them off the button mid-flight.
   Invariants: the feed's order is still the board's own
   order, read off the board DOM, never sorted; the Round
   194 sound state and the Round 196 fill behave exactly as
   before (a user pause pauses the fill with its main video;
   an early-started or settled slide is unaffected — a tap
   is the only new way to pause, and feedActivate189 remains
   the settle authority). Appended at the end of app.js per
   the sandbox-slice rule; every lookup is guarded and every
   call into older blocks is typeof-guarded. */
/* "0:00" formatting for the time readouts. PURE on purpose
   (the suites drive it in a vm): non-finite or negative
   input reads as 0:00, an hour-plus clip reads h:mm:ss. */
function vidTimeFmt223(t) {
  const s = Math.max(0, Math.floor(Number(t) || 0));
  const m = Math.floor(s / 60), r = s % 60;
  if (m >= 60) { const hh = Math.floor(m / 60), mm = m % 60; return hh + ":" + String(mm).padStart(2, "0") + ":" + String(r).padStart(2, "0"); }
  return m + ":" + String(r).padStart(2, "0");
}
/* The shared scrub wiring: pointer drags on the hit element
   seek the video. The element captures its own pointer, so
   a horizontal drag can never become the feed track's
   vertical swipe (the element's CSS touch-action:none keeps
   the browser from claiming the gesture either), and the
   drag's own click is stopped so it can never read as a tap
   on something beneath. Fraction math is clientX against
   the element's own rect — the visible bar IS the hit
   element on both surfaces that use this. */
function vidScrubWire223(hitEl, v) {
  try {
    if (!hitEl || !v || typeof hitEl.addEventListener !== "function") return;
    let down223 = false;
    const seekTo223 = (e) => {
      try {
        if (!e || typeof e.clientX !== "number" || typeof hitEl.getBoundingClientRect !== "function") return;
        const r = hitEl.getBoundingClientRect();
        if (!r || !(r.width > 0)) return;
        const f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const d = Number(v.duration) || 0;
        if (d > 0) v.currentTime = f * d;
      } catch (err) { /* a refused seek never breaks the surface */ }
    };
    hitEl.addEventListener("pointerdown", (e) => {
      down223 = true;
      try { if (e && typeof e.stopPropagation === "function") e.stopPropagation(); } catch (err) {}
      try { if (typeof hitEl.setPointerCapture === "function" && e && e.pointerId != null) hitEl.setPointerCapture(e.pointerId); } catch (err) { /* capture is an enhancement — the move/up handlers still land on the element in most engines */ }
      seekTo223(e);
    });
    hitEl.addEventListener("pointermove", (e) => { if (down223) seekTo223(e); });
    const end223 = () => { down223 = false; };
    hitEl.addEventListener("pointerup", end223);
    hitEl.addEventListener("pointercancel", end223);
    hitEl.addEventListener("click", (e) => { try { if (e && typeof e.stopPropagation === "function") e.stopPropagation(); } catch (err) {} });
  } catch (e) { /* a surface without a working scrub keeps its player */ }
}
/* The tap-toggle's icon flash: the glyph of the state the
   tap just produced (▶ now playing / ❚❚ now paused),
   centered on the slide, fading on its CSS animation; the
   class is re-armed per tap so rapid toggles re-flash. */
function feedFlash223(flash, glyph) {
  try {
    if (!flash) return;
    flash.textContent = glyph;
    if (flash.classList && typeof flash.classList.remove === "function") flash.classList.remove("show");
    void (typeof flash.offsetWidth === "number" ? flash.offsetWidth : 0);
    if (flash.classList && typeof flash.classList.add === "function") flash.classList.add("show");
  } catch (e) { /* the flash is feedback only — playback already changed */ }
}
/* Tap a feed video: pause it (its blur fill pauses with it)
   or play it (the sound state is restated first, the fill
   rejoins through the Round 196 sync, exactly as the settle
   path drives them). feedActivate189 is untouched — swipe
   away and back and the settled slide plays as always; the
   pause a tap made is a viewing state, not a preference. */
function feedTogglePlay223(slide, v) {
  try {
    if (!v) return;
    const flash = slide && typeof slide.querySelector === "function" ? slide.querySelector("[data-feed-flash]") : null;
    const fill = slide && typeof feedFillVideo196 === "function" ? feedFillVideo196(slide) : null;
    if (v.paused || v.ended) {
      if (typeof feedApplySound194 === "function") feedApplySound194(v);
      try { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); } catch (e) { /* a refused play leaves the poster resting, as everywhere in the feed */ }
      if (fill && typeof feedFillPlay196 === "function") feedFillPlay196(fill, v);
      feedFlash223(flash, "▶");
    } else {
      try { v.pause(); } catch (e) {}
      if (fill) { try { fill.pause(); } catch (e) {} }
      feedFlash223(flash, "❚❚");
    }
  } catch (e) { /* a tap that toggles nothing is just a tap */ }
}
function feedPaintTime223(v, timeEl) {
  try { if (timeEl) timeEl.textContent = vidTimeFmt223(v ? v.currentTime : 0) + " / " + vidTimeFmt223(v ? v.duration : 0); } catch (e) {}
}
/* Wire one rendered feed slide's Round 223 controls: the
   tap toggle on the MAIN video (a wide slide's fill is
   scenery and never takes the tap — it is pointer-events:
   none in CSS besides), the scrub drag, and the time
   readout's painters. Called from feedRender189 alongside
   the shape/fill wiring. Photo/embed/link slides and the
   end card carry no [data-feed-scrub] and wire nothing. */
function feedWireControls223(slide) {
  try {
    if (!slide || typeof slide.querySelector !== "function") return;
    if (typeof slide.getAttribute === "function" && slide.getAttribute("data-feed-kind") !== "video") return;
    const v = typeof feedMainVideo196 === "function" ? feedMainVideo196(slide) : slide.querySelector("video");
    if (!v) return;
    const scrub = slide.querySelector("[data-feed-scrub]");
    const timeEl = slide.querySelector("[data-feed-time]");
    if (typeof v.addEventListener === "function") {
      v.addEventListener("click", () => feedTogglePlay223(slide, v));
      v.addEventListener("timeupdate", () => feedPaintTime223(v, timeEl));
      v.addEventListener("loadedmetadata", () => feedPaintTime223(v, timeEl));
    }
    if (scrub) vidScrubWire223(scrub, v);
    feedPaintTime223(v, timeEl);
  } catch (e) { /* an unwired slide keeps the Round 189 feed */ }
}
/* The poster-moment seek: applied ONCE, when the video's
   metadata lands (or immediately, if it already has), and
   only while the clip is still at its head — a video the
   early-start observer already got playing past the moment
   is never yanked back. Clamped a hair inside the end so a
   poster at the final frame can't seek past the media.
   fastSeek where the engine offers it (its whole purpose is
   this jump), plain currentTime elsewhere — the same
   discipline as btlSeekOffset119. PURE-ish on purpose: the
   suites drive it against stub videos. */
function feedSeekPoster223(v, t) {
  try {
    const target = Number(t);
    if (!v || !Number.isFinite(target) || target <= 0) return;
    const apply223 = () => {
      try {
        if (typeof v.currentTime === "number" && v.currentTime > 0.25) return;
        const d = Number(v.duration) || 0;
        const tt = d > 0 ? Math.min(target, Math.max(0, d - 0.15)) : target;
        if (!(tt > 0)) return;
        if (typeof v.fastSeek === "function") v.fastSeek(tt);
        else v.currentTime = tt;
      } catch (e) { /* a refused seek leaves the head start — the pre-223 behavior */ }
    };
    if (typeof v.readyState === "number" && v.readyState >= 1) apply223();
    else if (typeof v.addEventListener === "function") v.addEventListener("loadedmetadata", apply223, { once: true });
  } catch (e) { /* the seek is an enhancement, never a gate */ }
}
/* Wire one slide's poster-moment start (feedRender189 calls
   this next to the controls wiring). Battle slides are
   excluded by their attribute — the slide renderer only
   stamps the moment on board slides to begin with, and this
   is the second lock. */
function feedWirePosterStart223(slide) {
  try {
    if (!slide || typeof slide.getAttribute !== "function") return;
    if (slide.getAttribute("data-feed-battle")) return;
    const t = Number(slide.getAttribute("data-feed-poster-time"));
    if (!Number.isFinite(t) || t <= 0) return;
    const v = typeof feedMainVideo196 === "function" ? feedMainVideo196(slide) : (typeof slide.querySelector === "function" ? slide.querySelector("video") : null);
    if (v) feedSeekPoster223(v, t);
  } catch (e) { /* an unseeked slide starts at 0:00, as before */ }
}
/* The feed vote button's label keeper (called from
   feedSyncCounts189 after every feed vote settles): the
   label reads "Voted" in the voted state and "Vote for this
   play" otherwise, mirroring the tile chip. It also rebuilds
   the crown + label when they are missing — toggleVote's
   pending state swaps the button's textContent ("Voting…"),
   which takes the crown image and the label span with it,
   and its restore puts back text only. The vote itself is
   never touched here: classes, aria and the count are the
   sync's own work, exactly as before. */
function feedSyncHypeLabel223(btn, voted) {
  try {
    if (!btn || typeof btn.querySelector !== "function") return;
    const label = btn.querySelector(".feed223-hypelabel");
    const crown = btn.querySelector(".feed191-crown");
    if (!label || !crown) {
      btn.innerHTML = `<img class="feed191-crown" src="crown.png" alt="" aria-hidden="true"><span class="feed223-hypelabel">${voted ? "Voted" : "Vote for this play"}</span>`;
      return;
    }
    label.textContent = voted ? "Voted" : "Vote for this play";
  } catch (e) { /* a label that won't sync never breaks the vote */ }
}
/* The watch view's control row (markup in watchHtml107),
   wired per detail render: the play/pause button mirrors
   the player's own state through its play/pause/ended
   events (autoplay refusals included — the icon follows the
   video, never the hope), the scrub drags through the
   shared wiring, and the progress + time paint on
   timeupdate. The row lives outside .watch-player, so the
   Round 140 chrome fade — which drops the video's controls
   attribute while it plays — can never hide it; Round 217's
   warming is untouched (the row wires the same element the
   detail already loaded). */
function wireCardControls223(body) {
  try {
    if (!body || typeof body.querySelector !== "function") return;
    const row = body.querySelector("[data-card-controls]");
    if (!row) return;
    const box = body.querySelector(".watch-player");
    const v = box && typeof box.querySelector === "function" ? box.querySelector("video:not(.vfill)") : null;
    if (!v) return;
    const btn = typeof row.querySelector === "function" ? row.querySelector("[data-card-playbtn]") : null;
    const scrub = typeof row.querySelector === "function" ? row.querySelector("[data-card-scrub]") : null;
    const fill = typeof row.querySelector === "function" ? row.querySelector("[data-card-progress]") : null;
    const timeEl = typeof row.querySelector === "function" ? row.querySelector("[data-card-time]") : null;
    const paint223 = () => {
      try {
        if (fill && fill.style) fill.style.width = (Number(v.duration) > 0 ? Math.round((Number(v.currentTime) || 0) / Number(v.duration) * 100) : 0) + "%";
        if (timeEl) timeEl.textContent = vidTimeFmt223(v.currentTime) + " / " + vidTimeFmt223(v.duration);
        if (btn) {
          const playing = !v.paused && !v.ended;
          btn.textContent = playing ? "❚❚" : "▶";
          if (typeof btn.setAttribute === "function") btn.setAttribute("aria-label", playing ? "Pause the play" : "Play the play");
        }
      } catch (e) { /* a paint hiccup never breaks the player */ }
    };
    if (btn && typeof btn.addEventListener === "function") btn.addEventListener("click", () => {
      try {
        if (v.paused || v.ended) { const pr = v.play(); if (pr && pr.catch) pr.catch(() => {}); }
        else v.pause();
      } catch (e) { /* the events below repaint the true state either way */ }
      paint223();
    });
    if (typeof v.addEventListener === "function") {
      v.addEventListener("timeupdate", paint223);
      v.addEventListener("loadedmetadata", paint223);
      v.addEventListener("play", paint223);
      v.addEventListener("pause", paint223);
      v.addEventListener("ended", paint223);
    }
    if (scrub) vidScrubWire223(scrub, v);
    paint223();
  } catch (e) { /* a row that won't wire leaves the native player exactly as before */ }
}
/* The hero's Watch Highlights, one tap into the feed: the
   board the visitor is on supplies the order (the Month
   board's rows on the Month view; the All Hypes board's
   tiles otherwise — the Battles pair is never read, so the
   tap can never land on a battle), read off the rendered
   DOM in document order exactly like feedBoardIds189 reads
   a tapped tile's board. The feed opens at the FIRST play
   and feedActivate189 starts it playing; the sound state is
   the feed's own (Round 194 — a fresh session starts
   muted). Returns false when the feed can't open (kill
   switch, no board rendered yet, no plays), and the caller
   then lets the tap fall through to the standing behavior. */
function feedHeroIds223() {
  try {
    if (typeof document === "undefined" || !document || typeof document.querySelector !== "function") return null;
    const onMonth = typeof currentView !== "undefined" && currentView === "month" && typeof monthSub !== "undefined" && monthSub !== "fame";
    const host = document.querySelector(onMonth ? "#monthRows" : "#allBoard") || document.querySelector("#allBoard") || document.querySelector("#monthRows");
    if (!host || typeof host.querySelectorAll !== "function") return null;
    const ids = [...host.querySelectorAll("[data-tile-id]")].map((n) => Number(typeof n.getAttribute === "function" ? n.getAttribute("data-tile-id") : 0)).filter((n) => n > 0);
    return ids.length ? ids : null;
  } catch (e) { return null; }
}
window.openHeroFeed223 = () => {
  try {
    if (typeof feedEnabled189 === "function" && !feedEnabled189()) return false;
    const ids = feedHeroIds223();
    if (!ids) return false;
    if (typeof window.openFeed189 !== "function") return false;
    return !!window.openFeed189(ids, ids[0], null);
  } catch (e) { return false; }
};
(function initHeroFeed223() {
  try {
    if (typeof document === "undefined" || !document || typeof document.addEventListener !== "function") return;
    /* Capture phase, on the document: the hero anchor's own
       data-tablink handler (registered on the anchor) runs
       at the target — this listener runs first, and only a
       feed that actually opened claims the tap (preventDefault
       + stopPropagation keep the deck scroll from also
       firing). Any other outcome leaves the tap exactly as
       it behaved before this round. */
    document.addEventListener("click", (e) => {
      try {
        const t = e && e.target;
        if (!t || typeof t.closest !== "function") return;
        if (!t.closest('a.btn-hero[data-tablink="plays"]')) return;
        if (window.openHeroFeed223()) {
          if (typeof e.preventDefault === "function") e.preventDefault();
          if (typeof e.stopPropagation === "function") e.stopPropagation();
        }
      } catch (err) { /* an unclaimed hero tap is the pre-223 tap */ }
    }, { capture: true });
  } catch (e) { /* no hero interception — the deck scroll stands */ }
})();

/* ---------------- Round 230 (2026-11-27): the B2 homepage —
   Battle under the hero, Featured + standing in one card, More
   Highlights with the leaderboard inside. Emil approved the B2
   mock with his own revisions (2026-11-27): the hero keeps its
   film at full presence and gains two things only — a secondary
   "Vote in Today's Battle" anchor beside Watch Highlights
   (present only when a battle exists) and his explainer line
   under the CTAs; Today's Battle sits DIRECTLY under the hero;
   the Featured Play and its Hype of the Month standing are ONE
   combined card; More Highlights shows different athletes only
   and carries the full leaderboard; Hype Frame keeps its
   existing section below; Hype Stories stays menu-only (the
   Round 108 ruling — no homepage section, menu link untouched).
   Every surface here reads the SAME state the board reads —
   no parallel data, no new endpoints:
   - the battle card renders d100.daily (the /api/daily-battle
     payload loadDaily100 already fetches) and its Vote buttons
     call the same dailyPick100 the Battles view's buttons
     call, so a pick on either surface is the same locked pick;
     loadDaily100 re-renders the home sections at both of its
     exits, and renderAll carries the orchestrator behind the
     house typeof guard;
   - the featured card reads CONTEST.entries[0] — the same #1
     renderMonth features — with the standing computed from the
     same payload (period + the leader's month vote count);
   - the leaderboard rows are fameRowHtml134 over the same
     CONTEST.entries (This Month) and the same all-time ranking
     renderFame computes (Hall of Fame tab) — complete, the
     leader's #1 row included (Emil: standings stay complete);
   - More Highlights reads ALL_PLAYS in payload order and
     excludes the battle pair's and the featured play's
     ATHLETES — identity, not play id: the featured athlete's
     other plays are excluded too, so the featured athlete
     appears exactly once in the upper half.
   Picks stay just-for-fun (Round 179): a battle pick casts no
   contest vote; the featured/leaderboard/tile Vote buttons are
   the contest's own toggleVote, exactly as on the board.
   The sections are decoration-grade: the orchestrator swallows
   its own errors, so a hiccup here never breaks the board. */
let homeLbTab230 = "month";
let homeDailyKicked230 = false;

function homeAthleteKeys230(h) {
  const keys = new Set();
  if (!h) return keys;
  if (h.athlete_id) keys.add("id:" + h.athlete_id);
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const label = norm(h.athlete_label), name = norm(h.player_name);
  if (label) keys.add("nm:" + label);
  if (name) keys.add("nm:" + name);
  return keys;
}
function homeSameAthlete230(a, b) {
  if (!a || !b) return false;
  const ka = homeAthleteKeys230(a);
  for (const k of homeAthleteKeys230(b)) if (ka.has(k)) return true;
  return false;
}
function homeAthleteLabel230(h) {
  return (h && (h.athlete_label || h.player_name)) || "";
}
function homePosterMedia230(h, imgAttrs) {
  const poster = typeof posterUrlFor134 === "function" ? posterUrlFor134(h) : "";
  if (poster) return `<img src="${esc(poster)}" alt=""${imgAttrs || ""}>`;
  /* Round 232 (2026-11-27, Emil — the battle card sat black):
     this helper must NEVER emit a <video>. The old fallback
     (fameThumbHtml) renders a real <video preload="metadata">
     for any play whose poster resolves empty — a video element
     in a card that is supposed to be a still, pulling stream
     bytes before any tap. posterUrlFor134 already resolves a
     branded placeholder image for poster-less file plays, so
     the only plays reaching here are ones with no image at
     all; they get a static sport chip instead. Homepage
     sections now load ZERO video bytes until a tap, by
     construction. */
  return `<span class="home-poster-fallback232">${esc(cap(h && h.sport ? h.sport : "Hype"))}</span>`;
}

/* The hero's battle anchor exists only while a battle does —
   created on the first available day, removed when none is. */
function homeSyncHeroAnchor230(avail) {
  let link = document.getElementById("heroBattleLink230");
  if (avail) {
    if (link) return;
    const ctas = document.querySelector(".hero-ctas");
    if (!ctas || typeof document.createElement !== "function") return;
    link = document.createElement("a");
    link.id = "heroBattleLink230";
    link.className = "hero-battle-link230";
    link.href = "#homeBattle230";
    link.textContent = "Vote in Today's Battle ↓";
    ctas.appendChild(link);
  } else if (link && typeof link.remove === "function") link.remove();
}

function homeBattleCard230(slot, p, r) {
  const picked = !!r.yourPick;
  const mine = picked && r.yourPick === p.id;
  const btn = picked
    ? `<button type="button" class="btn hb230-vote" disabled>${mine ? `${CROWN227} Your pick` : `Vote ${slot}`}</button>`
    : `<button type="button" class="btn hb230-vote" id="homePick${slot}230" onclick="homeBattlePick230('${slot}')">Vote ${slot}</button>`;
  /* Round 232: (1) the media tap opens the swipe FEED at this
     play (homeOpenPlay232), not the static detail — Emil: "We
     lost the swipe concept." The Vote button below keeps its
     own pick behavior. (2) The poster img rides
     fetchpriority="high" — the battle stills are the first
     content under the hero and must not queue behind the
     board's video traffic. (3) The meta omits the team segment
     when it merely repeats the athlete label (play 78's team
     field IS "Kameron A" — a deliberate privacy record, left
     stored as-is): "Kameron A. · Football · Kameron A" wrapped
     to two lines and opened a gap above Vote B; deduped, both
     cards' meta stays one line and the Vote buttons align. */
  return `<article class="hb230-card${mine ? " picked" : ""}">
    <div class="hb230-media" role="button" tabindex="0" aria-label="Watch ${esc(homeAthleteLabel230(p))} — ${esc(p.title)}" onclick="homeOpenPlay232(${p.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();homeOpenPlay232(${p.id})}">${homePosterMedia230(p, ' fetchpriority="high" decoding="async"')}<span class="hb230-side">${slot}</span><span class="hb230-play"><svg width="20" height="22" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span></div>
    <div class="hb230-info"><h4>${esc(p.title)}</h4><p>${esc(homeAthleteLabel230(p))} · ${esc(cap(p.sport))}${p.team && !homeTeamDupAthlete232(p) ? ` · ${esc(p.team)}` : ""}</p></div>
    ${btn}
  </article>`;
}
function renderHomeBattle230() {
  const sec = document.getElementById("homeBattle230");
  const body = document.getElementById("homeBattleBody230");
  let r = null;
  try { r = (typeof d100 !== "undefined" && d100) ? d100.daily : null; } catch (e) { /* battles block not initialized in this slice */ }
  const avail = !!(r && r.available && r.a && r.b);
  homeSyncHeroAnchor230(avail);
  if (!sec || !body) return;
  if (!avail) { sec.hidden = true; body.innerHTML = ""; return; }
  const split = r.yourPick && r.split && typeof splitHtml100 === "function"
    ? `<div class="hb230-split">${splitHtml100(r.split, r.a, r.b, r.yourPick, r.practice)}</div>` : "";
  body.innerHTML = `${r.practice ? `<p class="hb230-practice">Practice matchup · Picks are just for fun</p>` : ""}
    <div class="hb230-grid">${homeBattleCard230("A", r.a, r)}${homeBattleCard230("B", r.b, r)}</div>
    ${split}
    <button type="button" class="hb230-skip" onclick="homeBattleSkip230()">Skip matchup →</button>`;
  sec.hidden = false;
}
/* The home Vote buttons call the Battles view's own pick —
   one state (d100.daily), one locked pick, both surfaces
   re-render from loadDaily100 when it lands. */
async function homeBattlePick230(slot) {
  const a = document.getElementById("homePickA230"), b = document.getElementById("homePickB230");
  if (a) a.disabled = true;
  if (b) b.disabled = true;
  try { if (typeof dailyPick100 === "function") await dailyPick100(slot); } catch (e) { /* the re-render below restores the buttons */ }
  renderHomeBattle230();
}
/* Skip = the Daily card's own "Play another battle" path: open
   the Battles view on a fresh Quick matchup. */
function homeBattleSkip230() {
  if (typeof switchView === "function") switchView("battles");
  if (typeof playAnotherBattle102 === "function") playAnotherBattle102();
  else if (typeof scrollBoardIntoView122 === "function") scrollBoardIntoView122();
}

function renderHomeFeatured230() {
  const sec = document.getElementById("homeFeat230");
  const body = document.getElementById("homeFeatBody230");
  if (!sec || !body) return;
  const entries = (typeof CONTEST !== "undefined" && CONTEST && CONTEST.entries) || [];
  const h = entries.length ? entries[0] : null;
  if (!h) { sec.hidden = true; body.innerHTML = ""; return; }
  const label = homeAthleteLabel230(h);
  const votes = h.voteCount;
  const [y, m] = String(CONTEST.period || "").split("-").map(Number);
  const monthName = y && m && typeof MONTHS !== "undefined" ? `${MONTHS[m - 1]} ${y}` : "";
  const chip = typeof momentChipInline162 === "function" ? momentChipInline162(h) : "";
  const views = Number(h.viewCount) >= 1 ? `<span class="feat-views151">▶ ${watchesText151(h.viewCount)}</span>` : "";
  const meta = chip || views ? `<div class="feat230-meta">${chip}${views}</div>` : "";
  const voteBtn = h.isSample
    ? `<span class="feat-vote134 is-static">${CROWN227} <b>${votes}</b> this month vote${votes === 1 ? "" : "s"}</span>`
    : `<button type="button" class="feat-vote134${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)"><span class="feat-vote-label134">${h.hasVoted ? "✓ Voted for this play" : "Vote for this play"}</span><span class="feat-vote-count134">${votes} vote${votes === 1 ? "" : "s"}</span></button>`;
  body.innerHTML = `<article class="feat230">
    <div class="feat230-media" role="button" tabindex="0" aria-label="Watch ${esc(label)} — ${esc(shortTitle(h.title))}" onclick="homeOpenPlay232(${h.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();homeOpenPlay232(${h.id})}">${homePosterMedia230(h, ' fetchpriority="high" decoding="async"')}<span class="feat230-disc"><svg width="24" height="27" viewBox="0 0 12 14" aria-hidden="true"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span></div>
    <div class="feat230-side">
      ${meta}
      <div class="feat230-body">
        <span class="feat230-eyebrow">Featured Play · ${CROWN227} Currently #1</span>
        <h3 class="feat230-title"><span class="who">${esc(label)}</span> · ${esc(shortTitle(h.title))}</h3>
        <p class="feat230-sub">${esc(cap(h.sport))}</p>
        <div class="feat230-standing"><span class="race">🏆 Hype of the Month${monthName ? ` · ${monthName}` : ""}</span><br><b>${esc(label)} leads with ${votes} vote${votes === 1 ? "" : "s"}</b> · Win a homepage feature and a social shoutout.</div>
        <div class="feat230-vote">${voteBtn}</div>
      </div>
    </div>
  </article>`;
  sec.hidden = false;
}

function homeMoreTile230(h) {
  /* Round 234 (2026-11-27, Emil — "Still some load issues",
     13:32 phone screenshot): the tile still is NO LONGER
     loading="lazy". These were the only homepage section
     stills still lazy — the battle and featured stills have
     ridden fetchpriority="high" since R232 and painted in
     the same screenshot where all four More tiles sat solid
     black on their .hm230-media ground, page-load bar still
     running: WebKit defers lazy images behind the page's
     video traffic (the autoplaying hero, the gated board
     renditions pre-rolling below the fold). The still IS
     this tile's whole content, so it now fetches with the
     render and decodes async. (These tiles never carried
     the R233 video gate — they are <img> stills by
     construction since R232's homePosterMedia230.) */
  const votes = h.voteCount;
  const pill = h.isSample
    ? `<span class="hm230-votebtn is-static">Vote</span>`
    : `<button type="button" class="hm230-votebtn${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)">${h.hasVoted ? "✓ Voted" : "Vote"}</button>`;
  return `<article class="hm230-tile">
    <div class="hm230-media" role="button" tabindex="0" aria-label="Watch ${esc(homeAthleteLabel230(h))} — ${esc(shortTitle(h.title))}" onclick="homeOpenPlay232(${h.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();homeOpenPlay232(${h.id})}">${homePosterMedia230(h, ' decoding="async"')}${Number(h.viewCount) >= 1 ? `<span class="hm230-watches">▶ ${fmtCount151(h.viewCount)}</span>` : ""}</div>
    <div class="hm230-body"><h4>${esc(shortTitle(h.title))}</h4><p>${esc(homeAthleteLabel230(h))} · ${esc(cap(h.sport))}</p>${pill}</div>
  </article>`;
}
function renderHomeLb230() {
  const rows = document.getElementById("homeLbRows230");
  if (!rows) return false;
  const mBtn = document.getElementById("homeLbTabMonth230"), fBtn = document.getElementById("homeLbTabFame230");
  if (mBtn) mBtn.setAttribute("aria-pressed", String(homeLbTab230 !== "fame"));
  if (fBtn) fBtn.setAttribute("aria-pressed", String(homeLbTab230 === "fame"));
  if (homeLbTab230 === "fame") {
    /* The Hall of Fame ranking, computed exactly as renderFame
       computes it (samples never take a Fame slot) — rendered
       here, into the home section's own rows. */
    const ranked = (typeof ALL_PLAYS !== "undefined" && Array.isArray(ALL_PLAYS) ? [...ALL_PLAYS] : [])
      .filter((h) => !h.isSample).sort((a, b) => b.voteCount - a.voteCount || b.id - a.id).slice(0, 10);
    rows.innerHTML = ranked.length ? ranked.map((h, i) => fameRowHtml134(h, i, { home232: true })).join("") : `<p class="hlb230-empty">No plays yet — the Hall of Fame fills in as plays are posted and voted on.</p>`;
    return ranked.length > 0;
  }
  const entries = (typeof CONTEST !== "undefined" && CONTEST && CONTEST.entries) || [];
  /* Round 232: homepage rows route their media tap to the
     swipe feed (opts.home232), on BOTH tabs — the R230 month
     rows rode feed189, whose host check only recognizes the
     board's own lists, so homepage taps fell back to the
     static detail; the fame rows rode goToPlayCard outright. */
  rows.innerHTML = entries.length ? entries.map((h, i) => fameRowHtml134(h, i, { home232: true })).join("") : `<p class="hlb230-empty">No entries yet this month — post a play, and once it's approved and entered it competes here.</p>`;
  if (typeof hydrateDurPills === "function") hydrateDurPills();
  return entries.length > 0;
}
function renderHomeMore230() {
  const sec = document.getElementById("homeMore230");
  const grid = document.getElementById("homeMoreGrid230");
  if (!sec || !grid) return;
  const entries = (typeof CONTEST !== "undefined" && CONTEST && CONTEST.entries) || [];
  const feat = entries.length ? entries[0] : null;
  let daily = null;
  try { daily = (typeof d100 !== "undefined" && d100) ? d100.daily : null; } catch (e) { /* battles block not initialized in this slice */ }
  const excluded = [];
  if (feat) excluded.push(feat);
  if (daily && daily.available) { if (daily.a) excluded.push(daily.a); if (daily.b) excluded.push(daily.b); }
  const plays = (typeof ALL_PLAYS !== "undefined" && Array.isArray(ALL_PLAYS)) ? ALL_PLAYS : [];
  const tiles = plays.filter((h) => !excluded.some((x) => homeSameAthlete230(x, h))).slice(0, 4);
  grid.innerHTML = tiles.map(homeMoreTile230).join("");
  grid.hidden = tiles.length === 0;
  const lbHas = renderHomeLb230();
  sec.hidden = !(tiles.length || lbHas || plays.some((h) => !h.isSample));
}
/* The orchestrator — renderAll and loadDaily100 both land here.
   The first pass usually beats the Daily fetch, so it kicks the
   one shared loader once; loadDaily100's completion hook calls
   back in and the battle card (plus the hero anchor and More
   Highlights' exclusion set) settles from the real state. */
function renderHome230() {
  try {
    renderHomeFeatured230();
    renderHomeMore230();
    let daily = null;
    try { daily = (typeof d100 !== "undefined" && d100) ? d100.daily : null; } catch (e) { /* battles block not initialized in this slice */ }
    if (daily) renderHomeBattle230();
    else {
      homeSyncHeroAnchor230(false);
      const sec = document.getElementById("homeBattle230"); if (sec) sec.hidden = true;
      if (!homeDailyKicked230 && typeof loadDaily100 === "function") { homeDailyKicked230 = true; loadDaily100(); }
    }
    /* Round 234: document-wide tile-gate bind — the home
       sections render after the board in renderAll, and
       loadDaily100 lands here too; binding the gate against
       the whole document at the end of this render means no
       gated tile from ANY section can sit unobserved. */
    if (typeof bindTileGate233 === "function") bindTileGate233();
  } catch (e) { /* the B2 sections are decoration — a hiccup here never breaks the board load */ }
}
(function homeLbWire230() {
  /* Guarded like initHeroFeed223: VM slices that evaluate this
     block without a DOM (the test suites') must not throw. */
  try {
    if (typeof document === "undefined" || !document || typeof document.getElementById !== "function") return;
    const bind = (id, tab) => { const el = document.getElementById(id); if (el) el.addEventListener("click", () => { homeLbTab230 = tab; renderHomeLb230(); }); };
    bind("homeLbTabMonth230", "month");
    bind("homeLbTabFame230", "fame");
  } catch (e) { /* no DOM in this context — the tabs simply stay unwired */ }
})();

/* ================================================================
   Round 232 (2026-11-27): Emil's phone review of the R230
   homepage — five fixes.
   (1) Battle stills: homePosterMedia230 can no longer emit a
       <video> (see its note) and the battle/featured posters
       ride fetchpriority="high" — both cards paint their poster
       still immediately and the homepage sections load ZERO
       video bytes until a tap. (Measured cause in the round's
       test file: both sides already resolved to poster <img>s
       with the live payload — A /uploads/poster-77.jpg at
       257,834 B, B /uploads/poster-78.jpg at 200,805 B, each
       served in ~0.5 s — but the stills are full-size
       baseline JPEGs requested only after the daily-battle
       fetch returns, queued behind the 6,964,246 B hero film
       and the board's autoplaying tile videos (stream
       renditions of 931,335–3,665,557 B apiece); B's baseline
       JPEG painted top-down — sky first over the black card —
       exactly Emil's screenshot.)
   (2) Battle meta dedupe: homeTeamDupAthlete232 below.
   (3) The featured eyebrow is one line (styles.css →232: the
       CROWN227 img was display:block under the global img
       rule, breaking the span across three lines; the eyebrow
       is inline-flex now and the crown class itself is
       hardened — see the styles note).
   (4) Homepage taps open the swipe feed: homeOpenPlay232
       below routes battle/featured/More media taps and both
       homepage leaderboard tabs' rows into openFeed189, the
       R223 feed Watch Highlights opens, starting at the
       tapped play and swiping onward in the feed's normal
       board order (feedHeroIds223). The board panel's own
       tiles are NOT touched.
   (5) The board panel's Month view sheds its featured card
       and leaderboard (markup removed in index.html;
       renderMonth/renderFame/syncFilterUI/switchView writes
       guarded in place), and everything that used to land on
       the board's leaderboard — ?view=fame, the feed's "See
       the Leaderboard" — lands on the homepage section via
       homeLbLanding232 below.
   (6) Posters carry a server-side cache-bust token
       (server.js posterUrl232) so a cleaned poster replaces
       its 24h-cached copy immediately — no client change
       needed; poster_url stays an opaque URL here.
   ================================================================ */

/* (2) Normalized name comparison for the battle meta: trim,
   collapse whitespace, lowercase, and drop a trailing period
   or trailing spaces — the athlete label renders as
   "Kameron A." while play 78's team field stores "Kameron A",
   and the two must compare equal. */
function homeNormName232(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.\s]+$/, "");
}
function homeTeamDupAthlete232(p) {
  const t = homeNormName232(p && p.team);
  if (!t) return false;
  return t === homeNormName232(homeAthleteLabel230(p)) || t === homeNormName232(p && p.player_name);
}

/* (4) The homepage's play opener: feed-first, exactly
   openPlay189's contract (feed when it can, the static detail
   as the fallback) — but ordered by the FEED's board order
   (feedHeroIds223, the same list Watch Highlights opens)
   instead of the tapped element's host list: homepage sections
   live outside #allBoard/#monthRows, so openPlay189's host
   lookup could never see them. battle = null — a homepage tap
   is a board play, never the Battles pair. */
window.homeOpenPlay232 = (id) => {
  const nid = Number(id);
  try {
    if (typeof feedEnabled189 === "function" && feedEnabled189() && typeof window.openFeed189 === "function") {
      const ids = typeof feedHeroIds223 === "function" ? feedHeroIds223() : null;
      if (ids && ids.indexOf(nid) > -1 && window.openFeed189(ids, nid, null)) return;
    }
  } catch (e) { /* the detail below is the fallback, exactly as in openPlay189 */ }
  if (typeof window.openPlayDetail === "function") window.openPlayDetail(id);
};

/* (5) Land on the homepage leaderboard: paint the named tab
   and scroll the More Highlights section into view. Readers:
   fameLink94 (?view=fame → "fame") and the feed's end-card /
   Leaderboard landing (feedGo189('month') → "month"). Fully
   guarded — a landing hiccup must never break the boot or the
   feed close that precedes it. */
function homeLbLanding232(tab) {
  try { homeLbTab230 = tab === "fame" ? "fame" : "month"; } catch (e) { /* the R230 tab state is not initialized in this context — the default tab stands */ }
  try { if (typeof renderHomeLb230 === "function") renderHomeLb230(); } catch (e) { /* rows repaint on the next renderAll */ }
  try {
    const go = () => { const s = document.getElementById("homeMore230"); if (s && !s.hidden && typeof s.scrollIntoView === "function") s.scrollIntoView({ behavior: "smooth", block: "start" }); };
    if (typeof setTimeout === "function") setTimeout(go, 60); else go();
  } catch (e) { /* scrolling is a courtesy — the tab is already painted */ }
}
