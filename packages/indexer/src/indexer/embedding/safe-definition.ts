import type { ExtractContext } from "../extensions";

/** Remove authored source text from embedding projections before snapshot merge. */
export function byteSafeEmbeddingDefinition<
  T extends ReturnType<ExtractContext["define"]["definition"]>,
>(input: T): T {
  const { sourceSnippet: _sourceSnippet, ...definition } = input.definition;
  return { ...input, definition } as T;
}
