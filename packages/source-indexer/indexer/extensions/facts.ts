import type { ExtractedDefinition, ExtractedFacts, ExtractResult } from './types'

export function facts(input: ExtractedFacts): ExtractResult {
  return { kind: 'facts', facts: input }
}

export function projectDefinition(input: ExtractedDefinition): ExtractedDefinition {
  return {
    variableName: input.variableName,
    definition: input.definition,
    ...(input.extraDefinitions ? { extraDefinitions: [...input.extraDefinitions] } : {}),
  }
}

export function none(): ExtractResult {
  return { kind: 'none' }
}
