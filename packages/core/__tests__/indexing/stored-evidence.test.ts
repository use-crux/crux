import { describe, expect, it } from 'vitest'

import {
  StoredEvidenceContractError,
  deserializeStoredEvidence,
  serializeStoredEvidence,
  validateStoredEvidence,
} from '../../src/indexing'

const normalizedContent = 'Revenue was €10.'
const normalizedContentSha256 = '09a59b8741bee797f154d6dc36fae2bd2463dfbd2e2680409f910bdca3da001d'

function evidence() {
  return {
    schemaVersion: 2,
    documentSha256: 'a'.repeat(64),
    producer: {
      kind: 'parser',
      name: 'exceljs',
      version: '4.4.0',
      adapterVersion: '2.0.0',
    },
    coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A2:C2' },
    blockIds: ['sheet:Revenue', 'table:Revenue:A1:C2'],
    chunkId: 'chunk:revenue:0',
    chunkSha256: normalizedContentSha256,
    normalizedContent,
    normalizedContentSha256,
    normalizationVersion: '2.0.0',
    chunkerVersion: 'structured:2.0.0',
  }
}

describe('stored evidence schema 2', () => {
  it('validates, detaches, freezes, and serializes the immutable evidence chain', () => {
    const input = evidence()
    const validated = validateStoredEvidence(input)
    input.blockIds[0] = 'changed'

    expect(validated.blockIds).toEqual(['sheet:Revenue', 'table:Revenue:A1:C2'])
    expect(Object.isFrozen(validated)).toBe(true)
    expect(Object.isFrozen(validated.blockIds)).toBe(true)
    expect(deserializeStoredEvidence(serializeStoredEvidence(validated))).toEqual(validated)
  })

  it('round-trips every closed coordinate and producer variant', () => {
    const coordinates = [
      { kind: 'document', documentSha256: 'a'.repeat(64) },
      { kind: 'package-part', part: 'word/document.xml', anchor: 'body' },
      { kind: 'page', page: 1 },
      { kind: 'page-block', page: 1, block: 2, start: 0, end: 4 },
      { kind: 'slide', slide: 1, block: 2 },
      { kind: 'sheet-range', sheet: 'Revenue', range: 'A1:C2' },
      { kind: 'logical-table', rowStart: 0, rowEnd: 1 },
    ] as const

    for (const coordinate of coordinates) {
      const input = {
        ...evidence(),
        coordinate,
        ...(coordinate.kind === 'page'
          ? {
              producer: {
                kind: 'application-operation',
                operation: 'media.describe',
                identity: 'vision-prod',
                version: '1',
              },
            }
          : {}),
      }
      expect(deserializeStoredEvidence(serializeStoredEvidence(validateStoredEvidence(input)))).toEqual(input)
    }
  })

  it('rejects schema-1, unknown coordinate shapes, open evidence, and altered immutable content', () => {
    const schema1 = { ...evidence(), schemaVersion: 1 }
    expect(() => validateStoredEvidence(schema1)).toThrow(StoredEvidenceContractError)
    expect(() => deserializeStoredEvidence(JSON.stringify(schema1))).toThrow(StoredEvidenceContractError)

    const unknownCoordinate = { ...evidence(), coordinate: { kind: 'line', line: 1 } }
    expect(() => validateStoredEvidence(unknownCoordinate)).toThrow(StoredEvidenceContractError)

    const openEvidence = { ...evidence(), unexpected: true }
    expect(() => validateStoredEvidence(openEvidence)).toThrow(StoredEvidenceContractError)

    const alteredContent = { ...evidence(), normalizedContent: 'Revenue was €11.' }
    expect(() => validateStoredEvidence(alteredContent)).toThrow(StoredEvidenceContractError)
  })
})
