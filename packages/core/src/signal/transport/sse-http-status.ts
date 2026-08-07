/**
 * Pure HTTP status helpers for managed SSE connect failures.
 *
 * @remarks Core does **not** perform HTTP or own `fetch` / EventSource.
 * Adapters observe a connect response status, then use these helpers to decide
 * whether to throw {@link import("../../runtime/transport/stream-errors").ManagedStreamTerminalError}
 * (terminal) or an ordinary `Error` (transient reconnect).
 *
 * Classification summary:
 *
 * | HTTP status | Kind | Suggested code |
 * | --- | --- | --- |
 * | 401, 403, 404, 410 | terminal | `SSE_HTTP_${status}` |
 * | 408, 425, 429 | transient | `SSE_HTTP_${status}` |
 * | 5xx | transient | `SSE_HTTP_${status}` |
 * | Other 4xx | terminal | `SSE_HTTP_${status}` |
 *
 * Non-HTTP / network failures before a status remain adapter-owned ordinary
 * errors (transient by the stream fiber). 2xx is success — do not call these
 * helpers for successful connects.
 *
 * @module
 */

/** Result of classifying one HTTP connect failure status. */
export type SseHttpStatusKind = "terminal" | "transient";

/**
 * Classify an HTTP status from a failed SSE connect attempt.
 *
 * @param status - HTTP status code observed by the adapter (not 2xx).
 * @returns `"terminal"` when reconnect is unsafe; `"transient"` otherwise.
 *
 * @remarks Retryable 4xx (408, 425, 429) stay **transient**. Auth and permanent
 * endpoint failures (401, 403, 404, 410) and other 4xx are **terminal**. All
 * 5xx are **transient**.
 */
export function classifySseHttpStatus(status: number): SseHttpStatusKind {
  if (!Number.isInteger(status)) {
    // Non-integer statuses are not a protocol success path; treat as transient
    // so adapters still reconnect rather than permanently faulting.
    return "transient";
  }

  if (status >= 500 && status <= 599) {
    return "transient";
  }

  // Explicit retryable client timeouts / rate limits before the residual 4xx
  // terminal bucket (design table).
  if (status === 408 || status === 425 || status === 429) {
    return "transient";
  }

  if (status >= 400 && status <= 499) {
    return "terminal";
  }

  // Outside 4xx/5xx (including 1xx/3xx mis-use on a failure path): transient.
  return "transient";
}

/**
 * Secret-free durable error code for an SSE connect HTTP status.
 *
 * @param status - HTTP status code observed by the adapter.
 * @returns A code matching the managed-stream safe pattern `[A-Za-z0-9_.-]{1,64}`.
 *
 * @remarks Prefer throwing `ManagedStreamTerminalError(code, message)` when
 * {@link classifySseHttpStatus} returns `"terminal"`. Unsafe formatting is
 * avoided by construction (`SSE_HTTP_${integer}`).
 */
export function sseHttpStatusErrorCode(status: number): string {
  if (Number.isInteger(status) && status >= 100 && status <= 999) {
    return `SSE_HTTP_${status}`;
  }

  // Keep fallback inside the safe durable pattern for pathological inputs.
  return "SSE_HTTP_UNKNOWN";
}
