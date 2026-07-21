import { describe, expect, expectTypeOf, it } from 'vitest'
import type { StaticSyntaxFileRecord } from '../src/contracts/static-syntax/schema'
import { indexPatchFromWorkerEvents, indexPatchToWorkerEvents } from '../src/contracts/worker-events/schema'
import { workerEventFixtureOptions, workerEventFixturePatch } from '../src/contracts/worker-events/fixtures'
import {
  StaticIndexCompilerRequestSchema,
  StaticIndexCompilerResponseSchema,
  parseStaticIndexCompilerRequest,
} from '../src/contracts/static-index/schema'
import {
  staticIndexCompilerRequestFixtures,
  staticIndexCompilerResponseFixtures,
} from '../src/contracts/static-index/fixtures'
import { readStaticIndexRuntimeSharedFixture, staticIndexRuntimeContractFixtureGroups } from '../src/contracts/fixtures'
import {
  staticIndexRuntimeContractManifest,
  staticIndexRuntimeContractManifestGroups,
} from '../src/contracts/contract-manifest'
import { projectSemanticEvidenceBatches, semanticEvidenceBatchKinds } from '../src/contracts/semantic/schema'

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

  it('projects the shared semantic evidence fixture through the contract path', () => {
    const fixture = readStaticIndexRuntimeSharedFixture('semantic-evidence')

    expect(fixture.batches.map((batch) => batch.kind)).toEqual([
      'definitions',
      'relations',
      'sourceRefs',
      'diagnostics',
      'lintFindings',
    ])
    expect(projectSemanticEvidenceBatches(fixture.batches)).toMatchObject({
      definitions: [expect.objectContaining({ id: 'prompt:semantic-contract' })],
      diagnostics: [expect.objectContaining({ code: 'semantic.unsupported' })],
      lintFindings: [expect.objectContaining({ ruleId: 'semantic.degraded' })],
    })
  })

  it('indexes fixture groups from one contract fixtures path', () => {
    expect(staticIndexRuntimeContractFixtureGroups).toEqual([
      'worker-events',
      'static-syntax-records',
      'static-index',
      'semantic-evidence',
    ])
  })

  it('exports the canonical cross-language manifest from the contracts package', () => {
    expect(staticIndexRuntimeContractManifestGroups).toEqual(staticIndexRuntimeContractFixtureGroups)
    expect(staticIndexRuntimeContractManifest.groups.map((group) => group.id)).toEqual(
      staticIndexRuntimeContractFixtureGroups,
    )
    expect(staticIndexRuntimeContractManifest.groups.map((group) => group.mirrorStatus)).toEqual([
      'checked-mirror',
      'checked-mirror',
      'checked-mirror',
      'typescript-only',
    ])
    expect(staticIndexRuntimeContractManifest.protocolVersions).toEqual({
      projectIndexWorkerEvents: 3,
      staticIndexCompiler: 2,
    })
  })
})
