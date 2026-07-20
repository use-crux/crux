import { describe, expect, it } from 'vitest'
import { createSetupPlanner } from '@use-crux/core/setup'
import {
  node,
  inMemoryRuntimeStore,
  serverless,
  type RuntimeSetupPort,
} from '@use-crux/core/runtime'
import { createRuntimeSetupContributor } from '../src/indexer/setup/runtime-contributor'

describe('Runtime setup contributor', () => {
  it('warns about a fallback serverless namespace without failing setup', async () => {
    const runtime = serverless({
      store: inMemoryRuntimeStore(),
      publicUrl: 'https://app.example.com',
      env: {},
      wake: {
        id: 'test',
        capabilities: { signed: false },
        createWake: () => async () => undefined,
      },
    })
    const contributor = createRuntimeSetupContributor(runtime)
    const report = await createSetupPlanner([contributor]).check({
      root: '/project',
      mode: 'check',
    })

    expect(report.ok).toBe(true)
    expect(report.findings).toContainEqual(
      expect.objectContaining({
        contributorId: 'runtime',
        code: 'NAMESPACE_AMBIGUOUS',
        severity: 'warning',
      }),
    )
  })

  it('does not warn when namespace provenance is configured, inferred, or absent', async () => {
    const wake = { enqueue: async () => undefined }
    const runtimes = [
      serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        namespace: 'tenant-a',
        wake: {
          id: 'explicit',
          capabilities: { signed: false },
          createWake: () => wake.enqueue,
        },
      }),
      serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        env: { CRUX_RUNTIME_NAMESPACE: 'tenant-a' },
        wake: {
          id: 'env',
          capabilities: { signed: false },
          createWake: () => wake.enqueue,
        },
      }),
      serverless({
        store: inMemoryRuntimeStore(),
        publicUrl: 'https://app.example.com',
        env: { NODE_ENV: 'production', VERCEL_ENV: 'production' },
        wake: {
          id: 'inferred',
          capabilities: { signed: false },
          createWake: () => wake.enqueue,
        },
      }),
      node({ store: inMemoryRuntimeStore(), autoStartMaintenance: false }),
    ]

    const findings = await Promise.all(
      runtimes.map((runtime) =>
        createRuntimeSetupContributor(runtime).inspect({
          root: '/project',
          mode: 'check',
        }),
      ),
    )

    expect(findings.flat()).not.toContainEqual(
      expect.objectContaining({ code: 'NAMESPACE_AMBIGUOUS' }),
    )
  })

  it('maps findings and safely applies unhealthy setup', async () => {
    let healthy = false
    const setup: RuntimeSetupPort = {
      check: async () => ({
        ok: healthy,
        findings: healthy
          ? []
          : [
              {
                code: 'TABLE_MISSING',
                resource: 'work',
                message: 'missing',
                remediation: 'CREATE TABLE work',
              },
            ],
      }),
      apply: async () => {
        healthy = true
        return { ok: true, findings: [] }
      },
    }
    const store = inMemoryRuntimeStore()
    const runtime = node({
      store: { ...store, setup },
      autoStartMaintenance: false,
    })
    const contributor = createRuntimeSetupContributor(runtime)
    expect(
      await contributor.inspect({ root: '/project', mode: 'check' }),
    ).toEqual([
      expect.objectContaining({
        contributorId: 'runtime',
        severity: 'error',
        code: 'TABLE_MISSING',
      }),
    ])
    const [action] = await contributor.plan({ root: '/project', mode: 'plan' })
    expect(action).toMatchObject({ classification: 'safe-additive' })
    expect(
      (await contributor.apply!(action!, { root: '/project', mode: 'apply' }))
        .ok,
    ).toBe(true)
    expect(
      await contributor.inspect({ root: '/project', mode: 'check' }),
    ).toEqual([])
  })

  it('redacts URL credentials from findings and coding-agent prompts', async () => {
    const setup: RuntimeSetupPort = {
      check: async () => ({
        ok: false,
        findings: [
          {
            code: 'CONNECTION_FAILED',
            resource: 'postgres',
            message:
              'Could not connect to postgres://admin:hunt@r2@db.example.test/crux?token=visible',
            remediation:
              'DATABASE_URL=postgres://admin:hunt@r2@db.example.test/crux pnpm crux setup --apply',
          },
        ],
      }),
      apply: async () => ({ ok: false, findings: [] }),
    }
    const runtime = node({
      store: { ...inMemoryRuntimeStore(), setup },
      autoStartMaintenance: false,
    })
    const [finding] = await createRuntimeSetupContributor(runtime).inspect({
      root: '/project',
      mode: 'check',
    })
    const serialized = JSON.stringify(finding)
    expect(serialized).not.toContain('admin')
    expect(serialized).not.toContain('hunter2')
    expect(serialized).not.toContain('hunt@r2')
    expect(serialized).not.toContain('r2@db.example.test')
    expect(serialized).not.toContain('visible')
    expect(serialized).toContain('[REDACTED]')
  })

  it('treats host-owned Runtime setup as inert metadata', async () => {
    const capabilities = node({
      store: inMemoryRuntimeStore(),
      autoStartMaintenance: false,
    }).capabilities
    const contributor = createRuntimeSetupContributor({
      kind: 'host-bound',
      id: 'convex',
      host: 'convex',
      entry: 'createConvexRuntimeHandlers({ targetExecutor })',
      capabilities,
    })
    await expect(
      contributor.inspect({ root: '/project', mode: 'check' }),
    ).resolves.toEqual([])
    await expect(
      contributor.plan({ root: '/project', mode: 'plan' }),
    ).resolves.toEqual([])
  })
})
