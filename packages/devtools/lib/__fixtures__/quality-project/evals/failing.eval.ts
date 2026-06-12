import { evaluate } from '@crux/core/quality/api'

export default evaluate({
  task: (input: { word: string }) => input.word,
  data: [{ input: { word: 'unchanged' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output).toBe('something else entirely')
  },
})
