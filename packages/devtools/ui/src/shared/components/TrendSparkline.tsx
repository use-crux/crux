import { cn } from "@/shared/lib/utils";

interface TrendSparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
}

const COLOR_MAP: Record<string, { stroke: string; fill: string }> = {
  emerald: { stroke: "stroke-(--qw-ok)", fill: "fill-(--qw-ok-soft)" },
  red: { stroke: "stroke-(--qw-danger)", fill: "fill-(--qw-danger-soft)" },
  amber: { stroke: "stroke-(--qw-warn)", fill: "fill-(--qw-warn-soft)" },
  blue: { stroke: "stroke-(--qw-blue)", fill: "fill-(--qw-blue-soft)" },
  zinc: { stroke: "stroke-zinc-400", fill: "fill-zinc-400/10" },
};

export function TrendSparkline({
  data,
  width = 80,
  height = 32,
  color = "emerald",
  className,
}: TrendSparklineProps) {
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const padding = height * 0.1;

  const innerHeight = height - padding * 2;

  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = padding + innerHeight - ((v - min) / range) * innerHeight;
    return `${x},${y}`;
  });

  const polylinePoints = points.join(" ");
  const polygonPoints = `0,${height} ${polylinePoints} ${width},${height}`;

  const colors = COLOR_MAP[color] ?? COLOR_MAP.emerald;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn("shrink-0", className)}
    >
      <polygon points={polygonPoints} className={colors.fill} strokeWidth="0" />
      <polyline
        points={polylinePoints}
        fill="none"
        className={colors.stroke}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
