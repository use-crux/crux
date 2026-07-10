/**
 * Integration test — actually fetches a skill from skills.sh.
 * Skipped in CI (no network). Run manually with:
 *   pnpm --filter @use-crux/core test -- --run __tests__/skill/integration.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { resolveRegistrySkill } from '../../src/skill/registry'
import { clearCache } from '../../src/skill/cache'
import { parseFrontmatter } from '../../src/skill/frontmatter'

const SKIP = !process.env.TEST_INTEGRATION
const describeIntegration = SKIP ? describe.skip : describe

beforeEach(() => {
  clearCache()
})

describeIntegration('skills.sh integration (live API)', () => {
  it('fetches a real skill from skills.sh and parses it correctly', async () => {
    const result = await resolveRegistrySkill('skills.sh:mattpocock/skills/request-refactor-plan')

    // Metadata from frontmatter
    expect(result.meta.name).toBe('request-refactor-plan')
    expect(result.meta.description).toBeTruthy()
    expect(result.meta.description.length).toBeGreaterThan(10)

    // Body should have instructions
    expect(result.instructions).toBeTruthy()
    expect(result.instructions.length).toBeGreaterThan(100)
    expect(result.instructions).not.toContain('---') // frontmatter stripped

    // Should be valid Markdown
    expect(result.instructions).toContain('skill')
  }, 15000) // generous timeout for network

  it('caches after first fetch — second call does not hit network', async () => {
    const start1 = Date.now()
    const result1 = await resolveRegistrySkill('skills.sh:mattpocock/skills/request-refactor-plan')
    const elapsed1 = Date.now() - start1

    const start2 = Date.now()
    const result2 = await resolveRegistrySkill('skills.sh:mattpocock/skills/request-refactor-plan')
    const elapsed2 = Date.now() - start2

    // Cache hit should be near-instant (< 5ms vs hundreds for network)
    expect(elapsed2).toBeLessThan(elapsed1)
    expect(elapsed2).toBeLessThan(5)
    expect(result2.instructions).toBe(result1.instructions)
  }, 15000)

  it('frontmatter parser handles the live skill format', async () => {
    // Fetch raw content directly to test parser independently
    const resp = await fetch('https://skills.sh/api/download/mattpocock/skills/request-refactor-plan')
    const data = (await resp.json()) as { files: { path: string; contents: string }[] }
    const skillFile = data.files.find((f) => f.path.endsWith('SKILL.md'))

    expect(skillFile).toBeDefined()

    const { meta, body } = parseFrontmatter(skillFile!.contents, 'integration-test')
    expect(meta.name).toBe('request-refactor-plan')
    expect(meta.description).toBeTruthy()
    expect(body).not.toContain('---')
    expect(body.length).toBeGreaterThan(0)
  }, 15000)
})
