import type { IndexedStorageCapabilities } from '@/types'
import type { IndexIndex, ViewDef } from './adapt'

export type StorageDefinitionKind =
  | 'storage.recordStore'
  | 'storage.vectorStore'
  | 'storage.blobStore'
  | 'storage.bundle'
  | 'storage.scope'

const STORAGE_KINDS = new Set<string>([
  'storage.recordStore',
  'storage.vectorStore',
  'storage.blobStore',
  'storage.bundle',
  'storage.scope',
])

const COMPONENT_KEYS = ['recordStoreId', 'vectorStoreId', 'blobStoreId', 'storageId'] as const

export type StorageComponentKey = (typeof COMPONENT_KEYS)[number]

/** Definition ids for the stores/components that compose a storage entry. */
export type StorageComponentSummary = Partial<Record<StorageComponentKey, string>>

/** One authored/runtime definition that depends on a storage entry. */
export interface StorageUsageSummary {
  definitionId: string
  kind?: string
  name?: string
  relationType: string
}

export type StorageWarningSeverity = 'info' | 'warning' | 'error'

/** Privacy-safe storage diagnostic shown in Devtools. */
export interface StorageWarningSummary {
  code: string
  severity: StorageWarningSeverity
  message: string
  primaryDefinitionId?: string
  relatedDefinitionIds?: string[]
}

/** Aggregated runtime counters for the storage overlay. */
export interface StorageRuntimeSummary {
  operationCount?: number
  errorCount?: number
  avgLatencyMs?: number
  resultCount?: number
  bytes?: number
}

/** Privacy-safe read-model summary attached by the local Project Index backend. */
export interface StorageReadModelSummary {
  kind: StorageDefinitionKind
  backend?: string
  variableName?: string
  prefix?: string
  components: StorageComponentSummary
  capabilities?: IndexedStorageCapabilities
  usedBy: StorageUsageSummary[]
  warnings: StorageWarningSummary[]
  runtime?: StorageRuntimeSummary
}

/** Storage inventory row used by the storage section and tests. */
export interface StorageInventoryItem extends StorageReadModelSummary {
  id: string
  name: string
  file?: string
  line?: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out = value.filter((item): item is string => typeof item === 'string' && item.length > 0)
  return out.length > 0 ? out : undefined
}

function storageKind(value: unknown): StorageDefinitionKind | undefined {
  return typeof value === 'string' && STORAGE_KINDS.has(value) ? (value as StorageDefinitionKind) : undefined
}

function metadataStorage(def: ViewDef): Record<string, unknown> | undefined {
  const metadata = def.raw.metadata
  if (!metadata) return undefined
  const raw = (metadata as Record<string, unknown>).storage
  return isRecord(raw) ? raw : undefined
}

function storageComponents(raw: unknown): StorageComponentSummary {
  if (!isRecord(raw)) return {}
  const components: StorageComponentSummary = {}
  for (const key of COMPONENT_KEYS) {
    const value = stringValue(raw[key])
    if (value) components[key] = value
  }
  return components
}

function storageWarnings(raw: unknown): StorageWarningSummary[] {
  if (!Array.isArray(raw)) return []
  const warnings: StorageWarningSummary[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const code = stringValue(item.code)
    const message = stringValue(item.message)
    if (!code || !message) continue
    const severity = item.severity === 'error' || item.severity === 'warning' ? item.severity : 'info'
    warnings.push({
      code,
      severity,
      message,
      primaryDefinitionId: stringValue(item.primaryDefinitionId),
      relatedDefinitionIds: stringArrayValue(item.relatedDefinitionIds),
    })
  }
  return warnings
}

function storageUsedBy(raw: unknown): StorageUsageSummary[] {
  if (!Array.isArray(raw)) return []
  const usedBy: StorageUsageSummary[] = []
  for (const item of raw) {
    if (!isRecord(item)) continue
    const definitionId = stringValue(item.definitionId)
    const relationType = stringValue(item.relationType)
    if (!definitionId || !relationType) continue
    usedBy.push({
      definitionId,
      relationType,
      kind: stringValue(item.kind),
      name: stringValue(item.name),
    })
  }
  return usedBy
}

function storageRuntime(raw: unknown): StorageRuntimeSummary | undefined {
  if (!isRecord(raw)) return undefined
  const runtime: StorageRuntimeSummary = {
    operationCount: numberValue(raw.operationCount),
    errorCount: numberValue(raw.errorCount),
    avgLatencyMs: numberValue(raw.avgLatencyMs),
    resultCount: numberValue(raw.resultCount),
    bytes: numberValue(raw.bytes),
  }
  return Object.values(runtime).some((value) => value != null) ? runtime : undefined
}

function storageCapabilities(raw: unknown): IndexedStorageCapabilities | undefined {
  if (!isRecord(raw)) return undefined
  const capabilities = raw as IndexedStorageCapabilities
  return capabilities.record || capabilities.vector || capabilities.blob ? capabilities : undefined
}

/** Returns true when a view definition represents a first-class Storage Beta definition. */
export function isStorageDef(def: ViewDef | undefined): def is ViewDef & { kind: StorageDefinitionKind } {
  return Boolean(def && STORAGE_KINDS.has(def.kind))
}

/**
 * Builds the privacy-safe storage summary for one definition.
 *
 * The backend-owned `metadata.storage` summary wins when present. Older or
 * partial snapshots fall back to semantic facts, so the UI can render beta
 * indexes created before the local read-model enrichment existed.
 */
export function storageSummaryForDef(def: ViewDef): StorageReadModelSummary | undefined {
  const kind = storageKind(def.kind)
  if (!kind) return undefined

  const storage = metadataStorage(def)
  const facts = def.facts
  return {
    kind: storageKind(storage?.kind) ?? kind,
    backend: stringValue(storage?.backend) ?? facts?.backend,
    variableName: stringValue(storage?.variableName) ?? facts?.variableName,
    prefix: stringValue(storage?.prefix) ?? facts?.prefix,
    components: storageComponents(storage?.components),
    capabilities: storageCapabilities(storage?.capabilities) ?? facts?.capabilities,
    usedBy: storageUsedBy(storage?.usedBy),
    warnings: storageWarnings(storage?.warnings),
    runtime: storageRuntime(storage?.runtime),
  }
}

/** Returns storage warnings for one definition, or an empty array when none were emitted. */
export function storageWarningsForDef(def: ViewDef): StorageWarningSummary[] {
  return storageSummaryForDef(def)?.warnings ?? []
}

/** Builds a stable storage inventory in Project Index definition order. */
export function storageInventoryForIndex(index: Pick<IndexIndex, 'defs'>): StorageInventoryItem[] {
  return index.defs.flatMap((def) => {
    const summary = storageSummaryForDef(def)
    return summary ? [{ ...summary, id: def.id, name: def.name, file: def.file, line: def.line }] : []
  })
}
