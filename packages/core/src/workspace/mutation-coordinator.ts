/**
 * Same-process serialization for Workspace namespace mutations.
 *
 * @module
 */

const namespaceLocks = new Map<string, Promise<void>>();

/** Serialize one mutation against other work in the same Workspace namespace. */
export async function withWorkspaceMutationLock<T>(
  workspaceId: string,
  namespace: string,
  run: () => Promise<T>,
): Promise<T> {
  const key = `${workspaceId}\0${namespace}`;
  const previous = namespaceLocks.get(key) ?? Promise.resolve();
  let release: () => void = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const current = previous.catch(() => undefined).then(() => pending);
  namespaceLocks.set(key, current);
  await previous.catch(() => undefined);
  try {
    return await run();
  } finally {
    release();
    if (namespaceLocks.get(key) === current) {
      namespaceLocks.delete(key);
    }
  }
}
