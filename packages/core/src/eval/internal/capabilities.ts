/** Signal families an Eval task can prove it captures. */
export type Capability =
  | "modelCalls"
  | "toolCalls"
  | "steps"
  | "handoffs"
  | "retrieval"
  | "citations"
  | "safety"
  | "memory"
  | "routing"
  | "decisionReport";

/** Opaque provider model identity accepted by managed scorer adapters. */
export type ModelRef = unknown;

/** Opaque provider-neutral generation bridge used by managed scorers. */
export type GenerateFn = (prompt: never, options: never) => Promise<unknown>;
