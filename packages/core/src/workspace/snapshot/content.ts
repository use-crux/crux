/** Materialize live Workspace file content into snapshot-owned entries. */

import type { AssetRef, AssetStore, JsonObject } from "../../storage";
import type { WorkspaceProvenance } from "../artifact-types";
import type { WorkspaceFileRecord, WorkspacePath } from "../types";
import { canonicalizeJson, hashCanonical } from "./fingerprint";
import { materializeSnapshotPayload } from "./payload";
import {
  WORKSPACE_SNAPSHOT_SCHEMA,
  type WorkspaceSnapshotDescriptor,
  type WorkspaceSnapshotEntry,
  type WorkspaceSnapshotMaterializedState,
  type WorkspaceSnapshotPublishedState,
  type WorkspaceSnapshotProvenance,
} from "./records";

/** Result of copying one live record into snapshot-owned storage. */
export interface MaterializedSnapshotEntry {
  readonly entry: WorkspaceSnapshotEntry;
  readonly ownedAssets: readonly AssetRef[];
}

/** Inputs needed to materialize one HEAD and optional published projection. */
export interface MaterializeSnapshotEntryInput {
  readonly record: WorkspaceFileRecord;
  readonly published?: WorkspaceFileRecord;
  readonly snapshotId: string;
  readonly assets?: AssetStore;
}

/** Materialize one file record without retaining live ownership. */
export async function materializeSnapshotEntry(
  input: MaterializeSnapshotEntryInput,
): Promise<MaterializedSnapshotEntry> {
  const ownedAssets: AssetRef[] = [];
  try {
    const head = await materializeState(input, input.record, "head");
    ownedAssets.push(...head.ownedAssets);
    const published = await materializePublishedState(
      input,
      head.state,
      ownedAssets,
    );
    return {
      entry: {
        _cruxWorkspaceSnapshotEntry: true,
        schema: WORKSPACE_SNAPSHOT_SCHEMA,
        snapshotId: input.snapshotId,
        path: input.record.path as WorkspacePath,
        head: head.state,
        ...(published !== undefined ? { published } : {}),
        entryFingerprint: snapshotEntryFingerprint(
          input.record.path,
          head.state,
          published,
        ),
      },
      ownedAssets,
    } satisfies MaterializedSnapshotEntry;
  } catch (error) {
    for (const asset of ownedAssets.reverse()) {
      await input.assets?.delete(asset).catch(() => undefined);
    }
    throw error;
  }
}

async function materializePublishedState(
  input: MaterializeSnapshotEntryInput,
  head: WorkspaceSnapshotMaterializedState,
  ownedAssets: AssetRef[],
): Promise<WorkspaceSnapshotPublishedState | undefined> {
  if (!input.published) return undefined;
  if (input.published === input.record) {
    return { kind: "shared" };
  }
  const published = await materializeState(input, input.published, "published");
  ownedAssets.push(...published.ownedAssets);
  if (
    materializedStateFingerprint(head) ===
    materializedStateFingerprint(published.state)
  ) {
    for (const asset of published.ownedAssets) {
      await input.assets?.delete(asset);
    }
    ownedAssets.splice(
      ownedAssets.length - published.ownedAssets.length,
      published.ownedAssets.length,
    );
    return { kind: "shared" };
  }
  return { kind: "distinct", state: published.state };
}

async function materializeState(
  input: Pick<MaterializeSnapshotEntryInput, "assets" | "snapshotId">,
  record: WorkspaceFileRecord,
  role: "head" | "published",
): Promise<{
  readonly state: WorkspaceSnapshotMaterializedState;
  readonly ownedAssets: readonly AssetRef[];
}> {
  const materialized = await materializeSnapshotPayload({
    record,
    snapshotId: input.snapshotId,
    role,
    ...(input.assets !== undefined ? { assets: input.assets } : {}),
  });
  return {
    state: {
      descriptor: snapshotDescriptor(record),
      payload: materialized.payload,
    },
    ownedAssets: materialized.ownedAssets,
  };
}

/** Recompute one entry's canonical logical fingerprint. */
export function snapshotEntryFingerprint(
  path: string,
  head: WorkspaceSnapshotMaterializedState,
  published: WorkspaceSnapshotPublishedState | undefined,
): string {
  return hashCanonical({
    format: "workspace-snapshot-entry:v1",
    path,
    head: logicalState(head),
    ...(published !== undefined
      ? {
          published:
            published.kind === "shared"
              ? { kind: "shared" }
              : { kind: "distinct", state: logicalState(published.state) },
        }
      : {}),
  });
}

/** Recompute one materialized state's canonical logical fingerprint. */
export function materializedStateFingerprint(
  state: WorkspaceSnapshotMaterializedState,
): string {
  return hashCanonical(logicalState(state));
}

function logicalState(state: WorkspaceSnapshotMaterializedState): JsonObject {
  return {
    descriptor: logicalDescriptor(state.descriptor),
    payload: {
      kind: state.payload.kind,
      contentHash: state.payload.contentHash,
    },
  };
}

function logicalDescriptor(
  descriptor: WorkspaceSnapshotDescriptor,
): JsonObject {
  return {
    mimeType: descriptor.mimeType,
    ...(descriptor.metadata !== undefined
      ? { metadata: descriptor.metadata }
      : {}),
    ...(descriptor.status !== undefined ? { status: descriptor.status } : {}),
    ...(descriptor.kind !== undefined ? { kind: descriptor.kind } : {}),
    ...(descriptor.producedBy !== undefined
      ? { producedBy: descriptor.producedBy }
      : {}),
  };
}

/** Project a live file's user-observable descriptor into snapshot form. */
export function snapshotDescriptor(
  record: WorkspaceFileRecord,
): WorkspaceSnapshotDescriptor {
  return {
    mimeType: record.mimeType,
    ...(record.metadata !== undefined
      ? { metadata: canonicalObject(record.metadata) }
      : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(record.kind !== undefined ? { kind: record.kind } : {}),
    ...(record.producedBy !== undefined
      ? { producedBy: snapshotProvenance(record.producedBy) }
      : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function snapshotProvenance(
  value: WorkspaceProvenance,
): WorkspaceSnapshotProvenance {
  return {
    ...(value.runId !== undefined ? { runId: value.runId } : {}),
    ...(value.spanId !== undefined ? { spanId: value.spanId } : {}),
    ...(value.sources !== undefined ? { sources: [...value.sources] } : {}),
  };
}

function canonicalObject(value: JsonObject): JsonObject {
  return canonicalizeJson(value);
}
