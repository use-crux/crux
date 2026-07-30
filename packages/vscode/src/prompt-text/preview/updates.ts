import type { PromptTextPreviewDocument } from './provider.js'

// VS Code may serialize content-provider work behind other extension-host
// activity. Keep the waiter bounded without mistaking a loaded host for an
// editor EOL transformation.
const documentRefreshTimeoutMs = 15_000

interface PromptTextPreviewDocumentWaiter {
  readonly expectedText: string
  readonly resolve: (document: PromptTextPreviewDocument) => void
}

/**
 * Waits for VS Code to materialize one content-provider invalidation.
 *
 * Waiters are URI-local, bounded by active publications, and removed on both
 * change and timeout so closed or empty resources leave no retained cache.
 */
export class PromptTextPreviewDocumentUpdates {
  readonly #waiters = new Map<string, Set<PromptTextPreviewDocumentWaiter>>()

  constructor(
    private readonly currentDocument: (
      uri: string,
    ) => PromptTextPreviewDocument | undefined,
  ) {}

  /** Resolve only publications whose expected bytes reached the exact URI. */
  changed(document: PromptTextPreviewDocument): void {
    const waiters = this.#waiters.get(document.uri)
    if (waiters === undefined) return
    for (const waiter of [...waiters]) {
      if (waiter.expectedText !== document.text) continue
      waiters.delete(waiter)
      waiter.resolve(document)
    }
    if (waiters.size === 0) this.#waiters.delete(document.uri)
  }

  /**
   * Invalidate one URI and await either its document event or bounded lookup.
   * The returned snapshot is never assumed exact without caller comparison.
   */
  async refresh(
    document: PromptTextPreviewDocument,
    expectedText: string,
    invalidate: () => void,
  ): Promise<PromptTextPreviewDocument> {
    const uri = document.uri
    let waiter: PromptTextPreviewDocumentWaiter | undefined
    const changed = new Promise<PromptTextPreviewDocument>((resolve) => {
      waiter = { expectedText, resolve }
      const waiters = this.#waiters.get(uri) ?? new Set()
      waiters.add(waiter)
      this.#waiters.set(uri, waiters)
    })
    invalidate()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<PromptTextPreviewDocument>((resolve) => {
      timer = setTimeout(() => {
        const current = this.currentDocument(uri)
        resolve(
          current === undefined
            ? { uri, languageId: '', eol: 'lf', text: '' }
            : current,
        )
      }, documentRefreshTimeoutMs)
    })
    try {
      return await Promise.race([changed, timeout])
    } finally {
      if (timer !== undefined) clearTimeout(timer)
      const waiters = this.#waiters.get(uri)
      if (waiter !== undefined) waiters?.delete(waiter)
      if (waiters?.size === 0) this.#waiters.delete(uri)
    }
  }

  /** Resolve and release all waiters during extension deactivation. */
  clear(): void {
    for (const [uri, waiters] of this.#waiters) {
      for (const waiter of waiters) {
        waiter.resolve({ uri, languageId: '', eol: 'lf', text: '' })
      }
    }
    this.#waiters.clear()
  }
}
