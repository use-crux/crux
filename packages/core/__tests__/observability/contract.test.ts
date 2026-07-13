import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import fixture from '../../src/observability/fixtures/generation-run.json'
import goldenNodeRun from '../../src/observability/fixtures/golden-node-run.json'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  CruxGraphRecordBatchSchema,
  CruxGraphRecordSchema,
  CruxRunStartRecordSchema,
  CruxRunResumeRecordSchema,
  CruxRunSuspendRecordSchema,
  CruxSpanStartRecordSchema,
} from '../../src/observability'
import { validateRecordForEmission } from '../../src/observability/validate-record'

describe('Crux observability graph contract', () => {
  it('requires run:start to be the first record in a segment in both validators', () => {
    const invalidStart = { ...fixture.records[0], segmentSeq: 2 }
    expect(CruxRunStartRecordSchema.safeParse(invalidStart).success).toBe(false)

    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      expect(validateRecordForEmission(invalidStart).ok).toBe(false)
    } finally {
      process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('keeps presentation read-model exports out of the wire contract module', async () => {
    const contractSource = await readFile(
      new URL('../../src/observability/contract.ts', import.meta.url),
      'utf8',
    )
    const presentationSource = await readFile(
      new URL('../../src/observability/presentation.ts', import.meta.url),
      'utf8',
    )

    expect(contractSource).not.toMatch(
      /export\s+(?:interface|type)\s+Crux(?:Presentation|RunSummaryView|SpanSummaryView|RunDetail)/u,
    )
    expect(presentationSource).toContain(
      'Presentation read-model — versioned independently of the wire contract; NOT covered by schema-version guarantees.',
    )
  })

  it('validates the shared generation run fixture', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(fixture)

    expect(parsed.records).toHaveLength(13)
    expect(
      parsed.records.every(
        (record) => record.schemaVersion === CRUX_OBSERVABILITY_SCHEMA_VERSION,
      ),
    ).toBe(true)
    expect(parsed.records.map((record) => record.type)).toEqual([
      'run:start',
      'span:start',
      'artifact',
      'edge',
      'artifact',
      'edge',
      'artifact',
      'edge',
      'span:event',
      'artifact',
      'edge',
      'span:end',
      'run:end',
    ])
    expect(parsed.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'context.contribution',
        preview: expect.objectContaining({
          kind: 'context.contribution',
          state: 'active',
          included: true,
        }),
      }),
    )
    expect(parsed.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'prompt.budget',
        preview: expect.objectContaining({
          kind: 'prompt.budget',
          dropped: expect.any(Array),
        }),
      }),
    )
    expect(parsed.records[0]).toMatchObject({
      type: 'run:start',
      sessionId: 'session_support_001',
      userId: 'user_support_001',
      attributes: expect.objectContaining({ 'meta.ticketId': 'ticket_123' }),
    })
  })

  it('validates the golden Node run fixture for RunDetail builders', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(goldenNodeRun)

    expect(
      parsed.records.some(
        (record) =>
          record.type === 'span:event' && record.name === 'token.chunk',
      ),
    ).toBe(true)
    expect(
      parsed.records.some(
        (record) => record.type === 'edge' && record.edgeType === 'explains',
      ),
    ).toBe(true)
    expect(
      parsed.records.filter(
        (record) =>
          record.type === 'span' && record.parentSpanId === '8f3227aa4c6f0565',
      ),
    ).toHaveLength(4)
    const artifactKinds = new Set(
      parsed.records.flatMap((record) =>
        record.type === 'artifact' ? [record.kind] : [],
      ),
    )
    expect([...artifactKinds]).toEqual(
      expect.arrayContaining([
        'retrieval.hits',
        'citation.report',
        'score.report',
        'composition.report',
        'handoff.payload',
        'delegate.report',
        'constraint.report',
        'guardrail.report',
        'routing.report',
        'cache.report',
        'compaction.report',
        'memory.snapshot',
        'embedding.report',
        'indexing.report',
        'ingest.report',
        'corpus.report',
        'security.report',
      ]),
    )
    const routingReport = parsed.records.find(
      (record) => record.type === 'artifact' && record.kind === 'routing.report',
    )
    expect(routingReport).toMatchObject({
      type: 'artifact',
      kind: 'routing.report',
      preview: {
        model: expect.any(String),
        trace: expect.any(Array),
      },
    })
    expect(routingReport).not.toHaveProperty('preview.kind')
  })

  it('keeps generation span fields inspectable without opening artifact payloads', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(fixture)
    const spanStart = parsed.records.find(
      (record) => record.type === 'span:start',
    )

    expect(spanStart).toMatchObject({
      runId: 'run_d202cd4d27c2073026a950af',
      segmentId: 'seg_d202cd4d27c2073026a950af',
      segmentSeq: 2,
      spanId: '841e9c04c4d09a6e',
      family: 'generation',
      primitive: 'generation.call',
      model: 'gpt-4o',
      provider: 'openai',
      promptId: 'support.reply',
    })
  })

  it('accepts custom edge and artifact names only through the custom namespace', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(fixture)
    const edge = parsed.records.find((record) => record.type === 'edge')
    const artifact = parsed.records.find((record) => record.type === 'artifact')

    expect(
      CruxGraphRecordSchema.safeParse({
        ...edge,
        edgeId: 'edge_custom',
        edgeType: 'custom.app_relation',
      }).success,
    ).toBe(true)
    expect(
      CruxGraphRecordSchema.safeParse({
        ...artifact,
        artifactId: 'artifact_custom',
        kind: 'custom.app_payload',
      }).success,
    ).toBe(true)
    expect(
      CruxGraphRecordSchema.safeParse({
        ...edge,
        edgeId: 'edge_invalid',
        edgeType: 'app_relation',
      }).success,
    ).toBe(false)
    expect(
      CruxGraphRecordSchema.safeParse({
        ...artifact,
        artifactId: 'artifact_invalid',
        kind: 'app_payload',
      }).success,
    ).toBe(false)
  })

  it('exports the canonical taxonomy required by the observability ADRs', () => {
    expect(CRUX_PRIMITIVE_FAMILIES).toEqual(
      expect.arrayContaining([
        'generation',
        'prompt',
        'context',
        'agent',
        'flow',
        'composition',
        'tool',
        'retrieval',
        'embedding',
        'memory',
        'constraint',
        'guardrail',
        'routing',
        'cache',
        'cost',
        'eval',
        'scoring',
        'citation',
        'handoff',
        'delegate',
        'plan',
        'task',
        'workspace',
        'indexing',
        'ingest',
        'corpus',
        'skill',
        'security',
        'custom',
      ]),
    )
    expect(CRUX_PRIMITIVE_NAMES).toEqual(
      expect.arrayContaining([
        'generation.call',
        'generation.stream',
        'flow.suspension',
        'prompt.resolve',
        'prompt.budget',
        'context.predicate',
        'composition.parallel',
        'composition.pipeline',
        'composition.consensus',
        'composition.swarm',
        'retrieval.pipeline',
        'retrieval.recipe',
        'retrieval.retrieve',
        'retrieval.query',
        'retrieval.stage',
        'retrieval.step',
        'tool.approval',
        'workspace.operation',
        'corpus.sync',
        'skill.load',
        'security.warning',
        'custom.operation',
      ]),
    )
    expect(CRUX_CANONICAL_EDGE_TYPES).toContain('delegate.invoked')
    expect(CRUX_CANONICAL_EDGE_TYPES).toContain('explains')
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).not.toContain('quality.snapshot')
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).toEqual(
      expect.arrayContaining([
        'approval.request',
        'tool.request',
        'stream.timeline',
        'context.contribution',
        'prompt.budget',
        'validation.feedback',
        'retrieval.hits',
        'citation.report',
        'score.report',
        'composition.report',
        'handoff.payload',
        'delegate.report',
        'constraint.report',
        'guardrail.report',
        'routing.report',
        'cache.report',
        'compaction.report',
        'memory.snapshot',
        'memory.write',
        'embedding.report',
        'indexing.report',
        'ingest.report',
        'corpus.report',
        'security.report',
      ]),
    )
  })

  it('accepts blocked terminal status and flow suspension records', () => {
    expect(
      CruxGraphRecordSchema.safeParse({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: 'rec_1111111111111111_1',
        type: 'span',
        runId: 'run_111111111111111111111111',
        segmentId: 'seg_111111111111111111111111',
        segmentSeq: 1,
        spanId: '1111111111111111',
        family: 'guardrail',
        primitive: 'guardrail.run',
        name: 'pii check',
        startedAt: '2026-05-16T18:00:00.001Z',
        endedAt: '2026-05-16T18:00:00.010Z',
        status: 'blocked',
      }).success,
    ).toBe(true)

    expect(
      CruxGraphRecordSchema.safeParse({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: 'rec_2222222222222222_2',
        type: 'span',
        runId: 'run_222222222222222222222222',
        segmentId: 'seg_222222222222222222222222',
        segmentSeq: 1,
        spanId: '2222222222222222',
        parentSpanId: '3333333333333333',
        family: 'flow',
        primitive: 'flow.suspension',
        name: 'plan-approval',
        startedAt: '2026-05-16T18:00:00.050Z',
        endedAt: '2026-05-16T18:00:00.050Z',
        status: 'suspended',
      }).success,
    ).toBe(true)
  })

  it('validates explicit run suspension and fresh-segment resumption', () => {
    const suspended = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_suspend',
      type: 'run:suspend',
      runId: 'run_lifecycle',
      segmentId: 'seg_lifecycle_a',
      segmentSeq: 2,
      traceId: '11111111111111111111111111111111',
      suspendedAt: '2026-05-16T18:00:01.000Z',
      reason: 'await-signal',
      attributes: { boundary: 'approval' },
    }
    const resumed = {
      schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
      recordId: 'rec_resume',
      type: 'run:resume',
      runId: 'run_lifecycle',
      segmentId: 'seg_lifecycle_b',
      segmentSeq: 1,
      traceId: '11111111111111111111111111111111',
      resumedAt: '2026-05-16T18:01:00.000Z',
      reason: 'signal',
      previousSegmentId: 'seg_lifecycle_a',
    }

    expect(CruxRunSuspendRecordSchema.parse(suspended)).toEqual(suspended)
    expect(CruxRunResumeRecordSchema.parse(resumed)).toEqual(resumed)
    expect(CruxGraphRecordSchema.safeParse(suspended).success).toBe(true)
    expect(CruxGraphRecordSchema.safeParse(resumed).success).toBe(true)
    expect(
      CruxRunResumeRecordSchema.safeParse({ ...resumed, segmentSeq: 2 }).success,
    ).toBe(false)
  })

  it('keeps primitive names mapped to their canonical families', () => {
    for (const primitive of CRUX_PRIMITIVE_NAMES) {
      expect(CRUX_PRIMITIVE_FAMILIES).toContain(
        CRUX_PRIMITIVE_FAMILY_BY_NAME[primitive],
      )
    }

    expect(
      CruxSpanStartRecordSchema.safeParse({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: 'rec_3333333333333333_3',
        type: 'span:start',
        runId: 'run_333333333333333333333333',
        segmentId: 'seg_333333333333333333333333',
        segmentSeq: 1,
        spanId: '4444444444444444',
        family: 'tool',
        primitive: 'generation.call',
        name: 'bad family',
        startedAt: '2026-05-16T18:00:00.000Z',
        status: 'running',
      }).success,
    ).toBe(false)
  })
})
