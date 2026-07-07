import type ts from 'typescript'
import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  SourceLocation,
  SourceSnippet,
} from '@use-crux/core/project-index'
import type { StaticFoundDefinition, StaticRelationRef } from '../../../types'

/**
 * Compiler-owned parser call context used by the TypeScript compatibility
 * frontend and extension fixture helpers.
 *
 * Public extractors receive the stable `ExtractContext` reader surface. This
 * context is intentionally internal because it still carries TypeScript parser
 * nodes for compatibility execution.
 *
 * @internal
 */
export interface StaticCallContext {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly variableName: string
  readonly exported: boolean
  readonly call: ts.Expression
  readonly callName: string
  readonly firstArg?: ts.Expression
  readonly objectArg?: ts.ObjectLiteralExpression
  readonly source: SourceLocation
  readonly snippet?: SourceSnippet
  readonly localName: string
  readonly localInitializers: ReadonlyMap<string, ts.Expression>
  readonly importName?: string
  readonly importSource?: string
  readonly helpers: StaticCallHelpers
  readonly safeId: StaticCallHelpers['safeId']
  readonly define: StaticCallHelpers['define']
}

/**
 * Parser helper functions carried by the internal static call context.
 *
 * @internal
 */
export interface StaticCallHelpers {
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

/** Legacy alias retained for narrow host internals. */
export type ExtractContext = StaticCallContext
