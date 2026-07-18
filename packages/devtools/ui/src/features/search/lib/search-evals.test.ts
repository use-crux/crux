import { describe, expect, it } from "vitest";
import type { EvalCatalogEntry } from "@/features/evals/types";
import { searchEvals } from "./search-evals";

const evals: EvalCatalogEntry[] = [
  {
    id: "support.refunds",
    definitionFingerprint: "support-fingerprint",
    sourceKey: { relativeFile: "evals/support.eval.ts" },
    cases: [{ id: "refund-policy" }],
    variants: ["current", "cheaper"],
    description: "Answers customer refund questions",
    tags: ["customer-service"],
  },
];

describe("searchEvals", () => {
  it.each(["support", "refund", "customer-service", "cheaper"])(
    "finds an Eval by %s",
    (query) => {
      expect(searchEvals(evals, query)).toEqual([
        expect.objectContaining({
          category: "evals",
          label: "support.refunds",
          nav: { view: "evals", evalId: "support.refunds" },
        }),
      ]);
    },
  );
});
