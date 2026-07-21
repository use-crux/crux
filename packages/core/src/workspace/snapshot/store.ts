/**
 * RecordStore lifecycle helpers for Workspace snapshots.
 *
 * @module
 */

import type { RecordEntry, RecordStore } from "../../storage";
import { normalizePath } from "../path";
import type { WorkspacePath } from "../types";
import { snapshotManifestFingerprint } from "./fingerprint";
import { listAllSnapshotRecords } from "./store-list";
import {
  WORKSPACE_SNAPSHOT_SCHEMA,
  type WorkspaceSnapshotHeader,
  type WorkspaceSnapshotEntry,
} from "./records";
import {
  isWorkspaceSnapshotEntry,
  isWorkspaceSnapshotHeader,
} from "./record-validation";

function snapshotPrefix(workspaceId: string, namespace: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(namespace)}:snapshot:`;
}

function snapshotEntryPrefix(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): string {
  return `${snapshotPrefix(workspaceId, namespace)}${encodeURIComponent(snapshotId)}:entry:`;
}

/** Record key for one normalized file entry within a snapshot. */
export function snapshotEntryKey(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
  path: WorkspacePath,
): string {
  return `${snapshotEntryPrefix(workspaceId, namespace, snapshotId)}${encodeURIComponent(path)}`;
}

/** Record key for one snapshot lifecycle header. */
export function snapshotHeaderKey(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): string {
  return `${snapshotPrefix(workspaceId, namespace)}${encodeURIComponent(snapshotId)}:header`;
}

/** Write the initial invisible header for a snapshot being materialized. */
export async function createSnapshotHeader(input: {
  readonly store: RecordStore;
  readonly id: string;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly createdAt: number;
}): Promise<WorkspaceSnapshotHeader> {
  const header = {
    _cruxWorkspaceSnapshot: true,
    schema: WORKSPACE_SNAPSHOT_SCHEMA,
    state: "creating",
    id: input.id,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    fileCount: 0,
    sizeBytes: 0,
    createdAt: input.createdAt,
    manifestFingerprint: snapshotManifestFingerprint({
      id: input.id,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      path: input.path,
      createdAt: input.createdAt,
      entries: [],
    }),
  } satisfies WorkspaceSnapshotHeader;
  const created = await input.store.create(
    snapshotHeaderKey(input.workspaceId, input.namespace, input.id),
    header,
  );
  if (!created) {
    throw new Error("Snapshot id collision prevented header creation.");
  }
  return header;
}

/** Replace a creating header with its committed aggregate values. */
export async function commitSnapshotHeader(input: {
  readonly store: RecordStore;
  readonly header: WorkspaceSnapshotHeader;
  readonly fileCount: number;
  readonly sizeBytes: number;
  readonly entries: readonly {
    readonly path: string;
    readonly fingerprint: string;
  }[];
}): Promise<WorkspaceSnapshotHeader> {
  const header = {
    ...input.header,
    state: "committed",
    fileCount: input.fileCount,
    sizeBytes: input.sizeBytes,
    manifestFingerprint: snapshotManifestFingerprint({
      id: input.header.id,
      workspaceId: input.header.workspaceId,
      namespace: input.header.namespace,
      path: input.header.path,
      createdAt: input.header.createdAt,
      entries: input.entries,
    }),
  } satisfies WorkspaceSnapshotHeader;
  await input.store.put(
    snapshotHeaderKey(header.workspaceId, header.namespace, header.id),
    header,
  );
  return header;
}

/** Persist one materialized file entry. */
export async function putSnapshotEntry(input: {
  readonly store: RecordStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly entry: WorkspaceSnapshotEntry;
}): Promise<void> {
  await input.store.put(
    snapshotEntryKey(
      input.workspaceId,
      input.namespace,
      input.entry.snapshotId,
      input.entry.path,
    ),
    input.entry,
  );
}

/** Best-effort cleanup for a snapshot that did not commit. */
export async function cleanupSnapshotHeader(
  store: RecordStore,
  header: Pick<WorkspaceSnapshotHeader, "workspaceId" | "namespace" | "id">,
): Promise<void> {
  await store.delete(
    snapshotHeaderKey(header.workspaceId, header.namespace, header.id),
  );
}

/** Load a structurally valid snapshot header, preserving malformed values for callers. */
export async function getSnapshotHeader(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): Promise<WorkspaceSnapshotHeader | "malformed" | null> {
  const value = await store.get(
    snapshotHeaderKey(workspaceId, namespace, snapshotId),
  );
  if (value === null) return null;
  return isWorkspaceSnapshotHeader(value) ? value : "malformed";
}

/** One safely orderable committed header candidate for logical pagination. */
export type WorkspaceSnapshotHeaderCandidate =
  | {
      readonly kind: "valid";
      readonly id: string;
      readonly path: WorkspacePath;
      readonly createdAt: number;
      readonly header: WorkspaceSnapshotHeader;
    }
  | {
      readonly kind: "corrupt";
      readonly id: string;
      readonly path: WorkspacePath;
      readonly createdAt: number;
    };

/** List safely orderable committed header candidates in one namespace. */
export async function listSnapshotHeaderCandidates(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
): Promise<readonly WorkspaceSnapshotHeaderCandidate[]> {
  const prefix = snapshotPrefix(workspaceId, namespace);
  const records = await listAllSnapshotRecords(store, prefix);
  const candidates: WorkspaceSnapshotHeaderCandidate[] = [];
  for (const entry of records) {
    const header = entry.value;
    if (
      isWorkspaceSnapshotHeader(header) &&
      header.workspaceId === workspaceId &&
      header.namespace === namespace &&
      entry.key === snapshotHeaderKey(workspaceId, namespace, header.id)
    ) {
      if (header.state === "committed") {
        candidates.push({
          kind: "valid",
          id: header.id,
          path: header.path,
          createdAt: header.createdAt,
          header,
        });
      }
      continue;
    }
    const corrupt = corruptHeaderCandidate(
      entry.key,
      header,
      workspaceId,
      namespace,
    );
    if (corrupt) candidates.push(corrupt);
  }
  return candidates;
}

function corruptHeaderCandidate(
  key: string,
  value: Record<string, unknown>,
  workspaceId: string,
  namespace: string,
): Extract<
  WorkspaceSnapshotHeaderCandidate,
  { readonly kind: "corrupt" }
> | null {
  if (
    value._cruxWorkspaceSnapshot !== true ||
    value.state !== "committed" ||
    typeof value.id !== "string" ||
    !value.id.trim() ||
    typeof value.path !== "string" ||
    typeof value.createdAt !== "number" ||
    !Number.isFinite(value.createdAt) ||
    value.createdAt < 0 ||
    key !== snapshotHeaderKey(workspaceId, namespace, value.id)
  ) {
    return null;
  }
  try {
    const path = normalizePath(value.path);
    if (path !== value.path) return null;
    return { kind: "corrupt", id: value.id, path, createdAt: value.createdAt };
  } catch {
    return null;
  }
}

/** List every raw materialized entry record owned by one snapshot id. */
export function listSnapshotEntryRecords(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): Promise<readonly RecordEntry[]> {
  return listAllSnapshotRecords(
    store,
    snapshotEntryPrefix(workspaceId, namespace, snapshotId),
  );
}
