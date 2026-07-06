/**
 * Runtime store adapter conformance suite.
 *
 * Adapter packages call {@link runStoreAdapterTests} from their Vitest suites
 * to prove the storage layer preserves the invariants the Runtime Engine
 * kernel depends on: durable events, waiter races, namespace isolation,
 * leases, timer records, outbox recovery, JSON cloning, and transaction
 * rollback.
 *
 * @module
 */

import { describe } from 'vitest'
import type { RuntimeStoreAdapter } from '../store'
import { registerStoreCoordinationTests } from './store-coordination'
import { registerStoreRecordTests } from './store-records'
import { registerStoreRetentionTests } from './store-retention'
import type { RunStoreAdapterTestsOptions } from './store-types'

export type { RunStoreAdapterTestsOptions } from './store-types'

/** Register shared behavior checks for Runtime Engine store adapters. */
export function runStoreAdapterTests<TStore extends RuntimeStoreAdapter>(
  options: RunStoreAdapterTestsOptions<TStore>,
): void {
  describe(`${options.name} RuntimeStoreAdapter conformance`, () => {
    registerStoreRecordTests(options)
    registerStoreRetentionTests(options)
    registerStoreCoordinationTests(options)
  })
}
