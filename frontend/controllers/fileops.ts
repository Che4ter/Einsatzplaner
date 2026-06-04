// controllers/fileops.ts — file lifecycle and page-refresh orchestration.
// Imports: leaf modules + core.js + navigation.js (dependency order is respected).

import * as Planner from '../services.js';
import type { YearPlan } from '../services.js';
import { state, setAutosavePaused } from '../state.js';
import { showToast, showConfirm } from '../ui.js';
import { esc } from '../utils.js';
import { resetCloudWriteState, disconnectFromCloud } from '../sync/index.js';
import { el, setText, setHtml, show, hide } from '../dom.js';
import {
  setAutosaveLocal,
  handleSaveConflict,
  setDirtyUI,
  hideExternalChangeBanner,
  showExternalChangeBanner,
  updateSidebarMeta,
  showPage,
} from './core.js';
import {
  navigateToMonth,
  showStatisticsPage,
  showSettingsPage,
  showVerlaufPage,
  showYearPage,
} from './navigation.js';

export async function applyReloadedPlan(plan: YearPlan): Promise<void> {
  state.plan = plan;
  updateSidebarMeta(plan);
  setDirtyUI(false);
  hideExternalChangeBanner();
  await refreshCurrentPage();
  showToast('Ansicht aktualisiert.', 'success');
}

export async function onPlanLoaded(plan: YearPlan): Promise<void> {
  resetCloudWriteState();
  state.plan = plan;
  updateSidebarMeta(plan);
  setText('sb-filename', String(plan.year));
  setDirtyUI(false);
  Planner.GetCurrentFileName().then(name => {
    if (name && name !== '.') setText('sb-filename', name);
  }).catch(() => {});

  ['settings', 'statistics', 'verlauf', 'year'].forEach(p => {
    const btn = el<HTMLButtonElement>(`nav-btn-${p}`);
    if (btn) btn.disabled = false;
  });
  show('btn-close');

  const now = new Date();
  const m = plan.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  await navigateToMonth(m);
}

export async function cmdClose(): Promise<void> {
  if (state.dirty) {
    const ok = await showConfirm({
      kicker: 'Datei schließen',
      title: 'Ungespeicherte Änderungen',
      message: 'Du hast ungespeicherte Änderungen. Trotzdem schließen?',
      okLabel: 'Schließen',
    });
    if (!ok) return;
  }

  if (state.online) {
    disconnectFromCloud();
    try { await Planner.DisconnectCloud(); } catch { /* ignore */ }
  }

  resetCloudWriteState();
  state.plan    = null;
  state.dirty   = false;
  state.online  = false;
  state.cloudRoomCode = '';

  setText('sidebar-team-name', 'Einsatzplan');
  setText('sidebar-year-label', 'Kein Jahr geladen');
  setText('sb-filename', '—');
  document.title = 'Einsatzplan';

  ['settings', 'statistics', 'verlauf', 'year'].forEach(p => {
    const btn = el<HTMLButtonElement>(`nav-btn-${p}`);
    if (btn) btn.disabled = true;
  });
  setHtml('nav-months', '<div style="padding: 8px 16px; font-size: 13px; color: var(--side-muted);">Keine Datei geöffnet</div>');

  const pill  = el('save-state');
  const label = el('save-state-label');
  if (pill)  { pill.classList.remove('dirty', 'error', 'syncing'); }
  if (label) label.textContent = 'Kein Dokument';

  const btnSave = el<HTMLButtonElement>('btn-save');
  if (btnSave) { btnSave.disabled = true; btnSave.style.display = ''; }

  hideExternalChangeBanner();
  hide('btn-close');
  showPage('welcome');
  tryRestoreLastFile();
}

export async function refreshCurrentPage(): Promise<void> {
  switch (state.currentPage) {
    case 'month':      await navigateToMonth(state.currentMonth!); break;
    case 'statistics': await showStatisticsPage(); break;
    case 'settings':   await showSettingsPage(); break;
    case 'verlauf':    await showVerlaufPage(); break;
    case 'year':       await showYearPage(); break;
    default:           await onPlanLoaded(state.plan!); break;
  }
}

export async function cmdOpen(): Promise<void> {
  try {
    const plan = await Planner.OpenPlan();
    if (!plan) return;
    await onPlanLoaded(plan);
  } catch (e) {
    showToast('Fehler beim Öffnen: ' + e, 'error');
  }
}

export async function cmdSave(): Promise<void> {
  try {
    await Planner.SavePlan();
    setDirtyUI(false);
    hideExternalChangeBanner();
    setAutosavePaused(false);
    showToast('Gespeichert.', 'success');
  } catch (e) {
    const msg = String(e);
    if (msg.includes('conflict')) {
      await handleSaveConflict();
    } else {
      showToast('Fehler beim Speichern: ' + e, 'error');
    }
  }
}

export async function handleExternalChange(): Promise<void> {
  if (!state.plan) return;
  const isDirty = state.dirty;
  if (!isDirty) {
    try {
      const plan = await Planner.ReloadPlan();
      if (!plan) return;
      await applyReloadedPlan(plan);
    } catch (e) {
      showToast('Fehler beim Aktualisieren: ' + e, 'error');
    }
  } else {
    setAutosavePaused(true);
    showExternalChangeBanner(true);
  }
}

export async function tryRestoreLastFile(): Promise<void> {
  try {
    const paths = await Planner.GetRecentPaths();
    if (!paths || paths.length === 0) return;
    const list = el('welcome-reopen-list');
    const container = el('welcome-reopen');
    if (!list || !container) return;
    list.innerHTML = '';
    for (const path of paths) {
      const name = path.split(/[/\\]/).pop() || path;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)';
      row.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div style="flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;color:var(--ink)" title="${esc(path)}">${esc(name)}</div>
        <button class="dlg-btn danger btn-sm action-rem" title="Entfernen">&times;</button>
        <button class="dlg-btn primary btn-sm action-open">Öffnen</button>`;
      (row.querySelector('.action-open') as HTMLButtonElement).addEventListener('click', async () => {
        try {
          const plan = await Planner.ReopenPlan(path);
          if (plan) await onPlanLoaded(plan);
        } catch {
          showToast('Datei nicht mehr gefunden.', 'error');
        }
      });
      (row.querySelector('.action-rem') as HTMLButtonElement).addEventListener('click', async () => {
        try {
          await Planner.RemoveRecentPath(path);
          tryRestoreLastFile();
        } catch { /* ignore */ }
      });
      list.appendChild(row);
    }
    container.style.display = '';
  } catch { /* ignore */ }
}
