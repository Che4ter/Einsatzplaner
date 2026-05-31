// ═══════════════════════════════════════════════════════════════════════════
// 1. SERVICE PROXY
// Thin wrappers around the auto-generated Wails bindings.
// All Go calls go through here. Error handling and toast feedback live here.
// ═══════════════════════════════════════════════════════════════════════════

import * as Planner from './bindings/einsatzplaner/einsatzplan/service/plannerservice.js';
import { Events } from '/wails/runtime.js';

// ── Constants ────────────────────────────────────────────────────────────────

const MONATE = ['Januar','Februar','März','April','Mai','Juni',
                'Juli','August','September','Oktober','November','Dezember'];
const MONATE_SHORT = MONATE.map(m => m.slice(0, 3));
const WEEKDAY_SHORT = ['So','Mo','Di','Mi','Do','Fr','Sa'];
const WEEKDAY_LONG  = ['Sonntag','Montag','Dienstag','Mittwoch','Donnerstag','Freitag','Samstag'];

const TEAM_COLORS = [
  '#0d9488','#2563eb','#9333ea','#db2777','#ea580c',
  '#65a30d','#0891b2','#7c3aed','#c2410c','#15803d',
];

// ═══════════════════════════════════════════════════════════════════════════
// 2. STATE
// Single source of truth. Never mutated by render functions.
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  plan:         null,   // full YearPlan from Go
  currentMonth: null,   // 1–12
  currentPage:  'welcome',
  // per-page UI state (filter selections etc.)
  statsMonth:   0,      // 0 = all months
  verlaufGroup: 'all',
  yearPerson:   null,   // person id filter for year overview
  monthPerson:  null,   // person id filter for month view
};

// ─── Autosave ────────────────────────────────────────────────────────────────
const AUTOSAVE_DELAY_MS = 3000;
let _autosaveTimer = null;
let _autosavePaused = false; // paused when an external conflict is detected

function isAutosaveEnabled() {
  return localStorage.getItem('autosave') === 'true';
}

function setAutosave(enabled) {
  localStorage.setItem('autosave', enabled ? 'true' : 'false');
  if (!enabled && _autosaveTimer) {
    clearTimeout(_autosaveTimer);
    _autosaveTimer = null;
  }
}

function scheduleAutosave() {
  if (!isAutosaveEnabled() || !state.plan || _autosavePaused) return;
  if (_autosaveTimer) clearTimeout(_autosaveTimer);
  _autosaveTimer = setTimeout(async () => {
    _autosaveTimer = null;
    try {
      await Planner.SavePlan();
      setDirtyUI(false);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('conflict')) {
        _autosavePaused = true;
        const ok = await showConfirm({
          kicker: 'Konflikt',
          title: 'Datei wurde extern geändert',
          message: 'Eine andere Person hat diese Datei gespeichert.<br>Trotzdem überschreiben?',
          okLabel: 'Überschreiben',
        });
        if (ok) {
          try {
            await Planner.ForceOverwriteSave();
            setDirtyUI(false);
            hideExternalChangeBanner();
            _autosavePaused = false;
            showToast('Gespeichert (überschrieben).', 'success');
          } catch (e2) {
            showToast('Fehler beim Speichern: ' + e2, 'error');
          }
        } else {
          showExternalChangeBanner(true);
        }
      } else {
        showToast('Automatisches Speichern fehlgeschlagen.', 'error');
      }
    }
  }, AUTOSAVE_DELAY_MS);
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. PURE RENDER FUNCTIONS
// Each function takes data as parameters and returns an HTML string.
// No side effects, no state reads, no Go calls.
// ═══════════════════════════════════════════════════════════════════════════

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escNl(s) {
  return esc(s).replace(/\n/g,'<br>');
}

function firstName(name) {
  return (name ?? '').split(' ')[0];
}

/** Resolve a month entry regardless of whether the key is a number or string. */
function getMonth(plan, m) {
  return plan?.months?.[m] ?? plan?.months?.[String(m)];
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return WEEKDAY_SHORT[d.getDay()] + ' ' + String(d.getDate()).padStart(2,'0') + '.' + String(d.getMonth()+1).padStart(2,'0') + '.';
}

function weekNumber(iso) {
  const d = new Date(iso + 'T00:00:00');
  // Shift to the Thursday of the same ISO week (Mon=1…Sun=7; Thu=4).
  // The ISO year of the week is determined by where Thursday falls.
  const thursday = new Date(d);
  thursday.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const startOfWeek1 = new Date(jan4);
  startOfWeek1.setDate(jan4.getDate() - (jan4.getDay() || 7) + 1);
  return Math.ceil((thursday - startOfWeek1) / 604800000) + 1;
}

function localIso(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

// Date display helpers: Swiss format DD.MM.YYYY <-> ISO YYYY-MM-DD
function isoToDisplay(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}
function displayToIso(str) {
  if (!str) return '';
  const parts = str.split('.');
  if (parts.length !== 3 || parts[2].length !== 4) return '';
  const [d, m, y] = parts;
  return `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
}

function getWednesdays(year, month) {
  const days = [];
  const d = new Date(year, month - 1, 1);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  while (d.getMonth() === month - 1) {
    days.push(localIso(d));
    d.setDate(d.getDate() + 7);
  }
  return days;
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function renderMonthNav(plan, summaries, currentMonth, currentPage) {
  if (!plan) {
    return '<div style="padding:8px 16px;font-size:13px;color:var(--side-muted)">Keine Datei geöffnet</div>';
  }
  const now = new Date();
  const curYear = now.getFullYear();
  const curMon  = now.getMonth() + 1;
  const year    = plan.year;

  return Array.from({length: 12}, (_, i) => {
    const m   = i + 1;
    const sum = summaries?.[m] ?? {total: 0, issues: 0};
    const isPast    = year < curYear || (year === curYear && m < curMon);
    const isCurrent = year === curYear && m === curMon;
    const isActive  = currentPage === 'month' && m === currentMonth;
    const hasIssue  = sum.issues > 0;

    const cls = [
      'month-row',
      isPast    ? 'past'    : '',
      isCurrent ? 'current' : '',
      isActive  ? 'active'  : '',
      hasIssue  ? 'has-issue' : '',
    ].filter(Boolean).join(' ');

    const countStyle = sum.total === 0 ? 'opacity:0' : '';
    return `<button class="${cls}" data-action="nav-month" data-month="${m}">
      <span class="mr-num">${String(m).padStart(2,'0')}</span>
      <span>${MONATE[i]}</span>
      <span class="mr-count" style="${countStyle}">${sum.total || '–'}</span>
    </button>`;
  }).join('');
}

// ── Month page ────────────────────────────────────────────────────────────────

function renderMonthPage(plan, month, events, stats, filterPerson) {
  const { year, team, settings } = plan;
  const now = new Date();
  const today = localIso(now);

  const allEvents    = events;
  const activeEvents = events.filter(e => !e.isClosed);
  const closedEvents = events.filter(e => e.isClosed);

  // ── Filter bar ────────────────────────────────────────────────────────────
  const activeTeam = team.filter(m => m.active);
  const allOn = !filterPerson;
  const filterChips = [
    `<button class="filter-chip all${allOn ? ' on' : ''}" data-action="month-person" data-id="">Alle anzeigen</button>`,
    ...activeTeam.map(m => {
      const on = filterPerson === m.id;
      return `<button class="filter-chip${on ? ' on' : ''}" style="--chip-color:${esc(m.color)}"
        data-action="month-person" data-id="${esc(m.id)}">
        <span class="fc-dot"></span>${esc(m.name)}
      </button>`;
    })
  ].join('');
  const filterBarHtml = `
    <div class="filter-bar no-sticky${filterPerson ? ' active' : ''}">
      <span class="filter-label">Filter</span>
      <div class="filter-chips">${filterChips}</div>
    </div>`;

  // Apply person filter to active events
  const visibleActiveEvents = filterPerson
    ? activeEvents.filter(e => (e.assignedStaff ?? []).includes(filterPerson))
    : activeEvents;

  // Hero stats from Go — no business logic in render
  const fullyStaffed = stats.totalEvents - stats.underCount;
  const openSlots    = Math.max(0, stats.totalNeed - stats.totalAssigned);

  // Calendar weeks
  const wednesdays = getWednesdays(year, month);
  const wedSet = new Set(wednesdays);
  const manualWeekdays = [...new Set(
    visibleActiveEvents.filter(e => e.type === 'wednesday' || e.type === 'weekday')
      .map(e => e.date).filter(d => !wedSet.has(d))
  )];
  const closedWeekdayDates = [...new Set(
    closedEvents.filter(e => e.type === 'wednesday' || e.type === 'weekday')
      .map(e => e.date).filter(d => !wedSet.has(d))
  )];
  const weekdayDates = [...new Set([...wednesdays, ...manualWeekdays, ...closedWeekdayDates])].sort();
  const weekendEvents = visibleActiveEvents.filter(e => e.type === 'weekend');

  // KW range label
  const firstWed = wednesdays[0];
  const lastWed  = wednesdays[wednesdays.length - 1];
  const kwLabel  = firstWed
    ? `KW ${weekNumber(firstWed)}–${weekNumber(lastWed)}`
    : '';



  // Weekday column
  const weekdayColHtml = weekdayDates.map(date => {
    const dayEvents = visibleActiveEvents.filter(e =>
      (e.type === 'wednesday' || e.type === 'weekday') && e.date === date);
    const dayClosed = closedEvents.filter(e =>
      (e.type === 'wednesday' || e.type === 'weekday') && e.date === date);
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const kw = weekNumber(date);
    const closedCardsHtml = dayClosed.map(e => renderClosedCard(e, month)).join('');
    return `
      <div class="date-row${isToday ? ' today' : ''}${dayClosed.length && !dayEvents.length ? ' closed' : ''}">
        <div class="date-marker">
          <span class="dm-day">${WEEKDAY_SHORT[d.getDay()]}</span>
          <span class="dm-num">${d.getDate()}</span>
          <span class="date-kw">KW ${kw}</span>
        </div>
        <div class="row-body">
          ${closedCardsHtml}
          ${dayEvents.map(e => renderEventCard(e, team, month)).join('')}
          ${!dayClosed.length ? `<button class="add-event-btn" data-action="add-event" data-type="${d.getDay() === 3 ? 'wednesday' : 'weekday'}" data-month="${month}" data-date="${date}">
            + Einsatz hinzufügen
          </button>` : ''}
        </div>
      </div>`;
  }).join('');

  // Weekend column grouped by date
  const closedWeekendDates = new Set(
    closedEvents.filter(e => e.type === 'weekend').map(e => e.date)
  );
  const weekendByDate = {};
  weekendEvents.forEach(e => {
    (weekendByDate[e.date] = weekendByDate[e.date] ?? []).push(e);
  });
  // also add dates from closed weekend events
  closedEvents.filter(e => e.type === 'weekend').forEach(e => {
    weekendByDate[e.date] = weekendByDate[e.date] ?? [];
  });
  const weekendDates = Object.keys(weekendByDate).sort();
  const weekendColHtml = weekendDates.map(date => {
    const evs = weekendByDate[date];
    const dayClosed = closedEvents.filter(e => e.type === 'weekend' && e.date === date);
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const firstEv = evs[0];
    const dateEnd = firstEv?.dateEnd && firstEv.dateEnd !== date ? firstEv.dateEnd : null;
    const closedCardsHtml = dayClosed.map(e => renderClosedCard(e, month)).join('');
    return `
      <div class="date-row${isToday ? ' today' : ''}${dayClosed.length && !evs.length ? ' closed' : ''}">
        <div class="date-marker">
          <span class="dm-day">${WEEKDAY_SHORT[d.getDay()]}</span>
          <span class="dm-num">${d.getDate()}${dateEnd ? `<span class="date-range">–${new Date(dateEnd+'T00:00:00').getDate()}</span>` : ''}</span>
          <span class="date-kw">${MONATE_SHORT[d.getMonth()]}</span>
        </div>
        <div class="row-body">
          ${closedCardsHtml}
          ${evs.map(e => renderEventCard(e, team, month)).join('')}
          ${!dayClosed.length ? `<button class="add-event-btn" data-action="add-event" data-type="weekend" data-month="${month}" data-date="${date}">
            + Einsatz hinzufügen
          </button>` : ''}
        </div>
      </div>`;
  }).join('');

  const prevMonth = month > 1  ? month - 1 : null;
  const nextMonth = month < 12 ? month + 1 : null;

  return `
    ${activeTeam.length > 0 ? filterBarHtml : ''}
    <div class="month-page">
      <section class="month-hero">
        <div class="month-hero-left">
          <div class="month-kicker">
            <span>Monatsplan</span>
            ${kwLabel ? `<span class="pill">${esc(kwLabel)}</span>` : ''}
          </div>
          <h1 class="month-title">
            ${esc(MONATE[month-1])}
            <span class="year">${year}</span>
          </h1>
          <nav class="month-nav">
            ${prevMonth
              ? `<button class="mn-btn" data-action="nav-month" data-month="${prevMonth}">← ${MONATE_SHORT[prevMonth-1]}</button>`
              : `<button class="mn-btn" disabled>←</button>`}
            ${nextMonth
              ? `<button class="mn-btn" data-action="nav-month" data-month="${nextMonth}">${MONATE_SHORT[nextMonth-1]} →</button>`
              : `<button class="mn-btn" disabled>→</button>`}
          </nav>
        </div>
        <div class="month-stats">
          <div class="stat">
            <div class="stat-num">${stats.totalEvents}</div>
            <div class="stat-label">Einsätze</div>
          </div>
          <div class="stat">
            <div class="stat-num${stats.underCount > 0 ? ' warn' : ''}">${fullyStaffed}${stats.totalEvents > 0 ? `<span class="stat-num-sub"> / ${stats.totalEvents}</span>` : ''}</div>
            <div class="stat-label">Vollbesetzt</div>
          </div>
          <div class="stat">
            <div class="stat-num${openSlots > 0 ? ' warn' : ''}">${openSlots}</div>
            <div class="stat-label">Offene Plätze</div>
          </div>
          <div class="stat">
            <div class="stat-num${closedEvents.length > 0 ? ' warn' : ''}">${closedEvents.length}</div>
            <div class="stat-label">Ferien</div>
          </div>
        </div>
      </section>

      <div class="columns">
        <div class="col-weekday">
          <div class="col-head">
            <span class="col-title">Wochentage</span>
            <button class="col-add" data-action="add-event" data-type="weekday" data-month="${month}" data-date="">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Anderen Wochentag
            </button>
          </div>
          ${weekdayColHtml}
        </div>
        <div class="col-weekend">
          <div class="col-head">
            <span class="col-title">Wochenende</span>
            <button class="col-add" data-action="add-event" data-type="weekend" data-month="${month}" data-date="">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Wochenende hinzufügen
            </button>
          </div>
          ${weekendColHtml}
        </div>
      </div>
    </div>`;
}

function renderEventCard(ev, team, month) {
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

function renderClosedCard(ev, month) {
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

// ── Statistics page ───────────────────────────────────────────────────────────

function renderStatisticsPage(plan, stats, personStats, filterMonth) {
  const { year } = plan;
  const cvClass = stats.coveragePct >= 95 ? 'ok' : stats.coveragePct >= 80 ? 'warn' : 'danger';
  const maxTotal = Math.max(1, ...personStats.map(s => s.total));

  const chips = `
    <div class="month-chips">
      <button class="month-chip${filterMonth === 0 ? ' on' : ''}"
        data-action="stats-filter" data-month="0">Alle</button>
      ${MONATE_SHORT.map((name, i) =>
        `<button class="month-chip${filterMonth === i+1 ? ' on' : ''}"
          data-action="stats-filter" data-month="${i+1}">${name}</button>`
      ).join('')}
    </div>`;

  // Max hours across all people, used to scale the prep segment consistently.
  const maxHrs = Math.max(1, ...personStats.map(p => p.hrs + (p.prepHrs ?? 0)));
  const barsHtml = personStats.map(p => {
    const wkdPct  = Math.round(p.wkd / maxTotal * 100);
    const wkePct  = Math.round(p.wke / maxTotal * 100);
    const totalHrs = p.hrs + (p.prepHrs ?? 0);
    const prepPct = Math.round((p.prepHrs ?? 0) / maxHrs * 100);
    const wkdHrs  = Math.round(p.hrs * (p.wkd / (p.total || 1)));
    const wkeHrs  = Math.round(p.hrs * (p.wke / (p.total || 1)));
    const wkdTip  = esc(`${wkdHrs}h Wochentage`);
    const wkeTip  = esc(`${wkeHrs}h Wochenende`);
    const prepTip = esc(`${Math.round(p.prepHrs ?? 0)}h Vor-/Nachbearbeitung`);
    return `
      <div class="person-row${p.active ? '' : ' inactive'}">
        <span class="person-name-chip" style="background:${esc(p.color)}">${esc(p.name)}</span>
        <div class="bar-track">
          ${wkdPct > 0 ? `<div class="bar-seg has-tip" data-tip="${wkdTip}" style="width:${wkdPct}%;background:${esc(p.color)}"></div>` : ''}
          ${wkePct > 0 ? `<div class="bar-seg wke has-tip" data-tip="${wkeTip}" style="width:${wkePct}%;background:${esc(p.color)}"></div>` : ''}
          ${prepPct > 0 ? `<div class="bar-seg prep has-tip" data-tip="${prepTip}" style="width:${prepPct}%;background:${esc(p.color)}"></div>` : ''}
        </div>
        <div class="person-row-nums">
          <span>${p.total} <span class="sub">Einsätze</span></span>
          <span>${Math.round(totalHrs)} <span class="sub">Std.</span></span>
        </div>
      </div>`;
  }).join('');

  const subtitle = filterMonth === 0
    ? `Jahresübersicht ${year}`
    : `${MONATE[filterMonth-1]} ${year}`;
  const evSub = filterMonth === 0 ? `im Jahr ${year}` : MONATE[filterMonth-1];

  return `
    <div class="admin-page">
      <header class="admin-hero">
        <div>
          <div class="admin-kicker">Auswertung</div>
          <h1 class="admin-title">Statistiken</h1>
        </div>
        <div class="admin-hero-side">${esc(subtitle)}</div>
      </header>

      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-card-kicker">Einsätze</div>
          <div class="stat-card-num">${stats.totalEvents}</div>
          <div class="stat-card-sub">${esc(evSub)} · ${Math.round(stats.vorOrtHours)}h Mobilarbeit</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-kicker">Stunden</div>
          <div class="stat-card-num">${Math.round(stats.totalHours + stats.prepHours)}</div>
          <div class="stat-card-sub">Gesamteinsatzzeit${stats.prepHours > 0 ? ` (davon ${Math.round(stats.prepHours)}h Vor-/Nachber.)` : ''}</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-kicker">Abdeckung</div>
          <div class="stat-card-num ${cvClass}">${stats.coveragePct}%</div>
          <div class="stat-card-sub">${stats.totalAssigned} von ${stats.totalNeed} besetzt</div>
        </div>
        <div class="stat-card">
          <div class="stat-card-kicker">Unterbesetzt</div>
          <div class="stat-card-num ${stats.underCount === 0 ? 'ok' : 'warn'}">${stats.underCount}</div>
          <div class="stat-card-sub">Einsätze mit Lücken</div>
        </div>
      </div>

      <div class="stat-section">Einsätze pro Person</div>
      ${chips}
      <div class="chart-card">
        <div class="chart-legend">
          <span><span class="legend-swatch" style="background:var(--teal)"></span>Wochentag</span>
          <span><span class="legend-swatch" style="background:var(--teal);opacity:0.45"></span>Wochenende</span>
          <span><span class="legend-swatch prep-swatch"></span>Vor-/Nachbereitung</span>
        </div>
        ${personStats.length === 0
          ? '<div class="empty-state" style="padding:32px 0"><div class="empty-state-text">Kein Teammitglied erfasst.</div></div>'
          : barsHtml}
      </div>
    </div>`;
}

// ── Settings page ─────────────────────────────────────────────────────────────

function renderSettingsPage(plan) {
  const { settings, team, year } = plan;
  const autosaveChecked = isAutosaveEnabled() ? 'checked' : '';

  const locationRows = (settings.locations ?? []).map((loc, i) => `
    <div class="a-row">
      <div class="a-row-main"><div class="a-row-name">${esc(loc)}</div></div>
      <div class="a-row-actions">
        <button class="a-row-btn" data-action="edit-location" data-index="${i}">Bearbeiten</button>
        <button class="a-row-btn danger" data-action="delete-location" data-index="${i}">Löschen</button>
      </div>
    </div>`).join('');

  const timeRows = (settings.defaultTimes ?? []).map((t, i) => {
    const SVG_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>`;
    const SVG_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H7M12 7l-5 5 5 5"/></svg>`;
    const pre  = t.timeSetup    ? `<span class="ev-edge">${SVG_R}${esc(t.timeSetup)}</span>` : '';
    const post = t.timeTeardown ? `<span class="ev-edge">${SVG_L}${esc(t.timeTeardown)}</span>` : '';
    const mainT = `<span class="ev-core">${esc(t.from)}–${esc(t.to)}</span>`;
    const sub = [pre, mainT, post].filter(Boolean).join('');
    return `
    <div class="a-row">
      <div class="a-row-main">
        <div class="a-row-name">${esc(t.label || 'Standard')}</div>
        <div class="a-row-sub ev-times" style="font-size:12px">${sub}</div>
      </div>
      <div class="a-row-actions">
        <button class="a-row-btn" data-action="edit-time" data-index="${i}">Bearbeiten</button>
        <button class="a-row-btn danger" data-action="delete-time" data-index="${i}">Löschen</button>
      </div>
    </div>`;
  }).join('');

  const teamRows = team.map(m => `
    <div class="a-row team${m.active ? '' : ' inactive'}">
      <span class="person-name-chip" style="background:${esc(m.color)}">${esc(m.name)}</span>
      <div class="a-row-main">
        ${!m.active ? '<span class="a-row-note">Inaktiv</span>' : ''}
        ${m.excludeFromHours ? '<span class="a-row-note">Stunden ausgeschlossen</span>' : ''}
      </div>
      <div class="a-row-actions">
        <button class="a-row-btn" data-action="edit-member" data-id="${esc(m.id)}">Bearbeiten</button>
        <button class="a-row-btn danger" data-action="delete-member" data-id="${esc(m.id)}">Löschen</button>
      </div>
    </div>`).join('');

  return `
    <div class="admin-page">
      <header class="admin-hero">
        <div>
          <div class="admin-kicker">Verwaltung</div>
          <h1 class="admin-title">Einstellungen</h1>
        </div>
        <div class="admin-hero-side">${year}</div>
      </header>

      <div class="a-card">
        <div class="a-card-head">
          <span class="a-card-title">Allgemein</span>
        </div>
        <div class="a-card-body">
          <div class="dlg-field" style="margin:0">
            <div class="dlg-label">Teamname</div>
            <input class="dlg-input" type="text" id="settings-team-name"
              value="${esc(settings.teamName)}" placeholder="z.B. Mobile Spielanimation" data-action="save-team-name">
          </div>
          <div class="dlg-field" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="dlg-label" style="margin-bottom:0">Automatisch speichern</div>
              <div class="dlg-hint">Änderungen werden nach ${AUTOSAVE_DELAY_MS / 1000} Sekunden automatisch gespeichert.</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="settings-autosave" ${autosaveChecked} data-action="toggle-autosave">
              <span class="toggle-track"></span>
            </label>
          </div>
        </div>
      </div>

      <div class="a-card">
        <div class="a-card-head">
          <span class="a-card-title">Orte</span>
          <button class="a-add-btn" data-action="add-location">+ Ort hinzufügen</button>
        </div>
        <div class="a-card-body tight">
          ${locationRows || '<div class="a-empty">Noch keine Orte erfasst.</div>'}
        </div>
      </div>

      <div class="a-card">
        <div class="a-card-head">
          <span class="a-card-title">Standardzeiten</span>
          <button class="a-add-btn" data-action="add-time">+ Zeit hinzufügen</button>
        </div>
        <div class="a-card-body tight">
          ${timeRows || '<div class="a-empty">Noch keine Zeiten erfasst.</div>'}
        </div>
      </div>

      <div class="a-card">
        <div class="a-card-head">
          <span class="a-card-title">Team</span>
          <span class="a-card-sub">${team.filter(m => m.active).length} aktiv · ${team.filter(m => !m.active).length} inaktiv</span>
          <button class="a-add-btn" data-action="add-member">+ Person hinzufügen</button>
        </div>
        <div class="a-card-body tight">
          ${teamRows || '<div class="a-empty">Noch keine Teammitglieder erfasst.</div>'}
        </div>
      </div>
    </div>`;
}

// ── Verlauf (activity log) page ───────────────────────────────────────────────

const ACTION_GROUP = {
  assign: 'zuteilung', unassign: 'zuteilung', swap: 'zuteilung',
  create: 'termin',    edit: 'termin',         delete: 'termin',
  close:  'ferien',    'close-batch': 'ferien', reopen: 'ferien',
  note:   'notiz',
};

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

function renderVerlaufPage(plan, log, groupFilter) {
  const { team } = plan;
  const teamById = Object.fromEntries(team.map(m => [m.id, m]));
  const today = localIso(new Date());

  const groups = [
    { id: 'all',       label: 'Alle' },
    { id: 'zuteilung', label: 'Zuteilungen' },
    { id: 'termin',    label: 'Termine' },
    { id: 'ferien',    label: 'Ferien' },
    { id: 'notiz',     label: 'Notizen' },
  ];

  const filtered = log.filter(e =>
    groupFilter === 'all' || ACTION_GROUP[e.action] === groupFilter
  );

  // Group by day
  const byDay = [];
  let curDay = null;
  filtered.forEach(e => {
    const day = e.at.slice(0, 10);
    if (day !== curDay) { curDay = day; byDay.push({ day, items: [] }); }
    byDay[byDay.length - 1].items.push(e);
  });

  const todayCount = log.filter(e => e.at.slice(0, 10) === today).length;

  const filterChips = groups.map(g => `
    <button class="act-pill${groupFilter === g.id ? ' on' : ''}"
      data-action="verlauf-filter" data-group="${g.id}">${g.label}</button>`
  ).join('');

  const dayBlocks = byDay.map(({ day, items }) => {
    const h = fmtDayHeading(day, today);
    const isToday = h.isToday;
    const entriesHtml = items.map(e => renderActivityEntry(e, teamById, today)).join('');
    return `
      <section class="act-day">
        <div class="act-day-head${isToday ? ' today' : ''}">
          <span class="act-day-title">${esc(h.kicker ?? h.body)}</span>
          ${h.kicker ? `<span class="act-day-sub">${esc(h.body)}</span>` : ''}
          <span class="act-day-count">${items.length}</span>
        </div>
        ${entriesHtml}
      </section>`;
  }).join('');

  return `
    <div class="admin-page">
      <header class="admin-hero">
        <div>
          <div class="admin-kicker">Aktivität</div>
          <h1 class="admin-title">Verlauf</h1>
        </div>
        <div class="activity-meta">
          <div><strong>${todayCount}</strong> heute · <strong>${log.length}</strong> insgesamt</div>
        </div>
      </header>

      <div class="act-controls">
        <div class="act-control-group">
          <span class="act-control-label">Typ</span>
          ${filterChips}
        </div>
      </div>

      ${byDay.length === 0
        ? `<div class="act-empty"><div class="big">Keine Aktivität</div><div>Noch keine Einträge vorhanden.</div></div>`
        : dayBlocks}
    </div>`;
}

function renderActivityEntry(e, teamById, today) {
  const iconName  = ACTION_ICON_NAME[e.action] ?? 'edit';
  const iconClass = ACTION_ICON_CLASS[e.action] ?? 'edit';
  const time      = e.at ? e.at.slice(11, 16) : '';
  const isRecent  = e.at?.slice(0, 10) === today;

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

  const humanFieldValue = (field, val) => {
    if (!val && val !== 0) return '—';
    if (field === 'type') return EVENT_TYPE_LABELS[val] ?? val;
    if (field === 'date' || field === 'dateEnd') return formatDate(val);
    if (field === 'comment' && val.length > 50) return val.slice(0, 48) + '…';
    return val;
  };

  const EVENT_TYPE_LABELS = {
    wednesday: 'Mittwoch',
    weekday:   'Wochentag',
    weekend:   'Wochenende',
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

  // Human-readable from→to for edit entries
  const fromToHtml = (from, to) => {
    if (!from && !to) return '';
    const parts = [];
    if (from) parts.push(`<span class="act-detail-from">${esc(from)}</span>`);
    if (to)   parts.push(`<span class="act-detail-to">${from ? '→ ' : ''}${esc(to)}</span>`);
    return `<div class="act-detail">${parts.join(' ')}</div>`;
  };

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

function fmtDayHeading(dayIso, todayIso) {
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

// ── Year overview page ────────────────────────────────────────────────────────

function renderYearPage(plan, summaries, yearStats, closedCount, personStats, filterPerson) {
  const { year, team } = plan;
  const activeTeam = team.filter(m => m.active);
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const currentMonth = today.getFullYear() === year ? today.getMonth() + 1 : null;

  // ── Filter bar ─────────────────────────────────────────────
  const allOn = !filterPerson;
  const filterChips = [
    `<button class="filter-chip all${allOn ? ' on' : ''}" data-action="year-person" data-id="">Alle anzeigen</button>`,
    ...activeTeam.map(m => {
      const on = filterPerson === m.id;
      return `<button class="filter-chip${on ? ' on' : ''}" style="--chip-color:${esc(m.color)}"
        data-action="year-person" data-id="${esc(m.id)}">
        <span class="fc-dot"></span>${esc(m.name)}
      </button>`;
    })
  ].join('');

  // ── Person stats for hero ───────────────────────────────────
  const heroPerson = filterPerson ? activeTeam.find(m => m.id === filterPerson) : null;
  const ps = filterPerson ? personStats.find(p => p.id === filterPerson) : null;

  // Find next upcoming event for filtered person
  let nextEvent = null;
  if (heroPerson) {
    for (let m = 1; m <= 12; m++) {
      const mo = getMonth(plan, m);
      if (!mo) continue;
      for (const e of (mo.events ?? [])) {
        if (e.isClosed) continue;
        if (!(e.assignedStaff ?? []).includes(filterPerson)) continue;
        if (e.date >= todayStr && (!nextEvent || e.date < nextEvent.date)) nextEvent = e;
      }
    }
  }

  // ── Hero section ────────────────────────────────────────────
  let heroHtml = '';
  if (heroPerson && ps) {
    let nextHtml;
    if (nextEvent) {
      const d = new Date(nextEvent.date + 'T00:00:00');
      nextHtml = `<div class="person-next">
        <div class="pn-date">
          <span class="pn-date-dow">${esc(WEEKDAY_SHORT[d.getDay()])}</span>
          <span class="pn-date-day">${String(d.getDate()).padStart(2,'0')}</span>
          <span class="pn-date-mon">${esc(MONATE_SHORT[d.getMonth()])}</span>
        </div>
        <div class="pn-body">
          <span class="pn-label">Nächster Einsatz</span>
          <div class="pn-main">
            <span class="pn-loc">${esc(nextEvent.location || '—')}</span>
            ${nextEvent.timeFrom && nextEvent.timeTo
              ? `<span class="pn-time">${esc(nextEvent.timeFrom)}–${esc(nextEvent.timeTo)}</span>`
              : ''}
          </div>
        </div>
      </div>`;
    } else {
      nextHtml = `<div class="person-next none">Kein anstehender Einsatz</div>`;
    }
    heroHtml = `<section class="person-hero">
      <div class="person-hero-text">
        <div class="person-kicker">
          <span class="pk-dot" style="background:${esc(heroPerson.color)}"></span>
          <span>Persönliche Übersicht · ${esc(String(year))}</span>
        </div>
        <div class="person-name-row">
          <h1 class="person-name">${esc(heroPerson.name)}</h1>
        </div>
        ${nextHtml}
      </div>
      <div class="person-stats">
        <div class="stat">
          <div class="stat-num">${ps.total}</div>
          <div class="stat-label">Einsätze</div>
        </div>
        <div class="stat">
          <div class="stat-num">${ps.wkd}</div>
          <div class="stat-label">Wochentage</div>
        </div>
        <div class="stat">
          <div class="stat-num">${ps.wke}</div>
          <div class="stat-label">Wochenenden</div>
        </div>
        <div class="stat">
          <div class="stat-num">${Math.round(ps.hrs + (ps.prepHrs ?? 0))}<span class="stat-num-unit">h</span></div>
          <div class="stat-label">Stunden</div>
        </div>
      </div>
    </section>`;
  } else {
    const cvClass = yearStats.coveragePct >= 95 ? 'ok' : yearStats.coveragePct >= 80 ? 'warn' : 'danger';
    heroHtml = `<section class="year-hero">
      <div>
        <div class="month-kicker"><span>Jahresübersicht</span></div>
        <h1 class="year-title">
          Alle Monate<span class="year-num">${year}</span>
        </h1>
      </div>
      <div class="year-stats">
        <div class="stat">
          <div class="stat-num">${yearStats.totalEvents}</div>
          <div class="stat-label">Einsätze</div>
        </div>
        <div class="stat">
          <div class="stat-num ${cvClass}">${yearStats.coveragePct}%</div>
          <div class="stat-label">Abdeckung</div>
        </div>
        <div class="stat">
          <div class="stat-num">${Math.round(yearStats.totalHours + yearStats.prepHours)}</div>
          <div class="stat-label">Stunden</div>
        </div>
        <div class="stat">
          <div class="stat-num${closedCount > 0 ? ' warn' : ''}">${closedCount}</div>
          <div class="stat-label">Ferien</div>
        </div>
      </div>
    </section>`;
  }

  // ── 12-month timeline ───────────────────────────────────────
  const monthsHtml = MONATE.map((name, i) => {
    const m = i + 1;
    const mo = getMonth(plan, m);
    const events = (mo?.events ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
    const summary = summaries?.[m] ?? summaries?.[String(m)] ?? {};
    const isPast  = currentMonth ? m < currentMonth : false;
    const isCurrent = m === currentMonth;

    // When filtering, skip months where person has no events
    const personEvents = filterPerson
      ? events.filter(e => !e.isClosed && (e.assignedStaff ?? []).includes(filterPerson))
      : null;
    if (filterPerson && personEvents.length === 0) return '';

    // Month head meta pips
    let metaPips = '';
    if (!filterPerson) {
      const total = summary.total ?? 0;
      const issues = summary.issues ?? 0;
      const pipTone = issues > 0 ? 'warn' : total > 0 ? 'ok' : '';
      metaPips = `<div class="ym-meta">
        <span class="pip${pipTone ? ' '+pipTone : ''}">
          <span class="pip-dot"></span>
          ${total} ${total === 1 ? 'Einsatz' : 'Einsätze'}
        </span>
        ${issues > 0 ? `<span class="pip warn"><span class="pip-dot"></span>${issues} offen</span>` : ''}
      </div>`;
    } else if (personEvents.length > 0) {
      metaPips = `<div class="ym-meta">
        <span class="pip ok"><span class="pip-dot"></span>${personEvents.length} ${personEvents.length === 1 ? 'Einsatz' : 'Einsätze'}</span>
      </div>`;
    }

    // Event rows
    const rowsHtml = events.map(e => {
      const d = new Date(e.date + 'T00:00:00');
      const dow = WEEKDAY_SHORT[d.getDay()];
      const dayNum = String(d.getDate()).padStart(2, '0');
      const isToday = e.date === todayStr;
      const isWeekend = e.type === 'weekend';
      const isClosed = e.isClosed;

      let rowClass = 'yr-row';
      if (isClosed) rowClass += ' closed';
      if (isWeekend) rowClass += ' weekend';
      if (isToday) rowClass += ' today';

      if (isClosed) {
        return `<div class="${rowClass}">
          <div class="yr-marker">
            <span class="yr-dow">${esc(dow)}</span>
            <span class="yr-num">${dayNum}</span>
          </div>
          <div class="yr-body">
            <div class="yr-closed">
              <div class="yr-closed-ic">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </div>
              <span>${escNl(e.comment || 'Keine Durchführung')}</span>
            </div>
          </div>
        </div>`;
      }

      const assigned = e.assignedStaff ?? [];
      const need = e.staffRequired ?? 0;
      const tone = need === 0 ? '' : assigned.length >= need ? 'ok' : assigned.length >= need - 1 ? 'warn' : 'danger';
      const matchesFilter = !filterPerson || assigned.includes(filterPerson);
      const missing = Math.max(0, need - assigned.length);

      const people = assigned.map(id => activeTeam.find(m => m.id === id)).filter(Boolean);
      const chipHtml = people.map(p => {
        const outline = filterPerson === p.id ? `outline:2px solid var(--ink);outline-offset:1px;` : '';
        return `<span class="yr-chip" title="${esc(p.name)}" style="background:${esc(p.color)};${outline}"><span class="yr-chip-dot"></span>${esc(p.name)}</span>`;
      }).join('') +
      Array.from({length: missing}, () => `<span class="yr-chip empty">+</span>`).join('') +
      (need > 0 ? `<span class="yr-meter-text ${tone}">${assigned.length}/${need}</span>` : '');

      return `<div class="${rowClass}">
        <div class="yr-marker">
          <span class="yr-dow">${esc(dow)}</span>
          <span class="yr-num">${dayNum}</span>
        </div>
        <div class="yr-body">
          <div class="yr-event ${tone}${matchesFilter ? '' : ' dim'}" data-action="toggle-yr-event" data-id="${esc(e.id)}" data-month="${m}">
            <div class="yr-ev-main">
              <span class="yr-ev-loc">${esc(e.location || '—')}</span>
              ${(e.timeFrom && e.timeTo) ? `<span class="yr-ev-times">
                ${e.timeSetup ? `<span class="ev-edge" title="Aufbau ab ${esc(e.timeSetup)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>${esc(e.timeSetup)}</span>` : ''}
                <span class="ev-core">${esc(e.timeFrom)}<span>–</span>${esc(e.timeTo)}</span>
                ${e.timeTeardown ? `<span class="ev-edge" title="Abbau bis ${esc(e.timeTeardown)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H7M12 7l-5 5 5 5"/></svg>${esc(e.timeTeardown)}</span>` : ''}
              </span>` : ''}
              ${isWeekend ? `<span class="yr-ev-tag">WE</span>` : ''}
            </div>
            <div class="yr-ev-chips">${chipHtml}</div>
            <div class="yr-ev-detail">
              ${e.comment ? `<div class="yr-ev-detail-comment">${escNl(e.comment)}</div>` : ''}
              <div class="yr-ev-detail-row">
                ${people.length > 0 ? `<div class="yr-ev-detail-people">${people.map(p =>
                  `<span class="yr-ev-detail-chip" style="background:${esc(p.color)}">${esc(p.name)}</span>`
                ).join('')}</div>` : ''}
                ${isWeekend && e.dateEnd ? `<div class="yr-ev-detail-meta">bis ${esc(formatDate(e.dateEnd))}</div>` : ''}
                <button class="yr-ev-edit-btn" data-action="edit-event" data-id="${esc(e.id)}" data-month="${m}">Bearbeiten</button>
              </div>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const emptyHtml = events.length === 0 && !filterPerson
      ? `<div class="ym-empty">Keine Einsätze geplant.</div>` : '';

    return `
      <section class="year-month${isCurrent ? ' current' : ''}${isPast ? ' past' : ''}">
        <div class="year-month-head" data-action="nav-month" data-month="${m}">
          <span class="ym-num">${String(m).padStart(2,'0')}</span>
          <div class="ym-head-mid">
            <span class="ym-name">${esc(name)}</span>
            ${metaPips}
          </div>
          <span class="ym-chev">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
        </div>
        ${emptyHtml}
        ${rowsHtml}
      </section>`;
  }).join('');

  // No-match state when filtering
  const hasAny = filterPerson && MONATE.some((_, i) => {
    const m = i + 1;
    const mo = getMonth(plan, m);
    return (mo?.events ?? []).some(e => !e.isClosed && (e.assignedStaff ?? []).includes(filterPerson));
  });
  const noMatchHtml = filterPerson && !hasAny
    ? `<div class="yr-no-match">
        <div class="big">Keine Einsätze gefunden</div>
        <div>${esc(heroPerson?.name ?? filterPerson)} hat in ${year} noch keine zugeteilten Einsätze.</div>
      </div>` : '';

  return `
    <div class="filter-bar year-filter-bar${filterPerson ? ' active' : ''}">
      <div class="filter-bar-inner">
        <span class="filter-label">Filter</span>
        <div class="filter-chips">${filterChips}</div>
      </div>
    </div>
    <div class="year-page">
      ${heroHtml}
      ${noMatchHtml}
      ${monthsHtml}
    </div>`;
}

// ── Quick-assign popover ──────────────────────────────────────────────────────

function renderQAPopover(team, assignedStaff, eventId, month) {
  const rows = team.filter(m => m.active).map(m => {
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

// ═══════════════════════════════════════════════════════════════════════════
// 4. CONTROLLERS
// Orchestrate: call Go → update state → call render → update DOM
// ═══════════════════════════════════════════════════════════════════════════

// ── DOM update helpers ───────────────────────────────────────────────────────

function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  const page = document.getElementById('page-' + id);
  if (page) page.classList.add('active');
  state.currentPage = id;
}

function setDirtyUI(isDirty) {
  const pill  = document.getElementById('save-state');
  const label = document.getElementById('save-state-label');
  if (pill)  pill.classList.toggle('dirty', isDirty);
  if (label) label.textContent = isDirty ? 'Ungespeichert' : 'Gespeichert';
  const btnSave = document.getElementById('btn-save');
  if (btnSave) btnSave.disabled = !isDirty;
  if (isDirty) scheduleAutosave();
}

function refreshSidebar() {
  if (!state.plan) return;
  Planner.GetMonthSummaries().then(summaries => {
    document.getElementById('nav-months').innerHTML =
      renderMonthNav(state.plan, summaries, state.currentMonth, state.currentPage);
  });
}

function refreshSidebarSync(summaries) {
  document.getElementById('nav-months').innerHTML =
    renderMonthNav(state.plan, summaries, state.currentMonth, state.currentPage);
}

// ── After plan loaded ────────────────────────────────────────────────────────

async function onPlanLoaded(plan) {
  state.plan = plan;
  const teamName = plan.settings?.teamName;
  document.getElementById('sidebar-team-name').textContent = teamName || 'Einsatzplan';
  document.getElementById('sidebar-year-label').textContent = `Einsatzplan · ${plan.year}`;
  document.title = `Einsatzplan ${plan.year}`;
  document.getElementById('sb-filename').textContent = plan.year;
  setDirtyUI(false);
  Planner.GetCurrentFileName().then(name => {
    if (name) document.getElementById('sb-filename').textContent = name;
  }).catch(() => {});

  // Enable nav buttons
  ['settings','statistics','verlauf','year'].forEach(p => {
    const btn = document.getElementById(`nav-btn-${p}`);
    if (btn) btn.disabled = false;
  });

  // Navigate to current month or month 1
  const now = new Date();
  const m = plan.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  await navigateToMonth(m);

}

// ── Navigation ────────────────────────────────────────────────────────────────

async function navigateToMonth(month) {
  state.currentMonth = month;
  try {
    const [events, summaries, stats] = await Promise.all([
      Planner.GetMonthEvents(month),
      Planner.GetMonthSummaries(),
      Planner.GetYearStats(month),
    ]);
    document.getElementById('month-content').innerHTML =
      renderMonthPage(state.plan, month, events, stats, state.monthPerson);
    refreshSidebarSync(summaries);
    showPage('month');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

async function showStatisticsPage() {
  try {
    const [stats, personStats] = await Promise.all([
      Planner.GetYearStats(state.statsMonth),
      Planner.GetPersonStats(state.statsMonth),
    ]);
    document.getElementById('statistics-content').innerHTML =
      renderStatisticsPage(state.plan, stats, personStats, state.statsMonth);
    showPage('statistics');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

async function showSettingsPage() {
  document.getElementById('settings-content').innerHTML = renderSettingsPage(state.plan);
  showPage('settings');
}

async function showVerlaufPage() {
  try {
    const log = await Planner.GetActivityLog();
    document.getElementById('verlauf-content').innerHTML =
      renderVerlaufPage(state.plan, log, state.verlaufGroup);
    showPage('verlauf');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

async function showYearPage() {
  try {
    const [summaries, yearStats, personStats] = await Promise.all([
      Planner.GetMonthSummaries(),
      Planner.GetYearStats(0),
      Planner.GetPersonStats(0),
    ]);
    const closedCount = Object.values(state.plan.months || {})
      .reduce((n, m) => n + (m.events || []).filter(e => e.isClosed).length, 0);
    document.getElementById('year-content').innerHTML =
      renderYearPage(state.plan, summaries, yearStats, closedCount, personStats, state.yearPerson);
    showPage('year');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

// ── File operations ───────────────────────────────────────────────────────────

async function cmdNew() {
  showModal('modal-new-year');
}

async function cmdOpen() {
  try {
    const plan = await Planner.OpenPlan();
    if (!plan) return;
    await onPlanLoaded(plan);
  } catch (e) {
    showToast('Fehler beim Öffnen: ' + e, 'error');
  }
}

async function cmdSave() {
  try {
    await Planner.SavePlan();
    setDirtyUI(false);
    hideExternalChangeBanner();
    _autosavePaused = false;
    showToast('Gespeichert.', 'success');
  } catch (e) {
    const msg = String(e);
    if (msg.includes('conflict')) {
      const ok = await showConfirm({
        kicker: 'Konflikt',
        title: 'Datei wurde extern geändert',
        message: 'Eine andere Person hat diese Datei gespeichert.<br>Trotzdem überschreiben?',
        okLabel: 'Überschreiben',
      });
      if (ok) {
        try {
          await Planner.ForceOverwriteSave();
          setDirtyUI(false);
          hideExternalChangeBanner();
          _autosavePaused = false;
          showToast('Gespeichert (überschrieben).', 'success');
        } catch (e2) {
          showToast('Fehler beim Speichern: ' + e2, 'error');
        }
      }
    } else {
      showToast('Fehler beim Speichern: ' + e, 'error');
    }
  }
}

// ── Event modal ──────────────────────────────────────────────────────────────

let _eventId       = null;
let _eventMonth    = null;
let _eventType     = null;
let _eventDate     = null;
let _eventFromPage = null; // 'year' | null — where the edit modal was opened from

async function openAddEvent(type, date, month) {
  _eventId    = null;
  _eventMonth = month ?? state.currentMonth;
  _eventType  = type;
  _eventDate  = date || '';

  document.getElementById('modal-event-title').textContent = 'Einsatz hinzufügen';
  document.getElementById('btn-modal-event-delete').style.display = 'none';
  document.getElementById('event-is-closed').checked = false;
  document.getElementById('event-fields').style.display = '';

  // Show date row if no date pinned
  const dateRow = document.getElementById('event-date-row');
  const dateEndGroup = document.getElementById('event-date-end-group');
  if (date) {
    dateRow.style.display = 'none';
    const d = new Date(date + 'T00:00:00');
    document.getElementById('event-display-weekday').textContent = WEEKDAY_LONG[d.getDay()];
    document.getElementById('event-display-date').textContent =
      `${d.getDate()}. ${MONATE[d.getMonth()]} ${state.plan.year}`;
  } else {
    dateRow.style.display = '';
    document.getElementById('event-date-input').value = '';
    document.getElementById('event-display-weekday').textContent = '';
    document.getElementById('event-display-date').textContent = type === 'weekend' ? 'Wochenende' : 'Wochentag';
  }
  dateEndGroup.style.display = type === 'weekend' ? '' : 'none';

  document.getElementById('event-location').value    = '';
  document.getElementById('event-time-from').value   = '';
  document.getElementById('event-time-to').value     = '';
  document.getElementById('event-time-setup').value    = '';
  document.getElementById('event-time-teardown').value = '';
  document.getElementById('event-staff-required').value = '2';
  document.getElementById('event-staff-display').textContent = '2';
  document.getElementById('event-comment').value     = '';

  populateLocationDatalist(state.plan.settings.locations ?? []);
  populateTimePresets(state.plan.settings.defaultTimes ?? []);
  populateStaffList(state.plan.team, []);
  showModal('modal-event');
}

async function openEditEvent(eventId, month) {
  const events = getMonth(state.plan, month)?.events ?? [];
  const ev = events.find(e => e.id === eventId);
  if (!ev) return;

  _eventId    = eventId;
  _eventMonth = month;
  _eventType  = ev.type;
  _eventDate  = ev.date;

  document.getElementById('modal-event-title').textContent = 'Einsatz bearbeiten';
  document.getElementById('btn-modal-event-delete').style.display = '';
  document.getElementById('event-date-row').style.display = 'none';
  document.getElementById('event-is-closed').checked = ev.isClosed;
  document.getElementById('event-fields').style.display = ev.isClosed ? 'none' : '';
  document.getElementById('event-closed-label').classList.toggle('is-closed', ev.isClosed);

  const d = new Date(ev.date + 'T00:00:00');
  document.getElementById('event-display-weekday').textContent = WEEKDAY_LONG[d.getDay()];
  document.getElementById('event-display-date').textContent =
    `${d.getDate()}. ${MONATE[d.getMonth()]} ${state.plan.year}`;

  document.getElementById('event-location').value   = ev.location   ?? '';
  document.getElementById('event-time-from').value  = ev.timeFrom   ?? '';
  document.getElementById('event-time-to').value    = ev.timeTo     ?? '';
  document.getElementById('event-time-setup').value    = ev.timeSetup    ?? '';
  document.getElementById('event-time-teardown').value = ev.timeTeardown ?? '';
  const need = ev.staffRequired ?? 0;
  document.getElementById('event-staff-required').value = need;
  document.getElementById('event-staff-display').textContent = need;
  document.getElementById('event-comment').value    = ev.comment    ?? '';
  document.getElementById('event-date-end-group').style.display = ev.type === 'weekend' ? '' : 'none';
  document.getElementById('event-date-end-input').value = ev.dateEnd ?? '';

  populateLocationDatalist(state.plan.settings.locations ?? []);
  populateTimePresets(state.plan.settings.defaultTimes ?? []);
  populateStaffList(state.plan.team, ev.assignedStaff ?? []);
  showModal('modal-event');
}

async function confirmEventModal() {
  const isClosed  = document.getElementById('event-is-closed').checked;
  const location  = document.getElementById('event-location').value.trim();
  const timeFrom     = document.getElementById('event-time-from').value;
  const timeTo       = document.getElementById('event-time-to').value;
  const timeSetup    = document.getElementById('event-time-setup').value    || '';
  const timeTeardown = document.getElementById('event-time-teardown').value || '';
  const need      = parseInt(document.getElementById('event-staff-required').value, 10) || 0;
  const comment   = document.getElementById('event-comment').value.trim();
  const date      = _eventDate || document.getElementById('event-date-input').value;
  const dateEnd   = document.getElementById('event-date-end-input')?.value || '';

  if (!isClosed && !date) {
    showToast('Datum fehlt', 'error');
    return;
  }

  const assignedStaff = [...document.querySelectorAll('.staff-pick.on')].map(b => b.dataset.id);

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
      await Planner.UpdateEvent(_eventMonth, ev);
    } else {
      await Planner.CreateEvent(_eventMonth, ev);
    }
    // Auto-add new location only after the event was accepted by the backend.
    if (location && !(state.plan.settings.locations ?? []).includes(location)) {
      const newSettings = { ...state.plan.settings, locations: [...(state.plan.settings.locations ?? []), location] };
      await Planner.UpdateSettings(newSettings);
      state.plan.settings = newSettings;
    }
    state.plan = await Planner.GetPlan();
    closeModal('modal-event');
    setDirtyUI(true);
    if (_eventFromPage === 'year') await showYearPage();
    else await navigateToMonth(_eventMonth);
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

async function deleteEventModal() {
  if (!_eventId) return;
  try {
    await Planner.DeleteEvent(_eventMonth, _eventId);
    state.plan = await Planner.GetPlan();
    closeModal('modal-event');
    setDirtyUI(true);
    if (_eventFromPage === 'year') await showYearPage();
    else await navigateToMonth(_eventMonth);
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

// ── Quick-assign ──────────────────────────────────────────────────────────────

let _qaEventId = null;
let _qaMonth   = null;

async function openQA(eventId, month, anchorEl) {
  _qaEventId = eventId;
  _qaMonth   = month;
  const events = getMonth(state.plan, month)?.events ?? [];
  const ev = events.find(e => e.id === eventId);
  if (!ev) return;

  const pop = document.getElementById('qa-popover');
  pop.innerHTML = renderQAPopover(state.plan.team, ev.assignedStaff ?? [], eventId, month);
  pop.style.display = 'block';

  const rect = anchorEl.getBoundingClientRect();
  const inner = pop.querySelector('#qa-pop-inner');
  if (inner) {
    inner.style.position = 'fixed';
    inner.style.left = rect.left + 'px';
    inner.style.top  = (rect.bottom + 6) + 'px';
    inner.style.zIndex = '200';
  }
}

async function qaToggle(memberId, eventId, month) {
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

// ── Team member modal ─────────────────────────────────────────────────────────

let _memberEditId = null;
let _memberColor  = TEAM_COLORS[0];

function openAddMember() {
  _memberEditId = null;
  _memberColor  = TEAM_COLORS[state.plan.team.length % TEAM_COLORS.length];
  document.getElementById('modal-member-title').textContent = 'Person hinzufügen';
  document.getElementById('input-member-name').value  = '';
  document.getElementById('input-member-exclude-hours').checked = false;
  document.getElementById('input-member-active').checked = true;
  document.getElementById('modal-member-active-row').style.display = 'none';
  renderColorPicker(state.plan.team);
  showModal('modal-member');
}

function openEditMember(id) {
  const m = state.plan.team.find(t => t.id === id);
  if (!m) return;
  _memberEditId = id;
  _memberColor  = m.color;
  document.getElementById('modal-member-title').textContent = 'Person bearbeiten';
  document.getElementById('input-member-name').value  = m.name;
  document.getElementById('input-member-exclude-hours').checked = !!m.excludeFromHours;
  document.getElementById('input-member-active').checked = !!m.active;
  document.getElementById('modal-member-active-row').style.display = 'flex';
  renderColorPicker(state.plan.team);
  showModal('modal-member');
}

async function confirmMemberModal() {
  const name  = document.getElementById('input-member-name').value.trim();
  if (!name) {
    document.getElementById('input-member-name').style.borderColor = 'var(--rose)';
    return;
  }
  try {
    const excludeFromHours = document.getElementById('input-member-exclude-hours').checked;
    const active = _memberEditId ? document.getElementById('input-member-active').checked : true;
    if (_memberEditId) {
      const m = state.plan.team.find(t => t.id === _memberEditId);
      await Planner.UpdateMember({ ...m, name, color: _memberColor, excludeFromHours, active });
    } else {
      await Planner.CreateMember({ id: '', name, color: _memberColor, active: true, excludeFromHours });
    }
    state.plan = await Planner.GetPlan();
    closeModal('modal-member');
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

async function toggleMemberActive(id) {
  try {
    await Planner.ToggleMemberActive(id);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

async function deleteMember(id) {
  try {
    await Planner.DeleteMember(id);
    state.plan = await Planner.GetPlan();
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

// ── Location modal ────────────────────────────────────────────────────────────

let _locationEditIndex = -1;

function openAddLocation() {
  _locationEditIndex = -1;
  document.getElementById('modal-location-title').textContent = 'Ort hinzufügen';
  document.getElementById('input-location-name').value = '';
  showModal('modal-location');
}

function openEditLocation(index) {
  _locationEditIndex = index;
  document.getElementById('modal-location-title').textContent = 'Ort bearbeiten';
  document.getElementById('input-location-name').value = state.plan.settings.locations[index] ?? '';
  showModal('modal-location');
}

async function confirmLocationModal() {
  const name = document.getElementById('input-location-name').value.trim();
  if (!name) return;
  const locs = [...(state.plan.settings.locations ?? [])];
  if (_locationEditIndex >= 0) locs[_locationEditIndex] = name;
  else locs.push(name);
  const s = { ...state.plan.settings, locations: locs };
  try {
    await Planner.UpdateSettings(s);
    state.plan.settings = s;
    closeModal('modal-location');
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e, 'error');
  }
}

async function deleteLocation(index) {
  const locs = [...(state.plan.settings.locations ?? [])];
  locs.splice(index, 1);
  const s = { ...state.plan.settings, locations: locs };
  try {
    await Planner.UpdateSettings(s);
    state.plan.settings = s;
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}

// ── Time preset modal ─────────────────────────────────────────────────────────

let _timeEditIndex = -1;

function openAddTime() {
  _timeEditIndex = -1;
  document.getElementById('modal-time-title').textContent = 'Standardzeit hinzufügen';
  document.getElementById('input-time-label').value    = '';
  document.getElementById('input-time-from').value     = '13:30';
  document.getElementById('input-time-to').value       = '17:30';
  document.getElementById('input-time-setup').value    = '';
  document.getElementById('input-time-teardown').value = '';
  showModal('modal-time');
}

function openEditTime(index) {
  _timeEditIndex = index;
  const t = state.plan.settings.defaultTimes[index];
  document.getElementById('modal-time-title').textContent = 'Standardzeit bearbeiten';
  document.getElementById('input-time-label').value    = t?.label        ?? '';
  document.getElementById('input-time-from').value     = t?.from         ?? '13:30';
  document.getElementById('input-time-to').value       = t?.to           ?? '17:30';
  document.getElementById('input-time-setup').value    = t?.timeSetup    ?? '';
  document.getElementById('input-time-teardown').value = t?.timeTeardown ?? '';
  showModal('modal-time');
}

async function confirmTimeModal() {
  const label        = document.getElementById('input-time-label').value.trim();
  const from         = document.getElementById('input-time-from').value;
  const to           = document.getElementById('input-time-to').value;
  const timeSetup    = document.getElementById('input-time-setup').value    || '';
  const timeTeardown = document.getElementById('input-time-teardown').value || '';
  const times = [...(state.plan.settings.defaultTimes ?? [])];
  const entry = { label: label || 'Standard', from, to, ...(timeSetup    && { timeSetup }),
                                                          ...(timeTeardown && { timeTeardown }) };
  if (_timeEditIndex >= 0) times[_timeEditIndex] = entry;
  else times.push(entry);
  const s = { ...state.plan.settings, defaultTimes: times };
  try {
    await Planner.UpdateSettings(s);
    state.plan.settings = s;
    closeModal('modal-time');
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Speichern: ' + e, 'error');
  }
}

async function deleteTime(index) {
  const times = [...(state.plan.settings.defaultTimes ?? [])];
  times.splice(index, 1);
  const s = { ...state.plan.settings, defaultTimes: times };
  try {
    await Planner.UpdateSettings(s);
    state.plan.settings = s;
    setDirtyUI(true);
    await showSettingsPage();
  } catch (e) {
    showToast('Fehler beim Löschen: ' + e, 'error');
  }
}

// ── Reopen last file ──────────────────────────────────────────────────────────

async function tryRestoreLastFile() {
  try {
    const paths = await Planner.GetRecentPaths();
    if (!paths || paths.length === 0) return;
    const list = document.getElementById('welcome-reopen-list');
    const container = document.getElementById('welcome-reopen');
    if (!list || !container) return;
    list.innerHTML = '';
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() || path;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)';
      row.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <div style="flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;color:var(--ink)" title="${esc(path)}">${esc(name)}</div>
        <button class="dlg-btn primary btn-sm">Öffnen</button>`;
      row.querySelector('button').addEventListener('click', async () => {
        try {
          const plan = await Planner.ReopenPlan(path);
          if (plan) await onPlanLoaded(plan);
        } catch {
          showToast('Datei nicht mehr gefunden.', 'error');
        }
      });
      list.appendChild(row);
    }
    container.style.display = '';
  } catch { /* ignore */ }
}

// ── New year modal ────────────────────────────────────────────────────────────

async function confirmNewYear() {
  const year = parseInt(document.getElementById('input-new-year').value, 10);
  if (!year || year < 2020 || year > 2099) {
    document.getElementById('input-new-year').style.borderColor = 'var(--rose)';
    return;
  }
  try {
    const plan = await Planner.CreatePlan(year);
    if (!plan) return; // user cancelled dialog
    closeModal('modal-new-year');
    await onPlanLoaded(plan);
    showToast(`Einsatzplan ${year} erstellt.`, 'success');
  } catch (e) {
    showToast('Fehler: ' + e, 'error');
  }
}

// ── Export modal ──────────────────────────────────────────────────────────────

const exportState = {
  tab: 'ical',          // 'ical' | 'pdf'
  persons: new Set(),   // selected person IDs for iCal
  months: new Set(),    // selected month numbers (1-12) for PDF
};

function openExportModal() {
  const plan = state.plan;
  if (!plan) return;

  // Init: all active persons selected
  exportState.tab = 'ical';
  exportState.persons = new Set(plan.team.filter(m => m.active).map(m => m.id));

  // Init months: next month only by default
  const now = new Date();
  const curMonth = plan.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  const nextMonth = curMonth < 12 ? curMonth + 1 : 12;
  exportState.months = new Set([nextMonth]);

  document.getElementById('export-head-sub').textContent = `Export · ${plan.year}`;
  renderExportModal();
  showModal('modal-export');
}

function renderExportModal() {
  const plan = state.plan;
  if (!plan) return;
  const { tab, persons, months } = exportState;
  const activeTeam = plan.team.filter(m => m.active);
  const year = plan.year;

  // Update tab buttons
  document.querySelectorAll('.export-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  let bodyHtml = '';
  if (tab === 'ical') {
    const personChips = activeTeam.map(m => {
      const on = persons.has(m.id);
      return `<button class="export-person-chip${on ? ' on' : ''}"
        data-action="export-person-toggle" data-id="${esc(m.id)}"
        style="--chip-c:${esc(m.color)}">
        <span class="ep-dot" style="background:${esc(m.color)}"></span>
        ${esc(m.name)}
      </button>`;
    }).join('');

    bodyHtml = `
      <div class="export-info-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <div>
          <strong>Importiert in Apple Kalender, Google Kalender oder Outlook.</strong>
          <p>Lädt eine .ics-Datei mit allen Einsätzen für ${year} herunter — nur die Termine, für die mindestens eine der gewählten Personen eingeteilt ist.</p>
        </div>
      </div>
      <div>
        <div class="export-section-head">
          <span class="export-section-label">Personen</span>
          <div class="export-toggle-group">
            <button data-action="export-all-persons">Alle</button>
            <button data-action="export-no-persons">Keine</button>
          </div>
        </div>
        <div class="export-person-chips">${personChips}</div>
      </div>`;

    const filename = `einsatzplan-${year}.ics`;
    document.getElementById('export-foot-filename').textContent = filename;
    document.getElementById('btn-export-confirm').textContent = '↓ Kalender herunterladen';
  } else {
    // PDF tab
    const now = new Date();
    const curMonth = plan.year === now.getFullYear() ? now.getMonth() + 1 : null;

    const monthItems = MONATE.map((name, i) => {
      const m = i + 1;
      const mo = getMonth(plan, m);
      const evCount = (mo?.events ?? []).filter(e => !e.isClosed).length;
      const on = months.has(m);
      const isCur = m === curMonth;
      const isEmpty = evCount === 0;
      return `<div class="export-month-item${on ? ' on' : ''}${isEmpty ? ' empty' : ''}"
        data-action="${isEmpty ? '' : 'export-month-toggle'}" data-month="${m}">
        ${isCur ? `<span class="export-month-badge">Aktuell</span>` : ''}
        <div class="export-month-name">${esc(name)}</div>
        <div class="export-month-sub">${evCount > 0 ? `${evCount} Einsätze` : '—'}</div>
        <div class="export-month-check">
          <svg viewBox="0 0 24 24" fill="none" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        </div>
      </div>`;
    }).join('');

    bodyHtml = `
      <div class="export-info-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        <div>
          <strong>Druckfertiges PDF zum Aushängen im Büro.</strong>
          <p>Ein Monat pro Seite mit Datum, Ort, Zeit und Team. Geschlossene Tage und offene Stellen sind markiert.</p>
        </div>
      </div>
      <div>
        <div class="export-section-head">
          <span class="export-section-label">Monate auswählen</span>
          <div class="export-toggle-group">
            <button data-action="export-month-preset" data-preset="current">Aktuell</button>
            <button data-action="export-month-preset" data-preset="remaining">Verbleibend</button>
            <button data-action="export-month-preset" data-preset="all">Ganzes Jahr</button>
          </div>
        </div>
        <div class="export-month-grid">${monthItems}</div>
      </div>`;

    const count = months.size;
    document.getElementById('export-foot-filename').textContent = `einsatzplan-${year}.pdf · ${count} Seite${count !== 1 ? 'n' : ''}`;
    document.getElementById('btn-export-confirm').textContent = '↓ PDF herunterladen';
  }

  document.getElementById('export-body').innerHTML = bodyHtml;
}

async function doExportICal() {
  const plan = state.plan;
  if (!plan) return;
  const personIDs = [...exportState.persons];
  try {
    await Planner.ExportICal(personIDs);
    closeModal('modal-export');
    showToast('Kalender exportiert.', 'success');
  } catch (e) {
    if (e) showToast('Export fehlgeschlagen: ' + e, 'error');
  }
}

function doExportPDF() {
  const plan = state.plan;
  if (!plan) return;
  const selectedMonths = [...exportState.months].sort((a, b) => a - b);
  if (selectedMonths.length === 0) {
    showToast('Keine Monate ausgewählt.', 'warn');
    return;
  }

  const teamByID = {};
  plan.team.forEach(m => { teamByID[m.id] = m; });

  const teamName = esc(plan.settings?.teamName || 'Einsatzplan');

  // Height estimates in mm. Usable area per page = A4 297mm − 20mm top − 25mm bottom = 252mm.
  // Each page div has its own padding so margins are consistent on every page.
  const PAGE_H    = 252;  // 297 - 20 - 25
  const H_TITLE   = 11;   // p-doc-title + margin-bottom
  const H_FOOTER  = 8;    // p-page-footer
  const H_HEADING = 14;   // month title + divider + spacing
  const H_TH      = 6.5;  // table header row
  const H_ROW     = 7;    // event row
  const H_NOTE    = 4.5;  // note sub-row
  const H_EMPTY   = 7;    // "no events" paragraph
  const H_GAP     = 7;    // margin-bottom between months

  // Build month HTML + estimated height.
  const monthData = selectedMonths.map(m => {
    const mo = getMonth(plan, m);
    const allEvents = [...(mo?.events ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const noteCount = allEvents.filter(ev => !ev.isClosed && ev.comment).length;
    const estimatedMM = H_HEADING
      + (allEvents.length > 0
          ? H_TH + allEvents.length * H_ROW + noteCount * H_NOTE
          : H_EMPTY)
      + H_GAP;

    const rows = allEvents.map(ev => {
      const d = new Date(ev.date + 'T00:00:00');
      const dayStr = `${WEEKDAY_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
      const time = ev.timeFrom && ev.timeTo ? `${ev.timeFrom}–${ev.timeTo}` : '—';
      const loc = ev.location || '—';

      if (ev.isClosed) {
        return `<tr class="p-row-closed">
          <td class="p-date">${dayStr}</td>
          <td class="p-loc" colspan="3"><span class="p-closed-badge">Keine Durchführung</span></td>
        </tr>`;
      }

      const names = (ev.assignedStaff ?? []).map(id => {
        const mb = teamByID[id];
        return mb ? `<span class="p-chip"><span class="p-dot" style="background:${esc(mb.color)}"></span>${esc(mb.name)}</span>` : '';
      }).join('');
      const noteRow = ev.comment
        ? `<tr class="p-note-row"><td colspan="4" class="p-note-cell">${escNl(ev.comment)}</td></tr>`
        : '';
      return `<tr>
        <td class="p-date">${dayStr}</td>
        <td class="p-loc">${esc(loc)}</td>
        <td class="p-time">${esc(time)}</td>
        <td class="p-team">${names || '—'}</td>
      </tr>${noteRow}`;
    }).join('');

    const tableOrEmpty = allEvents.length > 0
      ? `<table class="p-table"><thead><tr>
          <th class="p-date">Datum</th><th class="p-loc">Ort</th><th class="p-time">Zeit</th><th>Team</th>
        </tr></thead><tbody>${rows}</tbody></table>`
      : '<p class="p-empty">Keine Einsätze in diesem Monat.</p>';

    return {
      estimatedMM,
      html: `<div class="p-month">
        <div class="p-month-heading">
          <div class="p-month-title">${esc(MONATE[m - 1])} ${plan.year}</div>
          <div class="p-divider"></div>
        </div>
        ${tableOrEmpty}
      </div>`,
    };
  });

  // Group months into pages. Each page is an explicit div with its own padding,
  // team name header and footer — so margins, header and footer repeat on every page.
  const pageGroups = [];
  let curGroup = [];
  let usedMM = H_TITLE + H_FOOTER;
  for (const md of monthData) {
    if (curGroup.length > 0 && usedMM + md.estimatedMM > PAGE_H) {
      pageGroups.push(curGroup);
      curGroup = [md];
      usedMM = H_TITLE + H_FOOTER + md.estimatedMM;
    } else {
      curGroup.push(md);
      usedMM += md.estimatedMM;
    }
  }
  if (curGroup.length > 0) pageGroups.push(curGroup);

  const footerDate = new Date().toLocaleDateString('de-CH');
  const footerHtml = `<div class="p-page-footer">Stand: ${footerDate} · Einsatzplan ${plan.year}</div>`;

  const pagesHtml = pageGroups.map((group, i) => `
    <div class="p-page${i > 0 ? ' p-page-break' : ''}">
      <div class="p-page-content">
        <div class="p-doc-title">${teamName}</div>
        ${group.map(m => m.html).join('')}
      </div>
      ${footerHtml}
    </div>`).join('');

  // Each .p-page div carries its own padding so margins are identical on every page.
  // @page { margin: 0 } prevents the system print dialog from adding extra margins on top.
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8">
  <title>Einsatzplan ${plan.year}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    @page { size: A4 portrait; margin: 0; }
    body {
      font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif;
      font-size: 10.5pt; color: #1a1a1a;
      print-color-adjust: exact; -webkit-print-color-adjust: exact;
    }
    .p-page {
      width: 210mm;
      padding: 20mm 25mm 25mm;
    }
    .p-page-break { break-before: page; }
    .p-doc-title { font-size: 13pt; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #1a1a1a; margin-bottom: 6mm; }
    .p-month { margin-bottom: 8mm; }
    .p-month-heading { margin-bottom: 6px; }
    .p-month-title { font-size: 20pt; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; color: #1a1a1a; margin-bottom: 5px; }
    .p-divider { border-bottom: 2px solid #1a1a1a; }
    .p-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
    .p-table th { font-size: 7.5pt; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #999; padding: 5px 8px 4px; border-bottom: 1px solid #ddd; text-align: left; }
    .p-table td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; font-size: 10pt; }
    .p-note-row td { border-bottom: 1px solid #f0f0f0; padding-top: 0; }
    .p-table tr:last-child td { border-bottom: none; }
    .p-date { font-weight: 600; white-space: nowrap; width: 84px; }
    .p-loc  { font-weight: 500; width: 140px; }
    .p-time { color: #555; white-space: nowrap; width: 90px; font-variant-numeric: tabular-nums; }
    .p-chip { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; white-space: nowrap; font-size: 9.5pt; }
    .p-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
    .p-note-cell { font-size: 8.5pt; color: #777; padding-bottom: 6px; font-style: italic; }
    .p-row-closed td { color: #bbb; }
    .p-closed-badge { font-size: 8pt; color: #b45309; font-style: italic; }
    .p-empty { color: #999; margin-top: 8px; font-size: 9.5pt; }
    .p-page-footer { margin-top: 10mm; font-size: 7.5pt; color: #bbb; text-align: right; }
  </style>
  </head><body>
    ${pagesHtml}
  </body></html>`;

  // Use a hidden iframe — avoids popup blocker in the WebView
  closeModal('modal-export');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;border:none;pointer-events:none';
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    // Remove after print dialog closes (afterprint fires when dialog is dismissed).
    iframe.contentWindow.addEventListener('afterprint', () => iframe.remove(), { once: true });
    // Fallback removal in case afterprint never fires (some browsers/WebViews).
    setTimeout(() => iframe.remove(), 30000);
  };
  const idoc = iframe.contentDocument;
  idoc.open();
  idoc.write(html);
  idoc.close();
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function showModal(id) {
  document.getElementById(id)?.classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id)?.classList.add('hidden');
}

// Shows a styled confirm dialog. Returns a Promise<boolean>.
let _confirmResolve = null;
function showConfirm({ kicker = '', title = '', message = '', okLabel = 'OK' } = {}) {
  document.getElementById('modal-confirm-kicker').textContent = kicker;
  document.getElementById('modal-confirm-title').textContent = title;
  document.getElementById('modal-confirm-msg').innerHTML = message;
  document.getElementById('btn-modal-confirm-ok').textContent = okLabel;
  showModal('modal-confirm');
  return new Promise(resolve => { _confirmResolve = resolve; });
}
document.getElementById('btn-modal-confirm-ok')?.addEventListener('click', () => {
  closeModal('modal-confirm');
  if (_confirmResolve) { _confirmResolve(true); _confirmResolve = null; }
});
document.getElementById('btn-modal-confirm-cancel')?.addEventListener('click', () => {
  closeModal('modal-confirm');
  if (_confirmResolve) { _confirmResolve(false); _confirmResolve = null; }
});

// ── Form helpers ──────────────────────────────────────────────────────────────

function populateLocationDatalist(locations) {
  // Store for custom autocomplete; no datalist needed
  _locationOptions = locations ?? [];
  wireLocationAC();
}

let _locationOptions = [];
let _locACWired = false;

function wireLocationAC() {
  if (_locACWired) return;
  const input = document.getElementById('event-location');
  const drop  = document.getElementById('event-location-drop');
  if (!input || !drop) return;
  _locACWired = true;

  function showDrop(items) {
    if (!items.length) { drop.classList.add('hidden'); return; }
    drop.innerHTML = items.map((l, i) =>
      `<li class="loc-ac-item" role="option" data-value="${esc(l)}" data-idx="${i}">${esc(l)}</li>`
    ).join('');
    drop.classList.remove('hidden');
  }

  function hideDrop() { drop.classList.add('hidden'); }

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = q
      ? _locationOptions.filter(l => l.toLowerCase().includes(q))
      : _locationOptions;
    showDrop(filtered);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim().toLowerCase();
    const filtered = q
      ? _locationOptions.filter(l => l.toLowerCase().includes(q))
      : _locationOptions;
    showDrop(filtered);
  });

  // mousedown fires before blur — mark that we're clicking inside the drop
  let _pickingItem = false;
  drop.addEventListener('mousedown', e => {
    _pickingItem = true;
    const li = e.target.closest('.loc-ac-item');
    if (li) {
      input.value = li.dataset.value;
      hideDrop();
    }
  });

  input.addEventListener('blur', () => {
    if (_pickingItem) { _pickingItem = false; return; }
    hideDrop();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideDrop(); return; }
    if (e.key === 'Enter') {
      const active = drop.querySelector('.loc-ac-item.active');
      if (active) { input.value = active.dataset.value; }
      hideDrop();
      e.preventDefault();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const items = [...drop.querySelectorAll('.loc-ac-item')];
      if (!items.length) return;
      const cur = drop.querySelector('.loc-ac-item.active');
      let idx = cur ? items.indexOf(cur) : -1;
      if (cur) cur.classList.remove('active');
      idx = e.key === 'ArrowDown' ? Math.min(idx + 1, items.length - 1) : Math.max(idx - 1, 0);
      items[idx].classList.add('active');
      items[idx].scrollIntoView({ block: 'nearest' });
    }
  });
}

function populateTimePresets(times) {
  const el = document.getElementById('event-time-presets');
  if (!el) return;
  el.innerHTML = times.map((t, i) => {
    const SVG_R = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h13M12 7l5 5-5 5"/></svg>`;
    const SVG_L = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12H7M12 7l-5 5 5 5"/></svg>`;
    const pre  = t.timeSetup    ? `<span class="ev-edge">${SVG_R}${esc(t.timeSetup)}</span>` : '';
    const post = t.timeTeardown ? `<span class="ev-edge">${SVG_L}${esc(t.timeTeardown)}</span>` : '';
    const mainTime = `<span class="ev-core">${esc(t.from)}–${esc(t.to)}</span>`;
    const sub = [pre, mainTime, post].filter(Boolean).join('');
    return `<button type="button" class="preset" data-action="time-preset" data-index="${i}">
      <span>${esc(t.label || 'Standard')}</span><span class="preset-time ev-times" style="margin-top:2px">${sub}</span>
    </button>`;
  }).join('');
}

function applyTimePreset(index) {
  const t = state.plan?.settings?.defaultTimes?.[index];
  if (!t) return;
  document.getElementById('event-time-from').value     = t.from     ?? '';
  document.getElementById('event-time-to').value       = t.to       ?? '';
  document.getElementById('event-time-setup').value    = t.timeSetup    ?? '';
  document.getElementById('event-time-teardown').value = t.timeTeardown ?? '';
}

function populateStaffList(team, assigned) {
  const el = document.getElementById('event-staff-list');
  if (!el) return;
  el.innerHTML = team.filter(m => m.active).map(m => {
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

function updateStaffSummary() {
  const assigned = document.querySelectorAll('.staff-pick.on').length;
  const need     = parseInt(document.getElementById('event-staff-required').value, 10) || 0;
  const el       = document.getElementById('event-staff-summary');
  if (el) el.textContent = `${assigned} von ${need} zugeteilt`;
}

function renderColorPicker(team) {
  const usedColors = new Set(team.map(m => m.color));
  const el = document.getElementById('member-color-picker');
  if (!el) return;
  el.innerHTML = TEAM_COLORS.map(c =>
    `<button type="button" class="color-swatch${c === _memberColor ? ' selected' : ''}"
      data-action="select-color" data-color="${c}"
      style="background:${c};${usedColors.has(c) && c !== _memberColor ? 'opacity:0.4' : ''}"></button>`
  ).join('');
}

function selectColor(color) {
  _memberColor = color;
  renderColorPicker(state.plan.team);
}

// ── Toast ─────────────────────────────────────────────────────────────────────

window.showToast = function(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => el.remove(), 3500);
};

// ═══════════════════════════════════════════════════════════════════════════
// 5. EVENT WIRING
// Single delegated listener. All interactive elements use data-action=.
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('click', e => {
  // Close QA popover on outside click
  const pop = document.getElementById('qa-popover');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target)) {
    pop.style.display = 'none';
  }

  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, month, type: evType, index, id, color, group,
          eventId, date } = el.dataset;

  switch (action) {
    case 'nav-month':
      if (month) navigateToMonth(Number(month));
      break;

    case 'toggle-yr-event': {
      const card = el.closest('.yr-event');
      if (card) card.classList.toggle('expanded');
      break;
    }

    case 'add-event':
      openAddEvent(evType, date || '', Number(month));
      break;

    case 'edit-event':
      _eventFromPage = state.currentPage === 'year' ? 'year' : null;
      openEditEvent(el.dataset.id, Number(month));
      break;

    case 'open-qa':
      e.stopPropagation();
      openQA(eventId, Number(month), el);
      break;

    case 'qa-toggle':
      qaToggle(id, eventId, Number(month));
      break;

    case 'time-preset':
      applyTimePreset(Number(index));
      break;

    case 'stats-filter':
      state.statsMonth = Number(month);
      showStatisticsPage();
      break;

    case 'verlauf-filter':
      state.verlaufGroup = group;
      showVerlaufPage();
      break;

    case 'year-person': {
      const pid = el.dataset.id || '';
      state.yearPerson = pid && pid !== state.yearPerson ? pid : null;
      showYearPage();
      break;
    }

    case 'month-person': {
      const pid = el.dataset.id || '';
      state.monthPerson = pid && pid !== state.monthPerson ? pid : null;
      navigateToMonth(state.currentMonth);
      break;
    }

    case 'export-tab': {
      exportState.tab = el.dataset.tab;
      renderExportModal();
      break;
    }
    case 'export-person-toggle': {
      const pid = el.dataset.id;
      if (exportState.persons.has(pid)) exportState.persons.delete(pid);
      else exportState.persons.add(pid);
      renderExportModal();
      break;
    }
    case 'export-all-persons':
      state.plan?.team.filter(m => m.active).forEach(m => exportState.persons.add(m.id));
      renderExportModal();
      break;
    case 'export-no-persons':
      exportState.persons.clear();
      renderExportModal();
      break;
    case 'export-month-toggle': {
      const mo = Number(el.dataset.month);
      if (exportState.months.has(mo)) exportState.months.delete(mo);
      else exportState.months.add(mo);
      renderExportModal();
      break;
    }
    case 'export-month-preset': {
      const now = new Date();
      const curMonth = state.plan?.year === now.getFullYear() ? now.getMonth() + 1 : 1;
      exportState.months.clear();
      if (el.dataset.preset === 'current') {
        exportState.months.add(curMonth);
      } else if (el.dataset.preset === 'remaining') {
        for (let mo = curMonth; mo <= 12; mo++) exportState.months.add(mo);
      } else {
        for (let mo = 1; mo <= 12; mo++) exportState.months.add(mo);
      }
      renderExportModal();
      break;
    }

    case 'edit-location':   openEditLocation(Number(index)); break;
    case 'delete-location': deleteLocation(Number(index));   break;
    case 'add-location':    openAddLocation();               break;
    case 'edit-time':       openEditTime(Number(index));     break;
    case 'delete-time':     deleteTime(Number(index));       break;
    case 'add-time':        openAddTime();                   break;
    case 'edit-member':     openEditMember(id);              break;
    case 'delete-member':   deleteMember(id);                break;
    case 'add-member':      openAddMember();                 break;
    case 'select-color':    selectColor(color);              break;

    case 'toggle-staff': {
      const isOn = el.classList.toggle('on');
      const c = el.dataset.color;
      el.style.background  = isOn ? c : '';
      el.style.borderColor = c;
      el.style.color       = isOn ? '#fff' : '';
      const dot = el.querySelector('.sp-dot');
      if (dot) dot.style.background = isOn ? 'rgba(255,255,255,0.7)' : c;
      updateStaffSummary();
      break;
    }
  }
});

// Staff stepper
document.getElementById('btn-staff-dec')?.addEventListener('click', () => {
  const inp = document.getElementById('event-staff-required');
  const cur = parseInt(inp.value, 10) || 0;
  if (cur > 0) { inp.value = cur - 1; document.getElementById('event-staff-display').textContent = cur - 1; updateStaffSummary(); }
});
document.getElementById('btn-staff-inc')?.addEventListener('click', () => {
  const inp = document.getElementById('event-staff-required');
  const cur = parseInt(inp.value, 10) || 0;
  inp.value = cur + 1; document.getElementById('event-staff-display').textContent = cur + 1; updateStaffSummary();
});

// Closed checkbox toggle
document.getElementById('event-is-closed')?.addEventListener('change', e => {
  document.getElementById('event-fields').style.display = e.target.checked ? 'none' : '';
  document.getElementById('event-closed-label').classList.toggle('is-closed', e.target.checked);
});

// ─── External change handling ────────────────────────────────────────────────

function showExternalChangeBanner(hasDirty) {
  const banner = document.getElementById('external-change-banner');
  const msg    = document.getElementById('external-change-msg');
  if (!banner || !msg) return;
  if (hasDirty) {
    msg.textContent = 'Eine andere Person hat diese Datei geändert. Neu laden verwirft deine ungespeicherten Änderungen.';
  } else {
    msg.textContent = 'Eine andere Person hat diese Datei geändert.';
  }
  banner.style.display = 'flex';
}

function hideExternalChangeBanner() {
  const banner = document.getElementById('external-change-banner');
  if (banner) banner.style.display = 'none';
}

// Re-renders whichever page is currently visible without changing the active page.
async function refreshCurrentPage() {
  switch (state.currentPage) {
    case 'month':      await navigateToMonth(state.currentMonth); break;
    case 'statistics': await showStatisticsPage(); break;
    case 'settings':   await showSettingsPage(); break;
    case 'verlauf':    await showVerlaufPage(); break;
    case 'year':       await showYearPage(); break;
    default:           await onPlanLoaded(state.plan); break;
  }
}

async function handleExternalChange() {
  if (!state.plan) return;
  const isDirty = document.getElementById('save-state')?.classList.contains('dirty') ?? false;
  if (!isDirty) {
    // No unsaved changes — reload silently and stay on current page.
    try {
      const plan = await Planner.ReloadPlan();
      if (!plan) return;
      // Update state and sidebar metadata without navigating away.
      state.plan = plan;
      const teamName = plan.settings?.teamName;
      document.getElementById('sidebar-team-name').textContent = teamName || 'Einsatzplan';
      document.getElementById('sidebar-year-label').textContent = `Einsatzplan · ${plan.year}`;
      document.title = `Einsatzplan ${plan.year}`;
      setDirtyUI(false);
      await refreshCurrentPage();
      hideExternalChangeBanner();
      showToast('Ansicht aktualisiert.', 'success');
    } catch (e) {
      showToast('Fehler beim Aktualisieren: ' + e, 'error');
    }
  } else {
    // Has unsaved changes — warn and let the user decide.
    _autosavePaused = true;
    showExternalChangeBanner(true);
  }
}

// Register Wails event listener for file-change notifications from the poller.
Events.On('plan:file-changed-externally', handleExternalChange);

// Toolbar buttons
document.getElementById('btn-new')?.addEventListener('click', cmdNew);
document.getElementById('btn-open')?.addEventListener('click', cmdOpen);
document.getElementById('btn-save')?.addEventListener('click', cmdSave);

// Banner buttons
document.getElementById('btn-reload-plan')?.addEventListener('click', async () => {
  hideExternalChangeBanner();
  _autosavePaused = false;
  try {
    const plan = await Planner.ReloadPlan();
    if (!plan) return;
    state.plan = plan;
    const teamName = plan.settings?.teamName;
    document.getElementById('sidebar-team-name').textContent = teamName || 'Einsatzplan';
    document.getElementById('sidebar-year-label').textContent = `Einsatzplan · ${plan.year}`;
    document.title = `Einsatzplan ${plan.year}`;
    setDirtyUI(false);
    await refreshCurrentPage();
    showToast('Ansicht aktualisiert.', 'success');
  } catch (e) {
    showToast('Fehler beim Neu laden: ' + e, 'error');
  }
});
document.getElementById('btn-dismiss-banner')?.addEventListener('click', hideExternalChangeBanner);
document.getElementById('btn-welcome-new')?.addEventListener('click', cmdNew);
document.getElementById('btn-welcome-open')?.addEventListener('click', cmdOpen);

// Export button — open export modal
document.getElementById('btn-export')?.addEventListener('click', () => {
  if (!state.plan) return;
  openExportModal();
});

// Admin nav buttons
document.getElementById('nav-btn-settings')?.addEventListener('click', showSettingsPage);
document.getElementById('nav-btn-statistics')?.addEventListener('click', () => {
  state.statsMonth = 0;
  showStatisticsPage();
});
document.getElementById('nav-btn-verlauf')?.addEventListener('click', showVerlaufPage);
document.getElementById('nav-btn-year')?.addEventListener('click', () => {
  state.yearPerson = null;
  showYearPage();
});

// Modal footers
document.getElementById('btn-modal-export-close')?.addEventListener('click',  () => closeModal('modal-export'));
document.getElementById('btn-modal-export-cancel')?.addEventListener('click', () => closeModal('modal-export'));
document.getElementById('btn-export-confirm')?.addEventListener('click', () => {
  if (exportState.tab === 'ical') doExportICal();
  else doExportPDF();
});
document.getElementById('btn-modal-event-confirm')?.addEventListener('click', confirmEventModal);
document.getElementById('btn-modal-event-delete')?.addEventListener('click',  deleteEventModal);
document.getElementById('btn-modal-event-cancel')?.addEventListener('click',  () => closeModal('modal-event'));
document.getElementById('btn-modal-event-cancel2')?.addEventListener('click', () => closeModal('modal-event'));
document.getElementById('btn-modal-member-confirm')?.addEventListener('click', confirmMemberModal);
document.getElementById('btn-modal-member-cancel')?.addEventListener('click',  () => closeModal('modal-member'));
document.getElementById('btn-modal-member-cancel2')?.addEventListener('click', () => closeModal('modal-member'));
document.getElementById('btn-modal-location-confirm')?.addEventListener('click', confirmLocationModal);
document.getElementById('btn-modal-location-cancel')?.addEventListener('click',  () => closeModal('modal-location'));
document.getElementById('btn-modal-location-cancel2')?.addEventListener('click', () => closeModal('modal-location'));
document.getElementById('btn-modal-time-confirm')?.addEventListener('click', confirmTimeModal);
document.getElementById('btn-modal-time-cancel')?.addEventListener('click',  () => closeModal('modal-time'));
document.getElementById('btn-modal-time-cancel2')?.addEventListener('click', () => closeModal('modal-time'));
document.getElementById('btn-modal-new-confirm')?.addEventListener('click', confirmNewYear);
document.getElementById('btn-modal-new-cancel')?.addEventListener('click',  () => closeModal('modal-new-year'));

// Keyboard shortcuts
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); cmdSave(); }
  if (e.key === 'Escape') {
    ['modal-event','modal-member','modal-location','modal-time','modal-new-year'].forEach(closeModal);
    const qa = document.getElementById('qa-popover');
    if (qa) qa.style.display = 'none';
  }
});

// Delegated change listeners (avoids accumulating listeners on each page navigation).
document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  if (el.dataset.action === 'save-team-name') {
    const s = { ...state.plan.settings, teamName: el.value };
    Planner.UpdateSettings(s)
      .then(() => { state.plan.settings.teamName = el.value; setDirtyUI(true); })
      .catch(err => showToast('Fehler: ' + err, 'error'));
    return;
  }

  if (el.dataset.action === 'toggle-autosave') {
    setAutosave(el.checked);
    return;
  }
});

// ── Global tooltip ────────────────────────────────────────────────────────────
{
  const tip = document.getElementById('app-tooltip');
  let hideTimer;

  document.addEventListener('mouseover', e => {
    const el = e.target.closest('.has-tip');
    if (!el) return;
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.tip ?? '';
    tip.classList.add('visible');
    positionTip(e);
  });
  document.addEventListener('mousemove', e => {
    if (e.target.closest('.has-tip')) positionTip(e);
  });
  document.addEventListener('mouseout', e => {
    if (!e.target.closest('.has-tip')) return;
    hideTimer = setTimeout(() => tip.classList.remove('visible'), 80);
  });

  function positionTip(e) {
    const GAP = 10;
    tip.style.left = '0';
    tip.style.top  = '0';
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = e.clientX - tw / 2;
    let y = e.clientY - th - GAP;
    if (x < 6) x = 6;
    if (x + tw > window.innerWidth - 6) x = window.innerWidth - tw - 6;
    if (y < 6) y = e.clientY + GAP;
    tip.style.left = x + 'px';
    tip.style.top  = y + 'px';
  }
}

// ── Boot ─────────────────────────────────────────────────────────────────────

Planner.GetVersion().then(v => {
  const el = document.getElementById('sb-version');
  if (el) el.textContent = v;
}).catch(() => {});

tryRestoreLastFile();
