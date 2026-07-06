import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import { resolveRelationModel, type RuntimeUseTargetRules } from '../indexer/relations'

const testDir = dirname(fileURLToPath(import.meta.url))

describe('runtime use target resolution', () => {
  it('resolves runtime use entries from supplied target data instead of SDK app-name heuristics', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      metadata: {
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'tools', via: 'runtime' }],
        },
      },
    })
    const toolbox = definition({
      id: 'context:brand-toolbox',
      kind: 'context',
      name: 'Brand Toolbox',
      metadata: {
        facts: {
          kind: 'context',
          tools: { hasTools: true },
        },
      },
    })
    const runtimeUseTargetRules = {
      exact: [
        {
          variable: 'tools',
          targetDefinitionIds: ['context:brand-toolbox'],
          targetKinds: ['context'],
          requireToolFacts: true,
        },
      ],
      suffix: [],
    } satisfies RuntimeUseTargetRules

    const model = resolveRelationModel({
      definitions: [prompt, toolbox],
      runtimeUseTargetRules,
    })

    const facts = model.definitions.find((definition) => definition.id === 'prompt:writer')?.metadata?.facts
    expect(facts?.kind === 'prompt' ? facts.useEntries : undefined).toEqual([
      expect.objectContaining({
        variable: 'tools',
        targetDefinitionId: 'context:brand-toolbox',
        targetKind: 'context',
        targetName: 'Brand Toolbox',
        relationType: 'prompt.uses_context',
      }),
    ])
  })

  it('keeps app-specific ids out of the relation resolver implementation', async () => {
    const source = await readFile(join(testDir, '..', 'indexer/relations/index.ts'), 'utf8')

    expect(source.toLowerCase()).not.toContain('karyla')
  })
})

function definition(input: {
  readonly id: string
  readonly kind: ProjectDefinition['kind']
  readonly name: string
  readonly metadata?: ProjectDefinition['metadata']
}): ProjectDefinition {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    status: 'active',
    fidelity: 'partial',
    metadata: input.metadata,
  }
}
