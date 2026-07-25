/**
 * Native structured-stream coordinator wiring (RFC #173, Phase 15).
 *
 * A structured stream with an enforce `assert` commit gate routes through the
 * shared attempt coordinator: a rejected attempt is discarded and restreamed with
 * corrective feedback, and only the accepted attempt's bytes reach the consumer
 * (buffer-until-commitment). A stream with no commit gate keeps the byte-for-byte
 * progressive path (RED 1, the no-gate lock).
 *
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { prompt as makePrompt } from '../../src/prompt/prompt'
import type { Message } from '../../src/generation/messages'
import type { AdapterResponse, StreamHandle } from '../../src/adapter/types'
import type { AdapterExecutionDialect } from '../../src/adapter/execution/session'
import { createAdapterExecution } from '../../src/adapter/execution/session'
import { permissiveCapabilities } from './structured-output/capability-fixtures'
import { boundary } from '../../src/safety'
import { guardrail } from '../../src/safety/guardrail'
import { constraint } from '../../src/safety/constraint'
import { ValidationExhaustedError } from '../../src/generation/validation-retry'
import { ConstraintViolationError } from '../../src/safety/constraint/errors'
import { resetHooks } from '../../src/runtime/runtime'
import { resetObservabilityRuntime, subscribeObservability } from '../../src/observability'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

function textPrompt() {
  return makePrompt({
    id: 'stream-coord-text',
    system: 'Answer.',
    prompt: ({ input }) => (input as { message: string }).message,
    input: z.object({ message: z.string() }),
  })
}

function structuredPrompt() {
  return makePrompt({
    id: 'stream-coord',
    system: 'Return JSON.',
    prompt: ({ input }) => (input as { message: string }).message,
    input: z.object({ message: z.string() }),
    output: z.object({ title: z.string(), count: z.number() }),
  })
}

/** A core-step dialect whose `stream` replays one scripted delta list per call. */
function scriptedStreamDialect(scripts: readonly (readonly string[])[]) {
  const queue = [...scripts]
  const calls: Message[][] = []
  const client = { kind: 'core' as const }
  const dialect: AdapterExecutionDialect<
    typeof client,
    string,
    { readonly text: string },
    never,
    Record<string, unknown>
  > = {
    kind: 'core-step',
    id: 'mock-stream',
    client,
    structuredOutput: { accepts: permissiveCapabilities },
    mapSettings: (settings) => ({ ...settings }),
    call: async () => {
      throw new Error('not used')
    },
    stream: async (_client, args): Promise<StreamHandle<AsyncIterable<{ text: string }>>> => {
      calls.push([...args.messages])
      const deltas = queue.shift() ?? ['']
      return {
        rawStream: (async function* () {
          for (const delta of deltas) yield { text: delta }
        })(),
        extractTextDelta: (chunk) => (chunk as { text?: string }).text,
        completion: async () => ({ finishReason: 'stop' as const }),
      }
    },
    appendToolRound: (messages, assistant: AdapterResponse, results) => [
      ...messages,
      { role: 'assistant' as const, content: assistant.text },
      ...results.map((result) => ({
        role: 'tool' as const,
        content: result.content,
        metadata: { toolCallId: result.toolCallId, toolName: result.name },
      })),
    ],
  }
  return { dialect, calls }
}

async function drainStream(result: {
  readonly rawStream: AsyncIterable<unknown>
  readonly extractTextDelta: (chunk: unknown) => string | undefined
}): Promise<string> {
  let text = ''
  for await (const chunk of result.rawStream) {
    const delta = result.extractTextDelta(chunk)
    if (delta) text += delta
  }
  return text
}

const titleConstraint = constraint({
  id: 'title-nonempty',
  on: boundary.output.object<{ title: string; count: number }>().path('title'),
  run: (title: string) => (title.length > 0 ? { pass: true } : { pass: false, feedback: 'title must not be empty' }),
})

// A root (whole-object) assert holds every byte until completion, so a rejected
// attempt's full answer is available for the corrective retry turn.
const countConstraint = constraint({
  id: 'count-positive',
  on: boundary.output.object<{ title: string; count: number }>(),
  run: (obj: { title: string; count: number }) =>
    obj.count > 1 ? { pass: true } : { pass: false, feedback: 'count must exceed 1' },
})

describe('native structured stream coordinator', () => {
  // ── RED 1: no commit gate → byte-for-byte progressive path, one provider call.
  it('streams byte-for-byte with no commit gate (single provider call)', async () => {
    const { dialect, calls } = scriptedStreamDialect([['{"title":"hi",', '"count":2}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
    })
    const text = await drainStream(result)
    const meta = await result.completion()
    expect(text).toBe('{"title":"hi","count":2}')
    expect(meta?.object).toEqual({ title: 'hi', count: 2 })
    expect(calls).toHaveLength(1) // no retry
  })

  // ── A scalar-path assert rejects attempt 0 and restreams; only the accepted
  // attempt's bytes reach the consumer, and the retry carries corrective feedback.
  it('retries a rejected assert attempt and publishes only the accepted stream', async () => {
    const { dialect, calls } = scriptedStreamDialect([
      ['{"title":"a",', '"count":1}'], // fails count-positive at completion
      ['{"title":"a","count":2}'], // passes
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countConstraint],
    })
    const text = await drainStream(result)
    const meta = await result.completion()
    // Only the accepted (second) attempt's bytes were published.
    expect(text).toBe('{"title":"a","count":2}')
    expect(meta?.object).toEqual({ title: 'a', count: 2 })
    expect(calls).toHaveLength(2)
    // The retry conversation carried the full rejected answer + corrective feedback.
    const retryContents = calls[1]!.map((message) => String(message.content)).join('\n')
    expect(retryContents).toContain('{"title":"a","count":1}')
    expect(retryContents).toContain('count must exceed 1')
  })

  // ── A scalar-path assert rejects EARLY (as soon as the bad value completes),
  // so the rest of that attempt never streams and its partial answer is discarded.
  it('rejects a scalar-path assert early and publishes only the accepted stream', async () => {
    const { dialect, calls } = scriptedStreamDialect([
      ['{"title":"",', '"count":1}'], // title completes empty → early reject
      ['{"title":"ok","count":2}'], // passes
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [titleConstraint],
    })
    const text = await drainStream(result)
    const meta = await result.completion()
    expect(text).toBe('{"title":"ok","count":2}')
    expect(meta?.object).toEqual({ title: 'ok', count: 2 })
    expect(calls).toHaveLength(2)
    expect(calls[1]!.map((m) => String(m.content)).join('\n')).toContain('title must not be empty')
  })

  // ── A pre-commit rejection leaks zero consumer bytes even when the failing
  // attempt streamed a partial prefix.
  it('leaks no bytes from a rejected attempt that streamed a partial prefix', async () => {
    const seen: string[] = []
    const { dialect } = scriptedStreamDialect([
      ['{"title":"', '","count":1}'], // holds (title incomplete), then fails at close
      ['{"title":"ok","count":2}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [titleConstraint],
    })
    for await (const chunk of result.rawStream) {
      const delta = result.extractTextDelta(chunk)
      if (delta) seen.push(delta)
    }
    await result.completion()
    // No fragment of the first attempt (empty title) ever surfaced.
    expect(seen.join('')).toBe('{"title":"ok","count":2}')
  })

  // ── Settlement suppression: an assert the accepted stream already passed is NOT
  // re-evaluated at completion (a `constraint.judge()` would run exactly once).
  it('does not re-run an accepted stream assert at completion (runs once)', async () => {
    const run = vi.fn((obj: { title: string; count: number }) =>
      obj.count > 0 ? { pass: true } : { pass: false, feedback: 'count must be positive' },
    )
    const once = constraint({ id: 'count-once', on: boundary.output.object<{ title: string; count: number }>(), run })
    const { dialect } = scriptedStreamDialect([['{"title":"a","count":2}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [once],
    })
    const text = await drainStream(result)
    const meta = await result.completion()
    expect(text).toBe('{"title":"a","count":2}')
    expect(meta?.object).toEqual({ title: 'a', count: 2 })
    // Evaluated once on the stream; suppressed (settled, unchanged) at completion.
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('native structured stream validation-retry gate', () => {
  // ── RED 4: validation-retry-only restream (no constraints). The candidate is
  // buffered to EOF-and-validate; an invalid parse discards it and restreams.
  it('retries a schema-invalid attempt and publishes only the valid one', async () => {
    const onRetry = vi.fn()
    const { dialect, calls } = scriptedStreamDialect([
      ['{"title":"a","count":', '"two"}'], // count is a string → safeParse fails
      ['{"title":"a","count":2}'], // valid
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      validationRetry: { maxRetries: 2, onRetry },
    })
    const text = await drainStream(result)
    const meta = await result.completion()
    expect(text).toBe('{"title":"a","count":2}')
    expect(meta?.object).toEqual({ title: 'a', count: 2 })
    expect(calls).toHaveLength(2)
    // onRetry fired once with the first validation-retry number.
    expect(onRetry).toHaveBeenCalledTimes(1)
    expect(onRetry).toHaveBeenCalledWith(1, expect.anything())
    // The retry conversation carried validation feedback.
    expect(calls[1]!.map((m) => String(m.content)).join('\n')).toContain('Validation failed')
  })

  // Validation exhaustion → ValidationExhaustedError with the retry-count semantics.
  it('throws ValidationExhaustedError when validation retries are exhausted', async () => {
    const onExhausted = vi.fn()
    const { dialect } = scriptedStreamDialect([
      ['{"title":"a","count":"x"}'],
      ['{"title":"a","count":"y"}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      validationRetry: { maxRetries: 1, onExhausted },
    })
    const error = await drainForError(result)
    expect(error).toBeInstanceOf(ValidationExhaustedError)
    expect((error as ValidationExhaustedError).attempts).toBe(1)
    expect((error as ValidationExhaustedError).maxAttempts).toBe(1)
    expect(onExhausted).toHaveBeenCalledWith(1, expect.anything())
  })

  // ── RED 5 (precedence): both an assert gate and a validation gate are active,
  // the assert PASSES, and validation fails. The whole candidate is buffered until
  // validate, so the failure surfaces as ValidationExhaustedError (never combined)
  // with zero leaked bytes.
  it('a passing assert + failing validation throws ValidationExhaustedError, zero leaked bytes', async () => {
    const seen: string[] = []
    const titleAssert = constraint({
      id: 'title-nonempty',
      on: boundary.output.object<{ title: string; count: number }>().path('title'),
      run: (title: string) => (title.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
    })
    const { dialect } = scriptedStreamDialect([
      ['{"title":"a","count":"bad"}'], // title assert passes; count invalid → validation fails
      ['{"title":"a","count":"bad"}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [titleAssert],
      validationRetry: { maxRetries: 1 },
    })
    let thrown: unknown
    try {
      for await (const chunk of result.rawStream) {
        const delta = result.extractTextDelta(chunk)
        if (delta) seen.push(delta)
      }
    } catch (e) {
      thrown = e
    }
    expect(thrown).toBeInstanceOf(ValidationExhaustedError)
    // The validation gate buffered everything; nothing leaked from either attempt.
    expect(seen.join('')).toBe('')
  })

  it('an assert failure (schema-valid value) throws ConstraintViolationError', async () => {
    const countAssert = constraint({
      id: 'count-positive',
      on: boundary.output.object<{ title: string; count: number }>().path('count'),
      run: (count: number) => (count > 0 ? { pass: true } : { pass: false, feedback: 'positive' }),
    })
    // Schema-valid numbers that all fail the assert (count <= 0); exhaust the assert.
    const { dialect } = scriptedStreamDialect([
      ['{"title":"a","count":-1}'],
      ['{"title":"a","count":-2}'],
      ['{"title":"a","count":-3}'],
      ['{"title":"a","count":-4}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countAssert],
    })
    expect(await drainForError(result)).toBeInstanceOf(ConstraintViolationError)
  })
})

describe('adapter release-gate parity', () => {
  // Arbitrary provider chunking must not change canonical content or decisions: the
  // scanner is fed byte-wise here and must produce the same published result.
  it('produces identical canonical output under arbitrary provider chunking', async () => {
    const wire = '{"title":"chunky","count":42}'
    const chunkings: readonly (readonly string[])[] = [
      [wire], // one chunk
      wire.match(/.{1,3}/g) as string[], // 3-byte chunks
      [...wire], // byte-wise
    ]
    const published: string[] = []
    const objects: unknown[] = []
    for (const deltas of chunkings) {
      const { dialect } = scriptedStreamDialect([deltas])
      const result = await createAdapterExecution(dialect).stream({
        prompt: structuredPrompt(),
        model: 'm',
        modelInfo: { provider: 'mock-stream', modelId: 'm' },
        input: { message: 'go' },
        constraints: [titleConstraint],
      })
      published.push(await drainStream(result))
      objects.push((await result.completion())?.object)
    }
    expect(published).toEqual([wire, wire, wire])
    expect(objects).toEqual([
      { title: 'chunky', count: 42 },
      { title: 'chunky', count: 42 },
      { title: 'chunky', count: 42 },
    ])
  })

  // A gate that blocks an early path must withhold BEFORE any release, even when the
  // offending value arrives in the very first chunk.
  it('blocks an early path before any byte is released', async () => {
    const seen: string[] = []
    const { dialect } = scriptedStreamDialect([
      ['{"title":"",', '"count":1}'], // title fails immediately
      ['{"title":"ok","count":1}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [titleConstraint],
    })
    for await (const chunk of result.rawStream) {
      const delta = result.extractTextDelta(chunk)
      if (delta) seen.push(delta)
    }
    await result.completion()
    // Nothing from the blocked attempt — not even its structurally-valid prefix.
    expect(seen.join('')).toBe('{"title":"ok","count":1}')
    expect(seen.some((part) => part.includes('"title":""'))).toBe(false)
  })

  // `raw` is documented `Unsafe:` — it is the provider stream, so it BYPASSES the
  // gates that `rawStream` enforces. This proves the documented hazard is real, so the
  // JSDoc warning cannot silently become false.
  it('proves raw bypasses Safety rewrites that rawStream applies', async () => {
    const redactor = guardrail({
      id: 'redact-secret',
      on: boundary.output.object<{ title: string; count: number }>().path('title'),
      run: (title: string) =>
        title === 'secret'
          ? { action: 'rewrite' as const, value: 'REDACTED', rewrite: { kind: 'redact' as const } }
          : { action: 'allow' as const },
    })
    const wire = '{"title":"secret","count":1}'

    // The gated surface applies the rewrite.
    const gated = await createAdapterExecution(scriptedStreamDialect([[wire]]).dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      guardrails: [redactor],
    })
    expect(await drainStream(gated)).toContain('REDACTED')

    // `raw` is the provider stream: draining it directly bypasses that rewrite.
    const unsafe = await createAdapterExecution(scriptedStreamDialect([[wire]]).dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      guardrails: [redactor],
    })
    let rawText = ''
    for await (const chunk of unsafe.raw as AsyncIterable<{ text?: string }>) {
      if (chunk.text) rawText += chunk.text
    }
    expect(rawText).toBe(wire) // the unredacted secret — exactly the documented hazard
  })

  // Usage/metadata from the ACCEPTED attempt is preserved across a retry.
  it('preserves completion metadata from the accepted attempt across a retry', async () => {
    const { dialect } = scriptedStreamDialect([
      ['{"title":"a","count":-1}'],
      ['{"title":"a","count":9}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countConstraint],
    })
    await drainStream(result)
    const meta = await result.completion()
    expect(meta?.finishReason).toBe('stop')
    expect(meta?.object).toEqual({ title: 'a', count: 9 })
    expect(meta?.text).toBe('{"title":"a","count":9}')
  })
})

describe('native structured stream attempt spans', () => {
  // ── RED 6: one logical run id, one `generation.stream`, and a distinct
  // `generation.stream.attempt` child per physical provider call.
  it('emits one attempt span per provider call under a single logical stream', async () => {
    const starts: Array<{ primitive?: string; runId?: string; spanId?: string; attributes?: Record<string, unknown> }> =
      []
    const ends: Array<{ spanId?: string; attributes?: Record<string, unknown> }> = []
    subscribeObservability(['span:start'], (record) => starts.push(record))
    subscribeObservability(['span:end'], (record) => ends.push(record))

    const countAssert = constraint({
      id: 'count-positive',
      on: boundary.output.object<{ title: string; count: number }>(),
      run: (obj: { title: string; count: number }) =>
        obj.count > 0 ? { pass: true } : { pass: false, feedback: 'positive' },
    })
    const { dialect } = scriptedStreamDialect([
      ['{"title":"a","count":-1}'], // rejected → discarded
      ['{"title":"a","count":2}'], // accepted
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countAssert],
    })
    await drainStream(result)
    await result.completion()

    const streamSpans = starts.filter((r) => r.primitive === 'generation.stream')
    const attemptSpans = starts.filter((r) => r.primitive === 'generation.stream.attempt')
    // Exactly one logical stream span; one attempt span per provider call.
    expect(streamSpans).toHaveLength(1)
    expect(attemptSpans).toHaveLength(2)
    // Attempt spans share the logical run id.
    expect(attemptSpans.every((s) => s.runId === streamSpans[0]?.runId)).toBe(true)
    // Causes are truthful: initial, then a constraint retry.
    expect(attemptSpans.map((s) => s.attributes?.cause)).toEqual(['initial', 'constraint-retry'])
    expect(attemptSpans.map((s) => s.attributes?.attemptIndex)).toEqual([0, 1])
    // Outcomes: the rejected attempt is `discarded` (policy), not a provider error.
    const attemptSpanIds = new Set(attemptSpans.map((s) => s.spanId))
    const attemptEnds = ends.filter((r) => attemptSpanIds.has(r.spanId))
    expect(attemptEnds.map((s) => s.attributes?.outcome)).toEqual(['discarded', 'accepted'])
    expect(attemptEnds[0]?.attributes?.failedPolicies).toEqual(['count-positive'])
  })

  it('emits an attempt span for an ordinary single-attempt stream', async () => {
    const starts: Array<{ primitive?: string; attributes?: Record<string, unknown> }> = []
    subscribeObservability(['span:start'], (record) => starts.push(record))
    const titleAssert = constraint({
      id: 'title-nonempty',
      on: boundary.output.object<{ title: string; count: number }>().path('title'),
      run: (title: string) => (title.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
    })
    const { dialect } = scriptedStreamDialect([['{"title":"a","count":1}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [titleAssert],
    })
    await drainStream(result)
    await result.completion()
    const attempts = starts.filter((r) => r.primitive === 'generation.stream.attempt')
    expect(attempts).toHaveLength(1)
    expect(attempts[0]?.attributes?.cause).toBe('initial')
  })

  // The Devtools timeline renders exactly these attempt attributes. Snapshotting them
  // as one record fixes what an operator can see: enough to explain why output was
  // withheld and re-streamed, and provably nothing of the withheld candidate itself.
  it('renders a buffering explanation with no held content (devtools fixture)', async () => {
    const SECRET = 'withheld-draft-title'
    const starts: Array<{ primitive?: string; spanId?: string; attributes?: Record<string, unknown> }> = []
    const ends: Array<{ spanId?: string; attributes?: Record<string, unknown> }> = []
    subscribeObservability(['span:start'], (record) => starts.push(record))
    subscribeObservability(['span:end'], (record) => ends.push(record))

    const countAssert = constraint({
      id: 'count-positive',
      on: boundary.output.object<{ title: string; count: number }>(),
      // Feedback is authored instruction prose only — no model output interpolated.
      run: (obj: { title: string; count: number }) =>
        obj.count > 0 ? { pass: true } : { pass: false, feedback: 'count must be positive' },
    })
    const { dialect } = scriptedStreamDialect([
      [`{"title":"${SECRET}","count":-1}`], // rejected → discarded, never published
      ['{"title":"published","count":2}'], // accepted
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countAssert],
    })
    await drainStream(result)
    await result.completion()

    const attemptStarts = starts.filter((r) => r.primitive === 'generation.stream.attempt')
    const attemptSpanIds = new Set(attemptStarts.map((s) => s.spanId))
    const timeline = attemptStarts.map((start, index) => ({
      ...(start.attributes as Record<string, unknown>),
      ...(ends.find((e) => e.spanId === start.spanId)?.attributes as Record<string, unknown>),
      order: index,
    }))

    expect(timeline).toEqual([
      { order: 0, attemptIndex: 0, cause: 'initial', outcome: 'discarded', failedPolicies: ['count-positive'] },
      { order: 1, attemptIndex: 1, cause: 'constraint-retry', outcome: 'accepted' },
    ])
    // The rendered timeline never carries the discarded candidate.
    expect(JSON.stringify(timeline)).not.toContain(SECRET)
    // Nor does any other span emitted for this stream.
    const emitted = JSON.stringify([...starts, ...ends])
    expect(emitted).not.toContain(SECRET)
    expect(attemptSpanIds.size).toBe(2)
  })

  // Spans are not the whole observability surface: `token.chunk` events carry live
  // delta text. A discarded attempt must not reach ANY observability record.
  it('leaks no discarded-attempt text into any observability record', async () => {
    const SECRET = 'discarded-secret-title'
    const records: unknown[] = []
    subscribeObservability((record) => records.push(record))

    const countAssert = constraint({
      id: 'count-positive',
      on: boundary.output.object<{ title: string; count: number }>(),
      run: (obj: { title: string; count: number }) =>
        obj.count > 0 ? { pass: true } : { pass: false, feedback: 'count must be positive' },
    })
    const { dialect } = scriptedStreamDialect([
      [`{"title":"${SECRET}","count":-1}`], // discarded: never published
      ['{"title":"published","count":2}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countAssert],
    })
    await drainStream(result)
    await result.completion()

    expect(JSON.stringify(records)).not.toContain(SECRET)
    // The chunk event itself still exists (timing/size stay measurable); only its
    // text is withheld while the attempt is discardable.
    const tokenChunks = records.filter(
      (r) => (r as { name?: string }).name === 'token.chunk',
    ) as Array<{ attributes?: Record<string, unknown> }>
    expect(tokenChunks.length).toBeGreaterThan(0)
    expect(tokenChunks[0]?.attributes).not.toHaveProperty('text')
    expect(tokenChunks[0]?.attributes?.charCount).toBeGreaterThan(0)
  })

  // The suppression must be scoped to gated streams: an ordinary stream publishes
  // everything it observes, so withholding its token text would be a pure loss.
  it('still records token text on an ordinary ungated stream', async () => {
    const records: unknown[] = []
    subscribeObservability((record) => records.push(record))
    const { dialect } = scriptedStreamDialect([['{"title":"visible","count":1}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
    })
    await drainStream(result)
    await result.completion()

    const tokenChunks = records.filter(
      (r) => (r as { name?: string }).name === 'token.chunk',
    ) as Array<{ attributes?: Record<string, unknown> }>
    expect(tokenChunks.length).toBeGreaterThan(0)
    expect(tokenChunks.map((c) => c.attributes?.text).join('')).toContain('visible')
  })
})

/** Drain a coordinated stream expecting a terminal rejection; return the thrown error. */
async function drainForError(result: {
  readonly rawStream: AsyncIterable<unknown>
  readonly completion: () => Promise<unknown>
}): Promise<unknown> {
  try {
    for await (const _chunk of result.rawStream) void _chunk
    await result.completion()
    return undefined
  } catch (error) {
    return error
  }
}

// RFC #173 requires both routes to observe the same retry policy. The SDK route
// coordinates on any assert gate, so the native route must too — gating coordination
// on `hasSchema` silently terminated a TEXT assert after one attempt while the same
// policy retried on `@use-crux/ai`.
describe('native text-boundary assert parity', () => {
  it('retries a rejected text assert instead of failing closed on the first attempt', async () => {
    const run = vi.fn((text: string) =>
      text.includes('[1]') ? { pass: true as const } : { pass: false as const, feedback: 'Cite a source.' },
    )
    const cite = constraint({ id: 'cite-sources', on: boundary.output.text(), run })
    const { dialect, calls } = scriptedStreamDialect([
      ['no citation here'], // rejected → discarded, never published
      ['now with [1]'], // accepted
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: textPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [cite],
    })
    const published = await drainStream(result)
    await result.completion()

    // Two provider calls: the assert retried rather than terminating.
    expect(calls).toHaveLength(2)
    expect(run).toHaveBeenCalledTimes(2)
    // Only the accepted attempt's bytes reached the consumer.
    expect(published).toBe('now with [1]')
    expect(published).not.toContain('no citation here')
    // The retry carried corrective feedback.
    expect(JSON.stringify(calls[1])).toContain('Cite a source.')
  })

  it('still throws ConstraintViolationError once the budget is exhausted', async () => {
    const cite = constraint({
      id: 'cite-sources',
      on: boundary.output.text(),
      maxRetries: 1,
      run: (text: string) =>
        text.includes('[1]') ? { pass: true as const } : { pass: false as const, feedback: 'Cite a source.' },
    })
    const { dialect } = scriptedStreamDialect([['nope'], ['still nope'], ['still nope']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: textPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [cite],
    })
    let published = ''
    let error: unknown
    try {
      published = await drainStream(result)
      await result.completion()
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConstraintViolationError)
    // Nothing was published on the way to exhaustion.
    expect(published).toBe('')
  })
})

const countGreaterThanOne = constraint({
  id: 'count-gt-1',
  on: boundary.output.object<{ title: string; count: number }>().path('count'),
  run: (count: number) => (count > 1 ? { pass: true } : { pass: false, feedback: 'count must exceed 1' }),
})

// A rejected attempt must actually cancel its provider stream. The coordinator awaits
// `abort()` before retrying, so a no-op there leaves the rejected request live.
describe('rejected attempt cancellation', () => {
  it('cancels the provider stream of a discarded attempt', async () => {
    const closed: number[] = []
    const scripts = [
      ['{"title":"a",', '"count":1}', '   '],
      ['{"title":"a","count":2}'],
    ]
    let attempt = 0
    const client = { kind: 'core' as const }
    const dialect: AdapterExecutionDialect<
      typeof client,
      string,
      { readonly text: string },
      never,
      Record<string, unknown>
    > = {
      kind: 'core-step',
      id: 'mock-stream',
      client,
      structuredOutput: { accepts: permissiveCapabilities },
      mapSettings: (settings) => ({ ...settings }),
      call: async () => {
        throw new Error('not used')
      },
      stream: async (): Promise<StreamHandle<AsyncIterable<{ text: string }>>> => {
        const index = attempt++
        const deltas = scripts[index] ?? ['']
        // A generator observes cancellation through `finally` when `.return()` runs.
        const iterable = (async function* () {
          try {
            for (const delta of deltas) yield { text: delta }
          } finally {
            closed.push(index)
          }
        })()
        return {
          rawStream: iterable,
          extractTextDelta: (chunk) => (chunk as { text?: string }).text,
          completion: async () => ({ finishReason: 'stop' as const }),
        }
      },
      appendToolRound: (messages, assistant: AdapterResponse) => [
        ...messages,
        { role: 'assistant' as const, content: assistant.text },
      ],
    }

    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countGreaterThanOne],
    })
    await drainStream(result)
    await result.completion()

    // Attempt 0 rejected early with deltas still pending; its stream must be closed.
    expect(closed).toContain(0)
  })
})

// `completion()` is documented as safe to await without consuming `deltas`. A rendezvous
// handoff made that a deadlock: the drive loop blocked on a consumer that never arrived.
describe('coordinated completion is independent of consumption', () => {
  it('resolves completion when the caller never drains deltas', async () => {
    const { dialect } = scriptedStreamDialect([['{"title":"a","count":2}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countConstraint],
    })
    // No `drainStream` — completion must settle on its own.
    const meta = await Promise.race([
      result.completion(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('completion deadlocked')), 4000)),
    ])
    expect((meta as { object?: unknown })?.object).toEqual({ title: 'a', count: 2 })
  })

  it('still replays every delta to a consumer that attaches after completion', async () => {
    const { dialect } = scriptedStreamDialect([['{"title":"a",', '"count":2}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: structuredPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [countConstraint],
    })
    await result.completion()
    // Buffered deltas are replayable: nothing was dropped while nobody was reading.
    expect(await drainStream(result)).toBe('{"title":"a","count":2}')
  })
})

// End-to-end proof of the governing rule: an object assertion that passed on the value
// the gate saw must NOT authorize release when a downstream text guard can still rewrite
// that value. Zero bytes may publish, and the invalidated assertion must drive a retry.
describe('deferred commitment across a downstream rewrite', () => {
  const nameSafe = constraint({
    id: 'name-safe',
    on: boundary.output.object<{ name: string; n: number }>().path('name'),
    run: (name: string) =>
      name === 'safe' ? { pass: true } : { pass: false, feedback: 'name must be safe' },
  })

  function mixedPrompt() {
    return makePrompt({
      id: 'mixed',
      system: 'Return JSON.',
      prompt: ({ input }) => (input as { message: string }).message,
      input: z.object({ message: z.string() }),
      output: z.object({ name: z.string(), n: z.number() }),
    })
  }

  it('retries when a text rewrite turns a passing occurrence into a failing one', async () => {
    let calls = 0
    // Rewrites "safe" → "unsafe" on the FIRST attempt only, so the retry can succeed.
    const rewriteOnce = guardrail({
      id: 'rewrite-once',
      on: boundary.output.text().complete(),
      run: (text: string) => {
        calls += 1
        return calls === 1
          ? { action: 'rewrite' as const, value: text.replace('"safe"', '"unsafe"'), rewrite: { kind: 'redact' as const } }
          : { action: 'allow' as const }
      },
    })
    const { dialect, calls: providerCalls } = scriptedStreamDialect([
      ['{"name":"safe","n":1}'],
      ['{"name":"safe","n":2}'],
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: mixedPrompt(),
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      constraints: [nameSafe],
      guardrails: [rewriteOnce],
    })
    const published = await drainStream(result)
    const meta = await result.completion()

    // The invalidated assertion forced another attempt...
    expect(providerCalls).toHaveLength(2)
    // ...and the rewritten, failing value never reached the consumer.
    expect(published).not.toContain('unsafe')
    expect(meta?.object).toEqual({ name: 'safe', n: 2 })
  })
})

// The authored schema must run exactly once per candidate. A validation gate parses the
// candidate before publishing it, and completion previously parsed the SAME value again,
// so transforms and stateful refinements ran twice.
describe('one authored parse per candidate', () => {
  it('parses the accepted candidate once and publishes that parse data', async () => {
    let parses = 0
    const counted = z
      .object({ title: z.string(), count: z.number() })
      .transform((value) => {
        parses += 1
        return { ...value, seen: parses }
      })
    const countedPrompt = makePrompt({
      id: 'counted',
      system: 'Return JSON.',
      prompt: ({ input }) => (input as { message: string }).message,
      input: z.object({ message: z.string() }),
      output: counted,
    })
    const { dialect } = scriptedStreamDialect([['{"title":"a","count":2}']])
    const result = await createAdapterExecution(dialect).stream({
      prompt: countedPrompt,
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      validationRetry: { maxRetries: 1 },
    })
    await drainStream(result)
    const meta = await result.completion()

    expect(parses).toBe(1)
    // And `result.object` IS that parse's data, transform included.
    expect(meta?.object).toEqual({ title: 'a', count: 2, seen: 1 })
  })

  it('parses each rejected candidate once as well', async () => {
    let parses = 0
    const counted = z
      .object({ title: z.string(), count: z.number().refine((n) => n > 1, 'too small') })
      .transform((value) => {
        parses += 1
        return value
      })
    const countedPrompt = makePrompt({
      id: 'counted-retry',
      system: 'Return JSON.',
      prompt: ({ input }) => (input as { message: string }).message,
      input: z.object({ message: z.string() }),
      output: counted,
    })
    const { dialect, calls } = scriptedStreamDialect([
      ['{"title":"a","count":1}'], // rejected by the refinement
      ['{"title":"a","count":2}'], // accepted
    ])
    const result = await createAdapterExecution(dialect).stream({
      prompt: countedPrompt,
      model: 'm',
      modelInfo: { provider: 'mock-stream', modelId: 'm' },
      input: { message: 'go' },
      validationRetry: { maxRetries: 1 },
    })
    await drainStream(result)
    await result.completion()

    expect(calls).toHaveLength(2)
    // The rejected candidate never reaches the transform (the refinement fails first),
    // and the accepted one is transformed exactly once.
    expect(parses).toBe(1)
  })
})
