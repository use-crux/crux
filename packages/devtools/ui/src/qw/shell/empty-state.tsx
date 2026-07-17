import type * as React from "react";
import { Icon } from "./Icon";
import type { IconName } from "./nav";

type EmptyStateTone =
  | "crux"
  | "danger"
  | "warn"
  | "ok"
  | "iris"
  | "blue"
  | "muted";

/** A centered, explicit empty/error state that never leaves a workbench blank. */
export function QEmpty({
  icon = "flask",
  title,
  body,
  action,
  tone,
}: {
  icon?: IconName;
  title: React.ReactNode;
  body?: React.ReactNode;
  action?: React.ReactNode;
  tone?: EmptyStateTone;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-[12px]"
        style={{
          background: tone ? `var(--qw-${tone}-soft)` : "var(--qw-bg-muted)",
          boxShadow: "inset 0 0 0 1px var(--qw-border)",
        }}
      >
        <Icon
          name={icon}
          size={22}
          color={tone ? `var(--qw-${tone})` : "var(--qw-fg-muted)"}
        />
      </div>
      <div className="text-[16px] font-semibold">{title}</div>
      {body && (
        <div
          className="max-w-[360px] text-[12.5px] leading-[1.55]"
          style={{ color: "var(--qw-fg-muted)" }}
        >
          {body}
        </div>
      )}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
