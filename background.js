/**
 * Resell Scout — background service worker
 * Seeds the reselling sheet with the built-in price catalog on first install.
 */

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason !== 'install') return;

  const catalog = await fetch(chrome.runtime.getURL('items-catalog.json')).then(r => r.json());
  const items = catalog.map((it, i) => ({ id: `cat${i}`, ...it }));
  chrome.storage.local.set({ items, enabled: true });
});
