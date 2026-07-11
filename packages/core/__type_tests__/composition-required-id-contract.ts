/**
 * Type tests proving `parallel()`/`pipeline()`/`consensus()`/`swarm()` require
 * an authored `id` in their public options — the same contract
 * `agent()`/`flow()`/`memory()`/`guardrail()`/`constraint()`/`blackboard()`
 * already use. Compiled via `tsc --noEmit` only — no runtime behavior.
 */

import { z } from 'zod'
import { agent } from '../src/agent/agent'
import { prompt } from '../src/prompt/prompt'
import { createParallel } from '../src/agent/parallel'
import { createPipeline } from '../src/agent/pipeline'
import { createConsensus } from '../src/agent/consensus'
import { createSwarm } from '../src/agent/swarm'
import type { AgentExecutor } from '../src/agent/executor'

declare const executor: AgentExecutor

const echoPrompt = prompt({
  id: 'echo',
  input: z.object({ content: z.string() }),
  output: z.object({ content: z.string() }),
  prompt: ({ input }) => input.content,
})

const echoAgent = agent({ id: 'echo-agent', prompt: echoPrompt })

async function requiredIdSurface() {
  const parallel = createParallel(executor)
  // @ts-expect-error — `parallel()` requires an authored `id`.
  await parallel({ context: { content: 'x' }, agents: { echo: echoAgent } })
  await parallel({
    id: 'review-parallel',
    context: { content: 'x' },
    agents: { echo: echoAgent },
  })

  const pipeline = createPipeline(executor)
  // @ts-expect-error — `pipeline()` requires an authored `id`.
  await pipeline({
    context: { content: 'x' },
    steps: [{ name: 'echo', agent: echoAgent }],
  })
  await pipeline({
    id: 'review-pipeline',
    context: { content: 'x' },
    steps: [{ name: 'echo', agent: echoAgent }],
  })

  const consensus = createConsensus(executor)
  // @ts-expect-error — `consensus()` requires an authored `id`.
  await consensus({
    agents: [echoAgent] as const,
    input: { content: 'x' },
    extract: (result) => result.output.content,
  })
  await consensus({
    id: 'review-consensus',
    agents: [echoAgent] as const,
    input: { content: 'x' },
    extract: (result) => result.output.content,
  })

  const swarm = createSwarm(executor)
  // @ts-expect-error — `swarm()` requires an authored `id`.
  await swarm({
    agents: { echo: echoAgent },
    startAgent: 'echo',
    input: { content: 'x' },
  })
  await swarm({
    id: 'review-swarm',
    agents: { echo: echoAgent },
    startAgent: 'echo',
    input: { content: 'x' },
  })
}
void requiredIdSurface
