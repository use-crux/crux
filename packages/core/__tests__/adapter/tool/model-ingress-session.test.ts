/** ToolLifecycle integration tests for post-conversion model ingress. */

import { describe, expect, it } from 'vitest'
import { createToolLifecycle, type ToolLifecycleOptions } from '../../../src/adapter/tool/session'
import type { AdapterResponse } from '../../../src/adapter/types'
import type { ResolvedPrompt } from '../../../src/resolver/types'
import { appendToolApprovalResponse } from '../../../src/tools/approvals'
import type { Message } from '../../../src/generation/messages'

describe('ToolLifecycle model ingress', () => {
  it('guards the canonical error JSON produced by a throwing tool', async () => {
    const lifecycle = coreLifecycle(
      {
        boom: {
          execute: async () => {
            throw new Error('private failure')
          },
        },
      },
      {
        modelIngress: async (input) => {
          expect(input).toMatchObject({
            kind: 'text',
            value: '{"error":"private failure"}',
            origin: { source: 'tool', kind: 'tool-result', toolName: 'boom', toolCallId: 'tc1' },
          })
          return { kind: 'text', value: 'safe failure' }
        },
      },
    )

    const round = await lifecycle.executeRound(response('boom'), [])

    if (round.kind !== 'completed') throw new Error('expected completed')
    expect(round.results[0]).toMatchObject({
      modelOutput: { type: 'error-text', value: 'safe failure' },
      content: 'safe failure',
      isError: true,
    })
  })

  it('guards the canonical error produced for an unknown tool', async () => {
    const lifecycle = coreLifecycle(
      { known: { execute: async () => 'ok' } },
      {
        modelIngress: async (input) => {
          expect(input).toMatchObject({
            kind: 'text',
            value: '{"error":"Tool \\"ghost\\" not found"}',
            origin: { source: 'tool', kind: 'tool-result', toolName: 'ghost', toolCallId: 'tc1' },
          })
          return { kind: 'text', value: 'unknown tool' }
        },
      },
    )

    const round = await lifecycle.executeRound(response('ghost'), [])

    if (round.kind !== 'completed') throw new Error('expected completed')
    expect(round.results[0]).toMatchObject({
      modelOutput: { type: 'error-text', value: 'unknown tool' },
      content: 'unknown tool',
      isError: true,
    })
  })

  it('guards invalid-approval model output before replay writeback', async () => {
    const lifecycle = coreLifecycle(
      { dangerous: { execute: async () => 'must not execute' } },
      {
        modelIngress: async (input) => {
          expect(input).toMatchObject({
            kind: 'text',
            origin: { source: 'tool', kind: 'tool-result', toolName: 'dangerous', toolCallId: 'tc9' },
          })
          return { kind: 'text', value: 'invalid approval' }
        },
      },
    )
    const messages = appendToolApprovalResponse(
      [
        { role: 'user' as const, content: 'go' },
        {
          role: 'assistant' as const,
          content: 'need approval',
          metadata: { toolCalls: [{ id: 'tc9', name: 'dangerous', args: {} }] },
        },
      ],
      {
        approvalId: 'approval_tc9',
        approved: true,
        approvalToken: 'forged',
      },
    ) as Message[]

    const outcome = await lifecycle.resume(messages)

    expect(outcome.messages.at(-1)).toMatchObject({
      role: 'tool',
      metadata: {
        toolCallId: 'tc9',
        toolName: 'dangerous',
        modelOutput: { type: 'error-text', value: 'invalid approval' },
      },
    })
  })

  it('propagates cancellation while canonical model ingress is pending', async () => {
    const controller = new AbortController()
    const reason = new DOMException('cancelled', 'AbortError')
    let markStarted!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const lifecycle = coreLifecycle(
      { lookup: { execute: async () => 'result' } },
      {
        abortSignal: controller.signal,
        modelIngress: async (input) => {
          markStarted()
          await held
          return input
        },
      },
    )

    const pending = lifecycle.executeRound(response('lookup'), [])
    await started
    controller.abort(reason)
    release()

    await expect(pending).rejects.toBe(reason)
  })
})

function coreLifecycle(
  tools: Record<string, unknown>,
  extra: Partial<ToolLifecycleOptions> = {},
) {
  return createToolLifecycle({
    regime: 'core',
    resolved: { settings: {}, tools } as ResolvedPrompt,
    promptId: 'p1',
    ...extra,
  })
}

function response(toolName: string): AdapterResponse {
  return {
    text: '',
    toolCalls: [{ id: 'tc1', name: toolName, args: {} }],
    usage: {
      inputTokens: 1,
      outputTokens: 1,
      totalTokens: 2,
      inputTokenDetails: {},
      outputTokenDetails: {},
    },
    finishReason: 'tool_calls',
    responseId: undefined,
    actualModelId: undefined,
  }
}
