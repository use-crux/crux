import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { ProjectDefinition } from '@use-crux/core/project-index'
import type { SetupReport } from '@use-crux/core/setup'
import { afterEach, describe, expect, it } from 'vitest'
import {
  runSetupOperation,
  runSetupPlanningOperation,
} from '../src/indexer/setup-ops'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('runSetupOperation', () => {
  it('aggregates non-Runtime contributors in a configless project', async () => {
    const root = await fixture({ dependencies: { next: '^16.0.0' } })
    await mkdir(join(root, 'src'))
    await writeFile(
      join(root, 'src/route.ts'),
      "import { defer } from '@use-crux/core';\nawait defer(sendReceipt, input)",
    )

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report.ok).toBe(false)
    expect(report.setup.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributorId: 'defer',
          code: 'DEFER_NEXT_INTEGRATION_MISSING',
        }),
        expect.objectContaining({
          contributorId: 'defer',
          code: 'DEFER_RUNTIME_NOT_CONFIGURED',
        }),
      ]),
    )
  })

  it('contains malformed project metadata without leaking its contents', async () => {
    const root = await mkdtemp(join(tmpdir(), 'crux-setup-ops-'))
    roots.push(root)
    await writeFile(join(root, '.gitignore'), '.crux/\n')
    await writeFile(join(root, 'package.json'), '{ "password": "secret" ')

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report).toMatchObject({
      ok: false,
      setup: {
        findings: [
          {
            contributorId: 'defer',
            code: 'SETUP_CONTRIBUTOR_FAILED',
          },
        ],
      },
    })
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('contains config evaluation failures and still runs sibling contributors', async () => {
    const root = await fixture({
      dependencies: { '@use-crux/core': 'workspace:*' },
    })
    await writeFile(join(root, 'crux.config.ts'), "throw new Error('DATABASE_URL=postgres://admin:secret@db/crux')")

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report.ok).toBe(false)
    expect(report.setup.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          contributorId: 'project-config',
          code: 'SETUP_CONTRIBUTOR_FAILED',
        }),
      ]),
    )
    expect(JSON.stringify(report)).not.toContain('admin')
    expect(JSON.stringify(report)).not.toContain('secret')
  })

  it('includes configured Storage setup in read-only checks', async () => {
    const root = await mkdtemp(
      join(dirname(fileURLToPath(import.meta.url)), '.tmp-setup-ops-'),
    )
    roots.push(root)
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, '.gitignore'), '.crux/\n')
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        'const storage = {',
        '  records: {} as never,',
        '  setup: {',
        '    check: async () => ({ ok: false, findings: [{',
        "      code: 'STORAGE_SCHEMA_MISSING', resource: 'records',",
        "      message: 'Storage schema is missing.',",
        "      remediation: 'CREATE SCHEMA crux_storage',",
        '    }] }),',
        '    apply: async () => ({ ok: true, findings: [] }),',
        '  },',
        '}',
        'export default {',
        '  config: { storage }, prompts: {}, contexts: {},',
        '  get: () => undefined,',
        '}',
      ].join('\n'),
    )

    const report = await runSetupOperation({ root, mode: 'check' })

    expect(report).toMatchObject({
      ok: false,
      setup: {
        mode: 'check',
        findings: [
          expect.objectContaining({
            contributorId: 'storage',
            code: 'STORAGE_SCHEMA_MISSING',
            remediation: 'CREATE SCHEMA crux_storage',
          }),
        ],
      },
      generation: { status: 'blocked' },
    })
  })

  it('applies configured Storage setup and closes the CLI-loaded bundle', async () => {
    const root = await mkdtemp(
      join(dirname(fileURLToPath(import.meta.url)), '.tmp-setup-ops-'),
    )
    roots.push(root)
    await writeFile(join(root, 'package.json'), '{"type":"module"}')
    await writeFile(join(root, '.gitignore'), '.crux/\n')
    const stateKey = `__cruxStorageSetup_${Date.now()}`
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        `const key = ${JSON.stringify(stateKey)}`,
        'const states = globalThis as typeof globalThis & Record<string, { healthy: boolean, applied: number, closed: number }>',
        'const state = states[key] ??= { healthy: false, applied: 0, closed: 0 }',
        'const storage = {',
        '  records: {} as never,',
        '  setup: {',
        '    check: async () => state.healthy',
        '      ? { ok: true, findings: [] }',
        '      : { ok: false, findings: [{ code: "STORAGE_SCHEMA_MISSING", resource: "records", message: "missing" }] },',
        '    apply: async () => {',
        '      state.applied += 1',
        '      state.healthy = true',
        '      return { ok: true, findings: [] }',
        '    },',
        '  },',
        '  close: async () => { state.closed += 1 },',
        '}',
        'export default {',
        '  config: { storage }, prompts: {}, contexts: {},',
        '  get: () => undefined,',
        '}',
      ].join('\n'),
    )

    const report = await runSetupPlanningOperation({
      root,
      mode: 'apply',
    })
    const state = (
      globalThis as typeof globalThis &
        Record<string, { applied: number; closed: number }>
    )[stateKey]

    expect(report).toMatchObject({
      ok: true,
      mode: 'apply',
      actions: [
        expect.objectContaining({
          id: 'storage.apply-setup',
          classification: 'safe-additive',
        }),
      ],
      applied: [{ actionId: 'storage.apply-setup', ok: true }],
      findings: [],
    })
    expect(state).toMatchObject({ applied: 1, closed: 1 })
    delete (
      globalThis as typeof globalThis & Record<string, unknown>
    )[stateKey]
  })

  it('dry-runs the canonical artifact plan, applies it, then reports current', async () => {
    const root = await fixture({ type: 'module' })
    const source = join(root, 'src/review.ts')
    await mkdir(join(root, 'src'))
    await writeFile(source, 'export const reviewFlow = true\n')
    const definitions = [runtimeTarget(source)]

    const checked = await runSetupOperation({
      root,
      mode: 'check',
      definitions,
    })

    expect(checked).toMatchObject({
      ok: false,
      setup: { mode: 'check' },
      generation: {
        status: 'would-generate',
        contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        pendingFiles: [
          '.crux/generated/runtime/privacy.json',
          '.crux/generated/runtime/program.ts',
          'crux/generated/next.ts',
          '.crux/generated/runtime/manifest.json',
        ],
        changedFiles: [],
        findings: [],
      },
    })
    expect(checked.setup.findings).toEqual([
      expect.objectContaining({
        contributorId: 'runtime-artifacts',
        code: 'RUNTIME_ARTIFACTS_STALE',
        remediation: expect.stringContaining('crux setup --apply'),
      }),
    ])
    await expect(readFile(join(root, '.crux/generated/runtime/manifest.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const applied = await runSetupOperation({
      root,
      mode: 'apply',
      definitions,
    })
    expect(applied).toMatchObject({
      ok: true,
      setup: { mode: 'apply', findings: [] },
      generation: {
        status: 'generated',
        contentHash: checked.generation.contentHash,
        pendingFiles: [],
        changedFiles: [
          '.crux/generated/runtime/privacy.json',
          '.crux/generated/runtime/program.ts',
          'crux/generated/next.ts',
          '.crux/generated/runtime/manifest.json',
        ],
        findings: [],
      },
    })

    await expect(runSetupOperation({ root, mode: 'check', definitions })).resolves.toMatchObject({
      ok: true,
      generation: {
        status: 'current',
        pendingFiles: [],
        changedFiles: [],
      },
    })
  })

  it('applies local-state before Runtime artifacts own .crux creation', async () => {
    const root = await fixture({ type: 'module' }, { gitignore: false })
    const source = join(root, 'src/review.ts')
    await mkdir(join(root, 'src'))
    await writeFile(source, 'export const reviewFlow = true\n')

    const applied = await runSetupOperation({
      root,
      mode: 'apply',
      definitions: [runtimeTarget(source)],
    })

    expect(applied).toMatchObject({
      ok: true,
      setup: {
        findings: [],
        applied: [{ actionId: 'local-state.gitignore-crux', ok: true }],
      },
      generation: {
        status: 'generated',
        changedFiles: [
          '.crux/generated/runtime/privacy.json',
          '.crux/generated/runtime/program.ts',
          'crux/generated/next.ts',
          '.crux/generated/runtime/manifest.json',
        ],
      },
    })
    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe(
      '.crux/\n',
    )
    await expect(
      readFile(join(root, '.crux/generated/runtime/manifest.json'), 'utf8'),
    ).resolves.toContain('"targets"')
  })

  it('does not duplicate the local-state rule across repeated apply', async () => {
    const root = await fixture({ type: 'module' }, { gitignore: false })

    await runSetupOperation({ root, mode: 'apply', definitions: [] })
    await runSetupOperation({ root, mode: 'apply', definitions: [] })

    await expect(readFile(join(root, '.gitignore'), 'utf8')).resolves.toBe(
      '.crux/\n',
    )
  })

  it('blocks generation on final setup errors but not warnings', async () => {
    const blockedRoot = await fixture({ type: 'module' })
    const blocked = await runSetupOperation({
      root: blockedRoot,
      mode: 'apply',
      setup: setupReport('apply', 'error'),
      definitions: [],
    })
    expect(blocked).toMatchObject({
      ok: false,
      generation: {
        status: 'blocked',
        pendingFiles: [],
        changedFiles: [],
        findings: [],
      },
    })
    await expect(readFile(join(blockedRoot, '.crux/generated/runtime/manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const warningRoot = await fixture({ type: 'module' })
    const warning = await runSetupOperation({
      root: warningRoot,
      mode: 'apply',
      setup: setupReport('apply', 'warning'),
      definitions: [],
    })
    expect(warning).toMatchObject({
      ok: true,
      setup: { findings: [expect.objectContaining({ severity: 'warning' })] },
      generation: { status: 'generated', findings: [] },
    })
  })

  it('keeps generation children out of the aggregate setup finding', async () => {
    const root = await fixture({ type: 'module' })
    const source = join(root, 'evals/invalid.eval.ts')
    const result = await runSetupOperation({
      root,
      mode: 'apply',
      setup: setupReport('apply'),
      definitions: [
        {
          id: 'eval:invalid',
          kind: 'eval',
          name: 'invalid',
          fidelity: 'resolved',
          source: { file: source, line: 1 },
          metadata: {
            exportName: 'default',
            evalContract: 'crux.eval',
            runtimeDiscovered: true,
            evalExecutionArms: [
              {
                name: 'current',
                status: 'invalid',
                code: 'task_not_callable',
                reason: 'Eval task must be callable.',
              },
            ],
          },
        },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      setup: {
        findings: [
          expect.objectContaining({
            contributorId: 'runtime-artifacts',
            code: 'RUNTIME_ARTIFACT_GENERATION_FAILED',
          }),
        ],
      },
      generation: {
        status: 'failed',
        pendingFiles: [],
        changedFiles: [],
        findings: [
          expect.objectContaining({
            code: 'RUNTIME_EVAL_INVALID',
            featureId: 'invalid',
          }),
        ],
      },
    })
    expect(result.setup.findings).toHaveLength(1)
  })

  it('returns a typed failed envelope when the fresh Project Index fails', async () => {
    const root = await fixture({ type: 'module' })
    const result = await runSetupOperation({
      root,
      mode: 'apply',
      setup: setupReport('apply'),
      generationFindings: [
        {
          code: 'PROJECT_INDEX_FAILED',
          category: 'internal',
          featureKind: 'runtime',
          featureId: 'project-index',
          summary: 'Crux could not inspect the project.',
          reason: 'Project indexing did not complete.',
          whatStillWorks: 'Existing generated files are unchanged.',
        },
      ],
    })

    expect(result).toMatchObject({
      ok: false,
      setup: {
        findings: [
          expect.objectContaining({
            contributorId: 'runtime-artifacts',
            code: 'RUNTIME_ARTIFACT_GENERATION_FAILED',
          }),
        ],
      },
      generation: {
        status: 'failed',
        findings: [expect.objectContaining({ code: 'PROJECT_INDEX_FAILED' })],
      },
    })
    await expect(readFile(join(root, '.crux/generated/runtime/manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('inspects an inert Convex declaration without executing its host', async () => {
    const root = await fixture({
      type: 'module',
      dependencies: {
        '@use-crux/core': 'workspace:*',
        '@use-crux/convex': 'workspace:*',
      },
    })
    await writeFile(
      join(root, 'crux.config.ts'),
      [
        "import { config } from '@use-crux/core'",
        "import { convex } from '@use-crux/convex/runtime'",
        'export default config({ runtime: convex() })',
      ].join('\n'),
    )

    const result = await runSetupOperation({
      root,
      mode: 'check',
      definitions: [],
    })

    expect(result.generation.status).toBe('blocked')
    expect(JSON.stringify(result)).not.toContain('RUNTIME_HOST_ONLY')
  })
})

function runtimeTarget(source: string): ProjectDefinition {
  return {
    id: 'flow:review',
    kind: 'flow',
    name: 'review',
    fidelity: 'resolved',
    fingerprint: 'definition-review-v1',
    source: { file: source, line: 1 },
    metadata: { exportName: 'reviewFlow' },
  }
}

function setupReport(mode: 'check' | 'apply', severity?: 'error' | 'warning'): SetupReport {
  return {
    ok: severity !== 'error',
    mode,
    findings: severity
      ? [
          {
            contributorId: 'fixture',
            code: `FIXTURE_${severity.toUpperCase()}`,
            resource: 'fixture',
            severity,
            message: `Fixture ${severity}.`,
          },
        ]
      : [],
    actions: [],
    applied: [],
  }
}

async function fixture(
  manifest: object,
  options: { readonly gitignore?: boolean } = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'crux-setup-ops-'))
  roots.push(root)
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest))
  if (options.gitignore !== false) {
    await writeFile(join(root, '.gitignore'), '.crux/\n')
  }
  return root
}
