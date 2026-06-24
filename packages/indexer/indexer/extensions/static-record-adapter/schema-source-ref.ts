import type { JsonSchema } from '@crux/core/project-index'
import type { ExtractedSourceRef } from '../public-contract/types'
import type { StaticSyntaxValue } from '../../static/syntax-record/types'
import { staticRecordSchemaProperty, staticSyntaxValueToJsonSchema } from '../../static/syntax-record/schema'
import { staticObjectPropertyValue } from '../../static/syntax-record/value'
import type { StaticObjectValue } from '../../static/syntax-record/types'
import {
  createStaticRecordSourceResolver,
  type ResolvedStaticRecordSource,
} from './source-resolver'

/** Projects schema metadata and source refs from a record-backed config property. */
export function schemaPropertySourceRefs(input: {
  readonly object?: StaticObjectValue
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly initializerValues: ReadonlyMap<string, StaticSyntaxValue>
  readonly property: string
  readonly definitionId: string
}): { readonly schema?: JsonSchema; readonly sourceRefs: readonly ExtractedSourceRef[] } {
  if (!input.object) return { sourceRefs: [] }
  const propertyValue = staticObjectPropertyValue(input.object, input.property)
  const resolved = input.resolver.resolveValue(propertyValue)
  const schema =
    staticRecordSchemaProperty(input.object, input.property, input.initializerValues) ??
    (resolved ? staticSyntaxValueToJsonSchema(resolved.value, resolved.initializers) : undefined)
  const sourceRefs = resolved
    ? [
        {
          definitionId: input.definitionId,
          ref: input.resolver.sourceRef({
            definitionId: input.definitionId,
            role: 'schema',
            property: input.property,
            resolved,
            metadata: {
              schemaKind: schemaKind(resolved.value),
              parsedSchema: Boolean(schema),
            },
          }),
        },
        ...nestedSchemaSourceRefs({
          resolver: input.resolver,
          root: resolved,
          property: input.property,
          definitionId: input.definitionId,
          schema,
        }),
      ]
    : []
  return {
    ...(schema ? { schema } : {}),
    sourceRefs,
  }
}

function nestedSchemaSourceRefs(input: {
  readonly resolver: ReturnType<typeof createStaticRecordSourceResolver>
  readonly root: ResolvedStaticRecordSource
  readonly property: string
  readonly definitionId: string
  readonly schema?: JsonSchema
}): readonly ExtractedSourceRef[] {
  if (!input.schema) return []
  const refs: ExtractedSourceRef[] = []
  const seen = new Set<string>([input.root.symbol])
  const visit = (value: StaticSyntaxValue): void => {
    if (value.kind === 'identifier') {
      const resolved = input.resolver.resolveFrom(input.root, value)
      if (resolved && !seen.has(resolved.symbol) && schemaKind(resolved.value)) {
        seen.add(resolved.symbol)
        refs.push({
          definitionId: input.definitionId,
          ref: input.resolver.sourceRef({
            definitionId: input.definitionId,
            role: 'schema',
            property: input.property,
            resolved,
            metadata: {
              schemaKind: schemaKind(resolved.value),
              parsedSchema: Boolean(staticSyntaxValueToJsonSchema(resolved.value, resolved.initializers)),
              nested: true,
            },
          }),
        })
        visit(resolved.value)
      }
      return
    }
    for (const child of childValues(value)) visit(child)
  }
  visit(input.root.value)
  return refs
}

function childValues(value: StaticSyntaxValue): readonly StaticSyntaxValue[] {
  switch (value.kind) {
    case 'array':
      return value.elements
    case 'object':
      return value.properties.flatMap((property) => (property.spread ? [] : [property.value]))
    case 'call':
      return [...(value.receiver ? [value.receiver] : []), ...value.args]
    case 'template':
      return value.expressions
    default:
      return []
  }
}

function schemaKind(value: StaticSyntaxValue): 'zod' | 'convex-validator' | 'json-schema' | undefined {
  if (containsRootNamespace(value, 'z')) return 'zod'
  if (containsRootNamespace(value, 'v')) return 'convex-validator'
  if (value.kind === 'object') return 'json-schema'
  return undefined
}

function containsRootNamespace(value: StaticSyntaxValue, name: 'z' | 'v'): boolean {
  if (value.kind === 'identifier') return value.name === name
  if (value.kind === 'property-access') return value.path[0] === name
  if (value.kind === 'call') {
    return Boolean(
      (value.receiver && containsRootNamespace(value.receiver, name)) ||
        value.args.some((arg) => containsRootNamespace(arg, name)),
    )
  }
  if (value.kind === 'array') return value.elements.some((item) => containsRootNamespace(item, name))
  if (value.kind === 'object') {
    return value.properties.some((property) => !property.spread && containsRootNamespace(property.value, name))
  }
  return false
}
