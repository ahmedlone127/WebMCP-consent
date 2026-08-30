/**
 * Runs in the page's own JS context (MAIN world), before the page's own
 * scripts. Patches registerTool on navigator.modelContext / document.modelContext,
 * and patches window.fetch, so both the tool surface and the network calls a
 * tool makes pass through here first -- on any site, whether or not that
 * site built a consent layer of its own.
 */
(function () {
  const PENDING = new Map();  // id -> { resolve, reject, commit, kind, ... }
  const CHECKS = new Map();   // id -> { resolve } -- whitelist lookups awaiting the background
  let seq = 0;
  const nextId = (p) => `wmc-ext-${p}-${Date.now()}-${++seq}`;

  // Names of WebMCP tools currently executing (read or write), most recent
  // last. The fetch patch only gates requests made while this is non-empty
  // -- it must never interfere with the page's own, human-driven traffic
  // -- and uses the top of the stack to attribute a caught request to the
  // tool that triggered it.
  const callStack = [];
  // True while we're running a tool's real execute() that the operator has
  // already approved (or that was whitelisted). Its own resulting fetch
  // calls are recorded but not re-gated -- one approval, not two.
  let trustedInFlight = false;

  function isWrite(def) {
    const a = def.annotations || {};
    return a.readOnlyHint !== true; // fail-safe default: gate unless proven safe
  }

  function scoreOf({ write, method, sameOrigin }) {
    let s = 0;
    if (write) s += 2;
    if (method && method !== 'GET' && method !== 'HEAD') s += 2;
    if (sameOrigin === false) s += 3;
    return s;
  }

  function checkWhitelist(key) {
    const id = nextId('chk');
    return new Promise((resolve) => {
      CHECKS.set(id, { resolve });
      window.postMessage({ source: 'webmcp-consent-ext', type: 'CHECK_WHITELIST', id, key }, '*');
    });
  }

  async function trackedRun(fn, def, input) {
    callStack.push(def.name);
    try {
      return await fn.call(def, input);
    } finally {
      callStack.pop();
    }
  }

  function wrapRead(def) {
    const originalExecute = def.execute;
    return { ...def, async execute(input) { return trackedRun(originalExecute, def, input); } };
  }

  function wrapWrite(def) {
    const originalExecute = def.execute;
    const key = `${location.origin}::${def.name}`;

    return {
      ...def,
      description: `${def.description} This site did not mark this tool as read-only, so WebMCP Consent is holding it for your approval before it runs.`,
      async execute(input) {
        const allowed = await checkWhitelist(key);
        if (allowed) {
          return trackedRun(() => {
            trustedInFlight = true;
            return Promise.resolve(originalExecute.call(def, input)).finally(() => { trustedInFlight = false; });
          }, def, input);
        }

        const id = nextId('tool');
        return new Promise((resolve, reject) => {
          PENDING.set(id, {
            resolve, reject, kind: 'tool', key,
            commit: () => trackedRun(() => {
              trustedInFlight = true;
              return Promise.resolve(originalExecute.call(def, input)).finally(() => { trustedInFlight = false; });
            }, def, input),
          });
          window.postMessage({
            source: 'webmcp-consent-ext', type: 'PROPOSE', id, kind: 'tool', key,
            tool: def.name, description: def.description, input,
            score: scoreOf({ write: true }),
            pageUrl: location.href, pageTitle: document.title,
          }, '*');
        });
      },
    };
  }

  function patchRegisterTool(root) {
    if (!root || !root.modelContext || root.modelContext.__wmcPatched) return;
    const mc = root.modelContext;
    const realRegister = mc.registerTool.bind(mc);
    mc.registerTool = function (def, options) {
      const toRegister = isWrite(def) ? wrapWrite(def) : wrapRead(def);
      return realRegister(toRegister, options);
    };
    mc.__wmcPatched = true;
  }

  function patchFetch() {
    if (typeof window.fetch !== 'function' || window.fetch.__wmcPatched) return;
    const realFetch = window.fetch.bind(window);
    const patched = function (input, init) {
      const method = ((init && init.method) || 'GET').toUpperCase();
      const callerTool = callStack[callStack.length - 1];

      if (!callerTool || method === 'GET' || method === 'HEAD' || trustedInFlight) {
        return realFetch(input, init); // not agent-triggered, safe method, or already approved
      }

      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      let sameOrigin = null;
      try { sameOrigin = new URL(url, location.href).origin === location.origin; } catch { /* leave null */ }

      const id = nextId('net');
      return new Promise((resolve, reject) => {
        PENDING.set(id, { resolve, reject, kind: 'network', commit: () => realFetch(input, init) });
        window.postMessage({
          source: 'webmcp-consent-ext', type: 'PROPOSE', id, kind: 'network',
          tool: `${callerTool} → HTTP ${method}`,
          description: `${callerTool} claims to be safe, but tried to send an untracked ${method} request while running.`,
          input: { method, url },
          score: scoreOf({ write: true, method, sameOrigin }),
          pageUrl: location.href, pageTitle: document.title,
        }, '*');
      });
    };
    patched.__wmcPatched = true;
    window.fetch = patched;
  }

  patchRegisterTool(navigator);
  patchRegisterTool(document);
  patchFetch();

  let tries = 0;
  const timer = setInterval(() => {
    patchRegisterTool(navigator);
    patchRegisterTool(document);
    patchFetch();
    if (++tries > 40) clearInterval(timer);
  }, 50);

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'webmcp-consent-ext-response') return;

    if (msg.type === 'CHECK_WHITELIST') {
      const c = CHECKS.get(msg.id);
      if (!c) return;
      CHECKS.delete(msg.id);
      c.resolve(!!msg.allowed);
      return;
    }

    if (msg.type === 'DECISION') {
      const p = PENDING.get(msg.id);
      if (!p) return;
      PENDING.delete(msg.id);
      if (!msg.approved) {
        p.reject(new Error(msg.reason || 'The operator declined this action. Nothing was changed.'));
        return;
      }
      Promise.resolve()
        .then(p.commit)
        .then((result) => p.resolve(typeof result === 'string' ? result : 'Approved.'))
        .catch((err) => p.reject(err));
    }
  });
})();
