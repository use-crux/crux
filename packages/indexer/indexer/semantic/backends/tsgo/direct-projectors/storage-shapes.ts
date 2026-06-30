import type { DependencyFacts, ProjectRelation, StorageFacts } from '@use-crux/core/project-index'
import {
  isCallExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  type Expression,
  type ObjectLiteralExpression,
} from '@typescript/native-preview/unstable/ast'
import { projectRelation } from '../../../../relations'
import type {
  SemanticStorageDefinitionKind,
  SemanticStorageFactoryDescriptor,
} from '../../../storage-model'
import { nativeNodeList, nativeSourceForNode } from '../source'
import type { NativeVariable, RelationFact } from './types'

export interface NativeStorageDefinition {
  readonly variable: NativeVariable
  readonly kind: SemanticStorageDefinitionKind
  readonly id: string
  readonly name: string
  readonly descriptor: SemanticStorageFactoryDescriptor
  readonly source: Expression | ObjectLiteralExpression
}

export interface NativeStorageReference {
  readonly property: 'storage' | 'records' | 'vectors' | 'blobs'
  readonly expression: Expression
  readonly target: NativeStorageDefinition
}

/** Returns a supported storage call name from a native expression. */
export function storageCallName(expression: Expression): string | undefined {
  if (!isCallExpression(expression)) return undefined
  if (isIdentifier(expression.expression)) return expression.expression.text
  if (
    isPropertyAccessExpression(expression.expression) &&
    isIdentifier(expression.expression.expression) &&
    expression.expression.expression.text === 'storage'
  ) {
    return expression.expression.name.text
  }
  return undefined
}

/** Returns the source node that should anchor a storage definition. */
export function storageDefinitionSource(expression: Expression): Expression | ObjectLiteralExpression | undefined {
  if (!isCallExpression(expression)) return undefined
  const [firstArg] = nativeNodeList(expression.arguments)
  if (storageCallName(expression) === 'storage' && firstArg && isObjectLiteralExpression(firstArg)) return firstArg
  return expression
}

/** Returns the object literal that supplies bundle fields for a storage definition. */
export function storageBundleObject(definition: NativeStorageDefinition): ObjectLiteralExpression | undefined {
  if (isObjectLiteralExpression(definition.source)) return definition.source
  if (!isCallExpression(definition.variable.initializer)) return undefined
  const [firstArg] = nativeNodeList(definition.variable.initializer.arguments)
  return firstArg && isObjectLiteralExpression(firstArg) ? firstArg : undefined
}

/** Reads a bundle property expression from shorthand or property assignment syntax. */
export function storagePropertyExpression(
  object: ObjectLiteralExpression,
  propertyName: string,
): Expression | undefined {
  const property = nativeNodeList(object.properties).find(
    (candidate) =>
      (isPropertyAssignment(candidate) || isShorthandPropertyAssignment(candidate)) &&
      isIdentifier(candidate.name) &&
      candidate.name.text === propertyName,
  )
  if (!property) return undefined
  if (isPropertyAssignment(property)) return property.initializer
  return isShorthandPropertyAssignment(property) && isIdentifier(property.name) ? property.name : undefined
}

/** Returns whether a storage config field points at the expected storage definition kind. */
export function storagePropertyMatches(
  property: NativeStorageReference['property'],
  target: NativeStorageDefinition,
): boolean {
  switch (property) {
    case 'storage':
      return target.kind === 'storage.bundle' || target.kind === 'storage.scope'
    case 'records':
      return target.kind === 'storage.recordStore'
    case 'vectors':
      return target.kind === 'storage.vectorStore'
    case 'blobs':
      return target.kind === 'storage.blobStore'
  }
}

/** Builds a resolved storage relation anchored to the authored storage source. */
export function storageRelation(
  definition: NativeStorageDefinition,
  type: ProjectRelation['type'],
  to: string,
): RelationFact {
  return projectRelation({
    type,
    from: definition.id,
    to,
    fidelity: 'resolved',
    source: nativeSourceForNode(definition.variable.file, definition.source),
  })
}

/** Converts storage references into Project Index dependency facts. */
export function storageDependencies(refs: readonly NativeStorageReference[]): DependencyFacts | undefined {
  const dependencies = compactRecord({
    storage: uniqueTargets(refs, 'storage'),
    storageScopes: uniqueTargets(refs, 'storage', 'storage.scope'),
    recordStores: uniqueTargets(refs, 'records'),
    vectorStores: uniqueTargets(refs, 'vectors'),
    blobStores: uniqueTargets(refs, 'blobs'),
  })
  return Object.keys(dependencies).length > 0 ? dependencies : undefined
}

export function storageReferenceTarget(
  refs: readonly NativeStorageReference[],
  property: NativeStorageReference['property'],
): NativeStorageDefinition | undefined {
  return refs.find((ref) => ref.property === property)?.target
}

export function storageReferenceVariable(
  refs: readonly NativeStorageReference[],
  property: NativeStorageReference['property'],
): string | undefined {
  const ref = refs.find((entry) => entry.property === property)
  return ref ? expressionIdentifier(ref.expression) : undefined
}

export function expressionIdentifier(expression: Expression): string | undefined {
  return isIdentifier(expression) ? expression.text : undefined
}

export function compactStorageFacts(input: StorageFacts): StorageFacts {
  return Object.fromEntries(
    Object.entries(input as unknown as Record<string, unknown>).filter(([, value]) => value !== undefined),
  ) as unknown as StorageFacts
}

export function compactRecord<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>
}

function uniqueTargets(
  refs: readonly NativeStorageReference[],
  property: NativeStorageReference['property'],
  kind?: SemanticStorageDefinitionKind,
): string[] | undefined {
  const values = refs
    .filter((ref) => ref.property === property && (!kind || ref.target.kind === kind))
    .map((ref) => ref.target.id)
  const unique = [...new Set(values)].sort()
  return unique.length > 0 ? unique : undefined
}
