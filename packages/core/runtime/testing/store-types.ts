import type { RuntimeStoreAdapter } from '../store'

/** Options for {@link runStoreAdapterTests}. */
export interface RunStoreAdapterTestsOptions<
  TStore extends RuntimeStoreAdapter = RuntimeStoreAdapter,
> {
  /** Human-readable adapter name used for the Vitest `describe()` block. */
  readonly name: string
  /** Create a fresh, isolated store for each conformance test. */
  readonly createStore: () => TStore | Promise<TStore>
  /** Configure the next transaction to fail after N successful writes. */
  readonly failAfterWrites: (store: TStore, writes: number) => void
  /** Configure the next outbox confirmation to crash before mutation. */
  readonly crashBeforeOutboxConfirm: (store: TStore) => void
  /** Assert that the adapter intentionally serializes all transactions. */
  readonly assertSerializedTransactions?: boolean
}
