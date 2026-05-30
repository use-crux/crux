import type { Guardrail, GuardrailContext, ChunkGuardrailResult } from './types'

/**
 * Create a `TransformStream<string, string>` that applies guardrails to streaming chunks.
 *
 * Guards declare their buffer strategy:
 * - `'none'` — `onChunk` runs per-chunk in real-time (v0 LLM Suspense pattern)
 * - `'full'` — chunks are accumulated; `validate` runs after stream completes (v0 Autofixer pattern)
 *
 * Mixed strategies are supported: `buffer: 'none'` guards process chunks in real-time,
 * while `buffer: 'full'` guards wait for the complete stream then run in `flush()`.
 *
 * **Hold pattern**: A guard can return `{ action: 'hold' }` to prevent emission and
 * merge the current chunk into the next `onChunk` call. This enables cross-chunk
 * transforms (e.g., fixing an import statement that spans multiple tokens).
 * Each guard has its own independent hold buffer. On stream end, any held
 * content is flushed unchanged.
 */
export function createStreamGuardrailTransform(
  guards: readonly Guardrail<'output'>[],
  ctx: GuardrailContext,
): TransformStream<string, string> {
  const noneGuards = guards.filter((g) => g.stream?.buffer === 'none' && g.onChunk)
  const fullGuards = guards.filter((g) => g.stream?.buffer === 'full')

  let accumulated = ''
  let emittedLength = 0

  // Per-guard hold buffers
  const holdBuffers = new Map<string, string>()

  return new TransformStream<string, string>({
    async transform(chunk, controller) {
      accumulated += chunk
      let currentChunk = chunk
      let held = false

      for (const guard of noneGuards) {
        // Prepend any held content from this guard's buffer
        const heldContent = holdBuffers.get(guard.name) ?? ''
        const guardInput = heldContent + currentChunk

        const result: ChunkGuardrailResult = await guard.onChunk!(guardInput, accumulated, ctx)

        switch (result.action) {
          case 'pass':
            holdBuffers.delete(guard.name)
            currentChunk = guardInput
            break

          case 'hold':
            holdBuffers.set(guard.name, guardInput)
            held = true
            break

          case 'transform':
          case 'redact':
            holdBuffers.delete(guard.name)
            accumulated = accumulated.slice(0, accumulated.length - guardInput.length) + result.content
            currentChunk = result.content
            break

          case 'block':
            holdBuffers.delete(guard.name)
            controller.error(
              new Error(`Stream blocked by guardrail "${guard.name}": ${(result as { reason?: string }).reason ?? 'blocked'}`),
            )
            return

          case 'warn':
            holdBuffers.delete(guard.name)
            currentChunk = guardInput
            break
        }

        // If any guard held, don't emit and skip remaining guards
        if (held) return
      }

      // If no full-buffer guards, emit chunk immediately
      if (fullGuards.length === 0) {
        controller.enqueue(currentChunk)
        emittedLength += currentChunk.length
      }
    },

    async flush(controller) {
      // If there's unemitted content (from holds or full-buffer guards), handle it
      const unemitted = accumulated.slice(emittedLength)
      holdBuffers.clear()

      if (fullGuards.length === 0) {
        // No full-buffer guards — emit any content that was held at stream end
        if (unemitted.length > 0) {
          controller.enqueue(unemitted)
        }
        return
      }

      // Run buffer:'full' guards on the complete accumulated text
      let content = accumulated

      for (const guard of fullGuards) {
        const result = await guard.validate(content, ctx)

        switch (result.action) {
          case 'pass':
            break

          case 'redact':
          case 'transform':
            content = result.content
            break

          case 'block':
            controller.error(new Error(`Stream blocked by guardrail "${guard.name}": ${result.reason}`))
            return

          case 'warn':
            break

        }
      }

      controller.enqueue(content)
    },
  })
}
