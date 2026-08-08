import { describe, expect, it } from 'vitest'

import { sha256Hex } from '../../src/content/sha256'
import { createIndexedChunkRecord, indexedChunkToHit } from '../../src/indexed-knowledge/records'
import type { CruxChunk } from '../../src/indexing'

const content = 'Revenue was €10.'
const contentHash = sha256Hex(new TextEncoder().encode(content))

function chunk(): CruxChunk {
  return {
    namespace: 'finance',
    sourceId: 'revenue.xlsx',
    chunkId: 'chunk:revenue:0',
    ordinal: 0,
    content,
    metadata: {},
    evidence: {
      schemaVersion: 2,
      documentSha256: 'a'.repeat(64),
      producer: { kind: 'parser', name: 'exceljs', version: '4.4.0', adapterVersion: '2.0.0' },
      coordinate: { kind: 'sheet-range', sheet: 'Revenue', range: 'A2:C2' },
      blockIds: ['sheet:Revenue', 'table:Revenue:A1:C2'],
      chunkId: 'chunk:revenue:0',
      chunkSha256: contentHash,
      normalizedContent: content,
      normalizedContentSha256: contentHash,
      normalizationVersion: '2.0.0',
      chunkerVersion: 'structured:2.0.0',
    },
  }
}

describe('stored retrieval evidence', () => {
  it('round-trips exact schema-2 evidence from an indexed record to a retrieval hit', () => {
    const record = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk(), now: 1 })
    const hit = indexedChunkToHit({ value: record, score: 0.9 })

    expect(record.evidence).toEqual(chunk().evidence)
    expect(hit).toMatchObject({ evidence: chunk().evidence })
  })

  it('rejects persisted schema-1 evidence instead of guessing an upgrade', () => {
    const record = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk(), now: 1 })
    const stale = { ...record, evidence: { ...record.evidence, schemaVersion: 1 } }

    expect(indexedChunkToHit({ value: stale, score: 0.9 })).toBeNull()
  })

  it('rejects missing evidence instead of hydrating a legacy chunk', () => {
    const legacy = { ...chunk(), evidence: undefined }

    expect(() => createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: legacy, now: 1 })).toThrow(
      'Stored evidence is required',
    )

    const persisted = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk(), now: 1 })
    expect(indexedChunkToHit({ value: { ...persisted, evidence: undefined }, score: 0.9 })).toBeNull()
  })

  it('rejects malformed persisted structured spreadsheet facts', () => {
    const record = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk(), now: 1 })
    const malformed = {
      ...record,
      provenance: {
        spreadsheets: [{
          sheetBlockId: 'sheet:Revenue',
          tableBlockId: 'table:Revenue',
          sheet: 'Revenue',
          index: 0,
          range: 'A1:B2',
          cells: [],
          unexpected: true,
        }],
      },
    }

    expect(indexedChunkToHit({ value: malformed, score: 0.9 })).toBeNull()
  })
})
