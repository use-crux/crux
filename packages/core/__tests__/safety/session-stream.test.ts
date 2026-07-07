/**
 * Boundary tests for the `Safety` streaming sub-protocol (`openStream()`):
 * the "LLM Suspense" pattern — hold buffers, mid-stream transforms,
 * full-buffer flush validation, report-only constraints at finish.
 */

import { afterEach, describe, it, expect } from 'vitest'
import { createSafety, GuardrailBlockedError, ConstraintViolationError } from '../../safety'
import type { SafetyCallOptions } from '../../safety'
import { guardrail } from '../../safety/guardrail'
import { constraint } from '../../safety/constraint'
import { resetHooks } from '../../runtime/runtime'

afterEach(() => {
  resetHooks()
})

const session = (options?: Partial<SafetyCallOptions>) => createSafety({ promptId: 'p1', model: 'm1', ...options })

// ── hold / release ─────────────────────────────────────────────────

describe('openStream — hold and release', () => {
  it('a hold verdict buffers and emits nothing; the next verdict releases held + new content in order', async () => {
    // Holds any chunk ending mid-word (no trailing space), passes otherwise.
    const sentenceGuard = guardrail({
      name: 'sentence',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) => (chunk.endsWith(' ') ? { action: 'pass' as const } : { action: 'hold' as const }),
    })
    const stream = session({ call: { guardrails: [sentenceGuard] } }).openStream()

    expect(await stream.feed('Hel')).toEqual({ kind: 'hold' })
    expect(await stream.feed('lo ')).toEqual({ kind: 'emit', content: 'Hello ' })
  })

    it('an async onChunk fix round-trips: hold, then release corrected content', async () => {
    // The v0 LLM Suspense pattern: hold a suspicious import line, look up
    // the real path "asynchronously", release the corrected content.
    const importFixer = guardrail({
      name: 'import-fixer',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) => {
        if (chunk.includes('@/comps/')) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return { action: 'transform' as const, content: chunk.replace('@/comps/', '@/components/') }
        }
        if (chunk.includes('@/co') && !chunk.includes(' ')) return { action: 'hold' as const }
        return { action: 'pass' as const }
      },
    })
    const safety = session({ call: { guardrails: [importFixer] } })
    const stream = safety.openStream()

    expect(await stream.feed('@/co')).toEqual({ kind: 'hold' })
    expect(await stream.feed('mps/Button')).toEqual({ kind: 'emit', content: '@/components/Button' })
    // The original pre-fix content lands in the audit.
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'import-fixer', action: 'transform', original: '@/comps/Button' }),
    )

    const seal = await stream.finish()
    expect(seal.text).toBe('@/components/Button')
    expect(seal.pending).toBe('')
  })

    it('flushes held content unchanged at finish when the stream ends mid-hold', async () => {
    const holdAll = guardrail({
      name: 'hold-all',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async () => ({ action: 'hold' as const }),
    })
    const stream = session({ call: { guardrails: [holdAll] } }).openStream()

    expect(await stream.feed('never ')).toEqual({ kind: 'hold' })
    expect(await stream.feed('released')).toEqual({ kind: 'hold' })

    const seal = await stream.finish()
    expect(seal.text).toBe('never released')
    expect(seal.pending).toBe('never released')
  })
})

// ── redact mid-stream ──────────────────────────────────────────────

describe('openStream — chunk rewrites', () => {
  it('redacted chunks reach the consumer while the original lands in the audit', async () => {
    const redactor = guardrail({
      name: 'key-redactor',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) =>
        chunk.includes('sk-123')
          ? { action: 'redact' as const, content: chunk.replace('sk-123', '[KEY]') }
          : { action: 'pass' as const },
    })
    const safety = session({ call: { guardrails: [redactor] } })
    const stream = safety.openStream()

    expect(await stream.feed('key: sk-123 ok')).toEqual({ kind: 'emit', content: 'key: [KEY] ok' })
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'key-redactor', action: 'redact', original: 'key: sk-123 ok' }),
    )
    expect((await stream.finish()).text).toBe('key: [KEY] ok')
  })
})

// ── buffer: 'full' ─────────────────────────────────────────────────

describe("openStream — buffer: 'full'", () => {
  it('holds every chunk and validates the accumulated text at finish', async () => {
    const finalCheck = guardrail({
      name: 'final-transform',
      phase: 'output',
      validate: async (content) => ({ action: 'transform' as const, content: content.toUpperCase() }),
      stream: { buffer: 'full' },
    })
    const stream = session({ call: { guardrails: [finalCheck] } }).openStream()

    expect(await stream.feed('hello ')).toEqual({ kind: 'hold' })
    expect(await stream.feed('world')).toEqual({ kind: 'hold' })

    const seal = await stream.finish()
    expect(seal.text).toBe('HELLO WORLD')
    // Nothing was released during feed — the whole guarded text is pending.
    expect(seal.pending).toBe('HELLO WORLD')
  })

    it('a full-buffer block at finish throws GuardrailBlockedError', async () => {
    const blocker = guardrail({
      name: 'final-block',
      phase: 'output',
      validate: async () => ({ action: 'block' as const, reason: 'unacceptable' }),
      stream: { buffer: 'full' },
    })
    const stream = session({ call: { guardrails: [blocker] } }).openStream()

    await stream.feed('bad ')
    await expect(stream.finish()).rejects.toBeInstanceOf(GuardrailBlockedError)
  })
})

// ── block mid-stream ───────────────────────────────────────────────

describe('openStream — block', () => {
  it('a block verdict mid-stream throws GuardrailBlockedError from feed', async () => {
    const blocker = guardrail({
      name: 'live-block',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) =>
        chunk.includes('forbidden') ? { action: 'block' as const, reason: 'forbidden token' } : { action: 'pass' as const },
    })
    const stream = session({ call: { guardrails: [blocker] } }).openStream()

    expect(await stream.feed('fine ')).toEqual({ kind: 'emit', content: 'fine ' })
    await expect(stream.feed('forbidden')).rejects.toBeInstanceOf(GuardrailBlockedError)
  })
})

// ── constraints on streams ─────────────────────────────────────────

describe('openStream — constraints', () => {
  it('constraints run report-only at finish — failing asserts audit without throwing', async () => {
    const neverPasses = constraint({
      name: 'impossible',
      check: async () => ({ pass: false as const, feedback: 'cannot satisfy on a live stream' }),
    })
    const safety = session({ call: { constraints: [neverPasses] } })
    const stream = safety.openStream()

    expect(await stream.feed('streamed ')).toEqual({ kind: 'emit', content: 'streamed ' })
    const seal = await stream.finish()

    expect(seal.text).toBe('streamed ')
    expect(safety.audit.constraints?.allPassed).toBe(false)
    expect(safety.audit.constraints?.entries[0]).toMatchObject({
      constraint: 'impossible',
      pass: false,
      feedback: 'cannot satisfy on a live stream',
    })
  })

    it('a constraint onChunk abort stops the stream early with ConstraintViolationError', async () => {
    const abortOnRamble = constraint({
      name: 'no-ramble',
      check: async () => ({ pass: true as const }),
      onChunk: async (_chunk, accumulated) =>
        accumulated.length > 10 ? { abort: true as const, feedback: 'rambling' } : { abort: false as const },
    })
    const stream = session({ call: { constraints: [abortOnRamble] } }).openStream()

    expect(await stream.feed('short')).toEqual({ kind: 'emit', content: 'short' })
    await expect(stream.feed(' and much much longer')).rejects.toBeInstanceOf(ConstraintViolationError)
  })
})

// ── transcript + transform() pipe ──────────────────────────────────

describe('openStream — transcript and transform()', () => {
  it('records stream.chunk directives and stream.finish in the transcript', async () => {
    const holdFirst = guardrail({
      name: 'hold-first',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) => (chunk.length < 4 ? { action: 'hold' as const } : { action: 'pass' as const }),
    })
    const safety = session({ call: { guardrails: [holdFirst] } })
    const stream = safety.openStream()

    await stream.feed('ab')
    await stream.feed('cd')
    await stream.finish()

    expect(safety.transcript).toEqual([
      { t: 'stream.chunk', directive: 'hold' },
      { t: 'stream.chunk', directive: 'emit' },
      { t: 'stream.finish' },
    ])
  })

    it('transform() pipes chunks through the protocol, releasing pending content at flush', async () => {
    const upper = guardrail({
      name: 'upper',
      phase: 'output',
      validate: async (content) => ({ action: 'transform' as const, content: content.toUpperCase() }),
      stream: { buffer: 'full' },
    })
    const stream = session({ call: { guardrails: [upper] } }).openStream()

    const source = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('one ')
        controller.enqueue('two')
        controller.close()
      },
    })
    const out: string[] = []
    const reader = source.pipeThrough(stream.transform()).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      out.push(value)
    }

    expect(out).toEqual(['ONE TWO'])
  })

    it('passthrough when no streaming guards or constraints are configured', async () => {
    const inputOnly = guardrail({ name: 'in', phase: 'input', validate: async () => ({ action: 'pass' as const }) })
    const stream = session({ call: { guardrails: [inputOnly] } }).openStream()

    expect(await stream.feed('as-is')).toEqual({ kind: 'emit', content: 'as-is' })
    const seal = await stream.finish()
    expect(seal.text).toBe('as-is')
    expect(seal.pending).toBe('')
  })
})
