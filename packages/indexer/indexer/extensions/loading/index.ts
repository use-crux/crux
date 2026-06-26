/**
 * Indexer Extension package loading and manifest validation.
 *
 * This boundary owns trust-policy checks, installed package validation, and
 * manifest reference resolution before trusted extension code is imported.
 *
 * @module
 */

export { isIndexerExtensionAllowed, validateIndexerExtensionManifest } from './manifest'
export {
  INDEXER_EXTENSION_API_VERSION,
  loadIndexerExtensionReferences,
  PROJECT_INDEX_SCHEMA_VERSION,
  resolveIndexerExtensionReferences,
  type InstalledIndexerExtension,
  type LoadIndexerExtensionReferencesInput,
  type ResolvedIndexerExtension,
  type ResolveIndexerExtensionReferencesInput,
  type ResolveIndexerExtensionReferencesResult,
} from './references'
export type { IndexerExtensionManifestValidation } from './manifest'

