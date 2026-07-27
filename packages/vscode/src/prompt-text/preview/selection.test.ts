import { describe, expect, it, vi } from 'vitest'
import { PromptTextPreviewRequests } from './requests.js'
import {
  promptTextPreviewChoiceLabel,
  resolvePromptTextPreview,
} from './selection.js'
import { previewSource, range } from './test-fixtures.js'

describe('resolvePromptTextPreview', () => {
  it('formats exact ordinal and one-based line Quick Pick labels', () => {
    expect(
      promptTextPreviewChoiceLabel({
        ordinal: 2,
        range: range(4, 3, 5, 0),
      }),
    ).toBe('Template 3 — line 5')
  })

  it('cancels Quick Pick without a second request or side effect', async () => {
    const source = previewSource()
    const request = vi.fn(async () => ({
      protocolVersion: 1 as const,
      uri: source.uri,
      openEpoch: source.openEpoch,
      version: source.version,
      sourceHash: source.sourceHash,
      kind: 'choose' as const,
      requestStatus: 'complete' as const,
      choices: [{ ordinal: 0, range: range(3, 1, 5, 2) }],
    }))

    const result = await resolvePromptTextPreview(
      source,
      { line: 3, character: 2 },
      new PromptTextPreviewRequests(request),
      async () => undefined,
    )

    expect(result).toEqual({ kind: 'cancelled' })
    expect(request).toHaveBeenCalledOnce()
  })

  it('rejects an otherwise valid response with a stale exact stamp', async () => {
    const source = previewSource()
    const requests = new PromptTextPreviewRequests(async () => ({
      protocolVersion: 1,
      uri: source.uri,
      openEpoch: source.openEpoch,
      version: source.version + 1,
      sourceHash: source.sourceHash,
      kind: 'unavailable',
      reason: 'template-not-found',
    }))

    expect(
      await resolvePromptTextPreview(
        source,
        { line: 3, character: 2 },
        requests,
        vi.fn(),
      ),
    ).toEqual({ kind: 'stale' })
  })

  it('treats transport rejection as analysis unavailable', async () => {
    const source = previewSource()
    const requests = new PromptTextPreviewRequests(async () => {
      throw new Error('client disconnected')
    })

    expect(
      await resolvePromptTextPreview(
        source,
        { line: 3, character: 2 },
        requests,
        vi.fn(),
      ),
    ).toEqual({
      kind: 'unavailable',
      reason: 'analysis-unavailable',
    })
  })
})
