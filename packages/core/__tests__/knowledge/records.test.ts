import { describe, expect, it } from 'vitest'
import {
  asKnowledgeEdgeRecord,
  asKnowledgeEntityRecord,
  createKnowledgeEdgeRecord,
  createKnowledgeEntityRecord,
} from '../../src/knowledge/records'

const chunkA = { kind: 'chunk' as const, sourceId: 'doc:1', chunkId: 'chunk%a' }
const chunkB = { kind: 'chunk' as const, sourceId: 'doc:1', chunkId: 'chunk%b' }
const entity = { kind: 'entity' as const, entityId: 'Entity:100%' }

describe('knowledge record codecs', () => {
  it('creates and narrows canonical edge records', () => {
    const record = createKnowledgeEdgeRecord({
      type: 'mentions',
      from: chunkA,
      to: entity,
      direction: 'directed',
      description: 'Chunk mentions entity.',
      evidence: [{ sourceId: 'doc:1', chunkRef: chunkA, provenance: 'exact' }],
      stageId: 'relate',
      stageVersion: 1,
      generationId: 'gen:1',
      namespace: 'tenant:a',
      now: 123,
    })

    expect(record.edgeId).toMatch(/^edge_[0-9a-f]{8}$/)
    expect(createKnowledgeEdgeRecord({ ...record, now: 456 }).edgeId).toBe(record.edgeId)
    expect(record).toEqual({
      _cruxRecordType: 'knowledge-edge',
      edgeId: record.edgeId,
      type: 'mentions',
      from: chunkA,
      to: entity,
      direction: 'directed',
      description: 'Chunk mentions entity.',
      evidence: [{ sourceId: 'doc:1', chunkRef: chunkA, provenance: 'exact' }],
      stageId: 'relate',
      stageVersion: 1,
      generationId: 'gen:1',
      namespace: 'tenant:a',
      createdAt: 123,
      updatedAt: 123,
    })
    expect(asKnowledgeEdgeRecord(record)).toEqual(record)
  })

  it('uses one direction-normalized identity for symmetric edges', () => {
    const left = createKnowledgeEdgeRecord({
      type: 'related',
      from: chunkB,
      to: chunkA,
      direction: 'symmetric',
      evidence: [],
      stageId: 'relate',
      stageVersion: 1,
      generationId: 'gen',
      namespace: 'ns',
      now: 1,
    })
    const right = createKnowledgeEdgeRecord({
      type: 'related',
      from: chunkA,
      to: chunkB,
      direction: 'symmetric',
      evidence: [],
      stageId: 'relate',
      stageVersion: 1,
      generationId: 'gen',
      namespace: 'ns',
      now: 1,
    })

    expect(left.edgeId).toBe(right.edgeId)
    expect(left.from).toEqual(chunkA)
    expect(left.to).toEqual(chunkB)
  })

  it('rejects malformed edge records by returning null', () => {
    const valid = createKnowledgeEdgeRecord({
      type: 'mentions',
      from: chunkA,
      to: entity,
      direction: 'directed',
      evidence: [{ sourceId: 'doc:1', chunkRef: chunkA, provenance: 'derived' }],
      stageId: 'relate',
      stageVersion: 1,
      generationId: 'gen',
      namespace: 'ns',
      now: 1,
    })

    const { edgeId: _edgeId, ...missingEdgeId } = valid
    void _edgeId

    expect(asKnowledgeEdgeRecord({ ...valid, _cruxRecordType: 'knowledge-entity' })).toBeNull()
    expect(asKnowledgeEdgeRecord(missingEdgeId)).toBeNull()
    expect(asKnowledgeEdgeRecord({ ...valid, evidence: [{ sourceId: 'doc:1', chunkRef: entity, provenance: 'exact' }] })).toBeNull()
    expect(asKnowledgeEdgeRecord({ ...valid, stageVersion: '1' })).toBeNull()
  })

  it('creates and narrows canonical entity records', () => {
    const record = createKnowledgeEntityRecord({
      entityId: 'Entity:100%',
      canonicalName: 'Entity 100',
      aliases: ['E100', 'Entity:100%'],
      description: 'A known entity.',
      generationId: 'gen:1',
      namespace: 'tenant:a',
    })

    expect(record).toEqual({
      _cruxRecordType: 'knowledge-entity',
      entityId: 'Entity:100%',
      canonicalName: 'Entity 100',
      aliases: ['E100', 'Entity:100%'],
      description: 'A known entity.',
      generationId: 'gen:1',
      namespace: 'tenant:a',
    })
    expect(asKnowledgeEntityRecord(record)).toEqual(record)
  })

  it('rejects malformed entity records by returning null', () => {
    const valid = createKnowledgeEntityRecord({
      entityId: 'Entity:100%',
      canonicalName: 'Entity 100',
      aliases: ['E100'],
      generationId: 'gen',
      namespace: 'ns',
    })

    const { canonicalName: _canonicalName, ...missingCanonicalName } = valid
    void _canonicalName

    expect(asKnowledgeEntityRecord({ ...valid, _cruxRecordType: 'knowledge-edge' })).toBeNull()
    expect(asKnowledgeEntityRecord(missingCanonicalName)).toBeNull()
    expect(asKnowledgeEntityRecord({ ...valid, aliases: ['E100', 100] })).toBeNull()
    expect(asKnowledgeEntityRecord({ ...valid, description: 100 })).toBeNull()
  })
})
