/**
 * Public Convex Storage Beta factories.
 *
 * These helpers expose Convex-backed `RecordStore` capabilities without
 * leaking Convex function refs into `@use-crux/core`.
 *
 * @module
 */

import { storage as createStorage } from "@use-crux/core/storage";
import type { RecordStore, SearchStore, Storage } from "@use-crux/core/storage";
import type { ConvexCtxPort, ConvexMemoryStoreConfig } from "./store";
import { convexComponentDocumentPort } from "./store";
import { isConvexStoreDocumentComponent } from "./store-document-component";
import { createStoreDocRecordStore } from "./store-doc";
import { convexAssetStore, type ConvexAssetStoreConfig } from "./workspace";

/** Configuration for {@link convexStorage}. */
export interface ConvexStorageConfig<
  TCtx extends ConvexCtxPort = ConvexCtxPort,
> extends ConvexMemoryStoreConfig<TCtx> {
  /** Optional caller-provided search store. Convex does not provide one by default. */
  readonly search?: SearchStore;
  /** Optional Convex file-storage binding for asset payloads. */
  readonly assets?: ConvexAssetStoreConfig;
}

/** Create a Convex-backed beta `RecordStore`. */
export function convexRecordStore<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  config: ConvexMemoryStoreConfig<TCtx>,
): RecordStore {
  return createStoreDocRecordStore({
    now: config.now,
    io: documentPort(config),
  });
}

/** Create a Convex-backed beta `Storage` bundle. */
export function convexStorage<TCtx extends ConvexCtxPort = ConvexCtxPort>(
  config: ConvexStorageConfig<TCtx>,
): Storage {
  return createStorage({
    records: convexRecordStore(config),
    ...(config.search ? { search: config.search } : {}),
    ...(config.assets ? { assets: convexAssetStore(config.assets) } : {}),
  });
}

function documentPort<TCtx extends ConvexCtxPort>(
  config: ConvexMemoryStoreConfig<TCtx>,
) {
  return isConvexStoreDocumentComponent(config.component)
    ? config.component.io(config.ctx)
    : convexComponentDocumentPort(config);
}
