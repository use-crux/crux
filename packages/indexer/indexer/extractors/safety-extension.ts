import { safeId } from '../definitions'
import type { ConfigReader, ExtractContext, IndexExtractor, UnresolvedReference } from '../extensions'
import { facts } from '../extensions'
import type { ProjectSourceRefRole, SafetyFacts } from '@use-crux/core/project-index'
import { internalStaticRecordContext } from '../static-index/compatibility/syntax-record-bridge/native-context'
import type { StaticObjectValue, StaticSyntaxValue } from '../static-index/syntax/record/types'

const safetyBoundaryIds = new Set([
  'user.input',
  'model.input',
  'model.output.text',
  'model.output.object',
  'model.output',
  'tool.call',
  'tool.result',
  'approval.request',
  'retrieval.result',
  'memory.write',
  'validation.feedback',
])

const boundaryIdByHelperPath: Readonly<Record<string, string | undefined>> = {
  'boundary.input.user': 'user.input',
  'boundary.input.text': 'user.input',
  'boundary.input.model': 'model.input',
  'boundary.output.text': 'model.output.text',
  'boundary.output.object': 'model.output.object',
  'boundary.output.both': 'model.output',
  'boundary.output.path': 'model.output.object',
  'boundary.tool.call': 'tool.call',
  'boundary.tool.result': 'tool.result',
  'boundary.approval.request': 'approval.request',
  'boundary.retrieval.result': 'retrieval.result',
  'boundary.memory.write': 'memory.write',
  'boundary.validation.feedback': 'validation.feedback',
}

/**
 * Extracts constraint, guardrail, and tool policy definitions from safety primitives.
 *
 * Safety extractors preserve validator/policy source refs and normalize `appliesTo`-style fields into
 * unresolved references so relation resolution can connect policies to protected index definitions.
 */
export const safetyIndexExtractor: IndexExtractor = {
  name: 'safety',
  patterns: [
    { kind: 'call', name: 'constraint' },
    { kind: 'call', name: 'guardrail' },
    { kind: 'call', name: 'toolPolicy' },
  ],
  extract: (ctx) => {
    const config = ctx.config
    if (!config) return { kind: 'none' }
    if (ctx.match.name === 'constraint') {
      const policyId = policyIdFor(ctx, config)
      const id = `constraint:${safeId(policyId)}`
      const targets = appliesToRefs(config)
      const boundaries = safetyBoundaries(ctx)
      const boundary = boundaries[0]
      const strategy = strategyFacts(config)
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id,
            kind: 'constraint',
            name: policyId,
            metadata: {
              exportName: ctx.source.variableName,
              policyId,
              severity: config.string('severity'),
              ...(boundary ? { boundary } : {}),
              ...(boundaries.length > 0 ? { boundaries } : {}),
              appliesTo: targets.metadata,
              ...(strategy ? { strategy } : {}),
              facts: safetyFacts({
                kind: 'constraint',
                policyId,
                severity: config.string('severity'),
                ...(boundary ? { boundary } : {}),
                ...(boundaries.length > 0 ? { boundaries } : {}),
                appliesTo: targets.metadata,
                ...(strategy ? { strategy } : {}),
              }),
            },
          }),
        ],
        sourceRefs: validatorSourceRefs(ctx, id, 'validator'),
        references: targets.refs.map((target) => ({ type: 'constraint.applies_to', ...target })),
      })
    }
    if (ctx.match.name === 'guardrail') {
      const policyId = policyIdFor(ctx, config)
      const id = `guardrail:${safeId(policyId)}`
      const targets = appliesToRefs(config)
      const boundaries = safetyBoundaries(ctx)
      const phase = config.string('phase')
      const strategy = strategyFacts(config)
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id,
            kind: 'guardrail',
            name: policyId,
            metadata: {
              exportName: ctx.source.variableName,
              policyId,
              phase,
              mode: config.string('mode'),
              stream: config.string('stream'),
              ...(boundaries.length > 0 ? { boundaries } : {}),
              appliesTo: targets.metadata,
              ...(strategy ? { strategy } : {}),
              facts: safetyFacts({
                kind: 'guardrail',
                policyId,
                policy: phase,
                ...(boundaries.length > 0 ? { boundaries } : {}),
                appliesTo: targets.metadata,
                ...(strategy ? { strategy } : {}),
              }),
            },
          }),
        ],
        sourceRefs: validatorSourceRefs(ctx, id, 'policy'),
        references: targets.refs.map((target) => ({ type: 'guardrail.applies_to', ...target })),
      })
    }
    if (ctx.match.name === 'toolPolicy') {
      const policyId = policyIdFor(ctx, config)
      const id = `toolPolicy:${safeId(policyId)}`
      const match = toolPolicyMatchFacts(config)
      return facts({
        definitions: [
          ctx.define.definition({
            variableName: ctx.source.variableName,
            id,
            kind: 'toolPolicy',
            name: policyId,
            metadata: {
              exportName: ctx.source.variableName,
              policyId,
              action: config.string('action'),
              ...(match ? { match } : {}),
              facts: safetyFacts({
                kind: 'toolPolicy',
                policyId,
                action: config.string('action'),
                ...(match ? { match } : {}),
              }),
            },
          }),
        ],
        sourceRefs: validatorSourceRefs(ctx, id, 'policy'),
      })
    }
    return { kind: 'none' }
  },
}

/** Collects callback source refs for validator or policy functions on safety definitions. */
function validatorSourceRefs(
  ctx: ExtractContext,
  definitionId: string,
  role: ProjectSourceRefRole,
) {
  return ['check', 'run', 'validate', 'evaluate']
    .map((property) => ctx.sourceRef.callbackProperty({ property, role, definitionId }))
    .filter((ref): ref is NonNullable<typeof ref> => Boolean(ref))
}

/**
 * Normalizes all supported target fields into unresolved references plus display metadata.
 *
 * Identifier targets are treated as variables/imports for resolver binding; string targets containing
 * a index-id separator are treated as direct ids.
 */
function appliesToRefs(config: NonNullable<Parameters<IndexExtractor['extract']>[0]['config']>): {
  readonly refs: ReadonlyArray<Pick<UnresolvedReference, 'toVariable' | 'toId'>>
  readonly metadata?: readonly string[]
} {
  const names = ['appliesTo', 'target', 'targets', 'for']
  const refs = names.flatMap((name): Array<Pick<UnresolvedReference, 'toVariable' | 'toId'>> => {
    const single = config.identifier(name)
    return [
      ...(single ? [{ toVariable: single }] : []),
      ...config.identifierArray(name).map((item) => ({ toVariable: item })),
      ...config.stringArray(name).map((item) =>
        item.includes(':') ? { toId: item } : { toVariable: item },
      ),
    ]
  })
  const metadata = names.flatMap((name) => [
    ...[config.identifier(name)].filter(isString),
    ...config.identifierArray(name),
    ...config.stringArray(name),
  ])
  return { refs, ...(metadata.length > 0 ? { metadata } : {}) }
}

/** Reads the stable beta `id` first while preserving legacy `name` fallback. */
function policyIdFor(ctx: ExtractContext, config: ConfigReader): string {
  return config.string('id') ?? config.string('name') ?? ctx.source.localName
}

/** Extracts safe, public strategy identity from helper calls such as `guardrail.pii(...)`. */
function strategyFacts(config: ConfigReader): SafetyFacts['strategy'] | undefined {
  const kind = config.callName('run')
  return kind ? { kind } : undefined
}

/** Extracts statically known Safety boundary ids from `on: boundary.*()` declarations. */
function safetyBoundaries(ctx: ExtractContext): readonly string[] {
  const objectArg = internalStaticRecordContext(ctx)?.objectArg
  const on = objectArg ? propertyValue(objectArg, 'on') : undefined
  return on ? unique(boundaryIdsFromValue(on)) : []
}

function boundaryIdsFromValue(value: StaticSyntaxValue): readonly string[] {
  if (value.kind === 'array') return value.elements.flatMap((entry) => boundaryIdsFromValue(entry))
  const id = boundaryIdFromValue(value)
  return id ? [id] : []
}

function boundaryIdFromValue(value: StaticSyntaxValue): string | undefined {
  if (value.kind === 'literal' && typeof value.value === 'string' && safetyBoundaryIds.has(value.value)) {
    return value.value
  }
  if (value.kind === 'call') {
    return boundaryIdByHelperPath[callPath(value).join('.')]
  }
  if (value.kind === 'property-access') {
    return boundaryIdByHelperPath[value.path.join('.')]
  }
  return undefined
}

function callPath(value: Extract<StaticSyntaxValue, { kind: 'call' }>): readonly string[] {
  return [...valuePath(value.receiver), value.callee.localName ?? value.callee.name]
}

function valuePath(value: StaticSyntaxValue | undefined): readonly string[] {
  if (!value) return []
  if (value.kind === 'identifier') return [value.name]
  if (value.kind === 'property-access') return value.path
  if (value.kind === 'call') return callPath(value)
  return []
}

function propertyValue(object: StaticObjectValue, name: string): StaticSyntaxValue | undefined {
  return object.properties.find((property) => !property.spread && property.name === name)?.value
}

function toolPolicyMatchFacts(config: ConfigReader): SafetyFacts['match'] | undefined {
  const match = config.object('match')
  const tool = match?.string('tool') ?? config.string('match')
  const tools = config.stringArray('match')
  const facts: Record<string, unknown> = {}
  if (tool) facts.tool = tool
  if (tools.length > 0) facts.tools = [...tools]
  return Object.keys(facts).length > 0 ? facts : undefined
}

function safetyFacts(input: SafetyFacts): SafetyFacts {
  return compactRecord(input) as SafetyFacts
}

function compactRecord<T extends object>(input: T): T {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as T
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}

/** Removes absent optional target values while preserving authored empty strings if they are ever allowed. */
function isString(value: string | undefined): value is string {
  return typeof value === 'string'
}
