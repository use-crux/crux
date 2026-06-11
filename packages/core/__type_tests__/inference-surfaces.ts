/**
 * Type tests for the inference improvements applied alongside the `any`
 * removal pass. These verify that public APIs *actually* deliver the
 * "state-of-the-art TypeScript support" promise users see in the README.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, match, when } from '../context'
import { contributor } from '../contributor'
import { prompt } from '../define'
import { evaluatePrompt, evaluation, evaluateContext } from '../testing'
import type { GenerateFn } from '../testing'
import type { ContextDef, PromptHooks, PromptResult } from '../types'

// ─────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────

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

const flag = context({ id: 'flag', system: 'rules…' })

const ScoreSchema = z.object({ score: z.number(), label: z.enum(['ok', 'bad']) })

const scoringPrompt = prompt({
  id: 'scoring',
  input: z.object({ text: z.string() }),
  output: ScoreSchema,
  use: [localeCtx, brandCtx],
  prompt: ({ input }) => `${input.brand}: score "${input.text}" in ${input.locale}.`,
})

const textPrompt = prompt({
  id: 'text-only',
  input: z.object({ q: z.string() }),
  use: [localeCtx],
  prompt: ({ input }) => input.q,
})

// ─────────────────────────────────────────────────────────────────
// PromptHooks: result is typed from the output schema
// ─────────────────────────────────────────────────────────────────

declare const structuredHooks: PromptHooks<typeof ScoreSchema>
declare const textHooks: PromptHooks<undefined>

// Structured: result.object is typed.
if (structuredHooks.onGenerate) {
  structuredHooks.onGenerate({ promptId: 'x', durationMs: 0 }, {
    text: '...',
    object: { score: 1, label: 'ok' },
  } as PromptResult<typeof ScoreSchema>)
}

// Text-only: result.text is required, no typed .object field.
const textResult = {} as PromptResult<undefined>
expectTypeOf(textResult.text).toEqualTypeOf<string>()

// Structured prompts carry both fields.
const structuredResult = {} as PromptResult<typeof ScoreSchema>
expectTypeOf(structuredResult.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()

// Hooks flow through PromptConfig — the prompt builder threads TOutput in.
prompt({
  id: 'with-hooks',
  input: z.object({ q: z.string() }),
  output: ScoreSchema,
  prompt: ({ input }) => input.q,
  hooks: {
    onGenerate: (_args, result) => {
      // result.object is typed from ScoreSchema with zero annotations.
      expectTypeOf(result.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()
    },
  },
})

prompt({
  id: 'with-hooks-text',
  input: z.object({ q: z.string() }),
  prompt: ({ input }) => input.q,
  hooks: {
    onGenerate: (_args, result) => {
      // text-only prompt: `text` is required, no `object`.
      expectTypeOf(result.text).toEqualTypeOf<string>()
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// rawFields: typed against the merged input schema
// ─────────────────────────────────────────────────────────────────

prompt({
  id: 'raw-fields-ok',
  input: z.object({ instruction: z.string(), indexedHtml: z.string() }),
  use: [localeCtx],
  rawFields: ['indexedHtml', 'locale'], // both prompt-own and context-merged keys accepted
  prompt: ({ input }) => input.instruction,
})

prompt({
  id: 'raw-fields-typo',
  input: z.object({ instruction: z.string(), indexedHtml: z.string() }),
  // @ts-expect-error — 'indxdHtml' is a typo; rawFields must be a key of MergedInput
  rawFields: ['indxdHtml'],
  prompt: ({ input }) => input.instruction,
})

context({
  id: 'context-raw-fields',
  input: z.object({ payload: z.string(), preformatted: z.string() }),
  rawFields: ['preformatted'],
  system: ({ input }) => `${input.payload} / ${input.preformatted}`,
})

const contextRawFieldsTypoInput = z.object({ payload: z.string() })
const contextRawFieldsTypoDef: ContextDef<typeof contextRawFieldsTypoInput> = {
  id: 'context-raw-fields-typo',
  input: contextRawFieldsTypoInput,
  // @ts-expect-error — 'paylod' is a typo; rawFields keys are checked against the input schema.
  rawFields: ['paylod'],
  system: ({ input }) => input.payload,
}
void contextRawFieldsTypoDef

// ─────────────────────────────────────────────────────────────────
// match(): on-return is constrained to case keys
// ─────────────────────────────────────────────────────────────────

match({
  on: (input: { mode: 'a' | 'b' | 'c' }) => input.mode,
  cases: { a: localeCtx, b: brandCtx, c: [localeCtx, flag] },
  default: flag,
})

// A subset is allowed — `on` may return any subset of declared case keys.
match({
  on: (input: { mode: 'a' | 'b' }) => input.mode,
  cases: { a: localeCtx, b: brandCtx, c: flag },
})

// ─────────────────────────────────────────────────────────────────
// evaluatePrompt: cases.input + result inferred from the prompt
// ─────────────────────────────────────────────────────────────────

declare const generateFn: GenerateFn

// Structured prompt — result.object typed from ScoreSchema, input has merged contexts.
void evaluatePrompt({
  prompt: scoringPrompt,
  generate: generateFn,
  models: ['m'],
  cases: [
    {
      name: 'ok',
      input: { text: 'hi', locale: 'en', brand: 'Acme' },
      assert: (result) => {
        expectTypeOf(result.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()
        return result.object.score >= 0
      },
    },
  ],
})

// Missing context fields are caught.
void evaluatePrompt({
  prompt: scoringPrompt,
  generate: generateFn,
  models: ['m'],
  cases: [
    {
      name: 'missing-fields',
      // @ts-expect-error — `locale` and `brand` are required by the merged input
      input: { text: 'hi' },
      assert: () => true,
    },
  ],
})

// Text-only prompt — `result.object` is absent; `result.text` is typed.
void evaluatePrompt({
  prompt: textPrompt,
  generate: generateFn,
  models: ['m'],
  cases: [
    {
      name: 'text',
      input: { q: 'hello', locale: 'en' },
      assert: (result) => {
        expectTypeOf(result.text).toEqualTypeOf<string>()
        return result.text.length > 0
      },
    },
  ],
})

// ─────────────────────────────────────────────────────────────────
// evaluation(): same inference, used by the CLI eval runner
// ─────────────────────────────────────────────────────────────────

evaluation({
  prompt: scoringPrompt,
  mode: 'structured',
  cases: [
    {
      name: 'inferred',
      input: { text: 't', locale: 'nl', brand: 'X' },
      assert: (result) => {
        expectTypeOf(result.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()
        return true
      },
    },
  ],
})

// ─────────────────────────────────────────────────────────────────
// evaluateContext(): case.input typed from the prompt
// ─────────────────────────────────────────────────────────────────

declare const fakeJudge: import('../scoring/types').JudgeInstance

void evaluateContext({
  prompt: scoringPrompt,
  generate: generateFn,
  model: 'm',
  judge: fakeJudge,
  cases: [
    {
      name: 'context-quality',
      input: { text: 't', locale: 'en', brand: 'Acme' },
      contexts: [brandCtx],
    },
  ],
})

void evaluateContext({
  prompt: scoringPrompt,
  generate: generateFn,
  model: 'm',
  judge: fakeJudge,
  cases: [
    {
      name: 'context-quality-typo',
      // @ts-expect-error — `brnad` typo; case input must satisfy the prompt's merged input
      input: { text: 't', locale: 'en', brnad: 'Acme' },
      contexts: [brandCtx],
    },
  ],
})

// ─────────────────────────────────────────────────────────────────
// when() narrows wrapped-context input
// ─────────────────────────────────────────────────────────────────

const localeWhen = when((input) => input.locale === 'en', localeCtx)
expectTypeOf(localeWhen.context).toEqualTypeOf<typeof localeCtx>()

// ─────────────────────────────────────────────────────────────────
// contributor() input inference in long use: tuples (use-crux/crux#29)
// ─────────────────────────────────────────────────────────────────

const regionContributor = contributor({
  id: 'region',
  input: z.object({ region: z.enum(['eu', 'us']) }),
  contribute: ({ input }) => {
    // Declared schema types flow into contribute() with zero annotations.
    expectTypeOf(input.region).toEqualTypeOf<'eu' | 'us'>()
    return { metadata: { region: input.region } }
  },
})

// A long heterogeneous tuple — plain, conditional, match, contributor —
// must still infer the merged input without TS2589 blowups.
prompt({
  id: 'contributor-inference',
  input: z.object({ q: z.string() }),
  use: [
    localeCtx,
    when((input) => input.brand !== '', brandCtx),
    match({ on: () => 'a', cases: { a: flag } }),
    flag,
    regionContributor,
  ],
  prompt: ({ input }) => {
    expectTypeOf(input.q).toEqualTypeOf<string>()
    expectTypeOf(input.locale).toEqualTypeOf<'en' | 'nl'>()
    expectTypeOf(input.brand).toEqualTypeOf<string | undefined>()
    // Contributor-declared keys are required in the merged input.
    expectTypeOf(input.region).toEqualTypeOf<'eu' | 'us'>()
    return input.q
  },
})
