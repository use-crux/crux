export type SemanticValueExportRoute<TModule, TTerminal> =
  | {
      readonly kind: "module";
      readonly module: TModule;
      readonly exportName: string;
      readonly canonicalPackageRoot: boolean;
      readonly typeOnly?: boolean;
    }
  | {
      readonly kind: "terminal";
      readonly terminal: TTerminal;
      readonly typeOnly?: boolean;
    };

export interface SemanticValueExportRouteSet<TModule, TTerminal> {
  readonly routes: readonly SemanticValueExportRoute<TModule, TTerminal>[];
  readonly invalid?: boolean;
}

export interface SemanticValueExportProvenanceView<TModule, TTerminal> {
  readonly moduleKey: (module: TModule) => string;
  readonly terminalKey: (terminal: TTerminal) => string;
  readonly routes: (
    module: TModule,
    exportName: string,
  ) => SemanticValueExportRouteSet<TModule, TTerminal>;
}

export interface SemanticValueExportProvenanceInput<TModule, TTerminal> {
  readonly module: TModule;
  readonly exportName: string;
  readonly canonicalPackageRoot: boolean;
  readonly view: SemanticValueExportProvenanceView<TModule, TTerminal>;
}

/**
 * Resolves one authored value-export route to a unique canonical terminal.
 *
 * Type-only edges contribute no value route. Any candidate cycle, invalid
 * module evidence, or multiple distinct value terminals fails the proof.
 */
export function semanticValueExportTerminal<TModule, TTerminal>(
  input: SemanticValueExportProvenanceInput<TModule, TTerminal>,
): TTerminal | undefined {
  try {
    const result = visit(
      input.module,
      input.exportName,
      input.canonicalPackageRoot,
      input.view,
      new Set(),
    );
    if (result.invalid) return undefined;
    const terminals = new Map<
      string,
      { readonly terminal: TTerminal; readonly canonicalPackageRoot: boolean }
    >();
    for (const candidate of result.terminals) {
      const key = input.view.terminalKey(candidate.terminal);
      const existing = terminals.get(key);
      terminals.set(key, {
        terminal: candidate.terminal,
        canonicalPackageRoot:
          candidate.canonicalPackageRoot ||
          existing?.canonicalPackageRoot === true,
      });
    }
    if (terminals.size !== 1) return undefined;
    const resolved = terminals.values().next().value;
    return resolved?.canonicalPackageRoot ? resolved.terminal : undefined;
  } catch {
    return undefined;
  }
}

interface VisitResult<TTerminal> {
  readonly invalid: boolean;
  readonly terminals: readonly {
    readonly terminal: TTerminal;
    readonly canonicalPackageRoot: boolean;
  }[];
}

function visit<TModule, TTerminal>(
  module: TModule,
  exportName: string,
  canonicalPackageRoot: boolean,
  view: SemanticValueExportProvenanceView<TModule, TTerminal>,
  ancestors: ReadonlySet<string>,
): VisitResult<TTerminal> {
  const key = `${view.moduleKey(module)}\0${exportName}`;
  if (ancestors.has(key)) return { invalid: true, terminals: [] };
  const nextAncestors = new Set(ancestors);
  nextAncestors.add(key);

  const routeSet = view.routes(module, exportName);
  if (routeSet.invalid) return { invalid: true, terminals: [] };
  const valueRoutes = routeSet.routes.filter((route) => !route.typeOnly);
  if (valueRoutes.length === 0) return { invalid: true, terminals: [] };

  const terminals: {
    readonly terminal: TTerminal;
    readonly canonicalPackageRoot: boolean;
  }[] = [];
  for (const route of valueRoutes) {
    if (route.kind === "terminal") {
      terminals.push({ terminal: route.terminal, canonicalPackageRoot });
      continue;
    }
    const nested = visit(
      route.module,
      route.exportName,
      canonicalPackageRoot || route.canonicalPackageRoot,
      view,
      nextAncestors,
    );
    if (nested.invalid) return { invalid: true, terminals: [] };
    terminals.push(...nested.terminals);
  }
  return { invalid: false, terminals };
}
