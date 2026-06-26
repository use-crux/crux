import { config } from '@use-crux/core'

export default config({
  quality: {
    id: 'fixture-quality',
    include: ['judge-missing-binding.eval.ts', 'embedding-missing-binding.eval.ts'],
  },
})
