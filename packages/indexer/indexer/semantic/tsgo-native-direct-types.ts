import type { IndexPatchFacts } from '../patches'
import type { NativeDirectDefinitionKind, NativeDirectPrimitiveSpec } from './tsgo-native-direct-manifest'
import type {
  Expression,
  ObjectLiteralExpression,
  SourceFile,
  VariableDeclaration,
} from '@typescript/native-preview/unstable/ast'

export type NativeDefinitionKind = NativeDirectDefinitionKind
export type DefinitionFact = NonNullable<IndexPatchFacts['definitions']>[number]
export type SourceRefFact = NonNullable<IndexPatchFacts['sourceRefs']>[number]
export type RelationFact = NonNullable<IndexPatchFacts['relations']>[number]

export interface NativeVariable {
  readonly name: string
  readonly file: SourceFile
  readonly declaration: VariableDeclaration
  readonly initializer: Expression
}

export interface NativeDefinition {
  readonly variable: NativeVariable
  readonly primitive: NativeDirectPrimitiveSpec
  readonly id: string
  readonly kind: NativeDefinitionKind
  readonly name: string
  readonly object: ObjectLiteralExpression
}

export interface DefinitionSourceEvidence {
  readonly metadata: NonNullable<DefinitionFact['metadata']>
  readonly sourceRefs: readonly SourceRefFact[]
}

export interface NativeDependencyEvidence {
  readonly facts?: NonNullable<DefinitionFact['metadata']>['facts']
  readonly relations: readonly RelationFact[]
  readonly sourceRefs: readonly SourceRefFact[]
}
