/**
 * Project Model prompt-test discovery for the Quality runner.
 *
 * The runner uses the public Project Model read model plus any already-loaded
 * config module to find prompt values with colocated tests. It does not run
 * source projection itself; authored source discovery is owned by the native
 * Project Index pipeline.
 *
 * @module
 */

import { pathToFileURL } from 'node:url'
import type { AnyPrompt } from '@use-crux/core'
import type { ProjectModelDiagnostic, ResolvedProjectModel } from '@use-crux/core/project-index'
import { resolveProjectModel } from '@use-crux/indexer/host'

/** Prompts and prompt-test diagnostics discovered from Project Model evidence. */
export interface DiscoveredQualityPrompts {
  /** Prompt instances imported from model-visible modules or config exports. */
  readonly prompts: readonly AnyPrompt[]
  /** Diagnostics that should fail prompt-test collection before execution. */
  readonly diagnostics: readonly ProjectModelDiagnostic[]
}

/** Options for Quality prompt-test collection from Project Model evidence. */
export interface DiscoverQualityPromptTestsOptions {
  /** Project root used for Project Model resolution and model-visible imports. */
  readonly rootDir: string
  /** Crux config selected by the CLI, when one exists. */
  readonly configPath?: string
  /** Already-imported config module so prompt exports there reuse the same module instance. */
  readonly configModule?: Record<string, unknown>
}

/**
 * Discover prompt values that declare colocated Quality tests.
 *
 * The returned diagnostics are limited to prompt-test-blocking Project Model
 * diagnostics. This worker intentionally does not fall back to TypeScript
 * source projection when the Project Model has no source-derived definitions.
 */
export async function discoverQualityPromptTests(
  options: DiscoverQualityPromptTestsOptions,
): Promise<DiscoveredQualityPrompts> {
  const model = await resolveQualityProjectModel(options)
  const diagnostics = promptTestDiagnostics(model)
  const blockedFiles = new Set(
    diagnostics
      .map((diagnostic) => diagnostic.source?.file)
      .filter((file): file is string => typeof file === 'string' && file.length > 0),
  )
  const prompts = new Set<AnyPrompt>()
  const seen = new WeakSet<object>()

  if (options.configModule) {
    collectPromptExports(options.configModule, seen, prompts)
  }

  for (const file of promptSourceFiles(model)) {
    if (file === options.configPath || blockedFiles.has(file)) continue
    const moduleExports = (await import(pathToFileURL(file).href)) as Record<string, unknown>
    collectPromptExports(moduleExports, seen, prompts)
  }

  return { prompts: [...prompts], diagnostics }
}

async function resolveQualityProjectModel(options: DiscoverQualityPromptTestsOptions): Promise<ResolvedProjectModel> {
  return resolveProjectModel({
    root: options.rootDir,
    ...(options.configPath ? { configPath: options.configPath } : {}),
    resolutionMode: 'source-only',
  })
}

function promptTestDiagnostics(model: ResolvedProjectModel): readonly ProjectModelDiagnostic[] {
  return model.diagnostics.filter((diagnostic) => diagnostic.code === 'project_model.prompt_test_dependency_unproven')
}

function promptSourceFiles(model: ResolvedProjectModel): readonly string[] {
  return [
    ...new Set(
      model.definitions
        .filter((definition) => definition.kind === 'prompt')
        .map((definition) => definition.source?.file)
        .filter((file): file is string => typeof file === 'string' && file.length > 0 && !isEvaluationFile(file)),
    ),
  ].sort()
}

function isEvaluationFile(file: string): boolean {
  return /\.eval\.[cm]?[jt]sx?$/u.test(file)
}

function isPrompt(value: unknown): value is AnyPrompt {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { readonly _tag?: unknown })._tag === 'Prompt' &&
    'id' in value
  )
}

function isTraversableExport(value: unknown): value is object {
  if (value === null || typeof value !== 'object') return false
  if (isPrompt(value)) return true
  const prototype = Object.getPrototypeOf(value)
  return Array.isArray(value) || prototype === Object.prototype || prototype === null
}

function collectPromptExports(value: unknown, seen: WeakSet<object>, prompts: Set<AnyPrompt>): void {
  if (!isTraversableExport(value)) return
  if (seen.has(value)) return
  seen.add(value)

  if (isPrompt(value)) {
    prompts.add(value)
    return
  }

  for (const child of Object.values(value)) {
    collectPromptExports(child, seen, prompts)
  }
}
