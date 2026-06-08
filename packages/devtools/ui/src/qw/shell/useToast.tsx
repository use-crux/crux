/**
 * Minimal toast notification system for the Quality Workbench.
 *
 * Used to surface mutation success, the in-flight CLI-only affordances,
 * and any error from a fetch. Toasts auto-dismiss after 4s; up to 3 are
 * visible at once.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export type ToastKind = 'ok' | 'info' | 'warn' | 'danger'

interface Toast {
  id: number
  kind: ToastKind
  title: string
  message?: string
}

interface ToastApi {
  toast: (input: Omit<Toast, 'id'> | string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const seqRef = useRef(0)

  const toast = useCallback<ToastApi['toast']>((input) => {
    const id = ++seqRef.current
    const t: Toast = typeof input === 'string' ? { id, kind: 'info', title: input } : { id, ...input }
    setToasts((prev) => [...prev.slice(-2), t])
    setTimeout(() => {
      setToasts((prev) => prev.filter((x) => x.id !== id))
    }, 4500)
  }, [])

  const api = useMemo<ToastApi>(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const tone = {
    ok: { bg: 'var(--qw-ok-soft)', fg: 'var(--qw-ok)', icon: 'check' as const },
    info: { bg: 'var(--qw-crux-soft)', fg: 'var(--qw-crux)', icon: 'sparkle' as const },
    warn: { bg: 'var(--qw-warn-soft)', fg: 'var(--qw-warn)', icon: 'alert' as const },
    danger: { bg: 'var(--qw-danger-soft)', fg: 'var(--qw-danger)', icon: 'alert' as const },
  }[toast.kind]
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      className="pointer-events-auto flex min-w-[280px] max-w-[420px] items-start gap-3 rounded-[10px] px-4 py-3 transition-all"
      style={{
        background: 'var(--qw-bg-elev)',
        border: '1px solid var(--qw-border)',
        boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
        transform: entered ? 'translateY(0)' : 'translateY(8px)',
        opacity: entered ? 1 : 0,
      }}
    >
      <span
        className="mt-0.5 flex size-5 flex-shrink-0 items-center justify-center rounded-full"
        style={{ background: tone.bg }}
      >
        <Icon name={tone.icon} size={11} color={tone.fg} />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold" style={{ color: 'var(--qw-fg)' }}>
          {toast.title}
        </div>
        {toast.message && (
          <div className="mt-0.5 text-[12px]" style={{ color: 'var(--qw-fg-muted)' }}>
            {toast.message}
          </div>
        )}
      </div>
    </div>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    return {
      toast: (input) => {
        if (typeof input === 'object' && 'message' in input) {
          console.log('[toast]', input.title, input.message)
        } else {
          console.log('[toast]', input)
        }
      },
    }
  }
  return ctx
}
