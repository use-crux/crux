/**
 * Runtime inspectable resource registry.
 *
 * Primitives register the resources they own when they are defined. Devtools
 * can then ask the live runtime to inspect `memory:project` or
 * `blackboard:thread` without users separately wiring record stores into the bridge.
 *
 * @module
 */

import type { JsonObject, RecordListOptions, RecordPage } from '../storage'

export type InspectableResourceKind = 'store' | 'memory' | 'blackboard' | 'workspace' | 'retriever' | 'thread' | 'session' | 'custom'

export type InspectableResourceOperation = 'get' | 'list'

export interface InspectableReadableStore {
  get(key: string): Promise<JsonObject | null>
  list(prefix: string, options?: RecordListOptions): Promise<RecordPage>
}

export interface InspectableResource {
  readonly resource: string
  readonly kind: InspectableResourceKind
  readonly description?: string
  readonly operations: readonly InspectableResourceOperation[]
  readonly store?: InspectableReadableStore
  readonly defaultKey?: string
  readonly defaultPrefix?: string
  readonly metadata?: Record<string, unknown>
  read?(request: InspectableResourceReadRequest): Promise<unknown>
}

export type InspectableResourceReadRequest =
  | {
      readonly operation: 'get'
      readonly key?: string
      readonly store?: InspectableReadableStore
    }
  | {
      readonly operation: 'list'
      readonly prefix?: string
      readonly options?: RecordListOptions
      readonly store?: InspectableReadableStore
    }

const resources = new Map<string, InspectableResource>()

export function registerInspectableResource(resource: InspectableResource): InspectableResource {
  resources.set(resource.resource, Object.freeze({ ...resource, operations: [...resource.operations] }))
  return resource
}

export function getInspectableResource(resource: string): InspectableResource | undefined {
  return resources.get(resource)
}

export function listInspectableResources(): InspectableResource[] {
  return [...resources.values()].sort((a, b) => a.resource.localeCompare(b.resource))
}

export function clearInspectableResources(): void {
  resources.clear()
}
