/**
 * Static Index naming guards for the pre-launch runtime reorg.
 *
 * The guards are test-owned on purpose: Phase 1 records the old vocabulary
 * that later phases must remove, while some implementation surfaces still keep
 * those names in live files. The source scanner gives future phases a narrow
 * place to tighten the rules from "identified" to "gone".
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

/** Replacement vocabulary for each old Static Index term. */
export interface StaticIndexVocabularyReplacementMap {
  /** Implementation-first source-only compiler name. */
  readonly 'native-static': 'static-index'
  /** Public config field that names the parser implementation instead of the product lane. */
  readonly nativeAst: 'staticIndex' | 'staticSyntax' | 'oxcSyntax'
  /** Old Go package noun for code that hosts Project Index work instead of compiling it. */
  readonly projectindexer: 'projectindex'
  /** Rust module name to keep only for protocol ABI files until the protocol rename phase. */
  readonly native_static: 'static_index'
}

/** Old vocabulary term covered by the Static Index reorg guard. */
export type DeprecatedStaticIndexTerm = keyof StaticIndexVocabularyReplacementMap

/** Target replacement term for a specific deprecated Static Index term. */
export type StaticIndexReplacement<TTerm extends DeprecatedStaticIndexTerm> =
  StaticIndexVocabularyReplacementMap[TTerm]

/** Reorg phase that owns at least one removal for a deprecated term. */
export type StaticIndexTargetPhase = 2 | 4 | 5 | 6 | 7

/** Source root scanned by the naming guard. */
export type StaticIndexGuardRoot = 'packages/indexer/indexer' | 'packages/local/internal' | 'crates'

/** One deprecated term, its target vocabulary, and the source roots where it may still appear. */
export interface StaticIndexVocabularyGuard<TTerm extends DeprecatedStaticIndexTerm = DeprecatedStaticIndexTerm> {
  /** Deprecated literal term that should not survive the completed reorg. */
  readonly term: TTerm
  /** Final vocabulary that replaces this term. */
  readonly replacements: readonly StaticIndexReplacement<TTerm>[]
  /** Ordered phase numbers that will remove the term from at least one implementation surface. */
  readonly targetedPhases: readonly StaticIndexTargetPhase[]
  /** Implementation roots where the term is currently meaningful enough to scan. */
  readonly roots: readonly StaticIndexGuardRoot[]
  /** Protocol ABI paths that may keep the old Rust module name until the protocol phase. */
  readonly protocolOnlyPaths?: readonly string[]
}

/** One file or line where a deprecated term appears in a scanned implementation root. */
export interface StaticIndexVocabularyMatch {
  /** Repository-relative file path. */
  readonly path: string
  /** One-based line number for content matches. File-path matches omit this. */
  readonly line?: number
  /** Whether the term was found in the file path or file contents. */
  readonly source: 'path' | 'content'
  /** True when the match is inside a protocol ABI file intentionally deferred to Phase 7. */
  readonly protocolOnly: boolean
}

/** Scan result for one deprecated vocabulary guard. */
export interface StaticIndexVocabularyObservation<TTerm extends DeprecatedStaticIndexTerm = DeprecatedStaticIndexTerm> {
  /** Guard that produced this observation. */
  readonly guard: StaticIndexVocabularyGuard<TTerm>
  /** Sorted matches in implementation roots, excluding generated files and tests. */
  readonly matches: readonly StaticIndexVocabularyMatch[]
}

type GuardTerm<TGuards extends readonly StaticIndexVocabularyGuard[]> = TGuards[number]['term']

type MissingStaticIndexGuardTerm<TGuards extends readonly StaticIndexVocabularyGuard[]> = Exclude<
  DeprecatedStaticIndexTerm,
  GuardTerm<TGuards>
>

type RequireEveryStaticIndexGuardTerm<TGuards extends readonly StaticIndexVocabularyGuard[]> = [
  MissingStaticIndexGuardTerm<TGuards>,
] extends [never]
  ? unknown
  : {
      readonly missingStaticIndexGuardTerm: MissingStaticIndexGuardTerm<TGuards>
    }

/** Static Index naming guard fixtures in the order later phases should revisit them. */
export const staticIndexVocabularyGuards = defineStaticIndexVocabularyGuards([
  {
    term: 'native-static',
    replacements: ['static-index'],
    targetedPhases: [2, 5, 6, 7],
    roots: ['packages/indexer/indexer', 'packages/local/internal', 'crates'],
  },
  {
    term: 'nativeAst',
    replacements: ['staticIndex', 'staticSyntax', 'oxcSyntax'],
    targetedPhases: [2, 5, 7],
    roots: ['packages/indexer/indexer', 'packages/local/internal'],
  },
  {
    term: 'projectindexer',
    replacements: ['projectindex'],
    targetedPhases: [4, 5],
    roots: ['packages/local/internal'],
  },
  {
    term: 'native_static',
    replacements: ['static_index'],
    targetedPhases: [6, 7],
    roots: ['crates'],
    protocolOnlyPaths: ['crates/protocol/src/native_static.rs'],
  },
])

/**
 * Collect implementation matches for every Static Index vocabulary guard.
 *
 * Generated embed/UI bundles and test files are ignored so this function
 * measures source surfaces that future phases actually need to rename.
 *
 * @param repoRoot - Absolute repository root.
 * @returns Sorted observations, one per guard.
 */
export function collectStaticIndexVocabularyObservations(
  repoRoot: string,
): readonly StaticIndexVocabularyObservation[] {
  return staticIndexVocabularyGuards.map((guard) => ({
    guard,
    matches: collectMatches(repoRoot, guard),
  }))
}

function defineStaticIndexVocabularyGuards<const TGuards extends readonly StaticIndexVocabularyGuard[]>(
  guards: TGuards & RequireEveryStaticIndexGuardTerm<TGuards>,
): TGuards {
  return guards
}

function collectMatches(
  repoRoot: string,
  guard: StaticIndexVocabularyGuard,
): readonly StaticIndexVocabularyMatch[] {
  const matches: StaticIndexVocabularyMatch[] = []

  for (const root of guard.roots) {
    const absoluteRoot = join(repoRoot, root)
    if (!existsSync(absoluteRoot)) continue
    collectMatchesInDirectory(repoRoot, absoluteRoot, guard, matches)
  }

  return matches.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path)
    if (pathOrder !== 0) return pathOrder
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

function collectMatchesInDirectory(
  repoRoot: string,
  directory: string,
  guard: StaticIndexVocabularyGuard,
  matches: StaticIndexVocabularyMatch[],
): void {
  for (const entry of readdirSync(directory)) {
    const absolutePath = join(directory, entry)
    const stats = statSync(absolutePath)
    const repoPath = toRepoPath(repoRoot, absolutePath)

    if (stats.isDirectory()) {
      if (!shouldInspectDirectory(repoPath)) continue
      collectMatchesInDirectory(repoRoot, absolutePath, guard, matches)
      continue
    }

    if (!stats.isFile() || !shouldInspectFile(repoPath, stats.size)) continue
    collectMatchesInFile(repoRoot, absolutePath, guard, matches)
  }
}

function collectMatchesInFile(
  repoRoot: string,
  absolutePath: string,
  guard: StaticIndexVocabularyGuard,
  matches: StaticIndexVocabularyMatch[],
): void {
  const repoPath = toRepoPath(repoRoot, absolutePath)
  const protocolOnly = isProtocolOnlyPath(repoPath, guard)

  if (repoPath.includes(guard.term)) {
    matches.push({ path: repoPath, source: 'path', protocolOnly })
  }

  const source = readFileSync(absolutePath, 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.includes(guard.term)) return
    matches.push({ path: repoPath, line: index + 1, source: 'content', protocolOnly })
  })
}

function shouldInspectDirectory(repoPath: string): boolean {
  return ![
    'packages/local/internal/server/embed',
    'packages/local/internal/server/ui-embed',
    'target',
    'node_modules',
    'dist',
    '.turbo',
  ].some((ignored) => repoPath === ignored || repoPath.startsWith(`${ignored}/`))
}

function shouldInspectFile(repoPath: string, size: number): boolean {
  if (size > 1_000_000) return false
  if (repoPath.endsWith('.test.ts') || repoPath.endsWith('_test.go') || repoPath.endsWith('_tests.rs')) {
    return false
  }
  return ['.ts', '.tsx', '.js', '.mjs', '.json', '.go', '.rs', '.toml'].includes(extname(repoPath))
}

function isProtocolOnlyPath(repoPath: string, guard: StaticIndexVocabularyGuard): boolean {
  return Boolean(guard.protocolOnlyPaths?.some((path) => repoPath === path || repoPath.startsWith(`${path}/`)))
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll('\\', '/')
}
