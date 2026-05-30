import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../../skill/frontmatter'
import { SkillLoadError } from '../../skill/types'

describe('parseFrontmatter()', () => {
  it('parses valid frontmatter with name and description', () => {
    const raw = `---
name: seo-analysis
description: Analyze and optimize content for search engines
---

# SEO Analysis

Instructions here.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.name).toBe('seo-analysis')
    expect(result.meta.description).toBe('Analyze and optimize content for search engines')
    expect(result.body).toBe('# SEO Analysis\n\nInstructions here.')
  })

  it('parses optional version and license fields', () => {
    const raw = `---
name: test
description: Test skill
version: 1.2.3
license: Apache-2.0
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.version).toBe('1.2.3')
    expect(result.meta.license).toBe('Apache-2.0')
  })

  it('parses tags as comma-separated values', () => {
    const raw = `---
name: test
description: Test
tags: seo, writing, analysis
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.tags).toEqual(['seo', 'writing', 'analysis'])
  })

  it('parses tags in YAML array syntax', () => {
    const raw = `---
name: test
description: Test
tags: ['seo', 'writing']
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.tags).toEqual(['seo', 'writing'])
  })

  it('ignores IDE-specific fields', () => {
    const raw = `---
name: test
description: Test
allowed-tools: Read, Write, Edit
model: haiku
argument-hint: <query>
user-invocable: true
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.name).toBe('test')
    expect(result.meta.description).toBe('Test')
    // No error thrown — unknown fields are silently ignored
  })

  it('handles quoted values', () => {
    const raw = `---
name: "my-skill"
description: 'A skill with special: characters'
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.name).toBe('my-skill')
    expect(result.meta.description).toBe('A skill with special: characters')
  })

  it('throws SkillLoadError for missing frontmatter', () => {
    const raw = `# Just Markdown

No frontmatter here.`

    expect(() => parseFrontmatter(raw, 'test')).toThrow(SkillLoadError)
    expect(() => parseFrontmatter(raw, 'test')).toThrow('YAML frontmatter')
  })

  it('throws SkillLoadError for missing name', () => {
    const raw = `---
description: Has description but no name
---

Body.`

    expect(() => parseFrontmatter(raw, 'test')).toThrow(SkillLoadError)
    expect(() => parseFrontmatter(raw, 'test')).toThrow('name')
  })

  it('throws SkillLoadError for missing description', () => {
    const raw = `---
name: test
---

Body.`

    expect(() => parseFrontmatter(raw, 'test')).toThrow(SkillLoadError)
    expect(() => parseFrontmatter(raw, 'test')).toThrow('description')
  })

  it('handles empty body after frontmatter', () => {
    const raw = `---
name: test
description: Test
---
`

    const result = parseFrontmatter(raw, 'test')
    expect(result.body).toBe('')
  })

  it('handles comments in frontmatter', () => {
    const raw = `---
name: test
# This is a comment
description: Test skill
---

Body.`

    const result = parseFrontmatter(raw, 'test')
    expect(result.meta.name).toBe('test')
    expect(result.meta.description).toBe('Test skill')
  })
})
