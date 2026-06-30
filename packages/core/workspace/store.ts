/**
 * Workspace file-record persistence and listing.
 *
 * Keys records by workspace id + namespace + path in a {@link RecordStore}, and
 * derives directory/glob listings from the stored set.
 *
 * @module
 */

import type { ExactFilter, JsonObject, RecordStore } from "../storage";
import { recordToFile } from "./content";
import { globToRegExp } from "./glob";
import { mountForPath, normalizePath } from "./path";
import {
  FILE_RECORD_VERSION,
  type NormalizedMount,
  type WorkspaceDirectory,
  type WorkspaceFile,
  type WorkspaceFileRecord,
  type WorkspaceListEntry,
  type WorkspacePath,
} from "./types";

function filePrefix(workspaceId: string, namespace: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(namespace)}:file:`;
}

/** The data-store key for a single workspace file. */
export function fileKey(
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): string {
  return `${filePrefix(workspaceId, namespace)}${encodeURIComponent(path)}`;
}

/** Read a stored file record, or `null` if absent/malformed. */
export async function getRecord(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord | null> {
  const value = await store.get(fileKey(workspaceId, namespace, path));
  return isFileRecord(value) ? value : null;
}

/** Read a stored file record or throw if it does not exist. */
export async function getRequiredRecord(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord> {
  const record = await getRecord(store, workspaceId, namespace, path);
  if (!record) throw new Error(`workspace file not found: "${path}".`);
  return record;
}

/** List directory or glob entries beneath a query path. */
export async function listEntries(input: {
  readonly store: RecordStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly mounts: readonly NormalizedMount[];
  readonly queryPath: WorkspacePath;
  readonly isGlob: boolean;
  readonly limit?: number;
  readonly cursor?: string;
  readonly matchedMount?: NormalizedMount;
}): Promise<{
  readonly entries: WorkspaceListEntry[];
  readonly cursor?: string;
}> {
  if (input.queryPath === "/") {
    return {
      entries: input.mounts.map((mount) => ({
        kind: "directory",
        path: mount.path,
        mount: mount.path,
      })),
    };
  }

  const prefix = filePrefix(input.workspaceId, input.namespace);
  const glob = input.isGlob ? globToRegExp(input.queryPath) : undefined;
  const limit = input.limit;
  const entries: WorkspaceListEntry[] = [];
  let cursor = input.cursor;
  let nextCursor: string | undefined;
  do {
    const listed = await input.store.list(prefix, { limit, cursor });
    nextCursor = listed.cursor;
    const records = listed.entries.flatMap((entry) =>
      isFileRecord(entry.value) ? [entry.value] : [],
    );
    const pageEntries = input.isGlob
      ? records
          .filter(
            (record) =>
              (glob ? glob.test(record.path) : false) &&
              isReadableRecord(record, input.mounts),
          )
          .map(recordToFile)
      : directoryEntries(records, input.queryPath, input.matchedMount);
    entries.push(...pageEntries);
    cursor = listed.cursor;
  } while (nextCursor && (limit === undefined || entries.length < limit));
  return {
    entries: entries.slice(0, limit ?? entries.length),
    ...(nextCursor ? { cursor: nextCursor } : {}),
  };
}

/** List every file record in a namespace as {@link WorkspaceFile} entries. */
export async function listAllFileEntries(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  options: { readonly limit?: number } = {},
): Promise<{ readonly entries: WorkspaceFile[]; readonly cursor?: string }> {
  const listed = await store.list(filePrefix(workspaceId, namespace), {
    limit: options.limit,
  });
  return {
    entries: listed.entries.flatMap((entry) =>
      isFileRecord(entry.value) ? [recordToFile(entry.value)] : [],
    ),
    ...(listed.cursor ? { cursor: listed.cursor } : {}),
  };
}

/** List stored file records in a namespace. */
export async function listFileRecords(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  options: {
    readonly filter?: ExactFilter;
    readonly limit?: number;
  } = {},
): Promise<readonly WorkspaceFileRecord[]> {
  const listed = await store.list(filePrefix(workspaceId, namespace), {
    ...(options.filter ? { filter: options.filter } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });
  return listed.entries.flatMap((entry) =>
    isFileRecord(entry.value) ? [entry.value] : [],
  );
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

function directoryEntries(
  records: readonly WorkspaceFileRecord[],
  dir: WorkspacePath,
  mount: NormalizedMount | undefined,
): WorkspaceListEntry[] {
  const prefix = dir === "/" ? "/" : `${dir}/`;
  const files = new Map<string, WorkspaceFile>();
  const dirs = new Map<string, WorkspaceDirectory>();

  for (const record of records) {
    if (!record.path.startsWith(prefix)) continue;
    const rest = record.path.slice(prefix.length);
    if (!rest) continue;
    const [first, ...remaining] = rest.split("/");
    const childPath = `${dir === "/" ? "" : dir}/${first}` as WorkspacePath;
    if (remaining.length > 0) {
      dirs.set(childPath, {
        kind: "directory",
        path: childPath,
        mount: record.mount,
      });
    } else {
      files.set(childPath, recordToFile(record));
    }
  }

  if (mount && dir === mount.path) {
    for (const candidate of records) {
      if (candidate.path === mount.path)
        files.set(candidate.path, recordToFile(candidate));
    }
  }

  return [...dirs.values(), ...files.values()].sort((a, b) =>
    a.path.localeCompare(b.path),
  );
}

function isFileRecord(value: unknown): value is WorkspaceFileRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as { _cruxWorkspaceFile?: unknown; version?: unknown; path?: unknown };
  return (
    record._cruxWorkspaceFile === true &&
    record.version === FILE_RECORD_VERSION &&
    typeof record.path === "string"
  );
}
