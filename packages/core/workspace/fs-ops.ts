/**
 * Filesystem-style workspace operations.
 *
 * Keeps higher-level file operations out of the {@link workspace} factory while
 * sharing the same path validation, namespace override, and instrumentation
 * rules as the core read/write/list methods.
 *
 * @module
 */

import type { DataStore } from '../store/types'
import { analyzeContent, createFileRecord, recordToFile } from './content'
import { globToRegExp, hasGlob } from './glob'
import { instrument } from './observability'
import { mountForPath, normalizePath } from './path'
import { recordToReadResult } from './read-result'
import { fileKey, getRecord, listFileRecords } from './store'
import type {
  NormalizedMount,
  WorkspaceAppendOptions,
  WorkspaceBlobStore,
  WorkspaceFile,
  WorkspaceFileRecord,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
} from './types'

/** Bound dependencies for filesystem-style workspace operations. */
export interface WorkspaceFilesystemOpsConfig {
  readonly workspaceId: string
  readonly store: DataStore
  readonly blobs?: WorkspaceBlobStore
  readonly mounts: readonly NormalizedMount[]
  readonly inlineTextBelowBytes: number
  readonly resolveNamespace: () => Promise<string>
}

/** Public filesystem-style operations mixed into a {@link Workspace}. */
export interface WorkspaceFilesystemOps {
  /** Check whether a readable file exists at `path`. */
  exists(path: string, options?: WorkspaceNamespaceOption): Promise<boolean>
  /** Return public file metadata for `path`, or `null` when it is absent. */
  stat(path: string, options?: WorkspaceNamespaceOption): Promise<WorkspaceFile | null>
  /** Append text to a file, creating it when absent. */
  append(path: string, content: string, options?: WorkspaceAppendOptions): Promise<WorkspaceFile>
  /** Move a file to a new path. */
  rename(from: string, to: string, options?: WorkspaceMoveOptions): Promise<WorkspaceFile>
  /** Alias for {@link WorkspaceFilesystemOps.rename}. */
  move(from: string, to: string, options?: WorkspaceMoveOptions): Promise<WorkspaceFile>
  /** Copy a file to a new path. */
  copy(from: string, to: string, options?: WorkspaceMoveOptions): Promise<WorkspaceFile>
  /** Search text files and return line-oriented matches. */
  grep(query: string, options?: WorkspaceGrepOptions): Promise<WorkspaceGrepResult>
}

/** Create filesystem-style operations for one workspace instance. */
export function createWorkspaceFilesystemOps(config: WorkspaceFilesystemOpsConfig): WorkspaceFilesystemOps {
  async function exists(path: string, options?: WorkspaceNamespaceOption): Promise<boolean> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'exists', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, config.mounts, 'read')
      return (await getRecord(config.store, config.workspaceId, namespace, normalized)) !== null
    })
  }

  async function stat(path: string, options?: WorkspaceNamespaceOption): Promise<WorkspaceFile | null> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'stat', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, config.mounts, 'read')
      const record = await getRecord(config.store, config.workspaceId, namespace, normalized)
      return record ? recordToFile(record) : null
    })
  }

  async function append(path: string, content: string, options?: WorkspaceAppendOptions): Promise<WorkspaceFile> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'append', namespace, path }, async () => {
      const normalized = normalizePath(path)
      const mount = mountForPath(normalized, config.mounts, 'write')
      const existing = await getRecord(config.store, config.workspaceId, namespace, normalized)
      const currentContent = existing ? await readExistingText(path, existing) : ''
      const analysis = await analyzeContent(`${currentContent}${content}`, options?.mimeType ?? existing?.mimeType)
      const now = Date.now()
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
        inlineTextBelowBytes: config.inlineTextBelowBytes,
        blobs: config.blobs,
      })
      await config.store.set(fileKey(config.workspaceId, namespace, normalized), record)
      return recordToFile(record)
    })
  }

  async function rename(from: string, to: string, options?: WorkspaceMoveOptions): Promise<WorkspaceFile> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'rename', namespace, path: from }, async () => {
      const fromPath = normalizePath(from)
      const toPath = normalizePath(to)
      mountForPath(fromPath, config.mounts, 'write')
      const toMount = mountForPath(toPath, config.mounts, 'write')
      const source = await getRecord(config.store, config.workspaceId, namespace, fromPath)
      if (!source) throw new Error(`workspace.rename(): source file not found: "${fromPath}".`)
      const destination = await getRecord(config.store, config.workspaceId, namespace, toPath)
      if (destination && !options?.overwrite) {
        throw new Error(`workspace.rename(): destination file already exists: "${toPath}".`)
      }
      const moved: WorkspaceFileRecord = {
        ...source,
        path: toPath,
        mount: toMount.path,
        updatedAt: Date.now(),
      }
      await config.store.set(fileKey(config.workspaceId, namespace, toPath), moved)
      await config.store.delete(fileKey(config.workspaceId, namespace, fromPath))
      return recordToFile(moved)
    })
  }

  async function copy(from: string, to: string, options?: WorkspaceMoveOptions): Promise<WorkspaceFile> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'copy', namespace, path: from }, async () => {
      const fromPath = normalizePath(from)
      const toPath = normalizePath(to)
      mountForPath(fromPath, config.mounts, 'read')
      const toMount = mountForPath(toPath, config.mounts, 'write')
      const source = await getRecord(config.store, config.workspaceId, namespace, fromPath)
      if (!source) throw new Error(`workspace.copy(): source file not found: "${fromPath}".`)
      const destination = await getRecord(config.store, config.workspaceId, namespace, toPath)
      if (destination && !options?.overwrite) {
        throw new Error(`workspace.copy(): destination file already exists: "${toPath}".`)
      }
      const copied: WorkspaceFileRecord = {
        ...source,
        path: toPath,
        mount: toMount.path,
        updatedAt: Date.now(),
      }
      await config.store.set(fileKey(config.workspaceId, namespace, toPath), copied)
      return recordToFile(copied)
    })
  }

  async function grep(query: string, options?: WorkspaceGrepOptions): Promise<WorkspaceGrepResult> {
    const namespace = options?.namespace ?? (await config.resolveNamespace())
    return instrument({ workspaceId: config.workspaceId, operation: 'grep', namespace, path: options?.path ?? '/' }, async () => {
      if (!query) throw new Error('workspace.grep(): query must be non-empty.')
      const scope = options?.path ? normalizePath(options.path) : undefined
      if (scope && !hasGlob(scope)) mountForPath(scope, config.mounts, 'read')
      const scopePattern = scope && hasGlob(scope) ? globToRegExp(scope) : undefined
      const matcher = createMatcher(query, options?.ignoreCase)
      const records = (await listFileRecords(config.store, config.workspaceId, namespace))
        .filter((record) => isInScope(record, scope, scopePattern))
        .sort((a, b) => a.path.localeCompare(b.path))
      const matches: WorkspaceGrepMatch[] = []
      const maxResults = options?.maxResults && options.maxResults > 0 ? options.maxResults : 100
      for (const record of records) {
        const text = await readRecordText(record)
        if (text === undefined) continue
        for (const match of grepText(record.path, text, matcher)) {
          matches.push(match)
          if (matches.length >= maxResults) return { matches }
        }
      }
      return { matches }
    })
  }

  async function readExistingText(path: string, record: WorkspaceFileRecord): Promise<string> {
    const current = await recordToReadResult(record, { blobs: config.blobs, maxInlineBytes: Number.MAX_SAFE_INTEGER })
    if (current.kind !== 'text') {
      throw new Error(`workspace.append(): only text files can be appended. "${path}" is ${current.kind}.`)
    }
    return current.content
  }

  async function readRecordText(record: WorkspaceFileRecord): Promise<string | undefined> {
    const current = await recordToReadResult(record, { blobs: config.blobs, maxInlineBytes: Number.MAX_SAFE_INTEGER })
    return current.kind === 'text' ? current.content : undefined
  }

  return { exists, stat, append, rename, move: rename, copy, grep }
}

function isInScope(
  record: WorkspaceFileRecord,
  scope: ReturnType<typeof normalizePath> | undefined,
  scopePattern: RegExp | undefined,
): boolean {
  if (!scope) return true
  if (scopePattern) return scopePattern.test(record.path)
  return record.path === scope
}

function createMatcher(query: string, ignoreCase: boolean | undefined): RegExp {
  try {
    return new RegExp(query, ignoreCase ? 'gi' : 'g')
  } catch {
    return new RegExp(escapeRegExp(query), ignoreCase ? 'gi' : 'g')
  }
}

function grepText(path: string, content: string, matcher: RegExp): WorkspaceGrepMatch[] {
  const matches: WorkspaceGrepMatch[] = []
  const lines = content.split(/\r?\n/)
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]!
    matcher.lastIndex = 0
    let match = matcher.exec(line)
    while (match) {
      matches.push({ path, line: lineIndex + 1, column: match.index + 1, text: line })
      if (match[0].length === 0) matcher.lastIndex += 1
      match = matcher.exec(line)
    }
  }
  return matches
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
