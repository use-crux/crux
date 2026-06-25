import { readFile } from 'node:fs/promises'
import { collectImportBindings } from '../ast/imports'
import { createSourceFile } from '../ast/parse'
import { sha256 } from '../cache-identity'
import { isNativeDirectCandidateCallSet, isSemanticPrimitiveCallName } from './backends/tsgo/direct-projectors/manifest'

const defaultConcurrency = 64

export interface SemanticSourceProfileHints {
  /** Crux factory call names seen in source text. */
  readonly cruxCallNames?: readonly string[]
  /** Whether the source contains direct `z.object(...)` usage. */
  readonly hasZodObject?: boolean
  /** Whether the file fits the native direct Crux projector's source-level guardrails. */
  readonly nativeDirectCruxCandidate?: boolean
}

export interface SemanticSourceProfileFile {
  /** Absolute source file path. */
  readonly file: string
  /** UTF-8 source text read during semantic preflight, omitted for AST handoff profiles. */
  readonly source?: string
  /** SHA-256 hash of the source text for semantic cache identity. */
  readonly sourceHash: string
  /** UTF-8 byte length of the source text. */
  readonly sourceBytes: number
  /** Cheap source-shape hints produced while source text was already available. */
  readonly hints?: SemanticSourceProfileHints
}

export interface SemanticSourceProfile {
  /** Files that were successfully read and hashed during preflight. */
  readonly files: readonly SemanticSourceProfileFile[]
  /** Local dependency closure selected for semantic backend project setup. */
  readonly dependencyClosure: readonly string[]
  /** Total UTF-8 bytes read while building this profile. */
  readonly sourceBytes: number
  /** Whether the closure completed and all reached source files were readable. */
  readonly complete: boolean
}

export interface SemanticSourceProfileOptions {
  /** Caller-proven closure, usually from the static source graph. */
  readonly dependencyClosure?: readonly string[]
  /** Stop after this many local source files have been discovered. */
  readonly maxFiles?: number
  /** Mark incomplete once this many UTF-8 source bytes have been read. */
  readonly maxSourceBytes?: number
  /** Maximum concurrent source reads. */
  readonly concurrency?: number
}

/** Builds one semantic source profile row from source text already read by another compiler phase. */
export function semanticSourceProfileFileFromSource(
  file: string,
  source: string,
  options: { readonly includeSource?: boolean } = {},
): SemanticSourceProfileFile {
  return {
    file,
    ...(options.includeSource ? { source } : {}),
    sourceHash: sha256(source),
    sourceBytes: Buffer.byteLength(source, 'utf8'),
    hints: semanticSourceProfileHintsFromSource(source),
  }
}

/** Returns source-level semantic hints without exposing compiler AST nodes. */
export function semanticSourceProfileHintsFromSource(source: string): SemanticSourceProfileHints {
  const cruxCallNames = cruxCallNamesFromSource(source)
  return {
    ...(cruxCallNames.length > 0 ? { cruxCallNames } : {}),
    hasZodObject: source.includes('z.object'),
    nativeDirectCruxCandidate: isNativeDirectCruxSource(source, cruxCallNames),
  }
}

/** Reads, hashes, and optionally discovers the local semantic source closure. */
export async function semanticSourceProfile(
  root: string,
  files: readonly string[],
  options: SemanticSourceProfileOptions = {},
): Promise<SemanticSourceProfile> {
  if (options.dependencyClosure) {
    return semanticSourceProfileFromClosure([...new Set([...options.dependencyClosure, ...files])].sort(), options)
  }
  return semanticSourceProfileFromImports(root, files, options)
}

async function semanticSourceProfileFromClosure(
  closure: readonly string[],
  options: SemanticSourceProfileOptions,
): Promise<SemanticSourceProfile> {
  if (options.maxFiles !== undefined && closure.length > options.maxFiles) {
    return { files: [], dependencyClosure: closure, sourceBytes: 0, complete: false }
  }
  const files = presentValues(
    await mapConcurrent(closure, options.concurrency ?? defaultConcurrency, sourceProfileFile),
  )
  const sourceBytes = files.reduce((sum, file) => sum + file.sourceBytes, 0)
  return {
    files,
    dependencyClosure: closure,
    sourceBytes,
    complete: files.length === closure.length && withinSourceByteBudget(sourceBytes, options.maxSourceBytes),
  }
}

async function semanticSourceProfileFromImports(
  root: string,
  files: readonly string[],
  options: SemanticSourceProfileOptions,
): Promise<SemanticSourceProfile> {
  const seen = new Set<string>()
  const profiles = new Map<string, SemanticSourceProfileFile>()
  let queue: readonly string[] = [...new Set(files)].sort()
  let sourceBytes = 0
  let complete = true

  while (queue.length > 0) {
    const batch = nextBatch(queue, seen, options.concurrency ?? defaultConcurrency)
    queue = batch.remaining
    batch.files.forEach((file) => seen.add(file))

    if (options.maxFiles !== undefined && seen.size > options.maxFiles) {
      complete = false
      break
    }

    const readProfiles = presentValues(
      await mapConcurrent(batch.files, options.concurrency ?? defaultConcurrency, sourceProfileFile),
    )
    readProfiles.forEach((profile) => {
      profiles.set(profile.file, profile)
      sourceBytes += profile.sourceBytes
    })

    if (!withinSourceByteBudget(sourceBytes, options.maxSourceBytes)) {
      complete = false
      break
    }

    queue = [
      ...queue,
      ...readProfiles.flatMap((profile) =>
        profile.source
          ? [...collectImportBindings(createSourceFile(profile.file, profile.source), root, profile.file).values()].map(
              (binding) => binding.file,
            )
          : [],
      ),
    ].sort()
  }

  return {
    files: [...profiles.values()].sort(compareProfileFiles),
    dependencyClosure: [...seen].sort(),
    sourceBytes,
    complete: complete && profiles.size === seen.size,
  }
}

async function sourceProfileFile(file: string): Promise<SemanticSourceProfileFile | undefined> {
  try {
    const source = await readFile(file, 'utf8')
    return semanticSourceProfileFileFromSource(file, source, { includeSource: true })
  } catch {
    return undefined
  }
}

function nextBatch(
  queue: readonly string[],
  seen: ReadonlySet<string>,
  concurrency: number,
): { readonly files: readonly string[]; readonly remaining: readonly string[] } {
  const files: string[] = []
  const remaining: string[] = []
  const batchSeen = new Set<string>()
  for (const file of queue) {
    if (seen.has(file) || batchSeen.has(file)) continue
    if (files.length < Math.max(1, concurrency)) {
      files.push(file)
      batchSeen.add(file)
    } else {
      remaining.push(file)
    }
  }
  return { files, remaining }
}

async function mapConcurrent<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  fn: (value: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
  const results: TOutput[] = new Array(values.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
      while (next < values.length) {
        const index = next
        next += 1
        results[index] = await fn(values[index] as TInput)
      }
    }),
  )
  return results
}

function presentValues<T>(values: readonly (T | undefined)[]): T[] {
  return values.filter((value): value is T => value !== undefined)
}

function withinSourceByteBudget(sourceBytes: number, maxSourceBytes: number | undefined): boolean {
  return maxSourceBytes === undefined || sourceBytes <= maxSourceBytes
}

function compareProfileFiles(left: SemanticSourceProfileFile, right: SemanticSourceProfileFile): number {
  return left.file.localeCompare(right.file)
}

function cruxCallNamesFromSource(source: string): readonly string[] {
  const matches = source.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)
  const names = [...matches].map((match) => match[1]).filter((name): name is string => Boolean(name))
  return [...new Set(names.filter(isCruxCallName))].sort()
}

function isCruxCallName(name: string): boolean {
  return isSemanticPrimitiveCallName(name)
}

function isNativeDirectCruxSource(source: string, cruxCallNames: readonly string[]): boolean {
  return /from\s+['"]@crux\/core['"]/.test(source) && isNativeDirectCandidateCallSet(cruxCallNames)
}
