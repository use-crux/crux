/**
 * Project Model diagnostic projection for local Crux tooling.
 *
 * Index diagnostics describe scanner/runtime facts, and lint findings describe
 * actionable source-shape risks. This module translates the small subset that
 * belongs in the user-facing Project Model into stable diagnostic codes with
 * JSON-safe provenance.
 *
 * @module
 */

import type {
  IndexDiagnostic,
  IndexLintFinding,
  ProjectConfigFile,
  ProjectModelDiagnostic,
  ProjectModelProvenance,
  SourceLocation,
} from '@crux/core/project-index'
import { createProjectModelDiagnosticId } from '@crux/core/project-index'

/**
 * Build Project Model diagnostics from the resolved config state, index
 * diagnostics, and selected actionable lint findings.
 */
export function projectModelDiagnostics(
  root: string,
  configFiles: readonly ProjectConfigFile[],
  diagnostics: readonly IndexDiagnostic[],
  lintFindings: readonly IndexLintFinding[],
): readonly ProjectModelDiagnostic[] {
  const modelDiagnostics: ProjectModelDiagnostic[] = []

  if (configFiles.some((configFile) => configFile.status.value === 'missing')) {
    modelDiagnostics.push({
      id: createProjectModelDiagnosticId('diagnostic:project-model:source-only'),
      code: 'project_model.source_only_discovery',
      severity: 'info',
      message: 'No Crux config file was found; Project Model resolution is using source discovery only.',
      suggestedFix: 'Add Crux config only when you need explicit policy, trust, persistence, telemetry, or overrides.',
      provenance: filesystemProvenance(root, 'crux config search'),
    })
  }

  for (const diagnostic of diagnostics) {
    const mapped = projectModelDiagnosticFromIndexDiagnostic(root, diagnostic)
    if (mapped) modelDiagnostics.push(mapped)
  }

  for (const finding of lintFindings) {
    const mapped = projectModelDiagnosticFromLintFinding(finding)
    if (mapped) modelDiagnostics.push(mapped)
  }

  return dedupeDiagnostics(modelDiagnostics)
}

function projectModelDiagnosticFromIndexDiagnostic(
  root: string,
  diagnostic: IndexDiagnostic,
): ProjectModelDiagnostic | undefined {
  switch (diagnostic.code) {
    case 'index.config_not_found':
      return undefined
    case 'index.config_import_failed':
      return {
        id: createProjectModelDiagnosticId(`diagnostic:project-model:config-import:${diagnostic.id}`),
        code: 'project_model.config_import_failed',
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.source ? { source: diagnostic.source } : {}),
        ...(diagnostic.suggestedFix ? { suggestedFix: diagnostic.suggestedFix } : {}),
        provenance: diagnostic.source
          ? sourceProvenance(diagnostic.source)
          : filesystemProvenance(root, 'crux config import'),
      }
    case 'index.source_too_large':
      return {
        id: createProjectModelDiagnosticId(`diagnostic:project-model:source-skipped:${diagnostic.id}`),
        code: 'project_model.source_skipped',
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.source ? { source: diagnostic.source } : {}),
        ...(diagnostic.suggestedFix ? { suggestedFix: diagnostic.suggestedFix } : {}),
        provenance: diagnostic.source ? sourceProvenance(diagnostic.source) : filesystemProvenance(root, 'source skip'),
      }
    default:
      return undefined
  }
}

function projectModelDiagnosticFromLintFinding(finding: IndexLintFinding): ProjectModelDiagnostic | undefined {
  switch (finding.ruleId) {
    case 'injection.dynamic_tools':
      return projectModelDiagnosticFromActionableLint({
        finding,
        code: 'project_model.dynamic_tool_map_unproven',
        suggestedFix:
          'Expose stable tool names or static tool maps when review, replay, or eval setup needs source-visible tools.',
      })
    case 'routing.missing_stable_id':
      return projectModelDiagnosticFromActionableLint({
        finding,
        code: 'project_model.missing_stable_id',
        suggestedFix: 'Add a stable id so source definitions, runtime spans, and Quality history can join reliably.',
      })
    default:
      return undefined
  }
}

function projectModelDiagnosticFromActionableLint(input: {
  readonly finding: IndexLintFinding
  readonly code: ProjectModelDiagnostic['code']
  readonly suggestedFix: string
}): ProjectModelDiagnostic {
  return {
    id: createProjectModelDiagnosticId(`diagnostic:project-model:${input.code}:${input.finding.id}`),
    code: input.code,
    severity: input.finding.severity,
    message: input.finding.message,
    ...(input.finding.source ? { source: input.finding.source } : {}),
    suggestedFix: input.suggestedFix,
    provenance: input.finding.source ? sourceProvenance(input.finding.source) : runtimeProvenance('index lint'),
    details: lintFindingDetails(input.finding),
  }
}

function lintFindingDetails(finding: IndexLintFinding): Record<string, unknown> {
  return {
    ruleId: finding.ruleId,
    lintFindingId: finding.id,
    relatedDefinitionIds: finding.relatedDefinitionIds,
    ...(finding.primaryDefinitionId ? { primaryDefinitionId: finding.primaryDefinitionId } : {}),
    ...(finding.docsUrl ? { docsUrl: finding.docsUrl } : {}),
  }
}

function dedupeDiagnostics(diagnostics: readonly ProjectModelDiagnostic[]): readonly ProjectModelDiagnostic[] {
  const byId = new Map<string, ProjectModelDiagnostic>()
  for (const diagnostic of diagnostics) {
    byId.set(diagnostic.id, diagnostic)
  }
  return [...byId.values()]
}

function sourceProvenance(source: SourceLocation): ProjectModelProvenance {
  return { kind: 'source', file: source.file }
}

function filesystemProvenance(path: string, convention: string): ProjectModelProvenance {
  return { kind: 'filesystem', path, convention }
}

function runtimeProvenance(attribute: string): ProjectModelProvenance {
  return { kind: 'runtime', attribute }
}
