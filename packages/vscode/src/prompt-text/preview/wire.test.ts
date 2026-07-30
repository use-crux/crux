import { describe, expect, it } from 'vitest'
import { parsePromptTextPreviewStaticResult } from './wire.js'
import type { PromptTextPreviewServerUnavailableReason } from './types.js'

const sourceHash = 'a'.repeat(64)

describe('parsePromptTextPreviewStaticResult', () => {
  it('accepts and detaches an exact ready result', () => {
    const value = readyResult()

    expect(parsePromptTextPreviewStaticResult(value)).toEqual(value)
  })

  it('accepts truncated, choose, and unavailable variants', () => {
    expect(
      parsePromptTextPreviewStaticResult({
        ...readyResult(),
        previewStatus: 'truncated',
        truncation: {
          reason: 'max-fragment-depth',
          limit: 4,
          emittedBytes: 7,
        },
      }),
    ).toEqual({
      ...readyResult(),
      previewStatus: 'truncated',
      truncation: {
        reason: 'max-fragment-depth',
        limit: 4,
        emittedBytes: 7,
      },
    })
    const stamp = resultStamp()
    expect(
      parsePromptTextPreviewStaticResult({
        ...stamp,
        kind: 'choose',
        requestStatus: 'truncated',
        choices: [
          { ordinal: 1, range: range(1, 0, 1, 8) },
          { ordinal: 3, range: range(4, 2, 5, 1) },
        ],
      }),
    ).toEqual({
      ...stamp,
      kind: 'choose',
      requestStatus: 'truncated',
      choices: [
        { ordinal: 1, range: range(1, 0, 1, 8) },
        { ordinal: 3, range: range(4, 2, 5, 1) },
      ],
    })
    expect(
      parsePromptTextPreviewStaticResult({
        ...stamp,
        kind: 'unavailable',
        reason: 'template-not-found',
      }),
    ).toEqual({
      ...stamp,
      kind: 'unavailable',
      reason: 'template-not-found',
    })
  })

  it.each([
    'document-not-open',
    'revision-mismatch',
    'analysis-unavailable',
    'request-unsupported',
    'template-not-found',
    'template-ambiguous',
    'template-unsupported',
    'preview-unavailable',
  ] satisfies readonly PromptTextPreviewServerUnavailableReason[])(
    'accepts the server-owned %s unavailable reason',
    (reason) => {
      const value = { ...resultStamp(), kind: 'unavailable', reason }
      expect(parsePromptTextPreviewStaticResult(value)).toEqual(value)
    },
  )

  it.each([
    { ...readyResult(), foreign: true },
    {
      ...readyResult(),
      selection: { ...readyResult().selection, foreign: true },
    },
    {
      ...readyResult(),
      selection: {
        ...readyResult().selection,
        range: {
          ...readyResult().selection.range,
          start: {
            ...readyResult().selection.range.start,
            foreign: true,
          },
        },
      },
    },
    {
      ...readyResult(),
      previewStatus: 'truncated',
      truncation: {
        reason: 'max-preview-bytes',
        limit: 8,
        emittedBytes: 8,
        foreign: true,
      },
    },
  ])('rejects unknown fields recursively', (value) => {
    expect(parsePromptTextPreviewStaticResult(value)).toBeUndefined()
  })

  it.each([
    { ...readyResult(), previewStatus: 'truncated' },
    {
      ...readyResult(),
      truncation: {
        reason: 'max-preview-bytes',
        limit: 8,
        emittedBytes: 8,
      },
    },
    {
      ...resultStamp(),
      kind: 'choose',
      requestStatus: 'complete',
      choices: [],
    },
    {
      ...resultStamp(),
      kind: 'choose',
      requestStatus: 'complete',
      choices: [
        { ordinal: 2, range: range(2, 0, 2, 4) },
        { ordinal: 2, range: range(3, 0, 3, 4) },
      ],
    },
    {
      ...resultStamp(),
      kind: 'choose',
      requestStatus: 'complete',
      choices: [
        { ordinal: 1, range: range(4, 0, 4, 4) },
        { ordinal: 2, range: range(3, 0, 3, 4) },
      ],
    },
    {
      ...resultStamp(),
      kind: 'unavailable',
      reason: 'target-lost',
    },
  ])('rejects invalid union invariants: %o', (value) => {
    expect(parsePromptTextPreviewStaticResult(value)).toBeUndefined()
  })
})

function readyResult() {
  return {
    ...resultStamp(),
    kind: 'ready',
    selection: {
      ordinal: 0,
      range: {
        start: { line: 3, character: 1 },
        end: { line: 5, character: 2 },
      },
    },
    requestStatus: 'complete',
    templateStatus: 'complete',
    previewStatus: 'complete',
    evidence: 'syntax-exact',
    text: '# Hello\n',
  } as const
}

function resultStamp() {
  return {
    protocolVersion: 1,
    uri: 'file:///repo/writer.ts',
    openEpoch: 2,
    version: 7,
    sourceHash,
  } as const
}

function range(
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number,
) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  }
}
