import { pathToFileURL } from 'node:url'
import type { IndexDiagnostic } from '@use-crux/core/project-index'
import { compareCodepoint } from '../../sort'
import { isIndexerExtensionAllowed, validateIndexerExtensionManifest } from './manifest'
import {
  hasTraversalSegment,
  isPackageReferenceAllowed,
  resolveTrustedExtensionPackage,
} from './package-provenance'
import type { ExtensionReference, ExtensionTrustPolicy, IndexerExtension, IndexerExtensionConfig } from '../public-contract/types'

/**
 * Version of the experimental Indexer extension authoring surface understood by this package.
 *
 * Extension manifests compare against this value through `crux.indexer`. Bump it only when an
 * extension author must change their manifest or extractor/rule code to remain compatible.
 */
export const INDEXER_EXTENSION_API_VERSION = '0.1.0'
/**
 * Project Index schema version produced by this compiler.
 *
 * This guards extension manifests that depend on read-model fields or relation semantics. It is
 * intentionally separate from cache epochs: schema compatibility is an authoring contract, while
 * cache epochs are local invalidation levers.
 */
export const PROJECT_INDEX_SCHEMA_VERSION = 1

/**
 * Extension manifest that has already been obtained by trusted loader code.
 *
 * This resolver does not import packages. A future loader may turn `ExtensionReference` values into
 * these records after applying package-manager, workspace, or sandbox policy. Keeping the input as
 * plain data makes this module safe to exercise in tests and worker startup checks.
 */
export interface InstalledIndexerExtension {
  /** Package specifier from the user's config, for example `@acme/crux-indexer`. */
  readonly package: string
  /** Export name that produced the manifest. Defaults to `default`. */
  readonly export?: string
  /** Installed package version read from that package's nearest package.json. */
  readonly packageVersion?: string
  /** Data-first extension manifest contributed by that package/export pair. */
  readonly extension: IndexerExtension
}

interface NormalizedInstalledIndexerExtension extends InstalledIndexerExtension {
  readonly export: string
}

export interface ResolvedIndexerExtension {
  /** Normalized user config reference that selected this manifest. */
  readonly reference: ExtensionReference
  /** Installed package version used for the requested package-version check, when available. */
  readonly packageVersion?: string
  /** Validated manifest that may be handed to compiler profile construction. */
  readonly extension: IndexerExtension
}

export interface ResolveIndexerExtensionReferencesInput {
  /** Inert `config({ indexer })` data read from `@use-crux/core`. */
  readonly config?: IndexerExtensionConfig
  /**
   * Candidate manifests supplied by the caller.
   *
   * Passing manifests instead of package names keeps this function pure. Missing references are
   * reported as diagnostics; they are not imported here.
   */
  readonly installed?: readonly InstalledIndexerExtension[]
}

export interface ResolveIndexerExtensionReferencesResult {
  /** Manifests that passed reference matching, trust policy, version checks, and manifest validation. */
  readonly extensions: readonly ResolvedIndexerExtension[]
  /** Load diagnostics for references that were missing, denied, incompatible, or invalid. */
  readonly diagnostics: readonly IndexDiagnostic[]
}

export interface LoadIndexerExtensionReferencesInput {
  /** Project root used as the package-resolution base for configured extension packages. */
  readonly root: string
  /** Inert `config({ indexer })` data read from `@use-crux/core`. */
  readonly config?: IndexerExtensionConfig
}

/**
 * Resolve configured Indexer extension references against known manifests.
 *
 * This is the last pure gate before extension manifests can reach a compiler profile. It deliberately
 * returns diagnostics instead of throwing for expected project configuration problems, matching the
 * rest of the Project Index pipeline where degraded source intelligence should be explainable in the
 * index rather than crash the local dev server.
 *
 * The function is deterministic:
 *
 * - disabled references are ignored
 * - omitted exports normalize to `default`
 * - references are matched by `package#export`
 * - trust policy is checked before compatibility and manifest validation
 * - accepted manifests are returned sorted by extension name
 *
 * It is also intentionally not a loader. It does not call `import()`, inspect the filesystem, resolve
 * package versions from `node_modules`, or execute extension code.
 */
export function resolveIndexerExtensionReferences(
  input: ResolveIndexerExtensionReferencesInput = {},
): ResolveIndexerExtensionReferencesResult {
  const references = normalizeExtensionReferences(input.config?.extensions ?? [])
  const installed = normalizeInstalledExtensions(input.installed ?? [])
  const diagnostics: IndexDiagnostic[] = []
  const extensions: ResolvedIndexerExtension[] = []

  for (const reference of references) {
    const match = installed.find((candidate) => extensionReferenceKey(candidate) === extensionReferenceKey(reference))
    if (!match) {
      diagnostics.push(extensionLoadingDiagnostic('index.extension_not_found', reference, `Indexer extension ${formatReference(reference)} was not found.`))
      continue
    }

    if (!isIndexerExtensionAllowed(match.extension, input.config?.trust)) {
      diagnostics.push(
        extensionLoadingDiagnostic(
          'index.extension_not_allowed',
          reference,
          `Indexer extension ${match.extension.name} is not allowed by the active trust policy.`,
        ),
      )
      continue
    }

    const versionForRequest = match.packageVersion ?? match.extension.version
    if (reference.version && !satisfiesVersion(versionForRequest, reference.version)) {
      diagnostics.push(
        extensionLoadingDiagnostic(
          'index.extension_version_mismatch',
          reference,
          `Indexer extension package ${reference.package}@${versionForRequest} does not satisfy requested version ${reference.version}.`,
        ),
      )
      continue
    }

    const compatibilityError = compatibilityFailure(match.extension)
    if (compatibilityError) {
      diagnostics.push(extensionLoadingDiagnostic('index.extension_incompatible', reference, compatibilityError))
      continue
    }

    const manifest = validateIndexerExtensionManifest(match.extension)
    if (!manifest.valid) {
      diagnostics.push(
        extensionLoadingDiagnostic(
          'index.extension_invalid_manifest',
          reference,
          `Indexer extension ${match.extension.name} has an invalid manifest: ${manifest.errors.join(' ')}`,
        ),
      )
      continue
    }

    extensions.push({ reference, packageVersion: match.packageVersion, extension: match.extension })
  }

  return {
    extensions: extensions.sort((a, b) => compareCodepoint(a.extension.name, b.extension.name)),
    diagnostics,
  }
}

/**
 * Load configured Indexer extension packages from a project and validate their manifests.
 *
 * This is the dynamic counterpart to `resolveIndexerExtensionReferences(...)`. It performs only the
 * minimum effects needed to obtain manifests:
 *
 * - reject traversal-shaped package specifiers before import
 * - resolve packages from the project root with Node's normal package resolver
 * - read package identity and version from the nearest package.json
 * - verify the resolved entry stays inside the package root, including realpath checks
 * - import the selected package export
 * - hand the resulting manifests to the pure resolver for manifest-name trust, compatibility, and
 *   declaration validation
 *
 * There is no sandbox here. A package that passes provenance and trust preflight is trusted JavaScript
 * code. Stronger isolation would need a separate worker/process policy rather than a different helper
 * in this file.
 */
export async function loadIndexerExtensionReferences(
  input: LoadIndexerExtensionReferencesInput,
): Promise<ResolveIndexerExtensionReferencesResult> {
  const references = normalizeExtensionReferences(input.config?.extensions ?? [])
  const preflight = references.map((reference) => trustPreflight(reference, input.config?.trust))
  const preflightDiagnostics = preflight.flatMap((result) => result.diagnostic ?? [])
  const deniedReferences = new Set(
    preflight.filter((result) => result.diagnostic).map((result) => extensionReferenceKey(result.reference)),
  )
  const loadableReferences = references.filter((reference) => !deniedReferences.has(extensionReferenceKey(reference)))
  const loaded = await Promise.all(
    loadableReferences.map((reference) => loadOneIndexerExtension(input.root, reference, input.config?.trust)),
  )
  const installed = loaded.flatMap((result) => (result.installed ? [result.installed] : []))
  const installedKeys = new Set(installed.map(extensionReferenceKey))
  const resolvedReferences = loadableReferences.filter((reference) => installedKeys.has(extensionReferenceKey(reference)))
  const importDiagnostics = loaded.flatMap((result) => result.diagnostic ?? [])
  const resolved = resolveIndexerExtensionReferences({
    config: { ...input.config, extensions: resolvedReferences },
    installed,
  })

  return {
    extensions: resolved.extensions,
    diagnostics: [...preflightDiagnostics, ...importDiagnostics, ...resolved.diagnostics],
  }
}

/**
 * Imports one configured extension package/export from the project root.
 */
async function loadOneIndexerExtension(
  root: string,
  reference: ExtensionReference,
  policy: ExtensionTrustPolicy | undefined,
): Promise<{ readonly installed?: InstalledIndexerExtension; readonly diagnostic?: IndexDiagnostic }> {
  try {
    const trustedPackage = await resolveTrustedExtensionPackage({ root, reference, policy })
    if (!trustedPackage.ok) {
      return {
        diagnostic: extensionLoadingDiagnostic('index.extension_not_allowed', reference, trustedPackage.message),
      }
    }

    const mod = (await import(pathToFileURL(trustedPackage.package.entry).href)) as Record<string, unknown>
    const exportName = reference.export ?? 'default'
    const extension = mod[exportName]
    if (!isIndexerExtensionManifest(extension)) {
      return {
        diagnostic: extensionLoadingDiagnostic(
          'index.extension_invalid_manifest',
          reference,
          `Indexer extension ${formatReference(reference)} did not export an extension manifest.`,
        ),
      }
    }
    return {
      installed: {
        package: reference.package,
        export: exportName,
        ...(trustedPackage.package.packageVersion ? { packageVersion: trustedPackage.package.packageVersion } : {}),
        extension,
      },
    }
  } catch (error) {
    return {
      diagnostic: extensionLoadingDiagnostic(
        'index.extension_import_failed',
        reference,
        `Could not import Indexer extension ${formatReference(reference)}: ${errorMessage(error)}`,
      ),
    }
  }
}

/**
 * Evaluates the trust policy before importing a configured package.
 *
 * The returned reference is carried alongside the diagnostic so callers can exclude denied packages
 * without reverse-parsing diagnostic ids. Diagnostic ids are for humans and read models; control flow
 * should stay on typed values.
 */
function trustPreflight(
  reference: ExtensionReference,
  policy: ExtensionTrustPolicy | undefined,
): { readonly reference: ExtensionReference; readonly diagnostic?: IndexDiagnostic } {
  if (hasTraversalSegment(reference.package)) {
    return {
      reference,
      diagnostic: extensionLoadingDiagnostic(
        'index.extension_not_allowed',
        reference,
        `Indexer extension package ${reference.package} is not allowed because package specifiers cannot contain '..' path segments.`,
      ),
    }
  }
  if (isPackageReferenceAllowed(reference.package, policy)) return { reference }
  return {
    reference,
    diagnostic: extensionLoadingDiagnostic(
      'index.extension_not_allowed',
      reference,
      `Indexer extension package ${reference.package} is not allowed by the active trust policy.`,
    ),
  }
}

/**
 * Normalize references into the identity shape used by loader diagnostics and cache inputs.
 *
 * The user's config order should not affect compiler behavior, so sorting happens before any match or
 * validation work. Keeping disabled entries out of the normalized list also lets teams leave planned
 * extensions in config without changing the active compiler identity.
 */
function normalizeExtensionReferences(references: readonly ExtensionReference[]): readonly ExtensionReference[] {
  return references
    .filter((reference) => reference.enabled !== false)
    .map((reference) => ({ ...reference, export: reference.export ?? 'default' }))
    .sort((a, b) => compareCodepoint(extensionReferenceKey(a), extensionReferenceKey(b)))
}

/**
 * Normalizes installed extension descriptors to the same default export shape
 * used by config references.
 */
function normalizeInstalledExtensions(installed: readonly InstalledIndexerExtension[]): readonly NormalizedInstalledIndexerExtension[] {
  return installed.map((candidate) => ({ ...candidate, export: candidate.export ?? 'default' }))
}

/**
 * Builds the stable package/export key used for extension matching and sorting.
 */
function extensionReferenceKey(reference: Pick<ExtensionReference, 'package' | 'export'>): string {
  return `${reference.package}#${reference.export ?? 'default'}`
}

/**
 * Return the first compatibility problem that makes an extension unsafe for public loading.
 *
 * First-party/internal manifests may exist without a public compatibility block while the compiler is
 * still pre-launch. Public loading requires `crux.indexer` so third-party authors opt into a concrete
 * extension API version instead of relying on incidental TypeScript compatibility.
 */
function compatibilityFailure(extension: IndexerExtension): string | undefined {
  if (!extension.crux) {
    return `Indexer extension ${extension.name} must declare crux.indexer compatibility before public loading.`
  }
  if (!satisfiesVersion(INDEXER_EXTENSION_API_VERSION, extension.crux.indexer)) {
    return `Indexer extension ${extension.name} requires indexer ${extension.crux.indexer}, but this runtime exposes ${INDEXER_EXTENSION_API_VERSION}.`
  }
  if (
    extension.crux.projectIndexSchema != null &&
    extension.crux.projectIndexSchema !== PROJECT_INDEX_SCHEMA_VERSION
  ) {
    return `Indexer extension ${extension.name} requires Project Index schema ${extension.crux.projectIndexSchema}, but this runtime exposes ${PROJECT_INDEX_SCHEMA_VERSION}.`
  }
  return undefined
}

/**
 * Minimal semver-range check for the loader contract.
 *
 * The public API currently documents exact, `^`, `~`, and `*` ranges. If Crux later accepts npm-style
 * compound ranges, replace this helper with a dedicated semver dependency at the loader boundary.
 */
function satisfiesVersion(actual: string, range: string): boolean {
  const trimmed = range.trim()
  if (trimmed === '*' || trimmed === actual) return true
  if (trimmed.startsWith('^')) return sameMajor(actual, trimmed.slice(1))
  if (trimmed.startsWith('~')) return sameMajorMinor(actual, trimmed.slice(1))
  return false
}

/**
 * Returns whether two versions have the same major component.
 */
function sameMajor(a: string, b: string): boolean {
  return parseVersion(a).major === parseVersion(b).major
}

/**
 * Returns whether two versions have the same major and minor components.
 */
function sameMajorMinor(a: string, b: string): boolean {
  const left = parseVersion(a)
  const right = parseVersion(b)
  return left.major === right.major && left.minor === right.minor
}

/**
 * Parses the major/minor pieces needed by the loader's minimal range checker.
 */
function parseVersion(version: string): { readonly major: number; readonly minor: number } {
  const [major = '0', minor = '0'] = version.split('.')
  return {
    major: Number.parseInt(major, 10) || 0,
    minor: Number.parseInt(minor, 10) || 0,
  }
}

/**
 * Performs the minimal structural manifest check needed before registry
 * validation.
 */
function isIndexerExtensionManifest(value: unknown): value is IndexerExtension {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { name?: unknown; version?: unknown }
  return typeof candidate.name === 'string' && typeof candidate.version === 'string'
}

/**
 * Converts unknown thrown values into diagnostic-safe text.
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Creates a loader diagnostic for a rejected extension reference.
 */
function extensionLoadingDiagnostic(
  code: IndexDiagnostic['code'],
  reference: ExtensionReference,
  message: string,
): IndexDiagnostic {
  return {
    id: `${code}:${formatReference(reference)}`,
    code,
    severity: 'error',
    message,
  }
}

/**
 * Formats a package/export extension reference for diagnostics.
 */
function formatReference(reference: ExtensionReference): string {
  return `${reference.package}#${reference.export ?? 'default'}`
}
