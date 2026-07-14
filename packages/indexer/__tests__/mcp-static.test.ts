import type { McpServerFacts, ToolFacts } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { createStaticExtraction, type SourceReader } from '../src/indexer/static/extraction/engine'
import { createTypeScriptStaticSyntaxFrontend } from '../src/indexer/static-index/syntax'
import { mcpStaticFixtureSource } from './mcp-static-fixture'

describe('authored MCP static indexing', () => {
  it('indexes safe authored server facts and partial allowlisted tools without I/O', async () => {
    const extracted = await extract(mcpStaticFixtureSource)
    const servers = extracted.definitions.filter((definition) => definition.kind === 'mcp.server')
    const tools = extracted.definitions.filter((definition) => definition.kind === 'tool')

    expect(
      servers.map((definition) => ({
        id: definition.id,
        name: definition.name,
        facts: definition.metadata?.facts,
        exportName: definition.metadata?.exportName,
        sourceSnippet: definition.sourceSnippet,
      })),
    ).toEqual([
      {
        id: 'mcp.server:Filesystem-Primary',
        name: 'Filesystem / Primary',
        exportName: 'filesystem',
        sourceSnippet: undefined,
        facts: {
          kind: 'mcp.server',
          serverId: 'Filesystem / Primary',
          transport: { kind: 'stdio', executable: 'node' },
          tools: {
            allow: ['read.file', 'write-file'],
            prefix: 'fs_',
          },
        } satisfies McpServerFacts,
      },
      {
        id: 'mcp.server:remote',
        name: 'remote',
        exportName: 'remote',
        sourceSnippet: undefined,
        facts: {
          kind: 'mcp.server',
          serverId: 'remote',
          transport: {
            kind: 'streamable-http',
            origin: 'https://mcp.example.test',
            pathname: '/v1/tools',
          },
          tools: { deny: ['dangerous-tool'] },
        } satisfies McpServerFacts,
      },
      {
        id: 'mcp.server:dynamic',
        name: 'dynamic',
        exportName: 'dynamic',
        sourceSnippet: undefined,
        facts: {
          kind: 'mcp.server',
          serverId: 'dynamic',
          transport: { kind: 'resolver' },
        } satisfies McpServerFacts,
      },
      {
        id: 'mcp.server:opaque',
        name: 'opaque',
        exportName: 'opaque',
        sourceSnippet: undefined,
        facts: {
          kind: 'mcp.server',
          serverId: 'opaque',
          tools: { prefix: 'opaque_' },
        } satisfies McpServerFacts,
      },
      {
        id: 'mcp.server:invalid-http',
        name: 'invalid-http',
        exportName: 'invalidHttp',
        sourceSnippet: undefined,
        facts: {
          kind: 'mcp.server',
          serverId: 'invalid-http',
          transport: { kind: 'streamable-http' },
        } satisfies McpServerFacts,
      },
    ])

    expect(servers.map((definition) => definition.metadata?.runtimeJoin)).toEqual([
      expect.objectContaining({
        definitionId: 'mcp.server:Filesystem-Primary',
        kind: 'mcp.server',
        primitive: 'mcp.connect',
        serverId: 'Filesystem / Primary',
        spanAttributes: { serverId: 'Filesystem / Primary' },
      }),
      expect.objectContaining({
        definitionId: 'mcp.server:remote',
        kind: 'mcp.server',
        primitive: 'mcp.connect',
        serverId: 'remote',
        spanAttributes: { serverId: 'remote' },
      }),
      expect.objectContaining({
        definitionId: 'mcp.server:dynamic',
        kind: 'mcp.server',
        primitive: 'mcp.connect',
        serverId: 'dynamic',
        spanAttributes: { serverId: 'dynamic' },
      }),
      expect.objectContaining({
        definitionId: 'mcp.server:opaque',
        kind: 'mcp.server',
        primitive: 'mcp.connect',
        serverId: 'opaque',
        spanAttributes: { serverId: 'opaque' },
      }),
      expect.objectContaining({
        definitionId: 'mcp.server:invalid-http',
        kind: 'mcp.server',
        primitive: 'mcp.connect',
        serverId: 'invalid-http',
        spanAttributes: { serverId: 'invalid-http' },
      }),
    ])

    expect(tools).toEqual([
      expect.objectContaining({
        id: 'tool:fs_read.file',
        kind: 'tool',
        name: 'fs_read.file',
        fidelity: 'partial',
        metadata: {
          facts: {
            kind: 'tool',
            toolName: 'fs_read.file',
            mcp: {
              serverId: 'Filesystem / Primary',
              remoteName: 'read.file',
              exposedName: 'fs_read.file',
              provenance: 'authored-expected',
            },
          } satisfies ToolFacts,
        },
      }),
      expect.objectContaining({
        id: 'tool:fs_write-file',
        kind: 'tool',
        name: 'fs_write-file',
        fidelity: 'partial',
        metadata: {
          facts: {
            kind: 'tool',
            toolName: 'fs_write-file',
            mcp: {
              serverId: 'Filesystem / Primary',
              remoteName: 'write-file',
              exposedName: 'fs_write-file',
              provenance: 'authored-expected',
            },
          } satisfies ToolFacts,
        },
      }),
    ])
    for (const tool of tools) {
      expect(tool).not.toHaveProperty('status')
      expect(tool).not.toHaveProperty('description')
      expect(tool).not.toHaveProperty('sourceSnippet')
      expect(tool.metadata).not.toHaveProperty('inputSchema')
      expect(tool.metadata).not.toHaveProperty('outputSchema')
      expect(tool.metadata?.facts).not.toHaveProperty('hasExecute')
    }

    expect(extracted.relations).toEqual([
      expect.objectContaining({
        type: 'mcp.server.provides_tool',
        from: 'mcp.server:Filesystem-Primary',
        to: 'tool:fs_read.file',
      }),
      expect.objectContaining({
        type: 'mcp.server.provides_tool',
        from: 'mcp.server:Filesystem-Primary',
        to: 'tool:fs_write-file',
      }),
    ])
    expect(JSON.stringify(extracted)).not.toMatch(/SECRET_|password|private-server|private\/workspace|Authorization/)
  })
})

async function extract(source: string) {
  const file = '/fixture/mcp.ts'
  const reader: SourceReader = {
    read: async (requested) => {
      if (requested !== file) throw new Error(`Unexpected source: ${requested}`)
      return source
    },
  }
  return createStaticExtraction({
    root: '/fixture',
    cache: 'none',
    sources: reader,
    syntaxFrontend: createTypeScriptStaticSyntaxFrontend,
  }).extractFile(file)
}
