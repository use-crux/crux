const specifier = './conditional-portable.mjs'

export function loadAtRuntime() {
  return import(specifier)
}
