/**
 * Tool input/output bridging for generated workspace tools.
 *
 * Resolves tool names from an optional prefix, parses untyped tool arguments
 * into safe values, and shapes workspace results into {@link ToolModelOutput}
 * payloads the model can consume.
 *
 * @module
 */

import type { JsonValue, ToolModelOutput } from '../types/tool'
import type {
  WorkspaceFile,
  WorkspaceReadResult,
  WorkspaceToolNames,
  WorkspaceToolOptions,
  WorkspaceToolPrefix,
} from './types'

/** Resolve the generated workspace tool names from an optional prefix. */
export function workspaceToolNames<const Options extends Pick<WorkspaceToolOptions, 'prefix'> = {}>(
  options?: Options,
): WorkspaceToolNames<WorkspaceToolPrefix<Options>> {
  const prefix = options?.prefix ? toPascalCase(options.prefix) : ''
  return {
    list: prefix ? `list${prefix}Workspace` : 'listWorkspace',
    readFile: prefix ? `read${prefix}WorkspaceFile` : 'readWorkspaceFile',
    writeFile: prefix ? `write${prefix}WorkspaceFile` : 'writeWorkspaceFile',
    editFile: prefix ? `edit${prefix}WorkspaceFile` : 'editWorkspaceFile',
    renameFile: prefix ? `rename${prefix}WorkspaceFile` : 'renameWorkspaceFile',
    grep: prefix ? `grep${prefix}Workspace` : 'grepWorkspace',
    deleteFile: prefix ? `delete${prefix}WorkspaceFile` : 'deleteWorkspaceFile',
    undoFile: prefix ? `undo${prefix}WorkspaceFile` : 'undoWorkspaceFile',
  } as WorkspaceToolNames<WorkspaceToolPrefix<Options>>
}

function toPascalCase(value: string): string {
  return value
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/** Read a required non-empty string tool argument or throw. */
export function readRequiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`workspace tool argument "${name}" must be a non-empty string.`)
  }
  return value
}

/** Read an optional string tool argument. */
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Read an optional positive-integer tool argument. */
export function readOptionalPositiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

/** Read an optional boolean tool argument. */
export function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** Coerce a tool `content` argument into a string or JSON value. */
export function readWorkspaceToolContent(value: unknown): string | JsonValue {
  if (typeof value === 'string') return value
  return toJsonValue(value)
}

/** Build a `toModelOutput` that wraps a result under a labelled JSON envelope. */
export function modelJsonOutput(label: string) {
  return ({ output }: { readonly output: unknown }): ToolModelOutput => ({
    type: 'json',
    value: toJsonValue({ label, result: toModelSafeJson(output) }),
  })
}

/** Shape a {@link WorkspaceReadResult} into model output (text inline, binary as metadata). */
export function readModelOutput(output: unknown): ToolModelOutput {
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

/** Shape a {@link WorkspaceFile} into compact model output. */
export function fileModelOutput({ output }: { readonly output: unknown }): ToolModelOutput {
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

/** Recursively coerce an arbitrary value into a JSON-safe value. */
export function toJsonValue(value: unknown): JsonValue {
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
