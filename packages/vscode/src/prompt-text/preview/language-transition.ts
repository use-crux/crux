interface TransitionState {
  closeSeen: boolean
  openSeen: boolean
}

/**
 * Distinguishes one synthetic language-change close/open from a real close.
 *
 * States are URI-scoped so concurrent first publications cannot suppress one
 * another's lifecycle. A second close fails closed and disposes the resource.
 */
export class PromptTextPreviewLanguageTransitions {
  readonly #states = new Map<string, TransitionState>()

  /** Begin one URI-local language transition before invoking VS Code. */
  begin(uri: string): void {
    this.#states.set(uri, { closeSeen: false, openSeen: false })
  }

  /** Accept only the open paired with a previously observed synthetic close. */
  opened(uri: string): boolean {
    const state = this.#states.get(uri)
    if (state === undefined || !state.closeSeen || state.openSeen) return false
    state.openSeen = true
    return true
  }

  /** Suppress the first synthetic close; treat any other close as disposal. */
  closed(uri: string): 'ignore' | 'dispose' {
    const state = this.#states.get(uri)
    if (state === undefined || state.closeSeen) {
      this.#states.delete(uri)
      return 'dispose'
    }
    state.closeSeen = true
    return 'ignore'
  }

  /** Verify that VS Code returned the same URI as Markdown after both events. */
  complete(
    expectedUri: string,
    returnedUri: string,
    languageId: string,
  ): boolean {
    const state = this.#states.get(expectedUri)
    return (
      state !== undefined &&
      state.closeSeen &&
      state.openSeen &&
      returnedUri === expectedUri &&
      languageId === 'markdown'
    )
  }

  /** Forget one completed or failed transition without retaining URI state. */
  finish(uri: string): void {
    this.#states.delete(uri)
  }

  /** Forget every transition during extension deactivation. */
  clear(): void {
    this.#states.clear()
  }
}
