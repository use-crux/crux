import { describe, expect, it } from 'vitest'
import type { InputSchemaContribution, JsonSchema, ProjectDefinition, ProjectRelation } from '@crux/core/project-index'
import { indexLintFindings } from '../indexer/lints/findings'

const stringSchema = { type: 'string' } satisfies JsonSchema
const numberSchema = { type: 'number' } satisfies JsonSchema

describe('injection lint rules', () => {
  it('reports required prompt input that is contributed through injection', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      inputSchema: objectSchema({ topic: stringSchema }, ['topic']),
      expandedInputSchema: objectSchema({ topic: stringSchema, locale: stringSchema }, ['topic', 'locale']),
      inputContributions: [
        contribution({
          field: 'locale',
          schema: stringSchema,
          required: true,
          sourceDefinitionId: 'context:locale',
          sourceName: 'locale',
          sourceKind: 'context',
        }),
      ],
    })
    const context = definition({
      id: 'context:locale',
      kind: 'context',
      name: 'locale',
      inputSchema: objectSchema({ locale: stringSchema }, ['locale']),
    })

    const findings = indexLintFindings({ definitions: [prompt, context], relations: [] })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'prompt.hidden_required_input',
          primaryDefinitionId: 'prompt:writer',
          relatedDefinitionIds: ['prompt:writer', 'context:locale'],
        }),
      ]),
    )
  })

  it('reports conditional required prompt input without making the global field required', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      inputSchema: objectSchema({ topic: stringSchema }, ['topic']),
      expandedInputSchema: objectSchema({ topic: stringSchema, locale: stringSchema }, ['topic']),
      inputContributions: [
        contribution({
          field: 'locale',
          schema: stringSchema,
          required: false,
          sourceDefinitionId: 'context:locale',
          sourceName: 'locale',
          sourceKind: 'context',
          conditionality: 'when',
          via: 'when',
        }),
      ],
    })
    const context = definition({
      id: 'context:locale',
      kind: 'context',
      name: 'locale',
      inputSchema: objectSchema({ locale: stringSchema }, ['locale']),
    })

    const findings = indexLintFindings({ definitions: [prompt, context], relations: [] })

    expect(findings.map((finding) => finding.ruleId)).toContain('prompt.conditional_required_input')
    expect(findings.map((finding) => finding.ruleId)).not.toContain('prompt.hidden_required_input')
  })

  it('reports obvious schema conflicts between injected input contributors', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      inputSchema: objectSchema({ topic: stringSchema }, ['topic']),
      expandedInputSchema: objectSchema({ topic: stringSchema, tone: stringSchema }, ['topic']),
      inputContributions: [
        contribution({
          field: 'tone',
          schema: stringSchema,
          sourceDefinitionId: 'context:brand',
          sourceName: 'brand',
          sourceKind: 'context',
        }),
        contribution({
          field: 'tone',
          schema: numberSchema,
          sourceDefinitionId: 'injectable:style',
          sourceName: 'style',
          sourceKind: 'injectable',
        }),
      ],
    })

    const findings = indexLintFindings({
      definitions: [
        prompt,
        definition({ id: 'context:brand', kind: 'context', name: 'brand' }),
        definition({ id: 'injectable:style', kind: 'injectable', name: 'style' }),
      ],
      relations: [],
    })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'prompt.conflicting_injected_input',
          primaryDefinitionId: 'prompt:writer',
        }),
      ]),
    )
  })

  it('reports runtime-dependent use entries', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      facts: {
        kind: 'prompt',
        useEntries: [{ variable: 'runtimeContext', conditionality: 'dynamic', via: 'runtime' }],
      },
    })

    const findings = indexLintFindings({ definitions: [prompt], relations: [] })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'injection.dynamic_dependency',
          primaryDefinitionId: 'prompt:writer',
        }),
      ]),
    )
  })

  it('reports dynamic injected tool contributors through resolved use paths', () => {
    const prompt = definition({
      id: 'prompt:writer',
      kind: 'prompt',
      name: 'writer',
      facts: {
        kind: 'prompt',
        useEntries: [{ variable: 'tools', targetDefinitionId: 'context:tools', conditionality: 'always' }],
      },
    })
    const context = definition({
      id: 'context:tools',
      kind: 'context',
      name: 'tools',
      facts: {
        kind: 'context',
        tools: { hasTools: true, dynamic: true },
      },
    })
    const relation = {
      id: 'prompt:writer->context:tools',
      type: 'prompt.uses_context',
      from: 'prompt:writer',
      to: 'context:tools',
      fidelity: 'resolved',
    } satisfies ProjectRelation

    const findings = indexLintFindings({ definitions: [prompt, context], relations: [relation] })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleId: 'injection.dynamic_tools',
          primaryDefinitionId: 'prompt:writer',
          relatedDefinitionIds: ['prompt:writer', 'context:tools'],
        }),
      ]),
    )
  })
})

function definition(
  input: Pick<ProjectDefinition, 'id' | 'kind' | 'name'> & {
    readonly inputSchema?: JsonSchema
    readonly expandedInputSchema?: JsonSchema
    readonly inputContributions?: readonly InputSchemaContribution[]
    readonly facts?: NonNullable<ProjectDefinition['metadata']>['facts']
  },
): ProjectDefinition {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    fidelity: 'resolved',
    metadata: {
      ...(input.inputSchema ? { inputSchema: input.inputSchema } : {}),
      ...(input.facts ? { facts: input.facts } : {}),
      intelligence:
        input.inputSchema || input.expandedInputSchema || input.inputContributions
          ? {
              confidence: 'static',
              contract: {
                ...(input.inputSchema ? { inputSchema: input.inputSchema } : {}),
                ...(input.expandedInputSchema ? { expandedInputSchema: input.expandedInputSchema } : {}),
                ...(input.inputContributions ? { inputContributions: [...input.inputContributions] } : {}),
              },
            }
          : undefined,
    },
  }
}

function objectSchema(properties: Record<string, JsonSchema>, required: readonly string[] = []): JsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required: [...required] } : {}),
  }
}

function contribution(input: InputSchemaContribution): InputSchemaContribution {
  return input
}
