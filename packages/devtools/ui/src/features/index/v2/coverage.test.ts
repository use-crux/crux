import { describe, expect, it } from 'vitest'
import { describeCatalogCoverage } from './coverage'
import type { ObservabilityDefinitionActivitySummary } from '@/types'

function activity(runCount: number): ObservabilityDefinitionActivitySummary {
  return { definitionId: 'def:1', runCount }
}

describe('describeCatalogCoverage', () => {
  it('classifies a directly-observed kind as direct-activity, with evidence when runCount > 0', () => {
    expect(describeCatalogCoverage('agent', activity(3))).toMatchObject({
      treatment: 'direct-activity',
      runCount: 3,
      hasRuntimeEvidence: true,
    })
  })

  it('classifies a directly-observed kind with no runs as direct-activity without evidence, not no-runtime', () => {
    expect(describeCatalogCoverage('agent', undefined)).toMatchObject({
      treatment: 'direct-activity',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('does not fabricate activity for a contributor without canonical runtime identity', () => {
    expect(describeCatalogCoverage('injectable', activity(0), activity(5))).toMatchObject({
      treatment: 'no-runtime',
      runCount: 0,
      hasRuntimeEvidence: false,
      parentDerived: false,
    })
  })

  it.each(['deferred-work', 'media.operation', 'ingest.source'])(
    'describes %s as runtime-observed but unjoined without accepting fabricated definition activity',
    (kind) => {
      expect(describeCatalogCoverage(kind, activity(8), activity(5))).toMatchObject({
        treatment: 'runtime-unjoined',
        runCount: 0,
        hasRuntimeEvidence: false,
        parentDerived: false,
      })
    },
  )

  it('classifies a structural-child kind with declared runtime primitives (flow.step) as contributor', () => {
    expect(describeCatalogCoverage('flow.step', activity(2))).toMatchObject({
      treatment: 'contributor',
      runCount: 2,
    })
  })

  it('classifies a structural-child kind with no declared runtime primitive as a truthful derived contributor', () => {
    expect(describeCatalogCoverage('routing.router.route', activity(0), activity(9))).toMatchObject({
      treatment: 'contributor',
      runCount: 9,
      parentDerived: true,
    })
  })

  it('treats a Quality-owned structural child as Quality-primary', () => {
    expect(describeCatalogCoverage('evaluation.case', activity(2))).toMatchObject({
      treatment: 'quality-primary',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('classifies a quality-owned kind with no direct-runtime secondary (dataset) as quality-primary with zero runtime evidence', () => {
    expect(describeCatalogCoverage('dataset', activity(4))).toMatchObject({
      treatment: 'quality-primary',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('classifies a quality-owned kind with a direct-runtime secondary (scorer) as quality-primary but surfaces real runtime evidence', () => {
    expect(describeCatalogCoverage('scorer', activity(7))).toMatchObject({
      treatment: 'quality-primary',
      runCount: 7,
      hasRuntimeEvidence: true,
    })
  })

  it('classifies a static-only kind (registry) as no-runtime', () => {
    expect(describeCatalogCoverage('registry', activity(1))).toMatchObject({
      treatment: 'no-runtime',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('classifies the fallback sentinel kind as no-runtime', () => {
    expect(describeCatalogCoverage('unknown', undefined)).toMatchObject({
      treatment: 'no-runtime',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('keeps a child with no live identity path at truthful zero runtime', () => {
    expect(describeCatalogCoverage('rag.pipeline.stage', activity(9), activity(9))).toMatchObject({
      treatment: 'no-runtime',
      runCount: 0,
      hasRuntimeEvidence: false,
    })
  })

  it('falls back to no-runtime for a kind absent from the manifest, never crashing', () => {
    expect(describeCatalogCoverage('made-up-kind', activity(1))).toMatchObject({
      treatment: 'no-runtime',
    })
  })
})
