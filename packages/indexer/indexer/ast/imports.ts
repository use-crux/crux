import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import ts from 'typescript'

/**
 * Resolved import binding for an identifier visible in a source file.
 *
 * Static extraction stores both the resolved file path and the authored module specifier. The file
 * path supports same-pass dependency parsing, while `moduleSpecifier` lets extractor patterns match
 * imported APIs without confusing them with same-named local helpers.
 */
export interface ImportBinding {
  importedName: string
  file: string
  moduleSpecifier: string
}

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
 * Collects local identifiers introduced by static ES imports in one source file.
 *
 * Only imports that can be resolved to a local project file are returned. Package imports still
 * matter for extractor pattern matching through the authored module specifier, but they do not become
 * source-file dependencies unless the resolver can map them to project source.
 */
export function collectImportBindings(
  sourceFile: ts.SourceFile,
  root: string,
  importerFile: string,
): Map<string, ImportBinding> {
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
      bindings.set(clause.name.text, {
        importedName: 'default',
        file: resolvedFile,
        moduleSpecifier: statement.moduleSpecifier.text,
      })
    }
    const namedBindings = clause.namedBindings
    if (!namedBindings) continue
    if (ts.isNamedImports(namedBindings)) {
      for (const element of namedBindings.elements) {
        bindings.set(element.name.text, {
          importedName: element.propertyName?.text ?? element.name.text,
          file: resolvedFile,
          moduleSpecifier: statement.moduleSpecifier.text,
        })
      }
    }
  }
  return bindings
}

/**
 * Resolves an import specifier to a project source file when static extraction can safely follow it.
 *
 * Relative imports are resolved from the importing file. Bare imports are only followed when the
 * project `tsconfig.json` declares a matching path alias; package resolution is intentionally outside
 * this source-indexing pass.
 */
function resolveImportFile(
  importerFile: string,
  specifier: string,
  resolverConfig: ImportResolverConfig | undefined,
): string | undefined {
  if (specifier.startsWith('.')) return resolveImportBase(resolve(dirname(importerFile), specifier))
  const aliasBase = resolveAliasBase(specifier, resolverConfig)
  return aliasBase ? resolveImportBase(aliasBase) : undefined
}

/**
 * Applies the supported TypeScript/JavaScript source-file suffix search for an import base path.
 *
 * Declaration files are excluded because they do not contain authored Crux runtime definitions.
 */
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

/**
 * Resolves a bare specifier through the cached `tsconfig.json` path aliases for the project root.
 */
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

/**
 * Returns the parsed path-alias resolver config for a project root.
 *
 * The config is cached per root because import collection is called for many files during a compiler
 * pass and the alias config is immutable for that pass.
 */
function resolverConfigForRoot(root: string): ImportResolverConfig | undefined {
  const cached = resolverConfigCache.get(root)
  if (resolverConfigCache.has(root)) return cached
  const loaded = loadResolverConfig(root)
  resolverConfigCache.set(root, loaded)
  return loaded
}

/**
 * Loads the subset of `tsconfig.json` needed for static import alias resolution.
 *
 * Invalid, missing, or unsupported configs simply disable alias resolution; extraction continues with
 * relative imports so a broken config read cannot prevent local file indexing.
 */
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

/**
 * Converts one `compilerOptions.paths` entry into a prefix/suffix matcher.
 *
 * The resolver supports the same single-wildcard shape used by common TypeScript aliases such as
 * `@/* -> src/*`.
 */
function pathAlias(pattern: string, targets: unknown): PathAlias | undefined {
  if (!Array.isArray(targets)) return undefined
  const star = pattern.indexOf('*')
  const prefix = star === -1 ? pattern : pattern.slice(0, star)
  const suffix = star === -1 ? '' : pattern.slice(star + 1)
  const stringTargets = targets.filter((target): target is string => typeof target === 'string')
  return stringTargets.length > 0 ? { prefix, suffix, targets: stringTargets } : undefined
}

/** Narrows unknown parsed JSON values before reading nested compiler options. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Checks whether a resolved candidate is a source file static extraction can parse.
 *
 * Filesystem failures are treated as a normal miss because many candidate suffixes are expected not
 * to exist.
 */
function isImportableFile(file: string): boolean {
  if (file.endsWith('.d.ts')) return false
  try {
    return statSync(file).isFile()
  } catch {
    return false
  }
}
