import { evaluate } from '@use-crux/core/quality'

export default evaluate('dup.id', {
  task: (input: string) => input,
  data: [{ input: 'a' }],
})
