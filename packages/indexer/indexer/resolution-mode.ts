/**
 * Project Model resolution-mode helpers for indexer boundaries.
 *
 * Public contracts live in `@crux/core/project-index`; this module keeps the
 * indexer-specific defaults and permission checks close to the compiler and
 * worker request handling code.
 *
 * @module
 */

import { isProjectModelResolutionMode, type ProjectModelResolutionMode } from '@crux/core/project-index'

/** Default mode for Project Model and snapshot callers that may load config policy but not authored source modules. */
export const DEFAULT_PROJECT_MODEL_RESOLUTION_MODE = 'config-policy' satisfies ProjectModelResolutionMode

/** Default mode for configuration inspection. */
export const DEFAULT_CONFIG_INSPECT_RESOLUTION_MODE = 'config-policy' satisfies ProjectModelResolutionMode

/**
 * Return a valid resolution mode, falling back to the supplied default.
 *
 * Use this at JSON or loosely typed worker boundaries where values arrive as
 * `unknown`; typed package APIs should accept {@link ProjectModelResolutionMode}
 * directly and let TypeScript reject invalid literals.
 */
export function projectModelResolutionModeOrDefault(
  value: unknown,
  fallback: ProjectModelResolutionMode = DEFAULT_PROJECT_MODEL_RESOLUTION_MODE,
): ProjectModelResolutionMode {
  return isProjectModelResolutionMode(value) ? value : fallback
}

/** Whether resolving this mode may import the selected Crux config file. */
export function resolutionModeImportsConfig(mode: ProjectModelResolutionMode): boolean {
  return mode !== 'source-only'
}

/** Whether resolving this mode may import discovered authored source modules. */
export function resolutionModeImportsSource(mode: ProjectModelResolutionMode): boolean {
  return mode === 'runtime-rich'
}

/**
 * Config inspection never imports authored source modules.
 *
 * `semantic` and `runtime-rich` requests are reduced to `config-policy` at this
 * boundary because the inspect read model represents config policy, not runtime
 * observations.
 */
export function configInspectResolutionMode(mode: ProjectModelResolutionMode | undefined): ProjectModelResolutionMode {
  return mode === 'source-only' ? 'source-only' : DEFAULT_CONFIG_INSPECT_RESOLUTION_MODE
}
