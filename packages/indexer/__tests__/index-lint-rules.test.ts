import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { indexLintRuleIds, indexLintRules } from '../indexer/index-lint-rules'

describe('index lint rule registry', () => {
  it('owns product metadata needed by all lint surfaces', () => {
    expect(Object.keys(indexLintRules).sort()).toEqual([...indexLintRuleIds].sort())

    for (const ruleId of indexLintRuleIds) {
      const rule = indexLintRules[ruleId]

      expect(rule.id).toBe(ruleId)
      expect(rule.title.trim()).not.toBe('')
      expect(rule.rationale.trim()).not.toBe('')
      expect(rule.docsSlug).toMatch(/^[a-z0-9-]+$/)
      expect(rule.profiles.length).toBeGreaterThan(0)
      expect(rule.fixes.length).toBeGreaterThan(0)
      expect(rule.fixes.every((fix) => fix.description.trim().length > 0)).toBe(true)
      expect(rule.suppression.scope).toMatch(/^(next-line|line|file)$/)
    }
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
})
