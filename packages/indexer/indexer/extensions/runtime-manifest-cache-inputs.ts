import { createHash } from 'node:crypto'
import type { ExtensionRuntimeManifest } from './runtime'
import type { IndexDependency } from './types'

type JsonPrimitive = string | number | boolean | null
type StableJsonValue = JsonPrimitive | readonly StableJsonValue[] | { readonly [key: string]: StableJsonValue }

/**
 * Returns cache dependencies for manifest data that affects static output but is not captured by
 * source/config hashes.
 *
 * Package versions remain the public contract for released extensions. The digest entries protect
 * local development, first-party primitive coverage changes, relation policy edits, and declared
 * evidence changes from being hidden by a warm static parse cache.
 */
export function runtimeManifestCacheInputs(manifest: ExtensionRuntimeManifest): readonly IndexDependency[] {
  return Object.freeze([
    ...manifest.extensions.map((extension) => ({
      kind: 'extension-manifest' as const,
      name: extension.name,
      version: extension.version,
      digest: manifestDigest(extensionManifestPayload(manifest, extension.name)),
    })),
    {
      kind: 'static-evidence-manifest',
      name: 'runtime-static-interests',
      digest: manifestDigest(manifest.staticInterests),
    },
    {
      kind: 'relation-policy',
      name: 'runtime-relation-specs',
      digest: manifestDigest(manifest.relationSpecs),
    },
    {
      kind: 'native-primitive-manifest',
      name: 'crux-native-static-host',
      version: '1',
      digest: manifestDigest(manifest.staticHost),
    },
  ])
}

/**
 * Hashes a manifest through a stable JSON projection.
 *
 * `JSON.stringify` preserves authoring order for object keys, so hashing it directly would make
 * semantically identical manifests produce different cache identities. The stable projection sorts
 * object keys recursively while preserving array order after registry normalization.
 */
function manifestDigest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stableJson(value))).digest('hex')
}

function extensionManifestPayload(manifest: ExtensionRuntimeManifest, extensionName: string): StableJsonValue {
  return {
    extractors: manifest.extractors
      .filter((extractor) => extractor.extension.name === extensionName)
      .map((extractor) => ({
        name: extractor.name,
        patterns: stableJson(extractor.patterns),
      })),
  }
}

function stableJson(value: unknown): StableJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(stableJson)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableJson(item)]),
    )
  }
  return null
}
