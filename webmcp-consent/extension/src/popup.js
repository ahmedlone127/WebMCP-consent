const $list = document.getElementById('list');
const $allowed = document.getElementById('allowed');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isPending = tab.dataset.tab === 'pending';
    $list.style.display = isPending ? '' : 'none';
    $allowed.style.display = isPending ? 'none' : '';
    if (!isPending) refreshAllowed();
  });
});

function renderPending(pending) {
  if (!pending.length) {
    $list.innerHTML = '<div class="empty">Nothing waiting on you.</div>';
    return;
  }
  $list.innerHTML = pending.map((p) => `
    <div class="card">
      <div class="card-head">
        <span class="tool">${esc(p.tool)}</span>
        <span class="score${p.score >= 5 ? ' hi' : ''}">risk ${esc(p.score)}</span>
      </div>
      <div class="site">${esc(p.pageTitle || '')} — ${esc(p.pageUrl || '')}</div>
      <div class="desc">${esc(p.description)}</div>
      <div class="input">${esc(JSON.stringify(p.input, null, 2))}</div>
      <div class="acts">
        <button class="ok" data-action="approve" data-id="${esc(p.id)}">Approve</button>
        ${p.kind === 'tool' && p.key ? `<button data-action="approve-always" data-id="${esc(p.id)}">Approve & Always Allow</button>` : ''}
        <button class="no" data-action="decline" data-id="${esc(p.id)}">Decline</button>
      </div>
    </div>`).join('');
}

function renderAllowed(whitelist) {
  const entries = Object.entries(whitelist || {});
  if (!entries.length) {
    $allowed.innerHTML = '<div class="empty">Nothing whitelisted yet.</div>';
    return;
  }
  $allowed.innerHTML = entries.map(([key, meta]) => `
    <div class="allow-row">
      <span><div class="allow-name">${esc(meta.tool || key)}</div><div class="allow-site">${esc(meta.pageUrl || '')}</div></span>
      <button data-action="revoke" data-key="${esc(key)}">Require approval again</button>
    </div>`).join('');
}

function refreshPending() {
  chrome.runtime.sendMessage({ type: 'GET_PENDING' }, (res) => renderPending((res && res.pending) || []));
}

function refreshAllowed() {
  chrome.runtime.sendMessage({ type: 'GET_WHITELIST' }, (res) => renderAllowed((res && res.whitelist) || {}));
}

$list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const action = btn.dataset.action;
  const approved = action === 'approve' || action === 'approve-always';
  chrome.runtime.sendMessage(
    // No reason string: the interceptor owns the wording the agent sees, and
    // a generic one here only ends up duplicated inside it.
    { type: 'DECIDE', id, approved, alwaysAllow: action === 'approve-always' },
    () => refreshPending()
  );
});

$allowed.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="revoke"]');
  if (!btn) return;
  chrome.runtime.sendMessage({ type: 'REMOVE_WHITELIST', key: btn.dataset.key }, () => refreshAllowed());
});

refreshPending();
const timer = setInterval(refreshPending, 1000);
window.addEventListener('unload', () => clearInterval(timer));
