import type {
  MutableApprovals,
  MutableLifecycle,
  MutableModelCalls,
  MutableSessionInputOutcome,
  MutableToolOutcome,
  MutableUsage,
  MutableWorkOutcome,
} from "./internal";
import type { FailureKind } from "./types";
import {
  exactKeys,
  invalid,
  readFinite,
  readInteger,
  readObject,
  readString,
} from "./validation";

export const USAGE_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
  "costUsd",
] as const;

export function readUsage(value: unknown, label: string): MutableUsage {
  const usage = readObject(value, label);
  exactKeys(
    usage,
    ["calls", "usageAttempts", "tokenReports", "costReports"],
    USAGE_KEYS,
    label,
  );
  const result: MutableUsage = {
    calls: readInteger(usage.calls, `${label}.calls`),
    usageAttempts: readInteger(usage.usageAttempts, `${label}.usageAttempts`),
    tokenReports: readInteger(usage.tokenReports, `${label}.tokenReports`),
    costReports: readInteger(usage.costReports, `${label}.costReports`),
  };
  for (const key of USAGE_KEYS) {
    if (!Object.hasOwn(usage, key)) continue;
    result[key] = (key === "costUsd" ? readFinite : readInteger)(
      usage[key],
      `${label}.${key}`,
    );
  }
  const hasTokens = USAGE_KEYS.slice(0, 5).some((key) => key in result);
  if ((result.tokenReports === 0) === hasTokens)
    invalid(`${label}.tokenReports`);
  if ((result.costReports === 0) === (result.costUsd !== undefined)) {
    invalid(`${label}.costReports`);
  }
  if (
    result.calls > result.usageAttempts ||
    result.tokenReports > result.usageAttempts ||
    result.costReports > result.usageAttempts
  ) {
    invalid(`${label}.usageAttempts`);
  }
  return result;
}

export function readModelCalls(value: unknown): MutableModelCalls {
  const object = counts(value, "state.modelCalls", [
    "started",
    "succeeded",
    "failed",
    "cancelled",
    "transportRetries",
  ]);
  return {
    started: object.started,
    succeeded: object.succeeded,
    failed: object.failed,
    cancelled: object.cancelled,
    transportRetries: object.transportRetries,
  };
}

export function readTool(value: unknown, label: string): MutableToolOutcome {
  const object = counts(value, label, [
    "called",
    "succeeded",
    "failed",
    "denied",
    "cancelled",
  ]);
  if (object.succeeded + object.failed + object.cancelled > object.called) {
    invalid(`${label} outcomes`);
  }
  return {
    called: object.called,
    succeeded: object.succeeded,
    failed: object.failed,
    denied: object.denied,
    cancelled: object.cancelled,
  };
}

export function readWork(value: unknown, label: string): MutableWorkOutcome {
  const work = readObject(value, label);
  exactKeys(
    work,
    ["started", "completed", "failed", "cancelled", "detached", "current"],
    [],
    label,
  );
  const gauges = counts(work.current, `${label}.current`, [
    "queued",
    "running",
    "suspended",
    "blocked",
  ]);
  const current = {
    queued: gauges.queued,
    running: gauges.running,
    suspended: gauges.suspended,
    blocked: gauges.blocked,
  };
  const result = {
    started: readInteger(work.started, `${label}.started`),
    completed: readInteger(work.completed, `${label}.completed`),
    failed: readInteger(work.failed, `${label}.failed`),
    cancelled: readInteger(work.cancelled, `${label}.cancelled`),
    detached: readInteger(work.detached, `${label}.detached`),
    current,
  };
  const settled =
    result.completed + result.failed + result.cancelled + result.detached;
  const active = Object.values(current).reduce((sum, count) => sum + count, 0);
  if (settled + active !== result.started) invalid(`${label} invariant`);
  return result;
}

export function readFailures(value: unknown): Record<FailureKind, number> {
  const object = counts(value, "state.failures", [
    "provider",
    "tool",
    "work",
    "approval",
    "safety",
    "validation",
    "preparation",
    "timeout",
    "runtime",
    "unknown",
  ]);
  return { ...object };
}

export function readApprovals(value: unknown): MutableApprovals {
  const object = counts(value, "state.approvals", [
    "requested",
    "approved",
    "denied",
    "expired",
  ]);
  if (object.approved + object.denied + object.expired > object.requested) {
    invalid("state.approval outcomes");
  }
  return { ...object };
}

export function readLifecycle(value: unknown): MutableLifecycle {
  const object = counts(value, "state.lifecycle", [
    "suspensions",
    "resumptions",
    "cancellations",
    "steeringInputs",
  ]);
  if (object.resumptions > object.suspensions) {
    invalid("state.lifecycle resumptions");
  }
  return { ...object };
}

export function readSessionInputOutcome(
  value: unknown,
  label: string,
): MutableSessionInputOutcome {
  const object = counts(value, label, [
    "accepted",
    "deduplicated",
    "delivered",
    "resumed",
    "dropped",
  ]);
  return { ...object };
}

export function readMap<T>(
  value: unknown,
  label: string,
  decode: (value: unknown, label: string) => T,
): Map<string, T> {
  if (!Array.isArray(value) || value.length > 64) invalid(label);
  const result = new Map<string, T>();
  value.forEach((entry, index) => {
    if (!Array.isArray(entry) || entry.length !== 2)
      invalid(`${label}[${index}]`);
    const key = readString(entry[0], `${label}[${index}][0]`);
    if (result.has(key)) invalid(`${label} duplicate identity`);
    result.set(key, decode(entry[1], `${label}[${index}][1]`));
  });
  return result;
}

function counts<K extends string>(
  value: unknown,
  label: string,
  keys: readonly K[],
): Record<K, number> {
  const object = readObject(value, label);
  exactKeys(object, keys, [], label);
  return Object.fromEntries(
    keys.map((key) => [key, readInteger(object[key], `${label}.${key}`)]),
  ) as Record<K, number>;
}
