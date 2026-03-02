/**
 * Resell Scout — popup logic
 */

// ─── State ────────────────────────────────────────────────────────────────────

let items   = [];
let editId  = null;   // null = adding, otherwise the id being edited

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const enabledToggle = document.getElementById('enabledToggle');
const itemCountEl   = document.getElementById('itemCount');
const avgProfitEl   = document.getElementById('avgProfit');
const emptyStateEl  = document.getElementById('emptyState');
const itemListEl    = document.getElementById('itemList');
const clearAllBtn   = document.getElementById('clearAllBtn');
const formTitle     = document.getElementById('formTitle');
const itemForm      = document.getElementById('itemForm');
const cancelBtn     = document.getElementById('cancelBtn');
const submitBtn     = document.getElementById('submitBtn');
const profitPreview = document.getElementById('profitPreview');
const profitText    = document.getElementById('profitText');

const fName     = document.getElementById('fName');
const fKeywords = document.getElementById('fKeywords');
const fMinBuy   = document.getElementById('fMinBuy');
const fMaxBuy   = document.getElementById('fMaxBuy');
const fResell   = document.getElementById('fResell');

// ─── Storage helpers ──────────────────────────────────────────────────────────

function save(callback) {
  chrome.storage.sync.set({ items }, () => {
    notifyContentScript();
    if (callback) callback();
  });
}

function load(callback) {
  chrome.storage.sync.get({ items: [], enabled: true }, data => {
    items = data.items;
    enabledToggle.checked = data.enabled;
    callback();
  });
}

function notifyContentScript() {
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]?.id) {
      chrome.tabs.sendMessage(tabs[0].id, { type: 'RS_UPDATED' }).catch(() => {
        // Tab may not have the content script (e.g. non-Marketplace page) — ignore
      });
    }
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  // Stats
  itemCountEl.textContent = `${items.length} item${items.length !== 1 ? 's' : ''} tracked`;

  if (items.length > 0) {
    const avg = items.reduce((sum, it) => {
      const margin = ((it.resellPrice - it.maxBuyPrice) / it.maxBuyPrice) * 100;
      return sum + margin;
    }, 0) / items.length;
    avgProfitEl.textContent = `Avg max margin: ${avg > 0 ? '+' : ''}${avg.toFixed(0)}%`;
  } else {
    avgProfitEl.textContent = '—';
  }

  // List
  if (items.length === 0) {
    emptyStateEl.hidden = false;
    itemListEl.hidden   = true;
    clearAllBtn.style.display = 'none';
    return;
  }

  emptyStateEl.hidden = true;
  itemListEl.hidden   = false;
  clearAllBtn.style.display = '';

  itemListEl.innerHTML = '';
  items.forEach(item => {
    const profit    = item.resellPrice - item.maxBuyPrice;
    const margin    = ((profit / item.maxBuyPrice) * 100).toFixed(0);
    const buyRange  = item.minBuyPrice
      ? `$${item.minBuyPrice}–$${item.maxBuyPrice}`
      : `≤ $${item.maxBuyPrice}`;

    const li = document.createElement('li');
    li.className = 'item-card';
    li.dataset.id = item.id;
    li.innerHTML = `
      <div class="item-top">
        <div>
          <div class="item-name">${escHtml(item.name)}</div>
          <div class="item-keywords">Keywords: ${escHtml(item.keywords)}</div>
        </div>
        <div class="item-actions">
          <button class="edit-btn" data-id="${item.id}">Edit</button>
          <button class="del-btn"  data-id="${item.id}">✕</button>
        </div>
      </div>
      <div class="item-prices">
        <div class="price-chip chip-buy">
          <span class="chip-label">Buy range</span>
          <span class="chip-value">${buyRange}</span>
        </div>
        <div class="price-chip chip-resell">
          <span class="chip-label">Resell</span>
          <span class="chip-value">$${item.resellPrice}</span>
        </div>
        <div class="price-chip chip-profit">
          <span class="chip-label">Max margin</span>
          <span class="chip-value">${profit >= 0 ? '+' : ''}$${profit.toFixed(0)} (${margin}%)</span>
        </div>
      </div>
    `;
    itemListEl.appendChild(li);
  });
}

// ─── Form helpers ─────────────────────────────────────────────────────────────

function clearForm() {
  itemForm.reset();
  editId = null;
  formTitle.textContent = 'Add Item';
  submitBtn.textContent = 'Add Item';
  cancelBtn.hidden = true;
  profitPreview.hidden = true;
}

function fillFormFor(item) {
  editId = item.id;
  fName.value     = item.name;
  fKeywords.value = item.keywords;
  fMinBuy.value   = item.minBuyPrice || '';
  fMaxBuy.value   = item.maxBuyPrice;
  fResell.value   = item.resellPrice;
  formTitle.textContent = 'Edit Item';
  submitBtn.textContent = 'Save Changes';
  cancelBtn.hidden = false;
  updateProfitPreview();
}

function updateProfitPreview() {
  const max    = parseFloat(fMaxBuy.value);
  const resell = parseFloat(fResell.value);
  if (isNaN(max) || isNaN(resell) || max <= 0) {
    profitPreview.hidden = true;
    return;
  }
  const profit = resell - max;
  const pct    = ((profit / max) * 100).toFixed(0);
  profitText.textContent = profit >= 0
    ? `Potential profit: +$${profit.toFixed(2)} (+${pct}%)`
    : `Loss at max buy: −$${Math.abs(profit).toFixed(2)} (${pct}%)`;
  profitPreview.classList.toggle('loss', profit < 0);
  profitPreview.hidden = false;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Event listeners ──────────────────────────────────────────────────────────

enabledToggle.addEventListener('change', () => {
  chrome.storage.sync.set({ enabled: enabledToggle.checked }, notifyContentScript);
});

clearAllBtn.addEventListener('click', () => {
  if (!confirm('Remove all tracked items?')) return;
  items = [];
  save(render);
  clearForm();
});

// Delegated clicks on the item list
itemListEl.addEventListener('click', e => {
  const editBtn = e.target.closest('.edit-btn');
  const delBtn  = e.target.closest('.del-btn');

  if (editBtn) {
    const id   = editBtn.dataset.id;
    const item = items.find(it => it.id === id);
    if (item) fillFormFor(item);
    document.getElementById('formSection').scrollIntoView({ behavior: 'smooth' });
  }

  if (delBtn) {
    const id = delBtn.dataset.id;
    items = items.filter(it => it.id !== id);
    if (editId === id) clearForm();
    save(render);
  }
});

cancelBtn.addEventListener('click', clearForm);

// Live profit preview
[fMaxBuy, fResell].forEach(el => el.addEventListener('input', updateProfitPreview));

itemForm.addEventListener('submit', e => {
  e.preventDefault();

  const name       = fName.value.trim();
  const keywords   = fKeywords.value.trim();
  const minBuy     = parseFloat(fMinBuy.value) || 0;
  const maxBuy     = parseFloat(fMaxBuy.value);
  const resellPrice = parseFloat(fResell.value);

  if (!name || !keywords || isNaN(maxBuy) || isNaN(resellPrice)) return;

  if (editId) {
    const idx = items.findIndex(it => it.id === editId);
    if (idx !== -1) {
      items[idx] = { ...items[idx], name, keywords, minBuyPrice: minBuy, maxBuyPrice: maxBuy, resellPrice };
    }
  } else {
    items.push({ id: uid(), name, keywords, minBuyPrice: minBuy, maxBuyPrice: maxBuy, resellPrice });
  }

  save(render);
  clearForm();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

load(render);
