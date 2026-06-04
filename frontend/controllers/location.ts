import * as Planner from '../services.js';
import { state } from '../state.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';
import { el, setText, val } from '../dom.js';

let _locationEditIndex = -1;

export function openAddLocation(): void {
  _locationEditIndex = -1;
  setText('modal-location-title', 'Ort hinzufügen');
  el<HTMLInputElement>('input-location-name')!.value = '';
  showModal('modal-location');
}

export function openEditLocation(index: number): void {
  const plan = state.plan;
  if (!plan) return;
  _locationEditIndex = index;
  setText('modal-location-title', 'Ort bearbeiten');
  el<HTMLInputElement>('input-location-name')!.value = plan.settings.locations[index] ?? '';
  showModal('modal-location');
}

export async function confirmLocationModal(): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const name = val('input-location-name').trim();
  if (!name) return;
  const locs = [...(plan.settings.locations ?? [])];
  if (_locationEditIndex >= 0) locs[_locationEditIndex] = name;
  else locs.push(name);
  const s = { ...plan.settings, locations: locs };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    closeModal('modal-location');
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e, 'error');
  }
}

export async function deleteLocation(index: number): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const locs = [...(plan.settings.locations ?? [])];
  locs.splice(index, 1);
  const s = { ...plan.settings, locations: locs };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}
