import {
  isArrowFunction,
  isFunctionDeclaration,
  isFunctionExpression,
  isIdentifier,
  isImportDeclaration,
  isVariableStatement,
  type SourceFile,
} from '@typescript/native-preview/unstable/ast'
import { nativeNodeList } from '../tsgo/source'
import type { NativeSourceBinding, NativeVariable } from './types'

/** Source-file-local declarations that native direct projectors can resolve without checker calls. */
export interface NativeDirectFileScope {
  readonly variables: readonly NativeVariable[]
  readonly bindings: readonly NativeSourceBinding[]
}

/** Collects source-file-local declarations that the direct projector can reference safely. */
export function collectNativeDirectFileScope(sourceFile: SourceFile): NativeDirectFileScope | undefined {
  const entries = nativeNodeList(sourceFile.statements).map((statement): NativeDirectFileScope | undefined => {
    if (isImportDeclaration(statement)) return { variables: [], bindings: [] }
    if (isFunctionDeclaration(statement) && statement.name) {
      return {
        variables: [],
        bindings: [
          {
            name: statement.name.text,
            file: sourceFile,
            declaration: statement,
            functionName: statement.name.text,
          },
        ],
      }
    }
    if (!isVariableStatement(statement)) return undefined
    const declarations = nativeNodeList(statement.declarationList.declarations)
    const variables = declarations.map((declaration) =>
      isIdentifier(declaration.name) && declaration.initializer
        ? {
            name: declaration.name.text,
            file: sourceFile,
            declaration,
            initializer: declaration.initializer,
          }
        : undefined,
    )
    if (!variables.every((variable): variable is NativeVariable => Boolean(variable))) return undefined
    return {
      variables,
      bindings: variables.map((variable) => ({
        name: variable.name,
        file: variable.file,
        declaration: variable.declaration,
        initializer: variable.initializer,
        functionName: nativeFunctionExpressionName(variable.name, variable.initializer),
      })),
    }
  })
  if (!entries.every((entry): entry is NativeDirectFileScope => Boolean(entry))) return undefined
  return {
    variables: entries.flatMap((entry) => entry.variables),
    bindings: entries.flatMap((entry) => entry.bindings),
  }
}

/** Builds source-file-local binding lookup tables for native source-ref projection. */
export function nativeBindingMapsByFile(
  scopes: readonly NativeDirectFileScope[],
): ReadonlyMap<SourceFile, ReadonlyMap<string, NativeSourceBinding>> {
  return new Map(
    scopes.flatMap((scope): Array<readonly [SourceFile, ReadonlyMap<string, NativeSourceBinding>]> => {
      const file = scope.bindings[0]?.file
      return file ? [[file, new Map(scope.bindings.map((binding) => [binding.name, binding]))]] : []
    }),
  )
}

function nativeFunctionExpressionName(name: string, initializer: NativeVariable['initializer']): string | undefined {
  return isFunctionExpression(initializer) || isArrowFunction(initializer) ? name : undefined
}
