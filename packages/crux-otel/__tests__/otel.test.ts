import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetRuntime, getRuntime, prompt as cruxPrompt } from '@crux/core'
import { configure } from '../../crux-core/configure'
import { withTelemetry } from '../index'
import { createCallbackExporter, createUrlExporter } from '../exporter'
import type { TraceSpan } from '../types'

function makePrompt(id: string) {
  return cruxPrompt({ id, system: `Prompt ${id}` })
}

function makeSpan(overrides?: Partial<TraceSpan>): TraceSpan {
  return {
    spanId: 's1',
    traceId: 't1',
    name: 'crux.generate',
    startTime: 1000,
    endTime: 1100,
    durationMs: 100,
    attributes: {},
    status: { code: 'OK' },
    ...overrides,
  }
}

describe('withTelemetry', () => {
  beforeEach(() => {
    resetRuntime()
  })

  it('returns a CruxPlugin with name crux:otel', () => {
    const plugin = withTelemetry()

    expect(plugin.name).toBe('crux:otel')
    expect(typeof plugin.install).toBe('function')
  })

  it('installs via configure() without errors', () => {
    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [withTelemetry({ serviceName: 'test-app' })],
    })

    expect(reg.get('a')).toBeDefined()
    reg.dispose()
  })

  it('can coexist with other plugins', () => {
    const hook = vi.fn()
    const otherPlugin = {
      name: 'other',
      install: () => ({ instrumentationHooks: { onToolStart: hook } }),
    }

    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [withTelemetry(), otherPlugin],
    })

    // Other plugin's hook should still work
    getRuntime().instrumentationHooks?.onToolStart?.({
      toolCallId: 'tc1',
      toolName: 'test',
      args: {},
    })
    expect(hook).toHaveBeenCalled()

    reg.dispose()
  })

  it('exports privacy-safe RAG eval summary spans', () => {
    const received: TraceSpan[] = []
    const reg = configure({
      prompts: [makePrompt('a')],
      plugins: [
        withTelemetry({
          exporter: (spans) => {
            received.push(...spans)
          },
        }),
      ],
    })

    const reporter = getRuntime().ragEvalReporter
    expect(reporter).toBeDefined()
    reporter?.onStart({ evalId: 'rag-docs', datasetId: 'docs', caseCount: 1 })
    reporter?.onEnd({
      evalId: 'rag-docs',
      status: 'success',
      summary: {
        total: 1,
        passed: 0,
        failed: 1,
        passRate: 0,
        byFailureType: {
          retrieval_miss: 1,
          low_precision: 0,
          invalid_citation: 0,
          unsupported_answer: 0,
          judge_failed: 0,
          timeout: 0,
          error: 0,
        },
        failureGroups: [{ type: 'retrieval_miss', count: 1, caseIds: ['case-1'] }],
        retrieval: {
          hitRateAtK: { 5: 0 },
          recallAtK: { 5: 0 },
          precisionAtK: { 5: 0 },
          mrr: 0,
          ndcg: 0,
        },
        citations: { validityRate: 1 },
      },
    })

    expect(received).toHaveLength(1)
    expect(received[0].name).toBe('crux.rag_eval')
    expect(received[0].attributes).toMatchObject({
      'crux.rag_eval.id': 'rag-docs',
      'crux.rag_eval.dataset_id': 'docs',
      'crux.rag_eval.case_count': 1,
      'crux.rag_eval.failed_count': 1,
      'crux.rag_eval.failure.retrieval_miss_count': 1,
      'crux.rag_eval.retrieval.recall_at_5': 0,
      'crux.rag_eval.citations.validity_rate': 1,
    })
    expect(JSON.stringify(received[0])).not.toContain('case-1')

    reg.dispose()
  })
})

describe('createCallbackExporter', () => {
  it('delivers spans to the callback', async () => {
    const received: TraceSpan[] = []
    const exporter = createCallbackExporter((spans) => {
      received.push(...spans)
    })

    const span = makeSpan()
    await exporter.export([span])

    expect(received).toHaveLength(1)
    expect(received[0].name).toBe('crux.generate')
  })

  it('ignores empty batches', async () => {
    const callback = vi.fn()
    const exporter = createCallbackExporter(callback)

    await exporter.export([])

    expect(callback).not.toHaveBeenCalled()
  })

  it('silently ignores callback errors', async () => {
    const exporter = createCallbackExporter(() => {
      throw new Error('callback failed')
    })

    // Should not throw
    await expect(exporter.export([makeSpan()])).resolves.toBeUndefined()
  })

  it('stops exporting after shutdown', async () => {
    const callback = vi.fn()
    const exporter = createCallbackExporter(callback)

    await exporter.shutdown()
    await exporter.export([makeSpan()])

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('createUrlExporter', () => {
  it('POSTs spans as JSON to the configured URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    const exporter = createUrlExporter({
      url: 'https://collector.example.com/v1/traces',
      headers: { 'X-Api-Key': 'test-key' },
    })

    const span = makeSpan()
    await exporter.export([span])

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://collector.example.com/v1/traces',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Api-Key': 'test-key',
        }),
        body: JSON.stringify([span]),
      }),
    )

    fetchSpy.mockRestore()
  })

  it('silently ignores fetch errors', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    const exporter = createUrlExporter({ url: 'https://fail.example.com' })

    await expect(exporter.export([makeSpan()])).resolves.toBeUndefined()

    fetchSpy.mockRestore()
  })

  it('stops exporting after shutdown', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response())

    const exporter = createUrlExporter({ url: 'https://example.com' })
    await exporter.shutdown()
    await exporter.export([makeSpan()])

    expect(fetchSpy).not.toHaveBeenCalled()

    fetchSpy.mockRestore()
  })
})
