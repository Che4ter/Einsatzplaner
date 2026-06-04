// services.ts — typed proxy over the auto-generated Wails bindings.
// All Go calls flow through here. Controllers never import from bindings/ directly.
//
// plannerCall<T>() centralises the standard try/toast/return-null error pattern.
// Domain type interfaces live here until wails3 can generate TS bindings.

import * as _P from './bindings/einsatzplaner/einsatzplan/service/plannerservice.js';
import { showToast } from './ui.js';

// ── Domain types ──────────────────────────────────────────────────────────────
// Minimal structural interfaces matching the Go domain types.
// Use `any` casts in calling code where a stricter type isn't worth the churn yet.

export interface YearPlan {
  version: number;
  year: number;
  settings: Settings;
  team: TeamMember[];
  months: Record<number | string, Month>;
  activityLog: ActivityEntry[];
}

export interface Month { events: Event[]; }

export interface Settings {
  teamName: string;
  locations: string[];
  defaultTimes: TimePreset[];
  prepTimeHours: number;
}

export interface TimePreset {
  label: string;
  from: string;
  to: string;
  timeSetup?: string;
  timeTeardown?: string;
}

export interface TeamMember {
  id: string;
  name: string;
  color: string;
  active: boolean;
  excludeFromHours?: boolean;
}

export interface Event {
  id: string;
  type: 'wednesday' | 'weekday' | 'weekend';
  date: string;
  dateEnd?: string;
  isClosed: boolean;
  location?: string;
  timeFrom?: string;
  timeTo?: string;
  timeSetup?: string;
  timeTeardown?: string;
  staffRequired: number;
  assignedStaff: string[];
  comment?: string;
  month: number;
}

export interface ActivityEntry {
  id: string;
  at: string;
  action: string;
  target?: { date?: string; month?: number; location?: string; type?: string };
  person?: string;
  field?: string;
  from?: string;
  to?: string;
  count?: number;
  reason?: string;
  note?: string;
}

export interface MonthSummary { total: number; issues: number; }

export interface MonthStats {
  totalEvents: number;
  underCount: number;
  openSlots: number;
  totalNeed: number;
  totalAssigned: number;
  filledSlots: number;
  coveragePct: number;
}

export interface YearStats extends MonthStats {
  totalHours: number;
  prepHours: number;
  vorOrtHours: number;
}

export interface PersonStats {
  id: string;
  name: string;
  color: string;
  active: boolean;
  total: number;
  wkd: number;
  wke: number;
  hrs: number;
  prepHrs?: number;
}

export interface CloudStatus {
  cloudEnabled: boolean;
  isOnline: boolean;
  roomCode: string;
  projectId: string;
  apiKey: string;
}

// ── Error helper ──────────────────────────────────────────────────────────────

// Wraps any Planner call with the standard try/toast/null pattern.
// Returns null on error so callers can `if (!result) return` instead of try/catch.
// Pass a German error prefix matching the operation, e.g. 'Fehler beim Speichern'.
export async function plannerCall<T>(
  fn: () => Promise<T>,
  errorMsg = 'Fehler',
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    showToast(`${errorMsg}: ${e}`, 'error');
    return null;
  }
}

// ── Read operations ───────────────────────────────────────────────────────────

export const GetPlan            = _P.GetPlan            as () => Promise<YearPlan>;
export const GetMonthSummaries  = _P.GetMonthSummaries  as () => Promise<Record<number, MonthSummary>>;
export const GetMonthEvents     = _P.GetMonthEvents     as (month: number) => Promise<Event[]>;
export const GetYearStats       = _P.GetYearStats       as (month: number) => Promise<YearStats>;
export const GetPersonStats     = _P.GetPersonStats     as (month: number) => Promise<PersonStats[]>;
export const GetActivityLog     = _P.GetActivityLog     as () => Promise<ActivityEntry[]>;
export const GetCloudStatus     = _P.GetCloudStatus     as () => Promise<CloudStatus>;
export const GetCurrentFileName = _P.GetCurrentFileName as () => Promise<string>;
export const GetRecentPaths     = _P.GetRecentPaths     as () => Promise<string[]>;
export const GetVersion         = _P.GetVersion         as () => Promise<string>;
export const CheckForUpdate     = _P.CheckForUpdate     as () => Promise<string | null>;
export const IsDirty            = _P.IsDirty            as () => Promise<boolean>;

// ── File operations ───────────────────────────────────────────────────────────

export const OpenPlan               = _P.OpenPlan               as () => Promise<YearPlan | null>;
export const SavePlan               = _P.SavePlan               as () => Promise<void>;
export const SavePlanAs             = _P.SavePlanAs             as () => Promise<void>;
export const ForceOverwriteSave     = _P.ForceOverwriteSave     as () => Promise<void>;
export const ReloadPlan             = _P.ReloadPlan             as () => Promise<YearPlan>;
export const ReopenPlan             = _P.ReopenPlan             as (path: string) => Promise<YearPlan>;
export const AddRecentPath          = _P.AddRecentPath          as (path: string) => Promise<void>;
export const RemoveRecentPath       = _P.RemoveRecentPath       as (path: string) => Promise<void>;
export const PickTemplateFile       = _P.PickTemplateFile       as () => Promise<string | null>;
export const CreatePlan             = _P.CreatePlan             as (year: number) => Promise<YearPlan>;
export const CreatePlanFromTemplate = _P.CreatePlanFromTemplate as (year: number, templatePath: string, includeEvents: boolean) => Promise<YearPlan>;

// ── Event mutations ───────────────────────────────────────────────────────────

export const UpdateEvent = _P.UpdateEvent as (month: number, ev: Event) => Promise<void>;
export const CreateEvent = _P.CreateEvent as (month: number, ev: Event) => Promise<void>;
export const DeleteEvent = _P.DeleteEvent as (month: number, eventID: string) => Promise<void>;
export const ToggleStaff = _P.ToggleStaff as (month: number, eventId: string, memberId: string) => Promise<void>;

// ── Member mutations ──────────────────────────────────────────────────────────

export const UpdateMember       = _P.UpdateMember       as (m: TeamMember) => Promise<void>;
export const CreateMember       = _P.CreateMember       as (m: TeamMember) => Promise<void>;
export const DeleteMember       = _P.DeleteMember       as (memberID: string) => Promise<void>;
export const ToggleMemberActive = _P.ToggleMemberActive as (id: string) => Promise<void>;

// ── Settings ──────────────────────────────────────────────────────────────────

export const UpdateSettings = _P.UpdateSettings as (s: Settings) => Promise<void>;

// ── Export ────────────────────────────────────────────────────────────────────

export const ExportICal     = _P.ExportICal     as (personIDs: string[], includePrep: boolean) => Promise<void>;
export const ExportPlanJSON = _P.ExportPlanJSON as () => Promise<string>;

// ── Cloud ─────────────────────────────────────────────────────────────────────

export const GenerateRoomCode   = _P.GenerateRoomCode   as () => Promise<string>;
export const ConnectCloud       = _P.ConnectCloud       as (roomCode: string, year: number) => Promise<void>;
export const DisconnectCloud    = _P.DisconnectCloud    as () => Promise<void>;
export const CreateCloudPlan    = _P.CreateCloudPlan    as (year: number, roomCode: string, templatePath: string, includeEvents: boolean) => Promise<YearPlan>;
export const NotifyCloudDisconnected = _P.NotifyCloudDisconnected as () => Promise<void>;

// ── Utility ───────────────────────────────────────────────────────────────────

export const OpenURL = _P.OpenURL as (url: string) => Promise<void>;

// ── Cloud sync callbacks (called by firebaseSync.js on inbound Firestore changes) ─

export const SyncFullPlan   = _P.SyncFullPlan   as unknown as (plan: YearPlan) => Promise<YearPlan>;
export const SyncMetaUpdate = _P.SyncMetaUpdate as (settings: Settings, team: TeamMember[]) => Promise<void>;
export const SyncEventUpdate = _P.SyncEventUpdate as (month: number, ev: Event, isDelete: boolean) => Promise<void>;
