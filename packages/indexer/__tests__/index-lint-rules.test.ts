import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexLintFindings } from '../indexer/lints/findings'
import {
  builtInIndexRuleDescriptors,
  indexLintRuleIds,
  indexLintRules,
  validateBuiltInIndexRuleManifests,
} from '../indexer/lints/rules'
import { readStaticIndexRuntimeSharedFixture } from '../contracts/fixtures'

const stableBetaRuleIds = [
  'quality.missing_baseline',
  'prompt.missing_input_schema',
  'prompt.hidden_required_input',
  'context.missing_input_schema',
  'injection.dynamic_dependency',
  'injection.dynamic_tools',
  'tool.missing_input_schema',
  'flow.duplicate_step_label',
  'flow.duplicate_suspend_name',
  'flow.undeclared_suspend_signal',
  'routing.missing_stable_id',
  'routing.router_missing_default',
  'routing.cascade_unreachable_tier',
  'rag.recipe_step_unresolved_target',
  'runtime.duplicate_target_name',
  'runtime.non_literal_target_name',
  'runtime.target_not_exported',
  'runtime.closure_defer',
  'runtime.non_serializable_payload',
] as const

const stableBetaRuleIdSet: ReadonlySet<string> = new Set(stableBetaRuleIds)

describe('index lint rule registry', () => {
  it('owns product metadata needed by all lint surfaces', () => {
    expect(Object.keys(indexLintRules).sort()).toEqual([...indexLintRuleIds].sort())

    for (const ruleId of indexLintRuleIds) {
      const rule = indexLintRules[ruleId]

      expect(rule.id).toBe(ruleId)
      expect(rule.title.trim()).not.toBe('')
      expect(rule.rationale.trim()).not.toBe('')
      expect(rule.manifest.id).toBe(rule.id)
      expect(rule.manifest.phase).toBe('index')
      expect(rule.manifest.fidelity).toBe('safe')
      expect(rule.manifest.requires.length).toBeGreaterThan(0)
      expect(rule.docsSlug).toMatch(/^[a-z0-9-]+$/)
      expect(rule.profiles.length).toBeGreaterThan(0)
      expect(rule.fixes.length).toBeGreaterThan(0)
      expect(rule.fixes.every((fix) => fix.description.trim().length > 0)).toBe(true)
      expect(rule.suppression.scope).toMatch(/^(next-line|line|file)$/)
    }
  })

  it('projects built-in rules into descriptor entries', () => {
    const descriptors = builtInIndexRuleDescriptors()
    const promptRule = descriptors.find((entry) => entry.id === 'prompt.missing_input_schema')

    expect(descriptors.map((entry) => entry.id).sort()).toEqual([...indexLintRuleIds].sort())
    expect(promptRule).toEqual(
      expect.objectContaining({
        id: 'prompt.missing_input_schema',
        source: 'builtin',
        severity: 'info',
        category: 'contracts',
        maturity: 'stable',
        confidence: 'high',
        profiles: ['recommended', 'strict'],
        phase: 'index',
        requires: ['definitions', 'sources'],
        fidelity: 'safe',
        docsUrl: '/docs/reference/crux-core/index-lints/prompt-missing-input-schema',
        suppression: {
          supported: true,
          scope: 'next-line',
          directive: '// crux-lint-disable-next-line prompt.missing_input_schema -- reason',
        },
      }),
    )
  })

  it('marks the stable-beta lint rule set explicitly', () => {
    expect(indexLintRuleIds.filter((ruleId) => indexLintRules[ruleId].maturity === 'stable')).toEqual([
      ...stableBetaRuleIds,
    ])

    for (const ruleId of stableBetaRuleIds) {
      expect(indexLintRules[ruleId].confidence, `${ruleId} confidence`).toMatch(/^(high|medium)$/)
      expect(indexLintRules[ruleId].profiles, `${ruleId} profiles`).toContain('recommended')
    }

    for (const ruleId of indexLintRuleIds.filter((id) => !stableBetaRuleIdSet.has(id))) {
      expect(indexLintRules[ruleId].maturity, `${ruleId} maturity`).toBe('preview')
    }
  })

  it('validates every built-in rule manifest', () => {
    expect(validateBuiltInIndexRuleManifests()).toEqual([])
  })

  it('pins native lint coverage claims to rule-specific parity evidence', () => {
    const coverage = readStaticIndexRuntimeSharedFixture('lint-rule-parity-coverage')
    const primitiveCoverage = readStaticIndexRuntimeSharedFixture('primitive-coverage-identities')

    expect(coverage.requiredEvidence).toEqual(['positive', 'negative'])
    expect(coverage.policyFixture).toBe('index-lint-native-policy-parity.test.ts')
    const coveredRuleIds = coverage.rules.map((rule) => rule.ruleId)
    const typeScriptOnlyRuleIds = (coverage.typeScriptOnlyRules ?? []).map((rule) => rule.ruleId)

    expect([...coveredRuleIds, ...typeScriptOnlyRuleIds].sort()).toEqual([...indexLintRuleIds].sort())
    expect(typeScriptOnlyRuleIds).toEqual(['runtime.missing_runtime_config'])
    expect(coverage.typeScriptOnlyRules?.[0]?.reason).toContain('crux.config.ts')

    for (const rule of coverage.rules) {
      expect(rule.positiveFixture, `${rule.ruleId} positive fixture`).toMatch(
        /^index-lint-native-(parity|injection-parity)\.test\.ts$/,
      )
      expect(rule.negativeFixture, `${rule.ruleId} negative fixture`).toBe(rule.positiveFixture)
    }

    for (const identity of primitiveCoverage.identities) {
      expect(identity.fixtureClasses.lints, `${identity.extractor} lint coverage anchor`).toBe(
        'lint-rule-parity-coverage.json',
      )
    }
  })

  it('emits quality baseline findings from the TypeScript static lint baseline', () => {
    expect(
      indexLintFindings({
        definitions: [
          {
            id: 'unknown:writer',
            kind: 'unknown',
            name: 'writer',
            fidelity: 'resolved',
            source: { file: '/workspace/acme/src/quality.ts', line: 1, column: 1 },
            quality: {
              experimentIds: ['experiment:writer'],
              experimentCount: 1,
              passRate: 0.8,
              lastRunId: 'experiment:writer',
            },
          },
        ],
        relations: [],
      }).find((finding) => finding.ruleId === 'quality.missing_baseline'),
    ).toMatchObject({
      id: 'lint:quality.missing_baseline:unknown:writer',
      ruleId: 'quality.missing_baseline',
      message: 'writer has experiment history but no promoted baseline.',
      primaryDefinitionId: 'unknown:writer',
      relatedDefinitionIds: ['unknown:writer'],
      evidence: [
        {
          kind: 'quality',
          label: 'Experiment history without baseline',
          definitionId: 'unknown:writer',
          data: {
            experimentIds: ['experiment:writer'],
            experimentCount: 1,
            passRate: 0.8,
            lastRunId: 'experiment:writer',
          },
        },
      ],
    })

    expect(
      indexLintFindings({
        definitions: [
          {
            id: 'unknown:writer',
            kind: 'unknown',
            name: 'writer',
            fidelity: 'resolved',
            quality: {
              experimentIds: ['experiment:writer'],
              baselineIds: ['baseline:writer'],
            },
          },
        ],
        relations: [],
      }).some((finding) => finding.ruleId === 'quality.missing_baseline'),
    ).toBe(false)
  })

  it('points every rule at a docs page with the required product sections', () => {
    const docsRoot = join(process.cwd(), '../../apps/docs/content/docs/reference/crux-core/index-lints')
    const requiredSections = [
      '## What it checks',
      '## Why it matters',
      '## How to fix',
      '## When to suppress',
      '## Rule metadata',
    ]

    for (const ruleId of indexLintRuleIds) {
      const rule = indexLintRules[ruleId]
      const file = join(docsRoot, `${rule.docsSlug}.mdx`)

      expect(existsSync(file), `${rule.id} docs page is missing`).toBe(true)
      const source = readFileSync(file, 'utf8')

      expect(source).toContain(`title: ${rule.id}`)
      for (const section of requiredSections) {
        expect(source, `${rule.id} docs page is missing ${section}`).toContain(section)
      }
      expect(source).toContain(`Rule id: \`${rule.id}\``)
      expect(source).toContain(`Category: \`${rule.category}\``)
      expect(source).toContain(`Maturity: \`${rule.maturity}\``)
    }
  })

  it('keeps docs navigation aligned with every built-in rule page', () => {
    const docsRoot = join(process.cwd(), '../../apps/docs/content/docs/reference/crux-core/index-lints')
    const meta = JSON.parse(readFileSync(join(docsRoot, 'meta.json'), 'utf8')) as { readonly pages: readonly string[] }

    expect(meta.pages).toEqual(indexLintRuleIds.map((ruleId) => indexLintRules[ruleId].docsSlug))
  })
})
