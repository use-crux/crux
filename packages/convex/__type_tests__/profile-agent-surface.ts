import type { LanguageModelV3 } from '@ai-sdk/provider'
import type { RecordStore, Storage } from '@use-crux/core/storage'
import { expectTypeOf } from 'vitest'
import { z } from 'zod'
import { createCruxConvex, prompt } from '../src'
import {
  convexAgent,
  type ConvexAgentDriver,
  type ConvexGenerateObjectResult,
  type ConvexThreadStreamObjectResult,
} from '../src/agent'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'

const model = {} as LanguageModelV3

const editPrompt = prompt({
  id: 'surface-edit',
  input: z.object({
    instruction: z.string(),
    projectId: z.string(),
  }),
  prompt: ({ input }) => input.instruction,
})

const metadataPrompt = prompt({
  id: 'surface-metadata',
  input: z.object({
    instruction: z.string(),
    projectId: z.string(),
  }),
  output: z.object({
    title: z.string(),
  }),
  prompt: ({ input }) => input.instruction,
})

convexAgent({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
  name: 'Namespaced Editor',
  prompt: editPrompt,
  languageModel: model,
  crux: {
    runtime: {
      storage: () => ({}) as RecordStore,
      namespace: ({ input }) => {
        expectTypeOf(input).toEqualTypeOf<Record<string, unknown>>()
        return 'tenant:test'
      },
    },
    prepare: ({ input }) => {
      expectTypeOf(input.instruction).toEqualTypeOf<string>()
      return { input }
    },
    observe: {
      name: ({ agentName, operation, target }) => {
        expectTypeOf(agentName).toEqualTypeOf<string>()
        expectTypeOf(operation).toEqualTypeOf<
          'resolve' | 'generateText' | 'streamText' | 'generateObject' | 'streamObject'
        >()
        expectTypeOf(target.threadId).toEqualTypeOf<string | undefined>()
        return `${agentName}:${operation}`
      },
      attributes: ({ promptId }) => ({
        promptId,
      }),
    },
    persistence: {
      skills: false,
      memory: false,
    },
  },
})

const crux = createCruxConvex({
  components: {
    crux: { crux: true } as never,
    agent: { agent: true } as never,
  },
})

const metadataAgent = crux.convexAgent({
  name: 'Metadata Editor',
  prompt: metadataPrompt,
  model,
})

const generatedObjectResult = metadataAgent.generateObject(
  {},
  { threadId: 'thread-1', userId: 'user-1' },
  {
    input: {
      instruction: 'Title this.',
      projectId: 'project-1',
    },
    temperature: 0.2,
  },
)
expectTypeOf(generatedObjectResult).toEqualTypeOf<ConvexGenerateObjectResult>()

metadataAgent.continueThread({}, { threadId: 'thread-1', userId: 'user-1' }).then(({ thread }) => {
  const streamedObjectResult = thread.streamObject({
    input: {
      instruction: 'Title this.',
      projectId: 'project-1',
    },
  })
  expectTypeOf(streamedObjectResult).toEqualTypeOf<ConvexThreadStreamObjectResult>()

  // @ts-expect-error thread object turns require Crux prompt input.
  thread.generateObject({
    temperature: 0.2,
  })
})

createProfileBackedAgentLifecycle({
  components: {
    agent: { agent: true },
  },
  driver: {} as ConvexAgentDriver,
  prompt: editPrompt,
  languageModel: model,
  storage: () => ({}) as RecordStore,
})

createProfileBackedAgentLifecycle({
  components: {
    agent: { agent: true },
  },
  driver: {} as ConvexAgentDriver,
  prompt: editPrompt,
  languageModel: model,
  storage: () => ({ records: {} as RecordStore }) as Storage,
})

// @ts-expect-error components.crux is required when no custom store is supplied.
createProfileBackedAgentLifecycle({
  components: {
    agent: { agent: true },
  },
  driver: {} as ConvexAgentDriver,
  prompt: editPrompt,
  languageModel: model,
})
