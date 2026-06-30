/**
 * Workspace virtual mount source helpers.
 *
 * Keeps provider-backed read semantics out of the main workspace factory while
 * preserving the same normalized path and text-windowing behavior as store-
 * backed files.
 *
 * @module
 */

import { globToRegExp, hasGlob } from "./glob";
import { workspaceMountSourceToCustomSource } from "./mount-source";
import { normalizePath } from "./path";
import { virtualFileFromReadResult } from "./read-result-file";
import { createWorkspaceTextMatcher, grepWorkspaceText } from "./text-search";
import { workspaceTextByteWindow } from "./text-window";
import type {
  NormalizedMount,
  WorkspaceFile,
  WorkspaceGrepMatch,
  WorkspaceGrepResult,
  WorkspaceListEntry,
  WorkspaceListResult,
  WorkspaceMountGrepOptions,
  WorkspaceMountListOptions,
  WorkspaceMountReadOptions,
  WorkspacePath,
  WorkspaceReadResult,
} from "./types";

export type SourceBackedMount = NormalizedMount & {
  readonly source: NonNullable<NormalizedMount["source"]>;
};

/** Return whether a normalized mount has a provider-backed source. */
export function hasWorkspaceMountSource(
  mount: NormalizedMount,
): mount is SourceBackedMount {
  return mount.source !== undefined;
}

/** Reject writes that would otherwise fall through to the local workspace store. */
export function assertWorkspaceMountIsLocal(
  mount: NormalizedMount,
  operation: string,
): void {
  if (!hasWorkspaceMountSource(mount)) return;
  throw new Error(
    `workspace.${operation}(): source-backed mount "${mount.path}" does not support writes.`,
  );
}

/** Resolve the deepest source-backed mount that covers a normalized query path. */
export function sourceMountForPath(
  path: WorkspacePath,
  mounts: readonly NormalizedMount[],
): SourceBackedMount | undefined {
  return mounts
    .filter(
      (mount): mount is SourceBackedMount =>
        hasWorkspaceMountSource(mount) &&
        (path === mount.path || path.startsWith(`${mount.path}/`)),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** List entries from a source-backed mount and normalize them into workspace paths. */
export async function listWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
  options: WorkspaceMountListOptions = {},
): Promise<WorkspaceListResult> {
  const sourceOptions = { ...options, mountPath: mount.path };
  const source = workspaceMountSourceToCustomSource(mount.source);
  const result = await source.list(path, sourceOptions);
  const entries = result.entries.map((entry) => normalizeListEntry(entry, mount));
  const maxEntries =
    options.limit === undefined
      ? entries.length
      : Math.max(0, Math.floor(options.limit));
  return {
    entries: entries.slice(0, maxEntries),
    ...(result.cursor ? { cursor: result.cursor } : {}),
  };
}

/** Search files under a source-backed mount. */
export async function grepWorkspaceMountSource(
  mount: SourceBackedMount,
  query: string,
  options: WorkspaceMountGrepOptions = {},
): Promise<WorkspaceGrepResult> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  if (source.grep) {
    const result = await source.grep(query, {
      ...options,
      mountPath: mount.path,
    });
    return {
      matches: clampMatches(
        result.matches.map((match) => normalizeGrepMatch(match, mount)),
        options.maxResults,
      ),
    };
  }

  const scope = options.path ? normalizePath(options.path) : mount.path;
  const scopePattern = hasGlob(scope) ? globToRegExp(scope) : undefined;
  const matcher = createWorkspaceTextMatcher(query, options);
  const matches: WorkspaceGrepMatch[] = [];
  const maxResults =
    options.maxResults && options.maxResults > 0 ? options.maxResults : 100;
  const pageLimit = maxResults;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  let sawListedFile = false;

  do {
    const listing = await listWorkspaceMountSource(mount, scope, {
      limit: pageLimit,
      ...(cursor ? { cursor } : {}),
    });
    const files = listing.entries
      .filter((entry): entry is WorkspaceFile => entry.kind === "file")
      .filter((entry) => isInScope(entry.path, scope, scopePattern))
      .sort((a, b) => a.path.localeCompare(b.path));
    sawListedFile ||= files.length > 0;

    for (const file of files) {
      const result = await readWorkspaceMountSource(
        mount,
        normalizePath(file.path),
        { maxInlineBytes: Number.MAX_SAFE_INTEGER, mountPath: mount.path },
      );
      if (result?.kind !== "text") continue;
      for (const match of grepWorkspaceText(
        result.path,
        result.content,
        matcher,
      )) {
        matches.push(match);
        if (matches.length >= maxResults) return { matches };
      }
    }

    cursor = listing.cursor;
    if (cursor) {
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
    }
  } while (cursor);

  if (!scopePattern && !sawListedFile && scope !== mount.path) {
    const result = await readWorkspaceMountSource(mount, scope, {
      maxInlineBytes: Number.MAX_SAFE_INTEGER,
      mountPath: mount.path,
    });
    const directMatches =
      result?.kind === "text"
        ? grepWorkspaceText(result.path, result.content, matcher)
        : [];
    return { matches: directMatches.slice(0, maxResults) };
  }

  return { matches };
}

/** Check whether a source-backed mount contains a normalized workspace path. */
export async function existsWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
): Promise<boolean> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  if (source.exists) return source.exists(path, { mountPath: mount.path });
  if (source.stat)
    return (await statWorkspaceMountSource(mount, path)) !== null;
  return (await readWorkspaceMountSource(mount, path)) !== null;
}

/** Return source-backed file metadata for a normalized workspace path. */
export async function statWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
): Promise<WorkspaceFile | null> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  if (source.stat) {
    const result = await source.stat(path, { mountPath: mount.path });
    return result ? normalizeFile(result, mount) : null;
  }
  const result = await readWorkspaceMountSource(mount, path);
  return result ? virtualFileFromReadResult(result, mount.path) : null;
}

/**
 * Read a normalized workspace path from a source-backed mount.
 *
 * The workspace owns the public path in the returned read result. This prevents
 * providers from leaking native resource identifiers or returning content for a
 * path outside their mounted root.
 */
export async function readWorkspaceMountSource(
  mount: SourceBackedMount,
  path: WorkspacePath,
  options: WorkspaceMountReadOptions = {},
): Promise<WorkspaceReadResult | null> {
  const source = workspaceMountSourceToCustomSource(mount.source);
  const result = await source.read(path, { ...options, mountPath: mount.path });
  return result ? normalizeReadResultPath(result, path, options) : null;
}

function normalizeListEntry(
  entry: WorkspaceListEntry,
  mount: SourceBackedMount,
): WorkspaceListEntry {
  const path = normalizeProviderEntryPath(entry.path, mount);
  if (entry.kind === "directory") {
    return { ...entry, path, mount: mount.path };
  }
  return normalizeFile(entry, mount);
}

function normalizeGrepMatch(
  match: WorkspaceGrepMatch,
  mount: SourceBackedMount,
): WorkspaceGrepMatch {
  return {
    ...match,
    path: normalizeProviderEntryPath(match.path, mount),
  };
}

function normalizeFile(
  file: WorkspaceFile,
  mount: SourceBackedMount,
): WorkspaceFile {
  const path = normalizeProviderEntryPath(file.path, mount);
  return { ...file, path, mount: mount.path, storage: "virtual" };
}

function isInScope(
  path: string,
  scope: WorkspacePath,
  scopePattern: RegExp | undefined,
): boolean {
  if (scopePattern) return scopePattern.test(path);
  return path === scope || path.startsWith(`${scope}/`);
}

function clampMatches(
  matches: readonly WorkspaceGrepMatch[],
  maxResults: number | undefined,
): readonly WorkspaceGrepMatch[] {
  return matches.slice(0, maxResults && maxResults > 0 ? maxResults : 100);
}

function normalizeProviderEntryPath(
  rawPath: string,
  mount: SourceBackedMount,
): WorkspacePath {
  const path = normalizePath(rawPath);
  if (path !== mount.path && !path.startsWith(`${mount.path}/`)) {
    throw new Error(
      `workspace mount source "${mount.source.kind}" returned path outside mount "${mount.path}".`,
    );
  }
  return path;
}

function normalizeReadResultPath(
  result: WorkspaceReadResult,
  path: WorkspacePath,
  options: WorkspaceMountReadOptions,
): WorkspaceReadResult {
  if (result.kind !== "text") return { ...result, path };

  const maxInlineBytes = options.maxInlineBytes;
  if (maxInlineBytes === undefined && options.offset === undefined) {
    return { ...result, path };
  }

  const window = workspaceTextByteWindow(
    result.content,
    maxInlineBytes ?? Number.MAX_SAFE_INTEGER,
    options.offset,
  );
  return {
    ...result,
    path,
    content: window.content,
    ...(window.truncated ? { truncated: true } : {}),
    ...(window.offset > 0 ? { offset: window.offset } : {}),
  };
}
