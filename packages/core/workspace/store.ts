/**
 * Workspace file-record persistence and listing.
 *
 * Keys records by workspace id + namespace + path in a {@link DataStore}, and
 * derives directory/glob listings from the stored set.
 *
 * @module
 */

import type { DataStore, JsonObject } from '../store/types'
import { recordToFile } from './content'
import { globToRegExp } from './glob'
import {
  FILE_RECORD_VERSION,
  type NormalizedMount,
  type WorkspaceDirectory,
  type WorkspaceFile,
  type WorkspaceFileRecord,
  type WorkspaceListEntry,
  type WorkspacePath,
} from './types'

function filePrefix(workspaceId: string, namespace: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(namespace)}:file:`
}

/** The data-store key for a single workspace file. */
export function fileKey(workspaceId: string, namespace: string, path: WorkspacePath): string {
  return `${filePrefix(workspaceId, namespace)}${encodeURIComponent(path)}`
}

/** Read a stored file record, or `null` if absent/malformed. */
export async function getRecord(
  store: DataStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord | null> {
  const value = await store.get(fileKey(workspaceId, namespace, path))
  return isFileRecord(value) ? value : null
}

/** Read a stored file record or throw if it does not exist. */
export async function getRequiredRecord(
  store: DataStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord> {
  const record = await getRecord(store, workspaceId, namespace, path)
  if (!record) throw new Error(`workspace file not found: "${path}".`)
  return record
}

/** List directory or glob entries beneath a query path. */
export async function listEntries(input: {
  readonly store: DataStore
  readonly workspaceId: string
  readonly namespace: string
  readonly mounts: readonly NormalizedMount[]
  readonly queryPath: WorkspacePath
  readonly isGlob: boolean
  readonly limit?: number
  readonly matchedMount?: NormalizedMount
}): Promise<WorkspaceListEntry[]> {
  if (input.queryPath === '/') {
    return input.mounts.map((mount) => ({ kind: 'directory', path: mount.path, mount: mount.path }))
  }

  const prefix = filePrefix(input.workspaceId, input.namespace)
  const listed = await input.store.list(prefix)
  const records = listed.entries.flatMap((entry) => (isFileRecord(entry.value) ? [entry.value] : []))
  const entries = input.isGlob
    ? records.filter((record) => globToRegExp(input.queryPath).test(record.path)).map(recordToFile)
    : directoryEntries(records, input.queryPath, input.matchedMount)
  return entries.slice(0, input.limit ?? entries.length)
}

/** List every file record in a namespace as {@link WorkspaceFile} entries. */
export async function listAllFileEntries(
  store: DataStore,
  workspaceId: string,
  namespace: string,
): Promise<WorkspaceFile[]> {
  const listed = await store.list(filePrefix(workspaceId, namespace))
  return listed.entries.flatMap((entry) => (isFileRecord(entry.value) ? [recordToFile(entry.value)] : []))
}

function directoryEntries(
  records: readonly WorkspaceFileRecord[],
  dir: WorkspacePath,
  mount: NormalizedMount | undefined,
): WorkspaceListEntry[] {
  const prefix = dir === '/' ? '/' : `${dir}/`
  const files = new Map<string, WorkspaceFile>()
  const dirs = new Map<string, WorkspaceDirectory>()

  for (const record of records) {
    if (!record.path.startsWith(prefix)) continue
    const rest = record.path.slice(prefix.length)
    if (!rest) continue
    const [first, ...remaining] = rest.split('/')
    const childPath = `${dir === '/' ? '' : dir}/${first}` as WorkspacePath
    if (remaining.length > 0) {
      dirs.set(childPath, { kind: 'directory', path: childPath, mount: record.mount })
    } else {
      files.set(childPath, recordToFile(record))
    }
  }

  if (mount && dir === mount.path) {
    for (const candidate of records) {
      if (candidate.path === mount.path) files.set(candidate.path, recordToFile(candidate))
    }
  }

  return [...dirs.values(), ...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}

function isFileRecord(value: JsonObject | null): value is WorkspaceFileRecord {
  return value?._cruxWorkspaceFile === true && value.version === FILE_RECORD_VERSION && typeof value.path === 'string'
}
