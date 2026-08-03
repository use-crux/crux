import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPostgresMaintenanceOwnership } from '../src/runtime/maintenance-ownership'

describe('Postgres maintenance ownership', () => {
  it('destroys the client when advisory unlock fails', async () => {
    const unlockError = new Error('unlock failed')
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(unlockError)
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release }),
    } as unknown as Pool
    const ownership = createPostgresMaintenanceOwnership(pool, 'runtime')
    const lease = await ownership.acquire('tenant')

    expect(lease.acquired).toBe(true)
    if (!lease.acquired) return
    await expect(lease.release()).rejects.toBe(unlockError)
    expect(release).toHaveBeenCalledWith(unlockError)
  })
})
