import { describe, expect, it } from 'vitest'
import type { ResolvedProjectModel } from '@crux/core/project-index'
import type { IndexPatch } from '../indexer/patches'
import { indexPatchFromWorkerEvents, indexPatchToWorkerEvents, projectIndexArtifactToWorkerEvent } from '../indexer/worker-protocol'

describe('project index worker protocol', () => {
  it('streams patch facts in ordered batches and reconstructs the same patch', () => {
    const patch: IndexPatch = {
      schemaVersion: 1,
      phase: 'ast',
      project: { root: '/repo', name: 'fixture', configFile: 'crux.config.ts' },
      startedAt: '2026-06-18T10:00:00.000Z',
      finishedAt: '2026-06-18T10:00:00.001Z',
      status: 'ok',
      invalidates: { all: true },
      facts: {
        definitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer',
            fidelity: 'partial',
            status: 'active',
            source: { file: '/repo/src/writer.ts', line: 3 },
          },
        ],
        diagnostics: [
          {
            id: 'diagnostic:writer',
            severity: 'info',
            code: 'index.writer',
            message: 'writer indexed',
            source: { file: '/repo/src/writer.ts', line: 3 },
          },
        ],
        sources: [
          {
            file: '/repo/src/writer.ts',
            status: 'indexed',
            definitionIds: ['prompt:writer'],
            diagnostics: ['diagnostic:writer'],
          },
        ],
        sourceGraph: {
          schemaVersion: 1,
          producedBy: '@crux/indexer',
          capabilities: ['definition-ownership', 'diagnostic-ownership'],
        },
      },
    }

    const events = indexPatchToWorkerEvents(patch, {
      transactionId: 'tx-ast',
      producer: { name: '@crux/indexer', version: 'test' },
      maxFactsPerBatch: 2,
    })

    expect(events.map((event) => event.type)).toEqual(['phase:start', 'fact:batch', 'fact:batch', 'phase:done'])
    expect(events[1]).toMatchObject({ type: 'fact:batch', sequence: 0 })
    expect(events[2]).toMatchObject({ type: 'fact:batch', sequence: 1 })

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
          provenance: { kind: 'filesystem', path: '/repo/.crux/quality', convention: 'default quality persistence root' },
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
})
