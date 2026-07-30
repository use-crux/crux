import type {
  PromptTextPreviewControllerPorts,
  PromptTextPreviewSource,
  PromptTextPreviewStaticParams,
  PromptTextPreviewStaticResult,
} from './types.js'

interface PendingPreviewRequest {
  readonly uri: string
  readonly slotId?: number
}

/** Owns cancellation tokens for explicit and slot-scoped preview pulls. */
export class PromptTextPreviewRequests {
  readonly #pending = new Map<AbortController, PendingPreviewRequest>()

  constructor(
    private readonly request: PromptTextPreviewControllerPorts['request'],
  ) {}

  /**
   * Pull one stamped result, returning null only when this owner canceled it.
   * Transport rejection remains a distinct undefined analysis failure.
   */
  async pull(
    source: PromptTextPreviewSource,
    target: PromptTextPreviewStaticParams['target'],
    slotId?: number,
  ): Promise<PromptTextPreviewStaticResult | undefined | null> {
    const cancellation = new AbortController()
    this.#pending.set(cancellation, { uri: source.uri, slotId })
    try {
      const result = await this.request(
        {
          protocolVersion: 1,
          uri: source.uri,
          openEpoch: source.openEpoch,
          version: source.version,
          sourceHash: source.sourceHash,
          target,
        },
        cancellation.signal,
      )
      return cancellation.signal.aborted ? null : result
    } catch {
      return cancellation.signal.aborted ? null : undefined
    } finally {
      this.#pending.delete(cancellation)
    }
  }

  /** Abort every explicit or refresh pull for one canonical source URI. */
  cancelSource(uri: string): void {
    for (const [request, identity] of this.#pending) {
      if (identity.uri === uri) request.abort()
    }
  }

  /** Abort only work owned by one retained preview slot. */
  cancelSlot(slotId: number): void {
    for (const [request, identity] of this.#pending) {
      if (identity.slotId === slotId) request.abort()
    }
  }

  /** Abort and forget all owned pulls during controller disposal. */
  dispose(): void {
    for (const request of this.#pending.keys()) request.abort()
    this.#pending.clear()
  }
}
