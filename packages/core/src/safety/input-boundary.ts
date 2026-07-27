import type { BoundaryDef } from "./boundary";
import type {
  InputBoundaryOptions,
  InputSource,
  InputSourcesFromOptions,
  MediaInputSource,
  ModelInputOrigin,
  ModelInputOriginFor,
  NonEmptyInputBoundaryOptions,
  TextInputSource,
} from "./input-origin";
import type { MediaPartSubject } from "./media/types";

const TEXT_SOURCES = [
  "user",
  "tool",
  "retrieval",
  "memory",
  "handoff",
  "feedback",
] as const;
const MEDIA_SOURCES = ["user", "tool"] as const;

/**
 * Target untrusted text immediately before it enters a governed model.
 *
 * With no options, the boundary matches user, tool, rendered retrieval,
 * memory, handoff, and framework-feedback text. Use {@link toolPolicy} instead
 * when policy logic needs the raw tool result before canonical model-output
 * conversion.
 *
 * @param options Optional semantic source filter.
 * @returns A frozen text boundary with callback origin narrowed to `from`.
 *
 * @example
 * ```ts
 * const allText = boundary.input.text()
 * ```
 *
 * @example
 * ```ts
 * const toolText = boundary.input.text({ from: 'tool' })
 * ```
 */
function text<
  const TOptions extends InputBoundaryOptions<TextInputSource> =
    InputBoundaryOptions<TextInputSource>,
>(
  options?: NonEmptyInputBoundaryOptions<TOptions>,
): BoundaryDef<
  "model.input.text",
  string,
  ModelInputOriginFor<InputSourcesFromOptions<TOptions, TextInputSource>>
> {
  return createInputBoundary(
    "model.input.text",
    normalizeInputSources(options?.from, TEXT_SOURCES),
  );
}

/**
 * Target canonical untrusted media immediately before it enters a governed model.
 *
 * With no options, the boundary matches user and tool media. Retrieval is not
 * a media source because retrieved assets are not implicitly hydrated. Use
 * {@link toolPolicy} for raw tool results before canonical conversion.
 *
 * @param options Optional semantic source filter.
 * @returns A frozen media boundary whose subject is a {@link MediaPartSubject}.
 *
 * @example
 * ```ts
 * const allMedia = boundary.input.media()
 * ```
 *
 * @example
 * ```ts
 * const toolMedia = boundary.input.media({ from: 'tool' })
 * ```
 */
function media<
  const TOptions extends InputBoundaryOptions<MediaInputSource> =
    InputBoundaryOptions<MediaInputSource>,
>(
  options?: NonEmptyInputBoundaryOptions<TOptions>,
): BoundaryDef<
  "model.input.media",
  MediaPartSubject,
  ModelInputOriginFor<InputSourcesFromOptions<TOptions, MediaInputSource>>
> {
  return createInputBoundary(
    "model.input.media",
    normalizeInputSources(options?.from, MEDIA_SOURCES),
  );
}

/**
 * Target trusted developer and system instructions sent to a governed model.
 *
 * @remarks
 * This boundary has no source filter. A system message is not trusted merely
 * because of its role: rendered retrieval, memory, blackboard, and handoff text
 * remain on {@link text} with their untrusted sources. Raw tool values belong
 * in {@link toolPolicy}.
 *
 * @returns A frozen trusted-instructions boundary.
 *
 * @example
 * ```ts
 * const trustedInstructions = boundary.input.instructions()
 * ```
 */
function instructions(): BoundaryDef<
  "model.instructions",
  string,
  Extract<ModelInputOrigin, { readonly source: "instructions" }>
> {
  return createInputBoundary("model.instructions");
}

/** @internal Public input helper group mounted at `boundary.input`. */
export const inputBoundary = Object.freeze({ text, media, instructions });

function createInputBoundary<
  TId extends "model.input.text" | "model.input.media" | "model.instructions",
  TSubject,
  TOrigin = unknown,
>(id: TId, from?: readonly InputSource[]): BoundaryDef<TId, TSubject, TOrigin> {
  const descriptor =
    from === undefined
      ? { _tag: "Boundary" as const, id }
      : { _tag: "Boundary" as const, id, from };
  return Object.freeze(descriptor) as BoundaryDef<TId, TSubject, TOrigin>;
}

function normalizeInputSources<TSource extends InputSource>(
  selected: TSource | readonly TSource[] | undefined,
  supported: readonly TSource[],
): readonly TSource[] | undefined {
  if (selected === undefined) return undefined;
  const values = Array.isArray(selected) ? selected : [selected];
  if (values.length === 0)
    throw new TypeError("Input boundary source filters cannot be empty.");
  const normalized = [...new Set(values)];
  for (const source of normalized) {
    if (!supported.includes(source)) {
      throw new TypeError(
        `Unsupported input boundary source: ${String(source)}`,
      );
    }
  }
  return Object.freeze(normalized);
}
