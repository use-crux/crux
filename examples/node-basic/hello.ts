import { openai } from '@ai-sdk/openai'
import { generate } from '@crux/ai'
import { prompt } from '@crux/core'
import { z } from 'zod'

const classify = prompt({
  id: 'classify',
  input: z.object({ text: z.string() }),
  output: z.object({
    sentiment: z.enum(['positive', 'negative', 'neutral']),
  }),
  system: 'Classify the sentiment of the given text.',
  prompt: ({ input }) => input.text,
})

const result = await generate(classify, {
  model: openai('gpt-4o'),
  input: { text: 'This is incredible.' },
})

console.log(result.object.sentiment)
