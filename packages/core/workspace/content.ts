/**
 * Content analysis and file-record conversions.
 *
 * Turns raw {@link WorkspaceContent} into a {@link ContentAnalysis}, builds the
 * persisted {@link WorkspaceFileRecord} (inline or blob-backed), and converts
 * records back into {@link WorkspaceFile} / {@link WorkspaceReadResult} shapes.
 *
 * @module
 */

import type { JsonValue } from '../types/tool'
import {
  DEFAULT_INLINE_TEXT_BYTES,
  FILE_RECORD_VERSION,
  type ContentAnalysis,
  type WorkspaceBlobStore,
  type WorkspaceContent,
  type WorkspaceFile,
  type WorkspaceFileRecord,
  type WorkspacePath,
  type WorkspaceReadResult,
} from './types'

/** Analyze raw content into its kind, mime type, size, and decoded payload. */
export async function analyzeContent(content: WorkspaceContent, mimeType?: string): Promise<ContentAnalysis> {
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

/** Build a persisted file record, inlining small text/JSON or writing to a blob store. */
export async function createFileRecord(input: {
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

/** Convert a stored record into a {@link WorkspaceFile} listing entry. */
export function recordToFile(record: WorkspaceFileRecord): WorkspaceFile {
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

/** Convert a stored record into a {@link WorkspaceReadResult}, honoring the inline cap. */
export function recordToReadResult(
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

function isBlob(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof ReadableStream !== 'undefined' && value instanceof ReadableStream
}

function isTextMime(mimeType: string | undefined): boolean {
  return !!mimeType && (mimeType.startsWith('text/') || mimeType === 'application/json')
}

/** UTF-8 byte length of a string. */
export function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function preview(value: string): string {
  return value.length > 240 ? `${value.slice(0, 237)}...` : value
}

/** Find all start indexes of `find` within `content`. */
export function findOccurrences(content: string, find: string): number[] {
  const indexes: number[] = []
  let index = content.indexOf(find)
  while (index >= 0) {
    indexes.push(index)
    index = content.indexOf(find, index + find.length)
  }
  return indexes
}
