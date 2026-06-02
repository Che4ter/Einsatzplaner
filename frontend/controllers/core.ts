// controllers/core.ts — shared DOM helpers used by all other controllers.
//
// Contains the setDirtyUI/scheduleAutosave/handleSaveConflict cluster (mutual callers,
// must live in one file) plus sidebar helpers and showPage.
//
// Imports only from leaves: state, services, dom, render/, ui.

import * as Planner from '../services.js';
import {
  state, AUTOSAVE_DELAY_MS, autosavePaused, setAutosavePaused,
  isAutosaveEnabled, setAutosave,
} from '../state.js';
import { showToast, showConfirm } from '../ui.js';
import { renderMonthNav } from '../render/index.js';
import type { YearPlan } from '../services.js';

// ── Autosave timer (module-private) ──────────────────────────────────────────

let _autosaveTimer: ReturnType<typeof setTimeout> | null = null;

export function scheduleAutosave(): void {
  if (!isAutosaveEnabled() || !state.plan || autosavePaused) return;
  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(async () => {
    _autosaveTimer = null;
    try {
      await Planner.SavePlan();
      setDirtyUI(false);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('conflict')) {
        await handleSaveConflict();
      } else {
        showToast('Automatisches Speichern fehlgeschlagen.', 'error');
      }
    }
  }, AUTOSAVE_DELAY_MS);
}

// setAutosave wrapper that also cancels any pending timer when disabling.
export function setAutosaveLocal(enabled: boolean): void {
  setAutosave(enabled);
  if (!enabled && _autosaveTimer) {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = null;
  }
}

export async function handleSaveConflict(): Promise<void> {
  setAutosavePaused(true);
  const ok = await showConfirm({
    kicker: 'Konflikt',
    title: 'Datei wurde extern geändert',
    message: 'Eine andere Person hat diese Datei gespeichert.\nTrotzdem überschreiben?',
    okLabel: 'Überschreiben',
  });
  if (ok) {
    try {
      await Planner.ForceOverwriteSave();
      setDirtyUI(false);
      hideExternalChangeBanner();
      setAutosavePaused(false);
      showToast('Gespeichert (überschrieben).', 'success');
    } catch (e) {
      showToast('Fehler beim Speichern: ' + e, 'error');
    }
  } else {
    showExternalChangeBanner(true);
  }
}

// ── Dirty / save-state pill ───────────────────────────────────────────────────

export function setDirtyUI(isDirty: boolean): void {
  // In cloud/online mode the save pill is managed by applyCloudStatus ("Cloud · live").
  // Never let local dirty/saved text overwrite it.
  if (state.online) return;
  state.dirty = isDirty;
  const pill  = document.getElementById('save-state');
  const label = document.getElementById('save-state-label');
  if (pill)  pill.classList.toggle('dirty', isDirty);
  if (label) label.textContent = isDirty ? 'Ungespeichert' : 'Gespeichert';
  const btnSave = document.getElementById('btn-save');
  if (btnSave) (btnSave as HTMLButtonElement).disabled = !isDirty;
  if (isDirty) scheduleAutosave();
}

// ── External-change banner ────────────────────────────────────────────────────

export function showExternalChangeBanner(hasDirty: boolean): void {
  const banner = document.getElementById('external-change-banner');
  const msg    = document.getElementById('external-change-msg');
  if (!banner || !msg) return;
  msg.textContent = hasDirty
    ? 'Eine andere Person hat diese Datei geändert. Neu laden verwirft deine ungespeicherten Änderungen.'
    : 'Eine andere Person hat diese Datei geändert.';
  banner.style.display = 'flex';
}

export function hideExternalChangeBanner(): void {
  setAutosavePaused(false);
  const banner = document.getElementById('external-change-banner');
  if (banner) banner.style.display = 'none';
}

// ── Page switching ────────────────────────────────────────────────────────────

export function showPage(id: string): void {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  state.currentPage = id;
}

// ── Sidebar helpers ───────────────────────────────────────────────────────────

export function refreshSidebar(): void {
  if (!state.plan) return;
  Planner.GetMonthSummaries().then(summaries => {
    const el = document.getElementById('nav-months');
    if (el) el.innerHTML = renderMonthNav(state.plan!, summaries, state.currentMonth, state.currentPage);
  });
}

export function refreshSidebarSync(summaries: any): void {
  const el = document.getElementById('nav-months');
  if (el) el.innerHTML = renderMonthNav(state.plan!, summaries, state.currentMonth, state.currentPage);
}

export function updateSidebarMeta(plan: YearPlan): void {
  const teamName = plan.settings?.teamName;
  const nameEl = document.getElementById('sidebar-team-name');
  const yearEl = document.getElementById('sidebar-year-label');
  if (nameEl) nameEl.textContent = teamName || 'Einsatzplan';
  if (yearEl) yearEl.textContent = `Einsatzplan · ${plan.year}`;
  document.title = `Einsatzplan ${plan.year}`;
}
