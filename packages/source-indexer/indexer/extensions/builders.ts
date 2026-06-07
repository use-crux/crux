import type { DefinitionBuilder, ReferenceBuilder } from './types'

export function createDefinitionBuilder(): DefinitionBuilder {
  return {
    fromProjectDefinition: (input) => input,
  }
}

export function createReferenceBuilder(): ReferenceBuilder {
  return {
    variable: (type, toVariable) => ({ type, toVariable }),
    id: (type, toId) => ({ type, toId }),
  }
}
