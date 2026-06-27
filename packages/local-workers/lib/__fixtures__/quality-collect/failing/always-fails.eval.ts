import { evaluate } from '@use-crux/core/quality'

/** The output never matches — the default assertions gate fails (exit 1). */
export default evaluate({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'hello' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output).toBe('goodbye')
  },
})
