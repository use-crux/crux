import type { CatalogDiagnostic, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/catalog'
import type { StaticRelationRef } from '../types'

export interface ExtensionIdentity {
  readonly name: string
  readonly version: string
}

export interface SourceIndexerExtension {
  readonly name: string
  readonly version: string
  readonly extractors?: readonly CatalogExtractor[]
  readonly resolvers?: readonly CatalogResolver[]
  readonly rules?: readonly CatalogRule[]
  readonly emitters?: readonly CatalogEmitter[]
  readonly relations?: readonly RelationSpec[]
  readonly queries?: readonly IndexQuery[]
}

export type ExtractPattern =
  | {
      readonly kind: 'call'
      readonly name: string
      readonly importFrom?: readonly string[]
      readonly configArg?: number
    }
  | {
      readonly kind: 'new'
      readonly name: string
      readonly importFrom?: readonly string[]
      readonly configArg?: number
    }

export interface CatalogExtractor {
  readonly name: string
  readonly patterns: readonly ExtractPattern[]
  extract(ctx: ExtractContext): ExtractResult
}

export interface ExtractContext {
  readonly extension: ExtensionIdentity
  readonly extractor: string
  readonly match: ExtractMatch
  readonly source: SourceView
  readonly config: StaticObjectReader | undefined
  readonly define: DefinitionBuilder
  readonly ref: ReferenceBuilder
  readonly unstableNative?: {
    readonly legacyStaticContext?: unknown
    readonly typescript?: unknown
  }
}

export interface ExtractMatch {
  readonly kind: ExtractPattern['kind']
  readonly name: string
}

export interface SourceView {
  readonly root: string
  readonly file: string
  readonly variableName: string
  readonly localName: string
}

export type ExtractResult =
  | {
      readonly kind: 'none'
      readonly dependencies?: readonly IndexDependency[]
    }
  | {
      readonly kind: 'facts'
      readonly facts: ExtractedFacts
      readonly dependencies?: readonly IndexDependency[]
    }
  | {
      readonly kind: 'degraded'
      readonly facts?: ExtractedFacts
      readonly diagnostics: readonly CatalogDiagnostic[]
      readonly dependencies?: readonly IndexDependency[]
    }

export interface ExtractedFacts {
  readonly definitions?: readonly ExtractedDefinition[]
  readonly references?: readonly UnresolvedReference[]
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  readonly diagnostics?: readonly CatalogDiagnostic[]
}

export interface ExtractedDefinition {
  readonly variableName: string
  readonly definition: ProjectDefinition
  readonly extraDefinitions?: readonly ProjectDefinition[]
}

export type UnresolvedReference = StaticRelationRef

export interface ExtractedSourceRef {
  readonly definitionId: string
  readonly ref: ProjectSourceRef
}

export interface RelationSpec {
  readonly type: string
  readonly fromKinds?: readonly string[]
  readonly toKinds?: readonly string[]
  readonly presentation: 'edge' | 'detail' | 'both'
  readonly fidelity?: 'partial' | 'resolved'
  readonly runtimeJoin: boolean
}

export interface CatalogResolver {
  readonly name: string
  resolve(ctx: ResolveContext): ResolveResult
}

export interface ResolveContext {
  readonly definitions: readonly ProjectDefinition[]
  readonly references: readonly UnresolvedReference[]
}

export interface ResolveResult {
  readonly relations?: readonly ProjectRelation[]
  readonly sourceRefs?: readonly ExtractedSourceRef[]
  readonly diagnostics?: readonly CatalogDiagnostic[]
  readonly dependencies?: readonly IndexDependency[]
}

export interface CatalogRule {
  readonly name: string
  check(ctx: CatalogRuleContext): readonly unknown[]
}

export interface CatalogRuleContext {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

export interface CatalogEmitter {
  readonly name: string
}

export interface IndexQuery {
  readonly id: string
  readonly version: string
}

export type IndexDependency =
  | { readonly kind: 'source-file'; readonly file: string }
  | { readonly kind: 'config-file'; readonly file: string }
  | { readonly kind: 'extension'; readonly name: string; readonly version: string }
  | { readonly kind: 'extractor'; readonly extension: string; readonly name: string }

export interface StaticObjectReader {
  has(property: string): boolean
  string(property: string): string | undefined
  stringArray(property: string): readonly string[]
  identifier(property: string): string | undefined
  identifierArray(property: string): readonly string[]
  json(property?: string): unknown
}

export interface DefinitionBuilder {
  fromProjectDefinition(input: ExtractedDefinition): ExtractedDefinition
}

export interface ReferenceBuilder {
  variable(type: string, toVariable: string): UnresolvedReference
  id(type: string, toId: string): UnresolvedReference
}
