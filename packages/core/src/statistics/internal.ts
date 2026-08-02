import type {
  ApprovalStats,
  FailureKind,
  LifecycleStats,
  ModelCallStats,
  StatisticsOwner,
  StatisticsUsageReport,
  ToolOutcomeStats,
  WorkCurrentState,
  WorkOutcomeStats,
} from "./types";

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export interface MutableUsage extends Mutable<StatisticsUsageReport> {
  calls: number;
  usageAttempts: number;
  tokenReports: number;
  costReports: number;
}

export type MutableModelCalls = Mutable<ModelCallStats>;
export type MutableToolOutcome = Mutable<ToolOutcomeStats>;
export type MutableWorkOutcome = Omit<Mutable<WorkOutcomeStats>, "current"> & {
  current: Mutable<Readonly<Record<WorkCurrentState, number>>>;
};
export type MutableApprovals = Mutable<ApprovalStats>;
export type MutableLifecycle = Mutable<LifecycleStats>;

export interface OwnerState {
  readonly owner: StatisticsOwner;
  readonly startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  cursor: number;
  lastRecordFingerprint: string;
  activeTimeMs: number;
  suspendedTimeMs: number;
  readonly usage: MutableUsage;
  readonly models: Map<string, MutableUsage>;
  otherModels?: MutableUsage;
  readonly modelCalls: MutableModelCalls;
  readonly tools: MutableToolOutcome;
  readonly toolsByName: Map<string, MutableToolOutcome>;
  otherTools?: MutableToolOutcome;
  readonly work: MutableWorkOutcome;
  readonly workByTarget: Map<string, MutableWorkOutcome>;
  otherWork?: MutableWorkOutcome;
  readonly failures: Record<FailureKind, number>;
  readonly approvals: MutableApprovals;
  readonly lifecycle: MutableLifecycle;
}

export function createOwnerState(
  owner: StatisticsOwner,
  at: Date,
  cursor: number,
  lastRecordFingerprint: string,
): OwnerState {
  return {
    owner: { ...owner },
    startedAt: new Date(at),
    updatedAt: new Date(at),
    cursor,
    lastRecordFingerprint,
    activeTimeMs: 0,
    suspendedTimeMs: 0,
    usage: { calls: 0, usageAttempts: 0, tokenReports: 0, costReports: 0 },
    models: new Map(),
    modelCalls: {
      started: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      transportRetries: 0,
    },
    tools: emptyToolOutcome(),
    toolsByName: new Map(),
    work: emptyWorkOutcome(),
    workByTarget: new Map(),
    failures: {
      provider: 0,
      tool: 0,
      work: 0,
      approval: 0,
      safety: 0,
      validation: 0,
      preparation: 0,
      timeout: 0,
      runtime: 0,
      unknown: 0,
    },
    approvals: { requested: 0, approved: 0, denied: 0, expired: 0 },
    lifecycle: {
      suspensions: 0,
      resumptions: 0,
      cancellations: 0,
      steeringInputs: 0,
    },
  };
}

export function emptyToolOutcome(): MutableToolOutcome {
  return { called: 0, succeeded: 0, failed: 0, denied: 0, cancelled: 0 };
}

export function emptyWorkOutcome(): MutableWorkOutcome {
  return {
    started: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    detached: 0,
    current: emptyWorkCurrent(),
  };
}

function emptyWorkCurrent(): Record<WorkCurrentState, number> {
  return { queued: 0, running: 0, suspended: 0, blocked: 0 };
}
