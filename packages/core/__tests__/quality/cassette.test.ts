import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  CassetteMissError,
  cassettePath,
  normalizedCallKey,
  openCassetteSession,
} from '../../quality/internal/cassette'
import type { InterceptedGeneration } from '../../adapter/interception'

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
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
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
})

describe('cassette session — record-new', () => {
  it('executes misses live, records them, and replays hits without executing', async () => {
    const path = await tempCassette()
    const recordSession = await openCassetteSession({ path, mode: 'record-new' })
    let liveCalls = 0
    const execute = async () => {
      liveCalls++
      return loopOutcome('live answer')
    }

    const first = (await recordSession.intercept(call(), execute)) as ReturnType<typeof loopOutcome>
    expect(first.response.text).toBe('live answer')
    expect(liveCalls).toBe(1)
    await recordSession.flush()

    const replaySession = await openCassetteSession({ path, mode: 'record-new' })
    const second = (await replaySession.intercept(call(), execute)) as ReturnType<typeof loopOutcome>
    expect(liveCalls).toBe(1) // served from the cassette
    expect(second.response.text).toBe('live answer')
    expect(second.messages).toHaveLength(2)
    expect(second.status).toBe('complete')
    expect(replaySession.stats).toMatchObject({ hits: 1, misses: 0 })
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
})

describe('cassette session — replay-strict', () => {
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
    const recordSession = await openCassetteSession({ path, mode: 'record-new' })
    await recordSession.intercept(call(), async () => loopOutcome('stale answer'))
    await recordSession.flush()

    const refreshSession = await openCassetteSession({ path, mode: 'refresh' })
    const result = (await refreshSession.intercept(call(), async () => loopOutcome('fresh answer'))) as ReturnType<
      typeof loopOutcome
    >
    expect(result.response.text).toBe('fresh answer')
    await refreshSession.flush()

    const replaySession = await openCassetteSession({ path, mode: 'replay-strict' })
    const replayed = (await replaySession.intercept(call(), async () => loopOutcome('never'))) as ReturnType<
      typeof loopOutcome
    >
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

    const replaySession = await openCassetteSession({ path, mode: 'replay-strict' })
    const replayed = (await replaySession.intercept(call(), async () => loopOutcome('never'))) as {
      raw: unknown
    }
    expect(replayed.raw).toBeUndefined()
  })

  it('redacts api keys and authorization material at write time, always', async () => {
    const path = await tempCassette()
    const session = await openCassetteSession({ path, mode: 'record-new' })
    await session.intercept(
      call({ settings: { temperature: 0, apiKey: 'sk-super-secret', headers: { authorization: 'Bearer tok' } } }),
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

    const replaySession = await openCassetteSession({ path, mode: 'replay-strict' })
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
    const result = (await session.intercept(call(), async () => suspended)) as { status: string }
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
      JSON.stringify({ version: 1, metadata: { recordedAt, sdkVersion: 'x', models: [] }, entries: {} }),
    )

    const session = await openCassetteSession({ path, mode: 'replay-strict' })
    expect(session.staleSince).toBe(recordedAt)

    const fresh = await openCassetteSession({ path: await tempCassette('fresh'), mode: 'record-new' })
    expect(fresh.staleSince).toBeUndefined()
  })
})
