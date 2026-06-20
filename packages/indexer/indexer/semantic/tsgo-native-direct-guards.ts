import {
  isIdentifier,
  isPropertyAccessExpression,
  type Expression,
} from '@typescript/native-preview/unstable/ast'
import type { NativeDefinition } from './tsgo-native-direct-types'
import { propertyInitializer } from './tsgo-native-direct-object'

/**
 * Returns whether a direct-native definition uses semantic shapes the direct
 * projector does not yet emit. These files must route through the complete
 * native shared analyzer to preserve exact backend parity.
 */
export function hasUnsupportedSemanticProperty(definition: NativeDefinition): boolean {
  return (
    unsupportedPresentProperties(definition).some((property) => Boolean(propertyInitializer(definition.object, property))) ||
    unsupportedResolvableSourceRefProperties(definition).some((property) => {
      const initializer = propertyInitializer(definition.object, property)
      return initializer ? isNativeResolvableSourceExpression(initializer) : false
    })
  )
}

function unsupportedPresentProperties(definition: NativeDefinition): readonly string[] {
  switch (definition.kind) {
    case 'context':
      return ['use', 'tools']
    default:
      return []
  }
}

function unsupportedResolvableSourceRefProperties(definition: NativeDefinition): readonly string[] {
  switch (definition.kind) {
    case 'prompt':
      return ['system', 'prompt']
    case 'context':
      return ['system', 'resolve', 'render', 'handler', 'when']
    case 'tool':
      return ['execute', 'run', 'handler']
    default:
      return []
  }
}

function isNativeResolvableSourceExpression(expression: Expression): boolean {
  return isIdentifier(expression) || isPropertyAccessExpression(expression)
}
