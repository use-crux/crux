import { cn } from "@/shared/lib/utils";

interface AnomalyBadgeProps {
  deviation: number;
  type?: "cost" | "latency" | "tokens" | "error";
  className?: string;
}

const TYPE_ICONS: Record<string, string> = {
  cost: "$",
  latency: "\u23F1",
  tokens: "\u25B2",
  error: "\u26A0",
};

function getColor(deviation: number, type?: string): string {
  if (type === "tokens") return "text-(--devtools-warn) bg-(--devtools-warn-soft)";
  if (deviation > 0) return "text-(--devtools-danger) bg-(--devtools-danger-soft)";
  return "text-(--devtools-ok) bg-(--devtools-ok-soft)";
}

export function AnomalyBadge({
  deviation,
  type,
  className,
}: AnomalyBadgeProps) {
  if (Math.abs(deviation) <= 0.2) return null;

  const pct = Math.round(deviation * 100);
  const sign = pct > 0 ? "+" : "";
  const color = getColor(deviation, type);
  const icon = type ? TYPE_ICONS[type] : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
        color,
        className,
      )}
    >
      {icon && <span>{icon}</span>}
      {sign}
      {pct}%
    </span>
  );
}
