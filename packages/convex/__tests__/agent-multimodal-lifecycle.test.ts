import type { LanguageModelV3 } from '@ai-sdk/provider'
import { prompt } from '@use-crux/core'
import type { StoredAsset } from '@use-crux/core/storage'
import { describe, expect, it, vi } from 'vitest'
import { createProfileBackedAgentLifecycle } from '../src/agent/lifecycle'
import { afterPreparedAgentCall } from '../src/agent/lifecycle-persistence'
import { inMemoryRecordStore } from '../src/memory'
import { FakeConvexAgentDriver } from './fixtures/fakeAgentDriver'

function model(): LanguageModelV3 {
  return {
    provider: 'openai',
    modelId: 'gpt-4o',
    specificationVersion: 'v3',
  } as LanguageModelV3
}

function lifecycleWithPrompt(driver: FakeConvexAgentDriver, messages: ReturnType<typeof prompt>['config']['messages']) {
  const mediaPrompt = prompt({
    id: 'convex-agent-media',
    messages,
  })

  return createProfileBackedAgentLifecycle({
    components: {
      crux: { marker: 'crux' } as never,
      agent: { marker: 'agent' } as never,
    },
    driver,
    languageModel: model(),
    name: 'Media Agent',
    prompt: mediaPrompt,
    storage: () => inMemoryRecordStore(),
  })
}

describe('profile-backed Convex Agent multimodal lifecycle', () => {
  it('passes stored Convex assets as Agent-native URL parts without another storage write', async () => {
    const driver = new FakeConvexAgentDriver()
    const storedImage = {
      type: 'data',
      data: new Uint8Array([1, 2, 3]),
      mediaType: 'image/png',
      ref: { uri: 'convex://storage_existing_1' },
    } satisfies StoredAsset
    const store = vi.fn(async () => 'storage_new')
    const getUrl = vi.fn(async () => 'https://files.example/storage_existing_1?token=redacted')
    const lifecycle = lifecycleWithPrompt(driver, () => [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the image.' },
          { type: 'image', source: storedImage, mediaType: 'image/png' },
        ],
      },
    ])

    await lifecycle.invokeText({
      ctx: { storage: { store, getUrl } },
      target: { threadId: 'thread-media', userId: 'user-1' },
      args: { input: {} },
    })

    expect(store).not.toHaveBeenCalled()
    expect(getUrl).toHaveBeenCalledWith('storage_existing_1')
    expect(driver.generatedTextCalls[0]?.args.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe the image.' },
          {
            type: 'image',
            image: new URL('https://files.example/storage_existing_1?token=redacted'),
            mediaType: 'image/png',
          },
        ],
      },
    ])
    expect(JSON.stringify(driver.generatedTextCalls[0]?.args.messages)).not.toContain('convex://')
  })

  it('fails clearly when a stored Convex asset cannot be resolved', async () => {
    const driver = new FakeConvexAgentDriver()
    const lifecycle = lifecycleWithPrompt(driver, () => [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'data',
              data: new Uint8Array([1, 2, 3]),
              mediaType: 'image/png',
              ref: { uri: 'convex://storage_secret_1' },
            } satisfies StoredAsset,
            mediaType: 'image/png',
          },
        ],
      },
    ])

    const invocation = lifecycle.invokeText({
      ctx: { storage: { store: vi.fn() } },
      target: { threadId: 'thread-media', userId: 'user-1' },
      args: { input: {} },
    })

    await expect(invocation).rejects.toThrow('Stored Convex media cannot be resolved')
    await expect(invocation).rejects.not.toThrow('storage_secret_1')
    expect(driver.generatedTextCalls).toHaveLength(0)
  })

  it('captures Agent-native media messages without bearer URLs or storage IDs', async () => {
    const captureTurn = vi.fn(
      async (_turn: { readonly messages: readonly { readonly content: string }[] }) => undefined,
    )
    const flush = vi.fn(async () => undefined)

    await afterPreparedAgentCall({
      resolved: {
        settings: {},
        memoryBindings: [{ memory: { captureTurn, flush } }],
      } as never,
      input: {},
      result: { text: 'assistant reply' },
      captureMessages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'remember this image' },
            {
              type: 'image',
              image: new URL('https://files.example/storage_existing_1?token=secret'),
              mediaType: 'image/png',
            },
          ],
        },
      ],
    })

    expect(captureTurn).toHaveBeenCalledTimes(1)
    const turn = captureTurn.mock.calls[0]?.[0] as
      | { readonly messages: readonly { readonly content: string }[] }
      | undefined
    const content = turn?.messages[0]?.content ?? ''
    expect(content).toContain('remember this image')
    expect(content).toContain('[image image/png')
    expect(content).not.toContain('storage_existing_1')
    expect(content).not.toContain('token=secret')
    expect(content).not.toContain('https://files.example')
  })

  it('converts media on continued-thread streaming turns while preserving thread context', async () => {
    const driver = new FakeConvexAgentDriver()
    driver.contextSnapshot = {
      all: [],
      search: [],
      recent: [],
      inputMessages: [],
      inputPrompt: [],
      existingResponses: [],
      threadId: 'thread-reloaded',
      userId: 'user-reloaded',
    }
    const lifecycle = lifecycleWithPrompt(driver, () => [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize the report.' },
          {
            type: 'file',
            source: {
              type: 'data',
              data: new Uint8Array([1, 2, 3]),
              mediaType: 'application/pdf',
            },
            mediaType: 'application/pdf',
            filename: 'report.pdf',
          },
        ],
      },
    ])

    const { thread } = await lifecycle.continueThread({
      ctx: { storage: agentStorage([]) },
      target: { threadId: 'thread-original', userId: 'user-original' },
    })
    await thread.streamText({ input: {}, promptMessageId: 'message-1' }, { saveStreamDeltas: true })

    expect(driver.contextRequests[0]).toMatchObject({
      target: { threadId: 'thread-original', userId: 'user-original' },
      callArgs: { promptMessageId: 'message-1' },
    })
    expect(driver.streamedTextCalls[0]).toMatchObject({
      target: { threadId: 'thread-reloaded', userId: 'user-reloaded' },
      options: expect.objectContaining({ saveStreamDeltas: true }),
    })
    expect(driver.streamedTextCalls[0]?.args.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Summarize the report.' },
          {
            type: 'file',
            data: new Uint8Array([1, 2, 3]),
            mediaType: 'application/pdf',
            filename: 'report.pdf',
          },
        ],
      },
    ])
  })
})

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
