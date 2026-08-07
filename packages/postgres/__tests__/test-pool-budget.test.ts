import { describe, expect, it } from 'vitest'
import {
  createPostgresTestPool,
  POSTGRES_TEST_POOL_MAX,
} from './test-database'

describe('PostgreSQL test pool budget', () => {
  it('caps pool max so concurrent suites stay under CI connection limits', async () => {
    const pool = createPostgresTestPool(
      'postgres://postgres:postgres@127.0.0.1:1/unused',
    )
    try {
      expect(POSTGRES_TEST_POOL_MAX).toBeGreaterThanOrEqual(3)
      expect(POSTGRES_TEST_POOL_MAX).toBeLessThan(10)
      expect(pool.options.max).toBe(POSTGRES_TEST_POOL_MAX)
    } finally {
      await pool.end()
    }
  })
})
