import { describe, expect, it, vi } from 'vitest'
import type { PromptTextPreviewDocument } from './provider.js'
import { PromptTextPreviewDocumentUpdates } from './updates.js'

describe('PromptTextPreviewDocumentUpdates', () => {
  it('ignores a delayed clear event while waiting for republished bytes', async () => {
    const document: PromptTextPreviewDocument = {
      uri: 'crux-prompt-preview:/Static%20preview.md?slot=1',
      languageId: 'markdown',
      eol: 'lf',
      text: '# Original\n',
    }
    const updates = new PromptTextPreviewDocumentUpdates(() => document)
    const invalidate = vi.fn()
    let settled = false
    const pending = updates
      .refresh(document, '# Edited\n', invalidate)
      .then((updated) => {
        settled = true
        return updated
      })

    updates.changed({ ...document, text: '' })
    await Promise.resolve()
    expect(settled).toBe(false)

    updates.changed({ ...document, text: '# Edited\n' })
    await expect(pending).resolves.toMatchObject({ text: '# Edited\n' })
    expect(invalidate).toHaveBeenCalledOnce()
  })
})
