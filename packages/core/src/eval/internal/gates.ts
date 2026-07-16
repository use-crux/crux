/** Pure zero-config blocking projection across Current and candidate arms. @internal */

import type { EvalCell, EvalGateSummary } from "./types";

export function evaluateBlockingGates(
  cells: readonly EvalCell[],
  blockingVariants: readonly string[],
): EvalGateSummary {
  const blocking = new Set(blockingVariants);
  const passed = cells
    .filter((cell) => blocking.has(cell.variant))
    .every((cell) => cell.status === "passed");
  const results = Object.freeze(
    [...new Set(cells.map((cell) => cell.variant))].map((variant) => {
      const cellPassed = cells
        .filter((cell) => cell.variant === variant)
        .every((cell) => cell.status === "passed");
      return Object.freeze({
        gate: "pass" as const,
        variantName: variant,
        threshold: true as const,
        actual: cellPassed,
        passed: cellPassed,
        ...(!blocking.has(variant) ? { informational: true as const } : {}),
      });
    }),
  );
  return Object.freeze({
    passed,
    blockingPassed: passed,
    results,
  });
}
