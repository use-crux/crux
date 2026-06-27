import { prompt } from '@use-crux/core'
import { evaluate } from '@use-crux/core/quality'
import { z } from 'zod'

const implicitPrompt = prompt({
  id: 'fixture.implicit-model',
  input: z.object({ question: z.string() }),
  system: 'Answer the question.',
})

export default evaluate('evals.implicit-model', {
  task: implicitPrompt,
  data: [{ input: { question: 'Should project setup be used implicitly?' } }],
})
