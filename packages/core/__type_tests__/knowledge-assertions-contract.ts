/**
 * Type-level contract for assertion vocabulary authoring.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { indexingPipeline } from '../src/indexing'
import { assertions, knowledgeBase, type AssertionSet, type AssertionStage } from '../src/knowledge'
import type { AssertionDeriveStage } from '../src/knowledge/derive/stage'
import type { KnowledgeModel } from '../src/knowledge/model'

declare const model: KnowledgeModel

const facts = assertions({
  id: 'facts',
  version: 1,
  types: {
    fact: z.object({ value: z.string(), count: z.number().optional() }).describe('A fact'),
    flag: z.object({ enabled: z.boolean() }).describe('A flag'),
  },
  run: (_input, api) => {
    api.emit('fact', { value: 'ready' }, {
      evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
    })
    api.emit('flag', { enabled: true }, {
      evidence: [{ kind: 'chunk', sourceId: 'guide', chunkId: 'c1' }],
      provenance: 'exact',
    })
    const newer = api.emit('fact', { value: 'new' }, {
      evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
    })
    api.relate('supersedes', newer, { type: 'fact', data: { value: 'old' } }, {
      evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
    })
    api.relate('supports', 0, newer, {
      evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' },
    })

    api.emit(
      // @ts-expect-error Assertion type names are constrained by the authored vocabulary.
      'missing',
      { value: 'ready' },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
    api.emit(
      'fact',
      // @ts-expect-error Assertion data is inferred from the selected schema.
      { value: 1 },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
    api.relate(
      // @ts-expect-error Assertion relation type names are closed.
      'replaces',
      newer,
      newer,
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
    api.relate(
      'supersedes',
      newer,
      // @ts-expect-error Canonical assertion relation refs are typed by authored schemas.
      { type: 'fact', data: { value: 1 } },
      { evidence: { kind: 'chunk', sourceId: 'guide', chunkId: 'c1' } },
    )
  },
})

expectTypeOf(facts).toMatchTypeOf<AssertionDeriveStage>()
expectTypeOf(facts).toMatchTypeOf<AssertionStage<{
  readonly fact: z.ZodObject<{
    value: z.ZodString
    count: z.ZodOptional<z.ZodNumber>
  }>
  readonly flag: z.ZodObject<{ enabled: z.ZodBoolean }>
}>>()
const assertionDeriveStage: AssertionDeriveStage = facts
indexingPipeline({ derive: [assertionDeriveStage] })

const kb = knowledgeBase({ id: 'docs' })
const factSet = kb.assertions(facts, { types: ['fact'] as const })
expectTypeOf(factSet).toMatchTypeOf<AssertionSet<typeof facts.types, 'fact'>>()
factSet.resolve({
  id: 'policy',
  version: 1,
  run: ({ assertions: items }, decision) => {
    const first = items[0]
    if (first) {
      expectTypeOf(first.type).toEqualTypeOf<'fact'>()
      decision.unresolved(first, 'review')
    }
  },
})
kb.assertions(
  facts,
  // @ts-expect-error Assertion set type filters are constrained by the authored vocabulary.
  { types: ['missing'] as const },
)

assertions({
  id: 'model-facts',
  version: 1,
  types: {
    fact: z.object({ value: z.string() }).describe('A fact'),
  },
  model,
  instructions: 'Extract explicit facts',
})

// @ts-expect-error An assertion config requires exactly one production mode.
assertions({
  id: 'missing-mode',
  version: 1,
  types: {
    fact: z.object({ value: z.string() }).describe('A fact'),
  },
})

// @ts-expect-error An assertion config cannot combine production modes.
assertions({
  id: 'both-modes',
  version: 1,
  types: {
    fact: z.object({ value: z.string() }).describe('A fact'),
  },
  model,
  run: () => {},
})
