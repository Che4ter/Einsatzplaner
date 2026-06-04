import * as Planner from '../services.js';
import type { Event as PlanEvent, TeamMember, TimePreset } from '../services.js';
import { state } from '../state.js';
import { MONATE, WEEKDAY_LONG, esc, getMonth } from '../utils.js';
import { renderQAPopover } from '../render/index.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { navigateToMonth, showYearPage } from './navigation.js';
import { el, setText, val } from '../dom.js';

let _eventId: string | null       = null;
let _eventMonth: number | null    = null;
let _eventType: string | null     = null;
let _eventDate: string | null     = null;
let _eventFromPage: string | null = null;

export function setEventFromPage(v: string | null): void { _eventFromPage = v; }

export async function openAddEvent(type: string, date: string, month: number): Promise<void> {
  _eventId    = null;
  _eventMonth = month ?? state.currentMonth;
  _eventType  = type;
  _eventDate  = date || '';
  _eventFromPage = null;

  setText('modal-event-title', 'Einsatz hinzufügen');
  el('btn-modal-event-delete')!.style.display = 'none';
  el<HTMLInputElement>('event-is-closed')!.checked = false;
  el('event-fields')!.style.display = '';

  const plan = state.plan;
  if (!plan) return;

  const dateRow      = el('event-date-row')!;
  const dateEndGroup = el('event-date-end-group')!;
  if (date) {
    dateRow.style.display = 'none';
    const d = new Date(date + 'T00:00:00');
    setText('event-display-weekday', WEEKDAY_LONG[d.getDay()]);
    setText('event-display-date', `${d.getDate()}. ${MONATE[d.getMonth()]} ${plan.year}`);
  } else {
    dateRow.style.display = '';
    el<HTMLInputElement>('event-date-input')!.value = '';
    setText('event-display-weekday', '');
    setText('event-display-date', type === 'weekend' ? 'Wochenende' : 'Wochentag');
  }
  dateEndGroup.style.display = type === 'weekend' ? '' : 'none';
  if (type !== 'weekend') el<HTMLInputElement>('event-date-end-input')!.value = '';

  el<HTMLInputElement>('event-location')!.value       = '';
  el<HTMLInputElement>('event-time-from')!.value      = '';
  el<HTMLInputElement>('event-time-to')!.value        = '';
  el<HTMLInputElement>('event-time-setup')!.value     = '';
  el<HTMLInputElement>('event-time-teardown')!.value  = '';
  el<HTMLInputElement>('event-staff-required')!.value = '2';
  setText('event-staff-display', '2');
  el<HTMLTextAreaElement>('event-comment')!.value = '';

  populateLocationDatalist(plan.settings.locations ?? []);
  populateTimePresets(plan.settings.defaultTimes ?? []);
  populateStaffList(plan.team, []);
  showModal('modal-event');
}

export async function openEditEvent(eventId: string, month: number): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const events = getMonth(plan, month)?.events ?? [];
  const ev = events.find((e: any) => e.id === eventId);
  if (!ev) return;

  _eventId    = eventId;
  _eventMonth = month;
  _eventType  = ev.type;
  _eventDate  = ev.date;

  setText('modal-event-title', 'Einsatz bearbeiten');
  el('btn-modal-event-delete')!.style.display = '';
  el('event-date-row')!.style.display = 'none';
  el<HTMLInputElement>('event-is-closed')!.checked = ev.isClosed;
  el('event-fields')!.style.display = ev.isClosed ? 'none' : '';
  el('event-closed-label')!.classList.toggle('is-closed', ev.isClosed);

  const d = new Date(ev.date + 'T00:00:00');
  setText('event-display-weekday', WEEKDAY_LONG[d.getDay()]);
  setText('event-display-date', `${d.getDate()}. ${MONATE[d.getMonth()]} ${plan.year}`);

  el<HTMLInputElement>('event-location')!.value      = ev.location      ?? '';
  el<HTMLInputElement>('event-time-from')!.value     = ev.timeFrom      ?? '';
  el<HTMLInputElement>('event-time-to')!.value       = ev.timeTo        ?? '';
  el<HTMLInputElement>('event-time-setup')!.value    = ev.timeSetup     ?? '';
  el<HTMLInputElement>('event-time-teardown')!.value = ev.timeTeardown  ?? '';
  const need = ev.staffRequired ?? 0;
  el<HTMLInputElement>('event-staff-required')!.value = String(need);
  setText('event-staff-display', String(need));
  el<HTMLTextAreaElement>('event-comment')!.value = ev.comment ?? '';
  el('event-date-end-group')!.style.display = ev.type === 'weekend' ? '' : 'none';
  el<HTMLInputElement>('event-date-end-input')!.value = ev.dateEnd ?? '';

  populateLocationDatalist(plan.settings.locations ?? []);
  populateTimePresets(plan.settings.defaultTimes ?? []);
  populateStaffList(plan.team, ev.assignedStaff ?? []);
  showModal('modal-event');
}

export async function confirmEventModal(): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const isClosed     = el<HTMLInputElement>('event-is-closed')!.checked;
  const location     = val('event-location').trim();
  const timeFrom     = val('event-time-from');
  const timeTo       = val('event-time-to');
  const timeSetup    = val('event-time-setup');
  const timeTeardown = val('event-time-teardown');
  const need         = parseInt(val('event-staff-required'), 10) || 0;
  const comment      = val('event-comment').trim();
  const date         = _eventDate || val('event-date-input');
  const dateEnd      = val('event-date-end-input');

  if (!isClosed && !date) {
    showToast('Datum fehlt', 'error');
    return;
  }

  const assignedStaff = [...document.querySelectorAll('.staff-pick.on')].map(b => (b as HTMLElement).dataset.id!);

  const ev = {
    id:            _eventId ?? '',
    month:         _eventMonth!,
    type:          _eventType! as PlanEvent['type'],
    date:          date,
    dateEnd:       dateEnd,
    isClosed:      isClosed,
    location:      isClosed ? '' : location,
    timeFrom:      isClosed ? '' : timeFrom,
    timeTo:        isClosed ? '' : timeTo,
    timeSetup:     isClosed ? '' : timeSetup,
    timeTeardown:  isClosed ? '' : timeTeardown,
    staffRequired: isClosed ? 0 : need,
    assignedStaff: isClosed ? [] : assignedStaff,
    comment:       comment,
  };

  try {
    if (_eventId) {
      await Planner.UpdateEvent(_eventMonth!, ev);
    } else {
      await Planner.CreateEvent(_eventMonth!, ev);
    }
    if (location && !(plan.settings.locations ?? []).includes(location)) {
      const newSettings = { ...plan.settings, locations: [...(plan.settings.locations ?? []), location] };
      await Planner.UpdateSettings(newSettings);
    }
    state.plan = await Planner.GetPlan();
    closeModal('modal-event');
    setDirtyUI(true);
    if (_eventFromPage === 'year') await showYearPage();
    else await navigateToMonth(_eventMonth!);
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

export async function deleteEventModal(): Promise<void> {
  if (!_eventId) return;
  try {
    await Planner.DeleteEvent(_eventMonth!, _eventId);
    state.plan = await Planner.GetPlan();
    closeModal('modal-event');
    setDirtyUI(true);
    if (_eventFromPage === 'year') await showYearPage();
    else await navigateToMonth(_eventMonth!);
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

let _qaEventId: string | null = null;
let _qaMonth: number | null   = null;

export async function openQA(eventId: string, month: number, anchorEl: Element): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  _qaEventId = eventId;
  _qaMonth   = month;
  const events = getMonth(plan, month)?.events ?? [];
  const ev = events.find((e: any) => e.id === eventId);
  if (!ev) return;

  const pop = el('qa-popover')!;
  pop.innerHTML = renderQAPopover(plan.team, ev.assignedStaff ?? [], eventId, month);
  pop.style.display = 'block';

  const rect  = anchorEl.getBoundingClientRect();
  const inner = pop.querySelector('#qa-pop-inner') as HTMLElement | null;
  if (inner) {
    inner.style.position = 'fixed';
    inner.style.left     = rect.left + 'px';
    inner.style.top      = (rect.bottom + 6) + 'px';
    inner.style.zIndex   = '200';
  }
}

export async function qaToggle(memberId: string, eventId: string, month: number): Promise<void> {
  try {
    await Planner.ToggleStaff(month, eventId, memberId);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    const qa = el('qa-popover');
    if (qa) qa.style.display = 'none';
    await navigateToMonth(month);
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

let _locationOptions: string[] = [];
let _locACWired = false;

export function populateLocationDatalist(locations: string[]): void {
  _locationOptions = locations ?? [];
  _locACWired = false;  // reset so the new DOM element gets wired each time the modal opens
  wireLocationAC();
}

function wireLocationAC(): void {
  if (_locACWired) return;
  const input = el<HTMLInputElement>('event-location');
  const drop  = el('event-location-drop');
  if (!input || !drop) return;
  _locACWired = true;

  function showDrop(items: string[]): void {
    if (!items.length) { drop!.classList.add('hidden'); return; }
    drop!.innerHTML = items.map((l, i) =>
      `<li class="loc-ac-item" role="option" data-value="${esc(l)}" data-idx="${i}">${esc(l)}</li>`
    ).join('');
    drop!.classList.remove('hidden');
  }

  function hideDrop(): void { drop!.classList.add('hidden'); }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = q ? _locationOptions.filter(l => l.toLowerCase().includes(q)) : _locationOptions;
    showDrop(filtered);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = q ? _locationOptions.filter(l => l.toLowerCase().includes(q)) : _locationOptions;
    showDrop(filtered);
  });

  let _pickingItem = false;
  drop.addEventListener('mousedown', e => {
    _pickingItem = true;
    const li = (e.target as Element).closest('.loc-ac-item') as HTMLElement | null;
    if (li) { input.value = li.dataset.value!; hideDrop(); }
  });

  input.addEventListener('blur', () => {
    if (_pickingItem) { _pickingItem = false; return; }
    hideDrop();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDrop(); return; }
    if (e.key === 'Enter') {
      const active = drop!.querySelector('.loc-ac-item.active') as HTMLElement | null;
      if (active) { input.value = active.dataset.value!; }
      hideDrop();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...drop!.querySelectorAll('.loc-ac-item')] as HTMLElement[];
      if (!items.length) return;
      const cur = drop!.querySelector('.loc-ac-item.active') as HTMLElement | null;
      let idx = cur ? items.indexOf(cur) : -1;
      if (cur) cur.classList.remove('active');
      idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
  });
}

export function populateTimePresets(times: TimePreset[]): void {
  const presetsEl = el('event-time-presets');
  if (!presetsEl) return;
  presetsEl.innerHTML = times.map((t, i) => {
    const SVG_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>`;
    const SVG_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H7M12 7l-5 5 5 5"/></svg>`;
    const pre      = t.timeSetup    ? `<span class="ev-edge">${SVG_R}${esc(t.timeSetup)}</span>` : '';
    const post     = t.timeTeardown ? `<span class="ev-edge">${SVG_L}${esc(t.timeTeardown)}</span>` : '';
    const mainTime = `<span class="ev-core">${esc(t.from)}-${esc(t.to)}</span>`;
    const sub      = [pre, mainTime, post].filter(Boolean).join('');
    return `<button type="button" class="preset" data-action="time-preset" data-index="${i}">
      <span>${esc(t.label || 'Standard')}</span><span class="preset-time ev-times" style="margin-top:2px">${sub}</span>
    </button>`;
  }).join('');
}

export function applyTimePreset(index: number): void {
  const t = state.plan?.settings?.defaultTimes?.[index];
  if (!t) return;
  el<HTMLInputElement>('event-time-from')!.value     = t.from         ?? '';
  el<HTMLInputElement>('event-time-to')!.value       = t.to           ?? '';
  el<HTMLInputElement>('event-time-setup')!.value    = t.timeSetup    ?? '';
  el<HTMLInputElement>('event-time-teardown')!.value = t.timeTeardown ?? '';
}

export function populateStaffList(team: TeamMember[], assigned: string[]): void {
  const staffListEl = el('event-staff-list');
  if (!staffListEl) return;
  staffListEl.innerHTML = team.filter(m => m.active).slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => {
    const on = assigned.includes(m.id);
    return `<button type="button"
      class="staff-pick${on ? ' on' : ''}"
      data-id="${esc(m.id)}"
      data-action="toggle-staff"
      data-color="${esc(m.color)}"
      style="${on ? `background:${esc(m.color)}` : `border-color:${esc(m.color)}`}">
      <span class="sp-dot" style="background:${on ? 'rgba(255,255,255,0.7)' : esc(m.color)}"></span>
      ${esc(m.name)}
    </button>`;
  }).join('');
  updateStaffSummary();
}

export function updateStaffSummary(): void {
  const assigned = document.querySelectorAll('.staff-pick.on').length;
  const need     = parseInt(val('event-staff-required'), 10) || 0;
  setText('event-staff-summary', `${assigned} von ${need} zugeteilt`);
}
