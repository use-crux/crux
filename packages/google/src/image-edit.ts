import {
  MaskReferenceImage,
  MaskReferenceMode,
  RawReferenceImage,
  type Image,
  type ReferenceImage,
} from "@google/genai";
import type { Asset } from "@use-crux/core";

/** Build SDK-owned Imagen edit references without changing portable prompt text. */
export async function googleImagenEditReferences(
  images: readonly Asset[],
  mask?: Asset,
): Promise<ReferenceImage[]> {
  const references = await Promise.all(
    images.map(async (asset, index) =>
      Object.assign(new RawReferenceImage(), {
        referenceId: index + 1,
        referenceImage: await googleImagenEditImage(asset),
      }),
    ),
  );
  if (mask === undefined) return references;

  references.push(
    Object.assign(new MaskReferenceImage(), {
      referenceId: images.length + 1,
      referenceImage: await googleImagenEditImage(mask),
      config: { maskMode: MaskReferenceMode.MASK_MODE_USER_PROVIDED },
    }),
  );
  return references;
}

async function googleImagenEditImage(asset: Asset): Promise<Image> {
  if (asset.type !== "data")
    throw new TypeError("Google Imagen edits require data assets.");
  const bytes =
    asset.data instanceof Blob
      ? new Uint8Array(await asset.data.arrayBuffer())
      : asset.data;
  return {
    imageBytes: Buffer.from(bytes).toString("base64"),
    mimeType: asset.mediaType,
  };
}
