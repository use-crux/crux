/** PostgreSQL session ownership for exclusive Runtime maintenance. */

import {
  createRuntimeError,
  type RuntimeMaintenanceOwnershipPort,
  type RuntimeMaintenanceOwnershipResult,
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
      if (pool.options.max < 2) {
        throw createRuntimeError({
          code: 'SETUP_REQUIRED',
          whatFailed: `Postgres Runtime worker ownership cannot use a pool with max ${pool.options.max}.`,
          why: 'Session-scoped ownership reserves one pooled connection while Runtime maintenance needs another.',
          whatStillWorks:
            'Postgres Runtime store operations that do not acquire worker ownership continue to work.',
          nextStep:
            'Set poolOptions: { max: 2 } or provide a pg Pool configured with max >= 2.',
        })
      }
      const client = await pool.connect()
      let clientReleased = false
      let lostError: Error | undefined
      let rejectLost!: (error: Error) => void
      const lost = new Promise<never>((_resolve, reject) => {
        rejectLost = reject
      })
      void lost.catch(() => undefined)
      const releaseClient = (error?: unknown): void => {
        if (clientReleased) return
        clientReleased = true
        client.removeListener('error', onClientError)
        client.release(
          error === undefined
            ? undefined
            : error instanceof Error
              ? error
              : true,
        )
      }
      const onClientError = (error: Error): void => {
        if (clientReleased) return
        lostError = error
        releaseClient(error)
        rejectLost(error)
      }
      client.on('error', onClientError)
      try {
        const result = await client.query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_lock($1::integer, $2::integer) AS acquired',
          [hashLockKey(schema), hashLockKey(namespace)],
        )
        if (result.rows[0]?.acquired !== true) {
          releaseClient()
          return { acquired: false }
        }

        let releasePromise: Promise<void> | undefined
        return {
          acquired: true,
          lost,
          release(): Promise<void> {
            releasePromise ??= (async () => {
              if (lostError) throw lostError
              try {
                const result = await client.query<{ released: boolean }>(
                  'SELECT pg_advisory_unlock($1::integer, $2::integer) AS released',
                  [hashLockKey(schema), hashLockKey(namespace)],
                )
                if (result.rows[0]?.released !== true) {
                  throw createRuntimeError({
                    code: 'LEASE_LOST',
                    whatFailed: `Postgres Runtime worker ownership was not held while releasing namespace \`${namespace}\`.`,
                    why: 'PostgreSQL returned false from pg_advisory_unlock, so a successful ownership handover cannot be reported.',
                    whatStillWorks:
                      'The pooled connection is discarded and no new maintenance tick is started by this worker.',
                    nextStep:
                      'Inspect the ownership connection and worker logs, then restart the worker only after confirming no other process owns the namespace.',
                  })
                }
              } catch (error) {
                releaseClient(error)
                throw error
              }
              releaseClient()
            })()
            return releasePromise
          },
        }
      } catch (error) {
        releaseClient()
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
