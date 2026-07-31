/**
 * Atomic publication and validation of exact-recovery values.
 *
 * @module
 */

import { getHooks } from "../../runtime/runtime";
import type { JsonObject, RecordStore } from "../../storage/types";
import type { StoredAsset } from "../../asset/types";
import {
  createOffloadHandle,
  offloadPreview,
  serializeOffloadValue,
  type OffloadHandle,
  type SerializedOffloadValue,
} from "./handle";

const RETENTION_MS = 5 * 60_000;
const ownerIds = new WeakMap<RecordStore, string>();
let nextOwnerId = 1;

interface OffloadRecord extends JsonObject {
  readonly kind: "request.offload";
  readonly handle: string;
  readonly revision: 1;
  readonly encoding: "text" | "json" | "asset";
  readonly contentType: string;
  readonly serialized: string;
  readonly bytes: number;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly revoked: boolean;
}

/** Prepared exact-recovery projection ready for candidate selection. @internal */
export interface PreparedOffload {
  readonly handle: OffloadHandle;
  readonly text: string;
  readonly bytes: number;
  readonly publish: () => Promise<void>;
  readonly validate: () => Promise<void>;
}

/** Prepare inert publication work for the active storage scope. @internal */
export function prepareOffload(
  value: unknown,
): PreparedOffload | undefined {
  const hooks = getHooks();
  const records = hooks.records;
  if (!records) return undefined;
  const stored = isStoredAsset(value) ? value : undefined;
  if (stored && !hooks.assets) return undefined;
  const serialized = stored
    ? serializeStoredAsset(stored)
    : serializeOffloadValue(value);
  const handle = createOffloadHandle(ownerIdentity(records), serialized);
  return Object.freeze({
    handle,
    text: offloadPreview(handle, serialized),
    bytes: serialized.bytes,
    publish: () => publish(records, handle, serialized),
    validate: () => validate(records, handle),
  });
}

/** Resolve one handle in the active owner scope without existence leaks. @internal */
export async function readOffloadValue(handle: string): Promise<unknown> {
  const records = getHooks().records;
  if (!records) throw unavailable();
  const record = await readValidRecord(records, handle);
  if (!record) throw unavailable();
  if (record.encoding === "asset") {
    const assets = getHooks().assets;
    if (!assets) throw unavailable();
    try {
      return await assets.get({ uri: record.serialized });
    } catch {
      throw unavailable();
    }
  }
  return record.encoding === "text"
    ? record.serialized
    : JSON.parse(record.serialized) as unknown;
}

async function publish(
  records: RecordStore,
  handle: OffloadHandle,
  value: SerializedOffloadValue,
): Promise<void> {
  const existing = await readValidRecord(records, handle.id);
  if (existing) return;
  const now = Date.now();
  const record: OffloadRecord = {
    kind: "request.offload",
    handle: handle.id,
    revision: handle.revision,
    encoding: value.encoding,
    contentType: value.contentType,
    serialized: value.serialized,
    bytes: value.bytes,
    createdAt: now,
    expiresAt: now + RETENTION_MS,
    revoked: false,
  };
  if (records.create) {
    const created = await records.create(recordKey(handle.id), record, {
      ttlMs: RETENTION_MS,
    });
    if (!created && !(await readValidRecord(records, handle.id))) {
      throw unavailable();
    }
    return;
  }
  await records.put(recordKey(handle.id), record, {
    ttlMs: RETENTION_MS,
  });
}

async function validate(
  records: RecordStore,
  handle: OffloadHandle,
): Promise<void> {
  const record = await readValidRecord(records, handle.id);
  if (!record || record.revision !== handle.revision) throw unavailable();
}

async function readValidRecord(
  records: RecordStore,
  handle: string,
): Promise<OffloadRecord | undefined> {
  const value = await records.get(recordKey(handle));
  if (!isOffloadRecord(value)) return undefined;
  if (
    value.handle !== handle ||
    value.revoked ||
    value.expiresAt <= Date.now()
  ) {
    return undefined;
  }
  return value;
}

function recordKey(handle: string): string {
  return `crux:request-offload:v1:${handle}`;
}

function ownerIdentity(records: RecordStore): string {
  let identity = ownerIds.get(records);
  if (!identity) {
    identity = `storage-scope-${nextOwnerId}`;
    nextOwnerId += 1;
    ownerIds.set(records, identity);
  }
  return identity;
}

function isOffloadRecord(
  value: JsonObject | null | undefined,
): value is OffloadRecord {
  return (
    value?.kind === "request.offload" &&
    typeof value.handle === "string" &&
    value.revision === 1 &&
    (value.encoding === "text" ||
      value.encoding === "json" ||
      value.encoding === "asset") &&
    typeof value.contentType === "string" &&
    typeof value.serialized === "string" &&
    typeof value.bytes === "number" &&
    typeof value.createdAt === "number" &&
    typeof value.expiresAt === "number" &&
    typeof value.revoked === "boolean"
  );
}

function serializeStoredAsset(
  value: StoredAsset,
): SerializedOffloadValue {
  const mediaType = value.mediaType ?? "application/octet-stream";
  const bytes =
    value.size ??
    (value.type === "data" && value.data instanceof Uint8Array
      ? value.data.byteLength
      : value.type === "data" && typeof Blob !== "undefined" &&
          value.data instanceof Blob
        ? value.data.size
        : 0);
  return Object.freeze({
    encoding: "asset",
    contentType: mediaType,
    serialized: value.ref.uri,
    bytes,
    preview: `${value.filename ?? value.type} (${bytes} bytes)`,
  });
}

function isStoredAsset(value: unknown): value is StoredAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as {
    readonly type?: unknown;
    readonly ref?: { readonly uri?: unknown };
  };
  return (
    (asset.type === "data" ||
      asset.type === "url" ||
      asset.type === "provider-file") &&
    typeof asset.ref?.uri === "string"
  );
}

function unavailable(): TypeError {
  return new TypeError("Exact-recovery reference is unavailable.");
}
