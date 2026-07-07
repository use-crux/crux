import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../adapter/define-adapter'
import type { AdapterResponse } from '../../adapter/types'
import { prompt } from '../../prompt/prompt'
import type { Message } from '../../generation/messages'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../observability'
import { resetHooks, updateHooks } from '../../runtime/runtime'
import { appendToolApprovalResponse } from '../../tools/approvals'
import type { ToolModelOutput } from '../../types/tool'

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

function response(text: string, toolCalls?: AdapterResponse['toolCalls']): AdapterResponse {
  return {
    text,
    toolCalls,
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 },
    finishReason: toolCalls ? 'tool_calls' : 'stop',
    responseId: 'resp_1',
    actualModelId: 'mock-model',
  }
}

function testPrompt(tools: Record<string, unknown>) {
  return prompt({
    id: 'tool-observability',
    system: 'Use tools when needed.',
    prompt: ({ input }) => (input as { instruction: string }).instruction,
    input: z.object({ instruction: z.string() }),
    tools,
  })
}

function testAdapter(responses: AdapterResponse[]) {
  let calls = 0
  return makeAdapter<MockClient, MockResponse, MockStream>({
    providerId: 'mock',
    async call() {
      const extracted = responses[Math.min(calls, responses.length - 1)]
      calls++
      return { raw: { id: `raw_${calls}`, content: extracted.text }, extracted }
    },
    async stream() {
      throw new Error('not used')
    },
    appendToolRound(messages: Message[], assistantResponse: AdapterResponse, toolResults) {
      return [
        ...messages,
        {
          role: 'assistant' as const,
          content: assistantResponse.text,
          metadata: { toolCalls: assistantResponse.toolCalls },
        },
        ...toolResults.map((result) => ({
          role: 'tool' as const,
          content: result.content,
          metadata: { toolCallId: result.toolCallId, toolName: result.name },
        })),
      ]
    },
    mapSettings(settings) {
      return settings
    },
  })({ apiKey: 'test' })
}

describe('canonical tool observability', () => {
  afterEach(() => {
    resetObservabilityRuntime()
    resetHooks()
  })

    it('records tool calls with args, raw result, model output, and relation edges', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const execute = vi.fn(async ({ query }: { query: string }) => ({ rows: [`result:${query}`], internalId: 42 }))
    const toModelOutput = vi.fn(
      async ({ output }: { output: { rows: string[] } }): Promise<ToolModelOutput> => ({
        type: 'json',
        value: { rows: output.rows },
      }),
    )
    const model = testAdapter([
      response('', [{ id: 'call_search', name: 'search', args: { query: 'refund' } }]),
      response('done'),
    ])

    await model.generate(
      testPrompt({
        search: {
          description: 'Search docs',
          parameters: z.object({ query: z.string() }),
          execute,
          toModelOutput,
        },
      }),
      {
        model: 'mock-model',
        input: { instruction: 'Find refund policy' },
      },
    )
    await observe.flush()

    const starts = transport.records.filter((record) => record.type === 'span:start')
    expect(starts).toContainEqual(
      expect.objectContaining({
        primitive: 'tool.call',
        name: 'search',
        attributes: expect.objectContaining({ toolCallId: 'call_search', toolName: 'search' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.request',
        attributes: expect.objectContaining({ toolCallId: 'call_search', toolName: 'search' }),
        preview: expect.objectContaining({
          toolCallId: 'call_search',
          toolName: 'search',
          args: { query: 'refund' },
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.args',
        attributes: expect.objectContaining({ toolCallId: 'call_search', toolName: 'search' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ resultKind: 'raw', outputSize: expect.any(Number) }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({ resultKind: 'model', modelOutputType: 'json' }),
      }),
    )
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'consumed' }))
    expect(transport.records).toContainEqual(expect.objectContaining({ type: 'edge', edgeType: 'produced' }))
  })

    it('omits tool input and output previews when capture policy disables them', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    updateHooks({
      observabilityCapture: {
        recordInputs: false,
        recordOutputs: false,
      },
    })
    const model = testAdapter([
      response('', [{ id: 'call_search', name: 'search', args: { query: 'refund' } }]),
      response('done'),
    ])

    await model.generate(
      testPrompt({
        search: {
          description: 'Search docs',
          parameters: z.object({ query: z.string() }),
          execute: async ({ query }: { query: string }) => ({ rows: [`result:${query}`], internalId: 42 }),
        },
      }),
      {
        model: 'mock-model',
        input: { instruction: 'Find refund policy' },
      },
    )
    await observe.flush()

    const requestArtifact = transport.records.find(
      (record) => record.type === 'artifact' && record.kind === 'tool.request',
    )
    const argsArtifact = transport.records.find((record) => record.type === 'artifact' && record.kind === 'tool.args')
    const resultArtifacts = transport.records.filter(
      (record) => record.type === 'artifact' && record.kind === 'tool.result',
    )

    expect(requestArtifact).toMatchObject({ encoding: 'reference', sizeBytes: expect.any(Number), hash: expect.any(String) })
    expect(requestArtifact).not.toHaveProperty('preview')
    expect(argsArtifact).toMatchObject({ encoding: 'reference', sizeBytes: expect.any(Number), hash: expect.any(String) })
    expect(argsArtifact).not.toHaveProperty('preview')
    expect(resultArtifacts).toHaveLength(2)
    for (const artifact of resultArtifacts) {
      expect(artifact).toMatchObject({ encoding: 'reference', sizeBytes: expect.any(Number), hash: expect.any(String) })
      expect(artifact).not.toHaveProperty('preview')
    }
  })

    it('records thrown tool execute errors as rich tool.call error evidence while preserving model output', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const execute = vi.fn(async () => {
      const error = new Error('search exploded')
      error.stack = 'Error: search exploded\n    at tool execute'
      throw error
    })
    const model = testAdapter([
      response('', [{ id: 'call_search', name: 'search', args: { query: 'refund' } }]),
      response('done'),
    ])

    const result = await model.generate(
      testPrompt({
        search: {
          description: 'Search docs',
          parameters: z.object({ query: z.string() }),
          execute,
        },
      }),
      {
        model: 'mock-model',
        input: { instruction: 'Find refund policy' },
      },
    )
    await observe.flush()

    expect(result.messages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: JSON.stringify({ error: 'search exploded' }),
        metadata: expect.objectContaining({ toolCallId: 'call_search', toolName: 'search' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'tool.result',
        attributes: expect.objectContaining({
          toolName: 'search',
          toolCallId: 'call_search',
          resultKind: 'model',
          modelOutputType: 'error-json',
          isError: true,
          errorKind: 'execute_error',
        }),
        preview: { type: 'error-json', value: { error: 'search exploded' } },
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:event',
        name: 'exception',
        attributes: expect.objectContaining({
          toolName: 'search',
          toolCallId: 'call_search',
          phase: 'tool.execute',
          errorKind: 'execute_error',
          'error.phase': 'tool.execute',
          'error.kind': 'execute_error',
          'exception.message': 'search exploded',
          'exception.type': 'Error',
          'exception.stacktrace': expect.stringContaining('search exploded'),
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.stack',
        attributes: expect.objectContaining({ toolName: 'search', toolCallId: 'call_search' }),
        preview: expect.stringContaining('search exploded'),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'error.raw',
        attributes: expect.objectContaining({ toolName: 'search', toolCallId: 'call_search' }),
        preview: expect.objectContaining({ message: 'search exploded', name: 'Error' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        error: { message: 'search exploded', name: 'Error', category: 'execute_error' },
        attributes: expect.objectContaining({
          toolName: 'search',
          toolCallId: 'call_search',
          phase: 'tool.execute',
          errorKind: 'execute_error',
        }),
      }),
    )
  })

    it('records approval requests and denied resume decisions as tool.approval spans', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const model = testAdapter([response('', [{ id: 'call_delete', name: 'deletePost', args: { id: 'post_1' } }])])
    const postPrompt = testPrompt({
      deletePost: {
        description: 'Delete a post',
        parameters: z.object({ id: z.string() }),
        needsApproval: true,
        execute: async () => 'deleted',
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
    })
    const approval = pending.messages.flatMap((message) => message.metadata?.toolApprovalRequests ?? [])[0]
    const deniedMessages = appendToolApprovalResponse(pending.messages, {
      approvalId: approval.approvalId,
      approvalToken: approval.approvalToken,
      approved: false,
      reason: 'Need owner confirmation',
    })

    await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Resume' },
      messages: deniedMessages,
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.approval',
        name: 'deletePost.approval.request',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.approval',
        name: 'deletePost.approval.denied',
      }),
    )
    expect(transport.records).not.toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.call',
        name: 'deletePost',
      }),
    )
  })

    it('records approved resume decisions before executing the approved tool', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const execute = vi.fn(async () => 'deleted')
    const model = testAdapter([
      response('', [{ id: 'call_delete', name: 'deletePost', args: { id: 'post_1' } }]),
      response('done'),
    ])
    const postPrompt = testPrompt({
      deletePost: {
        description: 'Delete a post',
        parameters: z.object({ id: z.string() }),
        needsApproval: true,
        execute,
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
    })
    const approval = pending.messages.flatMap((message) => message.metadata?.toolApprovalRequests ?? [])[0]
    const approvedMessages = appendToolApprovalResponse(pending.messages, {
      approvalId: approval.approvalId,
      approvalToken: approval.approvalToken,
      approved: true,
    })

    await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Resume' },
      messages: approvedMessages,
    })
    await observe.flush()

    expect(execute).toHaveBeenCalledOnce()
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.approval',
        name: 'deletePost.approval.approved',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.call',
        name: 'deletePost',
      }),
    )
  })

    it('records approval token mismatches as errored tool.approval spans and invalid denial results', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const model = testAdapter([response('', [{ id: 'call_delete', name: 'deletePost', args: { id: 'post_1' } }])])
    const execute = vi.fn(async () => 'deleted')
    const postPrompt = testPrompt({
      deletePost: {
        description: 'Delete a post',
        parameters: z.object({ id: z.string() }),
        needsApproval: true,
        execute,
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
    })
    const approval = pending.messages.flatMap((message) => message.metadata?.toolApprovalRequests ?? [])[0]
    const badMessages = appendToolApprovalResponse(pending.messages, {
      approvalId: approval.approvalId,
      approvalToken: 'wrong-token',
      approved: true,
    })

    const resumed = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Resume' },
      messages: badMessages,
    })
    await observe.flush()

    expect(execute).not.toHaveBeenCalled()
    expect(resumed.messages).toContainEqual(
      expect.objectContaining({
        role: 'tool',
        content: expect.stringContaining('"reason":"approval-invalid"'),
        metadata: expect.objectContaining({
          toolCallId: 'call_delete',
          toolName: 'deletePost',
        }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.approval',
        name: 'deletePost.approval.token-mismatch',
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        attributes: expect.objectContaining({ phase: 'token-mismatch', isError: true }),
      }),
    )
  })

    it('records missing tools as errored tool.call spans instead of hiding the failure in message history', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const model = testAdapter([
      response('', [{ id: 'call_missing', name: 'missingTool', args: { value: true } }]),
      response('done'),
    ])

    await model.generate(testPrompt({}), {
      model: 'mock-model',
      input: { instruction: 'Call missing tool' },
    })
    await observe.flush()

    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:start',
        primitive: 'tool.call',
        name: 'missingTool',
        attributes: expect.objectContaining({ toolCallId: 'call_missing', toolName: 'missingTool' }),
      }),
    )
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        status: 'error',
        attributes: expect.objectContaining({ isError: true, errorKind: 'tool_not_found' }),
      }),
    )
  })
})
