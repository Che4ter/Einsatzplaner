import * as Planner from '../services.js';
import type { TimePreset } from '../services.js';
import { state } from '../state.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';
import { el, setText, val } from '../dom.js';

let _timeEditIndex = -1;

export function openAddTime(): void {
  _timeEditIndex = -1;
  setText('modal-time-title', 'Standardzeit hinzufügen');
  el<HTMLInputElement>('input-time-label')!.value    = '';
  el<HTMLInputElement>('input-time-from')!.value     = '13:30';
  el<HTMLInputElement>('input-time-to')!.value       = '17:30';
  el<HTMLInputElement>('input-time-setup')!.value    = '';
  el<HTMLInputElement>('input-time-teardown')!.value = '';
  showModal('modal-time');
}

export function openEditTime(index: number): void {
  const plan = state.plan;
  if (!plan) return;
  _timeEditIndex = index;
  const t = plan.settings.defaultTimes[index] as TimePreset | undefined;
  setText('modal-time-title', 'Standardzeit bearbeiten');
  el<HTMLInputElement>('input-time-label')!.value    = t?.label        ?? '';
  el<HTMLInputElement>('input-time-from')!.value     = t?.from         ?? '13:30';
  el<HTMLInputElement>('input-time-to')!.value       = t?.to           ?? '17:30';
  el<HTMLInputElement>('input-time-setup')!.value    = t?.timeSetup    ?? '';
  el<HTMLInputElement>('input-time-teardown')!.value = t?.timeTeardown ?? '';
  showModal('modal-time');
}

export async function confirmTimeModal(): Promise<void> {
  const label        = val('input-time-label').trim();
  const from         = val('input-time-from');
  const to           = val('input-time-to');
  const timeSetup    = val('input-time-setup');
  const timeTeardown = val('input-time-teardown');
  const plan = state.plan;
  if (!plan) return;
  const times = [...(plan.settings.defaultTimes ?? [])];
  const entry: TimePreset = {
    label: label || 'Standard',
    from,
    to,
    ...(timeSetup    && { timeSetup }),
    ...(timeTeardown && { timeTeardown }),
  };
  if (_timeEditIndex >= 0) times[_timeEditIndex] = entry;
  else times.push(entry);
  const s = { ...plan.settings, defaultTimes: times };
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
  const plan = state.plan;
  if (!plan) return;
  const times = [...(plan.settings.defaultTimes ?? [])];
  times.splice(index, 1);
  const s = { ...plan.settings, defaultTimes: times };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}
