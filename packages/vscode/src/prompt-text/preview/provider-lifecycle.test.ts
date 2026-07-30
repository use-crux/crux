import { describe, expect, it, vi } from 'vitest'
import {
  isPreviewEOLCompatible,
  PromptTextPreviewDocumentProvider,
  type PromptTextPreviewDocument,
  type PromptTextPreviewProviderPorts,
} from './provider.js'
import type { PromptTextPreviewReadyResult } from './types.js'
import { previewSource, range, readyResult } from './test-fixtures.js'

describe('PromptTextPreviewDocumentProvider lifecycle', () => {
  it('publishes and reveals an exact empty preview', async () => {
    const harness = createHarness()
    const ready = {
      ...readyResult(harness.source, harness.slot.range),
      text: '',
    }

    expect(await harness.provider.publish(harness.slot, ready, true)).toBe(
      'exact',
    )

    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe('')
    expect(harness.provider.provideCodeLensTitle(harness.uri)).toMatch(
      / · empty$/,
    )
    expect(harness.showDocument).toHaveBeenCalledOnce()
  })

  it('does not reveal before VS Code verifies the cleared document', async () => {
    let resolveClear:
      | ((document: PromptTextPreviewDocument) => void)
      | undefined
    let refreshes = 0
    const harness = createHarness({
      refreshDocument: async (_content, current) => {
        refreshes++
        if (refreshes === 1) return { ...current, text: '# normalized\n' }
        return new Promise((resolve) => {
          resolveClear = resolve
        })
      },
    })

    const publication = harness.provider.publish(
      harness.slot,
      {
        ...readyResult(harness.source, harness.slot.range),
        text: '# exact\n',
      },
      true,
    )
    await vi.waitFor(() => expect(refreshes).toBe(2))

    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe('')
    expect(harness.showDocument).not.toHaveBeenCalled()
    resolveClear?.({
      uri: harness.uri,
      languageId: 'markdown',
      eol: 'lf',
      text: '',
    })
    expect(await publication).toBe('editor-eol-normalization')
    expect(harness.showDocument).toHaveBeenCalledOnce()
  })

  it('keeps invalidating a visible resource until stale bytes are cleared', async () => {
    let refreshes = 0
    const harness = createHarness({
      refreshDocument: async (content, current) => {
        refreshes++
        return {
          ...current,
          text: refreshes === 2 ? '# exact\n' : content,
        }
      },
    })
    await harness.provider.publish(
      harness.slot,
      ready('# exact\n', harness),
      true,
    )

    expect(
      await harness.provider.publish(
        harness.slot,
        ready('# incompatible\r\n', harness),
        false,
      ),
    ).toBe('editor-eol-normalization')

    expect(refreshes).toBe(3)
    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe('')
  })

  it('stops stale clear retries when a newer publication supersedes them', async () => {
    let resolveStale:
      | ((document: PromptTextPreviewDocument) => void)
      | undefined
    let refreshes = 0
    const harness = createHarness({
      refreshDocument: async (content, current) => {
        refreshes++
        if (refreshes === 2) {
          return new Promise((resolve) => {
            resolveStale = resolve
          })
        }
        return { ...current, text: content }
      },
    })
    await harness.provider.publish(
      harness.slot,
      ready('# first\n', harness),
      false,
    )
    const stale = harness.provider.publish(
      harness.slot,
      ready('# incompatible\r\n', harness),
      true,
    )
    await vi.waitFor(() => expect(refreshes).toBe(2))

    expect(
      await harness.provider.publish(
        harness.slot,
        ready('# newest\n', harness),
        false,
      ),
    ).toBe('exact')
    resolveStale?.({
      uri: harness.uri,
      languageId: 'markdown',
      eol: 'lf',
      text: '# first\n',
    })
    await stale

    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe(
      '# newest\n',
    )
    expect(harness.showDocument).not.toHaveBeenCalled()
  })

  it('does not let an older failed publication dispose a newer result', async () => {
    let rejectFirst: ((reason: Error) => void) | undefined
    let opens = 0
    const harness = createHarness({
      openDocument: (document) => {
        opens++
        if (opens > 1) return Promise.resolve(document)
        return new Promise((_resolve, reject) => {
          rejectFirst = reject
        })
      },
    })
    const first = harness.provider.publish(
      harness.slot,
      ready('# first\n', harness),
      true,
    )
    const second = harness.provider.publish(
      harness.slot,
      ready('# second\n', harness),
      true,
    )
    await second

    rejectFirst?.(new Error('superseded open failed'))
    await first

    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe(
      '# second\n',
    )
  })

  it('serializes overlapping language establishment for one resource', async () => {
    let establish: ((document: PromptTextPreviewDocument) => void) | undefined
    const setMarkdownLanguage = vi.fn(
      () =>
        new Promise<PromptTextPreviewDocument>((resolve) => {
          establish = resolve
        }),
    )
    const harness = createHarness({
      languageId: 'plaintext',
      setMarkdownLanguage,
    })

    const first = harness.provider.publish(
      harness.slot,
      ready('# first\n', harness),
      true,
    )
    const second = harness.provider.publish(
      harness.slot,
      ready('# second\n', harness),
      true,
    )
    await vi.waitFor(() => expect(setMarkdownLanguage).toHaveBeenCalledOnce())
    establish?.({
      uri: harness.uri,
      languageId: 'markdown',
      eol: 'lf',
      text: '',
    })
    await Promise.all([first, second])

    expect(setMarkdownLanguage).toHaveBeenCalledOnce()
    expect(harness.provider.provideTextDocumentContent(harness.uri)).toBe(
      '# second\n',
    )
  })

  it.each([
    ['lf', 'plain', true],
    ['lf', 'one\nline', true],
    ['lf', 'one\r\nline', false],
    ['lf', 'one\rline', false],
    ['crlf', 'plain', true],
    ['crlf', 'one\r\nline', true],
    ['crlf', 'one\nline', false],
    ['crlf', 'one\rline', false],
  ] as const)('checks %s compatibility for %j', (eol, text, expected) => {
    expect(isPreviewEOLCompatible(text, eol)).toBe(expected)
  })
})

function createHarness(
  options: {
    readonly languageId?: string
    readonly publishedText?: (content: string) => string
    readonly openDocument?: (
      document: PromptTextPreviewDocument,
    ) => Promise<PromptTextPreviewDocument>
    readonly refreshDocument?: (
      content: string,
      document: PromptTextPreviewDocument,
    ) => Promise<PromptTextPreviewDocument>
    readonly setMarkdownLanguage?: (
      document: PromptTextPreviewDocument,
    ) => Promise<PromptTextPreviewDocument>
  } = {},
) {
  const source = previewSource()
  const slot = {
    id: 1,
    sourceUri: source.uri,
    sourcePath: source.sourcePath,
    initialLine: 4,
    range: range(3, 1, 5, 2),
  }
  const uri = 'crux-prompt-preview:/Static%20preview.md?slot=1'
  let document: PromptTextPreviewDocument = {
    uri,
    languageId: options.languageId ?? 'markdown',
    eol: 'lf',
    text: '',
  }
  const showDocument = vi.fn()
  let provider: PromptTextPreviewDocumentProvider
  const ports: PromptTextPreviewProviderPorts = {
    createUri: () => uri,
    openDocument: () =>
      options.openDocument?.(document) ?? Promise.resolve(document),
    setMarkdownLanguage: async (value) => {
      document = (await options.setMarkdownLanguage?.(value)) ?? {
        ...value,
        languageId: 'markdown',
      }
      return document
    },
    refreshDocument: async () => {
      const content = provider.provideTextDocumentContent(uri) ?? ''
      document = (await options.refreshDocument?.(content, document)) ?? {
        ...document,
        text: options.publishedText?.(content) ?? content,
      }
      return document
    },
    showDocument,
    contentChanged() {},
    codeLensesChanged() {},
  }
  provider = new PromptTextPreviewDocumentProvider(ports)
  return { source, slot, uri, provider, showDocument }
}

function ready(
  text: string,
  harness: ReturnType<typeof createHarness>,
): PromptTextPreviewReadyResult {
  return {
    ...readyResult(harness.source, harness.slot.range),
    text,
  }
}
