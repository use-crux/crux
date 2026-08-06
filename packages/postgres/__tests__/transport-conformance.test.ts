import { afterAll, beforeAll } from 'vitest'
import { runTransportStoreConformanceTests } from '@use-crux/core/runtime/testing'
import { postgres } from '../src/runtime'
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

let database: PostgresTestDatabase

beforeAll(async () => {
  database = await startPostgresTestDatabase()
}, 30_000)

afterAll(async () => {
  await database?.close()
})

runTransportStoreConformanceTests({
  name: 'PostgreSQL',
  createHarness: async (law) => {
    const schema = `crux_transport_${law.replace(/[^a-z0-9]+/gi, '_').toLowerCase()}`
    const store = postgres({ url: database.url, schema })
    const setup = await store.setup.apply()
    if (!setup.ok) {
      await store.close()
      throw new Error(
        `PostgreSQL transport setup failed: ${setup.findings
          .map((finding) => finding.message)
          .join('; ')}`,
      )
    }
    return {
      store,
      async dispose() {
        await store.close()
      },
    }
  },
})
