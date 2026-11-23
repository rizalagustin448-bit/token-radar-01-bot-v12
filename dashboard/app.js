// app.js — renders the radar board from window.BOARD (data.js, written by
// main.ts from the sealed snapshot). No network, no imports: everything the
// page shows comes from the data file beside it.

const B = window.BOARD;
const rows = B.rows;
const V = B.model.validation;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => n >= 1e9 ? '$' + (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.round(n);
const moneyFull = (n) => '$' + Math.round(n).toLocaleString('en-US');
const usd2 = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
const pct = (n) => (n == null ? '—' : (n > 0 ? '+' : '') + n.toFixed(1) + '%');

let sortKey = 'rank', sortDir = 1;

// ---------------------------------------------------------------- strip
(function renderStrip() {
  const v = V;
  $('strip-text').textContent =
    `Leave-one-out on ${v.loo_n} traded tokens: median error ${Math.exp(v.loo_median_abs_log_error).toFixed(1)}x, ` +
    `${Math.round(v.loo_within_3x * 100)}% within 3x. ` +
    `Walk-forward on the ${v.wf_n} latest listings: median predicted/actual ${v.wf_median_pred_actual.toFixed(2)}x, ` +
    `${Math.round(v.wf_within_3x * 100)}% within 3x. ` +
    `Global market-cap/TVL median ${v.global_ratio_median}. ` +
    `${v.excluded_wrapped} wrapped, bridged or exchange products are excluded from the ranking — they are not pre-token launches. ` +
    `Every value below is fitted from the snapshot — no protocol name is hardcoded.`;
  $('meta').textContent = `Snapshot ${B.as_of}\n${rows.length} rows · ${rows.filter((r) => r.is_watchlist).length} watchlist`;
})();

// ---------------------------------------------------------------- filters
const cats = [...new Set(rows.map((r) => r.category).filter(Boolean))].sort();
for (const c of cats) {
  const o = document.createElement('option');
  o.textContent = c;
  $('cat').appendChild(o);
}

function filtered() {
  const q = $('q').value.trim().toLowerCase();
  const cat = $('cat').value;
  const ver = $('verdict').value;
  const wl = $('wl').checked;
  return rows.filter((r) =>
    (!q || r.name.toLowerCase().includes(q) || r.slug.includes(q)) &&
    (!cat || r.category === cat) &&
    (!ver || r.verdict === ver) &&
    (!wl || r.is_watchlist));
}

function sorted(list) {
  const k = sortKey;
  return [...list].sort((a, b) => {
    const x = a[k], y = b[k];
    const d = (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    return d !== 0 ? d : a.rank - b.rank;
  });
}

// ---------------------------------------------------------------- board
function renderBoard() {
  const list = sorted(filtered());
  const maxV = rows[0].implied_value_usd;
  $('rows').innerHTML = list.map((r) => {
    const w = Math.max(2, Math.round((r.implied_value_usd / maxV) * 120));
    const ch = r.change_7d == null ? '—' : `<span class="${r.change_7d >= 0 ? 'up' : 'dn'}">${pct(r.change_7d)}</span>`;
    return `<tr data-slug="${esc(r.slug)}" class="${sel === r.slug ? 'sel' : ''}">
      <td class="num">${r.rank}</td>
      <td><span class="nm">${esc(r.name)}</span> <span class="sl">${esc(r.slug)}</span><br>
        <span class="cat">${esc(r.category || '—')} · ${esc(r.chains[0] || '')}</span> ${r.is_watchlist ? '<span class="wl">★ watchlist</span>' : ''}</td>
      <td class="num">${money(r.tvl_usd)}</td>
      <td class="num">${ch}</td>
      <td class="num"><span class="bar" style="width:${w}px"></span>${money(r.implied_value_usd)}</td>
      <td class="num">${(r.odds * 100).toFixed(0)}%</td>
      <td class="num">${usd2(r.per_hour_usd)}</td>
      <td class="num">${usd2(r.net_usd)}</td>
      <td><span class="pill ${r.verdict}">${r.verdict}</span></td>
    </tr>`;
  }).join('');
  $('count').textContent = `Showing ${list.length} of ${rows.length} rows`;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.addEventListener('click', () => renderDetail(tr.dataset.slug, true)));
}

// ---------------------------------------------------------------- detail
let sel = null;

function compChart(r) {
  const dist = (B.model.comps_by_category || {})[r.category || '(none)'] || [];
  if (!dist.length) return '<p class="note">No traded comp in this category — the fitted ratio is the shrunk global median.</p>';
  const lo = Math.min(...dist, Math.log(r.fitted_ratio)) - 0.3, hi = Math.max(...dist, Math.log(r.fitted_ratio)) + 0.3;
  const X = (v) => 10 + ((v - lo) / (hi - lo)) * 560;
  const dots = dist.map((v) => `<circle cx="${X(v).toFixed(1)}" cy="26" r="5" fill="#93a5bd"/>`).join('');
  const gmed = Math.log(V.global_ratio_median);
  return `<svg class="chart" width="580" height="52" viewBox="0 0 580 52" role="img" aria-label="Category comps chart">
    <line x1="10" y1="26" x2="570" y2="26" stroke="#243449" stroke-width="2"/>
    ${dots}
    <line x1="${X(gmed).toFixed(1)}" y1="8" x2="${X(gmed).toFixed(1)}" y2="44" stroke="#93a5bd" stroke-width="1.5" stroke-dasharray="4 3"/>
    <line x1="${X(Math.log(r.fitted_ratio)).toFixed(1)}" y1="8" x2="${X(Math.log(r.fitted_ratio)).toFixed(1)}" y2="44" stroke="#f2b13c" stroke-width="3"/>
  </svg>
  <p class="note">Grey dots: each traded comp in ${esc(r.category || '—')} (log market-cap/TVL). Dashed: global median ${V.global_ratio_median}. Gold: this protocol's fitted ratio ${r.fitted_ratio} (n=${dist.length} comps, shrunk k=5).</p>`;
}

function renderDetail(slug, scroll) {
  const r = rows.find((x) => x.slug === slug);
  if (!r) return;
  sel = slug;
  const steps = r.farm_steps.map((s, i) => `<li>${esc(s)}</li>`).join('');
  $('detail').hidden = false;
  $('detail').innerHTML = `
    <h2>${esc(r.name)} <span class="sl" style="color:var(--mut);font-family:var(--mono);font-size:13px">${esc(r.slug)}</span></h2>
    <p class="note">${esc(r.category || '—')} · ${esc(r.chains.join(', '))} · TVL ${moneyFull(r.tvl_usd)} · 7d ${pct(r.change_7d)} · first tracked ${esc(r.listed_at || '—')} · ${r.is_watchlist ? 'on the watchlist' : 'below the watchlist floor'} — records no token.</p>
    <div class="facts">
      <div class="fact"><b>${money(r.implied_value_usd)}</b><span>implied value (rank ${r.rank})</span></div>
      <div class="fact"><b>${(r.odds * 100).toFixed(1)}%</b><span>token odds: base ${r.odds_base} × age ${r.odds_age} × growth ${r.odds_growth}</span></div>
      <div class="fact"><b>${money(r.fitted_mcap_usd)}</b><span>fitted market cap at ratio ${r.fitted_ratio} (${r.category_comps} category comps)</span></div>
      <div class="fact"><b><span class="pill ${r.verdict}">${r.verdict}</span> ${usd2(r.per_hour_usd)}/h</b><span>net ${usd2(r.net_usd)} on $${r.farm_cost_usd} cost, ${r.farm_hours}h</span></div>
    </div>
    <h3>How the value was fitted</h3>
    ${compChart(r)}
    <h3>Farm plan — costed, step by step</h3>
    <ol>${steps}</ol>
    <p class="note">Total: $${r.farm_cost_usd} in gas and bridges, ${r.farm_hours} hours. Expected value ${moneyFull(r.expected_value_usd)} = implied value × 0.001% share. Net ${usd2(r.net_usd)} after cost and time at $15/hour.</p>`;
  document.querySelectorAll('#rows tr').forEach((tr) => tr.classList.toggle('sel', tr.dataset.slug === slug));
  if (scroll) $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- wiring
document.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
  const k = th.dataset.sort;
  if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = k === 'name' ? 1 : -1; }
  renderBoard();
}));
['q', 'cat', 'verdict', 'wl'].forEach((id) => $(id).addEventListener('input', renderBoard));

(function initFromQuery() {
  const p = new URLSearchParams(location.search);
  if (p.get('category')) $('cat').value = p.get('category');
  if (p.get('verdict')) $('verdict').value = p.get('verdict');
  if (p.get('watchlist') === '1') $('wl').checked = true;
  renderBoard();
  const slug = p.get('slug');
  if (slug) renderDetail(slug, false);
  else if (p.get('view') === 'detail') renderDetail(rows[0].slug, false);
})();
