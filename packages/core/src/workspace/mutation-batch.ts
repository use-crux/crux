/**
 * Same-process observed-failure boundary for multi-path Workspace mutations.
 *
 * @module
 */

import type { AssetStore, RecordStore } from "../storage";
import { createFileRecord } from "./content";
import {
  assertWorkspaceMutationBatchAllowed,
  workspaceSetOptions,
  type WorkspaceLimits,
} from "./limits";
import { withWorkspaceMutationLock } from "./mutation-coordinator";
import { emitWorkspaceVersion, instrument } from "./observability";
import { mountForPath } from "./path";
import {
  prepareWorkspaceMutations,
  validateWorkspaceMutationMounts,
  type PreparedWorkspaceMutation,
  type WorkspaceMutation,
} from "./mutation/plan";
import {
  captureMutationPreState,
  cleanupCommittedMutationBatch,
  deleteMutationPathMetadata,
  rollbackMutationBatch,
  type WorkspaceMutationPreState,
} from "./transaction-rollback";
import { commitVersionedWorkspaceRecord } from "./versioned-record-persistence";
import type {
  WorkspaceVersionEvent,
  WorkspaceVersioning,
} from "./version-types";
import type { WorkspaceChangeEmitter, WorkspaceChangeInput } from "./watch";
import type {
  NormalizedMount,
  WorkspaceFileRecord,
  WorkspacePath,
  WorkspaceRetention,
} from "./types";
export type {
  MaterializedWorkspaceState,
  WorkspaceMutation,
} from "./mutation/plan";

/** Dependencies shared by transaction commits and snapshot restore batches. */
export interface WorkspaceMutationBatchConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly mounts: readonly NormalizedMount[];
  readonly inlineTextBelowBytes: number;
  readonly limits?: WorkspaceLimits;
  readonly retention?: WorkspaceRetention;
  readonly versioning?: WorkspaceVersioning;
  readonly emitChange: WorkspaceChangeEmitter;
  /** Preserve ordinary target write/delete instrumentation for transactions. */
  readonly instrumentMutations?: boolean;
}

/** Apply a complete mutation plan atomically for failures observed in-process. */
export async function applyWorkspaceMutationBatch(
  config: WorkspaceMutationBatchConfig,
  namespace: string,
  mutations:
    | readonly WorkspaceMutation[]
    | (() => Promise<readonly WorkspaceMutation[]>),
): Promise<void> {
  const createMutations =
    typeof mutations === "function" ? mutations : async () => mutations;
  const prepared =
    typeof mutations === "function"
      ? undefined
      : await prepareWorkspaceMutations(mutations);
  const committed = await withWorkspaceMutationLock(
    config.workspaceId,
    namespace,
    async () =>
      applyLocked(
        config,
        namespace,
        prepared ?? (await prepareWorkspaceMutations(await createMutations())),
      ),
  );
  for (const event of committed.versionEvents) emitWorkspaceVersion(event);
  for (const event of committed.changeEvents) {
    await config.emitChange(event).catch(() => undefined);
  }
}

interface CommittedWorkspaceMutationBatch {
  readonly versionEvents: readonly WorkspaceVersionEvent[];
  readonly changeEvents: readonly WorkspaceChangeInput[];
}

async function applyLocked(
  config: WorkspaceMutationBatchConfig,
  namespace: string,
  prepared: readonly PreparedWorkspaceMutation[],
): Promise<CommittedWorkspaceMutationBatch> {
  validateWorkspaceMutationMounts(config.mounts, prepared);
  await assertWorkspaceMutationBatchAllowed({
    store: config.store,
    workspaceId: config.workspaceId,
    namespace,
    mutations: prepared.map((item) =>
      item.kind === "put"
        ? { kind: "put", path: item.mutation.path, size: item.head.size }
        : { kind: "delete", path: item.mutation.path },
    ),
    limits: config.limits,
  });

  const before = new Map<WorkspacePath, WorkspaceMutationPreState>();
  for (const { mutation } of prepared) {
    before.set(
      mutation.path,
      await captureMutationPreState(config, namespace, mutation.path),
    );
  }

  const finalHeads = new Map<WorkspacePath, WorkspaceFileRecord>();
  const versionEvents: WorkspaceVersionEvent[] = [];
  try {
    for (const item of prepared) {
      const apply = async (): Promise<void> => {
        if (item.kind === "delete") {
          await deleteMutationPathMetadata(
            config,
            namespace,
            item.mutation.path,
          );
          return;
        }
        const previous = before.get(item.mutation.path)?.head ?? null;
        finalHeads.set(
          item.mutation.path,
          await applyPut(config, namespace, item, previous, (event) =>
            versionEvents.push(event),
          ),
        );
      };
      await (config.instrumentMutations
        ? instrument(
            {
              workspaceId: config.workspaceId,
              operation: item.kind === "put" ? "write" : "delete",
              namespace,
              path: item.mutation.path,
            },
            apply,
          )
        : apply());
    }
  } catch (error) {
    const failures = await rollbackMutationBatch(config, namespace, before);
    if (failures.length > 0) logMaintenanceFailure("rollback", failures);
    throw error;
  }

  await cleanupCommittedMutationBatch(
    config,
    namespace,
    prepared.flatMap((item) =>
      item.kind === "delete" ? [item.mutation.path] : [],
    ),
    before,
    finalHeads,
  );
  const changeEvents = prepared.flatMap(({ mutation }) => {
    const previous = before.get(mutation.path)?.head ?? null;
    if (mutation.kind === "delete") {
      return previous
        ? [changeEvent(config.workspaceId, namespace, mutation.path, "delete")]
        : [];
    }
    const head = finalHeads.get(mutation.path);
    return head
      ? [
          changeEvent(
            config.workspaceId,
            namespace,
            mutation.path,
            previous ? "update" : "create",
            head.updatedAt,
          ),
        ]
      : [];
  });
  return { versionEvents, changeEvents };
}

async function applyPut(
  config: WorkspaceMutationBatchConfig,
  namespace: string,
  item: Extract<PreparedWorkspaceMutation, { readonly kind: "put" }>,
  previous: WorkspaceFileRecord | null,
  emitVersion: (event: WorkspaceVersionEvent) => void,
): Promise<WorkspaceFileRecord> {
  let current = previous;
  const published = item.mutation.published;
  const states =
    item.published && published
      ? [
          {
            logical: published,
            analysis: item.published,
            firstRestoreState: true,
          },
          {
            logical: item.mutation.head,
            analysis: item.head,
            firstRestoreState: false,
          },
        ]
      : [
          {
            logical: item.mutation.head,
            analysis: item.head,
            firstRestoreState: true,
          },
        ];
  for (const state of states) {
    const now = Date.now();
    const record = await createFileRecord({
      workspaceId: config.workspaceId,
      namespace,
      path: item.mutation.path,
      mount: mountForPath(item.mutation.path, config.mounts, "write").path,
      analysis: state.analysis,
      metadata: state.logical.metadata,
      status: state.logical.status,
      artifactKind: state.logical.artifactKind,
      producedBy: state.logical.producedBy,
      ...(item.mutation.operation === "restore"
        ? { artifactMode: "replace" as const }
        : {}),
      ...(item.mutation.operation === "restore" && state.firstRestoreState
        ? { pinFinalVersionToCurrent: true }
        : {}),
      existing: current,
      now,
      ...(state.logical.createdAt !== undefined
        ? { createdAt: state.logical.createdAt }
        : {}),
      version: (current?.headVersion ?? 0) + 1,
      inlineTextBelowBytes: config.inlineTextBelowBytes,
      assets: config.assets,
    });
    await commitVersionedWorkspaceRecord({
      store: config.store,
      assets: config.assets,
      workspaceId: config.workspaceId,
      namespace,
      path: item.mutation.path,
      record,
      previous: current,
      operation: item.mutation.operation,
      versioning: config.versioning,
      setOptions: workspaceSetOptions(config.store, config.retention),
      deferRetention: true,
      emitVersion,
    });
    current = record;
  }
  if (!current) {
    throw new Error("Workspace put mutation did not produce a HEAD record.");
  }
  return current;
}

function changeEvent(
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  type: "create" | "update" | "delete",
  at?: number,
): WorkspaceChangeInput {
  return {
    type,
    workspaceId,
    namespace,
    path,
    ...(at !== undefined ? { at } : {}),
  };
}

function logMaintenanceFailure(phase: string, error: unknown): void {
  console.warn(
    `[crux] workspace mutation batch ${phase} failed; continuing.`,
    error,
  );
}
