import type { ReactNode } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/components/ui/resizable";

interface RunDetailInspectLayoutProps {
  /** Uses the narrow stacked layout instead of compressing desktop panes. */
  readonly mobile: boolean;
  /** Gives the Timeline structure pane more room on desktop. */
  readonly timeline: boolean;
  readonly structure: ReactNode;
  readonly detail: ReactNode;
  readonly inspector: ReactNode;
}

/**
 * Responsive shell for Run Detail's structure, detail, and inspector panes.
 *
 * @remarks Desktop keeps the resizable three-pane workspace. Narrow viewports
 * stack Structure above Detail so both remain usable and omit the desktop-only
 * Inspector rail; evidence and native cards remain available in Detail.
 */
export function RunDetailInspectLayout({
  mobile,
  timeline,
  structure,
  detail,
  inspector,
}: RunDetailInspectLayoutProps) {
  if (mobile) {
    return (
      <div
        data-run-detail-layout="stacked"
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        <div className="h-[32%] min-h-[140px] max-h-[240px] shrink-0 overflow-hidden border-b border-(--devtools-border)">
          {structure}
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">{detail}</div>
      </div>
    );
  }

  return (
    <div
      data-run-detail-layout="resizable"
      className="flex h-full min-h-0 overflow-hidden"
    >
      <div className="min-w-0 flex-1">
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full min-h-0 overflow-hidden"
        >
          <ResizablePanel
            defaultSize={timeline ? "46%" : "34%"}
            minSize="18%"
            maxSize="62%"
          >
            {structure}
          </ResizablePanel>
          <ResizableHandle withHandle className="bg-[var(--devtools-border)]" />
          <ResizablePanel defaultSize={timeline ? "54%" : "66%"}>
            {detail}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      {inspector}
    </div>
  );
}
