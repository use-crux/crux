#!/usr/bin/env tsx

/**
 * Real-project semantic parity checker for Project Index backends.
 *
 * The checker runs AST/source indexing once, then compares normalized semantic
 * facts from the JavaScript TypeScript backend and the experimental native
 * backend against the same previous-index snapshot.
 *
 * @module
 */

import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProjectIndexSnapshot } from '@crux/core/project-index'
import {
  indexProjectAst,
  indexProjectSemantic,
  type IndexPatch,
  type IndexPatchFacts,
  type SemanticBackendName,
  type SemanticBackendSelection,
} from '@crux/indexer'

interface SemanticParityArgs {
  /** Project root to analyze. */
  readonly root: string
  /** Delete Project Index caches before AST and each semantic backend run. */
  readonly clearCache: boolean
}

interface BackendParityRun {
  readonly backend: SemanticBackendName
  readonly status: IndexPatch['status']
  readonly facts: JsonValue
  readonly counts: FactCounts
  readonly nativeCoverage: readonly string[]
}

type JsonPrimitive = string | number | boolean | null
type JsonObject = { readonly [key: string]: JsonValue }
type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject

const factKeys = [
  'prompts',
  'contexts',
  'tools',
  'lint',
  'definitions',
  'relations',
  'sourceRefs',
  'diagnostics',
  'lintFindings',
  'ruleDescriptors',
  'sources',
  'sourceGraph',
] as const satisfies readonly (keyof IndexPatchFacts)[]

type FactKey = (typeof factKeys)[number]
type FactCount = number | 'present' | 'missing'
type FactCounts = Readonly<Record<FactKey, FactCount>>

const DEFAULT_BACKEND_ROOT = '/home/henri/private/karyla/packages/backend'

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (!existsSync(args.root)) throw new Error(`Project root does not exist: ${args.root}`)

  console.log(`Semantic parity root: ${args.root}`)
  if (args.clearCache) clearIndexCache(args.root)

  const astPatch = await indexProjectAst({ root: args.root, projectName: 'semantic-parity' })
  const previousIndex = projectIndexSnapshotFromAstPatch(astPatch)
  const typeScript = await runBackend('typescript', args, previousIndex, astPatch.semanticSourceProfile)
  const native = await runBackend('native', args, previousIndex, astPatch.semanticSourceProfile)

  printRun(typeScript)
  printRun(native)

  const diff = firstDiff(typeScript.facts, native.facts)
  if (typeScript.status !== native.status || diff) {
    console.error(`parity=failed`)
    if (typeScript.status !== native.status) {
      console.error(`status: typescript=${typeScript.status} native=${native.status}`)
    }
    if (diff) console.error(diff)
    process.exitCode = 1
    return
  }

  console.log('parity=ok')
}

async function runBackend(
  backend: SemanticBackendName,
  args: SemanticParityArgs,
  previousIndex: ProjectIndexSnapshot,
  semanticSourceProfile: IndexPatch['semanticSourceProfile'],
): Promise<BackendParityRun> {
  const nativeCoverage: string[] = []
  if (args.clearCache) clearIndexCache(args.root)
  const patch = await indexProjectSemantic({
    root: args.root,
    projectName: `semantic-parity-${backend}`,
    semanticBackend: semanticBackendSelection(backend),
    previousIndex,
    semanticSourceProfile,
    semanticInstrumentation: {
      onNativeCoverage: (coverage) => nativeCoverage.push(JSON.stringify(coverage)),
    },
  })
  return {
    backend,
    status: patch.status,
    facts: normalizeJson(factsForParity(patch.facts)),
    counts: factCounts(patch.facts),
    nativeCoverage,
  }
}

function semanticBackendSelection(backend: SemanticBackendName): SemanticBackendSelection {
  return backend === 'native' ? { name: 'native' } : backend
}

function factsForParity(facts: IndexPatchFacts): Readonly<Record<FactKey, IndexPatchFacts[FactKey]>> {
  return factKeys.reduce(
    (result, key) => ({
      ...result,
      [key]: facts[key],
    }),
    {} as Record<FactKey, IndexPatchFacts[FactKey]>,
  )
}

function factCounts(facts: IndexPatchFacts): FactCounts {
  return factKeys.reduce(
    (result, key) => ({
      ...result,
      [key]: factCount(facts[key]),
    }),
    {} as Record<FactKey, FactCount>,
  )
}

function factCount(value: IndexPatchFacts[FactKey]): FactCount {
  if (value === undefined) return 'missing'
  if (Array.isArray(value)) return value.length
  return 'present'
}

function normalizeJson(value: unknown): JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value
  }
  if (Array.isArray(value)) return value.map(normalizeJson).sort(compareJsonValues)
  if (typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).reduce<Record<string, JsonValue>>((result, [key, entry]) => {
      if (entry === undefined) return result
      return {
        ...result,
        [key]: normalizeJson(entry),
      }
    }, {})
  }
  return String(value)
}

function compareJsonValues(left: JsonValue, right: JsonValue): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

function firstDiff(left: JsonValue, right: JsonValue, path = 'facts'): string | undefined {
  if (JSON.stringify(left) === JSON.stringify(right)) return undefined
  if (Array.isArray(left) || Array.isArray(right)) return firstArrayDiff(left, right, path)
  if (isJsonObject(left) || isJsonObject(right)) return firstObjectDiff(left, right, path)
  return `${path}: ${preview(left)} !== ${preview(right)}`
}

function firstArrayDiff(left: JsonValue, right: JsonValue, path: string): string {
  if (!Array.isArray(left) || !Array.isArray(right)) return `${path}: ${preview(left)} !== ${preview(right)}`
  if (left.length !== right.length) {
    const missingInNative = firstMissingArrayItem(left, right)
    const missingInTypeScript = firstMissingArrayItem(right, left)
    return [
      `${path}.length: ${left.length} !== ${right.length}`,
      missingInNative === undefined ? undefined : `missingInNative=${missingInNative}`,
      missingInTypeScript === undefined ? undefined : `missingInTypeScript=${missingInTypeScript}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join('\n')
  }
  for (let index = 0; index < left.length; index += 1) {
    const diff = firstDiff(left[index] ?? null, right[index] ?? null, `${path}[${index}]`)
    if (diff) return diff
  }
  return `${path}: arrays differ`
}

function firstMissingArrayItem(expected: readonly JsonValue[], actual: readonly JsonValue[]): string | undefined {
  const actualItems = new Set(actual.map((item) => JSON.stringify(item)))
  const missing = expected.find((item) => !actualItems.has(JSON.stringify(item)))
  return missing === undefined ? undefined : preview(missing)
}

function firstObjectDiff(left: JsonValue, right: JsonValue, path: string): string {
  if (!isJsonObject(left) || !isJsonObject(right)) return `${path}: ${preview(left)} !== ${preview(right)}`
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
  for (const key of keys) {
    if (!(key in left)) return `${path}.${key}: missing in typescript`
    if (!(key in right)) return `${path}.${key}: missing in native`
    const diff = firstDiff(left[key] ?? null, right[key] ?? null, `${path}.${key}`)
    if (diff) return diff
  }
  return `${path}: objects differ`
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function preview(value: JsonValue): string {
  const text = JSON.stringify(value)
  return text.length > 500 ? `${text.slice(0, 500)}...` : text
}

function printRun(run: BackendParityRun): void {
  console.log(
    [
      `${run.backend}:`,
      `status=${run.status}`,
      ...factKeys.map((key) => `${key}=${run.counts[key]}`),
      run.nativeCoverage.length > 0 ? `nativeCoverage=${run.nativeCoverage.join(',')}` : undefined,
    ]
      .filter((part): part is string => Boolean(part))
      .join(' '),
  )
}

function projectIndexSnapshotFromAstPatch(patch: IndexPatch): ProjectIndexSnapshot {
  return {
    schemaVersion: 1,
    project: patch.project,
    indexedAt: patch.finishedAt ?? patch.startedAt,
    prompts: patch.facts.prompts ? [...patch.facts.prompts] : [],
    contexts: patch.facts.contexts ? [...patch.facts.contexts] : [],
    tools: patch.facts.tools ? [...patch.facts.tools] : [],
    lint: patch.facts.lint,
    definitions: patch.facts.definitions ? [...patch.facts.definitions] : [],
    relations: patch.facts.relations ? [...patch.facts.relations] : [],
    diagnostics: patch.facts.diagnostics ? [...patch.facts.diagnostics] : [],
    lintFindings: patch.facts.lintFindings ? [...patch.facts.lintFindings] : [],
    ruleDescriptors: patch.facts.ruleDescriptors ? [...patch.facts.ruleDescriptors] : [],
    sources: patch.facts.sources ? [...patch.facts.sources] : [],
    sourceGraph: patch.facts.sourceGraph,
  }
}

function parseArgs(argv: readonly string[]): SemanticParityArgs {
  const rootFlag = argv.find((arg) => arg.startsWith('--root='))
  return {
    root: resolve(rootFlag?.slice('--root='.length) ?? DEFAULT_BACKEND_ROOT),
    clearCache: argv.includes('--clear-cache'),
  }
}

function clearIndexCache(root: string): void {
  rmSync(join(root, '.crux', 'cache', 'index'), { recursive: true, force: true })
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exitCode = 1
})
