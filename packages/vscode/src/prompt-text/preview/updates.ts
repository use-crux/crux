import type { PromptTextPreviewDocument } from './provider.js'
import { findDocument, previewDocument } from './vscode-source.js'

// VS Code may serialize content-provider work behind other extension-host
// activity. Keep the waiter bounded without mistaking a loaded host for an
// editor EOL transformation.
const documentRefreshTimeoutMs = 15_000

/**
 * Waits for VS Code to materialize one content-provider invalidation.
 *
 * Waiters are URI-local, bounded by active publications, and removed on both
 * change and timeout so closed or empty resources leave no retained cache.
 */
export class PromptTextPreviewDocumentUpdates {
  readonly #waiters = new Map<
    string,
    Set<(document: PromptTextPreviewDocument) => void>
  >()

  /** Resolve every waiter for the exact URI with VS Code's current bytes. */
  changed(document: PromptTextPreviewDocument): void {
    const waiters = this.#waiters.get(document.uri)
    this.#waiters.delete(document.uri)
    for (const resolve of waiters ?? []) resolve(document)
  }

  /**
   * Invalidate one URI and await either its document event or bounded lookup.
   * The returned snapshot is never assumed exact without caller comparison.
   */
  async refresh(
    document: PromptTextPreviewDocument,
    invalidate: () => void,
  ): Promise<PromptTextPreviewDocument> {
    const uri = document.uri
    let settle: ((value: PromptTextPreviewDocument) => void) | undefined
    const changed = new Promise<PromptTextPreviewDocument>((resolve) => {
      settle = resolve
      const waiters = this.#waiters.get(uri) ?? new Set()
      waiters.add(resolve)
      this.#waiters.set(uri, waiters)
    })
    invalidate()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<PromptTextPreviewDocument>((resolve) => {
      timer = setTimeout(() => {
        const current = findDocument(uri)
        resolve(
          current === undefined
            ? { uri, languageId: '', eol: 'lf', text: '' }
            : previewDocument(current),
        )
      }, documentRefreshTimeoutMs)
    })
    try {
      return await Promise.race([changed, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      const waiters = this.#waiters.get(uri)
      if (settle !== undefined) waiters?.delete(settle)
      if (waiters?.size === 0) this.#waiters.delete(uri)
    }
  }

  /** Resolve and release all waiters during extension deactivation. */
  clear(): void {
    for (const [uri, waiters] of this.#waiters) {
      for (const resolve of waiters) {
        resolve({ uri, languageId: '', eol: 'lf', text: '' })
      }
    }
    this.#waiters.clear()
  }
}
