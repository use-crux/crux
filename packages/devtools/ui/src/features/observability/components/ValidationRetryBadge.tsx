import { Chip } from "@/devtools/shell/primitives";
import { AlertTriangleIcon, XCircleIcon, WrenchIcon } from "lucide-react";

/** Props for a single validation retry attempt display. */
interface ValidationRetryAttemptProps {
  attemptNumber: number;
  maxAttempts: number;
  error: string;
  repairAttempted: boolean;
  repairSucceeded: boolean;
}

/** Props for the ValidationRetryBadge component. */
interface ValidationRetryBadgeProps {
  /** 'attempt' for in-progress retry, 'exhausted' for all retries failed, 'repaired' for text-repair success. */
  status: "attempt" | "exhausted" | "repaired";
  /** Current attempt number (for 'attempt' status). */
  attemptNumber?: number;
  /** Maximum configured retries. */
  maxAttempts?: number;
  className?: string;
}

/**
 * Badge indicating validation retry status in the trace timeline.
 * Shows attempt progress, text repair success, or exhaustion failure.
 * Uses the shared `Chip` primitive (tone-driven) per the design system.
 */
export function ValidationRetryBadge({
  status,
  attemptNumber,
  maxAttempts,
  className,
}: ValidationRetryBadgeProps) {
  if (status === "repaired") {
    return (
      <Chip tone="ok" className={className}>
        <WrenchIcon className="h-3 w-3" />
        text repaired
      </Chip>
    );
  }

  if (status === "exhausted") {
    return (
      <Chip tone="danger" className={className}>
        <XCircleIcon className="h-3 w-3" />
        retries exhausted
      </Chip>
    );
  }

  return (
    <Chip tone="warn" className={className}>
      <AlertTriangleIcon className="h-3 w-3" />
      retry {attemptNumber}/{maxAttempts}
    </Chip>
  );
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
    <div className="flex items-start gap-2 rounded-md border border-(--devtools-warn-soft) bg-(--devtools-warn-soft) p-2 text-sm">
      <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-(--devtools-warn)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-(--devtools-warn)">
            Validation retry {attemptNumber}/{maxAttempts}
          </span>
          {repairAttempted && (
            <Chip tone={repairSucceeded ? "ok" : "danger"}>
              <WrenchIcon className="h-2.5 w-2.5" />
              {repairSucceeded ? "repaired" : "repair failed"}
            </Chip>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-(--devtools-fg-muted)">{error}</p>
      </div>
    </div>
  );
}

/** Displays the exhaustion state when all validation retries failed. */
export function ValidationRetryExhaustedRow({
  totalAttempts,
  lastError,
  promptId,
}: {
  totalAttempts: number;
  lastError: string;
  promptId: string;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-(--devtools-danger-soft) bg-(--devtools-danger-soft) p-2 text-sm">
      <XCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-(--devtools-danger)" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-(--devtools-danger)">
            Validation retries exhausted
          </span>
          <Chip tone="muted">{totalAttempts} attempts</Chip>
        </div>
        <p className="mt-1 text-xs text-(--devtools-fg-muted)">
          Prompt:{" "}
          <code className="rounded bg-(--devtools-bg-muted) px-1">{promptId}</code>
        </p>
        <p className="mt-0.5 truncate text-xs text-(--devtools-danger)">
          {lastError}
        </p>
      </div>
    </div>
  );
}
