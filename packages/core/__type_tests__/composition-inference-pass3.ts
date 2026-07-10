/**
 * Type tests for pipeline overload extension and flow/handoff/delegate inference.
 *
 * Verifies that:
 * - `pipeline()` infers context accumulation through 10 steps (matches Vercel AI SDK).
 * - `flow.step<T>()` return type is inferred from the step's return.
 * - `handoff()` preserves input/output schema inference.
 * - `delegate()` preserves args/handoff schema inference.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { agent } from '../src/agent/agent'
import { createPipeline } from '../src/agent/pipeline'
import { prompt } from '../src/prompt/prompt'
import { handoff } from '../src/agent/handoff'
import { delegate } from '../src/agent/delegate'
import { flow } from '../src/flow/scope'
import type { AgentExecutor } from '../src/agent/executor'

declare const executor: AgentExecutor

const echoPrompt = prompt({
  id: 'echo',
  input: z.object({ q: z.string() }),
  output: z.object({ answer: z.string() }),
  prompt: ({ input }) => input.q,
})
const echoAgent = agent({ id: 'echo', prompt: echoPrompt })

// ─────────────────────────────────────────────────────────────────
// pipeline(): accumulator inference through 6, 8, 10 steps
// ─────────────────────────────────────────────────────────────────

const pipeline = createPipeline(executor)

async function pipelineDeep() {
  // The earlier-step ctx access inside each later step is what proves the
  // accumulator works: `ctx.s5.e` would fail to type-check at step 6 if
  // pipeline didn't carry the typed Acc through that position. This file
  // exercises through position 10 — the new overloads added in this pass.
  const r10 = await pipeline({
    context: { seed: 'go' },
    steps: [
      { name: 's1', fn: async () => ({ a: 1 }) },
      { name: 's2', fn: async (ctx) => ({ b: ctx.s1.a + 1 }) },
      { name: 's3', fn: async (ctx) => ({ c: ctx.s2.b + 1 }) },
      { name: 's4', fn: async (ctx) => ({ d: ctx.s3.c + 1 }) },
      { name: 's5', fn: async (ctx) => ({ e: ctx.s4.d + 1 }) },
      { name: 's6', fn: async (ctx) => ({ f: ctx.s5.e + 1 }) },
      { name: 's7', fn: async (ctx) => ({ g: ctx.s6.f + 1 }) },
      { name: 's8', fn: async (ctx) => ({ h: ctx.s7.g + 1 }) },
      { name: 's9', fn: async (ctx) => ({ i: ctx.s8.h + 1 }) },
      { name: 's10', fn: async (ctx) => ({ j: ctx.s9.i + 1 }) },
    ],
  })
  if (r10.status === 'completed') {
    expectTypeOf(r10.context.seed).toEqualTypeOf<string>()
  }
}
void pipelineDeep

// Verify step-by-step accumulator threading: each ctx access compiles only
// if the prior step's output was added to the accumulator. With `const`
// generics on the step params, literal step names are preserved.
async function pipelineAccumulator() {
  const r = await pipeline({
    context: { initial: 42 },
    steps: [
      { name: 'first', fn: async (ctx) => ({ doubled: ctx.initial * 2 }) },
      { name: 'second', fn: async (ctx) => ({ tripled: ctx.first.doubled * 1.5 }) },
      { name: 'third', fn: async (ctx) => ({ summary: `${ctx.initial} → ${ctx.second.tripled}` }) },
    ],
  })
  if (r.status === 'completed') {
    expectTypeOf(r.context.initial).toEqualTypeOf<number>()
    expectTypeOf(r.context.first).toEqualTypeOf<{ doubled: number }>()
    expectTypeOf(r.context.second).toEqualTypeOf<{ tripled: number }>()
    expectTypeOf(r.context.third).toEqualTypeOf<{ summary: string }>()
  }
}
void pipelineAccumulator

// ─────────────────────────────────────────────────────────────────
// flow.step<T>(): return type inferred from the step function.
// ─────────────────────────────────────────────────────────────────

async function flowSurface() {
  const f = flow('demo', async (scope) => {
    expectTypeOf(scope.flowId).toEqualTypeOf<string>()

    const plan = await scope.step('plan', async () => ({ steps: ['a', 'b'] }))
    expectTypeOf(plan).toEqualTypeOf<{ steps: string[] }>()

    const search = await scope.step('search', async () => 42)
    expectTypeOf(search).toEqualTypeOf<number>()

    return { plan, search }
  })
  void f
}
void flowSurface

// ─────────────────────────────────────────────────────────────────
// handoff(): prepare(input) typed from inputSchema; payload.data typed from outputSchema.
// ─────────────────────────────────────────────────────────────────

const research = handoff({
  id: 'research-to-writer',
  inputSchema: z.object({ findings: z.array(z.string()) }),
  outputSchema: z.object({ synthesis: z.string(), sourceCount: z.number() }),
  transform: (input) => {
    expectTypeOf(input.findings).toEqualTypeOf<string[]>()
    return { synthesis: input.findings.join(', '), sourceCount: input.findings.length }
  },
})

async function handoffSurface() {
  // @ts-expect-error — `notFindings` is not a valid input key
  await research.prepare({ notFindings: [] })

  const payload = await research.prepare({ findings: ['a', 'b'] })
  expectTypeOf(payload.data).toEqualTypeOf<{ synthesis: string; sourceCount: number }>()
}
void handoffSurface

// ─────────────────────────────────────────────────────────────────
// delegate(): args + execute return typed from schemas.
// ─────────────────────────────────────────────────────────────────

const researchDelegate = delegate({
  id: 'delegate-research',
  argsSchema: z.object({ query: z.string(), depth: z.number().optional() }),
  handoff: research,
  execute: async (args) => {
    expectTypeOf(args.query).toEqualTypeOf<string>()
    expectTypeOf(args.depth).toEqualTypeOf<number | undefined>()
    // Return value must satisfy handoff.inputSchema
    return { findings: [args.query] }
  },
})

async function delegateSurface() {
  const result = await researchDelegate.run({ query: 'foo' }, undefined)
  expectTypeOf(result.data).toEqualTypeOf<{ synthesis: string; sourceCount: number }>()

  // @ts-expect-error — `bogus` not in argsSchema
  await researchDelegate.run({ bogus: true }, undefined)
}
void delegateSurface
