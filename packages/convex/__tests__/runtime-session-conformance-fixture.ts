import { config, createWorkHost, effect, getSession, prompt, session } from '@use-crux/core'
import { adapter, type AdapterResponse, type AdapterSpec } from '@use-crux/core/adapter'
import {
  defineGenerationModel,
  managedGenerationCheckpoint,
  managedGenerationStepBoundary,
} from '@use-crux/core/adapter-authoring'
import { agent, type AgentExecutor } from '@use-crux/core/agent'
import {
  createRuntimeProgram,
  createRuntimeWorker,
  createRuntimeError,
  inMemoryRuntimeStore,
  node,
  type RuntimeStoreAdapter,
} from '@use-crux/core/runtime'
import type { SessionConformanceHarness } from '@use-crux/core/runtime/testing'
import { convexTest } from 'convex-test'
import { makeFunctionReference, type FunctionReference } from 'convex/server'
import { vi } from 'vitest'
import { z } from 'zod'
import schema from '../src/component/schema'
import { convexRuntimeStore } from '../src/runtime'
import { convexRecordStore } from '../src/storage'
import type { ConvexCtxPort } from '../src/store'
import { runtimePublicWorkComponent, runtimePublicWorkModules } from './runtime-public-work-fixture'

const modules = {
  ...runtimePublicWorkModules,
  '../src/component/memory.ts': () => import('../src/component/memory'),
  '../src/component/runtime/session_execution.ts': () => import('../src/component/runtime/session_execution'),
  '../src/component/runtime/session_helpers.ts': () => import('../src/component/runtime/session_helpers'),
  '../src/component/runtime/session_identity.ts': () => import('../src/component/runtime/session_identity'),
  '../src/component/runtime/session_port.ts': () => import('../src/component/runtime/session_port'),
  '../src/component/runtime/session_subscriptions.ts': () =>
    import('../src/component/runtime/session_subscriptions'),
  '../src/component/runtime/session_checkpoint.ts': () =>
    import('../src/component/runtime/session_checkpoint'),
  '../src/component/runtime/sessions.ts': () => import('../src/component/runtime/sessions'),
} satisfies Record<string, () => Promise<unknown>>

/** Build one isolated real-component Convex Session conformance harness. */
export function createConvexSessionConformanceHarness(id: string): SessionConformanceHarness {
  const test = convexTest({ schema, modules })
  const baseComponent = runtimePublicWorkComponent()
  const component = {
    ...baseComponent,
    runtime: {
      ...baseComponent.runtime,
      sessions: { run: makeFunctionReference('runtime/sessions:run') },
    },
  }
  const namespace = `session-conformance-${id}`
  const counts = { executor: 0, provider: 0, tool: 0, effect: 0 }
  let activeMessage = ''
  const recordEffect = effect(`session.conformance.${id}`, async () => {
    counts.effect += 1
    return 'effect-result'
  })
  const tool = async () => {
    counts.tool += 1
    await recordEffect()
    return 'tool-result'
  }
  const provider = async () => {
    counts.provider += 1
    return counts.provider % 2 === 1
      ? adapterResponse('Checking', [{ id: `conformance-${counts.provider}`, name: 'check', args: {} }])
      : adapterResponse(JSON.stringify({ reply: `Echo: ${activeMessage}` }))
  }
  const runtime = adapter(conformanceSpec(provider))({})
  const execute: AgentExecutor = async (target, options) => {
    counts.executor += 1
    const input = options.input
    if (!isConformanceInput(input)) throw new Error('Invalid conformance input')
    if (input.message === 'private-failure') {
      throw new Error('Session conformance failure.')
    }
    activeMessage = input.message
    const result = await runtime.generate(target.prompt, {
      model: 'session-conformance-model',
      input,
      tools: { ...target.tools, ...options.tools },
      maxSteps: 2,
      prepareStep: () => ({ inputBudget: { max: 100_000 } }),
      [managedGenerationCheckpoint]: options[managedGenerationCheckpoint],
      [managedGenerationStepBoundary]: options[managedGenerationStepBoundary],
    })
    return {
      agentId: target.id,
      output: result.object ?? result.text,
      durationMs: 1,
      threadCommit: result.threadCommit,
    }
  }
  const model = defineGenerationModel({
    adapter: { id: 'test', version: '1' },
    native: Object.freeze({ id: 'session-conformance-model' }),
    definition: { id: `test:session-conformance:${id}`, fingerprint: 'v1' },
    identity: { kind: 'model', model: `session-conformance-${id}` },
    capabilities: {
      contract: 'crux.generation-capabilities.v1',
      language: ['text-input', 'text-output', 'structured-output', 'tool-calls'],
      embedding: [],
      image: [],
      speech: [],
      transcription: [],
    },
    runtime: { createAgentExecutor: () => execute },
  })
  const primary = agent({
    id: `session-conformance-primary-${id}`,
    model,
    prompt: prompt({
      input: z.object({ message: z.string() }),
      output: z.object({ reply: z.string() }),
      prompt: ({ input }) => input.message,
    }),
    tools: { check: { description: 'Exercise recovery.', execute: tool } },
    prepareStep: () => ({ inputBudget: { max: 100_000 } }),
  })
  const conflicting = agent({
    id: `session-conformance-conflict-${id}`,
    model,
    prompt: primary.prompt,
  })
  const unsupported = agent({
    id: `session-conformance-unsupported-${id}`,
    model: defineGenerationModel({
      adapter: { id: 'test', version: '1' },
      native: Object.freeze({ id: 'text-only' }),
      definition: { id: `test:text-only:${id}`, fingerprint: 'v1' },
      identity: { kind: 'model', model: `text-only-${id}` },
      capabilities: {
        contract: 'crux.generation-capabilities.v1',
        language: ['text-input', 'text-output'],
        embedding: [],
        image: [],
        speech: [],
        transcription: [],
      },
      runtime: { createAgentExecutor: () => execute },
    }),
    prompt: primary.prompt,
  })
  const program = createRuntimeProgram({
    targets: [primary, conflicting, unsupported],
    transports: [],
  })
  const records = convexRecordStore({
    component: memoryComponent(),
    ctx: ctx(test),
  })
  let armedFault: 'after-checkpoint' | 'after-thread-publication' | undefined
  const createStore = (): RuntimeStoreAdapter => {
    const base = convexRuntimeStore({ ctx: ctx(test), component })
    const sessions = base.sessions
    if (!sessions) throw new Error('Expected Convex Session storage.')
    const store = {
      ...base,
      sessions: {
        ...sessions,
        checkpointPreparedExecution: async (input: Parameters<typeof sessions.checkpointPreparedExecution>[0]) => {
          const result = await sessions.checkpointPreparedExecution(input)
          if (armedFault === 'after-checkpoint') {
            armedFault = undefined
            throw faultError(input.workId, 'prepared execution checkpoint')
          }
          return result
        },
      },
    }
    Object.defineProperty(store, postPublicationSeam(), {
      value: async ({ workId }: { readonly workId: string }) => {
        if (armedFault === 'after-thread-publication') {
          armedFault = undefined
          throw faultError(workId, 'owner-Thread publication')
        }
      },
    })
    return Object.freeze(store)
  }
  const createHost = () => {
    config({ storage: { records } })
    return createWorkHost({
      runtime: node({
        store: createStore(),
        namespace,
        autoStartMaintenance: false,
      }),
      program,
    })
  }
  let host = createHost()

  return {
    create: (key) => host.run(() => session(primary, { key })),
    get: (key) => host.run(() => getSession(primary, key)),
    createConflict: (key) => host.run(() => session(conflicting, { key })),
    createCapabilityFailure: (key) => host.run(() => Reflect.apply(session, undefined, [unsupported, { key }])),
    ownerIds: async (threadId) => {
      const control = await records.get(`thread/${threadId}`)
      const owners = control?.owners
      return owners && typeof owners === 'object' && !Array.isArray(owners) ? Object.keys(owners) : []
    },
    startWorker: () =>
      createRuntimeWorker({
        runtime: node({
          store: createStore(),
          namespace,
          autoStartMaintenance: false,
        }),
        program,
        pollIntervalMs: 1,
      }),
    armFault: (boundary) => {
      armedFault = boundary
    },
    reconnect: () => {
      host.dispose()
      host = createHost()
    },
    receiptCount: async (threadId) =>
      (await records.list(`thread/${threadId}/receipt/`, { limit: 100 })).entries.length,
    makeTerminalFailure: async () => {
      const store = createStore()
      const pending = await store.state.listWork({
        namespace,
        status: 'pending',
      })
      const [work] = pending
      if (!work || pending.length !== 1) throw new Error('Expected one pending Session Work.')
      await store.state.putWork(Object.freeze({ ...work, maxAttempts: 1 }))
    },
    sessionCount: async () =>
      await test.run(async (context) => (await context.db.query('runtimeSessions').collect()).length),
    executionCounts: () => ({ ...counts }),
    dispose: () => host.dispose(),
  }
}

function postPublicationSeam(): symbol {
  const symbol = Object.getOwnPropertySymbols(inMemoryRuntimeStore()).find(
    (candidate) => candidate.description === 'crux.session.post-publication-seam',
  )
  if (!symbol) throw new Error('Expected the Core Session post-publication seam.')
  return symbol
}

function faultError(workId: string, boundary: string) {
  return createRuntimeError({
    code: 'LEASE_LOST',
    whatFailed: `Runtime work \`${workId}\` stopped after its ${boundary}.`,
    why: 'The Convex conformance harness injected deterministic host loss.',
    whatStillWorks: 'Committed durable Session facts remain recoverable by another worker.',
    nextStep: 'Retry through the Runtime worker.',
  })
}

function ctx(test: ReturnType<typeof convexTest>): ConvexCtxPort {
  return {
    runQuery: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      await test.query(ref as FunctionReference<'query', 'public', Record<string, unknown>, TResult>, args),
    runMutation: async <TResult>(ref: unknown, args: Record<string, unknown>) =>
      await test.mutation(ref as FunctionReference<'mutation', 'public', Record<string, unknown>, TResult>, args),
  }
}

function memoryComponent() {
  return {
    memory: {
      get: makeFunctionReference('memory:get'),
      list: makeFunctionReference('memory:list'),
      set: makeFunctionReference('memory:set'),
      insert: makeFunctionReference('memory:insert'),
      remove: makeFunctionReference('memory:remove'),
      compareAndSet: makeFunctionReference('memory:compareAndSet'),
    },
  }
}

function isConformanceInput(value: unknown): value is { readonly message: string } {
  return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
}

function conformanceSpec(provider: () => Promise<AdapterResponse>): AdapterSpec<object, object, never> {
  return {
    providerId: 'session-conformance',
    structuredOutput: {
      accepts: {
        id: 'test.permissive',
        supportsJsonSchema: true,
        requiresAllProperties: false,
        supportsOptionalProperties: true,
        supportsNullable: true,
        supportsBooleanSchemas: true,
        supportsReferences: true,
        supportsUnions: true,
        supportsRecursiveSchemas: true,
        additionalProperties: 'supported',
        unsupportedKeywords: [],
      },
    },
    async call() {
      return { raw: {}, extracted: await provider() }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound(messages, assistant, results) {
      return [
        ...messages,
        {
          role: 'assistant',
          content: assistant.text,
          metadata: { toolCalls: assistant.toolCalls },
        },
        ...results.map((result) => ({
          role: 'tool' as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ]
    },
    mapSettings: (settings) => ({ ...settings }),
  }
}

function adapterResponse(
  text: string,
  toolCalls?: Array<{ id: string; name: string; args: unknown }>,
): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: undefined,
    finishReason: 'stop',
    responseId: undefined,
    actualModelId: undefined,
  }
}
