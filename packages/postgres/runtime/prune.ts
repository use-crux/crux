import type { RuntimePruneResult } from '@use-crux/core/runtime'
import type { PgExecutor } from './sql'

export interface PostgresPruneRowsOptions {
  readonly table: string
  readonly filters: readonly string[]
  readonly values: readonly unknown[]
  readonly orderBy: string
  readonly limit: number
}

export async function prunePostgresRows(
  db: PgExecutor,
  options: PostgresPruneRowsOptions,
): Promise<RuntimePruneResult> {
  const limit = Math.max(0, Math.trunc(options.limit))
  const values = [...options.values, limit, limit + 1]
  const limitPlaceholder = `$${values.length - 1}`
  const candidateLimitPlaceholder = `$${values.length}`
  const where = options.filters.join(' AND ')
  const result = await db.query(
    `WITH candidates AS (
       SELECT ctid, row_number() OVER (ORDER BY ${options.orderBy}) AS rn
         FROM ${options.table}
        WHERE ${where}
        ORDER BY ${options.orderBy}
        LIMIT ${candidateLimitPlaceholder}
     ),
     doomed AS (
       SELECT ctid FROM candidates WHERE rn <= ${limitPlaceholder}
     ),
     deleted AS (
       DELETE FROM ${options.table}
        WHERE ctid IN (SELECT ctid FROM doomed)
        RETURNING 1
     )
     SELECT
       (SELECT COUNT(*)::int FROM deleted) AS removed,
       EXISTS(SELECT 1 FROM candidates WHERE rn > ${limitPlaceholder}) AS truncated`,
    values,
  )
  const row = result.rows[0] as
    | { readonly removed: number | string; readonly truncated: boolean }
    | undefined
  return {
    removed: Number(row?.removed ?? 0),
    truncated: Boolean(row?.truncated),
  }
}

export function pruneNamespaceFilters(options: {
  readonly namespace?: string
  readonly before: Date
}): { readonly filters: string[]; readonly values: unknown[] } {
  const values: unknown[] = [options.before]
  const filters: string[] = []
  if (options.namespace !== undefined) {
    values.push(options.namespace)
    filters.push(`namespace = $${values.length}`)
  }
  return { filters, values }
}
