import { describe, expect, it } from 'vitest'
import fixture from '../../src/project-index/fixtures/definition-coverage.json'
import { DefinitionRefSchema } from '../../src/observability/schema'
import {
  definitionRef,
  flowStepDefinitionRef,
  knowledgeBaseDefinitionRef,
  parallelBranchDefinitionRef,
  recipeStepDefinitionRef,
  scorerDefinitionRef,
  toolPolicyDefinitionRef,
} from '../../src/observability/definition-ref'
import { DEFINITION_KIND_COVERAGE } from '../../src/project-index/definition-kind-coverage'

function expectedDefinitionRef(kind: string) {
  const descriptor = DEFINITION_KIND_COVERAGE[kind as keyof typeof DEFINITION_KIND_COVERAGE]
  if (kind === 'scorer') return scorerDefinitionRef('connected')
  if (descriptor.primary === 'directly-observed') {
    return definitionRef(kind as Parameters<typeof definitionRef>[0], 'connected')
  }
  switch (kind) {
    case 'rag.knowledgeBase': return knowledgeBaseDefinitionRef('connected')
    case 'toolPolicy': return toolPolicyDefinitionRef('connected')
    case 'flow.step': return flowStepDefinitionRef('connected', 'connected')
    case 'composition.parallel.branch': return parallelBranchDefinitionRef('connected', 'connected')
    case 'rag.recipe.step': return recipeStepDefinitionRef('connected', 'connected')
    default: return undefined
  }
}

describe('manifest-generated observability coverage fixture', () => {
  it('covers every current definition kind exactly once with its manifest treatment', () => {
    expect(fixture.generatedFrom).toBe('DEFINITION_KIND_COVERAGE')
    expect(fixture.cases.map((entry) => entry.kind).sort()).toEqual(
      Object.keys(DEFINITION_KIND_COVERAGE).sort(),
    )
    expect(new Set(fixture.cases.map((entry) => entry.kind)).size).toBe(fixture.cases.length)

    for (const entry of fixture.cases) {
      const descriptor = DEFINITION_KIND_COVERAGE[entry.kind as keyof typeof DEFINITION_KIND_COVERAGE]
      expect(entry.primary, entry.kind).toBe(descriptor.primary)
      expect(entry.runtimePrimitiveNames, entry.kind).toEqual(descriptor.runtimePrimitiveNames ?? [])
      if (entry.expectedTreatment === 'definition-ref') {
        expect(DefinitionRefSchema.safeParse(entry.definitionRef).success, entry.kind).toBe(true)
        expect(entry.definitionRef, entry.kind).toEqual(expectedDefinitionRef(entry.kind))
      } else {
        expect(entry.definitionRef, entry.kind).toBeNull()
      }
    }
  })

  it('declares all four adapter packages exercised by the connected fixture suite', () => {
    expect(fixture.adapters).toEqual([
      '@use-crux/openai',
      '@use-crux/anthropic',
      '@use-crux/google',
      '@use-crux/ai',
    ])
  })
})
