import { config } from '@crux/core'

export default config({
  prompts: [],
  quality: {
    id: 'fixture-quality',
    include: ['judge-missing-binding.eval.ts', 'embedding-missing-binding.eval.ts'],
  },
})
