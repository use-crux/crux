import { resolveSemanticSourceImportFile } from './source-import-resolver'
import { compareCodepoint } from '../sort'

export interface SemanticSourceImportDependency {
  /** Absolute local source file resolved from the import specifier. */
  readonly file: string
  /** Authored module specifier from the import declaration. */
  readonly moduleSpecifier: string
}

export interface SemanticSourceImportDependencyInput {
  /** Absolute Project Index root used for tsconfig path alias lookup. */
  readonly root: string
  /** Absolute file path of the source text containing imports. */
  readonly importerFile: string
  /** Source text to scan for static ES import declarations. */
  readonly source: string
}

/**
 * Collects local source dependencies from static import declarations in source text.
 *
 * This intentionally avoids TypeScript AST construction. Semantic preflight
 * only needs a conservative local dependency closure for cache identity and
 * backend setup; backend-specific analyzers own exact syntax traversal.
 */
export function collectSemanticSourceImportDependencies(
  input: SemanticSourceImportDependencyInput,
): readonly SemanticSourceImportDependency[] {
  const dependencies = new Map<string, SemanticSourceImportDependency>()

  for (const moduleSpecifier of staticImportSpecifiers(input.source)) {
    const file = resolveSemanticSourceImportFile(input.root, input.importerFile, moduleSpecifier)
    if (!file) continue
    dependencies.set(file, { file, moduleSpecifier })
  }

  return [...dependencies.values()].sort((left, right) => compareCodepoint(left.file, right.file))
}

/**
 * Finds static import declarations with bindings and returns their module specifiers.
 *
 * Side-effect imports are intentionally ignored to match the historical
 * semantic preflight behavior, which followed import bindings rather than all
 * executable module dependencies.
 */
function staticImportSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = []
  let index = 0

  while (index < source.length) {
    const skipped = skipStringOrComment(source, index)
    if (skipped !== index) {
      index = skipped
      continue
    }

    if (isKeywordAt(source, index, 'import')) {
      const parsed = parseStaticImportDeclaration(source, index + 'import'.length)
      if (parsed) {
        if (parsed.hasBindings) specifiers.push(parsed.specifier)
        index = parsed.end
        continue
      }
    }

    index += 1
  }

  return specifiers
}

interface ParsedImportDeclaration {
  readonly specifier: string
  readonly hasBindings: boolean
  readonly end: number
}

function parseStaticImportDeclaration(source: string, start: number): ParsedImportDeclaration | undefined {
  let cursor = skipWhitespaceAndComments(source, start)
  if (source[cursor] === '(' || source[cursor] === '.') return undefined

  const sideEffect = readStringLiteral(source, cursor)
  if (sideEffect) {
    return { specifier: sideEffect.value, hasBindings: false, end: sideEffect.end }
  }

  while (cursor < source.length) {
    const skipped = skipStringOrComment(source, cursor)
    if (skipped !== cursor) {
      cursor = skipped
      continue
    }
    if (source[cursor] === ';') return undefined
    if (isKeywordAt(source, cursor, 'from')) {
      const moduleSpecifier = readStringLiteral(source, skipWhitespaceAndComments(source, cursor + 'from'.length))
      if (moduleSpecifier) {
        return { specifier: moduleSpecifier.value, hasBindings: true, end: moduleSpecifier.end }
      }
    }
    cursor += 1
  }

  return undefined
}

function readStringLiteral(source: string, start: number): { readonly value: string; readonly end: number } | undefined {
  const quote = source[start]
  if (quote !== "'" && quote !== '"') return undefined
  let escaped = false
  for (let index = start + 1; index < source.length; index += 1) {
    const char = source[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === quote) return { value: source.slice(start + 1, index), end: index + 1 }
  }
  return undefined
}

function skipWhitespaceAndComments(source: string, start: number): number {
  let index = start
  while (index < source.length) {
    if (/\s/.test(source[index] ?? '')) {
      index += 1
      continue
    }
    const skipped = skipComment(source, index)
    if (skipped === index) return index
    index = skipped
  }
  return index
}

function skipStringOrComment(source: string, index: number): number {
  const commentEnd = skipComment(source, index)
  if (commentEnd !== index) return commentEnd
  const stringEnd = skipStringLike(source, index)
  return stringEnd !== index ? stringEnd : index
}

function skipComment(source: string, index: number): number {
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

function skipStringLike(source: string, index: number): number {
  const quote = source[index]
  if (quote !== "'" && quote !== '"' && quote !== '`') return index
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
    if (char === quote) return cursor + 1
  }
  return source.length
}

function isKeywordAt(source: string, index: number, keyword: string): boolean {
  return (
    source.startsWith(keyword, index) &&
    !isIdentifierPart(source[index - 1]) &&
    !isIdentifierPart(source[index + keyword.length])
  )
}

function isIdentifierPart(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9_$]/.test(char))
}
