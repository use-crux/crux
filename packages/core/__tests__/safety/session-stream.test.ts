/**
 * Boundary tests for the `Safety` streaming sub-protocol (`openStream()`):
 * the "LLM Suspense" pattern — hold buffers, mid-stream transforms,
 * full-buffer flush validation, report-only constraints at finish.
 */

import { afterEach, describe, it, expect } from 'vitest'
import { boundary, createSafety, GuardrailBlockedError, ConstraintViolationError } from '../../src/safety'
import { openSafetySessionStructuredStream } from '../../src/safety/session'
import type { SafetyCallOptions } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { constraint } from '../../src/safety/constraint'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => {
  resetHooks()
})

const session = (options?: Partial<SafetyCallOptions>) => createSafety({ promptId: 'p1', model: 'm1', ...options })

// ── hold / release ─────────────────────────────────────────────────

describe('openStream — hold and release', () => {
  it('a hold verdict buffers and emits nothing; the next verdict releases held + new content in order', async () => {
    // Holds any chunk ending mid-word (no trailing space), passes otherwise.
    const sentenceGuard = guardrail({
      id: 'sentence',
      on: boundary.output.text(),
      run: async (chunk) => (chunk.endsWith(' ') ? { action: 'allow' as const } : { action: 'hold' as const }),
    })
    const stream = session({
      call: { guardrails: [sentenceGuard] },
    }).openStream()

    expect(await stream.feed('Hel')).toEqual({ kind: 'hold' })
    expect(await stream.feed('lo ')).toEqual({
      kind: 'emit',
      content: 'Hello ',
    })
  })

  it('an async per-delta fix round-trips: hold, then release corrected content', async () => {
    // The v0 LLM Suspense pattern: hold a suspicious import line, look up
    // the real path "asynchronously", release the corrected content.
    const importFixer = guardrail({
      id: 'import-fixer',
      on: boundary.output.text(),
      run: async (chunk) => {
        if (chunk.includes('@/comps/')) {
          await new Promise((resolve) => setTimeout(resolve, 1))
          return {
            action: 'rewrite' as const,
            value: chunk.replace('@/comps/', '@/components/'),
            rewrite: { kind: 'normalize' as const },
          }
        }
        if (chunk.includes('@/co') && !chunk.includes(' ')) return { action: 'hold' as const }
        return { action: 'allow' as const }
      },
    })
    const safety = session({ call: { guardrails: [importFixer] } })
    const stream = safety.openStream()

    expect(await stream.feed('@/co')).toEqual({ kind: 'hold' })
    expect(await stream.feed('mps/Button')).toEqual({
      kind: 'emit',
      content: '@/components/Button',
    })
    // Safe-by-default audit records the action without leaking the pre-fix content.
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'import-fixer', action: 'transform' }),
    )
    expect(JSON.stringify(safety.audit.guardrails?.applied ?? [])).not.toContain('@/comps/Button')

    const seal = await stream.finish()
    expect(seal.text).toBe('@/components/Button')
    expect(seal.pending).toBe('')
  })

  it('fails closed instead of releasing held content unchanged when the stream ends mid-hold', async () => {
    const holdAll = guardrail({
      id: 'hold-all',
      on: boundary.output.text(),
      run: async () => ({ action: 'hold' as const }),
    })
    const stream = session({ call: { guardrails: [holdAll] } }).openStream()

    expect(await stream.feed('never ')).toEqual({ kind: 'hold' })
    expect(await stream.feed('released')).toEqual({ kind: 'hold' })

    await expect(stream.finish()).rejects.toThrow(/hold|stream|safety|result/i)
  })
})

// ── redact mid-stream ──────────────────────────────────────────────

describe('openStream — chunk rewrites', () => {
  it('propagates blocked completion-slot guardrails without running constraints', async () => {
    let constraintCalls = 0
    const blocker = guardrail({
      id: 'completion-slot-blocker',
      on: boundary.output.text(),
      run: async (text) =>
        text === 'blocked' ? { action: 'block' as const, reason: 'blocked slot' } : { action: 'allow' as const },
    })
    const neverRun = constraint({
      id: 'completion-slot-constraint',
      on: boundary.output.text(),
      run: async () => {
        constraintCalls++
        return { pass: true as const }
      },
    })
    const safety = session({
      call: { guardrails: [blocker], constraints: [neverRun] },
    })

    await expect(safety.guardOutputTextParts(['safe', 'blocked'])).rejects.toBeInstanceOf(GuardrailBlockedError)
    expect(constraintCalls).toBe(0)
  })

  it('redacted chunks reach the consumer without exposing the original in audit', async () => {
    const redactor = guardrail({
      id: 'key-redactor',
      on: boundary.output.text(),
      run: async (chunk) =>
        chunk.includes('sk-123')
          ? {
              action: 'rewrite' as const,
              value: chunk.replace('sk-123', '[KEY]'),
              rewrite: { kind: 'redact' as const },
            }
          : { action: 'allow' as const },
    })
    const safety = session({ call: { guardrails: [redactor] } })
    const stream = safety.openStream()

    expect(await stream.feed('key: sk-123 ok')).toEqual({
      kind: 'emit',
      content: 'key: [KEY] ok',
    })
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'key-redactor', action: 'redact' }),
    )
    expect(JSON.stringify(safety.audit.guardrails?.applied ?? [])).not.toContain('sk-123')
    expect((await stream.finish()).text).toBe('key: [KEY] ok')
  })
})

// ── stable beta stream defaults ────────────────────────────────────

describe('openStream — stable beta stream contract', () => {
  it('runs ordinary output guardrails on streams by default', async () => {
    const redactor = guardrail({
      id: 'default-stream-redactor',
      on: boundary.output.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('sk-123', '[KEY]'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const stream = session({ call: { guardrails: [redactor] } }).openStream()

    // Adaptive default is per canonical delta: each delta is evaluated and rewritten.
    expect(await stream.feed('key sk-123 ok')).toEqual({
      kind: 'emit',
      content: 'key [KEY] ok',
    })
    expect((await stream.finish()).text).toBe('key [KEY] ok')
  })

  it('runs `.complete()` guardrails exactly once at finish', async () => {
    const seen: string[] = []
    const finalOnly = guardrail({
      id: 'final-only',
      on: boundary.output.text().complete(),
      run: async (content) => {
        seen.push(content)
        return { action: 'allow' as const }
      },
    })
    const stream = session({ call: { guardrails: [finalOnly] } }).openStream()

    expect(await stream.feed('a secret')).toEqual({
      kind: 'emit',
      content: 'a secret',
    })
    const seal = await stream.finish()

    expect(seen).toEqual(['a secret'])
    expect(seal.text).toBe('a secret')
    expect(seal.pending).toBe('')
  })

  it('records report-mode stream guardrail findings without changing released text', async () => {
    const reporter = guardrail({
      id: 'shadow-stream',
      on: boundary.output.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('secret', '[REDACTED]'),
        rewrite: { kind: 'normalize' as const },
      }),
    })
    const safety = session({
      call: { guardrails: [reporter] },
      safety: { tune: { 'shadow-stream': { mode: 'report' } } },
    })
    const stream = safety.openStream()

    expect(await stream.feed('secret')).toEqual({
      kind: 'emit',
      content: 'secret',
    })
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({ guard: 'shadow-stream', action: 'transform' }),
    )
    expect((await stream.finish()).text).toBe('secret')
  })

  it('runs report-mode constraints at stream finish', async () => {
    const reportOnly = constraint({
      id: 'shadow-stream-judge',
      on: boundary.output.both(),
      run: async () => ({ pass: false as const, feedback: 'shadow finding' }),
    })
    const safety = session({
      call: { constraints: [reportOnly] },
      safety: { tune: { 'shadow-stream-judge': { mode: 'report' } } },
    })
    const stream = safety.openStream()

    expect(await stream.feed('candidate')).toEqual({
      kind: 'emit',
      content: 'candidate',
    })
    expect(await stream.finish()).toMatchObject({ text: 'candidate' })
    expect(safety.audit.constraints?.entries).toContainEqual(
      expect.objectContaining({
        constraint: 'shadow-stream-judge',
        pass: false,
        feedback: 'shadow finding',
      }),
    )
  })

  it('cascades multiple stream guards so later guards see earlier rewrites', async () => {
    const seen: string[] = []
    const redactor = guardrail({
      id: 'redactor',
      on: boundary.output.text(),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.replace('secret', '[X]'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const inspector = guardrail({
      id: 'inspector',
      on: boundary.output.text(),
      run: async (content) => {
        seen.push(content)
        return { action: 'allow' as const }
      },
    })
    const stream = session({
      call: { guardrails: [redactor, inspector] },
    }).openStream()

    expect(await stream.feed('secret')).toEqual({
      kind: 'emit',
      content: '[X]',
    })
    expect(seen).toEqual(['[X]'])
  })

  it('records report-mode stream blocks without stopping live output', async () => {
    const blocker = guardrail({
      id: 'shadow-stream-block',
      on: boundary.output.text(),
      run: async () => ({ action: 'block' as const, reason: 'shadow block' }),
    })
    const safety = session({
      call: { guardrails: [blocker] },
      safety: { tune: { 'shadow-stream-block': { mode: 'report' } } },
    })
    const stream = safety.openStream()

    expect(await stream.feed('visible')).toEqual({
      kind: 'emit',
      content: 'visible',
    })
    expect(safety.audit.guardrails?.applied).toContainEqual(
      expect.objectContaining({
        guard: 'shadow-stream-block',
        action: 'block',
        reason: 'shadow block',
      }),
    )
  })

  it('fails closed when a held segment exceeds maxHold and remains held', async () => {
    const holdUntilLimit = guardrail({
      id: 'hold-limit',
      // A whole-buffer segmenter with a 3-char hold limit; the guard always holds.
      on: boundary.output.text().segments({
        maxCharacters: 10_000,
        next: (buffer) => (buffer.length > 0 ? buffer.length : undefined),
        maxHold: { chars: 3 },
      }),
      run: async () => ({ action: 'hold' as const }),
    })
    const stream = session({
      call: { guardrails: [holdUntilLimit] },
    }).openStream()

    await expect(stream.feed('abcd')).rejects.toThrow(/hold|limit|stream|safety/i)
  })

  it('flushes null-segmenter buffers at EOS with last:true', async () => {
    const seen: Array<{ content: string; last: unknown }> = []
    const finalSegmenter = guardrail({
      id: 'null-segmenter',
      // A segmenter that never emits: the whole text is one unit completed at EOF.
      on: boundary.output.text().segments({ maxCharacters: 10_000, next: (buffer, { final }) => (final ? buffer.length : undefined) }),
      run: async (content, ctx) => {
        seen.push({
          content,
          last: ctx.stream?.last,
        })
        return { action: 'allow' as const }
      },
    })
    const stream = session({
      call: { guardrails: [finalSegmenter] },
    }).openStream()

    expect(await stream.feed('partial')).toEqual({ kind: 'hold' })
    expect(await stream.finish()).toMatchObject({
      text: 'partial',
      pending: 'partial',
    })
    expect(seen).toEqual([{ content: 'partial', last: true }])
  })

  it('gates object/path occurrences through the structured stream and seals the value', async () => {
    const seen: Array<{ subject: unknown; last: unknown }> = []
    const pathGuard = guardrail({
      id: 'customer-email',
      on: boundary.output.object<{ customer: { email: string } }>().path('customer.email'),
      run: async (subject, ctx) => {
        seen.push({ subject, last: ctx.stream?.last })
        return { action: 'allow' as const }
      },
    })
    // Object output uses the structured stream (public openStream stays text-only).
    const stream = openSafetySessionStructuredStream(session({ call: { guardrails: [pathGuard] } }))

    let released = ''
    for (const chunk of ['{"customer":', '{"email":"a@b.c"}}']) {
      const directive = await stream.feed(chunk)
      if (directive.kind === 'emit') released += directive.content
    }
    const seal = await stream.finish()
    released += seal.pending

    expect(seal.text).toBe('{"customer":{"email":"a@b.c"}}')
    expect(seal.parsed).toEqual({ customer: { email: 'a@b.c' } })
    expect(released).toBe(seal.text)
    expect(seen).toEqual([{ subject: 'a@b.c', last: true }])
  })
})

// ── null segmenter full buffering ─────────────────────────────────

describe('openStream — null segmenter buffering', () => {
  it('holds every chunk and validates the accumulated text at finish', async () => {
    const finalCheck = guardrail({
      id: 'final-transform',
      on: boundary.output.text().segments({ maxCharacters: 10_000, next: (buffer, { final }) => (final ? buffer.length : undefined) }),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.toUpperCase(),
        rewrite: { kind: 'normalize' as const },
      }),
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
      id: 'final-block',
      on: boundary.output.text().segments({ maxCharacters: 10_000, next: (buffer, { final }) => (final ? buffer.length : undefined) }),
      run: async () => ({
        action: 'block' as const,
        reason: 'unacceptable',
      }),
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
      id: 'live-block',
      on: boundary.output.text(),
      run: async (chunk) =>
        chunk.includes('forbidden')
          ? { action: 'block' as const, reason: 'forbidden token' }
          : { action: 'allow' as const },
    })
    const stream = session({ call: { guardrails: [blocker] } }).openStream()

    expect(await stream.feed('fine ')).toEqual({
      kind: 'emit',
      content: 'fine ',
    })
    await expect(stream.feed('forbidden')).rejects.toBeInstanceOf(GuardrailBlockedError)
  })
})

// ── constraints on streams ─────────────────────────────────────────

describe('openStream — constraints', () => {
  it('an assert commits the attempt: a standalone stream buffers then fails closed', async () => {
    const neverPasses = constraint({
      id: 'impossible',
      on: boundary.output.both(),
      run: async () => ({
        pass: false as const,
        feedback: 'cannot satisfy on a live stream',
      }),
    })
    const safety = session({ call: { constraints: [neverPasses] } })
    const stream = safety.openStream()

    // The assert holds every byte to completion (the whole attempt is buffered).
    expect(await stream.feed('streamed ')).toEqual({ kind: 'hold', bufferedBy: 'constraint' })
    // A standalone stream has no regeneration authority, so it fails closed.
    await expect(stream.finish()).rejects.toBeInstanceOf(ConstraintViolationError)
  })

  it('a passing assert releases the buffered attempt at completion', async () => {
    const alwaysPasses = constraint({
      id: 'ok',
      on: boundary.output.both(),
      run: async () => ({ pass: true as const }),
    })
    const safety = session({ call: { constraints: [alwaysPasses] } })
    const stream = safety.openStream()

    expect(await stream.feed('streamed ')).toEqual({ kind: 'hold', bufferedBy: 'constraint' })
    const seal = await stream.finish()
    // Nothing released during feed; the whole guarded text is the pending tail.
    expect(seal.pending).toBe('streamed ')
    expect(seal.text).toBe('streamed ')
  })

  it('a report-mode constraint never gates release', async () => {
    const reportOnly = constraint({
      id: 'observe-only',
      on: boundary.output.both(),
      run: async () => ({ pass: false as const, feedback: 'noted' }),
    })
    const safety = session({
      call: { constraints: [reportOnly] },
      safety: { tune: { 'observe-only': { mode: 'report' } } },
    })
    const stream = safety.openStream()
    // Report mode: output flows progressively, the finding is only recorded.
    expect(await stream.feed('streamed ')).toEqual({ kind: 'emit', content: 'streamed ' })
    const seal = await stream.finish()
    expect(seal.text).toBe('streamed ')
    expect(safety.audit.constraints?.entries[0]).toMatchObject({ constraint: 'observe-only', pass: false })
  })

})

// ── transcript + transform() pipe ──────────────────────────────────

describe('openStream — transcript and transform()', () => {
  it('records stream.chunk directives and stream.finish in the transcript', async () => {
    const holdFirst = guardrail({
      id: 'hold-first',
      on: boundary.output.text(),
      run: async (chunk) => (chunk.length < 4 ? { action: 'hold' as const } : { action: 'allow' as const }),
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
      id: 'upper',
      on: boundary.output.text().segments({ maxCharacters: 10_000, next: (buffer, { final }) => (final ? buffer.length : undefined) }),
      run: async (content) => ({
        action: 'rewrite' as const,
        value: content.toUpperCase(),
        rewrite: { kind: 'normalize' as const },
      }),
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
    const inputOnly = guardrail({
      id: 'in',
      on: boundary.input.text(),
      run: async () => ({ action: 'allow' as const }),
    })
    const stream = session({ call: { guardrails: [inputOnly] } }).openStream()

    expect(await stream.feed('as-is')).toEqual({
      kind: 'emit',
      content: 'as-is',
    })
    const seal = await stream.finish()
    expect(seal.text).toBe('as-is')
    expect(seal.pending).toBe('')
  })
})
