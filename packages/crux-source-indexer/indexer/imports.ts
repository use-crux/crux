import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

type TsImport = (specifier: string, parentURL: string) => Promise<unknown>

let cachedTsImport: Promise<TsImport> | undefined
let indexModeQueue: Promise<void> = Promise.resolve()

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

export async function importUserModule(file: string, timeoutMs: number): Promise<Record<string, unknown>> {
  const tsImport = await loadTsImport(file)
  const imported = await withTimeout(
    tsImport(pathToFileURL(file).href, import.meta.url) as Promise<unknown>,
    timeoutMs,
    `Timed out importing ${file} after ${timeoutMs}ms`,
  )
  if (!imported || typeof imported !== 'object') return {}
  return imported as Record<string, unknown>
}

async function loadTsImport(fromFile: string): Promise<TsImport> {
  cachedTsImport ??= importTsxApi(fromFile)
  return cachedTsImport
}

async function importTsxApi(fromFile: string): Promise<TsImport> {
  const packageRoot = nearestPackageRoot(fromFile)
  const requireFromProject = createRequire(join(packageRoot, 'package.json'))
  const apiPath = requireFromProject.resolve('tsx/esm/api')
  const api = (await import(pathToFileURL(apiPath).href)) as { tsImport?: unknown }
  if (typeof api.tsImport !== 'function') {
    throw new Error(`tsx/esm/api did not expose tsImport from ${apiPath}`)
  }
  return api.tsImport as TsImport
}

function nearestPackageRoot(file: string): string {
  let current = dirname(file)
  while (true) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) return dirname(file)
    current = parent
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
