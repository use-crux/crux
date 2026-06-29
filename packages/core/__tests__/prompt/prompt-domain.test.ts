/**
 * Characterization tests for the **prompt authoring domain barrel** (`../prompt`).
 *
 * Phase 2 of the Core structure refactor moves the prompt/context authoring
 * primitives out of root files (`define.ts`, `context.ts`, …) into the
 * `prompt/` domain. Other Core domains now import these primitives from the
 * `../prompt` barrel rather than from individual files. This suite is the
 * intra-package contract for that barrel: it must stay green when later phases
 * shuffle files *within* `prompt/`.
 *
 * It imports through the domain barrel (not individual files) and exercises a
 * representative behavior of each authoring entry point end to end. Type-level
 * coverage of the same barrel lives in `__type_tests__/prompt-domain-imports.ts`.
 */

import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import {
  prompt,
  context,
  createContexts,
  createPrompts,
  when,
  match,
  injectable,
  isInjectableEntry,
  contributor,
  isContributorEntry,
} from '../../prompt'

describe('prompt domain barrel (../prompt)', () => {
  it('exposes the documented authoring entry points', () => {
    for (const fn of [prompt, context, createContexts, createPrompts, when, match, injectable, contributor]) {
      expect(typeof fn).toBe('function')
    }
  })

    it('prompt() composes context system text through the domain barrel', async () => {
    const brand = context({
      id: 'brand',
      input: z.object({ brand: z.string() }),
      system: ({ input }) => `Brand: ${input.brand}`,
    })

    const answer = prompt({
      id: 'answer',
      use: [brand],
      input: z.object({ question: z.string() }),
      system: 'You are helpful.',
      prompt: ({ input }) => input.question,
    })

    const resolved = await answer.resolve({ input: { question: 'Hi?', brand: 'Acme' } })
    expect(resolved.system).toBe('You are helpful.\n\nBrand: Acme')
    expect(resolved.prompt).toBe('Hi?')
  })

    it('when()/match() gate context contributions', async () => {
    const onlyEn = when(
      (input: { locale: string }) => input.locale === 'en',
      context({ id: 'en', system: 'Answer in English.' }),
    )
    const branched = match({
      on: (input: { mode: string }) => input.mode,
      cases: { terse: context({ id: 'terse', system: 'Be terse.' }) },
      default: context({ id: 'verbose', system: 'Be verbose.' }),
    })

    const p = prompt({ id: 'gated', use: [onlyEn, branched], system: 'Base.', prompt: () => 'go' })

    const en = await p.resolve({ input: { locale: 'en', mode: 'terse' } })
    expect(en.system).toBe('Base.\n\nAnswer in English.\n\nBe terse.')

    const fr = await p.resolve({ input: { locale: 'fr', mode: 'other' } })
    expect(fr.system).toBe('Base.\n\nBe verbose.')
  })

    it('createPrompts()/createContexts() build addressable trees', () => {
    const ctxTree = createContexts({ tone: context({ id: 'tone', system: 'Friendly.' }) })
    expect(ctxTree.tone.id).toBe('tone')

    const promptTree = createPrompts({ greet: prompt({ id: 'greet', system: 'Hi.', prompt: () => 'hi' }) })
    expect(promptTree.greet.id).toBe('greet')
  })

    it('injectable()/contributor() produce recognizable use-entries', () => {
    const inj = injectable({ id: 'inj', inject: () => ({ metadata: { from: 'inj' } }) })
    expect(isInjectableEntry(inj)).toBe(true)

    const contrib = contributor({ id: 'contrib', contribute: () => ({ metadata: { from: 'contrib' } }) })
    expect(isContributorEntry(contrib)).toBe(true)
    // A contributor is structurally also an injectable entry.
    expect(isInjectableEntry(contrib)).toBe(true)
  })
})
