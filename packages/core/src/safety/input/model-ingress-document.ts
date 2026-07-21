import type { MediaPartSubject } from '../media/types'
import type { ToolModelInputOrigin } from './model-ingress'

/** @internal Stable key owned by one dialect-native model-ingress codec. */
export type ModelIngressSlotKey = string

/** @internal Guardable text at one stable position in a native value. */
export interface ModelIngressTextSlot {
  readonly kind: 'text'
  readonly key: ModelIngressSlotKey
  readonly value: string
}

/** @internal One removable native media position and its semantic callback views. */
export interface ModelIngressMediaSlot {
  readonly kind: 'media'
  readonly key: ModelIngressSlotKey
  readonly descriptor: string
  readonly subjects: readonly [MediaPartSubject, ...MediaPartSubject[]]
}

/** @internal Structurally protected native content that Safety does not interpret. */
export interface ModelIngressOpaqueSlot {
  readonly kind: 'opaque'
  readonly key: ModelIngressSlotKey
  readonly descriptor: string
}

/** @internal One ordered semantic position in a dialect-native ingress value. */
export type ModelIngressSlot =
  | ModelIngressTextSlot
  | ModelIngressMediaSlot
  | ModelIngressOpaqueSlot

/** @internal Native value paired with the semantic slots Safety may govern. */
export interface ModelIngressDocument<TValue = unknown> {
  readonly kind: 'document'
  readonly value: TValue
  readonly origin: ToolModelInputOrigin
  readonly slots: readonly ModelIngressSlot[]
}

/** @internal Minimal edits a dialect applies to its original native value. */
export interface ModelIngressPatch {
  readonly kind: 'patch'
  readonly text: ReadonlyMap<ModelIngressSlotKey, string>
  readonly removed: ReadonlySet<ModelIngressSlotKey>
}
