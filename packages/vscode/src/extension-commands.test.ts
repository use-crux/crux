import { describe, expect, it, vi } from 'vitest'
import { registerExtensionCommands } from './extension-commands.js'

describe('registerExtensionCommands', () => {
  it('registers editor commands and preserves devtools URL fallback behavior', async () => {
    const handlers = new Map<string, (argument?: unknown) => unknown>()
    const opened: string[] = []
    const restart = vi.fn()
    const registrations = registerExtensionCommands({
      registerCommand(command, handler) {
        handlers.set(command, handler)
        return { dispose() {} }
      },
      getPort: () => 4604,
      openExternal: async (url) => {
        opened.push(url)
      },
      restart,
    })

    expect([...handlers.keys()]).toEqual([
      'crux.openDocs',
      'crux.openDevtools',
      'crux.restartServer',
    ])
    expect(registrations).toHaveLength(3)
    await handlers.get('crux.openDocs')?.('https://cruxjs.dev/docs/lint/example')
    await handlers.get('crux.openDevtools')?.('http://localhost:4604/library/index/prompt%3Awriter')
    await handlers.get('crux.openDevtools')?.()
    await handlers.get('crux.restartServer')?.()

    expect(opened).toEqual([
      'https://cruxjs.dev/docs/lint/example',
      'http://localhost:4604/library/index/prompt%3Awriter',
      'http://localhost:4604/',
    ])
    expect(restart).toHaveBeenCalledOnce()
  })
})
