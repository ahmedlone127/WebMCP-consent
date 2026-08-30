/**
 * MV3 service worker. Holds pending proposals in memory (per browser
 * session -- this is a hackathon MVP, not durable storage), badges the
 * toolbar icon, and relays the operator's decision back to whichever tab
 * asked for it.
 */

let pending = []; // { id, tool, description, input, pageUrl, pageTitle, tabId, receivedAt }

function updateBadge() {
  chrome.action.setBadgeText({ text: pending.length ? String(pending.length) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#B4690E' });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PROPOSE') {
    pending.push({
      id: msg.id,
      tool: msg.tool,
      description: msg.description,
      input: msg.input,
      pageUrl: msg.pageUrl,
      pageTitle: msg.pageTitle,
      tabId: sender.tab ? sender.tab.id : null,
      receivedAt: Date.now(),
    });
    updateBadge();
    return;
  }

  if (msg?.type === 'GET_PENDING') {
    sendResponse({ pending });
    return;
  }

  if (msg?.type === 'DECIDE') {
    const idx = pending.findIndex((p) => p.id === msg.id);
    if (idx === -1) {
      sendResponse({ ok: false });
      return;
    }
    const [p] = pending.splice(idx, 1);
    updateBadge();
    if (p.tabId != null) {
      chrome.tabs.sendMessage(p.tabId, {
        type: 'DECISION',
        id: p.id,
        approved: msg.approved,
        reason: msg.reason,
      }).catch(() => {}); // the tab may have navigated away; nothing to do
    }
    sendResponse({ ok: true });
    return;
  }
});
