/**
 * Type contract for the Safety stable-beta authoring surface.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract.
 */

import { expectTypeOf } from 'vitest'
import {
  boundary,
  constraint,
  guardrail,
  type BoundaryDef,
  type DotPath,
  type PathValue,
  type SafetyTuneOptions,
} from '../src/safety'

interface CustomerSummary {
  customer: {
    email: string
    tags: readonly string[]
  }
  score: number
}

expectTypeOf<DotPath<CustomerSummary>>().toEqualTypeOf<
  'customer' | 'score' | 'customer.email' | 'customer.tags'
>()
expectTypeOf<PathValue<CustomerSummary, 'customer.email'>>().toEqualTypeOf<string>()

const emailBoundary = boundary.output.path<CustomerSummary>()('customer.email')
expectTypeOf(emailBoundary).toMatchTypeOf<BoundaryDef<'model.output.object', string>>()

// @ts-expect-error - path helpers reject fields that are not in the structured output type.
boundary.output.path<CustomerSummary>()('customer.missing')

guardrail({
  id: 'redact-output-email',
  on: boundary.output.path<CustomerSummary>()('customer.email'),
  run: (email, ctx) => {
    expectTypeOf(email).toEqualTypeOf<string>()
    expectTypeOf(ctx.boundary.id).toEqualTypeOf<'model.output.object'>()
    expectTypeOf(ctx.path).toEqualTypeOf<string | undefined>()
    return {
      action: 'rewrite',
      value: '[redacted]',
      rewrite: { kind: 'redact' },
    }
  },
})

guardrail({
  id: 'pii-input-output',
  on: [boundary.input.text(), boundary.output.text()] as const,
  run: (subject, ctx) => {
    expectTypeOf(subject).toEqualTypeOf<string>()
    expectTypeOf(ctx.boundary.id).toEqualTypeOf<'user.input' | 'model.output.text'>()
    return { action: 'allow' }
  },
})

interface Answer {
  answer: string
  citations: readonly string[]
}

constraint({
  id: 'has-citations',
  on: boundary.output.object<Answer>(),
  run: (answer) => {
    expectTypeOf(answer).toEqualTypeOf<Answer>()
    return answer.citations.length > 0
      ? { pass: true }
      : { pass: false, feedback: 'Add citations.' }
  },
})

const validTune = {
  tune: {
    pii: { mode: 'report', stream: 'final', enabled: false },
  },
} satisfies SafetyTuneOptions
expectTypeOf(validTune).toMatchTypeOf<SafetyTuneOptions>()

const invalidTune = {
  tune: {
    // @ts-expect-error - call-site tuning cannot replace policy logic.
    pii: { replace: true },
  },
} satisfies SafetyTuneOptions
