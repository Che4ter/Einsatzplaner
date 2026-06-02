import * as Planner from '../services.js';
import type { TimePreset } from '../services.js';
import { state } from '../state.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';

let _timeEditIndex = -1;

export function openAddTime(): void {
  _timeEditIndex = -1;
  document.getElementById('modal-time-title')!.textContent = 'Standardzeit hinzufügen';
  (document.getElementById('input-time-label') as HTMLInputElement).value    = '';
  (document.getElementById('input-time-from') as HTMLInputElement).value     = '13:30';
  (document.getElementById('input-time-to') as HTMLInputElement).value       = '17:30';
  (document.getElementById('input-time-setup') as HTMLInputElement).value    = '';
  (document.getElementById('input-time-teardown') as HTMLInputElement).value = '';
  showModal('modal-time');
}

export function openEditTime(index: number): void {
  _timeEditIndex = index;
  const t = state.plan.settings.defaultTimes[index] as TimePreset | undefined;
  document.getElementById('modal-time-title')!.textContent = 'Standardzeit bearbeiten';
  (document.getElementById('input-time-label') as HTMLInputElement).value    = t?.label        ?? '';
  (document.getElementById('input-time-from') as HTMLInputElement).value     = t?.from         ?? '13:30';
  (document.getElementById('input-time-to') as HTMLInputElement).value       = t?.to           ?? '17:30';
  (document.getElementById('input-time-setup') as HTMLInputElement).value    = t?.timeSetup    ?? '';
  (document.getElementById('input-time-teardown') as HTMLInputElement).value = t?.timeTeardown ?? '';
  showModal('modal-time');
}

export async function confirmTimeModal(): Promise<void> {
  const label        = (document.getElementById('input-time-label') as HTMLInputElement).value.trim();
  const from         = (document.getElementById('input-time-from') as HTMLInputElement).value;
  const to           = (document.getElementById('input-time-to') as HTMLInputElement).value;
  const timeSetup    = (document.getElementById('input-time-setup') as HTMLInputElement).value    || '';
  const timeTeardown = (document.getElementById('input-time-teardown') as HTMLInputElement).value || '';
  const times = [...(state.plan.settings.defaultTimes ?? [])];
  const entry: TimePreset = {
    label: label || 'Standard',
    from,
    to,
    ...(timeSetup    && { timeSetup }),
    ...(timeTeardown && { timeTeardown }),
  };
  if (_timeEditIndex >= 0) times[_timeEditIndex] = entry;
  else times.push(entry);
  const s = { ...state.plan.settings, defaultTimes: times };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    closeModal('modal-time');
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e, 'error');
  }
}

export async function deleteTime(index: number): Promise<void> {
  const times = [...(state.plan.settings.defaultTimes ?? [])];
  times.splice(index, 1);
  const s = { ...state.plan.settings, defaultTimes: times };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}
