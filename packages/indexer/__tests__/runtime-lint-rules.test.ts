import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IndexDiagnostic, ProjectDefinition } from '@use-crux/core/project-index'
import { createStaticExtraction } from '../indexer/static/extraction/engine'
import { indexLintFindings } from '../indexer/lints/findings'
import { applyIndexLintSuppressions } from '../indexer/lints/suppressions'
import { builtInIndexRuleDescriptors } from '../indexer/lints/rules'

describe('runtime lint rules', () => {
  it('reports duplicate durable target names across flow and runtime task definitions', () => {
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
          "import { task } from '@use-crux/core/runtime'",
          '',
          "const dynamicName = 'review'",
          'export const dynamicFlow = flow(dynamicName, async () => undefined)',
          "const localTask = task('local-task', { run: async () => undefined })",
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
          "import { task } from '@use-crux/core/runtime'",
          '',
          "export const embed = task('embed', { run: async () => undefined })",
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
