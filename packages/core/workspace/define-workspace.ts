/**
 * The {@link workspace} factory.
 *
 * Wires a {@link WorkspaceConfig} to a {@link DataStore} (metadata) and optional
 * {@link BlobStore} (binary/oversized payloads), then exposes the file
 * operations plus context/tool/injection adapters. Every operation is
 * instrumented and namespace-scoped.
 *
 * @module
 */

import { z } from 'zod'
import { context } from '../prompt/context'
import { inMemoryBlobStore, inMemoryDataStore } from '../store/memory'
import type { AnyToolSet, Context, PromptInjection } from '../types'
import type { ToolDef } from '../types/tool'
import { analyzeContent, createFileRecord, findOccurrences, recordToFile, recordToReadResult } from './content'
import { renderWorkspaceManifest } from './manifest'
import { mountForPath, normalizeMounts, normalizePath, defaultMounts } from './path'
import { instrument } from './observability'
import { fileKey, getRecord, getRequiredRecord, listEntries } from './store'
import { createWorkspaceTools } from './tools'
import { hasGlob } from './glob'
import {
  DEFAULT_INLINE_TEXT_BYTES,
  type Workspace,
  type WorkspaceConfig,
  type WorkspaceContent,
  type WorkspaceContextOptions,
  type WorkspaceDeleteOptions,
  type WorkspaceEditOptions,
  type WorkspaceEditPatch,
  type WorkspaceFile,
  type WorkspaceListOptions,
  type WorkspaceListResult,
  type WorkspaceBlobStore,
  type WorkspaceReadOptions,
  type WorkspaceReadResult,
  type WorkspaceToolOptions,
  type WorkspaceWriteOptions,
} from './types'

/**
 * Create a durable, path-addressed workspace.
 *
 * @param config - Workspace id, namespace resolution, stores, mounts, and tools.
 * @returns A frozen {@link Workspace} instance.
 */
export function workspace(config: WorkspaceConfig): Workspace {
  assertNonEmpty(config.id, 'workspace(): id must be non-empty.')

  const store = config.data ?? config.storage?.data ?? inMemoryDataStore()
  const blobs = config.blobs ?? config.storage?.blobs
  const mounts = normalizeMounts(config.mounts ?? defaultMounts())
  const inlineTextBelowBytes = config.content?.inlineTextBelowBytes ?? DEFAULT_INLINE_TEXT_BYTES

  async function resolveNamespace(input?: Record<string, unknown>, promptId?: string): Promise<string> {
    const raw =
      typeof config.namespace === 'function'
        ? await config.namespace({ input: input ?? {}, promptId })
        : config.namespace
    assertNonEmpty(raw, 'workspace(): namespace must resolve to a non-empty string.')
    return raw
  }

  async function list(path = '/', options?: WorkspaceListOptions): Promise<WorkspaceListResult> {
    const namespace = await resolveNamespace()
    return listForNamespace(namespace, path, options)
  }

  async function listForNamespace(
    namespace: string,
    path = '/',
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult> {
    return instrument({ workspaceId: config.id, operation: 'list', namespace, path }, async () => {
      const normalized = normalizePath(path)
      const isGlob = hasGlob(normalized)
      const matchedMount = isGlob || normalized === '/' ? undefined : mountForPath(normalized, mounts, 'read')
      const entries = await listEntries({
        store,
        workspaceId: config.id,
        namespace,
        mounts,
        queryPath: normalized,
        isGlob,
        limit: options?.limit,
        matchedMount,
      })
      return { entries }
    })
  }

  async function read(path: string, options?: WorkspaceReadOptions): Promise<WorkspaceReadResult> {
    const namespace = await resolveNamespace()
    return readForNamespace(namespace, path, options)
  }

  async function readForNamespace(
    namespace: string,
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult> {
    return instrument({ workspaceId: config.id, operation: 'read', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, mounts, 'read')
      const record = await getRequiredRecord(store, config.id, namespace, normalized)
      return recordToReadResult(record, options?.maxInlineBytes)
    })
  }

  async function write(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile> {
    const namespace = await resolveNamespace()
    return writeForNamespace(namespace, path, content, options)
  }

  async function writeForNamespace(
    namespace: string,
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile> {
    return instrument({ workspaceId: config.id, operation: 'write', namespace, path }, async () => {
      const normalized = normalizePath(path)
      const mount = mountForPath(normalized, mounts, 'write')
      const analysis = await analyzeContent(content, options?.mimeType)
      const existing = await getRecord(store, config.id, namespace, normalized)
      const now = Date.now()
      const record = await createFileRecord({
        workspaceId: config.id,
        namespace,
        path: normalized,
        mount: mount.path,
        analysis,
        metadata: options?.metadata,
        existing,
        now,
        inlineTextBelowBytes,
        blobs,
      })
      await store.set(fileKey(config.id, namespace, normalized), record)
      return recordToFile(record)
    })
  }

  async function edit(path: string, patch: WorkspaceEditPatch, options?: WorkspaceEditOptions): Promise<WorkspaceFile> {
    const namespace = await resolveNamespace()
    return editForNamespace(namespace, path, patch, options)
  }

  async function editForNamespace(
    namespace: string,
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile> {
    return instrument({ workspaceId: config.id, operation: 'edit', namespace, path }, async () => {
      if (!patch.find) throw new Error('workspace.edit(): patch.find must be non-empty.')
      const current = await readForNamespace(namespace, path)
      if (current.kind !== 'text') {
        throw new Error(`workspace.edit(): only text files can be edited. "${path}" is ${current.kind}.`)
      }
      const occurrences = findOccurrences(current.content, patch.find)
      if (occurrences.length === 0) {
        throw new Error(`workspace.edit(): text to replace was not found in "${path}".`)
      }
      if (occurrences.length > 1 && patch.occurrence === undefined) {
        throw new Error(
          `workspace.edit(): found ${occurrences.length} matches in "${path}". Pass occurrence to choose one.`,
        )
      }
      const occurrence = patch.occurrence ?? 1
      if (occurrence < 1 || occurrence > occurrences.length) {
        throw new Error(`workspace.edit(): occurrence ${occurrence} is outside the match range.`)
      }
      const index = occurrences[occurrence - 1]!
      const next = `${current.content.slice(0, index)}${patch.replace}${current.content.slice(index + patch.find.length)}`
      return writeForNamespace(namespace, path, next, {
        mimeType: options?.mimeType ?? current.mimeType,
        metadata: current.metadata,
      })
    })
  }

  async function remove(path: string, options?: WorkspaceDeleteOptions): Promise<void> {
    const namespace = await resolveNamespace()
    await removeForNamespace(namespace, path, options)
  }

  async function removeForNamespace(namespace: string, path: string, options?: WorkspaceDeleteOptions): Promise<void> {
    await instrument({ workspaceId: config.id, operation: 'delete', namespace, path }, async () => {
      const normalized = normalizePath(path)
      mountForPath(normalized, mounts, 'write')
      const record = await getRecord(store, config.id, namespace, normalized)
      await store.delete(fileKey(config.id, namespace, normalized))
      if (options?.deleteBlob !== false && record?.uri && blobs?.delete) {
        await blobs.delete(record.uri)
      }
    })
  }

  const asTools = createWorkspaceTools({
    workspaceId: config.id,
    defaultToolOptions: config.tools,
    ops: {
      list,
      read,
      write,
      edit,
      remove: (path) => remove(path),
      listForNamespace,
      readForNamespace,
      writeForNamespace,
      editForNamespace,
      removeForNamespace: (namespace, path) => removeForNamespace(namespace, path),
    },
  })

  function asContext(options?: WorkspaceContextOptions): Context<z.ZodType<{}>> {
    return context({
      id: `workspace:${config.id}`,
      description: `Workspace: ${config.id}`,
      input: z.object({}).passthrough(),
      priority: options?.priority ?? 65,
      system: async ({ input }) =>
        renderWorkspaceManifest({
          store,
          workspaceId: config.id,
          mounts,
          namespace: await resolveNamespace(input),
          options,
        }),
    })
  }

  const ws: Workspace = {
    _tag: 'Workspace',
    id: config.id,
    mounts,
    list,
    read,
    write,
    edit,
    delete: remove,
    asContext,
    asTools: (options?: WorkspaceToolOptions): Record<string, ToolDef> => asTools(options),
    async inject(args): Promise<PromptInjection> {
      const namespace = await resolveNamespace(args.input, args.promptId)
      return {
        contexts: [
          context({
            id: `workspace:${config.id}`,
            description: `Workspace: ${config.id}`,
            input: z.object({}).passthrough(),
            priority: 65,
            system: () => renderWorkspaceManifest({ store, workspaceId: config.id, mounts, namespace }),
          }),
        ],
        tools: asTools(undefined, namespace) as AnyToolSet,
        metadata: {
          workspace: {
            id: config.id,
            namespace,
            mounts: mounts.map((mount) => ({ path: mount.path, access: mount.access })),
          },
        },
      }
    },
  }

  return Object.freeze(ws)
}

/** An in-memory {@link WorkspaceBlobStore}, useful for tests and ephemeral runs. */
export function memoryWorkspaceBlobStore(): WorkspaceBlobStore {
  return inMemoryBlobStore()
}

function assertNonEmpty(value: string, message: string): void {
  if (!value.trim()) throw new Error(message)
}
