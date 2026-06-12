import { evaluate } from '@crux/core/quality/api'

export default evaluate('dup.id', {
  task: (input: string) => input,
  data: [{ input: 'a' }],
})
