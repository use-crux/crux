import { expectTypeOf } from 'vitest'
import { inMemoryBlobStore, inMemoryRecordStore, inMemoryVectorStore } from '@use-crux/core/storage'
import {
  describeBlobStoreConformance,
  describeRecordStoreConformance,
  describeVectorStoreConformance,
} from '@use-crux/core/storage/testing/vitest'
import type {
  DescribeBlobStoreConformanceOptions,
  DescribeRecordStoreConformanceOptions,
  DescribeVectorStoreConformanceOptions,
} from '@use-crux/core/storage/testing/vitest'
import type { BlobStore, JsonObject, RecordStore, VectorStore } from '@use-crux/core/storage'

interface ConformanceRecord extends JsonObject {
  readonly title: string
}

expectTypeOf(describeRecordStoreConformance<ConformanceRecord>)
  .parameter(0)
  .toEqualTypeOf<DescribeRecordStoreConformanceOptions<ConformanceRecord>>()
expectTypeOf(describeVectorStoreConformance).parameter(0).toEqualTypeOf<DescribeVectorStoreConformanceOptions>()
expectTypeOf(describeBlobStoreConformance).parameter(0).toEqualTypeOf<DescribeBlobStoreConformanceOptions>()

const recordOptions: DescribeRecordStoreConformanceOptions<ConformanceRecord> = {
  name: 'type-test-records',
  prepare: () => inMemoryRecordStore<ConformanceRecord>(),
}

const vectorOptions: DescribeVectorStoreConformanceOptions = {
  name: 'type-test-vectors',
  prepare: () => inMemoryVectorStore(),
}

const blobOptions: DescribeBlobStoreConformanceOptions = {
  name: 'type-test-blobs',
  prepare: () => inMemoryBlobStore(),
}

expectTypeOf(recordOptions.prepare()).toEqualTypeOf<RecordStore<ConformanceRecord> | Promise<RecordStore<ConformanceRecord>>>()
expectTypeOf(vectorOptions.prepare()).toEqualTypeOf<VectorStore | Promise<VectorStore>>()
expectTypeOf(blobOptions.prepare()).toEqualTypeOf<BlobStore | Promise<BlobStore>>()

const invalidOptions: DescribeRecordStoreConformanceOptions = {
  name: 'invalid-store',
  // @ts-expect-error Record conformance requires a RecordStore factory.
  prepare: () => inMemoryVectorStore(),
}

void recordOptions
void vectorOptions
void blobOptions
void invalidOptions
