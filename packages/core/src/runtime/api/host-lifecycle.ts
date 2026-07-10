import type { CruxContextStorage } from '../../shared/context-storage'

/**
 * Framework-neutral lifetime capabilities for one physical execution segment.
 *
 * Core never discovers framework globals. Adapters may provide any subset of
 * these capabilities at an invocation boundary; explicit arguments remain the
 * correctness path when no ambient context storage is available.
 */
export interface CruxHostLifecycle<TContext = unknown> {
  /** Optional segment-local ambient context supplied by the host adapter. */
  readonly context?: CruxContextStorage<TContext>
  /** Attach background work to the host lifetime primitive. */
  defer?(task: Promise<void>): void
  /** Absolute host deadline in epoch milliseconds, when the host exposes one. */
  deadline?(): number | undefined
}

/** Options for deriving a safe bounded drain budget from a host deadline. */
export interface CruxHostDeadlineOptions {
  /** Clock injection for deterministic tests. @default Date.now */
  readonly now?: () => number
  /** Time reserved before host termination. @default 0 */
  readonly safetyMarginMs?: number
}

/**
 * Return the remaining safe work budget for a host lifecycle.
 *
 * `undefined` means the host has no deadline. Invalid deadlines are ignored,
 * while elapsed deadlines return `0` so callers can stop work without treating
 * a timeout as a successful drain.
 */
export function remainingHostDeadlineMs(
  lifecycle: Pick<CruxHostLifecycle, 'deadline'> | undefined,
  options: CruxHostDeadlineOptions = {},
): number | undefined {
  const deadline = lifecycle?.deadline?.()
  if (deadline === undefined || !Number.isFinite(deadline)) return undefined

  const safetyMarginMs = Math.max(0, options.safetyMarginMs ?? 0)
  return Math.max(0, Math.floor(deadline - (options.now ?? Date.now)() - safetyMarginMs))
}

export type { CruxContextStorage } from '../../shared/context-storage'
