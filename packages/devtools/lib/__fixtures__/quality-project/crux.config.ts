import { config, prompt } from '@crux/core'

/** Rung-0 colocated tests — lowered to `prompt:fixture.greeter` at collect. */
const greeter = prompt({
  id: 'fixture.greeter',
  system: 'You greet people.',
  tests: [{ input: { q: 'hi' } }, { input: { q: 'hallo' } }],
})

export default config({
  prompts: [greeter],
  quality: {
    id: 'fixture-quality',
    include: 'evals/**/*.eval.ts',
  },
})
