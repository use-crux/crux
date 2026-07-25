/**
 * Adaptive-delta development notice for custom output-text guardrails.
 *
 * On a real stream execution, a custom guardrail (no bundled strategy) that
 * resolves to `{ source: 'adaptive', unit: 'delta' }` emits one dev-only notice
 * per definition. `.deltas()` and any explicit refinement suppress it, bundled
 * strategies suppress it, generate-only execution never emits, and production
 * emits nothing.
 *
 * @module
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'
import { resetAdaptiveDeltaNotices } from '../../src/safety/guardrail/adaptive-notice'
import { resetHooks } from '../../src/runtime/runtime'

let warn: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  resetAdaptiveDeltaNotices()
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  resetHooks()
})

const custom = (id: string, on: Parameters<typeof guardrail>[0]['on']) =>
  guardrail({ id, on: on as never, run: async () => ({ action: 'allow' as const }) })

const stream = (id: string, on: Parameters<typeof guardrail>[0]['on']) =>
  createSafety({ promptId: 'p', model: 'm', call: { guardrails: [custom(id, on)] } }).openStream()

describe('adaptive-delta notice', () => {
  it('emits once for an unrefined custom output-text guardrail on a stream', () => {
    stream('custom-adaptive', boundary.output.text())
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('custom-adaptive')
    expect(String(warn.mock.calls[0]?.[0])).toContain('delta')
  })

  it('deduplicates once per guardrail definition across streams', () => {
    const guard = custom('dedup-id', boundary.output.text())
    createSafety({ promptId: 'p', model: 'm', call: { guardrails: [guard] } }).openStream()
    createSafety({ promptId: 'p', model: 'm', call: { guardrails: [guard] } }).openStream()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not warn when the boundary is explicitly refined with .deltas()', () => {
    stream('explicit-deltas', boundary.output.text().deltas())
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn for a sentence-refined boundary', () => {
    stream('sentence-refined', boundary.output.text().sentences())
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn for a bundled strategy guardrail (has semantic default)', () => {
    const pii = guardrail({ id: 'pii', on: boundary.output.text(), run: guardrail.pii() })
    createSafety({ promptId: 'p', model: 'm', call: { guardrails: [pii] } }).openStream()
    expect(warn).not.toHaveBeenCalled()
  })

  it('does not warn during generate-only execution', async () => {
    const guard = custom('generate-only', boundary.output.text())
    const safety = createSafety({ promptId: 'p', model: 'm', call: { guardrails: [guard] } })
    await safety.guardOutputTextParts(['some complete text'])
    expect(warn).not.toHaveBeenCalled()
  })

  it('emits nothing in production', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      stream('prod-guard', boundary.output.text())
      expect(warn).not.toHaveBeenCalled()
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})
