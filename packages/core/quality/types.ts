/**
 * Browser-safe quality workbench types.
 *
 * Keep this file free of Node.js imports. Runtime file-backed helpers live in
 * `@crux/core/quality`.
 *
 * @module
 */

export interface QualityConfig {
  readonly id: string
  readonly dir?: string
  readonly privacy?: {
    readonly redact?: readonly string[]
  }
  readonly recording?: {
    readonly traces?: boolean
    readonly streams?: boolean
    readonly toolCalls?: boolean
    readonly retrieval?: boolean
    readonly citations?: boolean
    readonly retention?: { readonly maxRuns?: number }
  }
}
