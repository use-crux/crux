/**
 * Go Project Index vocabulary guards for the Rust/Go architecture cleanup.
 *
 * The guards are narrow by design: they allow old names only in the files
 * that are waiting for a later migration phase, while new source files must
 * use the target package vocabulary immediately.
 *
 * @module
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join, relative } from 'node:path'

/** Deprecated Go Project Index term covered by this architecture guard. */
export type DeprecatedProjectIndexGoTerm = 'indexwire'

/** Target replacement for a deprecated Go Project Index term. */
export type ProjectIndexGoReplacement<TTerm extends DeprecatedProjectIndexGoTerm> = TTerm extends 'indexwire'
  ? 'requestwire'
  : never

/** Reorg phase that owns removal of a deprecated Go Project Index term. */
export type ProjectIndexGoTargetPhase = 4

/** One deprecated term and the migration surface where it may still appear. */
export interface ProjectIndexGoVocabularyGuard<
  TTerm extends DeprecatedProjectIndexGoTerm = DeprecatedProjectIndexGoTerm,
> {
  /** Deprecated literal term that should not be used by new source code. */
  readonly term: TTerm
  /** Final vocabulary that replaces this term. */
  readonly replacement: ProjectIndexGoReplacement<TTerm>
  /** Phase that removes the currently allowed occurrences. */
  readonly targetedPhase: ProjectIndexGoTargetPhase
  /** Repository-relative source paths where the term is intentionally retained until its phase. */
  readonly allowedPaths: readonly string[]
}

/** One unexpected file or line where a deprecated Go Project Index term appears. */
export interface ProjectIndexGoVocabularyMatch {
  /** Repository-relative file path. */
  readonly path: string
  /** One-based line number for content matches. File-path matches omit this. */
  readonly line?: number
  /** Whether the term was found in the file path or file contents. */
  readonly source: 'path' | 'content'
}

/** Scan result for one deprecated Go Project Index term. */
export interface ProjectIndexGoVocabularyObservation<
  TTerm extends DeprecatedProjectIndexGoTerm = DeprecatedProjectIndexGoTerm,
> {
  /** Guard that produced this observation. */
  readonly guard: ProjectIndexGoVocabularyGuard<TTerm>
  /** Unexpected matches outside the current migration allowlist. */
  readonly matches: readonly ProjectIndexGoVocabularyMatch[]
}

/** Go Project Index vocabulary guards in phase order. */
export const projectIndexGoVocabularyGuards = [
  {
    // Phase 4 renamed `host/indexwire` to `workers/requestwire`, so the
    // deprecated `indexwire` term must no longer appear in any non-test source
    // file. The allowlist is intentionally empty: there is no remaining
    // migration surface.
    term: 'indexwire',
    replacement: 'requestwire',
    targetedPhase: 4,
    allowedPaths: [],
  },
] as const satisfies readonly ProjectIndexGoVocabularyGuard[]

/**
 * Collect unexpected deprecated Go Project Index vocabulary matches.
 *
 * @param repoRoot - Absolute repository root.
 * @returns Sorted observations, one per guard.
 */
export function collectProjectIndexGoVocabularyObservations(
  repoRoot: string,
): readonly ProjectIndexGoVocabularyObservation[] {
  return projectIndexGoVocabularyGuards.map((guard) => ({
    guard,
    matches: collectMatches(repoRoot, guard),
  }))
}

function collectMatches(
  repoRoot: string,
  guard: ProjectIndexGoVocabularyGuard,
): readonly ProjectIndexGoVocabularyMatch[] {
  const root = join(repoRoot, 'packages/local/internal')
  const matches: ProjectIndexGoVocabularyMatch[] = []
  if (existsSync(root)) collectMatchesInDirectory(repoRoot, root, guard, matches)
  return matches.sort((a, b) => {
    const pathOrder = a.path.localeCompare(b.path)
    if (pathOrder !== 0) return pathOrder
    return (a.line ?? 0) - (b.line ?? 0)
  })
}

function collectMatchesInDirectory(
  repoRoot: string,
  directory: string,
  guard: ProjectIndexGoVocabularyGuard,
  matches: ProjectIndexGoVocabularyMatch[],
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
  guard: ProjectIndexGoVocabularyGuard,
  matches: ProjectIndexGoVocabularyMatch[],
): void {
  const repoPath = toRepoPath(repoRoot, absolutePath)
  if (isAllowedPath(repoPath, guard)) return

  if (repoPath.includes(guard.term)) {
    matches.push({ path: repoPath, source: 'path' })
  }

  const source = readFileSync(absolutePath, 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (!line.includes(guard.term)) return
    matches.push({ path: repoPath, line: index + 1, source: 'content' })
  })
}

function shouldInspectDirectory(repoPath: string): boolean {
  return ![
    'packages/local/internal/assets/embed',
    'packages/local/internal/assets/ui-embed',
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
  return ['.go', '.ts', '.tsx', '.js', '.mjs', '.json'].includes(extname(repoPath))
}

function isAllowedPath(repoPath: string, guard: ProjectIndexGoVocabularyGuard): boolean {
  return guard.allowedPaths.some((path) => repoPath === path || repoPath.startsWith(`${path}/`))
}

function toRepoPath(repoRoot: string, absolutePath: string): string {
  return relative(repoRoot, absolutePath).replaceAll('\\', '/')
}
