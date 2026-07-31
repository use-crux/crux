/**
 * Retriever-backed workspace mount source adapter.
 *
 * Adapts a {@link Retriever} into the path-addressed custom mount source
 * contract. The adapter materializes the current retrieval result set as
 * read-only virtual text files under the mounted root.
 *
 * @module
 */

import type { Retriever, RetrieverHit } from "../retrieval/types";
import type { JsonValue } from "../types/tool";
import { globToRegExp, hasGlob } from "./glob";
import { isJsonValue } from "./json-value";
import { normalizePath } from "./path";
import { createWorkspaceTextMatcher, grepWorkspaceText } from "./text-search";
import type {
  WorkspaceRetrieverMountQueryInput,
  WorkspaceRetrieverMountSourceOptions,
} from "./retriever-source-types";
import { byteLength } from "./text-utils";
import type {
  WorkspaceCustomMountSource,
  WorkspaceFile,
  WorkspaceGrepResult,
  WorkspaceMountGrepOptions,
  WorkspaceMountReadOptions,
  WorkspacePath,
} from "./types";

export type {
  WorkspaceRetrieverMountOperation,
  WorkspaceRetrieverMountQueryInput,
  WorkspaceRetrieverMountSource,
  WorkspaceRetrieverMountSourceOptions,
} from "./retriever-source-types";

/**
 * Create a read-only workspace mount source backed by a retriever.
 *
 * @param retriever - Retriever whose hits should be projected as virtual files.
 * @param options - Query, path mapping, content mapping, and result limits.
 * @returns A {@link WorkspaceCustomMountSource} suitable for `mount.source`.
 */
export function retrieverWorkspaceMountSource(
  retriever: Retriever,
  options: WorkspaceRetrieverMountSourceOptions = {},
): WorkspaceCustomMountSource {
  return {
    kind: "custom",
    async list(path, listOptions) {
      const files = await resolveFiles(retriever, options, {
        operation: "list",
        path,
        mountPath: listOptions?.mountPath,
      });
      const scope = normalizePath(path);
      const scopePattern = hasGlob(scope) ? globToRegExp(scope) : undefined;
      const limit =
        listOptions?.limit !== undefined
          ? Math.max(0, Math.floor(listOptions.limit))
          : undefined;
      const entries = files
        .filter((file) => isInScope(file.path, scope, scopePattern))
        .map(toWorkspaceFile);
      return {
        entries: entries.slice(0, limit ?? entries.length),
      };
    },
    async read(path, readOptions) {
      const file = await findFile(retriever, options, {
        operation: "read",
        path,
        mountPath: readOptions?.mountPath,
      });
      if (!file) return null;
      return {
        kind: "text",
        path: file.path,
        mimeType: file.mimeType,
        content: file.content,
        size: file.size,
        ...(file.metadata ? { metadata: file.metadata } : {}),
      };
    },
    async grep(query, grepOptions) {
      const files = await resolveFiles(retriever, options, {
        operation: "grep",
        query,
        path: grepOptions?.path,
        mountPath: grepOptions?.mountPath,
      });
      return grepFiles(files, query, grepOptions);
    },
    async exists(path, existsOptions) {
      return (
        (await findFile(retriever, options, {
          operation: "exists",
          path,
          mountPath: existsOptions?.mountPath,
        })) !== null
      );
    },
    async stat(path, statOptions) {
      const file = await findFile(retriever, options, {
        operation: "stat",
        path,
        mountPath: statOptions?.mountPath,
      });
      return file ? toWorkspaceFile(file) : null;
    },
  };
}

interface ResolveFilesInput extends WorkspaceRetrieverMountQueryInput {
  readonly mountPath?: string;
}

interface RetrieverVirtualFile {
  readonly path: WorkspacePath;
  readonly content: string;
  readonly mimeType: string;
  readonly size: number;
  readonly metadata?: Record<string, JsonValue>;
}

async function findFile(
  retriever: Retriever,
  options: WorkspaceRetrieverMountSourceOptions,
  input: ResolveFilesInput,
): Promise<RetrieverVirtualFile | null> {
  const files = await resolveFiles(retriever, options, input);
  const path = input.path ? normalizePath(input.path) : undefined;
  return files.find((file) => file.path === path) ?? null;
}

async function resolveFiles(
  retriever: Retriever,
  options: WorkspaceRetrieverMountSourceOptions,
  input: ResolveFilesInput,
): Promise<readonly RetrieverVirtualFile[]> {
  const query = await resolveQuery(options, input);
  const hits = await retriever.retrieve(query, {
    limit: options.limit,
  });
  const mountPath = normalizePath(input.mountPath ?? mountFromPath(input.path));
  const files = new Map<string, RetrieverVirtualFile>();
  for (const hit of hits) {
    const file = hitToFile(hit, mountPath, options);
    if (!files.has(file.path)) files.set(file.path, file);
  }
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path));
}

async function resolveQuery(
  options: WorkspaceRetrieverMountSourceOptions,
  input: WorkspaceRetrieverMountQueryInput,
): Promise<string> {
  if (input.operation === "grep" && input.query) {
    return input.query;
  }
  if (typeof options.query === "function") {
    return options.query(input);
  }
  if (typeof options.query === "string") {
    return options.query;
  }
  return input.query ?? input.path ?? "";
}

function hitToFile(
  hit: RetrieverHit,
  mountPath: WorkspacePath,
  options: WorkspaceRetrieverMountSourceOptions,
): RetrieverVirtualFile {
  const content =
    options.contentForHit?.(hit) ?? (hit.kind === "finding" ? hit.content : hit.parent?.content ?? hit.content);
  const mimeType =
    typeof options.mimeType === "function"
      ? options.mimeType(hit)
      : (options.mimeType ?? "text/markdown");
  return {
    path: hitWorkspacePath(hit, mountPath, options),
    content,
    mimeType,
    size: byteLength(content),
    metadata: hitMetadata(hit),
  };
}

function hitWorkspacePath(
  hit: RetrieverHit,
  mountPath: WorkspacePath,
  options: WorkspaceRetrieverMountSourceOptions,
): WorkspacePath {
  const configuredPath = options.pathForHit?.(hit);
  const rawPath = configuredPath ?? (hit.kind === "finding"
    ? `findings/${hit.citation.findingTarget}.md`
    : hit.source.path?.replace(/^\/+/, "") ?? `${hit.source.id}/${hit.chunkId}.md`);
  const candidate = rawPath.startsWith("/")
    ? normalizePath(rawPath)
    : normalizePath(`${mountPath}/${rawPath}`);
  if (candidate !== mountPath && candidate.startsWith(`${mountPath}/`)) {
    return candidate;
  }
  throw new Error(
    `retrieverWorkspaceMountSource(): hit path "${rawPath}" is outside mount "${mountPath}".`,
  );
}

function hitMetadata(hit: RetrieverHit): Record<string, JsonValue> | undefined {
  if (hit.kind === "finding") {
    return { findingTarget: hit.citation.findingTarget };
  }
  const metadata: Record<string, JsonValue> = {
    sourceId: hit.source.id,
    chunkId: hit.chunkId,
  };
  for (const [key, value] of Object.entries(hit.metadata)) {
    if (isJsonValue(value)) metadata[key] = value;
  }
  return metadata;
}

function toWorkspaceFile(file: RetrieverVirtualFile): WorkspaceFile {
  return {
    kind: "file",
    path: file.path,
    mount: mountFromPath(file.path),
    mimeType: file.mimeType,
    size: file.size,
    storage: "virtual",
    ...(file.metadata ? { metadata: file.metadata } : {}),
    createdAt: 0,
    updatedAt: 0,
  };
}

function grepFiles(
  files: readonly RetrieverVirtualFile[],
  query: string,
  options: WorkspaceMountGrepOptions | undefined,
): WorkspaceGrepResult {
  const matcher = createWorkspaceTextMatcher(query, options);
  const scope = options?.path ? normalizePath(options.path) : undefined;
  const scopePattern =
    scope && hasGlob(scope) ? globToRegExp(scope) : undefined;
  const matches = files
    .filter((file) => !scope || isInScope(file.path, scope, scopePattern))
    .flatMap((file) => grepWorkspaceText(file.path, file.content, matcher));
  return {
    matches: matches.slice(
      0,
      options?.maxResults && options.maxResults > 0 ? options.maxResults : 100,
    ),
  };
}

function isInScope(
  path: string,
  scope: string,
  scopePattern?: RegExp,
): boolean {
  if (scopePattern) return scopePattern.test(path);
  return path === scope || path.startsWith(`${scope}/`);
}

function mountFromPath(path: string | undefined): WorkspacePath {
  const normalized = normalizePath(path ?? "/sources");
  const [, first] = normalized.split("/");
  return normalizePath(`/${first ?? "sources"}`);
}
