/**
 * MV3 service worker. Holds pending proposals, persists the "always allow"
 * whitelist, badges the toolbar icon, and relays the operator's decision back
 * to whichever tab asked for it.
 *
 * Pending proposals live in chrome.storage.session, not in a module-level
 * array. An MV3 service worker is evicted after ~30s idle, and a proposal is
 * precisely a thing that sits idle waiting for a human: keeping the queue in
 * memory means a tool call the operator takes half a minute to look at
 * vanishes, leaving the page's promise hanging with nothing left to approve.
 * storage.session keeps it for the life of the browser session without ever
 * writing a record of what the agent tried to do to disk.
 */

const PENDING_KEY = 'pending';
const WHITELIST_KEY = 'whitelist';

async function getPending() {
  const got = await chrome.storage.session.get(PENDING_KEY);
  return got[PENDING_KEY] || [];
}

async function setPending(list) {
  await chrome.storage.session.set({ [PENDING_KEY]: list });
  await updateBadge(list.length);
}

async function updateBadge(count) {
  try {
    await chrome.action.setBadgeText({ text: count ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#B4690E' });
  } catch { /* action API unavailable during teardown */ }
}

async function getWhitelist() {
  const got = await chrome.storage.local.get(WHITELIST_KEY);
  return got[WHITELIST_KEY] || {};
}

async function setWhitelisted(key, meta) {
  const whitelist = await getWhitelist();
  whitelist[key] = { addedAt: Date.now(), ...meta };
  await chrome.storage.local.set({ [WHITELIST_KEY]: whitelist });
}

async function removeWhitelisted(key) {
  const whitelist = await getWhitelist();
  delete whitelist[key];
  await chrome.storage.local.set({ [WHITELIST_KEY]: whitelist });
}

async function handlePropose(msg, sender) {
  const pending = await getPending();
  pending.push({
    id: msg.id,
    kind: msg.kind,
    key: msg.key || null,
    tool: msg.tool,
    description: msg.description,
    input: msg.input,
    pageUrl: msg.pageUrl,
    pageTitle: msg.pageTitle,
    tabId: sender.tab ? sender.tab.id : null,
    receivedAt: Date.now(),
  });
  await setPending(pending);
}

async function handleDecide(msg) {
  const pending = await getPending();
  const idx = pending.findIndex((p) => p.id === msg.id);
  if (idx === -1) return { ok: false };

  const [p] = pending.splice(idx, 1);
  await setPending(pending);

  if (msg.approved && msg.alwaysAllow && p.key) {
    await setWhitelisted(p.key, { tool: p.tool, pageUrl: p.pageUrl });
  }

  if (p.tabId != null) {
    try {
      await chrome.tabs.sendMessage(p.tabId, {
        type: 'DECISION',
        id: p.id,
        approved: msg.approved,
        reason: msg.reason,
      });
    } catch { /* the tab may have navigated away or closed */ }
  }
  return { ok: true };
}

// Every branch answers, and answers asynchronously, so `return true` is
// unconditional -- a branch that returned undefined after an async handler
// had already claimed the channel would reject the sender's promise.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return;

  const done = (value) => sendResponse(value);
  const fail = () => sendResponse({ ok: false });

  switch (msg.type) {
    case 'PROPOSE':
      handlePropose(msg, sender).then(() => done({ ok: true }), fail);
      return true;
    case 'GET_PENDING':
      getPending().then((pending) => done({ pending }), () => done({ pending: [] }));
      return true;
    case 'CHECK_WHITELIST':
      // Fail closed: an unreadable whitelist means "not allowed", which sends
      // the call to the approval queue rather than through it.
      getWhitelist().then(
        (whitelist) => done({ allowed: !!whitelist[msg.key] }),
        () => done({ allowed: false }),
      );
      return true;
    case 'GET_WHITELIST':
      getWhitelist().then((whitelist) => done({ whitelist }), () => done({ whitelist: {} }));
      return true;
    case 'REMOVE_WHITELIST':
      removeWhitelisted(msg.key).then(() => done({ ok: true }), fail);
      return true;
    case 'DECIDE':
      handleDecide(msg).then(done, fail);
      return true;
    default:
      return;
  }
});

// The badge is the only state that doesn't survive an eviction on its own.
getPending().then((pending) => updateBadge(pending.length)).catch(() => {});
