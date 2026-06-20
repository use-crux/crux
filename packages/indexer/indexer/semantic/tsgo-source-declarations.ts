import { extname } from 'node:path'
import ts from 'typescript'
import { propertyName } from '../ast/literals'

export interface TsgoModuleSourceResolver {
  readonly moduleSourceFile: (importingFile: string, moduleSpecifier: string) => ts.SourceFile | undefined
}

/** Returns candidate source paths for a relative TypeScript module specifier. */
export function tsgoModuleCandidates(base: string): readonly string[] {
  if (extname(base)) return [base]
  return [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.cts`,
    `${base}/index.ts`,
    `${base}/index.tsx`,
    `${base}/index.mts`,
    `${base}/index.cts`,
  ]
}

/** Returns the nearest import declaration that owns an import specifier node. */
export function nearestImportDeclaration(node: ts.Node): ts.ImportDeclaration | undefined {
  let current: ts.Node | undefined = node
  while (current && !ts.isSourceFile(current)) {
    if (ts.isImportDeclaration(current)) return current
    current = current.parent
  }
  return undefined
}

/**
 * Finds a declaration by stable symbol data when native-preview declaration
 * handles use byte-shifted ranges for source containing non-ASCII text.
 */
export function nearestNamedDeclaration(
  sourceFile: ts.SourceFile,
  pos: number,
  end: number,
  kindName: string,
  name: string,
): ts.Declaration | undefined {
  const candidates: ts.Declaration[] = []
  const visit = (node: ts.Node): void => {
    if (isDeclarationNode(node) && tsKindName(node.kind) === kindName && declarationName(node) === name) {
      candidates.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return candidates.sort((left, right) => rangeDistance(left, pos, end) - rangeDistance(right, pos, end))[0]
}

/** Resolves named imports to declarations in local source modules. */
export function importedDeclarationsByName(
  sourceFile: ts.SourceFile,
  name: string,
  resolver: TsgoModuleSourceResolver,
): readonly ts.Declaration[] {
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause || !ts.isStringLiteral(statement.moduleSpecifier)) {
      continue
    }
    const namedBindings = statement.importClause.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue
    for (const specifier of namedBindings.elements) {
      if (specifier.name.text !== name) continue
      const importedName = specifier.propertyName?.text ?? specifier.name.text
      const importedSource = resolver.moduleSourceFile(sourceFile.fileName, statement.moduleSpecifier.text)
      return importedSource ? exportedDeclarations(importedSource, importedName, resolver) : []
    }
  }
  return []
}

/** Returns local binding declarations visible before an identifier reference. */
export function localDeclarations(sourceFile: ts.SourceFile, name: string, pos: number | undefined): readonly ts.Declaration[] {
  const declarations: ts.Declaration[] = []
  const visit = (node: ts.Node): void => {
    if (isIdentifierBindingDeclaration(node) && declarationName(node) === name && (pos === undefined || node.pos <= pos)) {
      declarations.push(node)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return declarations.sort((left, right) => right.pos - left.pos)
}

/** Resolves exported declarations, following local named re-exports. */
export function exportedDeclarations(
  sourceFile: ts.SourceFile,
  exportedName: string,
  resolver: TsgoModuleSourceResolver,
): readonly ts.Declaration[] {
  const direct = topLevelDeclarations(sourceFile, exportedName, true)
  if (direct.length > 0) return direct
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue
    for (const specifier of statement.exportClause.elements) {
      if (specifier.name.text !== exportedName) continue
      const localName = specifier.propertyName?.text ?? specifier.name.text
      if (!statement.moduleSpecifier) return topLevelDeclarations(sourceFile, localName, false)
      if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
      const reexportSource = resolver.moduleSourceFile(sourceFile.fileName, statement.moduleSpecifier.text)
      return reexportSource ? exportedDeclarations(reexportSource, localName, resolver) : []
    }
  }
  return []
}

export function isDeclarationNode(node: ts.Node): node is ts.Declaration {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isPropertyAssignment(node) ||
    ts.isShorthandPropertyAssignment(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isParameter(node) ||
    ts.isPropertyDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
}

function topLevelDeclarations(
  sourceFile: ts.SourceFile,
  name: string,
  requireExport: boolean,
): readonly ts.Declaration[] {
  const declarations: ts.Declaration[] = []
  for (const statement of sourceFile.statements) {
    if (requireExport && !hasExportModifier(statement)) continue
    if (ts.isVariableStatement(statement)) {
      declarations.push(
        ...statement.declarationList.declarations.filter((node) => ts.isIdentifier(node.name) && node.name.text === name),
      )
      continue
    }
    if (hasNamedDeclaration(statement, name)) declarations.push(statement)
  }
  return declarations
}

function hasNamedDeclaration(node: ts.Node, name: string): node is ts.Declaration {
  return (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name?.text === name
  )
}

function declarationName(node: ts.Declaration): string | undefined {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text
  if (
    (ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node)) &&
    node.name
  ) {
    return node.name.text
  }
  if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node) || ts.isMethodDeclaration(node)) {
    return propertyName(node.name)
  }
  return undefined
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(ts.canHaveModifiers(node) && ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword))
}

function isIdentifierBindingDeclaration(node: ts.Node): node is ts.Declaration {
  return (
    ts.isVariableDeclaration(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node)
  )
}

function rangeDistance(node: ts.Node, pos: number, end: number): number {
  return Math.abs(node.pos - pos) + Math.abs(node.end - end)
}

function tsKindName(kind: ts.SyntaxKind): string {
  return ts.SyntaxKind[kind] ?? String(kind)
}
