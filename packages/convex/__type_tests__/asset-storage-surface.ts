import { expectTypeOf } from "vitest";
import * as ConvexExports from "../src";
import * as ConvexWorkspaceExports from "../src/workspace";
import { convexAssetStore, convexStorage } from "../src";
import type { AssetStore, Storage } from "@use-crux/core/storage";
import type { ConvexAssetStoreConfig, ConvexStorageConfig } from "../src";
import { createInMemoryConvexStoreDocumentComponent } from "../src/store-document-component";

const component = createInMemoryConvexStoreDocumentComponent();
const storageLike = {
  store: async (_blob: Blob) => "file-1",
};

const assets = convexAssetStore({ ctx: { storage: storageLike } });
expectTypeOf(assets).toEqualTypeOf<AssetStore>();

const config: ConvexStorageConfig = {
  component,
  ctx: component.ctx,
  assets: { ctx: { storage: storageLike } },
};
const bundle = convexStorage(config);
expectTypeOf(bundle).toEqualTypeOf<Storage>();
expectTypeOf(bundle.assets).toEqualTypeOf<AssetStore | undefined>();

const assetConfig: ConvexAssetStoreConfig = { ctx: { storage: storageLike } };
void assetConfig;

type ConvexValueExports = typeof ConvexExports;
type ConvexWorkspaceValueExports = typeof ConvexWorkspaceExports;

// @ts-expect-error — convexWorkspaceBlobStore was removed; use convexAssetStore.
type RemovedConvexWorkspaceBlobStoreValue = ConvexValueExports["convexWorkspaceBlobStore"];
// @ts-expect-error — ConvexWorkspaceBlobStoreConfig was removed; use ConvexAssetStoreConfig.
type RemovedConvexWorkspaceBlobStoreConfig = ConvexExports.ConvexWorkspaceBlobStoreConfig;
convexStorage({
  component,
  ctx: component.ctx,
  // @ts-expect-error — convexStorage({ blobs }) was removed; use convexStorage({ assets }).
  blobs: { ctx: { storage: storageLike } },
});
// @ts-expect-error — ConvexStorageConfig.blobs was removed; use assets.
type RemovedConvexStorageBlobs = ConvexStorageConfig["blobs"];
// @ts-expect-error — convexWorkspaceBlobStore was removed from the workspace subpath.
type RemovedConvexWorkspaceSubpathBlobStoreValue = ConvexWorkspaceValueExports["convexWorkspaceBlobStore"];
// @ts-expect-error — ConvexWorkspaceBlobStoreConfig was removed from the workspace subpath.
type RemovedConvexWorkspaceSubpathBlobStoreConfig = ConvexWorkspaceExports.ConvexWorkspaceBlobStoreConfig;
