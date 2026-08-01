import type {
  MutableApprovals,
  MutableLifecycle,
  MutableModelCalls,
  MutableToolOutcome,
  MutableUsage,
  MutableWorkOutcome,
  OwnerState,
} from "./internal";
import type { FailureKind, StatisticsLedgerExport } from "./types";

interface EncodedOwnerState {
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt?: string;
  readonly activeTimeMs: number;
  readonly suspendedTimeMs: number;
  readonly usage: MutableUsage;
  readonly models: readonly (readonly [string, MutableUsage])[];
  readonly otherModels?: MutableUsage;
  readonly modelCalls: MutableModelCalls;
  readonly tools: MutableToolOutcome;
  readonly toolsByName: readonly (readonly [string, MutableToolOutcome])[];
  readonly otherTools?: MutableToolOutcome;
  readonly work: MutableWorkOutcome;
  readonly workByTarget: readonly (readonly [string, MutableWorkOutcome])[];
  readonly otherWork?: MutableWorkOutcome;
  readonly failures: Record<FailureKind, number>;
  readonly approvals: MutableApprovals;
  readonly lifecycle: MutableLifecycle;
}

export function encodeOwnerState(state: OwnerState): StatisticsLedgerExport {
  const encoded: EncodedOwnerState = {
    startedAt: state.startedAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
    ...(state.completedAt
      ? { completedAt: state.completedAt.toISOString() }
      : {}),
    activeTimeMs: state.activeTimeMs,
    suspendedTimeMs: state.suspendedTimeMs,
    usage: state.usage,
    models: [...state.models],
    ...(state.otherModels ? { otherModels: state.otherModels } : {}),
    modelCalls: state.modelCalls,
    tools: state.tools,
    toolsByName: [...state.toolsByName],
    ...(state.otherTools ? { otherTools: state.otherTools } : {}),
    work: state.work,
    workByTarget: [...state.workByTarget],
    ...(state.otherWork ? { otherWork: state.otherWork } : {}),
    failures: state.failures,
    approvals: state.approvals,
    lifecycle: state.lifecycle,
  };
  return {
    version: 1,
    owner: { ...state.owner },
    cursor: state.cursor,
    state: JSON.stringify(encoded),
  };
}

export function decodeOwnerState(value: StatisticsLedgerExport): OwnerState {
  if (value.version !== 1)
    throw new TypeError("Unsupported statistics ledger export version.");
  const encoded = JSON.parse(value.state) as EncodedOwnerState;
  return {
    owner: { ...value.owner },
    cursor: value.cursor,
    startedAt: parseDate(encoded.startedAt),
    updatedAt: parseDate(encoded.updatedAt),
    ...(encoded.completedAt
      ? { completedAt: parseDate(encoded.completedAt) }
      : {}),
    activeTimeMs: encoded.activeTimeMs,
    suspendedTimeMs: encoded.suspendedTimeMs,
    usage: encoded.usage,
    models: new Map(encoded.models),
    ...(encoded.otherModels ? { otherModels: encoded.otherModels } : {}),
    modelCalls: encoded.modelCalls,
    tools: encoded.tools,
    toolsByName: new Map(encoded.toolsByName),
    ...(encoded.otherTools ? { otherTools: encoded.otherTools } : {}),
    work: encoded.work,
    workByTarget: new Map(encoded.workByTarget),
    ...(encoded.otherWork ? { otherWork: encoded.otherWork } : {}),
    failures: encoded.failures,
    approvals: encoded.approvals,
    lifecycle: encoded.lifecycle,
  };
}

function parseDate(value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new TypeError("Invalid statistics ledger timestamp.");
  return date;
}
