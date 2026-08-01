/**
 * Knowledge reference types and key-safe encoding.
 *
 * This module owns the closed {@link KnowledgeRefKind} set, the
 * {@link KnowledgeRef} union, and the canonical string codec used by record
 * keys.
 *
 * @module
 */

/** Closed set of reference kinds connected knowledge can address. */
export type KnowledgeRefKind = 'document' | 'parent' | 'chunk' | 'entity'

/** A precise, kind-discriminated reference to indexed evidence. */
export type KnowledgeRef =
  | { readonly kind: 'document'; readonly sourceId: string }
  | { readonly kind: 'parent'; readonly sourceId: string; readonly parentId: string }
  | { readonly kind: 'chunk'; readonly sourceId: string; readonly chunkId: string }
  | { readonly kind: 'entity'; readonly entityId: string }

/** Return whether a value is a supported {@link KnowledgeRefKind}. */
export function isKnowledgeRefKind(value: unknown): value is KnowledgeRefKind {
  return value === 'document' || value === 'parent' || value === 'chunk' || value === 'entity'
}

/** Return whether a value is a structurally valid {@link KnowledgeRef}. */
export function isKnowledgeRef(value: unknown): value is KnowledgeRef {
  if (!isRecord(value) || !isKnowledgeRefKind(value.kind)) return false
  switch (value.kind) {
    case 'document':
      return typeof value.sourceId === 'string'
    case 'parent':
      return typeof value.sourceId === 'string' && typeof value.parentId === 'string'
    case 'chunk':
      return typeof value.sourceId === 'string' && typeof value.chunkId === 'string'
    case 'entity':
      return typeof value.entityId === 'string'
  }
}

/** Encode a {@link KnowledgeRef} into the canonical record-key representation. */
export function encodeKnowledgeRef(ref: KnowledgeRef): string {
  switch (ref.kind) {
    case 'document':
      return `document:${encodeSegment(ref.sourceId)}`
    case 'parent':
      return `parent:${encodeSegment(ref.sourceId)}:${encodeSegment(ref.parentId)}`
    case 'chunk':
      return `chunk:${encodeSegment(ref.sourceId)}:${encodeSegment(ref.chunkId)}`
    case 'entity':
      return `entity:${encodeSegment(ref.entityId)}`
  }
}

/** Decode the canonical record-key representation into a {@link KnowledgeRef}. */
export function decodeKnowledgeRef(value: string): KnowledgeRef | null {
  const parts = value.split(':')
  const kind = parts[0]
  if (!isKnowledgeRefKind(kind)) return null

  switch (kind) {
    case 'document': {
      if (parts.length !== 2) return null
      const sourceId = decodeSegment(parts[1] ?? '')
      return sourceId === null ? null : { kind, sourceId }
    }
    case 'parent': {
      if (parts.length !== 3) return null
      const sourceId = decodeSegment(parts[1] ?? '')
      const parentId = decodeSegment(parts[2] ?? '')
      return sourceId === null || parentId === null ? null : { kind, sourceId, parentId }
    }
    case 'chunk': {
      if (parts.length !== 3) return null
      const sourceId = decodeSegment(parts[1] ?? '')
      const chunkId = decodeSegment(parts[2] ?? '')
      return sourceId === null || chunkId === null ? null : { kind, sourceId, chunkId }
    }
    case 'entity': {
      if (parts.length !== 2) return null
      const entityId = decodeSegment(parts[1] ?? '')
      return entityId === null ? null : { kind, entityId }
    }
  }
}

function encodeSegment(value: string): string {
  return value.replace(/%/g, '%25').replace(/:/g, '%3A')
}

function decodeSegment(value: string): string | null {
  let decoded = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (char !== '%') {
      decoded += char
      continue
    }

    const code = value.slice(index + 1, index + 3).toUpperCase()
    if (code === '25') {
      decoded += '%'
    } else if (code === '3A') {
      decoded += ':'
    } else {
      return null
    }
    index += 2
  }
  return decoded
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
