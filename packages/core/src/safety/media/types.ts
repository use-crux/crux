import type { ContentPart } from '../../types/content'

/** Canonical Safety targets whose subjects are individual media parts. */
export type MediaSafetyTargetId = 'model.input.media' | 'model.output.media'

/** Narrow an unknown boundary id to the canonical media target vocabulary. */
export function isMediaSafetyTargetId(value: unknown): value is MediaSafetyTargetId {
  return value === 'model.input.media' || value === 'model.output.media'
}

/**
 * A canonical non-text part that can be inspected by a media guardrail.
 *
 * Narrow `type` to access the canonical image, audio, video, or file fields.
 */
export type MediaPart = Exclude<ContentPart, { readonly type: 'text' }>

/**
 * Stable location of a canonical media part before any enforcing strip.
 *
 * Message and step indexes refer to their original arrays. Completed-operation
 * indexes refer to the original canonical option or result field. Narrow
 * `kind`, then `operation`, `phase`, and `field` where applicable.
 */
export type MediaPartOrigin =
  | {
      readonly kind: 'message'
      readonly messageIndex: number
      readonly partIndex: number
    }
  | {
      readonly kind: 'tool-result'
      readonly toolName: string
      readonly toolCallId?: string
      readonly partIndex: number
    }
  | {
      readonly kind: 'step'
      readonly stepIndex: number
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'input'
      readonly field: 'images'
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'input'
      readonly field: 'mask'
      readonly partIndex: 0
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateImage'
      readonly phase: 'output'
      readonly field: 'images'
      readonly partIndex: number
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'generateSpeech'
      readonly phase: 'output'
      readonly field: 'audio'
      readonly partIndex: 0
    }
  | {
      readonly kind: 'operation'
      readonly operation: 'transcribe'
      readonly phase: 'input'
      readonly field: 'audio'
      readonly partIndex: 0
    }

/**
 * A canonical media part together with its stable pre-write-back origin.
 *
 * Adapter codecs may expose a callback-only `provider-file` source whose
 * `fileId` is `'<redacted>'`. That sentinel protects the native provider ID
 * during Safety evaluation and is never a usable asset locator.
 */
export interface MediaPartSubject {
  /** Canonical image, audio, video, or file part under evaluation. */
  readonly part: MediaPart
  /** Stable location in the canonical surface under evaluation. */
  readonly origin: MediaPartOrigin
}

/** Privacy-safe location recorded for an evaluated canonical media part. */
export interface MediaPartLocation {
  /** Stable origin without a media source, filename, URL, or payload. */
  readonly origin: MediaPartOrigin
  /** Safe canonical discriminant; never the media source. */
  readonly partType: MediaPart['type']
}
