import type { ObservabilityRunDetailNode } from '@/types'
import { findArtifact, findAttribute, inspectionOf } from './span-detail-inspection'

export interface RetrievalEntries {
  query?: string
  hits: Array<Record<string, unknown>>
  stages: Array<Record<string, unknown>>
}

export function retrievalEntries(node: ObservabilityRunDetailNode): RetrievalEntries {
  const query =
    (findAttribute(node, 'query') as string | undefined) ?? (findAttribute(node, 'kind') as string | undefined)

  const insp = inspectionOf(node)
  if (insp?.retrieval && insp.retrieval.length > 0) {
    const hits: Array<Record<string, unknown>> = []
    for (const item of insp.retrieval) {
      const data = item.data
      if (data == null) continue
      if (Array.isArray(data)) {
        hits.push(...(data as Array<Record<string, unknown>>))
      } else if (typeof data === 'object') {
        const obj = data as { hits?: unknown }
        if (Array.isArray(obj.hits)) hits.push(...(obj.hits as Array<Record<string, unknown>>))
        else hits.push(data as Record<string, unknown>)
      }
    }
    const stagesAttr = findAttribute(node, 'stages')
    const stages = Array.isArray(stagesAttr) ? (stagesAttr as Array<Record<string, unknown>>) : []
    return { query, hits, stages }
  }

  const hitsArt = findArtifact(node, 'retrieval.hits')?.preview
  const hits = Array.isArray(hitsArt)
    ? (hitsArt as Array<Record<string, unknown>>)
    : Array.isArray((hitsArt as { hits?: unknown })?.hits)
      ? (hitsArt as { hits: Array<Record<string, unknown>> }).hits
      : Array.isArray(findAttribute(node, 'hits'))
        ? (findAttribute(node, 'hits') as Array<Record<string, unknown>>)
        : []
  const stagesAttr = findAttribute(node, 'stages')
  const stages = Array.isArray(stagesAttr) ? (stagesAttr as Array<Record<string, unknown>>) : []
  return { query, hits, stages }
}
