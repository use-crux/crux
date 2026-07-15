import { describe, expect, it } from 'vitest'
import type { ProjectIndexData } from '@/types'
import { buildIndex } from './adapt'
import { mcpCatalogView } from './mcp-catalog'

const indexData = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: 'mcp.server:billing',
      kind: 'mcp.server',
      name: 'billing',
      fidelity: 'partial',
      fingerprint: 'server-fingerprint',
      metadata: {
        facts: {
          kind: 'mcp.server',
          serverId: 'billing',
          transport: {
            kind: 'streamable-http',
            origin: 'https://mcp.example.test',
            pathname: '/rpc',
          },
          tools: { allow: ['lookup', 'refund'], prefix: 'billing_' },
        },
        runtimeOverlay: {
          status: 'error',
          observedAt: '2026-07-14T10:00:00.000Z',
          error: { phase: 'discover', category: 'schema' },
          lastSuccessfulDiscovery: {
            observedAt: '2026-07-14T09:59:00.000Z',
            implementation: 'official-client',
            protocolVersion: '2025-06-18',
            server: {
              untrusted: true,
              name: 'Billing MCP',
              version: '1.2.0',
            },
          },
        },
      },
    },
    {
      id: 'tool:billing_lookup',
      kind: 'tool',
      name: 'billing_lookup',
      fidelity: 'resolved',
      status: 'stale',
      fingerprint: 'tool-fingerprint',
      metadata: {
        inputSchema: {
          type: 'object',
          properties: { invoiceId: { type: 'string' } },
          required: ['invoiceId'],
        },
        facts: {
          kind: 'tool',
          toolName: 'billing_lookup',
          mcp: {
            serverId: 'billing',
            remoteName: 'lookup',
            exposedName: 'billing_lookup',
            provenance: 'runtime-discovered',
          },
        },
        mcpDiscovery: {
          observedAt: '2026-07-14T09:59:00.000Z',
          toolListFingerprint: 'sha256:list',
          inputSchemaFingerprint: 'sha256:input',
          annotations: {
            untrusted: true,
            value: { readOnlyHint: true, title: 'Secret secret-canary' },
          },
        },
      },
    },
    {
      id: 'tool:billing_refund',
      kind: 'tool',
      name: 'billing_refund',
      fidelity: 'partial',
      metadata: {
        facts: {
          kind: 'tool',
          toolName: 'billing_refund',
          mcp: {
            serverId: 'billing',
            remoteName: 'refund',
            exposedName: 'billing_refund',
            provenance: 'authored-expected',
          },
        },
      },
    },
  ],
  relations: [
    {
      id: 'rel:lookup',
      type: 'mcp.server.provides_tool',
      from: 'mcp.server:billing',
      to: 'tool:billing_lookup',
      fidelity: 'resolved',
    },
    {
      id: 'rel:refund',
      type: 'mcp.server.provides_tool',
      from: 'mcp.server:billing',
      to: 'tool:billing_refund',
      fidelity: 'partial',
    },
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData

describe('MCP Catalog projection', () => {
  it('projects safe server configuration, failure health, and child lifecycle', () => {
    const index = buildIndex(indexData)
    const view = mcpCatalogView(index.byId('mcp.server:billing')!, index)
    expect(view).toEqual(
      expect.objectContaining({
        kind: 'server',
        serverId: 'billing',
        state: 'failed',
        transport: {
          kind: 'streamable-http',
          origin: 'https://mcp.example.test',
          pathname: '/rpc',
        },
        selection: { allow: ['lookup', 'refund'], prefix: 'billing_' },
        failure: { phase: 'discover', category: 'schema' },
        lastSuccessfulDiscovery: {
          observedAt: '2026-07-14T09:59:00.000Z',
          implementation: 'official-client',
          protocolVersion: '2025-06-18',
          server: {
            untrusted: true,
            name: 'Billing MCP',
            version: '1.2.0',
          },
        },
        tools: [
          expect.objectContaining({
            id: 'tool:billing_lookup',
            state: 'stale',
          }),
          expect.objectContaining({
            id: 'tool:billing_refund',
            state: 'partial',
          }),
        ],
      }),
    )
  })

  it('projects exact MCP tool origin, schemas, fingerprints, and untrusted annotations', () => {
    const index = buildIndex(indexData)
    const view = mcpCatalogView(index.byId('tool:billing_lookup')!, index)
    expect(view).toEqual(
      expect.objectContaining({
        kind: 'tool',
        serverDefinitionId: 'mcp.server:billing',
        remoteName: 'lookup',
        exposedName: 'billing_lookup',
        state: 'stale',
        inputSchemaFingerprint: 'sha256:input',
        annotations: expect.objectContaining({
          untrusted: true,
          value: expect.objectContaining({ readOnlyHint: true }),
        }),
      }),
    )
    expect(view).toHaveProperty('inputSchema.properties.invoiceId.type', 'string')
  })

  it('distinguishes never-observed servers and never invents an owner join', () => {
    const index = buildIndex({
      ...indexData,
      definitions: [indexData.definitions[0]!].map((definition) => ({
        ...definition,
        metadata: { facts: definition.metadata.facts },
      })),
      relations: [],
    })
    expect(mcpCatalogView(index.byId('mcp.server:billing')!, index)).toMatchObject({
      kind: 'server',
      state: 'never-observed',
      tools: [],
    })

    const toolIndex = buildIndex({ ...indexData, relations: [] })
    expect(mcpCatalogView(toolIndex.byId('tool:billing_lookup')!, toolIndex)).toMatchObject({
      kind: 'tool',
      serverDefinitionId: undefined,
    })
  })

  it('maps runtime availability to current and removed without a shadow state', () => {
    const currentIndex = buildIndex({
      ...indexData,
      definitions: indexData.definitions.map((definition) =>
        definition.id === 'tool:billing_lookup' ? { ...definition, status: 'active' as const } : definition,
      ),
    })
    expect(mcpCatalogView(currentIndex.byId('tool:billing_lookup')!, currentIndex)).toMatchObject({
      kind: 'tool',
      state: 'current',
    })

    const removedIndex = buildIndex({
      ...indexData,
      definitions: indexData.definitions.map((definition) =>
        definition.id === 'tool:billing_lookup' ? { ...definition, status: 'removed' as const } : definition,
      ),
    })
    expect(mcpCatalogView(removedIndex.byId('tool:billing_lookup')!, removedIndex)).toMatchObject({
      kind: 'tool',
      state: 'removed',
    })
  })

  it('keeps known unsafe annotations labelled and does not project transport secrets', () => {
    const index = buildIndex(indexData)
    const server = mcpCatalogView(index.byId('mcp.server:billing')!, index)
    expect(JSON.stringify(server)).not.toContain('secret-canary')
    expect(JSON.stringify(server)).not.toContain('token=')
  })
})
