import { describe, expect, it } from "vitest";
import { resolveMediaCatalogJoin } from "./media-run-catalog-join";

const SECRET_ID = "media.operation:SECRET_CUSTOMER_ID";
const GENERIC_LABEL = "Catalog media operation";

describe("resolveMediaCatalogJoin label privacy", () => {
  it("never derives a rendered label from definitionId suffix or secret tokens", () => {
    const join = resolveMediaCatalogJoin(undefined, {
      definitionRefs: [invokedRef(SECRET_ID)],
    });

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
      resolveMediaCatalogJoin(
        {
          definitionName: "Cover art",
        },
        {
          definitionRefs: [invokedRef(SECRET_ID)],
        },
      ),
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
        resolveMediaCatalogJoin(
          { definitionName },
          { definitionRefs: [invokedRef(SECRET_ID)] },
        ),
      ).toMatchObject({ label: GENERIC_LABEL });
    }
  });
});

function invokedRef(id: string) {
  return {
    id,
    kind: "media.operation",
    role: "invoked-media-operation",
  } as const;
}
