import { evaluate } from '@crux/core/quality'

/** Named export without an explicit id — derived id appends `#alpha`. */
export const alpha = evaluate({
  task: (input: { value: number }) => input.value * 2,
  data: [{ input: { value: 2 }, expected: 4 }],
})

/** Explicit id wins over derivation. */
export const pinned = evaluate('support.pinned', {
  task: (input: { question: string }) => input.question.toUpperCase(),
  data: [{ input: { question: 'hello?' } }],
})

/** Not an evaluation — must be ignored by the export scan. */
export const helper = { _tag: 'NotAnEvaluation', run: () => undefined }
