import { afterEach, describe, expect, it } from 'vitest'
import {
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  type CruxGraphRecord,
  createCruxArtifactId,
  createCruxEdgeId,
  createCruxRecordId,
  createCruxRunId,
  createCruxSpanEventId,
  createCruxSpanId,
  createCruxTraceId,
  CruxGraphRecordSchema,
  CruxSpanIdSchema,
  CruxTraceIdSchema,
  observe,
  resetObservabilityRuntime,
  subscribeObservability,
} from '../../src/observability'

const hex32 = /^[0-9a-f]{32}$/
const hex16 = /^[0-9a-f]{16}$/

describe('Crux observability identity', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('creates W3C-compatible crypto IDs for traces and spans', () => {
    expect(createCruxTraceId()).toMatch(hex32)
    expect(createCruxTraceId()).not.toBe('00000000000000000000000000000000')
    expect(createCruxSpanId()).toMatch(hex16)
    expect(createCruxSpanId()).not.toBe('0000000000000000')
  })

  it('creates contract-prefixed graph IDs with crypto hex suffixes', () => {
    expect(createCruxRunId()).toMatch(/^run_[0-9a-f]{24}$/)
    expect(createCruxRecordId()).toMatch(/^rec_[0-9a-f]{16}_[0-9a-z]+$/)
    expect(createCruxSpanEventId()).toMatch(/^event_[0-9a-f]{16}$/)
    expect(createCruxEdgeId()).toMatch(/^edge_[0-9a-f]{16}$/)
    expect(createCruxArtifactId()).toMatch(/^artifact_[0-9a-f]{16}$/)
  })

  it('rejects legacy prefixed trace and span identifiers at the schema boundary', () => {
    expect(CruxTraceIdSchema.safeParse('trace_generation_fixture_01').success).toBe(false)
    expect(CruxTraceIdSchema.safeParse('00000000000000000000000000000000').success).toBe(false)
    expect(CruxSpanIdSchema.safeParse('span_generation_fixture_01').success).toBe(false)
    expect(CruxSpanIdSchema.safeParse('0000000000000000').success).toBe(false)
  })

  it('requires segment identity on every graph record', () => {
    const record = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_1111111111111111_1',
      type: 'run:start',
      runId: 'run_111111111111111111111111',
      traceId: '11111111111111111111111111111111',
      name: 'identity test',
      rootPrimitive: 'run',
      startedAt: '2026-05-16T18:00:00.000Z',
      status: 'running',
    }

    expect(CruxGraphRecordSchema.safeParse(record).success).toBe(false)
    expect(
      CruxGraphRecordSchema.safeParse({
        ...record,
        segmentId: 'seg_111111111111111111111111',
        segmentSeq: 1,
      }).success,
    ).toBe(true)
  })

  it('emits one segment with monotonic segment-local order through the public runtime', async () => {
    const records: CruxGraphRecord[] = []
    subscribeObservability((record) => {
      records.push(record)
    })

    await observe.run({ name: 'sequenced graph', rootPrimitive: 'custom.operation' }, async () => {
      await observe.span({ name: 'sequenced span', primitive: 'custom.operation' }, async () => {
        observe.event({ name: 'checkpoint' })
        const artifactId = observe.artifact({
          kind: 'output',
          contentType: 'application/json',
          encoding: 'json',
          preview: { ok: true },
        })
        observe.edge({
          edgeType: 'produced',
          from: { kind: 'span', id: observe.captureContext()!.currentSpanId! },
          to: { kind: 'artifact', id: artifactId! },
        })
      })
    })

    expect(records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
    expect(new Set(records.map((record) => record.segmentId)).size).toBe(1)
    expect(records.map((record) => record.segmentSeq)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})
