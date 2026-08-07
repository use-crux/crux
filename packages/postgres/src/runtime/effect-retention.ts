import type {
  RuntimeEffectPruneOptions,
  RuntimePruneResult,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import type { PgExecutor } from './sql'

/** Expire a bounded batch of PostgreSQL recovery envelopes atomically. */
export async function prunePostgresEffectEnvelopes(
  db: PgExecutor,
  records: string,
  faults: PostgresStoreFaults,
  options: RuntimeEffectPruneOptions,
): Promise<RuntimePruneResult> {
  recordWrite(faults)
  const result = await db.query(
    `WITH eligible AS MATERIALIZED (
       SELECT envelope.namespace, envelope.record_id
         FROM ${records} AS envelope
        WHERE ($1::text IS NULL OR envelope.namespace = $1)
          AND envelope.kind = 'envelope'
          AND CASE
            WHEN envelope.record->'envelope'->>'expiresAt' IS NOT NULL
              THEN (envelope.record->'envelope'->>'expiresAt')::bigint <= $3
            ELSE (envelope.record->'envelope'->>'createdAt')::bigint < $2
          END
        ORDER BY envelope.namespace ASC, envelope.record_id ASC
        LIMIT $4 + 1
        FOR UPDATE
     ), selected AS (
       SELECT namespace, record_id FROM eligible LIMIT $4
     ), updated_receipts AS (
       UPDATE ${records} AS receipt
          SET record = jsonb_set(
                jsonb_set(receipt.record, '{receipt,recovery}', '"expired"'),
                '{revision}', to_jsonb(receipt.revision + 1)
              ),
              revision = receipt.revision + 1
         FROM selected
        WHERE receipt.namespace = selected.namespace
          AND receipt.kind = 'receipt'
          AND receipt.record_id = selected.record_id
          AND receipt.record->'receipt'->>'recovery' <> 'recovered'
     ), deleted AS (
       DELETE FROM ${records} AS envelope
        USING selected
        WHERE envelope.namespace = selected.namespace
          AND envelope.kind = 'envelope'
          AND envelope.record_id = selected.record_id
        RETURNING envelope.record_id
     )
     SELECT (SELECT count(*) FROM deleted)::integer AS removed,
            (SELECT count(*) FROM eligible) > $4 AS truncated`,
    [
      options.namespace ?? null,
      options.before.getTime(),
      options.now.getTime(),
      options.limit,
    ],
  )
  return {
    removed: Number(result.rows[0]?.removed ?? 0),
    truncated: result.rows[0]?.truncated === true,
  }
}
