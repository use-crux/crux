import { afterEach, describe, expect, it } from 'vitest'
import { resetObservabilityRuntime } from '@use-crux/core/observability'
import { inMemoryDataStore, workspace } from '@use-crux/core'
import { withTelemetry } from '../index'
import type { TraceSpan } from '../types'

describe('workspace OTel privacy', () => {
  afterEach(() => {
    resetObservabilityRuntime()
  })

  it('maps workspace paths to hashes without exposing raw path attributes', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      data: inMemoryDataStore(),
    })

    await ws.write('/workspace/secret-name.md', 'classified')
    installed.dispose?.()

    const workspaceSpan = spans.find((span) => span.name === 'crux.workspace')

    expect(workspaceSpan).toBeDefined()
    expect(Object.values(workspaceSpan?.attributes ?? {})).not.toContain('/workspace/secret-name.md')
    expect(workspaceSpan?.attributes).toMatchObject({
      'crux.workspace.path_hash': expect.stringMatching(/^fnv1a:/),
    })
  })

  it('maps every workspace operation to operation and path hash attributes', async () => {
    const spans: TraceSpan[] = []
    const installed = withTelemetry({
      exporter: (batch) => {
        spans.push(...batch)
      },
    }).install({})
    const ws = workspace({
      id: 'research',
      namespace: 'thread:1',
      data: inMemoryDataStore(),
    })

    await ws.write('/workspace/a.md', 'alpha')
    await ws.read('/workspace/a.md')
    await ws.list('/workspace')
    await ws.exists('/workspace/a.md')
    await ws.stat('/workspace/a.md')
    await ws.append('/workspace/a.md', '\nbeta')
    await ws.edit('/workspace/a.md', { find: 'beta', replace: 'gamma' })
    await ws.copy('/workspace/a.md', '/workspace/copy.md')
    await ws.rename('/workspace/copy.md', '/workspace/moved.md')
    await ws.grep('alpha', { path: '/workspace/**/*.md' })
    await ws.write('/outputs/report.md', '# Report', { status: 'draft', kind: 'report' })
    await ws.artifacts()
    await ws.finalize('/outputs/report.md')
    await ws.delete('/workspace/moved.md')
    await new Promise((resolve) => setTimeout(resolve, 0))
    installed.dispose?.()

    const byOperation = new Map(
      spans
        .filter((span) => span.name === 'crux.workspace')
        .map((span) => [span.attributes['crux.workspace.operation'], span]),
    )

    for (const operation of [
      'list',
      'read',
      'write',
      'edit',
      'delete',
      'exists',
      'stat',
      'append',
      'rename',
      'copy',
      'grep',
      'artifacts',
      'finalize',
    ] as const) {
      expect(byOperation.get(operation)?.attributes).toMatchObject({
        'crux.workspace.operation': operation,
        'crux.workspace.path_hash': expect.stringMatching(/^fnv1a:/),
      })
    }
    for (const rawPath of ['/workspace/a.md', '/workspace/copy.md', '/workspace/moved.md', '/outputs/report.md']) {
      expect(spans.flatMap((span) => Object.values(span.attributes))).not.toContain(rawPath)
    }
  })
})
