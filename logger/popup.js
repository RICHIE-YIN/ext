/**
 * Market Logger — popup logic
 */

// ─── State ────────────────────────────────────────────────────────────────────

let log      = {};   // { [itemId]: entry }
let sortKey  = 'firstSeen';
let sortAsc  = false;
let query    = '';

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const loggingToggle = document.getElementById('loggingToggle');
const totalCountEl  = document.getElementById('totalCount');
const storageUsedEl = document.getElementById('storageUsed');
const searchBox     = document.getElementById('searchBox');
const exportBtn     = document.getElementById('exportBtn');
const clearBtn      = document.getElementById('clearBtn');
const emptyStateEl  = document.getElementById('emptyState');
const tableWrap     = document.getElementById('tableWrap');
const logBody       = document.getElementById('logBody');
const rowCountEl    = document.getElementById('rowCount');

// ─── Storage ──────────────────────────────────────────────────────────────────

function loadAll(cb) {
  chrome.storage.local.get({ log: {}, logging_enabled: true }, data => {
    log = data.log;
    loggingToggle.checked = data.logging_enabled;
    cb();
  });
}

function deleteEntry(id) {
  delete log[id];
  chrome.storage.local.set({ log }, render);
}

function clearAll() {
  log = {};
  chrome.storage.local.set({ log }, render);
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  const entries = Object.values(log);
  totalCountEl.textContent = `${entries.length} listing${entries.length !== 1 ? 's' : ''} logged`;

  // Rough storage estimate
  const bytes = JSON.stringify(log).length;
  storageUsedEl.textContent = bytes < 1024
    ? `${bytes} B used`
    : bytes < 1048576
      ? `${(bytes / 1024).toFixed(1)} KB used`
      : `${(bytes / 1048576).toFixed(2)} MB used`;

  if (!entries.length) {
    emptyStateEl.hidden = false;
    tableWrap.hidden    = true;
    return;
  }

  emptyStateEl.hidden = true;
  tableWrap.hidden    = false;

  // Filter
  const filtered = query
    ? entries.filter(e => e.title.toLowerCase().includes(query))
    : entries;

  // Sort
  filtered.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return sortAsc ? -1 : 1;
    if (va > vb) return sortAsc ?  1 : -1;
    return 0;
  });

  // Update sort arrows
  document.querySelectorAll('th[data-sort]').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === sortKey) {
      arrow.textContent = sortAsc ? '▲' : '▼';
    } else {
      arrow.textContent = '';
    }
  });

  // Cap render at 500 rows to keep popup snappy
  const MAX = 500;
  const shown = filtered.slice(0, MAX);

  logBody.innerHTML = '';
  for (const entry of shown) {
    const priceChanged = entry.priceHistory && entry.priceHistory.length > 0;
    const dateStr = formatDate(entry.firstSeen);
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="col-title">
        <div class="cell-title" title="${escHtml(entry.title)}">
          <a href="${escHtml(entry.url)}" target="_blank" rel="noopener">${escHtml(entry.title)}</a>
        </div>
      </td>
      <td class="col-price">
        <span class="cell-price ${priceChanged ? 'price-changed' : ''}">$${entry.price.toLocaleString()}</span>
      </td>
      <td class="col-seen"><span class="cell-seen">${entry.seenCount}</span></td>
      <td class="col-date"><span class="cell-date">${dateStr}</span></td>
      <td class="col-action">
        <button class="del-btn" data-id="${entry.id}" title="Remove this entry">✕</button>
      </td>
    `;
    logBody.appendChild(tr);
  }

  rowCountEl.textContent = filtered.length > MAX
    ? `Showing ${MAX} of ${filtered.length} matches`
    : `${filtered.length} result${filtered.length !== 1 ? 's' : ''}`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' });
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── CSV export ───────────────────────────────────────────────────────────────

function exportCSV() {
  const entries = Object.values(log);
  if (!entries.length) return;

  const headers = ['Title', 'Price', 'URL', 'First Seen', 'Last Seen', 'Times Seen', 'Price Changed'];

  const rows = entries.map(e => [
    csvCell(e.title),
    e.price,
    e.url,
    e.firstSeen  ? new Date(e.firstSeen).toLocaleString()  : '',
    e.lastSeen   ? new Date(e.lastSeen).toLocaleString()   : '',
    e.seenCount  || 1,
    e.priceHistory && e.priceHistory.length ? 'Yes' : 'No'
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);

  const a  = document.createElement('a');
  a.href   = url;
  a.download = `market-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(val) {
  const s = String(val).replace(/"/g, '""');
  return /[",\n]/.test(s) ? `"${s}"` : s;
}

// ─── Event listeners ──────────────────────────────────────────────────────────

loggingToggle.addEventListener('change', () => {
  chrome.storage.local.set({ logging_enabled: loggingToggle.checked });
});

searchBox.addEventListener('input', () => {
  query = searchBox.value.trim().toLowerCase();
  render();
});

exportBtn.addEventListener('click', exportCSV);

clearBtn.addEventListener('click', () => {
  if (!confirm(`Delete all ${Object.keys(log).length} logged listings?`)) return;
  clearAll();
});

// Column sort
document.querySelector('thead').addEventListener('click', e => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const key = th.dataset.sort;
  if (key === sortKey) {
    sortAsc = !sortAsc;
  } else {
    sortKey = key;
    sortAsc = key === 'title';   // titles sort A→Z by default, numbers Z→A
  }
  render();
});

// Delegated delete
logBody.addEventListener('click', e => {
  const btn = e.target.closest('.del-btn');
  if (btn) deleteEntry(btn.dataset.id);
});

// ─── Init ─────────────────────────────────────────────────────────────────────

loadAll(render);

// Refresh when popup is focused (user may have browsed in meantime)
window.addEventListener('focus', () => loadAll(render));
