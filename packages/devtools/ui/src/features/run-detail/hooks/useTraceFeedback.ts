import { useCallback, useState } from 'react'
import { qualityService } from '@/shared/services/quality'

export type FeedbackStatus = 'idle' | 'saving' | 'saved' | 'error'

export function useTraceFeedback(traceId: string) {
  const [feedbackStatus, setFeedbackStatus] = useState<FeedbackStatus>('idle')

  const recordFeedback = useCallback(
    async (rating: -1 | 1) => {
      const comment =
        rating < 0
          ? (window.prompt('What should be fixed before this becomes a regression case?') ?? undefined)
          : undefined

      setFeedbackStatus('saving')
      try {
        await qualityService.recordFeedback({
          traceId,
          rating,
          comment,
          tags: rating < 0 ? ['needs-review'] : ['positive'],
        })
        setFeedbackStatus('saved')
      } catch {
        setFeedbackStatus('error')
      }
    },
    [traceId],
  )

  return { feedbackStatus, recordFeedback }
}
