import { describe, expect, it } from 'vitest'
import type { ObservabilityRunDetailNode } from '@/types'
import { mcpPreparationForRun, mcpToolOrigin } from './mcp'

function node(primitive: string, fields: Record<string, unknown> = {}): ObservabilityRunDetailNode {
  return {
    id: `node:${primitive}`,
    spanId: `span:${primitive}`,
    runId: 'run:mcp',
    traceId: 'trace:mcp',
    parentSpanId: '',
    family: primitive.startsWith('mcp.') ? 'mcp' : 'generation',
    primitive,
    name: primitive,
    status: 'ok',
    startedAt: '2026-07-14T10:00:00.000Z',
    endedAt: '2026-07-14T10:00:00.010Z',
    durationMs: 10,
    model: '',
    provider: '',
    virtual: false,
    parentId: '',
    path: [],
    kind: 'span',
    display: { kind: 'operation', label: primitive },
    timing: { durationMs: 10, selfMs: 10, childrenMs: 0, detailsMs: 0 },
    metricBuckets: {},
    source: { placementReason: 'root' },
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
    ...fields,
  } as unknown as ObservabilityRunDetailNode
}

describe('MCP Run Detail projection', () => {
  it('orders preparation chronologically and resolves only exact server refs', () => {
    const serverRef = {
      id: 'mcp.server:billing',
      kind: 'mcp.server',
      role: 'resolved-mcp-server',
    } as const
    const root = node('agent.run', {
      children: [
        node('generation.call', {
          startedAt: '2026-07-14T10:00:03.000Z',
        }),
        node('mcp.discover', {
          startedAt: '2026-07-14T10:00:02.000Z',
          attributes: {
            sourceId: 'billing',
            sourceSessionId: 'session-1',
            discoveredToolCount: 3,
            exposedToolCount: 2,
            toolListFingerprint: 'sha256:tools',
          },
          definitionRefs: [serverRef],
        }),
        node('mcp.connect', {
          startedAt: '2026-07-14T10:00:01.000Z',
          attributes: {
            sourceId: 'billing',
            sourceSessionId: 'session-1',
            implementation: 'official-client',
            transport: 'streamable-http',
            protocolVersion: '2025-11-25',
          },
          definitionRefs: [serverRef],
        }),
      ],
    })

    expect(mcpPreparationForRun(root, new Set(['mcp.server:billing']))).toEqual([
      expect.objectContaining({
        phase: 'connect',
        sourceId: 'billing',
        implementation: 'official-client',
        server: expect.objectContaining({
          value: 'mcp.server:billing',
          resolved: true,
        }),
      }),
      expect.objectContaining({
        phase: 'discover',
        discoveredToolCount: 3,
        exposedToolCount: 2,
        toolListFingerprint: 'sha256:tools',
      }),
    ])
  })

  it('projects an MCP call as an ordinary tool with exact server/tool links', () => {
    const call = node('tool.call', {
      toolName: 'billing_lookup_invoice',
      attributes: {
        sourceKind: 'mcp',
        sourceId: 'billing',
        sourceSessionId: 'session-1',
        remoteName: 'lookup_invoice',
        exposedName: 'billing_lookup_invoice',
        discoverSpanId: 'span:mcp.discover',
      },
      definitionRefs: [
        {
          id: 'mcp.server:billing',
          kind: 'mcp.server',
          role: 'resolved-mcp-server',
        },
        {
          id: 'tool:billing_lookup_invoice',
          kind: 'tool',
          role: 'invoked-tool',
        },
      ],
    })

    expect(mcpToolOrigin(call, new Set(['mcp.server:billing', 'tool:billing_lookup_invoice']))).toEqual({
      sourceId: 'billing',
      sourceSessionId: 'session-1',
      remoteName: 'lookup_invoice',
      exposedName: 'billing_lookup_invoice',
      discoverSpanId: 'span:mcp.discover',
      server: expect.objectContaining({ value: 'mcp.server:billing' }),
      tool: expect.objectContaining({ value: 'tool:billing_lookup_invoice' }),
    })
  })

  it('keeps a failed preparation visible without exposing a raw error', () => {
    const failed = node('mcp.discover', {
      status: 'error',
      attributes: {
        sourceId: 'billing',
        sourceSessionId: 'session-1',
        failurePhase: 'discover',
      },
      error: {
        message: 'MCP discovery failed',
        category: 'schema_validation',
        cause: 'https://example.test?token=secret-canary',
      },
      definitionRefs: [
        {
          id: 'mcp.server:billing',
          kind: 'mcp.server',
          role: 'resolved-mcp-server',
        },
      ],
    })

    const [view] = mcpPreparationForRun(node('agent.run', { children: [failed] }), new Set(['mcp.server:billing']))
    expect(view).toMatchObject({
      phase: 'discover',
      status: 'error',
      failurePhase: 'discover',
      errorCategory: 'schema_validation',
    })
    expect(JSON.stringify(view)).not.toContain('secret-canary')
  })
})
