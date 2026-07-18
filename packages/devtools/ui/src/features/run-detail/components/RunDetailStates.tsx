/**
 * Run-detail shell states — loading / error / not-found (design `v11`
 * `ShellStates`). Never a blank screen: the structure lenses render one of
 * these whenever the `CruxRunDetail` projection isn't available yet.
 *
 * (The `empty` "Select a run" state belongs to the Runs list, not here — the
 * detail always has a `traceId`.)
 */

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Btn } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import type { IconName } from "@/devtools/shell/nav";
import { SkeletonCard, SkeletonRows } from "@/shared/components/Skeleton";
import { useNavigation } from "@/app/navigation/useNavigation";
import { navTarget } from "@/app/navigation/navTarget";
import { qk } from "@/shared/query/queryClient";

type StateTone = "danger" | "warn" | "crux" | "ok";

/** Centered icon + title + body + action — the `ShellStates` `Center`. */
function StateCenter({
  icon,
  tone,
  title,
  body,
  action,
}: {
  icon: IconName;
  tone?: StateTone;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  const toneColor = tone ? `var(--devtools-${tone})` : "var(--devtools-fg-muted)";
  const toneSoft = tone ? `var(--devtools-${tone}-soft)` : "var(--devtools-bg-muted)";
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 p-6 text-center">
      <div
        className="flex h-11 w-11 items-center justify-center rounded-[12px]"
        style={{
          background: toneSoft,
          boxShadow: "inset 0 0 0 1px var(--devtools-border)",
        }}
      >
        <Icon name={icon} size={20} color={toneColor} />
      </div>
      <div className="text-[15px] font-semibold">{title}</div>
      <div
        className="text-[12.5px] leading-[1.5]"
        style={{ color: "var(--devtools-fg-muted)", maxWidth: 320 }}
      >
        {body}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

/** Structure | detail skeleton shown while the projection loads. */
function StructureSkeleton() {
  return (
    <div className="grid h-full" style={{ gridTemplateColumns: "320px 1fr" }}>
      <aside
        className="flex h-full flex-col gap-2 p-3"
        style={{
          borderRight: "1px solid var(--devtools-border)",
          background: "var(--devtools-bg)",
        }}
      >
        <SkeletonRows rows={14} rowHeight={28} />
      </aside>
      <div className="flex flex-col gap-4 p-6">
        <SkeletonCard bodyLines={3} />
        <SkeletonCard bodyLines={6} />
        <SkeletonCard bodyLines={4} />
      </div>
    </div>
  );
}

function shortTrace(traceId: string): string {
  return traceId.length > 18 ? `${traceId.slice(0, 14)}…` : traceId;
}

/**
 * Picks the right shell state for the observability projection: error (with
 * Retry + Copy trace id), loading skeleton, or not-found (Back to runs).
 * Render this in the structure lenses when there's no span tree yet.
 */
export function RunStructureState({
  traceId,
  error,
  loading,
}: {
  traceId: string;
  error: Error | null;
  loading: boolean;
}) {
  const client = useQueryClient();
  const { navigate } = useNavigation();

  if (error) {
    return (
      <StateCenter
        icon="alert"
        tone="danger"
        title="Couldn't load this run"
        body="The run projection failed to build (e.g. a collector timeout). The records are safe — this is a read error, so a retry usually clears it."
        action={
          <div className="flex gap-2">
            <Btn
              size="sm"
              icon={<Icon name="loop" size={13} />}
              onClick={() =>
                void client.invalidateQueries({
                  queryKey: qk.observability.run(traceId),
                })
              }
            >
              Retry
            </Btn>
            <Btn
              size="sm"
              onClick={() => void navigator.clipboard?.writeText(traceId)}
            >
              Copy trace id
            </Btn>
          </div>
        }
      />
    );
  }

  if (loading) return <StructureSkeleton />;

  return (
    <StateCenter
      icon="search"
      tone="warn"
      title="Run not found"
      body={`No run matches ${shortTrace(traceId)} in this project. It may have aged out of the window or belong to another environment.`}
      action={
        <Btn
          size="sm"
          variant="soft"
          icon={<Icon name="arrowRight" size={13} />}
          onClick={() => navigate(navTarget("runs"))}
        >
          Back to runs
        </Btn>
      }
    />
  );
}
