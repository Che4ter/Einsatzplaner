// ═══════════════════════════════════════════════════════════════════════════
// app.ts — composition root: imports + DOM/Events wiring + boot
// ═══════════════════════════════════════════════════════════════════════════

import * as Planner from './services.js';
import { Events } from '/wails/runtime.js';
import * as FirebaseSync from './sync/index.js';
import { wireOutboundRelay, onWriteStateChange } from './sync/index.js';
import {
  showToast, showModal, closeModal, wireConfirmButtons, cancelConfirm,
} from './ui.js';
import { state, setAutosavePaused } from './state.js';
import { el, on, setText, show, hide } from './dom.js';

// ── Controllers ───────────────────────────────────────────────────────────────
import {
  setDirtyUI, setAutosaveLocal, hideExternalChangeBanner,
  updateSidebarMeta, refreshSidebar,
} from './controllers/core.js';
import {
  navigateToMonth, showStatisticsPage, showSettingsPage,
  showVerlaufPage, showYearPage,
} from './controllers/navigation.js';
import {
  onPlanLoaded, applyReloadedPlan, refreshCurrentPage,
  cmdOpen, cmdSave, cmdClose, handleExternalChange, tryRestoreLastFile,
} from './controllers/fileops.js';
import {
  setEventFromPage, openAddEvent, openEditEvent,
  confirmEventModal, deleteEventModal,
  openQA, qaToggle,
  applyTimePreset, updateStaffSummary,
} from './controllers/event.js';
import {
  openAddMember, openEditMember, confirmMemberModal, deleteMember,
  selectColor,
} from './controllers/member.js';
import {
  openAddLocation, openEditLocation, confirmLocationModal, deleteLocation,
} from './controllers/location.js';
import {
  openAddTime, openEditTime, confirmTimeModal, deleteTime,
} from './controllers/time.js';
import {
  openExportModal, doExportICal, doExportPDF, doExportJSON,
  getExportTab, setExportTab, toggleExportPerson, selectAllExportPersons, clearExportPersons,
  toggleExportMonth, toggleExportPrep, setExportMonthPreset,
} from './controllers/export.js';
import {
  applyCloudStatus, updateCloudWritePill,
  renderWelcomeCloudRecent, openConnectModal, doConnect, doLoadCloudYear,
  doDisconnect, resetNewYearModal, pickTemplateFile, confirmNewYearWithCloud,
  renderNewYearRecentRooms, initNewYearUseLast, toggleUseLastPlan,
} from './controllers/cloud.js';

// ═══════════════════════════════════════════════════════════════════════════
// EVENT WIRING
// Single delegated listener. All interactive elements use data-action=.
// ═══════════════════════════════════════════════════════════════════════════

document.addEventListener('click', (e: MouseEvent) => {
  // Close QA popover on outside click
  const pop = document.getElementById('qa-popover');
  if (pop && pop.style.display !== 'none' && !pop.contains(e.target as Node)) {
    pop.style.display = 'none';
  }

  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!el) return;
  const { action, month, type: evType, index, id, color, group, eventId, date } = el.dataset;

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
      openAddEvent(evType!, date || '', Number(month));
      break;

    case 'edit-event':
      setEventFromPage(state.currentPage === 'year' ? 'year' : null);
      openEditEvent(el.dataset.id!, Number(month));
      break;

    case 'open-qa':
      e.stopPropagation();
      openQA(eventId!, Number(month), el);
      break;

    case 'qa-toggle':
      qaToggle(id!, eventId!, Number(month));
      break;

    case 'time-preset':
      applyTimePreset(Number(index));
      break;

    case 'stats-filter':
      state.statsMonth = Number(month);
      showStatisticsPage();
      break;

    case 'verlauf-filter':
      state.verlaufGroup = group!;
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
      navigateToMonth(state.currentMonth!);
      break;
    }

    case 'export-tab':     setExportTab(el.dataset.tab!);                 break;
    case 'export-person-toggle': toggleExportPerson(el.dataset.id!);      break;
    case 'export-all-persons':   selectAllExportPersons();                 break;
    case 'export-no-persons':    clearExportPersons();                     break;
    case 'export-month-toggle':  toggleExportMonth(Number(el.dataset.month)); break;
    case 'export-toggle-prep':   toggleExportPrep();                       break;
    case 'export-month-preset':  setExportMonthPreset(el.dataset.preset as any); break;

    case 'edit-location':   openEditLocation(Number(index)); break;
    case 'delete-location': deleteLocation(Number(index));   break;
    case 'add-location':    openAddLocation();               break;
    case 'edit-time':       openEditTime(Number(index));     break;
    case 'delete-time':     deleteTime(Number(index));       break;
    case 'add-time':        openAddTime();                   break;
    case 'edit-member':     openEditMember(id!);             break;
    case 'delete-member':   deleteMember(id!);               break;
    case 'add-member':      openAddMember();                 break;
    case 'select-color':    selectColor(color!);             break;

    case 'toggle-staff': {
      const isOn = el.classList.toggle('on');
      const c = el.dataset.color!;
      el.style.background  = isOn ? c : '';
      el.style.borderColor = c;
      el.style.color       = isOn ? '#fff' : '';
      const dot = el.querySelector<HTMLElement>('.sp-dot');
      if (dot) dot.style.background = isOn ? 'rgba(255,255,255,0.7)' : c;
      updateStaffSummary();
      break;
    }
  }
});

// Staff stepper
on('btn-staff-dec', 'click', () => {
  const inp = el<HTMLInputElement>('event-staff-required');
  if (!inp) return;
  const cur = parseInt(inp.value, 10) || 0;
  if (cur > 0) {
    inp.value = String(cur - 1);
    setText('event-staff-display', String(cur - 1));
    updateStaffSummary();
  }
});
on('btn-staff-inc', 'click', () => {
  const inp = el<HTMLInputElement>('event-staff-required');
  if (!inp) return;
  const cur = parseInt(inp.value, 10) || 0;
  inp.value = String(cur + 1);
  setText('event-staff-display', String(cur + 1));
  updateStaffSummary();
});

// Closed checkbox toggle
on('event-is-closed', 'change', (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked;
  const fields = el('event-fields');
  const label  = el('event-closed-label');
  if (fields) fields.style.display = checked ? 'none' : '';
  if (label)  label.classList.toggle('is-closed', checked);
});

// Register Wails event listener for file-change notifications from the poller.
Events.On('plan:file-changed-externally', handleExternalChange);

// Toolbar buttons
on('btn-save', 'click', cmdSave);
on('btn-close', 'click', cmdClose);

// Banner buttons
on('btn-reload-plan', 'click', async () => {
  hideExternalChangeBanner();
  setAutosavePaused(false);
  try {
    const plan = await Planner.ReloadPlan();
    if (!plan) return;
    await applyReloadedPlan(plan);
  } catch (e) {
    showToast('Fehler beim Neu laden: ' + e, 'error');
  }
});
on('btn-dismiss-banner', 'click', hideExternalChangeBanner);
on('btn-welcome-new', 'click', () => { resetNewYearModal(); initNewYearUseLast(); showModal('modal-new-year'); });
on('btn-welcome-open', 'click', openConnectModal);

// Export button
on('btn-export', 'click', () => {
  if (!state.plan) return;
  openExportModal();
});

// Admin nav buttons
on('nav-btn-settings', 'click', showSettingsPage);
on('nav-btn-statistics', 'click', () => {
  state.statsMonth = 0;
  showStatisticsPage();
});
on('nav-btn-verlauf', 'click', showVerlaufPage);
on('nav-btn-year', 'click', () => {
  state.yearPerson = null;
  showYearPage();
});

// Modal footers
on('btn-modal-export-close',  'click', () => closeModal('modal-export'));
on('btn-modal-export-cancel', 'click', () => closeModal('modal-export'));
on('btn-export-confirm', 'click', () => {
  const tab = getExportTab();
  if (tab === 'json') { doExportJSON(); return; }
  if (tab === 'ical') doExportICal();
  else doExportPDF();
});
on('btn-modal-event-confirm', 'click', confirmEventModal);
on('btn-modal-event-delete',  'click', deleteEventModal);
on('btn-modal-event-cancel',  'click', () => closeModal('modal-event'));
on('btn-modal-event-cancel2', 'click', () => closeModal('modal-event'));
on('btn-modal-member-confirm', 'click', confirmMemberModal);
on('btn-modal-member-cancel',  'click', () => closeModal('modal-member'));
on('btn-modal-member-cancel2', 'click', () => closeModal('modal-member'));
on('btn-modal-location-confirm', 'click', confirmLocationModal);
on('btn-modal-location-cancel',  'click', () => closeModal('modal-location'));
on('btn-modal-location-cancel2', 'click', () => closeModal('modal-location'));
on('btn-modal-time-confirm', 'click', confirmTimeModal);
on('btn-modal-time-cancel',  'click', () => closeModal('modal-time'));
on('btn-modal-time-cancel2', 'click', () => closeModal('modal-time'));
on('btn-modal-new-confirm', 'click', confirmNewYearWithCloud);
on('btn-modal-new-cancel',  'click', () => { resetNewYearModal(); closeModal('modal-new-year'); });
on('btn-pick-template', 'click', pickTemplateFile);
on('btn-connect-open-file', 'click', async () => { closeModal('modal-connect'); await cmdOpen(); });

// Keyboard shortcuts
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); cmdSave(); }
  if (e.key === 'Escape') {
    (['modal-event','modal-member','modal-location','modal-time','modal-new-year'] as const).forEach(closeModal);
    cancelConfirm();
    const qa = document.getElementById('qa-popover');
    if (qa) qa.style.display = 'none';
  }
});

// Delegated change listeners
document.addEventListener('change', (e: Event) => {
  const el = (e.target as Element).closest<HTMLElement>('[data-action]');
  if (!el) return;

  if (el.dataset.action === 'save-team-name') {
    const s = { ...state.plan!.settings, teamName: (el as HTMLInputElement).value };
    Planner.UpdateSettings(s)
      .then(() => Planner.GetPlan())
      .then(plan => {
        state.plan = plan;
        updateSidebarMeta(plan!);
        setDirtyUI(true);
      })
      .catch((err: unknown) => showToast('Fehler: ' + err, 'error'));
    return;
  }

  if (el.dataset.action === 'toggle-autosave') {
    setAutosaveLocal((el as HTMLInputElement).checked);
    return;
  }
});

// ── Global tooltip ────────────────────────────────────────────────────────────
{
  const tip = document.getElementById('app-tooltip')!;
  let hideTimer: ReturnType<typeof setTimeout>;

  document.addEventListener('mouseover', (e: MouseEvent) => {
    const el = (e.target as Element).closest<HTMLElement>('.has-tip');
    if (!el) return;
    clearTimeout(hideTimer);
    tip.textContent = el.dataset.tip ?? '';
    tip.classList.add('visible');
    positionTip(e);
  });
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if ((e.target as Element).closest('.has-tip')) positionTip(e);
  });
  document.addEventListener('mouseout', (e: MouseEvent) => {
    if (!(e.target as Element).closest('.has-tip')) return;
    hideTimer = setTimeout(() => tip.classList.remove('visible'), 80);
  });

  function positionTip(e: MouseEvent): void {
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

// ── Cloud events ──────────────────────────────────────────────────────────────

Events.On('plan:cloud-meta-changed', async () => {
  if (!state.plan) return;
  try {
    const plan = await Planner.GetPlan();
    if (!plan) return;
    state.plan = plan;
    updateSidebarMeta(plan);
    await refreshCurrentPage();
  } catch { /* non-fatal */ }
});

Events.On('plan:cloud-event-changed', async (e: any) => {
  if (!state.plan) return;
  try {
    const plan = await Planner.GetPlan();
    if (!plan) return;
    state.plan = plan;
    const msg = typeof e?.data === 'string' ? JSON.parse(e.data) : e?.data;
    if (msg && msg.month) {
      if (state.currentPage === 'month' && state.currentMonth === msg.month) {
        await navigateToMonth(msg.month);
      } else {
        Planner.GetMonthSummaries().then(() => refreshSidebar()).catch(() => {});
      }
    }
  } catch { /* non-fatal */ }
});

Events.On('plan:cloud-activity-changed', async () => {
  if (state.currentPage === 'verlauf') await showVerlaufPage().catch(() => {});
});

Events.On('plan:cloud-disconnected', async () => {
  const status = await Planner.GetCloudStatus().catch(() => null);
  if (status) applyCloudStatus(status);
  showToast('Cloud-Verbindung getrennt.', 'warn');
});

// ── Cloud modal buttons ───────────────────────────────────────────────────────

on('btn-pill-reconnect', 'click', async () => {
  const roomCode = state.cloudRoomCode;
  const plan = state.plan;
  if (!roomCode || !plan) return;
  try {
    const reconnected = await FirebaseSync.connectToCloud(roomCode, plan.year);
    if (reconnected) {
      applyCloudStatus(await Planner.GetCloudStatus());
      showToast('Neu verbunden.', 'success');
    }
  } catch (e) {
    showToast('Verbindung fehlgeschlagen: ' + e, 'error');
  }
});
on('btn-modal-connect-close',  'click', () => { if (!state.online) FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); });
on('btn-modal-connect-cancel', 'click', () => { if (!state.online) FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); });
on('btn-modal-connect-confirm', 'click', doConnect);
on('btn-load-cloud-year', 'click', doLoadCloudYear);
on('btn-disconnect', 'click', doDisconnect);

// Generate room code in new-year modal
on('btn-new-year-generate-code', 'click', async () => {
  try {
    const code = await Planner.GenerateRoomCode();
    const inp = el<HTMLInputElement>('new-year-room-code');
    if (inp) inp.value = code;
  } catch { /* ignore */ }
});

// Show/hide cloud sub-rows when storage type changes in new-year modal
on('new-year-cloud', 'change', () => {
  const codeRow = el('new-year-cloud-code-row');
  const connRow = el('new-year-cloud-connected-row');
  if (state.online) {
    if (codeRow) codeRow.style.display = 'none';
    if (connRow) {
      connRow.style.display = '';
      setText('new-year-current-room-code', state.cloudRoomCode);
    }
  } else {
    if (codeRow) codeRow.style.display = '';
    if (connRow) connRow.style.display = 'none';
    renderNewYearRecentRooms();
  }
});
on('new-year-local', 'change', () => {
  hide('new-year-cloud-code-row');
  hide('new-year-cloud-connected-row');
});
on('new-year-use-last', 'change', (e: Event) => {
  toggleUseLastPlan((e.target as HTMLInputElement).checked);
});

// Escape key closes cloud connect modal
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') { if (!state.online) FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); }
}, { capture: false });

// ── Boot ─────────────────────────────────────────────────────────────────────

wireConfirmButtons();
wireOutboundRelay();
onWriteStateChange(() => updateCloudWritePill());

Planner.GetVersion().then(v => {
  setText('sb-version', v);
}).catch(() => {});

Planner.GetCloudStatus().then(status => {
  if (status.cloudEnabled) {
    FirebaseSync.initFirebase(status.projectId, status.apiKey);
  }
  applyCloudStatus(status);
  renderWelcomeCloudRecent();
}).catch(() => {});

Planner.CheckForUpdate().then((newTag: string | null) => {
  if (!newTag) return;
  const link = el<HTMLAnchorElement>('update-link');
  if (!link) return;
  link.textContent = 'Update verfügbar (' + newTag + ')';
  const releaseURL = 'https://github.com/Che4ter/Einsatzplaner/releases/tag/' + encodeURIComponent(newTag);
  show('update-link');
  link.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    Planner.OpenURL(releaseURL).catch(() => {});
  });
}).catch(() => {});

tryRestoreLastFile();
