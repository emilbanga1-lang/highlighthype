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
    return `<video src="${esc(h.media_url)}" controls playsinline muted loop preload="metadata"></video>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${esc(h.embed_url)}" allowfullscreen title="Embedded play"></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${esc(h.media_url)}" controls playsinline muted loop preload="metadata"></video>`;
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
      ${opts.prizeEligible === false ? `<p><span class="tagchip warn">Not prize-eligible — no parent/guardian contact on file</span></p>` : ""}
      <div class="votes">
        <button type="button" class="votebtn" aria-pressed="${h.hasVoted ? "true" : "false"}" onclick="toggleVote(${h.id})">${h.hasVoted ? "You voted — tap to remove" : "Vote"}</button>
        <span class="votecount"><b>${votes}</b> ${voteLabel} vote${votes === 1 ? "" : "s"}</span>
      </div>
      <div class="card-actions">
        <button type="button" class="mini-btn" onclick="openHypeFrame(${h.id})">📸 Create a Hype Frame</button>
        <button type="button" class="mini-btn" onclick="enterContest(${h.id})">🏆 Enter this play</button>
        <button type="button" class="mini-btn" onclick="sharePlay(${h.id})">🔗 Share</button>
        <button type="button" class="mini-btn" onclick="reportPlay(${h.id})">🚩 Report</button>
        ${ownerToken() && opts.inContest ? `<button type="button" class="mini-btn" onclick="markWinner(${h.id})">Mark winner (owner)</button>` : ""}
      </div>
    </div>
  </article>`;
}
window.toggleVote = async (id) => { try { await api(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken }) }); await loadData(); } catch (e) { alert(e.message); } };
window.enterContest = async (id) => {
  const play = ALL_PLAYS.find((p) => p.id === id) || CONTEST.entries.find((p) => p.id === id);
  if (play && !play.hasGuardianEmail && !play.hasGuardianText && !confirm("Heads up: this play has no parent/guardian email and no consented guardian text number on file, so it won't be prize-eligible — winners are contacted through a parent/guardian only. Enter anyway?")) return;
  try { const r = await api("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); alert(r.message); await loadData(); } catch (e) { alert(e.message); }
};
window.reportPlay = async (id) => { const reason = prompt("Why are you reporting this play? (optional)") || "Reported by a user"; try { const r = await api(`/api/highlights/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }); alert(r.message); } catch (e) { alert(e.message); } };
window.markWinner = async (id) => { try { const r = await api("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); if (r.warning) alert(r.warning); await loadData(); } catch (e) { alert(e.message); } };
window.sharePlay = async (id) => {
  const url = `${location.origin}${location.pathname}#play-${id}`;
  try { await navigator.clipboard.writeText(url); alert("Link copied! Share it anywhere."); }
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
  // Proof panel stats
  $("#proofContestStat").textContent = `${entries.length} ${entries.length === 1 ? "ENTRY" : "ENTRIES"}`;
  $("#proofContestSub").textContent = y && m ? `${MONTHS[m - 1]} ${y} · votes close at month-end` : "This month's contest";
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
  if (ranked.length) $("#proofFameStat").textContent = `#1: ${ranked[0].voteCount} VOTES`;
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
  const hawks = ALL_PLAYS.filter((h) => slugify(h.team) === "plainview-hawks").length;
  $("#proofHawksStat").textContent = hawks ? `${hawks} PLAY${hawks === 1 ? "" : "S"}` : "1 TEAM";
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
  const el = document.querySelector(`[data-play-id="${pm[1]}"]`);
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
$$("[data-panel-btn]").forEach((b) => b.addEventListener("click", () => { showHome(); closeMenu(false); showPanel(b.dataset.panelBtn); document.getElementById("deck")?.scrollIntoView({ behavior: "smooth" }); }));
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
  const sv = $("#swagVideo"); if (sv) { const p = sv.play(); if (p && p.catch) p.catch(() => {}); }
  // Store redesign (2026-11-04): #hype-girls / #hype-boys are no longer
  // stacked board sections — they select the grid's division filter and
  // land on the product grid. Other targets scroll as before.
  if (target === "hype-girls" || target === "hype-boys") {
    setStoreDivision(target === "hype-girls" ? "girls" : "boys", "all");
    setTimeout(() => document.getElementById("collections")?.scrollIntoView({ behavior: "smooth" }), 60);
  } else if (target) { const el = document.getElementById(target); if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth" }), 60); }
}
function showHome() {
  if (!document.body.classList.contains("store-open")) return;
  document.body.classList.remove("store-open");
  if (location.hash === "#shop") history.replaceState(null, "", "#top");
  const hv = $("#heroVideo"); if (hv) { const p = hv.play(); if (p && p.catch) p.catch(() => {}); }
}
$$("[data-store-link]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); closeMenu(false); showStore(a.dataset.storeTarget || null); }));
$$("[data-home-link]").forEach((b) => b.addEventListener("click", () => { showHome(); window.scrollTo(0, 0); }));
$$(".brand").forEach((b) => b.addEventListener("click", () => showHome()));
window.addEventListener("hashchange", () => {
  if (location.hash === "#shop") showStore();
  if (location.hash === "#hype-girls" || location.hash === "#hype-boys") showStore(location.hash.slice(1));
  const hm = location.hash.match(/^#hype-frame-(\d+)$/);
  if (hm) openHypeFrame(Number(hm[1]));
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
const FILM_SCENES = [
  { until: 2.5, title: "The Hype Girls hoodies", sub: "You paused on the Girls scene — Hype Street, Hype Athletics & Hype Essentials.", btn: "View the Girls look", target: "hype-girls" },
  { until: 5.0, title: "The Hype Boys hoodies", sub: "You paused on the Boys scene — Hype Street, Hype Athletics & Hype Unleashed.", btn: "View the Boys look", target: "hype-boys" },
  { until: 7.5, title: "The Hype All Day hoodie", sub: "You paused on the statement hoodie — see the coordinating pieces below.", btn: "View this look", target: "coordinating" },
  { until: Infinity, title: "Drop 001 — the full drop", sub: "Both collections, six boards. Preview — products are finalizing.", btn: "Shop Drop 001", target: "collections" },
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
  // Store v2 hero (2026-11-04): no native controls — tapping the film
  // toggles playback, and a round outline button (Overtime style,
  // bottom-right) does the same. Pausing still surfaces the scene card
  // above via the pause listener; the button icon just mirrors state.
  const playBtn = $("#swagPlayBtn");
  function syncPlayBtn() {
    if (!playBtn) return;
    playBtn.classList.toggle("is-paused", v.paused);
    playBtn.setAttribute("aria-label", v.paused ? "Play the Drop 001 film" : "Pause the Drop 001 film");
  }
  v.addEventListener("click", () => { if (v.paused) v.play(); else v.pause(); });
  if (playBtn) playBtn.addEventListener("click", (e) => { e.stopPropagation(); if (v.paused) v.play(); else v.pause(); });
  v.addEventListener("play", syncPlayBtn);
  v.addEventListener("pause", syncPlayBtn);
  syncPlayBtn();
})();

/* ---------------- Store: product grid (Drop 001 redesign) ----------------
   Emil (2026-11-04): the Store is now a compact product grid with real
   lookbook photography instead of six stacked illustrated boards.
   - Girls/Boys toggle + collection chips filter the grid in place.
   - Cards flip front/back (hover on desktop, ⇄ toggle on touch) and
     open a quick-view overlay. Preview only: no prices, no checkout.
   - The film's scene targets keep their names (hype-girls, hype-boys,
     coordinating, collections) but now drive the grid: division scenes
     set the filter and flash-highlight that side's cards; the other
     scenes land on the grid and flash the visible cards. */
const storeState = { division: "girls", chip: "all" };
function applyStoreFilter() {
  $$(".prod-card").forEach((c) => {
    const ok = c.dataset.division === storeState.division && (storeState.chip === "all" || c.dataset.collection === storeState.chip);
    c.hidden = !ok;
  });
  $$("[data-store-div]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.storeDiv === storeState.division)));
  $$("[data-store-chip]").forEach((b) => {
    if (b.dataset.chipDiv) b.hidden = b.dataset.chipDiv !== storeState.division;
    b.setAttribute("aria-pressed", String(b.dataset.storeChip === storeState.chip));
  });
}
function setStoreDivision(division, chip) {
  storeState.division = division;
  if (chip) storeState.chip = chip;
  // A chip that only exists on the other side (Essentials/Unleashed)
  // cannot survive a division switch.
  if (storeState.chip !== "all") {
    const chipBtn = $(`[data-store-chip="${storeState.chip}"]`);
    if (chipBtn && chipBtn.dataset.chipDiv && chipBtn.dataset.chipDiv !== division) storeState.chip = "all";
  }
  applyStoreFilter();
}
function flashStoreCards(selector) {
  const cards = $$(selector || ".prod-card:not([hidden])");
  cards.forEach((c) => { c.classList.remove("flash"); void c.offsetWidth; c.classList.add("flash"); });
  setTimeout(() => cards.forEach((c) => c.classList.remove("flash")), 2400);
}
function goToStoreScene(target) {
  if (target === "hype-girls" || target === "hype-boys") {
    const div = target === "hype-girls" ? "girls" : "boys";
    setStoreDivision(div, "all");
    document.getElementById("collections")?.scrollIntoView({ behavior: "smooth" });
    flashStoreCards(`.prod-card[data-division="${div}"]`);
  } else {
    // "coordinating" / "collections": the whole grid is the destination.
    storeState.chip = "all"; applyStoreFilter();
    document.getElementById("collections")?.scrollIntoView({ behavior: "smooth" });
    flashStoreCards();
  }
}
$$("[data-store-div]").forEach((b) => b.addEventListener("click", () => setStoreDivision(b.dataset.storeDiv)));
$$("[data-store-chip]").forEach((b) => b.addEventListener("click", () => { storeState.chip = b.dataset.storeChip; applyStoreFilter(); }));
// Store v2 (2026-11-04): the hero's underlined Shop Girls / Shop Boys
// links and the full-width photo tiles are navigation too — same
// destination as the film's division scenes (set filter, scroll to the
// grid, flash that side's cards).
$$("[data-hero-shop]").forEach((b) => b.addEventListener("click", () => goToStoreScene(b.dataset.heroShop === "girls" ? "hype-girls" : "hype-boys")));
$$("[data-store-tile]").forEach((b) => b.addEventListener("click", () => goToStoreScene(b.dataset.storeTile === "girls" ? "hype-girls" : "hype-boys")));
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
function openQuickView(card) {
  const qv = $("#quickView"); if (!qv) return;
  const front = card.querySelector(".prod-front"), back = card.querySelector(".prod-back"), flat = card.querySelector(".prod-flat");
  const qf = $("#qvFront"), qb = $("#qvBack"), qfl = $("#qvFlat");
  qf.src = front.src; qf.alt = front.alt; qb.src = back.src; qb.alt = back.alt; qfl.src = flat.src; qfl.alt = flat.alt;
  $("#qvSide").textContent = card.querySelector(".prod-side").textContent;
  $("#qvTitle").textContent = card.querySelector("h4").textContent;
  $("#qvSlogan").textContent = card.querySelector(".prod-slogan").textContent;
  $("#qvDesc").textContent = card.querySelector(".prod-desc").textContent;
  $("#qvColors").textContent = card.querySelector(".prod-colors").textContent;
  qv.hidden = false;
  document.body.classList.add("qv-open");
  qv.querySelector(".qv-close")?.focus();
}
function closeQuickView() {
  const qv = $("#quickView"); if (!qv) return;
  qv.hidden = true;
  document.body.classList.remove("qv-open");
}
$$("[data-qv-close]").forEach((el) => el.addEventListener("click", closeQuickView));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeQuickView(); });
applyStoreFilter();

/* ---------------- Hype Frame studio ---------------- */
// Emil's product concept (2026-11-04): a real freeze-frame from the
// athlete's OWN highlight, printed on premium youth apparel.
//   1. Select your highlight from an uploaded video (the play card button).
//   2. Freeze your favorite frame using a video timeline (scrub + freeze).
//   3. Customize with your name, jersey number, and optional HYPE FRAME
//      branding (drawn onto the print image itself, not just the preview).
//   4. Preview the actual image on a hoodie or T-shirt.
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
// Placement is stored as percentages RELATIVE to the print area
// (cx/cy = the print's center, size = print width as % of the area's
// width), so it maps proportionally when switching garments, and the
// order request carries it to the server for the printer to reproduce.
const HF_PLACEMENT_DEFAULT = { cx: 50, cy: 42, size: 66 };
const hfState = { play: null, mediaType: "", apparel: "hoodie", colorway: "Black", frozen: false, printDataUrl: "", printAspect: 0, placement: { ...HF_PLACEMENT_DEFAULT } };
const hfCrown = new Image();
let hfCrownReady = false;
hfCrown.onload = () => { hfCrownReady = true; if (hfState.frozen) composeHfPrint(); };
hfCrown.src = "/crown.png";

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
  $("#hfSize").value = HF_PLACEMENT_DEFAULT.size;
  $("#hfSizeVal").textContent = HF_PLACEMENT_DEFAULT.size + "%";
  $("#hfPlace").hidden = true;
  $("#hfPlayLine").textContent = `From the play “${play.title}” — freeze the frame, make it yours, preview it on apparel, and send the request. A parent or guardian confirms before anything is printed.`;
  $("#hfName").value = play.athlete_label || play.player_name || "";
  $("#hfJersey").value = play.jersey || "";
  $("#hfBranding").checked = true;
  $("#hfMsg").textContent = "";
  $("#hfStillWrap").hidden = true;
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
  $("#hfStill").src = c.toDataURL("image/png");
  $("#hfStillWrap").hidden = false;
  composeHfPrint();
}
// Compose the FINAL print image: the frozen frame, the optional HYPE
// FRAME lockup drawn into the frame's corner, and the name / jersey
// caption under the frame. The apparel preview and the submitted order
// both use this exact image — what they see is what would print.
function composeHfPrint() {
  const img = $("#hfPrintImg"), empty = $("#hfPrintEmpty");
  if (!hfState.frozen) { hfState.printDataUrl = ""; hfState.printAspect = 0; img.hidden = true; empty.hidden = false; $("#hfPlace").hidden = true; hfApplyPlacement(); return; }
  const fc = $("#hfCanvas");
  const W = fc.width, H = fc.height;
  const name = $("#hfName").value.trim(), jersey = $("#hfJersey").value.trim();
  const branding = $("#hfBranding").checked;
  const caption = [name ? name.toUpperCase() : "", jersey ? "#" + jersey.replace(/^#/, "") : ""].filter(Boolean).join(" · ");
  const bandH = caption ? Math.round(W * 0.17) : 0;
  const c = document.createElement("canvas");
  c.width = W; c.height = H + bandH;
  const x = c.getContext("2d");
  x.drawImage(fc, 0, 0);
  if (branding) {
    const m = Math.round(W * 0.03);
    const cw = Math.round(W * 0.17), ch = Math.round(cw * 290 / 518);
    if (hfCrownReady) x.drawImage(hfCrown, W - cw - m, m, cw, ch);
    else { // fallback crown if the image hasn't loaded: simple gold spikes
      x.save(); x.fillStyle = "#e3b93e"; x.beginPath();
      const bx = W - cw - m, by = m + ch * 0.25;
      x.moveTo(bx, by + ch * 0.6); x.lineTo(bx + cw * 0.08, by); x.lineTo(bx + cw * 0.3, by + ch * 0.38); x.lineTo(bx + cw * 0.5, by - ch * 0.22); x.lineTo(bx + cw * 0.7, by + ch * 0.38); x.lineTo(bx + cw * 0.92, by); x.lineTo(bx + cw, by + ch * 0.6); x.closePath(); x.fill(); x.restore();
    }
    const fs = Math.max(14, Math.round(W * 0.034));
    x.font = `800 ${fs}px Archivo, Arial, sans-serif`;
    x.textAlign = "right"; x.textBaseline = "top";
    try { x.letterSpacing = "2px"; } catch {}
    x.lineWidth = Math.max(2, fs / 6); x.strokeStyle = "rgba(0,0,0,.6)";
    const ly = m + ch + Math.round(W * 0.008);
    x.strokeText("HYPE FRAME", W - m, ly);
    x.fillStyle = "#ffffff"; x.fillText("HYPE FRAME", W - m, ly);
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
  $("#hfPlace").hidden = false;
  hfApplyPlacement();
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
  const area = HF_AREAS[hfState.apparel] || HF_AREAS.hoodie;
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
function hfSetPlacementSize(size) {
  hfState.placement.size = Math.min(100, Math.max(30, Math.round(Number(size) || HF_PLACEMENT_DEFAULT.size)));
  $("#hfSize").value = hfState.placement.size;
  $("#hfSizeVal").textContent = hfState.placement.size + "%";
  hfApplyPlacement();
}
function hfResetPlacement() {
  hfState.placement = { ...HF_PLACEMENT_DEFAULT };
  $("#hfSize").value = HF_PLACEMENT_DEFAULT.size;
  $("#hfSizeVal").textContent = HF_PLACEMENT_DEFAULT.size + "%";
  hfApplyPlacement();
}
function hfSetApparel(a) {
  hfState.apparel = a;
  $("#hfAppHoodie").setAttribute("aria-pressed", String(a === "hoodie"));
  $("#hfAppTee").setAttribute("aria-pressed", String(a === "tee"));
  $("#hfMock").dataset.apparel = a;
  // Toggle the hidden ATTRIBUTE, not the .hidden property: the garments
  // are SVG elements, where the IDL property does not reliably reflect
  // to the content attribute — and the CSS rule (.hf-garment[hidden])
  // keys off the attribute. toggleAttribute is an Element method, so it
  // works on SVG in every engine.
  $(".hf-garment-hoodie").toggleAttribute("hidden", a !== "hoodie");
  $(".hf-garment-tee").toggleAttribute("hidden", a !== "tee");
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
}
(function () {
  const v = $("#hfVideo");
  if (!v) return;
  v.addEventListener("loadedmetadata", () => { $("#hfScrub").max = v.duration || 0; hfUpdateTime(); });
  v.addEventListener("timeupdate", () => { $("#hfScrub").value = v.currentTime || 0; hfUpdateTime(); });
  $("#hfScrub").addEventListener("input", (e) => { if (v.duration) { v.currentTime = Number(e.target.value); hfUpdateTime(); } });
  $("#hfFreeze").addEventListener("click", freezeHfFrame);
  ["hfName", "hfJersey"].forEach((id) => $("#" + id).addEventListener("input", () => { if (hfState.frozen) composeHfPrint(); }));
  $("#hfBranding").addEventListener("change", () => { if (hfState.frozen) composeHfPrint(); });
  $("#hfAppHoodie").addEventListener("click", () => hfSetApparel("hoodie"));
  $("#hfAppTee").addEventListener("click", () => hfSetApparel("tee"));
  // Print placement: drag the print on the garment (pointer events, so
  // mouse + touch both work; touch-action:none on the print layer keeps
  // the drag from fighting page scroll), size slider + steppers, reset.
  const hfPrintEl = $("#hfPrint");
  let hfDrag = null;
  hfPrintEl.addEventListener("pointerdown", (e) => {
    if (!hfState.frozen) return;
    e.preventDefault();
    try { hfPrintEl.setPointerCapture(e.pointerId); } catch {}
    hfDrag = { x: e.clientX, y: e.clientY, cx: hfState.placement.cx, cy: hfState.placement.cy };
  });
  hfPrintEl.addEventListener("pointermove", (e) => {
    if (!hfDrag) return;
    const r = $("#hfMock").getBoundingClientRect();
    if (!r.width || !r.height) return;
    const area = HF_AREAS[hfState.apparel] || HF_AREAS.hoodie;
    const aw = r.width * area.width / 100, ah = r.height * area.height / 100;
    hfState.placement.cx = Math.min(100, Math.max(0, hfDrag.cx + (e.clientX - hfDrag.x) / aw * 100));
    hfState.placement.cy = Math.min(100, Math.max(0, hfDrag.cy + (e.clientY - hfDrag.y) / ah * 100));
    hfApplyPlacement();
  });
  ["pointerup", "pointercancel"].forEach((ev) => hfPrintEl.addEventListener(ev, () => { hfDrag = null; }));
  hfPrintEl.addEventListener("dragstart", (e) => e.preventDefault());
  $("#hfSize").addEventListener("input", (e) => hfSetPlacementSize(e.target.value));
  $("#hfSizeMinus").addEventListener("click", () => hfSetPlacementSize(hfState.placement.size - 4));
  $("#hfSizePlus").addEventListener("click", () => hfSetPlacementSize(hfState.placement.size + 4));
  $("#hfPlaceReset").addEventListener("click", hfResetPlacement);
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
        branding: $("#hfBranding").checked,
        apparel: hfState.apparel,
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
// Modern drag-and-drop front end for the SAME file input the form has
// always submitted (name="file"). It only dresses up picking the file:
// click/keyboard opens the native picker, drag & drop assigns the file
// to the input, and the chosen file's name + size are shown. Uploads are
// file-only — the old paste-a-link option was removed (Emil, 2026-11-04).
(function () {
  const dz = $("#dropzone"), input = $("#fileInput"), fileLine = $("#dzFile");
  if (!dz || !input) return;
  const fmtSize = (n) => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " KB" : n + " B";
  function showFile() {
    const f = input.files && input.files[0];
    dz.classList.toggle("has-file", !!f);
    if (f) { fileLine.textContent = `✓ ${f.name} · ${fmtSize(f.size)} — ready. Hit Continue below to add the details.`; fileLine.hidden = false; }
    else { fileLine.textContent = ""; fileLine.hidden = true; }
    // Picking a (new) file clears any Step 1 wizard message (e.g. the
    // mirrored confirmation from a just-finished submit).
    if (typeof uploadStepError === "function") uploadStepError(1, "");
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

/* ---------------- upload wizard (3 steps) ---------------- */
// Presentation only (Emil, 2026-11-04): the SAME form, fields, payload
// and submit handler — the wizard just shows one section at a time and
// gates Continue on what each step needs. Submit-time rules are
// unchanged from the single-page form: the guardian email stays
// OPTIONAL, and the athlete "same athlete?" prompt still runs at
// submit — when it fires, the wizard jumps back to Step 2 (where the
// prompt now lives) and returns to Step 3 on the prompt's Continue, so
// no entered data or chosen file is ever lost.
let uploadStep = 1;
const UPLOAD_STEP_NAMES = { 1: "Your video", 2: "The athlete", 3: "Parent/guardian (private)" };
function showUploadStep(n) {
  uploadStep = n;
  $$("#uploadForm .form-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== n; });
  const label = $("#uploadStepLabel"), fill = $("#uploadBarFill");
  if (label) label.textContent = `Step ${n} of 3 — ${UPLOAD_STEP_NAMES[n]}`;
  if (fill) fill.style.width = (n / 3 * 100) + "%";
  const back = $("#upBack"), next = $("#upNext");
  if (back) back.hidden = n === 1;
  if (next) next.hidden = n === 3;
}
function uploadStepError(n, text) {
  const el = $("#stepMsg" + n);
  if (el) { el.textContent = text || ""; el.hidden = !text; }
}
function validUploadStep(n) {
  const form = $("#uploadForm");
  if (!form) return true;
  if (n === 1) {
    const f = form.elements.file;
    if (!f || !f.files || !f.files.length) { uploadStepError(1, "Add your video or photo first — drop the clip in the box above."); return false; }
    if (!String(form.elements.title.value || "").trim()) { uploadStepError(1, "Give the play a title — that's what shows on the board."); form.elements.title.focus(); return false; }
  }
  if (n === 2) {
    if (!String(form.elements.playerName.value || "").trim()) { uploadStepError(2, "Add the athlete's first name — every hype needs its athlete."); form.elements.playerName.focus(); return false; }
    if (!form.elements.division.value) { uploadStepError(2, "Pick the division — Boys or Girls."); return false; }
  }
  uploadStepError(n, "");
  return true;
}
(function initUploadWizard() {
  const form = $("#uploadForm");
  if (!form) return;
  showUploadStep(1);
  $("#upNext").addEventListener("click", () => { if (validUploadStep(uploadStep)) showUploadStep(uploadStep + 1); });
  $("#upBack").addEventListener("click", () => showUploadStep(uploadStep - 1));
  // Enter advances through Steps 1-2 instead of submitting early; on
  // Step 3 it submits as usual. Textareas keep Enter for new lines, and
  // the dropzone keeps Enter for opening the file picker.
  form.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || uploadStep >= 3) return;
    const t = e.target;
    if (!t || t.tagName === "TEXTAREA" || t.tagName === "BUTTON") return;
    if (t.closest && t.closest("#dropzone")) return;
    if (t.type === "checkbox" || t.type === "radio" || t.type === "file") return;
    if (!$("#athletePrompt").hidden) return;
    e.preventDefault();
    if (validUploadStep(uploadStep)) showUploadStep(uploadStep + 1);
  });
})();

/* ---------------- upload + athlete prompt ---------------- */
let athleteCheckDoneFor = "";
$("#uploadForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const fd = new FormData(form);
  const name = String(fd.get("playerName") || "").trim();
  const msg = $("#uploadMsg");
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
        // The prompt lives in Step 2 of the wizard: jump back there to
        // show it (hiding the wizard nav so its Continue isn't confused
        // with the prompt's), then return to Step 3 on the prompt's
        // Continue so the upload result shows where Submit was pressed.
        showUploadStep(2);
        box.hidden = false;
        $("#upNext").hidden = true;
        $("#upBack").hidden = true;
        box.scrollIntoView({ behavior: "smooth", block: "center" });
        $("#athleteContinue").onclick = () => {
          const pick = box.querySelector("input[name='athletePick']:checked");
          if (!pick) { alert("Pick one so we file this play under the right athlete."); return; }
          if (pick.value === "__new") { form.elements.athleteChoice.value = "new"; form.elements.athleteKey.value = ""; }
          else { form.elements.athleteChoice.value = "same"; form.elements.athleteKey.value = pick.value; }
          athleteCheckDoneFor = name.toLowerCase();
          box.hidden = true;
          showUploadStep(3);
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
    form.elements.athleteChoice.value = ""; form.elements.athleteKey.value = "";
    athleteCheckDoneFor = "";
    $("#athletePrompt").hidden = true;
    uploadStepError(2, "");
    showUploadStep(1);
    // The wizard resets to Step 1 with the form cleared (today's reset
    // behavior); mirror the server's confirmation at Step 1 so the step
    // change doesn't swallow it.
    uploadStepError(1, j.message);
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
        return bits.length ? `<br>Parent/guardian (owner only): ${bits.join("<br>")}` : `<br><span style="color:var(--muted)">No parent/guardian contact on file — not prize-eligible.</span>`; })()}
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
            Apparel: ${esc(o.apparel)} · ${esc(o.colorway)}<br>
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
