/**
 * Runs in the ISOLATED world (default for content scripts), which is the
 * only place chrome.* APIs are available. interceptor.js runs in the MAIN
 * world so it can patch the page's real navigator.modelContext, but that
 * means it can't talk to the extension directly -- this script relays
 * between the two via window.postMessage <-> chrome.runtime.
 */

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== 'webmcp-consent-ext' || msg.type !== 'PROPOSE') return;
  chrome.runtime.sendMessage({
    type: 'PROPOSE',
    id: msg.id,
    tool: msg.tool,
    description: msg.description,
    input: msg.input,
    pageUrl: msg.pageUrl,
    pageTitle: msg.pageTitle,
  });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.type !== 'DECISION') return;
  window.postMessage({
    source: 'webmcp-consent-ext-response',
    id: msg.id,
    approved: msg.approved,
    reason: msg.reason,
  }, '*');
});
