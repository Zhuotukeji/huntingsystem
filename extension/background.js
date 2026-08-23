const WORKSPACE_PATH = "sidepanel.html";
const WORKSPACE_WIDTH = 420;
const WORKSPACE_HEIGHT = 820;
const WORKSPACE_WINDOW_KEY = "workspaceWindowId";

async function focusWorkspaceWindow(windowId, sourceTab) {
  const workspaceUrl = chrome.runtime.getURL(WORKSPACE_PATH);
  try {
    const workspace = await chrome.windows.get(windowId, { populate: true });
    if (!workspace.tabs?.some((tab) => tab.url?.startsWith(workspaceUrl))) return false;
    await chrome.windows.update(windowId, { focused: true, drawAttention: true });
    chrome.runtime.sendMessage({ type: "HUNTING_SOURCE_CONTEXT", windowId: sourceTab.windowId, tabId: sourceTab.id, url: sourceTab.url || "" }).catch(() => {});
    return true;
  } catch {
    await chrome.storage.session.remove(WORKSPACE_WINDOW_KEY);
    return false;
  }
}

async function openWorkspace(sourceTab) {
  const [saved] = await Promise.all([
    chrome.storage.session.get([WORKSPACE_WINDOW_KEY]),
    chrome.storage.session.set({ sourceWindowId: sourceTab.windowId, sourceTabId: sourceTab.id, sourceTabUrl: sourceTab.url || "" }),
  ]);
  if (Number.isInteger(saved[WORKSPACE_WINDOW_KEY]) && await focusWorkspaceWindow(saved[WORKSPACE_WINDOW_KEY], sourceTab)) return;

  try {
    const workspace = await chrome.windows.create({
      url: WORKSPACE_PATH,
      type: "popup",
      width: WORKSPACE_WIDTH,
      height: WORKSPACE_HEIGHT,
      focused: true,
    });
    if (Number.isInteger(workspace.id)) await chrome.storage.session.set({ [WORKSPACE_WINDOW_KEY]: workspace.id });
  } catch (error) {
    console.error("Failed to open the Hunting System workspace window", error);
    await chrome.tabs.create({ windowId: sourceTab.windowId, url: chrome.runtime.getURL(WORKSPACE_PATH) });
  }
}

chrome.action.onClicked.addListener((tab) => {
  openWorkspace(tab).catch((error) => console.error("Failed to launch the Hunting System workspace", error));
});

chrome.windows.onRemoved.addListener((windowId) => {
  chrome.storage.session.get([WORKSPACE_WINDOW_KEY]).then((saved) => {
    if (saved[WORKSPACE_WINDOW_KEY] === windowId) return chrome.storage.session.remove(WORKSPACE_WINDOW_KEY);
  }).catch(() => {});
});

chrome.runtime.onMessageExternal.addListener((message, sender, sendResponse) => {
  let origin;
  try { origin = new URL(sender.url || "").hostname; } catch { return false; }
  if (!['localhost', '127.0.0.1'].includes(origin) || message?.type !== "HUNTING_EXTENSION_PING") return false;
  sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
  return false;
});
