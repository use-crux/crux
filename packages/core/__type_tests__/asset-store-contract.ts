/**
 * Type-level contract for usable assets and optional AssetStore persistence.
 *
 * Runs under `tsc --noEmit`; `expectTypeOf` assertions and
 * `@ts-expect-error` markers carry the public API contract.
 */

import { expectTypeOf } from "vitest";
import { storage } from "../src/storage";
import type {
  Asset,
  AssetInfo,
  AssetPutOptions,
  AssetRef,
  AssetStore,
  DataAsset,
  ProviderFileAsset,
  RecordStore,
  StoredAsset,
  Storage,
  UrlAsset,
} from "../src/storage";

declare const asset: Asset;

if (asset.type === "data") {
  expectTypeOf(asset).toEqualTypeOf<DataAsset>();
  expectTypeOf(asset.data).toEqualTypeOf<Uint8Array | Blob>();
  expectTypeOf(asset.mediaType).toEqualTypeOf<string>();
  // @ts-expect-error data assets do not carry URL locators.
  asset.url;
}

if (asset.type === "url") {
  expectTypeOf(asset).toEqualTypeOf<UrlAsset>();
  expectTypeOf(asset.url).toEqualTypeOf<URL>();
  expectTypeOf(asset.mediaType).toEqualTypeOf<string | undefined>();
  // @ts-expect-error URL assets do not carry provider file ids.
  asset.fileId;
}

if (asset.type === "provider-file") {
  expectTypeOf(asset).toEqualTypeOf<ProviderFileAsset>();
  expectTypeOf(asset.provider).toEqualTypeOf<string>();
  expectTypeOf(asset.fileId).toEqualTypeOf<string>();
  // @ts-expect-error provider files do not carry inline bytes.
  asset.data;
}

const info: AssetInfo = {
  filename: "photo.png",
  size: 10,
  sha256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  width: 32,
  height: 32,
  durationInSeconds: 1.5,
  pageCount: 1,
};
void info;

const dataAsset: DataAsset = {
  type: "data",
  data: new Uint8Array([1, 2, 3]),
  mediaType: "image/png",
};

const urlAsset: UrlAsset = {
  type: "url",
  url: new URL("https://example.com/image.png"),
  mediaType: "image/png",
};

const providerFile: ProviderFileAsset = {
  type: "provider-file",
  provider: "openai",
  fileId: "file_123",
};

const stored: StoredAsset = {
  ...dataAsset,
  ref: { uri: "opaque-store-ref" },
};
expectTypeOf(stored).toMatchTypeOf<Asset>();
expectTypeOf(stored.ref).toEqualTypeOf<AssetRef>();

const putOptions: AssetPutOptions = {
  key: "uploads/photo.png",
  metadata: { source: "upload", retry: 1, active: true, parent: null },
};
void putOptions;

declare const store: AssetStore;
declare const records: RecordStore;
expectTypeOf(store.put(dataAsset)).resolves.toEqualTypeOf<StoredAsset>();
expectTypeOf(
  store.put(urlAsset, putOptions),
).resolves.toEqualTypeOf<StoredAsset>();
expectTypeOf(store.put(providerFile)).resolves.toEqualTypeOf<StoredAsset>();
expectTypeOf(
  store.get({ uri: "opaque-store-ref" }),
).resolves.toEqualTypeOf<StoredAsset>();
expectTypeOf(
  store.delete({ uri: "opaque-store-ref" }),
).resolves.toEqualTypeOf<void>();

// @ts-expect-error AssetRef is persistence plumbing, not a model-usable Asset.
const refAsAsset: Asset = { uri: "opaque-store-ref" };
void refAsAsset;

const kindedAsset: Asset = {
  type: "data",
  data: new Uint8Array(),
  mediaType: "image/png",
  // @ts-expect-error Asset uses `type` as the only public variant discriminator.
  kind: "image",
};
void kindedAsset;

// @ts-expect-error metadata remains an exact scalar filter.
const nestedMetadata: AssetPutOptions = { metadata: { nested: { ok: true } } };
void nestedMetadata;

// @ts-expect-error AssetStore ports are readonly.
store.put = async (value) => ({
  ...value,
  ref: { uri: "another-opaque-store-ref" },
});

const bundle = storage({ records, assets: store });
expectTypeOf(bundle).toEqualTypeOf<Storage>();
expectTypeOf(bundle.assets).toEqualTypeOf<AssetStore | undefined>();
