import type { LanguageModelV3 } from '@ai-sdk/provider'
import { serializeMessage } from '@convex-dev/agent'
import { prompt } from '@use-crux/core'
import type { AssetStore } from '@use-crux/core/storage'
import { describe, expect, it, vi } from 'vitest'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'
import { inMemoryRecordStore } from '../src/memory'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

describe('profile-backed Convex Agent media autosave', () => {
  it('leaves inline media persistence to the installed Convex Agent threshold', async () => {
    const autoSaveAt = await installedAgentAutoSaveStart()

    const below = await runInlineLifecycleThroughAgentPersistence(autoSaveAt - 1)
    expect(below.agentStorageWrites).toHaveLength(0)
    expect(below.serializedFileIds).toBeUndefined()
    expect(below.cruxAssetPut).not.toHaveBeenCalled()

    const above = await runInlineLifecycleThroughAgentPersistence(autoSaveAt)
    expect(above.agentStorageWrites).toHaveLength(1)
    expect(above.serializedFileIds).toEqual(['file-1'])
    expect(above.cruxAssetPut).not.toHaveBeenCalled()
  })
})

async function runInlineLifecycleThroughAgentPersistence(byteLength: number) {
  const driver = new FakeConvexAgentDriver()
  const agentStorageWrites: Blob[] = []
  const cruxAssetPut = vi.fn<AssetStore['put']>()
  const lifecycle = createProfileBackedAgentLifecycle({
    components: {
      crux: { marker: 'crux' } as never,
      agent: agentComponent() as never,
    },
    driver,
    languageModel: model(),
    name: 'Inline Media Agent',
    prompt: prompt({
      id: 'convex-agent-inline-media',
      messages: () => [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Describe the image.' },
            {
              type: 'image',
              source: {
                type: 'data',
                data: new Uint8Array(byteLength),
                mediaType: 'image/png',
              },
              mediaType: 'image/png',
            },
          ],
        },
      ],
    }),
    storage: () => ({
      records: inMemoryRecordStore(),
      assets: {
        put: cruxAssetPut,
        get: vi.fn<AssetStore['get']>(),
        delete: vi.fn<AssetStore['delete']>(),
      },
    }),
  })
  let serializedFileIds: string[] | undefined
  driver.onGenerateText = async ({ args }) => {
    const message = Array.isArray(args.messages) ? args.messages[0] : undefined
    const serialized = await serializeMessage(
      agentCtx(agentStorageWrites) as never,
      agentComponent() as never,
      message as never,
    )
    serializedFileIds = serialized.fileIds
  }

  await lifecycle.invokeText({
    ctx: { storage: agentStorage(agentStorageWrites) },
    target: { threadId: 'thread-inline', userId: 'user-1' },
    args: { input: {} },
  })

  return { agentStorageWrites, cruxAssetPut, serializedFileIds }
}

async function installedAgentAutoSaveStart(): Promise<number> {
  let high = 1
  while ((await agentStoresNativeImageBytes(high)) === false) {
    high *= 2
    if (high > 1024 * 1024) throw new Error('Unable to derive Convex Agent autosave threshold.')
  }
  let low = 1
  while (low < high) {
    const mid = low + Math.floor((high - low) / 2)
    if (await agentStoresNativeImageBytes(mid)) high = mid
    else low = mid + 1
  }
  return low
}

async function agentStoresNativeImageBytes(byteLength: number): Promise<boolean> {
  const writes: Blob[] = []
  await serializeMessage(agentCtx(writes) as never, agentComponent() as never, {
    role: 'user',
    content: [{ type: 'image', image: new Uint8Array(byteLength), mediaType: 'image/png' }],
  } as never)
  return writes.length > 0
}

function model(): LanguageModelV3 {
  return {
    provider: 'openai',
    modelId: 'gpt-4o',
    specificationVersion: 'v3',
  } as LanguageModelV3
}

function agentComponent() {
  return {
    files: {
      useExistingFile: 'files:useExistingFile',
      addFile: 'files:addFile',
    },
  }
}

function agentCtx(writes: Blob[]) {
  const component = agentComponent()
  return {
    storage: agentStorage(writes),
    async runAction() {
      return null
    },
    async runMutation(ref: unknown, args: Record<string, unknown>) {
      if (ref === component.files.useExistingFile) return null
      if (ref === component.files.addFile) {
        return {
          fileId: `file-${writes.length}`,
          storageId: String(args.storageId),
        }
      }
      throw new Error('Unexpected Convex Agent mutation.')
    },
  }
}

function agentStorage(writes: Blob[]) {
  return {
    async store(blob: Blob) {
      writes.push(blob)
      return `storage-${writes.length}`
    },
    async getUrl(storageId: string) {
      return `https://files.example/${storageId}?token=redacted`
    },
    async getMetadata() {
      return null
    },
    async delete() {},
  }
}
