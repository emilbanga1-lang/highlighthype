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
const cap = (s) => { if (s === "fieldhockey") return "Field Hockey"; if (s === "martialarts") return "Martial Arts"; if (s === "track") return "Track & Field"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
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
function mediaHtml(h) {
  /* Round 123: every video this renders carries the Round 118
     poster pattern from FIRST paint (banked action frame when one
     exists, else the branded placeholder; the attribute set is
     computed by posterAttr123 in the Round 123 block, reached
     through a typeof guard so sandbox slices without it render
     exactly as before). */
  const poster123 = (typeof posterAttr123 === "function") ? posterAttr123(h) : "";
  if (h.media_kind === "file") {
    if ((h.mime || "").startsWith("image/")) return `<img src="${esc(h.media_url)}" alt="">`;
    return `<video src="${esc(h.media_url)}"${poster123} controls playsinline muted loop preload="auto" autoplay></video>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${esc(h.embed_url)}" allowfullscreen title="Embedded play"></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${esc(h.media_url)}"${poster123} controls playsinline muted loop preload="auto" autoplay></video>`;
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
/* Round 105 (2026-11-11): winner crowns — the server PERSISTS the
   records (play_crowns; samples included, they never expire), the
   client only renders them. Compact form (tiles, battle minis):
   the LATEST crown plus a "+N more" chip. Full form (cards — the
   athlete page and the play detail): every crown the play holds. */
function crownsHtml105(h, full) {
  if (!h || !Array.isArray(h.crowns) || !h.crowns.length) return "";
  if (full) return `<p class="play-crowns">${h.crowns.map((c) => `<span class="crown-chip">👑 ${esc(c.title)}</span>`).join("")}</p>`;
  const more = h.crowns.length > 1 ? `<span class="crown-chip crown-more">+${h.crowns.length - 1} more</span>` : "";
  return `<p class="play-crowns"><span class="crown-chip">👑 ${esc(h.crowns[0].title)}</span>${more}</p>`;
}
function crownSuffix105(h) { return h && Array.isArray(h.crowns) && h.crowns.length ? ` · 👑 ${h.crowns[0].title}` : ""; }
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
    <div class="thumb">${mediaHtml(h)}${h.isWinner ? `<span class="badge" style="background:#fff;color:#0a0a0a">🏆 Hype of the Month winner</span>` : ""}${opts.rank && !h.isSample ? `<span class="ranktag">#${opts.rank}</span>` : ""}</div>
    <div class="card-body">
      <h3>${esc(h.title)}</h3>
      <p class="meta"><b>${esc(cap(h.sport))}</b>${h.play_type ? ` · ${esc(h.play_type)}` : ""} · ${h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed"}</p>
      ${h.isSample ? `<p class="sample-line"><span class="sample-badge">⭐ SAMPLE PLAY</span></p><p class="meta sample-note">Sample play — posted by HighlightHype to show how it works.</p>` : ""}
      ${athleteLine(h)}
      ${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}
      ${typeof crownsHtml105 === "function" ? crownsHtml105(h, true) : ""}
      ${opts.numbers && typeof numbersHtml105 === "function" ? numbersHtml105(h) : ""}
      ${h.story ? `<p class="meta">${esc(h.story)}</p>` : ""}
      ${opts.prizeEligible === false ? `<p><span class="tagchip warn">Can't be featured — no parent/guardian contact on file</span></p>` : ""}
      <div class="votes">
        ${h.isSample ? `<span class="tile-demo-tag" title="Sample play — a demo, not in the contest">Demo</span>` : `<button type="button" class="votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id}, this)">${h.hasVoted ? "You voted — tap to remove" : "Vote"}</button>`}
        <span class="votecount"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>
        ${h.isSample || (!h.hasGuardianEmail && !ownerToken()) ? "" : `<button type="button" class="mini-btn" onclick="enterContest(${h.id}, this)">🏆 Enter this play</button>`}
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
  const secs = TILE_DURATIONS.get(h.media_url);
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
function hydrateDurPills() {
  $$(".dur-host").forEach((host) => {
    const video = host.querySelector("video");
    if (!video) return;
    if (video.readyState >= 1) { fillDurPill(host); markVertical107(host); }
    video.addEventListener("loadedmetadata", () => { fillDurPill(host); markVertical107(host); }, { once: true });
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
  /* Round 45 (2026-11-08): ONE muted line under the title — name ·
     sport · division · count · age (the concept's quiet line; the
     count is bold so it still reads at a glance). */
  const parts = [];
  const first = firstNameOf(h);
  if (first) parts.push(esc(first));
  parts.push(esc(cap(h.sport)));
  parts.push(h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed");
  parts.push(`<b>${votes}</b> ${voteLabel || "all-time"} vote${votes === 1 ? "" : "s"}`);
  const age = humanAge(h.created_at);
  if (age) parts.push(age);
  return `<p class="tile-meta tile-info">${parts.join(" · ")}</p>`;
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
   the display-only chip — no vote affordance, as ever. */
function tileHtml(h, opts = {}) {
  const votes = opts.monthVotes != null ? opts.monthVotes : h.voteCount;
  const voteLabel = opts.monthVotes != null ? "this month" : "all-time";
  return `<article class="tile" data-tile-id="${h.id}" role="button" tabindex="0" aria-label="${esc(h.title)} — open the play" onclick="openPlayDetail(${h.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openPlayDetail(${h.id})}">
    <div class="tile-media dur-host">${fameThumbHtml(h)}<span class="tile-tap" aria-hidden="true" onclick="event.stopPropagation();openPlayDetail(${h.id})"></span><span class="tile-disc" aria-hidden="true"><svg width="17" height="19" viewBox="0 0 12 14"><path d="M0 0 L12 7 L0 14 Z" fill="#fff"/></svg></span>${h.isSample ? `<span class="tile-sample-tag">⭐ SAMPLE PLAY</span>` : ""}${h.isWinner ? `<span class="badge" style="background:#fff;color:#0a0a0a">🏆 Hype of the Month winner</span>` : ""}${opts.rank && !h.isSample ? `<span class="ranktag">#${opts.rank}</span>` : ""}${durPillHtml(h)}</div>
    <div class="tile-body">
      <div class="tile-toprow">
        <h3 class="tile-title">${esc(h.title)}</h3>
        <span class="tile-dots" aria-hidden="true">⋮</span>
      </div>
      ${tileInfoHtml(h, votes, voteLabel)}
      ${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}
      ${typeof crownsHtml105 === "function" ? crownsHtml105(h) : ""}
      <div class="tile-votes">
        ${h.isSample ? `<span class="vote-chip">👑 <b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>` : `<button type="button" class="vote-chip vote-chip-btn${h.hasVoted ? " voted" : ""}" aria-pressed="${h.hasVoted ? "true" : "false"}" aria-label="${h.hasVoted ? "You voted for this play — tap to remove your vote" : "Vote for this play"}" onclick="event.stopPropagation();toggleVote(${h.id}, this)">${h.hasVoted ? "👑 Voted" : "👑 Vote"} · <b>${votes}</b></button>`}
        <button type="button" class="mini-btn tile-hf-btn" onclick="event.stopPropagation();openHypeFrame(${h.id})" aria-label="Create a Hype Frame from this play">📸 Frame</button>
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
window.enterContest = (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || CONTEST.entries.find((p) => p.id === id);
  // Sample plays (Round 7): the Enter button is hidden on their cards;
  // this guards the flow itself if it is ever triggered another way.
  // The server refuses samples too, with the same message.
  if (play && play.isSample) {
    setEnterMsg(id, `<p class="card-msg-text">Sample plays can't enter Hype of the Month.</p>`);
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
function renderMonth() {
  const entries = CONTEST.entries || [];
  const [y, m] = (CONTEST.period || "").split("-").map(Number);
  if (y && m) { $("#boardTag").textContent = `The board · ${MONTHS[m - 1]}`; }
  // Podium: top 3 contest entries by this month's votes, medals beside rank.
  const top = entries.slice(0, 3);
  $("#podium").innerHTML = top.length ? top.map((h, i) => `
    <div class="pod${i === 0 ? " first" : ""}">${i === 0 ? `<span class="lead">Leading · Hype of the Month</span>` : ""}
      <div class="pod-main"><div class="rank-row"><div class="rank">${i + 1}</div>${medalSvg(i + 1)}</div>
      <div class="pod-text"><div class="who">${esc(h.title)}</div><div class="what">${esc(cap(h.sport))} · ${h.division === "girls" ? "Girls" : "Boys"} · ${h.voteCount} vote${h.voteCount === 1 ? "" : "s"} this month</div></div></div>
    </div>`).join("") : `<div class="pod"><div class="pod-text"><div class="who">No entries yet this month</div><div class="what">Enter an approved play to start the board.</div></div></div>`;
  const filtered = entries.filter((h) => divMatch(h, monthDiv) && (monthSport === "all" || h.sport === monthSport));
  // Round 54: first tile into .tile-featured-slot, the rest into
  // .tile-deck (display:contents on desktop, stacked + swipe deck
  // on phones — see styles.css). Inlined at both render sites: the
  // test suites slice these functions separately.
  const monthTiles = filtered.map((h) => tileHtml(h, { monthVotes: h.voteCount }));
  $("#board").innerHTML = monthTiles.length ? `<div class="tile-featured-slot">${monthTiles[0]}</div>` + (monthTiles.length > 1 ? `<div class="tile-deck">${monthTiles.slice(1).join("")}</div>` : "") : "";
  hydrateDurPills();
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
/* Hall of Fame thumbnails (Round 5, 2026-11-05): image plays keep
   their photo; video plays — uploaded files and direct link videos,
   the same two kinds the board cards play — get a REAL playing video
   (muted, looping, inline) instead of the old sport-name placeholder.
   Anything else (embeds, watch-links) keeps the sport-name fallback. */
function fameThumbHtml(h) {
  if (h.media_kind === "file" && (h.mime || "").startsWith("image/")) return `<img src="${esc(h.media_url)}" alt="">`;
  /* Round 123: board tiles wear the Round 118 poster pattern from
     first paint too (see mediaHtml) — a tile never sits black while
     its clip loads. */
  if (h.media_kind === "file" || h.media_kind === "link_video") return `<video src="${esc(h.media_url)}"${(typeof posterAttr123 === "function") ? posterAttr123(h) : ""} muted loop playsinline autoplay preload="metadata"></video>`;
  return `<span style="display:grid;place-items:center;height:100%;color:#fff;font-weight:800">${esc(cap(h.sport))}</span>`;
}
function renderFame() {
  // Hall of Fame (Round 7): sample plays are demos — their votes are
  // real demo votes, but a sample must never take a Hall of Fame slot.
  // This ranking is computed here (from ALL_PLAYS) and nowhere else,
  // so the filter lives at the computation point; contest exclusion
  // is additionally enforced server-side.
  const ranked = [...ALL_PLAYS].filter((h) => !h.isSample).sort((a, b) => b.voteCount - a.voteCount || b.id - a.id).slice(0, 10);
  $("#fameList").innerHTML = ranked.length ? ranked.map((h, i) => `
    <div class="fame-row${i === 0 ? " top" : ""}" role="button" tabindex="0" title="See this play's card" onclick="goToPlayCard(${h.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();goToPlayCard(${h.id})}">
      <span class="fame-rank">${i + 1}</span>
      <span class="fame-thumb">${fameThumbHtml(h)}</span>
      <div class="fame-info"><h4>${esc(h.title)}</h4><p>${esc(cap(h.sport))} · ${h.division === "girls" ? "Girls" : "Boys"}${h.team ? ` · ${esc(h.team)}` : " · No team tagged"}${h.athlete_label ? ` · ${esc(h.athlete_label)}` : ""}${h.athlete_tag ? ` · ${esc(h.athlete_tag)}` : ""}</p></div>
      <div class="fame-votes"><b>${h.voteCount}</b><span>All-time votes</span></div>
    </div>`).join("") : `<p style="color:var(--muted)">No plays yet — the Hall of Fame fills in as plays are posted and voted on.</p>`;
}
function renderMine() {
  const byAthlete = new Map();
  for (const h of ALL_PLAYS) {
    if (!h.athlete_id) continue;
    if (!byAthlete.has(h.athlete_id)) byAthlete.set(h.athlete_id, { id: h.athlete_id, label: h.athlete_label || h.player_name || "Athlete", team: h.team || "", tag: h.athlete_tag || "", count: 0 });
    const a = byAthlete.get(h.athlete_id);
    a.count++;
    if (!a.team && h.team) a.team = h.team;
    if (h.athlete_tag) a.tag = h.athlete_tag;
  }
  const list = [...byAthlete.values()].sort((a, b) => b.count - a.count);
  $("#mineAthletes").innerHTML = list.length ? list.map((a) => `
    <div class="queue-item" style="display:flex;gap:14px;align-items:center">
      <div class="athlete-avatar" aria-hidden="true">${esc((a.label || "?")[0].toUpperCase())}</div>
      <div style="flex:1"><b>${esc(a.label)}</b>${a.team ? ` · ${esc(a.team)}` : ""}${a.tag ? ` · <span class="tagchip">${esc(a.tag)}</span>` : ""}<br><span style="color:var(--muted)">${a.count} public play${a.count === 1 ? "" : "s"}</span></div>
      <button type="button" class="mini-btn" onclick="openAthlete('${esc(a.id)}')">See all plays →</button>
    </div>`).join("") : `<p style="color:var(--muted)">No athletes on the board yet — the first approved play starts the first collection.</p>`;
}
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
function guardianPlaysHtml121(plays) {
  const chip = (p) => {
    if (p.status === "approved") return `<span class="status-chip chip-live">✅ Live on the board</span>` + (p.inContest ? ` <span class="status-chip chip-contest">🏆 Entered in Hype of the Month</span>` : "");
    if (p.status === "pending") return `<span class="status-chip chip-review">⏳ In review</span>`;
    return `<span class="status-chip chip-off">Not on the board</span>`;
  };
  const when = (iso) => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); };
  return `<p class="mine-find-msg" style="margin-top:0">Your plays — every play posted with that email:</p>` + plays.map((p) => `
    <div class="queue-item mine-play-row" style="display:flex;gap:14px;align-items:center">
      <div style="flex:1"><b>${esc(p.title)}</b><br><span style="color:var(--muted)">${esc(p.athlete_label || "")}${p.athlete_tag ? ` · <span class="tagchip">${esc(p.athlete_tag)}</span>` : ""} · ${esc(cap(p.sport))}${p.team ? ` · ${esc(p.team)}` : ""}${when(p.created_at) ? ` · posted ${esc(when(p.created_at))}` : ""}</span><br>${chip(p)}</div>
      ${p.status === "approved" && p.athlete_id ? `<button type="button" class="mini-btn" onclick="openAthlete('${esc(p.athlete_id)}')">See plays →</button>` : ""}
    </div>`).join("");
}
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
function renderAll() { syncFilterUI(); renderMonth(); renderFame(); renderAll2(); renderMine(); renderPlayDetail(); highlightSharedPlay(); if (typeof updateContestStrip107 === "function") updateContestStrip107(); }
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
  const state = !entries.length
    ? "No entries yet — post a play; once it's approved, the parent who posted it can enter it"
    : !total
      ? "No votes yet — every vote counts"
      : (() => { const lead = entries.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0))[0]; return `Leader: ${lead.title} · ${lead.voteCount} vote${lead.voteCount === 1 ? "" : "s"}`; })();
  const [y, m] = (CONTEST.period || "").split("-").map(Number);
  const label107 = CONTEST.monthLabel || (y && m ? `${MONTHS[m - 1]} ${y}` : "");
  const t1 = $("#stripTitle"), t2 = $("#stripState"), ends = $("#stripEnds");
  if (t1) t1.textContent = label107 ? `Hype of the Month · ${label107}` : "Hype of the Month";
  if (t2) t2.textContent = state;
  const endsTxt = y && m ? `Ends ${MONTHS[m - 1].slice(0, 3)} ${new Date(y, m, 0).getDate()}` : "";
  if (ends) ends.textContent = endsTxt;
  const ms = $("#monthSub107");
  if (ms) ms.textContent = `${label107 ? `${label107} · ` : ""}${!entries.length ? "No entries yet — post a play, and once it's approved the parent/guardian who posted it can enter it here." : !total ? "No votes yet — every play is tied at 0. The first vote takes the lead." : "Every vote counts."}${endsTxt ? ` Voting ends ${endsTxt.replace("Ends ", "")}.` : ""}`;
  /* Round 123: the Watch view's slim contest line — the same live
     state in one line: month name, the honest entries count, and
     the tail that fits the state (enter while it's empty, vote
     once there's a board). */
  const slim123 = $("#contestSlimText123");
  if (slim123) {
    const monthName123 = m ? MONTHS[m - 1] : "";
    slim123.textContent = !entries.length
      ? `🏆 Hype of the Month${monthName123 ? ` — ${monthName123}` : ""}: no entries yet · Post a play to enter →`
      : `🏆 Hype of the Month${monthName123 ? ` — ${monthName123}` : ""}: ${entries.length} entr${entries.length === 1 ? "y" : "ies"} · Vote now →`;
  }
}
function renderAll2() { /* All Hypes view */
  // Round 10 (2026-11-05): the "All teams" filter is GONE at the
  // owner's direction — control, option population and the team
  // clause all removed; filtering behaves as if the team is always
  // "all" (team names still match through the search box). No API
  // change: loadData never sent a team parameter (the server's
  // /api/highlights team param simply stays at its "all" default).
  const q = allSearch.toLowerCase();
  const filtered = ALL_PLAYS.filter((h) =>
    divMatch(h, allDiv) &&
    (allSport === "all" || h.sport === allSport) &&
    (!q || [h.title, h.player_name, h.story, h.team, h.sport].join(" ").toLowerCase().includes(q)));
  $("#allCount").textContent = `${filtered.length} plays`;
  const emptyEl = $("#allEmpty");
  emptyEl.textContent = "No plays match — try a different board, sport, or search.";
  const allTiles = filtered.map((h, i) => tileHtml(h, { rank: i + 1 }));
  $("#allBoard").innerHTML = allTiles.length ? `<div class="tile-featured-slot">${allTiles[0]}</div>` + (allTiles.length > 1 ? `<div class="tile-deck">${allTiles.slice(1).join("")}</div>` : "") : "";
  hydrateDurPills();
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
  return `<article class="card watch-card" data-play-id="${h.id}">
    <div class="watch-player">${mediaHtml(h)}</div>
    <div class="watch-meta">
      <h2 class="watch-title">${esc(h.title)}</h2>
      <p class="watch-line"><b>${esc(cap(h.sport))}</b>${h.play_type ? ` · ${esc(h.play_type)}` : ""} · ${h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed"}${athleteBit ? ` · ${athleteBit}` : ""}</p>
      ${typeof badgesHtml100 === "function" ? badgesHtml100(h) : ""}
      ${typeof crownsHtml105 === "function" ? crownsHtml105(h, true) : ""}
      ${h.isSample ? `<p class="sample-line"><span class="sample-badge">⭐ SAMPLE PLAY</span> <span class="watch-demo">Demo</span></p><p class="meta sample-note">Sample play — posted by HighlightHype to show how it works.</p>` : ""}
      ${h.story ? `<p class="meta">${esc(h.story)}</p>` : ""}
      ${entry && entry.prizeEligible === false ? `<p><span class="tagchip warn">Can't be featured — no parent/guardian contact on file</span></p>` : ""}
    </div>
    <div class="watch-vote">
      ${h.isSample ? "" : `<button type="button" class="votebtn watch-votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id}, this)">${h.hasVoted ? "You voted — tap to remove" : "👑 Vote for Hype of the Month"}</button>`}
      <p class="watch-count"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</p>
    </div>
    <div class="card-actions watch-actions">
      <button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>
      ${h.isSample || (!h.hasGuardianEmail && !ownerToken()) ? "" : `<button type="button" class="mini-btn" onclick="enterContest(${h.id}, this)">🏆 Enter this play</button>`}
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
    return `<button type="button" class="upnext-row" onclick="openPlayDetail(${p.id})" aria-label="Up next: ${esc(p.title)}">
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
  if (!opts.keepHash) history.replaceState(null, "", `#play-${id}`);
  wrap.querySelector(".play-detail-back")?.focus();
};
function hidePlayDetail() {
  teardownDetailAutoplay(); // Round 15: nothing advances in the background once closed
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
  hidePlayDetail();
  if (was != null && (location.hash === `#play-${was}` || location.hash === `#watch-${was}`)) history.replaceState(null, "", "#top");
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
  history.replaceState(null, "", `#athlete-${athleteId}`);
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
function showPanel(name) {
  // Any panel navigation leaves the play detail behind (Round 8):
  // the overlay belongs to the boards, and panels (athlete, studio,
  // store…) replace the view. hidePlayDetail leaves the hash alone —
  // the #play- route reads it after showPanel runs.
  hidePlayDetail();
  $$(".panel[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  $$("[data-panel-btn]").forEach((b) => { if (b.dataset.panelBtn) b.setAttribute("aria-current", String(b.dataset.panelBtn === name)); });
  // Site stats: count the MAIN views only. Athlete pages and the
  // Hype Frame studio are steps inside a visit, not front doors, so
  // they are deliberately not counted as views.
  const viewKey = { plays: "home", mine: "mine", how: "how" }[name];
  if (viewKey && typeof trackEvent === "function") trackEvent("view", viewKey);
}
$$("[data-panel-btn]").forEach((b) => b.addEventListener("click", () => { showHome(); closeMenu(false); if (location.hash.startsWith("#hype-frame")) history.replaceState(null, "", "#top"); showPanel(b.dataset.panelBtn); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));
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
  $("#viewMonth").hidden = v !== "month" || fame;
  $("#viewFame").hidden = !fame;
  $("#viewAll").hidden = v !== "all";
  $$(".month-subseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.msub === monthSub)));
  const mSeg94 = $("#monthDivSeg"); if (mSeg94) mSeg94.hidden = !(v === "month" && !fame);
  const aSeg94 = $("#allDivSeg"); if (aSeg94) aSeg94.hidden = v !== "all";
  const viewBattlesEl = $("#viewBattles"); if (viewBattlesEl) viewBattlesEl.hidden = v !== "battles";
  $("#chipMonth").style.display = v === "month" ? "" : "none";
  /* Round 107: the contest strip belongs to the Watch feed only —
     Battles and the Month panel carry their own headers.
     Round 123: the strip MOVED into the Month panel — it now
     shows on the Month view (the fame sub-view hides the whole
     panel, strip included), and the slim one-line replacement
     (#contestSlim123) takes the old Watch-only rule. */
  const cs107 = $("#contestStrip"); if (cs107) cs107.hidden = v !== "month";
  const csSlim123 = $("#contestSlim123"); if (csSlim123) csSlim123.hidden = v !== "all";
  const seeAllRow = $("#seeAllRow"); if (seeAllRow) seeAllRow.hidden = v === "all";
  $("#boardTitle").innerHTML = v === "month" ? (fame ? `Hall of <span class="lime">Fame</span>` : `Hype of the Month`) : v === "battles" ? `Hype <span class="lime">Battles</span>` : `All <span class="lime">Hypes</span>`;
  /* Round 69 (2026-11-09, Emil): each board tab explains itself. */
  $("#boardIntro").textContent = v === "month" ? (fame ? "The most-voted plays of all time." : "Post a play — once it's approved, the parent who posted it can enter it. Your votes crown the winner.") : v === "battles" ? "Two plays go head to head. Which Play Wins?" : "Watch plays from every sport.";
  if (v === "battles" && typeof initBattles === "function") initBattles();
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
$$(".month-subseg button").forEach((b) => b.addEventListener("click", () => setMonthSub(b.dataset.msub)));
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
}
function showHome() {
  setStoreFocus(null);
  if (!document.body.classList.contains("store-open")) return;
  document.body.classList.remove("store-open");
  if (location.hash === "#shop") history.replaceState(null, "", "#top");
  /* Round 98 (2026-11-11): returning home restarts the hero MUTED
     even if the visitor had tapped its sound on before entering the
     Store — sound is per-visit and only the speaker icon turns it
     on. (The hero's volumechange listener re-syncs the icon.) */
  const hv = $("#heroVideo"); if (hv) { if (hv.dataset && hv.dataset.src && !hv.getAttribute("src")) hv.src = hv.dataset.src; hv.muted = true; const p = hv.play(); if (p && p.catch) p.catch(() => {}); }
  /* Round 48 (2026-11-08): the old homepage-film resume is retired —
     the homepage Hype Frame film is click-to-play now (Emil: no
     autoplay competing with the hero), so returning home must NOT
     start it. The studio film still resumes on studio open. */
  // Round 11 fix (2026-11-05): showStore() pauses the montage clips
  // too, and nothing resumed them — after one Store visit the three
  // sport strips froze on their posters for the rest of the session.
  $$(".montage video").forEach((v) => { const p = v.play(); if (p && p.catch) p.catch(() => {}); });
}
/* Round 48 (2026-11-08): the homepage Hype Frame film is
   click-to-play — the cream-hoodie cover swaps out and the film
   plays inline in the same frame. Nothing starts it but the tap. */
function playHfHomeFilm() {
  const cover = $("#hfFilmCover"), vid = $("#hfHomeFilm");
  if (!vid) return;
  if (cover) cover.hidden = true;
  vid.hidden = false;
  const p = vid.play(); if (p && p.catch) p.catch(() => {});
}
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
  window.scrollTo(0, 0);
  if (location.hash.startsWith("#hype-frame")) history.replaceState(null, "", "#top");
}
$$("[data-store-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); closeMenu(false); showStore(a.dataset.storeTarget || null); }));
$$("[data-home-link]").forEach((b) => b.addEventListener("click", () => goHome()));
$$(".brand").forEach((b) => b.addEventListener("click", () => goHome()));
window.addEventListener("hashchange", () => {
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
  const monthSports = sportsInData((CONTEST.entries || []).filter((h) => divMatch(h, monthDiv)));
  if (monthSport !== "all" && !monthSports.includes(monthSport)) monthSport = "all";
  const allSports = sportsInData(ALL_PLAYS.filter((h) => divMatch(h, allDiv)));
  if (allSport !== "all" && !allSports.includes(allSport)) allSport = "all";
  renderSportSelect($("#monthSportSelect"), monthSport, monthSports, (s) => { monthSport = s; syncFilterUI(); renderMonth(); });
  renderSportSelect($("#allSportSelect"), allSport, allSports, (s) => { allSport = s; syncFilterUI(); renderAll2(); });
  $$("#monthDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === monthDiv)); b.onclick = () => { monthDiv = b.dataset.div; syncFilterUI(); renderMonth(); }; });
  $$("#allDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === allDiv)); b.onclick = () => { allDiv = b.dataset.div; syncFilterUI(); renderAll2(); }; });
  // Round 62 (2026-11-08): the shared sport pill bar mirrors the
  // current view's sport (Month reads monthSport, the other views
  // allSport) — the fallbacks above have already run by here.
  const spCurrent = (typeof currentView !== "undefined" && currentView === "month") ? monthSport : allSport;
  $$("#sportPills .sp-pill").forEach((b) => b.classList.toggle("active", b.dataset.sp === spCurrent));
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
  // Price is set ($69.99 across Drop 001 youth hoodies); the size
  // selector is selection state only — no cart, no checkout — and it
  // resets each time the quick view opens.
  $$("#qvSizes .qv-size").forEach((b) => b.setAttribute("aria-pressed", "false"));
  qv.hidden = false;
  document.body.classList.add("qv-open");
  qv.querySelector(".qv-close")?.focus();
  requestAnimationFrame(qvSyncGallery);
}
$("#qvGallery")?.addEventListener("scroll", () => requestAnimationFrame(qvSyncGallery), { passive: true });
$$("#qvSizes .qv-size").forEach((b) => b.addEventListener("click", () => {
  $$("#qvSizes .qv-size").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
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
  $$("#hsSizes .hsv-size").forEach((b) => b.setAttribute("aria-pressed", "false"));
  hsSetTab("desc");
  hsSetFrame(0);
  view.hidden = false;
  document.body.classList.add("hsv-open");
  view.querySelector(".hsv-close")?.focus();
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
$$("#hsSizes .hsv-size").forEach((b) => b.addEventListener("click", () => {
  $$("#hsSizes .hsv-size").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
}));
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
const HF_COLORWAYS = {
  hoodie: [
    { name: "Black", hex: "#17171a" }, { name: "Cream", hex: "#f3e7cf" },
    { name: "Pink", hex: "#f3a8c4" }, { name: "Navy", hex: "#14264a" },
    { name: "Forest Green", hex: "#14532d" }, { name: "Heather Gray", hex: "#a8abb0" },
    { name: "Light Blue", hex: "#a9d7f0" }, { name: "Olive", hex: "#66704a" },
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
const hfState = { play: null, mediaType: "", apparel: "hoodie", side: "front", imageStyle: "photo", colorway: "Black", size: "YM", frozen: false, printDataUrl: "", printAspect: 0, placement: { ...HF_PLACEMENT_DEFAULT }, preset: "hypeframe" };
// (Store v8: the Hype Frame lockup — purple crown, script, underline —
// is drawn as canvas vector work in hfDrawLockup, so the old crown.png
// image loader is gone.)

window.openHypeFrame = (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || (CONTEST.entries || []).find((p) => p.id === id);
  if (!play) { alert("That play isn't on the board anymore."); return; }
  showHome(); closeMenu(false); showPanel("hypeframe");
  history.replaceState(null, "", `#hype-frame-${id}`);
  initHfStudio(play);
  // Round 4 fix (2026-11-05): the studio film lives in .view-home, so a
  // store visit leaves it paused (see showHome) — start it explicitly.
  const hfFilm = document.querySelector("#hypeframe .hf-film video"); if (hfFilm) { const p = hfFilm.play(); if (p && p.catch) p.catch(() => {}); }
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
  hfSetPreset("hypeframe");
  $("#hfMsg").textContent = "";
  // The garment stays fixed (hoodie); color, size AND print side are
  // the family's choice — the side picker returned in Round 35
  // (2026-11-07, Emil). Reset all three pickers for the new play.
  hfState.apparel = "hoodie";
  hfPickSide("front");
  hfPickImageStyle("photo");
  hfPickColor((HF_COLORWAYS.hoodie[0] || {}).name || "Black");
  hfPickSize("YM");
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
  hfBuildStrip();
  hfSyncFrozenThumb(); // new play: no print yet — confirmation hidden, Freeze label restored
}
/* Frame filmstrip (2026-11-05): thumbnails captured client-side from
   the play's own video at ~1s intervals (coarser for long clips, max
   ~30 thumbs) in a scrollable strip under the video. Tapping one
   seeks the studio video to that moment and pauses — the kid then
   hits Freeze, or nudges with the ±1s buttons. Captures run on a
   detached video element so the studio player is never disturbed;
   plays are same-origin files, so the canvas is not tainted. */
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
    cap.removeAttribute("src"); cap.load();
  });
}
function hfJumpToFrame(t, btn) {
  const v = $("#hfVideo"); if (!v) return;
  v.pause();
  if (v.duration) v.currentTime = Math.min(Math.max(0, t), v.duration);
  const scrub = $("#hfScrub"); if (scrub) scrub.value = v.currentTime || t;
  hfUpdateTime();
  $$("#hfStrip .hf-thumb").forEach((el) => el.classList.toggle("active", el === btn));
}
function hfFmtTime(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
function hfUpdateTime() {
  const v = $("#hfVideo");
  $("#hfTime").textContent = `${hfFmtTime(v.currentTime)} / ${hfFmtTime(v.duration)}`;
}
function freezeHfFrame() {
  if (!hfState.play) { alert("Pick a play on the board first."); return; }
  const c = $("#hfCanvas"), x = c.getContext("2d");
  if (hfState.mediaType === "video") {
    const v = $("#hfVideo");
    if (!v.videoWidth || v.readyState < 2) { alert("Give the video a moment to load, then freeze again."); return; }
    v.pause(); // freeze works mid-play: stop on this exact frame first
    c.width = v.videoWidth; c.height = v.videoHeight;
    x.drawImage(v, 0, 0, c.width, c.height);
  } else if (hfState.mediaType === "image") {
    const im = $("#hfPhoto");
    if (!im.naturalWidth) { alert("Give the photo a moment to load, then freeze again."); return; }
    c.width = im.naturalWidth; c.height = im.naturalHeight;
    x.drawImage(im, 0, 0, c.width, c.height);
  } else {
    alert("This play was posted as a link, so a frame can't be frozen from it here.");
    return;
  }
  hfState.frozen = true;
  composeHfPrint();
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
}
// Compose the FINAL print image: the frozen frame, the optional HYPE
// FRAME poster treatment (grunge frame + lockup band), and the name /
// jersey caption under the frame. The submitted order carries this
// exact image — what is composed here is what would print. (Round 2:
// the composition is no longer shown on a garment preview in the
// studio; it lives in hfState and rides on the order payload.)
function composeHfPrint() {
  if (!hfState.frozen) { hfState.printDataUrl = ""; hfState.printAspect = 0; hfSyncFrozenThumb(); return; }
  const fc = $("#hfCanvas");
  const W = fc.width, H = fc.height;
  const name = $("#hfName").value.trim(), jersey = $("#hfJersey").value.trim();
  // Look presets (2026-11-04): Classic = photo only, Signature = photo
  // + name/number caption band, Hype Frame = photo + poster treatment.
  const branding = hfState.preset === "hypeframe";
  const caption = hfState.preset === "signature"
    ? [name ? name.toUpperCase() : "", jersey ? "#" + jersey.replace(/^#/, "") : ""].filter(Boolean).join(" · ")
    : "";
  const bandH = caption ? Math.round(W * 0.17) : branding ? Math.round(W * 0.30) : 0;
  const c = document.createElement("canvas");
  c.width = W; c.height = H + bandH;
  const x = c.getContext("2d");
  x.drawImage(fc, 0, 0);
  if (branding) {
    // Poster identity (Store v8, from Emil's concept poster): a grunge
    // brush-stroke frame around the photo, and the lockup — purple
    // crown, HYPE FRAME script, HIGHLIGHTHYPE — in the band UNDER the
    // photo, replacing the old corner branding. Frame + script tone
    // follows the chosen garment colorway (bone on dark, ink on
    // light) so the print reads on whatever it is printed on.
    const tone = hfPrintTone();
    hfGrungeFrame(x, W, H, tone);
    hfDrawLockup(x, W, H, bandH, tone);
  }
  if (caption) {
    const fs = Math.round(W * 0.072);
    x.font = `800 ${fs}px Archivo, Arial, sans-serif`;
    x.textAlign = "center"; x.textBaseline = "middle";
    try { x.letterSpacing = "3px"; } catch {}
    x.lineWidth = Math.max(3, fs / 7); x.strokeStyle = "rgba(0,0,0,.65)";
    const cy = H + bandH / 2;
    x.strokeText(caption, W / 2, cy);
    x.fillStyle = "#ffffff"; x.fillText(caption, W / 2, cy);
  }
  hfState.printDataUrl = c.toDataURL("image/png");
  hfState.printAspect = c.height / c.width;
  hfSyncFrozenThumb();
}
// Print style presets: radio behavior over the three options; the
// choice re-composes the print live, exactly like the old checkbox did.
function hfSetPreset(p) {
  hfState.preset = p;
  $$("[data-hf-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfPreset === p)));
  if (hfState.frozen) composeHfPrint();
}
// Hoodie color + youth size (Round 3, 2026-11-05): Emil reversed the
// Round 2 simplification for these two fields. The color drives the
// composed print's frame tone (hfPrintTone reads hfState.colorway), so
// picking one re-composes a frozen print exactly like a style change.
// The garment stays "hoodie" and the side stays "front" — there is
// still no apparel mock, garment picker or side toggle.
const HF_SIZES = ["YXXS", "YXS", "YS", "YM", "YL", "YXL"];
function hfPickColor(name) {
  const list = HF_COLORWAYS[hfState.apparel] || [];
  if (!list.some((k) => k.name === name)) return;
  hfState.colorway = name;
  $$("#hfColors [data-hf-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfColor === name)));
  if (hfState.frozen) composeHfPrint();
}
function hfPickSize(size) {
  if (!HF_SIZES.includes(size)) return;
  hfState.size = size;
  $$("#hfSizes [data-hf-size]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfSize === size)));
}
/* Print side (RESTORED in Round 35, 2026-11-07 — Emil's call after
   the usability audit): the picker was removed in the Round 3 studio
   revision, but the order payload, the server column, the owner
   email and the Owner view carried the side all along — orders just
   always said Front. Now the family picks; default stays Front. */
function hfPickSide(side) {
  hfState.side = side === "back" ? "back" : "front";
  $$("#hfSides [data-hf-side]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfSide === hfState.side)));
}
/* Photo or Avatar (Round 38, 2026-11-08 — Twinkie's idea, approved by
   Twinkie + Nicholas): 'photo' prints the frozen frame as-is; 'avatar'
   has the frame illustrated at fulfillment. The choice rides on the
   order exactly like the print side; default is the real photo, reset
   for each new play. */
function hfPickImageStyle(style) {
  hfState.imageStyle = style === "avatar" ? "avatar" : "photo";
  $$("#hfImageStyles [data-hf-image-style]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfImageStyle === hfState.imageStyle)));
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
  $("#hfScrub").addEventListener("input", (e) => { if (v.duration) { v.currentTime = Number(e.target.value); hfUpdateTime(); } });
  $("#hfFreeze").addEventListener("click", freezeHfFrame);
  // Step buttons nudge the playhead ±1s (paused) so the exact moment is
  // easy to land on before freezing.
  const hfSeek = (d) => { if (v.duration) { v.pause(); v.currentTime = Math.min(Math.max(0, (v.currentTime || 0) + d), Math.max(0, v.duration - 0.05)); hfUpdateTime(); } };
  $("#hfStepBack").addEventListener("click", () => hfSeek(-1));
  $("#hfStepFwd").addEventListener("click", () => hfSeek(1));
  ["hfName", "hfJersey"].forEach((id) => $("#" + id).addEventListener("input", () => { if (hfState.frozen) composeHfPrint(); }));
  $$("[data-hf-preset]").forEach((b) => b.addEventListener("click", () => hfSetPreset(b.dataset.hfPreset)));
  // Color + size pickers (Round 3): color buttons are built from
  // HF_COLORWAYS so the list lives in exactly one place; size buttons
  // are static markup wired here.
  hfBuildColorButtons();
  $$("#hfSizes [data-hf-size]").forEach((b) => b.addEventListener("click", () => hfPickSize(b.dataset.hfSize)));
  $$("#hfSides [data-hf-side]").forEach((b) => b.addEventListener("click", () => hfPickSide(b.dataset.hfSide)));
  $$("#hfImageStyles [data-hf-image-style]").forEach((b) => b.addEventListener("click", () => hfPickImageStyle(b.dataset.hfImageStyle)));
  // Print placement is FIXED at the default (2026-11-04): no drag, no
  // placement controls and no garment preview; the order carries the
  // default placement, the fixed garment (hoodie), the chosen print
  // side (picker restored Round 35), colorway and size.
  $("#hfOrderForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const msg = $("#hfMsg");
    if (!hfState.play) { msg.textContent = "Pick a play on the board first — Hype Frame starts from an approved play."; return; }
    if (!hfState.frozen || !hfState.printDataUrl) { msg.textContent = "Freeze a frame first — the print starts from your frozen still."; return; }
    const guardianEmail = $("#hfGuardianEmail").value.trim();
    if (!guardianEmail) { msg.textContent = "A parent/guardian email is required so we can confirm before printing."; return; }
    msg.textContent = "Sending your request…";
    try {
      const r = await api("/api/hype-frame/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        highlightId: hfState.play.id,
        customName: $("#hfName").value.trim(),
        jersey: $("#hfJersey").value.trim(),
        branding: hfState.preset === "hypeframe",
        apparel: hfState.apparel,
        side: hfState.side,
        imageStyle: hfState.imageStyle,
        colorway: hfState.colorway,
        size: hfState.size,
        placement: hfState.placement,
        guardianName: $("#hfGuardianName").value.trim(),
        guardianEmail,
        image: hfState.printDataUrl,
      }) });
      msg.textContent = r.message;
    } catch (err) { msg.textContent = "Error: " + err.message; }
  });
})();

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
// Round 98 (2026-11-11, Emil bug report): the Round 30 "try unmuted
// first, fall back to muted" start is RETIRED. On a first visit the
// unmuted attempt was rejected and the fallback muted it — but once
// the tab had any clicks (e.g. Swag Shop, then Home), the browser
// granted activation and the unmuted play SUCCEEDED, so the music
// turned itself on when arriving back at the homepage. The rule now:
// the film ALWAYS starts muted on every home arrival, and the only
// unmute path is the visitor tapping the speaker icon during that
// visit.
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
  if (v.dataset && v.dataset.src && !v.getAttribute("src")) v.src = v.dataset.src;
  const setIcon = () => { if (!mute) return; mute.classList.toggle("is-muted", v.muted); mute.setAttribute("aria-label", v.muted ? "Unmute the film" : "Mute the film"); };
  /* Round 98: keep the icon synced with ANY later muted change
     (showHome's reset-to-muted on a store return, the icon tap). */
  v.addEventListener("volumechange", setIcon);
  /* A back/forward-cache restore reruns no scripts — if the visitor
     left with the sound on, a restored page must still arrive
     muted, so re-mute on a persisted pageshow. */
  window.addEventListener("pageshow", (e) => { if (e.persisted) { v.muted = true; setIcon(); } });
  v.muted = true;
  const p = v.play();
  if (p && p.catch) p.catch(() => {});
  setIcon();
  mute?.addEventListener("click", () => { v.muted = !v.muted; if (!v.muted) { const q = v.play(); if (q && q.catch) q.catch(() => {}); } setIcon(); });
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
  dz.addEventListener("click", (e) => { if (e.target !== input) input.click(); });
  dz.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
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
$$("[data-div-pick]").forEach((b) => b.addEventListener("click", () => setDivPick(b.dataset.divPick)));
// After a successful submit the form resets; re-sync the toggle and
// the sport dropdown with the reset field values (Boys, no sport).
window.syncQuickPicks = () => { setDivPick("boys"); setSportPick(""); };

/* ---------------- upload + athlete prompt ---------------- */
let athleteCheckDoneFor = "";
$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const msg = $("#uploadMsg");
  // Quick-upload validation (2026-11-04): the clip, the athlete's first
  // name and one sport tap are required; division defaults to Boys.
  // "What happened?" is optional — blank becomes "<Name>'s highlight".
  const fileEl = form.elements.file;
  if (!fileEl || !fileEl.files || !fileEl.files.length) { msg.textContent = "Add your clip first — tap the box at the top to pick it from your camera roll."; $("#dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
  const name = String(form.elements.playerName.value || "").trim();
  if (!name) { msg.textContent = "Add the athlete's first name — every hype needs its athlete."; form.elements.playerName.focus(); return; }
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
  if (name && athleteCheckDoneFor !== name.toLowerCase()) {
    try {
      const chk = await api(`/api/athletes/check?name=${encodeURIComponent(name)}`);
      if (chk.matches && chk.matches.length) {
        const box = $("#athletePrompt");
        box.innerHTML = `<h4>Is this the same athlete?</h4>
          <p>We already have ${chk.matches.length === 1 ? "an athlete" : "athletes"} named <b>${esc(name)}</b>. Pick the right one — or tell us this is a different athlete with the same name. We never merge two athletes just because the name matches.</p>
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
          athleteCheckDoneFor = name.toLowerCase();
          box.hidden = true;
          form.requestSubmit();
        };
        return;
      }
    } catch { /* if the check fails, submit normally — server still never merges by name alone */ }
  }
  msg.textContent = "Uploading…";
  try {
    const r = await fetch("/api/highlights", { method: "POST", body: new FormData(form) });
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
    showUploadSuccess121(j.athlete_tag || "", postedEmail121);
  } catch (err) { msg.textContent = "Error: " + err.message; }
});

/* Round 121 (2026-11-12): the post-success screen. The form body
   swaps for the #uploadSuccess panel (.upload-done hides every
   other form child in CSS): what happens next, the athlete's HH
   tag big enough to screenshot, and a jump straight into My Plays
   pre-filled with the email just posted with. "Post another play"
   hands the (already reset) form back. */
let lastPostedEmail121 = "";
function showUploadSuccess121(tag, email) {
  const form = $("#uploadForm");
  const panel = $("#uploadSuccess");
  if (!form || !panel) { const m = $("#uploadMsg"); if (m) m.textContent = "Thanks! Your play is in review and will appear once the owner approves it."; return; }
  lastPostedEmail121 = email || "";
  const tagEl = $("#uploadSuccessTag"), tagline = $("#uploadSuccessTagline");
  if (tagEl) tagEl.textContent = tag || "";
  if (tagline) tagline.hidden = !tag;
  const msg = $("#uploadMsg"); if (msg) msg.textContent = "";
  form.classList.add("upload-done");
  panel.hidden = false;
  form.scrollTop = 0;
  if (typeof form.scrollIntoView === "function") form.scrollIntoView({ block: "start" });
}
$("#uploadSuccessAnother")?.addEventListener("click", () => {
  const form = $("#uploadForm"), panel = $("#uploadSuccess");
  if (panel) panel.hidden = true;
  if (form) { form.classList.remove("upload-done"); form.scrollTop = 0; }
});
$("#uploadSuccessPlays")?.addEventListener("click", () => {
  const form = $("#uploadForm"), panel = $("#uploadSuccess");
  if (panel) panel.hidden = true;
  if (form) form.classList.remove("upload-done");
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
/* Site stats panel (owner view): renders GET /api/owner/stats —
   the aggregate counters (views, play opens, referrers) plus the
   existing-system totals the endpoint reads from the live tables.
   Counting started the day this shipped, so early on the honest
   answer for most rows is zero. */
function statsHtml(st) {
  const v = st.views || {}, po = st.playOpens || {}, t = st.totals || {}, pl = t.plays || {};
  const num = (n) => esc(Number(n || 0).toLocaleString("en-US"));
  const card = (label, n) => `<div class="queue-item stats-card"><b class="stats-num">${num(n)}</b><br><span style="color:var(--muted)">${esc(label)}</span></div>`;
  const cards = card("Views today", v.today) + card("Views · last 7 days", v.last7Days) + card("Views · last 30 days", v.last30Days) + card("Views · all time", v.allTime) + card("Play opens · all time", po.total);
  const byView = Object.entries(v.byView || {}).map(([k, n]) => `${esc(k)}: <b>${num(n)}</b>`).join(" · ");
  const dailyRows = (v.daily || []).filter((d) => d.count > 0);
  const daily = dailyRows.length ? dailyRows.map((d) => `<p>${esc(d.day)} — ${num(d.count)} view${d.count === 1 ? "" : "s"}</p>`).join("") : "<p>No views recorded yet.</p>";
  const top = (po.top || []).length ? po.top.map((p) => `<p><b>${esc(p.title)}</b> — ${num(p.opens)} open${p.opens === 1 ? "" : "s"}</p>`).join("") : "<p>No play opens recorded yet.</p>";
  const refs = (st.referrers || []).length ? st.referrers.map((r) => `<p>${esc(r.key)} — ${num(r.count)}</p>`).join("") : "<p>No arrivals recorded yet.</p>";
  const sys = `<p>Total votes: <b>${num(t.votes)}</b> · Plays: <b>${num(pl.total)}</b> (${num(pl.approved)} approved, ${num(pl.pending)} pending, ${num(pl.hidden)} hidden) · Hype Frame orders: <b>${num(t.hypeFrameOrders)}</b> · Athletes: <b>${num(t.athletes)}</b></p>`;
  return `<div class="stats-cards">${cards}</div>
    <p>Views by page (all time): ${byView}</p>
    ${sys}
    <h4 class="stats-sub">Views by day (last 30 days)</h4>${daily}
    <h4 class="stats-sub">Most opened plays</h4>${top}
    <h4 class="stats-sub">Hype Stories</h4>${(st.stories && st.stories.byEpisode && st.stories.byEpisode.length) ? st.stories.byEpisode.map((e) => `<p>${esc(e.episode)} — ${num(e.opens)} watch${e.opens === 1 ? "" : "es"}</p>`).join("") : "<p>No story watches recorded yet.</p>"}
    <h4 class="stats-sub">Where visitors came from</h4>${refs}
    <p style="color:var(--muted)">Counts are daily totals only — no visitor is identified or followed. Counting started when this shipped; earlier visits were never recorded.</p>`;
}
async function loadOwner() {
  if (!ownerToken()) { $("#ownerStatus").textContent = "Not claimed on this device yet."; $("#queue").innerHTML = ""; $("#reports").innerHTML = ""; $("#ownerStats").innerHTML = ""; const dnEl = $("#dropNotify"); if (dnEl) dnEl.innerHTML = ""; return; }
  try {
    const q = await api("/api/owner/queue");
    $("#ownerStatus").textContent = "Owner access active on this device.";
    $("#queue").innerHTML = q.queue.map((h) => `<div class="queue-item"><b>${esc(h.title)}</b> — ${esc(h.sport)} — status: <b>${esc(h.status)}</b>${h.isSample ? ` — <span class="tagchip">⭐ Sample play</span>` : ""} — ${h.voteCount} votes
      ${h.player_name ? `<br>Athlete: ${esc(h.athlete_label || h.player_name)}${h.athlete_tag ? ` · ${esc(h.athlete_tag)}` : ""}${h.team ? ` · ${esc(h.team)}` : ""}` : ""}
      ${(() => { const bits = [];
        if (h.guardian_email) bits.push(`${esc(h.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(h.guardian_email)}?subject=${encodeURIComponent("HighlightHype — " + h.title)}">✉️ Contact guardian</a>`);
        if (h.guardian_phone) bits.push(`${esc(h.guardian_phone)} <a class="mini-btn" style="text-decoration:none" href="tel:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">📞 Call</a> <a class="mini-btn" style="text-decoration:none" href="sms:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">💬 Text</a> ${h.text_consent ? `<span class="tagchip">Text opt-in: YES</span>` : `<span class="tagchip warn">No text opt-in — do not text</span>`}`);
        return bits.length ? `<br>Parent/guardian (owner only): ${bits.join("<br>")}` : `<br><span style="color:var(--muted)">No parent/guardian contact on file — can't be featured as a winner.</span>`; })()}
      ${h.guardian_consent_at ? `<br>Guardian consent ✓ ${esc(new Date(h.guardian_consent_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}` : ""}
      ${h.story_consent ? `<br><span class="tagchip">⭐ Story OK — may feature as a Hype Story</span>${h.story_text ? `<br>“What made this moment matter?” ${esc(h.story_text)}` : ""}` : (h.story_text ? `<br><span style="color:var(--muted)">Story note (no story permission given):</span> ${esc(h.story_text)}` : "")}
      ${h.review ? `<p>🤖 Pre-review: <b>${esc(h.review.verdict)}</b>${h.review.flags && h.review.flags.length ? `<br>${h.review.flags.map((f) => "• " + esc(f)).join("<br>")}` : ""}<br><i>First-pass check only — it does not approve the play. Watch it yourself before approving.</i></p>` : ""}
      ${h.ai ? `<p>🤖 AI: <b>${esc(h.ai.sport || "?")}</b> · ${esc(h.ai.division || "?")} · gate <b>${esc(h.ai.gate === "play" ? "pass" : h.ai.gate || "?")}</b>${typeof h.ai.confidence === "number" ? ` (${Math.round(h.ai.confidence * 100)}%)` : ""}${h.ai.reason ? ` — ${esc(h.ai.reason)}` : ""}<br><i>AI first pass — its suggestions were shown to the guardian, who could edit them. It never approves a play.</i></p>` : ""}
      <div class="qa"><button type="button" class="mini-btn" onclick="setStatus(${h.id},'approved')">Approve</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'hidden')">Hide</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'pending')">Back to review</button><button type="button" class="mini-btn" onclick="deletePlay(${h.id})">Delete</button>${h.isSample ? `<button type="button" class="mini-btn" onclick="setSample(${h.id},'${h.status}',false)">Remove sample mark</button>` : `<button type="button" class="mini-btn" onclick="setSample(${h.id},'approved',true)">Approve as Sample play</button>`}${h.status === "approved" && !h.isSample ? `<button type="button" class="mini-btn" onclick="setCelebration(${h.id},${h.celebration_spotlight ? "false" : "true"})">${h.celebration_spotlight ? "★ Celebration spotlight: ON — tap to remove" : "Celebration spotlight"}</button>` : ""}</div></div>`).join("") || "<p>Queue is empty.</p>";
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
          ${src ? `<img class="hf-req-img" src="${src}" alt="Hype Frame print image">` : `<p><i>Print image on file (preview unavailable here).</i></p>`}
          <div class="hf-req-body">
            <b>${esc(o.play_title || "Play #" + o.highlight_id)}</b> — status: <b>${esc(o.status)}</b><br>
            Print: ${esc(o.custom_name || "—")}${o.jersey ? ` · #${esc(o.jersey)}` : ""} · HYPE FRAME branding: ${o.branding ? "yes" : "no"}<br>
            Apparel: ${esc(o.apparel)} · ${esc(o.colorway)} · Size: ${esc(o.size || "YM")} · Print side: ${o.side === "back" ? "Back" : "Front"} · Image: ${o.image_style === "avatar" ? "Avatar (illustrate first)" : "Real photo"}<br>
            ${(() => { try { const p = JSON.parse(o.placement || ""); return p && p.cx != null ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size<br>` : ""; } catch { return ""; } })()}
            Parent/guardian (owner only): ${o.guardian_name ? `${esc(o.guardian_name)} — ` : ""}${esc(o.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(o.guardian_email)}?subject=${encodeURIComponent("HighlightHype — your Hype Frame request")}">✉️ Contact guardian</a><br>
            <span style="color:var(--muted)">${esc(o.created_at)} — confirm with the guardian before printing anything.</span>
          </div>
        </div>`;
      }
      $("#hfRequests").innerHTML = hfHtml || "<p>No Hype Frame requests yet.</p>";
    } catch { $("#hfRequests").innerHTML = "<p>Could not load Hype Frame requests.</p>"; }
    // Bottle drop notifications (owner only, Round 106): per-sport
    // counts plus the signup emails — the emails live ONLY in this
    // owner surface. Own try, same pattern as stats/Hype Frames.
    try {
      const dn = await api("/api/owner/drop-notifications");
      const dnCounts = (dn.counts || []).map((c) => `${esc(cap(c.sport))}: <b>${c.count}</b>`).join(" · ");
      const dnRows = (dn.signups || []).map((s) => `<p><b>${esc(s.email)}</b> — ${esc(cap(s.sport))} bottle <span style="color:var(--muted)">(${esc(s.created_at)})</span></p>`).join("");
      $("#dropNotify").innerHTML = `<p>${dnCounts || "No signups yet."}</p>${dnRows}`;
    } catch { $("#dropNotify").innerHTML = "<p>Could not load drop notifications.</p>"; }
  } catch (e) { $("#ownerStatus").textContent = "Owner access was refused on this device: " + e.message; }
}
window.setStatus = async (id, status) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); loadOwner(); loadData(); };
// Sample flag (Round 7): rides the same status call — one tap in the
// owner queue approves AND flags a play as a sample (or removes the
// mark, keeping the play's current status).
window.setSample = async (id, status, sample) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status, sample }) }); loadOwner(); loadData(); };
/* Round 100: Celebration Spotlight — one tap in the owner queue.
   The server clears every other play when one is set, so at most
   one play ever carries the Best Celebration badge. */
window.setCelebration = async (id, on) => { await api(`/api/highlights/${id}/celebration`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ spotlight: !!on }) }); loadOwner(); loadData(); };
window.deletePlay = async (id) => { if (!confirm("Delete this play permanently?")) return; await api(`/api/highlights/${id}`, { method: "DELETE" }); loadOwner(); loadData(); };
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
  loadData().then(() => { if (am) openAthlete(am[1]); if (hm) openHypeFrame(Number(hm[1])); });
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
  // Site stats: one referrer event per page load, plus the landing
  // view. Store deep links already counted themselves through the
  // showStore hook above, and #post counted "home" through
  // goSubmit → showPanel — every other landing (plain home, a
  // shared #play-, an athlete, the owner panel) starts on the home
  // boards, so it counts "home" here.
  trackReferrer();
  if (!bootPathTarget && !["#shop", "#hype-girls", "#hype-boys", "#post", "#stories"].includes(location.hash)) trackEvent("view", "home");
})();

/* ---------------- Rounds 62 + 67: board controls ----------------
   The sport pill bar filters the visible board in place (Month
   writes monthSport; Fame jumps to All Hypes like the old browse
   row did; All writes allSport). Round 67 (2026-11-09, Emil): the
   bar is one sideways-scrolling row (no More button), and each
   view's division seg sits visible in its board-tools row - the
   Filter popover is retired. The sport <select> stays in the DOM,
   CSS-hidden, because renderSportSelect/syncFilterUI run on it. */
$$("#sportPills .sp-pill").forEach((b) => {
  b.onclick = () => {
    const sp = b.dataset.sp;
    if (currentView === "month" && monthSub === "fame") { allSport = sp; syncFilterUI(); switchView("all"); renderAll2(); }
    else if (currentView === "month") { monthSport = sp; syncFilterUI(); renderMonth(); }
    else { allSport = sp; syncFilterUI(); if (currentView !== "all") switchView("all"); renderAll2(); }
  };
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
   two-choice card instead of landing on the board. Sample -> the
   studio with a sample play loaded (baseball preferred — the payoff
   is visible immediately); Own video -> the upload form (which now
   opens with the parent/guardian banner). */
window.openHfChoice = () => { const m = $("#hfChoiceModal"); if (!m) return; if (m.parentElement !== document.body) document.body.appendChild(m); m.hidden = false; };
window.closeHfChoice = () => { const m = $("#hfChoiceModal"); if (m) m.hidden = true; };
window.hfChoiceSample = () => {
  closeHfChoice();
  const pool = ALL_PLAYS || [];
  const pick = pool.find((p) => p.isSample && p.sport === "baseball") || pool.find((p) => p.isSample) || pool[0];
  if (pick) openHypeFrame(pick.id);
};
window.hfChoiceOwn = () => { closeHfChoice(); goSubmit(); };
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
   pairs, then mixed approved pairs. A pick casts a REAL vote only
   when both contenders are current contest entries — via the same
   vote endpoint the tiles use, and only when the voter has not
   already voted for that play (a battle pick must never toggle a
   vote OFF). Every pick also fires a battle_pick stat. Appended at
   the end of app.js per the sandbox-slice rule; every element
   lookup is guarded. */
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
     .watching outline alone marks the clip in the big player. */
  const letter = slot === "L" ? "A" : "B";
  return `<article class="btl-mini${showStreak ? " has-streak" : ""}" id="btlMini${slot}" data-slot="${slot}">
    <span class="btl-video-slot111" data-btl-media111 data-url="${esc(p.media_url)}" data-sport="${esc(cap(p.sport))}" data-title="${esc(p.title)}" role="img" aria-label="${esc(p.title)} — clip loading"></span>
    <span class="btl-letter" aria-hidden="true">${letter}</span>
    ${showStreak ? `<span class="btl-streak">👑 Won ${btl.streak} in a row</span>` : ""}
    <span class="btl-stamp">👑 WINNER</span>
    <div class="btl-mbody"><p class="btl-mtitle">${esc(p.title)}</p><p class="btl-mmeta">${esc(cap(p.sport))} · ${p.division === "girls" ? "Girls" : "Boys"}</p>${typeof crownsHtml105 === "function" ? crownsHtml105(p) : ""}</div>
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
  if (btl.pairReal) {
    const w = findPlay(winnerId);
    if (w && !w.hasVoted) {
      w.hasVoted = true;
      try {
        await api(`/api/highlights/${winnerId}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken }) });
        loadData().catch(() => {});
      } catch { /* a failed vote never breaks the game */ }
    }
  }
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
  applyDefaultView = function () { prevAD(); monthSub = "fame"; switchView("month"); };
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
   pick is locked server-side (one per voter per day). A pick on a
   real matchup also casts a normal contest vote (server-side,
   never a toggle-off); practice (sample) picks cast nothing.
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
function d100MiniHTML(prefix, slot, p) {
  if (!p) return "";
  /* Round 102: A/B letter chip (slot IS the letter here) and a
     Your pick tag that only the Daily card's .picked class
     reveals. Round 104: no Now watching tag on the mini — the big
     player's banner is the single watching marker. */
  return `<article class="btl-mini" id="${prefix}Mini${slot}" data-slot="${slot}">
    <span class="btl-video-slot111" data-btl-media111 data-url="${esc(p.media_url)}" data-sport="${esc(cap(p.sport))}" data-title="${esc(p.title)}" role="img" aria-label="${esc(p.title)} — clip loading"></span>
    <span class="btl-letter" aria-hidden="true">${slot}</span>
    <span class="btl-stamp">👑 WINNER</span>
    <span class="btl-yourpick">👑 Your pick</span>
    <div class="btl-mbody"><p class="btl-mtitle">${esc(p.title)}</p><p class="btl-mmeta">${esc(cap(p.sport))} · ${p.division === "girls" ? "Girls" : "Boys"}</p>${typeof badgesHtml100 === "function" ? badgesHtml100(p) : ""}${typeof crownsHtml105 === "function" ? crownsHtml105(p) : ""}</div>
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
  if (player.getAttribute("src") !== play.media_url || player.error) { player.src = play.media_url; player.load(); }
  /* Round 119: same black-intro offset seek as btlWatch. */
  if (typeof btlSeekOffset119 === "function") btlSeekOffset119(player);
  const label = document.getElementById(prefix + "NowLabel");
  if (label) label.textContent = "Now watching: " + play.title + (typeof crownSuffix105 === "function" ? crownSuffix105(play) : "");
  if (typeof btlPlayBig118 === "function") btlPlayBig118(player, false); else { try { player.play(); } catch { /* autoplay refusal is fine */ } }
}
function d100WireMatchup(prefix, plays, onWatch) {
  const matchup = document.getElementById(prefix + "Matchup");
  if (!matchup) return;
  /* Round 111: same pooled-media path as the Quick Battles render
     (Daily + Battle Run media is always eager — it is either the
     top card or a run the visitor just started). */
  if (typeof btlRetireMatchup111 === "function") btlRetireMatchup111(matchup);
  matchup.innerHTML = d100MiniHTML(prefix, "A", plays.A) + '<div class="btl-vs">VS</div>' + d100MiniHTML(prefix, "B", plays.B);
  if (typeof btlInstallMedia111 === "function") btlInstallMedia111(matchup, { eager: true });
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
  if (!r || !r.available) { d100.dailyCollapsed = false; if (card) card.classList.remove("daily-slim112"); if (main) main.hidden = true; if (strip) strip.hidden = true; if (empty) empty.hidden = false; if (practice) practice.hidden = true; return; }
  if (empty) empty.hidden = true;
  if (main) main.hidden = false;
  if (strip) strip.hidden = true;
  if (practice) practice.hidden = !r.practice;
  if (dateEl) dateEl.textContent = r.date;
  d100WireMatchup("daily", { A: r.a, B: r.b }, (slot) => { d100.dailyWatch = slot; d100Watch("daily", slot, slot === "A" ? r.a : r.b); });
  const pickA = document.getElementById("dailyPickA"), pickB = document.getElementById("dailyPickB");
  const split = document.getElementById("dailySplit");
  const anotherRow = document.getElementById("dailyAnotherRow");
  if (r.yourPick) {
    if (pickA) { pickA.disabled = true; pickA.textContent = r.yourPick === r.a.id ? "👑 Your pick" : "Pick A"; }
    if (pickB) { pickB.disabled = true; pickB.textContent = r.yourPick === r.b.id ? "👑 Your pick" : "Pick B"; }
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
    if (pickA) { pickA.disabled = false; pickA.textContent = "Pick A"; }
    if (pickB) { pickB.disabled = false; pickB.textContent = "Pick B"; }
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
      if (wLabel) { const wp = wSlot === "A" ? r.a : r.b; wLabel.textContent = "Now watching: " + wp.title + (typeof crownSuffix105 === "function" ? crownSuffix105(wp) : ""); }
    }
  }
  if (d100.scrollDaily) {
    d100.scrollDaily = false;
    card.classList.add("daily-flash");
    setTimeout(() => card.scrollIntoView({ behavior: "smooth", block: "start" }), 350);
  }
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
  d100WireMatchup("run", { A: m.a, B: m.b }, (slot) => d100Watch("run", slot, slot === "A" ? m.a : m.b));
  const pA = document.getElementById("runPickA"), pB = document.getElementById("runPickB");
  if (pA) { pA.disabled = false; pA.textContent = "👑 This one won"; }
  if (pB) { pB.disabled = false; pB.textContent = "👑 This one won"; }
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
    else if (r.yourPick) { line.textContent = `Your streak: ${n} 🔥 — pick tomorrow's winner to keep it going`; line.hidden = false; }
    else { line.textContent = "Pick today's winner to start your streak 🔥"; line.hidden = false; }
  }
  const stripStreak = document.getElementById("dailyStripStreak");
  if (stripStreak) stripStreak.textContent = r && r.available && !r.practice && r.yourPick ? ` · 🔥 ${r.streak ? (r.streak.current || 0) : 0}` : "";
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

/* Feature 2: challenge a friend — the share carries THIS matchup's
   two play ids; the landing (below) rebuilds the exact pair in
   the Fresh Pairs stage. navigator.share where the device offers
   it, copy-link fallback with inline feedback (the dailyShare100
   pattern). Pick rules on the landing are the stock ones: a real
   pair (both plays are live contest entries) casts real votes via
   btlPick; anything else is practice. */
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
    const url = v.getAttribute("src") || "";
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
/* The slim contest line on Watch: a tap opens the Month board,
   with the Round 122 scroll so the tap visibly lands somewhere. */
$("#contestSlim123")?.addEventListener("click", () => { switchView("month"); scrollBoardIntoView122(); $("#contestSlim123")?.blur(); });
