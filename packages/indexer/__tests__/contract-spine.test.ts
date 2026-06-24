import { describe, expect, expectTypeOf, it } from 'vitest'
import type { StaticSyntaxFileRecord } from '../indexer/contracts/static-syntax/schema'
import { indexPatchFromWorkerEvents, indexPatchToWorkerEvents } from '../indexer/contracts/worker-events/schema'
import {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../indexer/contracts/worker-events/fixtures'
import {
  NativeStaticCompilerRequestSchema,
  NativeStaticCompilerResponseSchema,
  parseNativeStaticCompilerRequest,
} from '../indexer/contracts/native-static/schema'
import {
  nativeStaticCompilerRequestFixtures,
  nativeStaticCompilerResponseFixtures,
} from '../indexer/contracts/native-static/fixtures'
import { nativeRuntimeContractFixtureGroups } from '../indexer/contracts/fixtures'
import { projectSemanticEvidenceBatches, semanticEvidenceBatchKinds } from '../indexer/contracts/semantic/schema'

describe('native runtime contract spine', () => {
  it('round-trips worker event fixtures through the contract path', () => {
    const events = indexPatchToWorkerEvents(workerEventFixturePatch, workerEventFixtureOptions)
    const json = JSON.parse(JSON.stringify(events))

    expect(indexPatchFromWorkerEvents(json)).toEqual(workerEventFixturePatch)
  })

  it('round-trips native static protocol fixtures through the contract path', () => {
    for (const request of nativeStaticCompilerRequestFixtures) {
      const json = JSON.parse(JSON.stringify(request))
      expect(NativeStaticCompilerRequestSchema.parse(json)).toEqual(json)
      expect(parseNativeStaticCompilerRequest(JSON.stringify(request))).toEqual({ ok: true, request: json })
    }

    for (const response of nativeStaticCompilerResponseFixtures) {
      const json = JSON.parse(JSON.stringify(response))
      expect(NativeStaticCompilerResponseSchema.parse(json)).toEqual(json)
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
    expect(nativeRuntimeContractFixtureGroups).toEqual(['worker-events', 'native-static'])
  })
})
