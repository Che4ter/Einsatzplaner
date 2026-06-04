// controllers/cloud.ts — Cloud connect/disconnect lifecycle and welcome-screen
// recent-rooms management.

import * as Planner from '../services.js';
import { state } from '../state.js';
import { esc } from '../utils.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { updateSidebarMeta } from './core.js';
import { onPlanLoaded } from './fileops.js';
import * as FirebaseSync from '../sync/index.js';
import {
  getRooms, addRoom, removeRoom, saveRooms,
  getCloudWriteState, resetCloudWriteState,
} from '../sync/index.js';
import { el, on, setText, show, hide } from '../dom.js';

// ── Module-private state ──────────────────────────────────────────────────────

let _newYearTemplatePath: string | null = null;
let _lastRecentPath: string | null = null;

// ── Welcome screen recent rooms ───────────────────────────────────────────────

// A ghosted row signals the room no longer exists on the server.
// Idempotent: safe to call multiple times on the same row element.
function applyGhostedState(row: HTMLElement & { _ghosted?: boolean }): void {
  if (row._ghosted) return;
  row._ghosted = true;
  row.style.opacity = '0.55';
  row.style.borderColor = 'var(--rose-soft)';
  const dot = row.querySelector('span');
  if (dot) { (dot as HTMLElement).style.background = 'var(--rose)'; (dot as HTMLElement).style.opacity = '0.7'; }
  row.querySelectorAll<HTMLButtonElement>('[data-year-chip]').forEach(b => {
    b.disabled = true;
    b.style.pointerEvents = 'none';
    b.style.opacity = '0.35';
  });
  const badge = document.createElement('span');
  badge.style.cssText = 'font-size:10px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--rose);white-space:nowrap;flex-shrink:0;padding:2px 7px;border-radius:99px;background:var(--rose-soft)';
  badge.textContent = 'Gelöscht';
  row.insertBefore(badge, row.lastChild);
}

// Render recent cloud connections on the welcome screen.
// Entries are grouped by room code so multiple years under the same code
// appear as one card with per-year "Laden" buttons.
export function renderWelcomeCloudRecent(): void {
  const recent = getRooms();
  const container = el('welcome-cloud-recent');
  const list = el('welcome-cloud-recent-list');
  if (!container || !list) return;
  if (recent.length === 0) { hide('welcome-cloud-recent'); return; }

  // Group by code (preserve insertion order = most-recent first per code)
  const byCode = new Map<string, { code: string; years: number[] }>();
  recent.forEach(r => {
    if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, years: [] });
    if (r.year && !byCode.get(r.code)!.years.includes(r.year)) byCode.get(r.code)!.years.push(r.year);
  });

  list.innerHTML = '';
  const rowsByCode = new Map<string, HTMLElement & { _ghosted?: boolean }>();

  byCode.forEach(({ code, years }) => {
    const sortedYears = years.slice().sort((a, b) => b - a);

    const row = document.createElement('div') as HTMLElement & { _ghosted?: boolean };
    row.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px 8px 8px 12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);transition:border-color 120ms,opacity 200ms';
    row.addEventListener('mouseenter', () => { if (!row._ghosted) row.style.borderColor = 'var(--line-strong)'; });
    row.addEventListener('mouseleave', () => { if (!row._ghosted) row.style.borderColor = 'var(--line)'; });

    const dot = document.createElement('span');
    dot.style.cssText = 'flex-shrink:0;width:7px;height:7px;border-radius:50%;background:var(--teal);opacity:0.55;margin-right:2px;margin-top:4px';
    row.appendChild(dot);

    const labelWrap = document.createElement('div');
    labelWrap.style.cssText = 'flex:1;min-width:0';
    const label = document.createElement('span');
    label.style.cssText = 'display:block;font-size:11px;font-family:var(--font-mono);color:var(--muted);letter-spacing:0.02em;word-break:break-all;line-height:1.5';
    label.textContent = code;
    const copyBtn = document.createElement('button');
    const copySvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
    copyBtn.title = 'Code kopieren';
    copyBtn.style.cssText = 'display:inline-flex;align-items:center;gap:3px;font-size:10px;color:var(--muted);background:none;border:none;cursor:pointer;padding:1px 4px;border-radius:3px;margin-top:3px;transition:color 120ms,background 120ms';
    copyBtn.innerHTML = copySvg + ' Kopieren';
    copyBtn.addEventListener('mouseenter', () => { copyBtn.style.color = 'var(--teal)'; copyBtn.style.background = 'var(--teal-soft)'; });
    copyBtn.addEventListener('mouseleave', () => { copyBtn.style.color = 'var(--muted)'; copyBtn.style.background = ''; });
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:11px;height:11px"><polyline points="20 6 9 17 4 12"/></svg> Kopiert!`;
        copyBtn.style.color = 'var(--teal)';
        setTimeout(() => { copyBtn.innerHTML = copySvg + ' Kopieren'; copyBtn.style.color = 'var(--muted)'; }, 2000);
      } catch { showToast('Kopieren fehlgeschlagen.', 'error'); }
    });
    labelWrap.appendChild(label);
    labelWrap.appendChild(copyBtn);
    row.appendChild(labelWrap);

    const chipsWrap = document.createElement('div');
    chipsWrap.style.cssText = 'display:flex;gap:4px;flex-shrink:0';
    if (sortedYears.length > 0) {
      sortedYears.forEach(year => {
        const chip = document.createElement('button');
        chip.dataset.yearChip = '1';
        chip.style.cssText = 'font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:99px;background:var(--teal-soft);color:var(--teal);border:1px solid transparent;cursor:pointer;transition:background 120ms,border-color 120ms,opacity 120ms';
        chip.textContent = String(year);
        chip.addEventListener('mouseenter', () => { if (!chip.disabled) { chip.style.background = '#cde3df'; chip.style.borderColor = 'var(--teal)'; } });
        chip.addEventListener('mouseleave', () => { if (!chip.disabled) { chip.style.background = 'var(--teal-soft)'; chip.style.borderColor = 'transparent'; } });
        chip.addEventListener('click', async () => {
          chip.disabled = true;
          chip.style.opacity = '0.5';
          chip.textContent = '…';
          try {
            const plan = await FirebaseSync.connectToCloud(code, year);
            if (plan) {
              addRecentRoom(code, plan.year ?? year);
              await onPlanLoaded(plan);
              applyCloudStatus(await Planner.GetCloudStatus());
              showToast(`Team-Plan ${year} geladen.`, 'success');
            } else {
              const inp = document.getElementById('connect-room-code') as HTMLInputElement | null;
              if (inp) inp.value = code;
              showModal('modal-connect');
            }
          } catch (e) {
            const msg = String(e);
            if (msg.includes('nicht gefunden') || msg.includes('not-found') || msg.includes('permission')) {
              applyGhostedState(row);
              showToast('Dieser Team-Plan existiert nicht mehr.', 'error');
            } else {
              showToast('Verbindung fehlgeschlagen: ' + e, 'error');
              chip.disabled = false;
              chip.style.opacity = '';
              chip.textContent = String(year);
            }
          }
        });
        chipsWrap.appendChild(chip);
      });
    } else {
      const openBtn = document.createElement('button');
      openBtn.dataset.yearChip = '1';
      openBtn.style.cssText = 'font-size:12px;font-weight:500;color:var(--teal);background:none;border:none;cursor:pointer;white-space:nowrap;padding:2px 4px';
      openBtn.textContent = 'Verbinden…';
      openBtn.addEventListener('click', () => {
        const inp = document.getElementById('connect-room-code') as HTMLInputElement | null;
        if (inp) inp.value = code;
        showModal('modal-connect');
      });
      chipsWrap.appendChild(openBtn);
    }
    row.appendChild(chipsWrap);

    const remBtn = document.createElement('button');
    remBtn.title = 'Aus Liste entfernen';
    remBtn.style.cssText = 'flex-shrink:0;width:22px;height:22px;display:flex;align-items:center;justify-content:center;border-radius:4px;color:var(--muted-2);font-size:15px;line-height:1;transition:color 120ms,background 120ms;margin-left:2px';
    remBtn.textContent = '×';
    remBtn.addEventListener('mouseenter', () => { remBtn.style.color = 'var(--rose)'; remBtn.style.background = 'var(--rose-soft)'; });
    remBtn.addEventListener('mouseleave', () => { remBtn.style.color = 'var(--muted-2)'; remBtn.style.background = ''; });
    remBtn.addEventListener('click', () => removeRecentRoom(code));
    row.appendChild(remBtn);

    list.appendChild(row);
    rowsByCode.set(code, row);
  });

  container.style.display = '';

  // Probe each room for server-side existence — always bypasses cache so
  // deleted rooms are reliably detected.
  rowsByCode.forEach((row, code) => {
    FirebaseSync.checkRoomExists(code).then(exists => {
      if (exists === false) applyGhostedState(row);
    }).catch(() => {});
  });
}

export function addRecentRoom(roomCode: string, year: number): void {
  saveRooms(addRoom(getRooms(), roomCode, year));
  renderWelcomeCloudRecent();
}

export function removeRecentRoom(roomCode: string): void {
  saveRooms(removeRoom(getRooms(), roomCode));
  renderWelcomeCloudRecent();
}

// ── Cloud status pill ─────────────────────────────────────────────────────────

export function updateCloudWritePill(): void {
  if (!state.online) return;
  const pill        = el('save-state');
  const label       = el('save-state-label');
  const reconnectBtn = el('btn-pill-reconnect');
  if (!pill || !label) return;
  const { pending, outOfSync } = getCloudWriteState();
  pill.classList.remove('dirty', 'error', 'syncing');
  if (outOfSync) {
    pill.classList.add('error');
    setText('save-state-label', 'Cloud · Sync-Fehler');
    if (reconnectBtn) reconnectBtn.style.display = '';
  } else if (pending > 0) {
    pill.classList.add('syncing');
    setText('save-state-label', 'Cloud · Synchronisiere…');
    if (reconnectBtn) reconnectBtn.style.display = 'none';
  } else {
    setText('save-state-label', 'Cloud · live');
    if (reconnectBtn) reconnectBtn.style.display = 'none';
  }
}

export function applyCloudStatus(status: any): void {
  state.online        = status.isOnline ?? false;
  state.cloudRoomCode = status.roomCode ?? '';
  const btnSave    = el('btn-save');
  const pill       = el('save-state');

  // When online: hide save button (autosave not relevant — direct Firestore write)
  if (btnSave) btnSave.style.display = status.isOnline ? 'none' : '';
  if (status.isOnline && pill)  pill.classList.remove('dirty');
  if (status.isOnline) setText('save-state-label', 'Cloud · live');
  // Reflect any in-flight or failed cloud writes in the pill.
  if (status.isOnline) updateCloudWritePill();

  // Show/hide cloud storage option in the new-year modal
  // Cloud option is always visible when cloud is enabled (not just when online)
  const cloudRow = el('new-year-cloud-row');
  if (cloudRow) cloudRow.style.display = status.cloudEnabled ? '' : 'none';

  // New-year modal: update cloud sub-rows based on connection state
  const nyCodeRow    = el('new-year-cloud-code-row');
  const nyConnRow    = el('new-year-cloud-connected-row');
  const nyCloudRadio = el<HTMLInputElement>('new-year-cloud');
  const cloudSelected = nyCloudRadio?.checked ?? false;
  if (status.isOnline) {
    if (nyCodeRow) nyCodeRow.style.display = 'none';
    if (nyConnRow) { nyConnRow.style.display = cloudSelected ? '' : 'none'; setText('new-year-current-room-code', status.roomCode); }
  } else {
    if (nyCodeRow) nyCodeRow.style.display = cloudSelected ? '' : 'none';
    if (nyConnRow) nyConnRow.style.display = 'none';
  }

  // Show/hide JSON export tab in export modal (available when online)
  const jsonTab = el('export-tab-json');
  if (jsonTab) jsonTab.style.display = status.cloudEnabled ? '' : 'none';
}

// ── Cloud Connect modal ───────────────────────────────────────────────────────

// Render recent local files in the "Bestehenden öffnen" modal.
async function renderModalRecentLocalFiles(): Promise<void> {
  const container = el('connect-local-recent');
  const list      = el('connect-local-recent-list');
  if (!container || !list) return;
  try {
    const paths = await Planner.GetRecentPaths();
    if (!paths || paths.length === 0) { hide('connect-local-recent'); return; }
    list.innerHTML = '';
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() || path;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:7px 10px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);transition:border-color 120ms';
      row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--line-strong)'; });
      row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--line)'; });
      row.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="width:15px;height:15px;flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--ink)" title="${esc(path)}">${esc(name)}</span>
        <button class="dlg-btn primary btn-sm" style="flex-shrink:0">Öffnen</button>`;
      (row.querySelector('.dlg-btn') as HTMLButtonElement).addEventListener('click', async () => {
        closeModal('modal-connect');
        try {
          const plan = await Planner.ReopenPlan(path);
          if (plan) await onPlanLoaded(plan);
        } catch {
          showToast('Datei nicht mehr gefunden.', 'error');
        }
      });
      list.appendChild(row);
    }
    container.style.display = '';
  } catch { hide('connect-local-recent'); }
}

export async function openConnectModal(): Promise<void> {
  const status = await Planner.GetCloudStatus().catch(() => null);
  if (!status) return;

  const cloudSections = el('connect-cloud-sections');
  const statusSec  = el('connect-status-section');
  const formSec    = el('connect-form-section');
  const foot       = el('connect-dlg-foot');
  const errEl      = el('connect-error');
  const yearRow    = el('connect-year-row');

  // Cloud sections only visible when cloud is configured
  if (cloudSections) cloudSections.style.display = status.cloudEnabled ? '' : 'none';

  if (status.isOnline) {
    if (statusSec) statusSec.style.display = '';
    if (formSec)   formSec.style.display   = 'none';
    if (foot)      foot.style.display      = 'none';
    setText('connect-active-code', status.roomCode);
  } else {
    if (statusSec) statusSec.style.display = 'none';
    if (formSec)   formSec.style.display   = '';
    if (foot)      foot.style.display      = status.cloudEnabled ? '' : 'none';
    if (errEl)   { hide('connect-error'); errEl.textContent = ''; }
    if (yearRow) yearRow.style.display = 'none';
  }

  // Render recently used rooms
  const recSec  = el('connect-recent-section');
  const recList = el('connect-recent-list');
  if (recSec && recList) {
    const recent = getRooms();
    if (recent.length > 0 && !status.isOnline) {
      const byCode = new Map<string, { code: string; years: number[] }>();
      recent.forEach(r => {
        if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, years: [] });
        if (r.year && !byCode.get(r.code)!.years.includes(r.year)) byCode.get(r.code)!.years.push(r.year);
      });
      recList.innerHTML = '';
      byCode.forEach(({ code, years }) => {
        const sortedYears = years.slice().sort((a, b) => b - a);
        const yearStr = sortedYears.length > 0 ? sortedYears.join(', ') : '?';
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);transition:border-color 120ms';
        row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--line-strong)'; });
        row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--line)'; });
        const codeSpan = document.createElement('span');
        codeSpan.style.cssText = 'flex:1;min-width:0;font-family:var(--font-mono);font-size:11px;color:var(--muted);word-break:break-all;line-height:1.4';
        codeSpan.textContent = code;
        const yearSpan = document.createElement('span');
        yearSpan.style.cssText = 'font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0';
        yearSpan.textContent = '· ' + yearStr;
        const copyBtn = document.createElement('button');
        const copySvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
        copyBtn.title = 'Kopieren';
        copyBtn.style.cssText = 'flex-shrink:0;display:flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:4px;color:var(--muted-2);transition:color 120ms,background 120ms';
        copyBtn.innerHTML = copySvg;
        copyBtn.addEventListener('mouseenter', () => { copyBtn.style.color = 'var(--teal)'; copyBtn.style.background = 'var(--teal-soft)'; });
        copyBtn.addEventListener('mouseleave', () => { copyBtn.style.color = 'var(--muted-2)'; copyBtn.style.background = ''; });
        copyBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          try {
            await navigator.clipboard.writeText(code);
            copyBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width:12px;height:12px"><polyline points="20 6 9 17 4 12"/></svg>`;
            setTimeout(() => { copyBtn.innerHTML = copySvg; copyBtn.style.color = 'var(--muted-2)'; }, 2000);
          } catch { showToast('Kopieren fehlgeschlagen.', 'error'); }
        });
        const useBtn = document.createElement('button');
        useBtn.className = 'dlg-btn secondary';
        useBtn.style.cssText = 'flex-shrink:0;font-size:11px;padding:3px 8px';
        useBtn.textContent = 'Verwenden';
        useBtn.addEventListener('click', () => {
          const inp = el<HTMLInputElement>('connect-room-code');
          if (inp) { inp.value = code; inp.focus(); }
        });
        row.appendChild(codeSpan);
        row.appendChild(yearSpan);
        row.appendChild(copyBtn);
        row.appendChild(useBtn);
        recList.appendChild(row);
      });
      show('connect-recent-section');
    } else {
      hide('connect-recent-section');
    }
  }
  renderModalRecentLocalFiles();
  showModal('modal-connect');
}

// Render recent cloud rooms as quick-pick buttons in the new-year modal cloud section.
export function renderNewYearRecentRooms(): void {
  const container = el('new-year-recent-rooms');
  const list      = el('new-year-recent-rooms-list');
  if (!container || !list) return;
  const recent = getRooms();
  if (recent.length === 0) { hide('new-year-recent-rooms'); return; }

  const byCode = new Map<string, { code: string; years: number[] }>();
  recent.forEach(r => {
    if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, years: [] });
    if (r.year && !byCode.get(r.code)!.years.includes(r.year)) byCode.get(r.code)!.years.push(r.year);
  });

  list.innerHTML = '';
  byCode.forEach(({ code, years }) => {
    const sortedYears = years.slice().sort((a: number, b: number) => b - a);
    const yearStr = sortedYears.length > 0 ? sortedYears.join(', ') : '?';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:6px;padding:5px 8px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);transition:border-color 120ms';
    row.addEventListener('mouseenter', () => { row.style.borderColor = 'var(--line-strong)'; });
    row.addEventListener('mouseleave', () => { row.style.borderColor = 'var(--line)'; });
    const codeSpan = document.createElement('span');
    codeSpan.style.cssText = 'flex:1;min-width:0;font-family:var(--font-mono);font-size:11px;color:var(--muted);word-break:break-all;line-height:1.4';
    codeSpan.textContent = code;
    const yearSpan = document.createElement('span');
    yearSpan.style.cssText = 'font-size:11px;color:var(--muted);white-space:nowrap;flex-shrink:0';
    yearSpan.textContent = '· ' + yearStr;
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'dlg-btn secondary';
    useBtn.style.cssText = 'flex-shrink:0;font-size:11px;padding:3px 8px';
    useBtn.textContent = 'Verwenden';
    useBtn.addEventListener('click', () => {
      const inp = el<HTMLInputElement>('new-year-room-code');
      if (inp) { inp.value = code; inp.focus(); }
    });
    row.appendChild(codeSpan);
    row.appendChild(yearSpan);
    row.appendChild(useBtn);
    list.appendChild(row);
  });
  container.style.display = '';
}

export async function doConnect(): Promise<void> {
  const codeInput = el<HTMLInputElement>('connect-room-code');
  const errEl     = el('connect-error');
  const roomCode  = (codeInput?.value ?? '').trim();

  if (errEl) { hide('connect-error'); errEl.textContent = ''; }

  if (!roomCode) {
    if (errEl) { errEl.textContent = 'Bitte einen Zugangscode eingeben.'; show('connect-error'); }
    return;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(roomCode)) {
    if (errEl) { errEl.textContent = 'Ungültiger Zugangscode (kein gültiges UUID-Format).'; show('connect-error'); }
    return;
  }

  try {
    // Probe the room for available years (year=0 → no Go-side commit yet)
    const plan = await FirebaseSync.connectToCloud(roomCode, 0);

    if (plan) {
      // Shouldn't happen (year=0 always returns null) but handle defensively
      addRecentRoom(roomCode, plan.year ?? 0);
      closeModal('modal-connect');
      await onPlanLoaded(plan);
      showToast('Cloud verbunden.', 'success');
      return;
    }

    // No plan yet — show year picker
    const years = await FirebaseSync.getAvailableYears(roomCode).catch(() => [] as number[]);
    const yearRow    = el('connect-year-row');
    const yearSelect = el<HTMLSelectElement>('connect-year-select');
    const foot       = el('connect-dlg-foot');

    foot!.style.display = 'none';
    yearRow!.style.display = '';
    yearSelect!.innerHTML = '';
    if (years.length > 0) {
      years.sort((a: number, b: number) => b - a).forEach((y: number) => {
        const opt = document.createElement('option');
        opt.value = String(y);
        opt.textContent = String(y);
        yearSelect!.appendChild(opt);
      });
    }
    const newOpt = document.createElement('option');
    newOpt.value = 'new';
    newOpt.textContent = '+ Neues Jahr';
    yearSelect!.appendChild(newOpt);

  } catch (e) {
    if (errEl) {
      errEl.textContent = 'Verbindung fehlgeschlagen: ' + e;
      show('connect-error');
    }
  }
}

export async function doLoadCloudYear(): Promise<void> {
  const yearSelect = el<HTMLSelectElement>('connect-year-select');
  const val = yearSelect?.value;
  if (!val) return;

  if (val === 'new') {
    closeModal('modal-connect');
    resetNewYearModal();
    const cloudRadio = el<HTMLInputElement>('new-year-cloud');
    if (cloudRadio) cloudRadio.checked = true;
    showModal('modal-new-year');
    return;
  }

  const year = parseInt(val, 10);
  try {
    // Use the room code stored during the probe step (doConnect), not Go's state —
    // ConnectCloud on the Go side hasn't been called yet at this point.
    const roomCode = FirebaseSync.getLastProbedRoomCode() || (await Planner.GetCloudStatus()).roomCode;
    const plan = await FirebaseSync.connectToCloud(roomCode, year);
    closeModal('modal-connect');
    if (plan) {
      addRecentRoom(roomCode, year);
      await onPlanLoaded(plan);
      applyCloudStatus(await Planner.GetCloudStatus());
      showToast(`Cloud-Plan ${year} geladen.`, 'success');
    }
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export async function doDisconnect(): Promise<void> {
  try {
    FirebaseSync.disconnectFromCloud();
    await Planner.DisconnectCloud();
    resetCloudWriteState();
    const status = await Planner.GetCloudStatus();
    applyCloudStatus(status);
    closeModal('modal-connect');
    showToast('Verbindung getrennt.', 'success');
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

// ── New-year modal ────────────────────────────────────────────────────────────

export function resetNewYearModal(): void {
  _newYearTemplatePath = null;
  setText('template-file-label', '');
  const preview = el('template-preview');
  if (preview) { hide('template-preview'); preview.textContent = ''; }
  hide('new-year-include-events-row');
  const evCb = el<HTMLInputElement>('new-year-include-events');
  if (evCb) evCb.checked = false;
  const localRadio = el<HTMLInputElement>('new-year-local');
  if (localRadio) localRadio.checked = true;
  hide('new-year-cloud-code-row');
  hide('new-year-recent-rooms');
  const nyCodeInput = el<HTMLInputElement>('new-year-room-code');
  if (nyCodeInput) nyCodeInput.value = '';
  hide('new-year-cloud-connected-row');
  // Reset use-last checkbox
  const useLast = el<HTMLInputElement>('new-year-use-last');
  if (useLast) useLast.checked = false;
  initNewYearUseLast();
}

export function toggleUseLastPlan(checked: boolean): void {
  const lbl = el('template-file-label');
  const evRow = el('new-year-include-events-row');
  if (checked && _lastRecentPath) {
    _newYearTemplatePath = _lastRecentPath;
    if (lbl) lbl.textContent = '';
    if (evRow) evRow.style.display = '';
  } else if (!checked) {
    _newYearTemplatePath = null;
    if (lbl) lbl.textContent = '';
    hide('new-year-include-events-row');
    const evCb = el<HTMLInputElement>('new-year-include-events');
    if (evCb) evCb.checked = false;
  }
}

export async function initNewYearUseLast(): Promise<void> {
  const row = el('new-year-use-last-row');
  if (!row) return;
  try {
    const paths = await Planner.GetRecentPaths();
    if (!paths || paths.length === 0) { hide('new-year-use-last-row'); return; }
    _lastRecentPath = paths[0];
    const name = paths[0].split(/[/\\]/).pop() || paths[0];
    setText('new-year-use-last-name', `(${name})`);
    row.style.display = '';
  } catch { hide('new-year-use-last-row'); }
}

export async function pickTemplateFile(): Promise<void> {
  try {
    const path = await Planner.PickTemplateFile();
    if (!path) return;
    _newYearTemplatePath = path;
    const useLast = el<HTMLInputElement>('new-year-use-last');
    if (useLast) useLast.checked = false;
    const lbl = el('template-file-label');
    if (lbl) lbl.textContent = path.split('/').pop()!.split('\\').pop()!;
    const preview = el('template-preview');
    if (preview) { preview.textContent = `Pfad: ${path}`; preview.style.display = 'block'; }
    const evRow = el('new-year-include-events-row');
    if (evRow) evRow.style.display = '';
  } catch (e) {
    showToast('Fehler beim Auswählen: ' + e, 'error');
  }
}

export async function confirmNewYear(): Promise<void> {
  const yearInput = document.getElementById('input-new-year') as HTMLInputElement | null;
  const year = parseInt(yearInput?.value ?? '', 10);
  if (!year || year < 2020 || year > 2099) {
    if (yearInput) yearInput.style.borderColor = 'var(--rose)';
    return;
  }
  try {
    let plan;
    const includeEvents = (document.getElementById('new-year-include-events') as HTMLInputElement | null)?.checked ?? false;
    if (_newYearTemplatePath) {
      plan = await Planner.CreatePlanFromTemplate(year, _newYearTemplatePath, includeEvents);
    } else {
      plan = await Planner.CreatePlan(year);
    }
    if (!plan) return;
    closeModal('modal-new-year');
    resetNewYearModal();
    await onPlanLoaded(plan);
    showToast(`Einsatzplan ${year} erstellt.`, 'success');
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export async function confirmNewYearWithCloud(): Promise<void> {
  const cloudRadio = document.getElementById('new-year-cloud') as HTMLInputElement | null;
  if (cloudRadio?.checked) {
    const yearInput = document.getElementById('input-new-year') as HTMLInputElement | null;
    const year = parseInt(yearInput?.value ?? '', 10);
    if (!year || year < 2020 || year > 2099) {
      if (yearInput) yearInput.style.borderColor = 'var(--rose)';
      return;
    }
    // If not yet connected, use the room code entered in this modal.
    let roomCode = state.cloudRoomCode ?? '';
    if (!state.online) {
      const codeInput = document.getElementById('new-year-room-code') as HTMLInputElement | null;
      roomCode = (codeInput?.value ?? '').trim();
    }
    if (!roomCode) {
      showToast('Bitte einen Raum-Code eingeben oder generieren.', 'error');
      return;
    }
    const includeEvents = (document.getElementById('new-year-include-events') as HTMLInputElement | null)?.checked ?? false;
    const templatePath  = _newYearTemplatePath ?? '';
    const confirmBtn2 = document.getElementById('btn-modal-new-confirm') as HTMLButtonElement | null;
    if (confirmBtn2) { confirmBtn2.disabled = true; confirmBtn2.textContent = 'Wird erstellt…'; }
    try {
      const plan = await Planner.CreateCloudPlan(year, roomCode, templatePath, includeEvents);
      if (!plan) { if (confirmBtn2) { confirmBtn2.disabled = false; confirmBtn2.textContent = 'Erstellen & Speichern'; } return; }
      if (roomCode && !state.online) addRecentRoom(roomCode, year);

      // Bootstrap Firestore: write meta+events BEFORE subscribing so that the
      // onSnapshot listeners in connectToCloud see the full initial data and
      // SyncFullPlan receives a complete plan rather than an empty skeleton.
      FirebaseSync.setRoomContext(roomCode, year);
      await FirebaseSync.dbAddYearToRoom(roomCode, year);
      await FirebaseSync.dbSaveMeta({
        settings: plan.settings || {},
        team: plan.team || [],
        version: plan.version || 1,
        year: year,
      });
      if (plan.months) {
        for (let m = 1; m <= 12; m++) {
          if ((plan.months as any)[m]?.events) {
            for (const ev of (plan.months as any)[m].events) {
              // dbSaveEventFull preserves assignedStaff — safe here because no
              // other clients are connected yet during initial plan creation.
              await FirebaseSync.dbSaveEventFull(m, ev);
            }
          }
        }
      }
      // Now subscribe — onSnapshot will fire with the data we just wrote.
      await FirebaseSync.connectToCloud(roomCode, year);

      closeModal('modal-new-year');
      resetNewYearModal();
      await onPlanLoaded(plan);
      applyCloudStatus(await Planner.GetCloudStatus().catch(() => ({})));
      showToast(`Cloud-Jahresplan ${year} erstellt.`, 'success');
    } catch (e) {
      showToast('Fehler: ' + e, 'error');
    } finally {
      if (confirmBtn2) { confirmBtn2.disabled = false; confirmBtn2.textContent = 'Erstellen & Speichern'; }
    }
    return;
  }
  await confirmNewYear();
}
