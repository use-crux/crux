/** Serializes language-client restarts without retaining failed queue state. */
export class RestartQueue {
  private tail: Promise<void> = Promise.resolve()

  /** Enqueues one restart and keeps later work runnable if it rejects. */
  enqueue(restart: () => Promise<void>): Promise<void> {
    const current = this.tail.then(restart)
    this.tail = current.catch(() => undefined)
    return current
  }
}
