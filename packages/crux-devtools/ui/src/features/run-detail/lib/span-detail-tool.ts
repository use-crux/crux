import type { ObservabilityRunDetailNode } from '@/types'
import { findArtifact, inspectionOf } from './span-detail-inspection'

export interface ResolvedToolPayload {
  args?: unknown
  result?: unknown
  argsOwner?: ObservabilityRunDetailNode
  resultOwner?: ObservabilityRunDetailNode
  inputSize?: number
  outputSize?: number
  fromAgent?: string
  toAgent?: string
  handoffId?: string
  delegateId?: string
  summary?: string
}

export interface ToolRequestEntry {
  toolName?: string
  toolCallId?: string
  args?: unknown
  owner: ObservabilityRunDetailNode
}

export function collectToolRequests(scope: ObservabilityRunDetailNode): ToolRequestEntry[] {
  const out: ToolRequestEntry[] = []

  function add(owner: ObservabilityRunDetailNode, preview: unknown) {
    const p = preview as { toolName?: string; toolCallId?: string; args?: unknown; input?: unknown }
    out.push({
      toolName: p.toolName,
      toolCallId: p.toolCallId,
      args: p.args ?? p.input,
      owner,
    })
  }

  function walk(node: ObservabilityRunDetailNode) {
    for (const artifact of node.artifacts ?? []) {
      if (artifact.kind === 'tool.request' && artifact.preview != null) {
        add(node, artifact.preview)
      }
    }
    for (const detail of node.details ?? []) {
      for (const artifact of detail.artifacts ?? []) {
        if (artifact.kind === 'tool.request' && artifact.preview != null) {
          add(node, artifact.preview)
        }
      }
    }
    for (const child of node.children ?? []) walk(child)
  }

  walk(scope)
  return out
}

export function resolveToolPayload(node: ObservabilityRunDetailNode | undefined): ResolvedToolPayload {
  const out: ResolvedToolPayload = {}
  if (!node) return out

  const insp = inspectionOf(node)
  if (insp?.tools && insp.tools.length > 0) {
    for (const item of insp.tools) {
      if (!item.data) continue
      if (item.kind === 'tool.args' && out.args === undefined) {
        out.args = item.data
        out.argsOwner = node
      } else if (item.kind === 'tool.result' && out.result === undefined) {
        out.result = item.data
        out.resultOwner = node
      } else if (item.kind === 'tool.request') {
        const d = item.data as { toolName?: string; toolCallId?: string; args?: unknown }
        if (out.args === undefined && d.args !== undefined) {
          out.args = d.args
          out.argsOwner = node
        }
      }
    }
  }

  if (out.args === undefined) {
    const direct = findArtifact(node, 'tool.args')
    if (direct?.preview !== undefined) {
      out.args = direct.preview
      out.argsOwner = node
    }
  }
  if (out.result === undefined) {
    const directResult = findArtifact(node, 'tool.result')
    if (directResult?.preview !== undefined) {
      out.result = directResult.preview
      out.resultOwner = node
    }
  }

  function walk(n: ObservabilityRunDetailNode) {
    if (n.primitive === 'delegate.invoke') {
      const attrs = n.attributes as Record<string, unknown> | null | undefined
      if (typeof attrs?.delegateId === 'string') out.delegateId ??= attrs.delegateId as string
      if (typeof attrs?.handoffId === 'string') out.handoffId ??= attrs.handoffId as string
      if (typeof attrs?.inputSize === 'number') out.inputSize ??= attrs.inputSize as number
      const input = findArtifact(n, 'input')?.preview ?? findArtifact(n, 'handoff.payload')?.preview
      if (out.args === undefined && input !== undefined) {
        out.args = input
        out.argsOwner = n
      }
    }
    if (n.primitive === 'handoff.prepare') {
      const attrs = n.attributes as Record<string, unknown> | null | undefined
      if (typeof attrs?.fromAgent === 'string') out.fromAgent ??= attrs.fromAgent as string
      if (typeof attrs?.toAgent === 'string') out.toAgent ??= attrs.toAgent as string
      if (typeof attrs?.handoffId === 'string') out.handoffId ??= attrs.handoffId as string
      if (typeof attrs?.outputSize === 'number') out.outputSize ??= attrs.outputSize as number
      const payload = findArtifact(n, 'handoff.payload')?.preview
      if (payload != null) {
        const data =
          typeof payload === 'object' && payload != null && 'data' in (payload as Record<string, unknown>)
            ? (payload as { data: unknown }).data
            : payload
        if (out.result === undefined) {
          out.result = data
          out.resultOwner = n
        }
        const summary =
          typeof payload === 'object' && payload != null && 'data' in (payload as Record<string, unknown>)
            ? ((payload as { data?: { summary?: unknown } }).data?.summary as string | undefined)
            : undefined
        if (typeof summary === 'string' && !out.summary) out.summary = summary
      }
    }
    for (const c of n.children ?? []) walk(c)
  }
  walk(node)
  return out
}
