import { describe, it, expect, beforeEach } from 'vitest'
import { createSkillActivationSession, skill, SkillLoadError } from '../../skill/index'
import { generateIndex } from '../../skill/project-index'
import { LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME } from '../../skill/tools'
import { compilePrompt } from '../../resolver/compile'
import type { AnyPromptConfig, ContextEntry } from '../../types'
import { context } from '../../prompt/context'
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
    const session = createSkillActivationSession({ skills: [s] })
    const tool = session.tools()[LOAD_SKILL_TOOL_NAME] as {
      execute: (args: Record<string, unknown>) => Promise<string>
    }

    expect(session.activeIds()).toEqual([])
    const result = await tool.execute({ name: 'seo' })
    expect(session.activeIds()).toEqual(['seo'])
    expect(result).toContain('loaded successfully')
  })

  it('returns error for unknown skill', async () => {
    const s = skill.inline({ id: 'seo', description: 'SEO', instructions: '...' })
    const session = createSkillActivationSession({ skills: [s] })
    const tool = session.tools()[LOAD_SKILL_TOOL_NAME] as {
      execute: (args: Record<string, unknown>) => Promise<string>
    }

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
    const session = createSkillActivationSession({ skills: [s] })
    const tool = session.tools()[LOAD_REFERENCE_TOOL_NAME] as {
      execute: (args: Record<string, unknown>) => Promise<string>
    }

    const result = await tool.execute({ skillName: 'seo', referenceName: 'keywords' })
    expect(result).toBe('Keyword research guide')
  })

  it('returns error for unknown skill', async () => {
    const session = createSkillActivationSession({ skills: [] })
    const tool = session.tools()[LOAD_REFERENCE_TOOL_NAME] as {
      execute: (args: Record<string, unknown>) => Promise<string>
    }

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
    const session = createSkillActivationSession({ skills: [s] })
    const tool = session.tools()[LOAD_REFERENCE_TOOL_NAME] as {
      execute: (args: Record<string, unknown>) => Promise<string>
    }

    const result = await tool.execute({ skillName: 'seo', referenceName: 'nonexistent' })
    expect(result).toContain('not found')
    expect(result).toContain('keywords')
  })
})

// ─────────────────────────────────────────────────────────────────
// Resolution pipeline integration
// ─────────────────────────────────────────────────────────────────

describe('skill entries through the resolution pipeline', () => {
  const inspect = (use: readonly ContextEntry[], input: Record<string, unknown> = {}) =>
    compilePrompt({ system: 'S', use } as AnyPromptConfig).inspect({ input })

  it('skills produce the index context and loader tools', async () => {
    const s = skill.inline({ id: 'test', description: 'Test', instructions: 'Do something.' })
    const ctx = context({ id: 'regular', system: 'Regular context' })

    const result = await inspect([s, ctx])
    expect(result.system.parts.map((p) => p.source)).toEqual([
      'prompt',
      'context:__crux_skill_index',
      'context:regular',
    ])
    expect(result.tools).toEqual(expect.arrayContaining([LOAD_SKILL_TOOL_NAME, LOAD_REFERENCE_TOOL_NAME]))
  })

  it('the generated index lists every skill', async () => {
    const s1 = skill.inline({ id: 'skill1', description: 'First skill', instructions: '...' })
    const s2 = skill.inline({ id: 'skill2', description: 'Second skill', instructions: '...' })

    const result = await inspect([s1, context({ id: 'regular', system: 'Regular' }), s2])
    const index = result.system.parts.find((p) => p.source === 'context:__crux_skill_index')
    expect(index?.text).toContain('skill1')
    expect(index?.text).toContain('skill2')
  })

  it('no index context or loader tools when no skills are present', async () => {
    const result = await inspect([context({ id: 'regular', system: 'Regular' })])
    expect(result.system.parts.map((p) => p.source)).toEqual(['prompt', 'context:regular'])
    expect(result.tools).toBeUndefined()
  })

  it('handles falsy entries alongside skills', async () => {
    const s = skill.inline({ id: 'test', description: 'Test', instructions: '...' })
    const result = await inspect([null, s, false, undefined])
    expect(result.system.parts.map((p) => p.source)).toEqual(['prompt', 'context:__crux_skill_index'])
  })
})
