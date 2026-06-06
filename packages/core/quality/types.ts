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
  /** Glob pattern(s) for authored suite files. Defaults to Crux suite conventions. */
  readonly include?: string | readonly string[]
  /** Glob pattern(s) for authored cassette files. Defaults to Crux cassette conventions. */
  readonly cassetteInclude?: string | readonly string[]
  /** Extra glob pattern(s) to exclude from authored quality asset discovery. */
  readonly exclude?: string | readonly string[]
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
