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
  ProjectDefinition,
  ProjectConfigFile,
  ProjectModelDiagnostic,
  ProjectModelProvenance,
  ProjectRelation,
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
  definitions: readonly ProjectDefinition[],
  relations: readonly ProjectRelation[],
): readonly ProjectModelDiagnostic[] {
  const modelDiagnostics: ProjectModelDiagnostic[] = []
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]))

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

  modelDiagnostics.push(...promptTestRelationDiagnostics(relations, definitionsById))

  for (const finding of lintFindings) {
    const mapped = projectModelDiagnosticFromLintFinding(finding, definitionsById)
    if (mapped) modelDiagnostics.push(mapped)
  }

  return dedupeDiagnostics(modelDiagnostics)
}

function promptTestRelationDiagnostics(
  relations: readonly ProjectRelation[],
  definitionsById: ReadonlyMap<string, ProjectDefinition>,
): readonly ProjectModelDiagnostic[] {
  return relations.flatMap((relation) => {
    const prompt = definitionsById.get(relation.from)
    if (!prompt || !isTestedPrompt(prompt)) return []
    if (!isPromptInjectionRelation(relation.type)) return []
    if (relation.fidelity === 'resolved' && definitionsById.has(relation.to)) return []
    const source = relation.source ?? prompt.source
    return [
      {
        id: createProjectModelDiagnosticId(
          `diagnostic:project-model:project_model.prompt_test_dependency_unproven:${relation.id}`,
        ),
        code: 'project_model.prompt_test_dependency_unproven',
        severity: 'warning',
        message: `Prompt "${prompt.name}" has colocated prompt tests, but Crux cannot fully prove its ${relation.type} dependency "${relation.to}".`,
        ...(source ? { source } : {}),
        suggestedFix:
          'Make the prompt-test dependency a stable exported context or explicit import so source discovery can prove it.',
        provenance: source ? sourceProvenance(source) : runtimeProvenance('index relation'),
        details: {
          relationId: relation.id,
          relationType: relation.type,
          primaryDefinitionId: prompt.id,
          missingDefinitionId: relation.to,
          fidelity: relation.fidelity,
        },
      },
    ]
  })
}

function projectModelDiagnosticFromIndexDiagnostic(
  root: string,
  diagnostic: IndexDiagnostic,
): ProjectModelDiagnostic | undefined {
  switch (diagnostic.code) {
    case 'index.config_not_found':
      return undefined
    case 'index.source_only':
      if (!diagnostic.source) return undefined
      return {
        id: createProjectModelDiagnosticId(`diagnostic:project-model:source-only:${diagnostic.id}`),
        code: 'project_model.source_only_discovery',
        severity: 'info',
        message: 'Project Model resolution used source-only discovery and did not import the selected config file.',
        source: diagnostic.source,
        suggestedFix: 'Use config-policy resolution when explicit config policy should be included.',
        provenance: sourceProvenance(diagnostic.source),
      }
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

function projectModelDiagnosticFromLintFinding(
  finding: IndexLintFinding,
  definitionsById: ReadonlyMap<string, ProjectDefinition>,
): ProjectModelDiagnostic | undefined {
  switch (finding.ruleId) {
    case 'injection.dynamic_dependency':
    case 'injection.unresolved_target':
      return promptTestDependencyDiagnostic(finding, definitionsById)
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

function promptTestDependencyDiagnostic(
  finding: IndexLintFinding,
  definitionsById: ReadonlyMap<string, ProjectDefinition>,
): ProjectModelDiagnostic | undefined {
  const definition = finding.primaryDefinitionId ? definitionsById.get(finding.primaryDefinitionId) : undefined
  if (!definition || !isTestedPrompt(definition)) return undefined
  return projectModelDiagnosticFromActionableLint({
    finding,
    code: 'project_model.prompt_test_dependency_unproven',
    message: `Prompt "${definition.name}" has colocated prompt tests, but Crux cannot prove one of its source dependencies. ${finding.message}`,
    suggestedFix:
      'Make the prompt-test dependency a stable exported context or explicit import so source discovery can prove it.',
  })
}

function projectModelDiagnosticFromActionableLint(input: {
  readonly finding: IndexLintFinding
  readonly code: ProjectModelDiagnostic['code']
  readonly message?: string
  readonly suggestedFix: string
}): ProjectModelDiagnostic {
  return {
    id: createProjectModelDiagnosticId(`diagnostic:project-model:${input.code}:${input.finding.id}`),
    code: input.code,
    severity: input.finding.severity,
    message: input.message ?? input.finding.message,
    ...(input.finding.source ? { source: input.finding.source } : {}),
    suggestedFix: input.suggestedFix,
    provenance: input.finding.source ? sourceProvenance(input.finding.source) : runtimeProvenance('index lint'),
    details: lintFindingDetails(input.finding),
  }
}

function isTestedPrompt(definition: ProjectDefinition): boolean {
  return (
    definition.kind === 'prompt' && isRecord(definition.metadata?.facts) && definition.metadata.facts.hasTests === true
  )
}

function isPromptInjectionRelation(type: string): boolean {
  return type === 'prompt.uses_context' || type === 'prompt.uses_injectable'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
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
