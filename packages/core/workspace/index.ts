/**
 * Durable workspaces for path-addressed agent files.
 *
 * Workspaces give prompts a scoped, filesystem-like tree for scratch files and
 * generated outputs. Metadata lives in a `DataStore`; binary or oversized
 * payloads live in a `BlobStore`.
 *
 * @module
 */

import { z } from 'zod'
import { context } from '../prompt/context'
import { observe } from '../observability'
import { getRuntime } from '../runtime/runtime'
import { inMemoryBlobStore, inMemoryDataStore } from '../store/memory'
import type { BlobReadResult, BlobRef, BlobStore, DataStore, JsonObject, Storage } from '../store/types'
import type { AnyToolSet, Context, PromptInjection } from '../types'
import type { JsonValue, ToolDef, ToolModelOutput } from '../types/tool'

const DEFAULT_INLINE_TEXT_BYTES = 64_000
const FILE_RECORD_VERSION = 1

type WorkspacePath = string & { readonly __brand: 'WorkspacePath' }

export type WorkspaceMountAccess = 'read' | 'readwrite'
export type WorkspaceOperation = 'list' | 'read' | 'write' | 'edit' | 'delete'

export interface WorkspaceMount {
  readonly path: string
  readonly access: WorkspaceMountAccess
  readonly description?: string
}

export interface WorkspaceContentOptions {
  readonly inlineTextBelowBytes?: number
}

export interface WorkspaceToolOptions {
  readonly prefix?: string
  readonly delete?: boolean
}

export interface WorkspaceConfig {
  readonly id: string
  readonly namespace:
    | string
    | ((args: { input: Record<string, unknown>; promptId?: string }) => string | Promise<string>)
  readonly data?: DataStore
  readonly blobs?: BlobStore
  readonly storage?: Storage
  readonly mounts?: readonly WorkspaceMount[]
  readonly content?: WorkspaceContentOptions
  readonly tools?: WorkspaceToolOptions
}

export type WorkspaceContent = string | JsonValue | Uint8Array | Blob | ReadableStream<Uint8Array>

export interface WorkspaceWriteOptions {
  readonly mimeType?: string
  readonly metadata?: Record<string, JsonValue>
}

export interface WorkspaceReadOptions {
  readonly maxInlineBytes?: number
}

export interface WorkspaceListOptions {
  readonly limit?: number
}

export interface WorkspaceEditPatch {
  readonly find: string
  readonly replace: string
  readonly occurrence?: number
}

export interface WorkspaceEditOptions {
  readonly mimeType?: string
}

export interface WorkspaceDeleteOptions {
  readonly deleteBlob?: boolean
}

export interface WorkspaceFile {
  readonly kind: 'file'
  readonly path: string
  readonly mimeType: string
  readonly size: number
  readonly mount: string
  readonly storage: 'inline' | 'blob'
  readonly uri?: string
  readonly preview?: string
  readonly metadata?: Record<string, JsonValue>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface WorkspaceDirectory {
  readonly kind: 'directory'
  readonly path: string
  readonly mount: string
}

export type WorkspaceListEntry = WorkspaceFile | WorkspaceDirectory

export interface WorkspaceListResult {
  readonly entries: readonly WorkspaceListEntry[]
}

export type WorkspaceReadResult =
  | {
      readonly kind: 'text'
      readonly path: string
      readonly mimeType: string
      readonly content: string
      readonly size: number
      readonly metadata?: Record<string, JsonValue>
    }
  | {
      readonly kind: 'json'
      readonly path: string
      readonly mimeType: 'application/json'
      readonly content: JsonValue
      readonly size: number
      readonly metadata?: Record<string, JsonValue>
    }
  | {
      readonly kind: 'binary'
      readonly path: string
      readonly mimeType: string
      readonly uri: string
      readonly size: number
      readonly preview?: string
      readonly metadata?: Record<string, JsonValue>
    }

export type WorkspaceBlobRef = BlobRef
export type WorkspaceBlobReadResult = BlobReadResult
export type WorkspaceBlobStore = BlobStore

export interface Workspace {
  readonly _tag: 'Workspace'
  readonly id: string
  readonly mounts: readonly WorkspaceMount[]
  list(path?: string, options?: WorkspaceListOptions): Promise<WorkspaceListResult>
  read(path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult>
  write(path: string, content: WorkspaceContent, options?: WorkspaceWriteOptions): Promise<WorkspaceFile>
  edit(path: string, patch: WorkspaceEditPatch, options?: WorkspaceEditOptions): Promise<WorkspaceFile>
  delete(path: string, options?: WorkspaceDeleteOptions): Promise<void>
  asContext(options?: WorkspaceContextOptions): Context<z.ZodType<{}>>
  asTools(options?: WorkspaceToolOptions): Record<string, ToolDef>
  inject(args: { input: Record<string, unknown>; promptId?: string }): PromptInjection | Promise<PromptInjection>
}

export interface WorkspaceContextOptions {
  readonly include?: readonly string[]
  readonly maxInlineBytes?: number
  readonly priority?: number
}

export interface WorkspaceToolNames {
  readonly list: string
  readonly readFile: string
  readonly writeFile: string
  readonly editFile: string
  readonly deleteFile: string
}

interface WorkspaceFileRecord extends JsonObject {
  readonly _cruxWorkspaceFile: true
  readonly version: typeof FILE_RECORD_VERSION
  readonly workspaceId: string
  readonly namespace: string
  readonly path: string
  readonly mount: string
  readonly mimeType: string
  readonly size: number
  readonly storage: 'inline' | 'blob'
  readonly inlineText?: string
  readonly inlineJson?: JsonValue
  readonly uri?: string
  readonly preview?: string
  readonly metadata?: Record<string, JsonValue>
  readonly createdAt: number
  readonly updatedAt: number
}

interface NormalizedMount extends WorkspaceMount {
  readonly path: WorkspacePath
}

interface ContentAnalysis {
  readonly kind: 'text' | 'json' | 'binary'
  readonly mimeType: string
  readonly size: number
  readonly text?: string
  readonly json?: JsonValue
  readonly binary?: Uint8Array | Blob | ReadableStream<Uint8Array>
}

export function workspace(config: WorkspaceConfig): Workspace {
  assertNonEmpty(config.id, 'workspace(): id must be non-empty.')

  const store = config.data ?? config.storage?.data ?? inMemoryDataStore()
  const blobs = config.blobs ?? config.storage?.blobs
  const mounts = normalizeMounts(config.mounts ?? defaultMounts())
  const inlineTextBelowBytes = config.content?.inlineTextBelowBytes ?? DEFAULT_INLINE_TEXT_BYTES

  async function resolveNamespace(input?: Record<string, unknown>, promptId?: string): Promise<string> {
    const raw =
      typeof config.namespace === 'function'
        ? await config.namespace({ input: input ?? {}, promptId })
        : config.namespace
    assertNonEmpty(raw, 'workspace(): namespace must resolve to a non-empty string.')
    return raw
  }

  async function list(path = '/', options?: WorkspaceListOptions): Promise<WorkspaceListResult> {
    const namespace = await resolveNamespace()
    return listForNamespace(namespace, path, options)
  }

  async function listForNamespace(
    namespace: string,
    path = '/',
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult> {
    return instrument({ workspaceId: config.id, operation: 'list', namespace, path }, async () => {
      const normalized = normalizePath(path)
      const isGlob = hasGlob(normalized)
      const matchedMount = isGlob || normalized === '/' ? undefined : mountForPath(normalized, mounts, 'read')
      const entries = await listEntries({
        store,
        workspaceId: config.id,
        namespace,
        mounts,
        queryPath: normalized,
        isGlob,
        limit: options?.limit,
        matchedMount,
      })
      return { entries }
    })
  }

  async function read(path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult> {
    const namespace = await resolveNamespace()
    return readForNamespace(namespace, path, options)
  }

  async function readForNamespace(
    namespace: string,
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult> {
    return instrument({ workspaceId: config.id, operation: 'read', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, mounts, 'read')
      const record = await getRequiredRecord(store, config.id, namespace, normalized)
      return recordToReadResult(record, options?.maxInlineBytes)
    })
  }

  async function write(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await resolveNamespace()
    return writeForNamespace(namespace, path, content, options)
  }

  async function writeForNamespace(
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile> {
    return instrument({ workspaceId: config.id, operation: 'write', namespace, path }, async () => {
      const normalized = normalizePath(path)
      const mount = mountForPath(normalized, mounts, 'write')
      const analysis = await analyzeContent(content, options?.mimeType)
      const existing = await getRecord(store, config.id, namespace, normalized)
      const now = Date.now()
      const record = await createFileRecord({
        workspaceId: config.id,
        namespace,
        path: normalized,
        mount: mount.path,
        analysis,
        metadata: options?.metadata,
        existing,
        now,
        inlineTextBelowBytes,
        blobs,
      })
      await store.set(fileKey(config.id, namespace, normalized), record)
      return recordToFile(record)
    })
  }

  async function edit(path: string, patch: WorkspaceEditPatch, options?: WorkspaceEditOptions): Promise<WorkspaceFile> {
    const namespace = await resolveNamespace()
    return editForNamespace(namespace, path, patch, options)
  }

  async function editForNamespace(
    namespace: string,
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile> {
    return instrument({ workspaceId: config.id, operation: 'edit', namespace, path }, async () => {
      if (!patch.find) throw new Error('workspace.edit(): patch.find must be non-empty.')
      const current = await readForNamespace(namespace, path)
      if (current.kind !== 'text') {
        throw new Error(`workspace.edit(): only text files can be edited. "${path}" is ${current.kind}.`)
      }
      const occurrences = findOccurrences(current.content, patch.find)
      if (occurrences.length === 0) {
        throw new Error(`workspace.edit(): text to replace was not found in "${path}".`)
      }
      if (occurrences.length > 1 && patch.occurrence === undefined) {
        throw new Error(
          `workspace.edit(): found ${occurrences.length} matches in "${path}". Pass occurrence to choose one.`,
        )
      }
      const occurrence = patch.occurrence ?? 1
      if (occurrence < 1 || occurrence > occurrences.length) {
        throw new Error(`workspace.edit(): occurrence ${occurrence} is outside the match range.`)
      }
      const index = occurrences[occurrence - 1]!
      const next = `${current.content.slice(0, index)}${patch.replace}${current.content.slice(index + patch.find.length)}`
      return writeForNamespace(namespace, path, next, {
        mimeType: options?.mimeType ?? current.mimeType,
        metadata: current.metadata,
      })
    })
  }

  async function remove(path: string, options?: WorkspaceDeleteOptions): Promise<void> {
    const namespace = await resolveNamespace()
    await removeForNamespace(namespace, path, options)
  }

  async function removeForNamespace(namespace: string, path: string, options?: WorkspaceDeleteOptions): Promise<void> {
    await instrument({ workspaceId: config.id, operation: 'delete', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, mounts, 'write')
      const record = await getRecord(store, config.id, namespace, normalized)
      await store.delete(fileKey(config.id, namespace, normalized))
      if (options?.deleteBlob !== false && record?.uri && blobs?.delete) {
        await blobs.delete(record.uri)
      }
    })
  }

  function asContext(options?: WorkspaceContextOptions): Context<z.ZodType<{}>> {
    return context({
      id: `workspace:${config.id}`,
      description: `Workspace: ${config.id}`,
      input: z.object({}).passthrough(),
      priority: options?.priority ?? 65,
      system: async ({ input }) => renderManifest(await resolveNamespace(input), options),
    })
  }

  function asTools(options?: WorkspaceToolOptions, namespaceOverride?: string): Record<string, ToolDef> {
    const toolOptions = { ...config.tools, ...options }
    const names = workspaceToolNames(toolOptions)
    const tools: Record<string, ToolDef> = {
      [names.list]: {
        description: `List files in workspace "${config.id}". Supports directory paths and simple globs like /workspace/**/*.md.`,
        parameters: z.object({
          path: z.string().optional().describe('Directory path or glob. Defaults to /.'),
          limit: z.number().int().positive().optional(),
        }),
        execute: (args: Record<string, unknown>) =>
          namespaceOverride
            ? listForNamespace(namespaceOverride, readOptionalString(args.path) ?? '/', {
                limit: readOptionalPositiveInteger(args.limit),
              })
            : list(readOptionalString(args.path) ?? '/', { limit: readOptionalPositiveInteger(args.limit) }),
        toModelOutput: modelJsonOutput('Workspace listing'),
      },
      [names.readFile]: {
        description: `Read a workspace file from "${config.id}". Text/JSON may be returned inline; binary files return safe metadata and URI.`,
        parameters: z.object({
          path: z.string().describe('Absolute workspace path, e.g. /workspace/notes.md.'),
          maxInlineBytes: z.number().int().positive().optional(),
        }),
        execute: (args: Record<string, unknown>) =>
          namespaceOverride
            ? readForNamespace(namespaceOverride, readRequiredString(args.path, 'path'), {
                maxInlineBytes: readOptionalPositiveInteger(args.maxInlineBytes),
              })
            : read(readRequiredString(args.path, 'path'), {
                maxInlineBytes: readOptionalPositiveInteger(args.maxInlineBytes),
              }),
        toModelOutput: ({ output }) => readModelOutput(output),
      },
      [names.writeFile]: {
        description: `Write a workspace file in "${config.id}". Binary and oversized content require a WorkspaceBlobStore.`,
        parameters: z.object({
          path: z.string().describe('Absolute workspace path, e.g. /outputs/report.md.'),
          content: z.union([z.string(), z.record(z.string(), z.unknown())]).describe('Text content or JSON content.'),
          mimeType: z.string().optional(),
        }),
        execute: (args: Record<string, unknown>) =>
          namespaceOverride
            ? writeForNamespace(
                namespaceOverride,
                readRequiredString(args.path, 'path'),
                readWorkspaceToolContent(args.content),
                {
                  mimeType: readOptionalString(args.mimeType),
                },
              )
            : write(readRequiredString(args.path, 'path'), readWorkspaceToolContent(args.content), {
                mimeType: readOptionalString(args.mimeType),
              }),
        toModelOutput: fileModelOutput,
      },
      [names.editFile]: {
        description: `Edit a text workspace file in "${config.id}" with simple find/replace.`,
        parameters: z.object({
          path: z.string(),
          find: z.string(),
          replace: z.string(),
          occurrence: z.number().int().positive().optional(),
        }),
        execute: (args: Record<string, unknown>) =>
          namespaceOverride
            ? editForNamespace(namespaceOverride, readRequiredString(args.path, 'path'), {
                find: readRequiredString(args.find, 'find'),
                replace: readRequiredString(args.replace, 'replace'),
                occurrence: readOptionalPositiveInteger(args.occurrence),
              })
            : edit(readRequiredString(args.path, 'path'), {
                find: readRequiredString(args.find, 'find'),
                replace: readRequiredString(args.replace, 'replace'),
                occurrence: readOptionalPositiveInteger(args.occurrence),
              }),
        toModelOutput: fileModelOutput,
      },
    }

    if (toolOptions.delete) {
      tools[names.deleteFile] = {
        description: `Delete a workspace file from "${config.id}". This tool is opt-in because deletion is irreversible.`,
        parameters: z.object({
          path: z.string(),
        }),
        execute: async (args: Record<string, unknown>) => {
          const path = readRequiredString(args.path, 'path')
          if (namespaceOverride) {
            await removeForNamespace(namespaceOverride, path)
          } else {
            await remove(path)
          }
          return { deleted: true, path }
        },
        toModelOutput: modelJsonOutput('Workspace file deleted'),
      }
    }
    return tools
  }

  async function renderManifest(namespace: string, options?: WorkspaceContextOptions): Promise<string> {
    const rootListing: WorkspaceListResult = {
      entries: await listEntries({
        store,
        workspaceId: config.id,
        namespace,
        mounts,
        queryPath: normalizePath('/'),
        isGlob: false,
      }),
    }
    const files = await listAllFileEntries(store, config.id, namespace)
    const lines = [
      `## Workspace (${config.id})`,
      `Namespace: ${namespace}`,
      '',
      'Mounted roots:',
      ...mounts.map((mount) => `- ${mount.path} (${mount.access})${mount.description ? `: ${mount.description}` : ''}`),
    ]
    if (rootListing.entries.length > 0) {
      lines.push('', 'Files:')
      for (const entry of rootListing.entries) {
        if (entry.kind === 'directory') {
          lines.push(`- ${entry.path}/`)
        } else {
          lines.push(`- ${entry.path} (${entry.mimeType}, ${entry.size} bytes)`)
        }
      }
      for (const file of files) {
        lines.push(`- ${file.path} (${file.mimeType}, ${file.size} bytes)`)
      }
    }
    lines.push(
      '',
      'Use workspace tools to list and read file contents when needed. Binary files are returned as metadata/URI references.',
    )

    const includes = options?.include ?? []
    if (includes.length > 0) {
      lines.push('', 'Included workspace files:')
      for (const include of includes) {
        const normalized = normalizePath(include)
        mountForPath(normalized, mounts, 'read')
        const record = await getRequiredRecord(store, config.id, namespace, normalized)
        const result = recordToReadResult(record, options?.maxInlineBytes)
        if (result.kind === 'text') {
          lines.push(`### ${result.path}`, result.content)
        } else if (result.kind === 'json') {
          lines.push(`### ${result.path}`, '```json', JSON.stringify(result.content, null, 2), '```')
        } else {
          lines.push(`### ${result.path}`, `[binary ${result.mimeType}, ${result.size} bytes]`)
        }
      }
    }

    return lines.join('\n')
  }

  const ws: Workspace = {
    _tag: 'Workspace',
    id: config.id,
    mounts,
    list,
    read,
    write,
    edit,
    delete: remove,
    asContext,
    asTools,
    async inject(args): Promise<PromptInjection> {
      const namespace = await resolveNamespace(args.input, args.promptId)
      return {
        contexts: [
          context({
            id: `workspace:${config.id}`,
            description: `Workspace: ${config.id}`,
            input: z.object({}).passthrough(),
            priority: 65,
            system: () => renderManifest(namespace),
          }),
        ],
        tools: asTools(undefined, namespace) as AnyToolSet,
        metadata: {
          workspace: {
            id: config.id,
            namespace,
            mounts: mounts.map((mount) => ({ path: mount.path, access: mount.access })),
          },
        },
      }
    },
  }

  return Object.freeze(ws)
}

export function workspaceToolNames(options?: Pick<WorkspaceToolOptions, 'prefix'>): WorkspaceToolNames {
  const prefix = options?.prefix ? toPascalCase(options.prefix) : ''
  return {
    list: prefix ? `list${prefix}Workspace` : 'listWorkspace',
    readFile: prefix ? `read${prefix}WorkspaceFile` : 'readWorkspaceFile',
    writeFile: prefix ? `write${prefix}WorkspaceFile` : 'writeWorkspaceFile',
    editFile: prefix ? `edit${prefix}WorkspaceFile` : 'editWorkspaceFile',
    deleteFile: prefix ? `delete${prefix}WorkspaceFile` : 'deleteWorkspaceFile',
  }
}

export function memoryWorkspaceBlobStore(): WorkspaceBlobStore {
  return inMemoryBlobStore()
}

function defaultMounts(): readonly WorkspaceMount[] {
  return [
    { path: '/workspace', access: 'readwrite', description: 'Scratch notes, intermediate files, and working state.' },
    { path: '/outputs', access: 'readwrite', description: 'Generated deliverables and files for the app/user.' },
  ]
}

function normalizeMounts(mounts: readonly WorkspaceMount[]): readonly NormalizedMount[] {
  if (mounts.length === 0) throw new Error('workspace(): at least one mount is required.')
  const seen = new Set<string>()
  const normalized = mounts.map((mount) => {
    const path = normalizePath(mount.path)
    if (path === '/') throw new Error('workspace(): root mount "/" is not supported.')
    if (seen.has(path)) throw new Error(`workspace(): duplicate mount path "${path}".`)
    seen.add(path)
    return Object.freeze({ ...mount, path })
  })
  return Object.freeze(normalized.sort((a, b) => a.path.localeCompare(b.path)))
}

function normalizePath(input: string): WorkspacePath {
  if (!input) throw new Error('workspace path must be non-empty.')
  if (!input.startsWith('/')) throw new Error(`workspace path "${input}" must start with "/".`)
  if (input.includes('\0')) throw new Error('workspace path contains a null byte.')
  if (input.includes('\\')) throw new Error('workspace path must use forward slashes, not backslashes.')
  if (/^[a-zA-Z]:/.test(input) || /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    throw new Error(`workspace path "${input}" must be a workspace path, not a URL or drive path.`)
  }

  const parts = input.split('/')
  const normalized: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    const decoded = safeDecode(part)
    if (part === '..' || decoded === '..') {
      throw new Error(`workspace path "${input}" contains path traversal.`)
    }
    if (decoded.includes('/') || decoded.includes('\\')) {
      throw new Error(`workspace path "${input}" contains encoded path separators.`)
    }
    normalized.push(part)
  }
  return (`/${normalized.join('/')}` || '/') as WorkspacePath
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function mountForPath(
  path: WorkspacePath,
  mounts: readonly NormalizedMount[],
  mode: 'read' | 'write',
): NormalizedMount {
  const match = mounts
    .filter((mount) => path === mount.path || path.startsWith(`${mount.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!match) {
    throw new Error(`workspace path "${path}" is outside configured workspace mounts.`)
  }
  if (mode === 'write' && match.access !== 'readwrite') {
    throw new Error(`workspace mount "${match.path}" is read-only.`)
  }
  return match
}

function filePrefix(workspaceId: string, namespace: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(namespace)}:file:`
}

function fileKey(workspaceId: string, namespace: string, path: WorkspacePath): string {
  return `${filePrefix(workspaceId, namespace)}${encodeURIComponent(path)}`
}

async function getRecord(
  store: DataStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord | null> {
  const value = await store.get(fileKey(workspaceId, namespace, path))
  return isFileRecord(value) ? value : null
}

async function getRequiredRecord(
  store: DataStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceFileRecord> {
  const record = await getRecord(store, workspaceId, namespace, path)
  if (!record) throw new Error(`workspace file not found: "${path}".`)
  return record
}

async function listEntries(input: {
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

async function listAllFileEntries(store: DataStore, workspaceId: string, namespace: string): Promise<WorkspaceFile[]> {
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

function hasGlob(path: string): boolean {
  return path.includes('*')
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      i += 1
    } else if (char === '*') {
      source += '[^/]*'
    } else {
      source += escapeRegExp(char)
    }
  }
  source += '$'
  return new RegExp(source)
}

function escapeRegExp(value: string | undefined): string {
  return (value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function analyzeContent(content: WorkspaceContent, mimeType?: string): Promise<ContentAnalysis> {
  if (typeof content === 'string') {
    return { kind: 'text', text: content, mimeType: mimeType ?? 'text/plain', size: byteLength(content) }
  }
  if (content instanceof Uint8Array) {
    return {
      kind: 'binary',
      binary: content,
      mimeType: mimeType ?? 'application/octet-stream',
      size: content.byteLength,
    }
  }
  if (isBlob(content)) {
    return {
      kind: isTextMime(mimeType ?? content.type) ? 'text' : 'binary',
      binary: content,
      mimeType: (mimeType ?? content.type) || 'application/octet-stream',
      size: content.size,
      text: isTextMime(mimeType ?? content.type) ? await content.text() : undefined,
    }
  }
  if (isReadableStream(content)) {
    return { kind: 'binary', binary: content, mimeType: mimeType ?? 'application/octet-stream', size: 0 }
  }
  const json = content as JsonValue
  return {
    kind: 'json',
    json,
    mimeType: 'application/json',
    size: byteLength(JSON.stringify(json)),
  }
}

async function createFileRecord(input: {
  readonly workspaceId: string
  readonly namespace: string
  readonly path: WorkspacePath
  readonly mount: WorkspacePath
  readonly analysis: ContentAnalysis
  readonly metadata: Record<string, JsonValue> | undefined
  readonly existing: WorkspaceFileRecord | null
  readonly now: number
  readonly inlineTextBelowBytes: number
  readonly blobs: WorkspaceBlobStore | undefined
}): Promise<WorkspaceFileRecord> {
  const base = {
    _cruxWorkspaceFile: true as const,
    version: FILE_RECORD_VERSION as typeof FILE_RECORD_VERSION,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    mount: input.mount,
    mimeType: input.analysis.mimeType,
    size: input.analysis.size,
    metadata: input.metadata,
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now,
  }

  if (input.analysis.kind === 'json' && input.analysis.size <= input.inlineTextBelowBytes) {
    return {
      ...base,
      storage: 'inline',
      inlineJson: input.analysis.json,
      preview: preview(JSON.stringify(input.analysis.json)),
    }
  }

  if (
    input.analysis.kind === 'text' &&
    input.analysis.text !== undefined &&
    input.analysis.size <= input.inlineTextBelowBytes
  ) {
    return {
      ...base,
      storage: 'inline',
      inlineText: input.analysis.text,
      preview: preview(input.analysis.text),
    }
  }

  if (!input.blobs) {
    throw new Error('workspace.write(): binary or oversized content requires a WorkspaceBlobStore.')
  }

  const payload =
    input.analysis.kind === 'text'
      ? (input.analysis.text ?? '')
      : input.analysis.kind === 'json'
        ? JSON.stringify(input.analysis.json)
        : input.analysis.binary
  if (payload === undefined) {
    throw new Error('workspace.write(): binary content could not be read.')
  }
  const ref = await input.blobs.put({
    key: `${input.workspaceId}/${input.namespace}${input.path}`,
    content: payload,
    mimeType: input.analysis.mimeType,
    metadata: input.metadata,
  })
  return {
    ...base,
    storage: 'blob',
    uri: ref.uri,
    size: ref.size || input.analysis.size,
    preview: input.analysis.text ? preview(input.analysis.text) : undefined,
  }
}

function recordToFile(record: WorkspaceFileRecord): WorkspaceFile {
  return {
    kind: 'file',
    path: record.path,
    mimeType: record.mimeType,
    size: record.size,
    mount: record.mount,
    storage: record.storage,
    ...(record.uri ? { uri: record.uri } : {}),
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function recordToReadResult(
  record: WorkspaceFileRecord,
  maxInlineBytes = DEFAULT_INLINE_TEXT_BYTES,
): WorkspaceReadResult {
  if (record.storage === 'inline' && record.inlineText !== undefined) {
    if (record.size > maxInlineBytes) {
      return binaryReference(record)
    }
    return {
      kind: 'text',
      path: record.path,
      mimeType: record.mimeType,
      content: record.inlineText,
      size: record.size,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    }
  }
  if (record.storage === 'inline' && record.inlineJson !== undefined) {
    return {
      kind: 'json',
      path: record.path,
      mimeType: 'application/json',
      content: record.inlineJson,
      size: record.size,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    }
  }
  return binaryReference(record)
}

function binaryReference(record: WorkspaceFileRecord): Extract<WorkspaceReadResult, { kind: 'binary' }> {
  if (!record.uri) {
    throw new Error(`workspace file "${record.path}" has blob storage but no URI.`)
  }
  return {
    kind: 'binary',
    path: record.path,
    mimeType: record.mimeType,
    uri: record.uri,
    size: record.size,
    ...(record.preview ? { preview: record.preview } : {}),
    ...(record.metadata ? { metadata: record.metadata } : {}),
  }
}

function isFileRecord(value: JsonObject | null): value is WorkspaceFileRecord {
  return value?._cruxWorkspaceFile === true && value.version === FILE_RECORD_VERSION && typeof value.path === 'string'
}

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
}

function isTextMime(mimeType: string | undefined): boolean {
  return !!mimeType && (mimeType.startsWith('text/') || mimeType === 'application/json')
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function preview(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value
}

function findOccurrences(content: string, find: string): number[] {
  const indexes: number[] = []
  let index = content.indexOf(find)
  while (index >= 0) {
    indexes.push(index)
    index = content.indexOf(find, index + find.length)
  }
  return indexes
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

function assertNonEmpty(value: string, message: string): void {
  if (!value.trim()) throw new Error(message)
}

function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workspace tool argument "${name}" must be a non-empty string.`)
  }
  return value
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function readWorkspaceToolContent(value: unknown): string | JsonValue {
  if (typeof value === 'string') return value
  return toJsonValue(value)
}

function modelJsonOutput(label: string) {
  return ({ output }: { readonly output: unknown }): ToolModelOutput => ({
    type: 'json',
    value: toJsonValue({ label, result: toModelSafeJson(output) }),
  })
}

function readModelOutput(output: unknown): ToolModelOutput {
  if (!isWorkspaceReadResult(output)) {
    return { type: 'json', value: toJsonValue(output) }
  }
  if (output.kind === 'text') {
    return { type: 'text', value: output.content }
  }
  if (output.kind === 'json') {
    return { type: 'json', value: output.content }
  }
  return {
    type: 'json',
    value: {
      kind: 'binary',
      path: output.path,
      mimeType: output.mimeType,
      uri: output.uri,
      size: output.size,
      ...(output.preview ? { preview: output.preview } : {}),
    },
  }
}

function fileModelOutput({ output }: { readonly output: unknown }): ToolModelOutput {
  if (!isWorkspaceFile(output)) {
    return { type: 'json', value: toJsonValue(output) }
  }
  return {
    type: 'json',
    value: {
      path: output.path,
      mimeType: output.mimeType,
      size: output.size,
      storage: output.storage,
      ...(output.uri ? { uri: output.uri } : {}),
    },
  }
}

function isWorkspaceReadResult(value: unknown): value is WorkspaceReadResult {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { readonly kind?: unknown; readonly path?: unknown }
  return (
    (candidate.kind === 'text' || candidate.kind === 'json' || candidate.kind === 'binary') &&
    typeof candidate.path === 'string'
  )
}

function isWorkspaceFile(value: unknown): value is WorkspaceFile {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { readonly kind?: unknown; readonly path?: unknown }
  return candidate.kind === 'file' && typeof candidate.path === 'string'
}

function toJsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(toJsonValue)
  if (typeof value === 'object') {
    const result: Record<string, JsonValue> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item !== undefined && typeof item !== 'function' && typeof item !== 'symbol') {
        result[key] = toJsonValue(item)
      }
    }
    return result
  }
  return String(value)
}

function toModelSafeJson(value: unknown): JsonValue {
  return toJsonValue(value)
}

async function instrument<T>(
  event: {
    readonly workspaceId: string
    readonly operation: WorkspaceOperation
    readonly namespace: string
    readonly path: string
  },
  run: () => Promise<T>,
): Promise<T> {
  const start = Date.now()
  const span = observe.openSpan({
    name: `workspace.${event.operation}`,
    family: 'workspace',
    primitive: 'workspace.operation',
    attributes: {
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      path: event.path,
    },
  })
  try {
    const result = await span.withContext(run)
    span.withContext(() => emitWorkspaceArtifact(span.spanId, event, result))
    const resultAttributes = workspaceResultAttributes(result)
    getRuntime().instrumentationHooks?.onWorkspaceOperation?.({
      workspaceId: event.workspaceId,
      namespace: event.namespace,
      operation: event.operation,
      path: event.path,
      status: 'success',
      durationMs: Date.now() - start,
    })
    span.end({
      attributes: {
        workspaceId: event.workspaceId,
        operation: event.operation,
        namespaceHash: hashString(event.namespace),
        path: event.path,
        status: 'success',
        ...resultAttributes,
      },
    })
    return result
  } catch (error) {
    getRuntime().instrumentationHooks?.onWorkspaceOperation?.({
      workspaceId: event.workspaceId,
      namespace: event.namespace,
      operation: event.operation,
      path: event.path,
      status: 'error',
      durationMs: Date.now() - start,
      error: error instanceof Error ? error.message : String(error),
    })
    span.error(error, {
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      path: event.path,
      status: 'error',
    })
    throw error
  }
}

function emitWorkspaceArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  event: {
    readonly workspaceId: string
    readonly operation: WorkspaceOperation
    readonly namespace: string
    readonly path: string
  },
  result: unknown,
): void {
  const preview = workspaceResultPreview(result)
  if (preview === undefined) return
  const artifactId = observe.artifact({
    kind: 'output',
    contentType: 'application/json',
    encoding: 'json',
    preview,
    attributes: {
      primitive: 'workspace.operation',
      workspaceId: event.workspaceId,
      operation: event.operation,
      namespaceHash: hashString(event.namespace),
      path: event.path,
      ...workspaceResultAttributes(result),
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'workspace.operation', operation: event.operation, workspaceId: event.workspaceId },
  })
}

function workspaceResultPreview(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  if (Array.isArray(record.entries)) {
    return {
      resultKind: 'list',
      entryCount: record.entries.length,
      entries: record.entries.slice(0, 50).map((entry) => workspaceEntryPreview(entry)),
    }
  }
  if (record.kind === 'file') {
    return {
      resultKind: 'file',
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      storage: record.storage,
      metadata: record.metadata,
    }
  }
  if (record.kind === 'text' || record.kind === 'json' || record.kind === 'binary') {
    return {
      resultKind: record.kind,
      path: record.path,
      mimeType: record.mimeType,
      size: record.size,
      metadata: record.metadata,
      preview: typeof record.preview === 'string' ? record.preview.slice(0, 500) : undefined,
      contentStored: false,
    }
  }
  return undefined
}

function workspaceEntryPreview(entry: unknown): Record<string, unknown> {
  if (!entry || typeof entry !== 'object') return { kind: 'unknown' }
  const record = entry as Record<string, unknown>
  return {
    kind: record.kind,
    path: record.path,
    mimeType: record.mimeType,
    size: record.size,
    storage: record.storage,
  }
}

function workspaceResultAttributes(result: unknown): Record<string, unknown> {
  if (!result || typeof result !== 'object') return {}
  const record = result as Record<string, unknown>
  if (Array.isArray(record.entries)) return { resultKind: 'list', entryCount: record.entries.length }
  if (typeof record.kind === 'string') {
    return {
      resultKind: record.kind,
      ...(typeof record.mimeType === 'string' ? { mimeType: record.mimeType } : {}),
      ...(typeof record.size === 'number' ? { size: record.size } : {}),
      ...(typeof record.storage === 'string' ? { storage: record.storage } : {}),
    }
  }
  return {}
}

function hashString(value: string): string {
  let hash = 2166136261
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}
