import type {
  CruxCurrentCatalogComparison,
  CruxCurrentProjectHealth,
  CruxProjectHealthMatchKind,
  CruxRunDetail,
  CruxRunManifestResolution,
} from "../src/observability";

declare const detail: CruxRunDetail;

const historical: CruxRunManifestResolution | undefined = detail.manifest;
const current: CruxCurrentCatalogComparison | undefined = detail.currentCatalog;
const health: CruxCurrentProjectHealth | undefined =
  detail.currentProjectHealth;

if (historical?.resolution === "resolved") {
  const definitionId: string | undefined =
    historical.definitions[0]?.definition?.id;
  void definitionId;
}

if (current?.resolution === "project-mismatch") {
  const label: "current-catalog" = current.label;
  void label;
}

if (health) {
  const label: "current-project-health" = health.label;
  const matchKind: CruxProjectHealthMatchKind | undefined =
    health.findings[0]?.matchedDefinitions[0]?.matchKinds[0];
  const finding = health.findings[0];
  if (finding?.suppressed) {
    const directiveFile: string = finding.suppressedBy.source.file;
    void directiveFile;
  }
  void label;
  void matchKind;
}

void historical;
void current;
void health;
