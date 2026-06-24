import {
  isArrowFunction,
  isFunctionExpression,
  isIdentifier,
  isMethodDeclaration,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  type Expression,
  type ObjectLiteralExpression,
} from '@typescript/native-preview/unstable/ast'
import { nativeNodeList, nativeSourceForNode, nativeSourceSnippetForNode } from '../tsgo/source'
import { propertyInitializer, propertyName } from './object'
import type { NativeDirectSourceRefSpec } from './manifest'
import type { NativeDefinition, NativeSourceBinding, SourceRefFact } from './types'

/** Input for source refs resolved from direct native AST bindings. */
export interface NativeDirectSourceRefInput {
  readonly definitionId: string
  readonly role: SourceRefFact['ref']['role']
  readonly property: string
  readonly expression: Expression
  readonly bindings: ReadonlyMap<string, NativeSourceBinding>
  readonly metadata?: SourceRefFact['ref']['metadata']
}

/** Emits direct source-ref evidence for manifest-declared resolvable properties. */
export function sourceRefEvidenceForDefinition(
  definition: NativeDefinition,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): readonly SourceRefFact[] | undefined {
  const refs = definition.primitive.sourceRefs.map((spec) => {
    const expression = propertyInitializer(definition.object, spec.property)
    return expression ? sourceRefEvidenceForExpression(definition.id, spec, expression, bindings) : []
  })
  return refs.every((entry): entry is readonly SourceRefFact[] => Boolean(entry)) ? refs.flat() : undefined
}

/** Creates one direct source-ref fact for a resolved native expression. */
export function nativeDirectSourceRefForExpression(input: NativeDirectSourceRefInput): SourceRefFact | undefined {
  const resolved = nativeResolvedSourceBinding(input.expression, input.bindings)
  if (!resolved || resolved === 'not-resolvable') return undefined
  return {
    definitionId: input.definitionId,
    ref: {
      id: `${input.definitionId}:source:${input.role}:${input.property}:${resolved.symbol}`,
      role: input.role,
      property: input.property,
      symbol: resolved.symbol,
      source: resolved.binding.functionName
        ? { ...nativeSourceForNode(resolved.binding.file, resolved.binding.declaration), function: resolved.binding.functionName }
        : nativeSourceForNode(resolved.binding.file, resolved.binding.declaration),
      snippet: nativeSourceSnippetForNode(resolved.binding.file, resolved.binding.declaration),
      fidelity: 'resolved',
      ...(input.metadata ? { metadata: input.metadata } : {}),
    },
  }
}

function sourceRefEvidenceForExpression(
  definitionId: string,
  spec: NativeDirectSourceRefSpec,
  expression: Expression,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): readonly SourceRefFact[] | undefined {
  const resolved = nativeResolvedSourceBinding(expression, bindings)
  if (resolved === 'not-resolvable') return []
  const ref = nativeDirectSourceRefForExpression({
    definitionId,
    role: spec.role,
    property: spec.property,
    expression,
    bindings,
    metadata: spec.metadata,
  })
  return ref ? [ref] : undefined
}

function nativeResolvedSourceBinding(
  expression: Expression,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): { readonly symbol: string; readonly binding: NativeSourceBinding } | 'not-resolvable' | undefined {
  if (isIdentifier(expression)) {
    const binding = bindings.get(expression.text)
    return binding ? { symbol: expression.text, binding } : undefined
  }
  if (!isPropertyAccessExpression(expression) || !isIdentifier(expression.expression)) {
    return 'not-resolvable'
  }
  const binding = propertyBinding(bindings.get(expression.expression.text), expression.name.text)
  return binding ? { symbol: `${expression.expression.text}.${expression.name.text}`, binding } : undefined
}

function propertyBinding(
  owner: NativeSourceBinding | undefined,
  property: string,
): NativeSourceBinding | undefined {
  return owner?.initializer && isObjectLiteralExpression(owner.initializer)
    ? objectPropertyBinding(owner.initializer, owner.file, property)
    : undefined
}

function objectPropertyBinding(
  object: ObjectLiteralExpression,
  file: NativeSourceBinding['file'],
  name: string,
): NativeSourceBinding | undefined {
  return nativeNodeList(object.properties)
    .map((property): NativeSourceBinding | undefined => {
      if (
        (isPropertyAssignment(property) || isShorthandPropertyAssignment(property) || isMethodDeclaration(property)) &&
        propertyName(property.name) === name
      ) {
        return {
          name,
          file,
          declaration: property,
          initializer: isPropertyAssignment(property) ? property.initializer : undefined,
          functionName: isMethodDeclaration(property)
            ? name
            : isPropertyAssignment(property) && (isFunctionExpression(property.initializer) || isArrowFunction(property.initializer))
              ? name
              : undefined,
        }
      }
      return undefined
    })
    .find((binding): binding is NativeSourceBinding => Boolean(binding))
}
