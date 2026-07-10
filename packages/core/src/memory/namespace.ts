/**
 * Shared namespace resolution for Memory and MemoryBlock runtime paths.
 *
 * Memory can render and capture asynchronously, but tool collection is still a
 * synchronous prompt-resolution surface. Keeping both paths here prevents
 * dynamic namespace failures from silently becoming empty-namespace writes.
 *
 * @module
 */

/** Input passed to a dynamic memory namespace resolver. */
export interface MemoryNamespaceContext {
  /** Prompt or direct-call input used to scope this memory operation. */
  input: Record<string, unknown>;
  /** Optional prompt identifier for prompt-bound memory operations. */
  promptId?: string;
}

/** Static namespace string or dynamic resolver used to scope memory data. */
export type MemoryNamespace =
  | string
  | ((ctx: MemoryNamespaceContext) => string | Promise<string>);

/** Options shared by sync and async namespace resolution. */
export interface ResolveMemoryNamespaceOptions extends MemoryNamespaceContext {
  /** Explicit namespace override. Empty string is valid only when passed intentionally. */
  override?: string;
}

/**
 * Resolve a namespace for async memory surfaces such as rendering, capture, and
 * proposal operations.
 */
export async function resolveMemoryNamespace(
  namespace: MemoryNamespace,
  options: ResolveMemoryNamespaceOptions,
): Promise<string> {
  if (options.override !== undefined) return options.override;
  const resolved =
    typeof namespace === "function"
      ? await namespace({ input: options.input, promptId: options.promptId })
      : namespace;
  return assertResolvedNamespace(resolved);
}

/**
 * Resolve a namespace for synchronous memory surfaces such as `asTools()`.
 *
 * Throws when a namespace resolver returns a promise, because returning tools
 * with `namespace: ''` would create writes in the wrong keyspace.
 */
export function resolveMemoryNamespaceSync(
  namespace: MemoryNamespace,
  options: ResolveMemoryNamespaceOptions & { boundary: string },
): string {
  if (options.override !== undefined) return options.override;
  if (typeof namespace !== "function")
    return assertResolvedNamespace(namespace);

  const resolved = namespace({
    input: options.input,
    promptId: options.promptId,
  });
  if (isPromiseLike(resolved)) {
    throw new Error(
      `Memory namespace for ${options.boundary} resolved asynchronously, but ${options.boundary} is synchronous. ` +
        "Pass an explicit namespace or use memory rendering/capture surfaces that support async namespaces.",
    );
  }
  return assertResolvedNamespace(resolved);
}

function assertResolvedNamespace(namespace: string): string {
  if (typeof namespace !== "string") {
    throw new Error("Memory namespace resolver must return a string.");
  }
  return namespace;
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return !!value && typeof value === "object" && "then" in value;
}
