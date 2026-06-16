import { evaluate } from '@crux/core/quality'

export const focused = evaluate.only({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'picked' } }],
})

export const ignored = evaluate({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'not picked' } }],
})
