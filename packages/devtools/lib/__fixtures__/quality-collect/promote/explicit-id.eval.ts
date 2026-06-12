import { evaluate } from '@crux/core/quality/api'

export default evaluate('promote.explicit', {
  task: (input: { name: string }) => `Hello ${input.name}`,
  data: [
    { name: 'ada', input: { name: 'Ada' } },
    { name: 'grace', input: { name: 'Grace' } },
  ],
})
