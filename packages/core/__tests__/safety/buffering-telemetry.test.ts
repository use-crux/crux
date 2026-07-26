/**
 * Buffering attribution without content leakage (RFC #173, Phase 17).
 *
 * A user must be able to see WHY output is withheld — in a UI and in telemetry —
 * without the held bytes, the candidate, or the corrective feedback ever appearing in
 * that channel.
 *
 * @module
 */

import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { boundary, createSafety } from '../../src/safety'
import { constraint } from '../../src/safety/constraint'
import { openSafetySessionStructuredStream } from '../../src/safety/session'
import { resetHooks } from '../../src/runtime/runtime'
import { resetObservabilityRuntime, subscribeObservability } from '../../src/observability'

afterEach(() => {
  resetHooks()
  resetObservabilityRuntime()
})

const SECRET = 'super-secret-title'

function gatedSession() {
  return createSafety({
    promptId: 'p',
    model: 'm',
    call: {
      constraints: [
        constraint({
          id: 'title-long-enough',
          on: boundary.output.object<{ title: string; count: number }>(),
          run: (obj: { title: string; count: number }) =>
            obj.count > 0 ? { pass: true } : { pass: false, feedback: `rejected ${SECRET}` },
        }),
      ],
    },
  })
}

describe('buffering attribution', () => {
  it('reports a content-free bufferedBy reason while a commit gate holds', async () => {
    const stream = openSafetySessionStructuredStream(gatedSession(), {})
    const directive = await stream.feed(`{"title":"${SECRET}"`)
    expect(directive.kind).toBe('hold')
    if (directive.kind === 'hold') {
      // The reason names the gate, not the content.
      expect(directive.bufferedBy).toBe('constraint')
      expect(JSON.stringify(directive)).not.toContain(SECRET)
    }
  })

  it('records the gate in the transcript without any held content', async () => {
    const safety = gatedSession()
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed(`{"title":"${SECRET}",`)
    await stream.feed('"count":1}')
    await stream.finish()
    const transcript = JSON.stringify(safety.transcript)
    // The transcript explains the buffering...
    expect(transcript).toContain('bufferedBy')
    expect(transcript).toContain('constraint')
    // ...but never carries the operation content.
    expect(transcript).not.toContain(SECRET)
  })

  it('never puts streamed candidate content into telemetry', async () => {
    const records: unknown[] = []
    subscribeObservability(['span:start', 'span:end'], (record) => records.push(record))

    // Feedback here is pure author prose with no model content interpolated.
    const safety = createSafety({
      promptId: 'p',
      model: 'm',
      call: {
        constraints: [
          constraint({
            id: 'count-positive',
            on: boundary.output.object<{ title: string; count: number }>(),
            run: (obj: { title: string; count: number }) =>
              obj.count > 0 ? { pass: true } : { pass: false, feedback: 'count must be positive' },
          }),
        ],
      },
    })
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed(`{"title":"${SECRET}","count":0}`)
    await stream.finish().catch(() => undefined)

    // Crux records the policy decision, never the model's streamed content.
    const telemetry = JSON.stringify(records)
    expect(telemetry).toContain('count-positive')
    expect(telemetry).not.toContain(SECRET)
  })

  // Authored `feedback` is policy prose that commonly echoes the model's own output, so
  // it is NOT recorded. Only its length is, which explains that feedback drove a retry
  // without carrying any of it.
  it('records feedback length but never the feedback text', async () => {
    const records: unknown[] = []
    subscribeObservability(['span:end'], (record) => records.push(record))
    const safety = gatedSession() // its feedback embeds SECRET on purpose
    const stream = openSafetySessionStructuredStream(safety, {})
    await stream.feed(`{"title":"x","count":0}`)
    await stream.finish().catch(() => undefined)
    const serialized = JSON.stringify(records)
    expect(serialized).not.toContain('rejected ')
    expect(serialized).not.toContain(SECRET)
    expect(serialized).toContain('feedbackLength')
  })
})

// A schema is not needed for these gates, but keep zod imported-and-used so the file
// mirrors real structured usage rather than drifting into a text-only fixture.
void z
