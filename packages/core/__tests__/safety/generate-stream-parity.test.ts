/**
 * Generate/stream parity through the shared text-occurrence replay engine.
 *
 * Explicit units (`.sentences()`/`.lines()`/`.segments()`) and rewrites produce
 * identical occurrences and output whether the text arrives as one complete
 * generate fragment or as arbitrary stream deltas. Adaptive text intentionally
 * differs: generate evaluates the complete text once; a stream evaluates per
 * canonical delta.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { boundary, createSafety, guardrail } from '../../src/safety'
import type { BoundaryInput } from '../../src/safety'
import { resetHooks } from '../../src/runtime/runtime'

afterEach(() => resetHooks())

type Recorder = { seen: string[]; output: string }

function recordingGuard(on: BoundaryInput, rewrite?: (s: string) => string) {
  const seen: string[] = []
  const guard = guardrail({
    id: 'rec',
    on: on as never,
    run: async (subject: string) => {
      seen.push(subject)
      return rewrite
        ? { action: 'rewrite' as const, value: rewrite(subject), rewrite: { kind: 'normalize' as const } }
        : { action: 'allow' as const }
    },
  })
  return { guard, seen }
}

async function viaGenerate(on: BoundaryInput, text: string, rewrite?: (s: string) => string): Promise<Recorder> {
  const { guard, seen } = recordingGuard(on, rewrite)
  const safety = createSafety({ promptId: 'p', model: 'm', call: { guardrails: [guard] } })
  const guarded = await safety.guardOutputTextParts([text])
  return { seen, output: guarded.join('') }
}

async function viaStream(
  on: BoundaryInput,
  deltas: readonly string[],
  rewrite?: (s: string) => string,
): Promise<Recorder> {
  const { guard, seen } = recordingGuard(on, rewrite)
  const safety = createSafety({ promptId: 'p', model: 'm', call: { guardrails: [guard] } })
  const stream = safety.openStream()
  let output = ''
  for (const delta of deltas) {
    const directive = await stream.feed(delta)
    if (directive.kind === 'emit') output += directive.content
  }
  const seal = await stream.finish()
  return { seen, output: output + seal.pending }
}

describe('explicit units: generate and stream agree', () => {
  const text = 'One. Two! Three?\nFourth line.'

  it('.sentences() sees identical occurrences and output', async () => {
    const gen = await viaGenerate(boundary.output.text().sentences(), text)
    const str = await viaStream(boundary.output.text().sentences(), text.split(''))
    expect(gen.seen).toEqual(str.seen)
    expect(gen.output).toBe(str.output)
    expect(gen.output).toBe(text)
  })

  it('.lines() sees identical occurrences and output', async () => {
    const gen = await viaGenerate(boundary.output.text().lines(), text)
    const str = await viaStream(boundary.output.text().lines(), [text.slice(0, 5), text.slice(5, 18), text.slice(18)])
    expect(gen.seen).toEqual(str.seen)
    expect(gen.output).toBe(str.output)
  })

  it('.segments() (custom) sees identical occurrences and output', async () => {
    const options = {
      maxCharacters: 100,
      next: (buffer: string, { final }: { final: boolean }) => {
        const index = buffer.indexOf('|')
        if (index >= 0) return index + 1
        return final ? buffer.length || undefined : undefined
      },
    }
    const piped = 'a|bb|ccc|tail'
    const gen = await viaGenerate(boundary.output.text().segments(options), piped)
    const str = await viaStream(boundary.output.text().segments(options), piped.split(''))
    expect(gen.seen).toEqual(str.seen)
    expect(gen.seen).toEqual(['a|', 'bb|', 'ccc|', 'tail'])
    expect(gen.output).toBe(str.output)
  })

  it('a .sentences() rewrite yields identical text in both modes', async () => {
    const upper = (s: string) => s.toUpperCase()
    const gen = await viaGenerate(boundary.output.text().sentences(), text, upper)
    const str = await viaStream(boundary.output.text().sentences(), text.split(''), upper)
    expect(gen.output).toBe(str.output)
    expect(gen.output).toBe(text.toUpperCase())
  })
})

describe('adaptive text differs by surface, by design', () => {
  const text = 'Alpha beta. Gamma delta.'

  it('generate evaluates the complete text once; stream evaluates per delta', async () => {
    const gen = await viaGenerate(boundary.output.text(), text)
    const deltas = ['Alpha ', 'beta. ', 'Gamma ', 'delta.']
    const str = await viaStream(boundary.output.text(), deltas)
    // Adaptive generate: one complete occurrence.
    expect(gen.seen).toEqual([text])
    // Adaptive stream: one occurrence per canonical delta.
    expect(str.seen).toEqual(deltas)
    // Released output is identical regardless of surface.
    expect(gen.output).toBe(str.output)
    expect(gen.output).toBe(text)
  })
})
