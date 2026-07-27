import type { MediaPartSubject, MediaSafetyTargetId } from './media/types'
import type { InputSource } from './input-origin'
import { inputBoundary } from './input-boundary'
import { inputTools } from './input-tool-boundary'
import type { ToolDefinitionSource } from './input-tool-boundary'
import { outputObject, outputText } from './output/output-boundaries'

export type {
  HoldCapability,
  HoldLimits,
  HoldMarker,
  ItemsBoundary,
  LineOptions,
  ObjectBoundary,
  PathBoundary,
  SafetyUnitKind,
  SegmentOptions,
  SentenceOptions,
  StringPathSentencesBoundary,
  TextBoundary,
} from './output/output-boundaries'

export type {
  MediaPart,
  MediaPartLocation,
  MediaPartOrigin,
  MediaPartSubject,
  MediaSafetyTargetId,
} from './media/types'
export { isMediaSafetyTargetId } from './media/types'

/** Canonical safety boundary ids used in decisions, traces, and config serialization. */
export type SafetyTargetId =
  | MediaSafetyTargetId
  | 'model.input.text'
  | 'model.input.tools'
  | 'model.instructions'
  | 'model.output.text'
  | 'model.output.object'
  | 'model.output'
  | 'tool.call'
  | 'tool.result'
  | 'approval.request'
  | 'memory.write'
  | 'validation.feedback'

/**
 * Frozen public boundary descriptor.
 *
 * `__subject` and `__origin` are phantom inference carriers and are never
 * assigned at runtime. `from` is present only for an explicit semantic source
 * filter; omitted filters retain the helper's semantic default.
 */
export interface BoundaryDef<TId extends SafetyTargetId = SafetyTargetId, TSubject = unknown, TOrigin = unknown> {
  /** Runtime discriminant for a Safety boundary descriptor. */
  readonly _tag: 'Boundary'
  /** Canonical destination guarded by the attached policy. */
  readonly id: TId
  /** Optional structured-output property path. */
  readonly path?: string
  /** @internal Compile-time policy subject carrier. */
  readonly __subject?: TSubject
  /** @internal Compile-time model-ingress origin carrier. */
  readonly __origin?: TOrigin
  /**
   * Frozen, de-duplicated provenance filter when explicitly supplied.
   *
   * @default Omitted, matching every source supported by the helper.
   */
  readonly from?: readonly (InputSource | ToolDefinitionSource)[]
  /**
   * Optional serializable refinement of a canonical boundary target.
   *
   * @default Omitted, selecting the root target.
   */
  readonly selector?: 'descriptions'
}

type Prev = [never, 0, 1, 2, 3, 4]

/**
 * Dot-separated property paths for structured output targeting.
 *
 * The recursion depth is intentionally capped to keep library consumers away
 * from TS2589 on large schemas while preserving useful autocomplete.
 */
export type DotPath<T, D extends number = 4> = [D] extends [never]
  ? never
  : T extends readonly unknown[]
    ? never
    : T extends object
      ? {
          [K in keyof T & string]: NonNullable<T[K]> extends object
            ? K | `${K}.${DotPath<NonNullable<T[K]>, Prev[D]>}`
            : K
        }[keyof T & string]
      : never

/** Value type at a {@link DotPath}. */
export type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<NonNullable<T[K]>, Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never

/** A single boundary or a readonly tuple of boundaries. */
export type BoundaryInput = BoundaryDef | readonly BoundaryDef[]

/** Infer the subject type accepted by a policy bound to `B`. */
export type SubjectOf<B> = B extends readonly (infer TBoundary)[]
  ? SubjectOf<TBoundary>
  : B extends BoundaryDef<SafetyTargetId, infer TSubject>
    ? TSubject
    : never

/** Infer the target id or id union for a boundary input. */
export type BoundaryIdOf<B> = B extends readonly (infer TBoundary)[]
  ? BoundaryIdOf<TBoundary>
  : B extends BoundaryDef<infer TId, unknown>
    ? TId
    : never

type BoundaryMember<B> = B extends readonly (infer TBoundary)[] ? TBoundary : B

/** Infer the semantic origin exposed by a boundary input. */
export type OriginOf<B> =
  BoundaryMember<B> extends BoundaryDef<SafetyTargetId, unknown, infer TOrigin>
    ? unknown extends TOrigin
      ? never
      : TOrigin
    : never

/** Infer boundary members that do not expose semantic origin. */
export type OriginlessBoundaryOf<B> =
  BoundaryMember<B> extends infer TBoundary
    ? TBoundary extends BoundaryDef<SafetyTargetId, unknown, infer TOrigin>
      ? unknown extends TOrigin
        ? TBoundary
        : never
      : never
    : never

/**
 * The selected structured-output path of a boundary, if any.
 *
 * A root `object()` builder installs a non-enumerable `.path()` method, so its
 * `path` property is a function rather than a selected-path string. Runtime
 * readers use this helper to read the selected path as data, treating the root
 * object (and any non-string `path`) as "no path selected".
 */
export function selectedPath(boundary: { readonly path?: unknown }): string | undefined {
  return typeof boundary.path === 'string' ? boundary.path : undefined
}

/** Runtime type guard for frozen boundary descriptors. */
export function isBoundaryDef(value: unknown): value is BoundaryDef {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as { readonly _tag?: unknown })._tag === 'Boundary' &&
    'id' in value &&
    typeof (value as { readonly id?: unknown }).id === 'string'
  )
}

function makeBoundary<TId extends SafetyTargetId, TSubject>(id: TId, path?: string): BoundaryDef<TId, TSubject> {
  const boundaryDef = path === undefined ? { _tag: 'Boundary' as const, id } : { _tag: 'Boundary' as const, id, path }
  return Object.freeze(boundaryDef) as BoundaryDef<TId, TSubject>
}

/**
 * Public authoring helpers for attaching safety policies to runtime
 * boundaries. Helpers return fresh frozen descriptors so callers can compare
 * ids structurally without depending on object identity.
 */
export const boundary = Object.freeze({
  input: Object.freeze({ ...inputBoundary, tools: inputTools }),
  output: Object.freeze({
    /**
     * Target the model's generated text.
     *
     * @remarks Adaptive default: evaluated once when a generate result completes
     * and once per canonical text delta on a stream. Refine the unit with
     * `.deltas()`, `.complete()`, `.sentences()`, `.lines()`, or `.segments()`.
     */
    text: outputText,
    /**
     * Target each canonical media part produced by a model or completed operation.
     *
     * The callback receives the original canonical media source together with a
     * stable origin. Narrow `subject.part.type` to inspect image, audio, video,
     * or file facts. Enforced `strip` removes the selected optional part; a
     * required or final part escalates to a block. Report mode records strip
     * intent without changing the result.
     *
     * Provider-native `raw` values, metadata, and warnings are not guarded and
     * may repeat content removed from canonical fields.
     *
     * @returns A boundary whose guardrail subject is a {@link MediaPartSubject}.
     *
     * @example
     * ```ts
     * const generatedImages = guardrail({
     *   id: 'generated-images',
     *   on: boundary.output.media(),
     *   run: (subject) => {
     *     if (subject.part.type !== 'image') return { action: 'allow' }
     *     return subject.part.mediaType === 'image/png'
     *       ? { action: 'allow' }
     *       : { action: 'strip', reason: 'Only PNG images are accepted.' }
     *   },
     * })
     * ```
     */
    media: (): BoundaryDef<'model.output.media', MediaPartSubject> => makeBoundary('model.output.media'),
    /**
     * Target the model's structured output object.
     *
     * @remarks Adaptive default: evaluates the complete root object. Select a
     * path with `.path('a.b')`; a string path adds `.sentences()` and an array
     * path adds `.items()`. Known paths autocomplete to depth four; deeper string
     * paths are runtime-valid with an `unknown` subject.
     */
    object: outputObject,
    both: <T>(): BoundaryDef<'model.output', { readonly text: string; readonly object: T }> =>
      makeBoundary('model.output'),
  }),
  memory: Object.freeze({
    /**
     * Target a managed-memory candidate immediately before durable commit.
     *
     * @remarks
     * Managed adapter capture runs block-local redaction, this global/prompt/call
     * boundary, block-local validation, `shouldRemember`, then persistence.
     * Standalone memory capture has no per-call Safety registry and remains
     * governed by block-local policy only.
     *
     * @returns A frozen memory-write boundary preserving the candidate type.
     *
     * @example
     * ```ts
     * const durableMemory = guardrail({
     *   id: 'durable-memory',
     *   on: boundary.memory.write<MyMemory>(),
     *   run: (candidate) =>
     *     candidate.safe
     *       ? { action: 'allow' }
     *       : { action: 'drop', reason: 'Unsafe memory is not persisted.' },
     * })
     * ```
     */
    write: <T = unknown>(): BoundaryDef<'memory.write', T> => makeBoundary('memory.write'),
  }),
  validation: Object.freeze({
    /**
     * Target framework-produced validation feedback before retry writeback.
     *
     * @remarks
     * This compatibility boundary covers validation feedback only. New
     * feedback, including constraint feedback and rejected output, is governed
     * through `boundary.input.text({ from: 'feedback' })`.
     *
     * @returns A frozen validation-feedback boundary.
     *
     * @example
     * ```ts
     * const feedbackIngress = guardrail({
     *   id: 'feedback-ingress',
     *   on: boundary.input.text({ from: 'feedback' }),
     *   run: (feedback) => ({ action: 'allow' }),
     * })
     * ```
     *
     * @deprecated Use `boundary.input.text({ from: 'feedback' })`. This alias
     * remains operational for validation feedback during the compatibility
     * window.
     */
    feedback: (): BoundaryDef<'validation.feedback', string> => makeBoundary('validation.feedback'),
  }),
})
