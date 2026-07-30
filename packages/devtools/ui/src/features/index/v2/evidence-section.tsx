/** Purpose-built Catalog sections for execution-evidence authoring and coverage. */

import { useNavigation } from "@/app/navigation/useNavigation";
import { useDefinitionActivity } from "@/shared/query/useDefinitionActivity";
import type { ViewDef } from "./adapt";
import { useIndexIndex, useIndexSelect } from "./context";
import {
  projectEvidenceAuthoringCatalog,
  projectEvidenceCoverageCatalog,
  type EvidenceCoverageStatus,
} from "./evidence-catalog";
import { Chip, SectionHead } from "./primitives";
import type { Tone } from "./tokens";
import { evidenceSectionStyles as styles } from "./evidence-section-styles";

/** Render the evidence-specific Catalog view for one indexed definition. */
export function IndexEvidence({ def }: { readonly def: ViewDef }) {
  const index = useIndexIndex();
  const baseAuthoring = projectEvidenceAuthoringCatalog(def, index);
  const { activity: exactActivity } = useDefinitionActivity(def.id);
  const { activity: ownerActivity } = useDefinitionActivity(
    baseAuthoring?.owner?.id,
  );

  if (baseAuthoring) {
    const view = projectEvidenceAuthoringCatalog(def, index, {
      exactRunCount: exactActivity?.runCount,
      ownerRunCount: ownerActivity?.runCount,
    });
    return view ? <EvidenceAuthoringSection view={view} /> : null;
  }

  const coverage = projectEvidenceCoverageCatalog(def.kind);
  return coverage ? (
    <EvidenceCoverageSection
      view={coverage}
      runtimeRunCount={exactActivity?.runCount}
    />
  ) : null;
}

function EvidenceAuthoringSection({
  view,
}: {
  readonly view: NonNullable<
    ReturnType<typeof projectEvidenceAuthoringCatalog>
  >;
}) {
  const select = useIndexSelect();
  const { navigate } = useNavigation();
  const kind =
    view.facts.evidenceKind.classification === "canonical" ||
    view.facts.evidenceKind.classification === "custom"
      ? view.facts.evidenceKind.value
      : view.facts.evidenceKind.classification;
  const facts = [
    ["Role", view.facts.role],
    ["Kind", kind],
    ["Conclusion", view.facts.conclusion],
    ["Source", view.facts.sourceForm],
    ["Subject", view.facts.subjectMode],
    ["Idempotent", view.facts.idempotent ? "yes" : "no"],
    ["Supersedes", view.facts.supersedes ? "yes" : "no"],
  ].filter((item): item is [string, string] => typeof item[1] === "string");

  return (
    <>
      <SectionHead eyebrow="Evidence authoring" />
      <section style={styles.panel} aria-label="Evidence authoring">
        <div style={styles.factGrid}>
          {facts.map(([label, value]) => (
            <div key={label} style={styles.fact}>
              <span style={styles.label}>{label}</span>
              <span style={styles.value}>{value}</span>
            </div>
          ))}
        </div>

        {view.source ? (
          <code style={styles.source}>
            {view.source.file}:{view.source.line}
            {view.source.column === undefined ? "" : `:${view.source.column}`}
          </code>
        ) : null}

        <div style={styles.actionRow}>
          {view.owner ? (
            <button
              type="button"
              aria-label={`Open Catalog definition ${view.owner.name}`}
              onClick={() => select(view.owner!.id)}
              style={styles.linkButton}
            >
              Declared in {view.owner.name}
            </button>
          ) : null}
          {view.observation ? (
            <button
              type="button"
              onClick={() =>
                navigate({
                  view: "runs",
                  definitionId: view.observation!.definitionId,
                })
              }
              style={styles.linkButton}
            >
              {view.observation.label} · {view.observation.runCount} run
              {view.observation.runCount === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>

        {view.findings.length > 0 ? (
          <div style={styles.findings}>
            {view.findings.map((finding) => (
              <div key={finding.id}>
                <Chip tone={finding.severity === "error" ? "danger" : "warn"}>
                  {finding.ruleId}
                </Chip>
                <p style={styles.findingCopy}>{finding.message}</p>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}

function EvidenceCoverageSection({
  view,
  runtimeRunCount,
}: {
  readonly view: NonNullable<ReturnType<typeof projectEvidenceCoverageCatalog>>;
  readonly runtimeRunCount?: number;
}) {
  return (
    <>
      <SectionHead
        eyebrow="Evidence coverage"
        right={
          runtimeRunCount ? (
            <span style={styles.runtime}>
              Current local window · {runtimeRunCount} run
              {runtimeRunCount === 1 ? "" : "s"}
            </span>
          ) : undefined
        }
      />
      <section style={styles.panel} aria-label="Evidence role coverage">
        <div role="list" style={styles.roleGrid}>
          {view.roles.map((role) => (
            <article key={role.role} role="listitem" style={styles.roleCard}>
              <h3 style={styles.roleTitle}>{titleCase(role.role)}</h3>
              <div style={styles.entryList}>
                {role.entries.map((entry) => (
                  <div key={entry.primitive} style={styles.entry}>
                    <div style={styles.entryHeading}>
                      <code style={styles.primitive}>{entry.primitive}</code>
                      <Chip tone={statusTone(entry.status)}>
                        {statusLabel(entry.status)}
                      </Chip>
                    </div>
                    {entry.sourceKinds?.length ? (
                      <span style={styles.detail}>
                        {entry.sourceKinds.join(", ")} · {entry.producer}
                      </span>
                    ) : null}
                    {entry.followUp ? (
                      <a
                        href={entry.followUp}
                        target="_blank"
                        rel="noreferrer"
                        style={styles.followUp}
                      >
                        Follow-up
                      </a>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}

function statusLabel(status: EvidenceCoverageStatus): string {
  switch (status) {
    case "caller-authored":
      return "Caller-authored";
    case "not-applicable":
      return "Not applicable";
    case "planned":
      return "Planned";
    default:
      return titleCase(status);
  }
}

function statusTone(status: EvidenceCoverageStatus): Tone {
  return status === "automatic"
    ? "ok"
    : status === "blocked"
      ? "warn"
      : status === "planned"
        ? "blue"
        : "muted";
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
