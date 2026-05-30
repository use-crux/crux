import { Badge } from '@/shared/components/ui/badge'
import { AlertTriangleIcon, CheckCircleIcon, XCircleIcon, WrenchIcon } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/** Props for a single validation retry attempt display. */
interface ValidationRetryAttemptProps {
  attemptNumber: number
  maxAttempts: number
  error: string
  repairAttempted: boolean
  repairSucceeded: boolean
}

/** Props for the ValidationRetryBadge component. */
interface ValidationRetryBadgeProps {
  /** 'attempt' for in-progress retry, 'exhausted' for all retries failed, 'repaired' for text-repair success. */
  status: 'attempt' | 'exhausted' | 'repaired'
  /** Current attempt number (for 'attempt' status). */
  attemptNumber?: number
  /** Maximum configured retries. */
  maxAttempts?: number
  className?: string
}

/**
 * Badge indicating validation retry status in the trace timeline.
 * Shows attempt progress, text repair success, or exhaustion failure.
 */
export function ValidationRetryBadge({ status, attemptNumber, maxAttempts, className }: ValidationRetryBadgeProps) {
  if (status === 'repaired') {
    return (
      <Badge variant="outline" className={cn('gap-1 border-green-500/30 bg-green-500/10 text-green-400', className)}>
        <WrenchIcon className="h-3 w-3" />
        text repai
      </Badge>
    )
  }

  if (status === 'exhausted') {
    return (
      <Badge variant="outline" className={cn('gap-1 border-red-500/30 bg-red-500/10 text-red-400', className)}>
        <XCircleIcon className="h-3 w-3" />
        retries exhausted
      </Badge>
    )
  }

  return (
    <Badge variant="outline" className={cn('gap-1 border-amber-500/30 bg-amber-500/10 text-amber-400', className)}>
      <AlertTriangleIcon className="h-3 w-3" />
      retry {attemptNumber}/{maxAttempts}
    </Badge>
  )
}

/** Displays a validation retry attempt detail row in the trace event list. */
export function ValidationRetryAttemptRow({
  attemptNumber,
  maxAttempts,
  error,
  repairAttempted,
  repairSucceeded,
}: ValidationRetryAttemptProps) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-amber-500/20 bg-amber-500/5 p-2 text-sm">
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-amber-300">
            Validation retry {attemptNumber}/{maxAttempts}
          </span>
          {repairAttempted && (
            <Badge variant="outline" className="h-5 gap-1 text-xs">
              <WrenchIcon className="h-2.5 w-2.5" />
              {repairSucceeded ? 'repaired' : 'repair failed'}
            </Badge>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{error}</p>
      </div>
    </div>
  )
}

/** Displays the exhaustion state when all validation retries failed. */
export function ValidationRetryExhaustedRow({
  totalAttempts,
  lastError,
  promptId,
}: {
  totalAttempts: number
  lastError: string
  promptId: string
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-red-500/20 bg-red-500/5 p-2 text-sm">
      <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-red-300">Validation retries exhausted</span>
          <Badge variant="outline" className="h-5 text-xs">
            {totalAttempts} attempts
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Prompt: <code className="rounded bg-muted px-1">{promptId}</code>
        </p>
        <p className="mt-0.5 truncate text-xs text-red-400/80">{lastError}</p>
      </div>
    </div>
  )
}
