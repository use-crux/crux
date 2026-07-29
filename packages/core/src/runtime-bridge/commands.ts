/**
 * Runtime Bridge command execution helpers.
 *
 * The command layer intentionally stays narrow: it reads registered inspectable
 * resources and normalizes errors for the local Go service.
 *
 * @module
 */

import {
  getInspectableResource,
  listInspectableResources,
  type InspectableResource,
  type InspectableReadableStore,
} from './resources'
import { normalizeObservedError } from '../observability/errors'
import { activePromptCatalogue } from '../runtime/prompt-catalogue'
import { promptPreviewCapability } from './prompt-preview/catalogue'
import {
  executePromptPreview,
  PromptPreviewCommandError,
} from './prompt-preview/execute'
import type {
  BridgeCapability,
  BridgeCommandRequest,
  BridgeStoreResource,
  RuntimeBridgeManifestInput,
  StoreReadCommandPayload,
} from './protocol'

export async function executeRuntimeBridgeCommand(
  input: RuntimeBridgeManifestInput,
  command: BridgeCommandRequest,
  options: RuntimeBridgeCommandExecutionOptions = {},
): Promise<unknown> {
  switch (command.command) {
    case 'store.read':
      return await executeStoreRead(input, command.payload)
    case 'prompt.previewExact':
      return await executePromptPreview(command, options)
  }
}

/** Transport-owned cancellation available only to exact-preview execution. */
export interface RuntimeBridgeCommandExecutionOptions {
  readonly signal?: AbortSignal
}

/** Derive bridge capabilities from configured and auto-registered resources. */
export function deriveBridgeCapabilities(
  input: RuntimeBridgeManifestInput,
): BridgeCapability[] {
  const capabilities: BridgeCapability[] = []
  const resources = deriveStoreResources(input)
  if (resources.length > 0) {
    capabilities.push({ command: 'store.read', resources })
  }
  const catalogue = activePromptCatalogue()
  const preview = promptPreviewCapability(catalogue.revision, catalogue.entries)
  if (preview) capabilities.push(preview)
  return capabilities
}

async function executeStoreRead(
  input: RuntimeBridgeManifestInput,
  payload: StoreReadCommandPayload,
): Promise<unknown> {
  const explicitResource = getInspectableResource(payload.resource)
  if (explicitResource?.read) {
    if (payload.operation === 'get') {
      return await explicitResource.read({
        operation: 'get',
        key: payload.key,
        store: explicitResource.store ?? readableStore(input.records),
      })
    }
    return await explicitResource.read({
      operation: 'list',
      prefix: payload.prefix,
      options: {
        limit: Math.min(payload.limit ?? 100, 500),
        cursor: payload.cursor,
        filter: payload.filter,
      },
      store: explicitResource.store ?? readableStore(input.records),
    })
  }

  const store = explicitResource?.store ?? readableStore(input.records)
  if (!isReadableRecordStore(store)) {
    throw new BridgeCommandExecutionError(
      'store_unavailable',
      'No readable RecordStore is configured.',
    )
  }

  const resolved = explicitResource ?? inferStoreResource(payload.resource)
  if (!resolved) {
    throw new BridgeCommandExecutionError(
      'unsupported_resource',
      `Unsupported store resource "${payload.resource}".`,
    )
  }
  if (payload.operation === 'get') {
    const key = payload.key ?? resolved.defaultKey
    if (!key) {
      throw new BridgeCommandExecutionError(
        'missing_key',
        `Resource "${payload.resource}" requires a key.`,
      )
    }
    return { value: await store.get(key) }
  }
  const prefix = payload.prefix ?? resolved.defaultPrefix
  if (prefix === undefined) {
    throw new BridgeCommandExecutionError(
      'missing_prefix',
      `Resource "${payload.resource}" requires a list prefix.`,
    )
  }
  return await store.list(prefix, {
    limit: Math.min(payload.limit ?? 100, 500),
    cursor: payload.cursor,
    filter: payload.filter,
  })
}

function deriveStoreResources(
  input: RuntimeBridgeManifestInput,
): BridgeStoreResource[] {
  const resources = new Map<string, BridgeStoreResource>()
  if (input.records) {
    resources.set('crux.store', {
      resource: 'crux.store',
      operations: ['get', 'list'],
      description: 'Configured record store resources',
      kind: 'store',
    })
  }
  for (const resource of listInspectableResources()) {
    resources.set(resource.resource, {
      resource: resource.resource,
      operations: [...resource.operations],
      description: resource.description,
      kind: resource.kind,
      metadata: resource.metadata,
    })
  }
  return [...resources.values()].sort((a, b) =>
    a.resource.localeCompare(b.resource),
  )
}

function inferStoreResource(
  resource: string,
):
  | Pick<InspectableResource, 'resource' | 'defaultKey' | 'defaultPrefix'>
  | undefined {
  if (resource === 'crux.store') return { resource }
  if (resource.startsWith('blackboard:')) {
    return { resource, defaultKey: resource, defaultPrefix: resource }
  }
  if (resource.startsWith('memory:')) {
    return { resource, defaultPrefix: `${resource}:` }
  }
  return undefined
}

function readableStore(value: unknown): InspectableReadableStore | undefined {
  return isReadableRecordStore(value) ? value : undefined
}

function isReadableRecordStore(
  value: unknown,
): value is InspectableReadableStore {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as { get?: unknown }).get === 'function' &&
    typeof (value as { list?: unknown }).list === 'function'
  )
}

class BridgeCommandExecutionError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'BridgeCommandExecutionError'
  }
}

/** Convert a thrown bridge command error into a stable command error code. */
export function bridgeErrorCode(error: unknown): string {
  if (error instanceof PromptPreviewCommandError) {
    return error.previewError.code
  }
  return error instanceof BridgeCommandExecutionError
    ? error.code
    : 'runtime_error'
}

/** Convert a thrown bridge command error into structured diagnostic details. */
export function bridgeErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof PromptPreviewCommandError) {
    return error.previewError.details ?? {}
  }
  const errorKind = bridgeErrorCode(error)
  const phase = 'runtime_bridge.command'
  return {
    ...normalizeObservedError(error, {
      phase,
      errorKind,
    }),
    phase,
    errorKind,
  }
}

/** Convert a thrown bridge command error into a user-facing message. */
export function bridgeErrorMessage(error: unknown): string {
  if (error instanceof PromptPreviewCommandError) {
    return error.previewError.message
  }
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  return 'Unknown bridge error'
}
