import type { FeedbackReceipt, FeedbackSubmission } from './types'

interface SubmitHttpFeedbackOptions {
  readonly fetchImpl: typeof globalThis.fetch
  readonly url: string
  readonly headers: Readonly<Record<string, string>>
  readonly timeoutMs: number
  readonly submission: FeedbackSubmission
}

/** Submit one normalized payload to the configured write-only HTTP route. @internal */
export async function submitHttpFeedback(
  options: SubmitHttpFeedbackOptions,
): Promise<FeedbackReceipt> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs)
  try {
    const response = await options.fetchImpl(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.submission),
      signal: controller.signal,
    })
    const decoded = await decodeJson(response)
    if (!response.ok) {
      throw new Error(
        `Feedback destination rejected the request (HTTP ${response.status}).`,
      )
    }
    return parseFeedbackReceipt(decoded)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith('Feedback destination')
    ) {
      throw error
    }
    throw new Error('Feedback destination request failed')
  } finally {
    clearTimeout(timeout)
  }
}

function parseFeedbackReceipt(value: unknown): FeedbackReceipt {
  if (
    !isRecord(value) ||
    typeof value.feedbackId !== 'string' ||
    typeof value.reviewId !== 'string' ||
    !Number.isInteger(value.revision) ||
    (value.revision as number) < 1 ||
    (value.status !== 'created' &&
      value.status !== 'updated' &&
      value.status !== 'duplicate') ||
    typeof value.acceptedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.acceptedAt))
  ) {
    throw new Error('Feedback destination returned an invalid durable receipt.')
  }
  return {
    feedbackId: value.feedbackId,
    reviewId: value.reviewId,
    revision: value.revision as number,
    status: value.status,
    acceptedAt: value.acceptedAt,
  }
}

async function decodeJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(await response.text())
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}
