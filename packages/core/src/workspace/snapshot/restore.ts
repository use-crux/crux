/** Exact-tree Workspace snapshot restore orchestration. */

import { applyWorkspaceMutationBatch } from "../mutation-batch";
import { normalizePath } from "../path";
import { listFileRecords } from "../store";
import { instrument } from "../observability";
import { liveSnapshotEntryFingerprint } from "./live-content";
import type { WorkspaceSnapshotConfig } from "./config";
import { snapshotBackendError } from "./errors";
import { validateSnapshotRef } from "./ref";
import { loadCommittedSnapshot } from "./restore-load";
import {
  assertSnapshotSelectionSupported,
  selectSnapshotRecords,
} from "./selection";
import {
  type WorkspaceSnapshotRef,
  type WorkspaceSnapshotRestoreResult,
} from "./types";

/** Restore one committed snapshot as an exact replacement of its captured tree. */
export async function restoreWorkspaceSnapshot(
  config: WorkspaceSnapshotConfig,
  snapshot: WorkspaceSnapshotRef,
): Promise<WorkspaceSnapshotRestoreResult> {
  const ref = validateSnapshotRef(snapshot, config.workspaceId);
  const path = normalizePath(ref.path);
  return instrument(
    {
      workspaceId: config.workspaceId,
      operation: "snapshot.restore",
      namespace: ref.namespace,
      path,
    },
    async () => {
      try {
        assertSnapshotSelectionSupported(path, config.mounts, ref.id);
        let result: WorkspaceSnapshotRestoreResult | undefined;
        await applyWorkspaceMutationBatch(config, ref.namespace, async () => {
          assertSnapshotSelectionSupported(path, config.mounts, ref.id);
          const hydrated = await loadCommittedSnapshot(config, ref);
          const live = selectSnapshotRecords(
            await listFileRecords(
              config.store,
              config.workspaceId,
              ref.namespace,
            ),
            path,
          );
          const capturedPaths = new Set<string>(
            hydrated.map(({ entry }) => entry.path),
          );
          const deleted = live.filter(
            (record) => !capturedPaths.has(record.path),
          );
          const liveByPath = new Map(
            live.map((record) => [record.path, record]),
          );
          const unchanged: string[] = [];
          const restored = [];
          for (const captured of hydrated) {
            const current = liveByPath.get(captured.entry.path);
            if (
              current &&
              (await liveSnapshotEntryFingerprint({
                record: current,
                store: config.store,
                ...(config.assets !== undefined
                  ? { assets: config.assets }
                  : {}),
                workspaceId: config.workspaceId,
                namespace: ref.namespace,
              })) === captured.entry.entryFingerprint
            ) {
              unchanged.push(captured.entry.path);
            } else {
              restored.push(captured);
            }
          }
          result = {
            restoredFiles: restored.length,
            deletedFiles: deleted.length,
            unchangedFiles: unchanged.length,
          };
          return [
            ...restored.map(({ entry, head, published }) => ({
              kind: "put" as const,
              path: entry.path,
              head,
              ...(published !== undefined ? { published } : {}),
              operation: "restore" as const,
            })),
            ...deleted.map((record) => ({
              kind: "delete" as const,
              path: normalizePath(record.path),
            })),
          ];
        });
        if (!result) {
          throw new Error("Snapshot restore did not produce a result.");
        }
        return result;
      } catch (error) {
        throw snapshotBackendError("restore", error, ref.id);
      }
    },
  );
}
