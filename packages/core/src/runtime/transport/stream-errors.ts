/**
 * Terminal failure classification for managed stream transports.
 *
 * @remarks Transient failures are the default. Terminal shapes stop automatic
 * reconnect and drive durable `faulted` checkpoint status.
 *
 * @module
 */

/**
 * Provider-derived failure codes stored on checkpoints must stay bounded and
 * secret-free. Accept only ASCII `[A-Za-z0-9_.-]` with length 1..64.
 */
const SAFE_PROVIDER_ERROR_CODE = /^[A-Za-z0-9_.-]{1,64}$/;

/** Fallback code when a terminal error carries an unsafe or empty code. */
export const TRANSPORT_STREAM_TERMINAL_CODE = "TRANSPORT_STREAM_TERMINAL" as const;

/**
 * Non-reconnectable stream failure.
 *
 * @remarks Runtime sets durable checkpoint status to `faulted` and stops
 * automatic reconnect until config identity changes or an operator clears
 * status. Prefer a stable secret-free `code`.
 */
export class ManagedStreamTerminalError extends Error {
  readonly code: string;
  readonly terminal = true as const;

  constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "ManagedStreamTerminalError";
    this.code = code;
  }
}

/**
 * True when `error` is a terminal stream failure (class or duck-typed shape).
 *
 * @remarks Duck typing requires `terminal === true` and a string `code`. Safe
 * code formatting is enforced when reading durable codes via
 * {@link managedStreamTerminalErrorCode}, not at classification time, so
 * adapters with imperfect codes still fault rather than reconnect forever.
 */
export function isManagedStreamTerminalError(
  error: unknown,
): error is ManagedStreamTerminalError | { readonly terminal: true; readonly code: string } {
  if (error instanceof ManagedStreamTerminalError) {
    return true;
  }

  if (error === null || typeof error !== "object") {
    return false;
  }

  const candidate = error as { readonly terminal?: unknown; readonly code?: unknown };
  return (
    candidate.terminal === true && typeof candidate.code === "string"
  );
}

/**
 * Durable-safe code for a terminal stream failure, or `undefined` when not terminal.
 *
 * @remarks Unsafe or empty codes map to {@link TRANSPORT_STREAM_TERMINAL_CODE}.
 */
export function managedStreamTerminalErrorCode(
  error: unknown,
): string | undefined {
  if (!isManagedStreamTerminalError(error)) {
    return undefined;
  }

  const code = error.code;
  if (SAFE_PROVIDER_ERROR_CODE.test(code)) {
    return code;
  }

  return TRANSPORT_STREAM_TERMINAL_CODE;
}

/** True when `code` is safe to persist as a checkpoint lastErrorCode. */
export function isSafeProviderErrorCode(code: string): boolean {
  return SAFE_PROVIDER_ERROR_CODE.test(code);
}
