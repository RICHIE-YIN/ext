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
 * Returns the first item whose keywords match the listing title, or null.
 */
function matchItem(title, items) {
  const lower = title.toLowerCase();
  for (const item of items) {
    const kws = item.keywords
      .toLowerCase()
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
    if (kws.some(kw => lower.includes(kw))) return item;
  }
  return null;
}

// ─── Badge creation ──────────────────────────────────────────────────────────

function makeBadge(item, price) {
  const good       = price <= item.maxBuyPrice;
  const profit     = item.resellPrice - price;
  const profitPct  = Math.round((profit / price) * 100);
  const overPct    = Math.round(((price - item.maxBuyPrice) / item.maxBuyPrice) * 100);

  const badge = document.createElement('div');
  badge.className = BADGE_CLASS;
  badge.dataset.rsGood = good ? '1' : '0';

  if (good) {
    const label = profitPct > 0 ? `+${profitPct}% profit` : 'Deal';
    badge.innerHTML = `<span class="rs-icon">✓</span><span>${label}</span>`;
    badge.title = `Buy for $${price} → Sell for $${item.resellPrice} (profit $${profit.toFixed(2)})`;
  } else {
    badge.innerHTML = `<span class="rs-icon">✗</span><span>$${(price - item.maxBuyPrice).toFixed(0)} over max</span>`;
    badge.title = `Max buy price is $${item.maxBuyPrice}. Listed at $${price} (+${overPct}%)`;
  }

  return badge;
}

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

    card.appendChild(makeBadge(matched, price));
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
