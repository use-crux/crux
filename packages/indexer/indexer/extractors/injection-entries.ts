import ts from 'typescript'
import type { InjectionReturnContributionFacts, InjectionToolFacts, InjectionUseFacts } from '@use-crux/core/project-index'
import type { StaticRelationRef } from '../types'
import type { ExtractContext } from '../extensions'
import { propertyName } from '../ast/literals'
import { resolveIdentifierSourceNode } from '../ast/source-refs'
import { internalStaticCallContext, internalStaticRecordContext, type InternalStaticRecordContext } from '../static-index/compatibility/syntax-record-bridge/native-context'
import type { StaticObjectValue, StaticSyntaxValue } from '../static-index/syntax/record/types'
import {
  createStaticSyntaxInitializerMap,
  resolveStaticSyntaxValue,
  type StaticSyntaxInitializerMap,
  staticObjectPropertyValue,
} from '../static-index/syntax/record/value'

type InjectionOwner = 'prompt' | 'context' | 'injectable'

/** Injection dependency fact enriched with the source-local variable used for relation binding. */
interface UseEntryWithSource extends InjectionUseFacts {
  readonly variable?: string
}

/** Tool contribution facts plus source-local variables that should become unresolved tool relations. */
interface ToolExtraction {
  readonly facts?: InjectionToolFacts
  readonly references: readonly string[]
}

interface ReferenceContributionExtraction {
  readonly variables: readonly string[]
  readonly dynamic: boolean
}

/** Value summary of statically visible contributions returned by an injectable callback. */
export interface InjectableStaticContributions {
  readonly useEntries: readonly UseEntryWithSource[]
  readonly tools: ToolExtraction
  readonly contributionFacts?: InjectionReturnContributionFacts
  readonly constraintReferences: readonly string[]
  readonly guardrailReferences: readonly string[]
  readonly mayInject: readonly string[]
}

/**
 * Reads an injection-like config property and returns the statically visible dependency entries it contains.
 *
 * The helper understands direct identifiers, local array constants, `when(...)`, and `match(...)` branches. It
 * intentionally returns conservative "unknown" or "dynamic" entries for shapes that require evaluation so callers
 * can preserve authored dependency intent without executing user code.
 */
export function injectionUseEntriesForConfigProperty(
  ctx: ExtractContext,
  property: string,
): readonly UseEntryWithSource[] {
  const expression = propertyExpression(ctx, property)
  if (expression) return injectionUseEntriesFromExpression(ctx, expression)
  const recordCtx = internalStaticRecordContext(ctx)
  const recordValue = recordCtx?.objectArg ? staticObjectPropertyValue(recordCtx.objectArg, property) : undefined
  return recordCtx && recordValue
    ? injectionUseEntriesFromRecordValue(recordValue, recordCtx.initializers)
    : injectionUseEntriesFromConfigProperty(ctx, property)
}

/**
 * Extracts injection dependency entries from a known object literal property.
 *
 * This is used by callback-return parsers such as `inject: () => ({ contexts: [...] })`, where the relevant
 * dependency array is nested below a returned object rather than on the primitive's top-level config.
 */
export function injectionUseEntriesFromObjectProperty(
  ctx: ExtractContext,
  object: ts.ObjectLiteralExpression,
  property: string,
): readonly UseEntryWithSource[] {
  const expression = propertyExpressionFromObject(object, property)
  return expression ? injectionUseEntriesFromExpression(ctx, expression) : []
}

/**
 * Converts extracted injection entries into unresolved index relation refs.
 *
 * Relation refs stay source-local at this point: they keep the authored variable name plus a target-kind map, and
 * the relation resolver later decides whether the target is a context, injectable, memory, or blackboard definition.
 */
export function relationRefsForInjectionUse(
  owner: InjectionOwner,
  fromId: string,
  entries: readonly UseEntryWithSource[],
): readonly StaticRelationRef[] {
  return entries.flatMap((entry) => {
    if (!entry.variable) return []
    const type = relationTypeForHint(owner, entry.relationHint)
    return [
      {
        type,
        typeByTargetKind: relationTypesByTargetKind(owner),
        fromId,
        toVariable: entry.variable,
      },
    ]
  })
}

/**
 * Reads a top-level tools-like config property and returns both index facts and unresolved tool references.
 *
 * Object literals preserve user-facing tool names while shorthand and identifier initializers preserve relation
 * targets. Dynamic shapes still mark the primitive as tool-capable without inventing dependencies.
 */
export function toolContributionsForConfigProperty(ctx: ExtractContext, property: string): ToolExtraction {
  const expression = propertyExpression(ctx, property)
  if (expression) return toolContributionsFromExpression(expression, ctx)
  const recordCtx = internalStaticRecordContext(ctx)
  const recordValue = recordCtx?.objectArg ? staticObjectPropertyValue(recordCtx.objectArg, property) : undefined
  return recordCtx && recordValue
    ? toolContributionsFromRecordValue(recordValue, recordCtx)
    : toolContributionsFromConfigProperty(ctx, property)
}

/**
 * Reads a tools-like property from an already discovered object literal.
 *
 * This supports callback-return objects such as injectable `tools` contributions and keeps that parsing behavior
 * shared with top-level config parsing.
 */
export function toolContributionsFromObjectProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
): ToolExtraction {
  return toolContributionsFromExpression(propertyExpressionFromObject(object, property))
}

/**
 * Projects an injectable callback return object into index-facing contribution values.
 *
 * The extractor does not need to hold a TypeScript object literal to understand what an injectable may
 * contribute. This helper keeps callback-return traversal inside the compiler-owned parsing layer and
 * exposes only injection entries, tool refs, and a list of visible contribution properties.
 */
export function injectableStaticContributions(
  ctx: ExtractContext,
  properties: readonly string[],
): InjectableStaticContributions {
  const returnObject = injectableReturnObject(ctx)
  if (!returnObject) {
    const recordReturnObject = injectableRecordReturnObject(ctx)
    const recordCtx = internalStaticRecordContext(ctx)
    if (recordReturnObject && recordCtx) {
      return injectableStaticContributionsFromRecordObject(recordReturnObject, properties, recordCtx.initializers)
    }
  }
  if (!returnObject) {
    return { useEntries: [], tools: { references: [] }, constraintReferences: [], guardrailReferences: [], mayInject: [] }
  }
  const constraints = referenceContributionsFromObjectProperty(returnObject, 'constraints')
  const guardrails = referenceContributionsFromObjectProperty(returnObject, 'guardrails')
  const metadata = metadataContributionsFromObjectProperty(returnObject, 'metadata')
  const contributionFacts = injectionReturnContributionFacts(constraints, guardrails, metadata)
  return {
    useEntries: injectionUseEntriesFromObjectProperty(ctx, returnObject, 'contexts'),
    tools: toolContributionsFromObjectProperty(returnObject, 'tools'),
    ...(contributionFacts ? { contributionFacts } : {}),
    constraintReferences: constraints.variables,
    guardrailReferences: guardrails.variables,
    mayInject: properties.filter((property) => hasObjectProperty(returnObject, property)),
  }
}

function injectableStaticContributionsFromRecordObject(
  object: StaticObjectValue,
  properties: readonly string[],
  initializers: StaticSyntaxInitializerMap,
): InjectableStaticContributions {
  const constraints = referenceContributionsFromRecordProperty(object, 'constraints')
  const guardrails = referenceContributionsFromRecordProperty(object, 'guardrails')
  const metadata = metadataContributionsFromRecordProperty(object, 'metadata')
  const contributionFacts = injectionReturnContributionFacts(constraints, guardrails, metadata)
  const toolsValue = staticObjectPropertyValue(object, 'tools')
  return {
    useEntries: injectionUseEntriesFromRecordProperty(object, 'contexts', initializers),
    tools: toolsValue ? toolContributionsFromRecordObjectValue(toolsValue) : { references: [] },
    ...(contributionFacts ? { contributionFacts } : {}),
    constraintReferences: constraints.variables,
    guardrailReferences: guardrails.variables,
    mayInject: properties.filter((property) => Boolean(staticObjectPropertyValue(object, property))),
  }
}

function injectableRecordReturnObject(ctx: ExtractContext): StaticObjectValue | undefined {
  const recordCtx = internalStaticRecordContext(ctx)
  if (!recordCtx?.objectArg) return undefined
  const value = staticObjectPropertyValue(recordCtx.objectArg, 'inject')
  const resolved = resolveStaticSyntaxValue(value, recordCtx.initializers)
  return firstReturnedRecordObject(resolved)
}

function firstReturnedRecordObject(value: StaticSyntaxValue | undefined): StaticObjectValue | undefined {
  if (value?.kind !== 'function') return undefined
  for (const returned of value.returns) {
    if (returned.kind === 'object') return returned
    const nested = firstReturnedRecordObject(returned)
    if (nested) return nested
  }
  return undefined
}

function injectionUseEntriesFromRecordProperty(
  object: StaticObjectValue,
  property: string,
  initializers: StaticSyntaxInitializerMap,
): readonly UseEntryWithSource[] {
  const value = staticObjectPropertyValue(object, property)
  return value ? injectionUseEntriesFromRecordValue(value, initializers) : []
}

function injectionUseEntriesFromRecordValue(
  value: StaticSyntaxValue,
  initializers: StaticSyntaxInitializerMap,
  inherited: Partial<Pick<UseEntryWithSource, 'conditionality' | 'via' | 'branch'>> = {},
  seen: ReadonlySet<string> = new Set(),
): readonly UseEntryWithSource[] {
  if (value.kind === 'array') {
    return value.elements.flatMap((element) => injectionUseEntriesFromRecordValue(element, initializers, inherited, seen))
  }

  if (value.kind === 'identifier') {
    const local = initializers.get(value.name)
    if (local && !seen.has(value.name) && local.kind === 'array') {
      return injectionUseEntriesFromRecordValue(
        local,
        initializers,
        {
          conditionality: inherited.conditionality ?? 'always',
          via: inherited.via ?? 'array-ref',
          branch: inherited.branch,
        },
        new Set([...seen, value.name]),
      )
    }
    return [
      {
        variable: value.name,
        relationHint: 'unknown',
        conditionality: inherited.conditionality ?? 'always',
        via: inherited.via ?? 'direct',
        ...(inherited.branch ? { branch: inherited.branch } : {}),
      },
    ]
  }

  if (value.kind === 'call') {
    const callName = value.callee.localName ?? value.callee.name
    if (callName === 'when' && value.args[1]) {
      return injectionUseEntriesFromRecordValue(value.args[1], initializers, {
        conditionality: 'when',
        via: 'when',
        branch: inherited.branch,
      })
    }
    if (callName === 'match' && value.args[0]?.kind === 'object') {
      return matchRecordUseEntries(value.args[0], initializers)
    }
    return [{ relationHint: 'unknown', conditionality: 'dynamic', via: inherited.via ?? 'direct' }]
  }

  return [{ relationHint: 'unknown', conditionality: 'unknown', via: inherited.via ?? 'direct' }]
}

function matchRecordUseEntries(
  object: StaticObjectValue,
  initializers: StaticSyntaxInitializerMap,
): readonly UseEntryWithSource[] {
  const cases = staticRecordObjectAlias(staticObjectPropertyValue(object, 'cases'), initializers)
  const defaults = staticObjectPropertyValue(object, 'default')
  const caseEntries =
    cases?.kind === 'object'
      ? cases.properties.flatMap((property) =>
          injectionUseEntriesFromRecordValue(property.value, initializers, {
            conditionality: 'match-case',
            via: 'match',
            branch: property.name,
          }),
        )
      : []
  const defaultEntries = defaults
    ? injectionUseEntriesFromRecordValue(defaults, initializers, {
        conditionality: 'match-default',
        via: 'match',
        branch: 'default',
      })
    : []
  return [...caseEntries, ...defaultEntries]
}

function staticRecordObjectAlias(
  value: StaticSyntaxValue | undefined,
  initializers: StaticSyntaxInitializerMap,
): StaticObjectValue | undefined {
  const resolved = resolveStaticSyntaxValue(value, initializers)
  return resolved?.kind === 'object' ? resolved : undefined
}

function toolContributionsFromRecordObjectValue(value: StaticSyntaxValue): ToolExtraction {
  return value.kind === 'object' ? toolContributionsFromRecordObject(value) : { facts: { hasTools: true, dynamic: true }, references: [] }
}

function referenceContributionsFromRecordProperty(
  object: StaticObjectValue,
  property: string,
): ReferenceContributionExtraction {
  const value = staticObjectPropertyValue(object, property)
  if (!value) return { variables: [], dynamic: false }
  if (value.kind === 'identifier') return { variables: [value.name], dynamic: false }
  if (value.kind === 'array') {
    const variables = value.elements.flatMap((item) => (item.kind === 'identifier' ? [item.name] : []))
    return { variables, dynamic: variables.length !== value.elements.length }
  }
  return { variables: [], dynamic: true }
}

function metadataContributionsFromRecordProperty(
  object: StaticObjectValue,
  property: string,
): { readonly keys: readonly string[]; readonly dynamic: boolean } {
  const value = staticObjectPropertyValue(object, property)
  return value?.kind === 'object'
    ? {
        keys: value.properties.flatMap((item) => (item.spread ? [] : [item.name])),
        dynamic: value.properties.some((item) => item.spread),
      }
    : { keys: [], dynamic: Boolean(value) }
}

/**
 * Returns the object literal produced by an injectable callback when it is statically visible.
 *
 * Supported forms include inline object returns, parenthesized object returns, and simple block-bodied returns.
 * The function never evaluates the callback; it only unwraps syntax that TypeScript already parsed.
 */
export function injectableReturnObject(
  ctx: ExtractContext,
  property = 'inject',
): ts.ObjectLiteralExpression | undefined {
  const expression = propertyExpression(ctx, property)
  if (!expression) return undefined
  return returnedObjectLiteral(resolveLocalExpression(ctx, expression))
}

/**
 * Converts supported injection expressions into dependency entries without evaluating user code.
 *
 * Recursive calls preserve branch/conditional metadata as the parser walks array literals, local array constants,
 * conditional helpers, and binary guards. Unsupported calls become dynamic entries so indexer output remains honest.
 */
function injectionUseEntriesFromExpression(
  ctx: ExtractContext,
  expression: ts.Expression,
  inherited: Partial<Pick<UseEntryWithSource, 'conditionality' | 'via' | 'branch'>> = {},
  seen: ReadonlySet<string> = new Set(),
): readonly UseEntryWithSource[] {
  const resolved = expression

  if (ts.isArrayLiteralExpression(resolved)) {
    return resolved.elements.flatMap((element) => {
      if (ts.isSpreadElement(element)) {
        return injectionUseEntriesFromExpression(
          ctx,
          element.expression,
          { conditionality: inherited.conditionality ?? 'unknown', via: 'spread', branch: inherited.branch },
          seen,
        )
      }
      return injectionUseEntriesFromExpression(ctx, element as ts.Expression, inherited, seen)
    })
  }

  if (ts.isIdentifier(resolved)) {
    const local = localInitializers(ctx).get(resolved.text)
    if (local && !seen.has(resolved.text) && ts.isArrayLiteralExpression(local)) {
      return injectionUseEntriesFromExpression(
        ctx,
        local,
        {
          conditionality: inherited.conditionality ?? 'always',
          via: inherited.via ?? 'array-ref',
          branch: inherited.branch,
        },
        new Set([...seen, resolved.text]),
      )
    }
    return [
      {
        variable: resolved.text,
        relationHint: 'unknown',
        conditionality: inherited.conditionality ?? 'always',
        via: inherited.via ?? 'direct',
        ...(inherited.branch ? { branch: inherited.branch } : {}),
      },
    ]
  }

  if (ts.isCallExpression(resolved)) {
    const callName = expressionName(resolved.expression)
    if (callName === 'when' && resolved.arguments[1]) {
      return injectionUseEntriesFromExpression(ctx, resolved.arguments[1], {
        conditionality: 'when',
        via: 'when',
        branch: inherited.branch,
      })
    }
    if (callName === 'match' && resolved.arguments[0] && ts.isObjectLiteralExpression(resolved.arguments[0])) {
      return matchUseEntries(ctx, resolved.arguments[0])
    }
    return [{ conditionality: 'dynamic', via: inherited.via ?? 'direct' }]
  }

  if (ts.isBinaryExpression(resolved) && resolved.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return injectionUseEntriesFromExpression(ctx, resolved.right, {
      conditionality: 'binary-guard',
      via: 'binary',
      branch: inherited.branch,
    })
  }

  return [{ conditionality: 'unknown', via: inherited.via ?? 'direct' }]
}

function injectionUseEntriesFromConfigProperty(
  ctx: ExtractContext,
  property: string,
): readonly UseEntryWithSource[] {
  const config = ctx.config
  if (!config) return []
  const arrayIdentifiers = config.identifierArray(property)
  const identifier = arrayIdentifiers.length > 0 ? undefined : config.identifier(property)
  const identifiers = uniqueStrings([...arrayIdentifiers, ...(identifier ? [identifier] : [])])
  if (identifiers.length > 0) {
    return identifiers.map((variable) => ({
      variable,
      relationHint: 'unknown',
      conditionality: 'always',
      via: 'direct',
    }))
  }
  return config.has(property) ? [{ relationHint: 'unknown', conditionality: 'unknown', via: 'direct' }] : []
}

/**
 * Extracts branch-aware dependency entries from the Crux `match(...)` helper shape.
 *
 * Each object key in `cases` becomes the `branch` metadata for the extracted entry; the optional `default` property
 * is represented as a dedicated default branch.
 */
function matchUseEntries(ctx: ExtractContext, object: ts.ObjectLiteralExpression): readonly UseEntryWithSource[] {
  const cases = propertyExpressionFromObject(object, 'cases')
  const defaults = propertyExpressionFromObject(object, 'default')
  const caseEntries =
    cases && ts.isObjectLiteralExpression(cases)
      ? cases.properties.flatMap((item): readonly UseEntryWithSource[] => {
          if (!ts.isPropertyAssignment(item)) return []
          const branch = propertyName(item.name)
          return injectionUseEntriesFromExpression(ctx, item.initializer, {
            conditionality: 'match-case',
            via: 'match',
            ...(branch ? { branch } : {}),
          })
        })
      : []
  const defaultEntries = defaults
    ? injectionUseEntriesFromExpression(ctx, defaults, {
        conditionality: 'match-default',
        via: 'match',
        branch: 'default',
      })
    : []
  return [...caseEntries, ...defaultEntries]
}

/**
 * Projects a tools expression into index-facing facts and relation targets.
 *
 * Object literals are treated as statically visible tool maps. Other expressions are marked dynamic because the
 * compiler can see that tools may be provided but cannot safely name them.
 */
function toolContributionsFromExpression(
  expression: ts.Expression | undefined,
  ctx?: ExtractContext,
  seen: ReadonlySet<string> = new Set(),
): ToolExtraction {
  if (!expression) return { references: [] }
  if (ts.isObjectLiteralExpression(expression)) {
    return toolContributionsFromObjectLiteral(expression)
  }
  if (ctx && ts.isCallExpression(expression)) {
    return toolContributionsFromFactoryCall(ctx, expression, seen)
  }
  return { facts: { hasTools: true, dynamic: true }, references: [] }
}

function toolContributionsFromConfigProperty(ctx: ExtractContext, property: string): ToolExtraction {
  const config = ctx.config
  if (!config) return { references: [] }
  const entries = config.objectMapIdentifierEntries(property)
  if (entries.length > 0) {
    const references = entries.map((entry) => entry.value)
    return {
      facts: {
        hasTools: true,
        names: entries.map((entry) => entry.key),
        variables: references,
      },
      references,
    }
  }
  const identifiers = config.identifierArray(property)
  if (identifiers.length > 0) {
    return {
      facts: {
        hasTools: true,
        names: [...identifiers],
        variables: [...identifiers],
      },
      references: [...identifiers],
    }
  }
  const reference = config.reference(property)
  if (reference) {
    return {
      facts: {
        hasTools: true,
        variables: [reference],
      },
      references: [reference],
    }
  }
  return config.has(property) ? { facts: { hasTools: true, dynamic: true }, references: [] } : { references: [] }
}

function toolContributionsFromRecordValue(
  value: StaticSyntaxValue,
  ctx: InternalStaticRecordContext,
  seen: ReadonlySet<string> = new Set(),
): ToolExtraction {
  const resolved = resolveStaticSyntaxValue(value, ctx.initializers)
  if (resolved?.kind === 'object') return toolContributionsFromRecordObject(resolved)
  if (resolved?.kind === 'call') return toolContributionsFromRecordFactoryCall(resolved, ctx, seen)
  if (resolved?.kind === 'identifier') return { facts: { hasTools: true, variables: [resolved.name] }, references: [resolved.name] }
  return { facts: { hasTools: true, dynamic: true }, references: [] }
}

function toolContributionsFromRecordObject(object: StaticObjectValue, dynamic = false): ToolExtraction {
  const hasSpread = object.properties.some((property) => property.spread)
  const contributions = object.properties.flatMap((property): readonly { readonly name: string; readonly reference: string }[] => {
    if (property.spread) return []
    if (property.value.kind === 'identifier') return [{ name: property.name, reference: property.value.name }]
    return []
  })
  const names = contributions.map((item) => item.name)
  const references = contributions.map((item) => item.reference)
  return {
    facts: {
      hasTools: true,
      ...(dynamic || hasSpread ? { dynamic: true } : {}),
      ...(names.length > 0 ? { names } : {}),
      ...(references.length > 0 ? { variables: references } : {}),
    },
    references,
  }
}

function toolContributionsFromRecordFactoryCall(
  call: Extract<StaticSyntaxValue, { readonly kind: 'call' }>,
  ctx: InternalStaticRecordContext,
  seen: ReadonlySet<string>,
): ToolExtraction {
  const callName = call.callee.localName ?? call.callee.name
  const key = `${ctx.record.file}:${callName}`
  if (seen.has(key)) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const helper = resolveStaticSyntaxValue({ kind: 'identifier', name: callName }, ctx.initializers)
  if (helper?.kind !== 'function') return { facts: { hasTools: true, dynamic: true }, references: [] }
  const helperInitializers = createStaticSyntaxInitializerMap(helper.localInitializers)
  const objects = helper.returns.flatMap((value): readonly StaticObjectValue[] => {
    const resolved = resolveStaticSyntaxValue(value, helperInitializers)
    return resolved?.kind === 'object' ? [resolved] : []
  })
  const object = objects.sort((a, b) => b.properties.length - a.properties.length)[0]
  return object ? toolContributionsFromRecordObject(object, true) : { facts: { hasTools: true, dynamic: true }, references: [] }
}

function referenceContributionsFromObjectProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
): ReferenceContributionExtraction {
  return referenceContributionsFromExpression(propertyExpressionFromObject(object, property))
}

function referenceContributionsFromExpression(expression: ts.Expression | undefined): ReferenceContributionExtraction {
  if (!expression) return { variables: [], dynamic: false }
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression
  if (ts.isIdentifier(unwrapped)) return { variables: [unwrapped.text], dynamic: false }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    const variables: string[] = []
    let dynamic = false
    for (const element of unwrapped.elements) {
      if (ts.isSpreadElement(element)) {
        const spread = referenceContributionsFromExpression(element.expression)
        variables.push(...spread.variables)
        dynamic = dynamic || spread.dynamic || spread.variables.length === 0
        continue
      }
      if (ts.isIdentifier(element)) {
        variables.push(element.text)
      } else {
        dynamic = true
      }
    }
    return { variables, dynamic }
  }
  return { variables: [], dynamic: true }
}

function metadataContributionsFromObjectProperty(
  object: ts.ObjectLiteralExpression,
  property: string,
): { readonly keys: readonly string[]; readonly dynamic: boolean } {
  const expression = propertyExpressionFromObject(object, property)
  if (!expression) return { keys: [], dynamic: false }
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression
  if (!ts.isObjectLiteralExpression(unwrapped)) return { keys: [], dynamic: true }
  const keys: string[] = []
  let dynamic = false
  for (const item of unwrapped.properties) {
    if (ts.isSpreadAssignment(item)) {
      dynamic = true
      continue
    }
    if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) {
      dynamic = true
      continue
    }
    const name = propertyName(item.name)
    if (name) keys.push(name)
    if (ts.isComputedPropertyName(item.name)) dynamic = true
  }
  return { keys, dynamic }
}

function injectionReturnContributionFacts(
  constraints: ReferenceContributionExtraction,
  guardrails: ReferenceContributionExtraction,
  metadata: { readonly keys: readonly string[]; readonly dynamic: boolean },
): InjectionReturnContributionFacts | undefined {
  const facts: InjectionReturnContributionFacts = {}
  if (constraints.variables.length > 0 || constraints.dynamic) {
    facts.constraints = {
      ...(constraints.variables.length > 0 ? { variables: [...constraints.variables] } : {}),
      ...(constraints.dynamic ? { dynamic: true } : {}),
    }
  }
  if (guardrails.variables.length > 0 || guardrails.dynamic) {
    facts.guardrails = {
      ...(guardrails.variables.length > 0 ? { variables: [...guardrails.variables] } : {}),
      ...(guardrails.dynamic ? { dynamic: true } : {}),
    }
  }
  if (metadata.keys.length > 0 || metadata.dynamic) {
    facts.metadata = {
      ...(metadata.keys.length > 0 ? { keys: [...metadata.keys] } : {}),
      ...(metadata.dynamic ? { dynamic: true } : {}),
    }
  }
  return Object.keys(facts).length > 0 ? facts : undefined
}

/** Extracts visible tool names from an object-literal tool map. */
function toolContributionsFromObjectLiteral(object: ts.ObjectLiteralExpression): ToolExtraction {
  const dynamic = object.properties.some(
    (item) =>
      ts.isSpreadAssignment(item) ||
      ((ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) && ts.isComputedPropertyName(item.name)),
  )
  const contributions = object.properties.flatMap(
      (item): readonly { readonly name?: string; readonly reference?: string }[] => {
        if (ts.isShorthandPropertyAssignment(item)) {
          return [{ name: item.name.text, reference: item.name.text }]
        }
        if (!ts.isPropertyAssignment(item)) return []
        const name = propertyName(item.name)
        const reference = ts.isIdentifier(item.initializer) ? item.initializer.text : undefined
        return name || reference ? [{ ...(name ? { name } : {}), reference: reference ?? name }] : []
      },
  )
  const names = contributions.flatMap((item) => item.name ?? [])
  const references = contributions.flatMap((item) => item.reference ?? [])
  return {
    facts: {
      hasTools: true,
      ...(dynamic ? { dynamic } : {}),
      ...(names.length > 0 ? { names } : {}),
      ...(references.length > 0 ? { variables: references } : {}),
    },
    references,
  }
}

/** Follows simple local/imported factory calls that return an object-literal tool map. */
function toolContributionsFromFactoryCall(
  ctx: ExtractContext,
  call: ts.CallExpression,
  seen: ReadonlySet<string>,
): ToolExtraction {
  const callName = expressionName(call.expression)
  const staticCtx = internalStaticCallContext(ctx)
  if (!callName || !staticCtx) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const key = `${staticCtx.file}:${callName}`
  if (seen.has(key)) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const resolved = resolveIdentifierSourceNode(
    staticCtx.root,
    staticCtx.file,
    staticCtx.sourceFile,
    callName,
    staticCtx.localInitializers,
  )
  if (!resolved || !ts.isFunctionDeclaration(resolved.node)) return { facts: { hasTools: true, dynamic: true }, references: [] }
  const object = returnedToolObjectFromFunction(resolved.node, resolved.localInitializers)
  if (!object) return { facts: { hasTools: true, dynamic: true }, references: [] }
  return toolContributionsFromExpression(object, ctx, new Set([...seen, key]))
}

/** Finds a statically visible object map returned by a factory function. */
function returnedToolObjectFromFunction(
  declaration: ts.FunctionDeclaration,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.ObjectLiteralExpression | undefined {
  const returned: ts.ObjectLiteralExpression[] = []
  if (!declaration.body) return undefined
  const functionInitializers = new Map(localInitializers)
  collectFunctionScopedInitializers(declaration.body, functionInitializers)
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      const expression = resolveFactoryExpression(node.expression, functionInitializers)
      if (ts.isObjectLiteralExpression(expression)) returned.push(expression)
    }
    ts.forEachChild(node, visit)
  }
  visit(declaration.body)
  return returned.sort((a, b) => b.properties.length - a.properties.length)[0]
}

/** Resolves return expressions such as `return allTools` to the local object literal. */
function resolveFactoryExpression(
  expression: ts.Expression,
  localInitializers: ReadonlyMap<string, ts.Expression>,
): ts.Expression {
  const unwrapped = ts.isParenthesizedExpression(expression) ? expression.expression : expression
  return ts.isIdentifier(unwrapped) ? (localInitializers.get(unwrapped.text) ?? unwrapped) : unwrapped
}

/** Collects local constants from a factory body for simple return-object resolution. */
function collectFunctionScopedInitializers(node: ts.Node, localInitializers: Map<string, ts.Expression>): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
    localInitializers.set(node.name.text, node.initializer)
  }
  ts.forEachChild(node, (child) => collectFunctionScopedInitializers(child, localInitializers))
}

/**
 * Unwraps syntax forms that can statically produce an injection return object.
 *
 * Parenthesized arrow returns are common for `inject: () => ({ ... })`. Expression-bodied callbacks are scanned for
 * the first object literal with injection-like keys so simple wrapper expressions can still be indexed.
 */
function returnedObjectLiteral(expression: ts.Expression): ts.ObjectLiteralExpression | undefined {
  if (ts.isParenthesizedExpression(expression)) return returnedObjectLiteral(expression.expression)
  if (ts.isObjectLiteralExpression(expression)) return expression
  if (ts.isArrowFunction(expression)) {
    if (ts.isObjectLiteralExpression(expression.body)) return expression.body
    if (ts.isParenthesizedExpression(expression.body)) return returnedObjectLiteral(expression.body.expression)
    if (ts.isExpression(expression.body)) return firstInjectionObject(expression.body)
    if (ts.isBlock(expression.body)) return returnedObjectFromBlock(expression.body)
  }
  if (ts.isFunctionExpression(expression)) return returnedObjectFromBlock(expression.body)
  return undefined
}

/** Reads a block-bodied callback and returns the first statically visible returned injection object. */
function returnedObjectFromBlock(block: ts.Block): ts.ObjectLiteralExpression | undefined {
  for (const statement of block.statements) {
    if (ts.isReturnStatement(statement) && statement.expression) {
      const returned = returnedObjectLiteral(statement.expression) ?? firstInjectionObject(statement.expression)
      if (returned) return returned
    }
  }
  return undefined
}

/**
 * Finds the first injection-shaped object literal below a TypeScript node.
 *
 * This is intentionally an internal traversal helper, not a public extension API. TypeScript exposes child traversal
 * through callbacks, so the small local assignment is contained here while the extractor-facing API remains immutable.
 */
function firstInjectionObject(node: ts.Node): ts.ObjectLiteralExpression | undefined {
  if (ts.isObjectLiteralExpression(node) && isInjectionObject(node)) return node
  let found: ts.ObjectLiteralExpression | undefined
  ts.forEachChild(node, (child) => {
    if (!found) found = firstInjectionObject(child)
  })
  return found
}

/** Checks whether an object literal resembles an injectable contribution object. */
function isInjectionObject(object: ts.ObjectLiteralExpression): boolean {
  return object.properties.some(
    (item) =>
      (ts.isPropertyAssignment(item) || ts.isShorthandPropertyAssignment(item)) &&
      ['contexts', 'tools', 'constraints', 'guardrails', 'metadata'].includes(propertyName(item.name) ?? ''),
  )
}

/** Checks whether a known object literal has a property or shorthand with the requested stable name. */
function hasObjectProperty(object: ts.ObjectLiteralExpression, property: string): boolean {
  return object.properties.some((item) => {
    if (!ts.isPropertyAssignment(item) && !ts.isShorthandPropertyAssignment(item)) return false
    return propertyName(item.name) === property
  })
}

/** Chooses the default relation type before the resolver has target-kind information. */
function relationTypeForHint(owner: InjectionOwner, hint: InjectionUseFacts['relationHint']): string {
  switch (hint) {
    case 'injectable':
      return `${owner}.uses_injectable`
    case 'memory':
      return `${owner}.uses_memory`
    case 'blackboard':
      return `${owner}.uses_blackboard`
    case 'context':
    case 'unknown':
    default:
      return `${owner}.uses_context`
  }
}

/** Returns the target-kind relation overrides used once relation binding identifies the target definition kind. */
function relationTypesByTargetKind(owner: InjectionOwner): StaticRelationRef['typeByTargetKind'] {
  return {
    context: `${owner}.uses_context`,
    injectable: `${owner}.uses_injectable`,
    memory: `${owner}.uses_memory`,
    blackboard: `${owner}.uses_blackboard`,
  }
}

/** Reads a property expression from the current extractor config object. */
function propertyExpression(ctx: ExtractContext, property: string): ts.Expression | undefined {
  const object = internalStaticCallContext(ctx)?.objectArg
  return object ? propertyExpressionFromObject(object, property) : undefined
}

/** Reads a named property initializer from a known object literal. */
function propertyExpressionFromObject(object: ts.ObjectLiteralExpression, property: string): ts.Expression | undefined {
  const assignment = object.properties.find(
    (item): item is ts.PropertyAssignment => ts.isPropertyAssignment(item) && propertyName(item.name) === property,
  )
  return assignment?.initializer
}

/** Resolves one level of local constant indirection for helper expressions. */
function resolveLocalExpression(ctx: ExtractContext, expression: ts.Expression): ts.Expression {
  return ts.isIdentifier(expression) ? (localInitializers(ctx).get(expression.text) ?? expression) : expression
}

/** Returns source-local initializers from the compiler-owned Static Index context. */
function localInitializers(ctx: ExtractContext): ReadonlyMap<string, ts.Expression> {
  return internalStaticCallContext(ctx)?.localInitializers ?? new Map()
}

/** Returns the authored callee name for simple function and property-access calls. */
function expressionName(expression: ts.Expression): string | undefined {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return undefined
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)]
}
