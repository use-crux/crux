/** Stream-bound tool-source cleanup. @internal */

import type { MaterializedToolSources } from "./tool-sources";

/**
 * Bind one idempotent cleanup promise to stream settlement and caller abort.
 *
 * The returned function is safe to call from raw-stream disposal, completion,
 * and setup error paths without closing source sessions more than once.
 */
export function createStreamSourceCleanup(
  sourceSession: MaterializedToolSources,
  signal: AbortSignal | undefined,
): () => Promise<void> {
  let cleanup: Promise<void> | undefined;
  const close = (): Promise<void> => {
    cleanup ??= sourceSession.close().finally(() => {
      signal?.removeEventListener("abort", onAbort);
    });
    return cleanup;
  };
  const onAbort = (): void => {
    void close();
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) void close();
  return close;
}
