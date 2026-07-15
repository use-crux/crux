import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProjectIndexData } from '@/types'
import { buildIndex } from './adapt'
import { IndexIndexProvider, IndexSelectProvider } from './context'
import { IndexMcpDetail } from './mcp-detail'

const data = {
  prompts: [],
  contexts: [],
  tools: [],
  definitions: [
    {
      id: 'mcp.server:billing',
      kind: 'mcp.server',
      name: 'billing',
      fidelity: 'partial',
      metadata: {
        facts: {
          kind: 'mcp.server',
          serverId: 'billing',
          transport: { kind: 'stdio', executable: 'billing-mcp' },
          tools: { allow: ['lookup'], prefix: 'billing_' },
        },
        runtimeOverlay: {
          status: 'ok',
          observedAt: '2026-07-14T10:00:00.000Z',
          revision: 'sha256:list',
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
        ignoredSecret: 'secret-canary',
      },
    },
    {
      id: 'tool:billing_lookup',
      kind: 'tool',
      name: 'billing_lookup',
      fidelity: 'resolved',
      status: 'active',
      metadata: {
        inputSchema: {
          type: 'object',
          properties: { invoiceId: { type: 'string' } },
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
          observedAt: '2026-07-14T10:00:00.000Z',
          toolListFingerprint: 'sha256:list',
          inputSchemaFingerprint: 'sha256:input',
          annotations: {
            untrusted: true,
            value: { title: 'Invoice lookup', readOnlyHint: true },
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
  ],
  diagnostics: [],
  lintFindings: [],
  sources: [],
} satisfies ProjectIndexData

function render(definitionId: string): string {
  const index = buildIndex(data)
  return renderToStaticMarkup(
    <IndexIndexProvider index={index}>
      <IndexSelectProvider select={() => undefined}>
        <IndexMcpDetail def={index.byId(definitionId)!} />
      </IndexSelectProvider>
    </IndexIndexProvider>,
  )
}

describe('MCP Catalog detail', () => {
  it('renders server configuration, health, selection, and owned tools', () => {
    const html = render('mcp.server:billing')
    expect(html).toContain('MCP server')
    expect(html).toContain('billing-mcp')
    expect(html).toContain('billing_')
    expect(html).toContain('Current')
    expect(html).toContain('tool:billing_lookup')
    expect(html).toContain('official-client')
    expect(html).toContain('Billing MCP')
    expect(html).toContain('untrusted')
    expect(html).not.toContain('secret-canary')
  })

  it('renders ordinary-tool MCP origin, schema identity, and untrusted annotations', () => {
    const html = render('tool:billing_lookup')
    expect(html).toContain('MCP origin')
    expect(html).toContain('mcp.server:billing')
    expect(html).toContain('lookup')
    expect(html).toContain('billing_lookup')
    expect(html).toContain('sha256:input')
    expect(html).toContain('invoiceId')
    expect(html).toContain('Untrusted server annotation')
  })
})
