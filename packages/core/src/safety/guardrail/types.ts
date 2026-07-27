import type { Message } from '../../generation/messages'
import type {
  BoundaryDef,
  BoundaryIdOf,
  BoundaryInput,
  HoldMarker,
  MediaPartLocation,
  MediaPartSubject,
  MediaSafetyTargetId,
  SafetyTargetId,
  SubjectOf,
} from '../boundary'
import type { SafetyUnitKind } from '../boundary'
import type { SafetyFinding, SafetyRunContext } from '../decision'
import type { ModelInputOrigin } from '../input-origin'
import type { ToolDefinitionOrigin } from '../input-tool-boundary'
import type {
  MemoryWriteGuardrailResult,
  ToolDefinitionGuardrailResult,
} from './specialized-results'

export type GuardrailMode = 'enforce' | 'report'
export type GuardrailRewriteKind = 'redact' | 'mask' | 'hash' | 'normalize'

/** Privacy-safe provenance supported by guardrail runtime records. @internal */
export type GuardrailOrigin = ModelInputOrigin | ToolDefinitionOrigin

/** Result returned by guardrail policy callbacks. */
export type GuardrailRunResult<TValue = string> =
  | { readonly action: 'allow' }
  | { readonly action: 'block'; readonly reason: string }
  | { readonly action: 'warn'; readonly reason: string }
  | {
      readonly action: 'rewrite'
      readonly value: TValue
      readonly rewrite: { readonly kind: GuardrailRewriteKind }
      readonly findings?: readonly SafetyFinding[]
    }
  | { readonly action: 'hold' }

/**
 * A guardrail result for a closed (non-growing) unit. `hold` is excluded because
 * a closed unit cannot grow; use it for `.complete()` text and for reusable
 * strategy bodies that never hold.
 */
export type ClosedGuardrailRunResult<TValue = string> = Exclude<
  GuardrailRunResult<TValue>,
  { readonly action: 'hold' }
>

/**
 * Result returned by a guardrail attached to `boundary.input.media()` or
 * `boundary.output.media()`. The callback receives a
 * {@link MediaPartSubject}; narrow `subject.part.type` and
 * `subject.origin.kind` before reading variant-specific fields.
 *
 * `strip` removes the current canonical part only in enforce mode. It escalates
 * to a block when removal would violate a required group, such as the final
 * generated image, speech audio, transcription audio, or an edit mask's image
 * dependency. Report mode records intent without changing input or result.
 * Warn, block, and strip results require a reason.
 */
export type MediaGuardrailRunResult =
  | { readonly action: 'allow' }
  | { readonly action: 'warn'; readonly reason: string }
  | { readonly action: 'block'; readonly reason: string }
  | { readonly action: 'strip'; readonly reason: string }

type IsMediaBoundary<B extends BoundaryInput> = [BoundaryIdOf<B>] extends [MediaSafetyTargetId] ? true : false

type BoundaryMember<B extends BoundaryInput> = B extends readonly (infer TBoundary)[] ? TBoundary : B

type RootToolDefinitionMember<TBoundary> =
  TBoundary extends { readonly id: 'model.input.tools' }
    ? TBoundary extends { readonly selector: 'descriptions' }
      ? never
      : TBoundary
    : never

type ToolDescriptionMember<TBoundary> =
  TBoundary extends {
    readonly id: 'model.input.tools'
    readonly selector: 'descriptions'
  }
    ? TBoundary
    : never

type ContainsRootToolDefinitionBoundary<B extends BoundaryInput> = [
  RootToolDefinitionMember<BoundaryMember<B>>,
] extends [never]
  ? false
  : true

type ContainsToolDescriptionBoundary<B extends BoundaryInput> = [
  ToolDescriptionMember<BoundaryMember<B>>,
] extends [never]
  ? false
  : true

type InvalidRootToolDefinitionMember<TBoundary> =
  TBoundary extends unknown
    ? RootToolDefinitionMember<TBoundary> extends never
      ? TBoundary
      : never
    : never

type InvalidToolDescriptionMember<TBoundary> =
  TBoundary extends unknown
    ? ToolDescriptionMember<TBoundary> extends never
      ? TBoundary extends {
          readonly id:
            | 'model.input.text'
            | 'model.instructions'
            | 'model.output.text'
            | 'validation.feedback'
        }
        ? never
        : TBoundary
      : never
    : never

type InvalidMemoryWriteMember<TBoundary> =
  TBoundary extends { readonly id: 'memory.write' } ? never : TBoundary

type IsRootToolDefinitionBoundary<B extends BoundaryInput> = [BoundaryIdOf<B>] extends ['model.input.tools']
  ? ContainsToolDescriptionBoundary<B> extends true
    ? false
    : true
  : false

type IsMemoryWriteBoundary<B extends BoundaryInput> = [BoundaryIdOf<B>] extends ['memory.write']
  ? true
  : false

type ContainsMediaBoundary<B extends BoundaryInput> = [Extract<BoundaryIdOf<B>, MediaSafetyTargetId>] extends [never]
  ? false
  : true

type IsMixedMediaBoundary<B extends BoundaryInput> =
  ContainsMediaBoundary<B> extends true
    ? Exclude<BoundaryIdOf<B>, MediaSafetyTargetId> extends never
      ? false
      : true
    : false

type ContainsMemoryWriteBoundary<B extends BoundaryInput> = Extract<
  BoundaryIdOf<B>,
  'memory.write'
> extends never
  ? false
  : true

type GuardrailBoundaryInput<B extends BoundaryInput> =
  IsMixedMediaBoundary<B> extends true
    ? B & {
        readonly 'A media guardrail can target only media boundaries': never
      }
    : ContainsRootToolDefinitionBoundary<B> extends true
      ? [InvalidRootToolDefinitionMember<BoundaryMember<B>>] extends [never]
        ? B
        : B & {
            readonly 'A root tool-definition guardrail can target only root tool definitions': never
          }
      : ContainsToolDescriptionBoundary<B> extends true
        ? [InvalidToolDescriptionMember<BoundaryMember<B>>] extends [never]
          ? B
          : B & {
              readonly 'A tool-description guardrail can target only closed string boundaries': never
            }
        : ContainsMemoryWriteBoundary<B> extends true
          ? [InvalidMemoryWriteMember<BoundaryMember<B>>] extends [never]
            ? B
            : B & {
                readonly 'A memory-write guardrail can target only memory-write boundaries': never
              }
          : B

/**
 * Whether the boundary's selected unit permits `hold`. Growing text units (text
 * deltas/sentences/lines/segments and string-path sentences) carry
 * `HoldMarker<'permitted'>`; closed units (`.complete()`, root object, scalar
 * path, array item, media, tool) do not. A multi-boundary attachment never
 * permits hold.
 */
type HoldPermittedFor<B extends BoundaryInput> = B extends readonly unknown[]
  ? false
  : B extends HoldMarker<'permitted'>
    ? true
    : false

type GuardrailRunResultFor<B extends BoundaryInput> =
  IsMediaBoundary<B> extends true
    ? MediaGuardrailRunResult
    : IsRootToolDefinitionBoundary<B> extends true
      ? ToolDefinitionGuardrailResult
      : ContainsToolDescriptionBoundary<B> extends true
        ? ClosedGuardrailRunResult<SubjectOf<B>>
        : IsMemoryWriteBoundary<B> extends true
          ? MemoryWriteGuardrailResult<SubjectOf<B>>
          : HoldPermittedFor<B> extends true
            ? GuardrailRunResult<SubjectOf<B>>
            : Exclude<GuardrailRunResult<SubjectOf<B>>, { readonly action: 'hold' }>

/**
 * First-party strategy metadata carried on a guardrail body. `defaultUnit` is the
 * strategy's semantic default streaming unit, applied when the attached boundary
 * has no explicit refinement (resolution order: explicit > strategy > adaptive).
 */
export interface GuardrailStrategyMeta {
  readonly kind: string
  readonly config: Readonly<Record<string, unknown>>
  readonly defaultUnit?: SafetyUnitKind
}

/** Callable guardrail body, optionally carrying first-party strategy metadata. */
export interface GuardrailRun<B extends BoundaryInput> {
  (subject: SubjectOf<B>, ctx: SafetyRunContext<B>): GuardrailRunResultFor<B> | Promise<GuardrailRunResultFor<B>>
  readonly strategy?: GuardrailStrategyMeta
}

/** Public guardrail authoring config. */
export interface GuardrailConfig<B extends BoundaryInput = BoundaryDef> {
  readonly id: string
  readonly on: GuardrailBoundaryInput<B>
  readonly category?: string
  readonly mode?: GuardrailMode
  readonly run: GuardrailRun<B>
}

/** Frozen guardrail object. */
export interface Guardrail<B extends BoundaryInput = BoundaryDef> {
  readonly _tag: 'Guardrail'
  readonly id: string
  readonly on: B
  readonly category: string | undefined
  readonly mode: GuardrailMode
  readonly run: GuardrailConfig<B>['run']
  readonly strategy?: GuardrailStrategyMeta
}

/** Internal call context used by the Safety session when running guardrails. */
export interface GuardrailContext<
  TOrigin extends GuardrailOrigin = ModelInputOrigin,
> {
  readonly mode?: GuardrailMode
  readonly promptId: string | undefined
  readonly model: string | undefined
  readonly messages: readonly Message[]
  readonly systemPrompt: string | undefined
  readonly traceId: string | undefined
  readonly metadata: Readonly<Record<string, unknown>>
  readonly origin?: TOrigin
  readonly stream?: {
    readonly segment: true
    readonly last: boolean
    readonly heldChars: number
    readonly heldMs: number
  }
}

export interface GuardrailAuditEntry {
  readonly guard: string
  readonly category?: string
  /** Exact boundary evaluated for this entry. */
  readonly boundary: SafetyTargetId
  /** Privacy-safe semantic provenance for model-ingress evaluations. */
  readonly origin?: GuardrailOrigin
  /** Effective enforcement posture after per-call tuning. */
  readonly mode: GuardrailMode
  readonly phase: 'input' | 'output'
  readonly action: string
  readonly reason?: string
  /** Safe model id for this media evaluation, when one is known. */
  readonly model?: string
  /** Safe original coordinates for media-boundary entries. */
  readonly location?: MediaPartLocation
  /** Present only when stripping the part immediately became a terminal block. */
  readonly escalatedToBlock?: true
  /** Present only when an enforced transcript rewrite removed segments and words. */
  readonly timedTranscriptDetailRemoved?: true
  /** Validated evidence emitted by this exact policy invocation. */
  readonly findings?: readonly SafetyFinding[]
  readonly durationMs: number
}

export interface GuardrailAudit {
  readonly applied: readonly GuardrailAuditEntry[]
  readonly blocked: boolean
}
