// controllers/cloud.ts — Cloud connect/disconnect lifecycle and welcome-screen
// recent-rooms management.

import * as Planner from '../services.js';
import { state } from '../state.js';
import { esc } from '../utils.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { updateSidebarMeta } from './core.js';
import { onPlanLoaded } from './fileops.js';
import { navigateToMonth } from './navigation.js';
import * as FirebaseSync from '../sync/index.js';
import {
  getRooms, addRoom, removeRoom, saveRooms,
  getCloudWriteState, resetCloudWriteState,
} from '../sync/index.js';

// ── Module-private state ──────────────────────────────────────────────────────

let _newYearTemplatePath: string | null = null;

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
  const container = document.getElementById('welcome-cloud-recent');
  const list = document.getElementById('welcome-cloud-recent-list');
  if (!container || !list) return;
  if (recent.length === 0) { container.style.display = 'none'; return; }

  // Group by code (preserve insertion order = most-recent first per code)
  const byCode = new Map<string, { code: string; years: number[] }>();
  recent.forEach(r => {
    if (!byCode.has(r.code)) byCode.set(r.code, { code: r.code, years: [] });
    if (r.year && !byCode.get(r.code)!.years.includes(r.year)) byCode.get(r.code)!.years.push(r.year);
  });

  list.innerHTML = '';
  const rowsByCode = new Map<string, HTMLElement & { _ghosted?: boolean }>();

  byCode.forEach(({ code, years }) => {
    const shortCode = code.slice(0, 8) + '…';
    const sortedYears = years.slice().sort((a, b) => b - a);

    const row = document.createElement('div') as HTMLElement & { _ghosted?: boolean };
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px 8px 8px 12px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);transition:border-color 120ms,opacity 200ms';
    row.addEventListener('mouseenter', () => { if (!row._ghosted) row.style.borderColor = 'var(--line-strong)'; });
    row.addEventListener('mouseleave', () => { if (!row._ghosted) row.style.borderColor = 'var(--line)'; });

    const dot = document.createElement('span');
    dot.style.cssText = 'flex-shrink:0;width:7px;height:7px;border-radius:50%;background:var(--teal);opacity:0.55;margin-right:2px';
    row.appendChild(dot);

    const label = document.createElement('span');
    label.title = code;
    label.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-family:var(--font-mono);color:var(--muted);letter-spacing:0.02em';
    label.textContent = shortCode;
    row.appendChild(label);

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
  const pill  = document.getElementById('save-state');
  const label = document.getElementById('save-state-label');
  if (!pill || !label) return;
  const { pending, outOfSync } = getCloudWriteState();
  pill.classList.remove('dirty', 'error', 'syncing');
  if (outOfSync) {
    pill.classList.add('error');
    label.textContent = 'Cloud · Sync-Fehler';
  } else if (pending > 0) {
    pill.classList.add('syncing');
    label.textContent = 'Cloud · Synchronisiere…';
  } else {
    label.textContent = 'Cloud · live';
  }
}

export function applyCloudStatus(status: any): void {
  state.online        = status.isOnline ?? false;
  state.cloudRoomCode = status.roomCode ?? '';
  const btnConnect = document.getElementById('btn-connect');
  const badge      = document.getElementById('cloud-badge');
  const btnSave    = document.getElementById('btn-save');
  const pill       = document.getElementById('save-state');
  const label      = document.getElementById('save-state-label');

  // Show connect button only when cloud is configured in the binary
  if (btnConnect) {
    btnConnect.style.display = status.cloudEnabled ? '' : 'none';
    btnConnect.classList.toggle('cloud-online', status.isOnline);
  }
  if (badge) {
    badge.style.display = status.isOnline ? '' : 'none';
    badge.title = status.isOnline ? `Verbunden · Zugangscode: ${status.roomCode}` : '';
  }
  // When online: hide save button (autosave not relevant — direct Firestore write)
  if (btnSave) btnSave.style.display = status.isOnline ? 'none' : '';
  if (status.isOnline && pill)  pill.classList.remove('dirty');
  if (status.isOnline && label) label.textContent = 'Cloud · live';
  // Reflect any in-flight or failed cloud writes in the pill.
  if (status.isOnline) updateCloudWritePill();

  // Show/hide cloud storage option in the new-year modal
  // Cloud option is always visible when cloud is enabled (not just when online)
  const cloudRow = document.getElementById('new-year-cloud-row');
  if (cloudRow) cloudRow.style.display = status.cloudEnabled ? '' : 'none';

  // Welcome screen cloud button
  const btnWelcomeCloud = document.getElementById('btn-welcome-cloud');
  if (btnWelcomeCloud) btnWelcomeCloud.style.display = status.cloudEnabled ? '' : 'none';

  // New-year modal: update cloud sub-rows based on connection state
  const nyCodeRow    = document.getElementById('new-year-cloud-code-row');
  const nyConnRow    = document.getElementById('new-year-cloud-connected-row');
  const nyCodeSpan   = document.getElementById('new-year-current-room-code');
  const nyCloudRadio = document.getElementById('new-year-cloud') as HTMLInputElement | null;
  const cloudSelected = nyCloudRadio?.checked ?? false;
  if (status.isOnline) {
    if (nyCodeRow) nyCodeRow.style.display = 'none';
    if (nyConnRow) { nyConnRow.style.display = cloudSelected ? '' : 'none'; if (nyCodeSpan) nyCodeSpan.textContent = status.roomCode; }
  } else {
    if (nyCodeRow) nyCodeRow.style.display = cloudSelected ? '' : 'none';
    if (nyConnRow) nyConnRow.style.display = 'none';
  }

  // Show/hide JSON export tab in export modal (available when online)
  const jsonTab = document.getElementById('export-tab-json');
  if (jsonTab) jsonTab.style.display = status.cloudEnabled ? '' : 'none';
}

// ── Cloud Connect modal ───────────────────────────────────────────────────────

export async function openConnectModal(): Promise<void> {
  const status = await Planner.GetCloudStatus().catch(() => null);
  if (!status) return;

  const statusSec  = document.getElementById('connect-status-section');
  const formSec    = document.getElementById('connect-form-section');
  const foot       = document.getElementById('connect-dlg-foot');
  const activeCode = document.getElementById('connect-active-code');
  const errEl      = document.getElementById('connect-error');
  const yearRow    = document.getElementById('connect-year-row');

  if (status.isOnline) {
    statusSec!.style.display = '';
    formSec!.style.display   = 'none';
    foot!.style.display      = 'none';
    if (activeCode) activeCode.textContent = status.roomCode;
  } else {
    statusSec!.style.display = 'none';
    formSec!.style.display   = '';
    foot!.style.display      = '';
    if (errEl)   { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (yearRow) yearRow.style.display = 'none';
  }

  // Render recently used rooms
  const recSec  = document.getElementById('connect-recent-section');
  const recList = document.getElementById('connect-recent-list');
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
        const btn = document.createElement('button');
        btn.className = 'dlg-btn secondary';
        btn.style.cssText = 'text-align:left;font-family:var(--font-mono);font-size:12px;padding:6px 10px';
        btn.innerHTML = `${esc(code.substring(0, 8))}… <span style="color:var(--muted);font-weight:400">· ${esc(yearStr)}</span>`;
        btn.addEventListener('click', () => {
          const inp = document.getElementById('connect-room-code') as HTMLInputElement | null;
          if (inp) inp.value = code;
        });
        recList.appendChild(btn);
      });
      recSec.style.display = '';
    } else {
      recSec.style.display = 'none';
    }
  }
  showModal('modal-connect');
}

export async function doConnect(): Promise<void> {
  const codeInput = document.getElementById('connect-room-code') as HTMLInputElement | null;
  const errEl     = document.getElementById('connect-error');
  const roomCode  = (codeInput?.value ?? '').trim();

  if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }

  if (!roomCode) {
    if (errEl) { errEl.textContent = 'Bitte einen Zugangscode eingeben.'; errEl.style.display = ''; }
    return;
  }

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(roomCode)) {
    if (errEl) { errEl.textContent = 'Ungültiger Zugangscode (kein gültiges UUID-Format).'; errEl.style.display = ''; }
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
    const yearRow    = document.getElementById('connect-year-row');
    const yearSelect = document.getElementById('connect-year-select') as HTMLSelectElement | null;
    const foot       = document.getElementById('connect-dlg-foot');

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
      errEl.style.display = '';
    }
  }
}

export async function doLoadCloudYear(): Promise<void> {
  const yearSelect = document.getElementById('connect-year-select') as HTMLSelectElement | null;
  const val = yearSelect?.value;
  if (!val) return;

  if (val === 'new') {
    closeModal('modal-connect');
    resetNewYearModal();
    const cloudRadio = document.getElementById('new-year-cloud') as HTMLInputElement | null;
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
  const lbl = document.getElementById('template-file-label');
  if (lbl) lbl.textContent = 'Kein Vorlage gewählt';
  const preview = document.getElementById('template-preview');
  if (preview) { preview.style.display = 'none'; preview.textContent = ''; }
  const evRow = document.getElementById('new-year-include-events-row');
  if (evRow) evRow.style.display = 'none';
  const evCb = document.getElementById('new-year-include-events') as HTMLInputElement | null;
  if (evCb) evCb.checked = false;
  const localRadio = document.getElementById('new-year-local') as HTMLInputElement | null;
  if (localRadio) localRadio.checked = true;
  const nyCodeRow = document.getElementById('new-year-cloud-code-row');
  if (nyCodeRow) nyCodeRow.style.display = 'none';
  const nyCodeInput = document.getElementById('new-year-room-code') as HTMLInputElement | null;
  if (nyCodeInput) nyCodeInput.value = '';
  const nyConnRow = document.getElementById('new-year-cloud-connected-row');
  if (nyConnRow) nyConnRow.style.display = 'none';
}

export async function pickTemplateFile(): Promise<void> {
  try {
    const path = await Planner.PickTemplateFile();
    if (!path) return;
    _newYearTemplatePath = path;
    const lbl = document.getElementById('template-file-label');
    if (lbl) lbl.textContent = path.split('/').pop()!.split('\\').pop()!;
    const preview = document.getElementById('template-preview');
    if (preview) { preview.textContent = `Pfad: ${path}`; preview.style.display = 'block'; }
    const evRow = document.getElementById('new-year-include-events-row');
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
