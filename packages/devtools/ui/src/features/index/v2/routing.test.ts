import { describe, expect, it } from "vitest";
import { glyphFor } from "../components/IndexKind";
import { kindMeta } from "./kit";

describe("routing index metadata", () => {
  it("labels stable split and retry kinds in legacy and v2 index views", () => {
    expect(glyphFor("routing.split")).toMatchObject({ label: "split" });
    expect(glyphFor("routing.retry.target")).toMatchObject({
      label: "retry target",
    });
    expect(kindMeta("routing.split")).toMatchObject({
      label: "Split",
      family: "routing",
      child: false,
    });
    expect(kindMeta("routing.retry.target")).toMatchObject({
      label: "Retry target",
      family: "routing",
      child: true,
    });
  });
});
