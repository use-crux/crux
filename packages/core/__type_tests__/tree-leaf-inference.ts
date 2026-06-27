/**
 * Type tests for `createPrompts()` / `createContexts()` leaf inference.
 *
 * The `_all` array on a tree should narrow to a union of the actual leaf
 * types — not the widened `AnyPrompt` / `Context<z.ZodType>`. This matters
 * when callers iterate `_all` and want IDE autocomplete on each leaf.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, createContexts } from '../prompt/context'
import { prompt } from '../prompt/prompt'
import { createPrompts } from '../prompt/prompts-tree'

const locale = context({
  id: 'locale',
  input: z.object({ locale: z.enum(['en', 'nl']) }),
  system: ({ input }) => `Reply in ${input.locale}.`,
})

const brand = context({
  id: 'brand',
  input: z.object({ brand: z.string() }),
  system: ({ input }) => `Brand: ${input.brand}`,
})

const tone = context({ id: 'tone', system: 'Friendly tone.' })

// ─────────────────────────────────────────────────────────────────
// createContexts — _all narrows to leaf union
// ─────────────────────────────────────────────────────────────────

const contexts = createContexts({
  brand: { voice: brand, secondary: tone },
  locale,
})

// Leaf access preserves concrete types.
expectTypeOf(contexts.brand.voice).toEqualTypeOf<typeof brand>()
expectTypeOf(contexts.brand.secondary).toEqualTypeOf<typeof tone>()
expectTypeOf(contexts.locale).toEqualTypeOf<typeof locale>()

// _all is a union of all leaf types — NOT widened.
type AllContexts = (typeof contexts._all)[number]
expectTypeOf<AllContexts>().toEqualTypeOf<typeof brand | typeof tone | typeof locale>()

// ─────────────────────────────────────────────────────────────────
// createPrompts — _all narrows to leaf union
// ─────────────────────────────────────────────────────────────────

const answerPrompt = prompt({
  id: 'answer',
  use: [locale],
  input: z.object({ q: z.string() }),
  output: z.object({ a: z.string() }),
  prompt: ({ input }) => input.q,
})

const summarizePrompt = prompt({
  id: 'summarize',
  input: z.object({ text: z.string() }),
  prompt: ({ input }) => input.text,
})

const prompts = createPrompts({
  qa: { answer: answerPrompt },
  utility: { summarize: summarizePrompt },
})

expectTypeOf(prompts.qa.answer).toEqualTypeOf<typeof answerPrompt>()
expectTypeOf(prompts.utility.summarize).toEqualTypeOf<typeof summarizePrompt>()

type AllPrompts = (typeof prompts._all)[number]
expectTypeOf<AllPrompts>().toEqualTypeOf<typeof answerPrompt | typeof summarizePrompt>()
