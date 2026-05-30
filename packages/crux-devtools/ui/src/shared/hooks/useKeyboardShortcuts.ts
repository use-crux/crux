import { useEffect, useCallback, useRef } from 'react'

interface KeyboardShortcutsOptions {
  /** List of trace IDs in display order */
  traceIds: string[]
  /** Currently selected trace ID */
  selectedTraceId: string | null
  /** Callback to select a trace */
  onSelectTrace: (traceId: string) => void
  /** Callback to deselect (Esc) */
  onDeselect: () => void
  /** Callback to open search (/) */
  onOpenSearch?: () => void
}

export function useKeyboardShortcuts({
  traceIds,
  selectedTraceId,
  onSelectTrace,
  onDeselect,
  onOpenSearch,
}: KeyboardShortcutsOptions) {
  const traceIdsRef = useRef(traceIds)
  traceIdsRef.current = traceIds

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Don't intercept when typing in inputs
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement).isContentEditable) return

      switch (e.key) {
        case 'j': {
          // Next trace
          e.preventDefault()
          const ids = traceIdsRef.current
          if (ids.length === 0) return
          if (!selectedTraceId) {
            onSelectTrace(ids[0]!)
          } else {
            const idx = ids.indexOf(selectedTraceId)
            if (idx < ids.length - 1) {
              onSelectTrace(ids[idx + 1]!)
            }
          }
          break
        }
        case 'k': {
          // Previous trace
          e.preventDefault()
          const ids = traceIdsRef.current
          if (ids.length === 0) return
          if (!selectedTraceId) {
            onSelectTrace(ids[ids.length - 1]!)
          } else {
            const idx = ids.indexOf(selectedTraceId)
            if (idx > 0) {
              onSelectTrace(ids[idx - 1]!)
            }
          }
          break
        }
        case 'Escape': {
          e.preventDefault()
          onDeselect()
          break
        }
        case '/': {
          if (onOpenSearch) {
            e.preventDefault()
            onOpenSearch()
          }
          break
        }
      }
    },
    [selectedTraceId, onSelectTrace, onDeselect, onOpenSearch],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])
}
