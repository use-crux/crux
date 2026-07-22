import type { IndexLintFinding } from "../../project-index/lint-types";

/** How a current lint finding reaches a definition observed by a run. */
export type CruxProjectHealthMatchKind =
  | "primary"
  | "related"
  | "affected"
  | "propagated";

/** One run-observed definition matched by a current Project Index finding. */
export interface CruxCurrentProjectHealthMatch {
  /** Canonical Project Index definition id. */
  definitionId: string;

  /** Definition kind emitted by the runtime reference. */
  kind: string;

  /** Runtime roles observed for this definition during the run. */
  roles: string[];

  /** Project Index fields through which the finding reaches this definition. */
  matchKinds: CruxProjectHealthMatchKind[];
}

type CurrentProjectHealthFindingFields =
  | "id"
  | "ruleId"
  | "severity"
  | "title"
  | "message"
  | "source"
  | "suppressed"
  | "suppressedBy";

type WithCurrentProjectHealthMatch<T extends IndexLintFinding> =
  T extends IndexLintFinding
    ? Pick<T, CurrentProjectHealthFindingFields> & {
        matchedDefinitions: CruxCurrentProjectHealthMatch[];
      }
    : never;

/**
 * A current authored lint finding relevant to definitions observed by a run.
 *
 * Suppression remains a strict retained-evidence union. Narrow on `suppressed`
 * before reading the required directive metadata.
 */
export type CruxCurrentProjectHealthFinding =
  WithCurrentProjectHealthMatch<IndexLintFinding>;

/**
 * Read-time lint context from the currently materialized Project Index.
 *
 * This projection describes current authored state, not historical run
 * evidence, and never contributes to the run's status.
 */
export interface CruxCurrentProjectHealth {
  label: "current-project-health";
  indexedAt: string;
  activeCount: number;
  suppressedCount: number;
  findings: CruxCurrentProjectHealthFinding[];
}
