import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { context, match, when } from '../../prompt/context'
import { contributor } from '../../prompt/contributor'
import { compilePrompt } from '../../resolver/compile'
import type { SkillEntry } from '../../prompt/context-types'
import type { AnyPromptConfig } from '../../prompt/prompt-types'

function fakeSkill(id: string): SkillEntry {
  return {
    _tag: 'Skill',
    id,
    description: `Skill ${id}`,
    instructions: `Do ${id} things.`,
    references: [],
    meta: { name: id, description: `Skill ${id}` },
    dump: () => `Do ${id} things.`,
  }
}

describe('resolver schema collection', () => {
  it('detects conflicts through when() wrappers', () => {
    const inner = context({
      id: 'inner',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `inner=${input.x}`,
    })
    const wrapper = context({
      id: 'wrapper',
      use: [inner],
      system: 'wrapper',
    })
    const sibling = context({
      id: 'sibling',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `sibling=${input.x}`,
    })

    expect(() =>
      compilePrompt({
        system: 'base',
        use: [when(() => true, wrapper), sibling],
      } satisfies AnyPromptConfig),
    ).toThrow(
      'Input key "x" is defined by both "inner" and "sibling". Context input keys must not overlap.',
    )
  })

  it('detects conflicts through match() branches', () => {
    const inner = context({
      id: 'inner',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `inner=${input.x}`,
    })
    const wrapper = context({
      id: 'wrapper',
      use: [inner],
      system: 'wrapper',
    })
    const sibling = context({
      id: 'sibling',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `sibling=${input.x}`,
    })

    expect(() =>
      compilePrompt({
        system: 'base',
        use: [match({ on: () => 'a', cases: { a: wrapper } }), sibling],
      } satisfies AnyPromptConfig),
    ).toThrow(
      'Input key "x" is defined by both "inner" and "sibling". Context input keys must not overlap.',
    )
  })

  it('merges nested use schemas under conditional wrappers as optional', () => {
    const inner = context({
      id: 'inner',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `inner=${input.x}`,
    })
    const wrapper = context({
      id: 'wrapper',
      use: [inner],
      system: 'wrapper',
    })

    const compiled = compilePrompt({
      system: 'base',
      use: [when(() => true, wrapper)],
    } satisfies AnyPromptConfig)

    expect(compiled.inputSchema?.safeParse({}).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ x: 'value' }).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ x: 42 }).success).toBe(false)
  })

  it('merges nested use schemas under match branches as optional', () => {
    const inner = context({
      id: 'inner',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `inner=${input.x}`,
    })
    const wrapper = context({
      id: 'wrapper',
      use: [inner],
      system: 'wrapper',
    })

    const compiled = compilePrompt({
      system: 'base',
      use: [match({ on: () => 'a', cases: { a: wrapper } })],
    } satisfies AnyPromptConfig)

    expect(compiled.inputSchema?.safeParse({}).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ x: 'value' }).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ x: 42 }).success).toBe(false)
  })

  it('keeps reused context fields required when any path is required', () => {
    const shared = context({
      input: z.object({ x: z.string() }),
      system: ({ input }) => `shared=${input.x}`,
    })

    const compiled = compilePrompt({
      system: 'base',
      use: [when(() => true, shared), shared],
    } satisfies AnyPromptConfig)

    expect(compiled.inputSchema?.safeParse({}).success).toBe(false)
    expect(compiled.inputSchema?.safeParse({ x: 'value' }).success).toBe(true)
  })

  it('context reused across match branches is not a self-conflict', () => {
    const shared = context({
      input: z.object({ x: z.string() }),
      system: ({ input }) => `shared=${input.x}`,
    })

    expect(() =>
      compilePrompt({
        system: 'base',
        use: [match({ on: () => 'a', cases: { a: shared, b: shared } })],
      } satisfies AnyPromptConfig),
    ).not.toThrow()
  })

  it('positional labels stable with falsy and primitive entries in use array', () => {
    const first = context({
      input: z.object({ x: z.string() }),
      system: ({ input }) => `first=${input.x}`,
    })
    const second = context({
      input: z.object({ x: z.string() }),
      system: ({ input }) => `second=${input.x}`,
    })

    expect(() =>
      compilePrompt({
        system: 'base',
        use: [false, fakeSkill('slot-skill'), first, null, second],
      } satisfies AnyPromptConfig),
    ).toThrow(
      'Input key "x" is defined by both "context[2]" and "context[4]". Context input keys must not overlap.',
    )
  })

  it('merges contributor nested use schemas under gated paths as optional', () => {
    const inner = context({
      id: 'inner',
      input: z.object({ x: z.string() }),
      system: ({ input }) => `inner=${input.x}`,
    })
    const bundled = contributor({
      id: 'bundle',
      input: z.object({ enabled: z.boolean() }),
      when: (input) => input.enabled,
      use: [inner],
      contribute: () => ({}),
    })

    const compiled = compilePrompt({
      system: 'base',
      use: [bundled],
    } satisfies AnyPromptConfig)

    expect(compiled.inputSchema?.safeParse({}).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ enabled: true, x: 'value' }).success).toBe(true)
    expect(compiled.inputSchema?.safeParse({ enabled: 'yes', x: 'value' }).success).toBe(false)
    expect(compiled.inputSchema?.safeParse({ enabled: true, x: 42 }).success).toBe(false)
  })
})
