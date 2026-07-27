/**
 * Semantic provenance for content entering a governed model.
 *
 * Origins describe where canonical input came from without retaining the
 * content itself. Use them to write source-aware policies and to interpret
 * privacy-safe Safety decisions.
 *
 * @module
 */

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
  /**
   * One source, or a non-empty source tuple, to match.
   *
   * @default All sources supported by the boundary helper.
   */
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
      /** Identifies caller-authored model input. */
      readonly source: "user";
      /** Canonical caller-input carrier. */
      readonly kind: "message" | "prompt" | "operation";
      /** Zero-based index in the canonical message list, when applicable. */
      readonly messageIndex?: number;
      /** Zero-based index in a multipart message, when applicable. */
      readonly partIndex?: number;
    }
  | {
      /** Identifies canonical content converted from a tool result. */
      readonly source: "tool";
      /** Stable tool-result ingress category. */
      readonly kind: "tool-result";
      /** Canonical provider-visible tool name. */
      readonly toolName: string;
      /** Provider-neutral tool-call identifier, when one exists. */
      readonly toolCallId?: string;
      /** Zero-based index in a multipart tool result, when applicable. */
      readonly partIndex?: number;
    }
  | {
      /** Identifies rendered retrieval context. */
      readonly source: "retrieval";
      /** Stable retrieval ingress category. */
      readonly kind: "retrieval-context";
      /** Stable first-party retriever identifier. */
      readonly retrieverId: string;
      /** Zero-based rendered retrieval block index, when applicable. */
      readonly blockIndex?: number;
      /** Zero-based segment index inside the rendered block, when applicable. */
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
