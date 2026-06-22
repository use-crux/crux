import type { CruxExperimentalConfig } from '@crux/core'

/** Native static syntax frontend selected by experimental project config. */
export type NativeStaticAstFrontend = 'oxc'

/** Normalized native static AST configuration used by parser hosts. */
export interface NativeStaticAstSelection {
  /** Whether Rust/Oxc static syntax parsing is enabled for this project. */
  readonly enabled: boolean
  /** Native static syntax frontend to use when enabled. */
  readonly frontend?: NativeStaticAstFrontend
}

/**
 * Converts `config({ experimental })` data into native static AST selection.
 *
 * The static AST switch is a sibling of the semantic native switch. Users opt
 * into Rust/Oxc static parsing with `experimental.indexer.nativeAst: true`
 * without changing semantic enrichment backend selection.
 */
export function nativeStaticAstSelectionFromConfig(
  config: CruxExperimentalConfig | undefined,
): NativeStaticAstSelection {
  const ast = config?.indexer?.nativeAst
  if (!ast) return { enabled: false }
  if (ast === true) return { enabled: true, frontend: 'oxc' }
  return { enabled: true, frontend: ast.frontend ?? 'oxc' }
}
