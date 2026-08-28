/**
 * webmcp-consent — a consent layer for WebMCP tools.
 *
 * Reads run freely. Writes never execute; they stage a proposal that a human
 * approves in the page, out of band from the agent's own channel.
 */

/** The spec is mid-migration between navigator and document. Check both. */
export function getModelContext() {
  if (typeof document !== 'undefined' && document.modelContext) return document.modelContext;
  if (typeof navigator !== 'undefined' && navigator.modelContext) return navigator.modelContext;
  return null;
}

/**
 * Wrap attacker-influenced text so it reaches the model visibly labelled as
 * data rather than instruction. Delimiting is not a guarantee, but it is the
 * cheapest signal you can send and it costs nothing.
 */
export function wrapUntrusted(text, { source = 'user-generated' } = {}) {
  return `<untrusted-content source="${source}">\n${text}\n</untrusted-content>`;
}

let seq = 0;
const nextId = (p) => `${p}-${String(++seq).padStart(3, '0')}`;

export class ConsentLayer {
  /**
   * @param {object} [opts]
   * @param {string} [opts.role='default']  Current user's role.
   * @param {number} [opts.timeoutMs=300000] Auto-expire pending proposals after
   *                                          5 minutes so an agent is never hung
   *                                          forever on an absent human. Pass 0
   *                                          to disable expiry.
   * @param {number} [opts.auditLimit=200]  Ring buffer size for the audit log.
   * @param {boolean} [opts.exposeHistory=true] Register get_action_history for the agent.
   */
  constructor(opts = {}) {
    this.role = opts.role ?? 'default';
    this.timeoutMs = opts.timeoutMs ?? 300_000;
    this.auditLimit = opts.auditLimit ?? 200;
    this.exposeHistory = opts.exposeHistory !== false;

    this.mc = getModelContext();
    this.available = !!this.mc;

    this._defs = [];        // tool definitions, registered or not
    this._pending = [];     // staged proposals awaiting a human
    this._audit = [];
    this._done = new Map(); // idempotency key -> settled result
    this._listeners = new Set();
    this._controller = null;

    this._sync();
  }

  /* ---------------------------------------------------------------- events */

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    const snapshot = { pending: this.pending, audit: this.audit, role: this.role, tools: this.toolNames };
    for (const fn of this._listeners) {
      try { fn(snapshot); } catch (e) { console.error('[webmcp-consent] listener threw', e); }
    }
  }

  /* ------------------------------------------------------------ read tools */

  /**
   * Register a tool that executes immediately. No approval, no friction.
   * Set `untrusted: true` when the tool returns user-generated content.
   */
  registerRead(def) {
    this._defs.push({ ...def, _kind: 'read' });
    this._sync();
    return this;
  }

  /* ----------------------------------------------------------- write tools */

  /**
   * Register a tool whose call stages a proposal instead of executing.
   *
   * @param {object} def
   * @param {string}   def.name
   * @param {string}   def.description
   * @param {object}   def.inputSchema
   * @param {string[]} [def.roles]     Roles that may see this tool at all.
   * @param {Function} [def.guard]     (input, ctx) => true | string. A string is
   *                                   a refusal reason. Runs at propose time AND
   *                                   again at approve time.
   * @param {Function} def.preview     (input, ctx) => { summary, diff, blastRadius, reversible }
   * @param {Function} def.commit      (input, ctx) => any. Runs only after approval.
   */
  registerStaged(def) {
    if (typeof def.preview !== 'function') throw new TypeError(`${def.name}: preview() is required`);
    if (typeof def.commit !== 'function') throw new TypeError(`${def.name}: commit() is required`);
    this._defs.push({ ...def, _kind: 'staged' });
    this._sync();
    return this;
  }

  /* ----------------------------------------------------------------- roles */

  /** Change the acting role. Tools the new role may not use are unregistered. */
  setRole(role) {
    if (role === this.role) return this;
    this.role = role;
    this._log('human', `role changed to ${role}`);
    this._sync();
    return this;
  }

  /* ------------------------------------------------------------- proposals */

  get pending() { return this._pending.map(({ _resolve, _reject, _timer, ...rest }) => rest); }
  get audit() { return [...this._audit]; }
  get toolNames() { return this._visibleDefs().map((d) => d.name); }

  /** Approve a staged proposal. Re-checks the guard before committing. */
  async approve(id) {
    const p = this._take(id);
    if (!p) return false;

    const ctx = { role: this.role, proposalId: id };

    if (p.def.roles && !p.def.roles.includes(this.role)) {
      this._log('system', `${id} blocked on re-check: role ${this.role} may not approve ${p.tool}`);
      p._reject(new Error(`Not committed. Your role (${this.role}) is not permitted to approve this action.`));
      this._emit();
      return false;
    }

    const verdict = p.def.guard ? p.def.guard(p.input, ctx) : true;
    if (verdict !== true) {
      const why = typeof verdict === 'string' ? verdict : 'blocked at approval';
      this._log('system', `${id} blocked on re-check: ${why}`);
      p._reject(new Error(`Not committed. ${why}`));
      this._emit();
      return false;
    }

    try {
      const result = await p.def.commit(p.input, ctx);
      if (p.key) this._done.set(p.key, result);
      this._log('human', `${id} approved — ${p.summary}`);
      p._resolve(typeof result === 'string' ? result : `Committed as ${id}.`);
      this._emit();
      return true;
    } catch (err) {
      this._log('system', `${id} failed on commit: ${err.message}`);
      p._reject(err);
      this._emit();
      return false;
    }
  }

  /** Decline a staged proposal. The agent's call rejects. */
  decline(id, reason = 'The operator declined this action.') {
    const p = this._take(id);
    if (!p) return false;
    this._log('human', `${id} declined`);
    p._reject(new Error(`${reason} Nothing was changed.`));
    this._emit();
    return true;
  }

  _take(id) {
    const i = this._pending.findIndex((p) => p.id === id);
    if (i < 0) return null;
    const [p] = this._pending.splice(i, 1);
    if (p._timer) clearTimeout(p._timer);
    return p;
  }

  /* ------------------------------------------------------------- internals */

  _log(actor, text) {
    this._audit.unshift({ at: new Date().toISOString(), actor, text });
    if (this._audit.length > this.auditLimit) this._audit.length = this.auditLimit;
  }

  _visibleDefs() {
    return this._defs.filter((d) => !d.roles || d.roles.includes(this.role));
  }

  /** Wrap a definition into a WebMCP tool descriptor. */
  _descriptor(def) {
    if (def._kind === 'read') return this._readDescriptor(def);
    return this._stagedDescriptor(def);
  }

  _readDescriptor(def) {
    const self = this;
    return {
      name: def.name,
      description: def.description,
      inputSchema: def.inputSchema ?? { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, ...(def.untrusted ? { untrustedContentHint: true } : {}), ...def.annotations },
      async execute(input) {
        const out = await def.execute(input, { role: self.role });
        self._log('agent', `read ${def.name}`);
        self._emit();
        return def.untrusted && typeof out === 'string' ? wrapUntrusted(out, { source: def.name }) : out;
      },
    };
  }

  _stagedDescriptor(def) {
    const self = this;
    const schema = def.inputSchema ?? { type: 'object', properties: {} };

    // Every staged tool accepts an idempotency key so a retrying agent
    // cannot create the same proposal twice.
    const inputSchema = {
      ...schema,
      properties: {
        ...(schema.properties ?? {}),
        idempotency_key: {
          type: 'string',
          description: 'Optional. Reuse the same key when retrying so the action is not duplicated.',
        },
      },
    };

    const description =
      `${def.description} This does NOT execute. It stages a proposal that the operator ` +
      `must approve in the page. The call will not return until they act on it.`;

    // WebMCP implementations budget tool description length (Chrome: 500
    // chars). The boilerplate above already spends ~135 of them, so a
    // developer's own description can push a registered tool over the limit
    // and get silently truncated by the runtime.
    if (description.length > 500) {
      console.warn(`[webmcp-consent] ${def.name}: description is ${description.length} chars, over the ~500 char budget most WebMCP runtimes enforce. Shorten def.description.`);
    }

    return {
      name: def.name,
      description,
      inputSchema,
      annotations: def.annotations,
      async execute(raw) {
        const { idempotency_key: key, ...input } = raw ?? {};
        const ctx = { role: self.role };

        if (key && self._done.has(key)) {
          return `Already completed under key ${key}. Nothing was done again.`;
        }
        if (key && self._pending.some((p) => p.key === key)) {
          throw new Error(`A proposal with key ${key} is already awaiting approval.`);
        }

        const verdict = def.guard ? def.guard(input, ctx) : true;
        if (verdict !== true) {
          const why = typeof verdict === 'string' ? verdict : 'not permitted for this role';
          self._log('agent', `${def.name} refused: ${why}`);
          self._emit();
          throw new Error(`Refused. ${why} Nothing was staged.`);
        }

        const view = (await def.preview(input, ctx)) ?? {};
        const id = nextId('PR');

        return new Promise((resolve, reject) => {
          const proposal = {
            id,
            tool: def.name,
            key,
            input,
            def,
            summary: view.summary ?? def.name,
            diff: view.diff ?? [],
            blastRadius: view.blastRadius ?? 1,
            reversible: view.reversible ?? false,
            reason: input.reason ?? view.reason ?? null,
            stagedAt: Date.now(),
            _resolve: resolve,
            _reject: reject,
            _timer: null,
          };

          if (self.timeoutMs > 0) {
            proposal._timer = setTimeout(() => {
              if (self._take(id)) {
                self._log('system', `${id} expired unapproved`);
                reject(new Error(`Proposal ${id} expired before the operator acted on it.`));
                self._emit();
              }
            }, self.timeoutMs);
          }

          self._pending.push(proposal);
          self._log('agent', `${id} proposed — ${proposal.summary}`);
          self._emit();
        });
      },
    };
  }

  /**
   * Rebuild the whole registration set. AbortController is how WebMCP
   * unregisters, so the tool surface is a pure function of current state.
   */
  _sync() {
    if (this._controller) this._controller.abort();
    this._controller = new AbortController();
    if (!this.mc) return;

    const signal = this._controller.signal;
    for (const def of this._visibleDefs()) {
      this.mc.registerTool(this._descriptor(def), { signal });
    }

    if (this.exposeHistory) {
      this.mc.registerTool({
        name: 'get_action_history',
        description: 'Read what you and the operator have already done in this session, so you do not repeat or duplicate work.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true },
        execute: async () => JSON.stringify(this._audit.slice(0, 25)),
      }, { signal });
    }
  }

  /** Unregister everything and clear pending proposals. */
  destroy() {
    if (this._controller) this._controller.abort();
    for (const p of this._pending) {
      if (p._timer) clearTimeout(p._timer);
      p._reject(new Error('The page tore down the consent layer.'));
    }
    this._pending = [];
    this._listeners.clear();
  }
}

export function createConsentLayer(opts) {
  return new ConsentLayer(opts);
}
