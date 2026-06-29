import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import type { LanguageModelV3 } from '@ai-sdk/provider'
import { Agent as ConvexAgentBase } from '@convex-dev/agent'
import type { CruxStore } from '@use-crux/core/store'
import type { ToolDef } from '@use-crux/core/tools'
import * as convexRoot from '../index'
import { createConvexRuntimeBridge, createCruxConvex, prompt, type ConvexCtxPort } from '../index'
import { Agent, convexAgent } from '../agent'
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

const languageModelAgent = convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  name: 'Language Model Editor',
  prompt: editPrompt,
  languageModel: model,
})

// @ts-expect-error profile-backed agents require `languageModel` or the legacy `model` alias.
convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  name: 'Missing Model Editor',
  prompt: editPrompt,
})

languageModelAgent.resolve(
  {},
  { threadId: 'thread-1' },
  {
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'en',
    },
  },
)

const profileLanguageModelAgent = crux.convexAgent({
  name: 'Profile Language Model Editor',
  prompt: editPrompt,
  languageModel: model,
})

// @ts-expect-error profile-created agents require `languageModel` or the legacy `model` alias.
crux.convexAgent({
  name: 'Missing Profile Model Editor',
  prompt: editPrompt,
})

profileLanguageModelAgent.crux.resolve(
  {},
  { threadId: 'thread-1' },
  {
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'en',
    },
  },
)

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

profileAgent.continueThread({}, { threadId: 'thread-1', userId: 'user-1' }).then(({ thread }) => {
  thread.streamText({
    input: {
      instruction: 'Improve this.',
      projectId: 'project-1',
      locale: 'nl',
    },
    temperature: 0.2,
  })

  // @ts-expect-error thread turns require Crux prompt input.
  thread.generateText({
    temperature: 0.2,
  })
})

// @ts-expect-error continueThread mirrors Convex Agent and does not accept per-turn input.
profileAgent.continueThread({}, { threadId: 'thread-1', userId: 'user-1' }, { input: {} })

profileAgent.streamText(
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

interface TenantConvexCtx extends ConvexCtxPort {
  tenantId: string
}

const tenantProfile = createCruxConvex<TenantConvexCtx>({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  store: {
    vectorIndexName: 'by_tenant_embedding',
    create(ctx, defaults) {
      expectTypeOf(ctx.tenantId).toEqualTypeOf<string>()
      expectTypeOf(defaults.vectorIndexName).toEqualTypeOf<string>()
      expectTypeOf(defaults.createComponentStore(ctx)).toEqualTypeOf<CruxStore>()
      return defaults.createComponentStore(ctx)
    },
  },
})

const tenantCtx = {
  tenantId: 'tenant-1',
  runQuery: async <TResult = unknown>() => undefined as TResult,
  runMutation: async <TResult = unknown>() => undefined as TResult,
} satisfies TenantConvexCtx

expectTypeOf(tenantProfile.store(tenantCtx)).toEqualTypeOf<CruxStore | Promise<CruxStore>>()

const tenantRunResult = tenantProfile.run(tenantCtx, { threadId: 'thread-1', attempt: 1 }, (scope) => {
  expectTypeOf(scope.ctx.tenantId).toEqualTypeOf<string>()
  expectTypeOf(scope.target?.threadId).toEqualTypeOf<string | undefined>()
  expectTypeOf(scope.target?.attempt).toEqualTypeOf<number | undefined>()
  expectTypeOf(scope.store).toEqualTypeOf<CruxStore>()
  return { ok: true as const }
})

expectTypeOf(tenantRunResult).toEqualTypeOf<Promise<{ ok: true }>>()

const runtimeBridge = createConvexRuntimeBridge<TenantConvexCtx>({
  component: { crux: true } as never,
})

const runtimeBridgeResult = runtimeBridge.run(tenantCtx, { threadId: 'thread-1', attempt: 1 }, (scope) => {
  expectTypeOf(scope.ctx.tenantId).toEqualTypeOf<string>()
  expectTypeOf(scope.target?.attempt).toEqualTypeOf<number | undefined>()
  expectTypeOf(scope.store).toEqualTypeOf<CruxStore>()
  return { runtime: true as const }
})

expectTypeOf(runtimeBridgeResult).toEqualTypeOf<Promise<{ runtime: true }>>()

type CruxAgentGenerateTextArgs = Parameters<Agent<TenantConvexCtx>['generateText']>
type ConvexAgentGenerateTextArgs = Parameters<ConvexAgentBase<TenantConvexCtx>['generateText']>
type CruxAgentStreamTextArgs = Parameters<Agent<TenantConvexCtx>['streamText']>
type ConvexAgentStreamTextArgs = Parameters<ConvexAgentBase<TenantConvexCtx>['streamText']>
type CruxAgentGenerateObjectArgs = Parameters<Agent<TenantConvexCtx>['generateObject']>
type ConvexAgentGenerateObjectArgs = Parameters<ConvexAgentBase<TenantConvexCtx>['generateObject']>
type CruxAgentStreamObjectArgs = Parameters<Agent<TenantConvexCtx>['streamObject']>
type ConvexAgentStreamObjectArgs = Parameters<ConvexAgentBase<TenantConvexCtx>['streamObject']>

expectTypeOf<CruxAgentGenerateTextArgs>().toEqualTypeOf<ConvexAgentGenerateTextArgs>()
expectTypeOf<CruxAgentStreamTextArgs>().toEqualTypeOf<ConvexAgentStreamTextArgs>()
expectTypeOf<CruxAgentGenerateObjectArgs>().toEqualTypeOf<ConvexAgentGenerateObjectArgs>()
expectTypeOf<CruxAgentStreamObjectArgs>().toEqualTypeOf<ConvexAgentStreamObjectArgs>()

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
