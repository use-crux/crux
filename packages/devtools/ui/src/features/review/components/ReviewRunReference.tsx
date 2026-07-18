import { Chip } from "@/devtools/shell/primitives";
import type { ReviewProjection } from "../types";

export function ReviewRunReference({
  runId,
  contextStatus,
  onOpen,
}: {
  readonly runId: string;
  readonly contextStatus: ReviewProjection["contextStatus"];
  readonly onOpen: () => void;
}) {
  if (contextStatus === "linked") {
    return (
      <button
        type="button"
        aria-label={`Open observed run ${runId}`}
        onClick={onOpen}
        className="ml-2 cursor-pointer font-mono underline"
        style={{ color: "var(--devtools-crux)" }}
      >
        {runId}
      </button>
    );
  }

  return (
    <span className="ml-2 inline-flex flex-wrap items-center gap-2">
      <span className="select-text font-mono">{runId}</span>
      <Chip tone="warn">Run evidence unavailable locally</Chip>
    </span>
  );
}
