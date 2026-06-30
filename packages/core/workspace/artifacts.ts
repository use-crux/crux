/**
 * Workspace artifact lifecycle operations.
 *
 * Artifacts are a typed view over ordinary workspace file records. This module
 * owns finalization and record-to-artifact projection so the main workspace
 * factory can stay focused on operation wiring.
 *
 * @module
 */

import type { ExactFilter, JsonObject, RecordStore } from "../storage";
import { instrument } from "./observability";
import { mountForPath, normalizePath } from "./path";
import { fileKey, getRequiredRecord, listFileRecords } from "./store";
import { getVersionRecord } from "./version-store";
import { workspaceSetOptions } from "./limits";
import { assertWorkspaceMountIsLocal } from "./virtual-source";
import type {
  WorkspaceArtifact,
  WorkspaceArtifactsQuery,
  WorkspaceFinalizeOptions,
} from "./artifact-types";
import type {
  NormalizedMount,
  WorkspacePath,
  WorkspaceRetention,
  WorkspaceFileRecord,
} from "./types";

/** Bound dependencies for artifact lifecycle operations. */
export interface WorkspaceArtifactOpsConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly mounts: readonly NormalizedMount[];
  readonly retention?: WorkspaceRetention;
  readonly resolveNamespace: () => Promise<string>;
}

/** Public artifact lifecycle operations mixed into a {@link Workspace}. */
export interface WorkspaceArtifactOps {
  /** Query files marked as artifacts by status, kind, or path. */
  artifacts(
    options?: WorkspaceArtifactsQuery,
  ): Promise<readonly WorkspaceArtifact[]>;
  /** Mark a file as a final artifact and return its app-facing projection. */
  finalize(
    path: string,
    options?: WorkspaceFinalizeOptions,
  ): Promise<WorkspaceArtifact>;
}

/** Create artifact lifecycle operations for one workspace instance. */
export function createWorkspaceArtifactOps(
  config: WorkspaceArtifactOpsConfig,
): WorkspaceArtifactOps {
  async function artifacts(
    options?: WorkspaceArtifactsQuery,
  ): Promise<readonly WorkspaceArtifact[]> {
    const namespace = await namespaceFor(options?.namespace);
    return instrument(
      {
        workspaceId: config.workspaceId,
        operation: "artifacts",
        namespace,
        path: options?.path ?? "/outputs",
      },
      async () => {
        const filter = artifactFilter(options);
        const records = await listFileRecords(
          config.store,
          config.workspaceId,
          namespace,
          { filter },
        );
        return Promise.all(
          records.filter(isArtifactRecord).map((record) =>
            resolveArtifact({
              record,
              store: config.store,
              workspaceId: config.workspaceId,
              namespace,
            }),
          ),
        );
      },
    );
  }

  async function finalize(
    path: string,
    options?: WorkspaceFinalizeOptions,
  ): Promise<WorkspaceArtifact> {
    const namespace = await namespaceFor(options?.namespace);
    return instrument(
      {
        workspaceId: config.workspaceId,
        operation: "finalize",
        namespace,
        path,
      },
      async () => {
        const normalized = normalizePath(path);
        const mount = mountForPath(normalized, config.mounts, "write");
        assertWorkspaceMountIsLocal(mount, "finalize");
        const current = await getRequiredRecord(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
        );
        const kind = options?.kind ?? current.kind;
        const finalized: WorkspaceFileRecord = {
          ...current,
          status: "final",
          ...(kind !== undefined ? { kind } : {}),
          // Pin the current revision as the published version.
          finalVersion: current.headVersion ?? 1,
          updatedAt: Date.now(),
        };
        await config.store.put(
          fileKey(config.workspaceId, namespace, normalized),
          finalized as unknown as JsonObject,
          workspaceSetOptions(config.store, config.retention),
        );
        return resolveArtifact({
          record: finalized,
          store: config.store,
          workspaceId: config.workspaceId,
          namespace,
        });
      },
    );
  }

  return { artifacts, finalize };

  async function namespaceFor(namespace: string | undefined): Promise<string> {
    if (namespace !== undefined) {
      if (namespace.length === 0)
        throw new Error("workspace(): namespace override must be non-empty.");
      return namespace;
    }
    return config.resolveNamespace();
  }
}

/**
 * Project a record into a {@link WorkspaceArtifact}, resolving the pinned
 * published version when the working copy has advanced past it.
 *
 * `finalize()` pins `finalVersion`; while a file stays `final` and is edited
 * further, its HEAD moves to newer versions but the published artifact must keep
 * surfacing the pinned revision. When the pin still equals HEAD (just finalized,
 * or no later edits) the HEAD record is used directly. If the pinned snapshot is
 * unavailable, this falls back to HEAD rather than failing.
 */
export async function resolveArtifact(input: {
  readonly record: WorkspaceFileRecord;
  readonly store: RecordStore;
  readonly workspaceId: string;
  readonly namespace: string;
}): Promise<WorkspaceArtifact> {
  const { record, store, workspaceId, namespace } = input;
  const scope = { workspaceId, namespace };
  const headVersion = record.headVersion ?? 1;
  if (
    record.status === "final" &&
    record.finalVersion !== undefined &&
    record.finalVersion !== headVersion
  ) {
    const pinned = await getVersionRecord(
      store,
      workspaceId,
      namespace,
      record.path as WorkspacePath,
      record.finalVersion,
    );
    if (pinned) {
      // Pinned content fields come from the snapshot; lifecycle fields from HEAD.
      return recordToArtifact(
        {
          ...pinned.snapshot,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          status: "final",
          kind: record.kind,
          producedBy: record.producedBy,
          finalVersion: record.finalVersion,
        },
        scope,
      );
    }
  }
  return recordToArtifact(record, scope);
}

/** Convert a stored workspace file into its artifact projection. */
export function recordToArtifact(
  record: WorkspaceFileRecord,
  scope: { readonly workspaceId: string; readonly namespace: string },
): WorkspaceArtifact {
  return {
    path: record.path,
    ...(record.kind ? { kind: record.kind } : {}),
    status: record.status ?? "draft",
    ...(record.finalVersion !== undefined
      ? { version: record.finalVersion }
      : {}),
    mimeType: record.mimeType,
    size: record.size,
    uri:
      record.uri ??
      inlineArtifactUri(scope.workspaceId, scope.namespace, record.path),
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.producedBy ? { producedBy: record.producedBy } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function inlineArtifactUri(
  workspaceId: string,
  namespace: string,
  path: string,
): string {
  const encodedWorkspace = encodeURIComponent(workspaceId);
  const encodedNamespace = encodeURIComponent(namespace);
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `workspace-inline://${encodedWorkspace}/${encodedNamespace}${encodedPath}`;
}

function artifactFilter(
  options: WorkspaceArtifactsQuery | undefined,
): ExactFilter | undefined {
  const filter: Record<string, ExactFilter[string]> = {};
  if (options?.status) filter.status = options.status;
  if (options?.kind) filter.kind = options.kind;
  if (options?.path) filter.path = normalizePath(options.path);
  return Object.keys(filter).length > 0 ? filter : undefined;
}

function isArtifactRecord(record: WorkspaceFileRecord): boolean {
  return (
    record.status !== undefined ||
    record.kind !== undefined ||
    record.producedBy !== undefined
  );
}
