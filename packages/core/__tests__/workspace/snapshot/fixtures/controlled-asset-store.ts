import { inMemoryAssetStore } from "../../../../src/storage";
import type { AssetRef, AssetStore } from "../../../../src/storage";

/** Controllable AssetStore boundary with successful ownership logs. */
export function controlledAssetStore(): {
  readonly store: AssetStore;
  readonly putRefs: readonly AssetRef[];
  readonly deletedRefs: readonly AssetRef[];
  failPuts(error: Error): void;
  failGets(error: Error): void;
  blockGetWhen(predicate: (ref: AssetRef) => boolean): {
    readonly entered: Promise<void>;
    release(): void;
  };
  failDelete(ref: AssetRef, error: Error): void;
  clearFailures(): void;
} {
  const inner = inMemoryAssetStore();
  const putRefs: AssetRef[] = [];
  const deletedRefs: AssetRef[] = [];
  let getFailure: Error | undefined;
  let putFailure: Error | undefined;
  let getBarrier:
    | {
        readonly predicate: (ref: AssetRef) => boolean;
        readonly entered: () => void;
        readonly wait: Promise<void>;
      }
    | undefined;
  let deleteFailure:
    | { readonly uri: string; readonly error: Error }
    | undefined;
  return {
    store: Object.freeze({
      put: async (asset, options) => {
        if (putFailure) throw putFailure;
        const stored = await inner.put(asset, options);
        putRefs.push(stored.ref);
        return stored;
      },
      get: async (ref) => {
        if (getFailure) throw getFailure;
        if (getBarrier?.predicate(ref)) {
          const barrier = getBarrier;
          barrier.entered();
          await barrier.wait;
        }
        return inner.get(ref);
      },
      delete: async (ref) => {
        if (deleteFailure?.uri === ref.uri) throw deleteFailure.error;
        await inner.delete(ref);
        deletedRefs.push(ref);
      },
    }),
    putRefs,
    deletedRefs,
    failPuts: (error) => {
      putFailure = error;
    },
    failGets: (error) => {
      getFailure = error;
    },
    blockGetWhen: (predicate) => {
      let enter!: () => void;
      let release!: () => void;
      const entered = new Promise<void>((resolve) => {
        enter = resolve;
      });
      const wait = new Promise<void>((resolve) => {
        release = resolve;
      });
      getBarrier = { predicate, entered: enter, wait };
      return {
        entered,
        release: () => {
          getBarrier = undefined;
          release();
        },
      };
    },
    failDelete: (ref, error) => {
      deleteFailure = { uri: ref.uri, error };
    },
    clearFailures: () => {
      putFailure = undefined;
      getFailure = undefined;
      deleteFailure = undefined;
    },
  };
}
