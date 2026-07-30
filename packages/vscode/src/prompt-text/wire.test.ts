import { describe, expect, it } from 'vitest'
import { parsePromptTextDecorationResult } from './wire.js'

describe('parsePromptTextDecorationResult', () => {
  it('accepts an exact version-one heading replacement', () => {
    const value = {
      protocolVersion: 1,
      uri: 'file:///writer.ts',
      openEpoch: 2,
      version: 7,
      sourceHash: 'a'.repeat(64),
      decorations: [
        {
          role: 'heading',
          range: {
            start: { line: 3, character: 15 },
            end: { line: 3, character: 20 },
          },
        },
      ],
    }

    expect(parsePromptTextDecorationResult(value)).toEqual(value)
  })

  it.each([
    { protocolVersion: 2 },
    { sourceHash: 'not-a-digest' },
    { decorations: [{ role: 'unknown', range: range() }] },
    {
      decorations: [
        {
          role: 'heading',
          range: {
            start: { line: -1, character: 0 },
            end: { line: 0, character: 1 },
          },
        },
      ],
    },
  ])('rejects malformed or unknown wire evidence: %o', (change) => {
    expect(
      parsePromptTextDecorationResult({
        protocolVersion: 1,
        uri: 'file:///writer.ts',
        openEpoch: 2,
        version: 7,
        sourceHash: 'a'.repeat(64),
        decorations: [],
        ...change,
      }),
    ).toBeUndefined()
  })
})

function range() {
  return {
    start: { line: 0, character: 0 },
    end: { line: 0, character: 1 },
  }
}
