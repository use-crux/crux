import { describe, expect, it } from 'vitest'
import {
  PromptTextDocumentRevisions,
  promptTextSourceHash,
} from './document-revisions.js'

describe('PromptTextDocumentRevisions', () => {
  it('keeps one URI epoch across edits and advances it after close/reopen', () => {
    const revisions = new PromptTextDocumentRevisions()
    const first = revisions.stamp({
      uri: 'file:///writer.ts',
      version: 3,
      text: 'md`# First`',
    })
    const changed = revisions.stamp({
      uri: 'file:///writer.ts',
      version: 4,
      text: 'md`# Second`',
    })

    expect(changed.openEpoch).toBe(first.openEpoch)
    expect(changed.sourceHash).not.toBe(first.sourceHash)

    revisions.close('file:///writer.ts')
    const reopened = revisions.stamp({
      uri: 'file:///writer.ts',
      version: 1,
      text: 'md`# Second`',
    })
    expect(reopened.openEpoch).toBeGreaterThan(changed.openEpoch)
    expect(reopened.sourceHash).toBe(changed.sourceHash)
  })

  it('uses the canonical lowercase SHA-256 source digest', () => {
    expect(
      promptTextSourceHash(
        "import { md, prompt } from '@use-crux/core'\n" +
          'export const writer = prompt({\n' +
          "  id: 'writer',\n" +
          '  prompt: md`# Hello`,\n' +
          '})\n',
      ),
    ).toBe('9a7e2e745698e9315a7f3a066017ac71ea0ffea39aa494c71878e7f2a1197d4f')
  })
})
