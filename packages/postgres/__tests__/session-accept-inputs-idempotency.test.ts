/** Concurrent stable-inputId acceptInputs idempotency on PostgreSQL. */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { config, createWorkHost, resetHooks, session } from '@use-crux/core'
import {
  createRuntimeProgram,
  node,
} from '@use-crux/core/runtime'
import { Pool } from 'pg'
import { postgresRecordStore } from '../src'
import { postgres } from '../src/runtime'
import {
  startPostgresTestDatabase,
  type PostgresTestDatabase,
} from './test-database'
import { createConformanceProgramFixture } from './session-conformance-model'

let database: PostgresTestDatabase

beforeAll(async () => {
  database = await startPostgresTestDatabase()
}, 30_000)

afterEach(() => resetHooks())

afterAll(async () => {
  await database?.close()
})

describe('PostgreSQL acceptInputs idempotency', () => {
  it('concurrent stable inputIds accept once without PK abort', async () => {
    const schema = `crux_accept_idemp_${process.pid}`
    const pool = new Pool({ connectionString: database.url })
    try {
      const store = postgres({ pool, schema })
      const records = postgresRecordStore({ pool, schema })
      await store.setup.apply()
      await records.setup.apply()
      const fixture = createConformanceProgramFixture('accept-idemp')
      const program = createRuntimeProgram({
        targets: [fixture.primary],
        transports: [],
      })
      const namespace = 'pg-accept-idemp'
      config({ storage: { records } })
      const host = createWorkHost({
        runtime: node({ store, namespace, autoStartMaintenance: false }),
        program,
      })
      try {
        const conversation = await host.run(() =>
          session(fixture.primary, { key: 'accept-idemp' }),
        )
        const inputId = 'input_sig_pg_race_1'
        const now = new Date()
        await Promise.all([
          store.transact(async (tx) => {
            await tx.sessions!.acceptInputs({
              namespace,
              sessionId: conversation.id,
              inputs: [{ message: 'once' }],
              inputIds: [inputId],
              now,
            })
          }),
          store.transact(async (tx) => {
            await tx.sessions!.acceptInputs({
              namespace,
              sessionId: conversation.id,
              inputs: [{ message: 'once' }],
              inputIds: [inputId],
              now,
            })
          }),
        ])
        const record = await store.sessions!.get(
          namespace,
          conversation.id,
        )
        expect(record?.acceptedCursor).toBe(1)
        expect(record?.pendingInputs).toBe(1)
        const input = await store.sessions!.getInput(
          namespace,
          conversation.id,
          inputId,
        )
        expect(input?.cursor).toBe(1)
      } finally {
        host.dispose()
      }
    } finally {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  })
})
