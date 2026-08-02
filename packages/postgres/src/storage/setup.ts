import type { Pool } from 'pg'
import { checkStorageDdl, storageDdlStatements, type StorageDdlOptions } from './ddl'
import { withStorageTransaction } from './sql'
import type { PostgresStorageSetup, PostgresStorageSetupFinding, PostgresStorageSetupResult } from './types'

export function createStorageSetup(pool: Pool, schema: string, options: StorageDdlOptions): PostgresStorageSetup {
  return {
    async check(): Promise<PostgresStorageSetupResult> {
      try {
        const findings = await checkStorageDdl(pool, schema, options)
        return result(findings)
      } catch {
        return result([backendFinding('check')])
      }
    },
    async apply(): Promise<PostgresStorageSetupResult> {
      try {
        await withStorageTransaction(pool, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLockKey(schema)])
          for (const statement of storageDdlStatements(schema, options)) {
            await client.query(statement)
          }
        })
        const findings = await checkStorageDdl(pool, schema, options)
        return result(findings)
      } catch {
        return result([backendFinding('apply')])
      }
    },
  }
}

function advisoryLockKey(schema: string): number {
  let hash = 0x43525853
  for (const character of `storage:${schema}`) {
    hash = (hash * 31 + character.charCodeAt(0)) | 0
  }
  return hash
}

function result(findings: readonly PostgresStorageSetupFinding[]): PostgresStorageSetupResult {
  return { ok: findings.length === 0, findings }
}

function backendFinding(operation: 'check' | 'apply'): PostgresStorageSetupFinding {
  return {
    code: 'POSTGRES_STORAGE_SETUP_FAILED',
    resource: 'postgres-storage',
    message: `PostgreSQL storage setup ${operation} failed. Check database availability and privileges.`,
  }
}
