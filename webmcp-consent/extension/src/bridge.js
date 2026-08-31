/**
 * ISOLATED world -- the only place chrome.* APIs are reachable. Relays
 * between the page (interceptor.js, via window.postMessage) and the
 * extension's background service worker.
 *
 * Reloading the extension orphans every copy of this script already injected
 * into an open tab: chrome.runtime survives as an object but every call on it
 * throws "Extension context invalidated". Each such throw is an uncaught
 * error on the page, so an orphaned tab that keeps relaying messages produces
 * a stream of them. Every chrome.* call below is therefore guarded, and a
 * failed relay answers the page with a denial rather than leaving the tool's
 * promise hanging forever.
 */

function alive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function reply(payload) {
  window.postMessage({ source: 'webmcp-consent-ext-response', ...payload }, '*');
}

const ORPHANED =
  'WebMCP Consent could not reach its approval queue, so nothing was run. ' +
  'The extension was probably reloaded or updated -- reload this page to reconnect.';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'webmcp-consent-ext') return;

  if (msg.type === 'PROPOSE') {
    if (!alive()) {
      // Fail closed: the operator will never see this card, so the call must
      // not sit unresolved pretending an approval is still possible.
      reply({ type: 'DECISION', id: msg.id, approved: false, unavailable: true, reason: ORPHANED });
      return;
    }
    try {
      chrome.runtime.sendMessage({
        type: 'PROPOSE',
        id: msg.id,
        kind: msg.kind,
        key: msg.key,
        tool: msg.tool,
        description: msg.description,
        input: msg.input,
        score: msg.score,
        pageUrl: msg.pageUrl,
        pageTitle: msg.pageTitle,
      }).catch(() => {
        reply({ type: 'DECISION', id: msg.id, approved: false, unavailable: true, reason: ORPHANED });
      });
    } catch {
      reply({ type: 'DECISION', id: msg.id, approved: false, unavailable: true, reason: ORPHANED });
    }
    return;
  }

  if (msg.type === 'CHECK_WHITELIST') {
    // A failed lookup answers "not whitelisted", which routes the call to the
    // approval queue rather than letting it through.
    if (!alive()) {
      reply({ type: 'CHECK_WHITELIST', id: msg.id, allowed: false });
      return;
    }
    try {
      chrome.runtime.sendMessage({ type: 'CHECK_WHITELIST', key: msg.key })
        .then((res) => {
          reply({ type: 'CHECK_WHITELIST', id: msg.id, allowed: !!(res && res.allowed) });
        })
        .catch(() => {
          reply({ type: 'CHECK_WHITELIST', id: msg.id, allowed: false });
        });
    } catch {
      reply({ type: 'CHECK_WHITELIST', id: msg.id, allowed: false });
    }
    return;
  }
});

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'DECISION') return;
    reply({ type: 'DECISION', id: msg.id, approved: msg.approved, reason: msg.reason });
  });
} catch { /* orphaned before we ever got to listen */ }
