import type { ProjectModelResolutionMode } from '@use-crux/core/project-index'
import { loadProjectConfig } from '../../config'
import {
  compilerProfileWithResolvedExtensions,
  createProjectIndexCompilerRuntime,
  cruxCoreCompilerProfile,
} from '../../compiler/profile'
import { loadIndexerExtensionReferences, type ResolvedIndexerExtension } from '../../extensions'
import {
  loadStaticExtensionHostManifest,
  type LoadStaticExtensionHostManifestInput,
  type LoadStaticExtensionHostManifestResult,
} from './evidence/host'
import { staticExtensionPackageCacheInputs, staticExtractionIdentity } from '../../static/extraction/identity'
import { OXC_STATIC_SYNTAX_FRONTEND_IDENTITY } from '../syntax/frontends/oxc'

/** Shared project config inputs for worker-hosted Static Index extension calls. */
export interface StaticIndexExtensionHostProjectInput {
  /** Project root used for config loading and extension package resolution. */
  readonly root: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Config loading mode used to resolve inert indexer extension settings. */
  readonly resolutionMode?: ProjectModelResolutionMode
}

/** Worker request for loading a data-only static extension host manifest. */
export interface LoadStaticExtensionHostManifestForProjectInput
  extends Pick<StaticIndexExtensionHostProjectInput, 'root' | 'configPath'> {
  /** Native compiler protocol version supported by the caller. */
  readonly nativeCompilerProtocolVersion: LoadStaticExtensionHostManifestInput['nativeCompilerProtocolVersion']
}

/**
 * Loads configured extension metadata and the exact static cache identity for Static Index planning.
 *
 * This boundary intentionally performs no source discovery, syntax planning, or cache lookup. Node
 * only executes user config and trusted extension package loading, then returns immutable manifest
 * data for the Go/Rust planner.
 */
export async function loadStaticExtensionHostManifestForProject(
  input: LoadStaticExtensionHostManifestForProjectInput,
): Promise<LoadStaticExtensionHostManifestResult> {
  const loaded = await loadProjectConfig(input.root, input.configPath, 'config-policy')
  const extensions = await loadIndexerExtensionReferences({
    root: input.root,
    config: loaded.loaded.indexer,
  })
  const result = await loadStaticExtensionHostManifest({
    root: input.root,
    extensions: extensions.extensions.map((entry) => entry.extension),
    nativeCompilerProtocolVersion: input.nativeCompilerProtocolVersion,
  })

  return {
    ...result,
    cacheInputs: staticIndexExtensionCacheInputs(extensions.extensions),
    diagnostics: [...loaded.diagnostics, ...extensions.diagnostics, ...result.diagnostics],
  }
}

function staticIndexExtensionCacheInputs(extensions: readonly ResolvedIndexerExtension[]) {
  const profile = compilerProfileWithResolvedExtensions(cruxCoreCompilerProfile, extensions)
  const runtime = createProjectIndexCompilerRuntime(profile)
  return staticExtractionIdentity({
    profile: runtime.profile,
    extensionRuntime: runtime.extensionRuntime,
    syntaxFrontend: OXC_STATIC_SYNTAX_FRONTEND_IDENTITY,
    additionalCacheInputs: staticExtensionPackageCacheInputs(
      extensions.map((extension) => ({
        packageName: extension.reference.package,
        exportName: extension.reference.export,
        packageVersion: extension.packageVersion,
      })),
    ),
  }).cacheInputs
}
