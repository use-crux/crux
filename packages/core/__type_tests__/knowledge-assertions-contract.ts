/**
 * Type-level contract for assertion vocabulary authoring.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { indexingPipeline } from '../src/indexing'
import { assertions, type AssertionStage } from '../src/knowledge'
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
