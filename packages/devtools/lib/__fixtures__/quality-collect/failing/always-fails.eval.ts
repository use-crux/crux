import { evaluate } from '@crux/core/quality/api'

/** The output never matches — the default assertions gate fails (exit 1). */
export default evaluate({
  task: (input: { q: string }) => input.q,
  data: [{ input: { q: 'hello' } }],
  expect: (ctx) => {
    ctx.expect(ctx.output).toBe('goodbye')
  },
})
