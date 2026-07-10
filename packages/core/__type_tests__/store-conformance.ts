import { expectTypeOf } from "vitest";
import {
  inMemoryAssetStore,
  inMemoryRecordStore,
  inMemoryVectorStore,
} from "@use-crux/core/storage";
import {
  describeAssetStoreConformance,
  describeRecordStoreConformance,
  describeVectorStoreConformance,
  vectorStoreConformanceSuite,
} from "@use-crux/core/storage/testing/vitest";
import type {
  DescribeAssetStoreConformanceOptions,
  DescribeRecordStoreConformanceOptions,
  DescribeVectorStoreConformanceOptions,
  VectorStoreConformanceSuiteOptions,
} from "@use-crux/core/storage/testing/vitest";
import type {
  AssetStore,
  JsonObject,
  RecordStore,
  VectorStore,
} from "@use-crux/core/storage";

interface ConformanceRecord extends JsonObject {
  readonly title: string;
}

expectTypeOf(describeRecordStoreConformance<ConformanceRecord>)
  .parameter(0)
  .toEqualTypeOf<DescribeRecordStoreConformanceOptions<ConformanceRecord>>();
expectTypeOf(describeVectorStoreConformance)
  .parameter(0)
  .toEqualTypeOf<DescribeVectorStoreConformanceOptions>();
expectTypeOf(vectorStoreConformanceSuite)
  .parameter(0)
  .toEqualTypeOf<VectorStoreConformanceSuiteOptions>();
expectTypeOf(describeAssetStoreConformance)
  .parameter(0)
  .toEqualTypeOf<DescribeAssetStoreConformanceOptions>();

const recordOptions: DescribeRecordStoreConformanceOptions<ConformanceRecord> =
  {
    name: "type-test-records",
    prepare: () => inMemoryRecordStore<ConformanceRecord>(),
  };

const vectorOptions: DescribeVectorStoreConformanceOptions = {
  name: "type-test-vectors",
  prepare: () => inMemoryVectorStore(),
};

const assetOptions: DescribeAssetStoreConformanceOptions = {
  name: "type-test-assets",
  prepare: () => inMemoryAssetStore(),
};

const vectorSuiteOptions: VectorStoreConformanceSuiteOptions = {
  name: "type-test-vector-suite",
  create: async () => ({
    records: inMemoryRecordStore(),
    vectors: inMemoryVectorStore(),
    cleanup: async () => {},
  }),
  capabilities: { sparse: true, hybrid: true, delete: true },
};

expectTypeOf(recordOptions.prepare()).toEqualTypeOf<
  RecordStore<ConformanceRecord> | Promise<RecordStore<ConformanceRecord>>
>();
expectTypeOf(vectorOptions.prepare()).toEqualTypeOf<
  VectorStore | Promise<VectorStore>
>();
expectTypeOf(assetOptions.prepare()).toEqualTypeOf<
  AssetStore | Promise<AssetStore>
>();

const invalidOptions: DescribeRecordStoreConformanceOptions = {
  name: "invalid-store",
  // @ts-expect-error Record conformance requires a RecordStore factory.
  prepare: () => inMemoryVectorStore(),
};

void recordOptions;
void vectorOptions;
void vectorSuiteOptions;
void assetOptions;
void invalidOptions;
