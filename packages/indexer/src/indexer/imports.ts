import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFileSync, statSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { extname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

let indexModeQueue: Promise<void> = Promise.resolve()
let importSessionSequence = 0
const importSessionStorage = new AsyncLocalStorage<string>()

const CRUX_USER_IMPORT_PREFIX = 'crux-user-import:'
const CRUX_USER_IMPORT_PARAM = 'cruxImport'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])

export class UserImportTimeoutError extends Error {
  readonly code = 'CRUX_USER_IMPORT_TIMEOUT'

  constructor(message: string) {
    super(message)
    this.name = 'UserImportTimeoutError'
  }
}

export function isUserImportTimeoutError(error: unknown): error is UserImportTimeoutError {
  return (
    error instanceof UserImportTimeoutError ||
    (error instanceof Error && 'code' in error && error.code === 'CRUX_USER_IMPORT_TIMEOUT')
  )
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(CRUX_USER_IMPORT_PREFIX)) {
      const request = decodeImportRequest(specifier)
      return resolveAndFingerprint(
        request.specifier,
        {
          ...context,
          parentURL: request.parentURL,
        },
        nextResolve,
        request.session,
      )
    }
    const session = importSessionStorage.getStore() ?? importSessionFrom(context.parentURL)
    if (session === undefined) return nextResolve(specifier, context)
    return resolveAndFingerprint(specifier, context, nextResolve, session)
  },
  load(url, context, nextLoad) {
    if (!url.startsWith('file:')) return nextLoad(url, context)
    if (!new URL(url).searchParams.has(CRUX_USER_IMPORT_PARAM)) {
      return nextLoad(url, context)
    }
    const sourceURL = withoutImportFingerprint(url)
    const extension = extname(new URL(sourceURL).pathname).toLowerCase()
    if (!TYPESCRIPT_EXTENSIONS.has(extension)) {
      return nextLoad(url, context)
    }
    const commonJs = extension === '.cts'
    const source = readFileSync(new URL(sourceURL), 'utf8')
    const transpiled = ts.transpileModule(source, {
      fileName: fileURLToPath(sourceURL),
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: commonJs ? ts.ModuleKind.CommonJS : ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
        inlineSourceMap: true,
        inlineSources: true,
      },
      reportDiagnostics: false,
    })
    return {
      format: commonJs ? 'commonjs' : 'module',
      source: transpiled.outputText,
      shortCircuit: true,
    }
  },
})

export function withCruxIndexMode<T>(task: () => Promise<T>): Promise<T> {
  const run = indexModeQueue.then(async () => {
    const previousIndexMode = process.env.CRUX_INDEX
    process.env.CRUX_INDEX = '1'
    try {
      return await task()
    } finally {
      if (previousIndexMode === undefined) delete process.env.CRUX_INDEX
      else process.env.CRUX_INDEX = previousIndexMode
    }
  })
  indexModeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** Keep one authored module graph identity for a complete discovery operation. */
export async function withUserImportSession<T>(task: () => Promise<T>): Promise<T> {
  if (importSessionStorage.getStore() !== undefined) return task()
  importSessionSequence += 1
  return importSessionStorage.run(String(importSessionSequence), task)
}

export async function importUserModule(file: string, timeoutMs: number): Promise<Record<string, unknown>> {
  if (importSessionStorage.getStore() === undefined) {
    return withUserImportSession(() => importUserModule(file, timeoutMs))
  }
  const imported = await withTimeout(
    () => import(fingerprintedFileURL(pathToFileURL(file).href)),
    timeoutMs,
    `Timed out importing ${file} after ${timeoutMs}ms`,
  )
  if (!imported || typeof imported !== 'object') return {}
  return imported as Record<string, unknown>
}

/** Import a package subpath relative to the authored project. */
export async function importUserSpecifier(specifier: string, parentFile: string, timeoutMs: number): Promise<unknown> {
  if (importSessionStorage.getStore() === undefined) {
    return withUserImportSession(() => importUserSpecifier(specifier, parentFile, timeoutMs))
  }
  // Vitest rewrites variable dynamic imports before Node's registered hooks.
  // Keep the test-only exception exact; shipped execution always resolves the
  // project-local internal runner through the authored parent URL below.
  if (
    process.env.VITEST === 'true' &&
    process.env.NODE_ENV === 'test' &&
    '__vitest_worker__' in globalThis &&
    specifier === '@use-crux/core/eval/internal/node-runner'
  ) {
    return withTimeout(
      () => import('@use-crux/core/eval/internal/node-runner'),
      timeoutMs,
      `Timed out importing ${specifier} from ${parentFile} after ${timeoutMs}ms`,
    )
  }
  const request = encodeURIComponent(
    JSON.stringify({
      specifier,
      parentURL: pathToFileURL(parentFile).href,
      session: importSessionStorage.getStore(),
    }),
  )
  return withTimeout(
    () => import(`${CRUX_USER_IMPORT_PREFIX}${request}`),
    timeoutMs,
    `Timed out importing ${specifier} from ${parentFile} after ${timeoutMs}ms`,
  )
}

interface ImportRequest {
  readonly specifier: string
  readonly parentURL: string
  readonly session: string
}

function decodeImportRequest(specifier: string): ImportRequest {
  const value = JSON.parse(
    decodeURIComponent(specifier.slice(CRUX_USER_IMPORT_PREFIX.length)),
  ) as Partial<ImportRequest>
  if (typeof value.specifier !== 'string' || typeof value.parentURL !== 'string' || typeof value.session !== 'string') {
    throw new TypeError('Invalid Crux user import request.')
  }
  return {
    specifier: value.specifier,
    parentURL: value.parentURL,
    session: value.session,
  }
}

type ResolveHook = Parameters<typeof registerHooks>[0]['resolve']
type ResolveContext = Parameters<NonNullable<ResolveHook>>[1]
type NextResolve = Parameters<NonNullable<ResolveHook>>[2]

function resolveAndFingerprint(specifier: string, context: ResolveContext, nextResolve: NextResolve, session: string) {
  try {
    return fingerprintResolution(nextResolve(specifier, context), session)
  } catch (error) {
    if (!isPathSpecifier(specifier) || !context.parentURL) throw error
    const base = new URL(specifier, context.parentURL)
    base.search = ''
    base.hash = ''
    for (const extension of SOURCE_EXTENSIONS) {
      const file = new URL(base.href)
      file.pathname += extension
      if (isFile(file)) {
        return fingerprintResolution(nextResolve(file.href, context), session)
      }
      const index = new URL(base.href.endsWith('/') ? base.href : `${base.href}/`)
      index.pathname += `index${extension}`
      if (isFile(index)) {
        return fingerprintResolution(nextResolve(index.href, context), session)
      }
    }
    throw error
  }
}

function fingerprintResolution<T extends { readonly url: string }>(resolved: T, session: string): T {
  if (!resolved.url.startsWith('file:')) return resolved
  const extension = extname(new URL(resolved.url).pathname).toLowerCase()
  if (!(SOURCE_EXTENSIONS as readonly string[]).includes(extension)) return resolved
  const url = fingerprintedFileURL(resolved.url, session)
  return { ...resolved, url }
}

function fingerprintedFileURL(url: string, session = importSessionStorage.getStore() ?? ''): string {
  const sourceURL = withoutImportFingerprint(url)
  const content = readFileSync(new URL(sourceURL))
  const fingerprint = createHash('sha256').update(session).update('\0').update(content).digest('hex')
  const tagged = new URL(sourceURL)
  tagged.searchParams.set(CRUX_USER_IMPORT_PARAM, `${session}_${fingerprint}`)
  return tagged.href
}

function importSessionFrom(parentURL: string | undefined): string | undefined {
  if (!parentURL?.startsWith('file:')) return undefined
  const value = new URL(parentURL).searchParams.get(CRUX_USER_IMPORT_PARAM)
  if (!value) return undefined
  const separator = value.indexOf('_')
  return separator === -1 ? undefined : value.slice(0, separator)
}

function withoutImportFingerprint(url: string): string {
  const sourceURL = new URL(url)
  sourceURL.searchParams.delete(CRUX_USER_IMPORT_PARAM)
  return sourceURL.href
}

function isPathSpecifier(specifier: string): boolean {
  return (
    specifier.startsWith('file:') ||
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier.startsWith('/')
  )
}

function isFile(url: URL): boolean {
  try {
    return statSync(url).isFile()
  } catch {
    return false
  }
}

async function withTimeout<T>(task: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      Promise.resolve().then(task),
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new UserImportTimeoutError(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
