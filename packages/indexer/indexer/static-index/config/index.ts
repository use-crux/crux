import type { CruxExperimentalConfig } from '@use-crux/core'

/** Static syntax frontend selected by experimental project config. */
export type StaticIndexSyntaxFrontend = 'oxc'

/** Normalized Static Index syntax configuration used by parser hosts. */
export interface StaticIndexSyntaxSelection {
  /** Whether Rust/Oxc static syntax parsing is enabled for this project. */
  readonly enabled: boolean
  /** Static syntax frontend to use when enabled. */
  readonly frontend?: StaticIndexSyntaxFrontend
}

/**
 * Converts `config({ experimental })` data into Static Index syntax selection.
 *
 * The public switch is still `experimental.indexer.nativeAst` during the
 * experimental phase. Internally, the compiler treats it as the Static Index
 * syntax frontend selection so source-only indexing remains backend-neutral.
 */
export function staticIndexSyntaxSelectionFromConfig(
  config: CruxExperimentalConfig | undefined,
): StaticIndexSyntaxSelection {
  const ast = config?.indexer?.nativeAst
  if (!ast) return { enabled: false }
  if (ast === true) return { enabled: true, frontend: 'oxc' }
  return { enabled: true, frontend: ast.frontend ?? 'oxc' }
}
