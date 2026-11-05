// HighlightHype front end (2026-11-03 design port).
// Voter identity = a random token stored in this browser (one vote per
// browser per play per month). Owner identity = token in localStorage.
// Athlete identity is server-side (athlete_id); the name is only a label.
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const voterToken = localStorage.getItem("hh_voter") || (() => { const t = "v_" + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem("hh_voter", t); return t; })();
const ownerToken = () => localStorage.getItem("hh_owner_token") || "";
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...(ownerToken() ? { "x-owner-token": ownerToken() } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Request failed");
  return j;
};
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => { if (s === "fieldhockey") return "Field Hockey"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };
const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const SPORTS = ["baseball", "basketball", "cheer", "fieldhockey", "football", "gymnastics", "hockey", "lacrosse", "other", "soccer", "softball", "volleyball"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ---------------- data ---------------- */
let ALL_PLAYS = [];      // approved, all-time (from /api/highlights?division=all)
let CONTEST = { period: "", entries: [], winnerId: null };
let currentView = "month";
let monthDiv = "boys", monthSport = "all";
let allDiv = "all", allSport = "all", allTeam = "all", allSearch = "";

async function loadData() {
  const [h, c] = await Promise.all([
    api(`/api/highlights?division=all&sort=top&voterToken=${voterToken}`),
    api(`/api/contest?voterToken=${voterToken}`),
  ]);
  ALL_PLAYS = h.highlights || [];
  CONTEST = c;
  renderAll();
}

/* ---------------- media + cards ---------------- */
function mediaHtml(h) {
  if (h.media_kind === "file") {
    if ((h.mime || "").startsWith("image/")) return `<img src="${esc(h.media_url)}" alt="">`;
    return `<video src="${esc(h.media_url)}" controls playsinline muted loop preload="auto" autoplay></video>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${esc(h.embed_url)}" allowfullscreen title="Embedded play"></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${esc(h.media_url)}" controls playsinline muted loop preload="auto" autoplay></video>`;
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
function cardHtml(h, opts = {}) {
  const votes = opts.monthVotes != null ? opts.monthVotes : h.voteCount;
  const voteLabel = opts.monthVotes != null ? "this month" : "all-time";
  return `<article class="card" data-play-id="${h.id}">
    <div class="thumb">${mediaHtml(h)}${h.isWinner ? `<span class="badge" style="background:#fff;color:#0a0a0a">🏆 Hype of the Month winner</span>` : ""}${opts.rank ? `<span class="ranktag">#${opts.rank}</span>` : ""}</div>
    <div class="card-body">
      <h3>${esc(h.title)}</h3>
      <p class="meta"><b>${esc(cap(h.sport))}</b>${h.play_type ? ` · ${esc(h.play_type)}` : ""} · ${h.division === "girls" ? "Girls" : h.division === "boys" ? "Boys" : "Coed"}</p>
      ${athleteLine(h)}
      ${h.story ? `<p class="meta">${esc(h.story)}</p>` : ""}
      ${opts.prizeEligible === false ? `<p><span class="tagchip warn">Can't be featured — no parent/guardian contact on file</span></p>` : ""}
      <div class="votes">
        <button type="button" class="votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id})">${h.hasVoted ? "You voted — tap to remove" : "Vote"}</button>
        <span class="votecount"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>
        <button type="button" class="mini-btn" onclick="enterContest(${h.id})">🏆 Enter this play</button>
        <button type="button" class="mini-btn" onclick="sharePlay(${h.id}, this)">🔗 Share</button>
        <button type="button" class="mini-btn" onclick="reportPlay(${h.id})">🚩 Report</button>
        ${ownerToken() && opts.inContest ? `<button type="button" class="mini-btn" onclick="markWinner(${h.id})">Mark winner (owner)</button>` : ""}
      </div>
    </div>
  </article>`;
}
window.toggleVote = async (id) => { try { await api(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken }) }); await loadData(); } catch (e) { alert(e.message); } };
window.enterContest = async (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || CONTEST.entries.find((p) => p.id === id);
  if (play && !play.hasGuardianEmail && !play.hasGuardianText && !confirm("Heads up: this play has no parent/guardian email and no consented guardian text number on file, so it can't be featured if it wins — winners are contacted through a parent/guardian only. Enter anyway?")) return;
  try { const r = await api("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); alert(r.message); await loadData(); } catch (e) { alert(e.message); }
};
window.reportPlay = async (id) => { const reason = prompt("Why are you reporting this play? (optional)") || "Reported by a user"; try { const r = await api(`/api/highlights/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }); alert(r.message); } catch (e) { alert(e.message); } };
window.markWinner = async (id) => { try { const r = await api("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); if (r.warning) alert(r.warning); await loadData(); } catch (e) { alert(e.message); } };
window.sharePlay = async (id, btn) => {
  const url = `${location.origin}${location.pathname}#play-${id}`;
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
  $("#board").innerHTML = filtered.map((h) => cardHtml(h, { monthVotes: h.voteCount, inContest: true, prizeEligible: h.prizeEligible })).join("");
  $("#emptyState").style.display = filtered.length ? "none" : "block";
}
function renderFame() {
  const ranked = [...ALL_PLAYS].sort((a, b) => b.voteCount - a.voteCount || b.id - a.id).slice(0, 10);
  $("#fameList").innerHTML = ranked.length ? ranked.map((h, i) => `
    <div class="fame-row${i === 0 ? " top" : ""}">
      <span class="fame-rank">${i + 1}</span>
      <span class="fame-thumb">${(h.mime || "").startsWith("image/") ? `<img src="${esc(h.media_url)}" alt="">` : `<span style="display:grid;place-items:center;height:100%;color:#fff;font-weight:800">${esc(cap(h.sport))}</span>`}</span>
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
function renderAll() { syncFilterUI(); renderMonth(); renderFame(); renderAll2(); renderMine(); highlightSharedPlay(); }
function renderAll2() { /* All Hypes view */ 
  const tf = $("#teamFilter");
  const teams = [...new Set(ALL_PLAYS.map((h) => h.team).filter(Boolean))];
  const prev = allTeam;
  tf.innerHTML = `<option value="all">All teams</option>` + teams.map((t) => `<option value="${slugify(t)}">${esc(t)}</option>`).join("") + `<option value="__none">No team tagged</option>`;
  tf.value = [...tf.options].some((o) => o.value === prev) ? prev : "all";
  allTeam = tf.value;
  const q = allSearch.toLowerCase();
  const filtered = ALL_PLAYS.filter((h) =>
    divMatch(h, allDiv) &&
    (allSport === "all" || h.sport === allSport) &&
    (allTeam === "all" || (allTeam === "__none" ? !h.team : slugify(h.team) === allTeam)) &&
    (!q || [h.title, h.player_name, h.story, h.team, h.sport].join(" ").toLowerCase().includes(q)));
  $("#allCount").textContent = `${filtered.length} of ${ALL_PLAYS.length} plays`;
  const emptyEl = $("#allEmpty");
  if (allTeam === "plainview-hawks" && !filtered.length) {
    $("#allBoard").innerHTML = "";
    emptyEl.textContent = "The Plainview Hawks board is waiting for its first approved Hawks-tagged play — post one and tag the team Plainview Hawks.";
    emptyEl.style.display = "block";
    return;
  }
  emptyEl.textContent = "No plays match — try a different board, sport, team, or search.";
  $("#allBoard").innerHTML = filtered.map((h, i) => cardHtml(h, { rank: i + 1 })).join("");
  emptyEl.style.display = filtered.length ? "none" : "block";
}
function highlightSharedPlay() {
  const pm = location.hash.match(/^#play-(\d+)$/);
  if (!pm) return;
  const id = pm[1];
  let el = document.querySelector(`[data-play-id="${id}"]`);
  if (!el) {
    // Deep-link fallback (2026-11-04): the play may not be rendered in
    // the current board view (e.g. it's not in this month's contest) —
    // switch to All Hypes with every filter open, render, then land on
    // the card. If the play doesn't exist at all, do nothing.
    if (!ALL_PLAYS.some((h) => String(h.id) === id)) return;
    allDiv = "all"; allSport = "all"; allTeam = "all"; allSearch = "";
    const si = $("#allSearch"); if (si) si.value = "";
    showPanel("plays"); switchView("all"); renderAll2(); syncFilterUI();
    el = document.querySelector(`[data-play-id="${id}"]`);
  }
  if (el) { el.classList.add("flash"); setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 150); }
}

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
    $("#athleteBoard").innerHTML = plays.map((h) => cardHtml(h)).join("");
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
  $$(".panel[data-panel]").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
  $$("[data-panel-btn]").forEach((b) => { if (b.dataset.panelBtn) b.setAttribute("aria-current", String(b.dataset.panelBtn === name)); });
}
$$("[data-panel-btn]").forEach((b) => b.addEventListener("click", () => { showHome(); closeMenu(false); if (location.hash.startsWith("#hype-frame")) history.replaceState(null, "", "#top"); showPanel(b.dataset.panelBtn); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));
$("#menuAllHypes").addEventListener("click", () => { showHome(); closeMenu(false); showPanel("plays"); switchView("all"); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); });
function switchView(v) {
  currentView = v;
  $$(".viewseg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.view === v)));
  $("#viewMonth").hidden = v !== "month";
  $("#viewFame").hidden = v !== "fame";
  $("#viewAll").hidden = v !== "all";
  $("#chipMonth").style.display = v === "month" ? "" : "none";
  $("#boardTitle").innerHTML = v === "month" ? `This month's <span class="lime">plays</span>` : v === "fame" ? `Hall of <span class="lime">Fame</span>` : `All <span class="lime">Hypes</span>`;
}
$$(".viewseg button").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));
function showStore(target) {
  document.body.classList.add("store-open");
  window.scrollTo(0, 0);
  $$(".view-home video").forEach((v) => v.pause());
  const sv = $("#swagVideo");
  if (sv) {
    // The film now carries the homepage music bed (2026-11-04). The
    // Enter-the-Store click is a user gesture, so try to start WITH
    // sound; if the browser keeps it muted, unmute on the first tap
    // anywhere in the store instead. Muted autoplay stays the fallback.
    const wasMuted = sv.muted;
    sv.muted = false;
    const p = sv.play(); if (p && p.catch) p.catch(() => {});
    if (wasMuted || sv.muted) {
      const unmute = () => { sv.muted = false; const q = sv.play(); if (q && q.catch) q.catch(() => {}); };
      $("#shop")?.addEventListener("pointerdown", unmute, { once: true });
    }
  }
  // #hype-girls / #hype-boys links focus that division's block
  // (2026-11-04 store restructure). Other targets scroll as before.
  if (target === "hype-girls" || target === "hype-boys") {
    setStoreFocus(target === "hype-girls" ? "girls" : "boys");
    setTimeout(() => document.getElementById("storeFocusBar")?.scrollIntoView({ behavior: "smooth" }), 60);
  } else if (target) { const el = document.getElementById(target); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 60); }
}
function showHome() {
  setStoreFocus(null);
  if (!document.body.classList.contains("store-open")) return;
  document.body.classList.remove("store-open");
  if (location.hash === "#shop") history.replaceState(null, "", "#top");
  const hv = $("#heroVideo"); if (hv) { const p = hv.play(); if (p && p.catch) p.catch(() => {}); }
}
/* One home reset for every logo / home link (2026-11-04): leave the
   store, land on the plays board, scroll to the top, and drop a stale
   Hype Frame deep link so it can't reopen the studio. */
function goHome() {
  showHome();
  showPanel("plays");
  window.scrollTo(0, 0);
  if (location.hash.startsWith("#hype-frame")) history.replaceState(null, "", "#top");
}
$$("[data-store-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); closeMenu(false); showStore(a.dataset.storeTarget || null); }));
$$("[data-home-link]").forEach((b) => b.addEventListener("click", () => goHome()));
$$(".brand").forEach((b) => b.addEventListener("click", () => goHome()));
window.addEventListener("hashchange", () => {
  if (location.hash === "#shop") showStore();
  if (location.hash === "#hype-girls" || location.hash === "#hype-boys") showStore(location.hash.slice(1));
  const hm = location.hash.match(/^#hype-frame-(\d+)$/);
  if (hm) openHypeFrame(Number(hm[1]));
  const pm = location.hash.match(/^#play-(\d+)$/);
  if (pm) { showHome(); showPanel("plays"); highlightSharedPlay(); }
});
function goSubmit() { showHome(); closeMenu(false); showPanel("plays"); switchView("month"); document.getElementById("uploadForm")?.scrollIntoView({ behavior: "smooth" }); }
$("#floatSubmit").addEventListener("click", goSubmit);
$$("[data-submit-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); goSubmit(); }));
$$("[data-tablink]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); showHome(); showPanel(a.dataset.tablink); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));

/* ---------------- filters ---------------- */
// Sport pills are DYNAMIC (Emil, 2026-11-04): "All sports" plus one pill
// per sport that actually has plays in the data behind that view — the
// month pills follow this month's contest entries (for the selected
// board), the All Hypes pills follow every approved play (for the
// selected board). No plays in a sport = no pill for it.
function sportsInData(plays) {
  const present = new Set(plays.map((h) => h.sport).filter(Boolean));
  return SPORTS.filter((s) => present.has(s));
}
function renderPills(el, current, sports, cb) {
  el.innerHTML = [`<button type="button" class="pill" data-sport="all" aria-pressed="${current === "all"}">All sports</button>`,
    ...sports.map((s) => `<button type="button" class="pill" data-sport="${s}" aria-pressed="${current === s}">${cap(s)}</button>`)].join("");
  el.querySelectorAll(".pill").forEach((b) => b.onclick = () => cb(b.dataset.sport));
}
function syncFilterUI() {
  // Fall back to "All sports" when the selected sport has no plays left
  // in the current data (its pill is gone, so the filter must not stick).
  const monthSports = sportsInData((CONTEST.entries || []).filter((h) => divMatch(h, monthDiv)));
  if (monthSport !== "all" && !monthSports.includes(monthSport)) monthSport = "all";
  const allSports = sportsInData(ALL_PLAYS.filter((h) => divMatch(h, allDiv)));
  if (allSport !== "all" && !allSports.includes(allSport)) allSport = "all";
  renderPills($("#monthSportPills"), monthSport, monthSports, (s) => { monthSport = s; syncFilterUI(); renderMonth(); });
  renderPills($("#allSportPills"), allSport, allSports, (s) => { allSport = s; syncFilterUI(); renderAll2(); });
  $$("#monthDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === monthDiv)); b.onclick = () => { monthDiv = b.dataset.div; syncFilterUI(); renderMonth(); }; });
  $$("#allDivSeg button").forEach((b) => { b.setAttribute("aria-pressed", String(b.dataset.div === allDiv)); b.onclick = () => { allDiv = b.dataset.div; syncFilterUI(); renderAll2(); }; });
}
$("#teamFilter").addEventListener("change", (e) => { allTeam = e.target.value; if (allTeam !== "all") history.replaceState(null, "", `#team-${allTeam}`); renderAll2(); });
$("#allSearch").addEventListener("input", (e) => { allSearch = e.target.value; renderAll2(); });

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
   Each scene's card targets that collection's grid card by slug. The old
   film's title-card and Hype All Day scenes are gone with the old film. */
const FILM_SCENES = [
  { until: 7, title: "The Boys Hype Street hoodie", sub: "You paused on the Boys Street scene — washed black with the crown HYPE chest.", btn: "View this look", target: "boys-street" },
  { until: 14, title: "The Boys Hype Athletics hoodie", sub: "You paused on the Boys Athletics scene — cream varsity with green stripes, Hype Is Earned.", btn: "View this look", target: "boys-athletics" },
  { until: 21, title: "The Boys Hype Unleashed hoodie", sub: "You paused on the Boys Unleashed scene — blue and yellow lightning print, It's Hype or Nothing.", btn: "View this look", target: "boys-unleashed" },
  { until: 28, title: "The Girls Hype Street hoodie", sub: "You paused on the Girls Street scene — washed charcoal with the hibiscus HYPE print.", btn: "View this look", target: "girls-street" },
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
  // No native controls and no round button (removed 2026-11-04):
  // tapping the film toggles playback, and pausing surfaces the scene
  // card above via the pause listener (pause-to-shop).
  v.addEventListener("click", () => { if (v.paused) v.play(); else v.pause(); });
})();

/* ---------------- Store: division blocks + focus (2026-11-04) -------
   Tonight batch restructure: the landing is film → Boys block → Girls
   block → Hype Frame creative, with all six cards always on the page.
   Focus mode (body[data-store-focus="boys"|"girls"]) hides the film,
   the store bar/head, and the other division's block, and pins the
   focused block under a slim focus bar. Entered from the film overlay
   Shop Boys/Girls links, each block's banner button, #hype-boys /
   #hype-girls links, and the film's pause-to-shop card (which focuses
   the paused scene's division and lands on its card). */
const storeState = { focus: null };
function setStoreFocus(div) {
  storeState.focus = div || null;
  if (div) document.body.dataset.storeFocus = div; else delete document.body.dataset.storeFocus;
  const bar = $("#storeFocusBar");
  if (bar) {
    bar.hidden = !div;
    if (div) $("#storeFocusTitle").textContent = `Hype ${div === "girls" ? "Girls" : "Boys"} — Drop 001`;
  }
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
$$("[data-store-focus]").forEach((b) => b.addEventListener("click", () => goToStoreScene(b.dataset.storeFocus === "girls" ? "hype-girls" : "hype-boys")));
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
   Gallery frames are the flat board illustrations recolored per
   colorway at build time (/swag/qv/<slug>-<color>-<side>.svg) — no
   worn/model photos anywhere in product views. */
const QV_PRODUCTS = {
  "boys-street": { side: "Boys Collection · Crown motif", slogan: "Hype Is Life", desc: "Everyday style. Youth culture.", colors: [["Black", "#2e2e31"], ["Denim Blue", "#3f5f82"], ["Gray", "#8b8e93"], ["Olive", "#5f6a45"]] },
  "boys-athletics": { side: "Boys Collection · Crown motif", slogan: "Hype Is Earned", desc: "Performance. Pride. Community.", colors: [["Cream", "#f3e7cf"], ["Heather Gray", "#a8abb0"], ["Forest Green", "#1e5138"], ["Navy", "#1c3054"]] },
  "boys-unleashed": { side: "Boys Collection · Crown motif", slogan: "It’s Hype or Nothing", desc: "Bold designs. High energy. No limits.", colors: [["Blue Lightning", "#37b6ff"], ["Fire Orange", "#ff7a1a"], ["Purple Lightning", "#7e22ce"], ["Teal Lightning", "#14b8a6"]] },
  "girls-street": { side: "Girls Collection · Tiara motif", slogan: "Hype Is Life", desc: "Everyday style. Youth culture.", colors: [["Black", "#2d2d31"], ["Pink", "#efa7c6"], ["Cream", "#f3e7cf"], ["Light Blue", "#a9d7f0"]] },
  "girls-athletics": { side: "Girls Collection · Tiara motif", slogan: "Hype Is Earned", desc: "Performance. Pride. Community.", colors: [["Cream", "#f3e7cf"], ["Forest Green", "#1e5138"], ["Navy", "#1c3054"], ["Heather Gray", "#a8abb0"]] },
  "girls-essentials": { side: "Girls Collection · Tiara motif", slogan: "The Hype Starts Here", desc: "Comfort. Creativity. Confidence.", colors: [["Sky Blue", "#8ec9ee"], ["Cream", "#f3e7cf"], ["Pink", "#f6a8c5"], ["Lavender", "#c2ade0"]] },
};
const qvColorSlug = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
let qvGalleryState = { slug: "", colors: [] };
function qvSyncGallery() {
  const g = $("#qvGallery"); if (!g || !qvGalleryState.colors.length) return;
  const w = g.clientWidth || 1;
  const idx = Math.min(qvGalleryState.colors.length * 2 - 1, Math.max(0, Math.round(g.scrollLeft / w)));
  const ci = Math.floor(idx / 2);
  $("#qvColorName").textContent = qvGalleryState.colors[ci][0];
  $("#qvSideLabel").textContent = idx % 2 ? "Back" : "Front";
  $$("#qvSwatches .qv-swatch").forEach((b, i) => b.setAttribute("aria-pressed", String(i === ci)));
}
function openQuickView(card) {
  const qv = $("#quickView"); if (!qv) return;
  const slug = card.dataset.slug;
  const data = QV_PRODUCTS[slug]; if (!data) return;
  qvGalleryState = { slug, colors: data.colors };
  const title = card.querySelector("h4").textContent;
  $("#qvSide").textContent = data.side;
  $("#qvTitle").textContent = title;
  $("#qvSlogan").textContent = data.slogan;
  $("#qvDesc").textContent = data.desc;
  $("#qvColors").textContent = data.colors.map((c) => c[0]).join(" · ");
  const g = $("#qvGallery");
  g.innerHTML = data.colors.map(([name]) => ["front", "back"].map((sd) => `<figure class="qv-frame"><img src="/swag/qv/${slug}-${qvColorSlug(name)}-${sd}.svg" alt="${esc(title)} hoodie in ${esc(name)} — ${sd} illustration" loading="lazy" decoding="async" /><figcaption>${sd}</figcaption></figure>`).join("")).join("");
  g.scrollLeft = 0;
  $("#qvSwatches").innerHTML = data.colors.map(([name, hex], i) => `<button type="button" class="qv-swatch" data-qv-color="${i}" aria-pressed="${i === 0}"><span class="swatch" style="--sw:${hex}"></span>${esc(name)}</button>`).join("");
  $$("#qvSwatches .qv-swatch").forEach((b) => b.addEventListener("click", () => {
    g.scrollTo({ left: Number(b.dataset.qvColor) * 2 * (g.clientWidth || 1), behavior: "smooth" });
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
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQuickView(); });

/* ---------------- Hype Frame studio ---------------- */
// Emil's product concept (2026-11-04): a real freeze-frame from the
// athlete's OWN highlight, printed on premium youth apparel.
//   1. Select your highlight from an uploaded video (the play card button).
//   2. Freeze your favorite frame using a video timeline (scrub, ±1s
//      step buttons, freeze — works while the video plays).
//   3. Pick a print style — Classic (photo only), Signature (photo +
//      name / jersey caption), or Hype Frame (grunge frame around the
//      photo + the HYPE FRAME script lockup under it, drawn onto the
//      print image itself, not just the preview). The print always
//      sits at the fixed default placement on the garment.
//   4. Preview the actual image on a hoodie or T-shirt — and pick the
//      print side, front or back (the choice rides on the order).
//   5. Order with parent or guardian approval (an order REQUEST — no
//      payment, no price; the owner confirms with the guardian first).
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
  tee: [
    { name: "Black", hex: "#17171a" }, { name: "White", hex: "#f5f5f2" },
    { name: "Cream", hex: "#f3e7cf" }, { name: "Heather Gray", hex: "#a8abb0" },
    { name: "Navy", hex: "#14264a" }, { name: "Pink", hex: "#f3a8c4" },
  ],
};
// Print areas per garment, as % of the mock box (the garment SVGs share a
// 640x720 viewBox). The print — frame + caption band + branding lockup,
// treated as ONE unit — must stay inside its garment's print area.
const HF_AREAS = {
  hoodie: { left: 25, top: 30, width: 50, height: 48 },
  tee: { left: 25, top: 22, width: 50, height: 52 },
};
// Print-side (Store v8): the back print rides a little higher on the
// garment than the chest print, so the back has its own print areas.
const HF_AREAS_BACK = {
  hoodie: { left: 25, top: 25.5, width: 50, height: 48 },
  tee: { left: 25, top: 17.5, width: 50, height: 52 },
};
// Placement is stored as percentages RELATIVE to the print area
// (cx/cy = the print's center, size = print width as % of the area's
// width), so it maps proportionally when switching garments, and the
// order request carries it to the server for the printer to reproduce.
const HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 66 };
const hfState = { play: null, mediaType: "", apparel: "hoodie", side: "front", colorway: "Black", frozen: false, printDataUrl: "", printAspect: 0, placement: { ...HF_PLACEMENT_DEFAULT }, preset: "hypeframe" };
// (Store v8: the Hype Frame lockup — purple crown, script, underline —
// is drawn as canvas vector work in hfDrawLockup, so the old crown.png
// image loader is gone.)

window.openHypeFrame = (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || (CONTEST.entries || []).find((p) => p.id === id);
  if (!play) { alert("That play isn't on the board anymore."); return; }
  showHome(); closeMenu(false); showPanel("hypeframe");
  history.replaceState(null, "", `#hype-frame-${id}`);
  initHfStudio(play);
  document.getElementById("hypeframe").scrollIntoView({ behavior: "smooth" });
};
function initHfStudio(play) {
  hfState.play = play;
  hfState.frozen = false;
  hfState.printDataUrl = "";
  hfState.printAspect = 0;
  hfState.placement = { ...HF_PLACEMENT_DEFAULT };
  $("#hfPlayLine").textContent = `From the play “${play.title}” — freeze the frame, make it yours, preview it on apparel, and send the request. A parent or guardian confirms before anything is printed.`;
  $("#hfName").value = play.athlete_label || play.player_name || "";
  $("#hfJersey").value = play.jersey || "";
  hfSetPreset("hypeframe");
  $("#hfMsg").textContent = "";
  $("#hfPrintImg").hidden = true;
  $("#hfPrintEmpty").hidden = false;
  hfApplyPlacement();
  const v = $("#hfVideo"), photo = $("#hfPhoto"), scrubRow = $("#hfScrubRow"), freezeBtn = $("#hfFreeze"), linkNote = $("#hfLinkNote");
  v.pause(); v.removeAttribute("src"); v.load();
  photo.removeAttribute("src");
  if (play.media_kind === "file" && (play.mime || "").startsWith("image/")) {
    hfState.mediaType = "image";
    photo.src = play.media_url; photo.hidden = false;
    v.hidden = true; scrubRow.style.display = "none"; linkNote.hidden = true; freezeBtn.disabled = false;
  } else if (play.media_kind === "file") {
    hfState.mediaType = "video";
    v.src = play.media_url; v.hidden = false;
    photo.hidden = true; scrubRow.style.display = ""; linkNote.hidden = true; freezeBtn.disabled = false;
  } else {
    hfState.mediaType = "link";
    v.hidden = true; photo.hidden = true; scrubRow.style.display = "none";
    linkNote.hidden = false; freezeBtn.disabled = true;
  }
  hfSetApparel("hoodie");
  hfSetSide("front");
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
// Compose the FINAL print image: the frozen frame, the optional HYPE
// FRAME poster treatment (grunge frame + lockup band), and the name /
// jersey caption under the frame. The apparel preview and the
// submitted order both use this exact image — what they see is what
// would print.
function composeHfPrint() {
  const img = $("#hfPrintImg"), empty = $("#hfPrintEmpty");
  if (!hfState.frozen) { hfState.printDataUrl = ""; hfState.printAspect = 0; img.hidden = true; empty.hidden = false; hfApplyPlacement(); return; }
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
  img.src = hfState.printDataUrl;
  img.hidden = false; empty.hidden = true;
  hfApplyPlacement();
}
// Print style presets: radio behavior over the three options; the
// choice re-composes the print live, exactly like the old checkbox did.
function hfSetPreset(p) {
  hfState.preset = p;
  $$("[data-hf-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.hfPreset === p)));
  if (hfState.frozen) composeHfPrint();
}
// Position the print layer inside the mock from hfState.placement.
// Pixel math against the rendered mock, stored back as print-area
// percentages. When the print fits the area on an axis its center is
// clamped so it stays fully inside; when it can't fit (a tall portrait
// print at a big size), it stays centered on that axis instead. With no
// frozen frame, inline geometry is cleared and the CSS per-garment
// rules position the empty-state placeholder, exactly as before.
function hfApplyPlacement() {
  const mock = $("#hfMock"), print = $("#hfPrint");
  if (!mock || !print) return;
  if (!hfState.frozen || !hfState.printAspect) { print.style.left = ""; print.style.top = ""; print.style.width = ""; return; }
  const r = mock.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const areaTable = hfState.side === "back" ? HF_AREAS_BACK : HF_AREAS;
  const area = areaTable[hfState.apparel] || HF_AREAS.hoodie;
  const ax = r.width * area.left / 100, ay = r.height * area.top / 100;
  const aw = r.width * area.width / 100, ah = r.height * area.height / 100;
  const pw = aw * hfState.placement.size / 100;
  const ph = pw * hfState.printAspect;
  let cxp = ax + aw * hfState.placement.cx / 100;
  let cyp = ay + ah * hfState.placement.cy / 100;
  cxp = pw >= aw ? ax + aw / 2 : Math.min(Math.max(cxp, ax + pw / 2), ax + aw - pw / 2);
  cyp = ph >= ah ? ay + ah / 2 : Math.min(Math.max(cyp, ay + ph / 2), ay + ah - ph / 2);
  hfState.placement.cx = Math.round((cxp - ax) / aw * 1000) / 10;
  hfState.placement.cy = Math.round((cyp - ay) / ah * 1000) / 10;
  print.style.width = pw + "px";
  print.style.left = (cxp - pw / 2) + "px";
  print.style.top = (cyp - ph / 2) + "px";
}
// Exactly one of the four garment SVGs (apparel x side) is visible.
// Toggle the hidden ATTRIBUTE, not the .hidden property: the garments
// are SVG elements, where the IDL property does not reliably reflect
// to the content attribute — and the CSS rule (.hf-garment[hidden])
// keys off the attribute. toggleAttribute is an Element method, so it
// works on SVG in every engine.
function hfSyncGarment() {
  const a = hfState.apparel, s = hfState.side;
  $(".hf-garment-hoodie-front").toggleAttribute("hidden", !(a === "hoodie" && s === "front"));
  $(".hf-garment-hoodie-back").toggleAttribute("hidden", !(a === "hoodie" && s === "back"));
  $(".hf-garment-tee-front").toggleAttribute("hidden", !(a === "tee" && s === "front"));
  $(".hf-garment-tee-back").toggleAttribute("hidden", !(a === "tee" && s === "back"));
  $("#hfMock").dataset.apparel = a;
  $("#hfMock").dataset.side = s;
}
function hfSetSide(s) {
  hfState.side = s === "back" ? "back" : "front";
  $("#hfSideFront").setAttribute("aria-pressed", String(hfState.side === "front"));
  $("#hfSideBack").setAttribute("aria-pressed", String(hfState.side === "back"));
  hfSyncGarment();
  hfApplyPlacement();
}
function hfSetApparel(a) {
  hfState.apparel = a;
  $("#hfAppHoodie").setAttribute("aria-pressed", String(a === "hoodie"));
  $("#hfAppTee").setAttribute("aria-pressed", String(a === "tee"));
  hfSyncGarment();
  const list = HF_COLORWAYS[a];
  if (!list.some((c) => c.name === hfState.colorway)) hfState.colorway = list[0].name;
  $("#hfSwatches").innerHTML = list.map((c) => `<button type="button" class="pill hf-swatch" data-colorway="${esc(c.name)}" aria-pressed="${hfState.colorway === c.name}"><span class="swatch" style="--sw:${c.hex}"></span>${esc(c.name)}</button>`).join("");
  $$("#hfSwatches .hf-swatch").forEach((b) => b.addEventListener("click", () => hfSetColorway(b.dataset.colorway)));
  hfSetColorway(hfState.colorway);
  hfApplyPlacement();
}
function hfSetColorway(name) {
  const c = (HF_COLORWAYS[hfState.apparel] || []).find((k) => k.name === name) || HF_COLORWAYS[hfState.apparel][0];
  hfState.colorway = c.name;
  $$("#hfMock .hf-fabric").forEach((p) => p.setAttribute("fill", c.hex));
  $$("#hfSwatches .hf-swatch").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.colorway === c.name)));
  // The Hype Frame print's frame/lockup tone follows the garment color.
  if (hfState.frozen && hfState.preset === "hypeframe") composeHfPrint();
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
  const hfSeek = (d) => { if (v.duration) { v.pause(); v.currentTime = Math.min(Math.max(0, (v.currentTime || 0) + d), v.duration); hfUpdateTime(); } };
  $("#hfStepBack").addEventListener("click", () => hfSeek(-1));
  $("#hfStepFwd").addEventListener("click", () => hfSeek(1));
  ["hfName", "hfJersey"].forEach((id) => $("#" + id).addEventListener("input", () => { if (hfState.frozen) composeHfPrint(); }));
  $$("[data-hf-preset]").forEach((b) => b.addEventListener("click", () => hfSetPreset(b.dataset.hfPreset)));
  $("#hfAppHoodie").addEventListener("click", () => hfSetApparel("hoodie"));
  $("#hfAppTee").addEventListener("click", () => hfSetApparel("tee"));
  $("#hfSideFront").addEventListener("click", () => hfSetSide("front"));
  $("#hfSideBack").addEventListener("click", () => hfSetSide("back"));
  // Print placement is FIXED at the default (2026-11-04): no drag, no
  // size controls — hfApplyPlacement positions from the defaults and
  // the order still carries the placement values to the server.
  window.addEventListener("resize", hfApplyPlacement);
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
        colorway: hfState.colorway,
        placement: hfState.placement,
        guardianName: $("#hfGuardianName").value.trim(),
        guardianEmail,
        image: hfState.printDataUrl,
      }) });
      msg.textContent = r.message;
    } catch (err) { msg.textContent = "Error: " + err.message; }
  });
})();

/* ---------------- hero ---------------- */
(function () {
  const v = $("#heroVideo"), fill = $("#heroFill"), cur = $("#heroCur"), total = $("#heroTotal"), sound = $("#heroSound");
  const fmt = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
  if (!v) return;
  v.addEventListener("loadedmetadata", () => { if (v.duration) total.textContent = "/ " + fmt(v.duration); });
  v.addEventListener("timeupdate", () => { if (v.duration && fill) fill.style.width = (v.currentTime / v.duration * 100) + "%"; if (cur) cur.textContent = fmt(v.currentTime || 0); });
  const p = v.play(); if (p && p.catch) p.catch(() => v.setAttribute("controls", ""));
  sound?.addEventListener("click", () => { v.muted = !v.muted; sound.textContent = v.muted ? "🔊 Tap for sound" : "🔇 Sound on — tap to mute"; if (!v.muted) { const q = v.play(); if (q && q.catch) q.catch(() => {}); } });
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

/* ---------------- quick upload picks (2026-11-04) ----------------
// The wizard is gone: one screen. Division is a big Boys/Girls toggle
// (default Boys) and sport is one-tap pills; both write into the SAME
// hidden form fields the payload has always carried (name="division",
// name="sport"), so the API, pre-review and athlete checks are
// untouched. Validation happens once, at submit (see below).
function setDivPick(div) {
  const form = $("#uploadForm"); if (!form) return;
  form.elements.division.value = div;
  $$("[data-div-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.divPick === div)));
}
function setSportPick(sport) {
  const form = $("#uploadForm"); if (!form) return;
  form.elements.sport.value = sport || "";
  $$("[data-sport-pick]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.sportPick === sport)));
}
$$("[data-div-pick]").forEach((b) => b.addEventListener("click", () => setDivPick(b.dataset.divPick)));
$$("[data-sport-pick]").forEach((b) => b.addEventListener("click", () => setSportPick(b.dataset.sportPick)));
// After a successful submit the form resets; re-sync the toggle/pills
// with the reset field values (Boys, no sport).
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
  if (!String(form.elements.sport.value || "").trim()) { msg.textContent = "Tap the sport — one tap is all it takes."; document.querySelector(".quick-sports")?.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
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
    msg.textContent = j.message;
    form.reset();
    if (window.resetDropzone) window.resetDropzone();
    if (window.syncQuickPicks) window.syncQuickPicks();
    form.elements.athleteChoice.value = ""; form.elements.athleteKey.value = "";
    athleteCheckDoneFor = "";
    $("#athletePrompt").hidden = true;
  } catch (err) { msg.textContent = "Error: " + err.message; }
});

/* ---------------- owner ---------------- */
async function loadOwner() {
  if (!ownerToken()) { $("#ownerStatus").textContent = "Not claimed on this device yet."; $("#queue").innerHTML = ""; $("#reports").innerHTML = ""; return; }
  try {
    const q = await api("/api/owner/queue");
    $("#ownerStatus").textContent = "Owner access active on this device.";
    $("#queue").innerHTML = q.queue.map((h) => `<div class="queue-item"><b>${esc(h.title)}</b> — ${esc(h.sport)} — status: <b>${esc(h.status)}</b> — ${h.voteCount} votes
      ${h.player_name ? `<br>Athlete: ${esc(h.athlete_label || h.player_name)}${h.athlete_tag ? ` · ${esc(h.athlete_tag)}` : ""}${h.team ? ` · ${esc(h.team)}` : ""}` : ""}
      ${(() => { const bits = [];
        if (h.guardian_email) bits.push(`${esc(h.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(h.guardian_email)}?subject=${encodeURIComponent("HighlightHype — " + h.title)}">✉️ Contact guardian</a>`);
        if (h.guardian_phone) bits.push(`${esc(h.guardian_phone)} <a class="mini-btn" style="text-decoration:none" href="tel:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">📞 Call</a> <a class="mini-btn" style="text-decoration:none" href="sms:${esc(h.guardian_phone.replace(/[^+\d]/g, ""))}">💬 Text</a> ${h.text_consent ? `<span class="tagchip">Text opt-in: YES</span>` : `<span class="tagchip warn">No text opt-in — do not text</span>`}`);
        return bits.length ? `<br>Parent/guardian (owner only): ${bits.join("<br>")}` : `<br><span style="color:var(--muted)">No parent/guardian contact on file — can't be featured as a winner.</span>`; })()}
      ${h.review ? `<p>🤖 Pre-review: <b>${esc(h.review.verdict)}</b>${h.review.flags && h.review.flags.length ? `<br>${h.review.flags.map((f) => "• " + esc(f)).join("<br>")}` : ""}<br><i>First-pass check only — it does not approve the play. Watch it yourself before approving.</i></p>` : ""}
      <div class="qa"><button type="button" class="mini-btn" onclick="setStatus(${h.id},'approved')">Approve</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'hidden')">Hide</button><button type="button" class="mini-btn" onclick="setStatus(${h.id},'pending')">Back to review</button><button type="button" class="mini-btn" onclick="deletePlay(${h.id})">Delete</button></div></div>`).join("") || "<p>Queue is empty.</p>";
    const rep = await api("/api/owner/reports");
    $("#reports").innerHTML = rep.reports.map((r) => `<p>Play #${r.highlight_id}: ${esc(r.reason)} (${esc(r.created_at)})</p>`).join("") || "<p>No reports.</p>";
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
            Apparel: ${esc(o.apparel)} · ${esc(o.colorway)} · Print side: ${o.side === "back" ? "Back" : "Front"}<br>
            ${(() => { try { const p = JSON.parse(o.placement || ""); return p && p.cx != null ? `Placement: ${p.cx}% / ${p.cy}% · ${p.size}% size<br>` : ""; } catch { return ""; } })()}
            Parent/guardian (owner only): ${o.guardian_name ? `${esc(o.guardian_name)} — ` : ""}${esc(o.guardian_email)} <a class="mini-btn" style="text-decoration:none" href="mailto:${esc(o.guardian_email)}?subject=${encodeURIComponent("HighlightHype — your Hype Frame request")}">✉️ Contact guardian</a><br>
            <span style="color:var(--muted)">${esc(o.created_at)} — confirm with the guardian before printing anything.</span>
          </div>
        </div>`;
      }
      $("#hfRequests").innerHTML = hfHtml || "<p>No Hype Frame requests yet.</p>";
    } catch { $("#hfRequests").innerHTML = "<p>Could not load Hype Frame requests.</p>"; }
  } catch (e) { $("#ownerStatus").textContent = "Owner access was refused on this device: " + e.message; }
}
window.setStatus = async (id, status) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); loadOwner(); loadData(); };
window.deletePlay = async (id) => { if (!confirm("Delete this play permanently?")) return; await api(`/api/highlights/${id}`, { method: "DELETE" }); loadOwner(); loadData(); };
$("#ownerBtn").addEventListener("click", () => { showHome(); $("#ownerPanel").classList.remove("hidden"); loadOwner(); $("#ownerPanel").scrollIntoView({ behavior: "smooth", block: "start" }); });
$("#saveTokenBtn").addEventListener("click", () => { const t = $("#tokenInp").value.trim(); if (!t) return alert("Paste an owner token first."); localStorage.setItem("hh_owner_token", t); $("#tokenInp").value = ""; alert("Owner token saved on this device."); loadOwner(); });
$("#claimBtn").addEventListener("click", async () => { try { const r = await api("/api/owner/claim", { method: "POST" }); localStorage.setItem("hh_owner_token", r.token); alert("Owner claimed on this device. The token is saved in this browser."); loadOwner(); } catch (e) { alert(e.message); } });
$("#modLinkBtn").addEventListener("click", async () => { const m = $("#modLinkMsg"); m.textContent = "Sending…"; try { const r = await api("/api/moderate/request"); m.textContent = r.message; } catch (e) { m.textContent = e.message; } });

/* ---------------- boot / hashes ---------------- */
(function boot() {
  const tm = location.hash.match(/^#team-(.+)$/);
  if (tm) { allTeam = tm[1]; switchView("all"); }
  const am = location.hash.match(/^#athlete-(.+)$/);
  const hm = location.hash.match(/^#hype-frame-(\d+)$/);
  syncFilterUI();
  loadData().then(() => { if (am) openAthlete(am[1]); if (hm) openHypeFrame(Number(hm[1])); });
  if (location.hash === "#shop") showStore();
  if (location.hash === "#hype-girls" || location.hash === "#hype-boys") showStore(location.hash.slice(1));
  if (location.hash === "#owner") { $("#ownerPanel").classList.remove("hidden"); loadOwner(); }
})();
