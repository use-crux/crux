import { evaluate } from '@crux/core/quality'

export default evaluate({
  task: (input: { word: string }) => input.word.toUpperCase(),
  data: [
    { input: { word: 'crux' }, expected: 'CRUX' },
    { input: { word: 'quality' }, expected: 'QUALITY' },
  ],
  expect: (ctx) => {
    ctx.expect(ctx.output).toBeTypeOf('string')
    if (ctx.expected !== undefined) ctx.expect(ctx.output).toBe(ctx.expected)
  },
})
