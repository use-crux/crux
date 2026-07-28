/** Physical provider-attempt timeline for media Runs. */

import type { MediaRunAttempt } from "../lib/media-run-projection";

/** Render physical provider attempts without duplicating the logical root. */
export function MediaRunAttemptTimeline({
  attempts,
}: {
  readonly attempts: readonly MediaRunAttempt[];
}) {
  if (attempts.length === 0) {
    return (
      <div aria-label="Attempt timeline" className="grid gap-1">
        <h4 className="text-xs font-medium text-(--devtools-fg-muted)">
          Physical attempts
        </h4>
        <p role="status" className="text-xs text-(--devtools-fg-muted)">
          No attempts recorded.
        </p>
      </div>
    );
  }

  const byId = new Map(attempts.map((attempt) => [attempt.spanId, attempt]));
  return (
    <div aria-label="Attempt timeline" className="grid gap-1">
      <h4 className="text-xs font-medium text-(--devtools-fg-muted)">
        Physical attempts
      </h4>
      <ol className="grid gap-1 text-xs">
        {attempts.map((attempt) => {
          const depth = attemptDepth(attempt, byId);
          const parent = attempt.parentSpanId
            ? byId.get(attempt.parentSpanId)
            : undefined;
          return (
            <li
              key={attempt.spanId}
              data-depth={depth}
              className={
                depth > 0
                  ? `border-l border-(--devtools-border) ${depth >= 2 ? "depth-2" : "depth-1"}`
                  : "depth-0"
              }
              style={depth > 0 ? { paddingLeft: depth * 12 } : undefined}
            >
              <span>
                {depth > 0 ? "↳ " : ""}
                {attempt.primitive}
                {attempt.attempt !== undefined
                  ? ` · attempt ${attempt.attempt}`
                  : ""}
                {parent ? ` (child of ${parent.primitive})` : ""}
              </span>
              <span className="text-(--devtools-fg-muted)">
                {" · "}
                {[
                  attempt.provider,
                  attempt.model,
                  attempt.terminal ?? attempt.status,
                  attempt.committed === undefined
                    ? undefined
                    : attempt.committed
                      ? "committed"
                      : "not committed",
                  attempt.durationMs !== undefined
                    ? `${attempt.durationMs}ms`
                    : undefined,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              <AttemptProgress attempt={attempt} />
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Render only the closed progressive scalar facts projected for one attempt. */
function AttemptProgress({ attempt }: { readonly attempt: MediaRunAttempt }) {
  const facts = [
    countLabel(attempt.previewCount, "preview"),
    countLabel(attempt.deltaCount, "delta"),
    countLabel(attempt.finalCount, "final"),
    attempt.byteCount !== undefined
      ? `${attempt.byteCount.toLocaleString("en-US")} bytes`
      : undefined,
    ...(attempt.mediaTypes ?? []),
  ].filter((fact): fact is string => fact !== undefined);
  if (facts.length === 0) return null;
  return (
    <div
      aria-label={`Attempt ${attempt.attempt ?? attempt.spanId} stream facts`}
      className="text-(--devtools-fg-muted)"
    >
      {facts.join(" · ")}
    </div>
  );
}

function countLabel(
  value: number | undefined,
  noun: string,
): string | undefined {
  if (value === undefined) return undefined;
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}

function attemptDepth(
  attempt: MediaRunAttempt,
  byId: ReadonlyMap<string, MediaRunAttempt>,
): number {
  let depth = 0;
  let parentId = attempt.parentSpanId ?? undefined;
  const seen = new Set<string>();
  while (parentId && byId.has(parentId) && !seen.has(parentId)) {
    seen.add(parentId);
    depth += 1;
    parentId = byId.get(parentId)?.parentSpanId ?? undefined;
  }
  return depth;
}
