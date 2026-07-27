/** Corrective writeback guarding over canonical provider-visible text. */

import { describe, expect, it } from 'vitest'
import type { Message } from '../../src/generation/messages'
import { boundary, guardrail, GuardrailBlockedError } from '../../src/safety'
import {
  guardSafetySessionFeedback,
  type FeedbackIngressGuard,
} from '../../src/safety/session-bridge'
import {
  guardCorrectiveMessages,
  guardSessionFeedback,
} from '../../src/safety/session-feedback-guard'
import { createSafety } from '../../src/safety/session-runtime'

describe('feedback ingress capability', () => {
  it('runs the new source and legacy validation alias with one safe origin', async () => {
    const seen: Array<{ readonly policy: string; readonly origin: unknown }> =
      []
    const safety = createSafety({
      promptId: 'feedback',
      model: 'test-model',
      call: {
        guardrails: [
          guardrail({
            id: 'new-feedback-source',
            on: boundary.input.text({ from: 'feedback' }),
            run: (text, context) => {
              seen.push({ policy: 'new', origin: context.origin })
              return {
                action: 'rewrite',
                value: text.replace('private', 'safe'),
                rewrite: { kind: 'redact' },
              }
            },
          }),
          guardrail({
            id: 'legacy-validation-feedback',
            on: boundary.validation.feedback(),
            run: (text, context) => {
              seen.push({ policy: 'legacy', origin: context.origin })
              return {
                action: 'rewrite',
                value: `${text}!`,
                rewrite: { kind: 'normalize' },
              }
            },
          }),
        ],
      },
    })

    await expect(
      guardSafetySessionFeedback(safety, {
        kind: 'validation-feedback',
        text: 'private feedback',
        attempt: 2,
      }),
    ).resolves.toBe('safe feedback!')
    expect(seen).toEqual([
      {
        policy: 'new',
        origin: {
          source: 'feedback',
          kind: 'validation-feedback',
          attempt: 2,
        },
      },
      {
        policy: 'legacy',
        origin: {
          source: 'feedback',
          kind: 'validation-feedback',
          attempt: 2,
        },
      },
    ])
  })

  it('does not run the legacy alias for rejected output or constraint feedback', async () => {
    const legacyKinds: string[] = []
    const safety = createSafety({
      promptId: 'feedback',
      model: 'test-model',
      call: {
        guardrails: [
          guardrail({
            id: 'legacy-validation-only',
            on: boundary.validation.feedback(),
            run: (_text, context) => {
              legacyKinds.push(context.origin?.kind ?? 'missing')
              return { action: 'allow' }
            },
          }),
        ],
      },
    })

    await guardSafetySessionFeedback(safety, {
      kind: 'rejected-output',
      text: 'rejected',
      attempt: 1,
    })
    await guardSafetySessionFeedback(safety, {
      kind: 'constraint-feedback',
      text: 'corrective',
      attempt: 1,
    })
    expect(legacyKinds).toEqual([])
  })

  it('keeps report-mode content unchanged while retaining its audit', async () => {
    const safety = createSafety({
      promptId: 'feedback',
      model: 'test-model',
      call: {
        guardrails: [
          guardrail({
            id: 'report-feedback-rewrite',
            mode: 'report',
            on: boundary.input.text({ from: 'feedback' }),
            run: () => ({
              action: 'rewrite',
              value: 'must not apply',
              rewrite: { kind: 'redact' },
            }),
          }),
        ],
      },
    })

    await expect(
      guardSafetySessionFeedback(safety, {
        kind: 'constraint-feedback',
        text: 'original',
        attempt: 1,
      }),
    ).resolves.toBe('original')
    expect(safety.audit.guardrails?.applied).toEqual([
      expect.objectContaining({
        guard: 'report-feedback-rewrite',
        action: 'redact',
        mode: 'report',
      }),
    ])
  })
})

describe('canonical corrective-message visitor', () => {
  it('guards every textual occurrence without traversing opaque values', async () => {
    const opaqueMetadata = { secret: 'metadata text' }
    const image = {
      type: 'image' as const,
      source: 'https://example.com/image.png',
      providerOptions: { vendor: { note: 'opaque text' } },
    }
    const toolCall = {
      type: 'tool-call' as const,
      toolCallId: 'call-1',
      toolName: 'lookup',
      input: { query: 'opaque tool text' },
    }
    const messages: readonly Message[] = [
      { role: 'system', content: 'system text', metadata: opaqueMetadata },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'user text', providerOptions: { vendor: {} } },
          image,
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'reasoning text' },
          toolCall,
          { type: 'text', text: 'assistant text' },
        ],
      },
    ]
    const seen: string[] = []
    const guard: FeedbackIngressGuard = async ({ text, kind, attempt }) => {
      seen.push(`${kind}:${attempt}:${text}`)
      return `guarded(${text})`
    }

    const guarded = await guardCorrectiveMessages({
      messages,
      kind: 'constraint-feedback',
      attempt: 3,
      guard,
    })

    expect(seen).toEqual([
      'constraint-feedback:3:system text',
      'constraint-feedback:3:user text',
      'constraint-feedback:3:reasoning text',
      'constraint-feedback:3:assistant text',
    ])
    expect(guarded).toEqual([
      {
        role: 'system',
        content: 'guarded(system text)',
        metadata: opaqueMetadata,
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'guarded(user text)',
            providerOptions: { vendor: {} },
          },
          image,
        ],
      },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'guarded(reasoning text)' },
          toolCall,
          { type: 'text', text: 'guarded(assistant text)' },
        ],
      },
    ])
    expect(guarded[0]?.metadata).toBe(opaqueMetadata)
    expect(
      Array.isArray(guarded[1]?.content) ? guarded[1].content[1] : undefined,
    ).toBe(image)
    expect(
      Array.isArray(guarded[2]?.content) ? guarded[2].content[1] : undefined,
    ).toBe(toolCall)
  })

  it('discards a partial rebuild when a later occurrence blocks', async () => {
    let calls = 0
    const block = new GuardrailBlockedError({
      guardrailId: 'block-second',
      phase: 'input',
      reason: 'blocked',
    })
    const guard: FeedbackIngressGuard = async ({ text }) => {
      calls += 1
      if (calls === 2) throw block
      return `changed ${text}`
    }
    const messages: readonly Message[] = [
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ]

    await expect(
      guardCorrectiveMessages({
        messages,
        kind: 'validation-feedback',
        attempt: 1,
        guard,
      }),
    ).rejects.toBe(block)
    expect(messages).toEqual([
      { role: 'user', content: 'first' },
      { role: 'user', content: 'second' },
    ])
  })

  it('validates positive one-based attempts before running a policy', async () => {
    await expect(
      guardSessionFeedback({
        bindings: [],
        input: { kind: 'rejected-output', text: 'candidate', attempt: 0 },
        context: {
          promptId: 'p',
          model: 'm',
          messages: [],
          systemPrompt: undefined,
          traceId: undefined,
          metadata: {},
        },
        appendAudit: () => {},
      }),
    ).rejects.toMatchObject({ name: 'SafetyResultError' })
  })
})
