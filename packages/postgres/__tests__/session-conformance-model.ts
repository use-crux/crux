import { effect, prompt, type Message } from '@use-crux/core'
import { agent, type AgentExecutor } from '@use-crux/core/agent'
import {
  adapter,
  type AdapterResponse,
  type AdapterSpec,
  type StructuredOutputCapabilities,
} from '@use-crux/core/adapter'
import {
  defineGenerationModel,
  managedGenerationCheckpoint,
  managedGenerationStepBoundary,
} from '@use-crux/core/adapter-authoring'
import { vi } from 'vitest'
import { z } from 'zod'

const capabilities: StructuredOutputCapabilities = {
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
}

export function createConformanceProgramFixture(id: string) {
  const effectHandler = vi.fn(async () => 'effect-result')
  const recordEffect = effect(`session.conformance.${id}`, effectHandler)
  const tool = vi.fn(async () => {
    await recordEffect()
    return 'tool-result'
  })
  let activeMessage = ''
  const provider = vi.fn(async () => {
    const call = provider.mock.calls.length
    return call % 2 === 1
      ? response('Checking', [
          { id: `conformance-${call}`, name: 'check', args: {} },
        ])
      : response(JSON.stringify({ reply: `Echo: ${activeMessage}` }))
  })
  const runtime = adapter(conformanceSpec(provider))({})
  const execute = vi.fn<AgentExecutor>(async (target, options) => {
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
  })
  const model = defineGenerationModel({
    adapter: { id: 'test', version: '1' },
    native: Object.freeze({ id: 'session-conformance-model' }),
    definition: { id: `test:session-conformance:${id}`, fingerprint: 'v1' },
    identity: { kind: 'model', model: `session-conformance-${id}` },
    capabilities: {
      contract: 'crux.generation-capabilities.v1',
      language: [
        'text-input',
        'text-output',
        'structured-output',
        'tool-calls',
      ],
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
    tools: {
      check: {
        description: 'Exercise managed Tool and Effect recovery.',
        execute: tool,
      },
    },
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
      native: Object.freeze({ id: 'session-conformance-text-only' }),
      definition: {
        id: `test:session-conformance-text-only:${id}`,
        fingerprint: 'v1',
      },
      identity: { kind: 'model', model: `session-conformance-text-only-${id}` },
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
  return {
    primary,
    conflicting,
    unsupported,
    execute,
    provider,
    tool,
    effectHandler,
  }
}

function isConformanceInput(
  value: unknown,
): value is { readonly message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

function conformanceSpec(
  provider: () => Promise<AdapterResponse>,
): AdapterSpec<object, object, never> {
  return {
    providerId: 'session-conformance',
    structuredOutput: { accepts: capabilities },
    async call() {
      return { raw: {}, extracted: await provider() }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound(messages, assistantResponse, results) {
      const assistantMessage: Message = {
        role: 'assistant',
        content: assistantResponse.text,
        metadata: { toolCalls: assistantResponse.toolCalls },
      }
      const toolMessages: Message[] = results.map((result) => ({
        role: 'tool',
        content: result.content,
        metadata: {
          toolCallId: result.toolCallId,
          toolName: result.name,
        },
      }))
      return [...messages, assistantMessage, ...toolMessages]
    },
    mapSettings: (settings) => ({ ...settings }),
  }
}

function response(
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
