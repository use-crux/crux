/**
 * Type contracts for the durable workspace domain.
 *
 * Public surface: mount/config options, content + read/write/edit/delete option
 * shapes, the {@link WorkspaceFile} / {@link WorkspaceDirectory} listing entries,
 * the {@link WorkspaceReadResult} union, and the {@link Workspace} instance. The
 * branded path, stored file record, normalized mount, and content analysis types
 * (plus record-format constants) are internal.
 *
 * @module
 */

import type { z } from 'zod'
import type { BlobReadResult, BlobRef, BlobStore, DataStore, JsonObject, Storage } from '../store/types'
import type { Context, PromptInjection } from '../prompt/context-types'
import type { JsonValue, ToolDef } from '../types/tool'

/** Default inline storage cutoff: text/JSON at or below this size is stored inline. */
export const DEFAULT_INLINE_TEXT_BYTES = 64_000
/** Stored file record schema version. */
export const FILE_RECORD_VERSION = 1

/** A validated, normalized workspace path. Internal brand. */
export type WorkspacePath = string & { readonly __brand: 'WorkspacePath' }

/** Access level for a workspace mount. */
export type WorkspaceMountAccess = 'read' | 'readwrite'
/** A workspace file operation. */
export type WorkspaceOperation = 'list' | 'read' | 'write' | 'edit' | 'delete'

/** A mounted root within a workspace. */
export interface WorkspaceMount {
  readonly path: string
  readonly access: WorkspaceMountAccess
  readonly description?: string
}

/** Inline-vs-blob content thresholds. */
export interface WorkspaceContentOptions {
  readonly inlineTextBelowBytes?: number
}

/** Options controlling generated workspace tools. */
export interface WorkspaceToolOptions {
  readonly prefix?: string
  readonly delete?: boolean
}

/** Per-call namespace override accepted by every workspace operation. */
export interface WorkspaceNamespaceOption {
  readonly namespace?: string
}

/** Configuration for {@link workspace}. */
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

/** JSON values accepted by {@link Workspace.write}; strings are handled as text content. */
export type WorkspaceJsonContent = Exclude<JsonValue, string>

/** Accepted content types for {@link Workspace.write}. */
export type WorkspaceContent = string | WorkspaceJsonContent | Uint8Array | Blob | ReadableStream<Uint8Array>

/** Options for {@link Workspace.write}. */
export interface WorkspaceWriteOptions extends WorkspaceNamespaceOption {
  readonly mimeType?: string
  readonly metadata?: Record<string, JsonValue>
}

/** Options for {@link Workspace.read}. */
export interface WorkspaceReadOptions extends WorkspaceNamespaceOption {
  readonly maxInlineBytes?: number
  readonly offset?: number
}

/** Options for {@link Workspace.list}. */
export interface WorkspaceListOptions extends WorkspaceNamespaceOption {
  readonly limit?: number
  readonly cursor?: string
}

/** A find/replace patch for {@link Workspace.edit}. */
export interface WorkspaceEditPatch {
  readonly find: string
  readonly replace: string
  readonly occurrence?: number
}

/** Options for {@link Workspace.edit}. */
export interface WorkspaceEditOptions extends WorkspaceNamespaceOption {
  readonly mimeType?: string
}

/** Options for {@link Workspace.delete}. */
export interface WorkspaceDeleteOptions extends WorkspaceNamespaceOption {
  readonly deleteBlob?: boolean
}

/** A file entry in a workspace listing. */
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

/** A directory entry in a workspace listing. */
export interface WorkspaceDirectory {
  readonly kind: 'directory'
  readonly path: string
  readonly mount: string
}

/** A workspace listing entry: file or directory. */
export type WorkspaceListEntry = WorkspaceFile | WorkspaceDirectory

/** The result of {@link Workspace.list}. */
export interface WorkspaceListResult {
  readonly entries: readonly WorkspaceListEntry[]
  readonly cursor?: string
}

/** The result of {@link Workspace.read}: inline text/JSON or a binary reference. */
export type WorkspaceReadResult =
  | {
      readonly kind: 'text'
      readonly path: string
      readonly mimeType: string
      readonly content: string
      readonly size: number
      readonly truncated?: boolean
      readonly offset?: number
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

/** Re-export of the store blob reference type, for workspace consumers. */
export type WorkspaceBlobRef = BlobRef
/** Re-export of the store blob read-result type, for workspace consumers. */
export type WorkspaceBlobReadResult = BlobReadResult
/** Re-export of the store blob store type, for workspace consumers. */
export type WorkspaceBlobStore = BlobStore

/** A durable, path-addressed workspace instance. */
export interface Workspace {
  readonly _tag: 'Workspace'
  readonly id: string
  readonly mounts: readonly WorkspaceMount[]
  list(path?: string, options?: WorkspaceListOptions): Promise<WorkspaceListResult>
  read(path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult>
  write(path: string, content: WorkspaceContent, options?: WorkspaceWriteOptions): Promise<WorkspaceFile>
  edit(path: string, patch: WorkspaceEditPatch, options?: WorkspaceEditOptions): Promise<WorkspaceFile>
  delete(path: string, options?: WorkspaceDeleteOptions): Promise<void>
  asContext(options?: WorkspaceContextOptions): Context<z.ZodObject<{}>>
  asTools<const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption = {}>(
    options?: Options,
  ): WorkspaceTools<WorkspaceToolPrefix<Options>, WorkspaceToolDelete<Options>>
  inject(args: { input: Record<string, unknown>; promptId?: string }): PromptInjection | Promise<PromptInjection>
}

/** Options for {@link Workspace.asContext}. */
export interface WorkspaceContextOptions {
  readonly include?: readonly string[]
  readonly maxInlineBytes?: number
  readonly priority?: number
}

/** Extract the literal prefix from workspace tool options. */
export type WorkspaceToolPrefix<Options> = Options extends { readonly prefix?: infer Prefix }
  ? Extract<Prefix, string> extends never
    ? undefined
    : Extract<Prefix, string>
  : undefined

/** Extract whether delete is explicitly enabled from workspace tool options. */
export type WorkspaceToolDelete<Options> = Options extends { readonly delete: true } ? true : false

type WorkspaceToolPrefixPart<Prefix extends string | undefined> = Prefix extends string ? Capitalize<Prefix> : ''

/** Resolved generated workspace tool names for a literal prefix. */
export interface WorkspaceToolNames<Prefix extends string | undefined = undefined> {
  readonly list: `list${WorkspaceToolPrefixPart<Prefix>}Workspace`
  readonly readFile: `read${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`
  readonly writeFile: `write${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`
  readonly editFile: `edit${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`
  readonly deleteFile: `delete${WorkspaceToolPrefixPart<Prefix>}WorkspaceFile`
}

/** Generated workspace tools for a literal prefix and delete-tool setting. */
export type WorkspaceTools<
  Prefix extends string | undefined = undefined,
  Delete extends boolean | undefined = false,
> = {
  readonly [Key in WorkspaceToolNames<Prefix>['list']]: ToolDef
} & {
  readonly [Key in WorkspaceToolNames<Prefix>['readFile']]: ToolDef
} & {
  readonly [Key in WorkspaceToolNames<Prefix>['writeFile']]: ToolDef
} & {
  readonly [Key in WorkspaceToolNames<Prefix>['editFile']]: ToolDef
} & (Delete extends true
    ? {
        readonly [Key in WorkspaceToolNames<Prefix>['deleteFile']]: ToolDef
      }
    : {})

/** The persisted record for a workspace file. Internal. */
export interface WorkspaceFileRecord extends JsonObject {
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

/** A mount with its path normalized to a {@link WorkspacePath}. Internal. */
export interface NormalizedMount extends WorkspaceMount {
  readonly path: WorkspacePath
}

/** The analyzed shape of content being written. Internal. */
export interface ContentAnalysis {
  readonly kind: 'text' | 'json' | 'binary'
  readonly mimeType: string
  readonly size: number
  readonly text?: string
  readonly json?: JsonValue
  readonly binary?: Uint8Array | Blob | ReadableStream<Uint8Array>
}
