import { describe, expect, it } from 'vitest'
import { validatePromptTextPreviewRefresh } from './refresh-result.js'
import { previewSource, range, readyResult } from './test-fixtures.js'

describe('validatePromptTextPreviewRefresh', () => {
  const target = range(3, 1, 5, 2)

  it('silently discards owner cancellation', () => {
    const source = previewSource()

    expect(
      validatePromptTextPreviewRefresh(null, source, source, target),
    ).toEqual({ kind: 'discarded' })
  })

  it('silently discards work whose source stamp was superseded locally', () => {
    const source = previewSource()
    const current = previewSource(undefined, {
      version: source.version + 1,
      sourceHash: 'b'.repeat(64),
    })

    expect(
      validatePromptTextPreviewRefresh(
        readyResult(source, target),
        source,
        current,
        target,
      ),
    ).toEqual({ kind: 'discarded' })
  })

  it('clears on current transport or foreign-result failure', () => {
    const source = previewSource()
    const foreign = {
      ...readyResult(source, target),
      version: source.version + 1,
    }

    expect(
      validatePromptTextPreviewRefresh(undefined, source, source, target),
    ).toEqual({
      kind: 'unavailable',
      reason: 'analysis-unavailable',
    })
    expect(
      validatePromptTextPreviewRefresh(foreign, source, source, target),
    ).toEqual({
      kind: 'unavailable',
      reason: 'analysis-unavailable',
    })
  })

  it('accepts only a current ready result at the exact range', () => {
    const source = previewSource()

    expect(
      validatePromptTextPreviewRefresh(
        readyResult(source, target),
        source,
        source,
        target,
      ),
    ).toEqual({ kind: 'ready', ready: readyResult(source, target) })
  })
})
