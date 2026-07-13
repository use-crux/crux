/**
 * Compile-time checks for native AI SDK ModelMessage inputs.
 */

import type { LanguageModel, ModelMessage } from 'ai'
import { z } from 'zod'
import { prompt } from '@use-crux/core'
import { generate, stream } from '../src'

declare const model: LanguageModel

const multimodalPrompt = prompt({
  id: 'ai-native-model-messages',
  input: z.object({ requestId: z.string() }),
  prompt: ({ input }) => `Continue ${input.requestId}.`,
})

const nativeMessages = [
  {
    role: 'user',
    content: [
      { type: 'text', text: 'Describe this file.' },
      {
        type: 'file',
        data: 'data:application/pdf;base64,JVBERi0x',
        mediaType: 'application/pdf',
        filename: 'report.pdf',
        providerOptions: { openai: { fileId: 'file_123' } },
      },
    ],
    providerOptions: { openai: { store: false } },
  },
] satisfies readonly ModelMessage[]

void generate(multimodalPrompt, {
  model,
  input: { requestId: 'req_1' },
  messages: nativeMessages,
})

void stream(multimodalPrompt, {
  model,
  input: { requestId: 'req_1' },
  messages: nativeMessages,
})

// @ts-expect-error - prompt input is still required when native messages are supplied.
void generate(multimodalPrompt, {
  model,
  messages: nativeMessages,
})

const removedPartType = `me${'dia'}` as const
const removedCompatibilityMessages = [
  { role: 'user', content: [{ type: removedPartType, data: 'SGVsbG8=', mediaType: 'audio/mpeg' }] },
]
// @ts-expect-error - current AI SDK ModelMessage accepts file/image parts, not the removed compatibility part.
const rejectedCompatibilityMessages: readonly ModelMessage[] = removedCompatibilityMessages
void rejectedCompatibilityMessages
