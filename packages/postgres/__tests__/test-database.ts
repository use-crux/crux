import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import EmbeddedPostgres from 'embedded-postgres'
import { Pool } from 'pg'

export interface PostgresTestDatabase {
  readonly url: string
  close(): Promise<void>
}

export async function startPostgresTestDatabase(): Promise<PostgresTestDatabase> {
  if (process.env.CRUX_TEST_DATABASE_URL) {
    return {
      url: process.env.CRUX_TEST_DATABASE_URL,
      async close() {},
    }
  }

  const databaseDir = await mkdtemp(join(tmpdir(), 'crux-postgres-test-'))
  const port = await getFreePort()
  const embedded = new EmbeddedPostgres({
    databaseDir,
    port,
    user: 'postgres',
    password: 'password',
    persistent: false,
    onLog: () => {},
    onError: () => {},
  })

  try {
    await embedded.initialise()
    await embedded.start()
  } catch (error) {
    await rm(databaseDir, { recursive: true, force: true }).catch(
      () => undefined,
    )
    throw error
  }

  return {
    url: `postgres://postgres:password@127.0.0.1:${port}/postgres`,
    async close() {
      await embedded.stop().catch(() => undefined)
      await rm(databaseDir, { recursive: true, force: true }).catch(
        () => undefined,
      )
    },
  }
}

/**
 * Shared test pool factory.
 *
 * Cap below pg's default max of 10 so idle connections from many short-lived
 * test pools cannot exhaust the CI Postgres budget (~100 connections) if a
 * worker bound is ever raised. Keep max high enough for:
 * - Runtime maintenance ownership (requires max >= 2)
 * - Dual-client READ COMMITTED interleaving tests that hold two clients and
 *   still issue pool queries (needs >= 3)
 */
export const POSTGRES_TEST_POOL_MAX = 4

export function createPostgresTestPool(url: string): Pool {
  const pool = new Pool({ connectionString: url, max: POSTGRES_TEST_POOL_MAX })
  pool.on('error', (error: unknown) => {
    if (isExpectedPoolShutdown(error)) return
    queueMicrotask(() => {
      throw error
    })
  })
  return pool
}

function isExpectedPoolShutdown(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === '57P01'
  )
}

async function getFreePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        if (!address || typeof address === 'string') {
          reject(new Error('Could not allocate a Postgres test port.'))
          return
        }
        resolve(address.port)
      })
    })
  })
}
