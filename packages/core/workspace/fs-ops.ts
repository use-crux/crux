/**
 * Filesystem-style workspace operations.
 *
 * Keeps higher-level file operations out of the {@link workspace} factory while
 * sharing the same path validation, namespace override, and instrumentation
 * rules as the core read/write/list methods.
 *
 * @module
 */

import type { JsonObject, RecordStore } from "../storage";
import { analyzeContent, createFileRecord, recordToFile } from "./content";
import {
  createFileRecordFromReadResult,
  readResultToWorkspaceContent,
} from "./copy-record";
import { globToRegExp, hasGlob } from "./glob";
import { instrument } from "./observability";
import { mountForPath, normalizePath } from "./path";
import { recordToReadResult } from "./read-result";
import { fileKey, getRecord, listFileRecords } from "./store";
import { snapshotContent } from "./version-content";
import { purgeVersions, recordFileVersion } from "./version-store";
import { createWorkspaceTextMatcher, grepWorkspaceText } from "./text-search";
import { grepWorkspaceSourceMounts } from "./source-grep";
import { writeWorkspaceMountSource } from "./source-write";
import {
  assertWorkspaceMountIsLocal,
  existsWorkspaceMountSource,
  grepWorkspaceMountSource,
  hasWorkspaceMountSource,
  readWorkspaceMountSource,
  sourceMountForPath,
  type SourceBackedMount,
  statWorkspaceMountSource,
} from "./virtual-source";
import {
  assertWorkspaceWriteAllowed,
  withWorkspaceWriteLock,
  workspaceSetOptions,
} from "./limits";
import {
  shouldSuppressWorkspaceChangeEvents,
  type WorkspaceChangeEmitter,
} from "./watch";
import type {
  NormalizedMount,
  WorkspaceAppendOptions,
  WorkspaceBlobStore,
  WorkspaceFile,
  WorkspaceFileRecord,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceLimits,
  WorkspaceMountWriteOptions,
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
  WorkspacePath,
  WorkspaceReadResult,
  WorkspaceRetention,
  WorkspaceVersioning,
} from "./types";

/** Bound dependencies for filesystem-style workspace operations. */
export interface WorkspaceFilesystemOpsConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly blobs?: WorkspaceBlobStore;
  readonly mounts: readonly NormalizedMount[];
  readonly inlineTextBelowBytes: number;
  readonly limits?: WorkspaceLimits;
  readonly retention?: WorkspaceRetention;
  readonly versioning?: WorkspaceVersioning;
  readonly resolveNamespace: () => Promise<string>;
  readonly emitChange?: WorkspaceChangeEmitter;
}

/** Public filesystem-style operations mixed into a {@link Workspace}. */
export interface WorkspaceFilesystemOps {
  /** Check whether a readable file exists at `path`. */
  exists(path: string, options?: WorkspaceNamespaceOption): Promise<boolean>;
  /** Return public file metadata for `path`, or `null` when it is absent. */
  stat(
    path: string,
    options?: WorkspaceNamespaceOption,
  ): Promise<WorkspaceFile | null>;
  /** Append text to a file, creating it when absent. */
  append(
    path: string,
    content: string,
    options?: WorkspaceAppendOptions,
  ): Promise<WorkspaceFile>;
  /** Move a file to a new path. */
  rename(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  /** Alias for {@link WorkspaceFilesystemOps.rename}. */
  move(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  /** Copy a file to a new path. */
  copy(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  /** Search text files and return line-oriented matches. */
  grep(
    query: string,
    options?: WorkspaceGrepOptions,
  ): Promise<WorkspaceGrepResult>;
}

/** Create filesystem-style operations for one workspace instance. */
export function createWorkspaceFilesystemOps(
  config: WorkspaceFilesystemOpsConfig,
): WorkspaceFilesystemOps {
  async function exists(
    path: string,
    options?: WorkspaceNamespaceOption,
  ): Promise<boolean> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "exists", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        const mount = mountForPath(normalized, config.mounts, "read");
        if (hasWorkspaceMountSource(mount)) {
          return existsWorkspaceMountSource(mount, normalized);
        }
        return (
          (await getRecord(
            config.store,
            config.workspaceId,
            namespace,
            normalized,
          )) !== null
        );
      },
    );
  }

  async function stat(
    path: string,
    options?: WorkspaceNamespaceOption,
  ): Promise<WorkspaceFile | null> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "stat", namespace, path },
      async () => {
        const normalized = normalizePath(path);
        const mount = mountForPath(normalized, config.mounts, "read");
        if (hasWorkspaceMountSource(mount)) {
          return statWorkspaceMountSource(mount, normalized);
        }
        const record = await getRecord(
          config.store,
          config.workspaceId,
          namespace,
          normalized,
        );
        return record ? recordToFile(record) : null;
      },
    );
  }

  async function append(
    path: string,
    content: string,
    options?: WorkspaceAppendOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation: "append", namespace, path },
      async () => {
        return withWorkspaceWriteLock(
          config.workspaceId,
          namespace,
          async () => {
            const normalized = normalizePath(path);
            const mount = mountForPath(normalized, config.mounts, "write");
            if (hasWorkspaceMountSource(mount)) {
              const current = await readWorkspaceMountSource(
                mount,
                normalized,
                { maxInlineBytes: Number.MAX_SAFE_INTEGER },
              );
              if (current && current.kind !== "text") {
                throw new Error(
                  `workspace.append(): only text files can be appended. "${path}" is ${current.kind}.`,
                );
              }
              if (current?.truncated) {
                throw new Error(
                  `workspace.append(): source-backed file "${path}" was truncated and cannot be appended.`,
                );
              }
              const file = await writeWorkspaceMountSource(
                mount,
                normalized,
                `${current?.content ?? ""}${content}`,
                mountAppendOptions(current, options),
              );
              if (!shouldSuppressWorkspaceChangeEvents(options)) {
                await config.emitChange?.({
                  type: current ? "update" : "create",
                  workspaceId: config.workspaceId,
                  namespace,
                  path: normalized,
                  at: file.updatedAt,
                });
              }
              return file;
            }
            assertWorkspaceMountIsLocal(mount, "append");
            const existing = await getRecord(
              config.store,
              config.workspaceId,
              namespace,
              normalized,
            );
            const currentContent = existing
              ? await readExistingText(path, existing)
              : "";
            const analysis = await analyzeContent(
              `${currentContent}${content}`,
              options?.mimeType ?? existing?.mimeType,
            );
            await assertWorkspaceWriteAllowed({
              store: config.store,
              workspaceId: config.workspaceId,
              namespace,
              path: normalized,
              nextSize: analysis.size,
              existing,
              limits: config.limits,
            });
            const now = Date.now();
            const record = await createFileRecord({
              workspaceId: config.workspaceId,
              namespace,
              path: normalized,
              mount: mount.path,
              analysis,
              metadata: existing?.metadata,
              status: existing?.status,
              artifactKind: existing?.kind,
              producedBy: existing?.producedBy,
              existing,
              now,
              version: (existing?.headVersion ?? 0) + 1,
              inlineTextBelowBytes: config.inlineTextBelowBytes,
              blobs: config.blobs,
            });
            const setOptions = workspaceSetOptions(
              config.store,
              config.retention,
            );
            await config.store.put(
              fileKey(config.workspaceId, namespace, normalized),
              record as unknown as JsonObject,
              setOptions,
            );
            await recordFileVersion({
              store: config.store,
              blobs: config.blobs,
              workspaceId: config.workspaceId,
              namespace,
              path: normalized,
              record,
              operation: "append",
              versioning: config.versioning,
              setOptions,
            });
            if (!shouldSuppressWorkspaceChangeEvents(options)) {
              await config.emitChange?.({
                type: existing ? "update" : "create",
                workspaceId: config.workspaceId,
                namespace,
                path: normalized,
                at: record.updatedAt,
              });
            }
            return recordToFile(record);
          },
        );
      },
    );
  }

  async function rename(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile> {
    return moveRecord("rename", from, to, options);
  }

  async function move(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile> {
    return moveRecord("move", from, to, options);
  }

  async function moveRecord(
    operation: "rename" | "move",
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return instrument(
      { workspaceId: config.workspaceId, operation, namespace, path: from },
      async () => {
        const fromPath = normalizePath(from);
        const toPath = normalizePath(to);
        const fromMount = mountForPath(fromPath, config.mounts, "write");
        assertWorkspaceMountIsLocal(fromMount, operation);
        const toMount = mountForPath(toPath, config.mounts, "write");
        assertWorkspaceMountIsLocal(toMount, operation);
        return withWorkspaceWriteLock(
          config.workspaceId,
          namespace,
          async () => {
            const source = await getRecord(
              config.store,
              config.workspaceId,
              namespace,
              fromPath,
            );
            if (!source)
              throw new Error(
                `workspace.${operation}(): source file not found: "${fromPath}".`,
              );
            if (fromPath === toPath) return recordToFile(source);
            const destination = await getRecord(
              config.store,
              config.workspaceId,
              namespace,
              toPath,
            );
            if (destination && !options?.overwrite) {
              throw new Error(
                `workspace.${operation}(): destination file already exists: "${toPath}".`,
              );
            }
            await assertWorkspaceWriteAllowed({
              store: config.store,
              workspaceId: config.workspaceId,
              namespace,
              path: toPath,
              nextSize: source.size,
              existing: destination,
              releasedBytes: source.size,
              limits: config.limits,
            });
            const moved = await freshRecordFromSource(
              namespace,
              source,
              toPath,
              toMount.path,
            );
            if (destination) {
              await purgeVersions(
                config.store,
                config.blobs,
                config.workspaceId,
                namespace,
                toPath,
                { currentBlobUri: destination.uri },
              );
            }
            await setFreshVersionedRecord(
              namespace,
              toPath,
              moved,
              destination,
            );
            await config.store.delete(
              fileKey(config.workspaceId, namespace, fromPath),
            );
            await purgeVersions(
              config.store,
              config.blobs,
              config.workspaceId,
              namespace,
              fromPath,
              { currentBlobUri: source.uri },
            );
            if (!shouldSuppressWorkspaceChangeEvents(options)) {
              await config.emitChange?.({
                type: "rename",
                workspaceId: config.workspaceId,
                namespace,
                from: fromPath,
                path: toPath,
                at: moved.updatedAt,
              });
            }
            return recordToFile(moved);
          },
        );
      },
    );
  }

  async function copy(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await namespaceFor(options);
    return instrument(
      {
        workspaceId: config.workspaceId,
        operation: "copy",
        namespace,
        path: from,
      },
      async () => {
        const fromPath = normalizePath(from);
        const toPath = normalizePath(to);
        const fromMount = mountForPath(fromPath, config.mounts, "read");
        const sourceMount = hasWorkspaceMountSource(fromMount)
          ? fromMount
          : undefined;
        const toMount = mountForPath(toPath, config.mounts, "write");
        const destinationMount = hasWorkspaceMountSource(toMount)
          ? toMount
          : undefined;
        if (!destinationMount) assertWorkspaceMountIsLocal(toMount, "copy");
        return withWorkspaceWriteLock(
          config.workspaceId,
          namespace,
          async () => {
            const sourceInput = sourceMount
              ? await getCopySourceRead(sourceMount, fromPath)
              : ({
                  kind: "record",
                  record: await getCopySourceRecord(namespace, fromPath),
                } as const);
            const sourceSize =
              sourceInput.kind === "read"
                ? sourceInput.result.size
                : sourceInput.record.size;
            if (destinationMount) {
              const destinationExists = await existsWorkspaceMountSource(
                destinationMount,
                toPath,
              );
              if (destinationExists && !options?.overwrite) {
                throw new Error(
                  `workspace.copy(): destination file already exists: "${toPath}".`,
                );
              }
              const sourceContent =
                sourceInput.kind === "read"
                  ? readResultToWorkspaceContent(sourceInput.result)
                  : await snapshotContent(sourceInput.record, config.blobs);
              const sourceMimeType =
                sourceInput.kind === "read"
                  ? sourceInput.result.mimeType
                  : sourceInput.record.mimeType;
              const sourceMetadata =
                sourceInput.kind === "read"
                  ? sourceInput.result.metadata
                  : sourceInput.record.metadata;
              const sourceStatus =
                sourceInput.kind === "read"
                  ? sourceInput.result.status
                  : sourceInput.record.status;
              const sourceKind =
                sourceInput.kind === "read"
                  ? sourceInput.result.artifactKind
                  : sourceInput.record.kind;
              const copied = await writeWorkspaceMountSource(
                destinationMount,
                toPath,
                sourceContent,
                {
                  mimeType: sourceMimeType,
                  ...(sourceMetadata !== undefined
                    ? { metadata: sourceMetadata }
                    : {}),
                  ...(sourceStatus !== undefined ? { status: sourceStatus } : {}),
                  ...(sourceKind !== undefined ? { kind: sourceKind } : {}),
                  operation: "copy",
                },
              );
              if (!shouldSuppressWorkspaceChangeEvents(options)) {
                await config.emitChange?.({
                  type: destinationExists ? "update" : "create",
                  workspaceId: config.workspaceId,
                  namespace,
                  path: toPath,
                  at: copied.updatedAt,
                });
              }
              return copied;
            }
            const destination = await getRecord(
              config.store,
              config.workspaceId,
              namespace,
              toPath,
            );
            if (destination && !options?.overwrite) {
              throw new Error(
                `workspace.copy(): destination file already exists: "${toPath}".`,
              );
            }
            await assertWorkspaceWriteAllowed({
              store: config.store,
              workspaceId: config.workspaceId,
              namespace,
              path: toPath,
              nextSize: sourceSize,
              existing: destination,
              limits: config.limits,
            });
            const copied = sourceInput.kind === "read"
              ? await freshRecordFromReadResult(
                  namespace,
                  sourceInput.result,
                  toPath,
                  toMount.path,
                )
              : await freshRecordFromSource(
                  namespace,
                  sourceInput.record,
                  toPath,
                  toMount.path,
                );
            if (destination) {
              await purgeVersions(
                config.store,
                config.blobs,
                config.workspaceId,
                namespace,
                toPath,
                { currentBlobUri: destination.uri },
              );
            }
            await setFreshVersionedRecord(
              namespace,
              toPath,
              copied,
              destination,
            );
            if (!shouldSuppressWorkspaceChangeEvents(options)) {
              await config.emitChange?.({
                type: destination ? "update" : "create",
                workspaceId: config.workspaceId,
                namespace,
                path: toPath,
                at: copied.updatedAt,
              });
            }
            return recordToFile(copied);
          },
        );
      },
    );
  }

  async function grep(
    query: string,
    options?: WorkspaceGrepOptions,
  ): Promise<WorkspaceGrepResult> {
    const namespace = await namespaceFor(options);
    return instrument(
      {
        workspaceId: config.workspaceId,
        operation: "grep",
        namespace,
        path: options?.path ?? "/",
      },
      async () => {
        if (!query)
          throw new Error("workspace.grep(): query must be non-empty.");
        const scope = options?.path ? normalizePath(options.path) : undefined;
        const sourceMount = scope
          ? sourceMountForPath(scope, config.mounts)
          : undefined;
        if (sourceMount) {
          return grepWorkspaceMountSource(sourceMount, query, {
            ...(options?.path ? { path: scope } : {}),
            ...(options?.ignoreCase !== undefined
              ? { ignoreCase: options.ignoreCase }
              : {}),
            ...(options?.regex !== undefined ? { regex: options.regex } : {}),
            ...(options?.maxResults !== undefined
              ? { maxResults: options.maxResults }
              : {}),
          });
        }
        if (scope && !hasGlob(scope))
          mountForPath(scope, config.mounts, "read");
        const scopePattern =
          scope && hasGlob(scope) ? globToRegExp(scope) : undefined;
        const matcher = createWorkspaceTextMatcher(query, options);
        const records = (
          await listFileRecords(config.store, config.workspaceId, namespace)
        )
          .filter(
            (record) =>
              isInScope(record, scope, scopePattern) &&
              isReadableRecord(record, config.mounts),
          )
          .sort((a, b) => a.path.localeCompare(b.path));
        const matches: WorkspaceGrepMatch[] = [];
        const maxResults =
          options?.maxResults && options.maxResults > 0
            ? options.maxResults
            : 100;
        for (const record of records) {
          const text = await readRecordText(record);
          if (text === undefined) continue;
          for (const match of grepWorkspaceText(record.path, text, matcher)) {
            matches.push(match);
            if (matches.length >= maxResults) return { matches };
          }
        }
        if (!scope && matches.length < maxResults) {
          matches.push(
            ...(await grepWorkspaceSourceMounts({
              mounts: config.mounts,
              query,
              options,
              usedResults: matches.length,
            })),
          );
        }
        return { matches };
      },
    );
  }

  async function readExistingText(
    path: string,
    record: WorkspaceFileRecord,
  ): Promise<string> {
    const current = await recordToReadResult(record, {
      blobs: config.blobs,
      maxInlineBytes: Number.MAX_SAFE_INTEGER,
    });
    if (current.kind !== "text") {
      throw new Error(
        `workspace.append(): only text files can be appended. "${path}" is ${current.kind}.`,
      );
    }
    return current.content;
  }

  async function readRecordText(
    record: WorkspaceFileRecord,
  ): Promise<string | undefined> {
    const current = await recordToReadResult(record, {
      blobs: config.blobs,
      maxInlineBytes: Number.MAX_SAFE_INTEGER,
    });
    return current.kind === "text" ? current.content : undefined;
  }

  function mountAppendOptions(
    current: WorkspaceReadResult | null,
    options: WorkspaceAppendOptions | undefined,
  ): WorkspaceMountWriteOptions {
    return {
      ...(options?.mimeType !== undefined
        ? { mimeType: options.mimeType }
        : current?.mimeType !== undefined
          ? { mimeType: current.mimeType }
          : {}),
      ...(current?.metadata !== undefined ? { metadata: current.metadata } : {}),
      ...(current?.status !== undefined ? { status: current.status } : {}),
      ...(current?.artifactKind !== undefined
        ? { kind: current.artifactKind }
        : {}),
      operation: "append",
    };
  }

  return { exists, stat, append, rename, move, copy, grep };

  async function namespaceFor(
    options?: WorkspaceNamespaceOption,
  ): Promise<string> {
    if (options?.namespace !== undefined) {
      if (options.namespace.length === 0)
        throw new Error("workspace(): namespace override must be non-empty.");
      return options.namespace;
    }
    return config.resolveNamespace();
  }

  async function freshRecordFromSource(
    namespace: string,
    source: WorkspaceFileRecord,
    path: WorkspacePath,
    mount: WorkspacePath,
  ): Promise<WorkspaceFileRecord> {
    const content = await snapshotContent(source, config.blobs);
    const analysis = await analyzeContent(content, source.mimeType);
    return createFileRecord({
      workspaceId: config.workspaceId,
      namespace,
      path,
      mount,
      analysis,
      metadata: source.metadata,
      status: source.status,
      artifactKind: source.kind,
      producedBy: source.producedBy,
      existing: null,
      now: Date.now(),
      version: 1,
      inlineTextBelowBytes: config.inlineTextBelowBytes,
      blobs: config.blobs,
    });
  }

  async function getCopySourceRecord(
    namespace: string,
    path: WorkspacePath,
  ): Promise<WorkspaceFileRecord> {
    const source = await getRecord(
      config.store,
      config.workspaceId,
      namespace,
      path,
    );
    if (!source) {
      throw new Error(`workspace.copy(): source file not found: "${path}".`);
    }
    return source;
  }

  async function getCopySourceRead(
    mount: SourceBackedMount,
    path: WorkspacePath,
  ): Promise<{ readonly kind: "read"; readonly result: WorkspaceReadResult }> {
    const result = await readWorkspaceMountSource(mount, path, {
      maxInlineBytes: Number.MAX_SAFE_INTEGER,
    });
    if (!result) {
      throw new Error(`workspace.copy(): source file not found: "${path}".`);
    }
    if (result.kind === "text" && result.truncated) {
      throw new Error(
        `workspace.copy(): source-backed file "${path}" was truncated and cannot be copied.`,
      );
    }
    return { kind: "read", result };
  }

  async function freshRecordFromReadResult(
    namespace: string,
    result: WorkspaceReadResult,
    path: WorkspacePath,
    mount: WorkspacePath,
  ): Promise<WorkspaceFileRecord> {
    return createFileRecordFromReadResult({
      workspaceId: config.workspaceId,
      namespace,
      path,
      mount,
      result,
      inlineTextBelowBytes: config.inlineTextBelowBytes,
      blobs: config.blobs,
    });
  }

  async function setFreshVersionedRecord(
    namespace: string,
    path: WorkspacePath,
    record: WorkspaceFileRecord,
    previous: WorkspaceFileRecord | null,
  ): Promise<void> {
    const key = fileKey(config.workspaceId, namespace, path);
    const setOptions = workspaceSetOptions(config.store, config.retention);
    await config.store.put(key, record as unknown as JsonObject, setOptions);
    try {
      await recordFileVersion({
        store: config.store,
        blobs: config.blobs,
        workspaceId: config.workspaceId,
        namespace,
        path,
        record,
        operation: "write",
        versioning: config.versioning,
        setOptions,
      });
    } catch (error) {
      if (previous) {
        await config.store.put(
          key,
          previous as unknown as JsonObject,
          setOptions,
        );
      } else {
        await config.store.delete(key);
      }
      throw error;
    }
  }
}

function isInScope(
  record: WorkspaceFileRecord,
  scope: ReturnType<typeof normalizePath> | undefined,
  scopePattern: RegExp | undefined,
): boolean {
  if (!scope) return true;
  if (scopePattern) return scopePattern.test(record.path);
  return record.path === scope;
}

function isReadableRecord(
  record: WorkspaceFileRecord,
  mounts: readonly NormalizedMount[],
): boolean {
  try {
    mountForPath(normalizePath(record.path), mounts, "read");
    return true;
  } catch {
    return false;
  }
}
