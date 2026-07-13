(function () {
  const root = document.documentElement
  root.classList.add('js')
  const buttons = document.querySelectorAll('[data-theme-toggle]')
  const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
  let stored = null
  try {
    stored = localStorage.getItem('crux-plan-theme')
  } catch {
    // Theme persistence is optional; the document remains fully usable.
  }

  if (stored === 'light' || stored === 'dark') root.dataset.theme = stored

  function resolvedTheme() {
    if (root.dataset.theme) return root.dataset.theme
    return systemTheme.matches ? 'dark' : 'light'
  }

  function updateLabels() {
    const next = resolvedTheme() === 'dark' ? 'light' : 'dark'
    buttons.forEach((button) => {
      button.textContent = next === 'dark' ? 'Dark' : 'Light'
      button.setAttribute('aria-label', `Use ${next} theme`)
    })
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = resolvedTheme() === 'dark' ? 'light' : 'dark'
      root.dataset.theme = next
      try {
        localStorage.setItem('crux-plan-theme', next)
      } catch {
        // Ignore storage failures in restrictive or file-based environments.
      }
      updateLabels()
    })
  })

  systemTheme.addEventListener?.('change', updateLabels)

  updateLabels()
})()
