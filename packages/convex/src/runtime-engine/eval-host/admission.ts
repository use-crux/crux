import type { EvalHostAdmissionPort, EvalHostAdmissionResult } from '@use-crux/core/runtime/internal/eval-host'
import { decodeCompositeValue } from '../codec'

/** Create the adapter-native atomic Eval admission bridge. */
export function createConvexEvalHostAdmission(options: {
  readonly ref: unknown
  readonly run: <TResult>(ref: unknown, args: Record<string, unknown>) => Promise<TResult>
}): EvalHostAdmissionPort {
  const port: EvalHostAdmissionPort = {
    async admit(input): Promise<EvalHostAdmissionResult> {
      const result = await options.run<unknown>(options.ref, {
        namespace: input.namespace,
        workId: input.workId,
        job: input.job,
        maxConcurrentJobs: input.maxConcurrentJobs,
        now: input.now.getTime(),
      })
      return decodeCompositeValue<EvalHostAdmissionResult>(result)
    },
  }
  return Object.freeze(port)
}
