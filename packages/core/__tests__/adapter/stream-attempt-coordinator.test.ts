/**
 * Shared stream-attempt coordinator: the buffer-until-commitment retry loop that
 * both stream routes use so their retry semantics cannot drift. It forwards only
 * the accepted attempt's released deltas (early unlock preserved), buffers until
 * COMMITMENT so a discarded attempt leaks zero consumer output, shares the
 * `maxSteps` budget with validation retry, enforces per-constraint `maxRetries`,
 * threads corrective messages, and throws the single public
 * `ConstraintViolationError` on exhaustion.
 *
 * @module
 */

import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { ConstraintViolationError } from '../../src/safety/constraint/errors'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import type { Message } from '../../src/generation/messages'
import { StreamConstraintRejection } from '../../src/safety/constraint/settlement'
import {
  runCoordinatedStream,
  StreamValidationRejection,
  type StreamAttemptEvent,
  type StreamAttemptFailure,
  type StreamAttemptStart,
} from '../../src/adapter/execution/stream-attempt'

/** A real ZodError for validation-rejection scripts. */
function zerr(): z.ZodError {
  const result = z.number().safeParse('nope')
  return (result as { error: z.ZodError }).error
}

/** A scripted attempt: a sequence of coordinator events, or a rejection to throw. */
type AuditEntry =
  import('../../src/safety/constraint/types').ConstraintAuditEntry
type Script =
  | { readonly events: readonly StreamAttemptEvent[] }
  | {
      readonly reject: readonly Partial<StreamAttemptFailure>[]
      readonly text?: string
      readonly audit?: readonly AuditEntry[]
    }
  | { readonly validationReject: string }

function sealed(text: string): StreamAttemptEvent {
  return {
    kind: 'sealed',
    seal: { text, parsed: undefined, pending: text },
    settlement: { attemptId: 'a', settled: [], audit: [] },
  }
}

/** An accepted attempt that commits immediately, then seals `text`. */
function accept(text: string): Script {
  return {
    events: [{ kind: 'committed' }, { kind: 'delta', text }, sealed(text)],
  }
}

function toFailures(
  failures: readonly Partial<StreamAttemptFailure>[],
): readonly StreamAttemptFailure[] {
  return failures.map((failure) => ({
    name: failure.name ?? 'c',
    severity: 'assert' as const,
    feedback: failure.feedback ?? 'nope',
    maxRetries: failure.maxRetries ?? 2,
    ...(failure.category !== undefined ? { category: failure.category } : {}),
  }))
}

function rejection(
  failures: readonly Partial<StreamAttemptFailure>[],
  text = 'bad',
  audit: readonly AuditEntry[] = [],
): StreamConstraintRejection {
  return new StreamConstraintRejection({
    failures: toFailures(failures),
    text,
    settlement: { attemptId: 'a', settled: [], audit },
  })
}

interface Harness {
  readonly correctives: Message[][]
  readonly aborted: boolean[]
  steps(): number
  run(): ReturnType<typeof runCoordinatedStream>
}

function coordinator(overrides: {
  readonly script: readonly Script[]
  readonly maxSteps?: number
  readonly signal?: AbortSignal
  readonly validationRetry?: import('../../src/generation/validation-retry').ValidationRetryOptions
}): Harness {
  const queue = [...overrides.script]
  const correctives: Message[][] = []
  const aborted: boolean[] = []
  let steps = 0

  const startAttempt: StreamAttemptStart = async ({
    corrective,
    attemptIndex,
  }) => {
    correctives.push([...corrective])
    aborted[attemptIndex] = false
    const script = queue.shift() ?? accept('exhausted')
    return {
      events: (async function* () {
        if ('validationReject' in script)
          throw new StreamValidationRejection({
            error: zerr(),
            text: script.validationReject,
          })
        if ('reject' in script)
          throw rejection(script.reject, script.text, script.audit ?? [])
        for (const event of script.events) yield event
      })(),
      abort: async () => {
        aborted[attemptIndex] = true
      },
    }
  }

  return {
    correctives,
    aborted,
    steps: () => steps,
    run: () =>
      runCoordinatedStream({
        startAttempt,
        maxSteps: overrides.maxSteps ?? 3,
        steps: () => steps,
        incrementStep: () => {
          steps += 1
        },
        formatFeedback: (failures) => [
          { role: 'user', content: failures.map((f) => f.feedback).join('; ') },
        ],
        guardFeedback: async (input) => input.text,
        ...(overrides.signal ? { signal: overrides.signal } : {}),
        ...(overrides.validationRetry
          ? { validationRetry: overrides.validationRetry }
          : {}),
      }),
  }
}

async function drain(
  stream: ReturnType<typeof runCoordinatedStream>,
): Promise<string[]> {
  const out: string[] = []
  for await (const delta of stream.deltas) out.push(delta)
  return out
}

describe('coordinated stream-attempt loop', () => {
  it('publishes the accepted attempt immediately (one step)', async () => {
    const co = coordinator({ script: [accept('ok')] })
    const stream = co.run()
    const deltas = await drain(stream)
    const result = await stream.completion()
    expect(deltas.join('')).toBe('ok')
    expect(result.seal.text).toBe('ok')
    expect(result.attempts).toBe(1)
    expect(co.steps()).toBe(1)
  })

  it('retries a rejected attempt with corrective feedback, then publishes the accepted one', async () => {
    const co = coordinator({
      script: [{ reject: [{ feedback: 'too short' }] }, accept('fixed')],
    })
    const stream = co.run()
    const deltas = await drain(stream)
    const result = await stream.completion()
    expect(deltas.join('')).toBe('fixed')
    expect(result.seal.text).toBe('fixed')
    expect(result.attempts).toBe(2)
    expect(co.steps()).toBe(2)
    expect(co.correctives[0]).toEqual([])
    expect(co.correctives[1]).toEqual([{ role: 'user', content: 'too short' }])
  })

  it('throws the public ConstraintViolationError when the shared budget is exhausted', async () => {
    const co = coordinator({
      script: [
        { reject: [{ name: 'c1' }] },
        { reject: [{ name: 'c1' }] },
        { reject: [{ name: 'c1' }] },
      ],
      maxSteps: 2,
    })
    const stream = co.run()
    await expect(stream.completion()).rejects.toBeInstanceOf(
      ConstraintViolationError,
    )
    expect(co.steps()).toBe(2)
  })

  it('throws when every failed constraint has exhausted its per-constraint retries', async () => {
    const co = coordinator({
      script: [
        { reject: [{ name: 'c1', maxRetries: 1 }] },
        { reject: [{ name: 'c1', maxRetries: 1 }] },
      ],
      maxSteps: 10,
    })
    const error = await co
      .run()
      .completion()
      .catch((e) => e)
    expect(error).toBeInstanceOf(ConstraintViolationError)
    expect((error as ConstraintViolationError).totalAttempts).toBe(2)
  })

  it('carries cumulative audit across discarded attempts into the terminal error', async () => {
    const co = coordinator({
      script: [
        {
          reject: [{ name: 'c1', maxRetries: 0 }],
          audit: [
            {
              constraint: 'c1',
              severity: 'assert',
              pass: false,
              feedback: 'x',
              attempts: 1,
              durationMs: 1,
            },
          ],
        },
      ],
      maxSteps: 10,
    })
    const error = (await co
      .run()
      .completion()
      .catch((e) => e)) as ConstraintViolationError
    expect(error).toBeInstanceOf(ConstraintViolationError)
    expect(error.totalAttempts).toBe(1)
    expect(error.audit.entries).toHaveLength(1)
    expect(error.audit.entries[0]?.constraint).toBe('c1')
  })

  it('stops and throws when the caller signal aborts before an attempt', async () => {
    const controller = new AbortController()
    controller.abort()
    const co = coordinator({
      script: [accept('never')],
      signal: controller.signal,
    })
    await expect(co.run().completion()).rejects.toThrow()
    expect(co.steps()).toBe(0)
  })

  it('aborts the rejected attempt before retrying', async () => {
    const co = coordinator({
      script: [{ reject: [{ feedback: 'retry me' }] }, accept('ok')],
    })
    const stream = co.run()
    await drain(stream)
    const result = await stream.completion()
    expect(result.seal.text).toBe('ok')
    // The rejected first attempt was aborted; the accepted second was not.
    expect(co.aborted[0]).toBe(true)
    expect(co.aborted[1]).toBe(false)
  })

  // ── RED 2: early unlock — the accepted attempt's prefix flushes at COMMITMENT,
  // before the seal (provider EOF). ──────────────────────────────────────────
  it('flushes the accepted prefix at the commit transition, before the seal', async () => {
    const flushOrder: string[] = []
    const script: Script = {
      events: [
        { kind: 'committed' },
        { kind: 'delta', text: '{"name":"alice"' },
        { kind: 'delta', text: ',"extra":"x"}' },
        sealed('{"name":"alice","extra":"x"}'),
      ],
    }
    const co = coordinator({ script: [script] })
    const stream = co.run()
    for await (const delta of stream.deltas) flushOrder.push(delta)
    const result = await stream.completion()
    // Deltas arrived progressively (two of them), not a single end-of-stream blob.
    expect(flushOrder).toEqual(['{"name":"alice"', ',"extra":"x"}'])
    expect(result.seal.text).toBe('{"name":"alice","extra":"x"}')
  })

  // ── RED 3: a pre-commit rejection leaks ZERO consumer events. ───────────────
  it('emits zero consumer deltas for a rejected (pre-commit) attempt', async () => {
    // First attempt holds (no committed event) then rejects; second accepts.
    const co = coordinator({
      script: [
        { reject: [{ name: 'items', feedback: 'too long' }] },
        accept('{"items":["ok"]}'),
      ],
    })
    const stream = co.run()
    const deltas = await drain(stream)
    // Only the accepted attempt's output ever reaches the consumer.
    expect(deltas.join('')).toBe('{"items":["ok"]}')
    const result = await stream.completion()
    expect(result.attempts).toBe(2)
  })

  it('never forwards a pre-commit delta even from the accepted attempt', async () => {
    // An attempt that (defensively) emits a delta BEFORE committing must not leak it.
    const script: Script = {
      events: [
        { kind: 'delta', text: 'LEAK' },
        { kind: 'committed' },
        { kind: 'delta', text: 'safe' },
        sealed('safe'),
      ],
    }
    const co = coordinator({ script: [script] })
    const stream = co.run()
    const deltas = await drain(stream)
    expect(deltas.join('')).toBe('safe')
  })

  // ── Fork 2: typed validation rejection shares the loop with its own budget. ──
  it('retries a validation rejection and publishes the accepted attempt', async () => {
    const onRetry = vi.fn()
    const co = coordinator({
      script: [{ validationReject: 'bad-json' }, accept('valid')],
      validationRetry: { maxRetries: 2, onRetry },
    })
    const stream = co.run()
    expect((await drain(stream)).join('')).toBe('valid')
    expect((await stream.completion()).attempts).toBe(2)
    expect(onRetry).toHaveBeenCalledWith(1, expect.anything())
  })

  it('converts exhausted validation rejection to ValidationExhaustedError (retry counts)', async () => {
    const onExhausted = vi.fn()
    const co = coordinator({
      script: [{ validationReject: 'a' }, { validationReject: 'b' }],
      maxSteps: 10,
      validationRetry: { maxRetries: 1, onExhausted },
    })
    const error = (await co
      .run()
      .completion()
      .catch((e) => e)) as ValidationExhaustedError
    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect(error.attempts).toBe(1) // validation retries performed
    expect(error.maxAttempts).toBe(1)
    expect(onExhausted).toHaveBeenCalledWith(1, expect.anything())
  })

  it('constraint retry then validation exhaustion → ValidationExhaustedError', async () => {
    const co = coordinator({
      script: [
        { reject: [{ name: 'c1' }] },
        { validationReject: 'x' },
        { validationReject: 'y' },
      ],
      maxSteps: 10,
      validationRetry: { maxRetries: 1 },
    })
    const error = await co
      .run()
      .completion()
      .catch((e) => e)
    expect(error).toBeInstanceOf(ValidationExhaustedError)
  })

  it('validation retry then constraint exhaustion → ConstraintViolationError', async () => {
    const co = coordinator({
      script: [
        { validationReject: 'x' },
        { reject: [{ name: 'c1', maxRetries: 0 }] },
      ],
      maxSteps: 10,
      validationRetry: { maxRetries: 2 },
    })
    const error = await co
      .run()
      .completion()
      .catch((e) => e)
    expect(error).toBeInstanceOf(ConstraintViolationError)
  })
})
