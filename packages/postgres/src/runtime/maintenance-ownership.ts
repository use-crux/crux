/** PostgreSQL session ownership for exclusive Runtime maintenance. */

import type {
  RuntimeMaintenanceOwnershipPort,
  RuntimeMaintenanceOwnershipResult,
} from '@use-crux/core/runtime'
import type { Pool } from 'pg'

/** Create cross-process Runtime maintenance ownership backed by advisory locks. */
export function createPostgresMaintenanceOwnership(
  pool: Pool,
  schema: string,
): RuntimeMaintenanceOwnershipPort {
  const ownership: RuntimeMaintenanceOwnershipPort = {
    async acquire(
      namespace: string,
    ): Promise<RuntimeMaintenanceOwnershipResult> {
      const client = await pool.connect()
      try {
        const result = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
          [hashLockKey(schema), hashLockKey(namespace)],
        )
        if (result.rows[0]?.acquired !== true) {
          client.release()
          return { acquired: false }
        }

        let releasePromise: Promise<void> | undefined
        return {
          acquired: true,
          release(): Promise<void> {
            releasePromise ??= (async () => {
              try {
                await client.query(
                  'SELECT pg_advisory_unlock($1::integer, $2::integer)',
                  [hashLockKey(schema), hashLockKey(namespace)],
                )
              } catch (error) {
                client.release(error instanceof Error ? error : true)
                throw error
              }
              client.release()
            })()
            return releasePromise
          },
        }
      } catch (error) {
        client.release()
        throw error
      }
    },
  }
  return Object.freeze(ownership)
}

function hashLockKey(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash | 0
}
