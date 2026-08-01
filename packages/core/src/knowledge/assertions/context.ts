/**
 * Context rendering for assertion handles.
 *
 * @module
 */

import type { AssertionResolutionResult } from './resolution'

/** Options for assertion context rendering. */
export interface AssertionContextOptions {
  /** Context priority used by prompt token budgeting. */
  readonly priority?: number
  /** Maximum assertion items rendered into the context. */
  readonly limit?: number
  /** Maximum characters rendered for one assertion item line. */
  readonly itemCharLimit?: number
}

/** Render metadata for an assertion set context. Internal. */
export interface AssertionSetContextMeta {
  readonly stageId: string
  readonly generationId: string
  readonly selectedTypes: readonly string[]
  readonly revisionHash?: string
  readonly omitted: number
}

/** Render metadata for a resolution context. Internal. */
export interface AssertionResolutionContextMeta {
  readonly stageId: string
  readonly generationId?: string
  readonly revisionHash?: string
}

const DEFAULT_LIMIT = 50
const DEFAULT_ITEM_CHAR_LIMIT = 240

type RenderableAssertion = {
  readonly assertionId: string
  readonly type: string
  readonly data: unknown
  readonly evidence: ReadonlyArray<{ readonly sourceId: string }>
}

/** Normalize assertion context options. Internal. */
export function normalizeAssertionContextOptions(options: AssertionContextOptions | undefined): Required<AssertionContextOptions> {
  return {
    priority: clampInteger(options?.priority ?? 50, 0, 100),
    limit: clampInteger(options?.limit ?? DEFAULT_LIMIT, 0, Number.MAX_SAFE_INTEGER),
    itemCharLimit: clampInteger(options?.itemCharLimit ?? DEFAULT_ITEM_CHAR_LIMIT, 24, Number.MAX_SAFE_INTEGER),
  }
}

/** Render a bounded assertion set context. Internal. */
export function renderAssertionSetContext<TItem extends RenderableAssertion>(
  items: readonly TItem[],
  meta: AssertionSetContextMeta,
  options: Required<AssertionContextOptions>,
): string {
  const lines = [
    `## Assertions: ${meta.stageId}`,
    `Generation: ${meta.generationId || 'none'}`,
    ...(meta.revisionHash ? [`View revision: ${meta.revisionHash}`] : []),
    `Types: ${meta.selectedTypes.length ? [...meta.selectedTypes].sort().join(', ') : 'all'}`,
  ]
  const byType = groupByType(items)
  for (const type of [...byType.keys()].sort()) {
    const typeItems = byType.get(type) ?? []
    lines.push(`- ${type} (${typeItems.length} shown)`)
    for (const item of typeItems) {
      lines.push(`  - ${truncate(renderAssertionLine(item), options.itemCharLimit)}`)
    }
  }
  if (meta.omitted > 0) lines.push(`${meta.omitted} more not shown`)
  return lines.join('\n')
}

/** Render a bounded assertion resolution context. Internal. */
export function renderAssertionResolutionContext<TItem extends RenderableAssertion>(
  result: AssertionResolutionResult<TItem>,
  meta: AssertionResolutionContextMeta,
  options: Required<AssertionContextOptions>,
): string {
  const selected = result.selected.slice(0, options.limit)
  const omitted = Math.max(0, result.selected.length - selected.length)
  const lines = [
    `## Assertion Resolution: ${meta.stageId}`,
    ...(meta.generationId ? [`Generation: ${meta.generationId}`] : []),
    ...(meta.revisionHash ? [`View revision: ${meta.revisionHash}`] : []),
    `Selected: ${result.selected.length}; superseded: ${result.superseded.length}; contested: ${result.contested.length}; unresolved: ${result.unresolved.length}`,
    '- selected',
    ...selected.map((item) => `  - ${truncate(renderAssertionLine(item), options.itemCharLimit)}`),
  ]
  if (omitted > 0) lines.push(`${omitted} more not shown`)
  return lines.join('\n')
}

function groupByType<TItem extends { readonly type: string }>(items: readonly TItem[]): Map<string, TItem[]> {
  const grouped = new Map<string, TItem[]>()
  for (const item of items) grouped.set(item.type, [...(grouped.get(item.type) ?? []), item])
  return grouped
}

function renderAssertionLine(item: {
  readonly assertionId: string
  readonly data: unknown
  readonly evidence: ReadonlyArray<{ readonly sourceId: string }>
}): string {
  const fields = renderDataFields(item.data)
  const sourceCount = new Set(item.evidence.map((support) => support.sourceId)).size
  return `${item.assertionId}: ${fields}; sources=${sourceCount}`
}

function renderDataFields(data: unknown): string {
  if (!isRecord(data)) return `value=${stableValue(data)}`
  const fields = Object.keys(data).sort().map((key) => `${key}=${stableValue(data[key])}`)
  return fields.length ? fields.join('; ') : 'no data fields'
}

function stableValue(value: unknown): string {
  if (isRecord(value)) {
    const fields = Object.keys(value).sort().map((key) => `"${key}":${stableValue(value[key])}`)
    return `{${fields.join(',')}}`
  }
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`
  return JSON.stringify(value)
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 16))}... [truncated]`
}

function clampInteger(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(value)))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
