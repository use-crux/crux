/** Core-owned semantic model-ingress capability behavior. */

import { afterEach, describe, expect, it } from 'vitest'
import { contentText } from '../../src/content'
import { boundary, createSafety, guardrail } from '../../src/safety'
import { safetySessionModelIngressGuard } from '../../src/safety/session'
import {
  createInMemoryObservabilityTransport,
  observe,
  resetObservabilityRuntime,
  setObservabilityTransport,
} from '../../src/observability'

afterEach(() => {
  resetObservabilityRuntime()
})

describe('model ingress', () => {
  it('observes tool provenance without serializing canonical tool text', async () => {
    const transport = createInMemoryObservabilityTransport()
    setObservabilityTransport(transport, { scheduledDelayMs: 0 })
    const safety = createSafety({
      call: {
        guardrails: [
          guardrail({
            id: 'report-tool-ingress',
            on: boundary.input.text({ from: 'tool' }),
            mode: 'report',
            run: () => ({
              action: 'rewrite',
              value: 'safe replacement',
              rewrite: { kind: 'redact' },
            }),
          }),
        ],
      },
    })
    const modelIngress = safetySessionModelIngressGuard(safety, 'tool')
    if (!modelIngress) throw new Error('expected tool model ingress')

    const guarded = await modelIngress({
      kind: 'text',
      value: 'SECRET_TOOL_TEXT',
      origin: {
        source: 'tool',
        kind: 'tool-result',
        toolName: 'search',
        toolCallId: 'call-safe-1',
      },
    })
    await observe.flush()

    expect(guarded).toEqual({ kind: 'text', value: 'SECRET_TOOL_TEXT' })
    expect(transport.records).toContainEqual(
      expect.objectContaining({
        type: 'artifact',
        kind: 'guardrail.report',
        preview: expect.objectContaining({
          target: { id: 'model.input.text', label: 'Model input · Text' },
          mode: 'report',
          origin: {
            source: 'tool',
            kind: 'tool-result',
            toolName: 'search',
            toolCallId: 'call-safe-1',
          },
        }),
      }),
    )
    expect(JSON.stringify(transport.records)).not.toContain('SECRET_TOOL_TEXT')
  })

  it('strips media before text projection and preserves retained part identity', async () => {
    const text = Object.freeze({ type: 'text' as const, text: 'private summary' })
    const removed = Object.freeze({
      type: 'image' as const,
      source: new Uint8Array([1]),
      mediaType: 'image/png',
    })
    const retained = Object.freeze({
      type: 'image' as const,
      source: new Uint8Array([2]),
      mediaType: 'image/png',
    })
    const expectedProjection = contentText([text, retained])
    const order: string[] = []
    const safety = createSafety({
      call: {
        guardrails: [
          guardrail({
            id: 'strip-selected-tool-media',
            on: boundary.input.media({ from: 'tool' }),
            run: (subject) => {
              order.push(subject.part === removed ? 'media:removed' : 'media:retained')
              return subject.part === removed
                ? { action: 'strip', reason: 'remove selected image' }
                : { action: 'allow' }
            },
          }),
          guardrail({
            id: 'rewrite-retained-tool-projection',
            on: boundary.input.text({ from: 'tool' }),
            run: (projection) => {
              order.push('text')
              expect(projection).toBe(expectedProjection)
              return {
                action: 'rewrite',
                value: projection.replace('private', 'safe'),
                rewrite: { kind: 'redact' },
              }
            },
          }),
        ],
      },
    })

    const modelIngress = safetySessionModelIngressGuard(safety, 'tool')
    expect(typeof modelIngress).toBe('function')
    if (!modelIngress) throw new Error('expected tool model ingress')
    const guarded = await modelIngress({
      kind: 'document',
      value: [text, removed, retained],
      origin: {
        source: 'tool',
        kind: 'tool-result',
        toolName: 'lookup',
        toolCallId: 'call-1',
      },
      slots: [
        { key: 'part:0', kind: 'text', value: text.text },
        {
          key: 'part:1',
          kind: 'media',
          descriptor: contentText([removed]),
          subjects: [
            {
              part: removed,
              origin: {
                kind: 'tool-result',
                toolName: 'lookup',
                toolCallId: 'call-1',
                partIndex: 1,
              },
            },
          ],
        },
        {
          key: 'part:2',
          kind: 'media',
          descriptor: contentText([retained]),
          subjects: [
            {
              part: retained,
              origin: {
                kind: 'tool-result',
                toolName: 'lookup',
                toolCallId: 'call-1',
                partIndex: 2,
              },
            },
          ],
        },
      ],
    })

    expect(order).toEqual(['media:removed', 'media:retained', 'text'])
    expect(guarded.kind).toBe('patch')
    if (guarded.kind !== 'patch') throw new Error('expected patch')
    expect(guarded.removed).toEqual(new Set(['part:1']))
    expect(guarded.text).toEqual(new Map([['part:0', 'safe summary']]))
  })
})
