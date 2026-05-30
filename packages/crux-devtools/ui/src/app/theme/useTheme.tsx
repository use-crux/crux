import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'

const ThemeContext = createContext<{
  theme: Theme
  setTheme: (t: Theme) => void
  toggle: () => void
}>({ theme: 'dark', setTheme: () => {}, toggle: () => {} })

const STORAGE_KEY = 'crux-devtools-theme'

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  const setTheme = (t: Theme) => {
    setThemeState(t)
    localStorage.setItem(STORAGE_KEY, t)
  }

  useEffect(() => {
    const root = document.documentElement
    root.classList.toggle('dark', theme === 'dark')
  }, [theme])

  return (
    <ThemeContext.Provider
      value={{
        theme,
        setTheme,
        toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      }}
    >
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
