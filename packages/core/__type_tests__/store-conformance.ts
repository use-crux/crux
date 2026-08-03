import { expectTypeOf } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  inMemorySearchStore,
} from "@use-crux/core/storage";
import {
  describeAssetStoreConformance,
  describeRecordStoreConformance,
  describeSearchStoreConformance,
  searchStoreConformanceSuite,
} from "@use-crux/core/storage/testing/vitest";
import type {
  DescribeAssetStoreConformanceOptions,
  DescribeRecordStoreConformanceOptions,
  DescribeSearchStoreConformanceOptions,
  SearchStoreConformanceSuiteOptions,
} from "@use-crux/core/storage/testing/vitest";
import type {
  AssetStore,
  JsonObject,
  RecordStore,
  SearchStore,
} from "@use-crux/core/storage";

interface ConformanceRecord extends JsonObject {
  readonly title: string;
}

expectTypeOf(describeRecordStoreConformance<ConformanceRecord>)
  .parameter(0)
  .toEqualTypeOf<DescribeRecordStoreConformanceOptions<ConformanceRecord>>();
expectTypeOf(describeSearchStoreConformance)
  .parameter(0)
  .toEqualTypeOf<DescribeSearchStoreConformanceOptions>();
expectTypeOf(searchStoreConformanceSuite)
  .parameter(0)
  .toEqualTypeOf<SearchStoreConformanceSuiteOptions>();
expectTypeOf(describeAssetStoreConformance)
  .parameter(0)
  .toEqualTypeOf<DescribeAssetStoreConformanceOptions>();

const recordOptions: DescribeRecordStoreConformanceOptions<ConformanceRecord> =
  {
    name: "type-test-records",
    prepare: () => inMemoryRecordStore<ConformanceRecord>(),
  };

const searchOptions: DescribeSearchStoreConformanceOptions = {
  name: "type-test-search",
  prepare: () => inMemorySearchStore(),
};

const assetOptions: DescribeAssetStoreConformanceOptions = {
  name: "type-test-assets",
  prepare: () => inMemoryAssetStore(),
};

const searchSuiteOptions: SearchStoreConformanceSuiteOptions = {
  name: "type-test-search-suite",
  create: async () => ({
    records: inMemoryRecordStore(),
    search: inMemorySearchStore(),
  }),
};

expectTypeOf(recordOptions.prepare()).toEqualTypeOf<
  RecordStore<ConformanceRecord> | Promise<RecordStore<ConformanceRecord>>
>();
expectTypeOf(searchOptions.prepare()).toEqualTypeOf<
  SearchStore | Promise<SearchStore>
>();
expectTypeOf(assetOptions.prepare()).toEqualTypeOf<
  AssetStore | Promise<AssetStore>
>();

const invalidOptions: DescribeRecordStoreConformanceOptions = {
  name: "invalid-store",
  // @ts-expect-error Record conformance requires a RecordStore factory.
  prepare: () => inMemorySearchStore(),
};

void recordOptions;
void searchOptions;
void searchSuiteOptions;
void assetOptions;
void invalidOptions;
