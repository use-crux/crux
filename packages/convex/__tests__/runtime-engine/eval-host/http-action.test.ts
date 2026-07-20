import { describe, expect, it, vi } from 'vitest'
import { makeFunctionReference } from 'convex/server'
import {
  createConvexEvalHttpAction,
  type ConvexEvalHttpRequest,
} from '../../../src/runtime'

describe('createConvexEvalHttpAction()', () => {
  it('registers a real HTTP action and preserves request and response bytes', async () => {
    const handler = makeFunctionReference<
      'action',
      { request: ConvexEvalHttpRequest },
      {
        status: number
        statusText: string
        headers: Array<{ name: string; value: string }>
        body: ArrayBuffer
      }
    >('_crux/targets:handleEvalRequest')
    const runAction = vi.fn(
      async (_handler: unknown, _args: { request: ConvexEvalHttpRequest }) => ({
        status: 202,
        statusText: 'Accepted',
        headers: [
          { name: 'content-type', value: 'application/octet-stream' },
          { name: 'set-cookie', value: 'first=1' },
          { name: 'set-cookie', value: 'second=2' },
        ],
        body: Uint8Array.from([0, 255, 10]).buffer,
      }),
    )
    const action = createConvexEvalHttpAction({
      handler,
      token: 'secret',
    }) as ReturnType<
      typeof createConvexEvalHttpAction
    > & {
      _handler: (ctx: unknown, request: Request) => Promise<Response>
    }

    expect(action.isHttp).toBe(true)

    const response = await action._handler(
      { runAction } as never,
      new Request('https://example.convex.site/jobs', {
        method: 'POST',
        headers: [
          ['authorization', 'Bearer secret'],
          ['x-crux-test', 'yes'],
        ],
        body: Uint8Array.from([0, 128, 255]),
      }),
    )

    expect(runAction).toHaveBeenCalledWith(handler, {
      request: {
        url: 'https://example.convex.site/jobs',
        method: 'POST',
        headers: expect.arrayContaining([
          { name: 'authorization', value: 'Bearer secret' },
          { name: 'x-crux-test', value: 'yes' },
        ]),
        body: expect.any(ArrayBuffer),
      },
    })
    const forwarded = runAction.mock.calls[0]![1].request
    expect([...new Uint8Array(forwarded.body)]).toEqual([0, 128, 255])
    expect(response.status).toBe(202)
    expect(response.statusText).toBe('Accepted')
    expect(response.headers.getSetCookie()).toEqual(['first=1', 'second=2'])
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([
      0, 255, 10,
    ])
  })

  it('rejects oversized streamed bodies before invoking the Node action', async () => {
    const runAction = vi.fn()
    const action = createConvexEvalHttpAction({ token: 'secret' }) as ReturnType<
      typeof createConvexEvalHttpAction
    > & {
      _handler: (ctx: unknown, request: Request) => Promise<Response>
    }
    const chunks = [new Uint8Array(10_000), new Uint8Array(10_000)]
    const request = new Request('https://example.convex.site/jobs', {
      method: 'POST',
      headers: { authorization: 'Bearer secret' },
      body: new ReadableStream({
        pull(controller) {
          const chunk = chunks.shift()
          if (chunk) controller.enqueue(chunk)
          else controller.close()
        },
      }),
      duplex: 'half',
    } as RequestInit & { duplex: 'half' })

    const response = await action._handler({ runAction } as never, request)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: { code: 'EVAL_HOST_BODY_TOO_LARGE' },
    })
    expect(runAction).not.toHaveBeenCalled()
  })
})
