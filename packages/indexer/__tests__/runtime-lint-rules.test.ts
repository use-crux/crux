import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexDiagnostic, ProjectDefinition } from '@use-crux/core/project-index'
import { compileProjectIndex } from '../indexer/compiler'
import { createStaticExtraction } from '../indexer/static/extraction/engine'
import { indexLintFindings } from '../indexer/lints/findings'
import { applyIndexLintSuppressions } from '../indexer/lints/suppressions'
import { builtInIndexRuleDescriptors } from '../indexer/lints/rules'

describe('runtime lint rules', () => {
  it('reports duplicate durable target names across flow and durable task definitions', () => {
    const findings = indexLintFindings({
      definitions: [
        runtimeDefinition({ id: 'flow:review', kind: 'flow', name: 'review' }),
        runtimeDefinition({ id: 'task:review', kind: 'task', name: 'review' }),
      ],
      relations: [],
    })

    expect(findings.find((finding) => finding.ruleId === 'runtime.duplicate_target_name')).toMatchObject({
      ruleId: 'runtime.duplicate_target_name',
      severity: 'error',
      category: 'runtime',
      relatedDefinitionIds: ['flow:review', 'task:review'],
    })
  })

  it('reports runtime targets with non-literal names or declarations that are not exported', () => {
    const findings = indexLintFindings({
      definitions: [
        runtimeDefinition({
          id: 'flow:src-review-dynamicFlow',
          kind: 'flow',
          name: 'dynamicFlow',
          runtimeTarget: { nameLiteral: false, exported: true },
        }),
        runtimeDefinition({
          id: 'task:local-task',
          kind: 'task',
          name: 'local-task',
          runtimeTarget: { nameLiteral: true, exported: false },
        }),
      ],
      relations: [],
    })

    expect(findings.map((finding) => finding.ruleId)).toEqual([
      'definition.missing_eval_coverage',
      'runtime.non_literal_target_name',
      'runtime.target_not_exported',
    ])
    expect(findings.find((finding) => finding.ruleId === 'runtime.non_literal_target_name')).toMatchObject({
      severity: 'error',
      primaryDefinitionId: 'flow:src-review-dynamicFlow',
    })
    expect(findings.find((finding) => finding.ruleId === 'runtime.target_not_exported')).toMatchObject({
      severity: 'error',
      primaryDefinitionId: 'task:local-task',
    })
  })

  it('uses extracted runtime target metadata for source-authored flow and task declarations', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-'))
    try {
      const file = join(root, 'targets.ts')
      await writeFile(
        file,
        [
          "import { flow } from '@use-crux/core/flow'",
          "import { durableTask } from '@use-crux/core/runtime'",
          '',
          "const dynamicName = 'review'",
          'export const dynamicFlow = flow(dynamicName, async () => undefined)',
          "const localTask = durableTask('local-task', { run: async () => undefined })",
        ].join('\n'),
      )

      const extraction = createStaticExtraction({ root, cache: 'none' })
      const extracted = await extraction.extractFiles([file])
      const findings = indexLintFindings({
        definitions: extracted.flatMap((item) => item.definitions),
        relations: [],
      })

      expect(findings.map((finding) => finding.ruleId)).toContain('runtime.non_literal_target_name')
      expect(findings.map((finding) => finding.ruleId)).toContain('runtime.target_not_exported')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reports runtime-bound flow body hazards from extracted source facts', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-'))
    try {
      const file = join(root, 'flow.ts')
      await writeFile(
        file,
        [
          "import { flow } from '@use-crux/core/flow'",
          "import { durableTask } from '@use-crux/core/runtime'",
          '',
          "export const embed = durableTask('embed', { run: async () => undefined })",
          "export const reviewFlow = flow('review', async (flow) => {",
          '  Date.now()',
          "  await flow.waitFor('approved')",
          '  await flow.defer(() => undefined)',
          '  await flow.after(embed, 1000, new Map())',
          "  await flow.untilIdle({ scope: 'current-flow' })",
          '})',
        ].join('\n'),
      )

      const extraction = createStaticExtraction({ root, cache: 'none' })
      const extracted = await extraction.extractFiles([file])
      const findings = indexLintFindings({
        definitions: extracted.flatMap((item) => item.definitions),
        relations: [],
        runtime: { configured: false },
      })

      expect(findings.map((finding) => finding.ruleId)).toEqual(
        expect.arrayContaining([
          'flow.nondeterministic_code',
          'runtime.closure_defer',
          'runtime.missing_runtime_config',
          'runtime.non_serializable_payload',
        ]),
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not treat unrelated defer/waitFor helpers as flow runtime APIs', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-'))
    try {
      const file = join(root, 'flow.ts')
      await writeFile(
        file,
        [
          "import { flow } from '@use-crux/core/flow'",
          "import { defer } from 'lodash'",
          '',
          "const emitter = { waitFor: async (_name: string) => undefined }",
          "export const reviewFlow = flow('review', async (scope) => {",
          '  defer(() => undefined)',
          "  await emitter.waitFor('approved')",
          "  await scope.waitFor('approved')",
          '})',
        ].join('\n'),
      )

      const extraction = createStaticExtraction({ root, cache: 'none' })
      const extracted = await extraction.extractFiles([file])
      const flowDefinition = extracted.flatMap((item) => item.definitions).find((definition) => definition.kind === 'flow')

      expect(flowDefinition?.metadata?.runtimeUsages).toEqual([
        expect.objectContaining({ method: 'waitFor' }),
      ])

      const findings = indexLintFindings({
        definitions: extracted.flatMap((item) => item.definitions),
        relations: [],
        runtime: { configured: false },
      })

      expect(findings.map((finding) => finding.ruleId)).toContain('runtime.missing_runtime_config')
      expect(findings.map((finding) => finding.ruleId)).not.toContain('runtime.closure_defer')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses loaded project runtime config when compiler-owned lint rules run', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-'))
    try {
      await writeFile(
        join(root, 'crux.config.ts'),
        ["import { config } from '@use-crux/core'", '', 'export default config({})'].join('\n'),
      )
      await writeFile(
        join(root, 'flow.ts'),
        [
          "import { flow } from '@use-crux/core/flow'",
          '',
          "export const reviewFlow = flow('review', async (scope) => {",
          "  await scope.waitFor('approved')",
          '})',
        ].join('\n'),
      )

      const result = await compileProjectIndex({ root, mode: 'runtime-rich' })

      expect(result.lintFindings.map((finding) => finding.ruleId)).toContain('runtime.missing_runtime_config')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses missing runtime config state when no crux config file exists', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-no-config-'))
    try {
      await writeFile(
        join(root, 'flow.ts'),
        [
          "import { flow } from '@use-crux/core/flow'",
          '',
          "export const reviewFlow = flow('review', async ({ waitFor }) => {",
          "  await waitFor('approved')",
          '})',
        ].join('\n'),
      )

      const result = await compileProjectIndex({ root })

      expect(result.project.runtimeConfigured).toBe(false)
      expect(result.lintFindings.map((finding) => finding.ruleId)).toContain('runtime.missing_runtime_config')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not report missing runtime config when config loading failed', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-bad-config-'))
    try {
      await writeFile(
        join(root, 'crux.config.ts'),
        ["import { config } from '@use-crux/core'", '', 'export default config({ runtime:'].join('\n'),
      )
      await writeFile(
        join(root, 'flow.ts'),
        [
          "import { flow } from '@use-crux/core/flow'",
          '',
          "export const reviewFlow = flow('review', async ({ ctx }) => {",
          "  await ctx.waitFor('approved')",
          '})',
        ].join('\n'),
      )

      const result = await compileProjectIndex({ root, mode: 'runtime-rich' })

      expect(result.project.runtimeConfigured).toBeUndefined()
      expect(result.diagnostics.length).toBeGreaterThan(0)
      expect(result.lintFindings.map((finding) => finding.ruleId)).not.toContain('runtime.missing_runtime_config')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('supports source suppression directives for runtime lint rule ids', async () => {
    const root = await mkdtemp(join(process.cwd(), '.tmp-runtime-lints-'))
    try {
      const file = join(root, 'targets.ts')
      await writeFile(
        file,
        [
          "import { flow } from '@use-crux/core/flow'",
          '',
          "const dynamicName = 'review'",
          '// crux-lint-disable-next-line runtime.non_literal_target_name -- generated name is local-only',
          'export const dynamicFlow = flow(dynamicName, async () => undefined)',
        ].join('\n'),
      )

      const extraction = createStaticExtraction({ root, cache: 'none' })
      const extracted = await extraction.extractFiles([file])
      const diagnostics: IndexDiagnostic[] = []
      const suppressed = applyIndexLintSuppressions({
        files: [file],
        diagnostics,
        ruleDescriptors: builtInIndexRuleDescriptors(),
        findings: indexLintFindings({
          definitions: extracted.flatMap((item) => item.definitions),
          relations: [],
        }),
      })

      expect(diagnostics).toEqual([])
      expect(suppressed.map((finding) => finding.ruleId)).not.toContain('runtime.non_literal_target_name')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

function runtimeDefinition(input: {
  readonly id: string
  readonly kind: 'flow' | 'task'
  readonly name: string
  readonly runtimeTarget?: {
    readonly nameLiteral?: boolean
    readonly exported?: boolean
  }
}): ProjectDefinition {
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    fidelity: 'resolved',
    metadata: {
      runtimeTarget: {
        kind: input.kind,
        nameLiteral: input.runtimeTarget?.nameLiteral ?? true,
        exported: input.runtimeTarget?.exported ?? true,
      },
    },
  }
}
