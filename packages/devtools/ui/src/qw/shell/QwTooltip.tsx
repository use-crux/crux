/**
 * Quality Workbench tooltip wrapper.
 *
 * Re-skins shadcn's tooltip with the `--qw-*` palette so action-button
 * hovers feel native to the rest of the shell instead of leaning on the
 * default zinc/foreground colors. Pass the wrapped element as `children`;
 * pass the hint as `content`. If you need the full primitive (custom
 * sides, controlled open state, etc.) import from `@/shared/components/ui/tooltip`
 * directly.
 *
 * Convention:
 *   <QwTooltip content="…">
 *     <Btn …>Resolve</Btn>
 *   </QwTooltip>
 *
 * Buttons must accept `ref` (shadcn buttons do; our `Btn` does — it's a
 * native <button>) so Radix's asChild slot can forward focus & hover.
 */

import { type ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/shared/components/ui/tooltip'

interface QwTooltipProps {
  content: ReactNode
  /** Side relative to the trigger. Defaults to `top` (matches Radix default). */
  side?: 'top' | 'right' | 'bottom' | 'left'
  /** Alignment along the trigger axis. Defaults to `center`. */
  align?: 'start' | 'center' | 'end'
  /** Hover delay before showing. Defaults to 320ms — fast enough to feel
   *  responsive, slow enough not to fire on accidental hovers. */
  delayMs?: number
  /** Disable the tooltip entirely (e.g. when the action is disabled). */
  disabled?: boolean
  children: ReactNode
}

export function QwTooltip({
  content,
  side = 'top',
  align = 'center',
  delayMs = 320,
  disabled = false,
  children,
}: QwTooltipProps) {
  if (disabled || !content) return <>{children}</>
  return (
    <Tooltip delayDuration={delayMs}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent
        side={side}
        align={align}
        sideOffset={6}
        className="qw-tooltip"
        style={{
          background: 'var(--qw-bg-elev)',
          color: 'var(--qw-fg)',
          border: '1px solid var(--qw-border)',
          fontFamily: 'var(--qw-mono)',
          fontSize: 11.5,
          lineHeight: 1.5,
          maxWidth: 320,
          padding: '6px 10px',
          borderRadius: 6,
          boxShadow: '0 4px 12px rgb(0 0 0 / 0.2)',
        }}
      >
        {content}
      </TooltipContent>
    </Tooltip>
  )
}
