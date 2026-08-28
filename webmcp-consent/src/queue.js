/**
 * Approval queue UI. Zero dependencies, light DOM, themeable via CSS vars.
 *
 * The buttons live in the page, not in the agent's conversation. Text injected
 * into your data can reach the agent. It cannot reach this element.
 */

const STYLE_ID = 'webmcp-consent-styles';

const CSS = `
.wmc-q{font:14px/1.5 var(--wmc-font,system-ui,sans-serif);color:var(--wmc-ink,#1b1f24)}
.wmc-empty{color:var(--wmc-muted,#8a939d);padding:18px 0;text-align:center;font-size:13px}
.wmc-card{border:1px solid var(--wmc-line,#dde2e8);border-left:3px solid var(--wmc-accent,#b4690e);
  background:var(--wmc-accent-bg,#fdf4e5);padding:12px;margin:10px 0}
.wmc-head{display:flex;justify-content:space-between;gap:10px;align-items:baseline;margin-bottom:8px}
.wmc-title{font-weight:600}
.wmc-id{font:11px var(--wmc-mono,ui-monospace,monospace);color:var(--wmc-muted,#8a939d)}
.wmc-diff{font:11px/1.7 var(--wmc-mono,ui-monospace,monospace);background:var(--wmc-surface,#fff);
  border:1px solid var(--wmc-line,#dde2e8);padding:8px;margin:8px 0}
.wmc-diff div{display:flex;gap:10px}
.wmc-k{color:var(--wmc-muted,#8a939d);min-width:110px}
.wmc-before{color:var(--wmc-danger,#a32626);text-decoration:line-through}
.wmc-after{color:var(--wmc-ok,#0f6d68)}
.wmc-warn{font-size:12px;color:var(--wmc-accent,#b4690e);margin:6px 0 10px}
.wmc-reason{font-size:12px;color:var(--wmc-muted,#8a939d);font-style:italic;margin:6px 0 10px}
.wmc-acts{display:flex;gap:8px}
.wmc-btn{font:13px inherit;padding:6px 13px;border:1px solid var(--wmc-line,#dde2e8);
  background:var(--wmc-surface,#fff);color:inherit;cursor:pointer;border-radius:3px}
.wmc-btn:hover{border-color:var(--wmc-muted,#8a939d)}
.wmc-btn:focus-visible{outline:2px solid currentColor;outline-offset:2px}
.wmc-ok{background:var(--wmc-ok,#0f6d68);border-color:var(--wmc-ok,#0f6d68);color:#fff}
.wmc-no{border-color:var(--wmc-danger,#a32626);color:var(--wmc-danger,#a32626)}
.wmc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

function injectStyles() {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Render a consent layer's pending queue into an element.
 *
 * @param {ConsentLayer} layer
 * @param {string|Element} target  Selector or element.
 * @param {object} [opts]
 * @param {string} [opts.emptyText]
 * @returns {Function} unmount
 */
export function mountApprovalQueue(layer, target, opts = {}) {
  injectStyles();
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) throw new Error(`[webmcp-consent] mount target not found: ${target}`);

  root.classList.add('wmc-q');
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Actions awaiting your approval');
  root.setAttribute('aria-live', 'polite');

  const emptyText = opts.emptyText ?? 'Nothing waiting on you.';

  function draw() {
    const items = layer.pending;
    if (!items.length) {
      root.innerHTML = `<div class="wmc-empty">${esc(emptyText)}</div>`;
      return;
    }
    root.innerHTML = items.map((p) => `
      <div class="wmc-card">
        <div class="wmc-head">
          <span class="wmc-title">${esc(p.summary)}</span>
          <span class="wmc-id">${esc(p.id)}</span>
        </div>
        <div class="wmc-diff">
          ${p.diff.map((d) => `<div>
            <span class="wmc-k">${esc(d.field)}</span>
            ${d.before !== undefined ? `<span class="wmc-before">${esc(d.before)}</span>` : ''}
            <span class="wmc-after">${esc(d.after)}</span>
          </div>`).join('')}
          <div><span class="wmc-k">records touched</span><span>${esc(p.blastRadius)}</span></div>
          <div><span class="wmc-k">reversible</span><span>${p.reversible ? 'yes' : 'no'}</span></div>
        </div>
        ${p.reversible ? '' : '<div class="wmc-warn">This cannot be undone once approved.</div>'}
        ${p.reason ? `<div class="wmc-reason">Agent's reason: ${esc(p.reason)}</div>` : ''}
        <div class="wmc-acts">
          <button class="wmc-btn wmc-ok" data-wmc-approve="${esc(p.id)}">Approve</button>
          <button class="wmc-btn wmc-no" data-wmc-decline="${esc(p.id)}">Decline</button>
        </div>
        <span class="wmc-sr">The agent is blocked on this until you choose.</span>
      </div>`).join('');
  }

  function onClick(e) {
    const a = e.target.closest('[data-wmc-approve]');
    const d = e.target.closest('[data-wmc-decline]');
    if (a) layer.approve(a.dataset.wmcApprove);
    else if (d) layer.decline(d.dataset.wmcDecline);
  }

  root.addEventListener('click', onClick);
  const unsub = layer.subscribe(draw);
  draw();

  return function unmount() {
    root.removeEventListener('click', onClick);
    unsub();
    root.innerHTML = '';
  };
}

/** Render the audit log into an element. Useful for the demo and for debugging. */
export function mountAuditLog(layer, target, { limit = 20 } = {}) {
  injectStyles();
  const root = typeof target === 'string' ? document.querySelector(target) : target;
  if (!root) throw new Error(`[webmcp-consent] mount target not found: ${target}`);

  function draw() {
    const rows = layer.audit.slice(0, limit);
    root.innerHTML = rows.length
      ? `<div style="font:11px/1.8 var(--wmc-mono,ui-monospace,monospace)">${rows.map((e) => `
          <div><span style="color:var(--wmc-muted,#8a939d)">${esc(e.at.slice(11, 19))}</span>
          <span style="margin:0 8px">${esc(e.actor)}</span>${esc(e.text)}</div>`).join('')}</div>`
      : '<div class="wmc-empty">No activity yet.</div>';
  }

  const unsub = layer.subscribe(draw);
  draw();
  return function unmount() { unsub(); root.innerHTML = ''; };
}
