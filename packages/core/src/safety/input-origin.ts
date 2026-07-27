/** Semantic owners supported by `boundary.input.text()`. */
export type TextInputSource =
  | "user"
  | "tool"
  | "retrieval"
  | "memory"
  | "handoff"
  | "feedback";

/** Semantic owners supported by `boundary.input.media()`. */
export type MediaInputSource = "user" | "tool";

/** Any semantic source accepted by a model-ingress boundary. */
export type InputSource = TextInputSource | MediaInputSource;

/**
 * Selects the semantic sources matched by a model-ingress boundary.
 *
 * Omitting `from` matches every source supported by the helper. A scalar
 * selects one source; a readonly array selects their union. Empty arrays are
 * rejected when the descriptor is created.
 */
export interface InputBoundaryOptions<TSource extends InputSource> {
  /** One source, or a non-empty source tuple, to match. Omit to match all supported sources. */
  readonly from?: TSource | readonly TSource[];
}

/** Resolve a semantic source union from input-boundary options. */
export type InputSourcesFromOptions<
  TOptions,
  TFallback extends InputSource,
> = TOptions extends {
  readonly from: infer TSelection;
}
  ? TSelection extends readonly (infer TSource)[]
    ? Extract<TSource, TFallback>
    : Extract<TSelection, TFallback>
  : TFallback;

/** Reject a statically known empty source tuple while retaining dynamic arrays. */
export type NonEmptyInputBoundaryOptions<TOptions> = TOptions extends {
  readonly from: readonly [];
}
  ? never
  : TOptions;

/**
 * Privacy-safe provenance supplied to model-ingress policy callbacks.
 *
 * Origins identify only the semantic owner and stable coordinates needed for
 * policy logic. They never contain input text, tool values, retrieval queries,
 * memory content, handoff payloads, feedback text, URLs, media bytes, or
 * provider objects.
 */
export type ModelInputOrigin =
  | {
      readonly source: "user";
      readonly kind: "message" | "prompt" | "operation";
      readonly messageIndex?: number;
      readonly partIndex?: number;
    }
  | {
      readonly source: "tool";
      readonly kind: "tool-result";
      readonly toolName: string;
      readonly toolCallId?: string;
      readonly partIndex?: number;
    }
  | {
      readonly source: "retrieval";
      readonly kind: "retrieval-context";
      readonly retrieverId: string;
      readonly blockIndex?: number;
      readonly segmentIndex?: number;
    }
  | {
      /** Identifies rendered managed-memory model ingress. */
      readonly source: "memory";
      /** Distinguishes managed memory from shared blackboard state. */
      readonly kind: "memory-context";
      /** Stable first-party memory identifier. */
      readonly memoryId: string;
      /** Zero-based rendered ingress block index when one context emits multiple blocks. */
      readonly blockIndex?: number;
    }
  | {
      /** Identifies rendered shared-blackboard model ingress. */
      readonly source: "memory";
      /** Distinguishes shared blackboard state from managed memory. */
      readonly kind: "blackboard-context";
      /** Stable first-party blackboard identifier. */
      readonly boardId: string;
      /** Zero-based rendered ingress block index when one board emits multiple blocks. */
      readonly blockIndex?: number;
    }
  | {
      /** Identifies content received through an agent handoff. */
      readonly source: "handoff";
      /** Stable handoff ingress category. */
      readonly kind: "handoff-context";
      /** Stable first-party handoff identifier. */
      readonly handoffId: string;
      /** Zero-based rendered ingress block index when one handoff emits multiple blocks. */
      readonly blockIndex?: number;
    }
  | {
      /** Identifies framework-produced corrective model ingress. */
      readonly source: "feedback";
      /** Corrective content category. */
      readonly kind:
        | "validation-feedback"
        | "constraint-feedback"
        | "rejected-output";
      /** One-based corrective attempt shared by rejected output and feedback. */
      readonly attempt: number;
    }
  | {
      /** Identifies authored or provider-adapted instructions. */
      readonly source: "instructions";
      /** Closest privacy-safe instruction category. */
      readonly kind: "prompt" | "context" | "skill" | "provider-adaptation";
      /** Stable authored context identifier when one exists. */
      readonly contextId?: string;
      /** Zero-based rendered ingress block index for multi-block contexts. */
      readonly blockIndex?: number;
    };

/** Narrows model-ingress provenance to the selected source union. */
export type ModelInputOriginFor<TSource extends InputSource> = Extract<
  ModelInputOrigin,
  { readonly source: TSource }
>;
