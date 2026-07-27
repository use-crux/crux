import { evaluate } from '@use-crux/core/eval'
import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'
import { createCruxRunId, createCruxSpanId, createCruxTraceId } from '@use-crux/core/observability'

const task = attachEvalTaskDescriptorForInternalUse(
  async (input: { question: string }) => input.question,
  {
    _tag: 'CruxEvalTaskDescriptor',
    identityEpoch: 2,
    operation: 'generate',
    adapterId: 'ai-sdk',
    capabilities: [],
    defaults: {},
    overrideKeys: [],
    projectIdentity: () => ({ reusable: true, fingerprintMaterial: { adapter: 'support-fixture-v1' } }),
    execute: async (input) => ({ output: (input as { question: string }).question }),
    projectOutput: (result) => result.output,
    projectResponse: (result) => ({
      runId: createCruxRunId(),
      _meta: { traceId: createCruxTraceId(), spanId: createCruxSpanId() },
      content: [], text: result.output, object: result.output, steps: [],
      finalStep: { content: [], text: result.output, finishReason: 'stop', responseId: 'support', modelId: 'fake', warnings: [] },
      messages: [], warnings: [],
    }),
  },
)

export default evaluate({
  task,
  cases: [{ id: 'refund', input: { question: 'Can I get a refund?' } }],
})
