/** Segmenter names and hooks supported by streaming guardrails. */
export type StreamSegmenter = 'sentence' | 'line' | 'chunk' | RegExp | ((buffer: string) => string | null)

/**
 * Streaming posture for output guardrails.
 *
 * `false` and `'final'` are explicitly audited in Phase 3. Segment options
 * gate text before release.
 */
export type GuardrailStreamOption =
  | false
  | 'final'
  | 'sentence'
  | 'line'
  | 'chunk'
  | {
      readonly segment: StreamSegmenter
      readonly maxHold?: { readonly chars?: number; readonly ms?: number }
      readonly onHoldLimit?: 'block' | 'release'
    }
