/**
 * Per-attempt timeout helper shared by the orchestration entry points and the
 * fallback loop.
 *
 * Wraps a single async attempt with an `AbortController`-backed deadline so a
 * slow provider call can be abandoned without leaking timers. Kept standalone so
 * both `orchestrate.ts` and `fallback-loop.ts` can depend on it without forming
 * an import cycle.
 *
 * @module
 * @internal
 */

/**
 * Wrap an async function call with a per-attempt timeout using AbortController.
 * If no timeout is set, runs the function directly with zero overhead.
 *
 * @param fn - The async function to execute
 * @param timeoutMs - Optional timeout in milliseconds. When exceeded, throws
 *   a `DOMException` with name `'AbortError'`.
 * @returns The result of `fn`
 *
 * @example
 * ```ts
 * const result = await withAttemptTimeout(
 *   () => client.chat.completions.create(args),
 *   10_000, // 10s timeout
 * )
 * ```
 */
export async function withAttemptTimeout<T>(fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
  if (!timeoutMs) return fn()

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => {
          reject(new DOMException('Fallback attempt timed out', 'AbortError'))
        })
      }),
    ])
    return result
  } finally {
    clearTimeout(timer)
  }
}
