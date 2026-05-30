import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, getRuntime, setRuntime } from '@crux/core'
import type { CruxRuntime } from '@crux/core'
import { withTelemetry } from '../index'
import type { TraceSpan } from '../types'

describe('OTel middleware — generate spans', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('creates a span with name crux.generate for each generate() call', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      serviceName: 'test',
      exporter: (s) => {
        spans.push(...s)
      },
    })

    const result = plugin.install({})
    setRuntime({ ...result })

    // Simulate a generate() call through the middleware
    const mockResult = {
      text: 'Hello',
      _meta: {
        usage: { inputTokens: 10, outputTokens: 5 },
        finishReason: 'stop',
        cost: 0.001,
      },
    }

    const mockNext = vi.fn().mockResolvedValue(mockResult)
    await result.middleware!(
      {
        promptId: 'test-prompt',
        preparedArgs: {
          model: { provider: 'openai', modelId: 'gpt-4o' },
        },
      },
      mockNext,
    )

    expect(spans).toHaveLength(1)
    expect(spans[0].name).toBe('crux.generate')
    expect(spans[0].attributes['gen_ai.system']).toBe('openai')
    expect(spans[0].attributes['gen_ai.request.model']).toBe('gpt-4o')
    expect(spans[0].attributes['crux.prompt.id']).toBe('test-prompt')
  })

  it('records token usage and cost as span attributes', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { middleware } = plugin.install({})

    await middleware!(
      { promptId: 'p', preparedArgs: { model: 'openai:gpt-4o' } },
      vi.fn().mockResolvedValue({
        _meta: {
          usage: { inputTokens: 100, outputTokens: 50 },
          cost: 0.005,
          finishReason: 'stop',
          actualModelId: 'gpt-4o-2024-08-06',
        },
      }),
    )

    expect(spans[0].attributes['gen_ai.usage.input_tokens']).toBe(100)
    expect(spans[0].attributes['gen_ai.usage.output_tokens']).toBe(50)
    expect(spans[0].attributes['crux.cost']).toBe(0.005)
    expect(spans[0].attributes['gen_ai.response.finish_reasons']).toBe('stop')
    expect(spans[0].attributes['gen_ai.response.model']).toBe('gpt-4o-2024-08-06')
  })

  it('sets span status to ERROR when generate throws', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { middleware } = plugin.install({})

    const error = new Error('Rate limit exceeded')
    await expect(
      middleware!({ promptId: 'p', preparedArgs: { model: 'openai:gpt-4o' } }, vi.fn().mockRejectedValue(error)),
    ).rejects.toThrow('Rate limit exceeded')

    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('Rate limit exceeded')
    // Should have an exception event
    expect(spans[0].events).toBeDefined()
    expect(spans[0].events![0].name).toBe('exception')
  })

  it('defers span end for streaming until stream completes', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { middleware } = plugin.install({})

    let resolveStream!: (value: unknown) => void
    const streamCompletion = new Promise((resolve) => {
      resolveStream = resolve
    })

    await middleware!(
      {
        promptId: 'p',
        preparedArgs: { model: 'anthropic:claude-sonnet-4-20250514' },
      },
      vi.fn().mockResolvedValue({
        _meta: {
          _streamCompletion: streamCompletion,
        },
      }),
    )

    // Span should NOT be exported yet (stream still in progress)
    expect(spans).toHaveLength(0)

    // Complete the stream
    resolveStream({
      usage: { inputTokens: 200, outputTokens: 100 },
      finishReason: 'end_turn',
      cost: 0.01,
    })

    // Wait for the promise chain to resolve
    await new Promise((r) => setTimeout(r, 10))

    expect(spans).toHaveLength(1)
    expect(spans[0].attributes['gen_ai.usage.input_tokens']).toBe(200)
    expect(spans[0].attributes['gen_ai.usage.output_tokens']).toBe(100)
    expect(spans[0].status.code).toBe('OK')
  })

  it('records error when stream fails', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { middleware } = plugin.install({})

    let rejectStream!: (reason: unknown) => void
    const streamCompletion = new Promise((_, reject) => {
      rejectStream = reject
    })

    await middleware!(
      { promptId: 'p', preparedArgs: { model: 'openai:gpt-4o' } },
      vi.fn().mockResolvedValue({
        _meta: { _streamCompletion: streamCompletion },
      }),
    )

    rejectStream(new Error('Connection reset'))
    await new Promise((r) => setTimeout(r, 10))

    expect(spans).toHaveLength(1)
    expect(spans[0].status.code).toBe('ERROR')
    expect(spans[0].status.message).toBe('Connection reset')
  })

  it('parses string model format (provider:modelId)', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
    })
    const { middleware } = plugin.install({})

    await middleware!(
      {
        promptId: 'p',
        preparedArgs: { model: 'anthropic:claude-sonnet-4-20250514' },
      },
      vi.fn().mockResolvedValue({ _meta: {} }),
    )

    expect(spans[0].attributes['gen_ai.system']).toBe('anthropic')
    expect(spans[0].attributes['gen_ai.request.model']).toBe('claude-sonnet-4-20250514')
  })

  it('includes custom attributes from options', async () => {
    const spans: TraceSpan[] = []
    const plugin = withTelemetry({
      exporter: (s) => {
        spans.push(...s)
      },
      attributes: { 'deployment.environment': 'staging' },
    })
    const { middleware } = plugin.install({})

    await middleware!(
      { promptId: 'p', preparedArgs: { model: 'openai:gpt-4o' } },
      vi.fn().mockResolvedValue({ _meta: {} }),
    )

    expect(spans[0].attributes['deployment.environment']).toBe('staging')
  })
})
