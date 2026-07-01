/**
 * Transaction-scoped workspace operations.
 *
 * A transaction runs against a private staging namespace seeded from the target
 * namespace, then applies only the paths touched by the callback. This keeps
 * read-your-own-writes behavior behind the ordinary workspace API while the
 * public surface stays small.
 *
 * @module
 */

import type { RecordStore } from "../storage";
import { snapshotContent } from "./version-content";
import { fileKey, listFileRecords } from "./store";
import { normalizePath } from "./path";
import { purgeVersions } from "./version-store";
import { instrument } from "./observability";
import { assertLocalTransactionMutationPath } from "./transaction-mounts";
import {
  captureRollbackState,
  currentRecord,
  deleteCapturedBlobs,
  rollbackTouchedPaths,
  type TransactionRollbackState,
} from "./transaction-rollback";
import type {
  Workspace,
  WorkspaceBlobStore,
  WorkspaceContent,
  WorkspaceFileRecord,
  WorkspaceNamespaceOption,
  NormalizedMount,
  WorkspaceRetention,
  WorkspaceTransaction,
  WorkspaceTransactionOptions,
  WorkspaceWriteOptions,
} from "./types";
/** Bound dependencies for workspace transaction orchestration. */
export interface WorkspaceTransactionConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly blobs?: WorkspaceBlobStore;
  readonly mounts: readonly NormalizedMount[];
  readonly retention?: WorkspaceRetention;
  readonly resolveNamespace: () => Promise<string>;
  readonly write: (
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
    producedBy?: WorkspaceFileRecord["producedBy"],
  ) => Promise<unknown>;
  readonly remove: (
    namespace: string,
    path: string,
    options?: { readonly deleteBlob?: boolean },
  ) => Promise<void>;
  readonly ops: Pick<
    Workspace,
    | "list"
    | "read"
    | "write"
    | "edit"
    | "delete"
    | "exists"
    | "stat"
    | "append"
    | "rename"
    | "move"
    | "copy"
    | "grep"
    | "artifacts"
    | "finalize"
  >;
}

/** Create the public `Workspace.transaction()` operation. */
export function createWorkspaceTransaction(
  config: WorkspaceTransactionConfig,
): Workspace["transaction"] {
  return async function transaction<T>(
    run: (tx: WorkspaceTransaction) => Promise<T> | T,
    options?: WorkspaceTransactionOptions,
  ): Promise<T> {
    const namespace = await namespaceFor(config, options);
    const stagingNamespace = `${namespace}.__crux_tx_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2)}`;
    const touched = new Set<string>();

    try {
      return await instrument(
        {
          workspaceId: config.workspaceId,
          operation: "transaction",
          namespace,
          path: "/",
        },
        async () => {
          await seedNamespace(config, namespace, stagingNamespace);
          const result = await run(transactionScope(config, stagingNamespace, touched));
          await commitTouchedPaths(config, namespace, stagingNamespace, touched);
          return result;
        },
      );
    } finally {
      await clearNamespace(config, stagingNamespace);
    }
  };
}

function transactionScope(
  config: WorkspaceTransactionConfig,
  namespace: string,
  touched: Set<string>,
): WorkspaceTransaction {
  const ops = config.ops;
  const scoped = (options?: WorkspaceNamespaceOption) => ({
    ...options,
    namespace,
  });
  const touch = (path: string): void => {
    assertLocalTransactionMutationPath(config.mounts, path);
    touched.add(normalizePath(path));
  };
  return Object.freeze({
    list: (path, options) => ops.list(path, scoped(options)),
    read: (path, options) => ops.read(path, scoped(options)),
    write: async (path, content, options) => {
      touch(path);
      return ops.write(path, content, scoped(options));
    },
    edit: async (path, patch, options) => {
      touch(path);
      return ops.edit(path, patch, scoped(options));
    },
    delete: async (path, options) => {
      touch(path);
      return ops.delete(path, scoped(options));
    },
    exists: (path, options) => ops.exists(path, scoped(options)),
    stat: (path, options) => ops.stat(path, scoped(options)),
    append: async (path, content, options) => {
      touch(path);
      return ops.append(path, content, scoped(options));
    },
    rename: async (from, to, options) => {
      touch(from);
      touch(to);
      return ops.rename(from, to, scoped(options));
    },
    move: async (from, to, options) => {
      touch(from);
      touch(to);
      return ops.move(from, to, scoped(options));
    },
    copy: async (from, to, options) => {
      touch(to);
      return ops.copy(from, to, scoped(options));
    },
    grep: (query, options) => ops.grep(query, scoped(options)),
    artifacts: (options) => ops.artifacts(scoped(options)),
    finalize: async (path, options) => {
      touch(path);
      return ops.finalize(path, scoped(options));
    },
  });
}

async function seedNamespace(
  config: WorkspaceTransactionConfig,
  fromNamespace: string,
  toNamespace: string,
): Promise<void> {
  const records = await listFileRecords(config.store, config.workspaceId, fromNamespace);
  for (const record of records) {
    await config.write(
      toNamespace,
      record.path,
      await snapshotContent(record, config.blobs),
      writeOptionsFromRecord(record),
      record.producedBy,
    );
  }
}

async function commitTouchedPaths(
  config: WorkspaceTransactionConfig,
  namespace: string,
  stagingNamespace: string,
  touched: ReadonlySet<string>,
): Promise<void> {
  const before = new Map<string, TransactionRollbackState>();
  const deletedStates: TransactionRollbackState[] = [];
  for (const path of touched) {
    before.set(path, await captureRollbackState(config, namespace, path));
  }
  try {
    for (const path of touched) {
      const staged = await currentRecord(config, stagingNamespace, path);
      if (!staged) {
        await config.remove(namespace, path, { deleteBlob: false });
        const state = before.get(path);
        if (state) deletedStates.push(state);
        continue;
      }
      await config.write(
        namespace,
        path,
        await snapshotContent(staged, config.blobs),
        writeOptionsFromRecord(staged),
        staged.producedBy,
      );
    }
  } catch (error) {
    await rollbackTouchedPaths(config, namespace, before);
    throw error;
  }
  const deletedBlobUris = new Set<string>();
  for (const state of deletedStates) {
    await deleteCapturedBlobs(config, state, deletedBlobUris);
  }
}

async function clearNamespace(
  config: WorkspaceTransactionConfig,
  namespace: string,
): Promise<void> {
  const records = await listFileRecords(config.store, config.workspaceId, namespace);
  for (const record of records) {
    await config.store.delete(fileKey(config.workspaceId, namespace, normalizePath(record.path)));
    await purgeVersions(
      config.store,
      config.blobs,
      config.workspaceId,
      namespace,
      normalizePath(record.path),
      { currentBlobUri: record.uri },
    );
  }
}

function writeOptionsFromRecord(record: WorkspaceFileRecord): WorkspaceWriteOptions {
  return {
    namespace: record.namespace,
    mimeType: record.mimeType,
    ...(record.metadata !== undefined ? { metadata: record.metadata } : {}),
    ...(record.status !== undefined ? { status: record.status } : {}),
    ...(record.kind !== undefined ? { kind: record.kind } : {}),
  };
}

async function namespaceFor(
  config: WorkspaceTransactionConfig,
  options: WorkspaceTransactionOptions | undefined,
): Promise<string> {
  if (options?.namespace !== undefined) {
    if (!options.namespace.trim()) {
      throw new Error("workspace(): namespace override must be non-empty.");
    }
    return options.namespace;
  }
  return config.resolveNamespace();
}
