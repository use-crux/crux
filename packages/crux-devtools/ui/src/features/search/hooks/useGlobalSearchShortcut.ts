import { useEffect, useState } from 'react'

export function useGlobalSearchShortcut() {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return { isOpen, setIsOpen }
}
