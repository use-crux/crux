import { caseFile, evaluate } from '@use-crux/core/eval'
import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'
import { createCruxRunId } from '@use-crux/core/observability'
import { z } from 'zod'

const inputSchema = z.object({ question: z.string() })

const task = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: 'CruxEvalTaskDescriptor',
    operation: 'generate',
    adapterId: 'ai-sdk',
    inputSchema,
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({ reusable: true, fingerprintMaterial: { adapter: 'fixture-v1' } }),
    execute: async (input) => ({ output: (input as { question: string }).question }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
      content: [],
      text: result.output,
      object: result.output,
      steps: [],
      finalStep: {
        content: [],
        text: result.output,
        finishReason: 'stop',
        responseId: 'fixture-response',
        modelId: 'fixture-model',
        warnings: [],
      },
      messages: [],
      warnings: [],
    }),
  },
)

export default evaluate({
  task,
  cases: [
    { id: 'hello', input: { question: 'hello' } },
    caseFile('./fixtures/managed.json', { input: inputSchema }),
  ],
  expect: ({ output, expect: assert }) => assert(output).toBe('hello'),
})
