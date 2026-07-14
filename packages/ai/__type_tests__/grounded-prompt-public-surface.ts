import type { LanguageModel } from 'ai'
import { context, prompt } from '@use-crux/core'
import { z } from 'zod'
import { grounding, type Retriever } from '@use-crux/core/retrieval'
import { generate } from '../src'

declare const model: LanguageModel
declare const retriever: Retriever

const docsGrounding = grounding({
  id: 'docs',
  retriever,
  query: 'How does Crux work?',
})
const grounded = prompt({
  id: 'grounded-public-surface',
  use: [docsGrounding] as const,
  prompt: 'Answer from the documentation.',
})

void generate(grounded, { model })

const locale = context({
  id: 'locale',
  input: z.object({ locale: z.enum(['en', 'nl']) }),
  system: ({ input }) => `Answer in ${input.locale}.`,
})
const groundedWithInput = prompt({
  use: [locale, docsGrounding, false, null] as const,
  prompt: 'Answer from the documentation.',
})

void generate(groundedWithInput, { model, input: { locale: 'en' } })
// @ts-expect-error - required context input remains required through the AI overload.
void generate(groundedWithInput, { model })
