import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { adapter as makeAdapter } from '../../src/adapter/define-adapter'
import type { AdapterResponse } from '../../src/adapter/types'
import { prompt } from '../../src/prompt/prompt'
import type { Message } from '../../src/generation/messages'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'
import { resetHooks, updateHooks } from '../../src/runtime/runtime'
import { appendToolApprovalResponse } from '../../src/tools/approvals'
import type { ToolModelOutput } from '../../src/types/tool'

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
    usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8, inputTokenDetails: {}, outputTokenDetails: {} },
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
        execute: async () => 'deleted',
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
      toolApproval: { deletePost: 'always' },
    })
    const approval = pending.messages.flatMap((message) => message.metadata?.toolApprovalRequests ?? [])[0]
    expect(approval.replay).toBeUndefined()
    const deniedMessages = appendToolApprovalResponse(pending.messages, {
      approvalId: approval.approvalId,
      approvalToken: approval.approvalToken,
      approved: false,
      reason: 'Need owner confirmation',
    })

    await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Resume' },
      toolApproval: { deletePost: 'always' },
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
    const attemptedCalls = transport.records.filter(
      (record) =>
        record.type === 'span:start' &&
        record.primitive === 'tool.call' &&
        record.name === 'deletePost',
    )
    expect(attemptedCalls).toHaveLength(1)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: attemptedCalls[0]!.spanId,
        status: 'suspended',
      }),
    )
    const approvalArtifacts = transport.records.filter(
      (record) =>
        record.type === 'artifact' &&
        (record.kind === 'approval.request' ||
          record.kind === 'approval.decision'),
    )
    expect(approvalArtifacts).toEqual([
      expect.objectContaining({
        kind: 'approval.request',
        preview: { status: 'requested' },
        attributes: {
          approvalOccurrence: expect.objectContaining({
            domain: 'crux.tool.approval',
            slot: 'request',
          }),
        },
      }),
    ])
    const authority = transport.records.filter(
      (record) =>
        record.type === 'edge' &&
        record.edgeType === 'evidence.for' &&
        record.attributes.role === 'authority',
    )
    const requested = authority.find(
      (record) => record.attributes.conclusion === 'inconclusive',
    )
    expect(requested).toMatchObject({
      to: { kind: 'span', id: attemptedCalls[0]!.spanId },
    })
    expect(
      authority.some(
        (record) => record.attributes.conclusion === 'denied',
      ),
    ).toBe(false)
  })

  it('redacts approval request tool args before capture', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport)
    const model = testAdapter([
      response('', [
        {
          id: 'call_email',
          name: 'sendEmail',
          args: { to: 'private@example.com', apiKey: 'sk-live-secret' },
        },
      ]),
    ])

    await model.generate(
      testPrompt({
        sendEmail: {
          description: 'Send an email',
          parameters: z.object({ to: z.string(), apiKey: z.string() }),
          execute: async () => 'sent',
        },
      }),
      {
        model: 'mock-model',
        input: { instruction: 'Send the email' },
        toolApproval: { sendEmail: 'always' },
      },
    )
    await observe.flush()

    const approvalArgs = transport.records.find(
      (record) =>
        record.type === 'artifact' &&
        record.kind === 'tool.args' &&
        record.attributes?.toolCallId === 'call_email',
    )
    const preview = JSON.stringify(approvalArgs?.preview)

    expect(preview).not.toContain('private@example.com')
    expect(preview).not.toContain('sk-live-secret')
    expect(preview).toContain('[redacted-email]')
    expect(preview).toContain('[redacted]')
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
        execute,
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
      toolApproval: { deletePost: 'always' },
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
      toolApproval: { deletePost: 'always' },
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
    const calls = transport.records.filter(
      (record) =>
        record.type === 'span:start' &&
        record.primitive === 'tool.call' &&
        record.name === 'deletePost',
    )
    expect(calls).toHaveLength(2)
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'span:end',
        spanId: calls[0]!.spanId,
        status: 'suspended',
      }),
    )
    expect(
      transport.records.some(
        (record) =>
          record.type === 'artifact' &&
          record.kind === 'approval.decision',
      ),
    ).toBe(false)
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
        execute,
      },
    })

    const pending = await model.generate(postPrompt, {
      model: 'mock-model',
      input: { instruction: 'Delete post_1' },
      toolApproval: { deletePost: 'always' },
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
      toolApproval: { deletePost: 'always' },
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
