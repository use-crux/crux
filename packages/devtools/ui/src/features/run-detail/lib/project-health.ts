import type {
  CruxCurrentCatalogComparison,
  CruxCurrentProjectHealth,
  CruxCurrentProjectHealthFinding,
  CruxCurrentProjectHealthMatch,
} from "@use-crux/core/observability";
import type { NavState } from "@/app/navigation/useNavigation";

/** One matched definition with navigation only when current Catalog resolution is safe. */
export interface CurrentProjectHealthMatchView extends CruxCurrentProjectHealthMatch {
  to?: NavState;
}

type WithCatalogLinks<T extends CruxCurrentProjectHealthFinding> =
  T extends CruxCurrentProjectHealthFinding
    ? Omit<T, "matchedDefinitions"> & {
        matchedDefinitions: CurrentProjectHealthMatchView[];
      }
    : never;

export type CurrentProjectHealthFindingView =
  WithCatalogLinks<CruxCurrentProjectHealthFinding>;

export interface CurrentProjectHealthView {
  indexedAt: string;
  active: Array<Exclude<CurrentProjectHealthFindingView, { suppressed: true }>>;
  suppressed: Array<
    Extract<CurrentProjectHealthFindingView, { suppressed: true }>
  >;
}

function catalogTarget(
  match: CruxCurrentProjectHealthMatch,
  resolvedDefinitionIds: ReadonlySet<string>,
): NavState | undefined {
  if (!resolvedDefinitionIds.has(match.definitionId)) return undefined;
  switch (match.kind) {
    case "prompt":
      return { view: "library-index", promptId: match.definitionId };
    case "context":
      return { view: "library-index", contextId: match.definitionId };
    case "tool":
      return { view: "library-index", toolName: match.definitionId };
    default:
      return undefined;
  }
}

function projectFinding(
  finding: CruxCurrentProjectHealthFinding,
  resolvedDefinitionIds: ReadonlySet<string>,
): CurrentProjectHealthFindingView {
  const matchedDefinitions = finding.matchedDefinitions.map((match) => {
    const to = catalogTarget(match, resolvedDefinitionIds);
    return { ...match, ...(to ? { to } : {}) };
  });
  if (finding.suppressed) {
    return { ...finding, suppressed: true, matchedDefinitions };
  }
  return { ...finding, matchedDefinitions };
}

/**
 * Builds the Run Detail view without inferring or repairing suppression state.
 *
 * Catalog navigation is fail-closed: it requires both a positive current
 * Catalog identity match and a definition kind supported by the Index router.
 */
export function projectCurrentProjectHealth(
  health: CruxCurrentProjectHealth | undefined,
  currentCatalog?: CruxCurrentCatalogComparison,
): CurrentProjectHealthView | undefined {
  if (!health) return undefined;

  const resolvedDefinitionIds = new Set(
    currentCatalog?.definitions
      .filter((definition) => definition.matched)
      .map((definition) => definition.definitionId) ?? [],
  );
  const active: CurrentProjectHealthView["active"] = [];
  const suppressed: CurrentProjectHealthView["suppressed"] = [];
  for (const finding of health.findings) {
    const view = projectFinding(finding, resolvedDefinitionIds);
    if (view.suppressed) suppressed.push(view);
    else active.push(view);
  }
  return { indexedAt: health.indexedAt, active, suppressed };
}
