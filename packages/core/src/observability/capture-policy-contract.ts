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

/**
 * A deployment-wide pattern removed from captured observability payloads.
 *
 * A bare expression replaces every match with `[REDACTED]`. Use the object
 * form to provide a literal replacement. Pattern matching never changes the
 * value used by the application, model, or tool.
 */
export type CruxObservabilityRedactionPattern =
  | RegExp
  | {
      /** Expression matched against captured observability strings. */
      readonly pattern: RegExp
      /**
       * Literal replacement inserted for every match.
       *
       * JavaScript replacement tokens such as `$&` and `$1` are not expanded.
       *
       * @default '[REDACTED]'
       */
      readonly replacement?: string
    }

/** Canonical artifacts whose payloads are governed by the Safety capture ladder. */
export type CruxSafetyArtifactKind = Extract<
  CruxCanonicalArtifactKind,
  | 'approval.request'
  | 'approval.decision'
  | 'constraint.report'
  | 'guardrail.report'
  | 'memory.write'
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
   * `full` keeps arbitrary payload previews. `safe` also retains the preview
   * and is a producer-side assertion that its artifact contract is already
   * safe by default; the capture layer does not classify or sanitize arbitrary
   * text. `evidence` keeps size/hash evidence without content previews, and
   * `off` removes payload previews and evidence metadata. Use `evidence` or
   * `off` for user-authored payloads that are not safe to retain.
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
   * Deployment-wide patterns removed from captured observability payloads.
   *
   * Rules run in declaration order at the shared observability privacy gate.
   * They do not modify application or provider data.
   *
   * @default []
   */
  readonly redactPatterns?: readonly CruxObservabilityRedactionPattern[]
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
  'data',
  'bytes',
  'base64',
  'raw',
  'nativeEvent',
] as const

export type CruxObservabilityArtifactCaptureDecision =
  | CruxObservabilityArtifactDirection
  | 'safety'
  | 'exempt'

export const ARTIFACT_CAPTURE_DECISIONS = {
  'approval.request': 'safety',
  'approval.decision': 'safety',
  input: 'input',
  messages: 'input',
  system: 'input',
  context: 'input',
  'context.contribution': 'input',
  prompt: 'input',
  'prompt.budget': 'input',
  'request.plan': 'exempt',
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
  'error.stack': 'exempt',
  'routing.report': 'exempt',
  'cache.report': 'exempt',
  'embedding.report': 'exempt',
  'indexing.report': 'exempt',
  'ingest.report': 'exempt',
  'corpus.report': 'exempt',
  'security.report': 'exempt',
  'media.report': 'exempt',
  'constraint.report': 'safety',
  'effect.receipt': 'exempt',
} as const satisfies Record<CruxCanonicalArtifactKind, CruxObservabilityArtifactCaptureDecision>

export function isCanonicalArtifactKind(kind: CruxArtifactKind): kind is CruxCanonicalArtifactKind {
  return (CRUX_CANONICAL_ARTIFACT_KINDS as readonly string[]).includes(kind)
}
