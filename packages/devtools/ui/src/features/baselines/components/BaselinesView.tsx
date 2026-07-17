import { useConnected } from "@/app/runtime/runtimeStore";
import { navTarget } from "@/app/navigation/navTarget";
import { useNavigation } from "@/app/navigation/useNavigation";
import { QwShell } from "@/qw/shell/QwShell";
import { Chip } from "@/qw/shell/primitives";
import { QEmpty } from "@/qw/shell/empty-state";
import { SkeletonRows } from "@/shared/components/Skeleton";
import { useEvalBaselines } from "../hooks/useBaselines";

export function BaselinesView() {
  const connected = useConnected();
  const { navigate } = useNavigation();
  const query = useEvalBaselines();
  const baselines = query.data ?? [];
  return (
    <QwShell
      activeView="baselines"
      onNavigate={(view) => navigate(navTarget(view))}
      breadcrumb="Evals / Baselines"
      title="Baselines"
      subtitle={`${baselines.length} accepted references`}
      connected={connected}
    >
      <div className="space-y-3 px-8 pb-10 pt-6">
        {query.isPending ? (
          <SkeletonRows rows={4} rowHeight={72} />
        ) : query.isError ? (
          <QEmpty
            icon="alert"
            title="Baselines unavailable"
            body={query.error.message}
          />
        ) : baselines.length === 0 ? (
          <QEmpty
            icon="bookmark"
            title="No Eval Baselines"
            body="Set a complete Eval run as the accepted historical reference."
          />
        ) : (
          baselines.map((baseline) => (
            <div
              key={baseline.baselineId}
              className="grid gap-3 rounded-[10px] px-4 py-3 md:grid-cols-[1fr_auto_auto]"
              style={{
                background: "var(--qw-bg-elev)",
                border: "1px solid var(--qw-border)",
              }}
            >
              <div>
                <div className="font-mono text-[13px] font-semibold">
                  {baseline.evalId}
                </div>
                <div
                  className="mt-1 font-mono text-[10.5px]"
                  style={{ color: "var(--qw-fg-faint)" }}
                >
                  {baseline.runId}
                </div>
              </div>
              <Chip tone="muted">{baseline.selectedArm}</Chip>
              <Chip
                tone={
                  baseline.compatibility?.status === "compatible"
                    ? "ok"
                    : baseline.compatibility
                      ? "warn"
                      : "muted"
                }
              >
                {baseline.compatibility?.status ?? "not compared"}
              </Chip>
              {baseline.compatibility?.reasons?.length ? (
                <div
                  className="md:col-span-3 text-[12px]"
                  style={{ color: "var(--qw-fg-muted)" }}
                >
                  {baseline.compatibility.reasons.join(" · ")}
                </div>
              ) : null}
            </div>
          ))
        )}
      </div>
    </QwShell>
  );
}
