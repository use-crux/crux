import type { NavState } from "@/app/navigation/useNavigation";
import type { EvalCatalogEntry } from "@/features/evals/types";

export interface EvalSearchResult {
  readonly category: "evals";
  readonly id: string;
  readonly label: string;
  readonly meta: string;
  readonly nav: NavState;
}

const MAX_RESULTS = 5;

function matches(query: string, ...fields: readonly string[]): boolean {
  const normalized = query.toLowerCase();
  return fields.some((field) => field.toLowerCase().includes(normalized));
}

/** Search the discovered Eval catalog shown by the Evals workspace. */
export function searchEvals(
  evals: readonly EvalCatalogEntry[],
  query: string,
): EvalSearchResult[] {
  const results: EvalSearchResult[] = [];
  for (const definition of evals) {
    if (results.length >= MAX_RESULTS) break;
    if (
      !matches(
        query,
        definition.id,
        definition.description ?? "",
        definition.sourceKey.relativeFile,
        ...(definition.tags ?? []),
        ...definition.variants,
        ...definition.cases.map((testCase) => testCase.id),
      )
    ) {
      continue;
    }
    results.push({
      category: "evals",
      id: definition.id,
      label: definition.id,
      meta:
        definition.description ??
        `${definition.cases.length} ${definition.cases.length === 1 ? "case" : "cases"} · ${definition.sourceKey.relativeFile}`,
      nav: { view: "evals", evalId: definition.id },
    });
  }
  return results;
}
