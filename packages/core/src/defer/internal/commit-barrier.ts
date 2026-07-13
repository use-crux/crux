type CommitOperationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown };

/** Tracks strict named operations even when their caller-facing promise is ignored. */
export interface DeferCommitBarrier {
  track(operation: PromiseLike<unknown>): void;
  settle(): Promise<void>;
}

/** Create one append-only strict commit barrier. @internal */
export function createDeferCommitBarrier(): DeferCommitBarrier {
  const operations: Array<Promise<CommitOperationResult>> = [];
  return {
    track(operation) {
      operations.push(
        Promise.resolve(operation).then<
          CommitOperationResult,
          CommitOperationResult
        >(
          () => ({ ok: true }),
          (error: unknown) => ({ ok: false, error }),
        ),
      );
    },
    async settle() {
      const results = await Promise.all(operations);
      const failure = results.find(
        (
          result,
        ): result is Extract<CommitOperationResult, { readonly ok: false }> =>
          !result.ok,
      );
      if (failure) throw failure.error;
    },
  };
}
