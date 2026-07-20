import { readFile } from 'node:fs/promises'
import ts from 'typescript'

export interface DeferSourceEvidence {
  readonly active: boolean
  readonly named: boolean
  readonly hostCapabilityMissing: boolean
  readonly namedDurabilityMissing: readonly string[]
}

const HOST_WRAPPERS = [
  'withCrux',
  'withNextDefer',
  'withNodeDefer',
  'withAfterDefer',
  'withServerlessDefer',
  'withWaitUntilDefer',
] as const

type HostWrapper = (typeof HOST_WRAPPERS)[number]

interface WrapperCapability {
  readonly wrapper: HostWrapper
  readonly namedDurable: boolean
}

/** Inspect authored defer overloads and host wrappers with TypeScript syntax. */
export async function inspectDeferSources(
  files: readonly string[],
): Promise<DeferSourceEvidence> {
  const evidence = await Promise.all(files.map(inspectFile))
  return {
    active: evidence.some(({ active }) => active),
    named: evidence.some(({ named }) => named),
    hostCapabilityMissing: evidence.some(
      ({ hostCapabilityMissing }) => hostCapabilityMissing,
    ),
    namedDurabilityMissing: [
      ...new Set(
        evidence.flatMap(
          ({ namedDurabilityMissing }) => namedDurabilityMissing,
        ),
      ),
    ].sort(),
  }
}

async function inspectFile(file: string): Promise<{
  readonly active: boolean
  readonly named: boolean
  readonly hostCapabilityMissing: boolean
  readonly namedDurabilityMissing: readonly string[]
}> {
  const source = ts.createSourceFile(
    file,
    await readFile(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  const deferBindings = importedBindings(source, new Set(['defer']))
  const hostBindings = importedBindingMap(source, new Set(HOST_WRAPPERS))
  let active = false
  let named = false
  let hostCapabilityMissing = false
  const namedDurabilityMissing = new Set<string>()
  const wrapped = wrappedFunctions(source, hostBindings)

  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      if (deferBindings.has(node.expression.text)) {
        active = true
        const namedCall = node.arguments.length >= 2
        named ||= namedCall
        const capabilities = containingCapabilities(node, wrapped)
        hostCapabilityMissing ||= capabilities.length === 0
        if (
          namedCall &&
          capabilities.length > 0 &&
          !capabilities.some(({ namedDurable }) => namedDurable)
        ) {
          for (const { wrapper } of capabilities) {
            namedDurabilityMissing.add(wrapper)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return {
    active,
    named,
    hostCapabilityMissing,
    namedDurabilityMissing: [...namedDurabilityMissing],
  }
}

function wrappedFunctions(
  source: ts.SourceFile,
  hostBindings: ReadonlyMap<string, string>,
): ReadonlyMap<ts.FunctionLikeDeclaration, readonly WrapperCapability[]> {
  const topLevelFunctions = new Map<string, ts.FunctionLikeDeclaration>()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      topLevelFunctions.set(statement.name.text, statement)
    }
    if (!ts.isVariableStatement(statement)) continue
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.initializer &&
        isFunctionLike(declaration.initializer)
      ) {
        topLevelFunctions.set(declaration.name.text, declaration.initializer)
      }
    }
  }

  const wrapped = new Map<ts.FunctionLikeDeclaration, WrapperCapability[]>()
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      hostBindings.has(node.expression.text)
    ) {
      const exported = hostBindings.get(node.expression.text)
      if (!isHostWrapper(exported)) {
        ts.forEachChild(node, visit)
        return
      }
      const argument = node.arguments[0]
      const target =
        argument && isFunctionLike(argument)
          ? argument
          : argument && ts.isIdentifier(argument)
            ? topLevelFunctions.get(argument.text)
            : undefined
      if (target) {
        const capabilities = wrapped.get(target) ?? []
        capabilities.push({
          wrapper: exported,
          namedDurable:
            exported !== 'withNodeDefer' &&
            hasLiteralDurableFinalization(node.arguments[1]),
        })
        wrapped.set(target, capabilities)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return wrapped
}

function containingCapabilities(
  node: ts.Node,
  functions: ReadonlyMap<
    ts.FunctionLikeDeclaration,
    readonly WrapperCapability[]
  >,
): readonly WrapperCapability[] {
  for (let current = node.parent; current; current = current.parent) {
    const capabilities = functions.get(current as ts.FunctionLikeDeclaration)
    if (capabilities) return capabilities
  }
  return []
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node)
}

function importedBindings(
  source: ts.SourceFile,
  exports: ReadonlySet<string>,
): ReadonlySet<string> {
  const bindings = new Set<string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!statement.moduleSpecifier.text.startsWith('@use-crux/')) continue
    for (const element of statement.importClause?.namedBindings &&
    ts.isNamedImports(statement.importClause.namedBindings)
      ? statement.importClause.namedBindings.elements
      : []) {
      if (exports.has(element.propertyName?.text ?? element.name.text)) {
        bindings.add(element.name.text)
      }
    }
  }
  return bindings
}

function importedBindingMap(
  source: ts.SourceFile,
  exports: ReadonlySet<string>,
): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>()
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue
    if (!statement.moduleSpecifier.text.startsWith('@use-crux/')) continue
    const namedBindings = statement.importClause?.namedBindings
    if (!namedBindings || !ts.isNamedImports(namedBindings)) continue
    for (const element of namedBindings.elements) {
      const exported = element.propertyName?.text ?? element.name.text
      if (exports.has(exported)) bindings.set(element.name.text, exported)
    }
  }
  return bindings
}

function isHostWrapper(value: string | undefined): value is HostWrapper {
  return HOST_WRAPPERS.includes(value as HostWrapper)
}

function hasLiteralDurableFinalization(
  options: ts.Expression | undefined,
): boolean {
  if (!options || !ts.isObjectLiteralExpression(options)) return false
  let proven = false
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      proven = false
      continue
    }
    const name = propertyName(property.name)
    if (name !== 'durableFinalization') continue
    proven =
      ts.isPropertyAssignment(property) &&
      property.initializer.kind === ts.SyntaxKind.TrueKeyword
  }
  return proven
}

function propertyName(name: ts.PropertyName | undefined): string | undefined {
  if (!name) return undefined
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text
  return undefined
}
