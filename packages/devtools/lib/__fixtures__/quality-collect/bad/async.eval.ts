import { evaluate } from '@crux/core/quality/api'

/** Exporting a promise of an Evaluation is a collect-time definition error. */
export default Promise.resolve(
  evaluate({
    task: (input: string) => input,
    data: [{ input: 'late' }],
  }),
)
