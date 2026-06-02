import { MONATE, MONATE_SHORT, WEEKDAY_SHORT, esc, localIso, weekNumber, getWednesdays } from '../utils.js';
import { renderEventCard, renderClosedCard } from './cards.js';

export function renderMonthPage(plan: any, month: number, events: any[], stats: any, filterPerson: string | null): string {
  const { year, team, settings } = plan;
  const now = new Date();
  const today = localIso(now);

  const activeEvents = events.filter((e: any) => !e.isClosed);
  const closedEvents = events.filter((e: any) => e.isClosed);

  const activeTeam = team.filter((m: any) => m.active).slice().sort((a: any, b: any) => a.name.localeCompare(b.name));
  const allOn = !filterPerson;
  const filterChips = [
    `<button class="filter-chip all${allOn ? ' on' : ''}" data-action="month-person" data-id="">Alle anzeigen</button>`,
    ...activeTeam.map((m: any) => {
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

  const visibleActiveEvents = filterPerson
    ? activeEvents.filter((e: any) => (e.assignedStaff ?? []).includes(filterPerson))
    : activeEvents;

  const fullyStaffed = stats.totalEvents - stats.underCount;
  const openSlots    = stats.openSlots ?? Math.max(0, stats.totalNeed - stats.totalAssigned);

  const wednesdays = getWednesdays(year, month);
  const wedSet = new Set(wednesdays);
  const manualWeekdays = [...new Set(
    visibleActiveEvents.filter((e: any) => e.type === 'wednesday' || e.type === 'weekday')
      .map((e: any) => e.date).filter((d: string) => !wedSet.has(d))
  )];
  const closedWeekdayDates = [...new Set(
    closedEvents.filter((e: any) => e.type === 'wednesday' || e.type === 'weekday')
      .map((e: any) => e.date).filter((d: string) => !wedSet.has(d))
  )];
  const weekdayDates = [...new Set([...wednesdays, ...manualWeekdays, ...closedWeekdayDates])].sort();
  const weekendEvents = visibleActiveEvents.filter((e: any) => e.type === 'weekend');

  const firstWed = wednesdays[0];
  const lastWed  = wednesdays[wednesdays.length - 1];
  const kwLabel  = firstWed ? `KW ${weekNumber(firstWed)}–${weekNumber(lastWed)}` : '';

  const weekdayColHtml = weekdayDates.map((date: any) => {
    const dayEvents = visibleActiveEvents.filter((e: any) =>
      (e.type === 'wednesday' || e.type === 'weekday') && e.date === date);
    const dayClosed = closedEvents.filter((e: any) =>
      (e.type === 'wednesday' || e.type === 'weekday') && e.date === date);
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const kw = weekNumber(date);
    const closedCardsHtml = dayClosed.map((e: any) => renderClosedCard(e, month)).join('');
    return `
      <div class="date-row${isToday ? ' today' : ''}${dayClosed.length && !dayEvents.length ? ' closed' : ''}">
        <div class="date-marker">
          <span class="dm-day">${WEEKDAY_SHORT[d.getDay()]}</span>
          <span class="dm-num">${d.getDate()}</span>
          <span class="date-kw">KW ${kw}</span>
        </div>
        <div class="row-body">
          ${closedCardsHtml}
          ${dayEvents.map((e: any) => renderEventCard(e, team, month)).join('')}
          ${!dayClosed.length ? `<button class="add-event-btn" data-action="add-event" data-type="${d.getDay() === 3 ? 'wednesday' : 'weekday'}" data-month="${month}" data-date="${date}">
            + Einsatz hinzufügen
          </button>` : ''}
        </div>
      </div>`;
  }).join('');

  const closedWeekendDates = new Set(
    closedEvents.filter((e: any) => e.type === 'weekend').map((e: any) => e.date)
  );
  const weekendByDate: Record<string, any[]> = {};
  weekendEvents.forEach((e: any) => {
    (weekendByDate[e.date] = weekendByDate[e.date] ?? []).push(e);
  });
  closedEvents.filter((e: any) => e.type === 'weekend').forEach((e: any) => {
    weekendByDate[e.date] = weekendByDate[e.date] ?? [];
  });
  const weekendDates = Object.keys(weekendByDate).sort();
  const weekendColHtml = weekendDates.map((date: string) => {
    const evs = weekendByDate[date];
    const dayClosed = closedEvents.filter((e: any) => e.type === 'weekend' && e.date === date);
    const d = new Date(date + 'T00:00:00');
    const isToday = date === today;
    const firstEv = evs[0];
    const dateEnd = firstEv?.dateEnd && firstEv.dateEnd !== date ? firstEv.dateEnd : null;
    const closedCardsHtml = dayClosed.map((e: any) => renderClosedCard(e, month)).join('');
    return `
      <div class="date-row${isToday ? ' today' : ''}${dayClosed.length && !evs.length ? ' closed' : ''}">
        <div class="date-marker">
          <span class="dm-day">${WEEKDAY_SHORT[d.getDay()]}</span>
          <span class="dm-num">${d.getDate()}${dateEnd ? `<span class="date-range">–${new Date(dateEnd+'T00:00:00').getDate()}</span>` : ''}</span>
          <span class="date-kw">${MONATE_SHORT[d.getMonth()]}</span>
        </div>
        <div class="row-body">
          ${closedCardsHtml}
          ${evs.map((e: any) => renderEventCard(e, team, month)).join('')}
          ${!dayClosed.length ? `<button class="add-event-btn" data-action="add-event" data-type="weekend" data-month="${month}" data-date="${date}">
            + Einsatz hinzufügen
          </button>` : ''}
        </div>
      </div>`;
  }).join('');

  const prevMonth = month > 1  ? month - 1 : null;
  const nextMonth = month < 12 ? month + 1 : null;

  // suppress unused import warning — settings is destructured from plan but not yet used here
  void settings;

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
