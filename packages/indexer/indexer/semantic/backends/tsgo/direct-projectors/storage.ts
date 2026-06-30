import type { ProjectRelation } from '@use-crux/core/project-index'
import {
  isCallExpression,
  isObjectLiteralExpression,
  isStringLiteral,
  type Expression,
  type ObjectLiteralExpression,
  type SourceFile,
} from '@typescript/native-preview/unstable/ast'
import { safeId } from '../../../../definitions'
import {
  semanticStorageFactoryDescriptor,
  type SemanticStorageFactoryDescriptor,
} from '../../../storage-model'
import { nativeNodeList } from '../source'
import { nativeDirectSourceRefForExpression } from './source-refs'
import {
  compactRecord,
  compactStorageFacts,
  expressionIdentifier,
  storageBundleObject,
  storageCallName,
  storageDefinitionSource,
  storageDependencies,
  storagePropertyExpression,
  storagePropertyMatches,
  storageReferenceTarget,
  storageReferenceVariable,
  storageRelation,
  type NativeStorageDefinition,
  type NativeStorageReference,
} from './storage-shapes'
import type { DefinitionFact, NativeSourceBinding, NativeVariable, RelationFact, SourceRefFact } from './types'

interface NativeStorageEvidence {
  readonly definitions: readonly DefinitionFact[]
  readonly relations: readonly RelationFact[]
  readonly sourceRefs: readonly SourceRefFact[]
}

/** Returns whether a top-level variable initializer is supported storage syntax. */
export function isNativeDirectStorageInitializer(variable: NativeVariable): boolean {
  return Boolean(nativeStorageDefinition(variable) || nativeStorageBundleObject(variable))
}

/** Emits direct-native evidence for simple Storage Beta definitions. */
export function nativeDirectStorageEvidence(
  variables: readonly NativeVariable[],
  bindingsByFile: ReadonlyMap<SourceFile, ReadonlyMap<string, NativeSourceBinding>>,
): NativeStorageEvidence | undefined {
  const definitions = variables.flatMap((variable) => nativeStorageDefinition(variable) ?? [])
  if (definitions.length === 0) return { definitions: [], relations: [], sourceRefs: [] }

  const definitionsByVariable = new Map(definitions.map((definition) => [definition.variable.name, definition]))
  const facts = definitions.map((definition) => storageDefinitionFact(definition, definitionsByVariable))
  if (!facts.every((fact): fact is DefinitionFact => Boolean(fact))) return undefined

  const relations = definitions.flatMap((definition) => storageRelations(definition, definitionsByVariable))
  const refGroups = definitions.map((definition) => {
    const bindings = bindingsByFile.get(definition.variable.file)
    return bindings ? storageSourceRefs(definition, definitionsByVariable, bindings) : undefined
  })
  if (!refGroups.every((entry): entry is SourceRefFact[] => Boolean(entry))) return undefined

  return {
    definitions: facts,
    relations,
    sourceRefs: refGroups.flat(),
  }
}

function nativeStorageDefinition(variable: NativeVariable): NativeStorageDefinition | undefined {
  const descriptor = nativeStorageDescriptor(variable.initializer)
  if (descriptor) {
    return {
      variable,
      kind: descriptor.kind,
      id: `${descriptor.kind}:${safeId(variable.name)}`,
      name: variable.name,
      descriptor,
      source: storageDefinitionSource(variable.initializer) ?? variable.initializer,
    }
  }
  return nativeStorageBundleObject(variable)
}

function nativeStorageBundleObject(variable: NativeVariable): NativeStorageDefinition | undefined {
  if (!variable.name.toLowerCase().includes('storage') || !isObjectLiteralExpression(variable.initializer)) return undefined
  return storageObjectReferences(variable.initializer, new Map()).length > 0
    ? {
        variable,
        kind: 'storage.bundle',
        id: `storage.bundle:${safeId(variable.name)}`,
        name: variable.name,
        descriptor: { kind: 'storage.bundle' },
        source: variable.initializer,
      }
    : undefined
}

function storageDefinitionFact(
  definition: NativeStorageDefinition,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
): DefinitionFact | undefined {
  const refs = storageReferences(definition, definitionsByVariable)
  if (!refs) return undefined
  const scope = definition.kind === 'storage.scope' ? storageScopeReference(definition, definitionsByVariable) : undefined
  if (definition.kind === 'storage.scope' && !scope) return undefined
  const facts = compactStorageFacts({
    kind: definition.kind,
    variableName: definition.name,
    backend: definition.descriptor.backend,
    capabilities: definition.descriptor.capabilities,
    records: storageReferenceTarget(refs, 'records')?.id,
    vectors: storageReferenceTarget(refs, 'vectors')?.id,
    blobs: storageReferenceTarget(refs, 'blobs')?.id,
    storage: scope?.target.id,
    prefix: scope?.prefix,
  })
  const dependencies = storageDependencies(refs)
  return {
    id: definition.id,
    kind: definition.kind,
    name: definition.name,
    fidelity: 'resolved',
    status: 'active',
    metadata: compactRecord({
      exportName: definition.name,
      variableName: definition.name,
      kind: definition.kind,
      backend: definition.descriptor.backend,
      capabilities: definition.descriptor.capabilities,
      recordsVariable: storageReferenceVariable(refs, 'records'),
      vectorsVariable: storageReferenceVariable(refs, 'vectors'),
      blobsVariable: storageReferenceVariable(refs, 'blobs'),
      baseStorageVariable: scope ? expressionIdentifier(scope.expression) : undefined,
      prefix: scope?.prefix,
      facts,
      intelligence: {
        confidence: 'semantic',
        ...(dependencies ? { dependencies } : {}),
      },
    }),
    sourceRefs: [],
  }
}

function storageRelations(
  definition: NativeStorageDefinition,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
): RelationFact[] {
  if (definition.kind === 'storage.bundle') {
    return (storageReferences(definition, definitionsByVariable) ?? []).flatMap((ref) => {
      const type = bundleRelationType(ref.property)
      return type ? [storageRelation(definition, type, ref.target.id)] : []
    })
  }
  const scope = definition.kind === 'storage.scope' ? storageScopeReference(definition, definitionsByVariable) : undefined
  return scope ? [storageRelation(definition, 'storage.scope.wraps_storage', scope.target.id)] : []
}

function storageSourceRefs(
  definition: NativeStorageDefinition,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
  bindings: ReadonlyMap<string, NativeSourceBinding>,
): SourceRefFact[] | undefined {
  const refs = [...(storageReferences(definition, definitionsByVariable) ?? [])]
  const scope = definition.kind === 'storage.scope' ? storageScopeReference(definition, definitionsByVariable) : undefined
  if (scope) refs.push(scope)
  const projected = refs.map((ref) =>
    nativeDirectSourceRefForExpression({
      definitionId: definition.id,
      role: 'config',
      property: ref.property,
      expression: ref.expression,
      bindings,
      metadata: { extensions: { storageConfig: ref.property } },
    }),
  )
  return projected.every((ref): ref is SourceRefFact => Boolean(ref)) ? projected : undefined
}

function storageReferences(
  definition: NativeStorageDefinition,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
): NativeStorageReference[] | undefined {
  if (definition.kind !== 'storage.bundle') return []
  const object = storageBundleObject(definition)
  return object ? storageObjectReferences(object, definitionsByVariable) : undefined
}

function storageObjectReferences(
  object: ObjectLiteralExpression,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
): NativeStorageReference[] {
  return (['records', 'vectors', 'blobs'] as const).flatMap((property) => {
    const expression = storagePropertyExpression(object, property)
    const variable = expression ? expressionIdentifier(expression) : undefined
    const target = variable ? definitionsByVariable.get(variable) : undefined
    return expression && target && storagePropertyMatches(property, target)
      ? [{ property, expression, target }]
      : []
  })
}

function storageScopeReference(
  definition: NativeStorageDefinition,
  definitionsByVariable: ReadonlyMap<string, NativeStorageDefinition>,
): (NativeStorageReference & { readonly prefix?: string }) | undefined {
  if (!isCallExpression(definition.variable.initializer)) return undefined
  const [storageExpression, prefixExpression] = nativeNodeList(definition.variable.initializer.arguments)
  const variable = storageExpression ? expressionIdentifier(storageExpression) : undefined
  const target = variable ? definitionsByVariable.get(variable) : undefined
  if (!storageExpression || !target || !storagePropertyMatches('storage', target)) return undefined
  return {
    property: 'storage',
    expression: storageExpression,
    target,
    ...(prefixExpression && isStringLiteral(prefixExpression) ? { prefix: prefixExpression.text } : {}),
  }
}

function nativeStorageDescriptor(expression: Expression): SemanticStorageFactoryDescriptor | undefined {
  return semanticStorageFactoryDescriptor(storageCallName(expression))
}

function bundleRelationType(property: NativeStorageReference['property']): ProjectRelation['type'] | undefined {
  if (property === 'records') return 'storage.bundle.uses_record_store'
  if (property === 'vectors') return 'storage.bundle.uses_vector_store'
  if (property === 'blobs') return 'storage.bundle.uses_blob_store'
  return undefined
}
