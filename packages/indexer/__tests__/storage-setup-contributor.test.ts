import { createSetupPlanner } from '@use-crux/core/setup'
import {
  inMemoryStorage,
  type Storage,
  type StorageSetupPort,
} from '@use-crux/core/storage'
import { describe, expect, it } from 'vitest'
import { createStorageSetupContributor } from '../src/indexer/setup/storage-contributor'

describe('Storage setup contributor', () => {
  it('maps configured storage findings and applies only safe additive setup', async () => {
    let healthy = false
    const setup: StorageSetupPort = {
      check: async () => ({
        ok: healthy,
        findings: healthy
          ? []
          : [
              {
                code: 'POSTGRES_STORAGE_SCHEMA_MISSING',
                resource: 'postgres-storage',
                message: 'Storage schema is missing.',
                remediation: 'CREATE SCHEMA crux_storage',
              },
            ],
      }),
      apply: async () => {
        healthy = true
        return { ok: true, findings: [] }
      },
    }
    const storage: Storage & { readonly setup: StorageSetupPort } = {
      ...inMemoryStorage(),
      setup,
    }
    const planner = createSetupPlanner([
      createStorageSetupContributor(storage),
    ])

    await expect(
      planner.check({ root: '/project', mode: 'check' }),
    ).resolves.toMatchObject({
      ok: false,
      findings: [
        {
          contributorId: 'storage',
          code: 'POSTGRES_STORAGE_SCHEMA_MISSING',
          resource: 'postgres-storage',
          severity: 'error',
          message: 'Storage schema is missing.',
          remediation: 'CREATE SCHEMA crux_storage',
        },
      ],
    })

    await expect(
      planner.apply({ root: '/project', mode: 'apply' }),
    ).resolves.toMatchObject({
      ok: true,
      actions: [
        {
          id: 'storage.apply-setup',
          contributorId: 'storage',
          classification: 'safe-additive',
        },
      ],
      applied: [{ actionId: 'storage.apply-setup', ok: true }],
      findings: [],
    })
  })

  it('redacts provider credentials from findings and agent prompts', async () => {
    const setup: StorageSetupPort = {
      check: async () => ({
        ok: false,
        findings: [
          {
            code: 'POSTGRES_STORAGE_SETUP_FAILED',
            resource: 'postgres-storage',
            message:
              'Could not connect to postgres://admin:hunt@r2@db.example.test/crux?token=visible',
            remediation:
              'DATABASE_URL=postgres://admin:hunt@r2@db.example.test/crux pnpm crux setup --apply',
          },
        ],
      }),
      apply: async () => ({ ok: false, findings: [] }),
    }
    const findings = await createStorageSetupContributor({
      ...inMemoryStorage(),
      setup,
    }).inspect({ root: '/project', mode: 'check' })

    const serialized = JSON.stringify(findings)
    expect(serialized).not.toContain('admin')
    expect(serialized).not.toContain('hunt@r2')
    expect(serialized).not.toContain('r2@db.example.test')
    expect(serialized).not.toContain('visible')
    expect(serialized).toContain('[REDACTED]')
  })
})
