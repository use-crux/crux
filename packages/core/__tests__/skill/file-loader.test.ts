import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'fs'
import { join } from 'path'
import { fileSkill } from '../../skill/file-loader'
import { SkillLoadError } from '../../skill/types'

const TEST_DIR = join(__dirname, '__fixtures__')
const SKILL_DIR = join(TEST_DIR, 'test-skill')
const SKILL_FILE = join(SKILL_DIR, 'SKILL.md')
const REFS_DIR = join(SKILL_DIR, 'references')

beforeAll(() => {
  // Create test fixture directory structure
  mkdirSync(REFS_DIR, { recursive: true })

  writeFileSync(
    SKILL_FILE,
    `---
name: test-skill
description: A test skill for unit tests
version: 2.0.0
license: Apache-2.0
tags: testing, unit
---

# Test Skill

These are the instructions for the test skill.

## Usage

Follow these steps:
1. Do this
2. Do that
`,
  )

  writeFileSync(join(REFS_DIR, 'patterns.md'), '# Common Patterns\n\nPattern content here.')
  writeFileSync(join(REFS_DIR, 'examples.md'), '# Examples\n\nExample content here.')
  writeFileSync(join(REFS_DIR, 'not-markdown.txt'), 'This should be ignored.')
})

afterAll(() => {
  rmSync(TEST_DIR, { recursive: true, force: true })
})

describe('fileSkill()', () => {
  it('loads a SKILL.md file with correct metadata', () => {
    const s = fileSkill(SKILL_FILE)

    expect(s._tag).toBe('Skill')
    expect(s.id).toBe('test-skill')
    expect(s.description).toBe('A test skill for unit tests')
    expect(s.meta.version).toBe('2.0.0')
    expect(s.meta.license).toBe('Apache-2.0')
    expect(s.meta.tags).toEqual(['testing', 'unit'])
  })

  it('parses the instruction body correctly (without frontmatter)', () => {
    const s = fileSkill(SKILL_FILE)

    expect(s.instructions).toContain('# Test Skill')
    expect(s.instructions).toContain('These are the instructions')
    expect(s.instructions).not.toContain('---')
    expect(s.instructions).not.toContain('name: test-skill')
  })

  it('dump() returns the instruction body only', () => {
    const s = fileSkill(SKILL_FILE)

    expect(s.dump()).toBe(s.instructions)
    expect(s.dump()).not.toContain('---')
  })

  it('discovers reference files from references/ directory', () => {
    const s = fileSkill(SKILL_FILE)

    expect(s.references).toHaveLength(2)
    const refNames = s.references.map((r) => r.name).sort()
    expect(refNames).toEqual(['examples', 'patterns'])
  })

  it('loads reference content correctly', () => {
    const s = fileSkill(SKILL_FILE)

    const patterns = s.references.find((r) => r.name === 'patterns')
    expect(patterns).toBeDefined()
    expect(patterns!.content).toContain('# Common Patterns')
  })

  it('ignores non-.md files in references/', () => {
    const s = fileSkill(SKILL_FILE)

    const names = s.references.map((r) => r.name)
    expect(names).not.toContain('not-markdown')
  })

  it('returns frozen object', () => {
    const s = fileSkill(SKILL_FILE)
    expect(Object.isFrozen(s)).toBe(true)
  })

  it('throws SkillLoadError for missing file', () => {
    expect(() => fileSkill('/nonexistent/path/SKILL.md')).toThrow(SkillLoadError)
    expect(() => fileSkill('/nonexistent/path/SKILL.md')).toThrow('could not read file')
  })

  it('works with skills that have no references/ directory', () => {
    const noRefsDir = join(TEST_DIR, 'no-refs-skill')
    mkdirSync(noRefsDir, { recursive: true })
    writeFileSync(
      join(noRefsDir, 'SKILL.md'),
      `---
name: simple
description: A simple skill
---

Just instructions.`,
    )

    const s = fileSkill(join(noRefsDir, 'SKILL.md'))
    expect(s.references).toHaveLength(0)
    expect(s.instructions).toBe('Just instructions.')
  })
})
