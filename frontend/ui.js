// ═══════════════════════════════════════════════════════════════════════════
// ui.js — leaf-level UI primitives: toasts, modal show/hide, and the styled
// confirm dialog. No app state, no Wails calls — only DOM. Extracted from app.js
// so the interaction-heavy core shrinks and these can be reused/tested in
// isolation.
// ═══════════════════════════════════════════════════════════════════════════

// showToast renders a transient toast. Also exposed on window for any non-module
// callers. durationMs controls how long it stays (default 3.5s).
export function showToast(msg, type = 'info', durationMs = 3500) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}
// Keep the global alias so inline handlers / debugging keep working.
window.showToast = showToast;

// ── Modal helpers ─────────────────────────────────────────────────────────────

export function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
export function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// Shows a styled confirm dialog. Returns a Promise<boolean> that resolves true
// on OK and false on Cancel.
let _confirmResolve = null;
export function showConfirm({ kicker = '', title = '', message = '', okLabel = 'OK' } = {}) {
  document.getElementById('modal-confirm-kicker').textContent = kicker;
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-msg').textContent = message;
  document.getElementById('btn-modal-confirm-ok').textContent = okLabel;
  showModal('modal-confirm');
  return new Promise(resolve => { _confirmResolve = resolve; });
}

// Cancels any in-flight confirm dialog (Escape key handler calls this).
export function cancelConfirm() {
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  closeModal('modal-confirm');
}

// wireConfirmButtons binds the confirm dialog's OK/Cancel buttons. Call once at
// startup (after the DOM is parsed).
export function wireConfirmButtons() {
  document.getElementById('btn-modal-confirm-ok')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
  });
  document.getElementById('btn-modal-confirm-cancel')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  });
}
