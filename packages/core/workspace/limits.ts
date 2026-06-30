/**
 * Operator controls for workspace writes.
 *
 * Retention is a best-effort store capability, while size limits are enforced
 * before file records are persisted. Namespace quotas intentionally use a
 * simple namespace scan in V0 so adapters do not need transactional counters.
 *
 * @module
 */

import type { RecordStore, RecordWriteOptions } from "../storage";
import { listFileRecords } from "./store";
import type { WorkspaceFileRecord } from "./types";

/** Write-time byte limits for a workspace. */
export interface WorkspaceLimits {
  /** Reject a single file whose analyzed payload size is above this value. */
  readonly maxFileBytes?: number;
  /** Reject a write that would push the namespace total above this value. */
  readonly maxNamespaceBytes?: number;
}

/** Retention policy for workspace metadata records. */
export interface WorkspaceRetention {
  /**
   * Time-to-live in milliseconds for workspace metadata records.
   *
   * The value is passed to `RecordStore.put({ ttlMs })` only when the configured
   * store reports TTL support. Stores without TTL support keep the record
   * indefinitely and do not throw.
   */
  readonly ttlMs?: number;
}

const namespaceLocks = new Map<string, Promise<void>>();

/** Return store write options for the configured retention policy. */
export function workspaceSetOptions(
  store: RecordStore,
  retention: WorkspaceRetention | undefined,
): RecordWriteOptions | undefined {
  const ttl = retention?.ttlMs;
  if (ttl === undefined || ttl <= 0 || store.capabilities().ttl === false)
    return undefined;
  return { ttlMs: ttl };
}

/** Serialize quota validation and persistence per workspace namespace. */
export async function withWorkspaceWriteLock<T>(
  workspaceId: string,
  namespace: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = `${workspaceId}\0${namespace}`;
  const previous = namespaceLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => pending);
  namespaceLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (namespaceLocks.get(key) === current) {
      namespaceLocks.delete(key);
    }
  }
}

/** Enforce configured byte limits before a workspace record is persisted. */
export async function assertWorkspaceWriteAllowed(input: {
  readonly store: RecordStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string;
  readonly nextSize: number;
  readonly existing: WorkspaceFileRecord | null;
  readonly releasedBytes?: number;
  readonly limits: WorkspaceLimits | undefined;
}): Promise<void> {
  const { limits } = input;
  if (!limits) return;

  if (
    limits.maxFileBytes !== undefined &&
    input.nextSize > limits.maxFileBytes
  ) {
    throw new Error(
      `workspace.write(): file "${input.path}" is ${input.nextSize} bytes, which exceeds limits.maxFileBytes (${limits.maxFileBytes}).`,
    );
  }

  if (limits.maxNamespaceBytes === undefined) return;

  const records = await listFileRecords(
    input.store,
    input.workspaceId,
    input.namespace,
  );
  const currentTotal = records.reduce(
    (total, record) => total + record.size,
    0,
  );
  const existingSize = input.existing?.size ?? 0;
  const nextTotal =
    currentTotal - existingSize - (input.releasedBytes ?? 0) + input.nextSize;

  if (nextTotal > limits.maxNamespaceBytes) {
    throw new Error(
      `workspace.write(): namespace "${input.namespace}" would use ${nextTotal} bytes, which exceeds limits.maxNamespaceBytes (${limits.maxNamespaceBytes}).`,
    );
  }
}
