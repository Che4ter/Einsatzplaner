// ═══════════════════════════════════════════════════════════════════════════
// render.js — pure presentational components.
// Each function takes data and returns an HTML string. No DOM, no state,
// no Wails calls — so they can be unit-tested in Node.
// Extracted from app.js as part of the gradual module split.
// ═══════════════════════════════════════════════════════════════════════════

import { esc, escNl, formatDate, WEEKDAY_LONG, MONATE } from './utils.js';

// ── Event cards ──────────────────────────────────────────────────────────────

export function renderEventCard(ev, team, month) {
  const assigned = ev.assignedStaff ?? [];
  const need     = ev.staffRequired ?? 0;
  const tone     = assigned.length >= need ? 'ok' : assigned.length >= need - 1 ? 'warn' : 'danger';
  const teamById = Object.fromEntries(team.map(t => [t.id, t]));

  // Meter pips
  const pips = Array.from({length: need}, (_, i) =>
    `<span class="meter-pip${i < assigned.length ? ' filled ' + tone : ''}"></span>`
  ).join('');

  // Staff chips (assigned)
  const assignedChips = assigned.map(id => {
    const m = teamById[id];
    if (!m) return '';
    return `<span class="chip" style="background:${esc(m.color)};border-color:${esc(m.color)};color:#fff">
      <span class="chip-dot" style="background:rgba(255,255,255,0.5)"></span>
      ${esc(m.name)}
    </span>`;
  }).join('');

  // Empty slots
  const emptySlots = Array.from({length: Math.max(0, need - assigned.length)}, () =>
    `<button class="chip empty qa-trigger" data-action="open-qa"
      data-event-id="${esc(ev.id)}" data-month="${month}">+ frei</button>`
  ).join('');

  const SVG_RIGHT = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>`;
  const SVG_LEFT  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H7M12 7l-5 5 5 5"/></svg>`;

  const timeStr     = ev.timeFrom && ev.timeTo ? `${ev.timeFrom}–${ev.timeTo}` : '';
  const setupStr    = ev.timeSetup    ? `<span class="ev-edge" title="Aufbau ab ${esc(ev.timeSetup)}">${SVG_RIGHT}${esc(ev.timeSetup)}</span>` : '';
  const mainStr     = timeStr ? `<span class="ev-core">${esc(ev.timeFrom)}<span>–</span>${esc(ev.timeTo)}</span>` : '';
  const teardownStr = ev.timeTeardown ? `<span class="ev-edge" title="Abbau bis ${esc(ev.timeTeardown)}">${SVG_LEFT}${esc(ev.timeTeardown)}</span>` : '';
  const timeHtml    = [setupStr, mainStr, teardownStr].filter(Boolean).join('');

  return `
    <div class="ev-card ${tone}" data-action="edit-event" data-id="${esc(ev.id)}" data-month="${month}" style="cursor:pointer">
      <div class="ev-top">
        <div class="ev-loc">${esc(ev.location || '—')}</div>
        <div class="ev-times">${timeHtml}</div>
      </div>
      <div class="ev-meter">
        <div class="meter-text ${tone}">${assigned.length}/${need}</div>
        <div class="meter-pips">${pips}</div>
      </div>
      <div class="ev-bottom">
        ${assignedChips}${emptySlots}
      </div>
      ${ev.comment ? `<div class="ev-comment">${escNl(ev.comment)}</div>` : ''}
    </div>`;
}

export function renderClosedCard(ev, month) {
  const minusSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>`;
  const label = ev.comment || ev.location || 'Geschlossen';
  return `
    <div class="closed-card" data-action="edit-event" data-id="${esc(ev.id)}" data-month="${month}">
      <div class="closed-icon">${minusSvg}</div>
      <div class="closed-main">
        <div class="closed-title">Keine Durchführung</div>
        <div class="closed-reason">${esc(label)}</div>
      </div>
    </div>`;
}

// ── Activity log entry ───────────────────────────────────────────────────────

const ACTION_ICON_CLASS = {
  assign:        'assign',  unassign:      'unassign', swap:   'swap',
  create:        'create',  edit:          'edit',     delete: 'delete',
  close:         'close',   'close-batch': 'close',    reopen: 'reopen',
  note:          'note',
};

const ICON_SVG = {
  userPlus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  userMinus:`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="23" y1="11" x2="17" y2="11"/></svg>`,
  swap:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  edit:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`,
  plus:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>`,
  pause:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>`,
  check:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`,
  note:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`,
};

const ACTION_ICON_NAME = {
  assign:        'userPlus',  unassign:      'userMinus', swap:   'swap',
  create:        'plus',      edit:          'edit',      delete: 'trash',
  close:         'pause',     'close-batch': 'pause',     reopen: 'check',
  note:          'note',
};

export function renderActivityEntry(e, teamById, today) {
  const iconName  = ACTION_ICON_NAME[e.action] ?? 'edit';
  const iconClass = ACTION_ICON_CLASS[e.action] ?? 'edit';
  const time      = e.at ? e.at.slice(11, 16) : '';

  const FIELD_LABELS = {
    location:      'Ort',
    time:          'Zeit',
    timeFrom:      'Beginn',
    timeTo:        'Ende',
    comment:       'Notiz',
    staffRequired: 'Personalbedarf',
    date:          'Datum',
    dateEnd:       'Enddatum',
    type:          'Typ',
  };

  const EVENT_TYPE_LABELS = {
    wednesday: 'Mittwoch',
    weekday:   'Wochentag',
    weekend:   'Wochenende',
  };

  const humanFieldValue = (field, val) => {
    if (!val && val !== 0) return '—';
    if (field === 'type') return EVENT_TYPE_LABELS[val] ?? val;
    if (field === 'date' || field === 'dateEnd') return formatDate(val);
    if (field === 'comment' && val.length > 50) return val.slice(0, 48) + '…';
    return val;
  };

  // Colored inline chip for a person
  const personChip = (id) => {
    const p = id ? teamById[id] : null;
    if (!p) return '';
    return `<span class="act-person-chip" style="background:${esc(p.color)}"><span class="pc-dot"></span>${esc(p.name)}</span>`;
  };

  // Target pill — navigates to the relevant month
  const targetPill = e.target?.date
    ? `<button class="act-target-pill" data-action="nav-month" data-month="${e.target.month ?? ''}">${esc(formatDate(e.target.date))}${e.target.location ? ' · ' + esc(e.target.location) : ''}</button>`
    : '';

  let textHtml = '';
  let detailHtml = '';

  switch (e.action) {
    case 'assign': {
      const chip = personChip(e.person);
      textHtml = chip
        ? `${chip} eingeteilt${targetPill ? ' für ' + targetPill : ''}`
        : `Person eingeteilt${targetPill ? ' für ' + targetPill : ''}`;
      break;
    }
    case 'unassign': {
      const chip = personChip(e.person);
      textHtml = chip
        ? `${chip} abgemeldet${targetPill ? ' von ' + targetPill : ''}`
        : `Person abgemeldet${targetPill ? ' von ' + targetPill : ''}`;
      break;
    }
    case 'swap': {
      const fromChip = personChip(e.from) || esc(e.from || '?');
      const toChip   = personChip(e.to)   || esc(e.to   || '?');
      textHtml = `Tausch${targetPill ? ' bei ' + targetPill : ''}: ${fromChip} → ${toChip}`;
      break;
    }
    case 'create': {
      const typeLabel = EVENT_TYPE_LABELS[e.target?.type] ?? '';
      textHtml = `Neuer${typeLabel ? ' ' + typeLabel + '-' : ''}Einsatz erstellt${targetPill ? ': ' + targetPill : ''}`;
      break;
    }
    case 'delete':
      textHtml = `Einsatz gelöscht${targetPill ? ': ' + targetPill : ''}`;
      break;
    case 'edit': {
      const fieldLabel = FIELD_LABELS[e.field] ?? e.field ?? 'Feld';
      const fromVal = humanFieldValue(e.field, e.from);
      const toVal   = humanFieldValue(e.field, e.to);
      const hasChange = e.from || e.to;
      const changePart = hasChange
        ? `: <span class="act-from">${esc(fromVal)}</span> → <span class="act-to">${esc(toVal)}</span>`
        : ' geändert';
      textHtml = `<em>${esc(fieldLabel)}</em>${targetPill ? ' bei ' + targetPill : ''}${changePart}`;
      break;
    }
    case 'close':
      textHtml = `${targetPill} als „Keine Durchführung" markiert`;
      if (e.reason) detailHtml = `<div class="act-detail">Grund: ${esc(e.reason)}</div>`;
      break;
    case 'close-batch':
      textHtml = `${e.count ?? 'Mehrere'} Termine als Ferien markiert${targetPill ? ' ab ' + targetPill : ''}`;
      if (e.reason) detailHtml = `<div class="act-detail">Grund: ${esc(e.reason)}</div>`;
      break;
    case 'reopen':
      textHtml = `${targetPill} reaktiviert`;
      break;
    case 'note':
      textHtml = `Notiz${targetPill ? ' bei ' + targetPill : ''} gesetzt`;
      if (e.note) detailHtml = `<div class="act-detail">„${esc(e.note)}"</div>`;
      break;
    default:
      textHtml = targetPill ? `Änderung bei ${targetPill}` : 'Änderung';
  }

  return `
    <div class="act-entry">
      <span class="act-time">${esc(time)}</span>
      <span class="act-icon ${iconClass}">${ICON_SVG[iconName] ?? ''}</span>
      <div class="act-body">
        <div class="act-text">${textHtml}</div>
        ${detailHtml}
      </div>
    </div>`;
}

export function fmtDayHeading(dayIso, todayIso) {
  const d     = new Date(dayIso     + 'T00:00:00');
  const today = new Date(todayIso   + 'T00:00:00');
  const diff  = Math.round((today - d) / 86400000);
  const dow   = WEEKDAY_LONG[d.getDay()];
  const dateStr = `${dow}, ${d.getDate()}. ${MONATE[d.getMonth()]}`;
  if (diff === 0) return { kicker: 'Heute',    body: dateStr, isToday: true };
  if (diff === 1) return { kicker: 'Gestern',  body: dateStr, isToday: false };
  if (diff <  7) return { kicker: dow,         body: `${d.getDate()}. ${MONATE[d.getMonth()]}`, isToday: false };
  return              { kicker: null,          body: dateStr, isToday: false };
}

// ── Quick-assign popover ─────────────────────────────────────────────────────

export function renderQAPopover(team, assignedStaff, eventId, month) {
  const rows = team.filter(m => m.active).slice().sort((a,b) => a.name.localeCompare(b.name)).map(m => {
    const on = assignedStaff.includes(m.id);
    return `<button class="qa-item${on ? ' assigned' : ''}"
      data-action="qa-toggle" data-event-id="${esc(eventId)}" data-month="${month}" data-id="${esc(m.id)}">
      <span class="qa-dot" style="background:${esc(m.color)}"></span>
      <span class="qa-name">${esc(m.name)}</span>
      ${on ? '<span class="qa-mark">zugeteilt</span>' : ''}
    </button>`;
  }).join('');
  return `<div class="qa-pop" id="qa-pop-inner">
    <div class="qa-pop-head">Wer übernimmt?</div>
    ${rows}
  </div>`;
}
