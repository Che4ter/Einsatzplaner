import * as Planner from '../services.js';
import { state } from '../state.js';
import { MONATE, WEEKDAY_SHORT, esc, escNl, getMonth, paginateByHeight } from '../utils.js';
import { showToast, showModal, closeModal } from '../ui.js';
import { setText, setHtml } from '../dom.js';

interface ExportState {
  tab: 'ical' | 'pdf' | 'json';
  persons: Set<string>;
  months: Set<number>;
  includePrep: boolean;
}

const exportState: ExportState = {
  tab:         'ical',
  persons:     new Set<string>(),
  months:      new Set<number>(),
  includePrep: true,
};

export function openExportModal(): void {
  const plan = state.plan;
  if (!plan) return;

  exportState.tab     = 'ical';
  exportState.persons = new Set(plan.team.filter((m: any) => m.active).map((m: any) => m.id));

  const now       = new Date();
  const curMonth  = plan.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  const nextMonth = curMonth < 12 ? curMonth + 1 : 12;
  exportState.months = new Set([nextMonth]);

  setText('export-head-sub', `Export · ${plan.year}`);
  renderExportModal();
  showModal('modal-export');
}

export function renderExportModal(): void {
  const plan = state.plan;
  if (!plan) return;
  const { tab, persons, months } = exportState;
  const activeTeam = plan.team.filter((m: any) => m.active).slice().sort((a: any, b: any) => a.name.localeCompare(b.name));
  const year = plan.year;

  document.querySelectorAll('.export-tab').forEach((btn: Element) => {
    (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.tab === tab);
  });

  let bodyHtml = '';

  if (tab === 'ical') {
    const personChips = activeTeam.map((m: any) => {
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
      </div>
      <div class="export-option-row">
        <span class="export-option-label">Vor- und Nachbereitungszeit einschließen</span>
        <button class="export-tog${exportState.includePrep ? ' on' : ''}" data-action="export-toggle-prep"></button>
      </div>`;

    const filename = `einsatzplan-${year}.ics`;
    setText('export-foot-filename', filename);
    setText('btn-export-confirm', '↓ Kalender herunterladen');
  } else if (tab === 'pdf') {
    const now      = new Date();
    const curMonth = plan.year === now.getFullYear() ? now.getMonth() + 1 : null;

    const monthItems = MONATE.map((name: string, i: number) => {
      const m       = i + 1;
      const mo      = getMonth(plan, m);
      const evCount = (mo?.events ?? []).filter((e: any) => !e.isClosed).length;
      const on      = months.has(m);
      const isCur   = m === curMonth;
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
      </div>
      <div class="export-option-row">
        <span class="export-option-label">Vor- und Nachbereitungszeit einschließen</span>
        <button class="export-tog${exportState.includePrep ? ' on' : ''}" data-action="export-toggle-prep"></button>
      </div>`;

    const count = months.size;
    setText('export-foot-filename', `einsatzplan-${year}.pdf · ${count} Seite${count !== 1 ? 'n' : ''}`);
    setText('btn-export-confirm', '↓ PDF herunterladen');
  }

  if (tab === 'json') {
    bodyHtml = `
      <div class="export-info-box">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>
        <div>
          <strong>Vollständiger JSON-Export des aktuellen Plans.</strong>
          <p>Lädt die komplette Datendatei herunter — kompatibel mit dem lokalen Dateiformat.</p>
        </div>
      </div>`;
    setText('export-foot-filename', `einsatzplan-${year}.json`);
    setText('btn-export-confirm', '↓ JSON herunterladen');
  }

  setHtml('export-body', bodyHtml);
}

export async function doExportICal(): Promise<void> {
  const plan = state.plan;
  if (!plan) return;
  const personIDs = [...exportState.persons];
  try {
    await Planner.ExportICal(personIDs, exportState.includePrep);
    closeModal('modal-export');
    showToast('Kalender exportiert.', 'success');
  } catch (e) {
    showToast('Export fehlgeschlagen: ' + e, 'error');
  }
}

export function doExportPDF(): void {
  const plan = state.plan;
  if (!plan) return;
  const selectedMonths = [...exportState.months].sort((a, b) => a - b);
  if (selectedMonths.length === 0) {
    showToast('Keine Monate ausgewählt.', 'warn');
    return;
  }

  const teamByID: Record<string, any> = {};
  plan.team.forEach((m: any) => { teamByID[m.id] = m; });

  const teamName = esc(plan.settings?.teamName || 'Einsatzplan');

  const PAGE_H    = 252;
  const H_TITLE   = 11;
  const H_FOOTER  = 8;
  const H_HEADING = 14;
  const H_TH      = 6.5;
  const H_ROW     = 7;
  const H_NOTE    = 4.5;
  const H_EMPTY   = 7;
  const H_GAP     = 7;

  const monthData = selectedMonths.map(m => {
    const mo        = getMonth(plan, m);
    const allEvents = [...(mo?.events ?? [])].sort((a: any, b: any) => a.date.localeCompare(b.date));
    const noteCount = allEvents.filter((ev: any) => !ev.isClosed && ev.comment).length;
    const estimatedMM = H_HEADING
      + (allEvents.length > 0
          ? H_TH + allEvents.length * H_ROW + noteCount * H_NOTE
          : H_EMPTY)
      + H_GAP;

    const rows = allEvents.map((ev: any) => {
      const d       = new Date(ev.date + 'T00:00:00');
      const dayStr  = `${WEEKDAY_SHORT[d.getDay()]} ${String(d.getDate()).padStart(2, '0')}.${String(m).padStart(2, '0')}.`;
      const dispFrom = exportState.includePrep && ev.timeSetup    ? ev.timeSetup    : ev.timeFrom;
      const dispTo   = exportState.includePrep && ev.timeTeardown ? ev.timeTeardown : ev.timeTo;
      const time    = dispFrom && dispTo ? `${dispFrom}–${dispTo}` : '—';
      const loc     = ev.location || '—';

      if (ev.isClosed) {
        return `<tr class="p-row-closed">
          <td class="p-date">${dayStr}</td>
          <td class="p-loc" colspan="3"><span class="p-closed-badge">Keine Durchführung</span></td>
        </tr>`;
      }

      const names = (ev.assignedStaff ?? []).map((id: string) => {
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

  const pageGroups = paginateByHeight(monthData, PAGE_H, H_TITLE + H_FOOTER);

  const footerDate = new Date().toLocaleDateString('de-CH');
  const footerHtml = `<div class="p-page-footer">Stand: ${footerDate} · Einsatzplan ${plan.year}</div>`;

  const pagesHtml = pageGroups.map((group: any[], i: number) => `
    <div class="p-page${i > 0 ? ' p-page-break' : ''}">
      <div class="p-page-content">
        <div class="p-doc-title">${teamName}</div>
        ${group.map((m: any) => m.html).join('')}
      </div>
      ${footerHtml}
    </div>`).join('');

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
    .p-table td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: middle; font-size: 10pt; }
    .p-note-row td { border-bottom: 1px solid #f0f0f0; padding: 3px 8px 7px 10px; vertical-align: middle; }
    .p-table tr:last-child td { border-bottom: none; }
    .p-date { font-weight: 600; white-space: nowrap; width: 84px; }
    .p-loc  { font-weight: 500; width: 140px; }
    .p-time { color: #555; white-space: nowrap; width: 90px; font-variant-numeric: tabular-nums; }
    .p-chip { display: inline-flex; align-items: center; gap: 4px; margin-right: 6px; white-space: nowrap; font-size: 9.5pt; }
    .p-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; display: inline-block; }
    .p-note-cell { font-size: 8.5pt; color: #888; padding-left: 4px; border-left: 2px solid #e0e0e0; font-style: italic; }
    .p-row-closed td { color: #bbb; }
    .p-closed-badge { font-size: 8pt; color: #b45309; font-style: italic; }
    .p-empty { color: #999; margin-top: 8px; font-size: 9.5pt; }
    .p-page-footer { margin-top: 10mm; font-size: 7.5pt; color: #bbb; text-align: right; }
  </style>
  </head><body>
    ${pagesHtml}
  </body></html>`;

  closeModal('modal-export');
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;border:none;pointer-events:none';
  document.body.appendChild(iframe);
  iframe.onload = () => {
    iframe.contentWindow!.focus();
    iframe.contentWindow!.print();
    iframe.contentWindow!.addEventListener('afterprint', () => iframe.remove(), { once: true });
    setTimeout(() => iframe.remove(), 30000);
  };
  const idoc = iframe.contentDocument!;
  idoc.open();
  idoc.write(html);
  idoc.close();
}

export function getExportTab(): string { return exportState.tab; }

// ── exportState mutation helpers (used by the delegated click handler in app.ts) ──

export function setExportTab(tab: string): void {
  exportState.tab = tab as ExportState['tab'];
  renderExportModal();
}

export function toggleExportPerson(pid: string): void {
  if (exportState.persons.has(pid)) exportState.persons.delete(pid);
  else exportState.persons.add(pid);
  renderExportModal();
}

export function selectAllExportPersons(): void {
  state.plan?.team.filter((m: any) => m.active).forEach((m: any) => exportState.persons.add(m.id));
  renderExportModal();
}

export function clearExportPersons(): void {
  exportState.persons.clear();
  renderExportModal();
}

export function toggleExportMonth(month: number): void {
  if (exportState.months.has(month)) exportState.months.delete(month);
  else exportState.months.add(month);
  renderExportModal();
}

export function toggleExportPrep(): void {
  exportState.includePrep = !exportState.includePrep;
  renderExportModal();
}

export function setExportMonthPreset(preset: 'current' | 'remaining' | 'all'): void {
  const now = new Date();
  const curMonth = state.plan?.year === now.getFullYear() ? now.getMonth() + 1 : 1;
  exportState.months.clear();
  if (preset === 'current') {
    exportState.months.add(curMonth);
  } else if (preset === 'remaining') {
    for (let mo = curMonth; mo <= 12; mo++) exportState.months.add(mo);
  } else {
    for (let mo = 1; mo <= 12; mo++) exportState.months.add(mo);
  }
  renderExportModal();
}

export async function doExportJSON(): Promise<void> {
  try {
    const json = await Planner.ExportPlanJSON();
    const year = state.plan?.year ?? 'plan';
    const blob = new Blob([json], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `einsatzplan-${year}.json`;
    a.click();
    URL.revokeObjectURL(url);
    closeModal('modal-export');
    showToast('JSON heruntergeladen.', 'success');
  } catch (e) {
    showToast('Export fehlgeschlagen: ' + e, 'error');
  }
}
