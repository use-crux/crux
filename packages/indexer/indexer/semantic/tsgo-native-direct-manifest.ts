import type {
  InjectionUseFacts,
  ProjectDefinitionKind,
  ProjectRelation,
  ProjectSourceRefRole,
} from '@crux/core/project-index'

export type NativeDirectDefinitionKind = ProjectDefinitionKind
export type NativeDirectSchemaMetadataKey = 'schema' | 'inputSchema' | 'outputSchema'

export interface NativeDirectSchemaSpec {
  readonly property: string
  readonly metadataKey: NativeDirectSchemaMetadataKey
}

export type NativeDirectRelationOriginSpec =
  | {
      readonly kind: 'owner'
    }
  | {
      readonly kind: 'indexedOwnerChild'
      readonly segment: string
    }

export type NativeDirectDependencyFactSpec =
  | {
      readonly kind: 'injectionUseEntries'
      readonly metadataKey: 'useEntries'
      readonly relationHint: NonNullable<InjectionUseFacts['relationHint']>
      readonly conditionality: NonNullable<InjectionUseFacts['conditionality']>
      readonly via: NonNullable<InjectionUseFacts['via']>
    }
  | {
      readonly kind: 'injectionToolMap'
      readonly metadataKey: 'tools'
    }

export interface NativeDirectArrayDependencySpec {
  readonly kind: 'arrayIdentifier'
  readonly property: string
  readonly targetKind: NativeDirectDefinitionKind
  readonly relationType: ProjectRelation['type']
  readonly relationOrigin: NativeDirectRelationOriginSpec
  readonly fact: Extract<NativeDirectDependencyFactSpec, { readonly kind: 'injectionUseEntries' }>
}

export interface NativeDirectObjectDependencySpec {
  readonly kind: 'objectShorthand'
  readonly property: string
  readonly targetKind: NativeDirectDefinitionKind
  readonly relationType: ProjectRelation['type']
  readonly relationOrigin: NativeDirectRelationOriginSpec
  readonly fact: Extract<NativeDirectDependencyFactSpec, { readonly kind: 'injectionToolMap' }>
  readonly sourceRef: {
    readonly role: ProjectSourceRefRole
    readonly property: string
    readonly metadata: Readonly<Record<string, unknown>>
  }
}

export type NativeDirectDependencySpec = NativeDirectArrayDependencySpec | NativeDirectObjectDependencySpec

export interface NativeDirectPrimitiveSpec {
  readonly callName: string
  readonly definitionKind: NativeDirectDefinitionKind
  readonly nameProperties: readonly string[]
  readonly schema: readonly NativeDirectSchemaSpec[]
  readonly emitDefinition: 'always' | 'withMetadata'
  readonly dependencies: readonly NativeDirectDependencySpec[]
}

/**
 * Internal manifest for first-party source shapes that can be projected
 * directly from TypeScript-Go AST evidence.
 *
 * This is deliberately data-only: it describes direct call names, definition
 * identity fields, schema fields, and local dependency relations. Anything not
 * represented here must route through the native shared semantic analyzer.
 */
export const nativeDirectPrimitiveManifest = [
  {
    callName: 'context',
    definitionKind: 'context',
    nameProperties: ['id'],
    emitDefinition: 'withMetadata',
    schema: [{ property: 'schema', metadataKey: 'schema' }],
    dependencies: [],
  },
  {
    callName: 'tool',
    definitionKind: 'tool',
    nameProperties: ['name', 'title'],
    emitDefinition: 'withMetadata',
    schema: [
      { property: 'input', metadataKey: 'inputSchema' },
      { property: 'parameters', metadataKey: 'inputSchema' },
      { property: 'output', metadataKey: 'outputSchema' },
    ],
    dependencies: [],
  },
  {
    callName: 'prompt',
    definitionKind: 'prompt',
    nameProperties: ['id'],
    emitDefinition: 'always',
    schema: [
      { property: 'input', metadataKey: 'inputSchema' },
      { property: 'output', metadataKey: 'outputSchema' },
    ],
    dependencies: [
      {
        kind: 'arrayIdentifier',
        property: 'use',
        targetKind: 'context',
        relationType: 'prompt.uses_context',
        relationOrigin: { kind: 'indexedOwnerChild', segment: 'use' },
        fact: {
          kind: 'injectionUseEntries',
          metadataKey: 'useEntries',
          relationHint: 'context',
          conditionality: 'always',
          via: 'direct',
        },
      },
      {
        kind: 'objectShorthand',
        property: 'tools',
        targetKind: 'tool',
        relationType: 'prompt.uses_tool',
        relationOrigin: { kind: 'owner' },
        fact: { kind: 'injectionToolMap', metadataKey: 'tools' },
        sourceRef: {
          role: 'config',
          property: 'tools',
          metadata: { toolMapContributor: 'property' },
        },
      },
    ],
  },
] as const satisfies readonly NativeDirectPrimitiveSpec[]

export const nativeDirectPrimitiveCallNames = nativeDirectPrimitiveManifest.map((primitive) => primitive.callName)

const firstPartySemanticCallNames = [
  'Agent',
  'agent',
  'blackboard',
  'cascade',
  'consensus',
  'constraint',
  'convexAgent',
  'createTool',
  'cruxFlow',
  'evaluate',
  'fallback',
  'flow',
  'fromRegistry',
  'guardrail',
  'injectable',
  'llmJudge',
  'match',
  'memory',
  'parallel',
  'pipeline',
  'registry',
  'retrievalPipeline',
  'retriever',
  'router',
  'swarm',
  'tool',
  'context',
  'prompt',
  'when',
  'workspace',
] as const

export const semanticPrimitiveCallNames = [...new Set(firstPartySemanticCallNames)].sort()

const nativeDirectPrimitiveCallNameSet: ReadonlySet<string> = new Set(nativeDirectPrimitiveCallNames)
const semanticPrimitiveCallNameSet: ReadonlySet<string> = new Set(semanticPrimitiveCallNames)
const nativeDirectPrimitiveByCallName: ReadonlyMap<string, NativeDirectPrimitiveSpec> = new Map(
  nativeDirectPrimitiveManifest.map((primitive) => [primitive.callName, primitive]),
)

export function nativeDirectPrimitiveForCallName(callName: string): NativeDirectPrimitiveSpec | undefined {
  return nativeDirectPrimitiveByCallName.get(callName)
}

export function isSemanticPrimitiveCallName(callName: string): boolean {
  return semanticPrimitiveCallNameSet.has(callName)
}

export function isNativeDirectPrimitiveCallName(callName: string): boolean {
  return nativeDirectPrimitiveCallNameSet.has(callName)
}

export function isNativeDirectCandidateCallSet(callNames: readonly string[]): boolean {
  return (
    callNames.some(isNativeDirectPrimitiveCallName) &&
    callNames.every((callName) => !isSemanticPrimitiveCallName(callName) || isNativeDirectPrimitiveCallName(callName))
  )
}
