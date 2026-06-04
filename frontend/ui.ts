// ui.ts — leaf-level UI primitives: toasts, modal show/hide, and the styled
// confirm dialog. No app state, no Wails calls — only DOM.

export type ToastType = 'info' | 'success' | 'warn' | 'error';

export function showToast(msg: string, type: ToastType = 'info', durationMs = 3500): void {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}
// Keep the global alias so inline handlers / debugging keep working.
(window as any).showToast = showToast;

// ── Modal helpers ─────────────────────────────────────────────────────────────

export function showModal(id: string): void {
  document.getElementById(id)?.classList.remove('hidden');
}
export function closeModal(id: string): void {
  document.getElementById(id)?.classList.add('hidden');
}

// ── Confirm dialog ────────────────────────────────────────────────────────────

export interface ConfirmOptions {
  kicker?: string;
  title?: string;
  message?: string;
  okLabel?: string;
}

let _confirmResolve: ((value: boolean) => void) | null = null;

export function showConfirm({ kicker = '', title = '', message = '', okLabel = 'OK' }: ConfirmOptions = {}): Promise<boolean> {
  (document.getElementById('modal-confirm-kicker') as HTMLElement).textContent = kicker;
  (document.getElementById('modal-confirm-title')  as HTMLElement).textContent = title;
  (document.getElementById('modal-confirm-msg')    as HTMLElement).textContent = message;
  (document.getElementById('btn-modal-confirm-ok') as HTMLElement).textContent = okLabel;
  showModal('modal-confirm');
  return new Promise(resolve => { _confirmResolve = resolve; });
}

export function cancelConfirm(): void {
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  closeModal('modal-confirm');
}

// wireConfirmButtons binds the confirm dialog's OK/Cancel buttons. Call once at startup.
export function wireConfirmButtons(): void {
  document.getElementById('btn-modal-confirm-ok')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
  });
  document.getElementById('btn-modal-confirm-cancel')?.addEventListener('click', () => {
    closeModal('modal-confirm');
    if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
  });
}
