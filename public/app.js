// HighlightHype front end. Voter identity = a random token stored in this
// browser (one vote per browser per play). Real account voting is a later,
// public-launch upgrade — see README limitations.
const $ = (s) => document.querySelector(s);
const voterToken = localStorage.getItem("hh_voter") || (() => { const t = "v_" + Math.random().toString(36).slice(2) + Date.now(); localStorage.setItem("hh_voter", t); return t; })();
const ownerToken = () => localStorage.getItem("hh_owner_token") || "";
const api = async (path, opts = {}) => {
  const r = await fetch(path, { ...opts, headers: { ...(opts.headers || {}), ...(ownerToken() ? { "x-owner-token": ownerToken() } : {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || "Request failed");
  return j;
};
const SPORT_COLORS = { baseball: "⚾", basketball: "🏀", soccer: "⚽", football: "🏈", softball: "🥎", gymnastics: "🤸", volleyball: "🏐", fieldhockey: "🏑", cheer: "📣", hockey: "🏒", lacrosse: "🥍", other: "⭐" };

function mediaHtml(h) {
  if (h.media_kind === "file") {
    if ((h.mime || "").startsWith("image/")) return `<img src="${h.media_url}" alt="">`;
    return `<div><video src="${h.media_url}" controls playsinline muted loop autoplay preload="auto" onclick="tapVideo(this)"></video><button class="tap-sound" onclick="tapVideo(this.previousElementSibling)">🔊 Tap for sound</button></div>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${h.embed_url}" allowfullscreen></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${h.media_url}" controls playsinline muted loop autoplay preload="auto" onclick="tapVideo(this)"></video>`;
  return `<p><a class="big" href="${h.media_url}" target="_blank" rel="noopener">▶ Watch on ${h.host_label || "link"} ↗</a></p>`;
}
window.tapVideo = (v) => { if (!v) return; if (v.muted) { v.muted = false; v.currentTime = 0; v.play(); } else if (v.paused) { v.play(); } else { v.pause(); } };
window.sharePlay = async (id) => {
  const url = `${location.origin}${location.pathname}#play-${id}`;
  try { await navigator.clipboard.writeText(url); alert("Link copied! Share it anywhere."); }
  catch { prompt("Copy this play link:", url); }
};
function cardHtml(h, inContest = false) {
  return `<article class="play sport-${esc(h.sport || "other")}" data-play-id="${h.id}">
    ${h.isWinner ? "<div class='tag'>🏆 HYPE OF THE MONTH WINNER</div>" : ""}
    ${mediaHtml(h)}
    <h3>${esc(h.title)}</h3>
    <div><span class="tag">${SPORT_COLORS[h.sport] || "⭐"} ${cap(h.sport)}</span>${h.play_type ? `<span class="tag">${esc(h.play_type)}</span>` : ""}${h.division === "girls" ? `<span class="tag">Girls</span>` : ""}${h.division === "boys" ? `<span class="tag">Boys</span>` : ""}${h.team ? `<span class="tag">🏟️ ${esc(h.team)}</span>` : ""}${h.player_name ? `<span class="tag">${esc(h.player_name)}</span>` : ""}</div>
    ${h.story ? `<p>${esc(h.story)}</p>` : ""}
    <p><button class="vote ${h.hasVoted ? "on" : ""}" onclick="toggleVote(${h.id})" title="${h.hasVoted ? "You voted — tap to remove your vote" : "Tap to vote"}">${h.hasVoted ? "♥" : "♡"} ${h.voteCount} vote${h.voteCount === 1 ? "" : "s"}${h.hasVoted ? " • You voted — tap to remove" : ""}</button>
    <button class="enter-btn" onclick="enterContest(${h.id})">🏆 Enter this play</button>
    <button onclick="sharePlay(${h.id})">🔗 Share this play</button>
    <button class="report-btn" onclick="reportPlay(${h.id})">🚩 Report this play</button></p>
    ${ownerToken() && inContest ? `<button onclick="markWinner(${h.id})">Mark as winner (owner)</button>` : ""}
  </article>`;
}
function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const cap = (s) => { if (s === "fieldhockey") return "Field Hockey"; const t = String(s || ""); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

let currentSport = "all", currentSort = "top", currentDivision = "boys", currentTeam = "all";
const slugify = (s) => String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const SPORTS = [["all", "🏆 All Sports"], ["baseball", "⚾ Baseball"], ["basketball", "🏀 Basketball"], ["cheer", "📣 Cheer"], ["fieldhockey", "🏑 Field Hockey"], ["football", "🏈 Football"], ["gymnastics", "🤸 Gymnastics"], ["hockey", "🏒 Hockey"], ["lacrosse", "🥍 Lacrosse"], ["other", "⭐ Other"], ["soccer", "⚽ Soccer"], ["softball", "🥎 Softball"], ["volleyball", "🏐 Volleyball"]];
function renderSportPills() {
  $("#sportPills").innerHTML = SPORTS.map(([v, l]) => `<button class="pill ${currentSport === v ? "active" : ""}" data-sport="${v}">${l}</button>`).join("");
  document.querySelectorAll("#sportPills .pill").forEach((b) => b.onclick = () => { currentSport = b.dataset.sport; renderSportPills(); loadPlays(); });
}
async function loadPlays() {
  const sport = currentSport, sort = currentSort, search = $("#searchInp").value;
  const d = await api(`/api/highlights?sport=${sport}&division=${currentDivision}&team=${encodeURIComponent(currentTeam)}&sort=${sort}&search=${encodeURIComponent(search)}&voterToken=${voterToken}`);
  // Team filter options (prototype): from all approved plays, so filtering
  // to one team does not hide the other teams from the dropdown.
  const tf = $("#teamFilter");
  if (tf) {
    try {
      const all = await api(`/api/highlights?division=all&voterToken=${voterToken}`);
      const teams = [...new Set(all.highlights.map((h) => h.team).filter(Boolean))];
      tf.innerHTML = `<option value="all">All teams</option>` + teams.map((t) => `<option value="${slugify(t)}">${esc(t)}</option>`).join("");
      tf.value = teams.some((t) => slugify(t) === currentTeam) ? currentTeam : "all";
    } catch {}
  }
  $("#statPlays").textContent = d.highlights.length;
  $("#statVotes").textContent = d.highlights.reduce((s, h) => s + (h.voteCount || 0), 0);
  const top = d.highlights.slice(0, 3);
  const slots = [0, 1, 2].map((i) => {
    const h = top[i];
    if (!h) return `<div class="open-spot"><b>Open spot — upload a play!</b><span>🚀</span></div>`;
    if (i === 0) return `<div class="mini"><div>👑</div><h3>${esc(h.title)}</h3><p><b>${h.voteCount} vote${h.voteCount === 1 ? "" : "s"} • ${SPORT_COLORS[h.sport] || "⭐"}</b><br>${esc(h.player_name || "")}</p><div style="height:8px;background:#2EE6FF;border-radius:4px"></div></div>`;
    return `<div class="open-spot"><b>#${i + 1} — ${esc(h.title)}</b><span>${h.voteCount} votes • ${esc(h.player_name || "")}</span></div>`;
  });
  $("#podium").innerHTML = slots.join("");
  const hof = $("#hofList");
  if (hof) {
    const ranked = [...d.highlights].sort((a, b) => b.voteCount - a.voteCount || b.id - a.id).slice(0, 10);
    hof.innerHTML = ranked.length > 3
      ? `<h3>Top 10 — all time</h3>` + ranked.slice(3).map((h, i) => `<p><b>#${i + 4}</b> — ${esc(h.title)} — ${h.voteCount} votes${h.team ? ` • ${esc(h.team)}` : ""}</p>`).join("")
      : `<p class="small">Top 10 fills in as more plays are posted — the podium above shows the Top 3 so far.</p>`;
  }
  $("#playsGrid").innerHTML = d.highlights.length ? d.highlights.map((h, i) => `<div>${i === 0 ? "<div class='tag' style='background:#FF4655'>● #1 PLAY RIGHT NOW</div>" : ""}${cardHtml(h)}</div>`).join("") : "<p>No plays match yet.</p>";
  // Shareable play link: #play-<id> scrolls to that card and highlights it.
  const pm = location.hash.match(/^#play-(\d+)$/);
  if (pm) {
    const el = document.querySelector(`[data-play-id="${pm[1]}"]`);
    if (el) { setTimeout(() => { el.scrollIntoView({ behavior: "smooth", block: "center" }); el.style.outline = "3px solid #D8FF3E"; }, 100); }
  }
}
async function loadContest() {
  const d = await api(`/api/contest?voterToken=${voterToken}`);
  $("#contestPeriod").textContent = d.period;
  const cd = $("#contestCountdown");
  if (cd && /^\d{4}-\d{2}$/.test(d.period)) {
    const [y, m] = d.period.split("-").map(Number);
    const last = new Date(y, m, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = Math.max(0, Math.round((last - today) / 86400000));
    cd.textContent = days === 0 ? "⏰ Last day of this month's contest!" : `⏰ ${days} day${days === 1 ? "" : "s"} left in this month's contest — votes close at month-end.`;
  }
  $("#contestCounts").innerHTML = "<p>" + Object.entries(d.sportCounts).map(([s, c]) => `${SPORT_COLORS[s] || "⭐"} ${cap(s)}: ${c}`).join(" · ") + (d.totalEntries ? "" : " — no entries yet") + "</p>";
  $("#contestList").innerHTML = d.entries.length ? d.entries.map((h, i) => `<div><div class="tag">#${i + 1}</div>${cardHtml(h, true)}</div>`).join("") : "<p>No entries this month yet. Enter an approved play from the Plays tab.</p>";
}
window.toggleVote = async (id) => { await api(`/api/highlights/${id}/vote`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ voterToken }) }); loadPlays(); loadContest(); };
window.enterContest = async (id) => { const r = await api("/api/contest/enter", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); alert(r.message); loadContest(); };
window.reportPlay = async (id) => { const reason = prompt("Why are you reporting this play? (optional)") || "Reported by a user"; const r = await api(`/api/highlights/${id}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) }); alert(r.message); };
window.markWinner = async (id) => { await api("/api/contest/winner", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ highlightId: id }) }); loadContest(); };

async function loadOwner() {
  if (!ownerToken()) { $("#ownerStatus").textContent = "Not claimed on this device yet."; $("#queue").innerHTML = ""; $("#reports").innerHTML = ""; return; }
  try {
    const q = await api("/api/owner/queue");
    $("#ownerStatus").textContent = "Owner access active on this device.";
    $("#queue").innerHTML = q.queue.map((h) => `<div class="play"><b>${esc(h.title)}</b> — ${h.sport} — status: <b>${h.status}</b> — ${h.voteCount} votes
      ${h.review ? `<p>🤖 Pre-review: <b>${esc(h.review.verdict)}</b>${h.review.flags && h.review.flags.length ? `<br>${h.review.flags.map((f) => "• " + esc(f)).join("<br>")}` : ""}<br><i>This is a first-pass check only — it does not approve the play. Watch it yourself before approving.</i></p>` : ""}
      <p><button onclick="setStatus(${h.id},'approved')">Approve</button> <button onclick="setStatus(${h.id},'hidden')">Hide</button> <button onclick="setStatus(${h.id},'pending')">Back to review</button> <button onclick="deletePlay(${h.id})">Delete</button></p></div>`).join("") || "<p>Queue is empty.</p>";
    const rep = await api("/api/owner/reports");
    $("#reports").innerHTML = rep.reports.map((r) => `<p>Play #${r.highlight_id}: ${esc(r.reason)} (${r.created_at})</p>`).join("") || "<p>No reports.</p>";
  } catch (e) { $("#ownerStatus").textContent = "Owner access was refused on this device: " + e.message; }
}
window.setStatus = async (id, status) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); loadOwner(); loadPlays(); loadContest(); };
window.deletePlay = async (id) => { if (!confirm("Delete this play permanently?")) return; await api(`/api/highlights/${id}`, { method: "DELETE" }); loadOwner(); loadPlays(); loadContest(); };

$("#ownerBtn").onclick = () => { $("#ownerPanel").classList.remove("hidden"); loadOwner(); document.getElementById("ownerPanel").scrollIntoView({ behavior: "smooth", block: "start" }); };
$("#saveTokenBtn").onclick = () => {
  const t = $("#tokenInp").value.trim();
  if (!t) return alert("Paste an owner token first.");
  localStorage.setItem("hh_owner_token", t); $("#tokenInp").value = "";
  alert("Owner token saved on this device."); loadOwner();
};
$("#claimBtn").onclick = async () => {
  try { const r = await api("/api/owner/claim", { method: "POST" }); localStorage.setItem("hh_owner_token", r.token); alert("Owner claimed on this device. This token is shown only once and is now saved in this browser."); loadOwner(); }
  catch (e) { alert(e.message); }
};
$("#uploadForm").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  $("#uploadMsg").textContent = "Uploading…";
  try {
    const r = await fetch("/api/highlights", { method: "POST", body: fd });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || "Upload failed");
    $("#uploadMsg").textContent = j.message; e.target.reset();
  } catch (err) { $("#uploadMsg").textContent = "Error: " + err.message; }
};
document.querySelectorAll(".tabs button[data-tab]").forEach((b) => b.onclick = () => {
  document.querySelectorAll(".tabs button[data-tab]").forEach((x) => x.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  b.classList.add("active"); document.getElementById(b.dataset.tab).classList.add("active");
  if (b.dataset.tab === "contest") loadContest();
});
document.querySelectorAll(".seg button").forEach((b) => b.onclick = () => { document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("active")); b.classList.add("active"); currentSort = b.dataset.sort; loadPlays(); });
const heroVideo = () => document.getElementById("heroVideo");
const heroSoundBtn = () => document.getElementById("heroSound");
window.toggleHeroSound = () => { const v = heroVideo(); if (!v) return; v.muted = !v.muted; if (!v.muted) v.play(); const b = heroSoundBtn(); if (b) b.innerHTML = v.muted ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="m16 9 5 6m0-6-5 6"/></svg>' : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 9a5 5 0 0 1 0 6"/><path d="M18 6a9 9 0 0 1 0 12"/></svg>'; b.setAttribute("aria-label", v.muted ? "Turn sound on" : "Mute video"); };
document.getElementById("heroSound")?.addEventListener("click", window.toggleHeroSound);
const heroPlayBtn = document.getElementById("heroPlay");
const syncHeroPlay = () => { const v = heroVideo(); if (heroPlayBtn) heroPlayBtn.innerHTML = v && !v.paused ? '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>' : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="m8 5 11 7-11 7V5Z"/></svg>'; if (heroPlayBtn) heroPlayBtn.setAttribute("aria-label", v && !v.paused ? "Pause video" : "Play video"); };
heroPlayBtn?.addEventListener("click", async () => { const v = heroVideo(); if (!v) return; if (v.paused) { try { await v.play(); } catch (e) { v.controls = true; } } else { v.pause(); } syncHeroPlay(); });
heroVideo()?.addEventListener("play", syncHeroPlay);
heroVideo()?.addEventListener("pause", syncHeroPlay);
syncHeroPlay();
function syncDivisionPills() {
  const bf = $("#boysFilter"), gf = $("#girlsFilter");
  if (bf) bf.classList.toggle("active", currentDivision === "boys");
  if (gf) gf.classList.toggle("active", currentDivision === "girls");
}
function showPlaysTab() {
  document.querySelectorAll(".tabs button[data-tab]").forEach((x) => x.classList.remove("active"));
  document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active"));
  document.querySelector('button[data-tab="plays"]')?.classList.add("active");
  document.getElementById("plays")?.classList.add("active");
}
window.chooseDivision = (d) => {
  // BUG FIX: picking a board must NOT touch the hero video's sound.
  // Sound is controlled only by the sound button (and the video controls).
  currentDivision = d;
  syncDivisionPills();
  showPlaysTab();
  loadPlays();
  document.querySelector(".filters")?.scrollIntoView({ behavior: "smooth" });
};
$("#searchInp").oninput = loadPlays;
$("#boysFilter").onclick = () => { currentDivision = "boys"; syncDivisionPills(); loadPlays(); };
$("#girlsFilter").onclick = () => { currentDivision = "girls"; syncDivisionPills(); loadPlays(); };
$("#teamFilter").onchange = (e) => { currentTeam = e.target.value; if (currentTeam !== "all") history.replaceState(null, "", `#team-${currentTeam}`); else history.replaceState(null, "", location.pathname); loadPlays(); };
syncDivisionPills();
// Team-board prototype link: #team-<slug> filters the board to that team.
const tm = location.hash.match(/^#team-(.+)$/);
if (tm) { currentTeam = tm[1]; }
renderSportPills();

// ---- Swag Store (parked preview only — cart is in this browser, no checkout) ----
const PRODUCTS = [
  { name: "The Hype Starts Here Tee", price: 32, desc: "Black tee. HYPE / THE HYPE STARTS HERE." },
  { name: "Hype Is Earned Tee", price: 32, desc: "Black tee. HYPE IS EARNED — crown on top." },
  { name: "Girls Line — Hype Starts Here Tee", price: 32, desc: "Girls line, Drop 001. Black tee. THE HYPE STARTS HERE." },
  { name: "Hype All Day Hoodie", price: 65, desc: "Navy hoodie. Hype all day." },
  { name: "HH Snapback", price: 35, desc: "Black snapback. HH HYPE." },
  { name: "Hype All Day Cap", price: 32, desc: "Coral cap. Hype all day." },
  { name: "Sticker 6-Pack", price: 12, desc: "HYPE / HIGHLIGHT HYPE / HYPE ALL DAY stickers." },
];
let cart = JSON.parse(localStorage.getItem("hh_cart") || "[]");
function renderSwag() {
  $("#swagGrid").innerHTML = PRODUCTS.map((p, i) => `<div class="play"><h3>${p.name}</h3><p>${p.desc}</p><p><b>$${p.price}.00</b></p>
    <label>Size <select id="size-${i}"><option>Youth S</option><option>Youth M</option><option>Youth L</option><option>Adult S</option><option>Adult M</option><option>Adult L</option><option>Adult XL</option></select></label>
    <button class="big" onclick="addToCart(${i})">Add to cart</button></div>`).join("");
  renderCart();
}
window.addToCart = (i) => {
  const size = document.getElementById(`size-${i}`).value;
  const found = cart.find((c) => c.i === i && c.size === size);
  if (found) found.qty++; else cart.push({ i, size, qty: 1 });
  localStorage.setItem("hh_cart", JSON.stringify(cart)); renderCart();
};
function renderCart() {
  const sub = cart.reduce((s, c) => s + PRODUCTS[c.i].price * c.qty, 0);
  const ship = sub === 0 ? 0 : (sub >= 50 ? 0 : 4.99);
  $("#cartCount").textContent = cart.reduce((s, c) => s + c.qty, 0);
  $("#cartItems").innerHTML = cart.length ? cart.map((c, idx) => `<p>${PRODUCTS[c.i].name} — ${c.size} × ${c.qty} — $${(PRODUCTS[c.i].price * c.qty).toFixed(2)} <button onclick="cartQty(${idx},1)">+</button> <button onclick="cartQty(${idx},-1)">−</button></p>`).join("") : "<p>Cart is empty.</p>";
  $("#cartSub").textContent = "$" + sub.toFixed(2);
  $("#cartShip").textContent = "$" + ship.toFixed(2);
  $("#cartTotal").textContent = "$" + (sub + ship).toFixed(2);
}
window.cartQty = (idx, d) => { cart[idx].qty += d; if (cart[idx].qty <= 0) cart.splice(idx, 1); localStorage.setItem("hh_cart", JSON.stringify(cart)); renderCart(); };
$("#cartBtn").onclick = () => { document.querySelectorAll(".tabs button[data-tab]").forEach((x) => x.classList.remove("active")); document.querySelectorAll(".tab").forEach((x) => x.classList.remove("active")); document.querySelector('button[data-tab="swag"]').classList.add("active"); document.getElementById("swag").classList.add("active"); };

loadPlays(); renderSwag();
if (location.hash === "#owner") { const p = document.getElementById("ownerPanel"); if (p) { p.classList.remove("hidden"); loadOwner(); p.scrollIntoView({ behavior: "smooth", block: "start" }); } }
