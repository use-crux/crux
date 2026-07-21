import { describe, expect, it } from 'vitest'
import { createServerOptions } from './server-options.js'

describe('createServerOptions', () => {
  it('uses the language client default stdio transport without adding CLI flags', () => {
    const options = createServerOptions({
      binaryPath: '/workspace/crux',
      port: 4400,
      workspaceRoot: '/workspace',
    })

    expect(options).toEqual({
      command: '/workspace/crux',
      args: ['lsp', '--port', '4400'],
      options: { cwd: '/workspace' },
    })
    expect('transport' in options).toBe(false)
  })
})
