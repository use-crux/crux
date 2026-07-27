import { describe, expect, it } from 'vitest'
import {
  createPreviewMetadataTitle,
  createPreviewResourceIdentity,
  promptTextPreviewUnavailableMessage,
  sanitizePreviewSourceLabel,
} from './metadata.js'
import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewServerUnavailableReason,
} from './types.js'

describe('static preview metadata', () => {
  it('builds the canonical sanitized bounded resource identity', () => {
    expect(
      sanitizePreviewSourceLabel('/private/秘密/..writer 🎉 preview_name.tsx'),
    ).toBe('writer-preview_name.tsx')
    expect(sanitizePreviewSourceLabel('/private/---')).toBe('source')
    expect(sanitizePreviewSourceLabel(`/x/${'a'.repeat(50)}.tsx`)).toBe(
      'a'.repeat(40),
    )

    expect(
      createPreviewResourceIdentity({
        id: 12,
        sourceUri: 'file:///private/repo/writer.ts',
        sourcePath: '/private/repo/writer.ts',
        initialLine: 4,
        range: range(),
      }),
    ).toEqual({
      path: '/Static preview — writer.ts L4 — 12.md',
      query: 'slot=12',
      title: 'Static preview — writer.ts L4 — 12.md',
    })
  })

  it('keeps exact preview state outside document bytes', () => {
    const ready = readyResult()
    expect(
      createPreviewMetadataTitle({
        kind: 'ready',
        sourcePath: '/private/repo/writer.ts',
        line: 4,
        ready,
      }),
    ).toBe(
      'Static preview — unknown values are placeholders' +
        ' · writer.ts:4 · syntax-exact' +
        ' · request complete · template complete · preview complete',
    )
    expect(
      createPreviewMetadataTitle({
        kind: 'ready',
        sourcePath: '/private/repo/writer.ts',
        line: 4,
        ready: {
          ...ready,
          text: '',
          previewStatus: 'complete',
        },
      }),
    ).toMatch(/ · empty$/)
    expect(
      createPreviewMetadataTitle({
        kind: 'ready',
        sourcePath: '/private/repo/writer.ts',
        line: 6,
        ready: {
          ...ready,
          previewStatus: 'truncated',
          truncation: {
            reason: 'max-fragment-depth',
            limit: 4,
            emittedBytes: 9,
          },
        },
      }),
    ).toMatch(/preview truncated: max fragment depth$/)
    expect(
      createPreviewMetadataTitle({
        kind: 'refreshing',
        sourcePath: '/private/repo/writer.ts',
        line: 7,
      }),
    ).toBe('Static preview — refreshing · writer.ts:7')
    expect(
      createPreviewMetadataTitle({
        kind: 'unavailable',
        sourcePath: '/private/repo/writer.ts',
        line: 7,
        reason: 'target-lost',
      }),
    ).toBe('Static preview — unavailable · writer.ts:7 · target-lost')
  })

  it('maps every server unavailable reason to its frozen command message', () => {
    const messages = {
      'document-not-open': 'Open the source document before previewing it.',
      'revision-mismatch':
        'The source changed before the static preview completed. Try again.',
      'analysis-unavailable': 'Static preview is temporarily unavailable.',
      'request-unsupported': 'Static preview does not support this document.',
      'template-not-found':
        'No PromptText template was found at the selected location.',
      'template-ambiguous':
        'Crux could not uniquely identify the selected PromptText template.',
      'template-unsupported':
        'This PromptText template cannot be statically previewed.',
      'preview-unavailable':
        'Static preview is unavailable for this PromptText template.',
    } as const satisfies Record<
      PromptTextPreviewServerUnavailableReason,
      string
    >

    for (const [reason, message] of Object.entries(messages)) {
      expect(
        promptTextPreviewUnavailableMessage(
          reason as PromptTextPreviewServerUnavailableReason,
        ),
      ).toBe(message)
    }
  })
})

function readyResult(): PromptTextPreviewReadyResult {
  return {
    protocolVersion: 1,
    uri: 'file:///private/repo/writer.ts',
    openEpoch: 2,
    version: 7,
    sourceHash: 'a'.repeat(64),
    kind: 'ready',
    selection: { ordinal: 0, range: range() },
    requestStatus: 'complete',
    templateStatus: 'complete',
    previewStatus: 'complete',
    evidence: 'syntax-exact',
    text: '# Hello',
  }
}

function range() {
  return {
    start: { line: 3, character: 1 },
    end: { line: 5, character: 2 },
  }
}
