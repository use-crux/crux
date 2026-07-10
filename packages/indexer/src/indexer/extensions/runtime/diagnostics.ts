import type { IndexDiagnostic } from '@use-crux/core/project-index'
import { fingerprint, safeId } from '../../definitions'
import type { RegisteredExtractor } from './registry-index'
import type { IndexerExtension } from '../public-contract/types'

type DiagnosticSource = IndexDiagnostic['source']

/**
 * Creates the diagnostic emitted when one static extractor throws.
 *
 * Extractor failures are isolated to the current extractor job. The diagnostic keeps both extension
 * and extractor identity so users can disable or upgrade the exact contribution that failed.
 */
export function extractorFailedDiagnostic(
  item: RegisteredExtractor,
  source: DiagnosticSource | undefined,
  error: unknown,
): IndexDiagnostic {
  const message = formatThrown(error)
  return {
    id: diagnosticId('extractor-failed', item.extension.name, item.extractor.name, source?.file, message),
    severity: 'warning',
    code: 'index.extractor_failed',
    message: `Static extractor ${item.extension.name}/${item.extractor.name} failed: ${message}`,
    ...(source ? { source } : {}),
    suggestedFix: 'Update or disable the failing indexer extension extractor.',
  }
}

/**
 * Creates the diagnostic emitted when untyped extension code returns a malformed extractor result.
 */
export function extractorResultInvalidDiagnostic(
  item: RegisteredExtractor,
  source: DiagnosticSource | undefined,
  reason: string,
): IndexDiagnostic {
  return {
    id: diagnosticId('extractor-result-invalid', item.extension.name, item.extractor.name, source?.file, reason),
    severity: 'warning',
    code: 'index.extractor_result_invalid',
    message: `Static extractor ${item.extension.name}/${item.extractor.name} returned an invalid result: ${reason}`,
    ...(source ? { source } : {}),
    suggestedFix: 'Return facts(...), none(), or a degraded result with a diagnostics array.',
  }
}

/**
 * Creates the diagnostic emitted when one extension rule throws.
 */
export function ruleFailedDiagnostic(extension: IndexerExtension, ruleId: string, error: unknown): IndexDiagnostic {
  const message = formatThrown(error)
  return {
    id: diagnosticId('rule-failed', extension.name, ruleId, message),
    severity: 'warning',
    code: 'index.rule_failed',
    message: `Index rule ${extension.name}/${ruleId} failed: ${message}`,
    suggestedFix: 'Update or disable the failing indexer extension rule.',
  }
}

/**
 * Creates the diagnostic emitted for cross-extension rule id collisions.
 */
export function ruleConflictDiagnostic(ruleId: string, owners: readonly string[]): IndexDiagnostic {
  return {
    id: diagnosticId('rule-conflict', ruleId, ...owners),
    severity: 'warning',
    code: 'index.rule_conflict',
    message: `Index rule id "${ruleId}" is declared by multiple extensions (${owners.join(', ')}); conflicting rules were skipped.`,
    suggestedFix: 'Rename one rule so every extension rule id is globally unique.',
  }
}

function diagnosticId(kind: string, ...parts: readonly (string | undefined)[]): string {
  const stable = parts.filter((part): part is string => Boolean(part))
  return `diagnostic:index:${kind}:${stable.map(safeId).join(':')}:${fingerprint(stable)}`
}

function formatThrown(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    const json = JSON.stringify(error)
    if (json) return json
  } catch {
    // Fall through to the generic string conversion.
  }
  return String(error)
}
