/**
 * Type tests for the agent-composition tightening pass.
 *
 * Covers the public-surface inference for `parallel()`, `consensus()`,
 * `swarm()`, `blackboard()`, and prompt-level semantic cache options.
 * Compiled via `tsc --noEmit` only — no runtime behavior.
 */

import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { prompt } from '../prompt/prompt'
import { context } from '../prompt/context'
import { agent } from '../agent/agent'
import type { AnyAgent } from '../agent/agent'
import { createParallel } from '../agent/parallel'
import { createConsensus } from '../agent/consensus'
import { createSwarm } from '../agent/swarm'
import { blackboard } from '../agent/blackboard'
import type { AgentExecutor } from '../agent/executor'

declare const executor: AgentExecutor

// ─────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────

const factPrompt = prompt({
  id: 'fact-checker',
  input: z.object({ claim: z.string() }),
  output: z.object({ verdict: z.enum(['true', 'false', 'mixed']) }),
  prompt: ({ input }) => input.claim,
})

const stylePrompt = prompt({
  id: 'style-reviewer',
  input: z.object({ prose: z.string() }),
  output: z.object({ tone: z.enum(['formal', 'casual']) }),
  prompt: ({ input }) => input.prose,
})

const factAgent = agent({ id: 'fact', prompt: factPrompt })
const styleAgent = agent({ id: 'style', prompt: stylePrompt })

// ─────────────────────────────────────────────────────────────────
// parallel(): context is the intersection of agent inputs;
// results[K].output is typed from each agent's output schema.
// ─────────────────────────────────────────────────────────────────

const parallel = createParallel(executor)

async function parallelSurface() {
  // Both agents see the same seed — context must satisfy both schemas.
  const { results } = await parallel({
    agents: { facts: factAgent, style: styleAgent },
    context: { claim: 'water boils at 100C', prose: 'a sentence' },
  })

  // results.facts.output is typed from factPrompt's output schema.
  expectTypeOf(results.facts.output).toEqualTypeOf<{
    verdict: 'true' | 'false' | 'mixed'
  }>()
  expectTypeOf(results.style.output).toEqualTypeOf<{
    tone: 'formal' | 'casual'
  }>()

  // Missing fields rejected.
  await parallel({
    agents: { facts: factAgent, style: styleAgent },
    // @ts-expect-error — `prose` is required by styleAgent
    context: { claim: 'x' },
  })

  // Plain async functions get input/output inferred from their signature.
  const enrich = async (input: { topic: string }) => ({ enriched: input.topic.toUpperCase() })
  const { results: r2 } = await parallel({
    agents: { enrich },
    context: { topic: 'ai' },
  })
  expectTypeOf(r2.enrich.output).toEqualTypeOf<{ enriched: string }>()
}
void parallelSurface

// ─────────────────────────────────────────────────────────────────
// consensus(): input intersects voter inputs; vote types narrow.
// ─────────────────────────────────────────────────────────────────

const consensus = createConsensus(executor)

async function consensusSurface() {
  const classifier1 = agent({ id: 'c1', prompt: factPrompt })
  const classifier2 = agent({ id: 'c2', prompt: factPrompt })

  const decision = await consensus({
    agents: [classifier1, classifier2] as const,
    input: { claim: 'is water wet?' },
    extract: (result) => {
      // result.output is typed as the union of voter outputs.
      expectTypeOf(result.output).toEqualTypeOf<{ verdict: 'true' | 'false' | 'mixed' }>()
      return result.output.verdict
    },
  })
  // result is typed as the union of `extract` return values.
  expectTypeOf(decision.result).toEqualTypeOf<'true' | 'false' | 'mixed'>()
  expectTypeOf(decision.votes).toEqualTypeOf<Record<'true' | 'false' | 'mixed', number>>()

  // Missing input fields rejected.
  await consensus({
    agents: [classifier1] as const,
    // @ts-expect-error — `claim` is required by the voter agent
    input: {},
    extract: (r) => r.output.verdict,
  })
}
void consensusSurface

// ─────────────────────────────────────────────────────────────────
// swarm(): start agent narrows input; output union from agents;
// activeTools keys are checked.
// ─────────────────────────────────────────────────────────────────

const swarm = createSwarm(executor)

async function swarmSurface() {
  const triagePrompt = prompt({
    id: 'triage',
    input: z.object({ message: z.string() }),
    output: z.object({ category: z.enum(['billing', 'general']) }),
    prompt: ({ input }) => input.message,
  })
  const billingPrompt = prompt({
    id: 'billing',
    input: z.object({ amount: z.number() }),
    output: z.object({ resolved: z.boolean() }),
    prompt: ({ input }) => String(input.amount),
  })

  const triage = agent({ id: 'triage', prompt: triagePrompt, handoffs: ['billing'] })
  const billing = agent({ id: 'billing', prompt: billingPrompt })

  // input is typed from the start agent (`triage`'s `{ message }` schema).
  const result = await swarm({
    agents: { triage, billing },
    startAgent: 'triage',
    input: { message: 'hello' },
    activeTools: {
      triage: [],
      billing: [],
    },
  })

  // finalAgentId narrows to the keys of the agents map.
  expectTypeOf(result.finalAgentId).toEqualTypeOf<'triage' | 'billing'>()

  // output is the union of every agent's output schema.
  expectTypeOf(result.output).toMatchTypeOf<{ category: 'billing' | 'general' } | { resolved: boolean }>()

  // @ts-expect-error — `unknownAgent` is not in the agents map
  await swarm({ agents: { triage, billing }, startAgent: 'unknownAgent', input: { message: 'x' } })

  // @ts-expect-error — start agent expects `{ message: string }`; this is wrong
  await swarm({ agents: { triage, billing }, startAgent: 'triage', input: { amount: 5 } })

  await swarm({
    agents: { triage, billing },
    startAgent: 'triage',
    input: { message: 'x' },
    // @ts-expect-error — `wrongKey` isn't an agent id
    activeTools: { wrongKey: [] },
  })
}
void swarmSurface

// ─────────────────────────────────────────────────────────────────
// blackboard(): keys are typed from the schema; non-object schemas rejected.
// ─────────────────────────────────────────────────────────────────

async function blackboardSurface() {
  const board = blackboard({
    id: 'thread',
    schema: z.object({ goal: z.string(), status: z.enum(['running', 'done']) }),
  })

  // get / set are typed by the schema shape.
  const goal = await board.get('goal')
  expectTypeOf(goal).toEqualTypeOf<string | undefined>()

  const status = await board.get('status')
  expectTypeOf(status).toEqualTypeOf<'running' | 'done' | undefined>()

  await board.set('status', 'running')
  // @ts-expect-error — 'wat' is not a valid status enum value
  await board.set('status', 'wat')
  // @ts-expect-error — 'unknownField' is not in the schema
  await board.get('unknownField')

  // patch is typed to Partial<State>.
  await board.patch({ status: 'done' })
  // @ts-expect-error — typo `staus` not allowed
  await board.patch({ staus: 'done' })

  // Non-ZodObject schemas are rejected at compile time.
  blackboard({
    id: 'wrong',
    // @ts-expect-error — schema must be a ZodObject for field-level validation
    schema: z.string(),
  })
}
void blackboardSurface

// ─────────────────────────────────────────────────────────────────
// Prompt-level semantic cache: query callback ctx.input is typed.
// ─────────────────────────────────────────────────────────────────

const localeCtx = context({
  id: 'locale',
  input: z.object({ locale: z.enum(['en', 'nl']) }),
  system: ({ input }) => `Reply in ${input.locale}.`,
})

prompt({
  id: 'cached',
  input: z.object({ topic: z.string() }),
  use: [localeCtx],
  prompt: ({ input }) => input.topic,
  cache: {
    semantic: {
      query: (ctx) => {
        // ctx.input typed from the merged input (own + context).
        expectTypeOf(ctx.input).toEqualTypeOf<{ topic: string; locale: 'en' | 'nl' }>()
        return `${ctx.input.locale}/${ctx.input.topic}`
      },
    },
  },
})

prompt({
  id: 'cached-typo',
  input: z.object({ topic: z.string() }),
  prompt: ({ input }) => input.topic,
  cache: {
    semantic: {
      query: (ctx) => {
        // @ts-expect-error — `topi` is not a field of the merged input
        return String(ctx.input.topi)
      },
    },
  },
})

// ─────────────────────────────────────────────────────────────────
// AnyAgent stays usable for heterogeneous registries.
// ─────────────────────────────────────────────────────────────────

const agentRegistry: Record<string, AnyAgent> = { factAgent, styleAgent }
void agentRegistry
