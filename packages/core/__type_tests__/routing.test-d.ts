/**
 * Type tests for the annotation-only routing API.
 *
 * These are the Phase 6 subset of the routing prototype: router/split/retry/
 * fallback composition, call-site `routing:`/`route:`, input compatibility,
 * widened-classify guardrails, and stream poisoning. Prompt-bound cascade
 * evaluator typing is intentionally Phase 7 scope.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { prompt, type AnyPrompt } from '../prompt'
import {
  cascade,
  fallback,
  retry,
  router,
  split,
  type CtxOf,
  type BoundOk,
  type InputOk,
  type PromptInputOf,
  type PromptOutputOf,
  type RouteArgs,
  type RoutingCallOptions,
  type RoutingReceipt,
  type StreamOf,
} from '../routing'

interface RawModel {
  readonly modelId: string
}

declare const opus: RawModel
declare const haiku: RawModel
declare const gpt5: RawModel

const supportPrompt = prompt({
  id: 'support',
  input: z.object({ question: z.string() }),
  output: z.object({ text: z.string() }),
  system: 'Answer support questions.',
})

const invoicePrompt = prompt({
  id: 'invoice',
  input: z.object({ pdfText: z.string() }),
  output: z.object({ total: z.number(), lines: z.array(z.string()) }),
  system: 'Extract invoice data.',
})

declare function generate<P extends AnyPrompt, M>(
  prompt: P & BoundOk<M, P> & InputOk<M, PromptInputOf<P>>,
  opts: { readonly model: M; readonly input: PromptInputOf<P> } & RoutingCallOptions<M>,
): Promise<{ readonly routing: RoutingReceipt }>

declare function stream<P extends AnyPrompt, M>(
  prompt: P &
    BoundOk<M, P> &
    InputOk<M, PromptInputOf<P>> &
    (StreamOf<M> extends true ? unknown : ['model contains a cascade; cascades are generate-only']),
  opts: { readonly model: M; readonly input: PromptInputOf<P> } & RoutingCallOptions<M>,
): Promise<{ readonly completion: Promise<{ readonly routing: RoutingReceipt }> }>

interface AuthContext {
  readonly tier: 'free' | 'pro' | 'enterprise'
  readonly betaOptIn?: boolean
}

const tierRouter = router({
  classify: ({ context }: RouteArgs<AuthContext>) => {
    if (context.betaOptIn) return 'deep'
    return context.tier === 'enterprise' ? 'deep' : 'fast'
  },
  routes: {
    fast: { model: haiku, temperature: 0 },
    deep: opus,
    default: haiku,
  },
})

void generate(supportPrompt, {
  model: tierRouter,
  input: { question: 'hi' },
  routing: { tier: 'pro' },
})

void generate(supportPrompt, {
  model: tierRouter,
  input: { question: 'hi' },
  routing: { tier: 'free' },
  route: 'deep',
})

// @ts-expect-error — missing routing context required by RouteArgs<AuthContext>
void generate(supportPrompt, { model: tierRouter, input: { question: 'hi' } })

void generate(supportPrompt, {
  model: tierRouter,
  input: { question: 'hi' },
  // @ts-expect-error — invalid tier value
  routing: { tier: 'gold' },
})

void generate(supportPrompt, {
  model: tierRouter,
  input: { question: 'hi' },
  routing: { tier: 'pro' },
  // @ts-expect-error — route is typed to authored route keys
  route: 'depe',
})

router({
  classify: ({ context }: RouteArgs<{ readonly vip: boolean }>) => (context.vip ? 'deep' : 'fast'),
  // @ts-expect-error — routes must cover classify's return key
  routes: { fast: haiku, default: haiku },
})

const contextFree = router({
  classify: () => 'a' as const,
  routes: { a: haiku, default: haiku },
})
void generate(supportPrompt, { model: contextFree, input: { question: 'hi' } })

void generate(supportPrompt, { model: opus, input: { question: 'hi' } })

// @ts-expect-error — route override is meaningless on a raw model
void generate(supportPrompt, { model: opus, input: { question: 'hi' }, route: 'deep' })

const canary = split({
  seed: ({ context }: RouteArgs<{ readonly sessionId: string }>) => context.sessionId,
  routes: { stable: { model: haiku, weight: 95 }, next: { model: gpt5, weight: 5 } },
})

const regionRouter = router({
  classify: ({ context }: RouteArgs<{ readonly region: 'eu' | 'us' }>) =>
    context.region === 'eu' ? 'eu' : 'us',
  routes: { eu: tierRouter, us: canary, default: haiku },
})

void generate(supportPrompt, {
  model: regionRouter,
  input: { question: 'hi' },
  routing: { region: 'eu', tier: 'pro', sessionId: 's_1' },
})

void generate(supportPrompt, {
  model: regionRouter,
  input: { question: 'hi' },
  // @ts-expect-error — nested context requirements survive composition
  routing: { region: 'eu' },
})

const resilient = fallback([retry(gpt5, { attempts: 2, backoff: 'exponential' }), haiku], {
  on: ['rate_limit'],
  timeout: { attempt: 10_000 },
})
void generate(supportPrompt, { model: resilient, input: { question: 'hi' } })
void stream(supportPrompt, { model: resilient, input: { question: 'hi' } })

const resilientTiered = fallback([tierRouter, haiku])
void generate(supportPrompt, {
  model: resilientTiered,
  input: { question: 'hi' },
  routing: { tier: 'free' },
})
// @ts-expect-error — router context survives through fallback
void generate(supportPrompt, { model: resilientTiered, input: { question: 'hi' } })

const extraction = cascade({
  prompt: invoicePrompt,
  tiers: [
    {
      model: haiku,
      evaluate: async ({ result, input, report }) => {
        expectTypeOf(result).toEqualTypeOf<PromptOutputOf<typeof invoicePrompt>>()
        expectTypeOf(input).toEqualTypeOf<PromptInputOf<typeof invoicePrompt>>()
        const judged = await report(Promise.resolve({ score: 0.9, cost: 0.002 }))
        const total: number = result.total
        const chars: number = input.pdfText.length
        return { accepted: total > 0 && chars > 0 && judged.score > 0.8 }
      },
    },
    { model: opus },
  ],
  budget: { maxCost: 0.05 },
})

void generate(invoicePrompt, { model: extraction, input: { pdfText: 'x' } })
// @ts-expect-error — cascade is bound to invoicePrompt, not supportPrompt
void generate(supportPrompt, { model: extraction, input: { question: 'hi' } })
// @ts-expect-error — cascade is generate-only
void stream(invoicePrompt, { model: extraction, input: { pdfText: 'x' } })

const genericCascade = cascade({
  tiers: [
    {
      model: haiku,
      evaluate: ({ result }) => {
        expectTypeOf(result).toEqualTypeOf<unknown>()
        return typeof result === 'object' && result !== null
      },
    },
    { model: opus },
  ],
})
void generate(supportPrompt, { model: genericCascade, input: { question: 'hi' } })
// @ts-expect-error — cascade is generate-only
void stream(supportPrompt, { model: genericCascade, input: { question: 'hi' } })

const lengthRouter = router({
  classify: ({ input }: RouteArgs<object, { readonly question: string }>) =>
    input.question.length > 2000 ? 'long' : 'short',
  routes: { long: opus, short: haiku, default: haiku },
})
void generate(supportPrompt, { model: lengthRouter, input: { question: 'hi' } })
// @ts-expect-error — invoice input lacks the field read by the classifier
void generate(invoicePrompt, { model: lengthRouter, input: { pdfText: 'x' } })

expectTypeOf<CtxOf<typeof regionRouter>>().toEqualTypeOf<{
  readonly region: 'eu' | 'us'
  readonly tier: 'free' | 'pro' | 'enterprise'
  readonly betaOptIn?: boolean
  readonly sessionId: string
}>()

const widened = router({
  classify: ({ context }: RouteArgs<{ readonly x: number }>): string =>
    context.x > 0 ? 'a' : 'b',
  // @ts-expect-error — classify must return specific route keys, not string
  routes: { a: haiku, default: haiku },
})
void widened

router({
  // @ts-expect-error — context is object until annotated
  classify: ({ context }) => (context.tier === 'pro' ? 'a' : 'default'),
  routes: { a: haiku, default: haiku },
})

const inputOnly = router({
  classify: ({ input }: RouteArgs<object, { readonly q: string }>) =>
    input.q.length > 10 ? 'a' : 'default',
  routes: { a: haiku, default: haiku },
})
void inputOnly
