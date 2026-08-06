import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPostgresMaintenanceOwnership } from '../src/runtime/maintenance-ownership'

describe('Postgres maintenance ownership', () => {
  it('rejects worker ownership when the pool cannot serve maintenance', async () => {
    const connect = vi.fn()
    const pool = { options: { max: 1 }, connect } as unknown as Pool
    const ownership = createPostgresMaintenanceOwnership(pool, 'runtime')

    await expect(ownership.acquire('tenant')).rejects.toMatchObject({
      code: 'SETUP_REQUIRED',
      nextStep: expect.stringMatching(/max.*2/i),
    })
    expect(connect).not.toHaveBeenCalled()
  })

  it('invalidates ownership when the lock connection is lost', async () => {
    const connectionError = new Error('connection lost')
    let onError: ((error: Error) => void) | undefined
    const release = vi.fn()
    const query = vi.fn().mockResolvedValue({ rows: [{ acquired: true }] })
    const client = {
      query,
      release,
      on: vi.fn((event: string, listener: (error: Error) => void) => {
        if (event === 'error') onError = listener
      }),
      removeListener: vi.fn(),
    }
    const pool = {
      options: { max: 2 },
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool
    const ownership = createPostgresMaintenanceOwnership(pool, 'runtime')
    const lease = await ownership.acquire('tenant')

    expect(lease.acquired).toBe(true)
    if (!lease.acquired) return
    expect(onError).toBeTypeOf('function')
    if (!onError || !lease.lost) throw new Error('Expected a loss signal.')
    onError(connectionError)

    await expect(lease.lost).rejects.toBe(connectionError)
    await expect(lease.release()).rejects.toBe(connectionError)
    expect(query).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(connectionError)
  })

  it('rejects release when PostgreSQL reports that no lock was held', async () => {
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockResolvedValueOnce({ rows: [{ released: false }] })
    const client = {
      query,
      release,
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const pool = {
      options: { max: 2 },
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool
    const ownership = createPostgresMaintenanceOwnership(pool, 'runtime')
    const lease = await ownership.acquire('tenant')

    expect(lease.acquired).toBe(true)
    if (!lease.acquired) return
    const releasing = lease.release()
    await expect(releasing).rejects.toMatchObject({ code: 'LEASE_LOST' })
    expect(lease.release()).toBe(releasing)
    expect(release).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'LEASE_LOST' }),
    )
  })

  it('destroys the client when advisory unlock fails', async () => {
    const unlockError = new Error('unlock failed')
    const release = vi.fn()
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [{ acquired: true }] })
      .mockRejectedValueOnce(unlockError)
    const client = {
      query,
      release,
      on: vi.fn(),
      removeListener: vi.fn(),
    }
    const pool = {
      options: { max: 2 },
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool
    const ownership = createPostgresMaintenanceOwnership(pool, 'runtime')
    const lease = await ownership.acquire('tenant')

    expect(lease.acquired).toBe(true)
    if (!lease.acquired) return
    await expect(lease.release()).rejects.toBe(unlockError)
    expect(release).toHaveBeenCalledWith(unlockError)
  })
})
