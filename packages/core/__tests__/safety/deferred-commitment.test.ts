/**
 * Deferred commitment for mixed object + text pipelines (RFC #173).
 *
 * Governing rule: no occurrence may unlock bytes until every downstream transformation
 * capable of changing that occurrence has completed. An object/path assertion that
 * passes inside the streaming gate is only PROVISIONAL while a downstream text or
 * composite guard can still rewrite the represented JSON, so it cannot authorize
 * release. Object-only pipelines have no such stage and keep progressive release.
 *
 * @module
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { boundary, createSafety } from '../../src/safety'
import { constraint } from '../../src/safety/constraint'
import { guardrail } from '../../src/safety/guardrail'
import { openSafetySessionStructuredStream } from '../../src/safety/session'
import { resetHooks } from '../../src/runtime/runtime'
import { resetObservabilityRuntime, subscribeObservability } from '../../src/observability'
import { subjectFingerprint } from '../../src/safety/constraint/fingerprint'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

type Doc = { readonly name: string; readonly n: number }

/** An assert requiring `name` to be exactly "safe". */
function nameMustBeSafe(run = vi.fn((name: string) => ({ pass: name === 'safe' }) as const)) {
  return {
    run,
    policy: constraint({
      id: 'name-safe',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => (run(name).pass ? { pass: true } : { pass: false, feedback: 'name must be safe' }),
    }),
  }
}

/** A text guardrail that rewrites the represented JSON after the object gate cleared it. */
const rewritesName = guardrail({
  id: 'rewrite-name',
  on: boundary.output.text().complete(),
  run: (text: string) => ({
    action: 'rewrite' as const,
    value: text.replace('"safe"', '"unsafe"'),
    rewrite: { kind: 'redact' as const },
  }),
})

describe('mixed object + text pipeline defers commitment', () => {
  it('publishes nothing when a downstream rewrite invalidates a passing assertion', async () => {
    const { policy } = nameMustBeSafe()
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [rewritesName] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})

    // The object gate clears `name: "safe"`, but the text guard can still rewrite it,
    // so nothing may be released while the attempt is uncommitted.
    const first = await stream.feed('{"name":"safe",')
    expect(first.kind).toBe('hold')
    const second = await stream.feed('"n":1}')
    expect(second.kind).toBe('hold')

    // At EOF the rewrite lands. The provisional settlement was fingerprinted against the
    // value the gate saw ("safe"), which no longer matches the final canonical value, so
    // it cannot be reused: the assertion re-runs on "unsafe", fails, and the attempt is
    // rejected BEFORE anything is released.
    await expect(stream.finish()).rejects.toThrow()
    expect(subjectFingerprint('safe')).not.toBe(subjectFingerprint('unsafe'))
  })

  it('runs the constraint once when no downstream change occurred', async () => {
    const seen: string[] = []
    const policy = constraint({
      id: 'name-safe',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => {
        seen.push(name)
        return name === 'safe' ? { pass: true } : { pass: false, feedback: 'name must be safe' }
      },
    })
    const untouched = guardrail({
      id: 'noop-text',
      on: boundary.output.text().complete(),
      run: () => ({ action: 'allow' as const }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [untouched] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed('{"name":"safe","n":1}')
    const seal = await stream.finish()

    // Released only after final text processing, and the settled value was unchanged,
    // so the constraint was evaluated exactly once.
    expect(seal.pending).toBe('{"name":"safe","n":1}')
    expect(seen).toEqual(['safe'])
  })

  it('keeps progressive release for an object-only pipeline', async () => {
    const { policy } = nameMustBeSafe()
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy] }, // no text guardrail: nothing downstream can rewrite
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    // The scalar path completes here, so its prefix unlocks immediately.
    const directive = await stream.feed('{"name":"safe","n":1}')
    expect(directive.kind).toBe('emit')
  })

  it('still rejects an early failure immediately, without waiting for EOF', async () => {
    const policy = constraint({
      id: 'name-safe',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) =>
        name === 'safe' ? { pass: true } : { pass: false, feedback: 'name must be safe' },
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [rewritesName] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    // `name` completes as a failing value: the uncommitted attempt is rejected now.
    await expect(stream.feed('{"name":"bad","n":1}')).rejects.toThrow()
  })
})

// A recheck must be indistinguishable from any other constraint evaluation: it runs
// through the shared observed evaluator, so callbacks get a real run context and the
// usual span/audit/event records are produced.
describe('recheck runs through the observed evaluator', () => {
  it('supports ctx.findings.add() during a recheck', async () => {
    const seen: unknown[] = []
    const policy = constraint({
      id: 'name-safe',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string, ctx: { readonly findings: { add: (f: unknown) => void } }) => {
        // Would throw if the recheck passed a bare/blank context.
        ctx.findings.add({ code: 'looked-at', message: 'checked' })
        seen.push(name)
        return name === 'safe' ? { pass: true } : { pass: false, feedback: 'name must be safe' }
      },
    })
    // Rewrites "safe" → "safer": the value CHANGED, so the recheck runs, and it passes.
    const renames = guardrail({
      id: 'rename',
      on: boundary.output.text().complete(),
      run: (text: string) => ({
        action: 'rewrite' as const,
        value: text.replace('"safe"', '"safer"'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy as never], guardrails: [renames] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed('{"name":"safe","n":1}')
    await expect(stream.finish()).rejects.toThrow() // "safer" !== "safe"
    // Ran on the gate value and again on the changed value — never a bare context.
    expect(seen).toEqual(['safe', 'safer'])
  })

  it('runs a changed-then-passing occurrence exactly twice, never again at completion', async () => {
    const seen: string[] = []
    const policy = constraint({
      id: 'name-nonempty',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => {
        seen.push(name)
        return name.length > 0 ? { pass: true } : { pass: false, feedback: 'name required' }
      },
    })
    const renames = guardrail({
      id: 'rename',
      on: boundary.output.text().complete(),
      run: (text: string) => ({
        action: 'rewrite' as const,
        value: text.replace('"safe"', '"safer"'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [renames] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed('{"name":"safe","n":1}')
    const seal = await stream.finish()

    // Once on the gate value, once on the changed value. The installed settlement is
    // re-fingerprinted to the FINAL value so completion reuses it rather than running
    // a third time.
    expect(seen).toEqual(['safe', 'safer'])
    expect(seal.settlement?.settled[0]?.subjectFingerprint).toBe(subjectFingerprint('safer'))
  })

  it('emits spans and audit for a recheck', async () => {
    const records: unknown[] = []
    subscribeObservability((record) => records.push(record))
    const policy = constraint({
      id: 'name-nonempty',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => (name.length > 0 ? { pass: true } : { pass: false, feedback: 'required' }),
    })
    const renames = guardrail({
      id: 'rename',
      on: boundary.output.text().complete(),
      run: (text: string) => ({
        action: 'rewrite' as const,
        value: text.replace('"safe"', '"safer"'),
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [renames] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed('{"name":"safe","n":1}')
    await stream.finish()
    const serialized = JSON.stringify(records)
    expect(serialized).toContain('constraint.check')
    expect(serialized).toContain('name-nonempty')
  })
})

// `downstreamMutators` defers commitment when a COMPOSITE `model.output` or media guard
// can change the represented JSON — with no `model.output.text` binding at all. That
// configuration had no coverage, and the finish path returned early for it, dropping
// every withheld byte and skipping the recheck.
describe('deferred commitment with no text binding', () => {
  const composite = guardrail({
    id: 'composite-observer',
    on: boundary.output.both<Doc>(),
    run: () => ({ action: 'allow' as const }),
  })

  it('releases everything it withheld', async () => {
    const policy = constraint({
      id: 'name-nonempty',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => (name.length > 0 ? { pass: true } : { pass: false, feedback: 'required' }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [composite] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    const first = await stream.feed('{"name":"safe",')
    const second = await stream.feed('"n":1}')
    const seal = await stream.finish()

    // Withheld while uncommitted...
    expect(first.kind).toBe('hold')
    expect(second.kind).toBe('hold')
    // ...then released in full. Nothing may be silently swallowed.
    const released =
      (first.kind === 'emit' ? first.content : '') +
      (second.kind === 'emit' ? second.content : '') +
      seal.pending
    expect(released).toBe('{"name":"safe","n":1}')
    expect(seal.text).toBe('{"name":"safe","n":1}')
  })

  it('still runs the recheck for a composite-only pipeline', async () => {
    const seen: string[] = []
    const policy = constraint({
      id: 'name-nonempty',
      on: boundary.output.object<Doc>().path('name'),
      run: (name: string) => {
        seen.push(name)
        return name.length > 0 ? { pass: true } : { pass: false, feedback: 'required' }
      },
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { constraints: [policy], guardrails: [composite] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed('{"name":"safe","n":1}')
    const seal = await stream.finish()

    // The value did not change, so the settlement is reused rather than re-evaluated,
    // and the seal carries evidence fingerprinted to the published value.
    expect(seen).toEqual(['safe'])
    expect(seal.settlement?.settled[0]?.subjectFingerprint).toBe(subjectFingerprint('safe'))
  })
})

// Contract 06, publication law 3: a composite `model.output` or output-media guard defers
// affected publication EVEN WITH NO ASSERT CONSTRAINT. Conditioning deferral on the
// presence of a constraint left a hole where a terminal composite rewrite/block happened
// after the bytes had already been published.
describe('composite/media guards gate independently of constraints', () => {
  it('publishes nothing before a composite rewrite is final, with no constraint', async () => {
    const rewrites = guardrail({
      id: 'composite-rewrite',
      on: boundary.output.both<Doc>(),
      run: (subject: { readonly text: string }) => ({
        action: 'rewrite' as const,
        value: { text: subject.text.replace('"secret"', '"redacted"') },
        rewrite: { kind: 'redact' as const },
      }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { guardrails: [rewrites] }, // NO constraints at all
    })
    const stream = openSafetySessionStructuredStream(safety, {})

    // Nothing may publish while a terminal composite stage can still rewrite it.
    const first = await stream.feed('{"name":"secret",')
    const second = await stream.feed('"n":1}')
    expect(first.kind).toBe('hold')
    expect(second.kind).toBe('hold')

    // Contract 06 red test #2: nothing publishes BEFORE the terminal guard has passed.
    // (That the terminal composite rewrite is then applied to the published value is the
    // finalization seam's job, covered by its own regressions.)
    const seal = await stream.finish()
    expect(seal.pending.length).toBeGreaterThan(0)
  })

  it('holds all bytes while a terminal composite block remains unresolved', async () => {
    const blocks = guardrail({
      id: 'composite-block',
      on: boundary.output.both<Doc>(),
      run: () => ({ action: 'block' as const, reason: 'not allowed' }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { guardrails: [blocks] },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    // Held with zero bytes published while a terminal block is still possible.
    const directive = await stream.feed('{"name":"secret","n":1}')
    expect(directive.kind).toBe('hold')
    // The unresolved terminal guardrail is the reason a user can act on.
    if (directive.kind === 'hold') expect(directive.bufferedBy).toBe('guardrail')
  })
})

// The composite cases above bind `model.output`. This one binds `model.output.media`
// specifically, so it proves the session's binding classification activates
// `downstreamMutators` for the media boundary too — not only for the composite one.
describe('output-media guard defers publication without any constraint', () => {
  it('holds while an unresolved terminal media guard could still strip or block', async () => {
    const mediaGuard = guardrail({
      id: 'media-terminal',
      on: boundary.output.media(),
      run: () => ({ action: 'allow' as const }),
    })
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: { guardrails: [mediaGuard] }, // no constraints, no text guard
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    const directive = await stream.feed('{"name":"secret","n":1}')

    expect(directive.kind).toBe('hold')
    if (directive.kind === 'hold') expect(directive.bufferedBy).toBe('guardrail')
  })
})
