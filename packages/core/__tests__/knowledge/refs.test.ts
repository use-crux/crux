import { describe, expect, it } from 'vitest'
import {
  decodeKnowledgeRef,
  encodeKnowledgeRef,
  isKnowledgeRef,
  isKnowledgeRefKind,
  type KnowledgeRef,
} from '../../src/knowledge/refs'

describe('KnowledgeRef codec', () => {
  it('round-trips every reference kind through key-safe encoding', () => {
    const refs: KnowledgeRef[] = idSegments.flatMap((left) => [
      { kind: 'document' as const, sourceId: left },
      { kind: 'entity' as const, entityId: left },
      ...idSegments.flatMap((right) => [
        { kind: 'parent' as const, sourceId: left, parentId: right },
        { kind: 'chunk' as const, sourceId: left, chunkId: right },
      ]),
    ])

    for (const ref of refs) {
      const encoded = encodeKnowledgeRef(ref)

      expect(encodeKnowledgeRef(ref)).toBe(encoded)
      expect(decodeKnowledgeRef(encoded)).toEqual(ref)
    }

    expect(encodeKnowledgeRef({ kind: 'chunk', sourceId: 'source:with%reserved-é', chunkId: 'chunk:%:東京' })).toBe(
      'chunk:source%3Awith%25reserved-é:chunk%3A%25%3A東京',
    )
  })

  it('returns null for malformed encoded references', () => {
    expect(decodeKnowledgeRef('')).toBeNull()
    expect(decodeKnowledgeRef('document')).toBeNull()
    expect(decodeKnowledgeRef('document:source:extra')).toBeNull()
    expect(decodeKnowledgeRef('chunk:source')).toBeNull()
    expect(decodeKnowledgeRef('entity:%')).toBeNull()
    expect(decodeKnowledgeRef('unknown:id')).toBeNull()
  })

  it('guards reference kinds and references', () => {
    expect(isKnowledgeRefKind('chunk')).toBe(true)
    expect(isKnowledgeRefKind('assertion')).toBe(false)
    expect(isKnowledgeRef({ kind: 'chunk', sourceId: 'source', chunkId: 'chunk' })).toBe(true)
    expect(isKnowledgeRef({ kind: 'chunk', sourceId: 'source' })).toBe(false)
  })
})

const idSegments = ['', 'plain', 'source:with%reserved-é', 'chunk:%:東京']
