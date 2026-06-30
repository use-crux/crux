/**
 * Version-aware read operations: history, diff, undo, and read-at-version.
 *
 * Keeps the temporal surface out of the {@link workspace} factory while sharing
 * its path validation, namespace override, and instrumentation. Read-at-version
 * and history fall back to the live HEAD record for files that have no stored
 * snapshots (those created by `copy`/`rename`, or before versioning existed).
 *
 * @module
 */

import type { DataStore } from "../store/types";
import { computeWorkspaceDiff } from "./diff";
import { instrument } from "./observability";
import { mountForPath, normalizePath } from "./path";
import { recordToReadResult } from "./read-result";
import { snapshotContent, snapshotText } from "./version-content";
import { getRecord } from "./store";
import {
  getVersionRecord,
  headToVersion,
  listVersionRecords,
  recordToVersion,
} from "./version-store";
import type {
  NormalizedMount,
  WorkspaceBlobStore,
  WorkspaceContent,
  WorkspaceFile,
  WorkspaceFileRecord,
  WorkspaceNamespaceOption,
  WorkspacePath,
  WorkspaceReadResult,
  WorkspaceWriteOptions,
} from "./types";
import type {
  WorkspaceDiff,
  WorkspaceDiffOptions,
  WorkspaceHistoryOptions,
  WorkspaceUndoOptions,
  WorkspaceVersion,
  WorkspaceVersionOperation,
} from "./version-types";

/** Bound dependencies for the version-aware operations. */
export interface WorkspaceVersionOpsConfig {
  readonly workspaceId: string;
  readonly store: DataStore;
  readonly blobs?: WorkspaceBlobStore;
  readonly mounts: readonly NormalizedMount[];
  readonly resolveNamespace: () => Promise<string>;
  /** The shared write path, used to append a restored version on `undo`. */
  readonly write: (
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options: WorkspaceWriteOptions,
    operation: WorkspaceVersionOperation,
  ) => Promise<WorkspaceFile>;
}

/** Version-aware operations mixed into a {@link Workspace}. */
export interface WorkspaceVersionOps {
  history(
    path: string,
    options?: WorkspaceHistoryOptions,
  ): Promise<readonly WorkspaceVersion[]>;
  diff(path: string, options?: WorkspaceDiffOptions): Promise<WorkspaceDiff>;
  undo(path: string, options?: WorkspaceUndoOptions): Promise<WorkspaceFile>;
  /**
   * Read a specific revision. Called inside {@link Workspace.read}'s span, so it
   * does not open its own.
   */
  readVersion(
    namespace: string,
    path: WorkspacePath,
    version: number,
    options: { readonly maxInlineBytes?: number; readonly offset?: number },
  ): Promise<WorkspaceReadResult>;
}

/** Create the version-aware operations for one workspace instance. */
export function createWorkspaceVersionOps(
  config: WorkspaceVersionOpsConfig,
): WorkspaceVersionOps {
  async function history(
    path: string,
    options?: WorkspaceHistoryOptions,
  ): Promise<readonly WorkspaceVersion[]> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "history", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        mountForPath(normalized, config.mounts, "read");
        const snapshots = await listVersionRecords(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
          options?.limit !== undefined ? { limit: options.limit } : {},
        );
        if (snapshots.length > 0) return snapshots.map(recordToVersion);
        const head = await getRecord(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
        );
        return head ? [headToVersion(head)] : [];
      },
    );
  }

  async function diff(
    path: string,
    options?: WorkspaceDiffOptions,
  ): Promise<WorkspaceDiff> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "diff", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        mountForPath(normalized, config.mounts, "read");
        const head = await requireHead(namespace, normalized, "diff");
        const current = head.headVersion ?? 1;
        const to = options?.to ?? current;
        const from = options?.from ?? to - 1;
        if (from < 1) {
          throw new Error(
            `workspace.diff(): "${path}" has no version ${from} to compare against.`,
          );
        }
        const before = await versionText(namespace, normalized, from, head);
        const after = await versionText(namespace, normalized, to, head);
        return computeWorkspaceDiff({ path: normalized, from, to, before, after });
      },
    );
  }

  async function undo(
    path: string,
    options?: WorkspaceUndoOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "undo", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        mountForPath(normalized, config.mounts, "write");
        const head = await requireHead(namespace, normalized, "undo");
        const current = head.headVersion ?? 1;
        if (current <= 1) {
          throw new Error(
            `workspace.undo(): "${path}" has no earlier version to restore.`,
          );
        }
        const previous = await getVersionRecord(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
          current - 1,
        );
        if (!previous) {
          throw new Error(
            `workspace.undo(): version ${current - 1} of "${path}" is no longer retained.`,
          );
        }
        const snapshot = previous.snapshot;
        const content = await snapshotContent(snapshot, config.blobs);
        return config.write(
          namespace,
          path,
          content,
          {
            mimeType: snapshot.mimeType,
            ...(snapshot.metadata ? { metadata: snapshot.metadata } : {}),
            ...(snapshot.status ? { status: snapshot.status } : {}),
            ...(snapshot.kind ? { kind: snapshot.kind } : {}),
          },
          "undo",
        );
      },
    );
  }

  async function readVersion(
    namespace: string,
    path: WorkspacePath,
    version: number,
    options: { readonly maxInlineBytes?: number; readonly offset?: number },
  ): Promise<WorkspaceReadResult> {
    const record = await resolveVersionRecord(namespace, path, version);
    return recordToReadResult(record, {
      blobs: config.blobs,
      ...(options.maxInlineBytes !== undefined
        ? { maxInlineBytes: options.maxInlineBytes }
        : {}),
      ...(options.offset !== undefined ? { offset: options.offset } : {}),
    });
  }

  /** Resolve the file record for a version, falling back to HEAD for the current one. */
  async function resolveVersionRecord(
    namespace: string,
    path: WorkspacePath,
    version: number,
  ): Promise<WorkspaceFileRecord> {
    const snapshot = await getVersionRecord(
      config.store,
      config.workspaceId,
      namespace,
      path,
      version,
    );
    if (snapshot) return snapshot.snapshot;
    const head = await getRecord(
      config.store,
      config.workspaceId,
      namespace,
      path,
    );
    if (head && (head.headVersion ?? 1) === version) return head;
    throw new Error(
      `workspace.read(): version ${version} of "${path}" was not found.`,
    );
  }

  async function versionText(
    namespace: string,
    path: WorkspacePath,
    version: number,
    head: WorkspaceFileRecord,
  ): Promise<string> {
    const record =
      (head.headVersion ?? 1) === version
        ? head
        : await resolveVersionRecord(namespace, path, version);
    return snapshotText(record, config.blobs);
  }

  async function requireHead(
    namespace: string,
    path: WorkspacePath,
    operation: "diff" | "undo",
  ): Promise<WorkspaceFileRecord> {
    const head = await getRecord(
      config.store,
      config.workspaceId,
      namespace,
      path,
    );
    if (!head) {
      throw new Error(`workspace.${operation}(): file not found: "${path}".`);
    }
    return head;
  }

  async function namespaceFor(
    options?: WorkspaceNamespaceOption,
  ): Promise<string> {
    if (options?.namespace !== undefined) {
      if (options.namespace.length === 0) {
        throw new Error("workspace(): namespace override must be non-empty.");
      }
      return options.namespace;
    }
    return config.resolveNamespace();
  }

  return { history, diff, undo, readVersion };
}
