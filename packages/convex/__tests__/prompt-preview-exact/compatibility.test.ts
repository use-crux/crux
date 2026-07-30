import { config, prompt } from '@use-crux/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { setup } from '../../src/bridge'
import { inMemoryRecordStore } from '../../src/memory'
import { configure } from '../../../core/src/runtime/configure'
import { TestRouter } from './test-router'

describe('Convex exact prompt preview compatibility', () => {
  const disposals: Array<() => void> = []

  afterEach(() => {
    for (const dispose of disposals.splice(0).reverse()) dispose()
    vi.restoreAllMocks()
  })

  it('keeps store dispatch compatible and preview execution log-free', async () => {
    const registry = configure({
      prompts: [prompt({ id: 'quiet', prompt: 'quiet output' })],
    })
    disposals.push(registry.dispose)
    const crux = config({
      devtools: { bridge: { transport: 'http', url: 'https://local.test' } },
    })
    disposals.push(crux.dispose)
    const records = inMemoryRecordStore()
    await records.put('record', { id: 'record' })
    const storage = vi.fn(() => ({ records }))
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {})
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

    const preview = await post._handler(
      {},
      new Request('https://local.test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_preview',
          command: 'prompt.previewExact',
          targetId: 'prompt:quiet',
          catalogueRevision: revision,
          payload: { input: {} },
          deadlineMs: 1_000,
        }),
      }),
    )
    expect(preview.status).toBe(200)
    expect(storage).not.toHaveBeenCalled()
    expect(warnings).not.toHaveBeenCalled()
    expect(errors).not.toHaveBeenCalled()
    expect(logs).not.toHaveBeenCalled()

    const store = await post._handler(
      {},
      new Request('https://local.test', {
        method: 'POST',
        body: JSON.stringify({
          type: 'command.request',
          commandId: 'cmd_store',
          command: 'store.read',
          payload: {
            operation: 'get',
            resource: 'crux.store',
            key: 'record',
          },
        }),
      }),
    )
    expect(store.status).toBe(200)
    expect(storage).toHaveBeenCalledTimes(1)
    expect(await store.json()).toMatchObject({
      type: 'command.result',
      commandId: 'cmd_store',
      result: { value: { id: 'record' } },
    })
  })
})
