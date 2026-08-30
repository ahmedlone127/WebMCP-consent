/**
 * MV3 service worker. Holds pending proposals in memory (per browser
 * session), persists the "always allow" whitelist in chrome.storage.local
 * (survives restarts), badges the toolbar icon, and relays the operator's
 * decision back to whichever tab asked for it.
 */

let pending = []; // { id, kind, key, tool, description, input, score, pageUrl, pageTitle, tabId, receivedAt }

function updateBadge() {
  chrome.action.setBadgeText({ text: pending.length ? String(pending.length) : '' });
  chrome.action.setBadgeBackgroundColor({ color: '#B4690E' });
}

async function getWhitelist() {
  const { whitelist } = await chrome.storage.local.get('whitelist');
  return whitelist || {};
}

async function setWhitelisted(key, meta) {
  const whitelist = await getWhitelist();
  whitelist[key] = { addedAt: Date.now(), ...meta };
  await chrome.storage.local.set({ whitelist });
}

async function removeWhitelisted(key) {
  const whitelist = await getWhitelist();
  delete whitelist[key];
  await chrome.storage.local.set({ whitelist });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'PROPOSE') {
    pending.push({
      id: msg.id,
      kind: msg.kind,
      key: msg.key || null,
      tool: msg.tool,
      description: msg.description,
      input: msg.input,
      score: msg.score,
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

  if (msg?.type === 'CHECK_WHITELIST') {
    getWhitelist().then((whitelist) => sendResponse({ allowed: !!whitelist[msg.key] }));
    return true; // async sendResponse
  }

  if (msg?.type === 'GET_WHITELIST') {
    getWhitelist().then((whitelist) => sendResponse({ whitelist }));
    return true;
  }

  if (msg?.type === 'REMOVE_WHITELIST') {
    removeWhitelisted(msg.key).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg?.type === 'DECIDE') {
    const idx = pending.findIndex((p) => p.id === msg.id);
    if (idx === -1) {
      sendResponse({ ok: false });
      return;
    }
    const [p] = pending.splice(idx, 1);
    updateBadge();

    const finish = () => {
      if (p.tabId != null) {
        chrome.tabs.sendMessage(p.tabId, {
          type: 'DECISION',
          id: p.id,
          approved: msg.approved,
          reason: msg.reason,
        }).catch(() => {}); // the tab may have navigated away
      }
      sendResponse({ ok: true });
    };

    if (msg.approved && msg.alwaysAllow && p.key) {
      setWhitelisted(p.key, { tool: p.tool, pageUrl: p.pageUrl }).then(finish);
      return true;
    }
    finish();
    return;
  }
});
