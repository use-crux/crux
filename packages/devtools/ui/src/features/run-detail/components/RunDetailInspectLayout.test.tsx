import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDetailInspectLayout } from "./RunDetailInspectLayout";

const panes = {
  structure: <div>Structure content</div>,
  detail: <div>Detail content</div>,
  inspector: <aside>Inspector content</aside>,
};

describe("RunDetailInspectLayout", () => {
  it("stacks usable structure and detail panes without the desktop rail on mobile", () => {
    const html = renderToStaticMarkup(
      <RunDetailInspectLayout {...panes} mobile timeline={false} />,
    );

    expect(html).toContain('data-run-detail-layout="stacked"');
    expect(html).toContain("Structure content");
    expect(html).toContain("Detail content");
    expect(html).not.toContain("Inspector content");
    expect(html).not.toContain('data-slot="resizable-panel-group"');
  });

  it("retains the resizable panes and inspector on desktop", () => {
    const html = renderToStaticMarkup(
      <RunDetailInspectLayout {...panes} mobile={false} timeline={false} />,
    );

    expect(html).toContain('data-run-detail-layout="resizable"');
    expect(html).toContain('data-slot="resizable-panel-group"');
    expect(html).toContain("Inspector content");
  });
});
