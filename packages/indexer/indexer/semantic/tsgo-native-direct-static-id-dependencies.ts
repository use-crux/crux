import { safeId } from '../definitions'
import { projectRelation } from '../relations'
import {
  isArrayLiteralExpression,
  isObjectLiteralExpression,
  isSpreadElement,
  isStringLiteral,
  type Expression,
} from '@typescript/native-preview/unstable/ast'
import type { NativeDirectStaticIdArrayDependencySpec } from './tsgo-native-direct-manifest'
import { propertyInitializer } from './tsgo-native-direct-object'
import { nativeNodeList, nativeSourceForNode } from './tsgo-native-source'
import type { NativeDefinition, RelationFact } from './tsgo-native-direct-types'

export type StaticIdArrayDependencyEntry = {
  readonly kind: 'staticIdArray'
  readonly spec: NativeDirectStaticIdArrayDependencySpec
  readonly targetName: string
  readonly relation: RelationFact
}

/**
 * Emits relations for literal string/object-id arrays whose targets are named
 * by stable Crux ids rather than by local symbols.
 */
export function staticIdArrayEntries(
  definition: NativeDefinition,
  spec: NativeDirectStaticIdArrayDependencySpec,
): readonly StaticIdArrayDependencyEntry[] | undefined {
  const expression = propertyInitializer(definition.object, spec.property)
  if (!expression) return []
  if (!isArrayLiteralExpression(expression)) return undefined
  return presentValues(
    nativeNodeList(expression.elements).map((element, index) => {
      if (isSpreadElement(element)) return undefined
      const targetName = staticIdTargetName(element)
      return targetName
        ? {
            kind: 'staticIdArray',
            spec,
            targetName,
            relation: projectRelation({
              type: spec.relationType,
              from: relationOriginId(definition, spec, index),
              to: `${spec.targetKind}:${safeId(targetName)}`,
              fidelity: 'resolved',
              source: nativeSourceForNode(definition.variable.file, definition.object),
            }),
          }
        : undefined
    }),
  )
}

function staticIdTargetName(expression: Expression): string | undefined {
  if (isStringLiteral(expression)) return expression.text
  if (!isObjectLiteralExpression(expression)) return undefined
  const id = propertyInitializer(expression, 'id')
  return id && isStringLiteral(id) ? id.text : undefined
}

function relationOriginId(
  definition: NativeDefinition,
  spec: NativeDirectStaticIdArrayDependencySpec,
  index: number,
): string {
  return spec.relationOrigin.kind === 'owner'
    ? definition.id
    : `${definition.id}:${spec.relationOrigin.segment}:${index + 1}`
}

function presentValues<TValue>(values: readonly (TValue | undefined)[]): readonly TValue[] | undefined {
  return values.every((value): value is TValue => value !== undefined) ? values : undefined
}
