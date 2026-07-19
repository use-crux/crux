import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeferSetupContributor } from '../src/indexer/setup/defer-contributor'

describe('defer setup effective host config', () => {
  it('does not accept an undefined host as retention evidence', async () => {
    const root = await createProject({
      'crux.config.ts': [
        "import { config } from '@use-crux/core'",
        'export default config({ host: undefined })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('ignores config-shaped calls outside the effective project config', async () => {
    const root = await createProject({
      'src/not-project-config.ts': [
        "import { config } from '@use-crux/core'",
        "import { next } from '@use-crux/next'",
        'export const ignored = config({ host: next() })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('does not accept a conditionally absent host as proven retention', async () => {
    const root = await createProject({
      'crux.config.ts': [
        "import { config } from '@use-crux/core'",
        "import { next } from '@use-crux/next'",
        'declare const enabled: boolean',
        'export default config({ host: enabled ? next() : undefined })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('does not accept an opaque identifier as effective host evidence', async () => {
    const root = await createProject({
      'crux.config.ts': [
        "import { config } from '@use-crux/core'",
        'const selectedHost = undefined',
        'export default config({ host: selectedHost })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('does not accept an opaque helper call as effective host evidence', async () => {
    const root = await createProject({
      'crux.config.ts': [
        "import { config } from '@use-crux/core'",
        'const resolveHost = () => undefined',
        'export default config({ host: resolveHost() })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })

  it('does not accept a host overwritten by a trailing spread', async () => {
    const root = await createProject({
      'crux.config.ts': [
        "import { config } from '@use-crux/core'",
        "import { next } from '@use-crux/next'",
        'declare const overrides: { host?: undefined }',
        'export default config({ host: next(), ...overrides })',
      ].join('\n'),
      'src/route.ts': [
        "import { defer } from '@use-crux/core'",
        'export async function POST() { defer(flushAnalytics) }',
      ].join('\n'),
    })

    const findings = await createDeferSetupContributor({
      runtime: undefined,
    }).inspect({ root, mode: 'check' })

    expect(findings).toContainEqual(
      expect.objectContaining({
        code: 'DEFER_HOST_CAPABILITY_NOT_PROVEN',
        resource: 'next',
      }),
    )
  })
})

async function createProject(
  files: Readonly<Record<string, string>>,
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-defer-host-config-'))
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
  for (const [file, source] of Object.entries(files)) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, source)
  }
  return root
}
