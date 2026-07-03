import { describe, expect, it } from 'vitest'
import fixture from '../../observability/fixtures/generation-run.json'
import goldenNodeRun from '../../observability/fixtures/golden-node-run.json'
import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  CRUX_CANONICAL_EDGE_TYPES,
  CRUX_OBSERVABILITY_SCHEMA_VERSION,
  CRUX_PRIMITIVE_FAMILIES,
  CRUX_PRIMITIVE_FAMILY_BY_NAME,
  CRUX_PRIMITIVE_NAMES,
  CruxGraphRecordBatchSchema,
  CruxGraphRecordSchema,
  CruxSpanStartRecordSchema,
} from '../../observability'

describe('Crux observability graph contract', () => {
  it('validates the shared generation run fixture', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(fixture)

    expect(parsed.records).toHaveLength(13)
    expect(parsed.records.every((record) => record.schemaVersion === CRUX_OBSERVABILITY_SCHEMA_VERSION)).toBe(true)
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
  })

  it('validates the golden Node run fixture for RunDetail builders', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(goldenNodeRun)

    expect(parsed.records.some((record) => record.type === 'span:event' && record.name === 'token.delta')).toBe(true)
    expect(parsed.records.some((record) => record.type === 'edge' && record.edgeType === 'explains')).toBe(true)
    expect(
      parsed.records.filter((record) => record.type === 'span' && record.parentSpanId === 'span_golden_parallel'),
    ).toHaveLength(4)
    const artifactKinds = new Set(parsed.records.flatMap((record) => (record.type === 'artifact' ? [record.kind] : [])))
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
  })

  it('keeps generation span fields inspectable without opening artifact payloads', () => {
    const parsed = CruxGraphRecordBatchSchema.parse(fixture)
    const spanStart = parsed.records.find((record) => record.type === 'span:start')

    expect(spanStart).toMatchObject({
      runId: 'run_generation_fixture_01',
      spanId: 'span_generation_fixture_01',
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
    expect(CRUX_CANONICAL_ARTIFACT_KINDS).toEqual(
      expect.arrayContaining([
        'tool.request',
        'stream.timeline',
        'context.contribution',
        'prompt.budget',
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
  })

  it('accepts blocked terminal status and flow suspension records', () => {
    expect(
      CruxGraphRecordSchema.safeParse({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: 'rec_blocked',
        type: 'span',
        runId: 'run_blocked',
        spanId: 'span_blocked',
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
        recordId: 'rec_suspend',
        type: 'span',
        runId: 'run_suspend',
        spanId: 'span_suspend',
        parentSpanId: 'span_flow',
        family: 'flow',
        primitive: 'flow.suspension',
        name: 'plan-approval',
        startedAt: '2026-05-16T18:00:00.050Z',
        endedAt: '2026-05-16T18:00:00.050Z',
        status: 'suspended',
      }).success,
    ).toBe(true)
  })

  it('keeps primitive names mapped to their canonical families', () => {
    for (const primitive of CRUX_PRIMITIVE_NAMES) {
      expect(CRUX_PRIMITIVE_FAMILIES).toContain(CRUX_PRIMITIVE_FAMILY_BY_NAME[primitive])
    }

    expect(
      CruxSpanStartRecordSchema.safeParse({
        schemaVersion: CRUX_OBSERVABILITY_SCHEMA_VERSION,
        recordId: 'rec_invalid_family',
        type: 'span:start',
        runId: 'run_invalid_family',
        spanId: 'span_invalid_family',
        family: 'tool',
        primitive: 'generation.call',
        name: 'bad family',
        startedAt: '2026-05-16T18:00:00.000Z',
        status: 'running',
      }).success,
    ).toBe(false)
  })
})
