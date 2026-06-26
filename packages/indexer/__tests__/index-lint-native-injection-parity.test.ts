import { describe, expect, it } from 'vitest'
import type { InputSchemaContribution, JsonSchema, ProjectDefinition, ProjectRelation } from '@use-crux/core/project-index'
import { canonicalIndexPatchFactsJson } from '../contracts/parity'
import { applyIndexLintConfig } from '../indexer/lints/config'
import { indexLintFindings } from '../indexer/lints/findings'
import { builtInIndexRuleDescriptors, type IndexLintRuleId } from '../indexer/lints/rules'
import { finalizeStaticIndexFactsWithWorker } from '../testing/static-index-worker'

const stringSchema = { type: 'string' } satisfies JsonSchema
const numberSchema = { type: 'number' } satisfies JsonSchema

interface InjectionParityCase {
  readonly name: string
  readonly definitions: readonly ProjectDefinition[]
  readonly relations?: readonly ProjectRelation[]
  readonly expectedRuleIds: readonly IndexLintRuleId[]
}

describe('native built-in injection lint parity', () => {
  it.each(injectionParityCases)('$name', async (testCase) => {
    const root = '/workspace/acme'
    const relations = testCase.relations ?? []
    const native = await finalizeStaticIndexFactsWithWorker({
      root,
      nativeFacts: [{ root, definitions: testCase.definitions, relations }],
      extensionFacts: [],
      lintConfig: { profile: 'strict' },
    })
    const ts = {
      lintFindings: applyIndexLintConfig({
        config: { profile: 'strict' },
        diagnostics: [],
        ruleDescriptors: builtInIndexRuleDescriptors(),
        findings: indexLintFindings({
          definitions: testCase.definitions,
          relations,
        }),
      }),
    }

    expect(canonicalIndexPatchFactsJson({ lintFindings: native.lintFindings ?? [] })).toBe(
      canonicalIndexPatchFactsJson(ts),
    )
    const nativeRuleIds = new Set((native.lintFindings ?? []).map((finding) => finding.ruleId))
    for (const ruleId of testCase.expectedRuleIds) {
      expect(nativeRuleIds.has(ruleId), `${testCase.name} should emit ${ruleId}`).toBe(true)
    }
  })
})

const injectionParityCases = [
  {
    name: 'required input contributed through injection',
    definitions: [
      definition({
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
      }),
      definition({ id: 'context:locale', kind: 'context', name: 'locale', inputSchema: objectSchema({ locale: stringSchema }, ['locale']) }),
    ],
    expectedRuleIds: ['prompt.hidden_required_input'],
  },
  {
    name: 'conditional required injected input',
    definitions: [
      definition({
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
      }),
      definition({ id: 'context:locale', kind: 'context', name: 'locale', inputSchema: objectSchema({ locale: stringSchema }, ['locale']) }),
    ],
    expectedRuleIds: ['prompt.conditional_required_input'],
  },
  {
    name: 'conflicting injected input schemas',
    definitions: [
      definition({
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        inputSchema: objectSchema({ topic: stringSchema }, ['topic']),
        expandedInputSchema: objectSchema({ topic: stringSchema, tone: stringSchema }, ['topic']),
        inputContributions: [
          contribution({ field: 'tone', schema: stringSchema, sourceDefinitionId: 'context:brand', sourceName: 'brand', sourceKind: 'context' }),
          contribution({ field: 'tone', schema: numberSchema, sourceDefinitionId: 'injectable:style', sourceName: 'style', sourceKind: 'injectable' }),
        ],
      }),
      definition({ id: 'context:brand', kind: 'context', name: 'brand' }),
      definition({ id: 'injectable:style', kind: 'injectable', name: 'style' }),
    ],
    expectedRuleIds: ['prompt.conflicting_injected_input'],
  },
  {
    name: 'runtime-dependent use entries',
    definitions: [
      definition({
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'runtimeContext', conditionality: 'dynamic', via: 'runtime' }],
        },
      }),
    ],
    expectedRuleIds: ['injection.dynamic_dependency'],
  },
  {
    name: 'dynamic injected tool contributors',
    definitions: [
      definition({
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'tools', targetDefinitionId: 'context:tools', conditionality: 'always' }],
        },
      }),
      definition({
        id: 'context:tools',
        kind: 'context',
        name: 'tools',
        facts: { kind: 'context', tools: { hasTools: true, dynamic: true } },
      }),
    ],
    relations: [relation('prompt.uses_context', 'prompt:writer', 'context:tools')],
    expectedRuleIds: ['injection.dynamic_tools'],
  },
  {
    name: 'indirect prompt tool surfaces',
    definitions: [
      definition({
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'tools', targetDefinitionId: 'context:tools', conditionality: 'always' }],
        },
      }),
      definition({
        id: 'context:tools',
        kind: 'context',
        name: 'tools',
        facts: { kind: 'context', tools: { hasTools: true, names: ['search'] } },
      }),
    ],
    relations: [relation('prompt.uses_context', 'prompt:writer', 'context:tools')],
    expectedRuleIds: ['prompt.indirect_tool_surface'],
  },
  {
    name: 'unresolved static injection targets',
    definitions: [
      definition({
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        facts: {
          kind: 'prompt',
          useEntries: [{ variable: 'missingContext', conditionality: 'always', via: 'direct' }],
        },
      }),
    ],
    expectedRuleIds: ['injection.unresolved_target'],
  },
  {
    name: 'deep injected schema chains',
    definitions: [
      definition({
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
            path: ['prompt:writer', 'injectable:brand', 'context:locale'],
          }),
        ],
      }),
      definition({ id: 'injectable:brand', kind: 'injectable', name: 'brand' }),
      definition({ id: 'context:locale', kind: 'context', name: 'locale', inputSchema: objectSchema({ locale: stringSchema }, ['locale']) }),
    ],
    expectedRuleIds: ['injection.deep_schema_chain'],
  },
] satisfies readonly InjectionParityCase[]

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
    source: { file: `/workspace/acme/src/${input.id.replace(/[^a-z0-9]+/gi, '-')}.ts`, line: 1, column: 1 },
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

function relation(type: string, from: string, to: string): ProjectRelation {
  return {
    id: `relation:${type}:${from}:${to}`,
    type,
    from,
    to,
    source: { file: '/workspace/acme/src/relations.ts', line: 1, column: 1 },
    fidelity: 'resolved',
  }
}
