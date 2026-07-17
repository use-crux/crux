import { useMemo, useState } from "react";
import { QwShell } from "@/qw/shell/QwShell";
import { navTarget } from "@/app/navigation/navTarget";
import { useNavigation } from "@/app/navigation/useNavigation";
import { useConnected } from "@/app/runtime/runtimeStore";
import { Btn, Chip, Kpi, SectionHead } from "@/qw/shell/primitives";
import { Icon } from "@/qw/shell/Icon";
import { useToast } from "@/qw/shell/useToast";
import { SkeletonRows } from "@/shared/components/Skeleton";
import {
  useCancelRuntimeWork,
  useRetryRuntimeWork,
  useRuntimeInspect,
  useRuntimeStatus,
} from "../hooks/useRuntime";
import {
  distinctSorted,
  filterRuntimeWork,
  runtimeCountLabel,
  runtimeCountsByStatus,
} from "../lib/runtime-format";
import {
  RuntimeOutboxTable,
  RuntimeTimerTable,
  RuntimeWorkDetail,
  RuntimeWorkTable,
} from "./RuntimeTables";
import type { RuntimeWorkFilters, RuntimeWorkStatus } from "../types";

type RuntimeTab = "work" | "timers" | "outbox" | "dead-letter";

const STATUSES: readonly (RuntimeWorkStatus | "all")[] = [
  "all",
  "pending",
  "leased",
  "suspended",
  "blocked",
  "dead-letter",
  "cancelled",
  "completed",
];

export function RuntimeView() {
  const { navigate } = useNavigation();
  const connected = useConnected();
  const { toast } = useToast();
  const statusQuery = useRuntimeStatus();
  const retry = useRetryRuntimeWork();
  const cancel = useCancelRuntimeWork();
  const [tab, setTab] = useState<RuntimeTab>("work");
  const [filters, setFilters] = useState<RuntimeWorkFilters>({ status: "all" });
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const inspectQuery = useRuntimeInspect(selectedWorkId);

  const status = statusQuery.data;
  const workRows = status?.work ?? [];
  const timers = status?.timers ?? [];
  const outbox = status?.outbox ?? [];
  const deadLetters = useMemo(
    () => workRows.filter((row) => row.status === "dead-letter"),
    [workRows],
  );
  const filteredWork = useMemo(
    () => filterRuntimeWork(workRows, filters),
    [workRows, filters],
  );
  const namespaces = useMemo(
    () => distinctSorted(workRows.map((row) => row.namespace)),
    [workRows],
  );
  const targets = useMemo(
    () => distinctSorted(workRows.map((row) => row.targetId)),
    [workRows],
  );
  const counts = useMemo(() => {
    return runtimeCountsByStatus(status?.counts ?? []);
  }, [status?.counts]);

  async function retryWork(workId: string) {
    try {
      const result = await retry.mutateAsync(workId);
      toast({
        kind: result.retried ? "ok" : "info",
        title: result.retried
          ? "Runtime work retried"
          : "Runtime work was not retryable",
        message: workId,
      });
    } catch (error) {
      toast({
        kind: "danger",
        title: "Retry failed",
        message: errorMessage(error),
      });
    }
  }

  async function cancelWork(workId: string) {
    try {
      const result = await cancel.mutateAsync(workId);
      toast({
        kind: result.cancelled ? "ok" : "info",
        title: result.cancelled
          ? "Runtime work cancelled"
          : "Runtime work was already terminal",
        message: workId,
      });
    } catch (error) {
      toast({
        kind: "danger",
        title: "Cancel failed",
        message: errorMessage(error),
      });
    }
  }

  return (
    <QwShell
      activeView="runtime"
      onNavigate={(v) => navigate(navTarget(v))}
      breadcrumb="Inspect / Runtime"
      title="Runtime"
      subtitle={
        status
          ? `${status.namespace} namespace · ${workRows.length} work items`
          : "Runtime state"
      }
      connected={connected}
      actions={
        <Btn
          size="sm"
          icon={<Icon name="loop" size={11} />}
          onClick={() => statusQuery.refetch()}
          disabled={statusQuery.isFetching}
        >
          Refresh
        </Btn>
      }
      tabs={[
        {
          label: "Work",
          count: workRows.length,
          active: tab === "work",
          onClick: () => setTab("work"),
        },
        {
          label: "Timers",
          count: timers.length,
          iconName: "clock",
          active: tab === "timers",
          onClick: () => setTab("timers"),
        },
        {
          label: "Outbox",
          count: outbox.length,
          iconName: "inbox",
          active: tab === "outbox",
          onClick: () => setTab("outbox"),
        },
        {
          label: "Dead-letter",
          count: deadLetters.length,
          iconName: "alert",
          active: tab === "dead-letter",
          onClick: () => setTab("dead-letter"),
        },
      ]}
      filterBar={
        <RuntimeFilterBar
          filters={filters}
          namespaces={namespaces}
          targets={targets}
          onChange={setFilters}
        />
      }
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-8 py-5">
        <div className="grid gap-3 md:grid-cols-4">
          <Kpi
            label="Pending"
            value={runtimeCountLabel(counts.get("pending"))}
          />
          <Kpi
            label="Suspended"
            value={runtimeCountLabel(counts.get("suspended"))}
          />
          <Kpi
            label="Blocked"
            value={runtimeCountLabel(counts.get("blocked"))}
          />
          <Kpi
            label="Dead-letter"
            value={runtimeCountLabel(counts.get("dead-letter"))}
          />
        </div>

        <div
          className="rounded-[8px]"
          style={{
            border: "1px solid var(--qw-border)",
            background: "var(--qw-bg-elev)",
          }}
        >
          <SectionHead eyebrow={tabLabel(tab)} className="m-0 px-4 py-3" />
          {statusQuery.isLoading ? (
            <div className="p-4">
              <SkeletonRows rows={8} rowHeight={34} />
            </div>
          ) : tab === "timers" ? (
            <RuntimeTimerTable rows={timers} />
          ) : tab === "outbox" ? (
            <RuntimeOutboxTable rows={outbox} />
          ) : (
            <RuntimeWorkTable
              rows={tab === "dead-letter" ? deadLetters : filteredWork}
              selectedWorkId={selectedWorkId ?? undefined}
              retrying={retry.isPending}
              cancelling={cancel.isPending}
              onSelect={setSelectedWorkId}
              onRetry={retryWork}
              onCancel={cancelWork}
            />
          )}
        </div>

        <div
          className="rounded-[8px]"
          style={{
            border: "1px solid var(--qw-border)",
            background: "var(--qw-bg-elev)",
          }}
        >
          <SectionHead eyebrow="detail" className="m-0 px-4 py-3" />
          <RuntimeWorkDetail detail={inspectQuery.data} />
        </div>
      </div>
    </QwShell>
  );
}

function RuntimeFilterBar({
  filters,
  namespaces,
  targets,
  onChange,
}: {
  filters: RuntimeWorkFilters;
  namespaces: readonly string[];
  targets: readonly string[];
  onChange: (filters: RuntimeWorkFilters) => void;
}) {
  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-2 px-8 py-2"
      style={{ borderBottom: "1px solid var(--qw-border)" }}
    >
      <Icon name="filter" size={11} />
      <Select
        value={filters.status ?? "all"}
        onChange={(status) =>
          onChange({ ...filters, status: status as RuntimeWorkStatus | "all" })
        }
        options={STATUSES}
      />
      <Select
        value={filters.namespace ?? "all"}
        onChange={(namespace) =>
          onChange({
            ...filters,
            namespace: namespace === "all" ? undefined : namespace,
          })
        }
        options={["all", ...namespaces]}
      />
      <Select
        value={filters.targetId ?? "all"}
        onChange={(targetId) =>
          onChange({
            ...filters,
            targetId: targetId === "all" ? undefined : targetId,
          })
        }
        options={["all", ...targets]}
      />
      {filters.status && filters.status !== "all" && (
        <Chip tone="crux" mono>
          {filters.status}
        </Chip>
      )}
    </div>
  );
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      className="rounded-[6px] px-2 py-1 text-[12px]"
      style={{
        background: "var(--qw-bg-elev)",
        border: "1px solid var(--qw-border)",
        color: "var(--qw-fg)",
      }}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function tabLabel(tab: RuntimeTab): string {
  if (tab === "dead-letter") return "dead-letter";
  return tab;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
