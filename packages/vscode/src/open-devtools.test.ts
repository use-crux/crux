import { describe, expect, it } from 'vitest'
import { createOpenDevtoolsHandler } from './open-devtools.js'

describe('createOpenDevtoolsHandler', () => {
  it('opens a lens URL and falls back to the configured local devtools root', async () => {
    const opened: string[] = []
    let port = 4603
    const handler = createOpenDevtoolsHandler({
      getPort: () => port,
      openExternal: async (url) => {
        opened.push(url)
      },
    })

    await handler('http://localhost:4603/library/index/prompt%3Awriter')
    port = 4700
    await handler(undefined)

    expect(opened).toEqual([
      'http://localhost:4603/library/index/prompt%3Awriter',
      'http://localhost:4700/',
    ])
  })
})
