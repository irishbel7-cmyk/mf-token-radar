// Token Launch Radar dashboard: renders the board written by main.ts.
// Data arrives as window.RADAR from the data.js script beside this page.
// No network, no framework. Supports deep links: #detail=<slug>,
// #cat=<category>, #watch=1, #q=<text>.
(function () {
  var data = window.RADAR || { rows: [], live: [], as_of: "", median_multiple: 0, board_size: 0, watchlist_covered: 0, source: "" };
  var rows = data.rows || [];
  var sortKey = "implied_value_usd";
  var sortDir = -1;

  function fmtMoney(n) {
    if (n === null || n === undefined) return "—";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + Math.round(n);
  }
  function fmtPct(v) {
    if (v === null || v === undefined) return "—";
    return (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  }
  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  var asOfEl = document.getElementById("asOf");
  asOfEl.textContent = data.as_of || "—";
  document.getElementById("headline").innerHTML =
    '<div class="stat"><b>' + rows.length + '</b><span>Protocols ranked</span></div>' +
    '<div class="stat"><b>' + (data.watchlist_covered || 0) + '/40</b><span>Watchlist covered</span></div>' +
    '<div class="stat"><b>' + (data.median_multiple ? data.median_multiple.toFixed(3) : "—") + '</b><span>Median multiple</span></div>';
  document.getElementById("footMeta").textContent =
    "Snapshot as of " + (data.as_of || "—") + ". " + (data.source || "") +
    " Board size " + rows.length + " rows. Median multiple " +
    (data.median_multiple ? data.median_multiple.toFixed(4) : "—") + ".";

  // Populate the filter dropdowns from the data.
  var cats = [];
  var chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  cats.sort();
  chains.sort();
  var catSel = document.getElementById("cat");
  cats.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });
  var chainSel = document.getElementById("chain");
  chains.forEach(function (c) {
    var o = document.createElement("option");
    o.value = c; o.textContent = c;
    chainSel.appendChild(o);
  });

  function filtered() {
    var q = document.getElementById("q").value.trim().toLowerCase();
    var cat = catSel.value;
    var chain = chainSel.value;
    var minTvl = parseFloat(document.getElementById("minTvl").value) || 0;
    var watchOnly = document.getElementById("watchOnly").checked;
    return rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && (r.chains || []).indexOf(chain) === -1) return false;
      if (r.tvl_usd < minTvl) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
  }

  function sorted(list) {
    var copy = list.slice();
    copy.sort(function (a, b) {
      var av = a[sortKey];
      var bv = b[sortKey];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (typeof av === "string") return sortDir * av.localeCompare(bv);
      if (Array.isArray(av)) return sortDir * (av.length - bv.length);
      return sortDir * (av - bv);
    });
    return copy;
  }

  function renderBoard() {
    var list = sorted(filtered());
    document.getElementById("count").textContent = list.length + " of " + rows.length + " shown";
    var html = "";
    list.forEach(function (r) {
      var chg = r.change_7d === null ? "—" : fmtPct(r.change_7d);
      var chgCls = r.change_7d === null ? "" : (r.change_7d >= 0 ? "up" : "down");
      html += '<tr data-slug="' + esc(r.slug) + '"><td class="num">#' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong>' +
        (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || "—") + '</td>' +
        '<td>' + esc((r.chains || []).join(", ")) + '</td>' +
        '<td class="tvl">' + fmtMoney(r.tvl_usd) + '</td>' +
        '<td class="num ' + chgCls + '">' + chg + '</td>' +
        '<td class="num">' + (r.age_days === null ? "—" : r.age_days + "d") + '</td>' +
        '<td class="value">' + fmtMoney(r.implied_value_usd) + '</td></tr>';
    });
    document.getElementById("rows").innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    document.getElementById("boardView").hidden = true;
    document.getElementById("detailView").hidden = false;
    var steps = (r.farm_steps || []).map(function (s, i) {
      return "<li>" + esc(s) + "</li>";
    }).join("");
    document.getElementById("detail").innerHTML =
      '<article class="detail-card"><h2>' + esc(r.name) + '</h2>' +
      '<p class="meta">Rank #' + r.rank + ' · ' + esc(r.slug) + ' · ' + esc(r.category || "No category recorded") +
      ' · Chains: ' + esc((r.chains || []).join(", ")) +
      (r.watchlist ? ' · <span class="badge">WATCHLIST</span>' : '') + '</p>' +
      '<div class="breakdown">' +
      '<div class="factor"><b>' + fmtMoney(r.tvl_usd) + '</b><span>TVL</span></div>' +
      '<div class="factor"><b>' + fmtMoney(r.base_value_usd) + '</b><span>Base: TVL × ' + (data.median_multiple ? data.median_multiple.toFixed(3) : "—") + '</span></div>' +
      '<div class="factor"><b>× ' + r.growth_factor.toFixed(2) + '</b><span>Growth (7d ' + fmtPct(r.change_7d) + ')</span></div>' +
      '<div class="factor"><b>× ' + r.maturity_factor.toFixed(2) + '</b><span>Maturity (' + (r.age_days === null ? "age unknown" : r.age_days + " days listed") + ')</span></div>' +
      '<div class="factor"><b>× ' + r.breadth_factor.toFixed(2) + '</b><span>Breadth (' + (r.chains || []).length + ' chains)</span></div>' +
      '<div class="factor final"><b>' + fmtMoney(r.implied_value_usd) + '</b><span>Implied value</span></div>' +
      '</div>' +
      '<h3>How to farm it</h3><ol>' + steps + '</ol></article>';
    window.scrollTo(0, 0);
  }

  function showBoard() {
    document.getElementById("detailView").hidden = true;
    document.getElementById("boardView").hidden = false;
    if (location.hash.indexOf("#detail=") === 0) history.replaceState(null, "", location.pathname);
  }

  document.getElementById("rows").addEventListener("click", function (e) {
    var tr = e.target.closest("tr[data-slug]");
    if (tr) showDetail(tr.getAttribute("data-slug"));
  });
  document.getElementById("backBtn").addEventListener("click", showBoard);
  ["q", "cat", "chain", "minTvl", "watchOnly"].forEach(function (id) {
    document.getElementById(id).addEventListener("input", renderBoard);
    document.getElementById(id).addEventListener("change", renderBoard);
  });
  document.querySelectorAll("#board thead th").forEach(function (th) {
    th.addEventListener("click", function () {
      var key = th.getAttribute("data-sort");
      if (sortKey === key) sortDir = -sortDir;
      else { sortKey = key; sortDir = key === "name" || key === "category" ? 1 : -1; }
      renderBoard();
    });
  });

  // Already-trading reference list, top 30 by market cap.
  var live = (data.live || []).slice(0, 30);
  document.getElementById("liveRows").innerHTML = live.map(function (p) {
    return "<tr><td><strong>" + esc(p.name) + "</strong></td><td>" + fmtMoney(p.tvl_usd) +
      "</td><td>" + fmtMoney(p.mcap_usd) + "</td></tr>";
  }).join("");

  // Deep links for screenshots and sharing.
  var hash = location.hash || "";
  var m;
  if ((m = hash.match(/#detail=([^&]+)/))) {
    renderBoard();
    showDetail(decodeURIComponent(m[1]));
  } else {
    if ((m = hash.match(/#cat=([^&]+)/))) catSel.value = decodeURIComponent(m[1]);
    if (hash.indexOf("#watch=1") !== -1) document.getElementById("watchOnly").checked = true;
    if ((m = hash.match(/#q=([^&]+)/))) document.getElementById("q").value = decodeURIComponent(m[1]);
    renderBoard();
  }
})();
