import { AsyncLocalStorage } from 'node:async_hooks'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { isBuiltin, registerHooks } from 'node:module'
import { dirname, extname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

let indexModeQueue: Promise<void> = Promise.resolve()
let importSessionSequence = 0
const importSessionStorage = new AsyncLocalStorage<UserImportSession>()
const activeImportSessions = new Map<string, UserImportSession>()

const CRUX_USER_IMPORT_PREFIX = 'crux-user-import:'
const CRUX_USER_IMPORT_PARAM = 'cruxImport'
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const
const TYPESCRIPT_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts'])
const CONFIG_NAMES = ['tsconfig.json', 'jsconfig.json'] as const
const DECLARATION_FILE = /\.d\.(?:ts|mts|cts)$/i

interface ParsedConfigState {
  readonly commandLine: ts.ParsedCommandLine
  readonly configFiles: readonly string[]
  readonly contentIdentity: string
}

interface UserImportSession {
  readonly id: string
  readonly root: string
  readonly configFiles: Set<string>
  readonly parsedConfigs: Map<string, ParsedConfigState>
  cacheDisabled: boolean
}

interface RejectedAuthoredAlias {
  readonly error: string
}

export interface UserImportConfigIdentity {
  readonly files: readonly string[]
  readonly cacheDisabled: boolean
}

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
      const session = activeImportSessions.get(request.session)
      if (!session) throw new TypeError('Crux user import session has expired.')
      return resolveAndFingerprint(
        request.specifier,
        {
          ...context,
          parentURL: request.parentURL,
        },
        nextResolve,
        session,
      )
    }
    const session = importSessionStorage.getStore() ?? activeSessionFrom(context.parentURL)
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
    const source = readFileSync(new URL(sourceURL), 'utf8')
    const session = activeSessionFrom(url)
    if (session) assertSafeAuthoredAliases(source, sourceURL, session)
    if (!TYPESCRIPT_EXTENSIONS.has(extension)) {
      return nextLoad(url, context)
    }
    const commonJs = extension === '.cts'
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
export async function withUserImportSession<T>(task: () => Promise<T>, root?: string): Promise<T> {
  return withBoundedUserImportSession(task, root)
}

/** Run one authored import graph within an explicit project boundary. */
export async function withBoundedUserImportSession<T>(task: () => Promise<T>, root?: string): Promise<T> {
  if (importSessionStorage.getStore() !== undefined) return task()
  importSessionSequence += 1
  const session: UserImportSession = {
    id: String(importSessionSequence),
    root: safeRealpath(resolve(root ?? process.cwd())),
    configFiles: new Set(),
    parsedConfigs: new Map(),
    cacheDisabled: false,
  }
  activeImportSessions.set(session.id, session)
  try {
    return await importSessionStorage.run(session, task)
  } finally {
    activeImportSessions.delete(session.id)
  }
}

/** Return the TS/JS config closure consulted by the current authored import graph. */
export function userImportConfigIdentity(): UserImportConfigIdentity {
  const session = importSessionStorage.getStore()
  return {
    files: session ? [...session.configFiles].sort() : [],
    cacheDisabled: session?.cacheDisabled ?? false,
  }
}

/** Source-test seam for the synchronous registered-hook resolution policy. */
export function resolveUserImportAliasForTest(
  specifier: string,
  parentFile: string,
  root: string,
): { readonly file?: string; readonly identity: UserImportConfigIdentity } {
  const session: UserImportSession = {
    id: 'test',
    root: safeRealpath(resolve(root)),
    configFiles: new Set(),
    parsedConfigs: new Map(),
    cacheDisabled: false,
  }
  const resolution = resolveAuthoredAlias(specifier, pathToFileURL(parentFile).href, session)
  if (resolution && typeof resolution !== 'string') throw new TypeError(resolution.error)
  return {
    ...(resolution ? { file: resolution } : {}),
    identity: { files: [...session.configFiles].sort(), cacheDisabled: session.cacheDisabled },
  }
}

export async function importUserModule(
  file: string,
  timeoutMs: number,
  root = dirname(file),
): Promise<Record<string, unknown>> {
  if (importSessionStorage.getStore() === undefined) {
    return withBoundedUserImportSession(() => importUserModule(file, timeoutMs, root), root)
  }
  prepareImportSessionForFile(file)
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
    return withBoundedUserImportSession(
      () => importUserSpecifier(specifier, parentFile, timeoutMs),
      dirname(parentFile),
    )
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
      session: importSessionStorage.getStore()?.id,
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

function resolveAndFingerprint(
  specifier: string,
  context: ResolveContext,
  nextResolve: NextResolve,
  session: UserImportSession,
) {
  const alias = resolveAuthoredAlias(specifier, context.parentURL, session)
  if (typeof alias === 'string') {
    return fingerprintResolution(nextResolve(pathToFileURL(alias).href, context), session)
  }
  if (alias) {
    const source = `throw new Error(${JSON.stringify(alias.error)})`
    return {
      url: `data:text/javascript,${encodeURIComponent(source)}`,
      shortCircuit: true,
    }
  }
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

function fingerprintResolution<T extends { readonly url: string }>(resolved: T, session: UserImportSession): T {
  if (!resolved.url.startsWith('file:')) return resolved
  const extension = extname(new URL(resolved.url).pathname).toLowerCase()
  if (!(SOURCE_EXTENSIONS as readonly string[]).includes(extension)) return resolved
  const url = fingerprintedFileURL(resolved.url, session)
  return { ...resolved, url }
}

function fingerprintedFileURL(url: string, session = importSessionStorage.getStore()): string {
  const sourceURL = withoutImportFingerprint(url)
  const content = readFileSync(new URL(sourceURL))
  const fingerprint = createHash('sha256')
    .update(session?.id ?? '')
    .update('\0')
    .update(configIdentity(session))
    .update('\0')
    .update(content)
    .digest('hex')
  const tagged = new URL(sourceURL)
  tagged.searchParams.set(CRUX_USER_IMPORT_PARAM, `${session?.id ?? ''}_${fingerprint}`)
  return tagged.href
}

function activeSessionFrom(parentURL: string | undefined): UserImportSession | undefined {
  if (!parentURL?.startsWith('file:')) return undefined
  const value = new URL(parentURL).searchParams.get(CRUX_USER_IMPORT_PARAM)
  if (!value) return undefined
  const separator = value.indexOf('_')
  return separator === -1 ? undefined : activeImportSessions.get(value.slice(0, separator))
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

function prepareImportSessionForFile(file: string): void {
  const session = importSessionStorage.getStore()
  if (!session) return
  const configFile = nearestConfigFile(file, session.root)
  if (configFile) parsedConfig(configFile, session)
}

function resolveAuthoredAlias(
  specifier: string,
  parentURL: string | undefined,
  session: UserImportSession,
): string | RejectedAuthoredAlias | undefined {
  if (!parentURL?.startsWith('file:') || isPathSpecifier(specifier) || isBuiltin(specifier)) return undefined
  const parentFile = fileURLToPath(withoutImportFingerprint(parentURL))
  const configFile = nearestConfigFile(parentFile, session.root)
  if (!configFile) return undefined
  const state = parsedConfig(configFile, session)
  if (!state) return undefined
  const pathsMatch = matchesPaths(specifier, state.commandLine.options.paths)
  if (!pathsMatch && !state.commandLine.options.baseUrl) return undefined
  const resolution = ts.resolveModuleName(specifier, parentFile, state.commandLine.options, ts.sys).resolvedModule
  if (!resolution) return undefined
  if (resolution.isExternalLibraryImport) return undefined
  if (DECLARATION_FILE.test(resolution.resolvedFileName)) {
    return {
      error: `Crux user import alias "${specifier}" resolved to a declaration file instead of executable source.`,
    }
  }
  const resolvedFile = safeRealpath(resolve(resolution.resolvedFileName))
  if (!isWithin(session.root, resolvedFile)) {
    return {
      error: `Crux user import alias "${specifier}" resolved outside the authored project boundary.`,
    }
  }
  const extension = extname(resolvedFile).toLowerCase()
  return (SOURCE_EXTENSIONS as readonly string[]).includes(extension) ? resolvedFile : undefined
}

function assertSafeAuthoredAliases(
  source: string,
  sourceURL: string,
  session: UserImportSession,
): void {
  for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
    const resolution = resolveAuthoredAlias(imported.fileName, sourceURL, session)
    if (resolution && typeof resolution !== 'string') {
      throw new TypeError(resolution.error)
    }
  }
}

function parsedConfig(configFile: string, session: UserImportSession): ParsedConfigState | undefined {
  const cached = session.parsedConfigs.get(configFile)
  if (cached && cached.contentIdentity === contentIdentity(cached.configFiles)) return cached

  const configFiles = new Set<string>()
  const host: ts.ParseConfigFileHost = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic() {},
    fileExists(file) {
      if (file.toLowerCase().endsWith('.json')) configFiles.add(resolve(file))
      return ts.sys.fileExists(file)
    },
    readFile(file) {
      const source = ts.sys.readFile(file)
      if (file.toLowerCase().endsWith('.json')) configFiles.add(resolve(file))
      return source
    },
  }
  const commandLine = ts.getParsedCommandLineOfConfigFile(configFile, {}, host)
  if (!commandLine) return undefined
  const files = [...configFiles].sort()
  for (const file of files) {
    session.configFiles.add(file)
    if (!isWithin(session.root, safeRealpath(file))) session.cacheDisabled = true
  }
  const state = { commandLine, configFiles: files, contentIdentity: contentIdentity(files) }
  session.parsedConfigs.set(configFile, state)
  return state
}

function nearestConfigFile(file: string, root: string): string | undefined {
  let directory = dirname(safeRealpath(file))
  if (!isWithin(root, directory)) return undefined
  while (isWithin(root, directory)) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(directory, name)
      if (isFile(pathToFileURL(candidate))) return candidate
    }
    if (directory === root) break
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return undefined
}

function matchesPaths(specifier: string, paths: ts.MapLike<string[]> | undefined): boolean {
  return Object.keys(paths ?? {}).some((pattern) => {
    const star = pattern.indexOf('*')
    return star === -1
      ? pattern === specifier
      : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1))
  })
}

function configIdentity(session: UserImportSession | undefined): string {
  if (!session) return ''
  return contentIdentity([...session.configFiles].sort())
}

function contentIdentity(files: readonly string[]): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file).update('\0')
    try {
      hash.update(readFileSync(file))
    } catch {
      hash.update('<missing>')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

function isWithin(root: string, file: string): boolean {
  const path = relative(root, file)
  return path === '' || (path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path))
}

function safeRealpath(file: string): string {
  try {
    return realpathSync(file)
  } catch {
    return resolve(file)
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
