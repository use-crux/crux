import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { McpPreparationView, McpToolOriginView } from '../lib/mcp'
import { McpPreparation, McpToolOrigin } from './McpPreparation'

describe('MCP Run Detail components', () => {
  it('renders an accessible preparation summary and exact Catalog target', () => {
    const view: McpPreparationView = {
      nodeId: 'node:discover',
      spanId: 'span:discover',
      phase: 'discover',
      status: 'ok',
      startedAt: '2026-07-14T10:00:02.000Z',
      durationMs: 18,
      sourceId: 'billing',
      sourceSessionId: 'session-1',
      discoveredToolCount: 3,
      exposedToolCount: 2,
      toolListFingerprint: 'sha256:tools',
      server: {
        label: 'mcp.server',
        value: 'mcp.server:billing',
        kind: 'mcp.server',
        role: 'resolved-mcp-server',
        resolved: true,
        to: { view: 'library-index', promptId: 'mcp.server:billing' },
      },
    }

    const html = renderToStaticMarkup(<McpPreparation view={view} />)
    expect(html).toContain('aria-label="MCP discovery preparation"')
    expect(html).toContain('Discovered')
    expect(html).toContain('>3</span>')
    expect(html).toContain('Exposed')
    expect(html).toContain('>2</span>')
    expect(html).toContain('18ms')
    expect(html).toContain('mcp.server:billing')
  })

  it('badges an ordinary tool call with remote/exposed identity', () => {
    const origin: McpToolOriginView = {
      sourceId: 'billing',
      sourceSessionId: 'session-1',
      remoteName: 'lookup_invoice',
      exposedName: 'billing_lookup_invoice',
      discoverSpanId: 'span:discover',
    }
    const html = renderToStaticMarkup(<McpToolOrigin origin={origin} />)
    expect(html).toContain('MCP')
    expect(html).toContain('lookup_invoice')
    expect(html).toContain('billing_lookup_invoice')
  })
})
