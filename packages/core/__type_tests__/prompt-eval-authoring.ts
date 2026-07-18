import { z } from 'zod'

import { prompt } from '../src/prompt'

prompt({
  id: 'evals-live-separately',
  input: z.object({ q: z.string() }),
  prompt: ({ input }) => input.q,
  // @ts-expect-error — prompt evaluation is authored with evaluate(), never a second inline tests API.
  tests: [{ input: { q: 'hello' } }],
})
