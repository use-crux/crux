/**
 * React 19 form primitives.
 *
 * Wraps `useFormStatus` so any form-action submit gets a consistent
 * pending UI without each form re-implementing button-disable +
 * spinner. Drop into the next real mutation form (Eval Case create,
 * Review action, lint suppression note) like:
 *
 *   <form action={submitAction}>
 *     <input name="title" />
 *     <FormSubmitButton variant="primary">Save case</FormSubmitButton>
 *     <FormPendingHint pendingMessage="Saving…" />
 *   </form>
 *
 * Uses `useActionState` at the caller for the actual async work; this
 * file only owns the inline pending UI.
 */

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Btn, type BtnProps } from "./primitives";

interface FormSubmitButtonProps extends Omit<
  BtnProps,
  "onClick" | "type" | "disabled"
> {
  /** If true, the button stays clickable while pending (rare; the
   *  default is to disable to prevent double-submit). */
  enabledWhilePending?: boolean;
  /** Optional explicit busy state — useful when the calling form mixes
   *  controlled async work with a `useActionState` result. */
  busy?: boolean;
}

/** Submit button that knows about its own form's pending state. */
export function FormSubmitButton({
  enabledWhilePending,
  busy,
  children,
  ...rest
}: FormSubmitButtonProps) {
  const { pending } = useFormStatus();
  const isPending = pending || busy;
  return (
    <Btn
      {...rest}
      type="submit"
      disabled={isPending && !enabledWhilePending}
      aria-busy={isPending || undefined}
    >
      {children}
    </Btn>
  );
}

/** Inline "Saving…" hint next to a submit button. Renders nothing when
 *  the form is idle. */
export function FormPendingHint({
  pendingMessage = "Saving…",
  className,
}: {
  pendingMessage?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <span
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--devtools-fg-muted)",
        fontSize: 12,
      }}
      aria-live="polite"
    >
      <span
        aria-hidden
        className="animate-running-pulse inline-block rounded-full"
        style={{ width: 6, height: 6, background: "var(--devtools-crux)" }}
      />
      {pendingMessage}
    </span>
  );
}

/** Disable an entire fieldset while the surrounding form is pending —
 *  cleaner than putting `disabled` on every input. */
export function FormPendingFieldset({
  children,
  className,
  legend,
}: {
  children: React.ReactNode;
  className?: string;
  legend?: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <fieldset
      disabled={pending}
      className={className}
      style={{ border: 0, padding: 0, margin: 0 }}
    >
      {legend && <legend className="sr-only">{legend}</legend>}
      {children}
    </fieldset>
  );
}
