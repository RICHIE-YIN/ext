/**
 * Resell Scout — content script
 * Runs on Facebook Marketplace pages, finds listing cards, and overlays
 * a green (good deal) or red (overpriced) badge based on your resell sheet.
 */

const BADGE_CLASS     = 'rs-badge';
const PROCESSED_ATTR  = 'data-rs-processed';
const ENABLED_KEY     = 'rs_enabled';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parsePrice(text) {
  const m = text.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

function loadItems() {
  return new Promise(resolve =>
    chrome.storage.local.get({ items: [], enabled: true }, d =>
      resolve({ items: d.items, enabled: d.enabled })
    )
  );
}

/**
 * Returns the item with the longest keyword found in the listing title, or null.
 * Longest wins so "ps5 pro" beats "ps5" when both items are in the sheet.
 */
function matchItem(title, items) {
  const lower = title.toLowerCase();
  let best = null;
  let bestLen = 0;
  const split = s => (s || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
  for (const item of items) {
    if (split(item.excludeKeywords).some(ex => lower.includes(ex))) continue;
    for (const kw of split(item.keywords)) {
      if (kw.length > bestLen && lower.includes(kw)) {
        best = item;
        bestLen = kw.length;
      }
    }
  }
  return best;
}

function money(n) {
  return `$${Math.round(n).toLocaleString()}`;
}

// ─── Badge creation ──────────────────────────────────────────────────────────

function makeBadge(item, price, title) {
  const good       = price <= item.maxBuyPrice;
  const profit     = item.resellPrice - price;
  const profitPct  = Math.round((profit / price) * 100);

  const badge = document.createElement('div');
  badge.className = BADGE_CLASS;
  badge.dataset.rsGood = good ? '1' : '0';

  if (good) {
    const label = profitPct > 0 ? `+${profitPct}% profit` : 'Deal';
    badge.innerHTML = `<span class="rs-icon">✓</span><span>${label}</span>`;
  } else {
    badge.innerHTML = `<span class="rs-icon">✗</span><span>${money(price - item.maxBuyPrice)} over max</span>`;
  }

  badge.addEventListener('mouseenter', () => showTooltip(badge, item, price, title));
  badge.addEventListener('mouseleave', hideTooltip);

  return badge;
}

// ─── Hover tooltip ───────────────────────────────────────────────────────────
// A single fixed-position tooltip on <body>, so card overflow can't clip it.

let tooltip = null;

function showTooltip(badge, item, price, title) {
  hideTooltip();

  const profit = item.resellPrice - price;
  const hasRange = item.lowPrice && item.highPrice;

  tooltip = document.createElement('div');
  tooltip.className = 'rs-tooltip';

  const rows = [
    ['Listed at', money(price)],
    ['Resell avg', money(item.resellPrice)],
    ...(hasRange ? [['Resell range', `${money(item.lowPrice)} – ${money(item.highPrice)}`]] : []),
    ['Max buy', money(item.maxBuyPrice)],
    ['Est. profit', `${profit >= 0 ? '+' : '−'}${money(Math.abs(profit))}`],
    ...(item.confidence ? [['Price data', `${item.confidence} confidence`]] : []),
  ];

  const name = document.createElement('div');
  name.className = 'rs-tip-name';
  name.textContent = item.name;

  const listing = document.createElement('div');
  listing.className = 'rs-tip-listing';
  listing.textContent = title.split('\n')[0];

  const table = document.createElement('div');
  table.className = 'rs-tip-rows';
  for (const [label, value] of rows) {
    const l = document.createElement('span');
    l.textContent = label;
    const v = document.createElement('strong');
    v.textContent = value;
    if (label === 'Est. profit') v.className = profit >= 0 ? 'rs-pos' : 'rs-neg';
    table.append(l, v);
  }

  tooltip.append(name, listing, table);
  document.body.appendChild(tooltip);

  // Position below the badge, clamped to the viewport
  const r = badge.getBoundingClientRect();
  const t = tooltip.getBoundingClientRect();
  const left = Math.min(r.left, window.innerWidth - t.width - 8);
  const top  = r.bottom + t.height + 6 > window.innerHeight
    ? r.top - t.height - 6
    : r.bottom + 6;
  tooltip.style.left = `${Math.max(8, left)}px`;
  tooltip.style.top  = `${Math.max(8, top)}px`;
}

function hideTooltip() {
  if (tooltip) tooltip.remove();
  tooltip = null;
}

window.addEventListener('scroll', hideTooltip, { passive: true });

// ─── Core processing ─────────────────────────────────────────────────────────

async function processListings() {
  const { items, enabled } = await loadItems();

  // Remove all badges when disabled
  if (!enabled) {
    document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
    document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el =>
      el.removeAttribute(PROCESSED_ATTR)
    );
    return;
  }

  if (!items.length) return;

  /**
   * Facebook Marketplace renders listing cards as <a> elements whose href
   * contains "/marketplace/item/". We use this stable URL pattern to find
   * cards regardless of the ever-changing class names.
   */
  const links = document.querySelectorAll(
    `a[href*="/marketplace/item/"]:not([${PROCESSED_ATTR}])`
  );

  for (const link of links) {
    link.setAttribute(PROCESSED_ATTR, '1');

    const rawText = link.innerText || link.textContent || '';
    const price   = parsePrice(rawText);
    if (price === null) continue;

    // Strip the price tokens to get a cleaner title string
    const title = rawText.replace(/\$[\d,]+(?:\.\d{1,2})?/g, '').trim();
    if (!title) continue;

    const matched = matchItem(title, items);
    if (!matched) continue;

    // Walk up to find a suitable card container (something with position context)
    const card = findCard(link);
    if (!card) continue;

    // Ensure the container can host an absolutely-positioned badge
    const pos = getComputedStyle(card).position;
    if (pos === 'static') card.style.position = 'relative';

    // Remove stale badge if item re-rendered
    card.querySelectorAll(`.${BADGE_CLASS}`).forEach(b => b.remove());

    card.appendChild(makeBadge(matched, price, title));
  }
}

/**
 * Walk up from the link until we find a container that looks like a card
 * (has an image sibling, or is reasonably sized, etc.).
 * Fallback: the link's direct parent.
 */
function findCard(link) {
  let el = link.parentElement;
  for (let i = 0; i < 5 && el; i++) {
    if (el.querySelector('img')) return el;
    el = el.parentElement;
  }
  return link.parentElement;
}

// ─── Reset + reprocess ───────────────────────────────────────────────────────

function resetAndProcess() {
  hideTooltip();
  document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach(el =>
    el.removeAttribute(PROCESSED_ATTR)
  );
  document.querySelectorAll(`.${BADGE_CLASS}`).forEach(el => el.remove());
  processListings();
}

// ─── Observe DOM mutations (Facebook loads content dynamically) ───────────────

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const debouncedProcess = debounce(processListings, 600);

const observer = new MutationObserver(debouncedProcess);
observer.observe(document.body, { childList: true, subtree: true });

// ─── Messages from popup ──────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'RS_UPDATED') resetAndProcess();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

processListings();
