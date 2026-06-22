import { createHash } from 'node:crypto'
import { relative } from 'node:path'
import ts from 'typescript'
import type {
  StaticCalleeRecord,
  StaticImportRecord,
  StaticInitializerRecord,
  StaticNewSourceMatch,
  StaticObjectValue,
  StaticSourceMatch,
  StaticSyntaxFileInput,
  StaticSyntaxFileRecord,
  StaticSyntaxFrontend,
  StaticSyntaxFrontendOptions,
} from './types'
import { collectImportBindings } from '../../ast/imports'
import { createSourceFile } from '../../ast/parse'
import { sourceForNode, sourceSnippetForNode } from '../../ast/snippets'
import {
  createStaticSyntaxCalleeMatcher,
  type StaticSyntaxCalleeMatcher,
  type StaticSyntaxEvidenceSlice,
} from './interests'
import {
  expressionName,
  staticCalleeRecordFromExpression,
  staticFunctionInitializersFromNode,
  staticFunctionValueFromNode,
  staticInitializerRecordsFromDeclaration,
  staticObjectValueFromExpression,
  staticSyntaxValueFromExpression,
} from './typescript-values'

const DEFAULT_CONSTRUCTOR_NAMES = ['Agent'] as const

type ParsedSourceFile = ts.SourceFile & {
  readonly parseDiagnostics?: readonly ts.Diagnostic[]
}

/**
 * Creates the TypeScript-backed syntax-record frontend.
 *
 * This frontend is a compatibility producer for Phase 10A. It proves the record ABI using the
 * existing TypeScript parser before Rust/Oxc is introduced behind the same `StaticSyntaxFrontend`
 * interface.
 */
export function createTypeScriptStaticSyntaxFrontend(
  options: StaticSyntaxFrontendOptions = {},
): StaticSyntaxFrontend {
  const callMatcher = createStaticSyntaxCalleeMatcher({
    names: options.callNames,
    interests: options.callInterests,
  })
  const constructorMatcher = createStaticSyntaxCalleeMatcher({
    names: options.constructorNames,
    interests: options.constructorInterests,
    defaultNames: DEFAULT_CONSTRUCTOR_NAMES,
  })
  return Object.freeze({
    name: 'typescript' as const,
    identity: { name: 'typescript' as const, version: ts.version },
    parseFile: (input: StaticSyntaxFileInput) => parseTypeScriptSyntaxFile(input, callMatcher, constructorMatcher),
  })
}

function parseTypeScriptSyntaxFile(
  input: StaticSyntaxFileInput,
  callMatcher: StaticSyntaxCalleeMatcher,
  constructorMatcher: StaticSyntaxCalleeMatcher,
): StaticSyntaxFileRecord {
  const sourceFile = createSourceFile(input.file, input.source) as ParsedSourceFile
  const imports = collectImportRecords(input.root, input.file, sourceFile)
  const importsByLocalName = new Map(imports.map((item) => [item.localName, item]))
  const localInitializers = collectLocalInitializers(sourceFile, importsByLocalName)
  const matches = collectMatches({
    root: input.root,
    file: input.file,
    sourceFile,
    importsByLocalName,
    callMatcher,
    constructorMatcher,
  })
  return {
    schemaVersion: 1,
    frontend: { name: 'typescript', version: ts.version },
    file: input.file,
    sourceHash: sha256(input.source),
    imports,
    matches,
    localInitializers,
    diagnostics: (sourceFile.parseDiagnostics ?? []).map((diagnostic, index) => ({
      id: `syntax:${input.file}:${index}`,
      severity: 'error',
      code: 'index.syntax_parse',
      message: ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
      source: diagnostic.start === undefined
        ? { file: input.file, line: 1, column: 1 }
        : sourceForPosition(sourceFile, diagnostic.start),
    })),
  }
}

function collectImportRecords(
  root: string,
  file: string,
  sourceFile: ts.SourceFile,
): readonly StaticImportRecord[] {
  const resolvedByLocalName = collectImportBindings(sourceFile, root, file)
  const records: StaticImportRecord[] = []
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier)) continue
    const moduleSpecifier = statement.moduleSpecifier.text
    const clause = statement.importClause
    if (!clause) continue
    if (clause.name) {
      records.push(importRecord(clause.name.text, 'default', moduleSpecifier, statement, resolvedByLocalName))
    }
    const namedBindings = clause.namedBindings
    if (!namedBindings) continue
    if (ts.isNamespaceImport(namedBindings)) {
      records.push(importRecord(namedBindings.name.text, '*', moduleSpecifier, statement, resolvedByLocalName))
      continue
    }
    for (const element of namedBindings.elements) {
      records.push(
        importRecord(
          element.name.text,
          element.propertyName?.text ?? element.name.text,
          moduleSpecifier,
          statement,
          resolvedByLocalName,
        ),
      )
    }
  }
  return records
}

function importRecord(
  localName: string,
  importedName: string,
  moduleSpecifier: string,
  statement: ts.ImportDeclaration,
  resolvedByLocalName: ReadonlyMap<string, { readonly file: string }>,
): StaticImportRecord {
  const resolved = resolvedByLocalName.get(localName)
  return {
    localName,
    importedName,
    moduleSpecifier,
    ...(resolved ? { resolvedFile: resolved.file } : {}),
    source: sourceForNode(statement.getSourceFile(), statement),
  }
}

function collectLocalInitializers(
  sourceFile: ts.SourceFile,
  importsByLocalName: ReadonlyMap<string, StaticImportRecord>,
): readonly StaticInitializerRecord[] {
  const records: StaticInitializerRecord[] = []
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      records.push({
        name: statement.name.text,
        value: staticFunctionValueFromNode(sourceFile, statement, importsByLocalName),
        source: sourceForNode(sourceFile, statement),
        snippet: sourceSnippetForNode(sourceFile, statement),
      })
      continue
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      records.push(...staticInitializerRecordsFromDeclaration(sourceFile, declaration, importsByLocalName))
    }
  }
  return records
}

function collectMatches(input: {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly importsByLocalName: ReadonlyMap<string, StaticImportRecord>
  readonly callMatcher: StaticSyntaxCalleeMatcher
  readonly constructorMatcher: StaticSyntaxCalleeMatcher
}): readonly StaticSourceMatch[] {
  const matches: StaticSourceMatch[] = []

  const visit = (node: ts.Node, scopedInitializers: readonly StaticInitializerRecord[] = []): void => {
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      const functionInitializers = staticFunctionInitializersFromNode(input.sourceFile, node, input.importsByLocalName)
      ts.forEachChild(node, (child) => visit(child, [...scopedInitializers, ...functionInitializers]))
      return
    }
    if (ts.isVariableStatement(node)) {
      const exported = hasExportModifier(node)
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue
        const match = matchFromInitializer(input, declaration.name.text, declaration.initializer, exported, scopedInitializers)
        if (match) matches.push(match)
      }
      return
    }
    if (ts.isCallExpression(node)) {
      const callee = staticCalleeRecordFromExpression(node.expression, input.importsByLocalName)
      if (input.callMatcher.allows(callee)) {
        matches.push(callMatch(input, `${callee.name}-${sourceForNode(input.sourceFile, node).line}`, node, false, scopedInitializers))
      }
    }
    if (ts.isNewExpression(node)) {
      const match = newMatch(input, `new-${sourceForNode(input.sourceFile, node).line}`, node, false, scopedInitializers)
      if (match) matches.push(match)
    }
    ts.forEachChild(node, (child) => visit(child, scopedInitializers))
  }

  visit(input.sourceFile)
  return matches
}

function matchFromInitializer(
  input: Parameters<typeof collectMatches>[0],
  variableName: string,
  initializer: ts.Expression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
): StaticSourceMatch | undefined {
  if (ts.isObjectLiteralExpression(initializer)) {
    return {
      kind: 'object',
      variableName,
      localName: fallbackLocalName(input.root, input.file, variableName),
      exported,
      object: staticObjectValueFromExpression(input.sourceFile, initializer, input.importsByLocalName),
      source: sourceForNode(input.sourceFile, initializer),
      snippet: sourceSnippetForNode(input.sourceFile, initializer),
      ...(scopedInitializers.length > 0 ? { localInitializers: scopedInitializers } : {}),
    }
  }
  if (ts.isCallExpression(initializer)) {
    const callee = staticCalleeRecordFromExpression(initializer.expression, input.importsByLocalName)
    return input.callMatcher.allows(callee)
      ? callMatch(input, variableName, initializer, exported, scopedInitializers)
      : undefined
  }
  if (ts.isNewExpression(initializer)) return newMatch(input, variableName, initializer, exported, scopedInitializers)
  return undefined
}

function callMatch(
  input: Parameters<typeof collectMatches>[0],
  variableName: string,
  call: ts.CallExpression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
): StaticSourceMatch {
  const callee = staticCalleeRecordFromExpression(call.expression, input.importsByLocalName)
  const evidence = input.callMatcher.evidenceFor(callee)
  const objectArg = objectArgument(call.arguments, evidence)
  const objectValue = objectArg
    ? slicedObjectValue(staticObjectValueFromExpression(input.sourceFile, objectArg, input.importsByLocalName), evidence)
    : undefined
  return {
    kind: 'call',
    variableName,
    localName: fallbackLocalName(input.root, input.file, variableName),
    exported,
    callee,
    args: call.arguments.map((arg) => staticSyntaxValueFromExpression(input.sourceFile, arg, input.importsByLocalName)),
    ...(objectValue ? { objectArg: objectValue } : {}),
    source: sourceForNode(input.sourceFile, call),
    snippet: sourceSnippetForNode(input.sourceFile, call),
    ...(scopedInitializers.length > 0 ? { localInitializers: scopedInitializers } : {}),
  }
}

function newMatch(
  input: Parameters<typeof collectMatches>[0],
  variableName: string,
  node: ts.NewExpression,
  exported: boolean,
  scopedInitializers: readonly StaticInitializerRecord[] = [],
): StaticNewSourceMatch | undefined {
  const name = expressionName(node.expression)
  if (!name) return undefined
  const callee = staticCalleeRecordFromExpression(node.expression, input.importsByLocalName)
  if (!input.constructorMatcher.allows(callee)) return undefined
  const evidence = input.constructorMatcher.evidenceFor(callee)
  const objectArg = objectArgument([...(node.arguments ?? [])], evidence)
  const objectValue = objectArg
    ? slicedObjectValue(staticObjectValueFromExpression(input.sourceFile, objectArg, input.importsByLocalName), evidence)
    : undefined
  return {
    kind: 'new',
    variableName,
    localName: fallbackLocalName(input.root, input.file, variableName),
    exported,
    callee,
    args: [...(node.arguments ?? [])].map((arg) =>
      staticSyntaxValueFromExpression(input.sourceFile, arg, input.importsByLocalName),
    ),
    ...(objectValue ? { objectArg: objectValue } : {}),
    source: sourceForNode(input.sourceFile, node),
    snippet: sourceSnippetForNode(input.sourceFile, node),
    ...(scopedInitializers.length > 0 ? { localInitializers: scopedInitializers } : {}),
  }
}

function objectArgument(
  args: readonly ts.Expression[],
  evidence: StaticSyntaxEvidenceSlice | undefined,
): ts.ObjectLiteralExpression | undefined {
  if (evidence?.configArg !== undefined) {
    const arg = args[evidence.configArg]
    return arg && ts.isObjectLiteralExpression(arg) ? arg : undefined
  }
  return args.find((arg): arg is ts.ObjectLiteralExpression => ts.isObjectLiteralExpression(arg))
}

function slicedObjectValue(
  object: StaticObjectValue,
  evidence: StaticSyntaxEvidenceSlice | undefined,
): StaticObjectValue | undefined {
  if (!evidence) return object
  if (evidence.properties.size === 0) return undefined
  return {
    ...object,
    properties: object.properties.filter((property) => !property.spread && evidence.properties.has(property.name)),
  }
}

function hasExportModifier(node: ts.Node): boolean {
  return Boolean(
    ts.canHaveModifiers(node) &&
    ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
  )
}

function fallbackLocalName(root: string, file: string, variableName: string): string {
  return `${relative(root, file).replace(/\\/g, '/')}:${variableName}`
}

function sourceForPosition(sourceFile: ts.SourceFile, position: number) {
  const line = sourceFile.getLineAndCharacterOfPosition(position)
  return { file: sourceFile.fileName, line: line.line + 1, column: line.character + 1 }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}
