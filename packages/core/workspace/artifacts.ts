/**
 * Workspace artifact lifecycle operations.
 *
 * Artifacts are a typed view over ordinary workspace file records. This module
 * owns finalization and record-to-artifact projection so the main workspace
 * factory can stay focused on operation wiring.
 *
 * @module
 */

import type { DataStore } from "../store/types";
import { instrument } from "./observability";
import { mountForPath, normalizePath } from "./path";
import { fileKey, getRequiredRecord, listFileRecords } from "./store";
import { workspaceSetOptions } from "./limits";
import type {
  WorkspaceArtifact,
  WorkspaceArtifactsQuery,
  WorkspaceFinalizeOptions,
} from "./artifact-types";
import type {
  NormalizedMount,
  WorkspaceRetention,
  WorkspaceFileRecord,
} from "./types";

/** Bound dependencies for artifact lifecycle operations. */
export interface WorkspaceArtifactOpsConfig {
  readonly workspaceId: string;
  readonly store: DataStore;
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
        return records
          .filter(isArtifactRecord)
          .map((record) =>
            recordToArtifact(record, {
              workspaceId: config.workspaceId,
              namespace,
            }),
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
        mountForPath(normalized, config.mounts, "write");
        const current = await getRequiredRecord(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
        );
        const finalized: WorkspaceFileRecord = {
          ...current,
          status: "final",
          kind: options?.kind ?? current.kind,
          updatedAt: Date.now(),
        };
        await config.store.set(
          fileKey(config.workspaceId, namespace, normalized),
          finalized,
          workspaceSetOptions(config.store, config.retention),
        );
        return recordToArtifact(finalized, {
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

/** Convert a stored workspace file into its artifact projection. */
export function recordToArtifact(
  record: WorkspaceFileRecord,
  scope: { readonly workspaceId: string; readonly namespace: string },
): WorkspaceArtifact {
  return {
    path: record.path,
    ...(record.kind ? { kind: record.kind } : {}),
    status: record.status ?? "draft",
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
): Record<string, unknown> | undefined {
  const filter: Record<string, unknown> = {};
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
