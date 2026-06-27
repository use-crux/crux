import { config, prompt } from '@use-crux/core'

/** Rung-0 colocated tests — lowered to `prompt:fixture.greeter` at collect. */
export const greeter = prompt({
  id: 'fixture.greeter',
  system: 'You greet people.',
  tests: [{ input: { q: 'hi' } }, { input: { q: 'hallo' } }],
})

export default config({
  quality: {
    id: 'fixture-quality',
    include: 'evals/**/*.eval.ts',
  },
})
