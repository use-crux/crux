import type {
  StatisticsFact,
  StatisticsOwner,
  StatisticsRecord,
  StatisticsUsageReport,
  WorkCurrentState,
} from "./types";
import {
  exactKeys,
  invalid,
  optional,
  readBoolean,
  readDate,
  readFinite,
  readInteger,
  readLiteral,
  readObject,
  readString,
  type UnknownObject,
} from "./validation";

const OWNER_KINDS = [
  "run",
  "flow",
  "session",
  "composition",
  "work",
  "media",
] as const;
const WORK_STATES = ["queued", "running", "suspended", "blocked"] as const;
const TOKEN_KEYS = [
  "inputTokens",
  "outputTokens",
  "totalTokens",
  "cachedInputTokens",
  "reasoningTokens",
] as const;
const USAGE_KEYS = [...TOKEN_KEYS, "costUsd"] as const;
type MutableUsageReport = {
  -readonly [K in keyof StatisticsUsageReport]: StatisticsUsageReport[K];
};

/** Validate and detach one host-submitted record. @internal */
export function normalizeStatisticsRecord(value: unknown): StatisticsRecord {
  const record = readObject(value, "record");
  exactKeys(record, ["owner", "cursor", "at", "fact"], [], "record");
  const at = record.at;
  if (!(at instanceof Date) || !Number.isFinite(at.getTime()))
    invalid("record.at");
  return {
    owner: readOwner(record.owner, "record.owner"),
    cursor: readInteger(record.cursor, "record.cursor"),
    at: new Date(at),
    fact: readFact(record.fact, false),
  };
}

/** Canonical exact-replay identity for one validated record. @internal */
export function fingerprintRecord(record: StatisticsRecord): string {
  return stableJson({
    at: record.at.toISOString(),
    cursor: record.cursor,
    fact: record.fact,
    owner: record.owner,
  });
}

/** Decode and authenticate a persisted high-water fingerprint. @internal */
export function decodeRecordFingerprint(value: unknown): StatisticsRecord {
  const text = readString(value, "state.lastRecordFingerprint");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    invalid("state.lastRecordFingerprint");
  }
  const record = readObject(parsed, "state.lastRecordFingerprint");
  exactKeys(record, ["at", "cursor", "fact", "owner"], [], "fingerprint");
  const decoded: StatisticsRecord = {
    owner: readOwner(record.owner, "fingerprint.owner"),
    cursor: readInteger(record.cursor, "fingerprint.cursor"),
    at: readDate(record.at, "fingerprint.at"),
    fact: readFact(record.fact, true),
  };
  if (fingerprintRecord(decoded) !== text)
    invalid("state.lastRecordFingerprint");
  return decoded;
}

export function readOwner(value: unknown, label: string): StatisticsOwner {
  const owner = readObject(value, label);
  exactKeys(owner, ["kind", "id"], [], label);
  return {
    kind: readLiteral(owner.kind, OWNER_KINDS, `${label}.kind`),
    id: readString(owner.id, `${label}.id`),
  };
}

function readFact(value: unknown, strict: boolean): StatisticsFact {
  const fact = readObject(value, "fact");
  const kind = readString(fact.kind, "fact.kind");
  switch (kind) {
    case "model-call": {
      keys(fact, ["kind", "outcome", "model"], ["usage"], strict);
      const usage = optional(
        fact,
        "usage",
        (candidate, label) => readUsage(candidate, label, strict),
        "fact",
      );
      return {
        kind,
        outcome: readLiteral(
          fact.outcome,
          ["started", "succeeded", "failed", "cancelled"],
          "fact.outcome",
        ),
        model: readString(fact.model, "fact.model"),
        ...(usage ? { usage } : {}),
      };
    }
    case "transport-retry": {
      keys(fact, ["kind", "model"], ["usage"], strict);
      const usage = optional(
        fact,
        "usage",
        (candidate, label) => readUsage(candidate, label, strict),
        "fact",
      );
      return {
        kind,
        model: readString(fact.model, "fact.model"),
        ...(usage ? { usage } : {}),
      };
    }
    case "tool":
      keys(fact, ["kind", "name", "outcome"], [], strict);
      return {
        kind,
        name: readString(fact.name, "fact.name"),
        outcome: readLiteral(
          fact.outcome,
          ["called", "succeeded", "failed", "denied", "cancelled"],
          "fact.outcome",
        ),
      };
    case "work-accepted":
      keys(fact, ["kind", "target", "state"], [], strict);
      return {
        kind,
        target: readString(fact.target, "fact.target"),
        state: readLiteral(
          fact.state,
          ["queued", "running", "blocked"],
          "fact.state",
        ),
      };
    case "work-state":
      keys(fact, ["kind", "target", "from", "to"], [], strict);
      return {
        kind,
        target: readString(fact.target, "fact.target"),
        from: readWorkState(fact.from, "fact.from"),
        to: readWorkState(fact.to, "fact.to"),
      };
    case "work-outcome":
      keys(fact, ["kind", "target", "from", "outcome"], [], strict);
      return {
        kind,
        target: readString(fact.target, "fact.target"),
        from: readWorkState(fact.from, "fact.from"),
        outcome: readLiteral(
          fact.outcome,
          ["completed", "failed", "cancelled", "detached"],
          "fact.outcome",
        ),
      };
    case "failure":
      keys(fact, ["kind", "failureKind"], [], strict);
      return {
        kind,
        failureKind: readLiteral(
          fact.failureKind,
          [
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
          ],
          "fact.failureKind",
        ),
      };
    case "approval":
      keys(fact, ["kind", "outcome"], [], strict);
      return {
        kind,
        outcome: readLiteral(
          fact.outcome,
          ["requested", "approved", "denied", "expired"],
          "fact.outcome",
        ),
      };
    case "lifecycle":
      keys(fact, ["kind", "event"], [], strict);
      return {
        kind,
        event: readLiteral(
          fact.event,
          ["suspension", "resumption", "cancellation", "steering-input"],
          "fact.event",
        ),
      };
    case "session-input":
      keys(fact, ["kind", "identity", "outcome"], [], strict);
      return {
        kind,
        identity: readString(fact.identity, "fact.identity"),
        outcome: readLiteral(
          fact.outcome,
          ["accepted", "deduplicated", "delivered", "resumed", "dropped"],
          "fact.outcome",
        ),
      };
    case "timing": {
      keys(
        fact,
        ["kind", "activeTimeMs", "suspendedTimeMs"],
        ["completed"],
        strict,
      );
      const completed = optional(fact, "completed", readBoolean, "fact");
      return {
        kind,
        activeTimeMs: readFinite(fact.activeTimeMs, "fact.activeTimeMs"),
        suspendedTimeMs: readFinite(
          fact.suspendedTimeMs,
          "fact.suspendedTimeMs",
        ),
        ...(completed === undefined ? {} : { completed }),
      };
    }
    default:
      return invalid("fact.kind");
  }
}

function readUsage(
  value: unknown,
  label: string,
  strict: boolean,
): StatisticsUsageReport {
  const usage = readObject(value, label);
  keys(usage, [], USAGE_KEYS, strict);
  return usageValues(usage, label);
}

function usageValues(
  value: UnknownObject,
  label: string,
): StatisticsUsageReport {
  const result: MutableUsageReport = {};
  for (const key of TOKEN_KEYS) {
    const amount = optional(value, key, readInteger, label);
    if (amount !== undefined) result[key] = amount;
  }
  const costUsd = optional(value, "costUsd", readFinite, label);
  if (costUsd !== undefined) result.costUsd = costUsd;
  return result;
}

function readWorkState(value: unknown, label: string): WorkCurrentState {
  return readLiteral(value, WORK_STATES, label);
}

function keys(
  value: UnknownObject,
  required: readonly string[],
  optionalKeys: readonly string[],
  strict: boolean,
): void {
  if (strict) exactKeys(value, required, optionalKeys, "fact");
  else if (required.some((key) => !Object.hasOwn(value, key))) invalid("fact");
}

function stableJson(value: unknown): string {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as UnknownObject;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}
