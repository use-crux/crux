/**
 * Format a canonical timeout budget for compact Devtools presentation.
 *
 * @param milliseconds - Positive, finite milliseconds from a resolved timeout
 *   policy.
 * @returns A compact milliseconds, seconds, or minutes label.
 */
export function formatTimeoutMs(milliseconds: number): string {
  if (milliseconds < 1_000) {
    return `${milliseconds} ms`;
  }

  if (milliseconds < 60_000) {
    return `${milliseconds / 1_000} s`;
  }

  const minutes = Math.floor(milliseconds / 60_000);
  const remainingSeconds = (milliseconds % 60_000) / 1_000;
  return remainingSeconds === 0
    ? `${minutes} min`
    : `${minutes} min ${remainingSeconds} s`;
}
