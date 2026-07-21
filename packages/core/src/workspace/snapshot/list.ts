/** Snapshot listing orchestration. */

import type { WorkspaceSnapshotConfig } from "./config";
import { resolveSnapshotNamespace } from "./config";
import { decodeSnapshotCursor, encodeSnapshotCursor } from "./cursor";
import { snapshotBackendError } from "./errors";
import { normalizePath } from "../path";
import { snapshotHeaderToRef } from "./records";
import { listSnapshotHeaders } from "./store";
import type {
  WorkspaceSnapshotListOptions,
  WorkspaceSnapshotPage,
} from "./types";

/** List committed snapshots in newest-first order. */
export async function listWorkspaceSnapshots(
  config: WorkspaceSnapshotConfig,
  options?: WorkspaceSnapshotListOptions,
): Promise<WorkspaceSnapshotPage> {
  const limit = validateListLimit(options?.limit);
  const path = options?.path === undefined ? null : normalizePath(options.path);
  const namespace = await resolveSnapshotNamespace(config, options?.namespace);
  try {
    const cursor =
      options?.cursor === undefined
        ? undefined
        : decodeSnapshotCursor(options.cursor, {
            workspaceId: config.workspaceId,
            namespace,
            path,
          });
    const ordered = (
      await listSnapshotHeaders(config.store, config.workspaceId, namespace)
    )
      .filter(
        (header) =>
          header.state === "committed" &&
          (path === null || header.path === path) &&
          (cursor === undefined || isAfterCursor(header, cursor)),
      )
      .sort(
        (left, right) =>
          right.createdAt - left.createdAt || compareText(right.id, left.id),
      );
    const selected = ordered.slice(0, limit);
    const snapshots = Object.freeze(selected.map(snapshotHeaderToRef));
    const last = selected.at(-1);
    const nextCursor =
      ordered.length > limit && last
        ? encodeSnapshotCursor({
            version: 1,
            workspaceId: config.workspaceId,
            namespace,
            path,
            createdAt: last.createdAt,
            id: last.id,
          })
        : undefined;
    return Object.freeze({
      snapshots,
      ...(nextCursor !== undefined ? { cursor: nextCursor } : {}),
    });
  } catch (error) {
    throw snapshotBackendError("list", error);
  }
}

function validateListLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError(
      "snapshot.list(): limit must be an integer from 1 to 100.",
    );
  }
  return limit;
}

function isAfterCursor(
  header: { readonly createdAt: number; readonly id: string },
  cursor: { readonly createdAt: number; readonly id: string },
): boolean {
  return (
    header.createdAt < cursor.createdAt ||
    (header.createdAt === cursor.createdAt && header.id < cursor.id)
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
