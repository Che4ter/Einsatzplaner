import * as Planner from '../services.js';
import { state } from '../state.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';

let _locationEditIndex = -1;

export function openAddLocation(): void {
  _locationEditIndex = -1;
  document.getElementById('modal-location-title')!.textContent = 'Ort hinzufügen';
  (document.getElementById('input-location-name') as HTMLInputElement).value = '';
  showModal('modal-location');
}

export function openEditLocation(index: number): void {
  _locationEditIndex = index;
  document.getElementById('modal-location-title')!.textContent = 'Ort bearbeiten';
  (document.getElementById('input-location-name') as HTMLInputElement).value =
    state.plan.settings.locations[index] ?? '';
  showModal('modal-location');
}

export async function confirmLocationModal(): Promise<void> {
  const name = (document.getElementById('input-location-name') as HTMLInputElement).value.trim();
  if (!name) return;
  const locs = [...(state.plan.settings.locations ?? [])];
  if (_locationEditIndex >= 0) locs[_locationEditIndex] = name;
  else locs.push(name);
  const s = { ...state.plan.settings, locations: locs };
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
  const locs = [...(state.plan.settings.locations ?? [])];
  locs.splice(index, 1);
  const s = { ...state.plan.settings, locations: locs };
  try {
    await Planner.UpdateSettings(s);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}
