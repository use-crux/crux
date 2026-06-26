import type { SafetyStream } from '@use-crux/core/safety'

/** Structural shape of the AI SDK `TextStreamPart`s the safety transform touches. */
interface SafetyTransformPart {
  readonly type?: string
  readonly id?: string
  readonly text?: string
  readonly finishReason?: string
  readonly [key: string]: unknown
}

/**
 * Mount core's safety streaming sub-protocol as an AI SDK stream transform.
 *
 * Every text delta is fed into core safety; emitted content is forwarded,
 * held content is swallowed, and the seal's pending tail is released before
 * the final `finish-step` so the SDK records it in `onFinish.text`.
 *
 * @internal
 */
export function createSafetyStreamTransform(
  safety: SafetyStream,
): () => TransformStream<SafetyTransformPart, SafetyTransformPart> {
  return () => {
    let sealed = false
    const releasePending = async (controller: TransformStreamDefaultController<SafetyTransformPart>) => {
      if (sealed) return
      sealed = true
      const seal = await safety.finish()
      if (seal.pending.length > 0) {
        const id = 'crux-safety'
        controller.enqueue({ type: 'text-start', id })
        controller.enqueue({ type: 'text-delta', id, text: seal.pending })
        controller.enqueue({ type: 'text-end', id })
      }
    }

    return new TransformStream<SafetyTransformPart, SafetyTransformPart>({
      async transform(part, controller) {
        if (part?.type === 'text-delta' && typeof part.text === 'string') {
          const directive = await safety.feed(part.text)
          if (directive.kind === 'hold') return
          if (directive.content.length > 0) controller.enqueue({ ...part, text: directive.content })
          return
        }
        if (part?.type === 'finish-step' && part.finishReason !== 'tool-calls') {
          await releasePending(controller)
        }
        controller.enqueue(part)
      },
      async flush(controller) {
        await releasePending(controller)
      },
    })
  }
}
