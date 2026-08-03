import type { Pool } from 'pg'
import { checkStorageDdl, storageDdlStatements, type StorageDdlOptions } from './ddl'
import { StorageError } from '@use-crux/core/storage'
import { withStorageTransaction } from './sql'
import type { PostgresStorageSetup, PostgresStorageSetupFinding, PostgresStorageSetupResult } from './types'

export function createStorageSetup(pool: Pool, schema: string, options: StorageDdlOptions): PostgresStorageSetup {
  return {
    async check(): Promise<PostgresStorageSetupResult> {
      try {
        const findings = await checkStorageDdl(pool, schema, await resolveDdlOptions(pool, options))
        return result(findings)
      } catch (cause) {
        return result([setupFinding('check', cause)])
      }
    },
    async apply(): Promise<PostgresStorageSetupResult> {
      try {
        const ddlOptions = await resolveDdlOptions(pool, options)
        await withStorageTransaction(pool, async (client) => {
          await client.query('SELECT pg_advisory_xact_lock($1)', [advisoryLockKey(schema)])
          for (const statement of storageDdlStatements(schema, ddlOptions)) {
            await client.query(statement)
          }
        })
        const findings = await checkStorageDdl(pool, schema, ddlOptions)
        return result(findings)
      } catch (cause) {
        return result([setupFinding('apply', cause)])
      }
    },
  }
}

async function resolveDdlOptions(pool: Pool, options: StorageDdlOptions): Promise<StorageDdlOptions> {
  if (options.lexicalConfiguration === undefined) return options
  const result = await pool.query<{ configuration: string }>(`SELECT $1::regconfig::oid::regconfig::text AS configuration`, [
    options.lexicalConfiguration,
  ])
  const configuration = result.rows[0]?.configuration
  if (!configuration) {
    throw new StorageError('invalid_value', 'PostgreSQL text-search configuration is invalid or unavailable.')
  }
  return { ...options, lexicalConfiguration: configuration }
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

function setupFinding(operation: 'check' | 'apply', cause: unknown): PostgresStorageSetupFinding {
  if ((cause instanceof StorageError && cause.code === 'invalid_value') || isInvalidRegconfig(cause)) {
    return {
      code: 'POSTGRES_SEARCH_CONFIGURATION_INVALID',
      resource: 'search:configuration',
      message: 'PostgreSQL text-search configuration is invalid or unavailable.',
    }
  }
  return {
    code: 'POSTGRES_STORAGE_SETUP_FAILED',
    resource: 'postgres-storage',
    message: `PostgreSQL storage setup ${operation} failed. Check database availability and privileges.`,
  }
}

function isInvalidRegconfig(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    ('code' in cause || 'routine' in cause) &&
    ((cause as { code?: unknown }).code === '42704' || (cause as { routine?: unknown }).routine === 'regconfigin')
  )
}
