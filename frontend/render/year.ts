import { MONATE, MONATE_SHORT, WEEKDAY_SHORT, esc, escNl, getMonth, formatDate } from '../utils.js';

export function renderYearPage(
  plan: any,
  summaries: any,
  yearStats: any,
  closedCount: number,
  personStats: any[],
  filterPerson: string | null,
): string {
  const { year, team } = plan;
  const activeTeam = team.filter((m: any) => m.active).slice().sort((a: any, b: any) => a.name.localeCompare(b.name));
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const currentMonth = today.getFullYear() === year ? today.getMonth() + 1 : null;

  const allOn = !filterPerson;
  const filterChips = [
    `<button class="filter-chip all${allOn ? ' on' : ''}" data-action="year-person" data-id="">Alle anzeigen</button>`,
    ...activeTeam.map((m: any) => {
      const on = filterPerson === m.id;
      return `<button class="filter-chip${on ? ' on' : ''}" style="--chip-color:${esc(m.color)}"
        data-action="year-person" data-id="${esc(m.id)}">
        <span class="fc-dot"></span>${esc(m.name)}
      </button>`;
    })
  ].join('');

  const heroPerson = filterPerson ? activeTeam.find((m: any) => m.id === filterPerson) : null;
  const ps = filterPerson ? personStats.find((p: any) => p.id === filterPerson) : null;

  let nextEvent: any = null;
  if (heroPerson) {
    for (let m = 1; m <= 12; m++) {
      const mo = getMonth(plan, m);
      if (!mo) continue;
      for (const e of (mo.events ?? [])) {
        if (e.isClosed) continue;
        if (!filterPerson || !(e.assignedStaff ?? []).includes(filterPerson)) continue;
        if (e.date >= todayStr && (!nextEvent || e.date < nextEvent.date)) nextEvent = e;
      }
    }
  }

  let heroHtml = '';
  if (heroPerson && ps) {
    let nextHtml: string;
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

  const monthsHtml = MONATE.map((name: string, i: number) => {
    const m = i + 1;
    const mo = getMonth(plan, m);
    const events = (mo?.events ?? []).slice().sort((a: any, b: any) => a.date.localeCompare(b.date));
    const summary = summaries?.[m] ?? summaries?.[String(m)] ?? {};
    const isPast  = currentMonth ? m < currentMonth : false;
    const isCurrent = m === currentMonth;

    const personEvents = filterPerson
      ? events.filter((e: any) => !e.isClosed && (e.assignedStaff ?? []).includes(filterPerson))
      : null;
    if (filterPerson && personEvents!.length === 0) return '';

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
    } else if (personEvents!.length > 0) {
      metaPips = `<div class="ym-meta">
        <span class="pip ok"><span class="pip-dot"></span>${personEvents!.length} ${personEvents!.length === 1 ? 'Einsatz' : 'Einsätze'}</span>
      </div>`;
    }

    const rowsHtml = events.map((e: any) => {
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

      const assigned: string[] = e.assignedStaff ?? [];
      const need = e.staffRequired ?? 0;
      const tone = need === 0 ? '' : assigned.length >= need ? 'ok' : assigned.length >= need - 1 ? 'warn' : 'danger';
      const matchesFilter = !filterPerson || assigned.includes(filterPerson);
      const missing = Math.max(0, need - assigned.length);

      const people = assigned.map((id: string) => activeTeam.find((m: any) => m.id === id)).filter(Boolean);
      const chipHtml = people.map((p: any) => {
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
                ${people.length > 0 ? `<div class="yr-ev-detail-people">${people.map((p: any) =>
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

  const hasAny = filterPerson && MONATE.some((_: string, i: number) => {
    const m = i + 1;
    const mo = getMonth(plan, m);
    return (mo?.events ?? []).some((e: any) => !e.isClosed && (e.assignedStaff ?? []).includes(filterPerson));
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
