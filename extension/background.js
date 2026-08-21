chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  let origin;
  try { origin = new URL(sender.url || "").hostname; } catch { return false; }
  if (!['localhost', '127.0.0.1'].includes(origin) || message?.type !== "HUNTING_EXTENSION_PING") return false;
  sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  return false;
});
