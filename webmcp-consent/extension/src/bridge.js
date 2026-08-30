/**
 * ISOLATED world -- the only place chrome.* APIs are reachable. Relays
 * between the page (interceptor.js, via window.postMessage) and the
 * extension's background service worker.
 */

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'webmcp-consent-ext') return;

  if (msg.type === 'PROPOSE') {
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
    });
    return;
  }

  if (msg.type === 'CHECK_WHITELIST') {
    chrome.runtime.sendMessage({ type: 'CHECK_WHITELIST', key: msg.key }, (res) => {
      window.postMessage({
        source: 'webmcp-consent-ext-response',
        type: 'CHECK_WHITELIST',
        id: msg.id,
        allowed: !!(res && res.allowed),
      }, '*');
    });
    return;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'DECISION') return;
  window.postMessage({
    source: 'webmcp-consent-ext-response',
    type: 'DECISION',
    id: msg.id,
    approved: msg.approved,
    reason: msg.reason,
  }, '*');
});
