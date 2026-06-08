import { describe, it, expect, beforeEach } from 'vitest'
import { skill, SkillLoadError } from '../../skill/index'
import { generateIndex } from '../../skill/project-index'
import {
  createSkillState,
  createLoadSkillTool,
  createLoadReferenceTool,
  LOAD_SKILL_TOOL_NAME,
  LOAD_REFERENCE_TOOL_NAME,
} from '../../skill/tools'
import { flattenContextEntries } from '../../resolve'
import type { ContextEntry } from '../../types'
import { context } from '../../context'
import { setTokenizer } from '../../tokenizer'

// Use a simple 1-char-per-token tokenizer for deterministic tests
beforeEach(() => {
  setTokenizer((text: string) => text.length)
})

// ─────────────────────────────────────────────────────────────────
// skill.inline()
// ─────────────────────────────────────────────────────────────────

describe('skill.inline()', () => {
  it('creates a frozen Skill object with correct properties', () => {
    const s = skill.inline({
      id: 'test-skill',
      description: 'A test skill',
      instructions: 'Do the thing.',
    })

    expect(s._tag).toBe('Skill')
    expect(s.id).toBe('test-skill')
    expect(s.description).toBe('A test skill')
    expect(s.instructions).toBe('Do the thing.')
    expect(s.references).toEqual([])
    expect(s.meta.name).toBe('test-skill')
    expect(s.meta.description).toBe('A test skill')
    expect(Object.isFrozen(s)).toBe(true)
  })

  it('dump() returns the raw instruction text', () => {
    const s = skill.inline({
      id: 'test',
      description: 'Test',
      instructions: 'These are the instructions.',
    })

    expect(s.dump()).toBe('These are the instructions.')
  })

  it('supports inline references', () => {
    const s = skill.inline({
      id: 'test',
      description: 'Test',
      instructions: 'Main content.',
      references: {
        patterns: 'Pattern reference content',
        examples: 'Example reference content',
      },
    })

    expect(s.references).toHaveLength(2)
    expect(s.references[0]!.name).toBe('patterns')
    expect(s.references[0]!.content).toBe('Pattern reference content')
    expect(s.references[1]!.name).toBe('examples')
    expect(s.references[1]!.content).toBe('Example reference content')
  })

  it('throws SkillLoadError for missing id', () => {
    expect(() => skill.inline({ id: '', description: 'Test', instructions: 'Content' })).toThrow(SkillLoadError)
  })

  it('throws SkillLoadError for missing description', () => {
    expect(() => skill.inline({ id: 'test', description: '', instructions: 'Content' })).toThrow(SkillLoadError)
  })

  it('throws SkillLoadError for missing instructions', () => {
    expect(() => skill.inline({ id: 'test', description: 'Test', instructions: '' })).toThrow(SkillLoadError)
  })
})

// ─────────────────────────────────────────────────────────────────
// Index generation
// ─────────────────────────────────────────────────────────────────

describe('generateIndex()', () => {
  it('generates a index with skill names and descriptions', () => {
    const s1 = skill.inline({ id: 'seo', description: 'SEO analysis', instructions: '...' })
    const s2 = skill.inline({ id: 'tone', description: 'Tone guidelines', instructions: '...' })

    const index = generateIndex([s1, s2])

    expect(index).toContain('## Skills')
    expect(index).toContain('**seo**: SEO analysis')
    expect(index).toContain('**tone**: Tone guidelines')
    expect(index).toContain('LoadSkill(name)')
    expect(index).toContain('LoadReference(skillName, referenceName)')
  })

  it('returns empty string for no skills', () => {
    expect(generateIndex([])).toBe('')
  })

  it('includes reference names when skill has references', () => {
    const s = skill.inline({
      id: 'research',
      description: 'Research skills',
      instructions: '...',
      references: { sources: 'Source list', methods: 'Research methods' },
    })

    const index = generateIndex([s])
    expect(index).toContain('references: sources, methods')
  })
})

// ─────────────────────────────────────────────────────────────────
// Skill tools
// ─────────────────────────────────────────────────────────────────

describe('LoadSkill tool', () => {
  it('marks skill as active on execute', async () => {
    const s = skill.inline({ id: 'seo', description: 'SEO', instructions: 'SEO instructions' })
    const state = createSkillState([s])
    const tool = createLoadSkillTool(state)

    expect(state.active.size).toBe(0)
    const result = await tool.execute({ name: 'seo' })
    expect(state.active.has('seo')).toBe(true)
    expect(result).toContain('loaded successfully')
  })

  it('returns error for unknown skill', async () => {
    const s = skill.inline({ id: 'seo', description: 'SEO', instructions: '...' })
    const state = createSkillState([s])
    const tool = createLoadSkillTool(state)

    const result = await tool.execute({ name: 'nonexistent' })
    expect(result).toContain('not found')
    expect(result).toContain('seo')
  })
})

describe('LoadReference tool', () => {
  it('returns reference content for valid reference', async () => {
    const s = skill.inline({
      id: 'seo',
      description: 'SEO',
      instructions: '...',
      references: { keywords: 'Keyword research guide' },
    })
    const state = createSkillState([s])
    const tool = createLoadReferenceTool(state)

    const result = await tool.execute({ skillName: 'seo', referenceName: 'keywords' })
    expect(result).toBe('Keyword research guide')
  })

  it('returns error for unknown skill', async () => {
    const state = createSkillState([])
    const tool = createLoadReferenceTool(state)

    const result = await tool.execute({ skillName: 'nope', referenceName: 'any' })
    expect(result).toContain('not found')
  })

  it('returns error for unknown reference', async () => {
    const s = skill.inline({
      id: 'seo',
      description: 'SEO',
      instructions: '...',
      references: { keywords: 'Guide' },
    })
    const state = createSkillState([s])
    const tool = createLoadReferenceTool(state)

    const result = await tool.execute({ skillName: 'seo', referenceName: 'nonexistent' })
    expect(result).toContain('not found')
    expect(result).toContain('keywords')
  })
})

// ─────────────────────────────────────────────────────────────────
// Resolution pipeline integration
// ─────────────────────────────────────────────────────────────────

describe('flattenContextEntries with skills', () => {
  it('extracts skills into separate array', () => {
    const s = skill.inline({ id: 'test', description: 'Test', instructions: 'Do something.' })
    const ctx = context({ id: 'regular', system: 'Regular context' })

    const entries: ContextEntry[] = [s, ctx]
    const result = flattenContextEntries(entries, {})

    expect(result.skills).toHaveLength(1)
    expect(result.skills[0]!.id).toBe('test')
  })

  it('separates skills from contexts without generating index', () => {
    // Index generation moved to resolvePrompt (async, handles registry fetch)
    const s = skill.inline({ id: 'seo', description: 'SEO analysis', instructions: 'Analyze SEO.' })
    const entries: ContextEntry[] = [s]
    const result = flattenContextEntries(entries, {})

    // Skills are extracted, no index context generated (that happens in resolvePrompt)
    expect(result.skills).toHaveLength(1)
    expect(result.active).toHaveLength(0) // no contexts, just the skill
  })

  it('does not extract skills when none present', () => {
    const ctx = context({ id: 'regular', system: 'Regular' })
    const entries: ContextEntry[] = [ctx]
    const result = flattenContextEntries(entries, {})

    expect(result.skills).toHaveLength(0)
    expect(result.active[0]!.id).toBe('regular')
  })

  it('works with mixed skills and contexts', () => {
    const s1 = skill.inline({ id: 'skill1', description: 'First skill', instructions: '...' })
    const s2 = skill.inline({ id: 'skill2', description: 'Second skill', instructions: '...' })
    const ctx = context({ id: 'regular', system: 'Regular' })

    const entries: ContextEntry[] = [s1, ctx, s2]
    const result = flattenContextEntries(entries, {})

    expect(result.skills).toHaveLength(2)
    // Only the regular context in active (index generated later in resolvePrompt)
    expect(result.active).toHaveLength(1)
    expect(result.active[0]!.id).toBe('regular')
  })

  it('handles falsy entries alongside skills', () => {
    const s = skill.inline({ id: 'test', description: 'Test', instructions: '...' })
    const entries: ContextEntry[] = [null, s, false, undefined]
    const result = flattenContextEntries(entries, {})

    expect(result.skills).toHaveLength(1)
    expect(result.active).toHaveLength(0) // no contexts
  })
})
