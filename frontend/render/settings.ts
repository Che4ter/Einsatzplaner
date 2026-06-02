import { esc } from '../utils.js';

// isOnline, autosaveEnabled, autosaveDelayMs are passed as parameters
// to keep this function pure (no state reads).
export function renderSettingsPage(
  plan: any,
  isOnline: boolean,
  autosaveEnabled: boolean,
  autosaveDelayMs: number,
): string {
  const { settings, team, year } = plan;
  const autosaveChecked = autosaveEnabled ? 'checked' : '';

  const locationRows = (settings.locations ?? []).map((loc: string, i: number) => `
    <div class="a-row">
      <div class="a-row-main"><div class="a-row-name">${esc(loc)}</div></div>
      <div class="a-row-actions">
        <button class="a-row-btn" data-action="edit-location" data-index="${i}">Bearbeiten</button>
        <button class="a-row-btn danger" data-action="delete-location" data-index="${i}">Löschen</button>
      </div>
    </div>`).join('');

  const timeRows = (settings.defaultTimes ?? []).map((t: any, i: number) => {
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

  const teamRows = team.slice().sort((a: any, b: any) => a.name.localeCompare(b.name)).map((m: any) => `
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
          ${isOnline ? '' : `<div class="dlg-field" style="margin-top:16px;display:flex;align-items:center;justify-content:space-between">
            <div>
              <div class="dlg-label" style="margin-bottom:0">Automatisch speichern</div>
              <div class="dlg-hint">Änderungen werden nach ${autosaveDelayMs / 1000} Sekunden automatisch gespeichert.</div>
            </div>
            <label class="toggle-switch">
              <input type="checkbox" id="settings-autosave" ${autosaveChecked} data-action="toggle-autosave">
              <span class="toggle-track"></span>
            </label>
          </div>`}
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
          <span class="a-card-sub">${team.filter((m: any) => m.active).length} aktiv · ${team.filter((m: any) => !m.active).length} inaktiv</span>
          <button class="a-add-btn" data-action="add-member">+ Person hinzufügen</button>
        </div>
        <div class="a-card-body tight">
          ${teamRows || '<div class="a-empty">Noch keine Teammitglieder erfasst.</div>'}
        </div>
      </div>
    </div>`;
}
