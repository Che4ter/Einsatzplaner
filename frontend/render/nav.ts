import { MONATE, esc } from '../utils.js';

export function renderMonthNav(plan: any, summaries: any, currentMonth: number | null, currentPage: string): string {
  if (!plan) {
    return '<div style="padding:8px 16px;font-size:13px;color:var(--side-muted)">Keine Datei geöffnet</div>';
  }
  const now = new Date();
  const curYear = now.getFullYear();
  const curMon  = now.getMonth() + 1;
  const year    = plan.year;

  return Array.from({length: 12}, (_: unknown, i: number) => {
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
