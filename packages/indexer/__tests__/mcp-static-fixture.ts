/** Shared no-I/O authored MCP source used for TypeScript and Rust/Oxc parity. */
export const mcpStaticFixtureSource = `
  import { mcp, stdio, streamableHttp } from '@use-crux/mcp'

  const resolveTransport = () => {
    throw new Error('static indexing must not execute transport resolvers')
  }
  declare function createOpaqueTransport(): never
  declare const selectedNames: string[]
  const opaqueTransport = createOpaqueTransport()

  export const filesystem = mcp({
    id: 'Filesystem / Primary',
    transport: stdio({
      command: '/usr/local/bin/node',
      args: ['private-server.mjs', '--token', 'SECRET_ARG'],
      cwd: '/private/workspace',
      env: { MCP_TOKEN: 'SECRET_ENV' },
    }),
    tools: {
      allow: ['read.file', 'write-file'],
      prefix: 'fs_',
    },
  })

  export const remote = mcp({
    id: 'remote',
    transport: streamableHttp({
      url: 'https://user:password@mcp.example.test/v1/tools?token=SECRET_QUERY#private',
      headers: { Authorization: 'Bearer SECRET_HEADER' },
    }),
    tools: { deny: ['dangerous-tool'] },
  })

  export const dynamic = mcp({
    id: 'dynamic',
    transport: resolveTransport,
  })

  export const opaque = mcp({
    id: 'opaque',
    transport: opaqueTransport,
    tools: { allow: selectedNames, prefix: 'opaque_' },
  })

  export const invalidHttp = mcp({
    id: 'invalid-http',
    transport: streamableHttp({ url: 'not-a-url?token=SECRET_INVALID_URL' }),
  })
`
