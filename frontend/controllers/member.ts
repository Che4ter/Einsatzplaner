import * as Planner from '../services.js';
import type { TeamMember } from '../services.js';
import { state } from '../state.js';
import { TEAM_COLORS } from '../utils.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';

let _memberEditId: string | null = null;
let _memberColor: string = TEAM_COLORS[0];

export function openAddMember(): void {
  _memberEditId = null;
  _memberColor  = TEAM_COLORS[state.plan.team.length % TEAM_COLORS.length];
  document.getElementById('modal-member-title')!.textContent = 'Person hinzufügen';
  (document.getElementById('input-member-name') as HTMLInputElement).value = '';
  (document.getElementById('input-member-exclude-hours') as HTMLInputElement).checked = false;
  (document.getElementById('input-member-active') as HTMLInputElement).checked = true;
  (document.getElementById('modal-member-active-row') as HTMLElement).style.display = 'none';
  renderColorPicker(state.plan.team);
  showModal('modal-member');
}

export function openEditMember(id: string): void {
  const m = state.plan.team.find((t: TeamMember) => t.id === id);
  if (!m) return;
  _memberEditId = id;
  _memberColor  = m.color;
  document.getElementById('modal-member-title')!.textContent = 'Person bearbeiten';
  (document.getElementById('input-member-name') as HTMLInputElement).value = m.name;
  (document.getElementById('input-member-exclude-hours') as HTMLInputElement).checked = !!m.excludeFromHours;
  (document.getElementById('input-member-active') as HTMLInputElement).checked = !!m.active;
  (document.getElementById('modal-member-active-row') as HTMLElement).style.display = 'flex';
  renderColorPicker(state.plan.team);
  showModal('modal-member');
}

export async function confirmMemberModal(): Promise<void> {
  const nameInput = document.getElementById('input-member-name') as HTMLInputElement;
  const name = nameInput.value.trim();
  if (!name) {
    nameInput.style.borderColor = 'var(--rose)';
    return;
  }
  try {
    const excludeFromHours = (document.getElementById('input-member-exclude-hours') as HTMLInputElement).checked;
    const active = _memberEditId
      ? (document.getElementById('input-member-active') as HTMLInputElement).checked
      : true;
    if (_memberEditId) {
      const m = state.plan.team.find((t: TeamMember) => t.id === _memberEditId);
      await Planner.UpdateMember({ ...m, name, color: _memberColor, excludeFromHours, active });
    } else {
      await Planner.CreateMember({ id: '', name, color: _memberColor, active: true, excludeFromHours });
    }
    closeModal('modal-member');
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export async function toggleMemberActive(id: string): Promise<void> {
  try {
    await Planner.ToggleMemberActive(id);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export async function deleteMember(id: string): Promise<void> {
  try {
    await Planner.DeleteMember(id);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export function renderColorPicker(team: TeamMember[]): void {
  const usedColors = new Set(team.map((m: TeamMember) => m.color));
  const el = document.getElementById('member-color-picker');
  if (!el) return;
  el.innerHTML = TEAM_COLORS.map((c: string) =>
    `<button type="button" class="color-swatch${c === _memberColor ? ' selected' : ''}"
      data-action="select-color" data-color="${c}"
      style="background:${c};${usedColors.has(c) && c !== _memberColor ? 'opacity:0.4' : ''}"></button>`
  ).join('');
}

export function selectColor(color: string): void {
  _memberColor = color;
  renderColorPicker(state.plan.team);
}
