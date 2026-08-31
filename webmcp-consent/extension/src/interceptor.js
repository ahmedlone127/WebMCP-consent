/**
 * Runs in the page's own JS context (MAIN world), before the page's own
 * scripts. Patches registerTool on document.modelContext (falling back to the
 * deprecated navigator.modelContext), and patches window.fetch, so both the
 * tool surface and the network calls a tool makes pass through here first --
 * on any site, whether or not that site built a consent layer of its own.
 *
 * Everything here is defensive. This script runs on every page the user
 * visits, so a failure to patch has to degrade quietly rather than throw
 * into the host page's console on a retry loop.
 */
(function () {
  const PENDING = new Map();  // id -> { resolve, reject, commit, kind, ... }
  const CHECKS = new Map();   // id -> { resolve } -- whitelist lookups awaiting the background
  let seq = 0;
  const nextId = (p) => `wmc-ext-${p}-${Date.now()}-${++seq}`;

  // Which modelContext objects we've already wrapped. Deliberately a WeakSet
  // in our own closure rather than a marker property on the page's object:
  // a marker the page can read is a marker the page can forge to opt itself
  // out of being gated.
  const patchedContexts = new WeakSet();

  // If the bridge doesn't answer, something is wrong on the extension side
  // (extension reloaded, service worker gone). Waits here fail CLOSED -- the
  // write does not run -- never open.
  const BRIDGE_TIMEOUT_MS = 5000;

  // A declined tool call RESOLVES with this text rather than rejecting.
  // Rejecting is the tidier-looking choice, but the WebMCP runtime replaces a
  // thrown error with its own generic wording ("the script function threw an
  // error"), so the operator's decision reaches the agent as an apparent bug
  // -- and an agent that thinks a tool is buggy retries it, turning every
  // decline into another approval prompt. Resolving with an explicit refusal
  // is the only way the human's answer survives the trip to the agent intact.
  const TOOL_DECLINED =
    'DECLINED BY OPERATOR. A human reviewed this action in the WebMCP Consent ' +
    'approval queue and declined it. Nothing was changed and no data was modified. ' +
    'Do not retry this action -- ask the person you are working with what they ' +
    'would like to do instead.';

  const NETWORK_DECLINED =
    'WebMCP Consent: the operator declined this request, so it was never sent.';

  // Distinct from a decline: nobody said no, the queue was simply unreachable.
  // Still fail-closed -- the action did not run -- but the agent shouldn't be
  // told a human rejected it when no human ever saw it.
  const TOOL_UNAVAILABLE =
    'NOT RUN. WebMCP Consent could not reach its approval queue, so this action ' +
    'was not executed and nothing was changed. No one has reviewed it. The ' +
    'extension was probably reloaded or updated -- reload the page and try again.';

  // Names of WebMCP tools currently executing (read or write), most recent
  // last. The fetch patch only gates requests made while this is non-empty
  // -- it must never interfere with the page's own, human-driven traffic
  // -- and uses the top of the stack to attribute a caught request to the
  // tool that triggered it.
  const callStack = [];
  // Depth of approved-and-running executes. A counter, not a boolean: two
  // approved writes can overlap, and a boolean would let the first one to
  // finish clear the flag while the second is still legitimately running,
  // re-gating its remaining requests and prompting the operator twice.
  let trustedDepth = 0;

  function isWrite(def) {
    const a = def.annotations || {};
    return a.readOnlyHint !== true; // fail-safe default: gate unless proven safe
  }

  function post(payload) {
    window.postMessage({ source: 'webmcp-consent-ext', ...payload }, '*');
  }

  function checkWhitelist(key) {
    const id = nextId('chk');
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        CHECKS.delete(id);
        resolve(false); // fail closed: unanswered means "still needs a human"
      }, BRIDGE_TIMEOUT_MS);
      CHECKS.set(id, { resolve: (v) => { clearTimeout(timer); resolve(v); } });
      post({ type: 'CHECK_WHITELIST', id, key });
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

  // Runs a tool's real execute() after the operator approved it (or after a
  // whitelist hit). Requests it makes are recorded but not re-gated -- one
  // approval, not two.
  function runTrusted(originalExecute, def, input) {
    return trackedRun(() => {
      trustedDepth++;
      return Promise.resolve(originalExecute.call(def, input))
        .finally(() => { trustedDepth--; });
    }, def, input);
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
        if (allowed) return runTrusted(originalExecute, def, input);

        const id = nextId('tool');
        const held = new Promise((resolve, reject) => {
          PENDING.set(id, {
            resolve, reject, kind: 'tool', key,
            commit: () => runTrusted(originalExecute, def, input),
          });
          post({
            type: 'PROPOSE', id, kind: 'tool', key,
            tool: def.name, description: def.description, input,
            pageUrl: location.href, pageTitle: document.title,
          });
        });
        // The caller still receives this rejection -- `held` is what's
        // returned. This second handler exists only so a decline doesn't
        // also print as an unhandled rejection in the host page's console.
        held.catch(() => {});
        return held;
      },
    };
  }

  // Reading root.modelContext invokes a platform getter, and anything that
  // getter reports -- a deprecation warning, a thrown DOMException -- is
  // surfaced by the browser's own binding layer, outside any catch of ours.
  // So probe with `in` first, which walks the prototype chain without
  // invoking anything, and only read the value once it's known to be there.
  function readContext(root) {
    if (!root) return null;
    try {
      if (!('modelContext' in root)) return null;
      const mc = root.modelContext;
      return mc && typeof mc.registerTool === 'function' ? mc : null;
    } catch {
      return null;
    }
  }

  // Returns true once this root has a wrapped registerTool, so the caller
  // knows it can stop retrying.
  function patchRegisterTool(root) {
    const mc = readContext(root);
    if (!mc) return false;
    if (patchedContexts.has(mc)) return true;

    const realRegister = mc.registerTool.bind(mc);
    const wrapper = function (def, options) {
      let toRegister = def;
      try {
        if (def && typeof def.execute === 'function') {
          toRegister = isWrite(def) ? wrapWrite(def) : wrapRead(def);
        }
      } catch {
        toRegister = def; // never break the host page's own registration
      }
      return realRegister(toRegister, options);
    };

    try {
      mc.registerTool = wrapper;
      if (mc.registerTool !== wrapper) {
        // Inherited accessor, or a non-writable own property -- shadow it.
        Object.defineProperty(mc, 'registerTool', {
          value: wrapper, writable: true, configurable: true, enumerable: false,
        });
      }
    } catch {
      return false; // non-configurable: nothing safe left to try, stay quiet
    }

    if (mc.registerTool !== wrapper) return false;
    patchedContexts.add(mc);
    return true;
  }

  function patchFetch() {
    let current;
    try { current = window.fetch; } catch { return; }
    if (typeof current !== 'function' || current.__wmcPatched) return;

    const realFetch = current.bind(window);
    const patched = function (input, init) {
      const method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      const callerTool = callStack[callStack.length - 1];

      if (!callerTool || method === 'GET' || method === 'HEAD' || trustedDepth > 0) {
        return realFetch(input, init); // not agent-triggered, safe method, or already approved
      }

      // Shown in full on the card: the operator reads the actual destination,
      // which says more than any score derived from it could.
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);

      const id = nextId('net');
      const held = new Promise((resolve, reject) => {
        PENDING.set(id, { resolve, reject, kind: 'network', commit: () => realFetch(input, init) });
        post({
          type: 'PROPOSE', id, kind: 'network',
          tool: `${callerTool} → HTTP ${method}`,
          description: `${callerTool} claims to be safe, but tried to send an untracked ${method} request while running.`,
          input: { method, url },
          pageUrl: location.href, pageTitle: document.title,
        });
      });
      held.catch(() => {}); // see the note in wrapWrite
      return held;
    };

    try {
      patched.__wmcPatched = true;
      window.fetch = patched;
    } catch { /* frozen window.fetch: leave the page's own alone */ }
  }

  function patchContexts() {
    try {
      // document.modelContext is the current surface. navigator.modelContext
      // is deprecated and Chrome logs a warning on every *access* -- which the
      // extension error page collects -- so it is only reached for when
      // document has nothing, i.e. on an older build that needs it.
      return patchRegisterTool(document) || patchRegisterTool(navigator);
    } catch {
      return false;
    }
  }

  function safePatchFetch() {
    try { patchFetch(); } catch { /* a retry loop must never spam the console */ }
  }

  // modelContext can appear after document_start depending on how the browser
  // exposes it, so keep looking for a couple of seconds.
  //
  // The two halves stop on different conditions on purpose. Context patching
  // stops as soon as it lands: on an older build, retrying means reaching for
  // the deprecated accessor, and every read of that logs a warning. The fetch
  // patch keeps re-applying for the whole window, because a page that assigns
  // its own window.fetch after load would otherwise silently take the
  // network-level catch with it.
  let contextPatched = patchContexts();
  safePatchFetch();

  let tries = 0;
  const timer = setInterval(() => {
    if (!contextPatched) contextPatched = patchContexts();
    safePatchFetch();
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
        if (p.kind === 'network') {
          // A blocked request has to keep looking like a failed request: the
          // caller is awaiting a Response, and resolving it with a string
          // would break code that reads .ok or .json() off the result.
          p.reject(new Error(msg.reason || NETWORK_DECLINED));
        } else {
          p.resolve(msg.unavailable ? TOOL_UNAVAILABLE : TOOL_DECLINED);
        }
        return;
      }
      Promise.resolve()
        .then(p.commit)
        .then((result) => {
          // Hand the real result back untouched. A network commit resolves
          // with a Response the caller is about to read .ok or .json() off,
          // and a tool can resolve with structured content rather than a
          // string -- substituting our own value for either silently
          // destroys the answer the agent asked for. Only fill in when a
          // tool genuinely returned nothing, so approval still reads as
          // confirmed rather than empty.
          if (p.kind === 'tool' && result === undefined) return p.resolve('Approved.');
          return p.resolve(result);
        })
        .catch((err) => p.reject(err));
    }
  });
})();
