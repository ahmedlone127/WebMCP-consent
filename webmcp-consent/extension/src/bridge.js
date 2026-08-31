/**
 * ISOLATED world -- the only place chrome.* APIs are reachable. Relays between
 * the page's MAIN world (interceptor.js) and the extension's background
 * service worker.
 *
 * The link to the MAIN world is a private MessagePort, handed over at
 * document_start before any page script has run. It is deliberately not
 * window.postMessage: the interceptor has to live in the MAIN world to patch
 * registerTool, so page scripts share that world and could otherwise read a
 * proposal's id off the wire and post back a forged approval for it.
 *
 * Reloading the extension orphans every copy of this script already injected
 * into an open tab: chrome.runtime survives as an object but every call on it
 * throws "Extension context invalidated". Every chrome.* call below is
 * therefore guarded, and a failed relay answers the page with a denial rather
 * than leaving the tool's promise hanging forever.
 */

let port = null;

const ORPHANED =
  'WebMCP Consent could not reach its approval queue, so nothing was run. ' +
  'The extension was probably reloaded or updated -- reload this page to reconnect.';

function alive() {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch {
    return false;
  }
}

function reply(payload) {
  if (port) port.postMessage(payload);
}

function handleFromPage(msg) {
  if (!msg || !msg.type) return;

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
  }
}

// The only thing accepted over window.postMessage is the one-time port
// handover, and only the first one -- a later message claiming to be the
// handshake is a page trying to substitute a channel it controls.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.__webmcpConsentPort !== true) return;
  if (port) return;
  const received = event.ports && event.ports[0];
  if (!received) return;
  port = received;
  port.onmessage = (e) => handleFromPage(e.data);
  port.start();
});

try {
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'DECISION') return;
    reply({ type: 'DECISION', id: msg.id, approved: msg.approved, reason: msg.reason });
  });
} catch { /* orphaned before we ever got to listen */ }
