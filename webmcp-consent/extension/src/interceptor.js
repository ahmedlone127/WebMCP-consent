/**
 * Runs in the page's own JS context (MAIN world), before the page's own
 * scripts. Patches registerTool on whichever of navigator.modelContext /
 * document.modelContext the browser exposes, so every tool the page
 * registers — on any site, whether or not that site built a consent layer
 * of its own — passes through here first.
 */
(function () {
  const PENDING = new Map(); // id -> { resolve, reject, originalExecute, input, name }
  let seq = 0;
  const nextId = () => `wmc-ext-${Date.now()}-${++seq}`;

  function isWrite(def) {
    const a = def.annotations || {};
    // Fail-safe default: a tool is treated as a write unless the site
    // explicitly says it's safe. Sites opt OUT of friction by being
    // explicit, rather than opting IN to protection.
    return a.readOnlyHint !== true;
  }

  function wrapTool(def) {
    const originalExecute = def.execute;
    return {
      ...def,
      description: `${def.description} This site did not mark this tool as read-only, so WebMCP Consent is holding it for your approval before it runs.`,
      async execute(input) {
        const id = nextId();
        return new Promise((resolve, reject) => {
          PENDING.set(id, { resolve, reject, originalExecute, input, name: def.name, def });
          window.postMessage({
            source: 'webmcp-consent-ext',
            type: 'PROPOSE',
            id,
            tool: def.name,
            description: def.description,
            input,
            pageUrl: location.href,
            pageTitle: document.title,
          }, '*');
        });
      },
    };
  }

  function patch(root) {
    if (!root || !root.modelContext || root.modelContext.__wmcPatched) return;
    const mc = root.modelContext;
    const realRegister = mc.registerTool.bind(mc);
    mc.registerTool = function (def, options) {
      const toRegister = isWrite(def) ? wrapTool(def) : def;
      return realRegister(toRegister, options);
    };
    mc.__wmcPatched = true;
  }

  patch(navigator);
  patch(document);

  // The spec is mid-migration and some pages may set modelContext up a
  // beat after document_start. Keep trying briefly; cheap and bounded.
  let tries = 0;
  const timer = setInterval(() => {
    patch(navigator);
    patch(document);
    if (++tries > 40) clearInterval(timer);
  }, 50);

  // The bridge script relays the human's decision back here.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || msg.source !== 'webmcp-consent-ext-response') return;
    const p = PENDING.get(msg.id);
    if (!p) return;
    PENDING.delete(msg.id);

    if (!msg.approved) {
      p.reject(new Error(msg.reason || 'The operator declined this action. Nothing was changed.'));
      return;
    }

    // Only now does the real side effect actually run.
    Promise.resolve()
      .then(() => p.originalExecute.call(p.def, p.input))
      .then((result) => p.resolve(typeof result === 'string' ? result : `Approved. ${p.name} executed.`))
      .catch((err) => p.reject(err));
  });
})();
