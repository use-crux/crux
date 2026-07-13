import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import {
  inMemoryRuntimeStore,
  node,
  type RuntimeSetupPort,
} from '@use-crux/core/runtime'
import { createDeferSetupContributor } from '../src/indexer/setup/defer-contributor'

describe('defer setup contributor', () => {
  it('reports exact Next integration and named durability remediation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/route.ts'),
      "import { defer } from '@use-crux/core';\nawait defer(sendReceipt, input)",
    )
    const contributor = createDeferSetupContributor({ runtime: undefined })
    const findings = await contributor.inspect({ root, mode: 'check' })
    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_NEXT_INTEGRATION_MISSING',
          docsUrl: expect.stringContaining('/defer/troubleshooting'),
          remediation: 'pnpm add @use-crux/next',
        }),
        expect.objectContaining({
          code: 'DEFER_RUNTIME_NOT_CONFIGURED',
          agentPrompt: expect.stringContaining('Runtime Engine'),
        }),
        expect.objectContaining({ code: 'DEFER_MAINTENANCE_NOT_PROVEN' }),
        expect.objectContaining({
          code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
          resource: 'host-lifetime',
        }),
      ]),
    )
    await expect(contributor.plan({ root, mode: 'plan' })).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributorId: 'defer',
          classification: 'requires-approval',
        }),
      ]),
    )
  })

  it('diagnoses adapter schema and maintenance for named defer usage', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@use-crux/core': 'workspace:*' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/handler.ts'),
      "import { defer } from '@use-crux/core';\nawait defer(sendReceipt, input)",
    )
    const setup: RuntimeSetupPort = {
      check: async () => ({
        ok: false,
        findings: [
          {
            code: 'TABLE_MISSING',
            resource: 'scheduledWork',
            message: 'missing',
          },
        ],
      }),
      apply: async () => ({ ok: true, findings: [] }),
    }
    const runtime = node({
      store: { ...inMemoryRuntimeStore(), setup },
      autoStartMaintenance: false,
    })

    const findings = await createDeferSetupContributor({ runtime }).inspect({
      root,
      mode: 'check',
    })

    expect(findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEFER_ADAPTER_SCHEMA_NOT_READY' }),
        expect.objectContaining({ code: 'DEFER_MAINTENANCE_NOT_PROVEN' }),
      ]),
    )
  })

  it('stays silent when defer is not used', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { next: '^16' } }),
    )

    const contributor = createDeferSetupContributor({ runtime: undefined })

    await expect(contributor.inspect({ root, mode: 'check' })).resolves.toEqual(
      [],
    )
    await expect(contributor.plan({ root, mode: 'plan' })).resolves.toEqual([])
  })

  it('treats callback references as inline and checks host integration per file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@use-crux/core': 'workspace:*' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/wrapped.ts'),
      [
        "import { defer } from '@use-crux/core'",
        "import { withNodeDefer } from '@use-crux/core/defer/node'",
        'export const handler = withNodeDefer(async () => { defer(sendReceipt) })',
      ].join('\n'),
    )
    const contributor = createDeferSetupContributor({ runtime: undefined })

    await expect(contributor.inspect({ root, mode: 'check' })).resolves.toEqual(
      [],
    )

    await writeFile(
      join(root, 'src/unwrapped.ts'),
      "import { defer } from '@use-crux/core'\nexport function handler() { defer(sendReceipt) }",
    )
    const findings = await contributor.inspect({ root, mode: 'check' })

    expect(findings).toEqual([
      expect.objectContaining({ code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN' }),
    ])
    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEFER_RUNTIME_NOT_CONFIGURED' }),
      ]),
    )
  })

  it('only accepts a host wrapper that contains the defer call, including imported aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@use-crux/core': 'workspace:*' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/handlers.ts'),
      [
        "import { defer as schedule } from '@use-crux/core'",
        "import { withNodeDefer as withHost } from '@use-crux/core/defer/node'",
        'export const wrapped = withHost(async () => { schedule(sendReceipt) })',
        'export async function unwrapped() { schedule(sendDigest) }',
      ].join('\n'),
    )

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({
      root,
      mode: 'check',
    })

    expect(findings).toEqual([
      expect.objectContaining({ code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN' }),
    ])
  })

  it('requires literal durable finalization proof for named host wrappers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        dependencies: {
          '@use-crux/core': 'workspace:*',
          '@use-crux/next': 'workspace:*',
          next: '^16',
        },
      }),
    )
    await mkdir(join(root, 'src'))
    const route = join(root, 'src/route.ts')
    await writeFile(
      route,
      [
        "import { defer } from '@use-crux/core'",
        "import { withNextDefer } from '@use-crux/next'",
        'export const POST = withNextDefer(async () => {',
        '  await defer(sendReceipt, input)',
        '  return new Response(null)',
        '})',
      ].join('\n'),
    )
    const contributor = createDeferSetupContributor({
      runtime: node({ store: inMemoryRuntimeStore() }),
    })

    await expect(
      contributor.inspect({ root, mode: 'check' }),
    ).resolves.toContainEqual(
      expect.objectContaining({
        code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
        resource: 'withNextDefer',
        remediation:
          'Set `durableFinalization: true` in the withNextDefer options after configuring Runtime durability.',
      }),
    )

    await writeFile(
      route,
      [
        "import { defer } from '@use-crux/core'",
        "import { withNextDefer } from '@use-crux/next'",
        'export const POST = withNextDefer(async () => {',
        '  await defer(sendReceipt, input)',
        '  return new Response(null)',
        '}, { durableFinalization: true })',
      ].join('\n'),
    )
    await expect(
      contributor.inspect({ root, mode: 'check' }),
    ).resolves.not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
        }),
      ]),
    )
  })

  it('never treats withNodeDefer as named durable finalization proof', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@use-crux/core': 'workspace:*' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/handler.ts'),
      [
        "import { defer } from '@use-crux/core'",
        "import { withNodeDefer } from '@use-crux/core/defer/node'",
        'export const handler = withNodeDefer(async (_request, response) => {',
        '  await defer(sendReceipt, input)',
        "  response.end('ok')",
        '})',
      ].join('\n'),
    )

    const findings = await createDeferSetupContributor({
      runtime: node({ store: inMemoryRuntimeStore() }),
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
        resource: 'withNodeDefer',
        remediation:
          'Move named defer(target, input) to a host integration that supports durable finalization; keep withNodeDefer for inline callbacks only.',
      }),
    )
    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN' }),
      ]),
    )
  })

  it('tracks durable finalization proof through serverless wrapper aliases', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-defer-setup-'))
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { '@use-crux/core': 'workspace:*' } }),
    )
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/handlers.ts'),
      [
        "import { defer } from '@use-crux/core'",
        "import { withAfterDefer as afterHost, withWaitUntilDefer as waitHost } from '@use-crux/core/defer/serverless'",
        'export const afterHandler = afterHost(async () => {',
        '  await defer(sendReceipt, input)',
        '}, { after, durableFinalization: true })',
        'export const waitHandler = waitHost(async () => {',
        '  await defer(sendDigest, input)',
        '}, { waitUntil })',
      ].join('\n'),
    )

    const findings = await createDeferSetupContributor({
      runtime: node({ store: inMemoryRuntimeStore() }),
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
        resource: 'withWaitUntilDefer',
      }),
    )
    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ resource: 'withAfterDefer' }),
      ]),
    )

    await writeFile(
      join(root, 'src/node-handler.ts'),
      [
        "import { defer } from '@use-crux/core'",
        "import { withNodeDefer } from '@use-crux/core/defer/node'",
        'export const handler = withNodeDefer(async () => {',
        '  await defer(sendReport, input)',
        '})',
      ].join('\n'),
    )
    const actions = await createDeferSetupContributor({
      runtime: node({ store: inMemoryRuntimeStore() }),
    }).plan({ root, mode: 'plan' })
    const durabilityActionIds = actions
      .filter(({ id }) => id.includes('durable-finalization-not-proven'))
      .map(({ id }) => id)

    expect(new Set(durabilityActionIds).size).toBe(durabilityActionIds.length)
    expect(durabilityActionIds).toHaveLength(2)
  })
})
