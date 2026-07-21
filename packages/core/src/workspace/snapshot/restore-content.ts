/** Snapshot entry validation and hydration for exact-tree restore. */

import type {
  AssetStore,
  JsonObject as StorageJsonObject,
  JsonValue as StorageJsonValue,
} from "../../storage";
import type { JsonValue as WorkspaceJsonValue } from "../../types/tool";
import { dataAssetBytes } from "../asset-content";
import type { MaterializedWorkspaceState } from "../mutation-batch";
import { byteLength } from "../text-utils";
import type { WorkspaceContent } from "../types";
import { snapshotEntryAssetOwnershipIsValid } from "./asset-ownership";
import { snapshotEntryFingerprint } from "./content";
import {
  canonicalizeJson,
  hashBytes,
  hashCanonical,
  hashText,
} from "./fingerprint";
import { isSnapshotJsonValue } from "./record-validation";
import type {
  WorkspaceSnapshotEntry,
  WorkspaceSnapshotMaterializedState,
} from "./records";
import { WorkspaceSnapshotError } from "./types";

/** Trusted restore state projected from one fully validated snapshot entry. */
export interface HydratedSnapshotEntry {
  readonly entry: WorkspaceSnapshotEntry;
  readonly head: MaterializedWorkspaceState;
  readonly published?: MaterializedWorkspaceState;
}

/** Validate logical payload fields and hydrate one snapshot entry for restore. */
export async function hydrateSnapshotEntry(
  entry: WorkspaceSnapshotEntry,
  assets: AssetStore | undefined,
): Promise<HydratedSnapshotEntry> {
  validateSnapshotEntryMetadata(entry);
  const head = await hydrateState(entry.head, entry.snapshotId, assets);
  const trustedState = { ...entry.head, payload: head.payload };
  const distinctPublished =
    entry.published?.kind === "distinct"
      ? await hydrateState(entry.published.state, entry.snapshotId, assets)
      : undefined;
  const trustedPublished =
    entry.published?.kind === "shared"
      ? entry.published
      : entry.published?.kind === "distinct" && distinctPublished
        ? {
            kind: "distinct" as const,
            state: {
              ...entry.published.state,
              payload: distinctPublished.payload,
            },
          }
        : undefined;
  const fingerprint = snapshotEntryFingerprint(
    entry.path,
    trustedState,
    trustedPublished,
  );
  if (fingerprint !== entry.entryFingerprint) {
    throw corruptSnapshot(
      entry.snapshotId,
      "Snapshot entry fingerprint is invalid.",
    );
  }
  return {
    entry: {
      ...entry,
      head: trustedState,
      ...(trustedPublished !== undefined
        ? { published: trustedPublished }
        : {}),
    },
    head: materializedWorkspaceState(trustedState, head.content),
    ...(trustedPublished?.kind === "distinct" && distinctPublished
      ? {
          published: materializedWorkspaceState(
            trustedPublished.state,
            distinctPublished.content,
          ),
        }
      : {}),
  };
}

/** Validate entry integrity that does not require reading owned asset bytes. */
export function validateSnapshotEntryMetadata(
  entry: WorkspaceSnapshotEntry,
): void {
  if (
    (entry.head.descriptor.status === "final") !==
    (entry.published !== undefined)
  ) {
    throw corruptSnapshot(
      entry.snapshotId,
      "Snapshot publication state is invalid.",
    );
  }
  if (!snapshotEntryAssetOwnershipIsValid(entry)) {
    throw corruptSnapshot(
      entry.snapshotId,
      "Snapshot asset ownership is invalid.",
    );
  }
  const fingerprint = snapshotEntryFingerprint(
    entry.path,
    entry.head,
    entry.published,
  );
  if (fingerprint !== entry.entryFingerprint) {
    throw corruptSnapshot(
      entry.snapshotId,
      "Snapshot entry fingerprint is invalid.",
    );
  }
  validateInlineState(entry.head, entry.snapshotId);
  if (entry.published?.kind === "distinct") {
    validateInlineState(entry.published.state, entry.snapshotId);
  }
}

async function hydrateState(
  state: WorkspaceSnapshotMaterializedState,
  snapshotId: string,
  assets: AssetStore | undefined,
): Promise<{
  readonly content: WorkspaceContent;
  readonly payload: WorkspaceSnapshotMaterializedState["payload"];
}> {
  const payload = state.payload;
  if (payload.storage === "asset") {
    if (!assets) {
      throw new Error("Snapshot restore requires its owning AssetStore.");
    }
    const stored = await assets.get({ uri: payload.assetUri });
    if (stored.type !== "data") {
      throw corruptSnapshot(snapshotId, "Snapshot asset payload is invalid.");
    }
    const bytes = await dataAssetBytes(stored);
    if (payload.sizeBytes !== bytes.byteLength) {
      throw corruptSnapshot(snapshotId, "Snapshot asset size is invalid.");
    }
    if (payload.kind === "json") {
      const parsed = parseSnapshotJson(bytes, snapshotId);
      if (!isStorageJsonValue(parsed)) {
        throw corruptSnapshot(snapshotId, "Snapshot JSON asset is invalid.");
      }
      const canonical = canonicalizeJson(parsed);
      if (payload.contentHash !== hashCanonical(canonical)) {
        throw corruptSnapshot(snapshotId, "Snapshot asset hash is invalid.");
      }
      return { content: bytes, payload };
    }
    if (payload.contentHash !== hashBytes(bytes)) {
      throw corruptSnapshot(snapshotId, "Snapshot asset hash is invalid.");
    }
    return { content: bytes, payload };
  }
  if (payload.kind === "text") {
    return { content: payload.content, payload };
  }
  if (
    payload.kind !== "json" ||
    typeof payload.content === "string" ||
    !isSnapshotJsonValue(payload.content)
  ) {
    throw corruptSnapshot(snapshotId, "Snapshot inline payload is invalid.");
  }
  const content = workspaceJson(canonicalizeJson(payload.content));
  return { content, payload: { ...payload, content } };
}

function validateInlineState(
  state: WorkspaceSnapshotMaterializedState,
  snapshotId: string,
): void {
  const payload = state.payload;
  if (payload.storage === "asset") return;
  if (payload.kind === "text") {
    if (
      payload.sizeBytes !== byteLength(payload.content) ||
      payload.contentHash !== hashText(payload.content)
    ) {
      throw corruptSnapshot(snapshotId, "Snapshot text payload is invalid.");
    }
    return;
  }
  if (
    payload.kind !== "json" ||
    typeof payload.content === "string" ||
    !isSnapshotJsonValue(payload.content)
  ) {
    throw corruptSnapshot(snapshotId, "Snapshot inline payload is invalid.");
  }
  const content = canonicalizeJson(payload.content);
  if (
    payload.sizeBytes !== byteLength(JSON.stringify(content)) ||
    payload.contentHash !== hashCanonical(content)
  ) {
    throw corruptSnapshot(snapshotId, "Snapshot JSON payload is invalid.");
  }
}

function parseSnapshotJson(bytes: Uint8Array, snapshotId: string): unknown {
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw corruptSnapshot(snapshotId, "Snapshot JSON asset is invalid.");
  }
}

function isStorageJsonValue(value: unknown): value is StorageJsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isStorageJsonValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every(
    (child) => child === undefined || isStorageJsonValue(child),
  );
}

function materializedWorkspaceState(
  state: WorkspaceSnapshotMaterializedState,
  content: WorkspaceContent,
): MaterializedWorkspaceState {
  const descriptor = state.descriptor;
  return {
    content,
    mimeType: descriptor.mimeType,
    createdAt: descriptor.createdAt,
    ...(descriptor.metadata !== undefined
      ? { metadata: workspaceJson(descriptor.metadata) }
      : {}),
    ...(descriptor.status !== undefined ? { status: descriptor.status } : {}),
    ...(descriptor.kind !== undefined ? { artifactKind: descriptor.kind } : {}),
    ...(descriptor.producedBy !== undefined
      ? {
          producedBy: {
            ...descriptor.producedBy,
            ...(descriptor.producedBy.sources !== undefined
              ? { sources: [...descriptor.producedBy.sources] }
              : {}),
          },
        }
      : {}),
  };
}

function workspaceJson(
  value: StorageJsonObject,
): Record<string, WorkspaceJsonValue>;
function workspaceJson(value: StorageJsonValue): WorkspaceJsonValue;
function workspaceJson(
  value: StorageJsonValue,
): WorkspaceJsonValue | Record<string, WorkspaceJsonValue> {
  if (value === null || typeof value !== "object") return value;
  if (isStorageJsonArray(value)) return value.map(workspaceJson);
  const result: Record<string, WorkspaceJsonValue> = {};
  for (const [key, child] of Object.entries(value)) {
    if (child !== undefined) result[key] = workspaceJson(child);
  }
  return result;
}

function isStorageJsonArray(
  value: StorageJsonValue,
): value is readonly StorageJsonValue[] {
  return Array.isArray(value);
}

function corruptSnapshot(
  snapshotId: string,
  message: string,
): WorkspaceSnapshotError {
  return new WorkspaceSnapshotError("corrupt_snapshot", message, {
    snapshotId,
  });
}
