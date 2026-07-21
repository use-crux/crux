import type { EmbeddingModality } from '@use-crux/core/embedding'

/** SDK- and documentation-verified defaults for known Google embedding ids. */
export const GOOGLE_EMBEDDING_MODEL_MODALITIES = {
  'gemini-embedding-2': ['text', 'image', 'audio', 'video', 'document'],
  'gemini-embedding-001': ['text'],
  'text-embedding-004': ['text'],
} as const satisfies Record<string, readonly EmbeddingModality[]>

/** Default modality union for a literal Google model id. */
export type GoogleDefaultEmbeddingModality<TModel extends string> =
  TModel extends keyof typeof GOOGLE_EMBEDDING_MODEL_MODALITIES
    ? (typeof GOOGLE_EMBEDDING_MODEL_MODALITIES)[TModel][number]
    : 'text'

/** Resolve explicit modalities before applying the conservative model default. */
export function googleEmbeddingModalities(
  model: string,
  explicit: readonly EmbeddingModality[] | undefined,
): readonly EmbeddingModality[] {
  if (explicit) return explicit
  return model in GOOGLE_EMBEDDING_MODEL_MODALITIES
    ? GOOGLE_EMBEDDING_MODEL_MODALITIES[model as keyof typeof GOOGLE_EMBEDDING_MODEL_MODALITIES]
    : ['text']
}
