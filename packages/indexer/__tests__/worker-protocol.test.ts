import { describe, expect, it } from 'vitest'
import type { ResolvedProjectModel } from '@crux/core/project-index'
import type { IndexPatch } from '../indexer/patches'
import {
  indexPatchFromWorkerEvents,
  indexPatchToWorkerEvents,
  projectIndexArtifactToWorkerEvent,
} from '../indexer/worker-protocol'
import {
  workerEventFixtureOptions,
  workerEventFixturePatch,
} from '../indexer/contracts/worker-events/fixtures'
import { readStaticIndexRuntimeSharedFixture } from '../indexer/contracts/fixtures'

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

  it('streams semantic source profile rows outside phase metadata', () => {
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
      producer: { name: '@crux/indexer', version: 'test' },
      maxFactsPerBatch: 2,
    })

    expect(events.map((event) => event.type)).toEqual(['phase:start', 'sourceProfile:batch', 'phase:done'])
    expect(events.find((event) => event.type === 'phase:done')).not.toHaveProperty('patch.semanticSourceProfile')
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
      producer: { name: '@crux/indexer/project-runtime-indexer', version: 'test' },
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
