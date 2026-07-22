/**
 * Index · Health — the Index-wide roll-up screen.
 *
 * Opt-in surface, opened from the `Health · N` button / tab on the Index
 * header. The redesign follows the Index health implementation handover and
 * replaces the old grouped sweep view with a SonarQube-style verdict page:
 *
 *  1. `IndexHealthOverview` — a scorecard (severity totals, rules firing,
 *     findings by category, most-affected definitions).
 *  2. `IndexHealthList` — an Index-wide, severity-filterable triage list with
 *     progressive disclosure (expand a row for evidence / propagation / fix).
 *
 * Both read the single adapted `IndexIndex` (built once in `IndexView`), so the
 * screen and the per-definition detail section share one projection. Suppressed
 * findings are shown struck (never hidden); `info` is neutral everywhere.
 */

import {
  DevtoolsShell,
  type DevtoolsTab,
} from "@/devtools/shell/DevtoolsShell";
import { IndexHealthList, IndexIndexProvider, type IndexIndex } from "../v2";
import { T } from "../v2/tokens";

interface IndexHealthProps {
  /** The adapted index model — built once in `IndexView`. */
  index: IndexIndex;
  indexedAt: string | undefined;
  connected: boolean;
  /** Shared tab strip — owned by `IndexView` so both surfaces stay in sync. */
  tabs?: readonly DevtoolsTab[];
}

function fmtIndexedAt(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameDay = new Date().toDateString() === d.toDateString();
  if (sameDay)
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function indexHealthSubtitle(
  index: IndexIndex,
  indexedAt: string | undefined,
): string {
  const active = index.healthFindings.filter((finding) => !finding.suppressed);
  const suppressedCount = index.healthFindings.length - active.length;
  const indexed = fmtIndexedAt(indexedAt);

  if (active.length === 0) {
    return [
      suppressedCount > 0
        ? "0 active findings"
        : "No active findings — every indexed definition passes its applicable rules.",
      suppressedCount > 0 && `${suppressedCount} suppressed`,
      indexed && `indexed ${indexed}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  const affected = new Set(
    active.map((finding) => finding.primaryDefinitionId).filter(Boolean),
  ).size;
  const warnCount = active.filter(
    (finding) => finding.severity === "warning" || finding.severity === "error",
  ).length;
  const infoCount = active.filter(
    (finding) => finding.severity === "info",
  ).length;

  return [
    `${active.length} active finding${active.length === 1 ? "" : "s"} across ${affected} definition${affected === 1 ? "" : "s"}`,
    warnCount > 0 && `${warnCount} warning${warnCount === 1 ? "" : "s"}`,
    infoCount > 0 && `${infoCount} info`,
    suppressedCount > 0 && `${suppressedCount} suppressed`,
    indexed && `indexed ${indexed}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function IndexHealth({
  index,
  indexedAt,
  connected,
  tabs,
}: IndexHealthProps) {
  const subtitle = indexHealthSubtitle(index, indexedAt);

  return (
    <DevtoolsShell
      breadcrumb="Library / Index / Health"
      title="Index health"
      subtitle={subtitle}
      tabs={tabs}
    >
      <div style={{ background: T.bg }}>
        <div
          style={{
            maxWidth: 1180,
            margin: "0 auto",
            padding: "26px 32px 90px",
          }}
        >
          <IndexIndexProvider index={index}>
            <IndexHealthList />
          </IndexIndexProvider>
        </div>
      </div>
    </DevtoolsShell>
  );
}
