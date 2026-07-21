/** Canonical live-state projection for Workspace snapshot restore equality. */

import type { AssetStore, RecordStore } from "../../storage";
import { resolvePublishedArtifactRecord } from "../artifacts";
import type { WorkspaceFileRecord } from "../types";
import {
  materializedStateFingerprint,
  snapshotDescriptor,
  snapshotEntryFingerprint,
} from "./content";
import { inspectSnapshotPayload } from "./payload";
import type {
  WorkspaceSnapshotMaterializedState,
  WorkspaceSnapshotPublishedState,
} from "./records";

/** Compute one live file's storage-independent snapshot entry fingerprint. */
export async function liveSnapshotEntryFingerprint(input: {
  readonly record: WorkspaceFileRecord;
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly workspaceId: string;
  readonly namespace: string;
}): Promise<string> {
  const head = await liveSnapshotState(input.record, input.assets);
  const published = await livePublishedState(input, head);
  return snapshotEntryFingerprint(input.record.path, head, published);
}

async function livePublishedState(
  input: {
    readonly record: WorkspaceFileRecord;
    readonly store: RecordStore;
    readonly assets?: AssetStore;
    readonly workspaceId: string;
    readonly namespace: string;
  },
  head: WorkspaceSnapshotMaterializedState,
): Promise<WorkspaceSnapshotPublishedState | undefined> {
  if (input.record.status !== "final") return undefined;
  const publishedRecord = await resolvePublishedArtifactRecord(input);
  if (publishedRecord === input.record) return { kind: "shared" };
  const published = await liveSnapshotState(publishedRecord, input.assets);
  return materializedStateFingerprint(head) ===
    materializedStateFingerprint(published)
    ? { kind: "shared" }
    : { kind: "distinct", state: published };
}

async function liveSnapshotState(
  record: WorkspaceFileRecord,
  assets: AssetStore | undefined,
): Promise<WorkspaceSnapshotMaterializedState> {
  return {
    descriptor: snapshotDescriptor(record),
    payload: (await inspectSnapshotPayload(record, assets)).payload,
  };
}
