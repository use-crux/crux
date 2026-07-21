/** Minimal lifecycle surface shared by vscode-languageclient and unit fakes. */
export interface ManagedClient {
  start(): Promise<void>
  stop(): Promise<void>
}

/** Tracks one client while clearing failed or detached instances eagerly. */
export class ClientSlot<TClient extends ManagedClient = ManagedClient> {
  private current: TClient | undefined

  /** Starts and retains a client, clearing it if startup rejects. */
  async start(next: TClient): Promise<void> {
    this.current = next
    try {
      await next.start()
    } catch (error) {
      if (this.current === next) this.current = undefined
      throw error
    }
  }

  /** Detaches the current client before awaiting its fallible stop. */
  async stop(): Promise<void> {
    const current = this.take()
    if (current !== undefined) await current.stop()
  }

  /** Detaches and returns the current client without stopping it. */
  take(): TClient | undefined {
    const current = this.current
    this.current = undefined
    return current
  }
}
