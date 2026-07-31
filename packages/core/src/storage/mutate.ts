/**
 * Portable atomic record mutation.
 *
 * Adapters can provide a native transaction or a small versioned compare-and-
 * set seam while callers use one capability-checked API.
 *
 * @module
 */

import { StorageError } from "./errors";
import type { JsonObject, RecordMutation, RecordStore } from "./types";

/** Retry controls for {@link mutateRecord}. */
export interface MutateRecordOptions {
  /** Maximum compare-and-set attempts before reporting a conflict. */
  readonly maxAttempts?: number;
  /** Maximum randomized delay between compare-and-set attempts. */
  readonly retryDelayMs?: number;
}

/**
 * Atomically derive and publish one record from its current value.
 *
 * @param store - Record store with native mutation or versioned CAS support.
 * @param key - Record key to mutate.
 * @param fn - Pure mutation callback. CAS retries may invoke it more than once.
 * @param options - Optional bounded retry controls.
 * @returns The published value, preserved current value, or `null` after delete.
 *
 * @example
 * ```ts
 * await mutateRecord(records, "counter", (current) => ({
 *   type: "put",
 *   value: { count: (current?.count ?? 0) + 1 },
 * }));
 * ```
 */
export async function mutateRecord<T extends JsonObject>(
  store: RecordStore<T>,
  key: string,
  fn: (
    current: T | null,
  ) => RecordMutation<T> | Promise<RecordMutation<T>>,
  options: MutateRecordOptions = {},
): Promise<T | null> {
  const capability = store.capabilities().mutate;
  if (capability === "native" && store.mutate) {
    return store.mutate(key, fn);
  }
  if (
    capability === "cas" &&
    store.getVersioned &&
    store.putVersioned
  ) {
    return mutateWithCas(
      store.getVersioned.bind(store),
      store.putVersioned.bind(store),
      key,
      fn,
      options,
    );
  }
  throw new StorageError(
    "unsupported_capability",
    "This RecordStore cannot mutate records atomically. Use an adapter with native mutate() or versioned getVersioned()/putVersioned() support.",
  );
}

async function mutateWithCas<T extends JsonObject>(
  getVersioned: NonNullable<RecordStore<T>["getVersioned"]>,
  putVersioned: NonNullable<RecordStore<T>["putVersioned"]>,
  key: string,
  fn: (
    current: T | null,
  ) => RecordMutation<T> | Promise<RecordMutation<T>>,
  options: MutateRecordOptions,
): Promise<T | null> {
  const maxAttempts = normalizeMaxAttempts(options.maxAttempts);
  const retryDelayMs = normalizeRetryDelay(options.retryDelayMs);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const current = await getVersioned(key);
    const mutation = await fn(current.value);
    if (mutation.type === "none") return current.value;
    const value = mutation.type === "put" ? mutation.value : null;
    if (await putVersioned(key, value, current.version)) return value;
    if (attempt + 1 < maxAttempts && retryDelayMs > 0) {
      await delay(Math.random() * retryDelayMs);
    }
  }
  throw new StorageError(
    "conflict",
    `Atomic record mutation did not commit after ${maxAttempts} attempts.`,
  );
}

function normalizeMaxAttempts(value: number | undefined): number {
  if (value === undefined) return 8;
  if (!Number.isInteger(value) || value < 1) {
    throw new StorageError(
      "invalid_value",
      "Mutation maxAttempts must be a positive integer.",
    );
  }
  return value;
}

function normalizeRetryDelay(value: number | undefined): number {
  if (value === undefined) return 10;
  if (!Number.isFinite(value) || value < 0) {
    throw new StorageError(
      "invalid_value",
      "Mutation retryDelayMs must be a non-negative number.",
    );
  }
  return value;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
