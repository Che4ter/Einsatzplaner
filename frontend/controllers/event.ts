import * as Planner from '../services.js';
import type { TeamMember, TimePreset } from '../services.js';
import { state } from '../state.js';
import { MONATE, WEEKDAY_LONG, esc, getMonth } from '../utils.js';
import { renderQAPopover } from '../render/index.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setDirtyUI } from './core.js';
import { navigateToMonth, showYearPage } from './navigation.js';

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

  document.getElementById('modal-event-title')!.textContent = 'Einsatz hinzufügen';
  (document.getElementById('btn-modal-event-delete') as HTMLElement).style.display = 'none';
  (document.getElementById('event-is-closed') as HTMLInputElement).checked = false;
  (document.getElementById('event-fields') as HTMLElement).style.display = '';

  const dateRow      = document.getElementById('event-date-row')!;
  const dateEndGroup = document.getElementById('event-date-end-group')!;
  if (date) {
    dateRow.style.display = 'none';
    const d = new Date(date + 'T00:00:00');
    document.getElementById('event-display-weekday')!.textContent = WEEKDAY_LONG[d.getDay()];
    document.getElementById('event-display-date')!.textContent =
      `${d.getDate()}. ${MONATE[d.getMonth()]} ${state.plan.year}`;
  } else {
    dateRow.style.display = '';
    (document.getElementById('event-date-input') as HTMLInputElement).value = '';
    document.getElementById('event-display-weekday')!.textContent = '';
    document.getElementById('event-display-date')!.textContent = type === 'weekend' ? 'Wochenende' : 'Wochentag';
  }
  dateEndGroup.style.display = type === 'weekend' ? '' : 'none';
  if (type !== 'weekend') (document.getElementById('event-date-end-input') as HTMLInputElement).value = '';

  (document.getElementById('event-location') as HTMLInputElement).value       = '';
  (document.getElementById('event-time-from') as HTMLInputElement).value      = '';
  (document.getElementById('event-time-to') as HTMLInputElement).value        = '';
  (document.getElementById('event-time-setup') as HTMLInputElement).value     = '';
  (document.getElementById('event-time-teardown') as HTMLInputElement).value  = '';
  (document.getElementById('event-staff-required') as HTMLInputElement).value = '2';
  document.getElementById('event-staff-display')!.textContent = '2';
  (document.getElementById('event-comment') as HTMLTextAreaElement).value = '';

  populateLocationDatalist(state.plan.settings.locations ?? []);
  populateTimePresets(state.plan.settings.defaultTimes ?? []);
  populateStaffList(state.plan.team, []);
  showModal('modal-event');
}

export async function openEditEvent(eventId: string, month: number): Promise<void> {
  const events = getMonth(state.plan, month)?.events ?? [];
  const ev = events.find((e: any) => e.id === eventId);
  if (!ev) return;

  _eventId    = eventId;
  _eventMonth = month;
  _eventType  = ev.type;
  _eventDate  = ev.date;

  document.getElementById('modal-event-title')!.textContent = 'Einsatz bearbeiten';
  (document.getElementById('btn-modal-event-delete') as HTMLElement).style.display = '';
  (document.getElementById('event-date-row') as HTMLElement).style.display = 'none';
  (document.getElementById('event-is-closed') as HTMLInputElement).checked = ev.isClosed;
  (document.getElementById('event-fields') as HTMLElement).style.display = ev.isClosed ? 'none' : '';
  document.getElementById('event-closed-label')!.classList.toggle('is-closed', ev.isClosed);

  const d = new Date(ev.date + 'T00:00:00');
  document.getElementById('event-display-weekday')!.textContent = WEEKDAY_LONG[d.getDay()];
  document.getElementById('event-display-date')!.textContent =
    `${d.getDate()}. ${MONATE[d.getMonth()]} ${state.plan.year}`;

  (document.getElementById('event-location') as HTMLInputElement).value      = ev.location      ?? '';
  (document.getElementById('event-time-from') as HTMLInputElement).value     = ev.timeFrom      ?? '';
  (document.getElementById('event-time-to') as HTMLInputElement).value       = ev.timeTo        ?? '';
  (document.getElementById('event-time-setup') as HTMLInputElement).value    = ev.timeSetup     ?? '';
  (document.getElementById('event-time-teardown') as HTMLInputElement).value = ev.timeTeardown  ?? '';
  const need = ev.staffRequired ?? 0;
  (document.getElementById('event-staff-required') as HTMLInputElement).value = need;
  document.getElementById('event-staff-display')!.textContent = need;
  (document.getElementById('event-comment') as HTMLTextAreaElement).value = ev.comment ?? '';
  (document.getElementById('event-date-end-group') as HTMLElement).style.display = ev.type === 'weekend' ? '' : 'none';
  (document.getElementById('event-date-end-input') as HTMLInputElement).value = ev.dateEnd ?? '';

  populateLocationDatalist(state.plan.settings.locations ?? []);
  populateTimePresets(state.plan.settings.defaultTimes ?? []);
  populateStaffList(state.plan.team, ev.assignedStaff ?? []);
  showModal('modal-event');
}

export async function confirmEventModal(): Promise<void> {
  const isClosed     = (document.getElementById('event-is-closed') as HTMLInputElement).checked;
  const location     = (document.getElementById('event-location') as HTMLInputElement).value.trim();
  const timeFrom     = (document.getElementById('event-time-from') as HTMLInputElement).value;
  const timeTo       = (document.getElementById('event-time-to') as HTMLInputElement).value;
  const timeSetup    = (document.getElementById('event-time-setup') as HTMLInputElement).value    || '';
  const timeTeardown = (document.getElementById('event-time-teardown') as HTMLInputElement).value || '';
  const need         = parseInt((document.getElementById('event-staff-required') as HTMLInputElement).value, 10) || 0;
  const comment      = (document.getElementById('event-comment') as HTMLTextAreaElement).value.trim();
  const date         = _eventDate || (document.getElementById('event-date-input') as HTMLInputElement).value;
  const dateEnd      = (document.getElementById('event-date-end-input') as HTMLInputElement)?.value || '';

  if (!isClosed && !date) {
    showToast('Datum fehlt', 'error');
    return;
  }

  const assignedStaff = [...document.querySelectorAll('.staff-pick.on')].map(b => (b as HTMLElement).dataset.id!);

  const ev = {
    id:            _eventId ?? '',
    type:          _eventType,
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
    if (location && !(state.plan.settings.locations ?? []).includes(location)) {
      const newSettings = { ...state.plan.settings, locations: [...(state.plan.settings.locations ?? []), location] };
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
  _qaEventId = eventId;
  _qaMonth   = month;
  const events = getMonth(state.plan, month)?.events ?? [];
  const ev = events.find((e: any) => e.id === eventId);
  if (!ev) return;

  const pop = document.getElementById('qa-popover')!;
  pop.innerHTML = renderQAPopover(state.plan.team, ev.assignedStaff ?? [], eventId, month);
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
    const qa = document.getElementById('qa-popover');
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
  wireLocationAC();
}

function wireLocationAC(): void {
  if (_locACWired) return;
  const input = document.getElementById('event-location') as HTMLInputElement | null;
  const drop  = document.getElementById('event-location-drop') as HTMLElement | null;
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
  const el = document.getElementById('event-time-presets');
  if (!el) return;
  el.innerHTML = times.map((t, i) => {
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
  (document.getElementById('event-time-from') as HTMLInputElement).value     = t.from          ?? '';
  (document.getElementById('event-time-to') as HTMLInputElement).value       = t.to            ?? '';
  (document.getElementById('event-time-setup') as HTMLInputElement).value    = t.timeSetup     ?? '';
  (document.getElementById('event-time-teardown') as HTMLInputElement).value = t.timeTeardown  ?? '';
}

export function populateStaffList(team: TeamMember[], assigned: string[]): void {
  const el = document.getElementById('event-staff-list');
  if (!el) return;
  el.innerHTML = team.filter(m => m.active).slice().sort((a, b) => a.name.localeCompare(b.name)).map(m => {
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
  const need     = parseInt((document.getElementById('event-staff-required') as HTMLInputElement).value, 10) || 0;
  const el       = document.getElementById('event-staff-summary');
  if (el) el.textContent = `${assigned} von ${need} zugeteilt`;
}
