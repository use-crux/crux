/**
 * Insights — derived diagnoses from Inspect and observability records.
 */

import { useDeferredValue, useMemo, useState } from "react";
import { DevtoolsShell } from "@/devtools/shell/DevtoolsShell";
import { Chip, Eyebrow } from "@/devtools/shell/primitives";
import { Icon } from "@/devtools/shell/Icon";
import {
  useInspectInsights,
  useInspectInsightSilences,
  useInspectRuns,
} from "@/shared/hooks/useInspectApi";
import {
  useInsightMutation,
  useSilenceMutation,
  useUnsilenceMutation,
} from "@/shared/hooks/inspect-mutations";
import { useToast } from "@/devtools/shell/useToast";
import { useNavigation } from "@/app/navigation/useNavigation";
import {
  AddFilterButton,
  CollapsibleGroup,
  GroupByDropdown,
  MultiSelectChip,
  SearchChip,
  type AddFilterOption,
} from "@/devtools/shell/FilterPopover";
import { DevtoolsTooltip } from "@/devtools/shell/DevtoolsTooltip";
import { InsightCard } from "@/features/insights/components/InsightCard";
import { SectionBoundary } from "@/devtools/shell/SectionBoundary";
import { SkeletonCard } from "@/shared/components/Skeleton";
import { SEV_LABEL, timeAgo } from "@/features/insights/lib/insight-format";
import type {
  InspectInsightRecord,
  InspectInsightSilence,
  InspectRunRecord,
} from "@/types";

const SEVERITY_OPTIONS = ["high", "medium", "low"] as const;
const STATUS_OPTIONS = ["open", "dismissed", "resolved"] as const;

export interface InsightsFilters {
  severity?: readonly ("high" | "medium" | "low")[];
  target?: readonly string[];
  status?: readonly ("open" | "dismissed" | "resolved")[];
  /** Insight title (e.g. "Run is slow", "Run has high token usage"). */
  title?: readonly string[];
  /** Insight tag (e.g. "Latency", "Cost"). */
  tag?: readonly string[];
  search?: string;
}

export type InsightsGroupBy =
  | "none"
  | "severity"
  | "target"
  | "status"
  | "title"
  | "tag";

interface InsightsProps {
  filters: InsightsFilters;
  groupBy: InsightsGroupBy;
}

export function InsightsView({ filters, groupBy }: InsightsProps) {
  const { navigate } = useNavigation();
  const {
    data: bffInsights,
    loading: insightsLoading,
    reload,
  } = useInspectInsights();
  const initialLoading = insightsLoading && !bffInsights;
  const { data: silenceList } = useInspectInsightSilences();
  const activeSilences = useMemo(
    () => (silenceList ?? []).filter((s) => !s.deletedAt),
    [silenceList],
  );
  const silence = useSilenceMutation();
  const unsilence = useUnsilenceMutation();
  // Pull the full runs list once and index by traceId. Joining client-side
  // hydrates each occurrence row with timing/target/status — backend
  // currently exposes only `linkedTraceIds[]` on the insight.
  const { data: allRuns } = useInspectRuns({});
  const traceLookup = useMemo(() => {
    const m = new Map<string, InspectRunRecord>();
    for (const r of allRuns ?? []) m.set(r.traceId, r);
    return m;
  }, [allRuns]);
  const updateInsight = useInsightMutation();
  const { toast } = useToast();
  const [hidden, setHidden] = useState<readonly string[]>([]);

  // Default filter: when no status is selected, show open-only (matches
  // the user's mental model of "Insights = things to act on").
  const statusFilter =
    filters.status && filters.status.length > 0
      ? new Set(filters.status as readonly string[])
      : new Set(["open"]);
  const severityFilter = new Set(filters.severity ?? []);
  const targetFilter = new Set(filters.target ?? []);
  const titleFilter = new Set(filters.title ?? []);
  const tagFilter = new Set(filters.tag ?? []);
  const searchTerm = filters.search?.toLowerCase().trim();
  // Defer the search term — on big insights lists, the filter+group
  // recompute is the expensive part. Deferring keeps the rest of the
  // page (header, tabs, filter chips) responsive while the new list
  // settles. The filtering reads the deferred value; UI dims via
  // `isFilterPending` below.
  const deferredSearch = useDeferredValue(searchTerm);
  const isFilterPending = searchTerm !== deferredSearch;

  const insights = useMemo(() => {
    return (bffInsights ?? []).filter((i) => {
      if (!statusFilter.has(i.status)) return false;
      if (hidden.includes(i.insightId)) return false;
      if (severityFilter.size > 0 && !severityFilter.has(i.severity))
        return false;
      if (
        targetFilter.size > 0 &&
        (!i.targetId || !targetFilter.has(i.targetId))
      )
        return false;
      if (titleFilter.size > 0 && !titleFilter.has(i.title)) return false;
      if (tagFilter.size > 0 && !i.tags.some((t) => tagFilter.has(t)))
        return false;
      if (deferredSearch) {
        const hay =
          `${i.title} ${i.summary} ${i.targetId ?? ""} ${i.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(deferredSearch)) return false;
      }
      return true;
    });
  }, [
    bffInsights,
    hidden,
    statusFilter,
    severityFilter,
    targetFilter,
    titleFilter,
    tagFilter,
    deferredSearch,
  ]);

  // Distincts derived from the FULL insight set (not filtered), so the
  // popovers always offer the complete value space.
  const distinctTargets = useMemo(() => {
    const s = new Set<string>();
    for (const i of bffInsights ?? []) {
      if (i.targetId) s.add(i.targetId);
    }
    return Array.from(s).slice(0, 50);
  }, [bffInsights]);
  const distinctTitles = useMemo(() => {
    const s = new Set<string>();
    for (const i of bffInsights ?? []) {
      if (i.title) s.add(i.title);
    }
    return Array.from(s).slice(0, 100);
  }, [bffInsights]);
  const distinctTags = useMemo(() => {
    const s = new Set<string>();
    for (const i of bffInsights ?? []) {
      for (const t of i.tags) s.add(t);
    }
    return Array.from(s).sort().slice(0, 100);
  }, [bffInsights]);

  function updateFilters(next: InsightsFilters) {
    navigate({
      view: "insights",
      ...next,
      ...(groupBy !== "none" ? { groupBy } : {}),
    });
  }

  function updateGroupBy(next: InsightsGroupBy) {
    navigate({
      view: "insights",
      ...filters,
      ...(next !== "none" ? { groupBy: next } : {}),
    });
  }

  const groups = useMemo(() => {
    if (groupBy === "none") return [{ key: "", items: insights }];
    const map = new Map<string, InspectInsightRecord[]>();
    // When grouping by tag, an insight with multiple tags appears in
    // multiple groups — that's the right read for "show me everything
    // tagged Cost regardless of title".
    if (groupBy === "tag") {
      for (const i of insights) {
        const tags = i.tags.length > 0 ? i.tags : ["(untagged)"];
        for (const t of tags) {
          const arr = map.get(t) ?? [];
          arr.push(i);
          map.set(t, arr);
        }
      }
    } else {
      for (const i of insights) {
        const key =
          groupBy === "severity"
            ? SEV_LABEL[i.severity]
            : groupBy === "target"
              ? (i.targetId ?? "—")
              : groupBy === "status"
                ? i.status
                : groupBy === "title"
                  ? i.title || "(no title)"
                  : "—";
        const arr = map.get(key) ?? [];
        arr.push(i);
        map.set(key, arr);
      }
    }
    // Sort groups by item count desc — biggest issue clusters surface first.
    return Array.from(map.entries())
      .map(([key, items]) => ({ key, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [insights, groupBy]);

  async function handleResolve(insightId: string) {
    // Resolve = "fixed, auto-reopen if it returns." Backend snapshots
    // occurrenceCount at this moment; the next read will reopen if more
    // occurrences appear.
    setHidden((h) => [...h, insightId]);
    const r = await updateInsight(insightId, "resolved");
    if (r.ok) reload();
  }

  async function handleSilence(insightId: string) {
    // Silence = "hide this pattern (title + target) going forward."
    // Backend extracts the pattern from the insight; future matching
    // insights are filtered out at the read model.
    setHidden((h) => [...h, insightId]);
    await silence({ insightId });
  }

  async function handleUnsilence(silenceId: string) {
    await unsilence(silenceId);
  }

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0 };
    for (const i of insights) c[i.severity]++;
    return c;
  }, [insights]);

  return (
    <DevtoolsShell
      breadcrumb="Inspect / Insights"
      title="What needs attention"
      subtitle={`${insights.length} open`}
      filterBar={
        <InsightsFilterChips
          filters={filters}
          onChange={updateFilters}
          distinctTargets={distinctTargets}
          distinctTitles={distinctTitles}
          distinctTags={distinctTags}
          right={
            <GroupByDropdown
              value={groupBy}
              options={[
                { value: "none", label: "No grouping" },
                { value: "title", label: "Type (title)" },
                { value: "tag", label: "Tag" },
                { value: "severity", label: "Severity" },
                { value: "target", label: "Target" },
                { value: "status", label: "Status" },
              ]}
              onChange={updateGroupBy}
            />
          }
        />
      }
    >
      <div
        className="min-h-full px-8 pb-10 pt-6"
        style={{
          backgroundImage:
            "linear-gradient(to right, var(--devtools-grid) 1px, transparent 1px), linear-gradient(to bottom, var(--devtools-grid) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      >
        {activeSilences.length > 0 && (
          <SilencesStrip
            silences={activeSilences}
            onUnsilence={handleUnsilence}
          />
        )}
        <div className="mb-[18px] flex items-center gap-3">
          <Eyebrow>Diagnosis feed</Eyebrow>
          <div
            className="h-px flex-1"
            style={{ background: "var(--devtools-border)" }}
          />
          <div className="flex gap-1.5">
            {counts.high > 0 && (
              <Chip tone="danger" dot>
                {counts.high} high
              </Chip>
            )}
            {counts.medium > 0 && (
              <Chip tone="warn" dot>
                {counts.medium} medium
              </Chip>
            )}
            {counts.low > 0 && (
              <Chip tone="iris" dot>
                {counts.low} low
              </Chip>
            )}
          </div>
        </div>

        {initialLoading && (
          <SectionBoundary
            title="Insights"
            fallback={
              <div className="flex flex-col gap-2">
                <SkeletonCard bodyLines={2} />
                <SkeletonCard bodyLines={2} />
                <SkeletonCard bodyLines={2} />
              </div>
            }
          >
            <div className="flex flex-col gap-2">
              <SkeletonCard bodyLines={2} />
              <SkeletonCard bodyLines={2} />
              <SkeletonCard bodyLines={2} />
            </div>
          </SectionBoundary>
        )}

        {!initialLoading && insights.length === 0 && (
          <div
            className="rounded-[10px] px-6 py-10 text-center text-[13px]"
            style={{
              background: "var(--devtools-bg-elev)",
              border: "1px dashed var(--devtools-border)",
              color: "var(--devtools-fg-muted)",
            }}
          >
            No insights match the active filters. Diagnoses show up when
            repeated tool loops, failed calls, or unusual latency and cost
            patterns are detected locally.
          </div>
        )}

        <div
          className="flex flex-col gap-2 transition-opacity"
          style={{ opacity: isFilterPending ? 0.6 : 1 }}
        >
          {groups.map((g) => {
            // Aggregate severity breakdown for the group header chip set.
            let high = 0;
            let medium = 0;
            let low = 0;
            const distinctTargetsInGroup = new Set<string>();
            for (const i of g.items) {
              if (i.severity === "high") high += 1;
              else if (i.severity === "medium") medium += 1;
              else if (i.severity === "low") low += 1;
              if (i.targetId) distinctTargetsInGroup.add(i.targetId);
            }
            return (
              <CollapsibleGroup
                key={g.key || "_"}
                groupKey={g.key}
                ungrouped={groupBy === "none"}
                title={g.key || "—"}
                count={g.items.length}
                summary={
                  <>
                    {high > 0 && (
                      <Chip tone="danger" mono>
                        {high} high
                      </Chip>
                    )}
                    {medium > 0 && (
                      <Chip tone="warn" mono>
                        {medium} med
                      </Chip>
                    )}
                    {low > 0 && (
                      <Chip tone="iris" mono>
                        {low} low
                      </Chip>
                    )}
                    {distinctTargetsInGroup.size > 0 &&
                      groupBy !== "target" && (
                        <span className="font-mono text-[10.5px]">
                          {distinctTargetsInGroup.size} target
                          {distinctTargetsInGroup.size === 1 ? "" : "s"}
                        </span>
                      )}
                  </>
                }
              >
                <div
                  className="flex flex-col gap-3.5"
                  style={{
                    padding: groupBy === "none" ? 0 : "14px 0",
                  }}
                >
                  {g.items.map((ins) => (
                    <InsightCard
                      key={ins.insightId}
                      ins={ins}
                      traceLookup={traceLookup}
                      onSilencePattern={() => handleSilence(ins.insightId)}
                      onResolve={() => handleResolve(ins.insightId)}
                    />
                  ))}
                </div>
              </CollapsibleGroup>
            );
          })}
        </div>
      </div>
    </DevtoolsShell>
  );
}

// ─── Silences strip ─────────────────────────────────────────────────
//
// Compact horizontal list of active pattern silences shown above the
// diagnosis feed. Lets the user spot and undo silences without leaving
// the screen — important so silencing doesn't feel like a one-way
// commit ("did I just hide something important?").

function SilencesStrip({
  silences,
  onUnsilence,
}: {
  silences: readonly InspectInsightSilence[];
  onUnsilence: (silenceId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? silences : silences.slice(0, 6);
  return (
    <div
      className="mb-[18px] flex flex-col gap-2 rounded-[10px] px-3.5 py-3"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px dashed var(--devtools-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <Icon name="x" size={12} color="var(--devtools-fg-muted)" />
        <span
          className="font-mono text-[10.5px] uppercase tracking-[0.1em]"
          style={{ color: "var(--devtools-fg-faint)" }}
        >
          Silenced patterns · {silences.length}
        </span>
        <span
          className="font-mono text-[10.5px]"
          style={{ color: "var(--devtools-fg-muted)" }}
        >
          insights matching these are hidden from the feed
        </span>
        {silences.length > 6 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-auto font-mono text-[10.5px] hover:opacity-80"
            style={{ color: "var(--devtools-crux)" }}
          >
            {expanded ? "show less" : `show all ${silences.length}`}
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((s) => (
          <span
            key={s.id}
            className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-[3px] font-mono text-[11px]"
            style={{
              background: "var(--devtools-bg-muted)",
              border: "1px solid var(--devtools-border)",
              color: "var(--devtools-fg)",
            }}
            title={`Silenced ${timeAgo(s.createdAt)}${s.note ? ` · ${s.note}` : ""}`}
          >
            <span style={{ color: "var(--devtools-fg-faint)" }}>
              {s.pattern.targetId ? "pattern:" : "title:"}
            </span>
            <span>{s.pattern.title}</span>
            {s.pattern.targetId && (
              <span style={{ color: "var(--devtools-fg-faint)" }}>
                · {s.pattern.targetId}
              </span>
            )}
            <DevtoolsTooltip content="Unsilence · matching insights return on next read">
              <button
                type="button"
                onClick={() => onUnsilence(s.id)}
                className="ml-1 opacity-70 hover:opacity-100"
                style={{ color: "var(--devtools-fg-faint)" }}
                aria-label={`Unsilence ${s.pattern.title}`}
              >
                <Icon name="x" size={10} />
              </button>
            </DevtoolsTooltip>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Filter chip bar ────────────────────────────────────────────────

function InsightsFilterChips({
  filters,
  onChange,
  distinctTargets,
  distinctTitles,
  distinctTags,
  right,
}: {
  filters: InsightsFilters;
  onChange: (next: InsightsFilters) => void;
  distinctTargets: readonly string[];
  distinctTitles: readonly string[];
  distinctTags: readonly string[];
  right?: React.ReactNode;
}) {
  function update<K extends keyof InsightsFilters>(
    key: K,
    value: InsightsFilters[K],
  ) {
    const next: InsightsFilters = { ...filters };
    if (
      value == null ||
      (Array.isArray(value) && value.length === 0) ||
      value === ""
    ) {
      delete next[key];
    } else {
      next[key] = value;
    }
    onChange(next);
  }

  const has = {
    title: !!filters.title && filters.title.length > 0,
    tag: !!filters.tag && filters.tag.length > 0,
    severity: !!filters.severity && filters.severity.length > 0,
    target: !!filters.target && filters.target.length > 0,
    status: !!filters.status && filters.status.length > 0,
    search: !!filters.search?.trim(),
  };

  type Kind = "title" | "tag" | "severity" | "target" | "status" | "search";
  const addOptions: ReadonlyArray<AddFilterOption<Kind>> = [
    {
      kind: "title",
      label: "Type",
      enabled: !has.title && distinctTitles.length > 0,
    },
    { kind: "tag", label: "Tag", enabled: !has.tag && distinctTags.length > 0 },
    { kind: "severity", label: "Severity", enabled: !has.severity },
    {
      kind: "target",
      label: "Target",
      enabled: !has.target && distinctTargets.length > 0,
    },
    { kind: "status", label: "Status", enabled: !has.status },
    { kind: "search", label: "Search", enabled: !has.search },
  ];

  return (
    <div
      className="flex flex-shrink-0 flex-wrap items-center gap-1.5 px-8 py-2"
      style={{
        borderBottom: "1px solid var(--devtools-border)",
        background: "var(--devtools-bg)",
      }}
    >
      <div
        className="mr-1 flex items-center gap-1.5 font-mono text-[11px] tracking-[0.04em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        <Icon name="filter" size={11} />
        filter
      </div>

      {has.title && (
        <MultiSelectChip
          k="type"
          values={filters.title ?? []}
          options={distinctTitles}
          onChange={(next) => update("title", next)}
        />
      )}
      {has.tag && (
        <MultiSelectChip
          k="tag"
          values={filters.tag ?? []}
          options={distinctTags}
          onChange={(next) => update("tag", next)}
        />
      )}
      {has.severity && (
        <MultiSelectChip
          k="severity"
          values={(filters.severity ?? []) as readonly string[]}
          options={SEVERITY_OPTIONS as readonly string[]}
          onChange={(next) =>
            update(
              "severity",
              next.filter(
                (s) => s === "high" || s === "medium" || s === "low",
              ) as readonly ("high" | "medium" | "low")[],
            )
          }
        />
      )}
      {has.target && (
        <MultiSelectChip
          k="target"
          values={filters.target ?? []}
          options={distinctTargets}
          onChange={(next) => update("target", next)}
        />
      )}
      {has.status && (
        <MultiSelectChip
          k="status"
          values={(filters.status ?? []) as readonly string[]}
          options={STATUS_OPTIONS as readonly string[]}
          onChange={(next) =>
            update(
              "status",
              next.filter(
                (s) => s === "open" || s === "dismissed" || s === "resolved",
              ) as readonly ("open" | "dismissed" | "resolved")[],
            )
          }
        />
      )}
      {has.search && (
        <SearchChip
          value={filters.search}
          onChange={(next) => update("search", next)}
          placeholder="title / summary / target / tag"
        />
      )}

      <AddFilterButton
        options={addOptions}
        onAdd={(kind) => {
          if (kind === "title" && distinctTitles[0])
            update("title", [distinctTitles[0]]);
          else if (kind === "tag" && distinctTags[0])
            update("tag", [distinctTags[0]]);
          else if (kind === "severity") update("severity", ["high"]);
          else if (kind === "target" && distinctTargets[0])
            update("target", [distinctTargets[0]]);
          else if (kind === "status") update("status", ["open"]);
          else if (kind === "search") update("search", " ");
        }}
      />

      <div className="flex-1" />
      {right}
    </div>
  );
}
