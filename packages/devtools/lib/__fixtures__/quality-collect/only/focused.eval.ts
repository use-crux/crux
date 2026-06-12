import { evaluate } from '@crux/core/quality/api'

export const focused = evaluate.only({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'picked' } }],
})

export const ignored = evaluate({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'not picked' } }],
})
