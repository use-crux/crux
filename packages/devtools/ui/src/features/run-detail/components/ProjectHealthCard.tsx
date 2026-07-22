import type {
  CruxCurrentCatalogComparison,
  CruxCurrentProjectHealth,
} from "@use-crux/core/observability";
import type { NavState } from "@/app/navigation/useNavigation";
import {
  projectCurrentProjectHealth,
  type CurrentProjectHealthFindingView,
} from "@/features/run-detail/lib/project-health";

interface ProjectHealthCardProps {
  health: CruxCurrentProjectHealth | undefined;
  currentCatalog?: CruxCurrentCatalogComparison;
  onNavigate: (state: NavState) => void;
}

function sourceLocation(
  source: { file: string; line: number; column?: number } | undefined,
): string | undefined {
  if (!source) return undefined;
  return [source.file, source.line, source.column].filter(Boolean).join(":");
}

function severityColor(severity: string): string {
  switch (severity) {
    case "error":
      return "var(--devtools-danger)";
    case "warning":
      return "var(--devtools-warn)";
    default:
      return "var(--devtools-fg-faint)";
  }
}

function ProjectHealthFindingRow({
  finding,
  onNavigate,
}: {
  finding: CurrentProjectHealthFindingView;
  onNavigate: (state: NavState) => void;
}) {
  const findingSource = sourceLocation(finding.source);
  return (
    <details
      open={finding.suppressed}
      className="rounded-md border px-3 py-2"
      style={{
        borderColor: "var(--devtools-border)",
        background: "var(--devtools-bg)",
        opacity: finding.suppressed ? 0.78 : 1,
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span
          aria-hidden="true"
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: severityColor(finding.severity) }}
        />
        <code className="text-[10px] text-[var(--devtools-fg-faint)]">
          {finding.ruleId}
        </code>
        <span
          className="min-w-0 flex-1 truncate text-xs font-medium"
          style={{
            color: finding.suppressed
              ? "var(--devtools-fg-muted)"
              : "var(--devtools-fg)",
            textDecoration: finding.suppressed ? "line-through" : undefined,
          }}
        >
          {finding.title}
        </span>
        {finding.suppressed ? (
          <span className="rounded border border-[var(--devtools-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--devtools-fg-muted)]">
            suppressed
          </span>
        ) : null}
      </summary>

      <div className="mt-2 space-y-2 pl-4 text-[11px] text-[var(--devtools-fg-muted)]">
        <p className="m-0">{finding.message}</p>
        <div className="flex flex-wrap gap-2">
          {finding.matchedDefinitions.map((match) => {
            const relationship = `${match.matchKinds.join(" + ")} · ${match.roles.join(" + ")}`;
            const target = match.to;
            return target ? (
              <button
                key={match.definitionId}
                type="button"
                onClick={() => onNavigate(target)}
                className="rounded border border-[var(--devtools-border)] bg-transparent px-2 py-1 text-left font-mono text-[10px] text-[var(--devtools-crux)]"
                title={`View ${match.definitionId} in Catalog`}
              >
                View {match.definitionId} in Catalog · {relationship}
              </button>
            ) : (
              <span
                key={match.definitionId}
                className="rounded border border-[var(--devtools-border)] px-2 py-1 font-mono text-[10px] text-[var(--devtools-fg-muted)]"
              >
                {match.definitionId} · {relationship}
              </span>
            );
          })}
        </div>
        {findingSource ? (
          <div>
            <span className="font-medium text-[var(--devtools-fg-faint)]">
              Finding source
            </span>{" "}
            · <code>{findingSource}</code>
          </div>
        ) : null}
        {finding.suppressed ? (
          <div>
            <span className="font-medium text-[var(--devtools-fg-faint)]">
              Suppressed by
            </span>{" "}
            · <code>{sourceLocation(finding.suppressedBy.source)}</code> ·{" "}
            {finding.suppressedBy.scope} ·{" "}
            {finding.suppressedBy.reason ?? "no reason recorded"}
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** Current authored Project Index context for a Run Detail screen. */
export function ProjectHealthCard({
  health,
  currentCatalog,
  onNavigate,
}: ProjectHealthCardProps) {
  const view = projectCurrentProjectHealth(health, currentCatalog);
  if (!view) return null;

  const findings = [...view.active, ...view.suppressed];
  return (
    <section
      aria-label="Current project health"
      className="mx-3 mt-2 rounded-lg border px-3 py-2"
      style={{
        borderColor: "var(--devtools-border)",
        background: "var(--devtools-bg-elev)",
      }}
    >
      <div className="flex items-center gap-2">
        <h2 className="m-0 text-xs font-semibold text-[var(--devtools-fg)]">
          Project health
        </h2>
        <span className="rounded border border-[var(--devtools-border)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--devtools-fg-faint)]">
          current index
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--devtools-fg-muted)]">
          {view.active.length} active · {view.suppressed.length} suppressed
        </span>
      </div>
      <p className="my-1 text-[10px] leading-4 text-[var(--devtools-fg-faint)]">
        Lint findings in the current Project Index that reference definitions
        this run used. Reflects your code as last indexed ({view.indexedAt}),
        not the code at run time, and does not affect this run&apos;s status.
      </p>
      {findings.length > 0 ? (
        <div className="mt-2 grid max-h-48 gap-1.5 overflow-auto">
          {findings.map((finding) => (
            <ProjectHealthFindingRow
              key={finding.id}
              finding={finding}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ) : (
        <p className="my-2 text-xs text-[var(--devtools-fg-muted)]">
          No current lint findings reference this run&apos;s definitions.
        </p>
      )}
    </section>
  );
}
