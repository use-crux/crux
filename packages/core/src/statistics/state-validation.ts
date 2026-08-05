import type {
  MutableToolOutcome,
  MutableUsage,
  MutableWorkOutcome,
  OwnerState,
} from "./internal";
import { decodeRecordFingerprint, readOwner } from "./record";
import {
  emptySessionInputOutcome,
  type MutableSessionInputOutcome,
} from "./internal";
import {
  readApprovals,
  readFailures,
  readLifecycle,
  readMap,
  readModelCalls,
  readSessionInputOutcome,
  readTool,
  readUsage,
  readWork,
  USAGE_KEYS,
} from "./state-fields";
import type { WorkCurrentState } from "./types";
import {
  exactKeys,
  invalid,
  optional,
  readDate,
  readFinite,
  readInteger,
  readObject,
  readString,
  sameRecord,
} from "./validation";

const USAGE_TOTAL_KEYS = [
  "calls",
  "usageAttempts",
  "tokenReports",
  "costReports",
  ...USAGE_KEYS,
] as const;

/** Decode and validate the complete persisted owner state. @internal */
export function decodeState(value: unknown): OwnerState {
  const state = readObject(value, "state");
  exactKeys(
    state,
    [
      "owner",
      "cursor",
      "lastRecordFingerprint",
      "startedAt",
      "updatedAt",
      "activeTimeMs",
      "suspendedTimeMs",
      "usage",
      "models",
      "modelCalls",
      "tools",
      "toolsByName",
      "work",
      "workByTarget",
      "failures",
      "approvals",
      "lifecycle",
    ],
    [
      "completedAt",
      "otherModels",
      "otherTools",
      "otherWork",
      "inputs",
      "inputsByIdentity",
      "otherInputs",
    ],
    "state",
  );
  const owner = readOwner(state.owner, "state.owner");
  const cursor = readInteger(state.cursor, "state.cursor");
  const startedAt = readDate(state.startedAt, "state.startedAt");
  const updatedAt = readDate(state.updatedAt, "state.updatedAt");
  const completedAt = optional(state, "completedAt", readDate, "state");
  if (
    startedAt > updatedAt ||
    (completedAt && (completedAt < startedAt || completedAt > updatedAt))
  ) {
    invalid("timestamps");
  }
  const lastRecord = decodeRecordFingerprint(state.lastRecordFingerprint);
  if (
    lastRecord.cursor !== cursor ||
    lastRecord.at.getTime() !== updatedAt.getTime() ||
    lastRecord.owner.kind !== owner.kind ||
    lastRecord.owner.id !== owner.id
  ) {
    invalid("state.lastRecordFingerprint");
  }

  const usage = readUsage(state.usage, "state.usage");
  const models = readMap(state.models, "state.models", readUsage);
  const otherModels = optional(state, "otherModels", readUsage, "state");
  const modelCalls = readModelCalls(state.modelCalls);
  const tools = readTool(state.tools, "state.tools");
  const toolsByName = readMap(state.toolsByName, "state.toolsByName", readTool);
  const otherTools = optional(state, "otherTools", readTool, "state");
  const work = readWork(state.work, "state.work");
  const workByTarget = readMap(
    state.workByTarget,
    "state.workByTarget",
    readWork,
  );
  const otherWork = optional(state, "otherWork", readWork, "state");
  const failures = readFailures(state.failures);
  const approvals = readApprovals(state.approvals);
  const lifecycle = readLifecycle(state.lifecycle);
  const inputs =
    state.inputs === undefined
      ? emptySessionInputOutcome()
      : readSessionInputOutcome(state.inputs, "state.inputs");
  const inputsByIdentity =
    state.inputsByIdentity === undefined
      ? new Map<string, MutableSessionInputOutcome>()
      : readMap(
          state.inputsByIdentity,
          "state.inputsByIdentity",
          readSessionInputOutcome,
        );
  const otherInputs =
    state.otherInputs === undefined
      ? undefined
      : readSessionInputOutcome(state.otherInputs, "state.otherInputs");

  validateOverflow(models, otherModels, hasUsage, "models");
  validateOverflow(toolsByName, otherTools, hasCounts, "tools");
  validateOverflow(workByTarget, otherWork, hasWork, "work");
  validateOverflow(inputsByIdentity, otherInputs, hasSessionInput, "inputs");
  if (!equalUsage(usage, sumUsage(models.values(), otherModels))) {
    invalid("usage totals");
  }
  if (modelCalls.started !== usage.calls) invalid("model call totals");
  if (
    modelCalls.succeeded + modelCalls.failed + modelCalls.cancelled >
    modelCalls.started
  ) {
    invalid("model call outcomes");
  }
  if (!sameRecord(tools, sumTools(toolsByName.values(), otherTools))) {
    invalid("Tool totals");
  }
  if (!equalWork(work, sumWork(workByTarget.values(), otherWork))) {
    invalid("Work totals");
  }
  if (
    !sameRecord(
      inputs,
      sumSessionInputs(inputsByIdentity.values(), otherInputs),
    )
  ) {
    invalid("Session input totals");
  }

  return {
    owner,
    cursor,
    lastRecordFingerprint: readString(
      state.lastRecordFingerprint,
      "state.lastRecordFingerprint",
    ),
    startedAt,
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    activeTimeMs: readFinite(state.activeTimeMs, "state.activeTimeMs"),
    suspendedTimeMs: readFinite(state.suspendedTimeMs, "state.suspendedTimeMs"),
    usage,
    models,
    ...(otherModels ? { otherModels } : {}),
    modelCalls,
    tools,
    toolsByName,
    ...(otherTools ? { otherTools } : {}),
    work,
    workByTarget,
    ...(otherWork ? { otherWork } : {}),
    failures,
    approvals,
    lifecycle,
    inputs,
    inputsByIdentity,
    ...(otherInputs ? { otherInputs } : {}),
  };
}

function validateOverflow<T>(
  map: Map<string, T>,
  overflow: T | undefined,
  hasActivity: (value: T) => boolean,
  label: string,
): void {
  if ([...map.values()].some((value) => !hasActivity(value))) invalid(label);
  if (overflow && (map.size !== 64 || !hasActivity(overflow))) {
    invalid(`${label} overflow`);
  }
}

function hasUsage(value: MutableUsage): boolean {
  return value.calls > 0 && value.usageAttempts >= value.calls;
}

function hasCounts(value: MutableToolOutcome): boolean {
  return Object.values(value).some((count) => count > 0);
}

function hasWork(value: MutableWorkOutcome): boolean {
  return value.started > 0;
}

function hasSessionInput(value: MutableSessionInputOutcome): boolean {
  return Object.values(value).some((count) => count > 0);
}

function sumSessionInputs(
  values: Iterable<MutableSessionInputOutcome>,
  overflow?: MutableSessionInputOutcome,
): MutableSessionInputOutcome {
  const all = overflow ? [...values, overflow] : [...values];
  const total = (key: keyof MutableSessionInputOutcome) =>
    all.reduce((sum, value) => sum + value[key], 0);
  return {
    accepted: total("accepted"),
    deduplicated: total("deduplicated"),
    delivered: total("delivered"),
    resumed: total("resumed"),
    dropped: total("dropped"),
  };
}

function sumUsage(
  values: Iterable<MutableUsage>,
  overflow?: MutableUsage,
): MutableUsage {
  const total: MutableUsage = {
    calls: 0,
    usageAttempts: 0,
    tokenReports: 0,
    costReports: 0,
  };
  for (const value of overflow ? [...values, overflow] : values) {
    for (const key of USAGE_TOTAL_KEYS) {
      const amount = value[key];
      if (amount !== undefined) total[key] = (total[key] ?? 0) + amount;
    }
  }
  return total;
}

function equalUsage(left: MutableUsage, right: MutableUsage): boolean {
  return USAGE_TOTAL_KEYS.every((key) => left[key] === right[key]);
}

function sumTools(
  values: Iterable<MutableToolOutcome>,
  overflow?: MutableToolOutcome,
): MutableToolOutcome {
  const all = overflow ? [...values, overflow] : [...values];
  const total = (key: keyof MutableToolOutcome) =>
    all.reduce((sum, value) => sum + value[key], 0);
  return {
    called: total("called"),
    succeeded: total("succeeded"),
    failed: total("failed"),
    denied: total("denied"),
    cancelled: total("cancelled"),
  };
}

function sumWork(
  values: Iterable<MutableWorkOutcome>,
  overflow?: MutableWorkOutcome,
): MutableWorkOutcome {
  const all = overflow ? [...values, overflow] : [...values];
  const totals = (key: keyof Omit<MutableWorkOutcome, "current">) =>
    all.reduce((sum, value) => sum + value[key], 0);
  const current = (key: WorkCurrentState) =>
    all.reduce((sum, value) => sum + value.current[key], 0);
  return {
    started: totals("started"),
    completed: totals("completed"),
    failed: totals("failed"),
    cancelled: totals("cancelled"),
    detached: totals("detached"),
    current: {
      queued: current("queued"),
      running: current("running"),
      suspended: current("suspended"),
      blocked: current("blocked"),
    },
  };
}

function equalWork(
  left: MutableWorkOutcome,
  right: MutableWorkOutcome,
): boolean {
  return (
    left.started === right.started &&
    left.completed === right.completed &&
    left.failed === right.failed &&
    left.cancelled === right.cancelled &&
    left.detached === right.detached &&
    sameRecord(left.current, right.current)
  );
}
