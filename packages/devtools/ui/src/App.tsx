/**
 * Quality Workbench root.
 *
 * Mounts the QwShell with the right screen for the current navigation
 * state, plus theme + tooltip contexts. React 19 primitives in use:
 *
 *  - `useTransition` inside `useNavigation()` keeps the previous screen
 *    visible while the next (lazy-loaded) page resolves; a thin top
 *    progress bar communicates the in-flight transition.
 *  - `Suspense` at the route boundary catches every lazy-loaded page +
 *    any data-fetching component that uses Suspense in the future.
 *    The fallback is a layout-stable `<SkeletonPage>`.
 *  - `ErrorBoundary` (resetKey'd on navigation) wraps the router so a
 *    page crash doesn't kill the shell. Section-level boundaries live
 *    inside individual pages via `SectionBoundary`.
 *
 * Screens subscribe to specific runtime slices via the selector hooks
 * in `app/runtime/runtimeStore.ts` — only screens that read a slice
 * re-render when that slice changes.
 */

import { Suspense, useEffect } from 'react'
import { useDevtools } from './app/runtime/useDevtools'
import { useConnected, useHasEverConnected } from './app/runtime/runtimeStore'
import { NavigationProvider, useNavigation } from './app/navigation/useNavigation'
import { TooltipProvider } from '@/shared/components/ui/tooltip'
import { ErrorBoundary } from './qw/shell/ErrorBoundary'
import { QwSidebar } from './qw/shell/QwSidebar'
import { ToastProvider } from './qw/shell/useToast'
import { GlobalSearch } from './features/search/components/GlobalSearch'
import { useGlobalSearchShortcut } from './features/search/hooks/useGlobalSearchShortcut'
import { AppRouter, WaitingShell } from './app/router/AppRouter'
import { SkeletonPage } from '@/shared/components/Skeleton'

export function App() {
  return (
    <NavigationProvider>
      <TooltipProvider>
        <ToastProvider>
          <AppInner />
        </ToastProvider>
      </TooltipProvider>
    </NavigationProvider>
  )
}

function AppInner() {
  const { nav, isNavigating } = useNavigation()
  useDevtools() // bootstraps WS + Query invalidation; state read via selectors
  const connected = useConnected()
  // `hasEverConnected` is the gate: once we land a single WS connection
  // we stop showing the onboarding shell, even on later disconnects
  // (the ConnectionBanner inside QwShell handles those). This separates
  // session-lifecycle state from catalog data — App.tsx no longer
  // reads catalog at all, so unrelated catalog WS pushes don't
  // re-render the root.
  const hasEverConnected = useHasEverConnected()
  const { isOpen, setIsOpen } = useGlobalSearchShortcut()

  // Listen for the shell's "open-search" custom event so the sidebar
  // ⌘K button opens the same dialog as the keyboard shortcut.
  useEffect(() => {
    function onOpen() {
      setIsOpen(true)
    }
    window.addEventListener('qw:open-search', onOpen as EventListener)
    return () => window.removeEventListener('qw:open-search', onOpen as EventListener)
  }, [setIsOpen])

  if (!hasEverConnected) {
    return <WaitingShell connected={connected} />
  }

  return (
    <>
      {/* Indeterminate top progress bar shown while a route transition
          is pending. Fixed positioning so it overlays the shell without
          pushing layout. */}
      {isNavigating && (
        <div
          className="qw-progress-bar"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            zIndex: 60,
          }}
          aria-hidden
        />
      )}
      {/* Persistent shell: sidebar stays mounted across route swaps so
          (a) navigation never blanks during a Suspense fallback and
          (b) the view transition only animates the content column,
          not the navbar. */}
      <div
        className="flex h-screen min-h-0 overflow-hidden"
        style={{
          background: 'var(--qw-bg)',
          color: 'var(--qw-fg)',
          fontFamily: 'var(--qw-sans)',
        }}
      >
        <QwSidebar />
        <ErrorBoundary resetKey={JSON.stringify(nav)}>
          <Suspense fallback={<SkeletonPage />}>
            <AppRouter nav={nav} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <GlobalSearch isOpen={isOpen} setIsOpen={setIsOpen} hideTrigger />
    </>
  )
}
