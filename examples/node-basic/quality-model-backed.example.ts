/**
 * Model-backed Quality example.
 *
 * This file stays as `.example.ts` so the basic example remains token-free by
 * default. Rename it to `quality-model-backed.eval.ts` when you want the CLI
 * to discover and run it, then record cassettes with `--replay record-new`.
 *
 * @module
 */

import { prompt } from '@use-crux/core'
import { evaluate, target } from '@use-crux/core/quality'
import { z } from 'zod'
import { createQualityModelRuntime } from './quality-models'

const supportAnswer = prompt({
  id: 'examples.support-answer',
  input: z.object({ question: z.string() }),
  output: z.object({ answer: z.string() }),
  system: 'Answer support questions in one concise sentence.',
  prompt: ({ input }) => input.question,
})

const qualityRuntime = createQualityModelRuntime()

export default evaluate('examples.model-backed-support-answer', {
  task: target.prompt(supportAnswer, {
    generate: qualityRuntime.generate,
    model: qualityRuntime.model,
  }),
  data: [
    {
      name: 'refund answer',
      input: { question: 'How do refunds work?' },
    },
  ],
  replay: { mode: 'record-new', cassette: 'node-basic-support-answer' },
  expect: (ctx) => {
    ctx.expect(ctx.output.answer.length).toBeGreaterThan(0)
  },
})
