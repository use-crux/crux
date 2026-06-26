import { createPrompts, prompt } from '@use-crux/core'
import type { Context } from '@use-crux/core'

declare const missingContext: Context

export const answer = prompt({
  id: 'support.answer',
  use: [missingContext],
  system: 'Answer customer support questions.',
  tests: [{ name: 'refund question', input: { question: 'How do refunds work?' } }],
})

export const prompts = createPrompts({
  support: {
    answer,
  },
})
