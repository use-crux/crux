import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RuntimeTransportBindingsTable } from "./RuntimeTransportBindings";

describe("RuntimeTransportBindingsTable", () => {
  it("reports unavailable health when transport bindings are omitted", () => {
    const html = renderToStaticMarkup(
      <RuntimeTransportBindingsTable rows={undefined} />,
    );
    expect(html).toContain(
      "Transport health is unavailable for this Runtime status snapshot.",
    );
    expect(html).not.toContain(
      "No managed-transport bindings in the generated Runtime program.",
    );
  });

  it("reports empty program bindings when the snapshot is present but empty", () => {
    const html = renderToStaticMarkup(
      <RuntimeTransportBindingsTable rows={[]} />,
    );
    expect(html).toContain(
      "No managed-transport bindings in the generated Runtime program.",
    );
    expect(html).not.toContain(
      "Transport health is unavailable for this Runtime status snapshot.",
    );
  });
});
