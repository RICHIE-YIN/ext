/**
 * Resell Scout — background service worker
 * Initialises default storage values on first install.
 */

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') {
    chrome.storage.local.set({ items: [], enabled: true });
  }
});
