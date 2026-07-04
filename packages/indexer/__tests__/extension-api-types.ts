import {
  callPattern,
  facts,
  newPattern,
  none,
  projectDefinition,
  type ArgumentReader,
  type IndexExtractor,
  type ConfigCallReader,
  type ConfigReader,
  type ConfiguredObjectReader,
  type DefinitionBuilder,
  type ExtractContext,
  type ExtractResult,
  type ExtractedDefinition,
  type ExtractedFacts,
  type ReferenceBuilder,
  type IndexerExtension,
  type IndexFactKind,
  type IndexRuleManifest,
  type SourceRefBuilder,
  type IndexDependency,
} from '../extensions'
import type { ProjectDefinitionKind } from '@use-crux/core/project-index'

// @ts-expect-error Registry construction is compiler-internal, not part of the public extension authoring barrel.
import { createExtensionRegistry } from '../extensions'
// @ts-expect-error Static parser adapters are compiler-internal, not public extension authoring helpers.
import { createStaticExtensionRegistry } from '../extensions'
// @ts-expect-error Relation resolution is a compiler phase, not a public extractor authoring helper.
import { resolveStaticRelationReferences } from '../extensions'
// @ts-expect-error Internal reader names are not part of the public authoring barrel.
import type { StaticArgumentReader, StaticObjectReader } from '../extensions'

type Expect<T extends true> = T
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
type SourceRef = NonNullable<ExtractedFacts['sourceRefs']>[number]

declare const ctx: ExtractContext
declare const config: ConfigReader
declare const args: ArgumentReader
declare const define: DefinitionBuilder
declare const ref: ReferenceBuilder
declare const sourceRef: SourceRefBuilder
declare const extracted: ExtractedDefinition

const maybeConfigString = ctx.config?.string('name')
type ConfigString = Expect<Equal<typeof maybeConfigString, string | undefined>>

// @ts-expect-error Native parser payloads are first-party internals, not public extractor context.
ctx.internalNative

const safeSourceId = ctx.source.safeId('Writer Prompt')
type SafeSourceId = Expect<Equal<typeof safeSourceId, string>>

const objectReader = config.object('nested')
type NestedObject = Expect<Equal<typeof objectReader, ConfigReader | undefined>>

const referenceValue = config.reference('component')
type ReferenceValue = Expect<Equal<typeof referenceValue, string | undefined>>

const objectArray = config.objectArray('steps')
type ObjectArray = Expect<Equal<typeof objectArray, readonly ConfigReader[]>>

const callObject = config.callObject('store')
type CallObject = Expect<Equal<typeof callObject, ConfigCallReader | undefined>>

const nestedString = config.nestedString(['write', 'mode'])
type NestedString = Expect<Equal<typeof nestedString, string | undefined>>

const callObjects = config.callObjectArray('blocks')
type CallObjects = Expect<Equal<typeof callObjects, readonly ConfigCallReader[]>>
type CallObjectName = Expect<Equal<(typeof callObjects)[number]['name'], string | undefined>>

const configuredObjects = config.objectOrCallObjectArray('steps')
type ConfiguredObjects = Expect<Equal<typeof configuredObjects, readonly ConfiguredObjectReader[]>>
type ConfiguredObjectName = Expect<Equal<(typeof configuredObjects)[number]['name'], string | undefined>>
type ConfiguredObjectConfig = Expect<Equal<(typeof configuredObjects)[number]['config'], ConfigReader>>

const jsonValue = args.json(0)
type JsonArgument = Expect<Equal<typeof jsonValue, unknown>>

const builtDefinition = define.definition({
  variableName: ctx.source.variableName,
  id: 'tool:writer',
  kind: 'tool',
  name: 'writer',
  metadata: {
    exportName: ctx.source.variableName,
    description: config.string('description'),
  },
})
type BuiltDefinition = Expect<Equal<typeof builtDefinition, ExtractedDefinition>>

const forwardedDefinition = define.fromProjectDefinition(extracted)
type ForwardedDefinition = Expect<Equal<typeof forwardedDefinition, ExtractedDefinition>>

const variableReference = ref.variable('agent.uses_tool', 'writerTool')
const idReference = ref.id('agent.uses_tool', 'tool:writer')
type VariableReference = Expect<Equal<typeof variableReference.type, string>>
type IdReference = Expect<Equal<typeof idReference.type, string>>

const schemaSourceRef = sourceRef.schemaProperty({ property: 'input', definitionId: 'tool:writer' })
type SchemaSourceRef = Expect<Equal<typeof schemaSourceRef.sourceRefs, readonly SourceRef[]>>

const callbackSourceRef = sourceRef.callbackProperty({
  property: 'execute',
  role: 'handler',
  definitionId: 'tool:writer',
})
type CallbackSourceRef = Expect<Equal<typeof callbackSourceRef, SourceRef | undefined>>

const successfulFacts = facts({
  definitions: [builtDefinition],
  references: [variableReference, idReference],
  sourceRefs: [...schemaSourceRef.sourceRefs, ...(callbackSourceRef ? [callbackSourceRef] : [])],
})
type SuccessfulFacts = Expect<Equal<typeof successfulFacts.kind, 'facts'>>

const noFacts = none()
type NoFacts = Expect<Equal<typeof noFacts.kind, 'none'>>

const copiedDefinition = projectDefinition(builtDefinition)
type CopiedDefinition = Expect<Equal<typeof copiedDefinition, ExtractedDefinition>>

const pattern = callPattern({ name: 'defineTool', importFrom: ['@acme/tools'], configArg: 1 })
type CallPattern = Expect<Equal<typeof pattern.kind, 'call'>>

const constructorPattern = newPattern({ name: 'Agent', importFrom: ['@use-crux/core'] })
type ConstructorPattern = Expect<Equal<typeof constructorPattern.kind, 'new'>>

const extension = {
  name: '@acme/tools',
  version: '1',
  extractors: [
    {
      name: 'acme.defineTool',
      patterns: [pattern],
      extract(input) {
        const name = input.config?.string('name') ?? input.args.string(0) ?? input.source.localName
        return facts({
          definitions: [
            input.define.definition({
              variableName: input.source.variableName,
              id: `tool:${name}`,
              kind: 'tool' as ProjectDefinitionKind,
              name,
              metadata: {
                exportName: input.source.variableName,
                inputSchema: input.config?.schema('input'),
              },
            }),
          ],
          references: [input.ref.variable('agent.uses_tool', 'agentTool')],
        })
      },
    } satisfies IndexExtractor,
  ],
} satisfies IndexerExtension

type AuthoredExtension = Expect<Equal<typeof extension.name, string>>

const minimalExtension = {
  name: '@acme/minimal',
  version: '1',
} satisfies IndexerExtension
type MinimalExtension = Expect<Equal<typeof minimalExtension.version, string>>

const semanticRuleManifest = {
  id: '@acme/tools/require-owner',
  docs: { description: 'Require owner metadata.' },
  phase: 'semantic',
  requires: ['definitions', 'sources'],
  fidelity: 'best-effort',
  defaultSeverity: 'warning',
  defaultOptions: { ownerField: 'owner' },
} satisfies IndexRuleManifest<{ ownerField: string }>
type SemanticRuleDefaultOptions = Expect<Equal<typeof semanticRuleManifest.defaultOptions.ownerField, string>>
type SemanticRuleFactKind = Expect<Equal<(typeof semanticRuleManifest.requires)[number], 'definitions' | 'sources'>>
type SemanticRuleFactKindAssignable = Expect<Equal<(typeof semanticRuleManifest.requires)[number] extends IndexFactKind ? true : false, true>>

const ruleExtension = {
  name: '@acme/tools',
  version: '1',
  rules: [
    {
      manifest: semanticRuleManifest,
      messages: { missing: 'Missing owner.' },
      check: () => [],
    },
  ],
} satisfies IndexerExtension
type RuleExtensionRuleId = Expect<Equal<NonNullable<typeof ruleExtension.rules>[number]['manifest']['id'], string>>

const invalidRuleManifest = {
  id: '@acme/tools/broken',
  docs: { description: 'Broken rule.' },
  phase: 'index',
  // @ts-expect-error Rule manifests require durable Project Index fact kinds.
  requires: ['semantic'],
  fidelity: 'safe',
  defaultSeverity: 'info',
} satisfies IndexRuleManifest

const ruleDependency = {
  kind: 'rule',
  extension: '@acme/internal',
  name: 'internal.index-rule',
} satisfies IndexDependency
type RuleDependencyKind = Expect<Equal<typeof ruleDependency.kind, 'rule'>>

const relationOnlyExtension = {
  name: '@acme/relations',
  version: '1',
  relations: [
    {
      type: 'workflow.uses_tool',
      fromKinds: ['workflow'],
      toKinds: ['tool'],
      presentation: 'edge',
      runtimeJoin: false,
    },
  ],
} satisfies IndexerExtension
type RelationOnlyExtension = Expect<Equal<NonNullable<typeof relationOnlyExtension.relations>[number]['type'], string>>

const resolverSlotExtension = {
  name: '@acme/not-yet',
  version: '1',
  // @ts-expect-error Custom resolver authoring is internal, not part of the public v1 manifest.
  resolvers: [],
} satisfies IndexerExtension
