import type { ObservabilityRunDetailNode } from '@/types'
import { definitionRefLinks, type DefinitionRefLink } from './definition-ref-links'

type McpPreparationPhase = 'connect' | 'discover'

/** Secret-safe MCP preparation facts rendered by Run Detail. */
export interface McpPreparationView {
  readonly nodeId: string
  readonly spanId: string
  readonly phase: McpPreparationPhase
  readonly status: string
  readonly startedAt: string
  readonly durationMs: number
  readonly sourceId?: string
  readonly sourceSessionId?: string
  readonly implementation?: string
  readonly transportKind?: string
  readonly protocolVersion?: string
  readonly serverName?: string
  readonly serverVersion?: string
  readonly discoveredToolCount?: number
  readonly exposedToolCount?: number
  readonly toolListFingerprint?: string
  readonly errorCategory?: string
  readonly failurePhase?: string
  readonly server?: DefinitionRefLink
}

/** MCP provenance added to the existing ordinary tool-call presentation. */
export interface McpToolOriginView {
  readonly sourceId?: string
  readonly sourceSessionId?: string
  readonly remoteName?: string
  readonly exposedName?: string
  readonly discoverSpanId?: string
  readonly server?: DefinitionRefLink
  readonly tool?: DefinitionRefLink
}

function stringAttribute(node: ObservabilityRunDetailNode, key: string): string | undefined {
  const value = node.attributes?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberAttribute(node: ObservabilityRunDetailNode, key: string): number | undefined {
  const value = node.attributes?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function linksForNode(
  node: ObservabilityRunDetailNode,
  knownDefinitionIds: ReadonlySet<string> | undefined,
): readonly DefinitionRefLink[] {
  return definitionRefLinks(node.definitionRefs ?? [], knownDefinitionIds)
}

function linkWithRole(links: readonly DefinitionRefLink[], role: string): DefinitionRefLink | undefined {
  return links.find((link) => link.role === role)
}

function preparationFromNode(
  node: ObservabilityRunDetailNode,
  knownDefinitionIds: ReadonlySet<string> | undefined,
): McpPreparationView | undefined {
  if (node.primitive !== 'mcp.connect' && node.primitive !== 'mcp.discover') {
    return undefined
  }

  const links = linksForNode(node, knownDefinitionIds)
  const error = node.error && typeof node.error !== 'string' ? node.error : undefined
  return {
    nodeId: node.id,
    spanId: node.spanId,
    phase: node.primitive === 'mcp.connect' ? 'connect' : 'discover',
    status: node.status,
    startedAt: node.startedAt,
    durationMs: node.durationMs,
    sourceId: stringAttribute(node, 'sourceId'),
    sourceSessionId: stringAttribute(node, 'sourceSessionId'),
    implementation: stringAttribute(node, 'implementation'),
    transportKind: stringAttribute(node, 'transport'),
    protocolVersion: stringAttribute(node, 'protocolVersion'),
    serverName: stringAttribute(node, 'serverName'),
    serverVersion: stringAttribute(node, 'serverVersion'),
    discoveredToolCount: numberAttribute(node, 'discoveredToolCount'),
    exposedToolCount: numberAttribute(node, 'exposedToolCount'),
    toolListFingerprint: stringAttribute(node, 'toolListFingerprint'),
    errorCategory:
      stringAttribute(node, 'errorCategory') ?? (typeof error?.category === 'string' ? error.category : undefined),
    failurePhase: stringAttribute(node, 'failurePhase'),
    server: linkWithRole(links, 'resolved-mcp-server'),
  }
}

/**
 * Collect preparation spans in recorded chronological order.
 *
 * Catalog navigation is projected exclusively from runtime `DefinitionRef`
 * values attached to each span. Display names and attributes are never used
 * to synthesize definition ids.
 */
export function mcpPreparationForRun(
  root: ObservabilityRunDetailNode,
  knownDefinitionIds?: ReadonlySet<string>,
): readonly McpPreparationView[] {
  const views: McpPreparationView[] = []
  const visit = (node: ObservabilityRunDetailNode): void => {
    const view = preparationFromNode(node, knownDefinitionIds)
    if (view) views.push(view)
    for (const child of node.children) visit(child)
  }
  visit(root)
  return views.sort(
    (left, right) => left.startedAt.localeCompare(right.startedAt) || left.spanId.localeCompare(right.spanId),
  )
}

/** Return MCP origin facts for an ordinary `tool.call`, when present. */
export function mcpToolOrigin(
  node: ObservabilityRunDetailNode,
  knownDefinitionIds?: ReadonlySet<string>,
): McpToolOriginView | undefined {
  if (node.primitive !== 'tool.call' || stringAttribute(node, 'sourceKind') !== 'mcp') {
    return undefined
  }

  const links = linksForNode(node, knownDefinitionIds)
  return {
    sourceId: stringAttribute(node, 'sourceId'),
    sourceSessionId: stringAttribute(node, 'sourceSessionId'),
    remoteName: stringAttribute(node, 'remoteName'),
    exposedName: stringAttribute(node, 'exposedName'),
    discoverSpanId: stringAttribute(node, 'discoverSpanId'),
    server: linkWithRole(links, 'resolved-mcp-server'),
    tool: linkWithRole(links, 'invoked-tool'),
  }
}
