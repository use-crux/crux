import ts from 'typescript'
import type { InjectionUseFacts } from '@crux/core/project-index'
import { propertyName } from '../ast/literals'
import type { ExtractedFacts } from '../extensions'

/**
 * Derives partial prompt injection facts from Convex runtime prepare helpers.
 *
 * This is a pure AST projection: it walks the supplied source file and returns
 * synthetic facts for runtime-only `use` arrays without reading files, writing
 * state, or mutating the source tree.
 */
export function staticRuntimePrepareFacts(sourceFile: ts.SourceFile): ExtractedFacts[] {
  const functions = new Map<string, ts.FunctionDeclaration>()
  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement)
  }

  const facts: ExtractedFacts[] = []
  const visit = (node: ts.Node): void => {
    if (!ts.isReturnStatement(node) || !node.expression) {
      ts.forEachChild(node, visit)
      return
    }
    const object = returnedObjectLiteral(node.expression)
    const useExpression = object ? propertyExpressionFromObject(object, 'use') : undefined
    const helperCall = useExpression ? awaitedCallExpression(useExpression) : undefined
    const helperName = helperCall ? expressionName(helperCall.expression) : undefined
    const helper = helperName ? functions.get(helperName) : undefined
    const promptVariable = preparePromptVariable(node)
    if (!helperCall || !helper || !promptVariable) {
      ts.forEachChild(node, visit)
      return
    }

    const useEntries = runtimeUseEntriesFromHelper(helper, helperCall, sourceFile)
    if (useEntries.length > 0) {
      const promptId = `prompt:${safeRuntimeId(promptVariable)}`
      facts.push({
        definitions: [
          {
            variableName: `runtimePrepare:${promptVariable}`,
            definition: {
              id: promptId,
              kind: 'prompt',
              name: promptVariable,
              fidelity: 'partial',
              status: 'active',
              metadata: {
                facts: {
                  kind: 'prompt',
                  useEntries,
                },
              },
            },
          },
        ],
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return facts
}

/**
 * Unwraps return expressions that directly return object literals.
 */
function returnedObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isParenthesizedExpression(expression) && ts.isObjectLiteralExpression(expression.expression))
    return expression.expression
  return ts.isObjectLiteralExpression(expression) ? expression : undefined
}

/**
 * Reads a property initializer from a returned object literal.
 */
function propertyExpressionFromObject(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const assignment = object.properties.find((item): item is ts.PropertyAssignment => {
    if (!ts.isPropertyAssignment(item)) return false
    return propertyName(item.name) === property
  })
  return assignment?.initializer
}

/**
 * Returns a simple identifier/property name for a call expression target.
 */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/**
 * Finds the prompt variable from Convex prepare result/args generic annotations.
 */
function preparePromptVariable(node: ts.Node): string | undefined {
  let current: ts.Node | undefined = node
  while (current) {
    const typeText = ts.isFunctionLike(current) && current.type ? current.type.getText() : undefined
    const match = typeText?.match(/ConvexAgentPrepare(?:Args|Result)<typeof\s+([A-Za-z_$][\w$]*)>/)
    if (match?.[1]) return match[1]
    current = current.parent
  }
  return undefined
}

/**
 * Normalizes awaited and non-awaited call expressions to the underlying call.
 */
function awaitedCallExpression(expression: ts.Expression): ts.CallExpression | undefined {
  const unwrapped = ts.isAwaitExpression(expression) ? expression.expression : expression
  return ts.isCallExpression(unwrapped) ? unwrapped : undefined
}

/**
 * Extracts runtime use entries from the helper function called by a prepare
 * return value.
 */
function runtimeUseEntriesFromHelper(
  helper: ts.FunctionDeclaration,
  call: ts.CallExpression,
  sourceFile: ts.SourceFile,
): InjectionUseFacts[] {
  const localInitializers = new Map<string, ts.Expression>()
  helper.forEachChild((node) => collectFunctionScopedInitializers(node, localInitializers))
  const argumentTextByParameter = new Map<string, string>()
  helper.parameters.forEach((parameter, index) => {
    if (!ts.isIdentifier(parameter.name)) return
    const argument = call.arguments[index]
    if (argument) argumentTextByParameter.set(parameter.name.text, argument.getText(sourceFile))
  })

  const entries: InjectionUseFacts[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = ts.isParenthesizedExpression(node.expression) ? node.expression.expression : node.expression
      if (ts.isArrayLiteralExpression(expression)) {
        entries.push(...runtimeUseEntriesFromArray(expression, sourceFile, localInitializers, argumentTextByParameter))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(helper)
  return entries
}

/**
 * Collects variable initializers declared inside a helper function body.
 */
function collectFunctionScopedInitializers(node: ts.Node, localInitializers: Map<string, ts.Expression>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    localInitializers.set(node.name.text, node.initializer)
  }
  ts.forEachChild(node, (child) => collectFunctionScopedInitializers(child, localInitializers))
}

/**
 * Converts a returned runtime use array into normalized use-entry facts.
 */
function runtimeUseEntriesFromArray(
  array: ts.ArrayLiteralExpression,
  sourceFile: ts.SourceFile,
  localInitializers: ReadonlyMap<string, ts.Expression>,
  argumentTextByParameter: ReadonlyMap<string, string>,
): InjectionUseFacts[] {
  return array.elements.flatMap((element): InjectionUseFacts[] => {
    if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
      const initializer = localInitializers.get(element.expression.text)
      if (initializer && ts.isConditionalExpression(initializer)) {
        return runtimeUseEntriesFromConditionalArray(initializer, sourceFile, argumentTextByParameter)
      }
      return [runtimeUseEntry(element.expression.getText(sourceFile), { conditionality: 'dynamic', via: 'spread' })]
    }
    return [runtimeUseEntry(element.getText(sourceFile), { conditionality: 'dynamic', via: 'runtime' })]
  })
}

/**
 * Converts conditional array branches into conditional runtime use-entry facts.
 */
function runtimeUseEntriesFromConditionalArray(
  expression: ts.ConditionalExpression,
  sourceFile: ts.SourceFile,
  argumentTextByParameter: ReadonlyMap<string, string>,
): InjectionUseFacts[] {
  const condition = substitutePrepareArguments(expression.condition.getText(sourceFile), argumentTextByParameter)
  const whenTrue = ts.isArrayLiteralExpression(expression.whenTrue)
    ? runtimeUseEntriesFromArray(expression.whenTrue, sourceFile, new Map(), argumentTextByParameter)
    : []
  return whenTrue.map((entry) => ({
    ...entry,
    conditionality: 'when',
    via: 'runtime',
    branch: condition,
  }))
}

/**
 * Replaces helper parameter references in a condition with call-site argument
 * text for more useful branch evidence.
 */
function substitutePrepareArguments(text: string, argumentTextByParameter: ReadonlyMap<string, string>): string {
  let result = text
  for (const [name, value] of argumentTextByParameter) {
    result = result.replace(new RegExp(`\\b${escapeRegExp(name)}\\.`, 'g'), `${value}.`)
  }
  return result
}

/**
 * Creates one normalized runtime use-entry fact.
 */
function runtimeUseEntry(
  variable: string,
  defaults: Pick<InjectionUseFacts, 'conditionality' | 'via'>,
): InjectionUseFacts {
  return {
    variable,
    relationHint: runtimeRelationHint(variable),
    ...defaults,
  }
}

/**
 * Infers the relation hint from a runtime variable name.
 */
function runtimeRelationHint(variable: string): InjectionUseFacts['relationHint'] {
  const lower = variable.toLowerCase()
  if (lower.includes('memory')) return 'memory'
  if (lower.includes('blackboard')) return 'blackboard'
  return 'unknown'
}

/**
 * Converts a runtime variable name into the stable id fragment used for
 * synthetic prompt ids.
 */
function safeRuntimeId(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .toLowerCase()
}

/**
 * Escapes literal text for use inside a generated regular expression.
 */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
