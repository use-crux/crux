import { describe, expect, it } from 'vitest'
import type { ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import {
  createRelationPolicyTable,
  mergeRelationsByIdentity,
  relationDiagnosticsFromReport,
  relationIdentity,
  resolveRelationModel,
} from '../indexer/relations/index'
import { staticParseResultFromFacts } from '../indexer/static/read-model'
import type { IndexRelationPolicy } from '../indexer/relations/types'
import type { StaticFoundDefinition } from '../indexer/types'

const basePolicy = {
  presentation: 'both',
  partial: true,
  runtimeJoin: true,
} satisfies Pick<IndexRelationPolicy, 'presentation' | 'partial' | 'runtimeJoin'>

function definition(input: {
  readonly id: string
  readonly kind: ProjectDefinition['kind']
  readonly name: string
  readonly fidelity?: ProjectDefinition['fidelity']
  readonly metadata?: ProjectDefinition['metadata']
}): ProjectDefinition {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    fidelity: input.fidelity ?? 'partial',
    status: 'active',
    metadata: input.metadata,
  }
}

function relation(input: {
  readonly type: string
  readonly from: string
  readonly to: string
  readonly fidelity: ProjectRelation['fidelity']
  readonly metadata?: ProjectRelation['metadata']
}): ProjectRelation {
  return {
    id: relationIdentity(input),
    type: input.type,
    from: input.from,
    to: input.to,
    fidelity: input.fidelity,
    metadata: input.metadata,
  }
}

describe('RelationModel facade', () => {
  it('constructs an explicit policy table with duplicate diagnostics and O(1) lookup', () => {
    const promptUsesContext = {
      ...basePolicy,
      type: 'prompt.uses_context',
      fromKinds: ['prompt'],
      toKinds: ['context'],
    } satisfies IndexRelationPolicy
    const duplicate = {
      ...basePolicy,
      type: 'prompt.uses_context',
      fromKinds: ['context'],
      toKinds: ['context'],
    } satisfies IndexRelationPolicy

    const table = createRelationPolicyTable({
      groups: [[promptUsesContext], [duplicate]],
      useMatchPrecedence: ['prompt', 'context', 'injectable', 'tool'],
    })

    expect(table.policyFor('prompt.uses_context')).toBe(promptUsesContext)
    expect(table.useMatchPrecedence).toEqual(['prompt', 'context', 'injectable', 'tool'])
    expect(table.validation).toEqual([
      expect.objectContaining({
        code: 'relation.policy_table_invalid',
        severity: 'error',
        relatedDefinitionIds: ['prompt.uses_context'],
      }),
    ])
  })

  it('merges relation groups by semantic identity with higher-fidelity relations winning', () => {
    const partial = relation({
      type: 'prompt.uses_context',
      from: 'prompt:writer',
      to: 'context:brand',
      fidelity: 'partial',
      metadata: { source: 'static' },
    })
    const resolved = relation({
      type: 'prompt.uses_context',
      from: 'prompt:writer',
      to: 'context:brand',
      fidelity: 'resolved',
      metadata: { source: 'semantic' },
    })

    expect(mergeRelationsByIdentity([partial], [resolved])).toEqual([resolved])
    expect(relationIdentity(partial)).toBe('relation:prompt.uses_context:prompt:writer:context:brand')
  })

  it('resolves static relation refs and enriches definitions through one idempotent model entry point', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      metadata: {
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'brandContext', relationHint: 'context' }],
        },
      },
    })
    const context = definition({
      id: 'context:brand-context',
      kind: 'context',
      name: 'Brand Context',
      fidelity: 'resolved',
      metadata: { exportName: 'brandContext' },
    })
    const found = [
      {
        variableName: 'writer',
        definition: prompt,
        relationRefs: [{ type: 'prompt.uses_context', toVariable: 'brandContext' }],
      },
    ] satisfies StaticFoundDefinition[]

    const model = resolveRelationModel({
      found,
      importedDefinitions: new Map([['brandContext', context]]),
      definitions: [prompt],
    })

    expect(model.relations).toEqual([
      expect.objectContaining({
        id: 'relation:prompt.uses_context:prompt:writer:context:brand-context',
        type: 'prompt.uses_context',
        from: 'prompt:writer',
        to: 'context:brand-context',
        fidelity: 'partial',
      }),
    ])
    expect(model.definitions).toEqual([
      expect.objectContaining({
        id: 'prompt:writer',
        metadata: expect.objectContaining({
          facts: expect.objectContaining({
            useEntries: [
              expect.objectContaining({
                variable: 'brandContext',
                targetDefinitionId: 'context:brand-context',
                targetKind: 'context',
                targetName: 'Brand Context',
                relationType: 'prompt.uses_context',
                relationFidelity: 'partial',
              }),
            ],
          }),
          intelligence: expect.objectContaining({
            dependencies: { contexts: ['context:brand-context'] },
          }),
        }),
      }),
    ])
    expect(model.report.counts).toEqual({ resolved: 1, unresolved: 0, policyGaps: 0 })
    expect(resolveRelationModel(model)).toEqual(model)
    expect(relationDiagnosticsFromReport(model.report)).toEqual([])
  })

  it('reports static relation refs that cannot be bound', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
    })
    const found = [
      {
        variableName: 'writer',
        definition: prompt,
        relationRefs: [{ type: 'unknown.uses_thing', toVariable: 'missingThing' }],
      },
    ] satisfies StaticFoundDefinition[]

    const model = resolveRelationModel({
      found,
      definitions: [prompt],
    })

    expect(model.relations).toEqual([])
    expect(model.report).toEqual({
      unresolved: [
        {
          reason: 'no-policy',
          fact: {
            ownerDefinitionId: 'prompt:writer',
            refType: 'unknown.uses_thing',
            toVariable: 'missingThing',
          },
        },
      ],
      policyGaps: [
        {
          type: 'unknown.uses_thing',
          sampleFact: {
            ownerDefinitionId: 'prompt:writer',
            refType: 'unknown.uses_thing',
            toVariable: 'missingThing',
          },
          count: 1,
        },
      ],
      counts: { resolved: 0, unresolved: 1, policyGaps: 1 },
    })
    expect(relationDiagnosticsFromReport(model.report)).toEqual([
      expect.objectContaining({ code: 'relation.unresolved_reference' }),
      expect.objectContaining({ code: 'relation.policy_gap' }),
    ])
  })

  it('surfaces relation report diagnostics from static fact projection', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
    })

    const result = staticParseResultFromFacts({
      facts: [
        {
          definitions: [{ variableName: 'writer', definition: prompt }],
          references: [{ type: 'unknown.uses_thing', toVariable: 'missingThing' }],
        },
      ],
      pathDefinitions: [],
      importedDefinitions: new Map(),
      diagnostics: [],
      dependencies: [],
    })

    expect(result.relations).toEqual([])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'relation.unresolved_reference',
        relatedDefinitionIds: ['prompt:writer'],
      }),
      expect.objectContaining({
        code: 'relation.policy_gap',
        relatedDefinitionIds: ['prompt:writer'],
      }),
    ])
  })
})
