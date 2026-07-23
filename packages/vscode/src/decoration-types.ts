import {
  decorationSeverities,
  type DecorationSeverity,
} from './decoration-policy.js'

interface DisposableDecorationType {
  dispose(): void
}

type DecorationTypeSet<Type extends DisposableDecorationType> = Readonly<
  Record<DecorationSeverity, Type>
>

/** Owns the replaceable editor decoration types for one extension instance. */
export class DecorationTypeRegistry<Type extends DisposableDecorationType> {
  #current: DecorationTypeSet<Type>

  constructor(
    private readonly create: (opacity: number) => DecorationTypeSet<Type>,
    opacity: number,
  ) {
    this.#current = create(normalizeDecorationOpacity(opacity))
  }

  /** Returns the active type set used for the next editor update. */
  get current(): DecorationTypeSet<Type> {
    return this.#current
  }

  /** Replaces all types so existing decoration options pick up new opacity. */
  rebuild(opacity: number): void {
    const previous = this.#current
    this.#current = this.create(normalizeDecorationOpacity(opacity))
    disposeTypes(previous)
  }

  /** Releases the active editor decoration types. */
  dispose(): void {
    disposeTypes(this.#current)
  }
}

/** Normalizes workspace configuration to the manifest's supported range. */
export function normalizeDecorationOpacity(value: number): number {
  if (!Number.isFinite(value)) return 0.65
  return Math.min(1, Math.max(0.1, value))
}

/** Applies a decoration setting change and refreshes after type replacement. */
export function handleDecorationConfigurationChange<
  Type extends DisposableDecorationType,
>(
  affectsConfiguration: (section: string) => boolean,
  registry: DecorationTypeRegistry<Type>,
  opacity: number,
  refresh: () => void,
): void {
  if (!affectsConfiguration('crux.decorations')) return
  if (affectsConfiguration('crux.decorations.opacity')) {
    registry.rebuild(opacity)
  }
  refresh()
}

function disposeTypes<Type extends DisposableDecorationType>(
  types: DecorationTypeSet<Type>,
): void {
  for (const severity of decorationSeverities) types[severity].dispose()
}
