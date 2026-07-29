import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PromptPreviewForm } from "./PromptPreviewForm";

describe("Prompt preview nullable form controls", () => {
  it("preserves an explicit null state for nullable scalars", () => {
    const html = renderToStaticMarkup(
      <PromptPreviewForm
        schema={{
          type: "object",
          properties: {
            title: { type: ["string", "null"] },
            active: { type: ["boolean", "null"] },
          },
          additionalProperties: false,
        }}
        value={{ title: null, active: null }}
        disabled={false}
        onChange={vi.fn()}
      />,
    );
    expect(html).toContain("Use null");
    expect(html.match(/checked=""/gu)).toHaveLength(2);
  });
});
