import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

interface PathAlias {
  readonly prefix: string
  readonly suffix: string
  readonly targets: readonly string[]
}

interface ImportResolverConfig {
  readonly baseUrl: string
  readonly aliases: readonly PathAlias[]
}

const resolverConfigCache = new Map<string, ImportResolverConfig | undefined>()

/**
 * Resolves a static import specifier to a local source file without TypeScript APIs.
 *
 * Native semantic preflight uses this path before the tsgo compiler session is
 * created, so it must stay text/filesystem-only.
 */
export function resolveSemanticSourceImportFile(
  root: string,
  importerFile: string,
  specifier: string,
): string | undefined {
  const resolverConfig = resolverConfigForRoot(root)
  if (specifier.startsWith('.')) return resolveImportBase(resolve(dirname(importerFile), specifier))
  const aliasBase = resolveAliasBase(specifier, resolverConfig)
  return aliasBase ? resolveImportBase(aliasBase) : undefined
}

function resolveImportBase(base: string): string | undefined {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    `${base}.mjs`,
    `${base}.cjs`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
    join(base, 'index.jsx'),
    join(base, 'index.mjs'),
    join(base, 'index.cjs'),
  ]
  return candidates.find((candidate) => isImportableFile(candidate))
}

function resolveAliasBase(specifier: string, resolverConfig: ImportResolverConfig | undefined): string | undefined {
  if (!resolverConfig) return undefined
  for (const alias of resolverConfig.aliases) {
    if (!specifier.startsWith(alias.prefix) || !specifier.endsWith(alias.suffix)) continue
    const matched = specifier.slice(alias.prefix.length, specifier.length - alias.suffix.length)
    for (const target of alias.targets) {
      const mapped = target.includes('*') ? target.replace('*', matched) : target
      const absolute = resolve(resolverConfig.baseUrl, mapped)
      if (resolveImportBase(absolute)) return absolute
    }
  }
  return undefined
}

function resolverConfigForRoot(root: string): ImportResolverConfig | undefined {
  const cached = resolverConfigCache.get(root)
  if (resolverConfigCache.has(root)) return cached
  const loaded = loadResolverConfig(root)
  resolverConfigCache.set(root, loaded)
  return loaded
}

function loadResolverConfig(root: string): ImportResolverConfig | undefined {
  const configFile = join(root, 'tsconfig.json')
  try {
    const raw = readFileSync(configFile, 'utf8')
    const parsed = JSON.parse(removeTrailingJsonCommas(stripJsonComments(raw))) as unknown
    if (!isRecord(parsed)) return undefined
    const compilerOptions = isRecord(parsed.compilerOptions) ? parsed.compilerOptions : undefined
    if (!compilerOptions) return undefined
    const baseUrlValue = typeof compilerOptions.baseUrl === 'string' ? compilerOptions.baseUrl : '.'
    const paths = isRecord(compilerOptions.paths) ? compilerOptions.paths : undefined
    if (!paths) return undefined
    const aliases = Object.entries(paths)
      .map(([pattern, targets]) => pathAlias(pattern, targets))
      .filter((alias): alias is PathAlias => Boolean(alias))
    return aliases.length > 0 ? { baseUrl: resolve(root, baseUrlValue), aliases } : undefined
  } catch {
    return undefined
  }
}

function pathAlias(pattern: string, targets: unknown): PathAlias | undefined {
  if (!Array.isArray(targets)) return undefined
  const star = pattern.indexOf('*')
  const prefix = star === -1 ? pattern : pattern.slice(0, star)
  const suffix = star === -1 ? '' : pattern.slice(star + 1)
  const stringTargets = targets.filter((target): target is string => typeof target === 'string')
  return stringTargets.length > 0 ? { prefix, suffix, targets: stringTargets } : undefined
}

function stripJsonComments(source: string): string {
  let output = ''
  let index = 0
  while (index < source.length) {
    const commentEnd = skipJsonComment(source, index)
    if (commentEnd !== index) {
      output += source.slice(index, commentEnd).replace(/[^\n]/g, ' ')
      index = commentEnd
      continue
    }
    const stringEnd = skipJsonString(source, index)
    if (stringEnd !== index) {
      output += source.slice(index, stringEnd)
      index = stringEnd
      continue
    }
    output += source[index]
    index += 1
  }
  return output
}

function removeTrailingJsonCommas(source: string): string {
  return source.replace(/,\s*([}\]])/g, '$1')
}

function skipJsonComment(source: string, index: number): number {
  if (source[index] !== '/') return index
  if (source[index + 1] === '/') {
    const newline = source.indexOf('\n', index + 2)
    return newline === -1 ? source.length : newline + 1
  }
  if (source[index + 1] === '*') {
    const close = source.indexOf('*/', index + 2)
    return close === -1 ? source.length : close + 2
  }
  return index
}

function skipJsonString(source: string, index: number): number {
  if (source[index] !== '"') return index
  let escaped = false
  for (let cursor = index + 1; cursor < source.length; cursor += 1) {
    const char = source[cursor]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') return cursor + 1
  }
  return source.length
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isImportableFile(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}
