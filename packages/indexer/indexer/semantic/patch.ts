import type { IndexDiagnostic } from '@crux/core/project-index'
import type { IndexPatch } from '../patches'

export class SemanticDiagnosticError extends Error {
  readonly diagnostic: IndexDiagnostic

  constructor(diagnostic: IndexDiagnostic) {
    super(diagnostic.message)
    this.name = 'SemanticDiagnosticError'
    this.diagnostic = diagnostic
  }
}

/**
 * Builds a semantic patch that records why enrichment was skipped.
 *
 * The patch intentionally contains only diagnostics. Applying it after an AST
 * patch keeps source and syntax facts intact while making semantic degradation
 * visible to callers and devtools.
 */
export function degradedSemanticPatch(basePatch: IndexPatch, diagnostics: readonly IndexDiagnostic[]): IndexPatch {
  return {
    ...basePatch,
    finishedAt: new Date().toISOString(),
    status: 'degraded',
    facts: { diagnostics },
  }
}

/**
 * Converts an unexpected semantic enrichment exception into a stable diagnostic.
 */
export function semanticFailureDiagnostic(error: unknown): IndexDiagnostic {
  if (error instanceof SemanticDiagnosticError) return error.diagnostic
  const detail = error instanceof Error ? error.message : String(error)
  return {
    id: 'diagnostic:semantic:failed',
    severity: 'warning',
    code: 'index.semantic_failed',
    message: `Semantic enrichment failed; semantic facts were skipped to preserve the source index. ${detail}`,
    suggestedFix: 'Check recent semantic analyzer changes or run with a smaller semantic input set.',
  }
}
