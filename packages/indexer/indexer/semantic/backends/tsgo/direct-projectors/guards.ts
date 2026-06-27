import type { NativeDefinition } from './types'
import { propertyInitializer } from './object'

/**
 * Returns whether a direct-native definition uses semantic shapes the direct
 * projector does not yet emit. These files must route through the complete
 * native shared analyzer to preserve exact backend parity.
 */
export function hasUnsupportedSemanticProperty(definition: NativeDefinition): boolean {
  return unsupportedPresentProperties(definition).some((property) => Boolean(propertyInitializer(definition.object, property)))
}

function unsupportedPresentProperties(definition: NativeDefinition): readonly string[] {
  switch (definition.kind) {
    default:
      return []
  }
}
