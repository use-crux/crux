/**
 * Tests for `makeAdapter()` — the provider adapter factory.
 *
 * Uses a FAKE adapter spec (no real SDK) to verify the shared
 * infrastructure: factory shape, tool loops, settings mapping,
 * schema sanitization, and composition methods.
 */

import { describe, it, expect, vi } from 'vitest'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import type { AdapterSpec } from '../../adapter/spec'
import type { AdapterResponse, CallArgs, StreamHandle, ToolResultEntry } from '../../adapter/types'
import type { Message } from '../../generation/messages'
import type { GenerationSettings, TraceMeta } from '../../types'
import { prompt as makePrompt } from '../../prompt/prompt'
import { z } from 'zod'
import { ValidationExhaustedError } from '../../generation/validation-retry'
import {
  approvalMiddleware,
  appendToolApprovalResponse,
  findToolApprovalRequests,
  toolMiddleware,
} from '../../tool-middleware'

// ─────────────────────────────────────────────────────────────────
// Mock Types
// ─────────────────────────────────────────────────────────────────

interface MockClient {
  apiKey: string
}

interface MockResponse {
  id: string
  content: string
}

interface MockStream {
  [Symbol.asyncIterator]: () => AsyncIterator<{ text: string }>
}

// ─────────────────────────────────────────────────────────────────
// Mock Helpers
// ─────────────────────────────────────────────────────────────────

function createMockResponse(text: string, toolCalls?: AdapterResponse['toolCalls']): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    finishReason: toolCalls ? 'tool_calls' : 'stop',
    responseId: 'resp_123',
    actualModelId: 'test-model',
  }
}

function createMockSpec(
  overrides?: Partial<AdapterSpec<MockClient, MockResponse, MockStream>>,
): AdapterSpec<MockClient, MockResponse, MockStream> {
  return {
    providerId: 'test',

    async call(_client, _args) {
      return {
        raw: { id: 'raw_123', content: 'hello' },
        extracted: createMockResponse('hello'),
      }
    },

    async stream(_client, _args) {
      const chunks = [{ text: 'hel' }, { text: 'lo' }]
      let idx = 0
      const rawStream = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (idx < chunks.length) {
                return { value: chunks[idx++], done: false }
              }
              return { value: undefined, done: true }
            },
          }
        },
      } as MockStream & AsyncIterable<unknown>

      return {
        rawStream,
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({
          usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
          finishReason: 'stop',
        }),
      }
    },

    appendToolRound(messages, assistantResponse, toolResults) {
      return [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        ...toolResults.map((tr) => ({
          role: 'tool' as const,
          content: tr.content,
          metadata: { toolCallId: tr.toolCallId, toolName: tr.name },
        })),
      ]
    },

    mapSettings(settings) {
      const mapped: Record<string, unknown> = {}
      if (settings.temperature !== undefined) mapped.temperature = settings.temperature
      if (settings.maxTokens !== undefined) mapped.max_tokens = settings.maxTokens
      return mapped
    },

    ...overrides,
  }
}

function createTestPrompt(opts?: { tools?: Record<string, unknown>; settings?: GenerationSettings }) {
  return makePrompt({
    id: 'test-prompt',
    system: 'You are a test assistant.',
    prompt: ({ input }) => (input as any).instruction,
    input: z.object({ instruction: z.string() }),
    settings: opts?.settings,
    tools: opts?.tools,
  })
}

// ─────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────

describe('adapter', () => {
  const mockClient: MockClient = { apiKey: 'test-key' }

  it('returns a factory function', () => {
    const factory = makeAdapter(createMockSpec())
    expect(typeof factory).toBe('function')
  })

  it('factory returns an adapter with expected methods', () => {
    const factory = makeAdapter(createMockSpec())
    const adapter = factory(mockClient)

    expect(adapter.providerId).toBe('test')
    expect(typeof adapter.generate).toBe('function')
    expect(typeof adapter.stream).toBe('function')
    expect(typeof adapter.parallel).toBe('function')
    expect(typeof adapter.pipeline).toBe('function')
    expect(typeof adapter.consensus).toBe('function')
    expect(typeof adapter.swarm).toBe('function')
  })

  it('adapter is frozen (immutable)', () => {
    const factory = makeAdapter(createMockSpec())
    const adapter = factory(mockClient)

    expect(Object.isFrozen(adapter)).toBe(true)
  })

  describe('generate()', () => {
    it('resolves prompt and calls spec.call()', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw_123', content: 'hello' },
        extracted: createMockResponse('hello'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      const result = await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'Say hello' },
      })

      expect(callSpy).toHaveBeenCalledOnce()
      expect(result.text).toBe('hello')
      expect(result.raw).toEqual({ id: 'raw_123', content: 'hello' })
    })

    it('returns raw response with _meta', async () => {
      const spec = createMockSpec()
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      const result = await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'Say hello' },
      })

      expect(result._meta).toBeDefined()
      expect(result._meta.usage).toEqual({
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      })
      expect(result._meta.finishReason).toBe('stop')
      expect(result._meta.responseId).toBe('resp_123')
      expect(result._meta.actualModelId).toBe('test-model')
    })

    it('returns steps count of 1 when no tool calls', async () => {
      const spec = createMockSpec()
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      const result = await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'Say hello' },
      })

      expect(result.steps).toBe(1)
    })

    it('passes model to call args', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      await adapter.generate(prompt, {
        model: 'gpt-4o-mini',
        input: { instruction: 'test' },
      })

      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.model).toBe('gpt-4o-mini')
    })

    it('passes system message from prompt', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'test' },
      })

      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.system).toBe('You are a test assistant.')
    })
  })

  describe('tool loop', () => {
    it('executes tools and loops until no more tool calls', async () => {
      let callCount = 0
      const callSpy = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // First call: return tool call
          return {
            raw: { id: 'raw_1', content: '' },
            extracted: createMockResponse('', [{ id: 'tc_1', name: 'get_weather', args: { city: 'Paris' } }]),
          }
        }
        // Second call: no tool calls
        return {
          raw: { id: 'raw_2', content: 'The weather in Paris is sunny.' },
          extracted: createMockResponse('The weather in Paris is sunny.'),
        }
      })

      const appendSpy = vi
        .fn()
        .mockImplementation((messages: Message[], resp: AdapterResponse, results: ToolResultEntry[]) => [
          ...messages,
          {
            role: 'assistant' as const,
            content: resp.text,
            metadata: { toolCalls: resp.toolCalls },
          },
          ...results.map((tr) => ({
            role: 'tool' as const,
            content: tr.content,
            metadata: { toolCallId: tr.toolCallId },
          })),
        ])

      const spec = createMockSpec({ call: callSpy, appendToolRound: appendSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'tool-prompt',
        system: 'You are a weather assistant.',
        prompt: ({ input }) => (input as any).query,
        input: z.object({ query: z.string() }),
        tools: {
          get_weather: {
            description: 'Get weather for a city',
            parameters: z.object({ city: z.string() }),
            execute: async (args: any) => ({ temperature: 22, condition: 'sunny' }),
          },
        },
      })

      const result = await adapter.generate(prompt, {
        model: 'test-model',
        input: { query: 'What is the weather in Paris?' },
      })

      expect(callSpy).toHaveBeenCalledTimes(2)
      expect(appendSpy).toHaveBeenCalledOnce()
      expect(result.text).toBe('The weather in Paris is sunny.')
      expect(result.steps).toBe(2)
    })

    it('applies prompt and call-site tool middleware before executing native adapter tools', async () => {
      const events: string[] = []
      const callSpy = vi
        .fn()
        .mockResolvedValueOnce({
          raw: { id: 'tool-call' },
          extracted: createMockResponse('', [{ id: 'tc_1', name: 'send_email', args: { subject: 'Hello' } }]),
        })
        .mockResolvedValueOnce({
          raw: { id: 'final' },
          extracted: createMockResponse('Sent.'),
        })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = makePrompt({
        system: 'Send email.',
        prompt: 'Send it.',
        tools: {
          send_email: {
            description: 'Send email',
            parameters: z.object({ subject: z.string() }),
            execute: async () => {
              events.push('execute')
              return 'sent'
            },
          },
        },
        toolMiddleware: toolMiddleware({
          id: 'prompt-audit',
          match: ['send_email'],
          beforeExecute: () => {
            events.push('prompt-before')
          },
        }),
      })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: {},
        toolMiddleware: toolMiddleware({
          id: 'call-audit',
          match: ['send_email'],
          afterExecute: () => {
            events.push('call-after')
          },
        }),
      })

      expect(events).toEqual(['prompt-before', 'execute', 'call-after'])
    })

    it('pauses native adapter tool calls for approval and resumes after approval response', async () => {
      const events: string[] = []
      const callSpy = vi
        .fn()
        .mockResolvedValueOnce({
          raw: { id: 'tool-call' },
          extracted: createMockResponse('', [{ id: 'tc_1', name: 'send_email', args: { subject: 'Hello' } }]),
        })
        .mockResolvedValueOnce({
          raw: { id: 'final' },
          extracted: createMockResponse('Sent.'),
        })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = makePrompt({
        system: 'Send email.',
        prompt: 'Send it.',
        tools: {
          send_email: {
            description: 'Send email',
            parameters: z.object({ subject: z.string() }),
            execute: async () => {
              events.push('execute')
              return 'sent'
            },
          },
        },
        toolMiddleware: approvalMiddleware({
          id: 'email-approval',
          match: ['send_email'],
          onApproved: () => {
            events.push('approved')
          },
        }),
      })

      const first = await adapter.generate(prompt, {
        model: 'test-model',
        input: {},
      })

      const requests = findToolApprovalRequests(first.messages)
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        approvalId: 'approval_tc_1',
        toolCallId: 'tc_1',
        toolName: 'send_email',
        input: { subject: 'Hello' },
      })
      expect(requests[0].approvalToken).toEqual(expect.any(String))
      expect(events).toEqual([])
      expect(callSpy).toHaveBeenCalledOnce()

      const final = await adapter.generate(prompt, {
        model: 'test-model',
        input: {},
        messages: appendToolApprovalResponse(first.messages, {
          approvalId: requests[0].approvalId,
          approved: true,
          approvalToken: requests[0].approvalToken,
        }) as Message[],
      })

      expect(final.text).toBe('Sent.')
      expect(events).toEqual(['approved', 'execute'])
      expect(callSpy).toHaveBeenCalledTimes(2)
    })

    it('maxSteps limits tool loop iterations', async () => {
      // Always return tool calls -- should be limited by maxSteps
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('', [{ id: 'tc_1', name: 'my_tool', args: {} }]),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'loop-prompt',
        system: 'Test.',
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        tools: {
          my_tool: {
            description: 'A test tool',
            parameters: z.object({}),
            execute: async () => 'result',
          },
        },
      })

      const result = await adapter.generate(prompt, {
        model: 'test-model',
        input: { text: 'test' },
        maxSteps: 3,
      })

      expect(callSpy).toHaveBeenCalledTimes(3)
      expect(result.steps).toBe(3)
    })
  })

  describe('settings mapping', () => {
    it('calls mapSettings with generation settings', async () => {
      const mapSettingsSpy = vi.fn().mockReturnValue({ temperature: 0.5 })

      const spec = createMockSpec({ mapSettings: mapSettingsSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt({ settings: { temperature: 0.5 } })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'test' },
      })

      expect(mapSettingsSpy).toHaveBeenCalledOnce()
      // mapSettings receives the merged settings from prompt resolution
      const passedSettings = mapSettingsSpy.mock.calls[0][0]
      expect(passedSettings.temperature).toBe(0.5)
    })

    it('mapped settings are passed in call args', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({
        call: callSpy,
        mapSettings: (s) => ({ temp: s.temperature, max_tok: s.maxTokens }),
      })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt({ settings: { temperature: 0.7, maxTokens: 100 } })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'test' },
      })

      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.settings).toEqual({ temp: 0.7, max_tok: 100 })
    })
  })

  describe('sanitizeToolSchema', () => {
    it('is called when provided', async () => {
      const sanitizeSpy = vi.fn().mockImplementation((schema: Record<string, unknown>) => {
        // Remove 'maxItems' like Anthropic adapter would
        const { maxItems, ...rest } = schema
        return rest
      })

      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({
        call: callSpy,
        sanitizeToolSchema: sanitizeSpy,
      })
      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'schema-prompt',
        system: 'Test.',
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        tools: {
          my_tool: {
            description: 'A tool',
            parameters: z.object({ items: z.array(z.string()) }),
            execute: async () => 'done',
          },
        },
      })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { text: 'test' },
      })

      // sanitizeToolSchema should have been called for the tool
      expect(sanitizeSpy).toHaveBeenCalled()
    })

    it('is not called when not provided', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ call: callSpy })
      // spec has no sanitizeToolSchema
      delete (spec as any).sanitizeToolSchema

      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'no-sanitize-prompt',
        system: 'Test.',
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        tools: {
          my_tool: {
            description: 'A tool',
            parameters: z.object({ name: z.string() }),
            execute: async () => 'done',
          },
        },
      })

      // Should not throw
      await adapter.generate(prompt, {
        model: 'test-model',
        input: { text: 'test' },
      })

      expect(callSpy).toHaveBeenCalled()
    })
  })

  describe('stream()', () => {
    it('resolves prompt and calls spec.stream()', async () => {
      const streamSpy = vi.fn().mockResolvedValue({
        rawStream: {
          [Symbol.asyncIterator]() {
            let done = false
            return {
              async next() {
                if (!done) {
                  done = true
                  return { value: { text: 'hello' }, done: false }
                }
                return { value: undefined, done: true }
              },
            }
          },
        },
        extractTextDelta: (chunk: unknown) => (chunk as { text: string }).text,
        completion: async () => ({ usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 } }),
      })

      const spec = createMockSpec({ stream: streamSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      const handle = await adapter.stream(prompt, {
        model: 'test-model',
        input: { instruction: 'Say hello' },
      })

      expect(streamSpy).toHaveBeenCalledOnce()
      expect(handle.rawStream).toBeDefined()
      expect(typeof handle.extractTextDelta).toBe('function')
      expect(typeof handle.completion).toBe('function')
    })

    it('can iterate over the stream', async () => {
      const spec = createMockSpec()
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      const handle = await adapter.stream(prompt, {
        model: 'test-model',
        input: { instruction: 'test' },
      })

      const chunks: string[] = []
      for await (const chunk of handle.rawStream) {
        const delta = handle.extractTextDelta(chunk)
        if (delta) chunks.push(delta)
      }

      expect(chunks).toEqual(['hel', 'lo'])
    })
  })

  describe('provider defaults', () => {
    it('uses spec.providerId as default provider in resolve', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ providerId: 'my-provider', call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'adapt-prompt',
        system: 'Base system.',
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        adapt: {
          'my-provider': { appendSystem: '\nCustom suffix.' },
        },
      })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { text: 'test' },
      })

      // The system should include the adaptation because provider matched
      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.system).toContain('Custom suffix.')
    })

    it('allows overriding provider at call-site', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ providerId: 'default-provider', call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const prompt = makePrompt({
        id: 'override-prompt',
        system: 'Base.',
        prompt: ({ input }) => (input as any).text,
        input: z.object({ text: z.string() }),
        adapt: {
          'custom-provider': { appendSystem: '\nCustom.' },
        },
      })

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { text: 'test' },
        provider: 'custom-provider',
      })

      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.system).toContain('Custom.')
    })
  })

  describe('validation retry', () => {
    const outputSchema = z.object({ name: z.string(), age: z.number() })

    function createSchemaPrompt() {
      return makePrompt({
        id: 'schema-prompt',
        system: 'Return JSON matching the schema.',
        prompt: ({ input }) => (input as any).instruction,
        input: z.object({ instruction: z.string() }),
        output: outputSchema,
      })
    }

    it('passes through valid structured output without retry', async () => {
      const validJson = '{"name":"Alice","age":30}'
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: validJson },
        extracted: createMockResponse(validJson),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const result = await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
        validationRetry: { maxRetries: 3 },
      })

      expect(callSpy).toHaveBeenCalledOnce()
      expect(result.text).toBe(validJson)
    })

    it('retries with feedback when output fails schema validation', async () => {
      let callCount = 0
      const callSpy = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          // First: invalid output (age is a string, not number)
          return {
            raw: { id: 'raw_1', content: '' },
            extracted: createMockResponse('{"name":"Alice","age":"thirty"}'),
          }
        }
        // Second: valid output
        return {
          raw: { id: 'raw_2', content: '' },
          extracted: createMockResponse('{"name":"Alice","age":30}'),
        }
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const result = await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
        validationRetry: { maxRetries: 3 },
      })

      expect(callSpy).toHaveBeenCalledTimes(2)
      expect(result.text).toBe('{"name":"Alice","age":30}')
    })

    it('throws ValidationExhaustedError when all retries fail', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('{"name":"Alice","age":"bad"}'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      await expect(
        adapter.generate(createSchemaPrompt(), {
          model: 'test-model',
          input: { instruction: 'give me a person' },
          maxSteps: 10,
          validationRetry: { maxRetries: 2 },
        }),
      ).rejects.toThrow(ValidationExhaustedError)

      // 1 initial + 2 retries = 3 calls
      expect(callSpy).toHaveBeenCalledTimes(3)
    })

    it('validation retries count against maxSteps budget', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('{"name":"Alice","age":"bad"}'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      await expect(
        adapter.generate(createSchemaPrompt(), {
          model: 'test-model',
          input: { instruction: 'give me a person' },
          maxSteps: 2,
          validationRetry: { maxRetries: 5 },
        }),
      ).rejects.toThrow(ValidationExhaustedError)

      // maxSteps=2 limits total calls even though maxRetries=5
      expect(callSpy).toHaveBeenCalledTimes(2)
    })

    it('calls onRetry hook on each validation retry', async () => {
      let callCount = 0
      const callSpy = vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount <= 2) {
          return {
            raw: { id: `raw_${callCount}`, content: '' },
            extracted: createMockResponse('{"name":"Alice","age":"bad"}'),
          }
        }
        return {
          raw: { id: 'raw_3', content: '' },
          extracted: createMockResponse('{"name":"Alice","age":30}'),
        }
      })

      const onRetry = vi.fn()
      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
        validationRetry: { maxRetries: 3, onRetry },
      })

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry.mock.calls[0]![0]).toBe(1) // attempt 1
      expect(onRetry.mock.calls[1]![0]).toBe(2) // attempt 2
      // Second arg should be a ZodError
      expect(onRetry.mock.calls[0]![1]).toBeDefined()
    })

    it('calls onExhausted hook when retries are used up', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('{"invalid": true}'),
      })

      const onExhausted = vi.fn()
      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      await expect(
        adapter.generate(createSchemaPrompt(), {
          model: 'test-model',
          input: { instruction: 'give me a person' },
          validationRetry: { maxRetries: 2, onExhausted },
        }),
      ).rejects.toThrow(ValidationExhaustedError)

      expect(onExhausted).toHaveBeenCalledOnce()
      expect(onExhausted.mock.calls[0]![0]).toBe(2) // attempts
    })

    it('does not retry when validationRetry is not configured', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('{"name":"Alice","age":"bad"}'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      // No validationRetry — should return invalid output without retry
      const result = await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
      })

      expect(callSpy).toHaveBeenCalledOnce()
      expect(result.text).toBe('{"name":"Alice","age":"bad"}')
    })

    it('uses repairJsonText before LLM retry', async () => {
      // Output wrapped in markdown fences — repairJsonText should fix it
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: '' },
        extracted: createMockResponse('```json\n{"name":"Alice","age":30}\n```'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      const result = await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
        validationRetry: { maxRetries: 3 },
      })

      // Text repair should fix it without needing a second LLM call
      expect(callSpy).toHaveBeenCalledOnce()
      expect(result.text).toBe('{"name":"Alice","age":30}')
    })

    it('injects corrective message with failed output and errors', async () => {
      let callCount = 0
      const callSpy = vi.fn().mockImplementation(async (_client: unknown, args: CallArgs) => {
        callCount++
        if (callCount === 1) {
          return {
            raw: { id: 'raw_1', content: '' },
            extracted: createMockResponse('{"name":"Alice","age":"thirty"}'),
          }
        }
        // Second call: verify corrective messages were injected
        const lastUserMsg = args.messages.filter((m) => m.role === 'user').pop()
        expect(lastUserMsg?.content).toContain('Validation failed')
        expect(lastUserMsg?.content).toContain('{"name":"Alice","age":"thirty"}')

        return {
          raw: { id: 'raw_2', content: '' },
          extracted: createMockResponse('{"name":"Alice","age":30}'),
        }
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)

      await adapter.generate(createSchemaPrompt(), {
        model: 'test-model',
        input: { instruction: 'give me a person' },
        validationRetry: { maxRetries: 3 },
      })

      expect(callSpy).toHaveBeenCalledTimes(2)
    })
  })

  describe('extra options', () => {
    it('passes extra to call args', async () => {
      const callSpy = vi.fn().mockResolvedValue({
        raw: { id: 'raw', content: 'ok' },
        extracted: createMockResponse('ok'),
      })

      const spec = createMockSpec({ call: callSpy })
      const adapter = makeAdapter(spec)(mockClient)
      const prompt = createTestPrompt()

      await adapter.generate(prompt, {
        model: 'test-model',
        input: { instruction: 'test' },
        extra: { tool_choice: 'auto' } as any,
      })

      const callArgs = callSpy.mock.calls[0][1] as CallArgs
      expect(callArgs.extra).toEqual({ tool_choice: 'auto' })
    })
  })
})
