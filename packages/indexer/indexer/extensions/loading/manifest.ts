import { createExtensionRegistry } from '../runtime/registry'
import type { ExtensionTrustPolicy, IndexerExtension } from '../public-contract/types'

export interface IndexerExtensionManifestValidation {
  readonly valid: boolean
  readonly errors: readonly string[]
}

/**
 * Validates one extension manifest by running it through the registry checks.
 */
export function validateIndexerExtensionManifest(
  extension: IndexerExtension,
): IndexerExtensionManifestValidation {
  try {
    createExtensionRegistry([extension])
    return { valid: true, errors: [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      valid: false,
      errors: message
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    }
  }
}

/**
 * Applies the configured trust policy to an extension identity.
 */
export function isIndexerExtensionAllowed(
  extension: Pick<IndexerExtension, 'name'>,
  policy: ExtensionTrustPolicy = { mode: 'first-party-only' },
): boolean {
  if (policy.deny?.includes(extension.name)) return false
  if (policy.mode === 'unsafe-local-dev') return true
  if (policy.mode === 'allowlisted') return policy.allow?.includes(extension.name) ?? false
  return extension.name === '@crux/indexer' || extension.name.startsWith('@crux/')
}
