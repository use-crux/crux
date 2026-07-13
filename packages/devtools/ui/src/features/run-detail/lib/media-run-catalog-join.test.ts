import { describe, expect, it } from "vitest";
import { resolveMediaCatalogJoin } from "./media-run-catalog-join";

const SECRET_ID = "media.operation:SECRET_CUSTOMER_ID";
const GENERIC_LABEL = "Catalog media operation";

describe("resolveMediaCatalogJoin label privacy", () => {
  it("never derives a rendered label from definitionId suffix or secret tokens", () => {
    const join = resolveMediaCatalogJoin({ definitionId: SECRET_ID });

    expect(join).toEqual({
      status: "joined",
      definitionId: SECRET_ID,
      label: GENERIC_LABEL,
    });
    if (join.status !== "joined") throw new Error("expected joined");
    expect(join.label).not.toContain("SECRET");
    expect(join.label).not.toContain("media.operation");
  });

  it("uses a safe display name when recorded separately", () => {
    expect(
      resolveMediaCatalogJoin({
        definitionId: SECRET_ID,
        definitionName: "Cover art",
      }),
    ).toEqual({
      status: "joined",
      definitionId: SECRET_ID,
      label: "Cover art",
    });
  });

  it("rejects display names that repeat the id or look like locators", () => {
    for (const definitionName of [
      SECRET_ID,
      "https://files.example/SECRET.pdf?token=1",
      "asset://SECRET_REF",
      "data:image/png;base64,SECRET",
    ]) {
      expect(
        resolveMediaCatalogJoin({ definitionId: SECRET_ID, definitionName }),
      ).toMatchObject({ label: GENERIC_LABEL });
    }
  });
});
