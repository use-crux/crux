import type { ExactFilter } from "../storage/types";

/**
 * Optional facts known about an asset without fetching or provider I/O.
 *
 * These fields describe usable media at storage and adapter boundaries. Unknown
 * facts stay omitted; validators reject malformed values instead of guessing.
 */
export type AssetInfo = {
  readonly filename?: string;
  /** Bytes, when already known without fetching. */
  readonly size?: number;
  readonly sha256?: string;
  readonly width?: number;
  readonly height?: number;
  readonly durationInSeconds?: number;
  readonly pageCount?: number;
};

/**
 * Inline media bytes that can be sent to a provider immediately.
 *
 * Stores and adapters copy mutable byte views at ownership boundaries so later
 * caller mutation cannot change the persisted or requested asset.
 */
export type DataAsset = AssetInfo & {
  readonly type: "data";
  readonly data: Uint8Array | Blob;
  readonly mediaType: string;
};

/**
 * HTTPS or data URL media that remains usable without a storage read.
 *
 * Validation does not download the URL. Providers may still reject unsupported
 * media types or private delivery URLs at their own operation boundary.
 */
export type UrlAsset = AssetInfo & {
  readonly type: "url";
  readonly url: URL;
  readonly mediaType?: string;
};

/**
 * Media already owned by a provider-side file system.
 *
 * The provider and file id are adapter-scoped locators. Stores may record them,
 * but must not dereference or upload provider files as part of `put()`.
 */
export type ProviderFileAsset = AssetInfo & {
  readonly type: "provider-file";
  readonly provider: string;
  readonly fileId: string;
  readonly mediaType?: string;
};

/**
 * Usable media for model input, generated output, or explicit persistence.
 *
 * Narrow on `type` to access data, URL, or provider-file fields. `AssetRef` is
 * intentionally not part of this union; persistence owners must hydrate refs
 * with their owning `AssetStore` before model calls.
 */
export type Asset = DataAsset | UrlAsset | ProviderFileAsset;

/**
 * Opaque reference returned by the store that created it.
 *
 * A ref is a bearer reference owned by the underlying `AssetStore`; possession
 * of the ref is enough for any store view backed by that owner to attempt
 * `get()` or `delete()`. `storage.scope()` does not authenticate refs or create
 * a new owning store. Applications and backend stores enforce authorization.
 *
 * Refs are never accepted as model input. Use `store.get(ref)` to rehydrate a
 * usable `StoredAsset`.
 */
export type AssetRef = {
  readonly uri: string;
};

/**
 * An asset that remains usable and also carries its durable store reference.
 */
export type StoredAsset = Asset & {
  readonly ref: AssetRef;
};

/**
 * Options for `AssetStore.put()`.
 *
 * `key` is a stable backend key that scoped storage views may namespace before
 * forwarding to the underlying store. That key namespacing is not
 * authorization. `metadata` is storage-only index/filter data and is never
 * merged into model-visible `AssetInfo`.
 */
export type AssetPutOptions = Readonly<{
  /** Stable backend key used by scoped/workspace storage. */
  key?: string;
  /** Storage index/filter metadata; never model-visible Asset facts. */
  metadata?: ExactFilter;
}>;

/**
 * Optional persistence port for media assets.
 *
 * `put()` may perform storage I/O but never provider/model calls or hidden URL
 * downloads. `get()` returns a usable stored asset or throws `StorageError`
 * when the underlying store cannot hydrate the bearer ref. Scoped storage views
 * do not wrap, sign, or verify refs; authorization belongs in the application
 * or backend store. The returned records are safe projections, not caller
 * objects spread back out of convenience subtypes.
 *
 * @example
 * ```ts
 * const stored = await assetStore.put({
 *   type: 'data',
 *   data: imageBytes,
 *   mediaType: 'image/png',
 * })
 *
 * const image = await assetStore.get(stored.ref)
 * ```
 */
export type AssetStore = Readonly<{
  put: (asset: Asset, options?: AssetPutOptions) => Promise<StoredAsset>;
  get: (ref: AssetRef) => Promise<StoredAsset>;
  delete: (ref: AssetRef) => Promise<void>;
}>;
