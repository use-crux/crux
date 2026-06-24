import ts from 'typescript'
import type { StaticRelationRef } from '../types'
import { facts, type IndexExtractor, type ExtractContext, type ExtractedSourceRef } from '../extensions'
import { propertyName } from '../ast/literals'
import {
  helperSourceRefsForNode,
  resolvedSourceNodeForProperty,
  sourceRefsForFactoryArguments,
  sourceRefsForObjectMapContributors,
} from '../ast/source-refs'
import {
  internalHandoffIdsForConfigProperty,
  internalIdentifierRefsForConfigProperty,
  internalObjectMapIdentifierEntries,
  internalToolNamesForConfigProperty,
} from '../extensions/static-record-adapter/config'
import {
  internalDataAccessRefsForConfigObject,
  internalDataAccessRefsForConfigProperties,
} from '../extensions/static-record-adapter/data-access'
import { internalStaticCallContext, internalStaticRecordContext } from '../extensions/static-record-adapter/native-context'
import {
  createStaticRecordSourceResolver,
  staticRecordProjectSourceRef,
} from '../extensions/static-record-adapter/source-resolver'
import type { StaticCallValue, StaticObjectValue, StaticSyntaxValue } from '../static/syntax-record/types'
import { resolveStaticSyntaxValue, staticObjectPropertyValue } from '../static/syntax-record/value'
import { primitiveDataIntelligence, uniqueDataAccesses, type PrimitiveDataAccessRef } from './data-access'

const callbackProperties = ['handler', 'run', 'execute', 'contextHandler', 'usageHandler'] as const

/**
 * Extracts `agent(...)`, `createAgent(...)`, and `Agent` constructor definitions.
 *
 * Agent extraction records prompt/tool/handoff dependencies, visible state access, runtime join hints,
 * and handler source refs as immutable facts. Cross-file binding is deferred to relation resolution.
 */
export const agentIndexExtractor: IndexExtractor = {
  name: 'agent',
  patterns: [
    { kind: 'call', name: 'agent' },
    { kind: 'call', name: 'convexAgent' },
    { kind: 'new', name: 'Agent' },
  ],
  extract: (ctx) => {
    if (ctx.match.name === 'convexAgent' || (ctx.match.kind === 'new' && ctx.match.name === 'Agent')) {
      return convexAgentFacts(ctx)
    }
    if (!ctx.config) return { kind: 'none' }
    const explicitId = ctx.config.string('id')
    const id = `agent:${ctx.source.safeId(explicitId ?? ctx.source.localName)}`
    const promptRef = ctx.config.identifier('prompt')
    const toolRefs = ctx.config.identifierArray('tools')
    const languageModelRef = ctx.config.identifier('languageModel')
    const handoffs = internalHandoffIdsForConfigProperty(ctx, 'handoffs')
    const usedConstraints = internalIdentifierRefsForConfigProperty(ctx, 'constraints')
    const usedGuardrails = internalIdentifierRefsForConfigProperty(ctx, 'guardrails')
    const dataAccesses = uniqueDataAccesses([
      ...internalDataAccessRefsForConfigObject(ctx),
      ...internalDataAccessRefsForConfigProperties(ctx, callbackProperties),
    ])
    const sourceRefs = [
      ...callbackProperties
        .map((property) =>
          ctx.sourceRef.callbackProperty({
            property,
            role: property === 'handler' ? 'handler' : property === 'execute' ? 'execute' : 'callback',
            definitionId: id,
          }),
        )
        .filter(isDefined),
      ...callbackProperties.flatMap((property) => ctx.sourceRef.helperRefsForProperty({ property, definitionId: id })),
    ]

    return facts({
      definitions: [
        ctx.define.definition({
          variableName: ctx.source.variableName,
          id,
          kind: 'agent',
          name: explicitId ?? ctx.source.variableName,
          metadata: {
            exportName: ctx.source.variableName,
            toolNames: internalToolNamesForConfigProperty(ctx, 'tools'),
            handoffs,
            facts: {
              kind: 'agent',
              ...(promptRef ? { promptId: promptRef } : {}),
              ...(toolRefs.length > 0 ? { toolNames: [...toolRefs] } : {}),
              ...(handoffs.length > 0 ? { handoffs: [...handoffs] } : {}),
              ...(usedConstraints.length > 0 ? { constraints: [...usedConstraints] } : {}),
              ...(usedGuardrails.length > 0 ? { guardrails: [...usedGuardrails] } : {}),
            },
            intelligence: agentIntelligence(
              promptRef,
              toolRefs,
              handoffs,
              dataAccesses,
              usedConstraints,
              usedGuardrails,
            ),
          },
        }),
      ],
      sourceRefs,
      references: [
        ...(promptRef ? [{ type: 'agent.uses_prompt', toVariable: promptRef }] : []),
        ...toolRefs.map((toVariable) => ({ type: 'agent.uses_tool', toVariable })),
        ...(languageModelRef
          ? [
              {
                type: 'agent.uses_routing',
                typeByTargetKind: {
                  'routing.router': 'agent.uses_routing',
                  'routing.cascade': 'agent.uses_routing',
                  'routing.fallback': 'agent.uses_routing',
                },
                toVariable: languageModelRef,
              },
            ]
          : []),
        ...handoffs.map((handoffId) => ({
          type: 'agent.can_handoff_to',
          toId: `agent:${ctx.source.safeId(handoffId)}`,
        })),
        ...usedConstraints.map((fromVariable) => ({ type: 'constraint.applies_to', fromVariable, toId: id })),
        ...usedGuardrails.map((fromVariable) => ({ type: 'guardrail.applies_to', fromVariable, toId: id })),
        ...dataAccessRelationRefs(id, dataAccesses),
      ],
    })
  },
}

/**
 * Extracts Convex Agent compatibility declarations through the first-party agent slot.
 *
 * The stable config/source-ref readers carry the common metadata. A narrow internal native context is
 * still used for object-map contributors and `resolve(prompt)` compatibility until those helpers are
 * represented by stable readers.
 */
function convexAgentFacts(ctx: ExtractContext): ReturnType<IndexExtractor['extract']> {
  if (!ctx.config) return { kind: 'none' }

  const explicitName = ctx.config.string('name')
  const id = `agent:${ctx.source.safeId(explicitName ?? ctx.source.localName)}`
  const definition = ctx.define.definition({
    variableName: ctx.source.variableName,
    id,
    kind: 'agent',
    name: explicitName ?? ctx.source.variableName,
    metadata: {
      exportName: ctx.source.variableName,
      runtime: 'convex-agent',
      hasTools: ctx.config.has('tools'),
      hasContextHandler: ctx.config.has('contextHandler'),
      hasUsageHandler: ctx.config.has('usageHandler'),
      hasPrepare: ctx.config.has('prepare'),
      maxSteps: ctx.config.has('maxSteps') ? 'configured' : undefined,
    },
  })

  return facts({
    definitions: [definition],
    references: [...convexAgentToolRelationRefs(ctx), ...convexAgentPromptRelationRefs(ctx)],
    sourceRefs: convexAgentSourceRefs(ctx, id),
  })
}

/** Builds unresolved tool relation refs from Convex agent tool-map configuration. */
function convexAgentToolRelationRefs(ctx: ExtractContext): StaticRelationRef[] {
  const staticCtx = internalStaticCallContext(ctx)
  const object = staticCtx?.objectArg
    ? objectLiteralForProperty(staticCtx.objectArg, 'tools', staticCtx.localInitializers)
    : undefined
  if (!object) {
    return internalObjectMapIdentifierEntries(ctx, 'tools').map((entry) => ({
      type: 'agent.uses_tool',
      toVariable: entry.value,
    }))
  }
  return object.properties
    .map((property) => {
      if (ts.isShorthandPropertyAssignment(property)) return property.name.text
      if (ts.isPropertyAssignment(property) && ts.isIdentifier(property.initializer)) return property.initializer.text
      return undefined
    })
    .filter((value): value is string => typeof value === 'string')
    .map((toVariable) => ({ type: 'agent.uses_tool', toVariable }))
}

/** Builds prompt relation refs from direct prompt or `languageModel: resolve(prompt)` config. */
function convexAgentPromptRelationRefs(ctx: ExtractContext): StaticRelationRef[] {
  const prompt = ctx.config?.identifier('prompt')
  if (prompt) return [{ type: 'agent.uses_prompt', toVariable: prompt }]

  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx?.objectArg) return convexAgentRecordPromptRelationRefs(ctx)
  const languageModel = propertyInitializer(staticCtx.objectArg, 'languageModel')
  if (!languageModel || !ts.isIdentifier(toExpression(languageModel))) return []
  const initializer = resolveIdentifierExpression(toExpression(languageModel), staticCtx.localInitializers)
  const promptRef = promptRefFromResolveCall(initializer)
  return promptRef ? [{ type: 'agent.uses_prompt', toVariable: promptRef }] : []
}

function convexAgentRecordPromptRelationRefs(ctx: ExtractContext): StaticRelationRef[] {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx?.objectArg) return []
  const languageModel = staticObjectPropertyValue(recordCtx.objectArg, 'languageModel')
  const initializer = resolveStaticSyntaxValue(languageModel, recordCtx.initializers)
  const promptRef = promptRefFromRecordResolveCall(initializer)
  return promptRef ? [{ type: 'agent.uses_prompt', toVariable: promptRef }] : []
}

/** Collects source refs for Convex agent config properties and contributor helpers. */
function convexAgentSourceRefs(ctx: ExtractContext, definitionId: string) {
  const staticCtx = internalStaticCallContext(ctx)
  if (!staticCtx) return convexAgentRecordSourceRefs(ctx, definitionId)
  if (!staticCtx?.objectArg) return convexAgentStableSourceRefs(ctx, definitionId)
  const objectArg = staticCtx.objectArg

  const callbackProperties = ['usageHandler', 'contextHandler', 'prepare'] as const
  const directRefs = [
    ctx.sourceRef.property({ property: 'prompt', role: 'config', definitionId }),
    ctx.sourceRef.property({ property: 'tools', role: 'config', definitionId }),
    ...callbackProperties.map((property) => ctx.sourceRef.property({ property, role: 'callback', definitionId })),
  ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))

  const toolsResolved = resolvedSourceNodeForProperty({
    root: staticCtx.root,
    file: staticCtx.file,
    sourceFile: staticCtx.sourceFile,
    object: objectArg,
    property: 'tools',
    localInitializers: staticCtx.localInitializers,
  })
  const toolMapRefs = sourceRefsForObjectMapContributors({
    definitionId,
    property: 'tools',
    root: staticCtx.root,
    file: toolsResolved?.sourceFile.fileName ?? staticCtx.file,
    sourceFile: toolsResolved?.sourceFile ?? staticCtx.sourceFile,
    objectExpression: toolsResolved?.expression,
    localInitializers: toolsResolved?.localInitializers ?? staticCtx.localInitializers,
  }).map((ref) => ({ definitionId, ref }))

  const helperRefs = ['tools', ...callbackProperties].flatMap((property) => {
    const initializer = propertyInitializer(objectArg, property)
    const expression = initializer ? toExpression(initializer) : undefined
    if (expression && ts.isCallExpression(expression)) {
      return helperSourceRefsForNode({
        definitionId,
        root: staticCtx.root,
        file: staticCtx.file,
        sourceFile: staticCtx.sourceFile,
        node: expression,
        localInitializers: staticCtx.localInitializers,
      }).map((ref) => ({ definitionId, ref }))
    }
    const resolved = resolvedSourceNodeForProperty({
      root: staticCtx.root,
      file: staticCtx.file,
      sourceFile: staticCtx.sourceFile,
      object: objectArg,
      property,
      localInitializers: staticCtx.localInitializers,
    })
    if (!resolved) return []
    return helperSourceRefsForNode({
      definitionId,
      root: staticCtx.root,
      file: resolved.sourceFile.fileName,
      sourceFile: resolved.sourceFile,
      node: resolved.node,
      localInitializers: resolved.localInitializers,
    }).map((ref) => ({ definitionId, ref }))
  })

  const factoryArgRefs = callbackProperties.flatMap((property) => {
    const initializer = propertyInitializer(objectArg, property)
    const expression = initializer ? toExpression(initializer) : undefined
    if (expression && ts.isCallExpression(expression)) {
      return sourceRefsForFactoryArguments({
        definitionId,
        property,
        root: staticCtx.root,
        file: staticCtx.file,
        sourceFile: staticCtx.sourceFile,
        node: expression,
        localInitializers: staticCtx.localInitializers,
      }).map((ref) => ({ definitionId, ref }))
    }
    const resolved = resolvedSourceNodeForProperty({
      root: staticCtx.root,
      file: staticCtx.file,
      sourceFile: staticCtx.sourceFile,
      object: objectArg,
      property,
      localInitializers: staticCtx.localInitializers,
    })
    if (!resolved) return []
    return sourceRefsForFactoryArguments({
      definitionId,
      property,
      root: staticCtx.root,
      file: resolved.sourceFile.fileName,
      sourceFile: resolved.sourceFile,
      node: resolved.node,
      localInitializers: resolved.localInitializers,
    }).map((ref) => ({ definitionId, ref }))
  })

  return dedupeSourceRefs([...directRefs, ...toolMapRefs, ...helperRefs, ...factoryArgRefs])
}

/** Collects Convex Agent refs available through parser-neutral config readers. */
function convexAgentStableSourceRefs(ctx: ExtractContext, definitionId: string) {
  const callbackProperties = ['usageHandler', 'contextHandler', 'prepare'] as const
  return [
    ctx.sourceRef.property({ property: 'prompt', role: 'config', definitionId }),
    ctx.sourceRef.property({ property: 'tools', role: 'config', definitionId }),
    ...callbackProperties.map((property) => ctx.sourceRef.property({ property, role: 'callback', definitionId })),
  ].filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
}

function convexAgentRecordSourceRefs(ctx: ExtractContext, definitionId: string): readonly ExtractedSourceRef[] {
  const recordCtx = internalStaticRecordContext(ctx)
  const directRefs = convexAgentStableSourceRefs(ctx, definitionId)
  if (!recordCtx?.objectArg) return directRefs
  const resolver = createStaticRecordSourceResolver({
    record: recordCtx.record,
    initializers: recordCtx.initializers,
    initializerRecords: recordCtx.initializerRecords,
    ...(recordCtx.recordsByFile ? { recordsByFile: recordCtx.recordsByFile } : {}),
  })
  const callbackProperties = ['usageHandler', 'contextHandler', 'prepare'] as const
  const helperRefs = ['tools', ...callbackProperties].flatMap((property) =>
    ctx.sourceRef.helperRefsForProperty({ property, definitionId }),
  )
  const toolMapRefs = recordToolMapContributorRefs(recordCtx.objectArg, resolver, definitionId)
  const factoryArgRefs = callbackProperties.flatMap((property) =>
    recordFactoryArgRefs(recordCtx.objectArg, property, resolver, definitionId),
  )
  return dedupeSourceRefs([...directRefs, ...toolMapRefs, ...helperRefs, ...factoryArgRefs])
}

function recordToolMapContributorRefs(
  objectArg: StaticObjectValue | undefined,
  resolver: ReturnType<typeof createStaticRecordSourceResolver>,
  definitionId: string,
): readonly ExtractedSourceRef[] {
  if (!objectArg) return []
  const tools = resolver.resolveValue(staticObjectPropertyValue(objectArg, 'tools'))
  const toolObject = tools?.value.kind === 'object' ? tools.value : undefined
  if (!tools || !toolObject) return []
  return toolObject.properties.flatMap((property): readonly ExtractedSourceRef[] => {
    if (property.value.kind !== 'identifier') return []
    const resolved = resolver.resolveFrom(tools, property.value)
    if (!resolved) return []
    return [
      {
        definitionId,
        ref: staticRecordProjectSourceRef({
          definitionId,
          role: 'config',
          property: 'tools',
          resolved,
          metadata: { toolMapContributor: property.spread ? 'spread' : 'property' },
        }),
      },
    ]
  })
}

function recordFactoryArgRefs(
  objectArg: StaticObjectValue | undefined,
  property: string,
  resolver: ReturnType<typeof createStaticRecordSourceResolver>,
  definitionId: string,
): readonly ExtractedSourceRef[] {
  if (!objectArg) return []
  const value = staticObjectPropertyValue(objectArg, property)
  const resolved = resolver.resolveValue(value)
  const call = callValue(resolved?.value ?? value)
  if (!call) return []
  return call.args.flatMap((arg, index): readonly ExtractedSourceRef[] => {
    if (arg.kind !== 'identifier') return []
    const argResolved = resolver.resolveValue(arg)
    if (!argResolved) return []
    return [
      {
        definitionId,
        ref: staticRecordProjectSourceRef({
          definitionId,
          role: 'config',
          property,
          resolved: argResolved,
          metadata: { factoryArg: true, argumentIndex: index, argumentName: arg.name },
        }),
      },
    ]
  })
}

function callValue(value: StaticSyntaxValue | undefined): StaticCallValue | undefined {
  return value?.kind === 'call' ? value : undefined
}

/**
 * Builds the structured `metadata.intelligence` payload consumed by index detail views.
 *
 * The shape groups prompt, tool, handoff, and data-access facts so consumers do not need to infer
 * agent structure from source snippets.
 */
function agentIntelligence(
  promptRef: string | undefined,
  toolRefs: readonly string[],
  handoffs: readonly string[],
  dataAccesses: readonly PrimitiveDataAccessRef[],
  constraints: readonly string[],
  guardrails: readonly string[],
): Record<string, unknown> | undefined {
  const data = primitiveDataIntelligence(dataAccesses)?.data
  if (
    !promptRef &&
    toolRefs.length === 0 &&
    handoffs.length === 0 &&
    constraints.length === 0 &&
    guardrails.length === 0 &&
    !data
  )
    return undefined
  return {
    confidence: 'static',
    control: {
      mode: handoffs.length > 0 ? 'event-driven' : 'immediate',
      ordering: 'event-driven',
    },
    dependencies: {
      ...(promptRef ? { prompt: promptRef } : {}),
      ...(promptRef ? { prompts: [promptRef] } : {}),
      ...(toolRefs.length > 0 ? { tools: [...toolRefs] } : {}),
      ...(handoffs.length > 0 ? { handoffs: [...handoffs] } : {}),
      ...(handoffs.length > 0 ? { agents: [...handoffs] } : {}),
      ...(constraints.length > 0 ? { constraints: [...constraints] } : {}),
      ...(guardrails.length > 0 ? { guardrails: [...guardrails] } : {}),
    },
    ...(data ? { data } : {}),
  }
}

/** Converts agent data-access observations into unresolved read/write relation refs. */
function dataAccessRelationRefs(fromId: string, accesses: readonly PrimitiveDataAccessRef[]): StaticRelationRef[] {
  return accesses.map((access) => ({
    type: access.kind === 'read' ? 'agent.reads_memory' : 'agent.writes_memory',
    typeByTargetKind:
      access.kind === 'read'
        ? {
            memory: 'agent.reads_memory',
            blackboard: 'agent.reads_blackboard',
            workspace: 'agent.reads_workspace',
          }
        : {
            memory: 'agent.writes_memory',
            blackboard: 'agent.writes_blackboard',
            workspace: 'agent.writes_workspace',
          },
    fromId,
    toVariable: access.targetVariable,
  }))
}

/** Reads the prompt identifier passed through `resolve(...)` helper calls. */
function promptRefFromResolveCall(expression: ts.Expression): string | undefined {
  const candidate = ts.isAwaitExpression(expression) ? expression.expression : expression
  if (!ts.isCallExpression(candidate) || expressionName(candidate.expression) !== 'resolve') return undefined
  const [firstArg] = candidate.arguments
  return firstArg && ts.isIdentifier(firstArg) ? firstArg.text : undefined
}

function promptRefFromRecordResolveCall(value: StaticSyntaxValue | undefined): string | undefined {
  if (value?.kind !== 'call') return undefined
  const callName = value.callee.localName ?? value.callee.name
  const [firstArg] = value.args
  return callName === 'resolve' && firstArg?.kind === 'identifier' ? firstArg.name : undefined
}

/** Resolves a property initializer, including shorthand properties and local initializer aliases. */
function propertyInitializer(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | ts.ShorthandPropertyAssignment | undefined {
  const property = object.properties.find(
    (item): item is ts.PropertyAssignment | ts.ShorthandPropertyAssignment =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && propertyName(item.name) === name,
  )
  if (!property) return undefined
  return ts.isShorthandPropertyAssignment(property) ? property : property.initializer
}

/** Resolves an object-literal config property, including one local identifier alias. */
function objectLiteralForProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const initializer = propertyInitializer(object, name)
  const expression = initializer ? resolveIdentifierExpression(toExpression(initializer), localInitializers) : undefined
  return expression && ts.isObjectLiteralExpression(expression) ? expression : undefined
}

/** Converts shorthand properties into identifier expressions so downstream helpers can share one path. */
function toExpression(value: ts.Expression | ts.ShorthandPropertyAssignment): ts.Expression {
  return ts.isShorthandPropertyAssignment(value) ? value.name : value
}

/** Resolves one local identifier alias before parser-owned source-ref or schema projection. */
function resolveIdentifierExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers.get(expression.text) ?? expression) : expression
}

/** Reads the callable or property name represented by a TypeScript expression. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

/** Deduplicates source refs by stable ref id while preserving the last computed value for each id. */
function dedupeSourceRefs<T extends { readonly ref: { readonly id: string } }>(refs: readonly T[]): T[] {
  const merged = new Map<string, T>()
  for (const ref of refs) merged.set(ref.ref.id, ref)
  return [...merged.values()]
}

/** Removes absent source refs after conservative source-ref construction. */
function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined
}
