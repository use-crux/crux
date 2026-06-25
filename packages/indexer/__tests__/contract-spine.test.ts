import { describe, expect, expectTypeOf, it } from 'vitest'
import type { StaticSyntaxFileRecord } from '../contracts/static-syntax/schema'
import { indexPatchFromWorkerEvents, indexPatchToWorkerEvents } from '../contracts/worker-events/schema'
import {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../contracts/worker-events/fixtures'
import {
  StaticIndexCompilerRequestSchema,
  StaticIndexCompilerResponseSchema,
  parseStaticIndexCompilerRequest,
} from '../contracts/static-index/schema'
import {
  staticIndexCompilerRequestFixtures,
  staticIndexCompilerResponseFixtures,
} from '../contracts/static-index/fixtures'
import { staticIndexRuntimeContractFixtureGroups } from '../contracts/fixtures'
import { projectSemanticEvidenceBatches, semanticEvidenceBatchKinds } from '../contracts/semantic/schema'

describe('Static Index runtime contract spine', () => {
  it('round-trips worker event fixtures through the contract path', () => {
    const events = indexPatchToWorkerEvents(workerEventFixturePatch, workerEventFixtureOptions)
    const json = JSON.parse(JSON.stringify(events))

    expect(indexPatchFromWorkerEvents(json)).toEqual(workerEventFixturePatch)
  })

  it('round-trips Static Index protocol fixtures through the contract path', () => {
    for (const request of staticIndexCompilerRequestFixtures) {
      const json = JSON.parse(JSON.stringify(request))
      expect(StaticIndexCompilerRequestSchema.parse(json)).toEqual(json)
      expect(parseStaticIndexCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request: json })
    }

    for (const response of staticIndexCompilerResponseFixtures) {
      const json = JSON.parse(JSON.stringify(response))
      expect(StaticIndexCompilerResponseSchema.parse(json)).toEqual(json)
    }
  })

  it('exposes static syntax and semantic evidence contracts from spine paths', () => {
    expectTypeOf<StaticSyntaxFileRecord>().toHaveProperty('schemaVersion').toEqualTypeOf<1>()
    expect(semanticEvidenceBatchKinds).toEqual([
      'definitions',
      'relations',
      'sourceRefs',
      'diagnostics',
      'lintFindings',
    ])
    expect(projectSemanticEvidenceBatches([{ kind: 'diagnostics', facts: [] }])).toEqual({ diagnostics: [] })
  })

  it('indexes fixture groups from one contract fixtures path', () => {
    expect(staticIndexRuntimeContractFixtureGroups).toEqual(['worker-events', 'static-index'])
  })
})
