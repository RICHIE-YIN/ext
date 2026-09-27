/**
 * Market Logger — content script
 * Auto-logs every listing card on Facebook Marketplace into chrome.storage.local.
 * Keyed by item ID so duplicates update rather than re-insert.
 */

const PROCESSED_ATTR = 'data-ml-processed';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parsePrice(text) {
  const m = text.match(/\$([\d,]+(?:\.\d{1,2})?)/);
  return m ? parseFloat(m[1].replace(/,/g, '')) : null;
}

function itemIdFromHref(href) {
  const m = (href || '').match(/\/marketplace\/item\/(\d+)/);
  return m ? m[1] : null;
}

function load(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function store(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

// ─── Core logging ─────────────────────────────────────────────────────────────

async function logVisibleListings() {
  const { logging_enabled = true } = await load({ logging_enabled: true });
  if (!logging_enabled) return;

  const links = document.querySelectorAll(
    `a[href*="/marketplace/item/"]:not([${PROCESSED_ATTR}])`
  );
  if (!links.length) return;

  const { log = {} } = await load({ log: {} });
  const now = new Date().toISOString();
  let dirty = false;

  for (const link of links) {
    link.setAttribute(PROCESSED_ATTR, '1');

    const href   = link.href || link.getAttribute('href') || '';
    const itemId = itemIdFromHref(href);
    if (!itemId) continue;

    const text  = link.innerText || link.textContent || '';
    const price = parsePrice(text);
    if (price === null) continue;

    // Strip price tokens to get a cleaner title
    const title = text.replace(/\$[\d,]+(?:\.\d{1,2})?/g, '').trim();
    if (!title) continue;

    const url = `https://www.facebook.com/marketplace/item/${itemId}/`;

    if (log[itemId]) {
      const entry = log[itemId];
      entry.lastSeen  = now;
      entry.seenCount = (entry.seenCount || 1) + 1;

      // Record a price change if the listed price shifted
      if (price !== entry.price) {
        entry.priceHistory = entry.priceHistory || [];
        entry.priceHistory.push({ price: entry.price, date: entry.lastSeen });
        entry.price = price;
      }
    } else {
      log[itemId] = { id: itemId, title, price, url, firstSeen: now, lastSeen: now, seenCount: 1 };
    }

    dirty = true;
  }

  if (dirty) await store({ log });
}

// ─── Observe dynamic loads ────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

const observer = new MutationObserver(debounce(logVisibleListings, 700));
observer.observe(document.body, { childList: true, subtree: true });

logVisibleListings();
