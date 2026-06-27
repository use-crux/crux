import { writeFileSync } from 'node:fs'
import { config } from '@use-crux/core'
import type { GenerateFn } from '@use-crux/core/quality'

const implicitGenerate = (async () => ({ text: 'implicit setup response' })) as unknown as GenerateFn

/**
 * Stale user config shape used to prove the launch runner ignores legacy
 * config-level model setup instead of spending tokens implicitly.
 */
const legacyQualityWithSetup = {
  id: 'fixture-quality',
  include: 'implicit-model.eval.ts',
  setup: async () => {
    if (process.env.CRUX_QUALITY_SETUP_MARKER !== undefined) {
      writeFileSync(process.env.CRUX_QUALITY_SETUP_MARKER, 'called', 'utf8')
    }
    return { generate: implicitGenerate, model: 'implicit-model' }
  },
}

export default config({
  quality: legacyQualityWithSetup,
})
