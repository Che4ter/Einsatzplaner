import { MONATE_SHORT, MONATE, esc } from '../utils.js';

export function renderStatisticsPage(plan: any, stats: any, personStats: any[], filterMonth: number): string {
  const { year } = plan;
  const cvClass = stats.coveragePct >= 95 ? 'ok' : stats.coveragePct >= 80 ? 'warn' : 'danger';
  const maxTotal = Math.max(1, ...personStats.map((s: any) => s.total));

  const chips = `
    <div class="month-chips">
      <button class="month-chip${filterMonth === 0 ? ' on' : ''}"
        data-action="stats-filter" data-month="0">Alle</button>
      ${MONATE_SHORT.map((name: string, i: number) =>
        `<button class="month-chip${filterMonth === i+1 ? ' on' : ''}"
          data-action="stats-filter" data-month="${i+1}">${name}</button>`
      ).join('')}
    </div>`;

  const maxHrs = Math.max(1, ...personStats.map((p: any) => p.hrs + (p.prepHrs ?? 0)));
  const barsHtml = personStats.map((p: any) => {
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
          <div class="stat-card-sub">${stats.filledSlots ?? stats.totalAssigned} von ${stats.totalNeed} besetzt</div>
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
