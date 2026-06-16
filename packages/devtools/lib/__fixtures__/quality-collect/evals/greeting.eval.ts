import { evaluate } from '@crux/core/quality'

export default evaluate({
  task: (input: { name: string }) => `Hello ${input.name}`,
  data: [{ input: { name: 'Ada' } }, { input: { name: 'Grace' } }],
})
