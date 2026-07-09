import type {
  ClaimOptions,
  Lease,
  LeasePort,
  LeaseResource,
} from '@use-crux/core/runtime'
import { decodeLease } from './codec'
import { newRuntimeId } from './ids'
import type { PgExecutor } from './sql'
import { table } from './sql'

export function createPostgresLeasePort(
  db: PgExecutor,
  schema: string,
): LeasePort {
  const leases = table(schema, 'leases')

  return {
    async claim(
      resource: LeaseResource,
      options: ClaimOptions,
    ): Promise<Lease | null> {
      const token = newRuntimeId('lease')
      const now = new Date()
      const expiresAt = new Date(now.getTime() + options.ttlMs)
      const result = await db.query(
        `INSERT INTO ${leases} AS runtime_leases (resource, token, expires_at, owner_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (resource) DO UPDATE SET
           token = EXCLUDED.token,
           expires_at = EXCLUDED.expires_at,
           owner_id = EXCLUDED.owner_id
         WHERE runtime_leases.expires_at < $5
         RETURNING *`,
        [resource, token, expiresAt, options.ownerId, now],
      )
      return result.rows[0] ? decodeLease(result.rows[0]) : null
    },

    async extend(lease: Lease, ttlMs: number): Promise<Lease> {
      const expiresAt = new Date(Date.now() + ttlMs)
      const result = await db.query(
        `UPDATE ${leases}
            SET expires_at = $3
          WHERE resource = $1
            AND token = $2
          RETURNING *`,
        [lease.resource, lease.token, expiresAt],
      )
      if (!result.rows[0]) {
        throw new Error(`Cannot extend a lease not owned by this token.`)
      }
      return decodeLease(result.rows[0])
    },

    async release(lease: Lease): Promise<void> {
      await db.query(
        `DELETE FROM ${leases} WHERE resource = $1 AND token = $2`,
        [lease.resource, lease.token],
      )
    },
  }
}
