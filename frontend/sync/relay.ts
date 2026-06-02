// sync/relay.ts — outbound cloud event relay.
// Wires the 8 Events.On('cloud:*') handlers that map Go-emitted events to
// Firestore writes. This is the outbox: Go mutates state and emits; JS transports.
// Call wireOutboundRelay() once at boot, before any cloud events can fire.

import { Events } from '/wails/runtime.js';
import {
  dbSaveEvent, dbSaveEventFull, dbDeleteEvent,
  dbSaveSettings, dbSaveMember, dbDeleteMember,
  dbAppendActivity, dbAssignStaff, dbUnassignStaff,
} from './firestore.js';
import { trackCloudWrite } from './writeTracker.js';

export function wireOutboundRelay(): void {
  // Update path: strips assignedStaff (managed atomically by toggle-staff)
  Events.On('cloud:save-event', (e: any) => {
    const [month, ev] = e.data;
    trackCloudWrite(dbSaveEvent(month, ev), 'Einsatz');
  });

  // Create path: writes the full document including assignedStaff.
  // On create the doc doesn't exist yet so initial assignments must be written here.
  Events.On('cloud:create-event', (e: any) => {
    const [month, ev] = e.data;
    trackCloudWrite(dbSaveEventFull(month, ev), 'Einsatz');
  });

  Events.On('cloud:delete-event', (e: any) => {
    trackCloudWrite(dbDeleteEvent(e.data), 'Löschen');
  });

  Events.On('cloud:save-settings', (e: any) => {
    trackCloudWrite(dbSaveSettings(e.data), 'Einstellungen');
  });

  Events.On('cloud:save-member', (e: any) => {
    trackCloudWrite(dbSaveMember(e.data), 'Person');
  });

  Events.On('cloud:delete-member', (e: any) => {
    trackCloudWrite(dbDeleteMember(e.data), 'Person löschen');
  });

  // Activity log: silent=true — a lost log line must not nag or flip the sync flag.
  Events.On('cloud:append-activity', (e: any) => {
    trackCloudWrite(dbAppendActivity(e.data), 'Verlauf', true);
  });

  Events.On('cloud:toggle-staff', (e: any) => {
    const [eventId, memberId, assign] = e.data;
    const p = assign
      ? dbAssignStaff(eventId, memberId)
      : dbUnassignStaff(eventId, memberId);
    trackCloudWrite(p, 'Zuteilung');
  });
}
