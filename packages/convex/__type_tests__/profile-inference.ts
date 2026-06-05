import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { ToolDef } from '@crux/core/tools'
import * as convexRoot from '../index'
import { createCruxConvex, prompt } from '../index'
import { convexAgent } from '../agent'
import { context } from '../context'
import { memory, recentMessages, workingState } from '../memory'
import { skill } from '../skill'
import { tool } from '../tools'

const workingStateSchema = z.object({
  draftId: z.string(),
})

const agentMemory = memory({
  id: 'agent-memory',
  blocks: [
    recentMessages({ id: 'recent', maxMessages: 4 }),
    workingState({ id: 'working', schema: workingStateSchema }),
  ],
})

expectTypeOf(agentMemory._tag).toEqualTypeOf<'Memory'>()

// @ts-expect-error high-level `agent()` is intentionally not exported from the Convex profile root.
convexRoot.agent

const editorialContext = context({
  id: 'editorial',
  input: z.object({
    locale: z.enum(['en', 'nl']),
  }),
  system: ({ input }) => `Write in ${input.locale}.`,
})

const editSkill = skill.inline({
  id: 'copy-editing',
  description: 'Copy editing guidance.',
  instructions: 'Tighten prose and preserve factual claims.',
})

const searchProject = tool({
  name: 'searchProject',
  description: 'Search project material.',
  input: z.object({
    query: z.string(),
  }),
  execute: async ({ input, ctx, target }) => {
    expectTypeOf(input.query).toEqualTypeOf<string>()
    expectTypeOf(ctx).toEqualTypeOf<unknown>()
    expectTypeOf(target.threadId).toEqualTypeOf<string | undefined>()
    return { query: input.query, threadId: target.threadId }
  },
})

expectTypeOf(searchProject.execute).toMatchTypeOf<
  ToolDef<{ query: string }, { query: string; threadId: string | undefined }>['execute']
>()

const editPrompt = prompt({
  id: 'edit',
  input: z.object({
    instruction: z.string(),
    projectId: z.string(),
  }),
  use: [agentMemory, editorialContext, editSkill],
  tools: {
    searchProject,
  },
  system: ({ input }) => `Project: ${input.projectId}`,
  prompt: ({ input }) => input.instruction,
})

const model = {} as LanguageModelV3

const agent = convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  name: 'Editor',
  prompt: editPrompt,
  model,
})

agent.generateText(
  {},
  { threadId: 'thread-1', userId: 'user-1' },
  {
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'en',
    },
  },
)

const crux = createCruxConvex({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
})

const profileAgent = crux.convexAgent({
  name: 'Profile Editor',
  prompt: editPrompt,
  model,
  prepare: async ({ input, messages }) => {
    expectTypeOf(messages?.recent[0]?.content).toEqualTypeOf<unknown>()
    return {
      input,
      use: [editorialContext],
      captureMessages: messages?.recent,
    }
  },
})

profileAgent.resolve(
  {},
  { threadId: 'thread-1' },
  {
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'nl',
    },
  },
)

profileAgent.continueThread(
  {},
  { threadId: 'thread-1', userId: 'user-1' },
  {
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'nl',
    },
  },
)

agent.generateText(
  {},
  { threadId: 'thread-1' },
  {
    // @ts-expect-error context input from use[] is required.
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
    },
  },
)
