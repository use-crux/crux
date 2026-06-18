import { createPrompts, prompt } from '@crux/core'
import { supportPolicy } from './contexts'

export const answer = prompt({
  id: 'support.answer',
  use: [supportPolicy],
  system: 'Answer customer support questions.',
  tests: [
    { name: 'refund question', input: { question: 'How do refunds work?' } },
    { name: 'status question', input: { question: 'Where is my order?' } },
  ],
})

export const prompts = createPrompts({
  support: {
    answer,
  },
})
