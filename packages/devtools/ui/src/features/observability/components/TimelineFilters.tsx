import type { SessionInfo } from "@/types";
import type { ViewMode } from "@/features/observability/lib/timeline-helpers";

export function TimelineFilters({
  sessions,
  promptIds,
  sessionFilter,
  promptFilter,
  statusFilter,
  searchQuery,
  viewMode,
  onSessionChange,
  onPromptChange,
  onStatusChange,
  onSearchChange,
  onViewModeChange,
  securityFilter,
  onSecurityFilterChange,
  securityCount,
}: {
  sessions: SessionInfo[];
  promptIds: string[];
  sessionFilter: string | null;
  promptFilter: string | null;
  statusFilter: string | null;
  searchQuery: string;
  viewMode: ViewMode;
  onSessionChange: (s: string | null) => void;
  onPromptChange: (s: string | null) => void;
  onStatusChange: (s: string | null) => void;
  onSearchChange: (s: string) => void;
  onViewModeChange: (m: ViewMode) => void;
  securityFilter?: boolean;
  onSecurityFilterChange?: (v: boolean) => void;
  securityCount?: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2">
      {/* View mode toggle */}
      <div className="flex items-center bg-zinc-800 rounded text-[10px]">
        {[
          { mode: "flat" as ViewMode, label: "Chronological" },
          { mode: "session" as ViewMode, label: "By Session" },
          { mode: "flow" as ViewMode, label: "By Flow" },
        ].map(({ mode, label }) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            className={`px-2 py-1 rounded transition-colors ${
              viewMode === mode
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-zinc-700" />

      {sessions.length > 0 && (
        <select
          value={sessionFilter ?? ""}
          onChange={(e) => onSessionChange(e.target.value || null)}
          className="bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1 border border-zinc-700"
        >
          <option value="">All sessions</option>
          {sessions.map((s) => (
            <option key={s.sessionId} value={s.sessionId}>
              {s.sessionId.length > 30
                ? s.sessionId.slice(0, 30) + "\u2026"
                : s.sessionId}{" "}
              ({s.traceCount})
            </option>
          ))}
        </select>
      )}
      {promptIds.length > 1 && (
        <select
          value={promptFilter ?? ""}
          onChange={(e) => onPromptChange(e.target.value || null)}
          className="bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1 border border-zinc-700"
        >
          <option value="">All prompts</option>
          {promptIds.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      )}
      <div className="flex items-center gap-1 text-[10px]">
        {(["all", "running", "success", "error"] as const).map((s) => (
          <button
            key={s}
            onClick={() => onStatusChange(s === "all" ? null : s)}
            className={`px-2 py-1 rounded transition-colors capitalize ${
              (s === "all" && !statusFilter) || statusFilter === s
                ? "bg-zinc-700 text-zinc-200"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {s}
          </button>
        ))}
      </div>
      {securityCount != null && securityCount > 0 && (
        <button
          onClick={() => onSecurityFilterChange?.(!securityFilter)}
          className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${
            securityFilter
              ? "bg-(--devtools-danger-soft) text-(--devtools-danger) border border-(--devtools-danger-soft)"
              : "text-zinc-500 hover:text-(--devtools-danger) border border-transparent"
          }`}
          title="Show only traces with security warnings"
        >
          {"\uD83D\uDEE1\uFE0F"} {securityCount}
        </button>
      )}
      <input
        type="text"
        placeholder="Search..."
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        className="bg-zinc-800 text-zinc-300 text-xs rounded px-2 py-1 border border-zinc-700 w-40 placeholder:text-zinc-600"
      />
    </div>
  );
}
