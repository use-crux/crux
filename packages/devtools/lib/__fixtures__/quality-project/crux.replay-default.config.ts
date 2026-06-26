import { config } from '@use-crux/core'

export default config({
  quality: {
    id: 'fixture-quality',
    include: 'evals/passing.eval.ts',
    defaults: { replay: 'record-new' },
  },
})
