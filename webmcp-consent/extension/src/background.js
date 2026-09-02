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

// A held call is invisible if the operator isn't already looking at the
// toolbar, and the agent is sitting there suspended the whole time. The
// notification carries the same two decisions as the popup so a proposal can
// be answered without opening anything. Its id is the proposal id, which makes
// clearing it on a decision made elsewhere a one-liner.
const NOTIFY_APPROVE = 0;
const NOTIFY_DECLINE = 1;

function describe(p) {
  let args = '';
  try {
    const entries = Object.entries(p.input || {});
    if (entries.length) {
      args = entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ');
    }
  } catch { /* unserialisable input still deserves a notification */ }
  let host = p.pageUrl || '';
  try { host = new URL(p.pageUrl).host; } catch { /* keep the raw string */ }
  return { args, host };
}

async function notify(p) {
  const { args, host } = describe(p);
  const title = p.kind === 'network'
    ? 'A "read-only" tool tried to send a request'
    : 'Approval needed';
  try {
    await chrome.notifications.create(p.id, {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('icons/icon128.png'),
      title,
      message: `${p.tool}${args ? `\n${args}` : ''}\n\n${host}`,
      contextMessage: 'WebMCP Consent',
      priority: 2,
      requireInteraction: true, // a suspended agent shouldn't time out silently
      buttons: [{ title: 'Approve' }, { title: 'Decline' }],
    });
  } catch { /* notifications may be blocked at the OS level; the popup still works */ }
}

async function clearNotification(id) {
  try { await chrome.notifications.clear(id); } catch { /* already gone */ }
}

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
  const entry = {
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
  };
  pending.push(entry);
  await setPending(pending);
  await notify(entry);
}

async function handleDecide(msg) {
  const pending = await getPending();
  const idx = pending.findIndex((p) => p.id === msg.id);
  if (idx === -1) return { ok: false };

  const [p] = pending.splice(idx, 1);
  await setPending(pending);
  // Whichever surface answered, the other one must stop asking.
  await clearNotification(p.id);

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

// Approve/Decline straight from the notification. The notification id is the
// proposal id, so this routes into exactly the same path the popup uses --
// there is no second decision route to keep in sync, and no way to approve
// something the queue doesn't still hold.
try {
  chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
    if (buttonIndex !== NOTIFY_APPROVE && buttonIndex !== NOTIFY_DECLINE) return;
    handleDecide({
      id: notificationId,
      approved: buttonIndex === NOTIFY_APPROVE,
      alwaysAllow: false, // "always allow" stays a deliberate choice made in the popup
    }).catch(() => {});
  });

  // Dismissing the notification is not a decision. The proposal stays queued
  // and the popup still shows it -- silently declining on a stray click would
  // be worse than leaving the agent waiting.
  chrome.notifications.onClicked.addListener(() => {
    chrome.action.openPopup().catch(() => {});
  });
} catch { /* notifications unavailable; popup remains the full interface */ }

// The badge is the only state that doesn't survive an eviction on its own.
getPending().then((pending) => updateBadge(pending.length)).catch(() => {});
