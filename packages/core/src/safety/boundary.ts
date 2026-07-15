import type { ApprovalRequestInfo } from '../adapter/tool/approval'
import type { RetrieverHit } from '../retrieval/types'
import type { ContentPart } from '../types/content'

/** Canonical safety boundary ids used in decisions, traces, and config serialization. */
export type SafetyTargetId =
  | 'user.input'
  | 'user.input.media'
  | 'model.input'
  | 'model.output.text'
  | 'model.output.object'
  | 'model.output'
  | 'tool.call'
  | 'tool.result'
  | 'approval.request'
  | 'retrieval.result'
  | 'memory.write'
  | 'validation.feedback'

/**
 * A canonical non-text input part that can be inspected by a media guardrail.
 *
 * The union is derived from {@link ContentPart}, so narrowing `type` exposes
 * the canonical properties for images, audio, video, and files.
 */
export type MediaPart = Exclude<ContentPart, { readonly type: 'text' }>

/**
 * The original canonical {@link MediaPart} and its stable input location.
 *
 * Both indexes refer to the caller's message arrays before any media is
 * stripped. The `part` is the original object supplied by the caller.
 */
export interface MediaPartSubject {
  /** The original canonical non-text part supplied by the caller. */
  readonly part: MediaPart
  /** Index in the original pre-strip messages array. */
  readonly messageIndex: number
  /** Index in the original pre-strip message content array. */
  readonly partIndex: number
}

/** Safe original input coordinates for an evaluated canonical media part. */
export interface MediaPartLocation {
  /** Index in the original pre-strip messages array. */
  readonly messageIndex: number
  /** Index in the original pre-strip message content array. */
  readonly partIndex: number
  /** Canonical media discriminant without its source value. */
  readonly partType: MediaPart['type']
}

/**
 * Frozen public boundary descriptor.
 *
 * The optional `__subject` member is a phantom carrier for TypeScript
 * inference. It is never assigned at runtime.
 */
export interface BoundaryDef<TId extends SafetyTargetId = SafetyTargetId, TSubject = unknown> {
  readonly _tag: 'Boundary'
  readonly id: TId
  readonly path?: string
  readonly __subject?: TSubject
}

/** Tool call payload passed to `tool.call` policies. */
export interface ToolCallSubject {
  readonly toolCallId?: string
  readonly toolName: string
  readonly input: unknown
}

/** Tool result payload passed to `tool.result` policies. */
export interface ToolResultSubject {
  readonly toolCallId?: string
  readonly toolName: string
  readonly input?: unknown
  readonly output: unknown
}

/** Human-approval payload passed to `approval.request` policies. */
export type ApprovalRequestSubject = ApprovalRequestInfo

/** Retrieval result payload passed to `retrieval.result` policies. */
export interface RetrievalResultSubject {
  readonly query?: string
  readonly hits: readonly RetrieverHit[]
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

function makeBoundary<TId extends SafetyTargetId, TSubject>(
  id: TId,
  path?: string,
): BoundaryDef<TId, TSubject> {
  const boundaryDef =
    path === undefined
      ? { _tag: 'Boundary' as const, id }
      : { _tag: 'Boundary' as const, id, path }
  return Object.freeze(boundaryDef) as BoundaryDef<TId, TSubject>
}

/**
 * Public authoring helpers for attaching safety policies to runtime
 * boundaries. Helpers return fresh frozen descriptors so callers can compare
 * ids structurally without depending on object identity.
 */
export const boundary = Object.freeze({
  input: Object.freeze({
    user: (): BoundaryDef<'user.input', string> => makeBoundary('user.input'),
    model: (): BoundaryDef<'model.input', string> => makeBoundary('model.input'),
    text: (): BoundaryDef<'user.input', string> => makeBoundary('user.input'),
    /**
     * Target each canonical non-text part in user input before provider normalization.
     *
     * @returns A boundary whose guardrail subject is a {@link MediaPartSubject}.
     *
     * @example
     * ```ts
     * const pngOnly = guardrail({
     *   id: 'png-only',
     *   on: boundary.input.media(),
     *   run: (subject) => {
     *     if (subject.part.type !== 'image') return { action: 'allow' }
     *     return subject.part.mediaType === 'image/png'
     *       ? { action: 'allow' }
     *       : { action: 'strip', reason: 'Only PNG images are accepted.' }
     *   },
     * })
     * ```
     */
    media: (): BoundaryDef<'user.input.media', MediaPartSubject> => makeBoundary('user.input.media'),
  }),
  output: Object.freeze({
    text: (): BoundaryDef<'model.output.text', string> => makeBoundary('model.output.text'),
    object: <T>(): BoundaryDef<'model.output.object', T> => makeBoundary('model.output.object'),
    both: <T>(): BoundaryDef<'model.output', { readonly text: string; readonly object: T }> =>
      makeBoundary('model.output'),
    path:
      <T>() =>
      <P extends DotPath<T>>(path: P): BoundaryDef<'model.output.object', PathValue<T, P>> =>
        makeBoundary('model.output.object', path),
  }),
  tool: Object.freeze({
    call: (): BoundaryDef<'tool.call', ToolCallSubject> => makeBoundary('tool.call'),
    result: (): BoundaryDef<'tool.result', ToolResultSubject> => makeBoundary('tool.result'),
  }),
  approval: Object.freeze({
    request: (): BoundaryDef<'approval.request', ApprovalRequestSubject> => makeBoundary('approval.request'),
  }),
  retrieval: Object.freeze({
    result: (): BoundaryDef<'retrieval.result', RetrievalResultSubject> => makeBoundary('retrieval.result'),
  }),
  memory: Object.freeze({
    write: <T = unknown>(): BoundaryDef<'memory.write', T> => makeBoundary('memory.write'),
  }),
  validation: Object.freeze({
    feedback: (): BoundaryDef<'validation.feedback', string> => makeBoundary('validation.feedback'),
  }),
})
