import * as Planner from '../services.js';
import type { TeamMember } from '../services.js';
import { state } from '../state.js';
import { TEAM_COLORS } from '../utils.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { showSettingsPage } from './navigation.js';
import { el, setText, hide } from '../dom.js';

let _memberEditId: string | null = null;
let _memberColor: string = TEAM_COLORS[0];

export function openAddMember(): void {
  const plan = state.plan;
  if (!plan) return;
  _memberEditId = null;
  _memberColor  = TEAM_COLORS[plan.team.length % TEAM_COLORS.length];
  setText('modal-member-title', 'Person hinzufügen');
  el<HTMLInputElement>('input-member-name')!.value = '';
  el<HTMLInputElement>('input-member-exclude-hours')!.checked = false;
  el<HTMLInputElement>('input-member-active')!.checked = true;
  hide('modal-member-active-row');
  renderColorPicker(plan.team);
  showModal('modal-member');
}

export function openEditMember(id: string): void {
  const plan = state.plan;
  if (!plan) return;
  const m = plan.team.find((t: TeamMember) => t.id === id);
  if (!m) return;
  _memberEditId = id;
  _memberColor  = m.color;
  setText('modal-member-title', 'Person bearbeiten');
  el<HTMLInputElement>('input-member-name')!.value = m.name;
  el<HTMLInputElement>('input-member-exclude-hours')!.checked = !!m.excludeFromHours;
  el<HTMLInputElement>('input-member-active')!.checked = !!m.active;
  const activeRow = el('modal-member-active-row');
  if (activeRow) activeRow.style.display = 'flex';
  renderColorPicker(plan.team);
  showModal('modal-member');
}

export async function confirmMemberModal(): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const nameInput = el<HTMLInputElement>('input-member-name');
  const name = nameInput?.value.trim() ?? '';
  if (!name) {
    if (nameInput) nameInput.style.borderColor = 'var(--rose)';
    return;
  }
  try {
    const excludeFromHours = el<HTMLInputElement>('input-member-exclude-hours')?.checked ?? false;
    const active = _memberEditId
      ? (el<HTMLInputElement>('input-member-active')?.checked ?? false)
      : true;
    if (_memberEditId) {
      const m = plan.team.find((t: TeamMember) => t.id === _memberEditId);
      if (!m) return;
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
  const picker = el('member-color-picker');
  if (!picker) return;
  picker.innerHTML = TEAM_COLORS.map((c: string) =>
    `<button type="button" class="color-swatch${c === _memberColor ? ' selected' : ''}"
      data-action="select-color" data-color="${c}"
      style="background:${c};${usedColors.has(c) && c !== _memberColor ? 'opacity:0.4' : ''}"></button>`
  ).join('');
}

export function selectColor(color: string): void {
  const plan = state.plan;
  if (!plan) return;
  _memberColor = color;
  renderColorPicker(plan.team);
}
