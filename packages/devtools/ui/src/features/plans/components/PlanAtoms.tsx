import { Icon } from "@/devtools/shell/Icon";

export function KindBadge({
  name,
  color,
  size = 22,
}: {
  name: Parameters<typeof Icon>[0]["name"];
  color?: string;
  size?: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-[6px]"
      style={{
        width: size,
        height: size,
        background: "var(--devtools-bg-muted)",
        boxShadow: "inset 0 0 0 1px var(--devtools-border)",
      }}
    >
      <Icon
        name={name}
        size={Math.round(size * 0.55)}
        color={color ?? "var(--devtools-fg-muted)"}
      />
    </div>
  );
}

export function Checkbox({ done }: { done: boolean }) {
  return (
    <span
      className="flex size-[14px] items-center justify-center rounded-[3px]"
      style={{
        background: done ? "var(--devtools-ok)" : "var(--devtools-bg)",
        boxShadow: `inset 0 0 0 1px ${done ? "var(--devtools-ok)" : "var(--devtools-border-strong)"}`,
      }}
    >
      {done && <Icon name="check" size={9} color="var(--devtools-bg)" />}
    </span>
  );
}

export function ProgressBar({
  percent,
  color,
}: {
  percent: number;
  color: string;
}) {
  return (
    <div
      className="h-[5px] flex-1 overflow-hidden rounded-full"
      style={{ background: "var(--devtools-bg-muted)" }}
    >
      <div
        className="h-full rounded-full transition-all"
        style={{
          width: `${Math.max(0, Math.min(100, percent))}%`,
          background: color,
        }}
      />
    </div>
  );
}

export function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-[10px] px-6 py-10 text-center text-[13px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px dashed var(--devtools-border)",
        color: "var(--devtools-fg-muted)",
      }}
    >
      {children}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      className="mb-4 rounded-[8px] px-4 py-3 text-[12px]"
      style={{ background: "var(--devtools-danger-soft)", color: "var(--devtools-danger)" }}
    >
      {message}
    </div>
  );
}

export function PendingBackend({
  title,
  body,
}: {
  title: string;
  body: string;
}) {
  return (
    <div
      className="rounded-[10px] px-5 py-4 text-[12.5px]"
      style={{
        background: "var(--devtools-bg-elev)",
        border: "1px dashed var(--devtools-border)",
        color: "var(--devtools-fg-muted)",
      }}
    >
      <div
        className="mb-1 text-[10px] font-medium uppercase tracking-[0.12em]"
        style={{ color: "var(--devtools-fg-faint)" }}
      >
        Pending backend projection
      </div>
      <div className="font-medium" style={{ color: "var(--devtools-fg)" }}>
        {title}
      </div>
      <div className="mt-0.5">{body}</div>
    </div>
  );
}
