import type { JsonSchema } from '@/types'
import type { IndexIndex, ViewDef } from './adapt'

export type McpCatalogToolState = 'partial' | 'current' | 'stale' | 'removed'

interface McpCatalogToolSummary {
  readonly id: string
  readonly name: string
  readonly remoteName?: string
  readonly exposedName?: string
  readonly state: McpCatalogToolState
}

export interface McpServerCatalogView {
  readonly kind: 'server'
  readonly serverId: string
  readonly state: 'never-observed' | 'current' | 'failed'
  readonly transport?:
    | { readonly kind: 'stdio'; readonly executable?: string }
    | {
        readonly kind: 'streamable-http'
        readonly origin?: string
        readonly pathname?: string
      }
    | { readonly kind: 'resolver' }
  readonly selection?: {
    readonly allow?: readonly string[]
    readonly deny?: readonly string[]
    readonly prefix?: string
  }
  readonly observedAt?: string
  readonly revision?: string
  readonly failure?: { readonly phase: string; readonly category: string }
  readonly lastSuccessfulDiscovery?: {
    readonly observedAt: string
    readonly implementation: 'official-client' | 'ai-sdk-native'
    readonly protocolVersion?: string
    readonly server?: {
      readonly untrusted: true
      readonly name?: string
      readonly version?: string
    }
  }
  readonly tools: readonly McpCatalogToolSummary[]
}

export interface McpToolCatalogView {
  readonly kind: 'tool'
  readonly serverDefinitionId?: string
  readonly serverId: string
  readonly remoteName: string
  readonly exposedName: string
  readonly provenance: 'authored-expected' | 'runtime-discovered'
  readonly state: McpCatalogToolState
  readonly observedAt?: string
  readonly toolListFingerprint?: string
  readonly inputSchemaFingerprint?: string
  readonly outputSchemaFingerprint?: string
  readonly inputSchema?: JsonSchema
  readonly outputSchema?: JsonSchema
  readonly annotations?: {
    readonly untrusted: true
    readonly value: Readonly<Record<string, unknown>>
  }
}

export type McpCatalogView = McpServerCatalogView | McpToolCatalogView

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : undefined
}

function toolState(definition: ViewDef): McpCatalogToolState {
  if (definition.status === 'removed') return 'removed'
  if (definition.status === 'stale') return 'stale'
  return definition.facts?.mcp?.provenance === 'runtime-discovered' && definition.status === 'active'
    ? 'current'
    : 'partial'
}

function safeTransport(value: unknown): McpServerCatalogView['transport'] {
  const transport = record(value)
  switch (text(transport?.kind)) {
    case 'stdio':
      return { kind: 'stdio', executable: text(transport?.executable) }
    case 'streamable-http':
      return {
        kind: 'streamable-http',
        origin: text(transport?.origin),
        pathname: text(transport?.pathname),
      }
    case 'resolver':
      return { kind: 'resolver' }
    default:
      return undefined
  }
}

function serverView(definition: ViewDef, index: IndexIndex): McpServerCatalogView | undefined {
  const metadata = definition.raw.metadata as Record<string, unknown> | undefined
  const facts = record(metadata?.facts)
  const serverId = text(facts?.serverId)
  if (!serverId) return undefined

  const transport = safeTransport(facts?.transport)

  const rawSelection = record(facts?.tools)
  const allow = stringList(rawSelection?.allow)
  const deny = stringList(rawSelection?.deny)
  const prefix = text(rawSelection?.prefix)
  const selection = allow || deny || prefix ? { allow, deny, prefix } : undefined
  const runtime = record(metadata?.runtimeOverlay)
  const runtimeStatus = text(runtime?.status)
  const rawFailure = record(runtime?.error)
  const phase = text(rawFailure?.phase)
  const category = text(rawFailure?.category)
  const rawSuccess = record(runtime?.lastSuccessfulDiscovery)
  const successObservedAt = text(rawSuccess?.observedAt)
  const implementation = text(rawSuccess?.implementation)
  const supportedImplementation =
    implementation === 'official-client' || implementation === 'ai-sdk-native' ? implementation : undefined
  const rawServer = record(rawSuccess?.server)
  const serverName = text(rawServer?.name)
  const serverVersion = text(rawServer?.version)
  const lastSuccessfulDiscovery: McpServerCatalogView['lastSuccessfulDiscovery'] =
    successObservedAt && supportedImplementation
      ? {
          observedAt: successObservedAt,
          implementation: supportedImplementation,
          protocolVersion: text(rawSuccess?.protocolVersion),
          server:
            rawServer?.untrusted === true && (serverName || serverVersion)
              ? {
                  untrusted: true as const,
                  name: serverName,
                  version: serverVersion,
                }
              : undefined,
        }
      : undefined

  const tools = index
    .relationsOf(definition.id)
    .outgoing.filter((relation) => relation.type === 'mcp.server.provides_tool')
    .map((relation) => index.byId(relation.to))
    .filter((tool): tool is ViewDef => tool?.kind === 'tool')
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      remoteName: tool.facts?.mcp?.remoteName,
      exposedName: tool.facts?.mcp?.exposedName,
      state: toolState(tool),
    }))

  return {
    kind: 'server',
    serverId,
    state: runtimeStatus === 'error' ? 'failed' : runtimeStatus === 'ok' ? 'current' : 'never-observed',
    transport,
    selection,
    observedAt: text(runtime?.observedAt),
    revision: text(runtime?.revision),
    failure: phase && category ? { phase, category } : undefined,
    lastSuccessfulDiscovery,
    tools,
  }
}

function toolView(definition: ViewDef, index: IndexIndex): McpToolCatalogView | undefined {
  const origin = definition.facts?.mcp
  if (!origin) return undefined
  const metadata = definition.raw.metadata as Record<string, unknown> | undefined
  const discovery = record(metadata?.mcpDiscovery)
  const annotations = record(discovery?.annotations)
  const annotationValue = record(annotations?.value)
  const owner = index
    .relationsOf(definition.id)
    .incoming.find(
      (relation) => relation.type === 'mcp.server.provides_tool' && index.byId(relation.from)?.kind === 'mcp.server',
    )

  return {
    kind: 'tool',
    serverDefinitionId: owner?.from,
    ...origin,
    state: toolState(definition),
    observedAt: text(discovery?.observedAt),
    toolListFingerprint: text(discovery?.toolListFingerprint),
    inputSchemaFingerprint: text(discovery?.inputSchemaFingerprint),
    outputSchemaFingerprint: text(discovery?.outputSchemaFingerprint),
    inputSchema: record(metadata?.inputSchema) as JsonSchema | undefined,
    outputSchema: record(metadata?.outputSchema) as JsonSchema | undefined,
    annotations:
      annotations?.untrusted === true && annotationValue ? { untrusted: true, value: annotationValue } : undefined,
  }
}

/** Build the MCP-specific Catalog projection without inventing graph joins. */
export function mcpCatalogView(definition: ViewDef, index: IndexIndex): McpCatalogView | undefined {
  if (definition.kind === 'mcp.server') return serverView(definition, index)
  if (definition.kind === 'tool') return toolView(definition, index)
  return undefined
}
