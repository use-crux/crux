import { describe, expect, it } from 'vitest'
import type { RuntimeTargetId, WorkId } from '@use-crux/core/runtime'
import { qstash, type QStashPublishRequest } from '../src/runtime'

describe('qstash() runtime wake adapter', () => {
  it('publishes wake envelopes to QStash with the endpoint URL and deduplication id', async () => {
    const published: QStashPublishRequest[] = []
    const wake = qstash({
      client: {
        publishJSON: async (request) => {
          published.push(request)
          return { messageId: 'msg_1' }
        },
      },
    })
    const deliver = wake.createWake({ url: 'https://app.example.com/api/crux' })

    await deliver({
      v: 1,
      ns: 'tenant-a',
      workId: 'work_1' as WorkId,
      target: 'review' as RuntimeTargetId,
      kind: 'flow.resume',
      idempotencyKey: 'resume:work_1:event_1',
      attempt: 1,
    })

    expect(published).toMatchObject([
      {
        url: 'https://app.example.com/api/crux',
        body: {
          workId: 'work_1',
          target: 'review',
        },
        deduplicationId: 'resume:work_1:event_1',
      },
    ])
  })

  it('verifies QStash signatures with the official receiver contract', async () => {
    const seen: unknown[] = []
    const wake = qstash({
      client: { publishJSON: async () => ({ messageId: 'msg_1' }) },
      receiver: {
        verify: async (request) => {
          seen.push(request)
          return true
        },
      },
    })

    await expect(
      wake.verify?.({
        request: new Request('https://app.example.com/api/crux', {
          method: 'POST',
          headers: {
            'upstash-signature': 'sig_123',
            'upstash-region': 'eu-west-1',
          },
        }),
        body: '{"ok":true}',
        rawBody: new TextEncoder().encode('{"ok":true}'),
      }),
    ).resolves.toBe(true)
    expect(seen).toEqual([
      {
        signature: 'sig_123',
        body: '{"ok":true}',
        url: 'https://app.example.com/api/crux',
        upstashRegion: 'eu-west-1',
      },
    ])
  })
})
