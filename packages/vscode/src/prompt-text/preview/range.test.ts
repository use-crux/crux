import { describe, expect, it } from 'vitest'
import { transformPreviewOffsets } from './range.js'

describe('transformPreviewOffsets', () => {
  it.each([
    {
      name: 'insertion before shifts both boundaries',
      changes: [{ rangeOffset: 2, rangeLength: 0, text: 'abc' }],
      want: { start: 13, end: 23 },
    },
    {
      name: 'insertion strictly inside extends the end',
      changes: [{ rangeOffset: 15, rangeLength: 0, text: 'abc' }],
      want: { start: 10, end: 23 },
    },
    {
      name: 'replacement ending at start shifts by its delta',
      changes: [{ rangeOffset: 5, rangeLength: 5, text: 'x' }],
      want: { start: 6, end: 16 },
    },
    {
      name: 'replacement strictly inside adjusts the end',
      changes: [{ rangeOffset: 12, rangeLength: 3, text: 'abcdef' }],
      want: { start: 10, end: 23 },
    },
    {
      name: 'descending changes use pre-event offsets',
      changes: [
        { rangeOffset: 2, rangeLength: 1, text: 'left' },
        { rangeOffset: 14, rangeLength: 2, text: '' },
        { rangeOffset: 25, rangeLength: 2, text: 'right' },
      ],
      want: { start: 13, end: 21 },
    },
  ])('$name', ({ changes, want }) => {
    expect(
      transformPreviewOffsets({ start: 10, end: 20 }, 30, changes),
    ).toEqual(want)
  })

  it.each([
    { changes: [{ text: 'full replacement' }] },
    { changes: [{ rangeOffset: 10, rangeLength: 0, text: 'boundary' }] },
    { changes: [{ rangeOffset: 20, rangeLength: 0, text: 'boundary' }] },
    { changes: [{ rangeOffset: 8, rangeLength: 4, text: 'crosses start' }] },
    { changes: [{ rangeOffset: 18, rangeLength: 4, text: 'crosses end' }] },
    { changes: [{ rangeOffset: 10, rangeLength: 2, text: 'touches start' }] },
    { changes: [{ rangeOffset: 18, rangeLength: 2, text: 'touches end' }] },
    {
      changes: [
        { rangeOffset: 2, rangeLength: 5, text: '' },
        { rangeOffset: 6, rangeLength: 3, text: '' },
      ],
    },
    { changes: [{ rangeOffset: 29, rangeLength: 2, text: '' }] },
  ])(
    'loses invalid, overlapping, or touching target changes: $changes',
    ({ changes }) => {
      expect(
        transformPreviewOffsets({ start: 10, end: 20 }, 30, changes),
      ).toBeUndefined()
    },
  )
})
