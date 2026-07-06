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
import { resetRuntime } from '../../runtime/runtime'

afterEach(() => {
  resetRuntime()
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
    const stream = session({
      call: { guardrails: [sentenceGuard] },
    }).openStream()

    expect(await stream.feed('Hel')).toEqual({ kind: 'hold' })
    expect(await stream.feed('lo ')).toEqual({
      kind: 'emit',
      content: 'Hello ',
    })
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
          return {
            action: 'transform' as const,
            content: chunk.replace('@/comps/', '@/components/'),
          }
        }
        if (chunk.includes('@/co') && !chunk.includes(' ')) return { action: 'hold' as const }
        return { action: 'pass' as const }
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
      name: 'hold-all',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async () => ({ action: 'hold' as const }),
    })
    const stream = session({ call: { guardrails: [holdAll] } }).openStream()

    expect(await stream.feed('never ')).toEqual({ kind: 'hold' })
    expect(await stream.feed('released')).toEqual({ kind: 'hold' })

    await expect(stream.finish()).rejects.toThrow(/hold|stream|safety|result/i)
  })
})

// ── redact mid-stream ──────────────────────────────────────────────

describe('openStream — chunk rewrites', () => {
  it('redacted chunks reach the consumer without exposing the original in audit', async () => {
    const redactor = guardrail({
      name: 'key-redactor',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
      stream: { buffer: 'none' },
      onChunk: async (chunk) =>
        chunk.includes('sk-123')
          ? {
              action: 'redact' as const,
              content: chunk.replace('sk-123', '[KEY]'),
            }
          : { action: 'pass' as const },
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
      name: 'default-stream-redactor',
      phase: 'output',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace('sk-123', '[KEY]'),
      }),
    })
    const stream = session({ call: { guardrails: [redactor] } }).openStream()

    expect(await stream.feed('key sk-')).toEqual({ kind: 'hold' })
    expect(await stream.feed('123. ')).toEqual({
      kind: 'emit',
      content: 'key [KEY]. ',
    })
    expect((await stream.finish()).text).toBe('key [KEY]. ')
  })

  it('runs stream:"final" guardrails exactly once at finish', async () => {
    const seen: string[] = []
    const finalOnly = guardrail({
      name: 'final-only',
      phase: 'output',
      stream: 'final' as never,
      validate: async (content) => {
        seen.push(content)
        return { action: 'pass' as const }
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

  it('records an audited skip for stream:false guardrails', async () => {
    const disabled = guardrail({
      name: 'skip-stream',
      phase: 'output',
      stream: false as never,
      validate: async () => {
        throw new Error('stream:false guard must not run')
      },
    })
    const safety = session({ call: { guardrails: [disabled] } })
    const stream = safety.openStream()

    expect(await stream.feed('raw')).toEqual({ kind: 'emit', content: 'raw' })
    expect((await stream.finish()).text).toBe('raw')
    expect(safety.audit.guardrails?.applied ?? []).toContainEqual(
      expect.objectContaining({
        guard: 'skip-stream',
        action: 'allow',
        reason: 'stream: false',
      }),
    )
  })

  it('cascades multiple stream guards so later guards see earlier rewrites', async () => {
    const seen: string[] = []
    const redactor = guardrail({
      name: 'redactor',
      phase: 'output',
      stream: 'chunk' as never,
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace('secret', '[X]'),
      }),
    })
    const inspector = guardrail({
      name: 'inspector',
      phase: 'output',
      stream: 'chunk' as never,
      validate: async (content) => {
        seen.push(content)
        return { action: 'pass' as const }
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

  it('fails closed when a held segment exceeds maxHold and remains held', async () => {
    const holdUntilLimit = guardrail({
      name: 'hold-limit',
      phase: 'output',
      stream: {
        segment: 'chunk',
        maxHold: { chars: 3 },
        onHoldLimit: 'block',
      } as never,
      validate: async () => ({ action: 'hold' }) as never,
    })
    const stream = session({
      call: { guardrails: [holdUntilLimit] },
    }).openStream()

    await expect(stream.feed('abcd')).rejects.toThrow(/hold|limit|stream|safety/i)
  })

  it('flushes null-segmenter buffers at EOS with last:true', async () => {
    const seen: Array<{ content: string; last: unknown }> = []
    const finalSegmenter = guardrail({
      name: 'null-segmenter',
      phase: 'output',
      stream: { segment: () => null } as never,
      validate: async (content, ctx) => {
        seen.push({
          content,
          last: (ctx as unknown as { stream?: { last?: unknown } }).stream?.last,
        })
        return { action: 'pass' as const }
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

  it('runs output object/path guardrails only at stream finalization', async () => {
    const safetyModule = (await import('../../safety')) as typeof import('../../safety') & {
      readonly boundary?: {
        readonly output: {
          readonly path: <T>() => (path: string) => unknown
        }
      }
    }
    expect(safetyModule.boundary).toBeDefined()

    const seen: Array<{ subject: unknown; last: unknown }> = []
    const pathGuard = (guardrail as unknown as (config: unknown) => unknown)({
      id: 'customer-email',
      on: safetyModule.boundary!.output.path<{ customer: { email: string } }>()('customer.email'),
      stream: 'chunk',
      run: async (subject: unknown, ctx: { readonly stream?: { readonly last?: unknown } }) => {
        seen.push({ subject, last: ctx.stream?.last })
        return { action: 'allow' as const }
      },
    })
    const stream = session({
      call: { guardrails: [pathGuard as never] },
    }).openStream()

    expect(await stream.feed('{"customer":')).toEqual({
      kind: 'emit',
      content: '{"customer":',
    })
    expect(await stream.feed('{"email":"a@b.c"}}')).toEqual({
      kind: 'emit',
      content: '{"email":"a@b.c"}}',
    })
    expect(await stream.finish()).toMatchObject({
      text: '{"customer":{"email":"a@b.c"}}',
    })
    expect(seen).toEqual([{ subject: 'a@b.c', last: true }])
  })
})

// ── buffer: 'full' ─────────────────────────────────────────────────

describe("openStream — buffer: 'full'", () => {
  it('holds every chunk and validates the accumulated text at finish', async () => {
    const finalCheck = guardrail({
      name: 'final-transform',
      phase: 'output',
      validate: async (content) => ({
        action: 'transform' as const,
        content: content.toUpperCase(),
      }),
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
      validate: async () => ({
        action: 'block' as const,
        reason: 'unacceptable',
      }),
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
        chunk.includes('forbidden')
          ? { action: 'block' as const, reason: 'forbidden token' }
          : { action: 'pass' as const },
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
  it('constraints run report-only at finish — failing asserts audit without throwing', async () => {
    const neverPasses = constraint({
      name: 'impossible',
      check: async () => ({
        pass: false as const,
        feedback: 'cannot satisfy on a live stream',
      }),
    })
    const safety = session({ call: { constraints: [neverPasses] } })
    const stream = safety.openStream()

    expect(await stream.feed('streamed ')).toEqual({
      kind: 'emit',
      content: 'streamed ',
    })
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
    const stream = session({
      call: { constraints: [abortOnRamble] },
    }).openStream()

    expect(await stream.feed('short')).toEqual({
      kind: 'emit',
      content: 'short',
    })
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
      validate: async (content) => ({
        action: 'transform' as const,
        content: content.toUpperCase(),
      }),
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
    const inputOnly = guardrail({
      name: 'in',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
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
