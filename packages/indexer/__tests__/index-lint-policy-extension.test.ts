import { writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IndexDiagnostic, IndexLintFinding, IndexRuleDescriptor, SourceLocation } from '@use-crux/core/project-index'
import { describe, expect, it } from 'vitest'
import { applyIndexLintConfig } from '../indexer/lints/config'
import { applyIndexLintSuppressions } from '../indexer/lints/suppressions'

describe('index lint policy for extension rules', () => {
  it('accepts descriptor-backed extension rule ids in lint config', () => {
    const diagnostics: IndexDiagnostic[] = []
    const findings = applyIndexLintConfig({
      config: {
        rules: {
          '@acme/rules/require-owner': { enabled: false },
        },
      },
      diagnostics,
      findings: [extensionFinding()],
      ruleDescriptors: [extensionRuleDescriptor],
    })

    expect(findings).toEqual([])
    expect(diagnostics).toEqual([])
  })

  it('accepts descriptor-backed extension rule ids in suppression comments', () => {
    const file = join(tmpdir(), `crux-extension-lint-policy-${process.pid}-${Date.now()}.ts`)
    writeFileSync(
      file,
      '// crux-lint-disable-next-line @acme/rules/require-owner -- owner is registered externally\nworkflow();\n',
    )
    try {
      const diagnostics: IndexDiagnostic[] = []
      const findings = applyIndexLintSuppressions({
        files: [file],
        diagnostics,
        findings: [extensionFinding({ file, line: 2, column: 1 })],
        ruleDescriptors: [extensionRuleDescriptor],
      })

      expect(findings).toEqual([])
      expect(diagnostics).toEqual([])
    } finally {
      rmSync(file, { force: true })
    }
  })
})

const extensionRuleDescriptor = {
  id: '@acme/rules/require-owner',
  source: 'extension',
  title: 'Require owner',
  description: 'Requires workflow owner metadata.',
} satisfies IndexRuleDescriptor

function extensionFinding(source?: SourceLocation): IndexLintFinding {
  return {
    id: 'lint:@acme/rules/require-owner:workflow',
    severity: 'warning',
    ruleId: '@acme/rules/require-owner',
    category: 'quality',
    maturity: 'experimental',
    confidence: 'medium',
    profiles: ['recommended'],
    title: 'Require owner',
    message: 'Workflow is missing owner metadata.',
    rationale: 'Owned workflows are easier to operate.',
    relatedDefinitionIds: [],
    evidence: [],
    fixes: [],
    docsUrl: 'https://example.test/rules/require-owner',
    ...(source ? { source } : {}),
  }
}
