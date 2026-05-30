import { describe, it, expect } from 'vitest'
import { guardrail as makeGuardrail, isGuardrail } from '../safety/guardrail'
import { createGuardrailPipeline } from '../safety/guardrail/pipeline'
import { createGuardrailPlugin } from '../safety/guardrail/plugin'
import { createStreamGuardrailTransform } from '../safety/guardrail/stream'
import { evaluateGuardrail } from '../safety/guardrail/evaluate'
import { GuardrailBlockedError } from '../safety/guardrail/errors'
import type { GuardrailContext } from '../safety/guardrail'

describe('guardrail', () => {
  it('creates a frozen guardrail object with correct shape', () => {
    const guard = makeGuardrail({
      name: 'test-guard',
      phase: 'input',
      validate: async (content: string, _ctx: GuardrailContext) => {
        if (content.includes('bad')) return { action: 'block' as const, reason: 'Contains bad word' }
        return { action: 'pass' as const }
      },
    })

    expect(guard._tag).toBe('Guardrail')
    expect(guard.name).toBe('test-guard')
    expect(guard.phase).toBe('input')
    expect(typeof guard.validate).toBe('function')
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('infers phase from config — input guard cannot return reask', () => {
    // This test verifies the runtime shape. TypeScript compile-time enforcement
    // is tested by the type system itself (reask not in InputGuardrailResult).
    const guard = makeGuardrail({
      name: 'input-only',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(guard.phase).toBe('input')
  })

  it('creates output guard with all action types except reask', () => {
    const guard = makeGuardrail({
      name: 'output-filter',
      phase: 'output',
      validate: async (content: string) => {
        if (content.includes('toxic')) return { action: 'block' as const, reason: 'Toxic content' }
        return { action: 'pass' as const }
      },
    })

    expect(guard.phase).toBe('output')
    expect(Object.isFrozen(guard)).toBe(true)
  })

  it('supports stream config on output guards', () => {
    const guard = makeGuardrail({
      name: 'streaming-guard',
      phase: 'output',
      stream: { buffer: 'full' },
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(guard.stream).toEqual({ buffer: 'full' })
  })

  it('supports onChunk handler for streaming', () => {
    const guard = makeGuardrail({
      name: 'chunk-guard',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (_chunk, _accumulated, _ctx) => ({ action: 'pass' as const }),
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(typeof guard.onChunk).toBe('function')
  })
})

describe('isGuardrail', () => {
  it('returns true for guardrail objects', () => {
    const guard = makeGuardrail({
      name: 'test',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    expect(isGuardrail(guard)).toBe(true)
  })

  it('returns false for non-guardrail objects', () => {
    expect(isGuardrail(null)).toBe(false)
    expect(isGuardrail(undefined)).toBe(false)
    expect(isGuardrail({})).toBe(false)
    expect(isGuardrail({ _tag: 'Prompt' })).toBe(false)
    expect(isGuardrail('string')).toBe(false)
  })
})

// ── Pipeline: Input Guards ──────────────────────────────────────────

describe('createGuardrailPipeline — input guards', () => {
  const makeCtx = (overrides?: Partial<GuardrailContext>): GuardrailContext => ({
    phase: 'input',
    promptId: 'test-prompt',
    model: 'test-model',
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
    ...overrides,
  })

  it('passes content through when all guards return pass', async () => {
    const guard1 = makeGuardrail({
      name: 'pass-1',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })
    const guard2 = makeGuardrail({
      name: 'pass-2',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const pipeline = createGuardrailPipeline([guard1, guard2])
    const result = await pipeline.runInput('hello world', makeCtx())

    expect(result.content).toBe('hello world')
    expect(result.audit.blocked).toBe(false)
    expect(result.audit.applied).toHaveLength(2)
  })

  it('throws GuardrailBlockedError when a guard blocks', async () => {
    const blocker = makeGuardrail({
      name: 'blocker',
      phase: 'input',
      validate: async (content) => {
        if (content.includes('injection')) return { action: 'block' as const, reason: 'Prompt injection detected' }
        return { action: 'pass' as const }
      },
    })

    const pipeline = createGuardrailPipeline([blocker])

    await expect(pipeline.runInput('ignore previous injection', makeCtx())).rejects.toThrow(GuardrailBlockedError)
  })

  it('short-circuits on first block — subsequent guards do not run', async () => {
    let secondRan = false

    const blocker = makeGuardrail({
      name: 'blocker',
      phase: 'input',
      validate: async () => ({ action: 'block' as const, reason: 'blocked' }),
    })
    const second = makeGuardrail({
      name: 'second',
      phase: 'input',
      validate: async () => {
        secondRan = true
        return { action: 'pass' as const }
      },
    })

    const pipeline = createGuardrailPipeline([blocker, second])

    await expect(pipeline.runInput('test', makeCtx())).rejects.toThrow(GuardrailBlockedError)
    expect(secondRan).toBe(false)
  })

  it('redacted content flows forward to subsequent guards', async () => {
    const receivedBySecond: string[] = []

    const redactor = makeGuardrail({
      name: 'redactor',
      phase: 'input',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace(/badword/g, '[REDACTED]'),
      }),
    })
    const inspector = makeGuardrail({
      name: 'inspector',
      phase: 'input',
      validate: async (content) => {
        receivedBySecond.push(content)
        return { action: 'pass' as const }
      },
    })

    const pipeline = createGuardrailPipeline([redactor, inspector])
    const result = await pipeline.runInput('hello badword world', makeCtx())

    expect(result.content).toBe('hello [REDACTED] world')
    expect(receivedBySecond[0]).toBe('hello [REDACTED] world')
  })

  it('transformed content flows forward to subsequent guards', async () => {
    const transformer = makeGuardrail({
      name: 'transformer',
      phase: 'input',
      validate: async (content) => ({
        action: 'transform' as const,
        content: content.toUpperCase(),
      }),
    })
    const passThrough = makeGuardrail({
      name: 'pass',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const pipeline = createGuardrailPipeline([transformer, passThrough])
    const result = await pipeline.runInput('hello', makeCtx())

    expect(result.content).toBe('HELLO')
  })

  it('warn action logs but continues with unchanged content', async () => {
    const warnings: Array<{ guard: string; reason: string }> = []

    const warner = makeGuardrail({
      name: 'warner',
      phase: 'input',
      validate: async () => ({
        action: 'warn' as const,
        reason: 'Suspicious but not blocking',
      }),
    })

    const pipeline = createGuardrailPipeline([warner], {
      onWarn: (guard, detail) => warnings.push({ guard: guard.name, reason: (detail as any).reason }),
    })
    const result = await pipeline.runInput('test', makeCtx())

    expect(result.content).toBe('test')
    expect(result.audit.blocked).toBe(false)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]!.guard).toBe('warner')
  })

  it('records audit trail with durations for each guard', async () => {
    const guard = makeGuardrail({
      name: 'slow-guard',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const pipeline = createGuardrailPipeline([guard])
    const result = await pipeline.runInput('test', makeCtx())

    expect(result.audit.applied).toHaveLength(1)
    expect(result.audit.applied[0]!.guard).toBe('slow-guard')
    expect(result.audit.applied[0]!.action).toBe('pass')
    expect(typeof result.audit.applied[0]!.durationMs).toBe('number')
  })

  it('only runs input guards — output guards are skipped in runInput', async () => {
    let outputRan = false

    const inputGuard = makeGuardrail({
      name: 'input',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })
    const outputGuard = makeGuardrail({
      name: 'output',
      phase: 'output',
      validate: async () => {
        outputRan = true
        return { action: 'pass' as const }
      },
    })

    const pipeline = createGuardrailPipeline([inputGuard, outputGuard])
    await pipeline.runInput('test', makeCtx())

    expect(outputRan).toBe(false)
  })
})

// ── Pipeline: Output Guards + Redact/Transform Chaining ─────────────

describe('createGuardrailPipeline — output guards', () => {
  const makeCtx = (overrides?: Partial<GuardrailContext>): GuardrailContext => ({
    phase: 'output',
    promptId: 'test-prompt',
    model: 'test-model',
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
    ...overrides,
  })

  it('runs output guards and returns modified content', async () => {
    const piiGuard = makeGuardrail({
      name: 'pii',
      phase: 'output',
      validate: async (content) => {
        const redacted = content.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]')
        if (redacted !== content) return { action: 'redact' as const, content: redacted }
        return { action: 'pass' as const }
      },
    })

    const pipeline = createGuardrailPipeline([piiGuard])
    const result = await pipeline.runOutput('SSN is 123-45-6789', makeCtx())

    expect(result.content).toBe('SSN is [SSN]')
    expect(result.audit.applied[0]!.action).toBe('redact')
    expect(result.audit.applied[0]!.original).toBe('SSN is 123-45-6789')
  })

  it('chains redact then transform — each sees modified content', async () => {
    const redactor = makeGuardrail({
      name: 'redactor',
      phase: 'output',
      validate: async (content) => ({
        action: 'redact' as const,
        content: content.replace(/secret/g, '[REDACTED]'),
      }),
    })
    const formatter = makeGuardrail({
      name: 'formatter',
      phase: 'output',
      validate: async (content) => ({
        action: 'transform' as const,
        content: content.trim() + '.',
      }),
    })

    const pipeline = createGuardrailPipeline([redactor, formatter])
    const result = await pipeline.runOutput('the secret word', makeCtx())

    expect(result.content).toBe('the [REDACTED] word.')
    expect(result.audit.applied).toHaveLength(2)
    expect(result.audit.applied[0]!.action).toBe('redact')
    expect(result.audit.applied[1]!.action).toBe('transform')
  })

  it('only runs output guards — input guards are skipped in runOutput', async () => {
    let inputRan = false

    const inputGuard = makeGuardrail({
      name: 'input',
      phase: 'input',
      validate: async () => {
        inputRan = true
        return { action: 'pass' as const }
      },
    })
    const outputGuard = makeGuardrail({
      name: 'output',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })

    const pipeline = createGuardrailPipeline([inputGuard, outputGuard])
    await pipeline.runOutput('test', makeCtx())

    expect(inputRan).toBe(false)
  })
})

// ── Reask was removed — retry-with-feedback is now in makeConstraint() ──

// ── Scoping: per-context guardrails ───────────────────────────────

describe('context-level guardrails', () => {
  it('context() stores guardrails on frozen object', async () => {
    // Dynamic import to avoid circular issues in test
    const { context } = await import('../context')

    const guard = makeGuardrail({
      name: 'ctx-guard',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const ctx = context({
      system: 'Test context',
      guardrails: [guard],
    })

    expect(ctx.guardrails).toHaveLength(1)
    expect(ctx.guardrails[0]!.name).toBe('ctx-guard')
    expect(Object.isFrozen(ctx.guardrails)).toBe(true)
  })

  it('context() defaults to empty guardrails array', async () => {
    const { context } = await import('../context')

    const ctx = context({
      system: 'No guards',
    })

    expect(ctx.guardrails).toHaveLength(0)
  })
})

// ── Scoping: mergeGuardrails logic ────────────────────────────────

describe('guardrail merge strategy', () => {
  it('per-call guard overrides same-named global guard', () => {
    const globalGuard = makeGuardrail({
      name: 'shared',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const callGuard = makeGuardrail({
      name: 'shared',
      phase: 'output', // different phase to distinguish
      validate: async () => ({ action: 'pass' as const }),
    })

    // Simulate mergeGuardrails logic (per-call wins)
    const seen = new Map<string, typeof globalGuard>()
    for (const g of [globalGuard]) seen.set(g.name, g)
    for (const g of [callGuard]) seen.set(g.name, g)
    const merged = [...seen.values()]

    expect(merged).toHaveLength(1)
    expect(merged[0]!.phase).toBe('output') // call guard won
  })

  it('guards from different scopes with different names all appear', () => {
    const globalGuard = makeGuardrail({
      name: 'injection',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })
    const promptGuard = makeGuardrail({
      name: 'pii',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })
    const callGuard = makeGuardrail({
      name: 'toxicity',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })

    const seen = new Map<string, typeof globalGuard>()
    for (const g of [globalGuard]) seen.set(g.name, g)
    for (const g of [promptGuard]) seen.set(g.name, g)
    for (const g of [callGuard]) seen.set(g.name, g)
    const merged = [...seen.values()]

    expect(merged).toHaveLength(3)
    expect(merged.map((g) => g.name).sort()).toEqual(['injection', 'pii', 'toxicity'])
  })
})

// ── Plugin: asPlugin() middleware integration ───────────────────────

describe('createGuardrailPlugin', () => {
  it('returns a CruxPlugin with correct name', () => {
    const guard = makeGuardrail({
      name: 'test',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const plugin = createGuardrailPlugin([guard])

    expect(plugin.name).toBe('crux:guardrails')
    expect(typeof plugin.install).toBe('function')
  })

  it('install() returns globalGuardrails in the plugin result', () => {
    const guard = makeGuardrail({
      name: 'test',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const plugin = createGuardrailPlugin([guard])
    const result = plugin.install({} as any)

    expect(result.globalGuardrails).toBeDefined()
    expect(result.globalGuardrails).toHaveLength(1)
    expect(result.globalGuardrails![0]!.name).toBe('test')
  })

  it('globalGuardrails contains all provided guards', () => {
    const guard1 = makeGuardrail({
      name: 'guard-a',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })
    const guard2 = makeGuardrail({
      name: 'guard-b',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })

    const plugin = createGuardrailPlugin([guard1, guard2])
    const result = plugin.install({} as any)

    expect(result.globalGuardrails).toHaveLength(2)
    expect(result.globalGuardrails!.map((g: any) => g.name)).toEqual(['guard-a', 'guard-b'])
  })

  it('does not install middleware (guardrails run inline in adapter)', () => {
    const guard = makeGuardrail({
      name: 'test',
      phase: 'input',
      validate: async () => ({ action: 'pass' as const }),
    })

    const plugin = createGuardrailPlugin([guard])
    const result = plugin.install({} as any)

    expect(result.middleware).toBeUndefined()
  })
})

// ── Streaming: buffer orchestration ─────────────────────────────────

describe('createStreamGuardrailTransform — buffer: none', () => {
  const makeCtx = (): GuardrailContext => ({
    phase: 'output',
    promptId: 'test',
    model: 'test-model',
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
  })

  it('passes chunks through when onChunk returns pass', async () => {
    const guard = makeGuardrail({
      name: 'passthrough',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async () => ({ action: 'pass' as const }),
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const chunks = ['Hello ', 'world', '!']
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })

    await readable.pipeThrough(transform).pipeTo(writable)

    expect(output.join('')).toBe('Hello world!')
  })

  it('transforms chunks in real-time via onChunk', async () => {
    const guard = makeGuardrail({
      name: 'uppercaser',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (chunk) => ({
        action: 'transform' as const,
        content: chunk.toUpperCase(),
      }),
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const chunks = ['hello ', 'world']
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })

    await readable.pipeThrough(transform).pipeTo(writable)

    expect(output.join('')).toBe('HELLO WORLD')
  })

  it('provides accumulated text to onChunk', async () => {
    const accumulatedValues: string[] = []

    const guard = makeGuardrail({
      name: 'accumulator',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (_chunk, accumulated) => {
        accumulatedValues.push(accumulated)
        return { action: 'pass' as const }
      },
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const chunks = ['a', 'b', 'c']
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    expect(accumulatedValues).toEqual(['a', 'ab', 'abc'])
  })
})

describe('createStreamGuardrailTransform — buffer: full', () => {
  const makeCtx = (): GuardrailContext => ({
    phase: 'output',
    promptId: 'test',
    model: 'test-model',
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
  })

  it('buffers all chunks and runs validate on complete text', async () => {
    let validateCalledWith = ''

    const guard = makeGuardrail({
      name: 'full-buffer',
      phase: 'output',
      stream: { buffer: 'full' },
      validate: async (content) => {
        validateCalledWith = content
        return {
          action: 'redact' as const,
          content: content.replace(/secret/g, '[REDACTED]'),
        }
      },
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const chunks = ['the ', 'secret', ' word']
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    expect(validateCalledWith).toBe('the secret word')
    expect(output.join('')).toBe('the [REDACTED] word')
  })

  it('passes through unchanged when validate returns pass', async () => {
    const guard = makeGuardrail({
      name: 'pass-buffer',
      phase: 'output',
      stream: { buffer: 'full' },
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const chunks = ['hello ', 'world']
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk)
        controller.close()
      },
    })

    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    expect(output.join('')).toBe('hello world')
  })
})

// ── evaluateGuardrail() testing helper ──────────────────────────────

describe('evaluateGuardrail', () => {
  it('runs a guard against test cases and returns pass/fail', async () => {
    const guard = makeGuardrail({
      name: 'pii-test',
      phase: 'output',
      validate: async (content) => {
        if (/\d{3}-\d{2}-\d{4}/.test(content))
          return { action: 'redact' as const, content: content.replace(/\d{3}-\d{2}-\d{4}/g, '[SSN]') }
        return { action: 'pass' as const }
      },
    })

    const report = await evaluateGuardrail(guard, [
      { input: 'SSN is 123-45-6789', expect: 'redact' },
      { input: 'Hello world', expect: 'pass' },
      { input: 'Call 555-12-3456', expect: 'redact' },
    ])

    expect(report.results).toHaveLength(3)
    expect(report.results[0]!.passed).toBe(true)
    expect(report.results[0]!.action).toBe('redact')
    expect(report.results[1]!.passed).toBe(true)
    expect(report.results[1]!.action).toBe('pass')
    expect(report.results[2]!.passed).toBe(true)
    expect(report.results[2]!.action).toBe('redact')
    expect(report.summary.total).toBe(3)
    expect(report.summary.passed).toBe(3)
    expect(report.summary.failed).toBe(0)
  })

  it('reports failures when action does not match expectation', async () => {
    const guard = makeGuardrail({
      name: 'always-pass',
      phase: 'output',
      validate: async () => ({ action: 'pass' as const }),
    })

    const report = await evaluateGuardrail(guard, [{ input: 'anything', expect: 'block' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.action).toBe('pass')
    expect(report.results[0]!.expected).toBe('block')
    expect(report.summary.passed).toBe(0)
    expect(report.summary.failed).toBe(1)
  })

  it('handles guard errors gracefully', async () => {
    const guard = makeGuardrail({
      name: 'broken',
      phase: 'output',
      validate: async () => {
        throw new Error('Guard exploded')
      },
    })

    const report = await evaluateGuardrail(guard, [{ input: 'test', expect: 'pass' }])

    expect(report.results[0]!.passed).toBe(false)
    expect(report.results[0]!.error).toBe('Guard exploded')
    expect(report.summary.failed).toBe(1)
  })
})

// ── Streaming: hold action ──────────────────────────────────────────

describe('createStreamGuardrailTransform — hold', () => {
  const makeCtx = (): GuardrailContext => ({
    phase: 'output',
    promptId: 'test',
    model: 'test-model',
    messages: [],
    systemPrompt: undefined,
    traceId: undefined,
    metadata: {},
  })

  it('holds chunks and merges them into the next onChunk call', async () => {
    const chunksSeen: string[] = []

    const guard = makeGuardrail({
      name: 'holder',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (chunk) => {
        chunksSeen.push(chunk)
        // Hold the first chunk, pass the merged second
        if (chunk === 'hello ') return { action: 'hold' as const }
        return { action: 'pass' as const }
      },
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue('hello ')
        controller.enqueue('world')
        controller.close()
      },
    })
    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    // Guard was called twice: first with "hello ", then with "hello world" (merged)
    expect(chunksSeen).toEqual(['hello ', 'hello world'])
    // Only one emission: the merged chunk
    expect(output).toEqual(['hello world'])
  })

  it('holds multiple chunks then transforms on release', async () => {
    const guard = makeGuardrail({
      name: 'import-fixer',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (chunk) => {
        // Hold until we see a complete import
        if (/import\s*\{/.test(chunk) && !/'[^']*'/.test(chunk)) {
          return { action: 'hold' as const }
        }
        // Complete import — transform it
        const match = chunk.match(/import\s*\{([^}]+)\}\s*from\s*'([^']+)'/)
        if (match) {
          return { action: 'transform' as const, content: chunk.replace('BadIcon', 'GoodIcon') }
        }
        return { action: 'pass' as const }
      },
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue('import { BadIcon }')
        controller.enqueue(" from 'lucide-react'\n")
        controller.close()
      },
    })
    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    expect(output.join('')).toBe("import { GoodIcon } from 'lucide-react'\n")
  })

  it('flushes held content unchanged when stream ends during hold', async () => {
    const guard = makeGuardrail({
      name: 'infinite-holder',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async () => ({ action: 'hold' as const }),
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([guard], makeCtx())
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue('orphaned ')
        controller.enqueue('content')
        controller.close()
      },
    })
    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    // Held content flushed unchanged on stream end
    expect(output.join('')).toBe('orphaned content')
  })

  it('hold works with downstream guards — they see the merged chunk', async () => {
    const downstreamChunks: string[] = []

    const holder = makeGuardrail({
      name: 'holder',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (chunk) => {
        if (chunk === 'a') return { action: 'hold' as const }
        return { action: 'pass' as const }
      },
      validate: async () => ({ action: 'pass' as const }),
    })

    const observer = makeGuardrail({
      name: 'observer',
      phase: 'output',
      stream: { buffer: 'none' },
      onChunk: async (chunk) => {
        downstreamChunks.push(chunk)
        return { action: 'pass' as const }
      },
      validate: async () => ({ action: 'pass' as const }),
    })

    const transform = createStreamGuardrailTransform([holder, observer], makeCtx())
    const output: string[] = []

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue('a')
        controller.enqueue('b')
        controller.close()
      },
    })
    const writable = new WritableStream({
      write(chunk) {
        output.push(chunk)
      },
    })
    await readable.pipeThrough(transform).pipeTo(writable)

    // Observer only saw "ab" (merged), never saw "a" alone
    expect(downstreamChunks).toEqual(['ab'])
    expect(output.join('')).toBe('ab')
  })
})
