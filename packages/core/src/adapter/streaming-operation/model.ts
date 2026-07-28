/** Project a model reference into its payload-free observability identity. */
export function describeStreamingModel(model: unknown): string | undefined {
  if (typeof model === "string" && model.trim()) return model;
  if (typeof model !== "object" || model === null) return undefined;
  const value = model as { readonly modelId?: unknown; readonly id?: unknown };
  if (typeof value.modelId === "string") return value.modelId;
  return typeof value.id === "string" ? value.id : undefined;
}
