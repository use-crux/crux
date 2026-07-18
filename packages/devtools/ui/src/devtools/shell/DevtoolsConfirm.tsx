/**
 * Devtools confirmation dialog wrapper.
 *
 * Wraps shadcn's AlertDialog with the Devtools palette + a compact <DevtoolsConfirm/>
 * API so screens don't have to plumb their own Trigger/Content/Action/
 * Cancel structure for every destructive action.
 *
 * Usage:
 *   <DevtoolsConfirm
 *     title="Silence this pattern?"
 *     description="Future insights matching 'Run is slow' on docs_agent will be hidden until you unsilence it."
 *     confirmLabel="Silence"
 *     tone="warn"
 *     onConfirm={() => silence(insightId)}
 *   >
 *     <Btn size="xs">Silence pattern</Btn>
 *   </DevtoolsConfirm>
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

export type DevtoolsConfirmTone = "danger" | "warn" | "crux";

interface DevtoolsConfirmProps {
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: DevtoolsConfirmTone;
  onConfirm: () => void;
  /**
   * Optional hover hint shown before the dialog opens. We render it here
   * (rather than letting callers wrap with <DevtoolsTooltip>) so the two Radix
   * `asChild` Slots stack directly on the trigger — nesting via a
   * function-component wrapper breaks Slot prop forwarding.
   */
  tooltip?: ReactNode;
  /** The button (or other element) the user clicks to open the dialog. */
  children: ReactNode;
}

const TONE: Record<DevtoolsConfirmTone, { bg: string; fg: string; ring: string }> = {
  danger: {
    bg: "var(--devtools-danger)",
    fg: "var(--devtools-bg)",
    ring: "var(--devtools-danger)",
  },
  warn: { bg: "var(--devtools-warn)", fg: "var(--devtools-bg)", ring: "var(--devtools-warn)" },
  crux: { bg: "var(--devtools-crux)", fg: "var(--devtools-bg)", ring: "var(--devtools-crux)" },
};

export function DevtoolsConfirm({
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "warn",
  onConfirm,
  tooltip,
  children,
}: DevtoolsConfirmProps) {
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
          background: "var(--devtools-bg-elev)",
          color: "var(--devtools-fg)",
          border: "1px solid var(--devtools-border)",
          fontFamily: "var(--devtools-mono)",
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
        className="devtools-confirm"
        style={{
          background: "var(--devtools-bg-elev)",
          color: "var(--devtools-fg)",
          border: "1px solid var(--devtools-border)",
          fontFamily: "var(--devtools-sans)",
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
              color: "var(--devtools-fg)",
            }}
          >
            {title}
          </AlertDialogTitle>
          {description && (
            <AlertDialogDescription
              style={{
                fontSize: 12.5,
                lineHeight: 1.55,
                color: "var(--devtools-fg-muted)",
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
              color: "var(--devtools-fg-muted)",
              border: "1px solid var(--devtools-border)",
              fontFamily: "var(--devtools-mono)",
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
              fontFamily: "var(--devtools-mono)",
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
