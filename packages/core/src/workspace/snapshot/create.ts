/** Materialized snapshot capture orchestration. */

import { withWorkspaceMutationLock } from "../mutation-coordinator";
import type { AssetRef } from "../../storage";
import { normalizePath } from "../path";
import { listFileRecords } from "../store";
import { resolvePublishedArtifactRecord } from "../artifacts";
import { instrument } from "../observability";
import type { WorkspaceSnapshotConfig } from "./config";
import { resolveSnapshotNamespace } from "./config";
import { snapshotBackendError } from "./errors";
import { materializeSnapshotEntry } from "./content";
import { createSnapshotId } from "./id";
import {
  snapshotHeaderToRef,
  type WorkspaceSnapshotEntry,
  snapshotEntrySizeBytes,
} from "./records";
import {
  assertSnapshotSelectionSupported,
  selectSnapshotRecords,
} from "./selection";
import {
  cleanupSnapshotHeader,
  commitSnapshotHeader,
  createSnapshotHeader,
  putSnapshotEntry,
} from "./store";
import { deleteSnapshotEntries } from "./store-delete";
import type { WorkspaceSnapshotOptions, WorkspaceSnapshotRef } from "./types";

/** Create one committed materialized snapshot. */
export async function createWorkspaceSnapshot(
  config: WorkspaceSnapshotConfig,
  options: WorkspaceSnapshotOptions,
): Promise<WorkspaceSnapshotRef> {
  const namespace = await resolveSnapshotNamespace(config, options.namespace);
  return instrument(
    {
      workspaceId: config.workspaceId,
      operation: "snapshot.create",
      namespace,
      path: options.path,
    },
    async () => {
      const path = normalizePath(options.path);
      assertSnapshotSelectionSupported(path, config.mounts);
      return withWorkspaceMutationLock(
        config.workspaceId,
        namespace,
        async () => {
          assertSnapshotSelectionSupported(path, config.mounts);
          const records = selectSnapshotRecords(
            await listFileRecords(
              config.store,
              config.workspaceId,
              namespace,
            ).catch((error: unknown) => {
              throw snapshotBackendError("create", error);
            }),
            path,
          );
          const snapshotId = createSnapshotId();
          const header = await createSnapshotHeader({
            store: config.store,
            id: snapshotId,
            workspaceId: config.workspaceId,
            namespace,
            path,
            createdAt: Date.now(),
          }).catch((error: unknown) => {
            throw snapshotBackendError("create", error, snapshotId);
          });
          const entries: WorkspaceSnapshotEntry[] = [];
          const ownedAssets: AssetRef[] = [];
          try {
            for (const record of records) {
              const published =
                record.status === "final"
                  ? await resolvePublishedArtifactRecord({
                      record,
                      store: config.store,
                      workspaceId: config.workspaceId,
                      namespace,
                    })
                  : undefined;
              const materialized = await materializeSnapshotEntry({
                record,
                ...(published !== undefined ? { published } : {}),
                snapshotId: header.id,
                ...(config.assets !== undefined
                  ? { assets: config.assets }
                  : {}),
              });
              entries.push(materialized.entry);
              ownedAssets.push(...materialized.ownedAssets);
              await putSnapshotEntry({
                store: config.store,
                workspaceId: config.workspaceId,
                namespace,
                entry: materialized.entry,
              });
            }
            const committed = await commitSnapshotHeader({
              store: config.store,
              header,
              fileCount: entries.length,
              sizeBytes: entries.reduce(
                (total, entry) => total + snapshotEntrySizeBytes(entry),
                0,
              ),
              entries: entries.map((entry) => ({
                path: entry.path,
                fingerprint: entry.entryFingerprint,
              })),
            });
            return snapshotHeaderToRef(committed);
          } catch (error) {
            await deleteSnapshotEntries(config.store, header).catch(
              () => undefined,
            );
            for (const asset of ownedAssets.reverse()) {
              await config.assets?.delete(asset).catch(() => undefined);
            }
            await cleanupSnapshotHeader(config.store, header).catch(
              () => undefined,
            );
            throw snapshotBackendError("create", error, header.id);
          }
        },
      );
    },
  );
}
