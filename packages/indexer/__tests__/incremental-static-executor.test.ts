import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IndexRuleDescriptor, ProjectIndexSnapshot } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { indexProjectAstPartial } from '../indexer/incremental/static-executor'

describe('incremental static executor', () => {
  it('preserves previous extension rule descriptors for partial lint policy', async () => {
    const root = join(tmpdir(), `crux-incremental-static-${process.pid}-${Date.now()}`)
    const file = join(root, 'src/workflow.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(file, 'export const workflow = 1\n')

    try {
      const result = await indexProjectAstPartial({
        decision: {
          kind: 'source-file-reindex',
          root,
          changedFiles: [file],
          deletedFiles: [],
          affectedFiles: [file],
          affectedDefinitionIds: [],
          graphConfidence: 'complete-enough-for-source-closure',
          explanation: {
            summary: 'test partial reindex',
            graphAvailable: true,
            fallbackUsed: false,
            traversedFiles: [file],
          },
        },
        previousIndex: previousIndex(root, file),
        startedAt: '2026-06-23T00:00:00.000Z',
      })

      expect(result.patch.facts.ruleDescriptors?.map((descriptor) => descriptor.id)).toContain(
        '@acme/rules/require-owner',
      )
      expect(result.patch.facts.diagnostics).not.toContainEqual(
        expect.objectContaining({ code: 'index.lint_unknown_configured_rule' }),
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })

  it('threads previous runtime config state into partial lint findings', async () => {
    const root = join(process.cwd(), `.tmp-crux-incremental-static-runtime-${process.pid}-${Date.now()}`)
    const file = join(root, 'src/flow.ts')
    mkdirSync(join(root, 'src'), { recursive: true })
    writeFileSync(
      join(root, 'crux.config.ts'),
      ['throw new Error("partial reindex must not import config")'].join('\n'),
    )
    writeFileSync(
      file,
      [
        "import { flow } from '@use-crux/core/flow'",
        '',
        "export const reviewFlow = flow('review', async (scope) => {",
        "  await scope.waitFor('approved')",
        '})',
      ].join('\n'),
    )

    try {
      const result = await indexProjectAstPartial({
        decision: {
          kind: 'source-file-reindex',
          root,
          changedFiles: [file],
          deletedFiles: [],
          affectedFiles: [file],
          affectedDefinitionIds: [],
          graphConfidence: 'complete-enough-for-source-closure',
          explanation: {
            summary: 'test runtime lint partial reindex',
            graphAvailable: true,
            fallbackUsed: false,
            traversedFiles: [file],
          },
        },
        previousIndex: previousIndex(root, file, { runtimeConfigured: false }),
        startedAt: '2026-06-23T00:00:00.000Z',
      })

      expect(result.patch.facts.lintFindings?.map((finding) => finding.ruleId)).toContain(
        'runtime.missing_runtime_config',
      )
    } finally {
      rmSync(root, { force: true, recursive: true })
    }
  })
})

const extensionRuleDescriptor = {
  id: '@acme/rules/require-owner',
  source: 'extension',
  title: 'Require owner',
  description: 'Requires workflow owner metadata.',
} satisfies IndexRuleDescriptor

function previousIndex(
  root: string,
  file: string,
  options: { readonly runtimeConfigured?: boolean } = {},
): ProjectIndexSnapshot {
  return {
    schemaVersion: 1,
    prompts: [],
    contexts: [],
    project: { root, ...(options.runtimeConfigured !== undefined ? { runtimeConfigured: options.runtimeConfigured } : {}) },
    lint: {
      rules: {
        '@acme/rules/require-owner': { enabled: false },
      },
    },
    indexedAt: '2026-06-20T00:00:00.000Z',
    definitions: [],
    relations: [],
    diagnostics: [],
    lintFindings: [],
    ruleDescriptors: [extensionRuleDescriptor],
    sourceGraph: {
      schemaVersion: 1,
      producedBy: '@use-crux/indexer',
      capabilities: [
        'source-dependencies',
        'source-dependents',
        'definition-ownership',
        'diagnostic-ownership',
        'project-shards',
      ],
      shards: [{ id: '.', root }],
    },
    sources: [{ file, status: 'indexed', dependencies: [], dependents: [], shardId: '.' }],
  }
}
