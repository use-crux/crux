/**
 * Runtime retention configuration and resolution.
 *
 * Public composers accept friendly duration inputs. The kernel consumes a
 * resolved, millisecond-based policy so maintenance can stay policy-only and
 * adapters can stay storage-only.
 *
 * @module
 */

import { createRuntimeError } from './errors'

/** Duration accepted by Runtime Engine retention config fields. */
export type RuntimeRetentionDurationInput = string | number | false

/** Runtime Engine retention policy accepted by composers and kernel helpers. */
export interface RuntimeRetentionConfig {
  /** Event log retention. Defaults to `24h`; `false` keeps events forever. */
  readonly events?: RuntimeRetentionDurationInput
  /** Terminal work retention. Defaults to `7d`; `false` keeps work forever. */
  readonly terminalWork?: RuntimeRetentionDurationInput
  /** Confirmed outbox retention. Defaults to `24h`; `false` keeps rows forever. */
  readonly confirmedOutbox?: RuntimeRetentionDurationInput
  /** Completed idempotency-key retention. Defaults to `7d`; `false` keeps keys forever. */
  readonly idempotencyKeys?: RuntimeRetentionDurationInput
  /** Fired and cancelled timer retention. Defaults to `24h`; `false` keeps timers forever. */
  readonly settledTimers?: RuntimeRetentionDurationInput
  /** Resolved, timed-out, and cancelled waiter retention. Defaults to `24h`; `false` keeps waiters forever. */
  readonly settledWaiters?: RuntimeRetentionDurationInput
  /** Terminal flow snapshot retention. Defaults to `30d`; `false` keeps snapshots forever. */
  readonly terminalSnapshots?: RuntimeRetentionDurationInput
  /** Effect recovery-envelope retention. Defaults to `30d`; `false` keeps envelopes forever. */
  readonly effectEnvelopes?: RuntimeRetentionDurationInput
  /** Maximum records to remove per class per maintenance tick. Defaults to 200. */
  readonly sweepLimit?: number
}

/** Millisecond retention policy consumed by kernel maintenance. */
export interface ResolvedRuntimeRetentionConfig {
  readonly events: number | false
  readonly terminalWork: number | false
  readonly confirmedOutbox: number | false
  readonly idempotencyKeys: number | false
  readonly settledTimers: number | false
  readonly settledWaiters: number | false
  readonly terminalSnapshots: number | false
  readonly effectEnvelopes: number | false
  readonly sweepLimit: number
}

/** Options used when resolving retention against host/wake capabilities. */
export interface ResolveRuntimeRetentionOptions {
  /** Longest wake delay/redelivery horizon known to the composer. */
  readonly redeliveryHorizonMs?: number
}

const DEFAULT_RUNTIME_RETENTION_CONFIG = {
  events: '24h',
  terminalWork: '7d',
  confirmedOutbox: '24h',
  idempotencyKeys: '7d',
  settledTimers: '24h',
  settledWaiters: '24h',
  terminalSnapshots: '30d',
  effectEnvelopes: '30d',
  sweepLimit: 200,
} as const satisfies Required<RuntimeRetentionConfig>

/** Resolve public retention config to the millisecond policy used by maintenance. */
export function resolveRuntimeRetentionConfig(
  config: RuntimeRetentionConfig | undefined,
  options: ResolveRuntimeRetentionOptions = {},
): ResolvedRuntimeRetentionConfig {
  const resolved: ResolvedRuntimeRetentionConfig = Object.freeze({
    events: resolveRetentionDuration(config?.events ?? DEFAULT_RUNTIME_RETENTION_CONFIG.events, 'events'),
    terminalWork: resolveRetentionDuration(
      config?.terminalWork ?? DEFAULT_RUNTIME_RETENTION_CONFIG.terminalWork,
      'terminalWork',
    ),
    confirmedOutbox: resolveRetentionDuration(
      config?.confirmedOutbox ?? DEFAULT_RUNTIME_RETENTION_CONFIG.confirmedOutbox,
      'confirmedOutbox',
    ),
    idempotencyKeys: resolveRetentionDuration(
      config?.idempotencyKeys ?? DEFAULT_RUNTIME_RETENTION_CONFIG.idempotencyKeys,
      'idempotencyKeys',
    ),
    settledTimers: resolveRetentionDuration(
      config?.settledTimers ?? DEFAULT_RUNTIME_RETENTION_CONFIG.settledTimers,
      'settledTimers',
    ),
    settledWaiters: resolveRetentionDuration(
      config?.settledWaiters ?? DEFAULT_RUNTIME_RETENTION_CONFIG.settledWaiters,
      'settledWaiters',
    ),
    terminalSnapshots: resolveRetentionDuration(
      config?.terminalSnapshots ?? DEFAULT_RUNTIME_RETENTION_CONFIG.terminalSnapshots,
      'terminalSnapshots',
    ),
    effectEnvelopes: resolveRetentionDuration(
      config?.effectEnvelopes ?? DEFAULT_RUNTIME_RETENTION_CONFIG.effectEnvelopes,
      'effectEnvelopes',
    ),
    sweepLimit: resolveSweepLimit(config?.sweepLimit),
  })

  const horizon = options.redeliveryHorizonMs
  if (
    horizon !== undefined &&
    horizon > 0 &&
    resolved.idempotencyKeys !== false &&
    resolved.idempotencyKeys < horizon
  ) {
    throw createRuntimeError({
      code: 'SETUP_REQUIRED',
      whatFailed: 'Runtime retention config is not safe for wake redelivery.',
      why: '`retention.idempotencyKeys` is shorter than this runtime composer\'s wake horizon.',
      whatStillWorks:
        'Runtime configuration and typechecking still work before the runtime is resolved.',
      nextStep:
        'Set `retention.idempotencyKeys` to at least the wake adapter max delay, or use `false` to keep keys indefinitely.',
    })
  }

  return resolved
}

function resolveRetentionDuration(
  input: RuntimeRetentionDurationInput,
  field: keyof Omit<RuntimeRetentionConfig, 'sweepLimit'>,
): number | false {
  if (input === false) return false
  if (typeof input === 'number') {
    if (Number.isFinite(input) && input >= 0) return input
    throw invalidRetentionField(field, 'Use a non-negative millisecond number.')
  }
  const parsed = parseDuration(input)
  if (parsed !== undefined) return parsed
  throw invalidRetentionField(
    field,
    'Use a duration string such as `24h`, `30m`, `5s`, or `100ms`.',
  )
}

function resolveSweepLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_RUNTIME_RETENTION_CONFIG.sweepLimit
  if (Number.isInteger(limit) && limit > 0) return limit
  throw invalidRetentionField('sweepLimit', 'Use a positive integer.')
}

function parseDuration(duration: string): number | undefined {
  const match = duration.match(/^(\d+)\s*(ms|s|m|h|d)$/)
  if (!match) return undefined
  const value = Number.parseInt(match[1]!, 10)
  switch (match[2]) {
    case 'ms':
      return value
    case 's':
      return value * 1_000
    case 'm':
      return value * 60_000
    case 'h':
      return value * 3_600_000
    case 'd':
      return value * 86_400_000
    default:
      return undefined
  }
}

function invalidRetentionField(field: string, nextStep: string) {
  return createRuntimeError({
    code: 'SETUP_REQUIRED',
    whatFailed: `Runtime retention config field \`${field}\` is invalid.`,
    why: 'Retention durations must resolve to non-negative milliseconds, and sweepLimit must be bounded.',
    whatStillWorks:
      'Runtime configuration and typechecking still work before the runtime is resolved.',
    nextStep,
  })
}
