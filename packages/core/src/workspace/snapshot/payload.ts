/** Snapshot-owned payload materialization for inline and AssetStore files. */

import type {
  AssetRef,
  AssetStore,
  JsonObject,
  JsonValue,
} from "../../storage";
import { dataAssetBytes, workspaceDataAsset } from "../asset-content";
import type { WorkspaceFileRecord } from "../types";
import {
  canonicalizeJson,
  hashBytes,
  hashCanonical,
  hashText,
} from "./fingerprint";
import type { WorkspaceSnapshotPayload } from "./records";
import { snapshotAssetOwnershipFingerprint } from "./asset-ownership";

/** Payload plus any new AssetStore ownership created while materializing it. */
export interface MaterializedSnapshotPayload {
  readonly payload: WorkspaceSnapshotPayload;
  readonly ownedAssets: readonly AssetRef[];
}

/** A live payload projection plus bytes needed for independent asset ownership. */
export type InspectedSnapshotPayload =
  | {
      readonly payload: WorkspaceSnapshotPayload;
      readonly assetBytes?: undefined;
    }
  | {
      readonly payload: Extract<
        WorkspaceSnapshotPayload,
        { readonly storage: "asset" }
      >;
      readonly assetBytes: Uint8Array;
    };

/** Copy one live payload into snapshot-owned storage. */
export async function materializeSnapshotPayload(input: {
  readonly record: WorkspaceFileRecord;
  readonly snapshotId: string;
  readonly role: "head" | "published";
  readonly assets?: AssetStore;
}): Promise<MaterializedSnapshotPayload> {
  const inspected = await inspectSnapshotPayload(input.record, input.assets);
  if (inspected.assetBytes === undefined) {
    return { payload: inspected.payload, ownedAssets: [] };
  }
  if (!input.assets) {
    throw new Error("Snapshot capture requires the file's owning AssetStore.");
  }
  const stored = await input.assets.put(
    workspaceDataAsset({
      data: inspected.assetBytes,
      mediaType: input.record.mimeType,
      size: inspected.assetBytes.byteLength,
    }),
    { key: snapshotAssetKey(input) },
  );
  return {
    payload: {
      ...inspected.payload,
      assetUri: stored.ref.uri,
      ownershipFingerprint: snapshotAssetOwnershipFingerprint({
        snapshotId: input.snapshotId,
        path: input.record.path,
        role: input.role,
        assetUri: stored.ref.uri,
      }),
    },
    ownedAssets: [stored.ref],
  };
}

/** Inspect one live payload using the same logical rules as snapshot capture. */
export async function inspectSnapshotPayload(
  record: WorkspaceFileRecord,
  assets: AssetStore | undefined,
): Promise<InspectedSnapshotPayload> {
  if (record.storage === "inline") {
    return { payload: materializeInlinePayload(record) };
  }
  if (!assets || !record.assetRef) {
    throw new Error(
      "Snapshot payload inspection requires its owning AssetStore.",
    );
  }
  const live = await assets.get(record.assetRef);
  if (live.type !== "data") {
    throw new Error("Workspace snapshots require AssetStore data assets.");
  }
  const assetBytes = await dataAssetBytes(live);
  const kind = payloadKind(record.mimeType);
  return {
    payload: {
      kind,
      storage: "asset",
      assetUri: record.assetRef.uri,
      ownershipFingerprint: "live-state-not-persisted",
      sizeBytes: assetBytes.byteLength,
      contentHash: assetContentHash(assetBytes, kind),
    },
    assetBytes,
  };
}

function materializeInlinePayload(
  record: WorkspaceFileRecord,
): WorkspaceSnapshotPayload {
  if (record.inlineText !== undefined) {
    return {
      kind: "text",
      storage: "inline",
      content: record.inlineText,
      sizeBytes: record.size,
      contentHash: hashText(record.inlineText),
    };
  }
  if (record.inlineJson !== undefined) {
    const content = canonicalizeJson(record.inlineJson);
    return {
      kind: "json",
      storage: "inline",
      content,
      sizeBytes: record.size,
      contentHash: hashCanonical(content),
    };
  }
  throw new Error(
    "Inline Workspace record has no snapshot-compatible content.",
  );
}

function snapshotAssetKey(input: {
  readonly record: WorkspaceFileRecord;
  readonly snapshotId: string;
  readonly role: "head" | "published";
}): string {
  const { record } = input;
  return `${encodeURIComponent(record.workspaceId)}/${encodeURIComponent(record.namespace)}/snapshots/${encodeURIComponent(input.snapshotId)}/${encodeURIComponent(record.path)}/${input.role}`;
}

function payloadKind(mimeType: string): "text" | "json" | "binary" {
  if (mimeType === "application/json" || mimeType.endsWith("+json")) {
    return "json";
  }
  return mimeType.startsWith("text/") ? "text" : "binary";
}

function assetContentHash(
  bytes: Uint8Array,
  kind: "text" | "json" | "binary",
): string {
  if (kind !== "json") return hashBytes(bytes);
  const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!isJsonValue(value)) {
    throw new Error("Snapshot JSON asset contains an invalid JSON value.");
  }
  return hashCanonical(canonicalizeJson(value));
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value as JsonObject).every(
    (child) => child === undefined || isJsonValue(child),
  );
}
