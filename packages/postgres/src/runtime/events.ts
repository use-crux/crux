import type {
  AppendEventOptions,
  DurableEventPort,
  NewRuntimeEvent,
  ReadEventsOptions,
  ReadEventsResult,
  RuntimeEvent,
} from '@use-crux/core/runtime'
import type { PostgresStoreFaults } from './faults'
import { recordWrite } from './faults'
import { decodeRuntimeEvent, encodeJson } from './codec'
import { pruneNamespaceFilters, prunePostgresRows } from './prune'
import type { PgExecutor } from './sql'
import { table } from './sql'

export function createPostgresEventPort(
  db: PgExecutor,
  schema: string,
  faults: PostgresStoreFaults,
): DurableEventPort {
  const events = table(schema, 'events')

  return {
    async append(
      event: NewRuntimeEvent,
      options?: AppendEventOptions,
    ): Promise<RuntimeEvent> {
      const existing = await findDuplicate(event, options)
      if (existing) return existing

      recordWrite(faults)
      const result = await db.query(
        `INSERT INTO ${events} (namespace, name, payload, duplicate_key, appended_at)
         VALUES ($1, $2, $3::jsonb, $4, now())
         ON CONFLICT (namespace, duplicate_key) WHERE duplicate_key IS NOT NULL
         DO UPDATE SET duplicate_key = EXCLUDED.duplicate_key
         RETURNING *`,
        [
          event.namespace,
          event.name,
          encodeJson(event.payload),
          duplicateKey(event, options),
        ],
      )
      return decodeRuntimeEvent(result.rows[0])
    },

    async read(options: ReadEventsOptions): Promise<ReadEventsResult> {
      const afterFound =
        options.after === undefined
          ? undefined
          : await containsCursor(options.namespace, options.name, options.after)
      const values: unknown[] = [options.namespace]
      const filters = ['namespace = $1']
      if (options.name !== undefined) {
        values.push(options.name)
        filters.push(`name = $${values.length}`)
      }
      if (options.after !== undefined && /^\d+$/.test(options.after)) {
        values.push(options.after)
        filters.push(`event_id > $${values.length}`)
      }
      values.push(options.limit ?? 100)
      const result = await db.query(
        `SELECT * FROM ${events}
          WHERE ${filters.join(' AND ')}
          ORDER BY event_id ASC
          LIMIT $${values.length}`,
        values,
      )
      const readEvents = result.rows.map(decodeRuntimeEvent)
      const cursor = readEvents.at(-1)?.eventId
      return {
        events: readEvents,
        ...(cursor ? { cursor } : {}),
        ...(afterFound === undefined ? {} : { afterFound }),
      }
    },

    async prune(options) {
      const { filters, values } = pruneNamespaceFilters(options)
      filters.push(`appended_at < $1`)
      recordWrite(faults)
      return await prunePostgresRows(db, {
        table: events,
        filters,
        values,
        orderBy: 'appended_at ASC, event_id ASC',
        limit: options.limit,
      })
    },
  }

  async function containsCursor(
    namespace: string,
    name: string | undefined,
    cursor: string,
  ): Promise<boolean> {
    if (!/^\d+$/.test(cursor)) return false
    const values: unknown[] = [namespace, cursor]
    const nameFilter =
      name === undefined
        ? ''
        : (() => {
            values.push(name)
            return ` AND name = $${values.length}`
          })()
    const result = await db.query(
      `SELECT 1 FROM ${events} WHERE namespace = $1 AND event_id = $2${nameFilter}`,
      values,
    )
    return Boolean(result.rows[0])
  }

  async function findDuplicate(
    event: NewRuntimeEvent,
    options: AppendEventOptions | undefined,
  ): Promise<RuntimeEvent | null> {
    if (event.eventId && /^\d+$/.test(event.eventId)) {
      const byCursor = await db.query(
        `SELECT * FROM ${events} WHERE namespace = $1 AND event_id = $2`,
        [event.namespace, Number(event.eventId)],
      )
      if (byCursor.rows[0]) return decodeRuntimeEvent(byCursor.rows[0])
    }
    const key = duplicateKey(event, options)
    if (!key) return null
    const byKey = await db.query(
      `SELECT * FROM ${events} WHERE namespace = $1 AND duplicate_key = $2`,
      [event.namespace, key],
    )
    return byKey.rows[0] ? decodeRuntimeEvent(byKey.rows[0]) : null
  }
}

function duplicateKey(
  event: NewRuntimeEvent,
  options: AppendEventOptions | undefined,
): string | undefined {
  if (event.eventId) return `event:${event.eventId}`
  if (options?.idempotencyKey) return `idempotency:${options.idempotencyKey}`
  return undefined
}
