import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { CruxLintConfig } from '@crux/core'
import type { IndexDiagnostic, ProjectDefinition } from '@crux/core/project-index'
import { canonicalIndexPatchFactsJson } from '../contracts/parity'
import { applyIndexLintConfig } from '../indexer/lints/config'
import { indexLintFindings } from '../indexer/lints/findings'
import { applyIndexLintSuppressions } from '../indexer/lints/suppressions'
import { builtInIndexRuleDescriptors } from '../indexer/lints/rules'
import { finalizeStaticIndexFactsWithWorker } from '../testing/static-index-worker'

interface PolicyParityCase {
  readonly name: string
  readonly config?: CruxLintConfig
  readonly sourceText?: string
  readonly sourceLine?: number
  readonly lintSuppressions?: readonly {
    readonly line: number
    readonly column: number
    readonly scope: 'next-line' | 'line' | 'file'
    readonly ruleId: string
  }[]
}

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('native lint policy parity', () => {
  it.each(policyParityCases)('$name', async (testCase) => {
    const root = '/workspace/acme'
    const file = await sourceFileForCase(testCase)
    const definitions = [
      {
        id: 'prompt:writer',
        kind: 'prompt',
        name: 'writer',
        fidelity: 'resolved',
        source: { file, line: testCase.sourceLine ?? 2, column: 1 },
      },
    ] satisfies readonly ProjectDefinition[]
    const native = await finalizeStaticIndexFactsWithWorker({
      root,
      nativeFacts: [{ root, definitions, relations: [] }],
      extensionFacts: [],
      ...(testCase.config ? { lintConfig: testCase.config } : {}),
      ...(testCase.lintSuppressions
        ? {
            lintSuppressions: testCase.lintSuppressions.map((suppression) => ({
              file,
              ...suppression,
            })),
          }
        : {}),
    })
    const diagnostics: IndexDiagnostic[] = []
    const suppressed = applyIndexLintSuppressions({
      files: [file],
      diagnostics,
      ruleDescriptors: builtInIndexRuleDescriptors(),
      findings: indexLintFindings({ definitions, relations: [] }),
    })
    const ts = {
      diagnostics,
      lintFindings: applyIndexLintConfig({
        config: testCase.config,
        diagnostics,
        ruleDescriptors: builtInIndexRuleDescriptors(),
        findings: suppressed,
      }),
    }

    expect(
      canonicalIndexPatchFactsJson({
        diagnostics: native.diagnostics ?? [],
        lintFindings: native.lintFindings ?? [],
      }),
    ).toBe(canonicalIndexPatchFactsJson(ts))
  })
})

const policyParityCases: readonly PolicyParityCase[] = [
  {
    name: 'disabled rule removes matching findings',
    config: { profile: 'strict', rules: { 'prompt.missing_input_schema': { enabled: false } } },
  },
  {
    name: 'severity override rewrites matching findings',
    config: { profile: 'strict', rules: { 'prompt.missing_input_schema': { severity: 'error' } } },
  },
  {
    name: 'profile off still reports unknown rule diagnostics',
    config: { profile: 'off', rules: { '@acme/rules/missing': { enabled: false } } },
  },
  {
    name: 'next-line suppression removes matching source finding',
    config: { profile: 'strict' },
    sourceText: '// crux-lint-disable-next-line prompt.missing_input_schema -- generated\nprompt()',
    sourceLine: 2,
    lintSuppressions: [{ line: 1, column: 4, scope: 'next-line', ruleId: 'prompt.missing_input_schema' }],
  },
  {
    name: 'unused suppression reports a source diagnostic',
    config: { profile: 'strict' },
    sourceText: '// crux-lint-disable-line tool.missing_input_schema -- stale\nprompt()',
    sourceLine: 2,
    lintSuppressions: [{ line: 1, column: 4, scope: 'line', ruleId: 'tool.missing_input_schema' }],
  },
]

async function sourceFileForCase(testCase: PolicyParityCase): Promise<string> {
  if (!testCase.sourceText) return '/workspace/acme/src/prompt.ts'
  const dir = await mkdtemp(join(tmpdir(), 'crux-lint-policy-'))
  tempDirs.push(dir)
  const file = join(dir, 'prompt.ts')
  await writeFile(file, testCase.sourceText)
  return file
}
