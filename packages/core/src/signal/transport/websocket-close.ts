/**
 * Pure WebSocket close-code helpers for managed provider-ingress adapters.
 *
 * @remarks Core does **not** open sockets or own browser/Node WebSocket APIs.
 * Adapters observe a close code, then use these helpers to decide whether the
 * connection completed cleanly, should reconnect (transient), or should durable
 * fault (terminal via `ManagedStreamTerminalError`).
 *
 * Classification summary (RFC 6455 + common app ranges):
 *
 * | Close code | Kind | Notes |
 * | --- | --- | --- |
 * | 1000 | normal | Clean close → iterator EOF → Runtime reconnect/backoff |
 * | 1001 | transient | Going away |
 * | 1006 | transient | Abnormal closure (no close frame) |
 * | 1002, 1003, 1007, 1008 | terminal | Protocol / policy / type errors |
 * | 1011 | transient | Server error |
 * | 1012, 1013, 1014 | transient | Service restart / try again / bad gateway |
 * | 4000–4999 | terminal by default | App range; treat known auth codes as terminal |
 * | Other / unknown | transient | Prefer reconnect over permanent fault |
 *
 * @module
 */

/** Result of classifying one WebSocket close code. */
export type WebSocketCloseKind = "normal" | "transient" | "terminal";

/**
 * Classify a WebSocket close code for managed reconnect policy.
 *
 * @param code - Close code observed by the adapter (RFC 6455 or app range).
 * @returns `"normal"` for clean EOF, `"terminal"` when reconnect is unsafe,
 *   otherwise `"transient"`.
 *
 * @remarks Adapters should map `"normal"` to clean iterator completion (no
 * throw), `"transient"` to an ordinary `Error`, and `"terminal"` to
 * `ManagedStreamTerminalError(webSocketCloseErrorCode(code), ...)`.
 */
export function classifyWebSocketCloseCode(code: number): WebSocketCloseKind {
  if (!Number.isInteger(code)) {
    return "transient";
  }

  if (code === 1000) {
    return "normal";
  }

  // Protocol / data / policy faults that should not spin forever.
  if (code === 1002 || code === 1003 || code === 1007 || code === 1008) {
    return "terminal";
  }

  // Common auth-style application codes (non-normative but widely used).
  if (code === 4001 || code === 4003 || code === 4401 || code === 4403) {
    return "terminal";
  }

  // Residual 4xxx app range: default terminal so misconfigured clients stop.
  // Adapters that need reconnect for a specific app code should throw ordinary
  // errors themselves instead of consulting this helper for that code.
  if (code >= 4000 && code <= 4999) {
    return "terminal";
  }

  // 1001 going away, 1006 abnormal, 1011 server error, 1012–1014 retryable, etc.
  return "transient";
}

/**
 * Secret-free durable error code for a WebSocket close.
 *
 * @param code - Close code observed by the adapter.
 * @returns A code matching the managed-stream safe pattern `[A-Za-z0-9_.-]{1,64}`.
 *
 * @remarks Prefer throwing `ManagedStreamTerminalError(code, message)` when
 * {@link classifyWebSocketCloseCode} returns `"terminal"`.
 */
export function webSocketCloseErrorCode(code: number): string {
  if (Number.isInteger(code) && code >= 0 && code <= 4999) {
    return `WS_CLOSE_${code}`;
  }

  return "WS_CLOSE_UNKNOWN";
}
