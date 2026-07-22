import type { HealthFinding } from "./adapt";
import { LintMetaTag } from "./kit";
import { T } from "./tokens";

/** Explicit state marker for a retained suppressed finding. */
export function SuppressedFindingTag({
  suppressed,
}: {
  suppressed: boolean | undefined;
}) {
  return suppressed ? <LintMetaTag>suppressed</LintMetaTag> : null;
}

/** Short suppression state shown beside a finding's remediation details. */
export function SuppressionSummary({ finding }: { finding: HealthFinding }) {
  if (!finding.suppressed) return null;

  return (
    <span
      style={{
        marginLeft: "auto",
        fontFamily: T.mono,
        fontSize: 10,
        color: T.fgFaint,
      }}
    >
      suppressed · {finding.suppressedBy?.reason ?? "no reason recorded"}
    </span>
  );
}

function sourceLocation(
  source: { file: string; line: number; column?: number } | undefined,
): string | undefined {
  if (!source) return undefined;
  return [source.file, source.line, source.column].filter(Boolean).join(":");
}

/** Finding and directive coordinates for auditing an applied suppression. */
export function SuppressionEvidence({ finding }: { finding: HealthFinding }) {
  if (!finding.suppressed || !finding.suppressedBy) return null;

  const findingSource = sourceLocation(finding.sourceLoc);
  const directiveSource = sourceLocation(finding.suppressedBy.source);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "max-content 1fr",
        gap: "6px 12px",
        marginTop: 10,
        padding: "9px 12px",
        background: T.bgElev,
        border: `1px solid ${T.border}`,
        borderRadius: 7,
        fontFamily: T.mono,
        fontSize: 10,
      }}
    >
      <span style={{ color: T.fgFaint }}>Finding source</span>
      <span style={{ color: T.fgMuted }}>
        {findingSource ?? "not recorded"}
      </span>
      <span style={{ color: T.fgFaint }}>Suppressed by</span>
      <span style={{ color: T.fgMuted }}>
        {directiveSource ?? "not recorded"} · {finding.suppressedBy.scope} ·{" "}
        {finding.suppressedBy.reason ?? "no reason recorded"}
      </span>
    </div>
  );
}
