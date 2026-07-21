import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  projectRetrievalMediaAttribution,
  retrievalHitPreview,
} from "../lib/retrieval-media-attribution";
import { RetrievalMediaAttribution } from "./RetrievalMediaAttribution";

describe("RetrievalMediaAttribution", () => {
  it("renders only byte-safe asset, media type, and page attribution", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const hit = {
      source: {
        id: "asset-source",
        assetRef: { uri: "asset://sha256/abc123" },
        mediaType: "image/png",
        location: { type: "page", pageNumber: 4 },
        signedUrl: "https://example.test/file?signature=SECRET_SIGNATURE",
        providerFileId: "SECRET_FILE_ID",
        filename: "private-image.png",
        bytes: "SECRET_BYTES",
      },
      content: "data:image/png;base64,SECRET_DATA",
    };
    const attribution = projectRetrievalMediaAttribution(hit);
    const html = renderToStaticMarkup(
      <RetrievalMediaAttribution attribution={attribution} />,
    );

    expect(html).toContain("asset://sha256/abc123");
    expect(html).toContain("image/png");
    expect(html).toContain("page 4");
    expect(html).not.toMatch(/SECRET_|data:image|private-image/u);
    expect(html).not.toMatch(/<(?:audio|img|video)\b/u);
    expect(retrievalHitPreview(hit, attribution)).toBe("");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("formats media time ranges without exposing arbitrary hit fields", () => {
    const attribution = projectRetrievalMediaAttribution({
      source: {
        assetRef: { uri: "asset://sha256/video" },
        mediaType: "video/mp4",
        location: { type: "time", unit: "seconds", start: 1.5, end: 3 },
      },
    });
    const html = renderToStaticMarkup(
      <RetrievalMediaAttribution attribution={attribution} />,
    );

    expect(html).toContain("1.5–3s");
  });

  it("preserves text previews for older non-media hits", () => {
    const hit = { content: "Legacy text result" };
    const attribution = projectRetrievalMediaAttribution(hit);

    expect(attribution).toBeUndefined();
    expect(retrievalHitPreview(hit, attribution)).toBe("Legacy text result");
  });
});
