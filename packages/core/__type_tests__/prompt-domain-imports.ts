/**
 * Type-level characterization of the **prompt authoring domain barrel** (`../prompt`).
 *
 * Companion to the runtime `__tests__/prompt/prompt-domain.test.ts`. Phase 2
 * of the Core structure refactor introduced `prompt/` as the owner of the
 * prompt/context authoring surface; this file pins that the domain barrel
 * re-exports both the authoring values and their inference types, so later
 * phases can move files *inside* `prompt/` without breaking intra-package
 * consumers.
 *
 * Runs under `tsc --noEmit` only — assertions carry the contract; nothing executes.
 *
 * Pins, per the naming/testing contract:
 * - context input schemas merge into the prompt input;
 * - conditional (`when`) contexts contribute *optional* input fields;
 * - the prompt output schema determines result typing;
 * - exported domain types stay strongly typed (no `any` leak).
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, when, prompt } from '../src/prompt'
import type {
  AnyPrompt,
  ConditionalContext,
  Context,
  ContextEntry,
  MergedInput,
  Prompt,
  Simplify,
} from '../src/prompt'

const localeCtx = context({
  id: 'locale',
  input: z.object({ locale: z.enum(['en', 'nl']) }),
  system: ({ input }) => `Reply in ${input.locale}.`,
})

const brandCtx = context({
  id: 'brand',
  input: z.object({ brand: z.string() }),
  system: ({ input }) => `Brand: ${input.brand}`,
})

// `use[]` accepts every legal member shape through the domain `ContextEntry`.
const conditional = when(({ locale }) => locale === 'en', localeCtx)
expectTypeOf(conditional).toMatchTypeOf<ConditionalContext<typeof localeCtx>>()
const entries: readonly ContextEntry[] = [localeCtx, brandCtx, conditional, false, null, undefined]
void entries

// Context input schemas merge into the prompt input (required fields).
const answer = prompt({
  id: 'answer',
  use: [localeCtx, brandCtx],
  input: z.object({ question: z.string() }),
  system: ({ input }) => `${input.brand} answering in ${input.locale}: ${input.question}`,
  prompt: ({ input }) => input.question,
})
expectTypeOf(answer).toMatchTypeOf<AnyPrompt>()
void answer.resolve({ input: { question: 'q', locale: 'en', brand: 'Acme' } })
void answer.resolve({
  // @ts-expect-error — locale and brand are required by the merged context schemas.
  input: { question: 'q' },
})

// Conditional contexts contribute *optional* input fields.
const optional = prompt({
  id: 'optional',
  use: [when(({ locale }) => locale === 'nl', localeCtx), brandCtx],
  input: z.object({ question: z.string() }),
  prompt: ({ input }) => input.question,
})
void optional.resolve({ input: { question: 'q', brand: 'Acme' } }) // locale omitted — allowed

// The prompt output schema determines result typing.
prompt({
  id: 'structured',
  input: z.object({ q: z.string() }),
  output: z.object({ score: z.number(), label: z.enum(['ok', 'bad']) }),
  prompt: ({ input }) => input.q,
  hooks: {
    onGenerate: (_args, result) => {
      expectTypeOf(result.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()
    },
  },
})

// `MergedInput` over a context tuple keeps each field's literal type (no `any` leak).
type AnswerInput = Simplify<
  MergedInput<z.ZodObject<{ question: z.ZodString }>, readonly [typeof localeCtx, typeof brandCtx]>
>
expectTypeOf<AnswerInput['question']>().toEqualTypeOf<string>()
expectTypeOf<AnswerInput['locale']>().toEqualTypeOf<'en' | 'nl'>()
expectTypeOf<AnswerInput['brand']>().toEqualTypeOf<string>()

declare const concrete: Prompt<z.ZodObject<{ q: z.ZodString }>, undefined, readonly [typeof localeCtx]>
expectTypeOf(concrete).toMatchTypeOf<AnyPrompt>()
expectTypeOf(concrete).not.toBeAny()

declare const ctx: Context<z.ZodType>
expectTypeOf(ctx).not.toBeAny()
