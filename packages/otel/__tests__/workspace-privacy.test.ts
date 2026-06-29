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
})
