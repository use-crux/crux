import type {
  RuntimeSetupApplyOptions,
  RuntimeSetupOptions,
  RuntimeSetupPort,
  RuntimeSetupResult,
} from '@use-crux/core/runtime'
import type { Pool } from 'pg'
import { applyDdl, checkDdl } from './ddl'
import { withTransaction } from './sql'

export function createPostgresSetupPort(
  pool: Pool,
  schema: string,
): RuntimeSetupPort {
  return {
    async check(_options?: RuntimeSetupOptions): Promise<RuntimeSetupResult> {
      const findings = await checkDdl(pool, schema)
      return { ok: findings.length === 0, findings }
    },

    async apply(
      _options?: RuntimeSetupApplyOptions,
    ): Promise<RuntimeSetupResult> {
      await withTransaction(pool, async (client) => {
        await applyDdl(client, schema)
      })
      const findings = await checkDdl(pool, schema)
      return { ok: findings.length === 0, findings }
    },
  }
}
