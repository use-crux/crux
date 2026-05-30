import { Fragment } from 'react'
import type { JsonSchema } from '@/types'

interface SchemaViewerProps {
  schema: JsonSchema | undefined
  label?: string
}

export function SchemaViewer({ schema, label }: SchemaViewerProps) {
  if (!schema) {
    return <div className="text-(--qw-fg-faint) text-sm italic">{label ? `No ${label} schema` : 'No schema'}</div>
  }

  const properties = schema.properties as Record<string, JsonSchema> | undefined
  const required = (schema.required as string[]) ?? []

  if (!properties) {
    return (
      <div className="text-sm text-(--qw-fg-muted) font-mono bg-(--qw-bg-elev) rounded p-3">{JSON.stringify(schema, null, 2)}</div>
    )
  }

  const hasDescriptions = checkHasDescriptions(properties)

  return (
    <div>
      {label && <h4 className="text-xs font-medium text-(--qw-fg-faint) uppercase tracking-wide mb-2">{label}</h4>}
      <table className="w-full text-sm">
        <thead>
          <tr className="text-(--qw-fg-faint) text-xs uppercase tracking-wide">
            <th className="text-left py-1 pr-4 font-medium">Field</th>
            <th className="text-left py-1 pr-4 font-medium">Type</th>
            <th className="text-left py-1 pr-4 font-medium">Required</th>
            {hasDescriptions && <th className="text-left py-1 font-medium">Description</th>}
          </tr>
        </thead>
        <tbody>
          <PropertyRows properties={properties} required={required} hasDescriptions={hasDescriptions} />
        </tbody>
      </table>
    </div>
  )
}

function PropertyRows({
  properties,
  required,
  hasDescriptions,
  depth = 0,
}: {
  properties: Record<string, JsonSchema>
  required: string[]
  hasDescriptions: boolean
  depth?: number
}) {
  return (
    <>
      {Object.entries(properties).map(([name, prop]) => {
        const nested = getNestedProperties(prop)
        const nestedRequired = ((prop as JsonSchema)?.required as string[]) ?? []

        return (
          <Fragment key={`${depth}-${name}`}>
            <tr className="border-t border-(--qw-border)/50">
              <td
                className="py-1.5 pr-4 font-mono text-(--qw-fg)"
                style={depth > 0 ? { paddingLeft: `${depth * 16}px` } : undefined}
              >
                {depth > 0 && <span className="text-(--qw-fg-faint) mr-1">└</span>}
                {name}
              </td>
              <td className="py-1.5 pr-4 text-(--qw-fg-muted)">{formatType(prop)}</td>
              <td className="py-1.5 pr-4">
                {required.includes(name) ? (
                  <span className="text-amber-400 text-xs">required</span>
                ) : (
                  <span className="text-(--qw-fg-faint) text-xs">optional</span>
                )}
              </td>
              {hasDescriptions && (
                <td className="py-1.5 text-(--qw-fg-faint) text-xs max-w-xs">{(prop as JsonSchema)?.description as string}</td>
              )}
            </tr>
            {nested && (
              <PropertyRows
                properties={nested}
                required={nestedRequired}
                hasDescriptions={hasDescriptions}
                depth={depth + 1}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

function getNestedProperties(prop: JsonSchema): Record<string, JsonSchema> | undefined {
  if ((prop as JsonSchema)?.type === 'object') {
    return (prop as JsonSchema)?.properties as Record<string, JsonSchema> | undefined
  }
  // array of objects — show item properties
  if ((prop as JsonSchema)?.type === 'array' && ((prop as JsonSchema)?.items as JsonSchema)?.type === 'object') {
    return ((prop as JsonSchema)?.items as JsonSchema)?.properties as Record<string, JsonSchema> | undefined
  }
  return undefined
}

function checkHasDescriptions(props: Record<string, JsonSchema>): boolean {
  return Object.values(props).some((prop) => {
    if (typeof (prop as JsonSchema)?.description === 'string') return true
    const nested = getNestedProperties(prop)
    return nested ? checkHasDescriptions(nested) : false
  })
}

function formatType(schema: JsonSchema): string {
  if (!schema) return 'unknown'
  const type = schema.type as string | string[] | undefined
  if (type === 'array') {
    const items = schema.items as JsonSchema | undefined
    return `${formatType(items ?? {})}[]`
  }
  if (type === 'object') return 'object'
  if (Array.isArray(type)) return type.join(' | ')
  if (schema.enum) return (schema.enum as string[]).map((v) => `"${v}"`).join(' | ')
  if (schema.anyOf) return (schema.anyOf as JsonSchema[]).map(formatType).join(' | ')
  return type ?? 'unknown'
}
