import { describe, expect, it } from 'vitest'
import { PromptTextPreviewSlots } from './slots.js'
import { previewSource, range } from './test-fixtures.js'

describe('PromptTextPreviewSlots', () => {
  it('retains the lower slot ID when transformed keys collide', () => {
    const slots = new PromptTextPreviewSlots(16)
    const source = previewSource('0123456789')
    const lower = slots.reserve(source, range(0, 2, 0, 4), {
      start: 2,
      end: 4,
    })
    const higher = slots.reserve(source, range(0, 6, 0, 8), {
      start: 6,
      end: 8,
    })
    expect(lower).toBeDefined()
    expect(higher).toBeDefined()

    const collision = slots.rekey(higher!, lower!.range)

    expect(collision).toEqual({ kept: false, ambiguous: higher })
    expect(slots.reserve(source, lower!.range, { start: 2, end: 4 })).toBe(
      lower,
    )
  })

  it('reuses a detached exact slot even when the catalogue is full', () => {
    const slots = new PromptTextPreviewSlots(1)
    const source = previewSource('0123456789')
    const expected = range(0, 2, 0, 4)
    const slot = slots.reserve(source, expected, { start: 2, end: 4 })
    expect(slot).toBeDefined()
    slots.lose(slot!)

    expect(slots.reserve(source, expected, { start: 2, end: 4 })).toBe(slot)
    expect(slots.reserve(source, expected, { start: 2, end: 4 })).toBe(slot)
    expect(slot?.tracked).toBe(true)
    expect(slots.size).toBe(1)
  })
})
