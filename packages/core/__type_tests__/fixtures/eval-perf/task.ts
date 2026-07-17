import type { EvalTask } from "../../../src/eval";

export interface PerfInput {
  readonly question: string;
  readonly tier: "free" | "pro";
  readonly index: number;
}

export interface PerfOutput {
  readonly answer: string;
  readonly confidence: number;
  readonly tags: readonly string[];
}

export interface PerfExpected {
  readonly phrase: string;
}

export declare const perfTask: EvalTask<
  PerfInput,
  { readonly object?: PerfOutput },
  PerfOutput,
  { readonly locale: "en" | "nl" },
  { readonly temperature?: number },
  "modelCalls" | "safety" | "decisionReport"
>;
