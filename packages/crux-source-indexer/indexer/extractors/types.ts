import type ts from 'typescript'
import type { JsonSchema, ProjectDefinition, ProjectDefinitionKind, SourceLocation, SourceSnippet } from '@crux/core/catalog'
import type { CatalogCapability } from '../graph/types'
import type { StaticFoundDefinition, StaticRelationRef } from '../types'

export interface ExtractContext {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly variableName: string
  readonly call: ts.CallExpression
  readonly callName: string
  readonly firstArg?: ts.Expression
  readonly objectArg?: ts.ObjectLiteralExpression
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
  readonly localName: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly helpers: ExtractHelpers
  readonly safeId: ExtractHelpers['safeId']
  readonly define: ExtractHelpers['define']
}

export interface ExtractHelpers {
  readonly safeId: (value: string) => string
  readonly schemaProperty: (
    object: ts.ObjectLiteralExpression,
    name: string,
    localInitializers: ReadonlyMap<string, ts.Expression>,
  ) => JsonSchema | undefined
  readonly define: (
    id: string,
    kind: ProjectDefinitionKind,
    name: string,
    objectArg: ts.ObjectLiteralExpression | undefined,
    metadata: Record<string, unknown>,
  ) => ProjectDefinition
  readonly relationRef: (type: string, target: { toVariable?: string; toId?: string }) => StaticRelationRef
}

export type ExtractResult = { kind: 'none' } | ({ kind: 'found' } & StaticFoundDefinition)

export interface CatalogExtractor {
  readonly name: string
  readonly callNames: readonly string[]
  readonly capabilities: readonly CatalogCapability[]
  readonly extract: (ctx: ExtractContext) => ExtractResult | undefined
}

export type PrimitiveExtractor = CatalogExtractor

export type StaticCallContext = ExtractContext

export function foundDefinition(
  variableName: string,
  definition: ProjectDefinition,
  relationRefs: readonly StaticRelationRef[] = [],
  extraDefinitions?: readonly ProjectDefinition[],
): ExtractResult {
  return {
    kind: 'found',
    variableName,
    definition,
    relationRefs: [...relationRefs],
    ...(extraDefinitions ? { extraDefinitions: [...extraDefinitions] } : {}),
  }
}
