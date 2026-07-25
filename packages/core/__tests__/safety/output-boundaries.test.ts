/**
 * RFC #173 output boundary builders — runtime descriptor behavior.
 *
 * Every fluent result is a fresh frozen `BoundaryDef` recognized by
 * `isBoundaryDef`, carrying serializable refinement state (`unit`, `path`,
 * `options`) with the fluent methods installed as non-enumerable own properties
 * so configuration/trace serialization never sees functions.
 *
 * @module
 */

import { describe, expect, it } from 'vitest'
import { isBoundaryDef } from '../../src/safety'
import { outputObject, outputText } from '../../src/safety/output/output-boundaries'

describe('output boundary builders — descriptors', () => {
  it('text() is a frozen, recognized descriptor with no explicit unit (adaptive)', () => {
    const b = outputText()
    expect(isBoundaryDef(b)).toBe(true)
    expect(Object.isFrozen(b)).toBe(true)
    expect(b.id).toBe('model.output.text')
    // Unrefined: no explicit unit, so strategy/adaptive resolution can apply.
    expect((b as { unit?: string }).unit).toBeUndefined()
  })

  it('installs fluent methods as non-enumerable properties (not serialized)', () => {
    const b = outputText()
    expect(Object.keys(b)).not.toContain('deltas')
    expect(Object.keys(b)).not.toContain('complete')
    // Serialization sees descriptor data, not the fluent methods.
    expect(JSON.parse(JSON.stringify(b))).toEqual({
      _tag: 'Boundary',
      id: 'model.output.text',
    })
    // The methods are still callable via their non-enumerable slots.
    expect(typeof (b as { complete?: unknown }).complete).toBe('function')
  })

  it('each refinement returns a fresh frozen descriptor, never mutating the builder', () => {
    const base = outputText()
    const complete = base.complete()
    const sentences = base.sentences()
    expect(complete).not.toBe(base)
    expect(sentences).not.toBe(base)
    expect(Object.isFrozen(complete)).toBe(true)
    expect((base as { unit?: string }).unit).toBeUndefined()
    expect((complete as { unit?: string }).unit).toBe('complete')
    expect((sentences as { unit?: string }).unit).toBe('sentence')
  })

  it('object().path() carries the path; .items()/.sentences() set the unit', () => {
    const object = outputObject<{ items: readonly number[]; summary: string }>()
    expect((object as { unit?: string }).unit).toBeUndefined()

    const items = object.path('items').items()
    expect(isBoundaryDef(items)).toBe(true)
    expect(items.id).toBe('model.output.object')
    expect((items as { unit?: string }).unit).toBe('item')
    expect(items.path).toBe('items')

    const sentences = object.path('summary').sentences({ maxHold: { chars: 500 } })
    expect((sentences as { unit?: string }).unit).toBe('sentence')
    expect(sentences.path).toBe('summary')
    expect((sentences as { options?: unknown }).options).toEqual({ maxHold: { chars: 500 } })
  })

  it('segments() stores its configuration as serializable options', () => {
    const b = outputText().segments({ maxCharacters: 40, next: (buffer) => (buffer.length >= 40 ? 40 : undefined) })
    expect((b as { unit?: string }).unit).toBe('segment')
    // The function is retained on the descriptor options for the engine,
    // but the descriptor itself remains frozen and recognized.
    expect(Object.isFrozen(b)).toBe(true)
    expect(isBoundaryDef(b)).toBe(true)
  })

  it('validates .segments() configuration at definition time', () => {
    expect(() => outputText().segments({ maxCharacters: 0, next: () => undefined })).toThrow(/maxCharacters/)
    expect(() => outputText().segments({ maxCharacters: -5, next: () => undefined })).toThrow(/maxCharacters/)
    expect(() =>
      outputText().segments({ maxCharacters: 1.5, next: () => undefined }),
    ).toThrow(/maxCharacters/)
    expect(() =>
      outputText().segments({ maxCharacters: 40, next: undefined as never }),
    ).toThrow(/next/)
    expect(() => outputText().segments({ maxCharacters: 40, next: () => undefined })).not.toThrow()
  })
})
