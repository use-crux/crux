/**
 * Quality Workbench confirmation dialog wrapper.
 *
 * Wraps shadcn's AlertDialog with the QW palette + a compact <QwConfirm/>
 * API so screens don't have to plumb their own Trigger/Content/Action/
 * Cancel structure for every destructive action.
 *
 * Usage:
 *   <QwConfirm
 *     title="Silence this pattern?"
 *     description="Future insights matching 'Run is slow' on docs_agent will be hidden until you unsilence it."
 *     confirmLabel="Silence"
 *     tone="warn"
 *     onConfirm={() => silence(insightId)}
 *   >
 *     <Btn size="xs">Silence pattern</Btn>
 *   </QwConfirm>
 *
 * Tone controls the confirm-button accent: `danger` for irreversible
 * destructive actions, `warn` for hide / silence flows, `crux` for
 * affirmative non-destructive confirmations (rarely needed — usually
 * skip the dialog entirely for those).
 */

import { type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/shared/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/components/ui/tooltip";

export type QwConfirmTone = "danger" | "warn" | "crux";

interface QwConfirmProps {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: QwConfirmTone;
  onConfirm: () => void;
  /**
   * Optional hover hint shown before the dialog opens. We render it here
   * (rather than letting callers wrap with <QwTooltip>) so the two Radix
   * `asChild` Slots stack directly on the trigger — nesting via a
   * function-component wrapper breaks Slot prop forwarding.
   */
  tooltip?: ReactNode;
  /** The button (or other element) the user clicks to open the dialog. */
  children: ReactNode;
}

const TONE: Record<QwConfirmTone, { bg: string; fg: string; ring: string }> = {
  danger: {
    bg: "var(--qw-danger)",
    fg: "var(--qw-bg)",
    ring: "var(--qw-danger)",
  },
  warn: { bg: "var(--qw-warn)", fg: "var(--qw-bg)", ring: "var(--qw-warn)" },
  crux: { bg: "var(--qw-crux)", fg: "var(--qw-bg)", ring: "var(--qw-crux)" },
};

export function QwConfirm({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "warn",
  onConfirm,
  tooltip,
  children,
}: QwConfirmProps) {
  const palette = TONE[tone];
  // Stack the two Slot triggers directly when a tooltip is requested so
  // both Radix contexts merge their event handlers onto the underlying
  // button. Order matters: TooltipTrigger outermost, AlertDialogTrigge
  // innermost — the dialog needs the click; the tooltip needs the hover.
  const trigger = tooltip ? (
    <Tooltip delayDuration={320}>
      <TooltipTrigger asChild>
        <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={6}
        style={{
          background: "var(--qw-bg-elev)",
          color: "var(--qw-fg)",
          border: "1px solid var(--qw-border)",
          fontFamily: "var(--qw-mono)",
          fontSize: 11.5,
          lineHeight: 1.5,
          maxWidth: 320,
          padding: "6px 10px",
          borderRadius: 6,
          boxShadow: "0 4px 12px rgb(0 0 0 / 0.2)",
        }}
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  ) : (
    <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
  );
  return (
    <AlertDialog>
      {trigger}
      <AlertDialogContent
        className="qw-confirm"
        style={{
          background: "var(--qw-bg-elev)",
          color: "var(--qw-fg)",
          border: "1px solid var(--qw-border)",
          fontFamily: "var(--qw-sans)",
          borderRadius: 10,
          maxWidth: 460,
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-0.01em",
              color: "var(--qw-fg)",
            }}
          >
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription
              style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--qw-fg-muted)",
                marginTop: 6,
              }}
            >
              {description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter style={{ marginTop: 16 }}>
          <AlertDialogCancel
            style={{
              background: "transparent",
              color: "var(--qw-fg-muted)",
              border: "1px solid var(--qw-border)",
              fontFamily: "var(--qw-mono)",
              fontSize: 12,
              padding: "6px 12px",
              borderRadius: 6,
            }}
          >
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            style={{
              background: palette.bg,
              color: palette.fg,
              boxShadow: `inset 0 0 0 1px ${palette.ring}`,
              fontFamily: "var(--qw-mono)",
              fontSize: 12,
              fontWeight: 600,
              padding: "6px 14px",
              borderRadius: 6,
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
