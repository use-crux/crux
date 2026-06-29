/**
 * Type-level characterization of the **published `@use-crux/core` barrel**.
 *
 * The sibling inference suites (`inference-surfaces.ts`, `no-any-public-surface.ts`)
 * import from relative paths (`../define`, `../context`, `../types`). They prove
 * the *implementations* infer well, but they follow files as they move and so
 * cannot prove the public barrel keeps re-exporting those types intact.
 *
 * This suite imports values **and** types exclusively from `@use-crux/core`.
 * During the Core structure refactor, root files move into domain folders; this
 * file must keep type-checking with zero edits. It is the type-level guardrail
 * paired with the runtime `__tests__/public-import-surface.test.ts` suite.
 *
 * Runs under `tsc --noEmit` only — `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the contract; nothing executes.
 *
 * Pins, per the naming/testing contract:
 * - context input schemas merge into the prompt input;
 * - conditional (`when`) contexts contribute *optional* input fields;
 * - the prompt output schema determines result typing;
 * - public re-exported types stay strongly typed (no `any` leak);
 * - the surface uses TypeScript 5.5-compatible syntax.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, when, match, createContexts, prompt } from '@use-crux/core'
import type {
  AnyPrompt,
  ConditionalContext,
  Context,
  ContextEntry,
  MatchSpec,
  MergedInput,
  Prompt,
  PromptMiddleware,
  PromptMiddlewareArgs,
  ResolvedPrompt,
  Simplify,
} from '@use-crux/core'

// ─────────────────────────────────────────────────────────────────
// Shared fixtures (authored through the public barrel)
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

const tone = context({ id: 'tone', system: '## Tone\nFriendly.' })

// ─────────────────────────────────────────────────────────────────
// createContexts / when / match keep their narrow result types
// ─────────────────────────────────────────────────────────────────

const tree = createContexts({ base: { tone }, locale: localeCtx })
expectTypeOf(tree.base.tone).toEqualTypeOf<typeof tone>()
expectTypeOf(tree.locale).toEqualTypeOf<typeof localeCtx>()
expectTypeOf(tree._all).toMatchTypeOf<Context<z.ZodType>[]>()

const conditional = when(({ locale }) => locale === 'en', localeCtx)
expectTypeOf(conditional).toMatchTypeOf<ConditionalContext<typeof localeCtx>>()

const branch = match({
  on: (input: { mode: 'terse' | 'verbose' }) => input.mode,
  cases: { terse: localeCtx, verbose: [localeCtx, brandCtx] },
  default: tone,
})
expectTypeOf(branch).toEqualTypeOf<MatchSpec>()

// `use[]` accepts every legal member shape through the public `ContextEntry`.
const entries: readonly ContextEntry[] = [localeCtx, brandCtx, conditional, branch, tone, false, null, undefined]
void entries

// ─────────────────────────────────────────────────────────────────
// Context input schemas merge into the prompt input (required fields)
// ─────────────────────────────────────────────────────────────────

const answer = prompt({
  id: 'public-barrel-answer',
  use: [localeCtx, brandCtx, tone],
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

// `.resolve()` resolves through the public `ResolvedPrompt` contract.
expectTypeOf(answer.resolve).returns.resolves.toMatchTypeOf<ResolvedPrompt>()

// ─────────────────────────────────────────────────────────────────
// Conditional contexts contribute *optional* input fields
// ─────────────────────────────────────────────────────────────────

const optional = prompt({
  id: 'public-barrel-optional',
  use: [when(({ locale }) => locale === 'nl', localeCtx), brandCtx],
  input: z.object({ question: z.string() }),
  system: ({ input }) => `${input.brand}: ${input.question}`,
  prompt: ({ input }) => input.question,
})

void optional.resolve({ input: { question: 'q', brand: 'Acme' } }) // locale omitted — allowed
void optional.resolve({ input: { question: 'q', brand: 'Acme', locale: 'en' } })

// ─────────────────────────────────────────────────────────────────
// The prompt output schema determines result typing
// ─────────────────────────────────────────────────────────────────

const ScoreSchema = z.object({ score: z.number(), label: z.enum(['ok', 'bad']) })

prompt({
  id: 'public-barrel-structured',
  input: z.object({ q: z.string() }),
  output: ScoreSchema,
  prompt: ({ input }) => input.q,
  hooks: {
    onGenerate: (_args, result) => {
      // Result object is inferred from the output schema with zero annotations.
      expectTypeOf(result.object).toEqualTypeOf<{ score: number; label: 'ok' | 'bad' }>()
    },
  },
})

prompt({
  id: 'text-only',
  input: z.object({ q: z.string() }),
  prompt: ({ input }) => input.q,
  hooks: {
    onGenerate: (_args, result) => {
      // Text-only prompts expose a required `text`, no typed `object`.
      expectTypeOf(result.text).toEqualTypeOf<string>()
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// Public re-exported helper types stay strongly typed (no `any` leak)
// ─────────────────────────────────────────────────────────────────

// `MergedInput` over a context tuple keeps each field's literal type.
type AnswerInput = Simplify<MergedInput<z.ZodObject<{ question: z.ZodString }>, readonly [typeof localeCtx, typeof brandCtx]>>
expectTypeOf<AnswerInput['question']>().toEqualTypeOf<string>()
expectTypeOf<AnswerInput['locale']>().toEqualTypeOf<'en' | 'nl'>()
expectTypeOf<AnswerInput['brand']>().toEqualTypeOf<string>()

// `Prompt<...>` is assignable to the catch-all `AnyPrompt` without widening to `any`.
declare const concrete: Prompt<z.ZodObject<{ q: z.ZodString }>, undefined, readonly [typeof localeCtx]>
expectTypeOf(concrete).toMatchTypeOf<AnyPrompt>()
expectTypeOf(concrete).not.toBeAny()

// Middleware result stays structurally readable — `text` is `string | undefined`,
// `object` is `unknown`, never `any`.
const middleware: PromptMiddleware = async (args, next) => {
  expectTypeOf(args).toMatchTypeOf<PromptMiddlewareArgs>()
  const result = await next(args)
  expectTypeOf(result.text).toEqualTypeOf<string | undefined>()
  expectTypeOf(result.object).toEqualTypeOf<unknown>()
  expectTypeOf(result.object).not.toBeAny()
  return result
}
void middleware

// `ResolvedPrompt.system` is a precise optional string, not `any`.
declare const resolved: ResolvedPrompt
expectTypeOf(resolved.system).toEqualTypeOf<string | undefined>()
expectTypeOf(resolved.system).not.toBeAny()
