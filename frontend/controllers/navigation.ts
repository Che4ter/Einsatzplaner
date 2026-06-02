// controllers/navigation.ts — page-level navigation functions.
// Imports: leaf modules + core.js (one level up in the dependency chain).

import * as Planner from '../services.js';
import { state, isAutosaveEnabled, AUTOSAVE_DELAY_MS } from '../state.js';
import { showToast } from '../ui.js';
import {
  renderMonthPage,
  renderStatisticsPage,
  renderSettingsPage,
  renderVerlaufPage,
  renderYearPage,
} from '../render/index.js';
import { showPage, refreshSidebarSync } from './core.js';

export async function navigateToMonth(month: number): Promise<void> {
  state.currentMonth = month;
  try {
    const [events, summaries, stats] = await Promise.all([
      Planner.GetMonthEvents(month),
      Planner.GetMonthSummaries(),
      Planner.GetYearStats(month),
    ]);
    document.getElementById('month-content')!.innerHTML =
      renderMonthPage(state.plan, month, events, stats, state.monthPerson);
    refreshSidebarSync(summaries);
    showPage('month');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

export async function showStatisticsPage(): Promise<void> {
  try {
    const [stats, personStats] = await Promise.all([
      Planner.GetYearStats(state.statsMonth),
      Planner.GetPersonStats(state.statsMonth),
    ]);
    document.getElementById('statistics-content')!.innerHTML =
      renderStatisticsPage(state.plan, stats, personStats, state.statsMonth);
    showPage('statistics');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

export async function showSettingsPage(): Promise<void> {
  document.getElementById('settings-content')!.innerHTML =
    renderSettingsPage(state.plan, state.online, isAutosaveEnabled(), AUTOSAVE_DELAY_MS);
  showPage('settings');
}

export async function showVerlaufPage(): Promise<void> {
  try {
    const log = await Planner.GetActivityLog();
    document.getElementById('verlauf-content')!.innerHTML =
      renderVerlaufPage(state.plan, log, state.verlaufGroup);
    showPage('verlauf');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}

export async function showYearPage(): Promise<void> {
  try {
    const [summaries, yearStats, personStats] = await Promise.all([
      Planner.GetMonthSummaries(),
      Planner.GetYearStats(0),
      Planner.GetPersonStats(0),
    ]);
    const closedCount = Object.values(state.plan?.months ?? {})
      .reduce((n, m) => n + (m.events || []).filter((e: any) => e.isClosed).length, 0);
    document.getElementById('year-content')!.innerHTML =
      renderYearPage(state.plan, summaries, yearStats, closedCount, personStats, state.yearPerson);
    showPage('year');
  } catch (e) {
    showToast('Fehler beim Laden: ' + e, 'error');
  }
}
