import type { MediaPartSubject } from '../../../boundary'

/**
 * A MIME essence or top-level wildcard, such as `image/png` or `image/*`.
 *
 * Patterns are normalized to lowercase without parameters. Runtime validation
 * rejects malformed patterns, global wildcards, and wildcard major types.
 */
export type MediaTypePattern = `${string}/${string}`

/** MIME allowlist applied to each input attachment. */
export interface MediaTypeGuardrailRule {
  /** A non-empty list of MIME essences or top-level wildcards accepted by the policy. */
  readonly allow: readonly [MediaTypePattern, ...MediaTypePattern[]]
  /**
   * Allow attachments whose MIME type cannot be observed locally.
   *
   * @default false
   */
  readonly allowUnknown?: boolean
}

/** Byte-size ceiling applied to each input attachment. */
export interface MediaSizeGuardrailRule {
  /** Maximum accepted payload size in bytes. Must be a positive safe integer. */
  readonly maxBytes: number
  /** Allow attachments whose size cannot be observed without external I/O. @default false */
  readonly allowUnknown?: boolean
}

/** Source restrictions applied to each input attachment. */
export interface MediaSourceGuardrailRule {
  /**
   * Exact remote URL hostnames accepted by the policy. Omit to allow every
   * otherwise-valid HTTPS host. Wildcards, schemes, ports, and paths are not accepted.
   */
  readonly allowHosts?: readonly string[]
  /**
   * Allow byte, Blob, data-Asset, and data-URL sources.
   *
   * @default true
   */
  readonly allowInline?: boolean
  /**
   * Allow provider-owned file references. URL host and credential rules do not apply to them.
   *
   * @default true
   */
  readonly allowProviderFiles?: boolean
  /**
   * Allow URL authority userinfo, such as a username or password before the hostname.
   *
   * @default false
   */
  readonly allowUrlUserInfo?: boolean
  /**
   * Allow URL query strings, including signed URL parameters. No token-name heuristics are used.
   *
   * @default true
   */
  readonly allowUrlQuery?: boolean
}

/** Action returned when an attachment violates the policy. */
export type MediaGuardrailAction = 'block' | 'strip'

type MediaGuardrailRules =
  | {
      readonly mediaTypes: MediaTypeGuardrailRule
      readonly size?: MediaSizeGuardrailRule
      readonly sources?: MediaSourceGuardrailRule
    }
  | {
      readonly mediaTypes?: MediaTypeGuardrailRule
      readonly size: MediaSizeGuardrailRule
      readonly sources?: MediaSourceGuardrailRule
    }
  | {
      readonly mediaTypes?: MediaTypeGuardrailRule
      readonly size?: MediaSizeGuardrailRule
      readonly sources: MediaSourceGuardrailRule
    }

/**
 * Declarative rules for validating input attachments before provider I/O.
 *
 * At least one of `mediaTypes`, `size`, or `sources` is required. Configured
 * rules are evaluated in that order and all failures are reported together.
 */
export type MediaGuardrailOptions = MediaGuardrailRules & {
  /**
   * Action returned when one or more configured rules fail.
   *
   * @default 'block'
   */
  readonly action?: MediaGuardrailAction
}

export type NormalizedMediaGuardrailConfig = Readonly<Record<string, unknown>> & {
  readonly mediaTypes?: {
    readonly allow: readonly MediaTypePattern[]
    readonly allowUnknown: boolean
  }
  readonly size?: {
    readonly maxBytes: number
    readonly allowUnknown: boolean
  }
  readonly sources?: {
    readonly allowHosts?: readonly string[]
    readonly allowInline: boolean
    readonly allowProviderFiles: boolean
    readonly allowUrlUserInfo: boolean
    readonly allowUrlQuery: boolean
  }
  readonly action: MediaGuardrailAction
}

export interface MediaPolicyFacts {
  readonly partType: MediaPartSubject['part']['type']
  readonly mediaType?: string
  readonly sizeBytes?: number
  readonly source:
    | { readonly kind: 'inline' }
    | {
        readonly kind: 'url'
        readonly hostname: string
        readonly hasUserInfo: boolean
        readonly hasQuery: boolean
      }
    | { readonly kind: 'provider-file' }
    | { readonly kind: 'unknown' }
}

export type MediaPolicyViolation =
  | { readonly kind: 'media-type-unknown' }
  | { readonly kind: 'media-type-not-allowed'; readonly mediaType: string }
  | { readonly kind: 'media-size-unknown' }
  | {
      readonly kind: 'media-size-exceeded'
      readonly sizeBytes: number
      readonly maxBytes: number
    }
  | { readonly kind: 'media-inline-not-allowed' }
  | { readonly kind: 'media-provider-file-not-allowed' }
  | { readonly kind: 'media-host-not-allowed' }
  | { readonly kind: 'media-url-userinfo-not-allowed' }
  | { readonly kind: 'media-url-query-not-allowed' }
  | { readonly kind: 'media-source-unknown' }
