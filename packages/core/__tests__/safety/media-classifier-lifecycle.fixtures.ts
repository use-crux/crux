import type { GenerateObjectFn } from '../../src/generation/support-types'
import {
  guardrail,
  type MediaClassifierAction,
  type MediaClassifierModality,
  type MediaClassifierUnsupportedAction,
  type MediaPart,
} from '../../src/safety'

interface ClassifierHarnessOptions {
  readonly score?: (part: MediaPart, callIndex: number) => number
  readonly action?: MediaClassifierAction
  readonly error?: Error
  readonly modalities?: readonly [
    MediaClassifierModality,
    ...MediaClassifierModality[],
  ]
  readonly unsupported?: MediaClassifierUnsupportedAction
}

/** Build a deterministic public classifier body and capture disclosed parts. */
export function classifierHarness(
  options: ClassifierHarnessOptions = {},
) {
  const parts: MediaPart[] = []
  const models: unknown[] = []
  const generate: GenerateObjectFn = async (call) => {
    if (call.messages === undefined) {
      throw new Error('media classifier must use canonical messages')
    }
    const message = call.messages[0]
    const content = message?.content
    if (
      message?.role !== 'user' ||
      !Array.isArray(content) ||
      content.length !== 2
    ) {
      throw new Error('media classifier must disclose one rubric and one part')
    }
    const part = content[1]
    if (!part || part.type === 'text') {
      throw new Error('media classifier call has no media part')
    }
    const callIndex = parts.length
    parts.push(part)
    models.push(call.model)
    if (options.error) throw options.error
    return {
      object: call.schema.parse({
        scores: {
          unsafe: options.score?.(part, callIndex) ?? 0,
        },
      }),
    }
  }
  const run = guardrail.mediaClassifier({
    generate,
    model: 'classifier-model',
    categories: [{ id: 'unsafe', description: 'Unsafe media content.' }],
    threshold: 0.8,
    ...(options.action ? { action: options.action } : {}),
    ...(options.modalities ? { modalities: options.modalities } : {}),
    ...(options.unsupported ? { unsupported: options.unsupported } : {}),
  })
  return {
    generate,
    run,
    parts,
    models,
    get calls() {
      return parts.length
    },
  }
}
