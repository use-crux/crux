import { useNavigation } from "@/app/navigation/useNavigation";
import { navTarget } from "@/app/navigation/navTarget";
import { useConnected } from "@/app/runtime/runtimeStore";
import { QwShell } from "@/qw/shell/QwShell";
import { Btn, Chip } from "@/qw/shell/primitives";
import { QEmpty } from "@/qw/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useReview, useReviewAction, useReviews } from "../hooks/useReview";
import { ReviewCaseEditor } from "./ReviewCaseEditor";

export function ReviewView({ reviewId }: { reviewId?: string }) {
  const connected = useConnected();
  const { navigate } = useNavigation();
  const list = useReviews();
  const detail = useReview(reviewId);
  const action = useReviewAction(reviewId);
  const reviews = list.data ?? [];
  const projection = detail.data?.projection;

  return (
    <QwShell
      activeView="review"
      onNavigate={(view) => navigate(navTarget(view))}
      breadcrumb="Evals / Review"
      title="Review"
      subtitle={`${reviews.filter((item) => item.status === "open").length} open`}
      connected={connected}
    >
      <div className="grid gap-4 px-8 pb-10 pt-6 lg:grid-cols-[minmax(300px,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          {list.isPending ? (
            <SkeletonRows rows={5} rowHeight={62} />
          ) : list.isError ? (
            <QEmpty
              icon="alert"
              title="Review unavailable"
              body={list.error.message}
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
                  background: "var(--qw-bg-elev)",
                  border: "1px solid var(--qw-border)",
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
            background: "var(--qw-bg-elev)",
            border: "1px solid var(--qw-border)",
          }}
        >
          {!reviewId ? (
            <p className="text-[13px]" style={{ color: "var(--qw-fg-muted)" }}>
              Select feedback to inspect its bounded run context and action
              history.
            </p>
          ) : detail.isPending ? (
            <SkeletonRows rows={5} rowHeight={44} />
          ) : detail.isError ? (
            <QEmpty
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
                    />
                  </>
                )}
                {action.isError && (
                  <p
                    role="alert"
                    className="text-[12px]"
                    style={{ color: "var(--qw-danger)" }}
                  >
                    {action.error.message}
                  </p>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </QwShell>
  );
}
