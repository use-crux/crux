/**
 * Stateless batch message summarization.
 *
 * Takes a `Message[]` array and produces a compact text summary using an LLM.
 * Framework-agnostic — accepts any SDK's generate function.
 *
 * @module
 */

import type { CompactionResult } from '../generation/messages'
import type { SummarizeConfig } from './types'
import { countTokens } from '../shared/tokenizer'
import { observe } from '../observability'

/**
 * Format messages into a numbered conversation transcript for the LLM.
 */
export function formatTranscript(messages: SummarizeConfig['messages']): string {
  return messages.map((m, i) => `[${i + 1}] ${m.role}: ${m.content}`).join('\n\n')
}

/**
 * Summarize a batch of messages into a compact text summary.
 *
 * @param config - Summarization configuration including messages, generate fn, and model.
 * @returns A `CompactionResult` with the summary text and token metrics.
 */
export async function summarizeMessages(config: SummarizeConfig): Promise<CompactionResult> {
  const { messages, generate, model, maxTokens = 500, focus } = config
  const span = observe.openSpan({
    name: 'compaction.summarize',
    family: 'compaction',
    primitive: 'compaction.run',
    attributes: {
      compactionKind: 'summary',
      messageCount: messages.length,
      model: modelLabel(model),
      maxTokens,
      focus,
    },
  })

  try {
    const result = await span.withContext(async () => {
      if (messages.length === 0) {
        const empty = { summary: '', tokensBefore: 0, tokensAfter: 0, ratio: 1 }
        emitSummaryArtifact(span.spanId, empty, { model, maxTokens, focus, messageCount: 0 })
        return empty
      }

      const transcript = formatTranscript(messages)
      const tokensBefore = countTokens(transcript)

      const focusInstruction = focus?.length ? `\n\nPrioritize these aspects: ${focus.join(', ')}.` : ''

      const system = [
        'You are a conversation summarizer. Produce a concise summary of the conversation below.',
        `Keep the summary under ${maxTokens} tokens.`,
        'Preserve key information: decisions made, facts established, tool results, and user preferences.',
        'Do not add information that is not in the conversation.',
        focusInstruction,
      ].join(' ')

      const { text } = await generate({
        model,
        system,
        prompt: transcript,
      })

      const tokensAfter = countTokens(text)

      const summary = {
        summary: text,
        tokensBefore,
        tokensAfter,
        ratio: tokensBefore > 0 ? tokensAfter / tokensBefore : 1,
      }
      emitSummaryArtifact(span.spanId, summary, { model, maxTokens, focus, messageCount: messages.length })
      return summary
    })
    span.end({
      attributes: {
        compactionKind: 'summary',
        messageCount: messages.length,
        model: modelLabel(model),
        maxTokens,
        focus,
        tokensBefore: result.tokensBefore,
        tokensAfter: result.tokensAfter,
        compressionRatio: result.ratio,
      },
    })
    return result
  } catch (error) {
    span.error(error, {
      compactionKind: 'summary',
      messageCount: messages.length,
      model: modelLabel(model),
      maxTokens,
      focus,
    })
    throw error
  }
}

function emitSummaryArtifact(
  spanId: ReturnType<typeof observe.openSpan>['spanId'],
  result: CompactionResult,
  attributes: { model: unknown; maxTokens: number; focus?: string[]; messageCount: number },
): void {
  const artifactId = observe.artifact({
    kind: 'compaction.report',
    contentType: 'application/json',
    encoding: 'json',
    preview: {
      kind: 'compaction.report',
      strategy: 'summary',
      summarizedPreview: result.summary.slice(0, 500),
      summaryPreview: result.summary.slice(0, 500),
      beforeTokens: result.tokensBefore,
      afterTokens: result.tokensAfter,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      compressionRatio: result.ratio,
      messageCount: attributes.messageCount,
      model: modelLabel(attributes.model),
      maxTokens: attributes.maxTokens,
      focus: attributes.focus,
    },
    attributes: {
      primitive: 'compaction.run',
      compactionKind: 'summary',
      messageCount: attributes.messageCount,
      model: modelLabel(attributes.model),
      maxTokens: attributes.maxTokens,
      focus: attributes.focus,
      tokensBefore: result.tokensBefore,
      tokensAfter: result.tokensAfter,
      compressionRatio: result.ratio,
    },
  })
  if (!artifactId) return
  observe.edge({
    edgeType: 'produced',
    from: { kind: 'span', id: spanId },
    to: { kind: 'artifact', id: artifactId },
    attributes: { primitive: 'compaction.run', compactionKind: 'summary' },
  })
}

function modelLabel(model: unknown): string {
  if (typeof model === 'string') return model
  if (model && typeof model === 'object') {
    const record = model as Record<string, unknown>
    if (typeof record.modelId === 'string') return record.modelId
    if (typeof record.id === 'string') return record.id
    if (typeof record.model === 'string') return record.model
  }
  return String(model)
}
