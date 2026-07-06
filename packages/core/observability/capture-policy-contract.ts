import {
  CRUX_CANONICAL_ARTIFACT_KINDS,
  type CruxCanonicalArtifactKind,
  type CruxArtifactKind,
  type CruxGraphRecord,
} from './contract'

/** Capture mode for a privacy-sensitive payload direction. */
export type CruxObservabilityCaptureMode = 'inline' | 'reference' | 'off'

/** Capture level used by the stable-beta safety artifact capture ladder. */
export type CruxObservabilityCaptureLevel = 'full' | 'safe' | 'evidence' | 'off'

/** Canonical artifacts whose payloads are governed by the Safety capture ladder. */
export type CruxSafetyArtifactKind = Extract<
  CruxCanonicalArtifactKind,
  | 'approval.request'
  | 'constraint.report'
  | 'guardrail.report'
  | 'memory.write'
  | 'quality.snapshot'
  | 'score.report'
  | 'tool.args'
  | 'tool.result'
  | 'validation.feedback'
>

export type CruxObservabilityArtifactDirection = 'input' | 'output'

export type CruxObservabilityCaptureTarget =
  | CruxObservabilityArtifactDirection
  | CruxSafetyArtifactKind

export type CruxObservabilityCaptureConfig =
  | CruxObservabilityCaptureLevel
  | {
      readonly default?: CruxObservabilityCaptureLevel
      readonly overrides?: Partial<Record<CruxObservabilityCaptureTarget, CruxObservabilityCaptureLevel>>
      /**
       * Last-mile record redaction hook.
       *
       * This is the same hook as the top-level `redactRecord` field, accepted here so
       * `observability.capture` can be the single privacy knob.
       */
      readonly redactRecord?: (record: CruxGraphRecord) => CruxGraphRecord | null
    }

/** Runtime policy for how observability payloads are captured. */
export interface CruxObservabilityCapturePolicy {
  /**
   * Stable-beta capture ladder for safety-sensitive artifacts.
   *
   * `full` keeps payload previews, `safe` keeps only already-safe previews,
   * `evidence` keeps size/hash evidence without content previews, and `off`
   * removes payload previews and evidence metadata.
   *
   * @default 'safe' for Safety artifacts; existing recordInputs/recordOutputs
   * defaults continue to apply to input/output families.
   */
  readonly capture?: CruxObservabilityCaptureConfig
  /**
   * Capture input-family payloads such as prompt messages and tool arguments.
   *
   * `true` is sugar for `'inline'`; `false` is sugar for `'reference'`.
   *
   * @default true
   */
  readonly recordInputs?: boolean | CruxObservabilityCaptureMode
  /**
   * Capture output-family payloads such as model responses, retrieved content,
   * memory snapshots, token text, and raw error evidence.
   *
   * `true` is sugar for `'inline'`; `false` is sugar for `'reference'`.
   *
   * @default true
   */
  readonly recordOutputs?: boolean | CruxObservabilityCaptureMode
  /**
   * Last-mile record redaction hook.
   *
   * Runs after capture policy and before sanitization. Returning `null` drops
   * the record. Throwing also drops the record, so privacy hooks fail closed.
   */
  readonly redactRecord?: (record: CruxGraphRecord) => CruxGraphRecord | null
}

/**
 * Keys whose values can carry prompt, retrieval, generation, or body text.
 *
 * These are stripped from record attributes when either capture direction is
 * disabled, and by the OTel mapper as defense in depth.
 */
export const PAYLOAD_ATTRIBUTE_KEYS = [
  'text',
  'query',
  'prompt',
  'messages',
  'input',
  'output',
  'preview',
  'content',
  'delta',
  'body',
  'filter',
] as const

export type CruxObservabilityArtifactCaptureDecision =
  | CruxObservabilityArtifactDirection
  | 'safety'
  | 'exempt'

export const ARTIFACT_CAPTURE_DECISIONS = {
  'approval.request': 'safety',
  input: 'input',
  messages: 'input',
  system: 'input',
  context: 'input',
  'context.contribution': 'input',
  prompt: 'input',
  'prompt.budget': 'input',
  'tool.args': 'safety',
  'tool.request': 'input',
  output: 'output',
  'stream.timeline': 'output',
  'tool.result': 'safety',
  'retrieval.hits': 'output',
  'memory.snapshot': 'output',
  'memory.recall': 'output',
  'memory.diff': 'output',
  'memory.write': 'safety',
  'error.raw': 'output',
  'guardrail.report': 'safety',
  'validation.feedback': 'safety',
  'handoff.payload': 'output',
  'delegate.report': 'output',
  'composition.report': 'output',
  'compaction.report': 'output',
  'score.report': 'safety',
  'citation.report': 'output',
  'comparison.report': 'output',
  'quality.snapshot': 'safety',
  'error.stack': 'exempt',
  'routing.report': 'exempt',
  'cache.report': 'exempt',
  'embedding.report': 'exempt',
  'indexing.report': 'exempt',
  'ingest.report': 'exempt',
  'corpus.report': 'exempt',
  'security.report': 'exempt',
  'constraint.report': 'safety',
} as const satisfies Record<CruxCanonicalArtifactKind, CruxObservabilityArtifactCaptureDecision>

export function isCanonicalArtifactKind(kind: CruxArtifactKind): kind is CruxCanonicalArtifactKind {
  return (CRUX_CANONICAL_ARTIFACT_KINDS as readonly string[]).includes(kind)
}
