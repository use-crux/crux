/**
 * Project published canonical structured text into partial values (RFC #173).
 *
 * `partialOutputStream` is a parsed projection of the SAME canonical text the
 * caller receives on `textStream` — not a second, independently gated channel.
 * Deriving it here rather than from a parallel occurrence feed is what makes the
 * contract's structured guarantees hold by construction instead of by agreement
 * between two code paths:
 *
 * - a partial can only describe text that was already published, so a rejected
 *   attempt, an unresolved `assert` gate, or a pending validation retry
 *   contributes nothing simply because it published no text;
 * - partials grow monotonically because the released text prefix does;
 * - values are canonical `z.input` (manifest-decoded, sentinel-free) because the
 *   release cursor already canonicalized them.
 *
 * The projector is incremental: it scans each newly published fragment once and
 * tracks the longest prefix that can be completed into valid JSON by closing the
 * open containers. A partial is produced only when that prefix ADVANCES, so a
 * value emerges once it is structurally complete rather than once per delta.
 *
 * @internal
 * @module
 */

/** A container currently open in the scanned prefix. */
type OpenContainer = "object" | "array";

/** Incremental projector over one logical stream's canonical text. */
export interface CanonicalPartialProjector {
  /**
   * Append newly published canonical text.
   *
   * @returns The new partial value when the completable prefix advanced, or
   *   `undefined` when this fragment added nothing structurally complete.
   */
  push(fragment: string): { readonly value: unknown } | undefined;
}

/**
 * Create a projector over canonical structured text.
 *
 * @remarks
 * Text is scanned exactly once. Re-parsing is proportional to the completable
 * prefix and happens only when that prefix grows, which for a streamed object is
 * once per completed member rather than once per character.
 */
export function createCanonicalPartialProjector(): CanonicalPartialProjector {
  let text = "";
  /** Index scanned so far, so each character is examined once across pushes. */
  let scanned = 0;
  /** Containers open at `scanned`, innermost last. */
  const stack: OpenContainer[] = [];
  let inString = false;
  let escaped = false;
  /**
   * Length of the longest prefix that becomes valid JSON once `stack` is closed.
   *
   * Zero means nothing structurally complete has been published yet, so there is
   * no honest partial to emit: an unterminated root string or leading whitespace
   * projects nothing. Opening the root container IS complete — `{` already
   * justifies an empty object, since every member of a partial is optional.
   */
  let completable = 0;
  /** Whether a root-level value has completed, making the document itself final. */
  let rootDone = false;
  /**
   * The last candidate actually published.
   *
   * Several structural events can describe the SAME value — opening a nested
   * container, closing it, and closing its parent all complete `{"a":{}}` — so
   * comparing the candidate text keeps one value from being published three
   * times to a surface whose contract is monotonic growth.
   */
  let emitted: string | undefined;

  const closers = (): string =>
    stack
      .map((container) => (container === "object" ? "}" : "]"))
      .reverse()
      .join("");

  return {
    push(fragment) {
      if (fragment === "") return undefined;
      text += fragment;
      for (; scanned < text.length; scanned += 1) {
        const char = text[scanned] as string;
        if (inString) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') {
            inString = false;
            // A closed string is a complete value — but inside an object it may
            // be a KEY, whose member is not complete until its value arrives.
            // Marking it here would project `{"a"}`, which is not valid JSON, so
            // the object case waits for the value's delimiter instead.
            if (stack[stack.length - 1] !== "object") {
              completable = scanned + 1;
              if (stack.length === 0) rootDone = true;
            }
          }
          continue;
        }
        if (char === '"') {
          inString = true;
          continue;
        }
        if (char === "{" || char === "[") {
          stack.push(char === "{" ? "object" : "array");
          // An empty container is already a valid value.
          completable = scanned + 1;
          continue;
        }
        if (char === "}" || char === "]") {
          stack.pop();
          completable = scanned + 1;
          if (stack.length === 0) rootDone = true;
          continue;
        }
        if (char === ",") {
          // Everything before the separator is complete; the separator itself is
          // not, so a half-written next member is simply left out.
          completable = scanned;
          continue;
        }
        // `:` and whitespace carry no completion. Numbers, `true`, `false`, and
        // `null` are deliberately NOT marked complete on their own characters:
        // `12` may still become `123`, and `tru` is not `true`. They become
        // completable only at the delimiter that closes them, above.
      }
      if (completable === 0) return undefined;
      const candidate = text.slice(0, completable) + (rootDone ? "" : closers());
      if (candidate === emitted) return undefined;
      try {
        const value: unknown = JSON.parse(candidate);
        emitted = candidate;
        return { value };
      } catch {
        // A prefix we believed completable did not parse. Publishing nothing is
        // the safe outcome: the caller still receives the authoritative value on
        // `completion.object`, and a later fragment may resynchronize.
        return undefined;
      }
    },
  };
}
