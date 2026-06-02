import { esc, localIso } from '../utils.js';
import { fmtDayHeading, renderActivityEntry } from './cards.js';

export const ACTION_GROUP: Record<string, string> = {
  assign: 'zuteilung', unassign: 'zuteilung', swap: 'zuteilung',
  create: 'termin',    edit: 'termin',         delete: 'termin',
  close:  'ferien',    'close-batch': 'ferien', reopen: 'ferien',
  note:   'notiz',
};

export function renderVerlaufPage(plan: any, log: any[], groupFilter: string): string {
  const { team } = plan;
  const teamById = Object.fromEntries(team.map((m: any) => [m.id, m]));
  const today = localIso(new Date());

  const groups = [
    { id: 'all',       label: 'Alle' },
    { id: 'zuteilung', label: 'Zuteilungen' },
    { id: 'termin',    label: 'Termine' },
    { id: 'ferien',    label: 'Ferien' },
    { id: 'notiz',     label: 'Notizen' },
  ];

  const filtered = log.filter((e: any) =>
    groupFilter === 'all' || ACTION_GROUP[e.action] === groupFilter
  );

  const byDay: { day: string; items: any[] }[] = [];
  let curDay: string | null = null;
  filtered.forEach((e: any) => {
    const day = e.at.slice(0, 10);
    if (day !== curDay) { curDay = day; byDay.push({ day, items: [] }); }
    byDay[byDay.length - 1].items.push(e);
  });

  const todayCount = log.filter((e: any) => e.at.slice(0, 10) === today).length;

  const filterChips = groups.map(g => `
    <button class="act-pill${groupFilter === g.id ? ' on' : ''}"
      data-action="verlauf-filter" data-group="${g.id}">${g.label}</button>`
  ).join('');

  const dayBlocks = byDay.map(({ day, items }) => {
    const h = fmtDayHeading(day, today);
    const isToday = h.isToday;
    const entriesHtml = items.map((e: any) => renderActivityEntry(e, teamById, today)).join('');
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
