import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { appendNativeToolRound, defineNativeChatProvider } from '@crux/core/adapter/native-chat'

const testDir = dirname(fileURLToPath(import.meta.url))

interface PackageJson {
  readonly exports?: Record<string, unknown>
  readonly typesVersions?: Record<string, Record<string, readonly string[]>>
}

describe('@crux/core/adapter/native-chat public surface', () => {
  it('keeps the package subpath export and typesVersion mapping stable', async () => {
    const source = await readFile(join(testDir, '..', '..', 'package.json'), 'utf8')
    const parsed = JSON.parse(source) as PackageJson

    expect(parsed.exports?.['./adapter/native-chat']).toEqual({
      types: './adapter/native-chat/index.ts',
      import: './adapter/native-chat/index.ts',
      require: './adapter/native-chat/index.ts',
    })
    expect(parsed.typesVersions?.['*']?.['adapter/native-chat']).toEqual(['adapter/native-chat/index.ts'])
  })

  it('exports only the stable runtime helpers from the public subpath', async () => {
    const nativeChat = await import('@crux/core/adapter/native-chat')

    expect(Object.keys(nativeChat).sort()).toEqual(['appendNativeToolRound', 'defineNativeChatProvider'])
    expect(nativeChat.appendNativeToolRound).toBe(appendNativeToolRound)
    expect(nativeChat.defineNativeChatProvider).toBe(defineNativeChatProvider)
  })
})
