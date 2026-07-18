import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CruxHostBinding } from '@use-crux/core'
import { createDeferSetupContributor } from '../src/indexer/setup/defer-contributor'

describe('defer setup host bindings', () => {
  it('recognizes the effective host loaded from project config', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/next': 'workspace:*',
        next: '^16',
      },
      files: {
        'crux.config.ts': [
          "import { config } from '@use-crux/core'",
          "import { next } from '@use-crux/next'",
          'export default config({ host: next() })',
        ].join('\n'),
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function POST() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
      host: configuredHost('next'),
    }).inspect({ root, mode: 'check' })

    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        }),
      ]),
    )
  })

  it('does not accept a host for a different freezing platform', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/next': 'workspace:*',
        next: '^16',
      },
      files: {
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function POST() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
      host: configuredHost('node'),
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('gives the exact one-line Next host remediation', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/next': 'workspace:*',
        next: '^16',
      },
      files: {
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function POST() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        remediation: 'Add `host: next()` to config() in crux.config.ts.',
        agentPrompt: expect.stringContaining('config({ host: next() })'),
      }),
    )
  })

  it('does not demand a wrapper for an unknown long-lived host', async () => {
    const root = await createProject({
      dependencies: { '@use-crux/core': 'workspace:*' },
      files: {
        'src/agent.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function enrich() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    await expect(
      createDeferSetupContributor({ runtime: undefined }).inspect({
        root,
        mode: 'check',
      }),
    ).resolves.toEqual([])
  })

  it('does not demand strict finalization for config-only named acceptance', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/next': 'workspace:*',
        next: '^16',
      },
      files: {
        'crux.config.ts': [
          "import { config } from '@use-crux/core'",
          "import { next } from '@use-crux/next'",
          'export default config({ host: next() })',
        ].join('\n'),
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function POST() { await defer(sendReceipt, input) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_DURABLE_FINALIZATION_NOT_PROVEN',
        }),
      ]),
    )
  })

  it('gives the exact one-line Vercel host remediation', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/vercel': 'workspace:*',
        '@vercel/functions': '^3',
      },
      files: {
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function POST() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        remediation: 'Add `host: vercel()` to config() in crux.config.ts.',
      }),
    )
  })

  it('keeps Workers retention request-scoped in its remediation', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/cloudflare': 'workspace:*',
        '@use-crux/core': 'workspace:*',
        wrangler: '^4',
      },
      files: {
        'src/worker.ts': [
          "import { defer } from '@use-crux/core'",
          'export async function fetch() { defer(flushAnalytics) }',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        remediation:
          'Use @use-crux/cloudflare withCrux, or pass workers({ ctx }) to a per-request boundary.',
      }),
    )
  })

  it('recognizes the framework withCrux lifecycle boundary', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/next': 'workspace:*',
        next: '^16',
      },
      files: {
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          "import { withCrux } from '@use-crux/next'",
          'export const POST = withCrux(async () => { defer(flushAnalytics) })',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        }),
      ]),
    )
  })

  it('recognizes the generic serverless lifecycle boundary', async () => {
    const root = await createProject({
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/vercel': 'workspace:*',
        '@vercel/functions': '^3',
      },
      files: {
        'src/route.ts': [
          "import { defer } from '@use-crux/core'",
          "import { withServerlessDefer } from '@use-crux/core/defer/serverless'",
          'export const POST = withServerlessDefer(async () => { defer(flushAnalytics) }, { binding })',
        ].join('\n'),
      },
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        }),
      ]),
    )
  })
})

async function createProject(input: {
  readonly dependencies: Readonly<Record<string, string>>
  readonly files: Readonly<Record<string, string>>
}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-defer-host-'))
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ dependencies: input.dependencies }),
  )
  for (const [file, source] of Object.entries(input.files)) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, source)
  }
  return root
}

function configuredHost(kind: string): CruxHostBinding {
  return {
    kind,
    invocationScope: true,
    retain: () => {},
  }
}
