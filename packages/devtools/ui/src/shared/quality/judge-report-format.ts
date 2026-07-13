import type { QualityJudgeReportScorer } from "@/types";

/** One labeled cell of the judge-vs-human confusion grid. */
export interface ConfusionGridCell {
  readonly key: "tp" | "fp" | "fn" | "tn";
  readonly label: string;
  readonly count: number;
  readonly agree: boolean;
}

/** Return the confusion grid in reading order: TP, FP, FN, TN. */
export function confusionGrid(
  confusion: QualityJudgeReportScorer["confusion"],
): ConfusionGridCell[] {
  return [
    {
      key: "tp",
      label: "Judge pass · Human pass",
      count: confusion.tp,
      agree: true,
    },
    {
      key: "fp",
      label: "Judge pass · Human fail",
      count: confusion.fp,
      agree: false,
    },
    {
      key: "fn",
      label: "Judge fail · Human pass",
      count: confusion.fn,
      agree: false,
    },
    {
      key: "tn",
      label: "Judge fail · Human fail",
      count: confusion.tn,
      agree: true,
    },
  ];
}

/** Format a 0–1 rate as a whole percentage, or `—` when absent. */
export function formatRate(value: number | null | undefined): string {
  return value == null ? "—" : `${Math.round(value * 100)}%`;
}

/** Format Cohen's kappa to two decimals, or `—` when absent. */
export function formatKappa(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(2);
}
