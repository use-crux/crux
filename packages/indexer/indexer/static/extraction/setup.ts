import type { IndexerExtensionRuntime } from '../../extensions'
import type { IndexerExtension } from '../../extensions'
import type { ProjectIndexCompilerProfile } from '../../compiler/profile'
import type { StaticSyntaxCallInterest, StaticSyntaxConstructorInterest } from '../syntax-record'

const nativeRoutingPruneCalls = new Set(['router', 'cascade', 'fallback'])
const cruxCoreExtensionName = '@crux/indexer/crux-core'
const cruxCoreRoutingExtractor = 'routing'

/** Appends caller-provided extensions to a compiler profile without mutating the base profile. */
export function compilerProfileWithExtensions(
  profile: ProjectIndexCompilerProfile,
  extensions: readonly IndexerExtension[],
): ProjectIndexCompilerProfile {
  if (extensions.length === 0) return profile
  return {
    ...profile,
    extensions: [...profile.extensions, ...extensions],
  }
}

/** Computes source-local call names from extension manifests and compiler-owned projections. */
export function staticExtractionCallNames(
  profile: ProjectIndexCompilerProfile,
  extensionRuntime: IndexerExtensionRuntime,
): ReadonlySet<string> {
  return new Set([
    ...extensionRuntime.manifest.callNames,
    ...(profile.projections ?? []).flatMap((projection) => projection.staticCallNames ?? []),
  ])
}

/** Computes import-aware call interests from extension manifests and compiler-owned projections. */
export function staticExtractionCallInterests(
  profile: ProjectIndexCompilerProfile,
  extensionRuntime: IndexerExtensionRuntime,
): readonly StaticSyntaxCallInterest[] {
  return uniqueCallInterests([
    ...(extensionRuntime.manifest.staticInterests.calls ?? []),
    ...(profile.projections ?? []).flatMap((projection) =>
      (projection.staticCallNames ?? []).map((name) => ({ name })),
    ),
  ])
}

/** Computes import-aware constructor interests from extension manifests. */
export function staticExtractionConstructorInterests(
  extensionRuntime: IndexerExtensionRuntime,
): readonly StaticSyntaxConstructorInterest[] {
  return uniqueConstructorInterests(extensionRuntime.manifest.staticInterests.constructors ?? [])
}

/** Computes native-covered call names whose heavy match evidence is not needed by TS extractors. */
export function staticExtractionNativeFactPruneCallNames(
  extensionRuntime: IndexerExtensionRuntime,
): ReadonlySet<string> {
  const prunable = new Set<string>()
  for (const callName of nativeRoutingPruneCalls) {
    const interested = extensionRuntime.manifest.extractors.filter((extractor) =>
      extractor.patterns.some((pattern) => pattern.kind === 'call' && pattern.name === callName),
    )
    if (
      interested.length > 0 &&
      interested.every(
        (extractor) =>
          extractor.extension.name === cruxCoreExtensionName && extractor.name === cruxCoreRoutingExtractor,
      )
    ) {
      prunable.add(callName)
    }
  }
  return prunable
}

function uniqueCallInterests(interests: readonly StaticSyntaxCallInterest[]): readonly StaticSyntaxCallInterest[] {
  return [...new Map(interests.map((interest) => [interestKey(interest), normalizeInterest(interest)])).values()].sort(
    compareInterests,
  )
}

function uniqueConstructorInterests(
  interests: readonly StaticSyntaxConstructorInterest[],
): readonly StaticSyntaxConstructorInterest[] {
  return [...new Map(interests.map((interest) => [interestKey(interest), normalizeInterest(interest)])).values()].sort(
    compareInterests,
  )
}

function normalizeInterest<T extends StaticSyntaxCallInterest | StaticSyntaxConstructorInterest>(interest: T): T {
  return {
    ...interest,
    ...(interest.importFrom ? { importFrom: [...interest.importFrom].sort() } : {}),
  }
}

function interestKey(interest: StaticSyntaxCallInterest | StaticSyntaxConstructorInterest): string {
  return `${interest.name}:${(interest.importFrom ?? []).join('|')}`
}

function compareInterests(
  left: StaticSyntaxCallInterest | StaticSyntaxConstructorInterest,
  right: StaticSyntaxCallInterest | StaticSyntaxConstructorInterest,
): number {
  return interestKey(left).localeCompare(interestKey(right))
}
