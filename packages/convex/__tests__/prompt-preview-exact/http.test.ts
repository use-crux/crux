import { config, prompt } from '@use-crux/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setup } from '../../src/bridge'
import { configure } from '../../../core/src/runtime/configure'
import { TestRouter } from './test-router'

describe('Convex exact prompt preview bridge', () => {
  const disposals: Array<() => void> = []

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose()
  })

  it('serves the current catalogue and rejects a retired revision on POST', async () => {
    const first = configure({
      prompts: [prompt({ id: 'first', prompt: 'first' })],
    })
    disposals.push(first.dispose)
    const crux = config({
      devtools: {
        bridge: {
          transport: 'http',
          url: 'https://project.convex.site/crux/bridge',
        },
      },
    })
    disposals.push(crux.dispose)
    const router = new TestRouter()
    setup(router, crux)
    const get = router.handler('GET')
    const post = router.handler('POST')

    const manifest = await (
      await get._handler(
        {},
        new Request('https://project.convex.site/crux/bridge'),
      )
    ).json()
    const capability = manifest.capabilities.find(
      (candidate: { command: string }) =>
        candidate.command === 'prompt.previewExact',
    )
    expect(capability.targets).toEqual([
      expect.objectContaining({ definitionId: 'prompt:first' }),
    ])

    const second = configure({
      prompts: [prompt({ id: 'second', prompt: 'second' })],
    })
    disposals.push(second.dispose)
    const response = await post._handler(
      {},
      new Request('https://project.convex.site/crux/bridge', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_old',
          command: 'prompt.previewExact',
          targetId: 'prompt:first',
          catalogueRevision: capability.catalogueRevision,
          payload: { input: {} },
          deadlineMs: 1_000,
        }),
      }),
    )

    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({
      type: 'command.error',
      commandId: 'cmd_old',
      error: {
        code: 'catalogue_changed',
        message: 'The runtime prompt catalogue changed.',
        details: {
          expectedCatalogueRevision: capability.catalogueRevision,
          actualCatalogueRevision: capability.catalogueRevision + 1,
        },
      },
    })
  })

  it('rejects duplicate keys without invoking the prompt', async () => {
    let calls = 0
    const registry = configure({
      prompts: [
        prompt({
          id: 'duplicate',
          prompt: () => {
            calls += 1
            return 'unsafe'
          },
        }),
      ],
    })
    disposals.push(registry.dispose)
    const crux = config({
      devtools: { bridge: { transport: 'http', url: 'https://local.test' } },
    })
    disposals.push(crux.dispose)
    const router = new TestRouter()
    setup(router, crux)
    const get = router.handler('GET')
    const post = router.handler('POST')
    const manifest = await (
      await get._handler({}, new Request('https://local.test'))
    ).json()
    const revision = manifest.capabilities.find(
      (candidate: { command: string }) =>
        candidate.command === 'prompt.previewExact',
    ).catalogueRevision
    const response = await post._handler(
      {},
      new Request('https://local.test', {
        method: 'POST',
        body: `{"type":"command.request","commandId":"cmd","command":"prompt.previewExact","targetId":"prompt:duplicate","catalogueRevision":${revision},"payload":{"input":{"value":1,"value":2}},"deadlineMs":1000}`,
      }),
    )

    expect(response.status).toBe(400)
    expect(calls).toBe(0)
    const body = await response.json()
    expect(body).toEqual({
      type: 'command.error',
      commandId: 'cmd',
      error: {
        code: 'invalid_request',
        message: 'Exact-preview request is invalid.',
      },
    })
    expect(JSON.stringify(body)).not.toContain('"value"')
  })

  it('does not resolve storage for preview and detects escaped commands', async () => {
    const render = vi.fn(() => 'unsafe')
    const registry = configure({
      prompts: [prompt({ id: 'escaped', prompt: render })],
    })
    disposals.push(registry.dispose)
    const crux = config({
      devtools: { bridge: { transport: 'http', url: 'https://local.test' } },
    })
    disposals.push(crux.dispose)
    const storage = vi.fn(() => {
      throw new Error('unrelated storage failure')
    })
    const router = new TestRouter()
    setup(router, crux, { storage })
    const get = router.handler('GET')
    const post = router.handler('POST')
    const manifest = await (
      await get._handler({}, new Request('https://local.test'))
    ).json()
    const revision = manifest.capabilities.find(
      (candidate: { command: string }) =>
        candidate.command === 'prompt.previewExact',
    ).catalogueRevision

    const response = await post._handler(
      {},
      new Request('https://local.test', {
        method: 'POST',
        body: `{"type":"command.request","commandId":"cmd_escaped","command":"prompt.preview\\u0045xact","targetId":"prompt:escaped","catalogueRevision":${revision},"payload":{"input":{"value":1,"value":2}},"deadlineMs":1000}`,
      }),
    )

    expect(response.status).toBe(400)
    expect(storage).not.toHaveBeenCalled()
    expect(render).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({
      type: 'command.error',
      commandId: 'cmd_escaped',
      error: { code: 'invalid_request' },
    })
  })
})
