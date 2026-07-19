/** Return a safe, stable model id without stringifying arbitrary objects. */
export function describeCompletedModel(model: unknown): string | undefined {
  if (typeof model === "string" && model.trim()) return model.trim();
  if (typeof model !== "object" || model === null) return undefined;

  const candidate = model as {
    readonly modelId?: unknown;
    readonly id?: unknown;
  };
  if (typeof candidate.modelId === "string" && candidate.modelId.trim()) {
    return candidate.modelId.trim();
  }
  if (typeof candidate.id === "string" && candidate.id.trim()) {
    return candidate.id.trim();
  }
  return undefined;
}
