/**
 * Utilities for comparing Project Index static syntax frontends.
 *
 * The comparison intentionally runs through `createStaticExtraction(...)` instead of parser-only
 * helpers. That keeps the benchmark and parity checks aligned with the compiler-owned static
 * extraction contract: source text in, Project Index facts out, no parser-native AST objects.
 *
 * @module
 */

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'
import type { IndexerExtension } from '@use-crux/indexer/extensions'
import type {
  StaticExtractionInstrumentation,
  StaticFileExtraction,
  StaticSyntaxFrontendFactory,
  SourceReader,
} from '@use-crux/indexer/host/static-index'
import {
  createStaticExtraction,
  createTypeScriptStaticSyntaxFrontend,
  staticDefinitionFiles,
} from '@use-crux/indexer/host/static-index'
import { createRustOxcStaticSyntaxFrontend } from '@use-crux/indexer/testing/rust-oxc-frontend'
import { canonicalStaticJson } from './indexer-static-canonical'

export type StaticFrontendName = 'typescript' | 'oxc-rust'

export interface StaticFrontendRunOptions {
  /** Absolute project root used for source discovery and relative mismatch output. */
  readonly root: string
  /** Files to extract. Defaults to the production static file selection. */
  readonly files?: readonly string[]
  /** Frontend to run through the static extraction engine. */
  readonly frontend: StaticFrontendName
  /** Optional source reader. Benchmarks use this to remove filesystem I/O from parser timing. */
  readonly sources?: SourceReader
  /** Number of files extracted concurrently. Defaults to 8, matching the engine batch path. */
  readonly concurrency?: number
  /** Optional static extraction instrumentation hooks. */
  readonly instrumentation?: StaticExtractionInstrumentation
  /** Extra TypeScript extension manifests used by extension-overhead benchmarks. */
  readonly extensions?: readonly IndexerExtension[]
}

export interface StaticFrontendRunResult {
  readonly frontend: StaticFrontendName
  readonly files: readonly StaticFileProjection[]
  readonly errors: readonly StaticFileError[]
  readonly totals: StaticExtractionTotals
}

export interface StaticFileProjection {
  readonly file: string
  readonly facts: StaticExtractionProjection
  /** Raw JSON is retained only to make non-semantic serialization drift debuggable. */
  readonly rawJson: string
  /** Canonical JSON is the parity gate for static extraction facts. */
  readonly canonicalJson: string
}

export interface StaticExtractionProjection {
  readonly definitions: StaticFileExtraction['definitions']
  readonly relations: StaticFileExtraction['relations']
  readonly diagnostics: StaticFileExtraction['diagnostics']
  readonly dependencies: StaticFileExtraction['dependencies']
}

export interface StaticExtractionTotals {
  readonly files: number
  readonly definitions: number
  readonly relations: number
  readonly diagnostics: number
  readonly dependencies: number
}

export interface StaticFileError {
  readonly file: string
  readonly message: string
}

export interface StaticParityOptions {
  /** Absolute project root used for source discovery and relative mismatch output. */
  readonly root: string
  /** Files to compare. Defaults to the production static file selection. */
  readonly files?: readonly string[]
  /** Optional source reader shared by both frontend runs. */
  readonly sources?: SourceReader
  /** Number of files extracted concurrently per frontend. */
  readonly concurrency?: number
  /** Number of detailed mismatch payloads to retain. Defaults to 10. */
  readonly maxMismatchDetails?: number
  /** Frontend compared against the TypeScript baseline. Defaults to the Rust/Oxc worker. */
  readonly actualFrontend?: Exclude<StaticFrontendName, 'typescript'>
}

export interface StaticParityResult {
  readonly root: string
  readonly files: number
  readonly matched: number
  readonly mismatchCount: number
  readonly rawMismatchCount: number
  readonly mismatches: readonly StaticParityMismatch[]
  readonly errors: readonly StaticFileError[]
  readonly typescript: StaticExtractionTotals
  readonly actualFrontend: Exclude<StaticFrontendName, 'typescript'>
  readonly actual: StaticExtractionTotals
}

export interface StaticParityMismatch {
  readonly file: string
  readonly relativeFile: string
  readonly changedFields: readonly StaticProjectionField[]
  readonly typescript: StaticExtractionProjection
  readonly actual: StaticExtractionProjection
}

export type StaticProjectionField = keyof StaticExtractionProjection

/**
 * Returns the same source-file selection used by static Project Index extraction.
 */
export function staticParityFiles(root: string): readonly string[] {
  return staticDefinitionFiles(root)
}

/**
 * Preloads source files into memory so benchmarks can focus on parser and extraction cost.
 */
export function preloadStaticSources(files: readonly string[]): SourceReader {
  const sources = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]))
  return {
    read: async (file) => {
      const source = sources.get(file)
      if (source === undefined) throw new Error(`Missing preloaded source: ${file}`)
      return source
    },
  }
}

/**
 * Runs one syntax frontend through the static extraction engine.
 */
export async function runStaticFrontendExtraction(options: StaticFrontendRunOptions): Promise<StaticFrontendRunResult> {
  const files = options.files ?? staticParityFiles(options.root)
  const extraction = createStaticExtraction({
    root: options.root,
    cache: 'none',
    sources: options.sources,
    syntaxFrontend: frontendFactory(options.frontend),
    instrumentation: options.instrumentation,
    extensions: options.extensions,
  })
  const projections: StaticFileProjection[] = []
  const errors: StaticFileError[] = []
  try {
    for (const extracted of await extraction.extractFiles(files, { concurrency: options.concurrency ?? 8 })) {
      const facts = projectStaticExtraction(extracted)
      projections.push({
        file: extracted.file,
        facts,
        rawJson: JSON.stringify(facts),
        canonicalJson: canonicalStaticJson(facts),
      })
    }
  } catch (error) {
    errors.push({ file: '<static-extraction>', message: errorMessage(error) })
  }

  return {
    frontend: options.frontend,
    files: projections,
    errors,
    totals: totalsFromProjections(projections),
  }
}

/**
 * Compares TypeScript-backed and native Rust/Oxc-backed static extraction output exactly.
 */
export async function compareStaticSyntaxFrontends(options: StaticParityOptions): Promise<StaticParityResult> {
  const files = options.files ?? staticParityFiles(options.root)
  const actualFrontend = options.actualFrontend ?? 'oxc-rust'
  const typescript = await runStaticFrontendExtraction({ ...options, files, frontend: 'typescript' })
  const actual = await runStaticFrontendExtraction({ ...options, files, frontend: actualFrontend })
  const actualByFile = new Map(actual.files.map((file) => [file.file, file]))
  const mismatches: StaticParityMismatch[] = []
  let mismatchCount = 0
  let rawMismatchCount = 0
  let matched = 0

  for (const expected of typescript.files) {
    const fileActual = actualByFile.get(expected.file)
    if (fileActual?.rawJson !== expected.rawJson) {
      rawMismatchCount += 1
    }
    if (fileActual && fileActual.canonicalJson === expected.canonicalJson) {
      matched += 1
      continue
    }
    mismatchCount += 1
    if (mismatches.length < (options.maxMismatchDetails ?? 10)) {
      mismatches.push({
        file: expected.file,
        relativeFile: relative(options.root, expected.file).replace(/\\/g, '/'),
        changedFields: fileActual ? changedFields(expected.facts, fileActual.facts) : ['definitions'],
        typescript: expected.facts,
        actual: fileActual?.facts ?? emptyProjection(),
      })
    }
  }

  return {
    root: options.root,
    files: files.length,
    matched,
    mismatchCount,
    rawMismatchCount,
    mismatches,
    errors: [...typescript.errors, ...actual.errors],
    typescript: typescript.totals,
    actualFrontend,
    actual: actual.totals,
  }
}

function frontendFactory(frontend: StaticFrontendName): StaticSyntaxFrontendFactory {
  if (frontend === 'oxc-rust') return createRustOxcStaticSyntaxFrontend
  return createTypeScriptStaticSyntaxFrontend
}

function projectStaticExtraction(extraction: StaticFileExtraction): StaticExtractionProjection {
  return {
    definitions: extraction.definitions,
    relations: extraction.relations,
    diagnostics: extraction.diagnostics,
    dependencies: extraction.dependencies,
  }
}

function changedFields(
  typescript: StaticExtractionProjection,
  actual: StaticExtractionProjection,
): readonly StaticProjectionField[] {
  return (['definitions', 'relations', 'diagnostics', 'dependencies'] as const).filter(
    (field) => canonicalStaticJson({ [field]: typescript[field] }) !== canonicalStaticJson({ [field]: actual[field] }),
  )
}

function emptyProjection(): StaticExtractionProjection {
  return { definitions: [], relations: [], diagnostics: [], dependencies: [] }
}

function totalsFromProjections(files: readonly StaticFileProjection[]): StaticExtractionTotals {
  return files.reduce<StaticExtractionTotals>(
    (totals, file) => ({
      files: totals.files + 1,
      definitions: totals.definitions + file.facts.definitions.length,
      relations: totals.relations + file.facts.relations.length,
      diagnostics: totals.diagnostics + file.facts.diagnostics.length,
      dependencies: totals.dependencies + file.facts.dependencies.length,
    }),
    { files: 0, definitions: 0, relations: 0, diagnostics: 0, dependencies: 0 },
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
