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
const SPORT_COLORS = { baseball: "⚾", basketball: "🏀", soccer: "⚽", football: "🏈", softball: "🥎", hockey: "🏒", lacrosse: "🥍", other: "⭐" };

function mediaHtml(h) {
  if (h.media_kind === "file") {
    if ((h.mime || "").startsWith("image/")) return `<img src="${h.media_url}" alt="">`;
    return `<div style="position:relative"><video src="${h.media_url}" controls playsinline muted loop autoplay preload="auto" onclick="tapVideo(this)"></video><button class="tap-sound" onclick="tapVideo(this.previousElementSibling)">🔊 Tap for sound</button><p class="small"><a href="${h.media_url}" target="_blank" rel="noopener">Open video ↗</a> · If the picture stays black, this is likely an iPhone .MOV (HEVC) clip — re-upload as MP4 for playback everywhere.</p></div>`;
  }
  if (h.media_kind === "link_embed") return `<iframe src="${h.embed_url}" allowfullscreen></iframe>`;
  if (h.media_kind === "link_video") return `<video src="${h.media_url}" controls playsinline muted loop autoplay preload="auto" onclick="tapVideo(this)"></video>`;
  return `<p><a class="big" href="${h.media_url}" target="_blank" rel="noopener">▶ Watch on ${h.host_label || "link"} ↗</a></p>`;
}
window.tapVideo = (v) => { if (!v) return; if (v.muted) { v.muted = false; v.currentTime = 0; v.play(); } else if (v.paused) { v.play(); } else { v.pause(); } };
function cardHtml(h, inContest = false) {
  return `<article class="play sport-${esc(h.sport || "other")}">
    ${h.isWinner ? "<div class='tag'>🏆 HYPE OF THE MONTH WINNER</div>" : ""}
    ${mediaHtml(h)}
    <h3>${esc(h.title)}</h3>
    <div><span class="tag">${SPORT_COLORS[h.sport] || "⭐"} ${esc(h.sport)}</span>${h.play_type ? `<span class="tag">${esc(h.play_type)}</span>` : ""}${h.player_name ? `<span class="tag">${esc(h.player_name)}</span>` : ""}</div>
    ${h.story ? `<p>${esc(h.story)}</p>` : ""}
    <p><button class="vote ${h.hasVoted ? "on" : ""}" onclick="toggleVote(${h.id})">${h.hasVoted ? "♥" : "♡"} ${h.voteCount} vote${h.voteCount === 1 ? "" : "s"}</button>
    <button onclick="enterContest(${h.id})">Enter Hype of the Month</button>
    <button onclick="reportPlay(${h.id})">Report</button></p>
    ${ownerToken() && inContest ? `<button onclick="markWinner(${h.id})">Mark as winner (owner)</button>` : ""}
  </article>`;
}
function esc(s) { return String(s || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

async function loadPlays() {
  const sport = $("#sportFilter").value, sort = $("#sortSel").value, search = $("#searchInp").value;
  const d = await api(`/api/highlights?sport=${sport}&sort=${sort}&search=${encodeURIComponent(search)}&voterToken=${voterToken}`);
  const top = d.highlights.slice(0, 3);
  $("#podium").innerHTML = top.length ? top.map((h, i) => `<div class="play ${i === 0 ? "first" : ""}"><div>${["🥈", "🥇", "🥉"][i] || ""} #${i + 1}</div>${cardHtml(h)}</div>`).join("") : "<p>No approved plays yet. Be the first — post a play above (it will be in review first).</p>";
  $("#playsGrid").innerHTML = d.highlights.length ? d.highlights.map((h) => cardHtml(h)).join("") : "<p>No plays match yet.</p>";
}
async function loadContest() {
  const d = await api(`/api/contest?voterToken=${voterToken}`);
  $("#contestPeriod").textContent = d.period;
  $("#contestCounts").innerHTML = "<p>" + Object.entries(d.sportCounts).map(([s, c]) => `${SPORT_COLORS[s] || "⭐"} ${s}: ${c}`).join(" · ") + (d.totalEntries ? "" : " — no entries yet") + "</p>";
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
      <p><button onclick="setStatus(${h.id},'approved')">Approve</button> <button onclick="setStatus(${h.id},'hidden')">Hide</button> <button onclick="setStatus(${h.id},'pending')">Back to review</button> <button onclick="deletePlay(${h.id})">Delete</button></p></div>`).join("") || "<p>Queue is empty.</p>";
    const rep = await api("/api/owner/reports");
    $("#reports").innerHTML = rep.reports.map((r) => `<p>Play #${r.highlight_id}: ${esc(r.reason)} (${r.created_at})</p>`).join("") || "<p>No reports.</p>";
  } catch (e) { $("#ownerStatus").textContent = "Owner access was refused on this device: " + e.message; }
}
window.setStatus = async (id, status) => { await api(`/api/highlights/${id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); loadOwner(); loadPlays(); loadContest(); };
window.deletePlay = async (id) => { if (!confirm("Delete this play permanently?")) return; await api(`/api/highlights/${id}`, { method: "DELETE" }); loadOwner(); loadPlays(); loadContest(); };

$("#ownerBtn").onclick = () => { $("#ownerPanel").classList.toggle("hidden"); loadOwner(); };
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
$("#sportFilter").onchange = loadPlays; $("#sortSel").onchange = loadPlays; $("#searchInp").oninput = loadPlays;

// ---- Swag Store (parked preview only — cart is in this browser, no checkout) ----
const PRODUCTS = [
  { name: "The Hype Starts Here Tee", price: 32, desc: "Black tee. HYPE / THE HYPE STARTS HERE." },
  { name: "Don't Believe The Hype Tee", price: 32, desc: "White tee. Don't believe the hype." },
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
