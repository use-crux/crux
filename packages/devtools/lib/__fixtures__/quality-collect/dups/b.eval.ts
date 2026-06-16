import { evaluate } from '@crux/core/quality'

export default evaluate('dup.id', {
  task: (input: string) => input,
  data: [{ input: 'b' }],
})
