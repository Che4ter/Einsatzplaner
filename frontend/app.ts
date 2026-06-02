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
  cmdOpen, cmdSave, handleExternalChange, tryRestoreLastFile,
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
  setExportTab, toggleExportPerson, selectAllExportPersons, clearExportPersons,
  toggleExportMonth, toggleExportPrep, setExportMonthPreset,
} from './controllers/export.js';
import {
  applyCloudStatus, updateCloudWritePill,
  renderWelcomeCloudRecent, openConnectModal, doConnect, doLoadCloudYear,
  doDisconnect, resetNewYearModal, pickTemplateFile, confirmNewYearWithCloud,
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
document.getElementById('btn-staff-dec')?.addEventListener('click', () => {
  const inp = document.getElementById('event-staff-required') as HTMLInputElement;
  const cur = parseInt(inp.value, 10) || 0;
  if (cur > 0) {
    inp.value = String(cur - 1);
    const disp = document.getElementById('event-staff-display');
    if (disp) disp.textContent = String(cur - 1);
    updateStaffSummary();
  }
});
document.getElementById('btn-staff-inc')?.addEventListener('click', () => {
  const inp = document.getElementById('event-staff-required') as HTMLInputElement;
  const cur = parseInt(inp.value, 10) || 0;
  inp.value = String(cur + 1);
  const disp = document.getElementById('event-staff-display');
  if (disp) disp.textContent = String(cur + 1);
  updateStaffSummary();
});

// Closed checkbox toggle
document.getElementById('event-is-closed')?.addEventListener('change', (e: Event) => {
  const checked = (e.target as HTMLInputElement).checked;
  const fields = document.getElementById('event-fields');
  const label  = document.getElementById('event-closed-label');
  if (fields) fields.style.display = checked ? 'none' : '';
  if (label)  label.classList.toggle('is-closed', checked);
});

// Register Wails event listener for file-change notifications from the poller.
Events.On('plan:file-changed-externally', handleExternalChange);

// Toolbar buttons
document.getElementById('btn-new')?.addEventListener('click', () => { resetNewYearModal(); showModal('modal-new-year'); });
document.getElementById('btn-open')?.addEventListener('click', cmdOpen);
document.getElementById('btn-save')?.addEventListener('click', cmdSave);

// Banner buttons
document.getElementById('btn-reload-plan')?.addEventListener('click', async () => {
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
document.getElementById('btn-dismiss-banner')?.addEventListener('click', hideExternalChangeBanner);
document.getElementById('btn-welcome-new')?.addEventListener('click', () => { resetNewYearModal(); showModal('modal-new-year'); });
document.getElementById('btn-welcome-open')?.addEventListener('click', cmdOpen);

// Export button
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
  const tab = document.querySelector<HTMLElement>('.export-tab.active')?.dataset.tab ?? 'ical';
  if (tab === 'json') { doExportJSON(); return; }
  if (tab === 'ical') doExportICal();
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
document.getElementById('btn-modal-new-confirm')?.addEventListener('click', confirmNewYearWithCloud);
document.getElementById('btn-modal-new-cancel')?.addEventListener('click',  () => { resetNewYearModal(); closeModal('modal-new-year'); });
document.getElementById('btn-pick-template')?.addEventListener('click', pickTemplateFile);

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

Events.On('plan:cloud-disconnected', async () => {
  const status = await Planner.GetCloudStatus().catch(() => null);
  if (status) applyCloudStatus(status);
  showToast('Cloud-Verbindung getrennt.', 'warn');
});

// ── Cloud modal buttons ───────────────────────────────────────────────────────

document.getElementById('btn-connect')?.addEventListener('click', openConnectModal);
document.getElementById('btn-welcome-cloud')?.addEventListener('click', openConnectModal);
document.getElementById('btn-modal-connect-close')?.addEventListener('click',  () => { FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); });
document.getElementById('btn-modal-connect-cancel')?.addEventListener('click', () => { FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); });
document.getElementById('btn-modal-connect-confirm')?.addEventListener('click', doConnect);
document.getElementById('btn-load-cloud-year')?.addEventListener('click', doLoadCloudYear);
document.getElementById('btn-disconnect')?.addEventListener('click', doDisconnect);

// Generate room code in new-year modal
document.getElementById('btn-new-year-generate-code')?.addEventListener('click', async () => {
  try {
    const code = await Planner.GenerateRoomCode();
    const inp = document.getElementById('new-year-room-code') as HTMLInputElement | null;
    if (inp) inp.value = code;
  } catch { /* ignore */ }
});

// Show/hide cloud sub-rows when storage type changes in new-year modal
document.getElementById('new-year-cloud')?.addEventListener('change', () => {
  const codeRow = document.getElementById('new-year-cloud-code-row');
  const connRow = document.getElementById('new-year-cloud-connected-row');
  if (state.online) {
    if (codeRow) codeRow.style.display = 'none';
    if (connRow) {
      connRow.style.display = '';
      const sp = document.getElementById('new-year-current-room-code');
      if (sp) sp.textContent = state.cloudRoomCode;
    }
  } else {
    if (codeRow) codeRow.style.display = '';
    if (connRow) connRow.style.display = 'none';
  }
});
document.getElementById('new-year-local')?.addEventListener('change', () => {
  const codeRow = document.getElementById('new-year-cloud-code-row');
  if (codeRow) codeRow.style.display = 'none';
  const connRow = document.getElementById('new-year-cloud-connected-row');
  if (connRow) connRow.style.display = 'none';
});

// Escape key closes cloud connect modal
document.addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'Escape') { FirebaseSync.disconnectFromCloud(); closeModal('modal-connect'); }
}, { capture: false });

// ── Boot ─────────────────────────────────────────────────────────────────────

wireConfirmButtons();
wireOutboundRelay();
onWriteStateChange(() => updateCloudWritePill());

Planner.GetVersion().then(v => {
  const el = document.getElementById('sb-version');
  if (el) el.textContent = v;
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
  const link = document.getElementById('update-link') as HTMLAnchorElement | null;
  if (!link) return;
  link.textContent = 'Update verfügbar (' + newTag + ')';
  const releaseURL = 'https://github.com/Che4ter/Einsatzplaner/releases/tag/' + encodeURIComponent(newTag);
  link.style.display = '';
  link.addEventListener('click', (e: MouseEvent) => {
    e.preventDefault();
    Planner.OpenURL(releaseURL).catch(() => {});
  });
}).catch(() => {});

tryRestoreLastFile();
