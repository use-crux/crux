import { describe, expect, it } from 'vitest'

import { createIndexedChunkRecord, indexedChunkToHit } from '../../src/indexed-knowledge/records'
import type { CruxChunk } from '../../src/indexing'
import { legacyTextChunk, legacyTextRecord, schema2TextChunk } from '../fixtures/schema2-stored-evidence'

const content = 'Revenue was €10.'

function chunk(): CruxChunk {
  return schema2TextChunk({
    namespace: 'finance',
    sourceId: 'revenue.xlsx',
    chunkId: 'chunk:revenue:0',
    ordinal: 0,
    content,
    metadata: {},
  })
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

    expect(indexedChunkToHit({ value: legacyTextRecord(record, 'schema-1-evidence'), score: 0.9 })).toBeNull()
  })

  it('rejects missing evidence instead of hydrating a legacy chunk', () => {
    const { evidence: _, ...legacyInput } = chunk()
    const legacy = legacyTextChunk(legacyInput)

    expect(() => createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: legacy, now: 1 })).toThrow(
      'Stored evidence is required',
    )

    const persisted = createIndexedChunkRecord({ indexerId: 'docs', generationId: 'g1', chunk: chunk(), now: 1 })
    expect(indexedChunkToHit({ value: legacyTextRecord(persisted, 'missing-evidence'), score: 0.9 })).toBeNull()
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

    const zeroBased = {
      ...record,
      provenance: {
        spreadsheets: [{
          sheetBlockId: 'sheet:Revenue', tableBlockId: 'table:Revenue', sheet: 'Revenue', index: 0, range: 'A1',
          cells: [{ id: 'cell:A1', address: 'A1', row: 0, column: 0, displayedValue: 'Plan' }],
        }],
      },
    }
    expect(indexedChunkToHit({ value: zeroBased, score: 0.9 })).toBeNull()
  })
})
