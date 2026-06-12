import { config, prompt } from '@crux/core'
import type { GenerateFn } from '@crux/core/quality'

/** Rung-0 colocated tests — lowered to `prompt:fixture.greeter` at collect. */
const greeter = prompt({
  id: 'fixture.greeter',
  system: 'You greet people.',
  tests: [{ input: { q: 'hi' } }, { input: { q: 'hallo' } }],
})

// Stub generate: the engine unwraps `.text` for text-mode prompts. The cast
// is unavoidable for stubs — GenerateFn's parameters are contravariant.
const stubGenerate = (async () => ({ text: 'hello from the stub' })) as unknown as GenerateFn

export default config({
  prompts: [greeter],
  quality: {
    id: 'fixture-quality',
    include: 'evals/**/*.eval.ts',
    setup: async () => ({ generate: stubGenerate }),
  },
})
