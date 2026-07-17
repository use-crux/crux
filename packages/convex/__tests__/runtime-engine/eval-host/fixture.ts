import { evaluate } from '@use-crux/core/eval'
import { attachEvalTaskDescriptorForInternalUse } from '@use-crux/core/eval/internal/task'
import { createCruxRunId } from '@use-crux/core/observability'
import {
  createDeployedEvalRegistry,
  fingerprintDeployedEvalCase,
  projectDeployedEvalVariants,
} from '@use-crux/core/runtime/internal/eval-registry'

export const TOKEN = 'convex-eval-capability-token-32-bytes'
export const NOW = new Date('2026-07-16T18:00:00.000Z')

/** Build one executable generated-registry fixture for Convex host tracers. */
export function fixtureRegistry(
  execute: (input: unknown) => Promise<{ output: unknown }> = async (input) => ({ output: input }),
) {
  const task = attachEvalTaskDescriptorForInternalUse(async (input: { message: string }) => input.message, {
    _tag: 'CruxEvalTaskDescriptor',
    operation: 'generate',
    adapterId: 'ai-sdk',
    capabilities: [],
    requiredHostCapabilities: [],
    defaults: { prompt: 'refund policy' },
    overrideKeys: [],
    projectIdentity: () => ({
      reusable: true,
      fingerprintMaterial: { adapter: 'convex-fixture-v1' },
    }),
    execute,
    projectOutput: (result) => result.output,
    projectResponse: () => ({
      runId: createCruxRunId(),
      content: [],
      text: '',
      steps: [],
      finalStep: {
        content: [],
        text: '',
        finishReason: 'stop',
        responseId: 'response-1',
        modelId: 'fixture',
        warnings: [],
      },
      messages: [],
      warnings: [],
    }),
  })
  const authored = {
    id: 'refund',
    input: { message: 'Refund please' },
  } as const
  const evalValue = evaluate({ id: 'support', task, cases: [authored] })
  return createDeployedEvalRegistry({
    entries: [
      {
        eval: evalValue,
        id: 'support',
        source: 'evals/support.eval.ts',
        evalFingerprint: 'eval-support-v1',
        cases: [
          {
            id: 'refund',
            fingerprint: fingerprintDeployedEvalCase('refund', authored),
            authored,
          },
        ],
        variants: projectDeployedEvalVariants(evalValue),
        requiredHostCapabilities: [],
        index: {
          id: 'support',
          source: 'evals/support.eval.ts',
          requiredHostCapabilities: [],
        },
      },
    ],
  })
}

/** Exact job request matching {@link fixtureRegistry}. */
export function jobBody(registry: ReturnType<typeof fixtureRegistry>) {
  const entry = registry.entries[0]!
  return {
    protocol: 'crux.eval-host.v1',
    jobId: 'job-support-refund-current-0',
    evalRunId: 'eval-run-1',
    evalId: entry.id,
    evalFingerprint: entry.evalFingerprint,
    caseId: entry.cases[0]!.id,
    caseFingerprint: entry.cases[0]!.fingerprint,
    variant: entry.variants[0]!.name,
    variantFingerprint: entry.variants[0]!.fingerprint,
    trial: 0,
    deadlineAt: '2026-07-16T19:00:00.000Z',
  } as const
}
