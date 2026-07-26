/**
 * Transactional `assert` commit gates on the structured stream (RFC #173, H).
 *
 * An `assert` constraint holds the whole attempt while unresolved (`bufferedBy:
 * 'constraint'`), then unlocks at its boundary's readiness: a scalar path when its
 * occurrence completes (early unlock), an `.items()` array at close, and a
 * root/composite at completion. A failed assert fails the stream closed with no
 * leaked bytes.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { boundary } from '../../src/safety'
import { constraint } from '../../src/safety/constraint/define'
import { StreamConstraintRejection } from '../../src/safety/constraint/settlement'
import type { ConstraintContext } from '../../src/safety/constraint/types'
import type { GuardrailContext } from '../../src/safety/guardrail/types'
import { createStructuredStreamGate } from '../../src/safety/stream/structured-stream-gate'

const guardCtx: GuardrailContext = {
  promptId: 'p',
  model: 'm',
  messages: [],
  systemPrompt: undefined,
  traceId: undefined,
  metadata: {},
  stream: { segment: true, last: true, heldChars: 0, heldMs: 0 },
}
const constraintContext: ConstraintContext = {
  promptId: 'p',
  model: 'm',
  traceId: undefined,
  attempt: 0,
  metadata: {},
}

function gateWith(asserts: readonly ReturnType<typeof constraint>[]) {
  return createStructuredStreamGate({
    objectBindings: [],
    guardContext: guardCtx,
    appendGuardrailAudit: () => {},
    assertConstraints: asserts,
    constraintContext,
  })
}

describe('structured assert commit gates', () => {
  it('holds output until a scalar-path assert resolves, then releases (early unlock)', async () => {
    const gate = gateWith([
      constraint({
        id: 'name-ok',
        on: boundary.output.object<{ name: string; extra: string }>().path('name'),
        run: (name: string) => (name.length > 0 ? { pass: true } : { pass: false, feedback: 'empty' }),
      }),
    ])
    const r1 = await gate.feed('{"name":"a')
    expect(r1).toBe('') // name not yet complete — the attempt is held
    expect(gate.heldBy()).toBe('constraint')
    const r2 = await gate.feed('lice","extra":"x"}')
    const seal = await gate.finish()
    // Once `name` completed and passed, the accumulated prefix released.
    expect(r2.length).toBeGreaterThan(0)
    expect(r1 + r2 + seal.pending).toBe('{"name":"alice","extra":"x"}')
  })

  it('buffers an .items() assert through array close and fails closed if a later item fails', async () => {
    const gate = gateWith([
      constraint({
        id: 'short-items',
        on: boundary.output.object<{ items: readonly string[] }>().path('items').items(),
        run: (item: string) => (item.length <= 3 ? { pass: true } : { pass: false, feedback: 'too long' }),
      }),
    ])
    const r1 = await gate.feed('{"items":["ok",')
    expect(r1).toBe('') // nothing leaks while the array is still open
    await expect(gate.feed('"toolong"]}')).rejects.toBeInstanceOf(StreamConstraintRejection)
  })

  it('holds a root assert to completion, then releases', async () => {
    const gate = gateWith([
      constraint({
        id: 'positive',
        on: boundary.output.object<{ a: number }>(),
        run: (obj: { a: number }) => (obj.a > 0 ? { pass: true } : { pass: false, feedback: 'not positive' }),
      }),
    ])
    const r1 = await gate.feed('{"a":1}')
    expect(r1).toBe('') // a root assert holds every byte to completion
    expect(gate.heldBy()).toBe('constraint')
    const seal = await gate.finish()
    expect(seal.pending).toBe('{"a":1}')
    expect(seal.parsed).toEqual({ a: 1 })
  })

  it('fails closed when a root assert fails at completion', async () => {
    const gate = gateWith([
      constraint({
        id: 'positive',
        on: boundary.output.object<{ a: number }>(),
        run: (obj: { a: number }) => (obj.a > 0 ? { pass: true } : { pass: false, feedback: 'not positive' }),
      }),
    ])
    await gate.feed('{"a":-1}')
    await expect(gate.finish()).rejects.toBeInstanceOf(StreamConstraintRejection)
  })

  it('resolves a missing optional-path assert vacuously at completion', async () => {
    const gate = gateWith([
      constraint({
        id: 'note-ok',
        on: boundary.output.object<{ note?: string; a: number }>().path('note'),
        // Never runs: the absent path selects no occurrence (vacuous pass).
        run: () => ({ pass: false, feedback: 'should not run' }),
      }),
    ])
    const r1 = await gate.feed('{"a":1}')
    expect(r1).toBe('') // held while the path assert is unresolved
    expect(gate.heldBy()).toBe('constraint')
    const seal = await gate.finish() // `note` never arrived → vacuous pass → release
    expect(seal.pending).toBe('{"a":1}')
    expect(seal.parsed).toEqual({ a: 1 })
  })

  it('does not hold when no assert constraints are attached', async () => {
    const gate = createStructuredStreamGate({
      objectBindings: [],
      guardContext: guardCtx,
      appendGuardrailAudit: () => {},
    })
    const r1 = await gate.feed('{"a":1}')
    expect(gate.heldBy()).toBeUndefined()
    const seal = await gate.finish()
    expect(r1 + seal.pending).toBe('{"a":1}')
  })
})
