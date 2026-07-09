/**
 * Worker-side discovery for `crux quality init`.
 *
 * The Go CLI owns file writes and terminal rendering. The worker owns runtime
 * source inspection because it already imports the user's TypeScript config and
 * can recognize first-party Crux primitives without duplicating policy in Go.
 *
 * @module
 */

import type { ProjectDefinitionKind, ProjectModelDefinition, ResolvedProjectModel } from '@use-crux/core/project-index'
import type { LoadedQualityProject } from './quality-config'

type QualityInitDefinitionKind = Extract<ProjectDefinitionKind, 'prompt' | 'agent' | 'flow' | 'rag.retriever'>

/** Importable source target that can seed a starter evaluation file. */
export interface QualityInitTarget {
  /** Project Index-style definition id, for example `prompt:support.answer`. */
  readonly definitionId: `${ProjectDefinitionKind}:${string}`
  /** Definition kind used by docs and CLI selection output. */
  readonly kind: QualityInitDefinitionKind
  /** Absolute source file containing the importable export. */
  readonly sourceFile: string
  /** Top-level named export to import from {@link sourceFile}. */
  readonly importName: string
  /** Expression used as `task:` after importing {@link importName}. */
  readonly taskExpression: string
  /** First authored prompt test input, when available, used to replace TODO input. */
  readonly sampleInput?: unknown
}

interface PromptLike {
  readonly _tag: 'Prompt'
  readonly id?: string
  readonly config?: {
    readonly tests?: readonly { readonly input?: unknown }[]
  }
}

/** Discover importable Quality init targets from the loaded project. */
export function discoverQualityInitTargets(project: LoadedQualityProject): QualityInitTarget[] {
  if (project.projectModel !== undefined) {
    return discoverProjectModelTargets(project)
  }
  if (project.configModule === undefined || project.configPath === undefined) return []
  return discoverConfigExportTargets(project)
}

function discoverConfigExportTargets(project: LoadedQualityProject): QualityInitTarget[] {
  const targets: QualityInitTarget[] = []
  const seen = new WeakSet<object>()
  for (const [exportName, value] of Object.entries(project.configModule ?? {})) {
    if (exportName === 'default' || !isIdentifier(exportName)) continue
    collectPromptTargets(value, {
      sourceFile: project.configPath ?? project.configDir,
      importName: exportName,
      expressionPath: [exportName],
      seen,
      targets,
    })
  }
  return dedupeTargets(targets)
}

function discoverProjectModelTargets(project: LoadedQualityProject): QualityInitTarget[] {
  const model = project.projectModel
  if (model === undefined) return []
  const covered = coveredDefinitionIds(model)
  const targets: QualityInitTarget[] = []
  for (const definition of model.definitions) {
    if (!isQualityInitDefinition(definition) || covered.has(definition.id)) continue
    const target = targetFromProjectModelDefinition(definition, project)
    if (target !== undefined) targets.push(target)
  }
  return dedupeTargets(targets)
}

function coveredDefinitionIds(model: ResolvedProjectModel): ReadonlySet<string> {
  return new Set(model.relations.filter((relation) => relation.type === 'eval.covers_definition').map((relation) => relation.to))
}

function isQualityInitDefinition(definition: ProjectModelDefinition): definition is ProjectModelDefinition & { readonly kind: QualityInitDefinitionKind } {
  return definition.kind === 'prompt' || definition.kind === 'agent' || definition.kind === 'flow' || definition.kind === 'rag.retriever'
}

function targetFromProjectModelDefinition(
  definition: ProjectModelDefinition & { readonly kind: QualityInitDefinitionKind },
  project: LoadedQualityProject,
): QualityInitTarget | undefined {
  const exportName = definitionExportName(definition)
  const sourceFile = definition.source?.file
  if (exportName === undefined || sourceFile === undefined || !isIdentifier(exportName)) return undefined
  const prompt = promptExport(project.configModule?.[exportName])
  return {
    definitionId: definition.id as `${ProjectDefinitionKind}:${string}`,
    kind: definition.kind,
    sourceFile,
    importName: exportName,
    taskExpression: exportName,
    ...(prompt !== undefined && sampleInputOf(prompt) !== undefined ? { sampleInput: sampleInputOf(prompt) } : {}),
  }
}

function definitionExportName(definition: ProjectModelDefinition): string | undefined {
  const provenance = definition.visibility.provenance
  return provenance.kind === 'source' && typeof provenance.exportName === 'string' && provenance.exportName.length > 0
    ? provenance.exportName
    : undefined
}

function collectPromptTargets(
  value: unknown,
  context: {
    readonly sourceFile: string
    readonly importName: string
    readonly expressionPath: readonly string[]
    readonly seen: WeakSet<object>
    readonly targets: QualityInitTarget[]
  },
): void {
  if (!isTraversable(value)) return
  if (context.seen.has(value)) return
  context.seen.add(value)

  if (isPrompt(value) && typeof value.id === 'string' && value.id.length > 0) {
    context.targets.push({
      definitionId: `prompt:${value.id}`,
      kind: 'prompt',
      sourceFile: context.sourceFile,
      importName: context.importName,
      taskExpression: expressionForPath(context.expressionPath),
      ...(sampleInputOf(value) !== undefined ? { sampleInput: sampleInputOf(value) } : {}),
    })
    return
  }

  for (const [key, child] of Object.entries(value)) {
    collectPromptTargets(child, {
      ...context,
      expressionPath: [...context.expressionPath, key],
    })
  }
}

function isPrompt(value: unknown): value is PromptLike {
  return value !== null && typeof value === 'object' && (value as { readonly _tag?: unknown })._tag === 'Prompt'
}

function promptExport(value: unknown): PromptLike | undefined {
  return isPrompt(value) ? value : undefined
}

function isTraversable(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  if (isPrompt(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sampleInputOf(prompt: PromptLike): unknown {
  return prompt.config?.tests?.find((test) => test.input !== undefined)?.input
}

function expressionForPath(path: readonly string[]): string {
  const [head, ...tail] = path
  if (head === undefined) return ''
  return [head, ...tail.map((part) => (isIdentifier(part) ? `.${part}` : `[${JSON.stringify(part)}]`))].join('')
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/u.test(value)
}

function dedupeTargets(targets: readonly QualityInitTarget[]): QualityInitTarget[] {
  const seen = new Set<string>()
  const out: QualityInitTarget[] = []
  for (const target of targets) {
    if (seen.has(target.definitionId)) continue
    seen.add(target.definitionId)
    out.push(target)
  }
  return out.sort((a, b) => a.definitionId.localeCompare(b.definitionId))
}
