import type { IndexPatchFacts } from '../../../../patches'
import { safeId } from '../../../../definitions'
import type { Project } from '@typescript/native-preview/unstable/sync'
import { isCallExpression, isIdentifier, type Expression, type SourceFile } from '@typescript/native-preview/unstable/ast'
import { nativeNodeList, nativeSourceForNode, nativeSourceSnippetForNode } from '../source'
import type { SemanticSourceProfile } from '../../../source-profile'
import { collectNativeDirectFileScope, nativeBindingMapsByFile } from './bindings'
import { dependencyEvidenceForDefinition } from './dependencies'
import { isNativeDirectCandidateCallSet, type NativeDirectSchemaSpec } from './manifest'
import { hasUnsupportedSemanticProperty } from './guards'
import { definitionName, nativeCruxCall, propertyInitializer } from './object'
import { routingEvidenceForDefinition } from './routing'
import { nativeDefinitionMapsByFile, nativeVariableMapsByFile } from './scope'
import { sourceRefEvidenceForDefinition } from './source-refs'
import type {
  DefinitionFact,
  DefinitionSourceEvidence,
  NativeDefinition,
  NativeDependencyEvidence,
  NativeSourceBinding,
  NativeVariable,
  SourceRefFact,
} from './types'
import { nativeZodExpressionToJsonSchema } from '../zod-schema'

export interface NativeDirectEvidenceResult {
  readonly facts: IndexPatchFacts
  readonly supportedFiles: readonly string[]
  readonly unsupportedFiles: readonly string[]
}

/** Returns whether files fit the native TypeScript-Go direct Crux projection. */
export function isNativeDirectCandidate(files: readonly string[], sourceProfile: SemanticSourceProfile): boolean {
  const profilesByFile = new Map(sourceProfile.files.map((file) => [file.file, file]))
  return files.length > 0 && files.every((file) => isNativeDirectProfile(profilesByFile.get(file)))
}

/** Returns files whose source profile says they are eligible for direct native projection. */
export function nativeDirectCandidateFiles(
  files: readonly string[],
  sourceProfile: SemanticSourceProfile,
): readonly string[] {
  const profilesByFile = new Map(sourceProfile.files.map((file) => [file.file, file]))
  return files.filter((file) => isNativeDirectProfile(profilesByFile.get(file))).sort()
}

/** Projects direct-native facts file by file, preserving unsupported files for the shared analyzer. */
export function nativeDirectEvidenceForFiles(
  project: Project,
  files: readonly string[],
): NativeDirectEvidenceResult | undefined {
  const supported: string[] = []
  const unsupported: string[] = []
  const facts: IndexPatchFacts[] = []

  for (const file of files) {
    const directFacts = nativeDirectEvidence(project, [file])
    if (directFacts) {
      supported.push(file)
      facts.push(directFacts)
    } else {
      unsupported.push(file)
    }
  }

  if (supported.length === 0) return undefined
  return {
    facts: mergeNativeDirectFacts(facts),
    supportedFiles: supported.sort(),
    unsupportedFiles: unsupported.sort(),
  }
}

/**
 * Projects a constrained direct Crux source shape directly from the native tsgo AST.
 *
 * The return value is `undefined` for unsupported syntax so callers can fall
 * back to the complete shared semantic analyzer without producing partial facts.
 */
export function nativeDirectEvidence(project: Project, files: readonly string[]): IndexPatchFacts | undefined {
  const sources = presentValues(files.map((file) => project.program.getSourceFile(file)))
  if (!sources) return undefined

  const scopes = presentValues(sources.map((source) => collectNativeDirectFileScope(source)))
  if (!scopes) return undefined

  const variableGroups = scopes.map((scope) => scope.variables)
  const nativeVariablesByFile = nativeVariableMapsByFile(sources, variableGroups)
  const nativeBindingsByFile = nativeBindingMapsByFile(scopes)
  const nativeVariables = variableGroups.flat()
  if (nativeVariables.some((variable) => hasUnsupportedTopLevelInitializer(variable, nativeVariablesByFile))) {
    return undefined
  }

  const definitions = nativeVariables.flatMap((variable) => nativeDefinition(variable) ?? [])
  const definitionsByFile = nativeDefinitionMapsByFile(sources, definitions)
  const sourceEvidencePairs = zipDefinitions(
    definitions,
    definitions.map((definition) => {
      const variables = nativeVariablesByFile.get(definition.variable.file)
      const bindings = nativeBindingsByFile.get(definition.variable.file)
      return variables && bindings ? definitionSourceEvidence(definition, variables, bindings) : undefined
    }),
  )
  if (!sourceEvidencePairs) return undefined
  const sourceEvidenceById = new Map(sourceEvidencePairs.map(({ definition, value }) => [definition.id, value]))
  const dependencyDefinitions = definitions.filter((definition) => definition.primitive.dependencies.length > 0)
  const dependencyEvidence = dependencyDefinitions.map((definition) => {
    const definitionsByVariable = definitionsByFile.get(definition.variable.file)
    return definitionsByVariable ? dependencyEvidenceForDefinition(definition, definitionsByVariable) : undefined
  })
  const dependencyEvidencePairs = zipDefinitions(dependencyDefinitions, dependencyEvidence)
  if (!dependencyEvidencePairs) return undefined

  const dependencyEvidenceById = new Map(dependencyEvidencePairs.map(({ definition, value }) => [definition.id, value]))
  const routingEvidence = definitions.map((definition) => {
    const definitionsByVariable = definitionsByFile.get(definition.variable.file)
    const bindings = nativeBindingsByFile.get(definition.variable.file)
    return definitionsByVariable && bindings
      ? routingEvidenceForDefinition(definition, definitionsByVariable, bindings)
      : undefined
  })
  const routingEvidencePairs = zipDefinitions(definitions, routingEvidence)
  if (!routingEvidencePairs) return undefined

  const emittedDefinitions = definitions.filter((definition) =>
    definition.primitive.emitDefinition === 'always'
      ? true
      : Object.keys(sourceEvidenceById.get(definition.id)?.metadata ?? {}).length > 0 ||
        Boolean(dependencyEvidenceById.get(definition.id)?.facts),
  )
  const emittedDefinitionsWithSourceEvidence = sourceEvidencePairs.filter(({ definition }) =>
    emittedDefinitions.includes(definition),
  )

  const definitionFacts = emittedDefinitionsWithSourceEvidence.map(({ definition, value }) =>
    definitionFact(definition, value, dependencyEvidenceById.get(definition.id)),
  )

  return {
    definitions: [...definitionFacts, ...routingEvidencePairs.flatMap(({ value }) => value.definitions)],
    relations: [
      ...dependencyEvidencePairs.flatMap(({ value }) => value.relations),
      ...routingEvidencePairs.flatMap(({ value }) => value.relations),
    ],
    sourceRefs: [
      ...sourceEvidencePairs.flatMap(({ value }) => value.sourceRefs),
      ...dependencyEvidencePairs.flatMap(({ value }) => value.sourceRefs),
      ...routingEvidencePairs.flatMap(({ value }) => value.sourceRefs),
    ],
    diagnostics: [],
  }
}

function isNativeDirectProfile(profile: SemanticSourceProfile['files'][number] | undefined): boolean {
  if (!profile) return false
  if (profile.hints?.nativeDirectCruxCandidate !== undefined) return profile.hints.nativeDirectCruxCandidate
  return profile.source ? isNativeDirectCandidateCallSet(profile.hints?.cruxCallNames ?? []) : false
}

function nativeDefinition(variable: NativeVariable): NativeDefinition | undefined {
  const call = nativeCruxCall(variable.initializer)
  if (!call) return undefined
  const name = definitionName(call.primitive, call.object, variable.name)
  if (!name) return undefined
  return {
    variable,
    primitive: call.primitive,
    object: call.object,
    kind: call.primitive.definitionKind,
    name,
    id: `${call.primitive.definitionKind}:${safeId(name)}`,
  }
}

function hasUnsupportedTopLevelInitializer(
  variable: NativeVariable,
  variablesByFile: ReadonlyMap<SourceFile, ReadonlyMap<string, NativeVariable>>,
): boolean {
  if (nativeCruxCall(variable.initializer)) return false
  if (!isCallExpression(variable.initializer)) return false
  const variables = variablesByFile.get(variable.file)
  if (!variables) return true
  return !nativeZodExpressionToJsonSchema(
    variable.file,
    variable.initializer,
    (name) => variables.get(name)?.initializer,
  )
}

function definitionSourceEvidence(
  definition: NativeDefinition,
  variables: ReadonlyMap<string, NativeVariable>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): DefinitionSourceEvidence | undefined {
  if (hasUnsupportedSemanticProperty(definition)) return undefined
  const entries: Array<NonNullable<ReturnType<typeof schemaEvidence>>> = []
  for (const spec of definition.primitive.schema) {
    const expression = propertyInitializer(definition.object, spec.property)
    if (!expression) continue
    const entry = schemaEvidence(definition, spec, variables, expression)
    if (!entry) return undefined
    entries.push(entry)
  }
  const sourceRefs = sourceRefEvidenceForDefinition(definition, bindings)
  if (!sourceRefs) return undefined
  return {
    metadata: Object.fromEntries(entries.map((entry) => [entry.metadataKey, entry.schema])),
    sourceRefs: [...entries.map((entry) => entry.sourceRef), ...sourceRefs],
  }
}

function schemaEvidence(
  definition: NativeDefinition,
  spec: NativeDirectSchemaSpec,
  variables: ReadonlyMap<string, NativeVariable>,
  expression: Expression,
):
  | {
      readonly metadataKey: string
      readonly schema: unknown
      readonly sourceRef: SourceRefFact
    }
  | undefined {
  if (!isIdentifier(expression)) return undefined
  const schemaVariable = variables.get(expression.text)
  if (!schemaVariable) return undefined
  const schema = nativeZodExpressionToJsonSchema(
    schemaVariable.file,
    schemaVariable.initializer,
    (name) => variables.get(name)?.initializer,
  )
  if (!schema) return undefined
  return {
    metadataKey: spec.metadataKey,
    schema,
    sourceRef: {
      definitionId: definition.id,
      ref: {
        id: `${definition.id}:source:schema:${spec.property}:${schemaVariable.name}`,
        role: 'schema',
        property: spec.property,
        symbol: schemaVariable.name,
        source: nativeSourceForNode(schemaVariable.file, schemaVariable.declaration),
        snippet: nativeSourceSnippetForNode(schemaVariable.file, schemaVariable.declaration),
        fidelity: 'resolved',
        metadata: { schemaKind: 'zod', parsedSchema: true },
      },
    },
  }
}

function definitionFact(
  definition: NativeDefinition,
  sourceEvidence: DefinitionSourceEvidence | undefined,
  dependencyEvidence: NativeDependencyEvidence | undefined,
): DefinitionFact {
  return {
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    fidelity: 'resolved',
    status: 'active',
    metadata: {
      ...(sourceEvidence?.metadata ?? {}),
      ...(dependencyEvidence?.facts ? { facts: dependencyEvidence.facts } : {}),
    },
    sourceRefs: [],
  }
}

function zipDefinitions<TValue>(
  definitions: readonly NativeDefinition[],
  values: readonly (TValue | undefined)[],
): readonly { readonly definition: NativeDefinition; readonly value: TValue }[] | undefined {
  if (definitions.length !== values.length) return undefined
  const pairs = definitions.map((definition, index) => {
    const value = values[index]
    return value ? { definition, value } : undefined
  })
  return presentValues(pairs)
}

function presentValues<TValue>(values: readonly (TValue | undefined)[]): readonly TValue[] | undefined {
  return values.every((value): value is TValue => value !== undefined) ? values : undefined
}

function mergeNativeDirectFacts(facts: readonly IndexPatchFacts[]): IndexPatchFacts {
  return {
    definitions: facts.flatMap((entry) => entry.definitions ?? []),
    relations: facts.flatMap((entry) => entry.relations ?? []),
    sourceRefs: facts.flatMap((entry) => entry.sourceRefs ?? []),
    diagnostics: facts.flatMap((entry) => entry.diagnostics ?? []),
  }
}
