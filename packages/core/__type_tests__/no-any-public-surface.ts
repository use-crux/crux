/**
 * Type tests for the hardened public surface of @use-crux/core.
 *
 * These tests assert that the recent `any` → `z.ZodType`/`unknown` migrations
 * preserve (or improve) inference for the documented composition patterns.
 * They run via `tsc --noEmit` — no runtime behavior is executed.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { context, when, match, createContexts } from '../prompt/context'
import { prompt } from '../prompt/prompt'
import type {
  AnyPrompt,
  AnyPromptConfig,
  ConditionalContext,
  Context,
  ContextEntry,
  MatchSpec,
  MiddlewareResult,
  Prompt,
  PromptMiddleware,
  PromptMiddlewareArgs,
  ResolvedPrompt,
} from '../types'

// ─────────────────────────────────────────────────────────────────
// Context inference still flows through createContexts / when / match
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

const tone = context({ system: '## Tone\nFriendly.' })

// Tree creation: leaf types preserved through DeepReadonly + ContextTreeResult
const tree = createContexts({
  base: { tone },
  locale: localeCtx,
})

expectTypeOf(tree.base.tone).toEqualTypeOf<typeof tone>()
expectTypeOf(tree.locale).toEqualTypeOf<typeof localeCtx>()
expectTypeOf(tree._all).toMatchTypeOf<Context<z.ZodType>[]>()

// when() / match(): result types remain narrowable through ContextEntry
const conditional = when(({ locale }) => locale === 'en', localeCtx)
expectTypeOf(conditional).toMatchTypeOf<ConditionalContext<typeof localeCtx>>()

const branch = match({
  on: (input: { mode: 'english' | 'branded' }) => input.mode,
  cases: { english: localeCtx, branded: [localeCtx, brandCtx] },
  default: tone,
})
expectTypeOf(branch).toEqualTypeOf<MatchSpec>()

// match() rejects typos: discriminator return must match one of the case keys.
match({
  on: (input: { mode: 'a' | 'b' }) => input.mode,
  cases: { a: localeCtx, b: localeCtx },
})
// The narrowing happens at the function-type level: a `() => string` is wider
// than `() => 'a' | 'b'` and won't satisfy the constraint.
const wideOn: () => string = () => 'a'
// @ts-expect-error — discriminator return must be one of the declared case keys
match({ on: wideOn, cases: { a: localeCtx, b: localeCtx } })

// ─────────────────────────────────────────────────────────────────
// Prompt input merging still requires every context field
// ─────────────────────────────────────────────────────────────────

const answer = prompt({
  use: [localeCtx, brandCtx, tone],
  input: z.object({ question: z.string() }),
  system: ({ input }) => `${input.brand} answering in ${input.locale}: ${input.question}`,
})

void answer.resolve({
  input: { question: 'q', locale: 'en', brand: 'Acme' },
})

void answer.resolve({
  // @ts-expect-error — locale/brand fields required from context schemas
  input: { question: 'q' },
})

// Conditional contexts contribute Partial<> fields
const optional = prompt({
  use: [when(({ locale }) => locale === 'nl', localeCtx), brandCtx],
  input: z.object({ question: z.string() }),
  system: ({ input }) => `${input.brand}: ${input.question}`,
})

void optional.resolve({
  input: { question: 'q', brand: 'Acme' }, // locale optional
})

void optional.resolve({
  input: { question: 'q', brand: 'Acme', locale: 'en' },
})

// ─────────────────────────────────────────────────────────────────
// AnyPrompt / AnyPromptConfig accept any concrete prompt
// ─────────────────────────────────────────────────────────────────

const concretePrompt: Prompt<z.ZodObject<{ q: z.ZodString }>, undefined, readonly [typeof localeCtx]> = prompt({
  use: [localeCtx],
  input: z.object({ q: z.string() }),
  system: ({ input }) => input.q,
})

expectTypeOf(concretePrompt).toMatchTypeOf<AnyPrompt>()
expectTypeOf(concretePrompt.config).toMatchTypeOf<AnyPromptConfig>()

// ─────────────────────────────────────────────────────────────────
// ContextEntry covers every legal use[] member
// ─────────────────────────────────────────────────────────────────

const entries: readonly ContextEntry[] = [localeCtx, brandCtx, conditional, branch, tone, false, null, undefined]
void entries

// ─────────────────────────────────────────────────────────────────
// Middleware contract: result is structurally readable, no `any` leak
// ─────────────────────────────────────────────────────────────────

const sampleMiddleware: PromptMiddleware = async (args, next) => {
  expectTypeOf(args).toMatchTypeOf<PromptMiddlewareArgs>()
  const result = await next(args)
  expectTypeOf(result).toMatchTypeOf<MiddlewareResult>()
  // text / object remain optional unknown — no `any` widening
  expectTypeOf(result.text).toEqualTypeOf<string | undefined>()
  expectTypeOf(result.object).toEqualTypeOf<unknown>()
  return result
}
void sampleMiddleware

// ─────────────────────────────────────────────────────────────────
// ResolvedPrompt: known fields stay strongly typed (no `any` regression)
// ─────────────────────────────────────────────────────────────────

declare const resolved: ResolvedPrompt
expectTypeOf(resolved.system).toEqualTypeOf<string | undefined>()
expectTypeOf(resolved.constraints).toEqualTypeOf<import('../safety/constraint/types').Constraint[] | undefined>()
expectTypeOf(resolved.guardrails).toEqualTypeOf<import('../safety/guardrail/types').Guardrail[] | undefined>()
