import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime } from '@crux/core'
import { withTelemetry } from '../index'
import type { TraceSpan } from '../types'

describe('Context bridge — span lifecycle and isolation', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('tool span created after generate span gets correct tracking', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const result = plugin.install({})

    // Simulate generate → tool flow
    const mockNext = vi.fn().mockResolvedValue({ _meta: {} })
    await result.middleware!({ promptId: 'p1', preparedArgs: { model: 'openai:gpt-4o' } }, mockNext)

    result.instrumentationHooks!.onToolStart!({
      toolCallId: 'tc1',
      toolName: 'search',
      args: {},
    })
    result.instrumentationHooks!.onToolEnd!({
      toolCallId: 'tc1',
      toolName: 'search',
      durationMs: 100,
    })

    // Should have 2 spans: generate + tool
    expect(spans).toHaveLength(2)
    expect(spans.map((s) => s.name)).toContain('crux.generate')
    expect(spans.map((s) => s.name)).toContain('crux.tool.search')
  })

  it('concurrent flows produce independent spans', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    // Start two concurrent flows
    hooks!.onFlowStart!({ flowId: 'f1', name: 'pipeline-A', startedAt: 1 })
    hooks!.onFlowStart!({ flowId: 'f2', name: 'pipeline-B', startedAt: 2 })

    // Steps in different flows
    hooks!.onStepStart!({ flowId: 'f1', stepId: 's1', label: 'step-A1' })
    hooks!.onStepStart!({ flowId: 'f2', stepId: 's2', label: 'step-B1' })

    // End steps
    hooks!.onStepEnd!({
      flowId: 'f1',
      stepId: 's1',
      label: 'step-A1',
      status: 'success',
      durationMs: 100,
    })
    hooks!.onStepEnd!({
      flowId: 'f2',
      stepId: 's2',
      label: 'step-B1',
      status: 'success',
      durationMs: 200,
    })

    // End flows
    hooks!.onFlowEnd!({
      flowId: 'f1',
      name: 'pipeline-A',
      status: 'success',
      durationMs: 300,
      totalSteps: 1,
    })
    hooks!.onFlowEnd!({
      flowId: 'f2',
      name: 'pipeline-B',
      status: 'success',
      durationMs: 400,
      totalSteps: 1,
    })

    // Should have 4 spans: 2 flows + 2 steps, no cross-contamination
    expect(spans).toHaveLength(4)
    const flowSpans = spans.filter((s) => s.name === 'crux.flow')
    const stepSpans = spans.filter((s) => s.name === 'crux.flow.step')
    expect(flowSpans).toHaveLength(2)
    expect(stepSpans).toHaveLength(2)
    expect(flowSpans[0].attributes['crux.flow.name']).toBe('pipeline-A')
    expect(flowSpans[1].attributes['crux.flow.name']).toBe('pipeline-B')
  })

  it('ending a flow does not affect other active flows', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onFlowStart!({ flowId: 'f1', name: 'A', startedAt: 1 })
    hooks!.onFlowStart!({ flowId: 'f2', name: 'B', startedAt: 2 })

    // End f1 — f2 should still be active
    hooks!.onFlowEnd!({
      flowId: 'f1',
      name: 'A',
      status: 'success',
      durationMs: 100,
      totalSteps: 0,
    })

    // Ending f1 exported one span
    expect(spans).toHaveLength(1)
    expect(spans[0].attributes['crux.flow.name']).toBe('A')

    // f2 can still end normally
    hooks!.onFlowEnd!({
      flowId: 'f2',
      name: 'B',
      status: 'success',
      durationMs: 200,
      totalSteps: 0,
    })
    expect(spans).toHaveLength(2)
    expect(spans[1].attributes['crux.flow.name']).toBe('B')
  })

  it('dispose clears span manager state', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const result = plugin.install({})

    // Start a flow but don't end it
    result.instrumentationHooks!.onFlowStart!({ flowId: 'f1', name: 'A', startedAt: 1 })

    // Dispose — should not crash even with dangling spans
    await result.dispose!()

    // Starting new operations after dispose should not crash
    // (exporter is shut down so nothing is exported)
  })

  it('duplicate end calls are safely ignored', () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { instrumentationHooks: hooks } = plugin.install({})

    hooks!.onFlowStart!({ flowId: 'f1', name: 'A', startedAt: 1 })
    hooks!.onFlowEnd!({
      flowId: 'f1',
      name: 'A',
      status: 'success',
      durationMs: 100,
      totalSteps: 0,
    })

    // Second end — should be a no-op
    hooks!.onFlowEnd!({
      flowId: 'f1',
      name: 'A',
      status: 'success',
      durationMs: 100,
      totalSteps: 0,
    })

    expect(spans).toHaveLength(1)
  })
})
