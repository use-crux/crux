import ts from 'typescript'
import { sha256 } from './cache-identity'
import { compareCodepoint } from './sort'

/** Hash evidence for one Project Index source row. */
export interface SourceInterfaceHashEvidence {
  /** SHA-256 hash of the exact UTF-8 source text. */
  readonly sourceHash: string
  /** SHA-256 hash of the exported source surface that dependents can observe. */
  readonly interfaceHash: string
}

/**
 * Computes the source and exported-interface hashes used by incremental planning.
 *
 * `sourceHash` answers whether a file changed at all. `interfaceHash` answers
 * whether dependent files can observe that change. The interface projection is
 * deliberately conservative: exported object/schema initializers are included,
 * while function and method bodies are reduced to signatures so body-only edits
 * can stop at the edited file.
 */
export function sourceInterfaceHashEvidence(file: string, source: string): SourceInterfaceHashEvidence {
  return {
    sourceHash: sha256(source),
    interfaceHash: sourceInterfaceHash(file, source),
  }
}

/** Computes only the exported-interface hash for a source file. */
export function sourceInterfaceHash(file: string, source: string): string {
  return sourceInterfaceHashFromSourceFile(ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true))
}

/** Computes the exported-interface hash from an already parsed TypeScript source file. */
export function sourceInterfaceHashFromSourceFile(sourceFile: ts.SourceFile): string {
  const rows = exportedInterfaceRows(sourceFile)
  return sha256(JSON.stringify(rows.sort(compareCodepoint)))
}

function exportedInterfaceRows(sourceFile: ts.SourceFile): string[] {
  const exportedLocals = localExports(sourceFile)
  const rows: string[] = []
  for (const statement of sourceFile.statements) {
    rows.push(...statementInterfaceRows(sourceFile, statement, exportedLocals))
  }
  return rows
}

function statementInterfaceRows(
  sourceFile: ts.SourceFile,
  statement: ts.Statement,
  exportedLocals: ReadonlyMap<string, string>,
): string[] {
  if (ts.isExportDeclaration(statement)) return exportDeclarationRows(sourceFile, statement)
  if (ts.isExportAssignment(statement)) return [`export-assignment:${printed(sourceFile, statement.expression)}`]

  const directExport = hasExportModifier(statement)
  if (ts.isFunctionDeclaration(statement)) {
    const name = statement.name?.text
    const exportedName = directExport ? exportedDeclarationName(statement, name) : name ? exportedLocals.get(name) : undefined
    return exportedName ? [`function:${exportedName}:${functionSignature(sourceFile, statement)}`] : []
  }
  if (ts.isClassDeclaration(statement)) {
    const name = statement.name?.text
    const exportedName = directExport ? exportedDeclarationName(statement, name) : name ? exportedLocals.get(name) : undefined
    return exportedName ? [`class:${exportedName}:${classSignature(sourceFile, statement)}`] : []
  }
  if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
    const exportedName = directExport ? exportedDeclarationName(statement, statement.name.text) : exportedLocals.get(statement.name.text)
    return exportedName ? [`declaration:${exportedName}:${printed(sourceFile, statement)}`] : []
  }
  if (ts.isVariableStatement(statement)) {
    return variableStatementRows(sourceFile, statement, directExport, exportedLocals)
  }
  return []
}

function variableStatementRows(
  sourceFile: ts.SourceFile,
  statement: ts.VariableStatement,
  directExport: boolean,
  exportedLocals: ReadonlyMap<string, string>,
): string[] {
  const rows: string[] = []
  for (const declaration of statement.declarationList.declarations) {
    for (const localName of bindingNames(declaration.name)) {
      const exportedName = directExport ? exportedDeclarationName(statement, localName) : exportedLocals.get(localName)
      if (!exportedName) continue
      rows.push(
        [
          'variable',
          exportedName,
          declaration.type ? printed(sourceFile, declaration.type) : '',
          declaration.initializer ? initializerInterface(sourceFile, declaration.initializer) : '',
        ].join(':'),
      )
    }
  }
  return rows
}

function exportDeclarationRows(sourceFile: ts.SourceFile, statement: ts.ExportDeclaration): string[] {
  const moduleSpecifier = statement.moduleSpecifier ? printed(sourceFile, statement.moduleSpecifier) : ''
  const clause = statement.exportClause
  if (!clause) return [`export-all:${moduleSpecifier}`]
  if (ts.isNamespaceExport(clause)) return [`export-namespace:${clause.name.text}:${moduleSpecifier}`]
  return clause.elements.map((element) =>
    [
      'export',
      element.propertyName?.text ?? element.name.text,
      element.name.text,
      moduleSpecifier,
    ].join(':'),
  )
}

function localExports(sourceFile: ts.SourceFile): ReadonlyMap<string, string> {
  const exports = new Map<string, string>()
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || statement.moduleSpecifier) continue
    if (!ts.isNamedExports(statement.exportClause)) continue
    for (const element of statement.exportClause.elements) {
      exports.set(element.propertyName?.text ?? element.name.text, element.name.text)
    }
  }
  return exports
}

function exportedDeclarationName(node: ts.Node, fallback: string | undefined): string {
  return hasDefaultModifier(node) ? 'default' : fallback ?? 'default'
}

function bindingNames(name: ts.BindingName): readonly string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => {
    if (ts.isOmittedExpression(element)) return []
    return bindingNames(element.name)
  })
}

function initializerInterface(sourceFile: ts.SourceFile, expression: ts.Expression): string {
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return functionSignature(sourceFile, expression)
  }
  if (ts.isClassExpression(expression)) {
    return classSignature(sourceFile, expression)
  }
  return printed(sourceFile, expression)
}

function functionSignature(
  sourceFile: ts.SourceFile,
  node: ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction | ts.MethodDeclaration,
): string {
  return [
    typeParameters(sourceFile, node.typeParameters),
    parameters(sourceFile, node.parameters),
    node.type ? printed(sourceFile, node.type) : '',
  ].join(':')
}

function classSignature(sourceFile: ts.SourceFile, node: ts.ClassDeclaration | ts.ClassExpression): string {
  const heritage = node.heritageClauses?.map((clause) => printed(sourceFile, clause)).join('|') ?? ''
  const members = node.members.map((member) => classMemberSignature(sourceFile, member)).filter(Boolean).sort(compareCodepoint)
  return [heritage, ...members].join(':')
}

function classMemberSignature(sourceFile: ts.SourceFile, member: ts.ClassElement): string {
  if (hasPrivateModifier(member)) return ''
  if (ts.isMethodDeclaration(member)) return `method:${memberName(sourceFile, member.name)}:${functionSignature(sourceFile, member)}`
  if (ts.isPropertyDeclaration(member)) {
    return [
      'property',
      memberName(sourceFile, member.name),
      member.type ? printed(sourceFile, member.type) : '',
      member.initializer ? initializerInterface(sourceFile, member.initializer) : '',
    ].join(':')
  }
  if (ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member)) {
    return `accessor:${memberName(sourceFile, member.name)}:${accessorSignature(sourceFile, member)}`
  }
  return printed(sourceFile, member)
}

function accessorSignature(
  sourceFile: ts.SourceFile,
  node: ts.GetAccessorDeclaration | ts.SetAccessorDeclaration,
): string {
  return [
    parameters(sourceFile, node.parameters),
    node.type ? printed(sourceFile, node.type) : '',
  ].join(':')
}

function parameters(sourceFile: ts.SourceFile, parameters: ts.NodeArray<ts.ParameterDeclaration>): string {
  return parameters.map((parameter) =>
    [
      parameter.dotDotDotToken ? '...' : '',
      printed(sourceFile, parameter.name),
      parameter.questionToken ? '?' : '',
      parameter.type ? printed(sourceFile, parameter.type) : '',
      parameter.initializer ? initializerInterface(sourceFile, parameter.initializer) : '',
    ].join(''),
  ).join(',')
}

function typeParameters(
  sourceFile: ts.SourceFile,
  parameters: ts.NodeArray<ts.TypeParameterDeclaration> | undefined,
): string {
  return parameters?.map((parameter) => printed(sourceFile, parameter)).join(',') ?? ''
}

function memberName(sourceFile: ts.SourceFile, name: ts.PropertyName | undefined): string {
  return name ? printed(sourceFile, name) : ''
}

function hasExportModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.ExportKeyword)
}

function hasDefaultModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.DefaultKeyword)
}

function hasPrivateModifier(node: ts.Node): boolean {
  return hasModifier(node, ts.SyntaxKind.PrivateKeyword)
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some((modifier) => modifier.kind === kind) ?? false)
}

function printed(sourceFile: ts.SourceFile, node: ts.Node): string {
  return ts.createPrinter({ removeComments: true }).printNode(ts.EmitHint.Unspecified, node, sourceFile)
}
