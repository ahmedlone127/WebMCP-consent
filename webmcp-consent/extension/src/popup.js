const $list = document.getElementById('list');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function render(pending) {
  if (!pending.length) {
    $list.innerHTML = '<div class="empty">Nothing waiting on you.</div>';
    return;
  }
  $list.innerHTML = pending.map((p) => `
    <div class="card">
      <div class="card-head"><span class="tool">${esc(p.tool)}</span></div>
      <div class="site">${esc(p.pageTitle || '')} — ${esc(p.pageUrl || '')}</div>
      <div class="desc">${esc(p.description)}</div>
      <div class="input">${esc(JSON.stringify(p.input, null, 2))}</div>
      <div class="acts">
        <button class="ok" data-action="approve" data-id="${esc(p.id)}">Approve</button>
        <button class="no" data-action="decline" data-id="${esc(p.id)}">Decline</button>
      </div>
    </div>`).join('');
}

function refresh() {
  chrome.runtime.sendMessage({ type: 'GET_PENDING' }, (res) => {
    render((res && res.pending) || []);
  });
}

$list.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const id = btn.dataset.id;
  const approved = btn.dataset.action === 'approve';
  chrome.runtime.sendMessage(
    { type: 'DECIDE', id, approved, reason: approved ? undefined : 'The operator declined this action.' },
    () => refresh()
  );
});

refresh();
const timer = setInterval(refresh, 1000);
window.addEventListener('unload', () => clearInterval(timer));
