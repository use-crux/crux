/**
 * Bounded persistence for managed-history summary artifacts.
 *
 * @internal
 * @module
 */

import { getHooks } from "../../runtime/runtime";
import type { JsonObject, RecordStore } from "../../storage/types";
import { HISTORY_ARTIFACT_GOVERNANCE } from "./identity";

export interface HistoryArtifactRecord extends JsonObject {
  readonly kind: "request.history-summary";
  readonly artifactId: string;
  readonly series: string;
  readonly sourceDigest: string;
  readonly prefixLength: number;
  readonly threadSource?: string;
  readonly threadRevision?: string;
  readonly threadRange?: string;
  readonly threadOffset?: number;
  readonly threadStart?: string;
  readonly threadEnd?: string;
  readonly summary: string;
  readonly createdAt: number;
  readonly governance: {
    readonly sensitivity: "restricted";
    readonly tenancy: "storage-scope";
    readonly residency: "storage-provider";
    readonly ownership: "storage-scope";
    readonly retentionMs: number;
  };
  readonly supportRequestId?: string;
  readonly supportRequestIds?: readonly string[];
}

const memoryArtifacts = new Map<string, HistoryArtifactRecord>();
const MEMORY_ARTIFACT_TTL_MS = HISTORY_ARTIFACT_GOVERNANCE.retentionMs;
const MEMORY_ARTIFACT_LIMIT = 128;

export async function readHistoryArtifact(
  key: string,
): Promise<HistoryArtifactRecord | undefined> {
  const records = configuredRecords();
  const value = records ? await records.get(key) : memoryArtifacts.get(key);
  if (!isHistoryArtifactRecord(value)) return undefined;
  if (!records && Date.now() - value.createdAt >= MEMORY_ARTIFACT_TTL_MS) {
    memoryArtifacts.delete(key);
    return undefined;
  }
  return value;
}

export async function listHistoryArtifacts(
  prefix: string,
): Promise<HistoryArtifactRecord[]> {
  const records = configuredRecords();
  if (!records) {
    return [...memoryArtifacts.entries()]
      .filter(([key, value]) => {
        if (Date.now() - value.createdAt < MEMORY_ARTIFACT_TTL_MS) {
          return key.startsWith(prefix);
        }
        memoryArtifacts.delete(key);
        return false;
      })
      .map(([, value]) => value);
  }
  const values: JsonObject[] = [];
  let cursor: string | undefined;
  do {
    const page = await records.list(prefix, { cursor });
    values.push(...page.entries.map((entry) => entry.value));
    cursor = page.cursor;
  } while (cursor);
  return values.filter(isHistoryArtifactRecord);
}

export async function publishHistoryArtifact(
  key: string,
  value: HistoryArtifactRecord,
): Promise<HistoryArtifactRecord> {
  const records = configuredRecords();
  if (!records) {
    if (!memoryArtifacts.has(key)) {
      memoryArtifacts.set(key, value);
      while (memoryArtifacts.size > MEMORY_ARTIFACT_LIMIT) {
        const oldest = memoryArtifacts.keys().next().value;
        if (typeof oldest !== "string") break;
        memoryArtifacts.delete(oldest);
      }
    }
    return memoryArtifacts.get(key) ?? value;
  }
  if (records.create) {
    const created = await records.create(key, value, {
      ttlMs: HISTORY_ARTIFACT_GOVERNANCE.retentionMs,
    });
    if (!created) {
      const winner = await records.get(key);
      if (isHistoryArtifactRecord(winner)) return winner;
    }
    return value;
  }
  await records.put(key, value, {
    ttlMs: HISTORY_ARTIFACT_GOVERNANCE.retentionMs,
  });
  return value;
}

function configuredRecords(): RecordStore | undefined {
  return getHooks().records;
}

function isHistoryArtifactRecord(
  value: JsonObject | null | undefined,
): value is HistoryArtifactRecord {
  return (
    value?.kind === "request.history-summary" &&
    typeof value.artifactId === "string" &&
    typeof value.series === "string" &&
    typeof value.sourceDigest === "string" &&
    typeof value.prefixLength === "number" &&
    validThreadRangeFields(value) &&
    typeof value.summary === "string" &&
    typeof value.createdAt === "number" &&
    isGovernance(value.governance)
  );
}

function validThreadRangeFields(value: JsonObject): boolean {
  const fields = [
    value.threadSource,
    value.threadRevision,
    value.threadRange,
    value.threadOffset,
  ];
  if (fields.every((field) => field === undefined)) {
    return value.threadStart === undefined && value.threadEnd === undefined;
  }
  return (
    typeof value.threadSource === "string" &&
    typeof value.threadRevision === "string" &&
    typeof value.threadRange === "string" &&
    typeof value.threadOffset === "number" &&
    Number.isSafeInteger(value.threadOffset) &&
    value.threadOffset >= 0 &&
    (value.threadStart === undefined ||
      typeof value.threadStart === "string") &&
    (value.threadEnd === undefined || typeof value.threadEnd === "string")
  );
}

function isGovernance(
  value: JsonObject[string],
): value is HistoryArtifactRecord["governance"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const policy = value as {
    readonly sensitivity?: unknown;
    readonly tenancy?: unknown;
    readonly residency?: unknown;
    readonly ownership?: unknown;
    readonly retentionMs?: unknown;
  };
  return (
    policy.sensitivity === "restricted" &&
    policy.tenancy === "storage-scope" &&
    policy.residency === "storage-provider" &&
    policy.ownership === "storage-scope" &&
    typeof policy.retentionMs === "number"
  );
}
