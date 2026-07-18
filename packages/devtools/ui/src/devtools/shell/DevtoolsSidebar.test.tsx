import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SidebarItem } from "./DevtoolsSidebar";

describe("DevtoolsSidebar responsive item", () => {
  it("keeps mobile navigation accessible while collapsing labels into an icon rail", () => {
    const markup = renderToStaticMarkup(
      <SidebarItem
        iconName="layers"
        label="Evals"
        active
        onClick={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Evals"');
    expect(markup).toContain("justify-center");
    expect(markup).toContain("sm:justify-start");
    expect(markup).toContain("hidden truncate sm:block");
  });
});
