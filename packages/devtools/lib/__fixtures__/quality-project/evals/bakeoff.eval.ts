import { evaluate } from '@crux/core/quality/api'

const quality = Object.assign(
  ({ output }: { input: unknown; output: unknown; expected: unknown }) => ({
    name: 'quality',
    score: (output as { score: number }).score,
  }),
  { scorerName: 'quality' as const },
)

/**
 * The Phase 4 acceptance bakeoff: three variants over a deterministic task,
 * paired against the `current` baseline. The candidates regress the quality
 * score by a fixed handicap, so the `minDeltaVsBaseline` gate trips with
 * zero-variance paired deltas.
 */
export default evaluate('evals.bakeoff', {
  task: (input: { difficulty: number }, params: { handicap?: number }) => ({
    score: Math.max(0, 1 - input.difficulty - (params.handicap ?? 0)),
  }),
  data: [
    { name: 'easy', input: { difficulty: 0 } },
    { name: 'medium', input: { difficulty: 0.2 } },
    { name: 'hard', input: { difficulty: 0.4 } },
  ],
  scorers: [quality],
  variants: {
    current: {},
    candidate: { handicap: 0.1 },
    cheap: { handicap: 0.3 },
  },
  baseline: 'current',
  gates: { scores: { quality: { minDeltaVsBaseline: -0.05 } } },
})
