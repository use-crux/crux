import type { IndexPatchFacts } from '../../../patches'
import type { NativeDirectDefinitionKind, NativeDirectPrimitiveSpec } from './manifest'
import type {
  Expression,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  ObjectLiteralExpression,
  PropertyAssignment,
  SourceFile,
  ShorthandPropertyAssignment,
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

export type NativeSourceDeclaration =
  | VariableDeclaration
  | FunctionDeclaration
  | PropertyAssignment
  | ShorthandPropertyAssignment
  | MethodDeclaration

export type NativeFunctionExpression = FunctionDeclaration | FunctionExpression

export interface NativeSourceBinding {
  readonly name: string
  readonly file: SourceFile
  readonly declaration: NativeSourceDeclaration
  readonly initializer?: Expression
  readonly functionName?: string
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
