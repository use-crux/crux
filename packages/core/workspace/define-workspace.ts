/**
 * The {@link workspace} factory.
 *
 * Wires a {@link WorkspaceConfig} to a {@link DataStore} (metadata) and optional
 * {@link BlobStore} (binary/oversized payloads), then exposes the file
 * operations plus context/tool/injection adapters. Every operation is
 * instrumented and namespace-scoped.
 *
 * @module
 */

import { inMemoryBlobStore, inMemoryDataStore } from "../store/memory";
import {
  analyzeContent,
  createFileRecord,
  findOccurrences,
  recordToFile,
} from "./content";
import {
  mountForPath,
  normalizeMounts,
  normalizePath,
  defaultMounts,
} from "./path";
import { activeWorkspaceProvenance, instrument } from "./observability";
import { fileKey, getRecord, getRequiredRecord, listEntries } from "./store";
import { purgeVersions, recordFileVersion } from "./version-store";
import { createWorkspaceVersionOps } from "./version-ops";
import type { WorkspaceVersionOperation } from "./version-types";
import { createWorkspaceTools } from "./tools";
import { hasGlob } from "./glob";
import { recordToReadResult } from "./read-result";
import { createWorkspaceFilesystemOps } from "./fs-ops";
import { createWorkspaceArtifactOps } from "./artifacts";
import { createWorkspaceContextAdapters } from "./context-adapters";
import {
  assertWorkspaceWriteAllowed,
  withWorkspaceWriteLock,
  workspaceSetOptions,
} from "./limits";
import {
  DEFAULT_INLINE_TEXT_BYTES,
  type Workspace,
  type WorkspaceConfig,
  type WorkspaceContent,
  type WorkspaceDeleteOptions,
  type WorkspaceEditOptions,
  type WorkspaceEditPatch,
  type WorkspaceFile,
  type WorkspaceListOptions,
  type WorkspaceListResult,
  type WorkspaceBlobStore,
  type WorkspaceNamespaceOption,
  type WorkspaceReadOptions,
  type WorkspaceReadResult,
  type WorkspaceToolDeleteWithDefaults,
  type WorkspaceToolOptions,
  type WorkspaceToolPrefixWithDefaults,
  type WorkspaceTools,
  type WorkspaceToolUndoWithDefaults,
  type WorkspaceWriteOptions,
} from "./types";

/**
 * Create a durable, path-addressed workspace.
 *
 * @param config - Workspace id, namespace resolution, stores, mounts, and tools.
 * @returns A frozen {@link Workspace} instance.
 */
export function workspace<const Config extends WorkspaceConfig>(
  config: Config,
): Workspace<Config["tools"]> {
  assertNonEmpty(config.id, "workspace(): id must be non-empty.");

  const store = config.data ?? config.storage?.data ?? inMemoryDataStore();
  const blobs = config.blobs ?? config.storage?.blobs;
  const mounts = normalizeMounts(config.mounts ?? defaultMounts());
  const inlineTextBelowBytes =
    config.content?.inlineTextBelowBytes ?? DEFAULT_INLINE_TEXT_BYTES;

  async function resolveNamespace(
    input?: Record<string, unknown>,
    promptId?: string,
  ): Promise<string> {
    const raw =
      typeof config.namespace === "function"
        ? await config.namespace({ input: input ?? {}, promptId })
        : config.namespace;
    assertNonEmpty(
      raw,
      "workspace(): namespace must resolve to a non-empty string.",
    );
    return raw;
  }

  async function namespaceFor(
    options?: WorkspaceNamespaceOption,
  ): Promise<string> {
    if (options?.namespace !== undefined) {
      assertNonEmpty(
        options.namespace,
        "workspace(): namespace override must be non-empty.",
      );
      return options.namespace;
    }
    return resolveNamespace();
  }

  async function list(
    path = "/",
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult> {
    const namespace = await namespaceFor(options);
    return listForNamespace(namespace, path, options);
  }

  async function listForNamespace(
    namespace: string,
    path = "/",
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult> {
    return instrument(
      { workspaceId: config.id, operation: "list", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        const isGlob = hasGlob(normalized);
        const matchedMount =
          isGlob || normalized === "/"
            ? undefined
            : mountForPath(normalized, mounts, "read");
        return listEntries({
          store,
          workspaceId: config.id,
          namespace,
          mounts,
          queryPath: normalized,
          isGlob,
          limit: options?.limit,
          cursor: options?.cursor,
          matchedMount,
        });
      },
    );
  }

  async function read(
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult> {
    const namespace = await namespaceFor(options);
    return readForNamespace(namespace, path, options);
  }

  async function readForNamespace(
    namespace: string,
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult> {
    return instrument(
      { workspaceId: config.id, operation: "read", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        mountForPath(normalized, mounts, "read");
        if (options?.version !== undefined) {
          return versionOps.readVersion(namespace, normalized, options.version, {
            maxInlineBytes: options.maxInlineBytes,
            offset: options.offset,
          });
        }
        const record = await getRequiredRecord(
          store,
          config.id,
          namespace,
          normalized,
        );
        return recordToReadResult(record, {
          blobs,
          maxInlineBytes: options?.maxInlineBytes,
          offset: options?.offset,
        });
      },
    );
  }

  async function write(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return writeForNamespace(
      namespace,
      path,
      content,
      options,
      artifactWriteProvenance(options),
    );
  }

  async function writeForNamespace(
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
    producedBy = artifactWriteProvenance(options),
    operation: WorkspaceVersionOperation = "write",
  ): Promise<WorkspaceFile> {
    return instrument(
      { workspaceId: config.id, operation: "write", namespace, path },
      async () => {
        return withWorkspaceWriteLock(config.id, namespace, async () => {
          const normalized = normalizePath(path);
          const mount = mountForPath(normalized, mounts, "write");
          const analysis = await analyzeContent(content, options?.mimeType);
          const existing = await getRecord(
            store,
            config.id,
            namespace,
            normalized,
          );
          await assertWorkspaceWriteAllowed({
            store,
            workspaceId: config.id,
            namespace,
            path: normalized,
            nextSize: analysis.size,
            existing,
            limits: config.limits,
          });
          const now = Date.now();
          const record = await createFileRecord({
            workspaceId: config.id,
            namespace,
            path: normalized,
            mount: mount.path,
            analysis,
            metadata: options?.metadata,
            status: options?.status,
            artifactKind: options?.kind,
            producedBy,
            existing,
            now,
            version: (existing?.headVersion ?? 0) + 1,
            inlineTextBelowBytes,
            blobs,
          });
          const setOptions = workspaceSetOptions(store, config.retention);
          await store.set(
            fileKey(config.id, namespace, normalized),
            record,
            setOptions,
          );
          await recordFileVersion({
            store,
            blobs,
            workspaceId: config.id,
            namespace,
            path: normalized,
            record,
            operation,
            versioning: config.versioning,
            setOptions,
          });
          return recordToFile(record);
        });
      },
    );
  }

  async function edit(
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return editForNamespace(namespace, path, patch, options);
  }

  async function editForNamespace(
    namespace: string,
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile> {
    return instrument(
      { workspaceId: config.id, operation: "edit", namespace, path },
      async () => {
        if (!patch.find)
          throw new Error("workspace.edit(): patch.find must be non-empty.");
        const current = await readForNamespace(namespace, path);
        if (current.kind !== "text") {
          throw new Error(
            `workspace.edit(): only text files can be edited. "${path}" is ${current.kind}.`,
          );
        }
        const occurrences = findOccurrences(current.content, patch.find);
        if (occurrences.length === 0) {
          throw new Error(
            `workspace.edit(): text to replace was not found in "${path}".`,
          );
        }
        if (occurrences.length > 1 && patch.occurrence === undefined) {
          throw new Error(
            `workspace.edit(): found ${occurrences.length} matches in "${path}". Pass occurrence to choose one.`,
          );
        }
        const occurrence = patch.occurrence ?? 1;
        if (occurrence < 1 || occurrence > occurrences.length) {
          throw new Error(
            `workspace.edit(): occurrence ${occurrence} is outside the match range.`,
          );
        }
        const index = occurrences[occurrence - 1]!;
        const next = `${current.content.slice(0, index)}${patch.replace}${current.content.slice(index + patch.find.length)}`;
        return writeForNamespace(
          namespace,
          path,
          next,
          {
            mimeType: options?.mimeType ?? current.mimeType,
            metadata: current.metadata,
            status: current.status,
            kind: current.artifactKind,
          },
          current.producedBy,
          "edit",
        );
      },
    );
  }

  async function remove(
    path: string,
    options?: WorkspaceDeleteOptions,
  ): Promise<void> {
    const namespace = await namespaceFor(options);
    await removeForNamespace(namespace, path, options);
  }

  async function removeForNamespace(
    namespace: string,
    path: string,
    options?: WorkspaceDeleteOptions,
  ): Promise<void> {
    await instrument(
      { workspaceId: config.id, operation: "delete", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        mountForPath(normalized, mounts, "write");
        const record = await getRecord(store, config.id, namespace, normalized);
        await store.delete(fileKey(config.id, namespace, normalized));
        await purgeVersions(store, blobs, config.id, namespace, normalized);
        if (options?.deleteBlob !== false && record?.uri && blobs?.delete) {
          await blobs.delete(record.uri);
        }
      },
    );
  }

  const fsOps = createWorkspaceFilesystemOps({
    workspaceId: config.id,
    store,
    blobs,
    mounts,
    inlineTextBelowBytes,
    limits: config.limits,
    retention: config.retention,
    versioning: config.versioning,
    resolveNamespace,
  });
  const versionOps = createWorkspaceVersionOps({
    workspaceId: config.id,
    store,
    blobs,
    mounts,
    resolveNamespace,
    write: (namespace, path, content, options, operation) =>
      writeForNamespace(namespace, path, content, options, undefined, operation),
  });
  const artifactOps = createWorkspaceArtifactOps({
    workspaceId: config.id,
    store,
    mounts,
    retention: config.retention,
    resolveNamespace,
  });
  const asTools = createWorkspaceTools<Config["tools"]>({
    workspaceId: config.id,
    defaultToolOptions: config.tools,
    ops: {
      list,
      read,
      write,
      edit,
      rename: fsOps.rename,
      grep: fsOps.grep,
      remove,
      undo: versionOps.undo,
    },
  });
  const contextAdapters = createWorkspaceContextAdapters<Config["tools"]>({
    workspaceId: config.id,
    store,
    blobs,
    mounts,
    resolveNamespace,
    asTools,
  });

  const ws: Workspace<Config["tools"]> = {
    _tag: "Workspace",
    id: config.id,
    mounts,
    list,
    read,
    write,
    edit,
    delete: remove,
    exists: fsOps.exists,
    stat: fsOps.stat,
    append: fsOps.append,
    rename: fsOps.rename,
    move: fsOps.move,
    copy: fsOps.copy,
    grep: fsOps.grep,
    history: versionOps.history,
    diff: versionOps.diff,
    undo: versionOps.undo,
    artifacts: artifactOps.artifacts,
    finalize: artifactOps.finalize,
    asContext: contextAdapters.asContext,
    asTools: <
      const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption =
        {},
    >(
      options?: Options,
    ): WorkspaceTools<
      WorkspaceToolPrefixWithDefaults<Config["tools"], Options>,
      WorkspaceToolDeleteWithDefaults<Config["tools"], Options>,
      WorkspaceToolUndoWithDefaults<Config["tools"], Options>
    > => asTools(options),
    inject: contextAdapters.inject,
  };

  return Object.freeze(ws);
}

/** An in-memory {@link WorkspaceBlobStore}, useful for tests and ephemeral runs. */
export function memoryWorkspaceBlobStore(): WorkspaceBlobStore {
  return inMemoryBlobStore();
}

function assertNonEmpty(value: string, message: string): void {
  if (!value.trim()) throw new Error(message);
}

function artifactWriteProvenance(options: WorkspaceWriteOptions | undefined) {
  if (!options?.status && !options?.kind) return undefined;
  return activeWorkspaceProvenance();
}
