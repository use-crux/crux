import type ts from 'typescript'
import type {
  JsonSchema,
  ProjectDefinition,
  ProjectDefinitionKind,
  SourceLocation,
  SourceSnippet,
} from '@crux/core/project-index'
import type { StaticFoundDefinition, StaticRelationRef } from '../types'

/**
 * Parser-Static Index call context used by first-party compatibility helpers.
 *
 * This is distinct from the stable extension `ExtractContext`: it still contains TypeScript nodes and
 * parser helper functions for internal extractors that have not been fully reduced to stable readers.
 */
export interface ExtractContext {
  readonly root: string
  readonly file: string
  readonly sourceFile: ts.SourceFile
  readonly variableName: string
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
  readonly helpers: ExtractHelpers
  readonly safeId: ExtractHelpers['safeId']
  readonly define: ExtractHelpers['define']
}

/**
 * Parser helper functions carried by the Static Index call context.
 *
 * Helpers centralize id sanitization, schema projection, definition defaults, and relation-ref
 * construction so compatibility helpers do not each reimplement parser rules.
 */
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

/**
 * Alias used by traversal-heavy first-party helpers to make their static-parser dependency explicit.
 */
export type StaticCallContext = ExtractContext
