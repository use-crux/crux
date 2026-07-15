import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CassetteCorruptionError,
  CassetteMissError,
  CassetteRecordedError,
  cassettePath,
  normalizedCallKey,
  openCassetteSession,
} from '../../src/quality/internal/cassette'
import type { InterceptedGeneration } from '../../src/adapter/interception'

const execFileAsync = promisify(execFile)
const tempDirs: string[] = []
async function tempCassette(name = 'test'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'crux-cassette-'))
  tempDirs.push(dir)
  return cassettePath(dir, name)
}
afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function call(overrides: Partial<InterceptedGeneration> = {}): InterceptedGeneration {
  return {
    kind: 'loop',
    promptId: 'support.answer',
    modelInfo: { provider: 'fake', modelId: 'm1' },
    system: 'be terse',
    prompt: 'how do refunds work?',
    messages: undefined,
    settings: { temperature: 0 },
    tools: undefined,
    ...overrides,
  }
}

function loopOutcome(text: string) {
  return {
    status: 'complete' as const,
    raw: { sdkObject: true },
    response: {
      text,
      toolCalls: undefined,
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3,
        inputTokenDetails: {},
        outputTokenDetails: {},
      },
      finishReason: 'stop',
      responseId: 'volatile-response-id',
      actualModelId: 'm1',
    },
    messages: [
      { role: 'user' as const, content: 'how do refunds work?' },
      { role: 'assistant' as const, content: text },
    ],
    steps: 1,
    meta: { costUsd: 0.001 },
  }
}

describe('normalizedCallKey', () => {
  it('is stable for identical calls and insensitive to undefined-vs-absent fields', () => {
    const a = normalizedCallKey(call())
    const b = normalizedCallKey(call({ messages: undefined, tools: undefined }))
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('changes when prompt content, model, or settings change', () => {
    const base = normalizedCallKey(call())
    expect(normalizedCallKey(call({ prompt: 'different question' }))).not.toBe(base)
    expect(normalizedCallKey(call({ modelInfo: { provider: 'fake', modelId: 'm2' } }))).not.toBe(base)
    expect(normalizedCallKey(call({ settings: { temperature: 1 } }))).not.toBe(base)
    expect(normalizedCallKey(call({ kind: 'structured' }))).not.toBe(base)
  })

  it('changes when tool parameter schemas change', () => {
    const base = normalizedCallKey(
      call({
        tools: [{ name: 'lookup', parameters: z.object({ query: z.string() }) }],
      }),
    )

    expect(
      normalizedCallKey(
        call({
          tools: [
            {
              name: 'lookup',
              parameters: z.object({ query: z.string(), locale: z.string() }),
            },
          ],
        }),
      ),
    ).not.toBe(base)
  })
})

describe('cassette session — record-new', () => {
  it('records an Error as a safe thrown outcome and replays it without live execution', async () => {
    const path = await tempCassette('thrown-error')
    const secretError = Object.assign(new Error('provider unavailable'), {
      code: 'secret-code',
      cause: { credential: 'sk-secret' },
      providerPayload: { prompt: 'private prompt' },
    })
    const recordSession = await openCassetteSession({
      path,
      mode: 'record-new',
    })

    await expect(
      recordSession.intercept(call(), async () => Promise.reject(secretError)),
    ).rejects.toBe(secretError)
    await recordSession.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: unknown }>
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: { name: 'Error', message: 'provider unavailable' },
    })
    const persisted = JSON.stringify(cassette)
    expect(persisted).not.toContain('secret-code')
    expect(persisted).not.toContain('sk-secret')
    expect(persisted).not.toContain('private prompt')

    const replaySession = await openCassetteSession({
      path,
      mode: 'replay-strict',
    })
    let liveCalls = 0
    await expect(
      replaySession.intercept(call(), async () => {
        liveCalls++
        return loopOutcome('never')
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CassetteRecordedError)
      expect(error).toMatchObject({
        name: 'Error',
        message: 'provider unavailable',
      })
      expect(error).not.toHaveProperty('code')
      expect(error).not.toHaveProperty('cause')
      expect(error).not.toHaveProperty('providerPayload')
      return true
    })
    expect(liveCalls).toBe(0)
  })

  it('preserves an empty Error message while falling back for an empty name', async () => {
    const path = await tempCassette('empty-error-message')
    const error = new Error('')
    error.name = ''
    const session = await openCassetteSession({ path, mode: 'record-new' })

    await expect(
      session.intercept(call(), async () => Promise.reject(error)),
    ).rejects.toBe(error)
    await session.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: unknown }>
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: { name: 'Error', message: '' },
    })
  })

  it('records fallback metadata and rethrows the original Error when its name getter throws', async () => {
    const path = await tempCassette('hostile-error-name')
    const error = new Error('provider unavailable')
    Object.defineProperty(error, 'name', {
      get: () => {
        throw new Error('hostile name getter')
      },
    })
    const session = await openCassetteSession({ path, mode: 'record-new' })

    await expect(
      session.intercept(call(), async () => Promise.reject(error)),
    ).rejects.toBe(error)
    await session.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: unknown }>
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: { name: 'Error', message: 'provider unavailable' },
    })
  })

  it('records fallback metadata and rethrows the original Error when its message getter throws', async () => {
    const path = await tempCassette('hostile-error-message')
    const error = new Error('provider unavailable')
    Object.defineProperty(error, 'message', {
      get: () => {
        throw new Error('hostile message getter')
      },
    })
    const session = await openCassetteSession({ path, mode: 'record-new' })

    await expect(
      session.intercept(call(), async () => Promise.reject(error)),
    ).rejects.toBe(error)
    await session.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: unknown }>
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: { name: 'Error', message: 'Unreadable Error message' },
    })
  })

  it('records a bounded non-Error throw and single-flights concurrent rejections', async () => {
    const path = await tempCassette('non-error-throw')
    const session = await openCassetteSession({ path, mode: 'record-new' })
    const thrown = `failure:${'x'.repeat(1_200)}`
    let liveCalls = 0
    const execute = async () => {
      liveCalls++
      await new Promise((resolve) => setTimeout(resolve, 20))
      throw thrown
    }

    const outcomes = await Promise.allSettled([
      session.intercept(call(), execute),
      session.intercept(call(), execute),
    ])
    expect(liveCalls).toBe(1)
    expect(outcomes).toEqual([
      { status: 'rejected', reason: thrown },
      { status: 'rejected', reason: thrown },
    ])
    await session.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<
        string,
        { result: { status: string; error: { name: string; message: string } } }
      >
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: { name: 'NonErrorThrow', message: thrown.slice(0, 1_000) },
    })

    const replay = await openCassetteSession({ path, mode: 'replay-strict' })
    await expect(
      replay.intercept(call(), async () => loopOutcome('never')),
    ).rejects.toMatchObject({
      name: 'NonErrorThrow',
      message: thrown.slice(0, 1_000),
    })
  })

  it('redacts common secrets from recorded thrown messages without changing the live rejection', async () => {
    const path = await tempCassette('redacted-thrown-message')
    const record = await openCassetteSession({ path, mode: 'record-new' })
    const error = new Error(
      'provider failed with token-supersecret and authorization: Bearer abc.def.ghi',
    )

    await expect(
      record.intercept(call(), async () => Promise.reject(error)),
    ).rejects.toBe(error)
    await record.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<
        string,
        { result: { status: string; error: { name: string; message: string } } }
      >
    }
    expect(Object.values(cassette.entries)[0]?.result).toEqual({
      status: 'thrown',
      error: {
        name: 'Error',
        message:
          'provider failed with [redacted-secret] and [redacted-authorization]',
      },
    })

    const replay = await openCassetteSession({
      path,
      mode: 'replay-strict',
    })
    await expect(
      replay.intercept(call(), async () => loopOutcome('never')),
    ).rejects.toMatchObject({
      name: 'Error',
      message:
        'provider failed with [redacted-secret] and [redacted-authorization]',
    })
  })

  it.each(['result.error', 'result.error.name', 'result.error.message'])(
    'keeps redacted thrown outcomes throwable when redacting %s',
    async (redactPath) => {
      const path = await tempCassette('redacted-thrown-error')
      const record = await openCassetteSession({
        path,
        mode: 'record-new',
        redactPaths: [redactPath],
      })
      const error = new Error('provider secret')

      await expect(
        record.intercept(call(), async () => Promise.reject(error)),
      ).rejects.toBe(error)
      await record.flush()

      const replay = await openCassetteSession({
        path,
        mode: 'replay-strict',
        redactPaths: [redactPath],
      })
      await expect(
        replay.intercept(call(), async () => loopOutcome('never')),
      ).rejects.toMatchObject({
        name: 'CassetteRecordedError',
        message: 'Recorded thrown value',
      })
    },
  )

  it.each([
    Object.create(null),
    {
      [Symbol.toPrimitive]: () => {
        throw new Error('hostile conversion')
      },
    },
  ])(
    'records a safe fallback when a non-Error thrown value cannot be stringified',
    async (thrown) => {
      const path = await tempCassette('unstringifiable-throw')
      const record = await openCassetteSession({ path, mode: 'record-new' })

      await expect(
        record.intercept(call(), async () => Promise.reject(thrown)),
      ).rejects.toBe(thrown)
      await record.flush()

      const cassette = JSON.parse(await readFile(path, 'utf8')) as {
        entries: Record<string, { result: unknown }>
      }
      expect(Object.values(cassette.entries)[0]?.result).toEqual({
        status: 'thrown',
        error: {
          name: 'NonErrorThrow',
          message: 'Unstringifiable thrown value',
        },
      })
    },
  )

  it.each([
    new Uint8Array([1, 2, 3]),
    { type: 'data', data: new Uint8Array([4]), mediaType: 'image/png' },
    { type: 'url', url: new URL('https://secret.example/media?token=secret'), mediaType: 'image/png' },
    { type: 'provider-file', provider: 'secret-provider', fileId: 'file-secret' },
  ])('does not record whole-value media through interceptValue', async (value) => {
    const path = await tempCassette('whole-value-media')
    const session = await openCassetteSession({ path, mode: 'record-new' })
    await expect(session.interceptValue({ kind: 'value', input: 'media' }, async () => value)).resolves.toBe(value)
    await session.flush()
    await expect(readFile(path, 'utf8')).rejects.toThrow()
    expect(session.stats.recorded).toBe(0)
  })

  it('executes misses live, records them, and replays hits without executing', async () => {
    const path = await tempCassette()
    const recordSession = await openCassetteSession({
      path,
      mode: 'record-new',
    })
    let liveCalls = 0
    const execute = async () => {
      liveCalls++
      return loopOutcome('live answer')
    }

    const first = (await recordSession.intercept(call(), execute)) as ReturnType<typeof loopOutcome>
    expect(first.response.text).toBe('live answer')
    expect(liveCalls).toBe(1)
    await recordSession.flush()

    const replaySession = await openCassetteSession({
      path,
      mode: 'record-new',
    })
    const second = (await replaySession.intercept(call(), execute)) as ReturnType<typeof loopOutcome>
    expect(liveCalls).toBe(1) // served from the cassette
    expect(second.response.text).toBe('live answer')
    expect(second.messages).toHaveLength(2)
    expect(second.status).toBe('complete')
    expect(replaySession.stats).toMatchObject({ hits: 1, misses: 0 })
  })

  it('single-flights concurrent identical misses to one live recording', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'record-new' })
    let liveCalls = 0
    const execute = async () => {
      const callNumber = ++liveCalls
      await new Promise((resolve) => setTimeout(resolve, 20))
      return loopOutcome(`live answer ${callNumber}`)
    }

    const [first, second] = (await Promise.all([session.intercept(call(), execute), session.intercept(call(), execute)])) as [
      ReturnType<typeof loopOutcome>,
      ReturnType<typeof loopOutcome>,
    ]

    expect(liveCalls).toBe(1)
    expect(first.response.text).toBe('live answer 1')
    expect(second.response.text).toBe('live answer 1')
    expect(session.stats.recorded).toBe(1)
  })

  it('writes metadata (recordedAt, sdkVersion, models) into the cassette file', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'record-new' })
    await session.intercept(call(), async () => loopOutcome('x'))
    await session.flush()

    const file = JSON.parse(await readFile(path, 'utf8')) as {
      version: number
      metadata: { recordedAt: string; sdkVersion: string; models: string[] }
      entries: Record<string, unknown>
    }
    expect(file.version).toBe(1)
    expect(Date.parse(file.metadata.recordedAt)).not.toBeNaN()
    expect(typeof file.metadata.sdkVersion).toBe('string')
    expect(file.metadata.models).toEqual(['fake/m1'])
    expect(Object.keys(file.entries)).toHaveLength(1)
  })

  it('merges disjoint recordings when two sessions flush the same cassette file', async () => {
    const path = await tempCassette()
    const firstSession = await openCassetteSession({
      path,
      mode: 'record-new',
    })
    const secondSession = await openCassetteSession({
      path,
      mode: 'record-new',
    })

    await firstSession.intercept(call({ prompt: 'first prompt' }), async () => loopOutcome('first answer'))
    await secondSession.intercept(call({ prompt: 'second prompt' }), async () => loopOutcome('second answer'))
    await firstSession.flush()
    await secondSession.flush()

    const file = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: { response?: { text?: string } } }>
    }
    expect(Object.keys(file.entries)).toHaveLength(2)
    expect(Object.values(file.entries).map((entry) => entry.result.response?.text).sort()).toEqual(['first answer', 'second answer'])
  })

  it('rejects lock-time disk corruption without modifying the cassette', async () => {
    const path = await tempCassette('lock-time-corruption')
    const seed = await openCassetteSession({ path, mode: 'record-new' })
    await seed.intercept(call({ prompt: 'seed prompt' }), async () =>
      loopOutcome('seed answer'),
    )
    await seed.flush()

    const pending = await openCassetteSession({ path, mode: 'record-new' })
    await pending.intercept(call({ prompt: 'pending prompt' }), async () =>
      loopOutcome('pending answer'),
    )

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, unknown>
    }
    const [[key, entry]] = Object.entries(cassette.entries)
    delete cassette.entries[key]
    const corruptKey = 'concurrent-corrupt-key'
    cassette.entries[corruptKey] = entry
    const corruptBytes = `${JSON.stringify(cassette, null, 2)}\n`
    await writeFile(path, corruptBytes)

    await expect(pending.flush()).rejects.toMatchObject({
      name: 'CassetteCorruptionError',
      path,
      key: corruptKey,
    })
    expect(await readFile(path, 'utf8')).toBe(corruptBytes)
  })

  it('merges disjoint recordings flushed by two separate processes', async () => {
    const path = await tempCassette()
    // Compute cassette module location from this test file (works regardless of process.cwd() in pnpm/vitest runs)
    const cassetteModuleFile = join(dirname(fileURLToPath(import.meta.url)), '../../src/quality/internal/cassette.ts')
    const worker = `
      import { openCassetteSession } from ${JSON.stringify(pathToFileURL(cassetteModuleFile).href)}
      const path = process.env.CASSETTE_PATH
      const prompt = process.env.CASSETTE_PROMPT
      const text = process.env.CASSETTE_TEXT
      if (!path || !prompt || !text) throw new Error('missing worker env')
      const session = await openCassetteSession({ path, mode: 'record-new' })
      await session.intercept({
        kind: 'loop',
        promptId: 'support.answer',
        modelInfo: { provider: 'fake', modelId: 'm1' },
        system: 'be terse',
        prompt,
        messages: undefined,
        settings: { temperature: 0 },
        tools: undefined,
      }, async () => ({
        status: 'complete',
        raw: { sdkObject: true },
        response: { text, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, inputTokenDetails: {}, outputTokenDetails: {} }, finishReason: 'stop' },
        messages: [{ role: 'assistant', content: text }],
        steps: 1,
        meta: {},
      }))
      await session.flush()
    `
    const tsxLoader = join(process.cwd(), '../../node_modules/.pnpm/tsx@4.22.3/node_modules/tsx/dist/esm/index.mjs')

    await Promise.all([
      execFileAsync(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval', worker], {
        env: { ...process.env, CASSETTE_PATH: path, CASSETTE_PROMPT: 'first process', CASSETTE_TEXT: 'first answer' },
      }),
      execFileAsync(process.execPath, ['--import', tsxLoader, '--input-type=module', '--eval', worker], {
        env: { ...process.env, CASSETTE_PATH: path, CASSETTE_PROMPT: 'second process', CASSETTE_TEXT: 'second answer' },
      }),
    ])

    const file = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, { result: { response?: { text?: string } } }>
    }
    expect(Object.keys(file.entries)).toHaveLength(2)
    expect(Object.values(file.entries).map((entry) => entry.result.response?.text).sort()).toEqual(['first answer', 'second answer'])
  })
})

describe('cassette session — replay-strict', () => {
  it('validates and replays with the effective custom matcher after redaction', async () => {
    const path = await tempCassette('custom-matcher')
    const customCall = call({ settings: { apiKey: 'sk-match-secret' } })
    const match = (normalized: { settings?: Record<string, unknown> }) =>
      `custom:${String(normalized.settings?.apiKey)}`
    const record = await openCassetteSession({
      path,
      mode: 'record-new',
      match,
    })
    await record.intercept(customCall, async () => loopOutcome('custom answer'))
    await record.flush()
    expect(await readFile(path, 'utf8')).not.toContain('sk-match-secret')

    let liveCalls = 0
    const replay = await openCassetteSession({
      path,
      mode: 'replay-strict',
      match,
    })
    const result = (await replay.intercept(customCall, async () => {
      liveCalls++
      return loopOutcome('never')
    })) as ReturnType<typeof loopOutcome>
    expect(result.response.text).toBe('custom answer')
    expect(liveCalls).toBe(0)
  })

  it('rejects an entry moved under a mismatched key before provider execution', async () => {
    const path = await tempCassette('corrupt-key')
    const record = await openCassetteSession({ path, mode: 'record-new' })
    await record.intercept(call(), async () => loopOutcome('recorded'))
    await record.flush()

    const cassette = JSON.parse(await readFile(path, 'utf8')) as {
      entries: Record<string, unknown>
    }
    const [[key, entry]] = Object.entries(cassette.entries)
    delete cassette.entries[key]
    const corruptKey = 'moved-entry-key'
    cassette.entries[corruptKey] = entry
    await writeFile(path, JSON.stringify(cassette))

    let liveCalls = 0
    await expect(
      openCassetteSession({ path, mode: 'replay-strict' }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CassetteCorruptionError)
      expect(error).toMatchObject({ path, key: corruptKey })
      expect((error as Error).message).toContain(path)
      expect((error as Error).message).toContain(corruptKey)
      expect((error as Error).message).not.toContain('how do refunds work?')
      return true
    })
    expect(liveCalls).toBe(0)
  })

  it('fails a miss closed with the key and a re-record hint, never executing', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'replay-strict' })
    let executed = false

    await expect(
      session.intercept(call(), async () => {
        executed = true
        return loopOutcome('never')
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(CassetteMissError)
      const miss = error as CassetteMissError
      expect(miss.key).toMatch(/^[0-9a-f]{64}$/)
      expect(miss.message).toContain(miss.key)
      expect(miss.message).toMatch(/record-new/)
      return true
    })
    expect(executed).toBe(false)
  })
})

describe('cassette session — refresh', () => {
  it('re-records exercised entries even when present', async () => {
    const path = await tempCassette()
    const recordSession = await openCassetteSession({
      path,
      mode: 'record-new',
    })
    await recordSession.intercept(call(), async () => loopOutcome('stale answer'))
    await recordSession.flush()

    const refreshSession = await openCassetteSession({ path, mode: 'refresh' })
    const result = (await refreshSession.intercept(call(), async () => loopOutcome('fresh answer'))) as ReturnType<typeof loopOutcome>
    expect(result.response.text).toBe('fresh answer')
    await refreshSession.flush()

    const replaySession = await openCassetteSession({
      path,
      mode: 'replay-strict',
    })
    const replayed = (await replaySession.intercept(call(), async () => loopOutcome('never'))) as ReturnType<typeof loopOutcome>
    expect(replayed.response.text).toBe('fresh answer')
  })
})

describe('cassette session — projection and redaction', () => {
  it('drops raw SDK objects from recorded entries; replayed outcomes carry raw: undefined', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'record-new' })
    await session.intercept(call(), async () => loopOutcome('x'))
    await session.flush()

    expect(await readFile(path, 'utf8')).not.toContain('sdkObject')

    const replaySession = await openCassetteSession({
      path,
      mode: 'replay-strict',
    })
    const replayed = (await replaySession.intercept(call(), async () => loopOutcome('never'))) as {
      raw: unknown
    }
    expect(replayed.raw).toBeUndefined()
  })

  it('redacts api keys and authorization material at write time, always', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'record-new' })
    await session.intercept(
      call({
        settings: {
          temperature: 0,
          apiKey: 'sk-super-secret',
          headers: { authorization: 'Bearer tok' },
        },
      }),
      async () => loopOutcome('x'),
    )
    await session.flush()

    const text = await readFile(path, 'utf8')
    expect(text).not.toContain('sk-super-secret')
    expect(text).not.toContain('Bearer tok')
  })

  it('records invalid structured attempts and revives them as ZodError-carrying attempts', async () => {
    const path = await tempCassette()
    const schema = z.object({ a: z.string() })
    const parsed = schema.safeParse({ a: 1 })
    const invalidAttempt = {
      status: 'invalid' as const,
      rawText: 'not json',
      error: (parsed as { error: z.ZodError }).error,
    }

    const session = await openCassetteSession({ path, mode: 'record-new' })
    await session.intercept(call({ kind: 'structured' }), async () => invalidAttempt)
    await session.flush()

    const replaySession = await openCassetteSession({
      path,
      mode: 'replay-strict',
    })
    const replayed = (await replaySession.intercept(call({ kind: 'structured' }), async () => invalidAttempt)) as {
      status: string
      rawText: string
      error: z.ZodError
    }
    expect(replayed.status).toBe('invalid')
    expect(replayed.rawText).toBe('not json')
    expect(replayed.error.issues.length).toBeGreaterThan(0)
  })

  it('does not record suspended outcomes — they pass through and miss next time', async () => {
    const path = await tempCassette()
    const suspended = {
      status: 'suspended' as const,
      reason: 'tool-approval' as const,
      pendingApprovals: [],
      assistantResponse: loopOutcome('x').response,
      messages: [],
      steps: 1,
    }
    const session = await openCassetteSession({ path, mode: 'record-new' })
    const result = (await session.intercept(call(), async () => suspended)) as {
      status: string
    }
    expect(result.status).toBe('suspended')
    await session.flush()

    const strict = await openCassetteSession({ path, mode: 'replay-strict' })
    await expect(strict.intercept(call(), async () => suspended)).rejects.toBeInstanceOf(CassetteMissError)
  })
})

describe('cassette session — staleness', () => {
  it('flags cassettes recorded more than 90 days ago', async () => {
    const path = await tempCassette()
    await mkdir(dirname(path), { recursive: true })
    const recordedAt = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString()
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        metadata: { recordedAt, sdkVersion: 'x', models: [] },
        entries: {},
      }),
    )

    const session = await openCassetteSession({ path, mode: 'replay-strict' })
    expect(session.staleSince).toBe(recordedAt)

    const fresh = await openCassetteSession({
      path: await tempCassette('fresh'),
      mode: 'record-new',
    })
    expect(fresh.staleSince).toBeUndefined()
  })
})
