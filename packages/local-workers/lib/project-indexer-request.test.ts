import { describe, expect, it } from 'vitest'
import { createProjectIndexWorkerRequestAssembler } from './project-indexer-request'

describe('createProjectIndexWorkerRequestAssembler', () => {
  it('assembles previous index definition and source batches for chunked worker requests', async () => {
    const assemble = createProjectIndexWorkerRequestAssembler()

    await expect(
      assemble({
        protocolVersion: 3,
        method: 'indexProjectSemantic',
        requestId: 'semantic:1',
        requestKind: 'start',
        root: '/repo',
        previousIndex: {
          schemaVersion: 1,
          project: { root: '/repo' },
          indexedAt: '2026-01-01T00:00:00.000Z',
          prompts: [],
          contexts: [],
          definitions: [],
          relations: [],
          diagnostics: [],
          lintFindings: [],
          ruleDescriptors: [],
          sources: [],
          sourceGraph: {
            schemaVersion: 1,
            producedBy: '@use-crux/indexer',
            capabilities: [],
          },
        },
      }),
    ).resolves.toBeUndefined()

    await expect(
      assemble({
        protocolVersion: 3,
        method: 'indexProjectSemantic',
        requestId: 'semantic:1',
        requestKind: 'previousIndex:definitions',
        root: '/repo',
        previousIndexDefinitions: [
          {
            id: 'prompt:writer',
            kind: 'prompt',
            name: 'writer',
            fidelity: 'resolved',
          },
        ],
      }),
    ).resolves.toBeUndefined()

    await expect(
      assemble({
        protocolVersion: 3,
        method: 'indexProjectSemantic',
        requestId: 'semantic:1',
        requestKind: 'previousIndex:sources',
        root: '/repo',
        previousIndexSources: [
          {
            file: '/repo/src/prompt.ts',
            status: 'indexed',
            dependencies: [],
            dependents: [],
            definitionIds: ['prompt:writer'],
            diagnostics: [],
          },
        ],
      }),
    ).resolves.toBeUndefined()

    const completed = await assemble({
      protocolVersion: 3,
      method: 'indexProjectSemantic',
      requestId: 'semantic:1',
      requestKind: 'done',
      root: '/repo',
    })

    expect(completed?.previousIndex?.definitions.map((definition) => definition.id)).toEqual([
      'prompt:writer',
    ])
    expect(completed?.previousIndex?.sources.map((source) => source.file)).toEqual([
      '/repo/src/prompt.ts',
    ])
  })
})
