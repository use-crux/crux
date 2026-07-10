import type { ReactNode } from "react";
import { Eyebrow } from "@/qw/shell/primitives";

export function RoutingReceiptSection({
  title,
  right,
  children,
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2.5">
        <Eyebrow>{title}</Eyebrow>
        <div
          className="h-px flex-1"
          style={{ background: "var(--qw-border)" }}
        />
        {right}
      </div>
      {children}
    </div>
  );
}

export function RoutingStepShell({
  title,
  index,
  right,
  children,
}: {
  title: string;
  index: number;
  right?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-[8px]"
      style={{
        background: "var(--qw-bg-elev)",
        border: "1px solid var(--qw-border)",
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: "1px solid var(--qw-border)" }}
      >
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--qw-fg-faint)", width: 18 }}
        >
          {index + 1}
        </span>
        <span
          className="flex-1 text-[12px] font-semibold"
          style={{ color: "var(--qw-fg)" }}
        >
          {title}
        </span>
        {right}
      </div>
      <div className="px-3 py-2.5">{children}</div>
    </div>
  );
}
