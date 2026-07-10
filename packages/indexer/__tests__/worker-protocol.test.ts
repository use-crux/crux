import { describe, expect, it } from 'vitest'
import type { ResolvedProjectModel } from '@use-crux/core/project-index'
import type { IndexPatch } from '../src/indexer/patches'
import {
  indexPatchFromWorkerEvents,
  projectIndexArtifactToWorkerEvents,
  indexPatchToWorkerEvents,
  projectIndexArtifactToWorkerEvent,
} from '../src/contracts/worker-events'
import {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../src/contracts/worker-events/fixtures'
import { readStaticIndexRuntimeSharedFixture } from '../src/contracts/fixtures'

describe('project index worker protocol', () => {
  it('streams contract fixture facts in ordered batches and reconstructs the same patch', () => {
    const events = indexPatchToWorkerEvents(workerEventFixturePatch, workerEventFixtureOptions)

    expect(events.map((event) => event.type)).toEqual([
      'phase:start',
      'fact:batch',
      'fact:batch',
      'sourceProfile:batch',
      'phase:done',
    ])
    expect(events[1]).toMatchObject({ type: 'fact:batch', sequence: 0 })
    expect(events[2]).toMatchObject({ type: 'fact:batch', sequence: 1 })

    expect(indexPatchFromWorkerEvents(events)).toEqual(workerEventFixturePatch)
  })

  it('reconstructs the shared worker event fixture file', () => {
    const fixture = readStaticIndexRuntimeSharedFixture('worker-events')

    expect(fixture.events.map((event) => event.type)).toEqual([
      'phase:start',
      'fact:batch',
      'sourceProfile:batch',
      'phase:done',
    ])
    expect(indexPatchFromWorkerEvents(fixture.events)).toMatchObject({
      phase: 'ast',
      project: { root: '/repo', name: 'contract-spine' },
      facts: {
        definitions: [expect.objectContaining({ id: 'prompt:contract-spine' })],
        diagnostics: [expect.objectContaining({ id: 'diagnostic:contract-spine' })],
      },
    })
  })

  it('loads shared worker event edge-case fixtures', () => {
    const fixture = readStaticIndexRuntimeSharedFixture('worker-event-cases')

    expect(fixture.artifactDone).toMatchObject({
      protocolVersion: 2,
      type: 'artifact:done',
      artifact: 'projectStaticSyntaxPlan',
      root: '/repo',
    })
    expect(fixture.artifactError).toMatchObject({
      protocolVersion: 2,
      type: 'artifact:error',
      error: { message: 'static syntax plan failed' },
    })
    expect(fixture.phaseError).toMatchObject({
      protocolVersion: 2,
      type: 'phase:error',
      phase: 'ast',
      error: { code: 'E_STATIC_INDEX' },
    })
    expect(fixture.outOfOrderEvents.map((event) => event.type)).toEqual(['phase:start', 'fact:batch'])
    expect(fixture.outOfOrderEvents[1]).toMatchObject({ type: 'fact:batch', sequence: 1 })
  })

  it('streams source profile rows and carries terminal profile metadata on phase:done', () => {
    const patch: IndexPatch = {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo', name: 'fixture' },
      startedAt: '2026-06-18T10:00:00.000Z',
      finishedAt: '2026-06-18T10:00:00.001Z',
      status: 'ok',
      facts: {},
      semanticSourceProfile: {
        files: [
          {
            file: '/repo/src/writer.ts',
            sourceHash: 'hash',
            sourceBytes: 10,
            hints: { nativeDirectCruxCandidate: true, cruxCallNames: ['prompt'] },
          },
        ],
        dependencyClosure: ['/repo/src/writer.ts'],
        sourceBytes: 10,
        complete: true,
      },
    }

    const events = indexPatchToWorkerEvents(patch, {
      transactionId: 'tx-ast',
      producer: { name: '@use-crux/indexer', version: 'test' },
      maxFactsPerBatch: 2,
    })

    expect(events.map((event) => event.type)).toEqual(['phase:start', 'sourceProfile:batch', 'phase:done'])
    const semanticSourceProfile = patch.semanticSourceProfile
    if (!semanticSourceProfile) throw new Error('Expected semantic source profile fixture')
    const sourceProfileBatch = events.find((event) => event.type === 'sourceProfile:batch')
    expect(sourceProfileBatch).toMatchObject({ type: 'sourceProfile:batch', files: semanticSourceProfile.files })
    expect(sourceProfileBatch).not.toHaveProperty('complete')
    expect(events.find((event) => event.type === 'phase:done')).toMatchObject({
      patch: { semanticSourceProfile },
    })
    expect(indexPatchFromWorkerEvents(events)).toEqual(patch)
  })

  it('splits fact batches by serialized event bytes', () => {
    const patch: IndexPatch = {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo', name: 'fixture' },
      startedAt: '2026-07-06T10:00:00.000Z',
      finishedAt: '2026-07-06T10:00:00.001Z',
      status: 'ok',
      facts: {
        diagnostics: [
          diagnosticFixture('diagnostic:large-a'),
          diagnosticFixture('diagnostic:large-b'),
        ],
      },
    }

    const events = indexPatchToWorkerEvents(patch, {
      transactionId: 'tx-large-facts',
      producer: { name: '@use-crux/indexer', version: 'test' },
      maxFactsPerBatch: 10,
      maxEventBytes: 1_500,
    })
    const factBatches = events.filter((event) => event.type === 'fact:batch')

    expect(factBatches).toHaveLength(2)
    expect(factBatches.map((event) => event.facts)).toEqual([[expect.any(Object)], [expect.any(Object)]])
    expect(indexPatchFromWorkerEvents(events)).toEqual(patch)
  })

  it('streams JSON artifacts through typed V2 artifact events', () => {
    const projectModel = {
      root: {
        value: '/repo',
        provenance: { kind: 'filesystem', path: '/repo', convention: 'resolved project root' },
      },
      resolutionMode: {
        value: 'config-policy',
        provenance: { kind: 'runtime', attribute: 'project-model.resolutionMode' },
      },
      configFiles: [],
      sourceRoots: [],
      ignoredPaths: [],
      definitions: [],
      relations: [],
      quality: {
        persistenceRoot: {
          value: '/repo/.crux/quality',
          provenance: {
            kind: 'filesystem',
            path: '/repo/.crux/quality',
            convention: 'default quality persistence root',
          },
        },
        includeGlobs: [],
        excludeGlobs: [],
        evaluationFiles: [],
      },
      diagnostics: [],
    } satisfies ResolvedProjectModel

    const event = projectIndexArtifactToWorkerEvent('projectModel', projectModel, {
      root: '/repo',
      transactionId: 'artifact-project-model',
    })

    expect(event).toMatchObject({
      protocolVersion: 2,
      type: 'artifact:done',
      artifact: 'projectModel',
      root: '/repo',
      payload: projectModel,
    })
  })

  it('chunks JSON artifacts by serialized event bytes', () => {
    const payload = {
      root: '/repo',
      files: [
        { file: '/repo/src/a.ts', source: 'x'.repeat(800) },
        { file: '/repo/src/b.ts', source: 'y'.repeat(800) },
      ],
    } as unknown as ResolvedProjectModel

    const events = projectIndexArtifactToWorkerEvents('projectModel', payload, {
      root: '/repo',
      transactionId: 'artifact-large-project-model',
      maxEventBytes: 700,
    })
    const chunks = events.filter((event) => event.type === 'artifact:chunk')
    const done = events.at(-1)
    const decoded = Buffer.concat(chunks.map((event) => Buffer.from(event.payloadChunk, 'base64'))).toString('utf8')

    expect(chunks.length).toBeGreaterThan(1)
    expect(done).toMatchObject({
      type: 'artifact:done',
      artifact: 'projectModel',
      root: '/repo',
    })
    expect(done).not.toHaveProperty('payload')
    expect(JSON.parse(decoded)).toEqual(payload)
  })

  it('marks runtime patch facts as runtime-observed evidence', () => {
    const patch: IndexPatch = {
      schemaVersion: 1,
      phase: 'runtime',
      project: { root: '/repo', name: 'fixture' },
      startedAt: '2026-06-20T10:00:00.000Z',
      finishedAt: '2026-06-20T10:00:00.001Z',
      status: 'ok',
      facts: {
        definitions: [
          {
            id: 'prompt:runtime',
            kind: 'prompt',
            name: 'runtime',
            fidelity: 'resolved',
            status: 'active',
          },
        ],
      },
    }

    const events = indexPatchToWorkerEvents(patch, {
      transactionId: 'tx-runtime',
      producer: { name: '@use-crux/indexer/project-runtime-indexer', version: 'test' },
    })
    const batch = events.find((event) => event.type === 'fact:batch')

    expect(batch).toMatchObject({
      type: 'fact:batch',
      facts: [
        expect.objectContaining({
          fidelity: 'runtime-observed',
          provenance: { kind: 'runtime', attribute: 'project-index.runtime' },
        }),
      ],
    })
  })
})

function diagnosticFixture(id: string): NonNullable<IndexPatch['facts']['diagnostics']>[number] {
  return {
    id,
    severity: 'info',
    code: 'index.large_fact',
    message: 'x'.repeat(800),
  }
}
