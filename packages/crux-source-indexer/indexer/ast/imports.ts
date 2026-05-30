import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'
import type { ImportBinding } from '../types'

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

export function collectImportBindings(sourceFile: ts.SourceFile, root: string, importerFile: string): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>()
  const resolverConfig = resolverConfigForRoot(root)
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const resolvedFile = resolveImportFile(importerFile, statement.moduleSpecifier.text, resolverConfig)
    if (!resolvedFile) continue
    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) {
      bindings.set(clause.name.text, { importedName: 'default', file: resolvedFile })
    }
    const namedBindings = clause.namedBindings
    if (!namedBindings) continue
    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.set(element.name.text, { importedName: element.propertyName?.text ?? element.name.text, file: resolvedFile })
      }
    }
  }
  return bindings
}

function resolveImportFile(importerFile: string, specifier: string, resolverConfig: ImportResolverConfig | undefined): string | undefined {
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
    const parsed = ts.parseConfigFileTextToJson(configFile, raw)
    if (parsed.error || !isRecord(parsed.config)) return undefined
    const compilerOptions = isRecord(parsed.config.compilerOptions) ? parsed.config.compilerOptions : undefined
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
