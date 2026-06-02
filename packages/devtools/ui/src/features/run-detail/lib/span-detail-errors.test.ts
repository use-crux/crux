import { describe, expect, it } from 'vitest'
import type { ObservabilityRunDetailNode } from '@/types'
import { resolveSpanError } from './span-detail-inspection'

function nodeWith(fields: Record<string, unknown>): ObservabilityRunDetailNode {
  return {
    id: 'span:tool',
    spanId: 'tool',
    runId: 'run',
    traceId: 'trace',
    family: 'tool',
    primitive: 'tool.call',
    name: 'rag.search',
    status: 'error',
    display: { kind: 'tool', label: 'rag.search' },
    timing: {},
    metricBuckets: {},
    source: {},
    details: [],
    artifacts: [],
    events: [],
    relations: [],
    diagnostics: [],
    children: [],
    ...fields,
  } as unknown as ObservabilityRunDetailNode
}

describe('resolveSpanError', () => {
  it('prefers node.error and attaches curated inspection evidence', () => {
    const resolved = resolveSpanError(
      nodeWith({
        error: {
          name: 'ToolExecutionError',
          message: 'tool exploded',
          category: 'tool',
          retryable: false,
        },
        inspection: {
          errors: [
            {
              type: 'artifact',
              id: 'artifact:stack',
              label: 'error.stack',
              kind: 'error.stack',
              sourceSpanId: 'tool',
              data: { stack: 'Error: tool exploded\n    at search.ts:10:3' },
            },
          ],
        },
      }),
    )

    expect(resolved).toMatchObject({
      name: 'ToolExecutionError',
      summary: 'tool exploded',
      category: 'tool',
      retryable: false,
    })
    expect(resolved?.stack).toContain('search.ts:10:3')
    expect(resolved?.evidence[0]).toMatchObject({
      label: 'error.stack',
      kind: 'error.stack',
    })
    expect(resolved?.evidence[0]?.preview).toContain('search.ts:10:3')
  })

  it('falls back to the synthetic inspection span.error item', () => {
    const resolved = resolveSpanError(
      nodeWith({
        inspection: {
          errors: [
            {
              type: 'span.error',
              id: 'error:tool',
              label: 'Span error',
              kind: 'tool.call',
              sourceSpanId: 'tool',
              data: {
                name: 'Error',
                message: 'inspection-only failure',
                phase: 'tool.execute',
              },
            },
          ],
        },
      }),
    )

    expect(resolved).toMatchObject({
      name: 'Error',
      summary: 'inspection-only failure',
      phase: 'tool.execute',
    })
  })

  it('falls back to direct error artifacts for older projections', () => {
    const resolved = resolveSpanError(
      nodeWith({
        artifacts: [
          {
            kind: 'error.stack',
            preview: { stack: 'Error: old projection\n    at legacy.ts:4:1' },
          },
          {
            kind: 'error.raw',
            preview: { message: 'old projection', code: 'E_LEGACY' },
          },
        ],
      }),
    )

    expect(resolved?.summary).toBe('old projection')
    expect(resolved?.code).toBe('E_LEGACY')
    expect(resolved?.stack).toContain('legacy.ts:4:1')
  })
})
