import { useNavigation } from "@/app/navigation/useNavigation";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { Btn, Chip } from "@/devtools/shell/primitives";
import { DevtoolsEmpty } from "@/devtools/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useReview, useReviewAction, useReviews } from "../hooks/useReview";
import { ReviewCaseEditor } from "./ReviewCaseEditor";
import { ReviewRunReference } from "./ReviewRunReference";
import { useEvalCatalog } from "@/features/evals/hooks/useEvals";

export function ReviewView({ reviewId }: { reviewId?: string }) {
  const { navigate } = useNavigation();
  const list = useReviews();
  const detail = useReview(reviewId);
  const action = useReviewAction(reviewId);
  const catalog = useEvalCatalog();
  const reviews = list.data ?? [];
  const projection = detail.data?.projection;

  return (
    <DevtoolsShell
      breadcrumb="Evals / Review"
      title="Review"
      subtitle={`${reviews.filter((item) => item.status === "open").length} open`}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          {list.isPending ? (
            <SkeletonRows rows={5} rowHeight={62} />
          ) : list.isError ? (
            <DevtoolsEmpty
              icon="alert"
              title="Review unavailable"
              body={list.error.message}
            />
          ) : reviews.length === 0 ? (
            <DevtoolsEmpty
              icon="inbox"
              title="Nothing to review"
              body="User feedback linked to an observed run will appear here."
            />
          ) : (
            reviews.map((item) => (
              <button
                key={item.reviewId}
                type="button"
                onClick={() =>
                  navigate({ view: "review", reviewId: item.reviewId })
                }
                className="block w-full cursor-pointer rounded-[9px] px-3.5 py-3 text-left hover:opacity-90"
                style={{
                  background: "var(--devtools-bg-elev)",
                  border: "1px solid var(--devtools-border)",
                }}
              >
                <div className="flex items-center gap-2">
                  <Chip tone={item.rating === "down" ? "danger" : "ok"}>
                    {item.rating}
                  </Chip>
                  <Chip tone={item.status === "open" ? "crux" : "muted"}>
                    {item.status}
                  </Chip>
                </div>
                <div className="mt-1.5 line-clamp-2 text-[12px]">
                  {item.comment || "No comment"}
                </div>
              </button>
            ))
          )}
        </div>
        <div
          className="rounded-[10px] p-4"
          style={{
            background: "var(--devtools-bg-elev)",
            border: "1px solid var(--devtools-border)",
          }}
        >
          {!reviewId ? (
            <p
              className="text-[13px]"
              style={{ color: "var(--devtools-fg-muted)" }}
            >
              Select feedback to inspect its bounded run context and action
              history.
            </p>
          ) : detail.isPending ? (
            <SkeletonRows rows={5} rowHeight={44} />
          ) : detail.isError ? (
            <DevtoolsEmpty
              icon="alert"
              title="Review unavailable"
              body={detail.error.message}
            />
          ) : (
            projection && (
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Chip tone={projection.status === "open" ? "crux" : "muted"}>
                    {projection.status}
                  </Chip>
                  <Chip tone="muted">context {projection.contextStatus}</Chip>
                  {projection.context?.model && (
                    <Chip tone="muted">{projection.context.model}</Chip>
                  )}
                </div>
                {projection.comment && (
                  <p className="text-[13px] leading-6">{projection.comment}</p>
                )}
                <section
                  className="grid gap-2 rounded-[8px] p-3 text-[12px] sm:grid-cols-2"
                  style={{ background: "var(--devtools-bg-muted)" }}
                >
                  <div>
                    <span style={{ color: "var(--devtools-fg-muted)" }}>
                      Observed run
                    </span>
                    <ReviewRunReference
                      runId={projection.runId}
                      contextStatus={projection.contextStatus}
                      onOpen={() =>
                        navigate({
                          view: "run-detail",
                          traceId: projection.runId,
                        })
                      }
                    />
                  </div>
                  <div>
                    <span style={{ color: "var(--devtools-fg-muted)" }}>
                      Updated
                    </span>{" "}
                    {new Date(projection.updatedAt).toLocaleString()}
                  </div>
                  {projection.context?.model ? (
                    <div>Model: {projection.context.model}</div>
                  ) : null}
                  {projection.context?.promptId ? (
                    <div>Prompt: {projection.context.promptId}</div>
                  ) : null}
                </section>
                {projection.correction !== undefined ? (
                  <section>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider">
                      Suggested correction
                    </h3>
                    <pre
                      className="mt-1 overflow-auto rounded-[7px] p-3 text-[11px]"
                      style={{ background: "var(--devtools-bg-muted)" }}
                    >
                      {JSON.stringify(projection.correction, null, 2)}
                    </pre>
                  </section>
                ) : null}
                {detail.data ? (
                  <section>
                    <h3 className="text-[11px] font-semibold uppercase tracking-wider">
                      History
                    </h3>
                    <div className="mt-2 space-y-1.5 text-[12px]">
                      {detail.data.submissions.map((submission) => (
                        <div key={submission.feedbackId}>
                          Feedback revision {submission.revision} ·{" "}
                          {new Date(submission.acceptedAt).toLocaleString()}
                        </div>
                      ))}
                      {detail.data.actions.map((item) => (
                        <div key={item.actionId}>
                          {item.type} ·{" "}
                          {new Date(item.createdAt).toLocaleString()}
                        </div>
                      ))}
                    </div>
                  </section>
                ) : null}
                {projection.status === "open" && (
                  <>
                    <div className="flex gap-2">
                      <Btn
                        onClick={() => action.mutate({ type: "resolve" })}
                        disabled={action.isPending}
                      >
                        Resolve
                      </Btn>
                      <Btn
                        variant="danger"
                        onClick={() => action.mutate({ type: "dismiss" })}
                        disabled={action.isPending}
                      >
                        Dismiss
                      </Btn>
                    </div>
                    <ReviewCaseEditor
                      reviewId={reviewId}
                      projection={projection}
                      evals={catalog.data ?? []}
                    />
                  </>
                )}
                {action.isError && (
                  <p
                    role="alert"
                    className="text-[12px]"
                    style={{ color: "var(--devtools-danger)" }}
                  >
                    {action.error.message}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </DevtoolsShell>
  );
}
