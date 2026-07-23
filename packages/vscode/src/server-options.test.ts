import { describe, expect, it } from 'vitest'
import { createServerOptions } from './server-options.js'

describe('createServerOptions', () => {
  it('uses the language client default stdio transport without adding CLI flags', () => {
    const options = createServerOptions({
      invocation: { command: '/workspace/crux', argsPrefix: [] },
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

  it('preserves the invocation prefix required by a Windows npm shim', () => {
    const options = createServerOptions({
      invocation: {
        command: 'C:\\Windows\\cmd.exe',
        argsPrefix: [
          '/d',
          '/s',
          '/c',
          'call',
          'C:\\workspace\\node_modules\\.bin\\crux.cmd',
        ],
      },
      port: 4400,
      workspaceRoot: 'C:\\workspace',
    })

    expect(options).toEqual({
      command: 'C:\\Windows\\cmd.exe',
      args: [
        '/d',
        '/s',
        '/c',
        'call',
        'C:\\workspace\\node_modules\\.bin\\crux.cmd',
        'lsp',
        '--port',
        '4400',
      ],
      options: { cwd: 'C:\\workspace' },
    })
  })
})
