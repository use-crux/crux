import { projectRelation } from '../../../../relations'
import type { InjectionToolFacts, InjectionUseFacts } from '@use-crux/core/project-index'
import {
  isArrayLiteralExpression,
  isIdentifier,
  isObjectLiteralExpression,
  isPropertyAssignment,
  isShorthandPropertyAssignment,
  isStringLiteral,
  type Expression,
  type ObjectLiteralExpression,
  type PropertyAssignment,
  type PropertyName,
} from '@typescript/native-preview/unstable/ast'
import { nativeNodeList, nativeSourceForNode, nativeSourceSnippetForNode } from '../source'
import type {
  NativeDirectArrayDependencySpec,
  NativeDirectDependencySpec,
  NativeDirectDependencyFactSpec,
  NativeDirectDefinitionKind,
  NativeDirectIdentifierDependencySpec,
  NativeDirectMcpExpectedToolsDependencySpec,
  NativeDirectObjectDependencySpec,
  NativeDirectRelationOriginSpec,
} from './manifest'
import { safeId } from '../../../../definitions'
import { staticIdArrayEntries, type StaticIdArrayDependencyEntry } from './static-id-dependencies'
import type { NativeDefinition, NativeDependencyEvidence, RelationFact, SourceRefFact } from './types'

type ArrayDependencyEntry = {
  readonly kind: 'arrayIdentifier'
  readonly spec: NativeDirectArrayDependencySpec
  readonly variable: string
  readonly target: NativeDefinition
  readonly fact: InjectionUseFacts
  readonly relation: RelationFact
}

type ObjectDependencyEntry = {
  readonly kind: 'objectShorthand'
  readonly spec: NativeDirectObjectDependencySpec
  readonly variable: string
  readonly target: NativeDefinition
  readonly relation: RelationFact
}

type IdentifierDependencyEntry = {
  readonly kind: 'identifierProperty'
  readonly spec: NativeDirectIdentifierDependencySpec
  readonly variable: string
  readonly target: NativeDefinition
  readonly relation: RelationFact
}

type McpExpectedToolEntry = {
  readonly kind: 'mcpExpectedTools'
  readonly spec: NativeDirectMcpExpectedToolsDependencySpec
  readonly relation: RelationFact
}

type DependencyEntry =
  | IdentifierDependencyEntry
  | ArrayDependencyEntry
  | ObjectDependencyEntry
  | StaticIdArrayDependencyEntry
  | McpExpectedToolEntry

/**
 * Emits direct dependency evidence from manifest-declared local reference shapes.
 *
 * Unsupported shapes return `undefined`; the native backend then falls back to
 * the complete shared semantic analyzer rather than mixing partial facts.
 */
export function dependencyEvidenceForDefinition(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
): NativeDependencyEvidence | undefined {
  const entryGroups = definition.primitive.dependencies.map((spec) => dependencyEntries(definition, definitions, spec))
  const resolvedEntryGroups = presentValues(entryGroups)
  if (!resolvedEntryGroups) return undefined

  const entries = resolvedEntryGroups.flat()
  const facts = dependencyFacts(definition, entries)
  return {
    ...(Object.keys(facts).length > 0 ? { facts } : {}),
    relations: entries.map((entry) => entry.relation),
    sourceRefs: entries.flatMap((entry) =>
      entry.kind === 'objectShorthand' ? [objectDependencySourceRef(definition, entry)] : [],
    ),
  }
}

function dependencyEntries(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  spec: NativeDirectDependencySpec,
): readonly DependencyEntry[] | undefined {
  if (spec.kind === 'identifierProperty') {
    return identifierPropertyEntries(definition, definitions, spec)
  }
  if (spec.kind === 'arrayIdentifier') {
    return arrayIdentifierEntries(definition, definitions, spec)
  }
  if (spec.kind === 'staticIdArray') {
    return staticIdArrayEntries(definition, spec)
  }
  if (spec.kind === 'mcpExpectedTools') {
    return mcpExpectedToolEntries(definition, spec)
  }
  return objectShorthandEntries(definition, definitions, spec)
}

function mcpExpectedToolEntries(
  definition: NativeDefinition,
  spec: NativeDirectMcpExpectedToolsDependencySpec,
): readonly McpExpectedToolEntry[] | undefined {
  const tools = propertyInitializer(definition.object, spec.property)
  if (!tools) return []
  if (!isObjectLiteralExpression(tools)) return undefined
  const allow = propertyInitializer(tools, 'allow')
  if (!allow) return []
  if (!isArrayLiteralExpression(allow)) return undefined
  const prefixExpression = propertyInitializer(tools, 'prefix')
  if (prefixExpression && !isStringLiteral(prefixExpression)) return undefined
  const prefix = prefixExpression?.text ?? ''
  return presentValues(
    nativeNodeList(allow.elements).map((element) => {
      if (!isStringLiteral(element)) return undefined
      return {
        kind: 'mcpExpectedTools' as const,
        spec,
        relation: projectRelation({
          type: spec.relationType,
          from: definition.id,
          to: `tool:${safeId(`${prefix}${element.text}`)}`,
          fidelity: 'resolved',
          source: nativeSourceForNode(definition.variable.file, definition.object),
        }),
      }
    }),
  )
}

function identifierPropertyEntries(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  spec: NativeDirectIdentifierDependencySpec,
): readonly IdentifierDependencyEntry[] | undefined {
  const expression = propertyInitializer(definition.object, spec.property)
  if (!expression) return []
  if (!isIdentifier(expression)) return undefined
  const target = definitions.get(expression.text)
  if (!target) return undefined
  return identifierTargetKinds(spec).includes(target.kind)
    ? [
        {
          kind: 'identifierProperty',
          spec,
          variable: expression.text,
          target,
          relation: projectRelation({
            type: spec.relationType,
            from: relationOriginId(definition, spec.relationOrigin, 0),
            to: target.id,
            fidelity: 'resolved',
            source: nativeSourceForNode(definition.variable.file, definition.object),
          }),
        },
      ]
    : []
}

function arrayIdentifierEntries(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  spec: NativeDirectArrayDependencySpec,
): readonly ArrayDependencyEntry[] | undefined {
  const expression = propertyInitializer(definition.object, spec.property)
  if (!expression) return []
  if (!isArrayLiteralExpression(expression)) return undefined
  const entries: ArrayDependencyEntry[] = []
  for (const [index, element] of nativeNodeList(expression.elements).entries()) {
    if (!isIdentifier(element)) return undefined
    const target = definitions.get(element.text)
    if (!target) return undefined
    if (target.kind !== spec.targetKind) continue
    entries.push(useEntry(definition, spec, element.text, target, index))
  }
  return entries
}

function objectShorthandEntries(
  definition: NativeDefinition,
  definitions: ReadonlyMap<string, NativeDefinition>,
  spec: NativeDirectObjectDependencySpec,
): readonly ObjectDependencyEntry[] | undefined {
  const expression = propertyInitializer(definition.object, spec.property)
  if (!expression) return []
  if (!isObjectLiteralExpression(expression)) return undefined
  return presentValues(
    nativeNodeList(expression.properties).map((property, index) => {
      if (!isShorthandPropertyAssignment(property) || !isIdentifier(property.name)) return undefined
      const target = definitions.get(property.name.text)
      return target?.kind === spec.targetKind
        ? {
            kind: 'objectShorthand',
            spec,
            variable: property.name.text,
            target,
            relation: projectRelation({
              type: spec.relationType,
              from: relationOriginId(definition, spec.relationOrigin, index),
              to: target.id,
              fidelity: 'resolved',
              source: nativeSourceForNode(definition.variable.file, definition.object),
            }),
          }
        : undefined
    }),
  )
}

function useEntry(
  definition: NativeDefinition,
  spec: NativeDirectArrayDependencySpec,
  variable: string,
  target: NativeDefinition,
  index: number,
): ArrayDependencyEntry {
  return {
    kind: 'arrayIdentifier',
    spec,
    variable,
    target,
    fact: {
      variable,
      relationHint: spec.fact.relationHint,
      targetDefinitionId: target.id,
      targetKind: target.kind,
      targetName: target.name,
      relationType: spec.relationType,
      relationFidelity: 'resolved',
      conditionality: spec.fact.conditionality,
      via: spec.fact.via,
    },
    relation: projectRelation({
      type: spec.relationType,
      from: relationOriginId(definition, spec.relationOrigin, index),
      to: target.id,
      fidelity: 'resolved',
      source: nativeSourceForNode(definition.variable.file, definition.object),
    }),
  }
}

function dependencyFacts(
  definition: NativeDefinition,
  entries: readonly DependencyEntry[],
): NonNullable<NativeDependencyEvidence['facts']> {
  const facts: Record<string, unknown> = {}
  for (const spec of definition.primitive.dependencies) {
    if (!('fact' in spec) || !spec.fact) continue
    if (!propertyInitializer(definition.object, spec.property)) continue
    const specEntries = entries.filter((entry) => entry.spec === spec)
    if (spec.fact.kind === 'injectionUseEntries') {
      const value = specEntries.flatMap((entry) => (entry.kind === 'arrayIdentifier' ? [entry.fact] : []))
      const existing = facts[spec.fact.metadataKey]
      facts[spec.fact.metadataKey] = Array.isArray(existing) ? [...existing, ...value] : value
      continue
    }
    const value = dependencyFactValue(spec.fact, specEntries)
    if (value === undefined) continue
    const existing = facts[spec.fact.metadataKey]
    facts[spec.fact.metadataKey] = existing ?? value
  }
  if (Object.keys(facts).length > 0) facts.kind = definition.kind
  return facts as NonNullable<NativeDependencyEvidence['facts']>
}

function dependencyFactValue(
  spec: NativeDirectDependencyFactSpec,
  entries: readonly DependencyEntry[],
): readonly InjectionUseFacts[] | InjectionToolFacts | undefined {
  if (spec.kind === 'injectionUseEntries') {
    return entries.flatMap((entry) => (entry.kind === 'arrayIdentifier' ? [entry.fact] : []))
  }
  const toolEntries = entries.filter((entry): entry is ObjectDependencyEntry => entry.kind === 'objectShorthand')
  return {
    hasTools: toolEntries.length > 0,
    names: toolEntries.map((entry) => entry.variable),
    variables: toolEntries.map((entry) => entry.target.name),
  }
}

function identifierTargetKinds(spec: NativeDirectIdentifierDependencySpec): readonly NativeDirectDefinitionKind[] {
  return spec.targetKinds ?? (spec.targetKind ? [spec.targetKind] : [])
}

function relationOriginId(definition: NativeDefinition, origin: NativeDirectRelationOriginSpec, index: number): string {
  return origin.kind === 'owner' ? definition.id : `${definition.id}:${origin.segment}:${index + 1}`
}

function objectDependencySourceRef(definition: NativeDefinition, entry: ObjectDependencyEntry): SourceRefFact {
  return {
    definitionId: definition.id,
    ref: {
      id: `${definition.id}:source:config:${entry.spec.property}:${entry.variable}`,
      role: entry.spec.sourceRef.role,
      property: entry.spec.sourceRef.property,
      symbol: entry.variable,
      source: nativeSourceForNode(entry.target.variable.file, entry.target.variable.declaration),
      snippet: nativeSourceSnippetForNode(entry.target.variable.file, entry.target.variable.declaration),
      fidelity: 'resolved',
      metadata: entry.spec.sourceRef.metadata,
    },
  }
}

function propertyInitializer(object: ObjectLiteralExpression, name: string): Expression | undefined {
  const property = nativeNodeList(object.properties).find(
    (candidate): candidate is PropertyAssignment =>
      isPropertyAssignment(candidate) && propertyName(candidate.name) === name,
  )
  return property?.initializer
}

function propertyName(name: PropertyName): string | undefined {
  if (isIdentifier(name) || isStringLiteral(name)) return name.text
  return undefined
}

function presentValues<TValue>(values: readonly (TValue | undefined)[]): readonly TValue[] | undefined {
  return values.every((value): value is TValue => value !== undefined) ? values : undefined
}
