import type {
  AcceptRuntimeTransportEnvelopeInput,
  AcceptRuntimeTransportEnvelopeResult,
  ClaimRuntimeTransportEnvelopesOptions,
  CompleteRuntimeTransportNormalizationInput,
  FailRuntimeTransportNormalizationInput,
  ReplayRuntimeTransportEnvelopeInput,
  RuntimeTransportEnvelopeIdentity,
  RuntimeTransportEnvelopeRecord,
  RuntimeTransportStorePort,
} from '@use-crux/core/runtime'

type StatisticsLedgerExport = NonNullable<
  Awaited<ReturnType<RuntimeTransportStorePort['getStatistics']>>
>
import { encodeJson } from './codec'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'
import { advisoryLockKey, table } from './sql'

/** Create the PostgreSQL managed-transport envelope transaction port. */
export function createPostgresTransportStore(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): RuntimeTransportStorePort {
  const envelopes = table(schema, 'transport_envelopes')
  const statistics = table(schema, 'transport_statistics')

  return {
    async get(identity) {
      const result = await db.query<Record<string, unknown>>(
        `SELECT * FROM ${envelopes}
          WHERE namespace = $1 AND provider = $2 AND account_id = $3 AND event_id = $4`,
        [
          identity.namespace,
          identity.provider,
          identity.accountId,
          identity.eventId,
        ],
      )
      return result.rows[0] ? decodeRecord(result.rows[0]) : null
    },

    async accept(
      input: AcceptRuntimeTransportEnvelopeInput,
    ): Promise<AcceptRuntimeTransportEnvelopeResult> {
      const now = input.now.toISOString()
      recordWrite(faults)
      const inserted = await db.query<Record<string, unknown>>(
        `INSERT INTO ${envelopes} (
          namespace, provider, account_id, event_id, binding_id, envelope,
          envelope_digest, state, attempts, max_attempts, accepted_at,
          updated_at, next_attempt_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6::jsonb, $7, 'accepted', 0, $8, $9, $9, $9
        )
        ON CONFLICT DO NOTHING
        RETURNING *`,
        [
          input.namespace,
          input.envelope.provider,
          input.envelope.accountId,
          input.envelope.eventId,
          input.envelope.bindingId,
          encodeJson(input.envelope),
          input.envelopeDigest,
          input.maxAttempts,
          now,
        ],
      )
      if (inserted.rows[0]) {
        return Object.freeze({
          kind: 'accepted' as const,
          record: decodeRecord(inserted.rows[0]),
        })
      }

      const existing = await getIdentity(db, envelopes, {
        namespace: input.namespace,
        provider: input.envelope.provider,
        accountId: input.envelope.accountId,
        eventId: input.envelope.eventId,
      })
      if (!existing) {
        throw new Error('Failed to read existing transport envelope.')
      }
      if (existing.envelopeDigest !== input.envelopeDigest) {
        return Object.freeze({ kind: 'conflict' as const, record: existing })
      }
      return Object.freeze({ kind: 'duplicate' as const, record: existing })
    },

    async claim(options: ClaimRuntimeTransportEnvelopesOptions) {
      const now = options.now.toISOString()
      const leaseExpiresAt = new Date(
        options.now.getTime() + options.leaseMs,
      ).toISOString()
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `WITH candidates AS (
          SELECT namespace, provider, account_id, event_id
          FROM ${envelopes}
          WHERE namespace = $1
            AND (
              (state = 'accepted' AND next_attempt_at <= $2::timestamptz)
              OR (state = 'claimed' AND lease_expires_at <= $2::timestamptz)
            )
          ORDER BY next_attempt_at ASC, provider ASC, account_id ASC, event_id ASC
          LIMIT $3
          FOR UPDATE SKIP LOCKED
        )
        UPDATE ${envelopes} AS target
        SET state = 'claimed',
            attempts = target.attempts + 1,
            updated_at = $2::timestamptz,
            next_attempt_at = $4::timestamptz,
            lease_token = $5,
            lease_expires_at = $4::timestamptz
        FROM candidates
        WHERE target.namespace = candidates.namespace
          AND target.provider = candidates.provider
          AND target.account_id = candidates.account_id
          AND target.event_id = candidates.event_id
        RETURNING target.*`,
        [
          options.namespace,
          now,
          options.limit,
          leaseExpiresAt,
          options.leaseToken,
        ],
      )
      return Object.freeze(result.rows.map(decodeRecord))
    },

    async completeNormalization(
      input: CompleteRuntimeTransportNormalizationInput,
    ) {
      const existing = await getIdentity(db, envelopes, input.identity)

      if (!existing) {
        return null
      }

      if (existing.state === 'normalized') {
        return existing
      }

      if (
        existing.state !== 'claimed' ||
        existing.leaseToken !== input.leaseToken
      ) {
        return null
      }
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `UPDATE ${envelopes}
          SET state = 'normalized',
              updated_at = $5::timestamptz,
              next_attempt_at = $5::timestamptz,
              lease_token = NULL,
              lease_expires_at = NULL,
              lineage = $7::jsonb
          WHERE namespace = $1 AND provider = $2 AND account_id = $3 AND event_id = $4
            AND state = 'claimed' AND lease_token = $6
          RETURNING *`,
        [
          input.identity.namespace,
          input.identity.provider,
          input.identity.accountId,
          input.identity.eventId,
          input.now.toISOString(),
          input.leaseToken,
          encodeJson(encodeLineagePayload(input.lineage, input.lineageTruncated)),
        ],
      )
      return result.rows[0] ? decodeRecord(result.rows[0]) : null
    },

    async failNormalization(input: FailRuntimeTransportNormalizationInput) {
      const existing = await getIdentity(db, envelopes, input.identity)
      if (
        !existing ||
        existing.state !== 'claimed' ||
        existing.leaseToken !== input.leaseToken
      ) {
        return null
      }
      const deadLetter = existing.attempts >= existing.maxAttempts
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `UPDATE ${envelopes}
          SET state = $5,
              updated_at = $6::timestamptz,
              next_attempt_at = $7::timestamptz,
              lease_token = NULL,
              lease_expires_at = NULL,
              last_failure = $8::jsonb
          WHERE namespace = $1 AND provider = $2 AND account_id = $3 AND event_id = $4
            AND state = 'claimed' AND lease_token = $9
          RETURNING *`,
        [
          input.identity.namespace,
          input.identity.provider,
          input.identity.accountId,
          input.identity.eventId,
          deadLetter ? 'dead-letter' : 'accepted',
          input.now.toISOString(),
          deadLetter
            ? input.now.toISOString()
            : input.nextAttemptAt.toISOString(),
          encodeJson({
            message: input.message,
            ...(input.code === undefined ? {} : { code: input.code }),
          }),
          input.leaseToken,
        ],
      )
      return result.rows[0] ? decodeRecord(result.rows[0]) : null
    },

    async replay(input: ReplayRuntimeTransportEnvelopeInput) {
      recordWrite(faults)
      const result = await db.query<Record<string, unknown>>(
        `UPDATE ${envelopes}
          SET state = 'accepted',
              attempts = 0,
              updated_at = $5::timestamptz,
              next_attempt_at = $5::timestamptz,
              lease_token = NULL,
              lease_expires_at = NULL,
              lineage = NULL
          WHERE namespace = $1 AND provider = $2 AND account_id = $3 AND event_id = $4
            AND state = 'dead-letter'
          RETURNING *`,
        [
          input.identity.namespace,
          input.identity.provider,
          input.identity.accountId,
          input.identity.eventId,
          input.now.toISOString(),
        ],
      )
      return result.rows[0] ? decodeRecord(result.rows[0]) : null
    },

    async getStatistics(namespace: string) {
      // Serialize read-modify-write across concurrent transactions, including
      // first insert when no statistics row exists yet (FOR UPDATE cannot lock
      // an absent row).
      await lockTransportStatisticsNamespace(db, schema, namespace)
      const result = await db.query<Record<string, unknown>>(
        `SELECT statistics FROM ${statistics} WHERE namespace = $1`,
        [namespace],
      )
      const value = result.rows[0]?.statistics
      return value ? (value as StatisticsLedgerExport) : null
    },

    async putStatistics(namespace: string, value: StatisticsLedgerExport) {
      await lockTransportStatisticsNamespace(db, schema, namespace)
      recordWrite(faults)
      await db.query(
        `INSERT INTO ${statistics} (namespace, statistics, updated_at)
         VALUES ($1, $2::jsonb, now())
         ON CONFLICT (namespace) DO UPDATE
         SET statistics = EXCLUDED.statistics,
             updated_at = EXCLUDED.updated_at`,
        [namespace, encodeJson(value)],
      )
    },

    async prune(options) {
      recordWrite(faults)
      const limit = Math.max(0, Math.trunc(options.limit))
      const result = await db.query<{
        removed: string | number
        truncated: boolean
      }>(
        `WITH candidates AS (
           SELECT namespace, provider, account_id, event_id,
                  row_number() OVER (ORDER BY updated_at ASC) AS rn
           FROM ${envelopes}
           WHERE ($1::text IS NULL OR namespace = $1)
             AND state IN ('normalized', 'dead-letter')
             AND updated_at < $2::timestamptz
           ORDER BY updated_at ASC
           LIMIT $4
         ),
         doomed AS (
           SELECT namespace, provider, account_id, event_id
           FROM candidates
           WHERE rn <= $3
         ),
         deleted AS (
           DELETE FROM ${envelopes} AS target
           USING doomed
           WHERE target.namespace = doomed.namespace
             AND target.provider = doomed.provider
             AND target.account_id = doomed.account_id
             AND target.event_id = doomed.event_id
           RETURNING 1
         )
         SELECT
           (SELECT count(*)::text FROM deleted) AS removed,
           EXISTS(SELECT 1 FROM candidates WHERE rn > $3) AS truncated`,
        [
          options.namespace ?? null,
          options.before.toISOString(),
          limit,
          limit + 1,
        ],
      )
      return {
        removed: Number(result.rows[0]?.removed ?? 0),
        truncated: Boolean(result.rows[0]?.truncated),
      }
    },
  }
}

/**
 * Transaction-scoped lock for one namespace statistics ledger.
 *
 * Covers both get/put and the absent-row first-insert race under READ COMMITTED.
 */
async function lockTransportStatisticsNamespace(
  db: PgExecutor,
  schema: string,
  namespace: string,
): Promise<void> {
  await db.query(
    'SELECT pg_advisory_xact_lock($1::integer, $2::integer)',
    [
      advisoryLockKey(`transport-statistics:${schema}`),
      advisoryLockKey(namespace),
    ],
  )
}

/** Persist lineage as a structured payload with optional truncation flag. */
function encodeLineagePayload(
  lineage: readonly { readonly signalId: string; readonly occurrenceId: string }[] | undefined,
  lineageTruncated: boolean | undefined,
):
  | readonly { readonly signalId: string; readonly occurrenceId: string }[]
  | {
      readonly entries: readonly {
        readonly signalId: string
        readonly occurrenceId: string
      }[]
      readonly truncated: true
    } {
  const entries = lineage ?? []
  if (lineageTruncated === true) {
    return { entries, truncated: true as const }
  }
  return entries
}

async function getIdentity(
  db: PgExecutor,
  envelopes: string,
  identity: RuntimeTransportEnvelopeIdentity,
): Promise<RuntimeTransportEnvelopeRecord | null> {
  const result = await db.query<Record<string, unknown>>(
    `SELECT * FROM ${envelopes}
      WHERE namespace = $1 AND provider = $2 AND account_id = $3 AND event_id = $4`,
    [identity.namespace, identity.provider, identity.accountId, identity.eventId],
  )
  return result.rows[0] ? decodeRecord(result.rows[0]) : null
}

function decodeRecord(row: Record<string, unknown>): RuntimeTransportEnvelopeRecord {
  const lastFailure = row.last_failure as
    | { message?: string; code?: string }
    | null
    | undefined
  const { lineage, lineageTruncated } = decodeLineagePayload(row.lineage)
  return Object.freeze({
    schemaVersion: 1 as const,
    namespace: String(row.namespace),
    provider: String(row.provider),
    accountId: String(row.account_id),
    eventId: String(row.event_id),
    bindingId: String(row.binding_id),
    envelope: row.envelope as RuntimeTransportEnvelopeRecord['envelope'],
    envelopeDigest: String(row.envelope_digest),
    state: row.state as RuntimeTransportEnvelopeRecord['state'],
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    acceptedAt: timestamp(row.accepted_at),
    updatedAt: timestamp(row.updated_at),
    nextAttemptAt: timestamp(row.next_attempt_at),
    ...(typeof row.lease_token === 'string'
      ? { leaseToken: row.lease_token }
      : {}),
    ...(row.lease_expires_at
      ? { leaseExpiresAt: timestamp(row.lease_expires_at) }
      : {}),
    ...(lastFailure && typeof lastFailure.message === 'string'
      ? {
          lastFailure: Object.freeze({
            message: lastFailure.message,
            ...(typeof lastFailure.code === 'string'
              ? { code: lastFailure.code }
              : {}),
          }),
        }
      : {}),
    ...(lineage && lineage.length > 0
      ? { lineage: Object.freeze(lineage) }
      : {}),
    ...(lineageTruncated ? { lineageTruncated: true as const } : {}),
  })
}

function decodeLineagePayload(value: unknown): {
  readonly lineage?: readonly {
    readonly signalId: string
    readonly occurrenceId: string
  }[]
  readonly lineageTruncated: boolean
} {
  if (Array.isArray(value)) {
    const lineage = decodeLineageEntries(value)
    return {
      ...(lineage.length > 0 ? { lineage } : {}),
      lineageTruncated: false,
    }
  }

  if (value && typeof value === 'object') {
    const record = value as {
      entries?: unknown
      truncated?: unknown
    }
    const lineage = Array.isArray(record.entries)
      ? decodeLineageEntries(record.entries)
      : []
    return {
      ...(lineage.length > 0 ? { lineage } : {}),
      lineageTruncated: record.truncated === true,
    }
  }

  return { lineageTruncated: false }
}

function decodeLineageEntries(
  value: readonly unknown[],
): readonly {
  readonly signalId: string
  readonly occurrenceId: string
}[] {
  return value
    .filter(
      (entry): entry is { signalId: string; occurrenceId: string } =>
        !!entry &&
        typeof entry === 'object' &&
        typeof (entry as { signalId?: unknown }).signalId === 'string' &&
        typeof (entry as { occurrenceId?: unknown }).occurrenceId === 'string',
    )
    .map((entry) =>
      Object.freeze({
        signalId: entry.signalId,
        occurrenceId: entry.occurrenceId,
      }),
    )
}

function timestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    return new Date(value).toISOString()
  }
  throw new Error('Transport envelope timestamp is missing.')
}
