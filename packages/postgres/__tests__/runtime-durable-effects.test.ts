import {
  runStoreEffectAdapterTests,
  type RunStoreEffectAdapterTestsOptions,
} from '@use-crux/core/runtime/testing'
import { afterAll, beforeAll } from 'vitest'
import { postgres, type PostgresRuntimeStore } from '../src/runtime'
import {
  createPostgresTestPool,
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'

let testDatabase: PostgresTestDatabase
const stores: Array<{
  readonly store: PostgresRuntimeStore
  readonly close: () => Promise<void>
}> = []
const schemas: string[] = []

async function createStore(): Promise<PostgresRuntimeStore> {
  const schema = `crux_effects_test_${Date.now()}_${schemas.length}`
  schemas.push(schema)
  const pool = createPostgresTestPool(testDatabase.url)
  const store = postgres({ pool, schema })
  stores.push({
    store,
    close: async () => {
      await store.close()
      await pool.end()
    },
  })
  await store.setup.apply()
  return store
}

beforeAll(async () => {
  testDatabase = await startPostgresTestDatabase()
}, 30_000)

afterAll(async () => {
  try {
    await Promise.all(stores.map((entry) => entry.close()))
    const cleanup = createPostgresTestPool(testDatabase.url)
    try {
      for (const schema of schemas) {
        await cleanup.query(`DROP SCHEMA IF EXISTS ${quoteIdent(schema)} CASCADE`)
      }
    } finally {
      await cleanup.end()
    }
  } finally {
    await testDatabase?.close()
  }
})

const options: RunStoreEffectAdapterTestsOptions<PostgresRuntimeStore> = {
  name: 'postgres',
  createStore,
  failAfterWrites: (store, writes) => store.testing.failAfter(writes),
  effectCapabilities: {
    atomicOperations: { support: 'supported' },
    multiOperationTransactions: { support: 'supported' },
    crashFencing: { support: 'supported' },
    reconstruction: { support: 'supported' },
    recoveryClaims: { support: 'supported' },
  },
}

runStoreEffectAdapterTests(options)

function quoteIdent(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`
}
