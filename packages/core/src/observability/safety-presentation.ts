/** Return the stable display label for a Safety target or the target itself. @internal */
export function safetyTargetLabel(target: string): string {
  switch (target) {
    case 'model.input.text':
      return 'Model input · Text'
    case 'model.input.media':
      return 'Model input · Media'
    case 'model.input.tools':
      return 'Model input · Tools'
    case 'model.instructions':
      return 'Model instructions'
    default:
      return target
  }
}

/** Build a render-safe Safety target reference. @internal */
export function safetyTarget(target: string): { readonly id: string; readonly label: string } {
  return { id: target, label: safetyTargetLabel(target) }
}
