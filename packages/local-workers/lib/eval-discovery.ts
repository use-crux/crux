/** Eval source discovery and selector resolution for the V3 coordinator. */

import type * as EvalRunnerCore from '@use-crux/core/eval/internal/runner'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { glob } from 'tinyglobby'

/** The project-local Core tooling contract used by discovery. */
export type EvalRunner = typeof EvalRunnerCore

export interface EvalModule {
  readonly relativeFile: string
  readonly exports: Readonly<Record<string, unknown>>
}

export interface EvalSourceKey {
  readonly relativeFile: string
  readonly export: 'default'
}

export interface DiscoveredEval {
  readonly id: string
  readonly eval: EvalRunnerCore.AnyEval
  readonly sourceKey: EvalSourceKey
  readonly sidecarFile: string
  readonly links: readonly string[]
}

export interface EvalDiscoveryError {
  readonly file: string
  readonly message: string
  readonly exports?: readonly string[]
}

export interface EvalDiscoveryResult {
  readonly evals: readonly DiscoveredEval[]
  readonly errors: readonly EvalDiscoveryError[]
}

/** Discover and import project Eval modules by the V1 source convention. */
export async function discoverProjectEvals(options: {
  readonly projectRoot: string
  readonly core: EvalRunner
}): Promise<EvalDiscoveryResult> {
  const files = await glob('**/*.eval.{ts,tsx,mts,cts,js,jsx,mjs,cjs}', {
    cwd: options.projectRoot,
    absolute: false,
    ignore: ['**/node_modules/**', '**/dist/**', '**/.crux/**'],
  })
  const modules: EvalModule[] = []
  const errors: EvalDiscoveryError[] = []
  for (const file of [...new Set(files)].sort()) {
    const relativeFile = normalizePath(file)
    try {
      modules.push({
        relativeFile,
        exports: (await import(pathToFileURL(resolve(options.projectRoot, file)).href)) as Record<string, unknown>,
      })
    } catch (error) {
      errors.push({ file: relativeFile, message: `Failed to import ${relativeFile}: ${errorMessage(error)}` })
    }
  }
  const collected = await collectEvalModules({ ...options, modules })
  return Object.freeze({
    evals: collected.evals,
    errors: Object.freeze([...errors, ...collected.errors]),
  })
}

/** Derive a simple Eval id from a project-relative `*.eval.*` source path. */
export function deriveEvalId(relativeFile: string): string {
  const normalized = normalizePath(relativeFile)
  const beneathEvals = normalized.startsWith('evals/') ? normalized.slice('evals/'.length) : normalized
  return beneathEvals.replace(/\.eval\.[cm]?[jt]sx?$/, '').replaceAll('/', '.')
}

/** Return the canonical sibling Review Case path for one Eval source. */
export function siblingCaseFile(relativeFile: string): string {
  const normalized = normalizePath(relativeFile)
  const stem = normalized.replace(/\.eval\.[cm]?[jt]sx?$/, '')
  if (stem === normalized) {
    throw new TypeError(`Eval source '${normalized}' must end in .eval.ts or .eval.js`)
  }
  return `${stem}.cases.jsonl`
}

/**
 * Inspect already-imported modules without executing Eval tasks, callbacks, or
 * scorers. Exactly one default Eval is admitted per source file.
 */
export async function collectEvalModules(options: {
  readonly projectRoot: string
  readonly core: EvalRunner
  readonly modules: readonly EvalModule[]
}): Promise<EvalDiscoveryResult> {
  const evals: DiscoveredEval[] = []
  const errors: EvalDiscoveryError[] = []

  for (const module of [...options.modules].sort((a, b) => a.relativeFile.localeCompare(b.relativeFile))) {
    const relativeFile = normalizePath(module.relativeFile)
    const candidates = Object.entries(module.exports).filter(([, value]) => options.core.isEvalForInternalUse(value))
    const names = candidates.map(([name]) => name)
    const defaultEval = module.exports.default

    if (candidates.length !== 1 || !options.core.isEvalForInternalUse(defaultEval)) {
      errors.push({
        file: relativeFile,
        exports: Object.freeze(names),
        message: discoveryExportMessage(relativeFile, names),
      })
      continue
    }

    const definition = options.core.getEvalDefinitionForInternalUse(defaultEval)
    const id = definition.explicitId ?? deriveEvalId(relativeFile)
    evals.push(
      Object.freeze({
        id,
        eval: defaultEval,
        sourceKey: Object.freeze({ relativeFile, export: 'default' as const }),
        sidecarFile: siblingCaseFile(relativeFile),
        links: definition.covers,
      }),
    )
  }

  errors.push(...duplicateIdErrors(evals))
  if (errors.length > 0) return Object.freeze({ evals: Object.freeze([]), errors: Object.freeze(errors) })
  return Object.freeze({ evals: Object.freeze(evals), errors: Object.freeze([]) })
}

function discoveryExportMessage(file: string, names: readonly string[]): string {
  if (names.length === 0) return `${file} must default-export exactly one Eval.`
  if (names.length === 1 && names[0] !== 'default') {
    return `${file} exports Eval '${names[0]}', but an Eval file must use a default export.`
  }
  return `${file} exports Evals ${names.map((name) => `'${name}'`).join(', ')}. Keep one default Eval and split each additional Eval into its own file.`
}

function duplicateIdErrors(evals: readonly DiscoveredEval[]): EvalDiscoveryError[] {
  const byId = new Map<string, DiscoveredEval[]>()
  for (const entry of evals) byId.set(entry.id, [...(byId.get(entry.id) ?? []), entry])
  return [...byId]
    .filter(([, entries]) => entries.length > 1)
    .map(([id, entries]) => ({
      file: entries[0]!.sourceKey.relativeFile,
      message: `Duplicate Eval id '${id}' in ${entries.map((entry) => entry.sourceKey.relativeFile).join(', ')}. Add a unique explicit id or rename a source file.`,
    }))
}

type SelectableEval = Pick<DiscoveredEval, 'id' | 'sourceKey'> & {
  readonly links?: readonly string[]
}

export interface EvalSelectionResult<T extends SelectableEval> {
  readonly matches: readonly T[]
  readonly errors: readonly { readonly selector: string; readonly message: string }[]
}

/** Resolve selectors in binding order: exact id, path/directory, then glob. */
export function selectEvals<T extends SelectableEval>(
  evals: readonly T[],
  selectors: readonly string[],
): EvalSelectionResult<T> {
  if (selectors.length === 0) return { matches: [...evals], errors: [] }
  const selected = new Set<T>()
  const errors: { selector: string; message: string }[] = []

  for (const selector of selectors) {
    const byId = evals.filter((entry) => entry.id === selector)
    const normalized = normalizePath(selector).replace(/\/$/, '')
    const byPath = byId.length > 0 ? [] : evals.filter((entry) => {
      const file = entry.sourceKey.relativeFile
      const sourceStem = file.replace(/\.eval\.[cm]?[jt]sx?$/, '')
      return file === normalized || sourceStem === normalized || file.startsWith(`${normalized}/`)
    })
    const byGlob = byId.length > 0 || byPath.length > 0 ? [] : evals.filter((entry) => {
      const pattern = wildcardPattern(selector)
      return pattern.test(entry.id) || pattern.test(entry.sourceKey.relativeFile)
    })
    const byLink = byId.length > 0 || byPath.length > 0 || byGlob.length > 0
      ? []
      : evals.filter((entry) => entry.links?.includes(selector) === true)
    if (byLink.length > 1) {
      errors.push({
        selector,
        message: `Selector '${selector}' is ambiguous across ${byLink.map((entry) => entry.id).join(', ')}. Run one exact command: ${byLink.map((entry) => `crux eval ${entry.id}`).join(' | ')}.`,
      })
      continue
    }
    const matches = byId.length > 0 ? byId : byPath.length > 0 ? byPath : byGlob.length > 0 ? byGlob : byLink
    if (matches.length === 0) {
      errors.push({ selector, message: `No Eval matches '${selector}'. Run 'crux eval list' to see exact Eval ids.` })
      continue
    }
    for (const match of matches) selected.add(match)
  }
  return { matches: [...selected], errors }
}

function wildcardPattern(value: string): RegExp {
  const escaped = normalizePath(value).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`)
}

function normalizePath(value: string): string {
  return value.replaceAll('\\', '/').replace(/^\.\//, '')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
