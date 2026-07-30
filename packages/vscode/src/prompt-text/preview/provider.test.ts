import { describe, expect, it } from 'vitest'
import {
  PromptTextPreviewDocumentProvider,
  type PromptTextPreviewDocument,
  type PromptTextPreviewProviderPorts,
} from './provider.js'
import type {
  PromptTextPreviewReadyResult,
  PromptTextPreviewSlot,
} from './types.js'

describe('PromptTextPreviewDocumentProvider', () => {
  it('opens empty, publishes exact bytes, and keeps metadata outside content', async () => {
    const harness = providerHarness('lf')
    const provider = new PromptTextPreviewDocumentProvider(harness.ports)
    harness.attach(provider)

    expect(await provider.publish(slot(), ready('# Hello\n'), true)).toBe(
      'exact',
    )

    expect(harness.openedContent).toEqual([''])
    expect(provider.provideTextDocumentContent(harness.uri)).toBe('# Hello\n')
    expect(provider.provideCodeLensTitle(harness.uri)).toBe(
      'Static preview — unknown values are placeholders' +
        ' · writer.ts:4 · syntax-exact' +
        ' · request complete · template complete · preview complete',
    )
    expect(harness.shown).toEqual([harness.uri])
  })

  it('shows only the cleared unavailable tab when VS Code would normalize EOL bytes', async () => {
    const harness = providerHarness('lf')
    const provider = new PromptTextPreviewDocumentProvider(harness.ports)
    harness.attach(provider)

    expect(await provider.publish(slot(), ready('# Hello\r\n'), true)).toBe(
      'editor-eol-normalization',
    )

    expect(provider.provideTextDocumentContent(harness.uri)).toBe('')
    expect(provider.provideCodeLensTitle(harness.uri)).toBe(
      'Static preview — unavailable · writer.ts:4 · editor-eol-normalization',
    )
    expect(harness.shown).toEqual([harness.uri])
  })
})

function providerHarness(eol: 'lf' | 'crlf') {
  const uri = 'crux-prompt-preview:/Static%20preview.md?slot=1'
  const openedContent: string[] = []
  const shown: string[] = []
  let provider: PromptTextPreviewDocumentProvider | undefined
  const document: PromptTextPreviewDocument = {
    uri,
    languageId: 'markdown',
    eol,
    text: '',
  }
  const ports: PromptTextPreviewProviderPorts = {
    createUri: () => uri,
    openDocument: async () => {
      openedContent.push(provider?.provideTextDocumentContent(uri) ?? 'missing')
      return document
    },
    setMarkdownLanguage: async (value) => value,
    refreshDocument: async (value) => {
      const content = provider?.provideTextDocumentContent(uri) ?? ''
      document.text =
        eol === 'crlf'
          ? content.replace(/(?<!\r)\n/gu, '\r\n')
          : content.replace(/\r\n/gu, '\n')
      return value
    },
    showDocument: async (value) => {
      shown.push(value.uri)
    },
    contentChanged() {},
    codeLensesChanged() {},
  }
  return {
    uri,
    openedContent,
    shown,
    ports,
    attach(value: PromptTextPreviewDocumentProvider) {
      provider = value
    },
  }
}

function slot(): PromptTextPreviewSlot {
  return {
    id: 1,
    sourceUri: 'file:///private/repo/writer.ts',
    sourcePath: '/private/repo/writer.ts',
    initialLine: 4,
    range: {
      start: { line: 3, character: 1 },
      end: { line: 5, character: 2 },
    },
  }
}

function ready(text: string): PromptTextPreviewReadyResult {
  return {
    protocolVersion: 1,
    uri: 'file:///private/repo/writer.ts',
    openEpoch: 2,
    version: 7,
    sourceHash: 'a'.repeat(64),
    kind: 'ready',
    selection: {
      ordinal: 0,
      range: slot().range,
    },
    requestStatus: 'complete',
    templateStatus: 'complete',
    previewStatus: 'complete',
    evidence: 'syntax-exact',
    text,
  }
}
