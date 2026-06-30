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
import { globToRegExp, hasGlob } from "./glob";
import { instrument } from "./observability";
import { mountForPath, normalizePath } from "./path";
import { recordToReadResult } from "./read-result";
import { fileKey, getRecord, listFileRecords } from "./store";
import { snapshotContent } from "./version-content";
import { purgeVersions, recordFileVersion } from "./version-store";
import {
  assertWorkspaceWriteAllowed,
  withWorkspaceWriteLock,
  workspaceSetOptions,
} from "./limits";
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
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
  WorkspacePath,
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
        mountForPath(normalized, config.mounts, "read");
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
        mountForPath(normalized, config.mounts, "read");
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
        mountForPath(fromPath, config.mounts, "write");
        const toMount = mountForPath(toPath, config.mounts, "write");
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
        mountForPath(fromPath, config.mounts, "read");
        const toMount = mountForPath(toPath, config.mounts, "write");
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
                `workspace.copy(): source file not found: "${fromPath}".`,
              );
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
              nextSize: source.size,
              existing: destination,
              limits: config.limits,
            });
            const copied = await freshRecordFromSource(
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
              copied,
              destination,
            );
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
        if (scope && !hasGlob(scope))
          mountForPath(scope, config.mounts, "read");
        const scopePattern =
          scope && hasGlob(scope) ? globToRegExp(scope) : undefined;
        const matcher = createMatcher(query, options);
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
          for (const match of grepText(record.path, text, matcher)) {
            matches.push(match);
            if (matches.length >= maxResults) return { matches };
          }
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

function createMatcher(
  query: string,
  options: WorkspaceGrepOptions | undefined,
): RegExp {
  return new RegExp(
    options?.regex ? query : escapeRegExp(query),
    options?.ignoreCase ? "gi" : "g",
  );
}

function grepText(
  path: string,
  content: string,
  matcher: RegExp,
): WorkspaceGrepMatch[] {
  const matches: WorkspaceGrepMatch[] = [];
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!;
    matcher.lastIndex = 0;
    let match = matcher.exec(line);
    while (match) {
      matches.push({
        path,
        line: lineIndex + 1,
        column: match.index + 1,
        text: line,
      });
      if (match[0].length === 0) matcher.lastIndex += 1;
      match = matcher.exec(line);
    }
  }
  return matches;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
