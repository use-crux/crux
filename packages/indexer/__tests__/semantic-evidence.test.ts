import type { ProjectDefinition, ProjectRelation } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { collectProjectedSemanticEvidence, projectSemanticEvidenceBatches } from '../src/indexer/semantic/evidence/projection'

describe('semantic evidence projector', () => {
  it('projects backend-neutral semantic evidence batches into patch facts', async () => {
    const definition: ProjectDefinition = {
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      fidelity: 'resolved',
      status: 'active',
    }
    const relation: ProjectRelation = {
      id: 'relation:prompt.uses_context:prompt:writer:context:brand',
      type: 'prompt.uses_context',
      from: 'prompt:writer',
      to: 'context:brand',
      fidelity: 'resolved',
    }

    const facts = projectSemanticEvidenceBatches([
      { kind: 'definitions', facts: [definition] },
      { kind: 'relations', facts: [relation] },
      {
        kind: 'sourceRefs',
        facts: [
          {
            definitionId: 'prompt:writer',
            ref: {
              id: 'source-ref:writer',
              role: 'prompt',
              source: { file: 'src/writer.ts', line: 1, column: 1 },
              fidelity: 'resolved',
            },
          },
        ],
      },
      { kind: 'diagnostics', facts: [] },
    ])

    await expect(collectProjectedSemanticEvidence([])).resolves.toEqual({ diagnostics: [] })
    expect(facts).toEqual({
      definitions: [definition],
      relations: [relation],
      sourceRefs: [
        {
          definitionId: 'prompt:writer',
          ref: {
            id: 'source-ref:writer',
            role: 'prompt',
            source: { file: 'src/writer.ts', line: 1, column: 1 },
            fidelity: 'resolved',
          },
        },
      ],
      diagnostics: [],
    })
  })
})
