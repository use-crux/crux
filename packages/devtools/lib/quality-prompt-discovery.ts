/**
 * Source-discovered prompt-test discovery for the Quality runner.
 *
 * The runner uses the public Project Model read model to find prompt source
 * files instead of asking users to register prompts in `crux.config.ts`.
 * Prompt-test dependency diagnostics are returned before importing prompt
 * modules so definition errors stay actionable and do not collapse into raw
 * JavaScript import failures.
 *
 * @module
 */

import { pathToFileURL } from 'node:url'
import type { AnyPrompt } from '@crux/core'
import type { ProjectModelDiagnostic, ResolvedProjectModel } from '@crux/core/project-index'
import { resolveProjectModel } from '@crux/indexer'

/** Prompts and prompt-test diagnostics discovered from project source. */
export interface DiscoveredQualityPrompts {
  /** Prompt instances imported from source-visible prompt modules. */
  readonly prompts: readonly AnyPrompt[]
  /** Diagnostics that should fail prompt-test collection before execution. */
  readonly diagnostics: readonly ProjectModelDiagnostic[]
}

/** Options for source-discovered Quality prompt-test collection. */
export interface DiscoverQualityPromptTestsOptions {
  /** Project root used for Project Model resolution and module imports. */
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
 * diagnostics. Informational project facts such as source-only discovery stay
 * on `crux config inspect` and do not fail Quality collection.
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
